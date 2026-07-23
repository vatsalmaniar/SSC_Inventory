import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fetchAll } from '../lib/fetchAll'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import PeopleAvatar from '../components/PeopleAvatar'
import { Spinner } from '../components/PeopleLoaders'
import { adminEmpIds } from '../lib/attScope'
import '../styles/people.css'
import '../styles/attendance-ui.css'

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
  const [fMethod, setFMethod] = useState('all')
  const [fDir, setFDir] = useState('all')
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
    let empQ = sb.from('employees').select('id,full_name').neq('lifecycle_status', 'exited').order('full_name')
    if (!mgmt) { if (!me?.id) { setDenied(true); setLoading(false); return } empQ = empQ.eq('id', me.id) }  // user: own swipes only
    const { data: list } = await empQ
    let scope = list || []
    if (prof?.role === 'management') { const ex = await adminEmpIds(); scope = scope.filter(e => !ex.includes(e.id)) }
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
  const filtered = useMemo(() => rows.filter(r =>
    (fEmp === 'all' || r.employee_id === fEmp) &&
    (fMethod === 'all' || r.method === fMethod) &&
    (fDir === 'all' || r.direction === fDir)
  ), [rows, fEmp, fMethod, fDir])
  useEffect(() => { setPage(1) }, [fEmp, fMethod, fDir])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER))
  const safePage = Math.min(page, totalPages)
  const view = filtered.slice((safePage - 1) * PER, safePage * PER)
  const pageWindow = useMemo(() => {
    const w = []; const lo = Math.max(1, safePage - 2), hi = Math.min(totalPages, lo + 4)
    for (let p = Math.max(1, hi - 4); p <= hi; p++) w.push(p)
    return w
  }, [safePage, totalPages])

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
      dir: r.direction === 'in' ? 'In' : 'Out',
      method: r.method === 'mobile' ? 'Mobile GPS' : r.method === 'biometric' ? 'Biometric' : r.method,
      loc: r.note || '', lat: r.lat ?? '', lng: r.lng ?? '',
    }))
    xlsFinish(ws, 7)
    await xlsDownload(wb, `Swipes_${timelineLabel.replace(/[^a-z0-9]+/gi, '_')}.xlsx`)
  }

  if (loading) return <Layout pageKey="people" pageTitle="Swipes"><div className="people-app"><Spinner label="Loading swipes…" /></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="Swipes"><div className="people-app"><div className="e-empty">No swipe access.</div></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Swipes">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={() => navigate('/people/attendance')} style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, padding: 0, marginBottom: 4 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M19 12H5M12 5l-7 7 7 7" /></svg>Attendance
            </button>
            <h1 className="ph-title">Swipes</h1>
            <div className="ph-sub">{filtered.length} swipes · {timelineLabel}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-neutral btn-sm" onClick={downloadSwipes} title="Download swipes (Excel)">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </button>
          </div>
        </div>

        <AttendanceTabs role={role} isManager={true} />

        {/* timeline (Order-List style) */}
        <div className="swf-tl" style={{ marginBottom: 12 }}>
          {TIMELINES.map(({ key, label }) => (
            <button key={key} className={timeline === key ? 'on' : ''} onClick={() => setTimeline(key)}>{label}</button>
          ))}
          {timeline === 'custom' && (
            <div className="swf-custom">
              <span>From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              <span>To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
              {(customFrom || customTo) && <button className="btn btn-sm" style={{ padding: '4px 8px', fontSize: 11, color: 'var(--neg)' }} onClick={() => { setCustomFrom(''); setCustomTo('') }}>Clear</button>}
            </div>
          )}
        </div>

        {/* person / method / direction filters */}
        <div className="filters">
          {emps.length > 1 && (
            <div className="f-sel"><select value={fEmp} onChange={e => setFEmp(e.target.value)}>
              <option value="all">All people</option>
              {emps.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select></div>
          )}
          <div className="f-sel"><select value={fMethod} onChange={e => setFMethod(e.target.value)}>
            <option value="all">All methods</option><option value="biometric">Biometric</option><option value="mobile">Mobile GPS</option>
          </select></div>
          <div className="f-sel"><select value={fDir} onChange={e => setFDir(e.target.value)}>
            <option value="all">In &amp; Out</option><option value="in">In only</option><option value="out">Out only</option>
          </select></div>
        </div>

        <div className="acard" style={{ overflow: 'hidden' }}>
          <div className="tbl-wrap">
            <table className="dtbl" style={{ minWidth: 820 }}>
              <thead><tr><th>Employee</th><th>Date &amp; time</th><th>In / Out</th><th>Method</th><th>Location</th><th className="r">GPS</th></tr></thead>
              <tbody>
                {view.length === 0 ? <tr><td colSpan={6}><div className="list-empty">No swipes match these filters.</div></td></tr> : view.map(r => (
                  <tr key={r.id}>
                    <td><div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                      <PeopleAvatar name={nameOf[r.employee_id] || ''} className="avatar" style={{ width: 24, height: 24, fontSize: 10, fontWeight: 600, flexShrink: 0 }} />
                      <span style={{ fontSize:12.5, color:'var(--ink)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{nameOf[r.employee_id] || '—'}</span></div></td>
                    <td style={{ color: 'var(--muted)', fontSize: 13 }}>{fmtDT(r.punch_at)}</td>
                    <td><span className="io-pill" style={{ '--sc': r.direction === 'in' ? '#10B981' : '#F59E0B' }}><span className="io-dot" />{r.direction === 'in' ? 'In' : 'Out'}</span></td>
                    <td>{r.method === 'mobile' ? <span className="method-tag gps">Mobile GPS</span> : r.method === 'biometric' ? <span className="method-tag biometric">Biometric</span> : <span className="method-tag web">{r.method}</span>}</td>
                    <td style={{ color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.note || ''}>{r.note || '—'}</td>
                    <td className="r">{r.lat != null && r.lng != null
                      ? <a className="loc-icon" href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" title="Open location in Maps"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0Z"/><circle cx="12" cy="10" r="3"/></svg></a>
                      : <span style={{ color: 'var(--muted-2)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--line-2)', flexWrap: 'wrap', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{filtered.length} swipes · page {safePage} of {totalPages}</span>
              <div className="swf-pages">
                <button className="swf-pg" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
                {pageWindow[0] > 1 && <><button className="swf-pg" onClick={() => setPage(1)}>1</button>{pageWindow[0] > 2 && <span style={{ color: 'var(--muted-2)', padding: '0 2px' }}>…</span>}</>}
                {pageWindow.map(p => <button key={p} className={'swf-pg' + (p === safePage ? ' on' : '')} onClick={() => setPage(p)}>{p}</button>)}
                {pageWindow[pageWindow.length - 1] < totalPages && <>{pageWindow[pageWindow.length - 1] < totalPages - 1 && <span style={{ color: 'var(--muted-2)', padding: '0 2px' }}>…</span>}<button className="swf-pg" onClick={() => setPage(totalPages)}>{totalPages}</button></>}
                <button className="swf-pg" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>›</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
