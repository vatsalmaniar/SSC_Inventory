import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import PeoplePager from '../components/PeoplePager'
import { siteFromNote, isBareEssl } from '../lib/deviceLabel'
import PeopleAvatar from '../components/PeopleAvatar'
import { visibleEmployees } from '../lib/peopleScope'
import { istYmd, istMinutes, toMin, DEFAULT_CFG, PUNCH_DEBOUNCE_MS } from '../lib/attendance'
import '../styles/people.css'
import '../styles/attendance-ui.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const PER = 50
const TIMELINES = [
  { key: 'today',     label: 'Today' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'custom',    label: 'Custom' },
]

// [start, end) date window for the selected timeline
function rangeFor(kind, cf, ct) {
  const now = new Date()
  const som = (y, m) => new Date(y, m, 1)
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0)
  const endNow = new Date(now); endNow.setDate(endNow.getDate() + 1); endNow.setHours(0, 0, 0, 0)
  if (kind === 'today') return [startToday, endNow]
  if (kind === 'week') { const d = new Date(startToday); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return [d, endNow] }
  if (kind === 'lastmonth') return [som(now.getFullYear(), now.getMonth() - 1), som(now.getFullYear(), now.getMonth())]
  if (kind === 'custom') {
    const st = cf ? new Date(cf + 'T00:00:00') : som(now.getFullYear(), now.getMonth())
    const en = ct ? (() => { const x = new Date(ct + 'T00:00:00'); x.setDate(x.getDate() + 1); return x })() : endNow
    return [st, en]
  }
  return [som(now.getFullYear(), now.getMonth()), som(now.getFullYear(), now.getMonth() + 1)] // month
}

export default function PeopleSwipes() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [role, setRole] = useState('')
  const [emps, setEmps] = useState([])
  const [rows, setRows] = useState([])
  const [timeline, setTimeline] = useState('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [fEmp, setFEmp] = useState('all')
  const [fBranch, setFBranch] = useState('all')
  const [fDept, setFDept] = useState('all')
  const [fMethod, setFMethod] = useState('all')
  const [fDir, setFDir] = useState('all')
  const [fLate, setFLate] = useState(false)   // first punch of the day after grace
  const [page, setPage] = useState(1)

  // refetch when the window changes (custom only refetches once both/one bound set)
  useEffect(() => { init() }, [timeline, customFrom, customTo]) // eslint-disable-line

  async function init() {
    setLoading(true); setPage(1)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    const { data: me } = await sb.from('employees').select('id').eq('profile_id', session.user.id).maybeSingle()
    const mgmt = ['admin', 'management'].includes(prof?.role)
    if (!mgmt && !me?.id) { setDenied(true); setLoading(false); return }
    // The DB decides the roster (admin all / management all-but-admin / everyone else self).
    const { data: list } = await visibleEmployees('attendance')
    const scope = list || []
    setEmps(scope)
    const ids = scope.map(e => e.id)
    if (!ids.length) { setRows([]); setLoading(false); return }
    const [start, end] = rangeFor(timeline, customFrom, customTo)
    const { data } = await fetchAll((from, to) =>
      sb.from('attendance_punches').select('id,employee_id,punch_at,direction,method,lat,lng,note')
        .in('employee_id', ids).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString())
        .order('punch_at', { ascending: false }).order('id').range(from, to))
    setRows(data || [])
    setLoading(false)
  }

  const nameOf = useMemo(() => { const m = {}; emps.forEach(e => m[e.id] = e.full_name); return m }, [emps])
  const empBy = useMemo(() => { const m = {}; emps.forEach(e => m[e.id] = e); return m }, [emps])
  const branches = useMemo(() => [...new Set(emps.map(e => e.branch).filter(Boolean))].sort(), [emps])
  const depts = useMemo(() => [...new Set(emps.map(e => e.department).filter(Boolean))].sort(), [emps])

  // The device's own in/out flag is unreliable and the policy engine IGNORES it
  // (computeDay derives from punch order). This log now shows the same truth: per person
  // per IST day, debounced punches alternate In → Out; a repeat scan within the debounce
  // window is marked Duplicate. `first` marks the day's first kept punch (the arrival).
  const derived = useMemo(() => {
    const by = {}
    rows.forEach(r => { const k = r.employee_id + '|' + istYmd(r.punch_at); (by[k] ||= []).push(r) })
    const m = {}
    Object.values(by).forEach(list => {
      const sorted = list.slice().sort((a, b) => new Date(a.punch_at) - new Date(b.punch_at))
      let kept = 0, lastKept = null
      sorted.forEach(r => {
        const t = new Date(r.punch_at)
        if (lastKept && (t - lastKept) < PUNCH_DEBOUNCE_MS) { m[r.id] = { dir: 'dup', first: false }; return }
        lastKept = t
        m[r.id] = { dir: kept % 2 === 0 ? 'in' : 'out', first: kept === 0 }
        kept++
      })
    })
    return m
  }, [rows])
  // Method options come from the data, not a hardcoded pair — 'web' and 'regularization'
  // punches exist too and a fixed list silently hides them (stale-filter bug, 2026-09-03).
  const METHOD_LABEL = { biometric: 'Biometric', mobile: 'Mobile GPS', web: 'Web check-in', regularization: 'Regularization' }
  const methods = useMemo(() => [...new Set(rows.map(r => r.method).filter(Boolean))].sort(), [rows])
  const graceMin = toMin(DEFAULT_CFG.grace_until)
  const isLateIn = r => !!derived[r.id]?.first && istMinutes(r.punch_at) > graceMin

  const filtered = useMemo(() => rows.filter(r =>
    (fEmp === 'all' || r.employee_id === fEmp) &&
    (fBranch === 'all' || empBy[r.employee_id]?.branch === fBranch) &&
    (fDept === 'all' || empBy[r.employee_id]?.department === fDept) &&
    (fMethod === 'all' || r.method === fMethod) &&
    (fDir === 'all' || derived[r.id]?.dir === fDir) &&
    (!fLate || isLateIn(r))
  ), [rows, fEmp, fBranch, fDept, fMethod, fDir, fLate, derived, empBy]) // eslint-disable-line
  useEffect(() => { setPage(1) }, [fEmp, fBranch, fDept, fMethod, fDir, fLate])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const safePage = Math.min(page, totalPages)
  const view = filtered.slice((safePage - 1) * PER, safePage * PER)

  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || '…'} – ${customTo || '…'}` : 'Custom range')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fmtDT = iso => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })

  async function downloadSwipes() {
    if (!filtered.length) { alert('No swipes to export.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library.'); return }
    const wb = new ExcelJS.Workbook(); wb.creator = 'SSC ERP'; wb.created = new Date()
    const ws = wb.addWorksheet('Swipes', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { header: 'Employee', key: 'emp', width: 24 },
      { header: 'Date & Time', key: 'dt', width: 22 },
      { header: 'In/Out', key: 'dir', width: 8 },
      { header: 'Method', key: 'method', width: 14 },
      { header: 'Location', key: 'loc', width: 42 },
      { header: 'Latitude', key: 'lat', width: 12 },
      { header: 'Longitude', key: 'lng', width: 12 },
    ]
    filtered.forEach(r => ws.addRow({
      emp: nameOf[r.employee_id] || '', dt: new Date(r.punch_at).toLocaleString('en-IN'),
      dir: derived[r.id]?.dir === 'dup' ? 'Duplicate' : derived[r.id]?.dir === 'in' ? 'In' : 'Out',
      method: r.method === 'mobile' ? 'Mobile GPS' : r.method === 'biometric' ? 'Biometric' : r.method,
      loc: r.note || '', lat: r.lat ?? '', lng: r.lng ?? '',
    }))
    xlsFinish(ws, 7)
    await xlsDownload(wb, `Swipes_${timelineLabel.replace(/[^a-z0-9]+/gi, '_')}.xlsx`)
  }

  if (loading) return <Layout pageKey="people" pageTitle="Swipes"><div className="orders-app"><div className="o-loading">Loading swipes…</div></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="Swipes"><div className="orders-app"><div className="o-empty">No swipe access.</div></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Swipes">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={() => navigate('/people')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>People
            </button>
            <h1 className="page-title">Swipes</h1>
            <div className="page-sub">{filtered.length} swipes · {timelineLabel}</div>
          </div>
          <div className="page-meta">
            <button className="btn-ghost" onClick={downloadSwipes} title="Download swipes (Excel)">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
          </div>
        </div>

        <AttendanceTabs role={role} isManager={true} />

        {/* timeline + filters, in the shared control language */}
        <div className="ph-filters">
          <div className="ph-seg" role="group" aria-label="Timeline">
            {TIMELINES.map(({ key, label }) => (
              <button key={key} className={timeline === key ? 'on' : ''} onClick={() => setTimeline(key)}>{label}</button>
            ))}
          </div>
          {timeline === 'custom' && (
            <span className="ph-monthwrap">
              <input className="ph-month" type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              <span className="ph-dash">to</span>
              <input className="ph-month" type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              {(customFrom || customTo) && <button className="ph-month-x" onClick={() => { setCustomFrom(''); setCustomTo('') }}>Clear</button>}
            </span>
          )}
          {emps.length > 1 && (
            <select className="ph-picker" value={fEmp} onChange={e => setFEmp(e.target.value)}>
              <option value="all">All people</option>
              {emps.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          )}
          {branches.length > 1 && (
            <select className="ph-picker" value={fBranch} onChange={e => setFBranch(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          {depts.length > 1 && (
            <select className="ph-picker" value={fDept} onChange={e => setFDept(e.target.value)}>
              <option value="all">All departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <select className="ph-picker" value={fMethod} onChange={e => setFMethod(e.target.value)}>
            <option value="all">All methods</option>
            {methods.map(m => <option key={m} value={m}>{METHOD_LABEL[m] || m}</option>)}
          </select>
          <select className="ph-picker" value={fDir} onChange={e => setFDir(e.target.value)}>
            <option value="all">In &amp; Out</option><option value="in">In only</option><option value="out">Out only</option><option value="dup">Duplicates</option>
          </select>
          <button onClick={() => setFLate(v => !v)} title="First punch of the day after 10:15"
            className={'ph-chip' + (fLate ? ' on' : '')}>Late in{fLate ? ' · on' : ''}</button>
        </div>

        <div className="card">
          <div className="ph-tbl-wrap">
            <table className="ph-tbl" style={{ minWidth: 820 }}>
              <thead><tr><th>Employee</th><th>Date &amp; time</th><th>In / Out</th><th>Method</th><th>Location</th><th className="r">GPS</th></tr></thead>
              <tbody>
                {view.length === 0 ? <tr><td colSpan={6}><div className="o-empty">No swipes match these filters.</div></td></tr> : view.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="lv-emp">
                        <PeopleAvatar name={nameOf[r.employee_id] || ''} className="avatar" style={{ width: 24, height: 24, fontSize: 10, fontWeight: 600, flexShrink: 0 }} />
                        <span className="lv-emp-n">{nameOf[r.employee_id] || '—'}</span>
                      </div>
                    </td>
                    <td className="m">
                      {fmtDT(r.punch_at)}
                      {isLateIn(r) && <span className="ph-reg is-pending" style={{width:'auto',padding:'0 5px',borderRadius:5}}>late</span>}
                    </td>
                    <td>{(() => { const d = derived[r.id]?.dir
                      return d === 'dup'
                        ? <span className="ol-status-pill" style={{ '--stage-color': '#94A3B8' }} title="Repeat scan within 2 minutes — ignored by attendance"><span className="ol-status-dot" />Dup</span>
                        : <span className="ol-status-pill" style={{ '--stage-color': d === 'in' ? '#10B981' : '#F59E0B' }} title="Derived from punch order (device flag is unreliable)"><span className="ol-status-dot" />{d === 'in' ? 'In' : 'Out'}</span> })()}</td>
                    <td><span className={'ph-tag ' + (r.method === 'mobile' ? 'is-gps' : r.method === 'biometric' ? 'is-bio' : 'is-web')}>{r.method === 'mobile' ? 'Mobile GPS' : r.method === 'biometric' ? 'Biometric' : (METHOD_LABEL[r.method] || r.method)}</span></td>
                    {/* Biometric notes become the site name (HO / Kaveri / Godawari);
                        a bare "eSSL" means the device was not in ETT_DEVICE_MAP, so the
                        site is unknown and we say so rather than guessing. Mobile punches
                        keep their reverse-geocoded address. */}
                    <td className="lv-reason" title={r.note || ''}>{(() => {
                      if (isBareEssl(r.note)) return <span className="ph-noswipe">device not mapped</span>
                      const site = siteFromNote(r.note)
                      return site ? <span className="ph-tag is-bio">{site}</span> : (r.note || '—')
                    })()}</td>
                    <td className="r">{r.lat != null && r.lng != null
                      ? <a className="ph-loc" href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" title="Open location in Maps"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg></a>
                      : <span style={{ color: 'var(--o-muted-2)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* House pager — replaces this page's bespoke swf-pg buttons. */}
          <PeoplePager page={safePage} setPage={setPage} total={filtered.length} pageSize={PER} />
        </div>
      </div>
    </Layout>
  )
}
