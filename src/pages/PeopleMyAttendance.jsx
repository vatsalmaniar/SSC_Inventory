import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { computeDay, loadWeekOffOverrides, minToHrs, fmtTime, toMin, STATUS_META, DEFAULT_CFG, effShift, declarationFor, applyDeclaration, istYmd, istMinutes } from '../lib/attendance'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import LeavePolicyDrawer from '../components/LeavePolicyDrawer'
import StatusDonut from '../components/StatusDonut'
import TrendChart from '../components/TrendChart'
import MyStat from '../components/StatTile'
import { visibleEmployees } from '../lib/peopleScope'
import '../styles/people.css'
import '../styles/attendance-ui.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const ymd = istYmd   // IST work date — never the viewer's timezone
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`

export default function PeopleMyAttendance() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const empParam = params.get('emp')
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [role, setRole] = useState('')
  const [emp, setEmp] = useState(null)      // target employee
  const [meId, setMeId] = useState(null)
  const [satWorker, setSatWorker] = useState(false)  // works the 2nd/4th Saturday —
                                                    // from att_saturday_workers() in the DB
  const [picks, setPicks] = useState([])    // employees this viewer may open
  const [cfg, setCfg] = useState(DEFAULT_CFG)
  const [policy, setPolicy] = useState(false)
  const [holidays, setHolidays] = useState(new Set())
  const [punches, setPunches] = useState([])
  const [leaveDates, setLeaveDates] = useState({})   // date -> approved leave_requests row
  const [imported, setImported] = useState({})   // work_date -> imported muster status
  const [decls, setDecls] = useState([])         // special-day declarations covering this month
  const [regs, setRegs] = useState({})           // work_date -> regularization row
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })
  // List by default -- exact arrival and departure times are what people come here for.
  // Calendar is one click away for reading the shape of the month. A previous explicit
  // choice still wins, so anyone who switched to calendar keeps it.
  const [recView, setRecView] = useState(() => {
    try {
      const v = localStorage.getItem('att.recView')
      return v === 'calendar' || v === 'list' ? v : 'list'
    } catch { return 'list' }
  })
  useEffect(() => { try { localStorage.setItem('att.recView', recView) } catch { /* private mode */ } }, [recView])

  const isFC = (emp?.branch || '').startsWith('FC')

  useEffect(() => { init() }, [empParam, cursor]) // eslint-disable-line

  async function init() {
    setLoading(true)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    const { data: myEmp } = await sb.from('employees').select('id').eq('profile_id', session.user.id).maybeSingle()
    setMeId(myEmp?.id || null)
    const mgmt = ['admin','management'].includes(prof?.role)
    // Picker roster comes from the DB: admin → all; management → all but admin; user → self.
    const { data: picksData } = await visibleEmployees('attendance')
    setPicks(picksData || [])
    const targetId = empParam || myEmp?.id
    if (!targetId) { setDenied(true); setLoading(false); return }
    const { data: t } = await sb.from('employees').select('*').eq('id', targetId).maybeSingle()
    if (!t) { setDenied(true); setLoading(false); return }
    // Access = "is this person in the roster the DB just handed me?". Previously the page
    // re-derived it (self / admin / management-not-admin) from its own admin-id list; that
    // was the rule written a second time. att_visible_employees already answers it, so a
    // target outside the roster is refused outright rather than rendering an empty month.
    const canView = (picksData || []).some(e => e.id === targetId)
    if (!canView) { setDenied(true); setLoading(false); return }
    setEmp(t)
    // Ask the database who works the 2nd/4th Saturday (same rule as OT eligibility)
    // rather than re-deriving role+designation here.
    const { data: sw } = await sb.rpc('att_saturday_workers')
    setSatWorker((sw || []).some(r => r.employee_id === t.id))
    // No need to pass it down: the days useMemo lists satWorker as a dependency,
    // so it re-scores the month as soon as the state commits.
    await load(t)
    setLoading(false)
  }

  async function load(t) {
    await loadWeekOffOverrides(sb)   // swapped week-offs before any day is scored
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const end = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1)
    const [c, hol, p, lv, ad, dc, rg] = await Promise.all([
      sb.from('attendance_config').select('*').maybeSingle(),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      sb.from('attendance_punches').select('punch_at,direction').eq('employee_id', t.id).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString()).order('punch_at'),
      sb.from('leave_requests').select('from_date,to_date,is_half_day').eq('employee_id', t.id).eq('status','approved'),
      sb.from('attendance_days').select('work_date,status').eq('employee_id', t.id).gte('work_date', ymd(start)).lt('work_date', ymd(end)),
      sb.from('attendance_declarations').select('*').lt('from_date', ymd(end)).gte('to_date', ymd(start)),
      // Approved regularizations carry the times HR accepted in place of the device
      // reading, which is exactly what a person wants to see when the swipe looks wrong.
      sb.from('regularizations').select('work_date,requested_in,requested_out,status,reason')
        .eq('employee_id', t.id).gte('work_date', ymd(start)).lt('work_date', ymd(end)),
    ])
    setCfg(c?.data || DEFAULT_CFG); setHolidays(new Set((hol?.data||[]).map(h=>h.holiday_date))); setPunches(p?.data||[]); setDecls(dc?.data||[])
    // keep the request itself — is_half_day decides whether the day costs 0.5 or a full paid day
    const ld = {}
    ;(lv?.data||[]).forEach(r => { let d=new Date(r.from_date), e=new Date(r.to_date); while(d<=e){ ld[ymd(d)]=r; d.setDate(d.getDate()+1) } })
    setLeaveDates(ld)
    const im={}; (ad?.data||[]).forEach(r => { im[r.work_date]=r.status }); setImported(im)
    const rm={}; (rg?.data||[]).forEach(r => { rm[r.work_date]=r }); setRegs(rm)
  }

  const byDate = useMemo(() => { const m={}; punches.forEach(p => (m[ymd(p.punch_at)] ||= []).push(p)); return m }, [punches])

  const days = useMemo(() => {
    const y = cursor.getFullYear(), mo = cursor.getMonth(), last = new Date(y, mo+1, 0).getDate()
    const todayY = ymd(new Date())
    const out = []
    for (let dd=1; dd<=last; dd++) {
      const dt = new Date(y, mo, dd), key = ymd(dt)
      if (key > todayY) { out.push({ date:key, dd, status:'upcoming' }); continue }
      const pch = byDate[key]
      let res
      const lvr = leaveDates[key]
      // satWorker: the fulfilment team works the 2nd and 4th Saturday, so those days must
      // score as real working days on their OWN attendance page too — not just the muster.
      const dayArgs = { config:effShift(emp, cfg), isHoliday:holidays.has(key), onLeave:!!lvr, leaveHalf:!!lvr?.is_half_day, leavePeriod:lvr?.half_period||'first', isFC, exempt:emp?.attendance_exempt, probation:emp?.lifecycle_status==='probation', satWorker }
      if (pch && pch.length) res = { date:key, dd, ...computeDay({ date:key, punches:pch, ...dayArgs }) }
      else if (imported[key]) res = { date:key, dd, status: imported[key] }
      else res = { date:key, dd, ...computeDay({ date:key, punches:[], ...dayArgs }) }
      out.push(applyDeclaration(res, declarationFor(decls, emp?.branch, key)))
    }
    return out
  }, [cursor, byDate, cfg, holidays, leaveDates, isFC, imported, emp, decls, satWorker])

  const stats = useMemo(() => {
    const c = { present:0, half_day:0, absent:0, leave:0, holiday:0, weekoff:0 }
    let ot=0, work=[], ins=[], outs=[]
    days.forEach(d => { if(d.status==='upcoming')return; c[d.status]=(c[d.status]||0)+1
      if(d.ot_min)ot+=d.ot_min; if(d.worked_min)work.push(d.worked_min)
      if(d.first_in)ins.push(istMinutes(d.first_in))
      if(d.last_out)outs.push(istMinutes(d.last_out)) })
    const avg=a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length):null
    const fmtMin=m=>m==null?'—':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
    return { c, ot, totalWork: work.reduce((s,x)=>s+x,0), avgIn:fmtMin(avg(ins)), avgOut:fmtMin(avg(outs)),
             attendance: c.present + c.half_day*0.5 }
  }, [days])

  // ── chart + calendar data ────────────────────────────────────────────────────
  const shiftStartMin = useMemo(() => toMin(effShift(emp, cfg).office_start), [emp, cfg])

  // Arrival trend: clock-in time per worked day, against the shift start. This is the
  // question the old page could not answer -- whether punctuality is drifting.
  const arrivalPoints = useMemo(() => days
    .filter(d => d.status !== 'upcoming' && d.first_in)
    .map(d => ({
      key: d.date,
      label: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      value: istMinutes(d.first_in),
      bad: (d.late_min || 0) > 0,
    })), [days])

  // Hours worked per day, for the column strip.
  const workedCols = useMemo(() => days
    .filter(d => d.status !== 'upcoming' && d.worked_min)
    .map(d => ({ key: d.date, dd: d.dd, min: d.worked_min, ot: d.ot_min || 0 })), [days])

  // A real weekday-aligned month grid. The old strip ran days end-to-end, so you could
  // not see which absences fell on a Monday or read the shape of a week at a glance.
  const calWeeks = useMemo(() => {
    if (!days.length) return []
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const lead = first.getDay()          // 0=Sun, matching the Sun-first header row
    const cells = [...Array(lead).fill(null), ...days]
    while (cells.length % 7) cells.push(null)
    const out = []
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7))
    return out
  }, [days, cursor])

  // 'HH:MM:SS' from a Postgres time column -> 'h:mm am/pm', matching fmtTime's look.
  const fmtClock = t => {
    if (!t) return null
    const [h, m] = String(t).split(':').map(Number)
    if (Number.isNaN(h)) return null
    const ap = h < 12 ? 'am' : 'pm'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2,'0')} ${ap}`
  }

  const fmtMinTime = m => m == null ? '—' : `${String(Math.floor(m/60)).padStart(2,'0')}:${String(Math.round(m)%60).padStart(2,'0')}`

  async function downloadMyAtt() {
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library.'); return }
    const wb = new ExcelJS.Workbook(); wb.creator = 'SSC ERP'; wb.created = new Date()
    const ws = wb.addWorksheet('Attendance', { views: [{ state:'frozen', ySplit:1 }] })
    ws.columns = [
      { header:'Date', key:'date', width:18 },
      { header:'Arrival', key:'in', width:10 },
      { header:'Departure', key:'out', width:10 },
      { header:'Worked', key:'worked', width:10 },
      { header:'OT (min)', key:'ot', width:9 },
      { header:'Status', key:'status', width:12 },
    ]
    days.filter(d => d.status !== 'upcoming').forEach(d => ws.addRow({
      date: new Date(d.date).toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' }),
      in: d.first_in ? fmtTime(d.first_in) : '', out: d.last_out ? fmtTime(d.last_out) : '',
      worked: d.worked_min ? minToHrs(d.worked_min) : '', ot: d.ot_min || '',
      status: (STATUS_META[d.status]?.label) || d.status,
    }))
    xlsFinish(ws, 6)
    await xlsDownload(wb, `Attendance_${(emp.full_name||'').replace(/\s+/g,'_')}_${cursor.toLocaleDateString('en-IN',{month:'short',year:'numeric'}).replace(' ','_')}.xlsx`)
  }

  if (loading) return <Layout pageKey="people" pageTitle="My Attendance"><div className="orders-app"><div className="o-loading">Loading attendance…</div></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="My Attendance"><div className="orders-app"><div className="o-empty">You don't have access to this record.</div></div></Layout>

  const monthLabel = cursor.toLocaleDateString('en-IN', { month:'long', year:'numeric' })
  const isSelf = emp.id === meId
  const todayStr = ymd(new Date())
  const CHK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
  const XMK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round"/></svg>

  return (
    <Layout pageKey="people" pageTitle="My Attendance">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={()=>navigate('/people')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="page-title">{isSelf ? 'My Attendance' : emp.full_name}</h1>
            <div className="page-sub">{monthLabel}{!isSelf && emp.designation ? ` · ${emp.designation}` : ''}</div>
          </div>
          <div className="page-meta">
            {picks.length > 1 && (
              <select className="ph-picker" value={emp.id} onChange={e=>navigate('/people/attendance/me?emp='+e.target.value)}>
                {picks.map(p=><option key={p.id} value={p.id}>{p.full_name}{p.id===meId?' (me)':''}</option>)}
              </select>
            )}
            <input className="ph-month" type="month" value={monthKey(cursor)} max={monthKey(new Date())}
              onChange={e=>{ if(e.target.value){ const [y,m]=e.target.value.split('-').map(Number); setCursor(new Date(y,m-1,1)) } }} />
            <button className="ph-link" onClick={()=>setPolicy(true)} title="How leave & LOP work">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
              Leave &amp; LOP
            </button>
            <button className="ph-link" onClick={()=>navigate('/people/handbook')} title="Employee Handbook">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h9a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4z" strokeLinejoin="round"/><path d="M4 4v11"/></svg>
              Handbook
            </button>
            <button className="btn-ghost" onClick={downloadMyAtt}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
            <button className="btn-primary" onClick={()=>navigate('/people/attendance/leave?apply=1')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              Leave
            </button>
          </div>
        </div>

        <AttendanceTabs role={role} isManager={true} />

        {/* ── bento: five stats, the arrival trend, and the month at a glance ── */}
        <div className="ph-bento">
          <MyStat label="Attendance" value={stats.attendance} unit="days"
            foot={<><b>{stats.c.present}</b> full · <b>{stats.c.half_day}</b> half</>} />
          <MyStat label="Days worked" value={minToHrs(stats.totalWork)}
            foot={<><b>{workedCols.length}</b> day{workedCols.length===1?'':'s'} on record</>} />
          <MyStat label="Overtime" value={stats.ot ? minToHrs(stats.ot) : '0'}
            foot={stats.ot ? 'paid extra hours' : 'none this month'} />
          <MyStat label="Avg clock-in" value={stats.avgIn}
            foot={<>shift starts <b>{fmtMinTime(shiftStartMin)}</b></>} />
          <MyStat label="Avg clock-out" value={stats.avgOut}
            foot={<><b>{stats.c.absent||0}</b> absent · <b>{stats.c.leave||0}</b> leave</>} />

          <div className="ph-wide ph-anchor">
            <div className="ph-anchor-head">
              <div>
                <div className="ph-anchor-eyebrow">Arrival time · {monthLabel}</div>
                <div className="ph-anchor-v">{stats.avgIn}</div>
                <div className="ph-anchor-sub">average clock-in over {arrivalPoints.length} day{arrivalPoints.length===1?'':'s'}</div>
              </div>
              <div className="ph-anchor-stats">
                <div><div className="ph-as-l">On time</div><div className="ph-as-v">{arrivalPoints.length ? arrivalPoints.filter(p=>!p.bad).length : '—'}</div></div>
                <div><div className="ph-as-l">Late</div><div className="ph-as-v">{arrivalPoints.length ? arrivalPoints.filter(p=>p.bad).length : '—'}</div></div>
                <div><div className="ph-as-l">Earliest</div><div className="ph-as-v">{arrivalPoints.length ? fmtMinTime(Math.min(...arrivalPoints.map(p=>p.value))) : '—'}</div></div>
              </div>
            </div>
            {/* Lower is better here, so the fill hangs from the top and the shift-start
                line makes "late" visible without reading any number. */}
            <TrendChart points={arrivalPoints} refValue={shiftStartMin} refLabel="shift start"
              fmt={fmtMinTime} invert height={104} />
          </div>

          <div className="card ph-tall">
            <div className="card-head">
              <div><div className="card-eyebrow">This month</div><div className="card-title">Breakdown</div></div>
            </div>
            <StatusDonut
              pct={(() => { const t=(stats.c.present||0)+(stats.c.half_day||0)+(stats.c.leave||0)+(stats.c.absent||0); return t ? Math.round(((stats.c.present||0)+(stats.c.half_day||0)*0.5)/t*100) : 0 })()}
              centerLabel="PRESENT"
              rows={[
                { label:'Present',  value:stats.c.present||0,  color:'#10B981' },
                { label:'Half day', value:stats.c.half_day||0, color:'#F59E0B' },
                { label:'Leave',    value:stats.c.leave||0,    color:'#8B5CF6' },
              ]}
              summary={{ label:'Absent', value:stats.c.absent||0 }}
            />
          </div>
        </div>

        {/* ── hours worked per day ── */}
        <div className="card" style={{marginTop:16}}>
          <div className="card-head">
            <div><div className="card-eyebrow">Hours per day</div><div className="card-title">Worked</div></div>
            <span className="trend-pill mono">{minToHrs(stats.totalWork)} total</span>
          </div>
          {workedCols.length === 0
            ? <div className="o-empty">No worked hours recorded this month</div>
            : (() => {
                const max = Math.max(...workedCols.map(c => c.min))
                return (
                  <div className="ph-cols" style={{height:150}}>
                    {workedCols.map(c => (
                      <div key={c.key} className="ph-col" title={`${new Date(c.key).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})} · ${minToHrs(c.min)}${c.ot?` (+${c.ot}m OT)`:''}`}>
                        <div className="ph-col-track">
                          <div className={`ph-col-fill${c.ot ? ' is-ot' : ''}`} style={{ height: `${Math.max(3,(c.min/max)*100)}%` }} />
                        </div>
                        <div className="ph-col-l">{c.dd}</div>
                      </div>
                    ))}
                  </div>
                )
              })()}
        </div>

        {/* ── records: one card, calendar or list ── */}
        <div className="card" style={{marginTop:16}}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">{monthLabel}</div>
              <div className="card-title">Daily Records</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <span className="trend-pill mono">{days.filter(d=>d.status!=='upcoming').length} days</span>
              <div className="ph-seg" role="group" aria-label="Record view">
                <button className={recView==='calendar'?'on':''} onClick={()=>setRecView('calendar')} aria-pressed={recView==='calendar'}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 2v2M10.5 2v2"/></svg>
                  Calendar
                </button>
                <button className={recView==='list'?'on':''} onClick={()=>setRecView('list')} aria-pressed={recView==='list'}>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/></svg>
                  List
                </button>
              </div>
            </div>
          </div>

          {recView === 'calendar' ? (
            <>
              <div className="ph-legend" style={{marginTop:2}}>
                {[['present','Present','#10B981'],['half_day','Half','#F59E0B'],['absent','Absent','#EF4444'],['leave','Leave','#8B5CF6'],['holiday','Holiday','#1a73e8'],['weekoff','Week-off','#CBD5E1']].map(([k,l,c])=>(
                  <span key={k} className="ph-lg"><span className="ph-lg-dot" style={{background:c}} />{l}</span>))}
              </div>
              <div className="ph-cal">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => <div key={d} className="ph-cal-h">{d}</div>)}
                {calWeeks.flat().map((d, i) => {
                  if (!d) return <div key={'x'+i} className="ph-cal-cell is-blank" />
                  const up = d.status === 'upcoming'
                  const isToday = d.date === todayStr
                  return (
                    <div key={d.date}
                      className={`ph-cal-cell st-${up ? 'future' : d.status}${isToday ? ' is-today' : ''}${d.declared ? ' is-decl' : ''}`}
                      title={[
                        new Date(d.date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'}),
                        up ? 'Upcoming' : (STATUS_META[d.status]?.label || d.status),
                        d.first_in ? 'In ' + fmtTime(d.first_in) : null,
                        d.last_out ? 'Out ' + fmtTime(d.last_out) : null,
                        d.worked_min ? minToHrs(d.worked_min) + ' worked' : null,
                        (byDate[d.date]||[]).length ? (byDate[d.date]||[]).length + ' swipe(s)' : null,
                        regs[d.date] ? 'Regularization ' + regs[d.date].status : null,
                      ].filter(Boolean).join(' · ')}>
                      <span className="ph-cal-d">{d.dd}</span>
                      {!up && d.first_in ? <span className="ph-cal-t">{fmtTime(d.first_in)}</span> : null}
                      {!up && d.last_out ? <span className="ph-cal-t dim">{fmtTime(d.last_out)}</span> : null}
                      {!up && !d.first_in && d.worked_min ? <span className="ph-cal-t dim">{Math.round(d.worked_min/60)}h</span> : null}
                      {regs[d.date] && <span className="ph-cal-r" title={`Regularization ${regs[d.date].status}`}>R</span>}
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="ph-tbl-wrap">
              <table className="ph-tbl">
                <thead><tr><th>Date</th><th>Swipes</th><th>Arrival</th><th>Departure</th><th className="r">Worked</th><th className="r">Status</th></tr></thead>
                <tbody>{[...days].reverse().filter(d=>d.status!=='upcoming').map(d => {
                  const meta = STATUS_META[d.status]||STATUS_META.absent
                  const swipes = byDate[d.date] || []
                  const reg = regs[d.date]
                  const regOk = reg && reg.status === 'approved'
                  return (
                  <tr key={d.date} className={d.date===todayStr?'is-today':''}>
                    <td className="b">
                      {new Date(d.date).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}
                      {reg && <span className={'ph-reg'+(regOk?'':' is-pending')} title={`Regularization ${reg.status}${reg.reason?': '+reg.reason:''}`}>R</span>}
                    </td>
                    {/* Raw device swipes, always shown. Arrival/Departure are the SCORED
                        values after de-duplication, so a double-scan is visible here even
                        though it collapses in the next two columns. */}
                    <td className="m ph-swipes">
                      {swipes.length === 0
                        ? <span className="ph-noswipe">no swipe</span>
                        : swipes.map((p,i) => <span key={i} className="ph-swipe">{fmtTime(p.punch_at)}</span>)}
                    </td>
                    <td className="m">
                      {fmtTime(d.first_in)}
                      {d.late_min>0 ? <span className="ph-late"> +{d.late_min}m</span> : null}
                      {regOk && fmtClock(reg.requested_in) && <span className="ph-regtime" title="Regularized arrival">→ {fmtClock(reg.requested_in)}</span>}
                    </td>
                    <td className="m">
                      {d.last_out?fmtTime(d.last_out):'—'}
                      {regOk && fmtClock(reg.requested_out) && <span className="ph-regtime" title="Regularized departure">→ {fmtClock(reg.requested_out)}</span>}
                    </td>
                    <td className="r m">{d.worked_min?minToHrs(d.worked_min):'—'}{d.ot_min?<span className="ph-ot"> +{d.ot_min}m</span>:null}</td>
                    <td className="r"><span className="ol-status-pill" style={{ '--stage-color': meta.dot }}><span className="ol-status-dot" />{meta.label}</span></td>
                  </tr>
                )})}</tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      <LeavePolicyDrawer open={policy} onClose={()=>setPolicy(false)} />
    </Layout>
  )
}
