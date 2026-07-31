import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { computeDay, isWeekOff, fmtTime, minToHrs, STATUS_META, DEFAULT_CFG, effShift, declarationFor, applyDeclaration, DECL_LABEL } from '../lib/attendance'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import { toast } from '../lib/toast'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import PeopleAvatar from '../components/PeopleAvatar'
import { adminEmpIds } from '../lib/attScope'
import { fetchAll } from '../lib/fetchAll'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const ymd = d => new Date(d).toLocaleDateString('en-CA')
const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
const DOWL = ['S','M','T','W','T','F','S']
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const STLBL = { present:'Present', half:'Half day', absent:'Absent', leave:'Leave', holiday:'Holiday', weekoff:'Week-off' }

// profile-photo avatar (shared people-photo directory, falls back to coloured initials)
const Av = ({ name, size=36 }) => <PeopleAvatar name={name} className="avatar" style={{width:size,height:size,fontSize:size*0.34,flexShrink:0}} />

const PENCIL = <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M11 2l3 3-8 8-4 1 1-4 8-8z" strokeLinejoin="round"/></svg>

// map computeDay/imported status → muster status classes
const mapStatus = s => s==='half_day' ? 'half' : s==='lop' ? 'absent' : s==='upcoming' ? 'future' : s
const declInp = { border:'1px solid var(--line)', borderRadius:8, padding:'8px 11px', font:'inherit', fontSize:13.5, color:'var(--ink)', background:'var(--surface)', outline:'none', width:'100%' }
const declFieldL = { display:'flex', flexDirection:'column', gap:5, fontSize:11.5, fontWeight:600, color:'var(--muted)' }
const DECL_REASONS = ['rainfall','flood','strike','festival','maintenance','other']

export default function PeopleMuster() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [role, setRole] = useState('')
  const [emps, setEmps] = useState([])
  const [cfg, setCfg] = useState(DEFAULT_CFG)
  const [holidays, setHolidays] = useState(new Set())
  const [punchMap, setPunchMap] = useState({})   // `${empId}|${date}` -> punches
  const [leaveMap, setLeaveMap] = useState({})    // `${empId}|${date}` -> true
  const [imported, setImported] = useState({})    // `${empId}|${date}` -> imported status (muster history)
  const [regMap, setRegMap] = useState({})        // `${empId}|${date}` -> regularization row
  const [cursor, setCursor] = useState(() => { const d=new Date(); d.setDate(1); return d })
  const [view, setView] = useState('grid')        // 'grid' | 'cal'
  const [dept, setDept] = useState('all')
  const [personId, setPersonId] = useState('')
  const [tip, setTip] = useState(null)            // { emp, rec, x, y }
  const [decls, setDecls] = useState([])          // special-day declarations covering this month
  const [showDecl, setShowDecl] = useState(false)
  const [declForm, setDeclForm] = useState({ from_date:'', to_date:'', branch:'', status:'wfh', reason:'rainfall', note:'' })
  const savingDecl = useRef(false)
  const [meId, setMeId] = useState(null)
  const [markCell, setMarkCell] = useState(null)      // { emp, day, date, status }
  const [markStatus, setMarkStatus] = useState('present')
  const [markNote, setMarkNote] = useState('')
  const markGuard = useRef(false)

  useEffect(() => { init() }, [cursor]) // eslint-disable-line
  useEffect(() => { if (emps.length && !emps.find(e=>e.id===personId)) setPersonId(emps[0].id) }, [emps]) // eslint-disable-line

  async function init() {
    setLoading(true)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    const { data: me } = await sb.from('employees').select('id').eq('profile_id', session.user.id).maybeSingle()
    setMeId(me?.id || null)
    const mgmt = ['admin','management'].includes(prof?.role)
    if (!mgmt) { setDenied(true); setLoading(false); return }   // Muster is admin/management only
    let empQ = sb.from('employees').select('id,full_name,employee_code,designation,department,branch,shift_start,shift_end,attendance_exempt,lifecycle_status').neq('lifecycle_status','exited').order('full_name')
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const end = new Date(cursor.getFullYear(), cursor.getMonth()+1, 1)
    const [empRes, c, hol, decl] = await Promise.all([empQ, sb.from('attendance_config').select('*').maybeSingle(), sb.from('holidays').select('holiday_date').eq('is_active',true), sb.from('attendance_declarations').select('*').lt('from_date', ymd(end)).gte('to_date', ymd(start))])
    let list = empRes.data || []
    if (prof?.role === 'management') { const ex = await adminEmpIds(); list = list.filter(e => !ex.includes(e.id)) }
    setEmps(list); setCfg(c?.data || DEFAULT_CFG); setHolidays(new Set((hol?.data||[]).map(h=>h.holiday_date))); setDecls(decl?.data || [])
    const ids = list.map(e=>e.id)
    if (ids.length) {
      // A full month exceeds PostgREST's 1000-row cap at this headcount (~1300 punches,
      // ~1150 attendance_days), so these must page. A capped query drops rows silently and
      // a day with no punches scores as absent + LOP — i.e. truncation reads as unpaid leave.
      const [pu, lv, ad, rg] = await Promise.all([
        fetchAll((f,t) => sb.from('attendance_punches').select('employee_id,punch_at,direction').in('employee_id', ids).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString()).order('punch_at').order('id').range(f,t)),
        fetchAll((f,t) => sb.from('leave_requests').select('employee_id,from_date,to_date').eq('status','approved').in('employee_id', ids).order('from_date').order('id').range(f,t)),
        fetchAll((f,t) => sb.from('attendance_days').select('employee_id,work_date,status,source_code').in('employee_id', ids).gte('work_date', ymd(start)).lt('work_date', ymd(end)).order('work_date').order('id').range(f,t)),
        fetchAll((f,t) => sb.from('regularizations').select('id,employee_id,work_date,status,reason,requested_in,requested_out').in('employee_id', ids).gte('work_date', ymd(start)).lt('work_date', ymd(end)).order('work_date').order('id').range(f,t)),
      ])
      const loadErr = pu.error || lv.error || ad.error || rg.error
      if (loadErr) toast(`Could not load the full month — figures may be incomplete. ${loadErr.message || ''}`, 'error')
      const pm={}; (pu.data||[]).forEach(p=>{ const k=`${p.employee_id}|${ymd(p.punch_at)}`; (pm[k]||=[]).push(p) }); setPunchMap(pm)
      const lm={}; (lv.data||[]).forEach(r=>{ let d=new Date(r.from_date),e=new Date(r.to_date); while(d<=e){ lm[`${r.employee_id}|${ymd(d)}`]=true; d.setDate(d.getDate()+1) } }); setLeaveMap(lm)
      const im={}; (ad.data||[]).forEach(r=>{ im[`${r.employee_id}|${r.work_date}`]={ s:r.status, c:r.source_code } }); setImported(im)
      const rm={}; (rg.data||[]).forEach(r=>{ rm[`${r.employee_id}|${r.work_date}`]=r }); setRegMap(rm)
    } else { setPunchMap({}); setLeaveMap({}); setImported({}); setRegMap({}) }
    setLoading(false)
  }

  const dayNums = useMemo(() => { const last=new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate(); return Array.from({length:last},(_,i)=>i+1) }, [cursor])
  const lastDay = dayNums.length
  const todayY = ymd(new Date())
  const now = new Date()
  const isCurMonth = now.getFullYear()===cursor.getFullYear() && now.getMonth()===cursor.getMonth()
  const todayNum = isCurMonth ? now.getDate() : -1
  const monthLabel = cursor.toLocaleDateString('en-IN',{month:'long',year:'numeric'})

  function cell(emp, dd) {
    const dt = new Date(cursor.getFullYear(), cursor.getMonth(), dd), key = ymd(dt)
    if (key > todayY) return { status:'upcoming' }
    // always compute from live swipes first, so we have real in/out/worked times…
    const punches = punchMap[`${emp.id}|${key}`]
    const computed = computeDay({ date:key, punches: punches||[], config:effShift(emp, cfg), isHoliday:holidays.has(key), onLeave:!!leaveMap[`${emp.id}|${key}`], isFC:(emp.branch||'').startsWith('FC'), exempt:emp.attendance_exempt, probation:emp.lifecycle_status==='probation' })
    // …but the official muster status (imported/synced) wins for the status/code shown.
    const imp = imported[`${emp.id}|${key}`]
    const result = imp ? { ...computed, status: imp.s, code: imp.c != null ? imp.c : computed.code } : computed
    // special-day declaration (rainfall/WFH/etc) rescues would-be-absent days for the branch
    return applyDeclaration(result, declarationFor(decls, emp.branch, key))
  }

  // per-employee month model (days + counts), memoised so hover doesn't recompute
  const musterData = useMemo(() => emps.map(e => {
    const days = dayNums.map(dd => {
      const dt = new Date(cursor.getFullYear(), cursor.getMonth(), dd)
      const cc = cell(e, dd)
      const status = mapStatus(cc.status)
      const reg = regMap[`${e.id}|${ymd(dt)}`] || null
      return { day: dd, dow: dt.getDay(), we: isWeekOff(dt), status,
        late: (cc.late_min||0) > 0, reg, inM: cc.first_in || null, outM: cc.last_out || null,
        worked: cc.worked_min || 0, code: cc.code || null, declared: cc.declared || null }
    })
    const c = { present:0, half:0, absent:0, leave:0, holiday:0, weekoff:0, reg:0, late:0 }
    days.forEach(d => { if (d.status!=='future' && c[d.status]!=null) c[d.status]++; if (d.reg) c.reg++; if (d.late) c.late++ })
    return { emp: e, days, c }
  }), [emps, dayNums, cursor, punchMap, leaveMap, imported, regMap, cfg, holidays, decls]) // eslint-disable-line

  const depts = useMemo(() => { const s=[]; emps.forEach(e=>{ if(e.department && s.indexOf(e.department)<0) s.push(e.department) }); return s }, [emps])
  const branches = useMemo(() => { const s=[]; emps.forEach(e=>{ if(e.branch && s.indexOf(e.branch)<0) s.push(e.branch) }); return s }, [emps])

  async function saveDecl() {
    if (savingDecl.current) return
    if (!declForm.from_date || !declForm.to_date) { alert('Pick a date (or range).'); return }
    if (declForm.to_date < declForm.from_date) { alert('End date is before the start date.'); return }
    savingDecl.current = true
    try {
      const { data: { session } } = await sb.auth.getSession()
      const { error } = await sb.from('attendance_declarations').insert({
        from_date: declForm.from_date, to_date: declForm.to_date, branch: declForm.branch || null,
        status: declForm.status, reason: declForm.reason, note: declForm.note?.trim() || null,
        created_by: session?.user?.id || null,
      })
      if (error) throw error
      setShowDecl(false); setDeclForm({ from_date:'', to_date:'', branch:'', status:'wfh', reason:'rainfall', note:'' })
      await init()
    } catch (e) { alert(e?.message || 'Failed to save declaration.') }
    finally { savingDecl.current = false }
  }
  async function deleteDecl(id) {
    if (!window.confirm('Remove this declaration?')) return
    try { await sb.from('attendance_declarations').delete().eq('id', id); await init() }
    catch (e) { alert(e?.message || 'Failed to remove.') }
  }
  const canMark = role==='admin' || (meId && cfg?.hr_approver_employee_id===meId)
  function openMark(emp, d) {
    const date = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), d.day))
    setMarkCell({ emp, day:d.day, date, status:d.status })
    setMarkStatus(d.status==='half' ? 'half_day' : (d.status==='future'||d.status==='holiday'||d.status==='weekoff') ? 'present' : d.status)
    setMarkNote('')
  }
  async function saveMark() {
    if (markGuard.current || !markCell) return
    markGuard.current = true
    try {
      const { error } = await sb.rpc('att_mark_day', { p_employee_id: markCell.emp.id, p_date: markCell.date, p_status: markStatus, p_note: markNote.trim()||null })
      if (error) throw error
      toast('Attendance marked','success'); setMarkCell(null); await init()
    } catch (e) { toast(e?.message || 'Failed to mark','error') }
    finally { markGuard.current = false }
  }
  const gridRows = useMemo(() => musterData.filter(m => dept==='all' || m.emp.department===dept), [musterData, dept])

  async function downloadMuster() {
    if (!emps.length) return
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library.'); return }
    const LTR = { present:'P', half_day:'H', absent:'A', lop:'LOP', leave:'L', holiday:'HO', weekoff:'WO' }
    const wb = new ExcelJS.Workbook(); wb.creator = 'SSC ERP'; wb.created = new Date()
    const ws = wb.addWorksheet('Muster', { views: [{ state:'frozen', xSplit:2, ySplit:1 }] })
    const cols = [{ header:'Employee', key:'emp', width:24 }, { header:'Code', key:'code', width:8 }]
    dayNums.forEach(d => cols.push({ header:String(d), key:'d'+d, width:4.5 }))
    ;[['Present','present'],['Absent','absent'],['Leave','leave'],['Half','half_day'],['LOP','lop'],['Holiday','holiday'],['Week-off','weekoff']].forEach(([h]) => cols.push({ header:h, key:h, width:9 }))
    ws.columns = cols
    emps.forEach(e => {
      const cnt = {}, obj = { emp:e.full_name, code:e.employee_code||'' }
      dayNums.forEach(d => { const cc = cell(e, d); obj['d'+d] = (cc.status==='half_day' && cc.code) ? cc.code : (LTR[cc.status] || ''); if (cc.status && cc.status!=='upcoming') cnt[cc.status] = (cnt[cc.status]||0)+1 })
      obj['Present']=cnt.present||0; obj['Absent']=cnt.absent||0; obj['Leave']=cnt.leave||0; obj['Half']=cnt.half_day||0; obj['LOP']=cnt.lop||0; obj['Holiday']=cnt.holiday||0; obj['Week-off']=cnt.weekoff||0
      const row = ws.addRow(obj)
      dayNums.forEach(d => { const cc = cell(e, d); const meta = STATUS_META[cc.status]
        if (meta) { const c = row.getCell('d'+d)
          c.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+meta.bg.replace('#','') } }
          c.font = { color:{ argb:'FF'+meta.color.replace('#','') }, bold:true, size:9 }
          c.alignment = { horizontal:'center' } } })
    })
    xlsFinish(ws, cols.length)
    await xlsDownload(wb, `Muster_${cursor.toLocaleDateString('en-IN',{month:'short',year:'numeric'}).replace(' ','_')}.xlsx`)
  }

  // ── tooltip ──
  const showTip = (emp, rec, ev) => setTip({ emp, rec, x: ev.clientX + 14, y: ev.clientY + 16 })
  const moveTip = ev => setTip(t => t ? { ...t, x: ev.clientX + 14, y: ev.clientY + 16 } : t)
  const hideTip = () => setTip(null)

  if (loading) return <Layout pageKey="people" pageTitle="Muster"><div className="people-app att-alt"><Spinner label="Building muster…" /></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="Muster"><div className="people-app att-alt"><div className="e-empty">Muster is for managers and admin/management.</div></div></Layout>

  const seg = (v, scheduled, color) => v>0 ? <i style={{width:(v/scheduled*100)+'%',background:color}} /> : null
  const legend = (
    <div className="att-legend">
      <span className="lg"><span className="lg-sq" style={{background:'var(--st-present)'}} />Present</span>
      <span className="lg"><span className="lg-sq" style={{background:'linear-gradient(180deg,#EDF0F3 0 50%,var(--st-present) 50% 100%)'}} />Half day</span>
      <span className="lg"><span className="lg-sq" style={{background:'var(--st-absent)'}} />Absent</span>
      <span className="lg"><span className="lg-sq" style={{background:'var(--st-leave)'}} />Leave</span>
      <span className="lg"><span className="lg-wo" />Week-off</span>
      <span className="lg"><span className="lg-late" />Late in</span>
      <span className="lg"><span className="lg-fold" />Regularized</span>
    </div>
  )
  const totReg = gridRows.reduce((s,m)=>s+m.c.reg,0)

  const person = emps.find(e=>e.id===personId) || emps[0]
  const personData = person ? musterData.find(m=>m.emp.id===person.id) : null

  return (
    <Layout pageKey="people" pageTitle="Muster">
      <div className="people-app att-alt">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people/attendance')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Attendance
            </button>
            <h1 className="ph-title">Muster</h1>
            <div className="ph-sub">{emps.length} people · {monthLabel}</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowDecl(true)} title="Declare a special day (rainfall / WFH / calamity)">+ Declare day</button>
            <button className="btn btn-neutral btn-sm" onClick={downloadMuster} title="Download detailed muster (Excel)">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download
            </button>
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

        {/* toolbar: count + view toggle + filter */}
        <div className="mb16" style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',color:'var(--muted)',fontSize:13}}>
          <span><b style={{color:'var(--ink)',fontSize:15}}>{emps.length}</b> people · {monthLabel}</span>
          <div className="mtoggle">
            <div className="mseg">
              <button className={view==='grid'?'on':''} onClick={()=>{setView('grid');hideTip()}}>Grid</button>
              <button className={view==='cal'?'on':''} onClick={()=>{setView('cal');hideTip()}}>Calendar</button>
            </div>
            {view==='cal'
              ? <div className="f-sel"><select value={personId} onChange={e=>setPersonId(e.target.value)}>
                  {emps.slice().sort((a,b)=>a.full_name.localeCompare(b.full_name)).map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select></div>
              : depts.length>0 && <div className="f-sel"><select value={dept} onChange={e=>setDept(e.target.value)}>
                  <option value="all">All departments</option>
                  {depts.map(d=><option key={d} value={d}>{d}</option>)}
                </select></div>}
          </div>
        </div>

        {view==='grid' ? (
          <div className="acard">
            <div className="card-h bd">{legend}<span className="card-sub"><b style={{color:'var(--accent)'}}>{totReg}</b> regularizations · hover any day</span></div>
            <div className="mgx">
              <div className="mgx-row mgx-axis">
                <div className="mgx-emp mgx-emp-h">{gridRows.length} people</div>
                <div className="mgx-strip">
                  {dayNums.map(dd => { const dt=new Date(cursor.getFullYear(),cursor.getMonth(),dd), we=isWeekOff(dt), wk=dt.getDay()===6&&dd<lastDay
                    return <span key={dd} className={'mga'+(we?' we':'')+(dd===todayNum?' today':'')+(wk?' wk':'')}><b>{dd}</b><i>{DOWL[dt.getDay()]}</i></span> })}
                </div>
                <div className="mgx-sum mgx-sum-h">Month</div>
              </div>
              {gridRows.length===0 ? <div className="list-empty">No employees in this view.</div> : gridRows.map(({emp:e, days, c}) => {
                const present = c.present + c.half, scheduled = c.present+c.half+c.absent+c.leave || 1
                return (
                  <div key={e.id} className="mgx-row">
                    <div className="mgx-emp" onClick={()=>navigate('/people/attendance/me?emp='+e.id)}>
                      <Av name={e.full_name} size={36} />
                      <div style={{minWidth:0}}>
                        <div className="m-emp-n" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.full_name}</div>
                        <div className="m-emp-s">{e.department||'—'}</div>
                      </div>
                    </div>
                    <div className="mgx-strip">
                      {days.map(d => { const wk=d.dow===6&&d.day<lastDay, interactive=d.status!=='future'
                        return <span key={d.day}
                          className={'mgc '+d.status+(d.reg?' reg':'')+(d.late?' late':'')+(d.declared?' decl':'')+(d.day===todayNum?' today':'')+(wk?' wk':'')}
                          style={canMark&&interactive?{cursor:'pointer'}:undefined}
                          onMouseEnter={interactive?ev=>showTip(e,d,ev):undefined}
                          onMouseMove={interactive?moveTip:undefined}
                          onMouseLeave={interactive?hideTip:undefined}
                          onClick={canMark&&interactive?()=>openMark(e,d):undefined} /> })}
                    </div>
                    <div className="mgx-sum">
                      <span className="msum-n"><b>{present}</b> / {scheduled} days</span>
                      <span className="msum-bar">{seg(c.present,scheduled,'var(--st-present)')}{seg(c.half,scheduled,'var(--st-half)')}{seg(c.leave,scheduled,'var(--st-leave)')}{seg(c.absent,scheduled,'var(--st-absent)')}</span>
                      {c.reg>0 && <span className="msum-reg">{PENCIL}{c.reg} reg.</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : personData ? (() => {
          const { emp: p, days, c } = personData
          const scheduled = c.present+c.half+c.absent+c.leave || 1
          const lead = new Date(cursor.getFullYear(),cursor.getMonth(),1).getDay()
          const stat = (l,v,color) => <div className="mcal-stat"><div className="mcal-stat-v" style={{color}}>{v}</div><div className="mcal-stat-l">{l}</div></div>
          return (
            <div className="acard">
              <div className="card-h bd" style={{flexWrap:'wrap',gap:16}}>
                <div className="mcal-person">
                  <Av name={p.full_name} size={40} />
                  <div><div className="mcal-name">{p.full_name}</div><div className="mcal-desig">{p.designation||'—'}{p.department?' · '+p.department:''}</div></div>
                </div>
                <div className="mcal-summary">
                  {stat('Present',c.present+c.half,'var(--st-present)')}
                  {stat('Absent',c.absent,'var(--st-absent)')}
                  {stat('Leave',c.leave,'var(--st-leave)')}
                  {stat('Late',c.late,'var(--st-half)')}
                  {stat('Regularized',c.reg,'var(--accent)')}
                </div>
              </div>
              <div className="mcal">
                <div className="mcal-head">{WD.map(w=><div key={w} className="mcal-hd">{w}</div>)}</div>
                <div className="mcal-grid">
                  {Array.from({length:lead}).map((_,i)=><div key={'b'+i} className="mcell blank" />)}
                  {days.map(d => {
                    const fut = d.status==='future'
                    let body
                    if (d.status==='present'||d.status==='half') body = <>
                      <div className="mcell-io">{d.inM?fmtTime(d.inM):'—'} <span className="ar">→</span> {d.outM?fmtTime(d.outM):'—'}</div>
                      <div className="mcell-w">{minToHrs(d.worked)}{d.late && <span className="mcell-late">Late</span>}</div>
                      {d.reg && <div className="mcell-reg">{PENCIL}Regularized</div>}
                    </>
                    else if (d.status==='absent') body = <><div className="mcell-lab">Absent</div>{d.reg && <div className="mcell-reg">{PENCIL}Regularized</div>}</>
                    else if (d.status==='leave') body = <div className="mcell-lab">Leave</div>
                    else if (d.status==='holiday') body = <div className="mcell-lab">Holiday</div>
                    else if (d.status==='weekoff') body = <div className="mcell-lab wo">Week-off</div>
                    else body = null
                    return (
                      <div key={d.day} className={'mcell '+(fut?'future':d.status)+(d.day===todayNum?' today':'')}>
                        <div className="mcell-top"><span className="mcell-d">{d.day}</span>{d.reg && <span className="mcell-fold" title="Regularized" />}</div>
                        {body}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })() : <div className="acard"><div className="list-empty">No employee selected.</div></div>}

        {/* hover tooltip */}
        {tip && (() => {
          const r = tip.rec, dt = new Date(cursor.getFullYear(),cursor.getMonth(),r.day)
          const dLbl = dt.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})
          const worked = r.status==='present'||r.status==='half'
          return (
            <div className="mtt" style={{left:tip.x,top:tip.y}}>
              <div className="mtt-hd"><span className="mtt-name">{tip.emp.full_name.split(' ')[0]}</span><span className="mtt-date">{dLbl}</span></div>
              <span className={'spill '+r.status}><span className="led" />{STLBL[r.status]||'—'}</span>
              {worked && <>
                <div className="mtt-rows">
                  <div className="mtt-io"><span className="k">Check-in</span><span className="v">{r.inM?fmtTime(r.inM):'—'}</span></div>
                  <div className="mtt-io"><span className="k">Check-out</span><span className="v">{r.outM?fmtTime(r.outM):'—'}</span></div>
                  <div className="mtt-io"><span className="k">Worked</span><span className="v">{minToHrs(r.worked)}</span></div>
                </div>
                {r.late && <div className="mtt-tags"><span className="mtt-tag late">Late in</span></div>}
              </>}
              {r.reg && <div className="mtt-reg">{PENCIL}<div><div className="mtt-reg-t">Regularized</div><div className="mtt-reg-s">{(r.reg.reason||'Adjustment')} · {r.reg.status}</div></div></div>}
              {r.declared && <div className="mtt-reg">{PENCIL}<div><div className="mtt-reg-t">Declared · {DECL_LABEL[r.declared.status]}</div><div className="mtt-reg-s">{r.declared.reason}{r.declared.note?' · '+r.declared.note:''}</div></div></div>}
            </div>
          )
        })()}

        {showDecl && (
          <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(11,27,48,0.55)',display:'grid',placeItems:'center',padding:16}} onClick={()=>setShowDecl(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,width:'min(540px,96vw)',maxHeight:'92vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.35)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'16px 20px',borderBottom:'1px solid var(--line-2)'}}>
                <div><div style={{fontWeight:600,fontSize:16,color:'var(--ink)'}}>Declare a special day</div><div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>Rainfall / WFH / calamity — sets everyone at a location for the date(s)</div></div>
                <button onClick={()=>setShowDecl(false)} style={{border:0,background:'none',fontSize:20,cursor:'pointer',color:'var(--muted)',lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <label style={declFieldL}>From<input type="date" value={declForm.from_date} onChange={e=>setDeclForm(f=>({...f,from_date:e.target.value,to_date:f.to_date||e.target.value}))} style={declInp}/></label>
                  <label style={declFieldL}>To<input type="date" value={declForm.to_date} min={declForm.from_date} onChange={e=>setDeclForm(f=>({...f,to_date:e.target.value}))} style={declInp}/></label>
                </div>
                <label style={declFieldL}>Location<select value={declForm.branch} onChange={e=>setDeclForm(f=>({...f,branch:e.target.value}))} style={declInp}><option value="">All locations</option>{branches.map(b=><option key={b} value={b}>{b}</option>)}</select></label>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <label style={declFieldL}>Set status<select value={declForm.status} onChange={e=>setDeclForm(f=>({...f,status:e.target.value}))} style={declInp}>{Object.entries(DECL_LABEL).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
                  <label style={declFieldL}>Reason<select value={declForm.reason} onChange={e=>setDeclForm(f=>({...f,reason:e.target.value}))} style={declInp}>{DECL_REASONS.map(r=><option key={r} value={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label>
                </div>
                <label style={declFieldL}>Note (optional)<input value={declForm.note} onChange={e=>setDeclForm(f=>({...f,note:e.target.value}))} placeholder="e.g. Heavy rain, city shut" style={declInp}/></label>
                <div style={{fontSize:11.5,color:'var(--muted)',lineHeight:1.5}}>Only affects would-be-absent days at the chosen location. People who punched in, or are on approved leave, keep their real status. WFH counts as present (paid).</div>
              </div>
              {decls.length>0 && <div style={{padding:'0 20px 6px'}}>
                <div style={{fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em',color:'var(--muted)',margin:'2px 0 6px'}}>Declared this month</div>
                {decls.map(d=>(
                  <div key={d.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 0',borderTop:'1px solid var(--line-2)',fontSize:12.5}}>
                    <div style={{minWidth:0}}><b>{DECL_LABEL[d.status]}</b> · {d.reason}{d.branch?' · '+d.branch:' · All'}<div style={{fontSize:11,color:'var(--muted-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.from_date}{d.to_date!==d.from_date?' → '+d.to_date:''}{d.note?' · '+d.note:''}</div></div>
                    <button className="btn btn-neutral btn-sm" onClick={()=>deleteDecl(d.id)}>Remove</button>
                  </div>
                ))}
              </div>}
              <div style={{display:'flex',justifyContent:'flex-end',gap:9,padding:'14px 20px',borderTop:'1px solid var(--line-2)',background:'var(--bg-2)'}}>
                <button className="btn btn-neutral btn-sm" onClick={()=>setShowDecl(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveDecl}>Declare</button>
              </div>
            </div>
          </div>
        )}

        {markCell && (
          <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(11,27,48,0.55)',display:'grid',placeItems:'center',padding:16}} onClick={()=>setMarkCell(null)}>
            <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:14,width:'min(440px,96vw)',boxShadow:'0 20px 60px rgba(0,0,0,0.35)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'16px 20px',borderBottom:'1px solid var(--line-2)'}}>
                <div><div style={{fontWeight:600,fontSize:16,color:'var(--ink)'}}>Mark attendance</div><div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{markCell.emp.full_name} · {new Date(markCell.date).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</div></div>
                <button onClick={()=>setMarkCell(null)} style={{border:0,background:'none',fontSize:20,cursor:'pointer',color:'var(--muted)',lineHeight:1}}>✕</button>
              </div>
              <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:14}}>
                <label style={declFieldL}>Status<select value={markStatus} onChange={e=>setMarkStatus(e.target.value)} style={declInp}>
                  <option value="present">Present</option>
                  <option value="half_day">Half day</option>
                  <option value="absent">Absent</option>
                  <option value="leave">Leave</option>
                  <option value="lop">LOP</option>
                </select></label>
                <label style={declFieldL}>Note (optional)<input value={markNote} onChange={e=>setMarkNote(e.target.value)} placeholder="e.g. Was present, missed punch" style={declInp}/></label>
                <div style={{fontSize:11.5,color:'var(--muted)',lineHeight:1.5}}>Overrides the computed status for this day, and is logged (who &amp; when). Admin &amp; HR only.</div>
              </div>
              <div style={{display:'flex',justifyContent:'flex-end',gap:9,padding:'14px 20px',borderTop:'1px solid var(--line-2)',background:'var(--bg-2)'}}>
                <button className="btn btn-neutral btn-sm" onClick={()=>setMarkCell(null)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveMark}>Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
