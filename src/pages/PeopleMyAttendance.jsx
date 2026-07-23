import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { currentFyLabel } from '../lib/kpi'
import { computeDay, isWeekOff, minToHrs, fmtTime, STATUS_META, DEFAULT_CFG, effShift } from '../lib/attendance'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import { adminEmpIds } from '../lib/attScope'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const AVC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
const oc = (n='') => { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVC[Math.abs(h)%AVC.length] }
const ini = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??'
const ymd = d => new Date(d).toLocaleDateString('en-CA')
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
  const [picks, setPicks] = useState([])    // employees this viewer may open
  const [cfg, setCfg] = useState(DEFAULT_CFG)
  const [holidays, setHolidays] = useState(new Set())
  const [punches, setPunches] = useState([])
  const [leaveDates, setLeaveDates] = useState(new Set())
  const [imported, setImported] = useState({})   // work_date -> imported muster status
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d })

  const isMgmt = ['admin','management'].includes(role)
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
    const adminIds = prof?.role === 'management' ? await adminEmpIds() : []
    // viewable-employee list for the picker: admin → all; management → all except admin; user → self only
    if (mgmt) {
      const { data } = await sb.from('employees').select('id,full_name').neq('lifecycle_status','exited').order('full_name')
      setPicks((data || []).filter(e => !adminIds.includes(e.id)))
    } else if (myEmp?.id) {
      const { data } = await sb.from('employees').select('id,full_name').eq('id', myEmp.id)
      setPicks(data || [])
    }
    const targetId = empParam || myEmp?.id
    if (!targetId) { setDenied(true); setLoading(false); return }
    // access: self; admin → anyone; management → anyone except admin
    const { data: t } = await sb.from('employees').select('*').eq('id', targetId).maybeSingle()
    if (!t) { setDenied(true); setLoading(false); return }
    const canView = targetId === myEmp?.id || prof?.role === 'admin' || (prof?.role === 'management' && !adminIds.includes(targetId))
    if (!canView) { setDenied(true); setLoading(false); return }
    setEmp(t)
    await load(t)
    setLoading(false)
  }

  async function load(t) {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const end = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1)
    const [c, hol, p, lv, ad] = await Promise.all([
      sb.from('attendance_config').select('*').maybeSingle(),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      sb.from('attendance_punches').select('punch_at,direction').eq('employee_id', t.id).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString()).order('punch_at'),
      sb.from('leave_requests').select('from_date,to_date,is_half_day').eq('employee_id', t.id).eq('status','approved'),
      sb.from('attendance_days').select('work_date,status').eq('employee_id', t.id).gte('work_date', ymd(start)).lt('work_date', ymd(end)),
    ])
    setCfg(c?.data || DEFAULT_CFG); setHolidays(new Set((hol?.data||[]).map(h=>h.holiday_date))); setPunches(p?.data||[])
    const ld = new Set()
    ;(lv?.data||[]).forEach(r => { let d=new Date(r.from_date), e=new Date(r.to_date); while(d<=e){ ld.add(ymd(d)); d.setDate(d.getDate()+1) } })
    setLeaveDates(ld)
    const im={}; (ad?.data||[]).forEach(r => { im[r.work_date]=r.status }); setImported(im)
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
      if (pch && pch.length) { out.push({ date:key, dd, ...computeDay({ date:key, punches:pch, config:effShift(emp, cfg), isHoliday:holidays.has(key), onLeave:leaveDates.has(key), isFC }) }); continue }
      if (imported[key]) { out.push({ date:key, dd, status: imported[key] }); continue }
      out.push({ date:key, dd, ...computeDay({ date:key, punches:[], config:effShift(emp, cfg), isHoliday:holidays.has(key), onLeave:leaveDates.has(key), isFC }) })
    }
    return out
  }, [cursor, byDate, cfg, holidays, leaveDates, isFC, imported, emp])

  const stats = useMemo(() => {
    const c = { present:0, half_day:0, absent:0, leave:0, holiday:0, weekoff:0 }
    let ot=0, work=[], ins=[], outs=[]
    days.forEach(d => { if(d.status==='upcoming')return; c[d.status]=(c[d.status]||0)+1
      if(d.ot_min)ot+=d.ot_min; if(d.worked_min)work.push(d.worked_min)
      if(d.first_in)ins.push(d.first_in.getHours()*60+d.first_in.getMinutes())
      if(d.last_out)outs.push(d.last_out.getHours()*60+d.last_out.getMinutes()) })
    const avg=a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length):null
    const fmtMin=m=>m==null?'—':`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`
    return { c, ot, totalWork: work.reduce((s,x)=>s+x,0), avgIn:fmtMin(avg(ins)), avgOut:fmtMin(avg(outs)),
             attendance: c.present + c.half_day*0.5 }
  }, [days])

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

  if (loading) return <Layout pageKey="people" pageTitle="My Attendance"><div className="people-app att-alt"><Spinner /></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="My Attendance"><div className="people-app att-alt"><div className="e-empty">You don't have access to this record.</div></div></Layout>

  const monthLabel = cursor.toLocaleDateString('en-IN', { month:'long', year:'numeric' })
  const isSelf = emp.id === meId
  const todayStr = ymd(new Date())
  const CHK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
  const XMK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 5l6 6M11 5l-6 6" strokeLinecap="round"/></svg>

  return (
    <Layout pageKey="people" pageTitle="My Attendance">
      <div className="people-app att-alt">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people/attendance')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Attendance
            </button>
            <h1 className="ph-title">{isSelf ? 'My Attendance' : emp.full_name}</h1>
            <div className="ph-sub">Monthly log{!isSelf && ` · ${emp.designation||''}`}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
            <button className="btn btn-neutral btn-sm" onClick={downloadMyAtt} title="Download attendance (Excel)">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </button>
            {picks.length > 1 && (
              <select value={emp.id} onChange={e=>navigate('/people/attendance/me?emp='+e.target.value)}
                style={{border:'1px solid var(--line)',borderRadius:8,padding:'7px 11px',font:'inherit',fontSize:13,color:'var(--ink)',background:'var(--surface)',cursor:'pointer',maxWidth:200}}>
                {picks.map(p=><option key={p.id} value={p.id}>{p.full_name}{p.id===meId?' (me)':''}</option>)}
              </select>
            )}
          </div>
        </div>

        <AttendanceTabs role={role} isManager={true} />

        {/* month timeline (Order-List style) */}
        <div className="swf-tl" style={{marginBottom:12}}>
          {(() => {
            const n=new Date(); const thisMK=monthKey(new Date(n.getFullYear(),n.getMonth(),1)); const lastMK=monthKey(new Date(n.getFullYear(),n.getMonth()-1,1)); const curMK=monthKey(cursor)
            return <>
              <button className={curMK===thisMK?'on':''} onClick={()=>setCursor(new Date(n.getFullYear(),n.getMonth(),1))}>This Month</button>
              <button className={curMK===lastMK?'on':''} onClick={()=>setCursor(new Date(n.getFullYear(),n.getMonth()-1,1))}>Last Month</button>
              <div className="swf-custom"><span>Month</span><input type="month" value={curMK} max={thisMK} onChange={e=>{ if(e.target.value){ const [y,m]=e.target.value.split('-').map(Number); setCursor(new Date(y,m-1,1)) } }} /></div>
            </>
          })()}
        </div>

        {/* KPI stats */}
        <div className="agrid g-5" style={{marginBottom:16}}>
          <div className="kpi"><div className="kpi-l">Attendance</div><div className="kpi-v">{stats.attendance}<small> days</small></div></div>
          <div className="kpi"><div className="kpi-l">Total worked</div><div className="kpi-v">{minToHrs(stats.totalWork)}</div></div>
          <div className="kpi"><div className="kpi-l">Overtime</div><div className="kpi-v" style={{color:'var(--accent)'}}>{stats.ot?minToHrs(stats.ot):'0'}</div></div>
          <div className="kpi"><div className="kpi-l">Avg clock-in</div><div className="kpi-v">{stats.avgIn}</div></div>
          <div className="kpi"><div className="kpi-l">Avg clock-out</div><div className="kpi-v">{stats.avgOut}</div></div>
        </div>

        {/* calendar */}
        <div className="acard" style={{marginBottom:16}}>
          <div className="card-h bd">
            <span className="card-t">Attendance · {monthLabel}</span>
            <div className="att-legend">
              {[['present','Present'],['half_day','Half'],['absent','Absent'],['leave','Leave'],['holiday','Holiday'],['weekoff','Week-off']].map(([k,l])=>(
                <span key={k} className="lg"><span className="lg-dot" style={{background:{present:'var(--st-present)',half_day:'var(--st-half)',absent:'var(--st-absent)',leave:'var(--st-leave)',holiday:'var(--st-holiday)',weekoff:'var(--muted-2)'}[k],boxShadow:k==='weekoff'?'inset 0 0 0 1px var(--line)':'none'}} />{l}</span>))}
            </div>
          </div>
          <div className="cal"><div className="cal-grid">
            {days.map(d => {
              const up = d.status==='upcoming', isToday = d.date===todayStr
              let mk
              if (up) mk = <div className="cal-mk future" />
              else if (d.status==='weekoff') mk = <div className="cal-mk weekoff"><span>W</span></div>
              else if (['present','half_day','holiday'].includes(d.status)) mk = <div className={'cal-mk '+d.status}>{d.status==='half_day'?<span style={{fontSize:11,fontWeight:800,color:'#fff'}}>½</span>:CHK}</div>
              else mk = <div className={'cal-mk '+d.status}>{XMK}</div>
              return (
                <div key={d.date} className={'cal-cell'+(isToday?' today':'')+(up?' future':'')} title={(STATUS_META[d.status]?.label||'')+(d.code&&d.code.includes(':')?' · '+d.code:'')}>
                  <span className="cal-day">{new Date(d.date).toLocaleDateString('en-GB',{weekday:'short'})} {d.dd}</span>{mk}
                </div>
              )
            })}
          </div></div>
        </div>

        {/* daily records */}
        <div className="acard">
          <div className="card-h bd"><span className="card-t">Daily records</span><span className="card-sub">{days.filter(d=>d.status!=='upcoming').length} days</span></div>
          <div className="tbl-wrap"><table className="dtbl"><thead><tr><th>Date</th><th>Arrival</th><th>Departure</th><th className="r">Worked</th><th className="r">Status</th></tr></thead>
            <tbody>{[...days].reverse().filter(d=>d.status!=='upcoming').map(d => { const meta=STATUS_META[d.status]||STATUS_META.absent; return (
              <tr key={d.date}>
                <td style={{fontWeight:600}}>{new Date(d.date).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</td>
                <td style={{color:'var(--muted)'}}>{fmtTime(d.first_in)}</td>
                <td style={{color:'var(--muted)'}}>{d.last_out?fmtTime(d.last_out):'—'}</td>
                <td className="r">{d.worked_min?minToHrs(d.worked_min):'—'}{d.ot_min?<span style={{color:'var(--accent)'}}> +{d.ot_min}m</span>:''}</td>
                <td className="r"><span className={'spill '+d.status}><span className="led" />{meta.label}</span></td>
              </tr>
            )})}</tbody></table></div>
        </div>
      </div>
    </Layout>
  )
}
