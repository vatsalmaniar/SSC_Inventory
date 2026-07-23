import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { currentFyLabel } from '../lib/kpi'
import { computeDay, isWeekOff, distanceM, minToHrs, fmtTime, toMin, STATUS_META, DEFAULT_CFG, effShift } from '../lib/attendance'
import { signPhotos } from '../lib/photos'
import { adminEmpIds } from '../lib/attScope'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const AVC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
const oc = (n='') => { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVC[Math.abs(h)%AVC.length] }
const ini = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??'
const ymd = d => new Date(d).toLocaleDateString('en-CA')  // YYYY-MM-DD local
const Av = ({ e, size=30 }) => <div className="avatar" style={{width:size,height:size,fontSize:size*0.36,...(e.signedPhoto?{backgroundImage:`url(${e.signedPhoto})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:oc(e.full_name)})}}>{e.signedPhoto?'':ini(e.full_name)}</div>

export default function PeopleAttendance() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState(null)
  const [role, setRole] = useState('')
  const [cfg, setCfg] = useState(DEFAULT_CFG)
  const [offices, setOffices] = useState([])
  const [holidays, setHolidays] = useState(new Set())
  const [punches, setPunches] = useState([])          // my punches (last ~45d)
  const [bal, setBal] = useState(null)
  const [pending, setPending] = useState(0)
  const [team, setTeam] = useState([])                // direct reports + their today punches
  const [scope, setScope] = useState([])              // dashboard-wide who's-in scope (+_punches/_onLeave)
  const [now, setNow] = useState(new Date())
  const [punching, setPunching] = useState(false)
  const [camOpen, setCamOpen] = useState(false)
  const [camErr, setCamErr] = useState('')
  const guard = useRef(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => { init() }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])

  const isFC = useMemo(() => (me?.branch || '').startsWith('FC') || ['fc_kaveri','fc_godawari'].includes(role), [me, role])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    const { data: emp } = await sb.from('employees').select('*').eq('profile_id', session.user.id).maybeSingle()
    setMe(emp || null)
    try { await load(emp, prof?.role || '') }
    catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { setLoading(false) }
  }

  async function load(emp, roleStr) {
    const since = new Date(); since.setDate(since.getDate() - 45)
    const [c, off, hol, bl, lr] = await Promise.all([
      sb.from('attendance_config').select('*').maybeSingle(),
      sb.from('office_locations').select('*').eq('is_active', true),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      emp ? sb.from('leave_balances').select('*').eq('employee_id', emp.id).eq('fy_label', currentFyLabel()).maybeSingle() : Promise.resolve({data:null}),
      emp ? sb.from('leave_requests').select('id,status').eq('employee_id', emp.id).eq('status','pending') : Promise.resolve({data:[]}),
    ])
    const config = c?.data || DEFAULT_CFG
    setCfg(config); setOffices(off?.data || [])
    setHolidays(new Set((hol?.data || []).map(h => h.holiday_date))); setBal(bl?.data || null)
    setPending((lr?.data || []).length)
    if (!emp) return

    const { data: p } = await sb.from('attendance_punches').select('punch_at,direction').eq('employee_id', emp.id).gte('punch_at', since.toISOString()).order('punch_at')
    setPunches(p || [])

    // ── Office presence (who's in / on leave) — ONE security-definer RPC, presence-only
    //    (name + in/out, no times/detail), visible to EVERY role. Powers both the presence
    //    board AND the "My team" card, so a normal user (RLS-blocked from others' punch
    //    detail) still sees who's in / on leave. Management never sees the admin.
    const mgmt = ['admin','management'].includes(roleStr)
    let presRows = []
    try {
      const { data: pres, error } = await sb.rpc('office_presence')
      if (error) throw error
      presRows = pres || []
    } catch (e) {
      // RPC not deployed → mgmt/admin read directly; normal users just see themselves.
      if (mgmt) {
        const { data } = await sb.from('employees').select('id,full_name,designation,department,photo_url').neq('lifecycle_status','exited').order('full_name')
        const list = data || [], ids = list.map(x=>x.id); const byIn = {}; let onLv = new Set()
        if (ids.length) {
          const todayStart = new Date(); todayStart.setHours(0,0,0,0); const todayStr = ymd(new Date())
          const [tp, lv] = await Promise.all([
            sb.from('attendance_punches').select('employee_id,direction,punch_at').in('employee_id', ids).gte('punch_at', todayStart.toISOString()),
            sb.from('leave_requests').select('employee_id').eq('status','approved').lte('from_date', todayStr).gte('to_date', todayStr).in('employee_id', ids),
          ])
          ;(tp.data||[]).forEach(x => { if (x.direction==='in') byIn[x.employee_id]=true; else if (!(x.employee_id in byIn)) byIn[x.employee_id]=false })
          onLv = new Set((lv.data||[]).map(r=>r.employee_id))
        }
        presRows = list.map(e => ({ employee_id:e.id, full_name:e.full_name, designation:e.designation, department:e.department, photo_url:e.photo_url, is_in:!!byIn[e.id], on_leave:onLv.has(e.id) }))
      }
    }
    if (roleStr === 'management') { const ex = await adminEmpIds(); presRows = presRows.filter(p => !ex.includes(p.employee_id)) }
    const presById = {}; presRows.forEach(p => { presById[p.employee_id] = p })

    // presence board + "on leave today" (everyone except me)
    const sl = presRows.filter(p => p.employee_id !== emp?.id).map(p => ({
      id: p.employee_id, full_name: p.full_name, designation: p.designation, department: p.department, photo_url: p.photo_url,
      _punches: p.is_in ? [{ direction:'in' }] : [], _onLeave: p.on_leave,
    }))
    signPhotos(sl).then(() => setScope([...sl])).catch(()=>{})
    setScope(sl)

    // "My team · today" → full downline (recursive), status from presence (RLS-safe for all roles)
    const { data: allEmp } = await sb.from('employees').select('id,full_name,designation,photo_url,reporting_manager_id').neq('lifecycle_status','exited')
    const byMgr = {}; (allEmp||[]).forEach(e => (byMgr[e.reporting_manager_id] ||= []).push(e))
    const repList = []; const stack = [...(byMgr[emp.id]||[])]
    while (stack.length) { const e = stack.pop(); if (repList.some(x=>x.id===e.id)) continue; repList.push(e); (byMgr[e.id]||[]).forEach(c => stack.push(c)) }
    repList.sort((a,b)=>a.full_name.localeCompare(b.full_name))
    repList.forEach(r => { const p = presById[r.id]; r.today = { status: p?.on_leave ? 'leave' : p?.is_in ? 'present' : 'absent' } })
    signPhotos(repList).then(() => setTeam([...repList])).catch(()=>{})
    setTeam(repList)
  }

  // group my punches by date
  const byDate = useMemo(() => { const m={}; punches.forEach(p => (m[ymd(p.punch_at)] ||= []).push(p)); return m }, [punches])
  const today = ymd(now)
  const myCfg = useMemo(() => effShift(me, cfg), [me, cfg])
  const todayComputed = useMemo(() => computeDay({ date: today, punches: byDate[today]||[], config: myCfg, isHoliday: holidays.has(today), isFC }), [byDate, today, myCfg, holidays, isFC])
  const todayPunches = byDate[today] || []
  const nextDir = todayPunches.length && todayPunches[todayPunches.length-1].direction === 'in' ? 'out' : 'in'

  // recent history (last 14 days with punches)
  const history = useMemo(() => Object.keys(byDate).sort().reverse().slice(0,14).map(dt => ({ date: dt, ...computeDay({ date: dt, punches: byDate[dt], config: myCfg, isHoliday: holidays.has(dt), isFC }) })), [byDate, myCfg, holidays, isFC])

  // this-month stats + donut
  const monthStats = useMemo(() => {
    const mk = today.slice(0,7)
    const days = Object.keys(byDate).filter(d => d.startsWith(mk)).map(d => computeDay({ date: d, punches: byDate[d], config: myCfg, isHoliday: holidays.has(d), isFC }))
    const c = { present:0, half_day:0, absent:0, leave:0, holiday:0 }
    let inMins=[], workMins=[], ontime=0, tot=0
    days.forEach(d => { c[d.status] = (c[d.status]||0)+1
      if (d.first_in) { inMins.push(d.first_in.getHours()*60+d.first_in.getMinutes()); tot++; if (d.status==='present') ontime++ }
      if (d.worked_min) workMins.push(d.worked_min) })
    const avg = a => a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null
    return { c, avgInMin: avg(inMins), avgWork: avg(workMins), onTimePct: tot ? Math.round(ontime/tot*100) : null }
  }, [byDate, myCfg, holidays, isFC, today])

  // ── who's on leave / not in yet (dashboard-wide) ──
  const { onLeaveToday, notInYet, inCount } = useMemo(() => {
    const off = isWeekOff(new Date()) || holidays.has(today)
    const onLeaveToday = scope.filter(s => s._onLeave)
    const inCount = scope.filter(s => (s._punches||[]).some(p => p.direction === 'in')).length
    const notInYet = off ? [] : scope.filter(s => !s._onLeave && !(s._punches||[]).some(p => p.direction === 'in'))
    return { onLeaveToday, notInYet, inCount }
  }, [scope, holidays, today])

  async function openPunch() {
    if (!me) return
    setCamErr(''); setCamOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(()=>{}) }
    } catch (e) {
      setCamErr('Camera not available — you can still punch without a photo.')
    }
  }
  function closeCam() {
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamOpen(false)
  }
  useEffect(() => () => { streamRef.current?.getTracks().forEach(t=>t.stop()) }, [])

  async function capturePunch() {
    if (guard.current || !me) return
    guard.current = true; setPunching(true)
    try {
      // 1. selfie frame (if camera live)
      let blob = null
      const v = videoRef.current
      if (v && streamRef.current && v.videoWidth) {
        const w = 480, h = Math.round(v.videoHeight / v.videoWidth * 480) || 480
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h
        cv.getContext('2d').drawImage(v, 0, 0, w, h)
        blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.6))
      }
      // 2. location + geofence
      const geo = await new Promise(res => {
        if (!navigator.geolocation) return res(null)
        navigator.geolocation.getCurrentPosition(p => res(p.coords), () => res(null), { enableHighAccuracy:true, timeout:15000, maximumAge:30000 })
      })
      let lat=null, lng=null, acc=null, within=null, officeId=null
      if (geo) { lat=geo.latitude; lng=geo.longitude; acc=geo.accuracy
        let best=null
        offices.forEach(o => { if(o.lat!=null){ const dm=distanceM({lat,lng},{lat:o.lat,lng:o.lng}); if(dm!=null&&(best==null||dm<best.dm)) best={dm,o} } })
        if (best) { within = best.dm <= (best.o.radius_m||150); officeId = best.o.id } }
      // 3. upload selfie (best-effort — a failed upload never blocks the punch)
      let photoPath = null
      if (blob) {
        const path = `${me.id}/${Date.now()}.jpg`
        const { error: upErr } = await sb.storage.from('attendance-photos').upload(path, blob, { contentType:'image/jpeg', upsert:false })
        if (!upErr) photoPath = path
      }
      // 4. record punch
      const { error } = await sb.from('attendance_punches').insert({ employee_id: me.id, direction: nextDir, method:'web', lat, lng, accuracy_m: acc, within_geofence: within, office_id: officeId, photo_path: photoPath })
      if (error) throw error
      toast(nextDir === 'in' ? 'Checked in.' : 'Checked out.', 'success')
      closeCam(); await load(me, role)
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setPunching(false) }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Attendance"><div className="people-app"><Spinner label="Loading attendance…" /></div></Layout>
  if (!me) return <Layout pageKey="people" pageTitle="Attendance"><div className="people-app"><div className="e-empty">No employee record linked to your login. Ask HR to link you in the Team directory.</div></div></Layout>

  const hour = now.getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const tm = STATUS_META[todayComputed.status] || STATUS_META.absent
  const dayMin = toMin(myCfg.office_end) - toMin(myCfg.office_start)
  const firstIn = todayComputed.first_in
  const elapsed = firstIn ? Math.max(0, Math.min(dayMin, (now - firstIn)/60000)) : 0
  const pct = firstIn ? Math.round(elapsed/dayMin*100) : 0
  const timeLeftMin = firstIn ? Math.max(0, Math.round(dayMin - elapsed)) : dayMin

  const donutC = monthStats.c
  const donutTot = Object.values(donutC).reduce((s,x)=>s+x,0) || 1
  const dseg = [['present','var(--st-present)'],['half_day','var(--st-half)'],['leave','var(--st-leave)'],['absent','var(--st-absent)'],['holiday','var(--st-holiday)']]
  const stColor = Object.fromEntries(dseg)
  let dacc=0; const conic = dseg.map(([k,c])=>{ const s=dacc/donutTot*360, e=(dacc+ (donutC[k]||0))/donutTot*360; dacc+=donutC[k]||0; return `${c} ${s}deg ${e}deg` }).join(',')
  const balNum = bal ? Number(bal.credited)+Number(bal.carried_forward)-Number(bal.used)-Number(bal.encashed) : null
  const avgInStr = monthStats.avgInMin!=null ? `${String(Math.floor(monthStats.avgInMin/60)).padStart(2,'0')}:${String(monthStats.avgInMin%60).padStart(2,'0')}` : '—'
  const showWho = scope.length > 0
  const nowMin = now.getHours()*60 + now.getMinutes()
  const shiftStart = toMin(myCfg.office_start), shiftEnd = toMin(myCfg.office_end)
  const tlPct = Math.max(0, Math.min(1, (nowMin - shiftStart)/((shiftEnd-shiftStart)||1)))
  const overtime = nowMin > shiftEnd
  const workedSoFarMin = firstIn ? (todayComputed.last_out ? (todayComputed.worked_min||0) : Math.round((now - firstIn)/60000)) : 0
  const credited = bal ? Number(bal.credited)+Number(bal.carried_forward) : 25

  const Icon = ({ d }) => <svg viewBox="0 0 16 16" width="13" fill="none" stroke="currentColor" strokeWidth="1.6"><path d={d} /></svg>

  return (
    <Layout pageKey="people" pageTitle="Attendance">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="ph-title">{greet}, {me.full_name.split(' ')[0]}</h1>
            <div className="ph-sub">{pending>0 ? <>You have <b>{pending}</b> leave request{pending>1?'s':''} pending.</> : 'Attendance overview'}</div>
          </div>
          <div className="meta-pill live"><span className="meta-dot" /> Live</div>
        </div>

        <AttendanceTabs role={role} isManager={team.length > 0} />

        {/* ── hero + floor ── */}
        <div className="dash-top">
          <section className="hero">
            <div className="hero-head">
              <span className="hero-eyebrow">Today · {now.toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'short'})}</span>
              <span className="hero-chip"><span className="led" style={{background: firstIn?'var(--st-present)':'#ff8b6b'}} />{firstIn?'Checked in':'Not in yet'}</span>
            </div>
            <div className="hero-body">
              <div className="hero-ring" style={{background:`conic-gradient(var(--accent) ${pct*3.6}deg, var(--line) 0)`}}>
                <div className="hero-ring-c"><div className="hero-ring-v">{pct}%</div><div className="hero-ring-l">of shift</div></div>
              </div>
              <div className="hero-mid">
                <div className="hero-stat">
                  <div><div className="hero-stat-l">Checked in</div><div className="hero-stat-v mono">{firstIn?fmtTime(firstIn):'—'}</div></div>
                  <div><div className="hero-stat-l">Worked so far</div><div className="hero-stat-v cyan">{firstIn?minToHrs(workedSoFarMin):'0h 00m'}</div></div>
                  <div><div className="hero-stat-l">Shift</div><div className="hero-stat-v mono">{(myCfg.office_start||'').slice(0,5)}–{(myCfg.office_end||'').slice(0,5)}</div></div>
                </div>
                <div className="tl">
                  <div className="tl-track"><div className="tl-fill" style={{width:(tlPct*100)+'%'}} /><div className="tl-now" style={{left:(tlPct*100)+'%'}} /></div>
                  <div className="tl-labels"><span>{(myCfg.office_start||'').slice(0,5)}</span><span>{overtime?'shift ended':'now '+now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true})}</span><span>{(myCfg.office_end||'').slice(0,5)}</span></div>
                </div>
              </div>
            </div>
            <div className="hero-cta">
              <button className="btn btn-cyan" onClick={openPunch} disabled={punching}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2" y="4.5" width="12" height="8.5" rx="1.5"/><circle cx="8" cy="8.7" r="2.2"/><path d="M6 4.5l1-1.5h2l1 1.5"/></svg>
                {nextDir==='in'?'Check In':'Check Out'}
              </button>
              <button className="btn btn-onnavy" onClick={()=>navigate('/people/attendance/regularize')}>Regularize</button>
            </div>
          </section>

          {showWho && (
            <div className="floor">
              <div className="floor-h"><span className="floor-t">Inside the office</span><span className="floor-sub">today</span></div>
              <div className="floor-big">{inCount} <small>/ {scope.length} in</small></div>
              <div className="pbar">
                <i style={{flex:Math.max(inCount,0.01),background:'var(--st-present)'}} />
                <i style={{flex:Math.max(onLeaveToday.length,0.01),background:'var(--st-leave)'}} />
                <i style={{flex:Math.max(notInYet.length,0.01),background:'var(--st-absent)'}} />
              </div>
              <div className="floor-legend">
                <span className="floor-leg"><span className="led" style={{background:'var(--st-present)'}} />Present <b>{inCount}</b></span>
                <span className="floor-leg"><span className="led" style={{background:'var(--st-leave)'}} />Leave <b>{onLeaveToday.length}</b></span>
                <span className="floor-leg"><span className="led" style={{background:'var(--st-absent)'}} />Not in <b>{notInYet.length}</b></span>
              </div>
              {notInYet.length>0 && (
                <div className="avstack">
                  {notInYet.slice(0,7).map(s=><span key={s.id} title={s.full_name}><Av e={s} size={34} /></span>)}
                  <span className="avstack-more">{notInYet.length>7?<><b>+{notInYet.length-7}</b> more not in</>:'still out'}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── stat tiles ── */}
        <div className="stiles">
          <div className="stile"><div className="stile-top"><span className="stile-ic" style={{background:'var(--accent-soft)',color:'var(--accent)'}}><Icon d="M8 2v6l4 2" /></span><span className="stile-l">Leave balance</span></div><div className="stile-v">{balNum ?? '—'}<small> / {credited}</small></div><div className="stile-foot"><b>{bal?Number(bal.used):0}</b> used · FY {currentFyLabel()}</div></div>
          <div className="stile"><div className="stile-top"><span className="stile-ic" style={{background:'var(--pos-bg)',color:'var(--st-present)'}}><Icon d="M3 8l3 3 7-7" /></span><span className="stile-l">Present · this mo</span></div><div className="stile-v">{donutC.present}<small> / {donutTot}</small></div><div className="stile-foot"><b>{donutC.half_day||0}</b> half · <b>{donutC.leave||0}</b> leave</div></div>
          <div className="stile"><div className="stile-top"><span className="stile-ic" style={{background:'var(--crit-bg)',color:'var(--crit)'}}><Icon d="M8 4v4l3 2" /></span><span className="stile-l">On-time</span></div><div className="stile-v">{monthStats.onTimePct!=null?monthStats.onTimePct+'%':'—'}</div><div className="stile-foot">arrivals this month</div></div>
          <div className="stile"><div className="stile-top"><span className="stile-ic" style={{background:'rgba(124,92,224,.10)',color:'var(--st-leave)'}}><Icon d="M2 13h12M4 13V7M8 13V4M12 13V9" /></span><span className="stile-l">Avg hours / day</span></div><div className="stile-v">{minToHrs(monthStats.avgWork)}</div><div className="stile-foot">clock-in avg <b>{avgInStr}</b></div></div>
        </div>

        {/* ── month donut + history ── */}
        <div className="agrid g-2u" style={{marginBottom:16}}>
          <div className="acard">
            <div className="card-h bd"><span className="card-t">My month</span><span className="card-sub">this month</span></div>
            <div className="mdonut">
              <div className="donut2" style={{background:`conic-gradient(${conic}, var(--line) 0)`}}><div className="donut2-c"><div className="donut2-v">{donutC.present}</div><div className="donut2-l">present days</div></div></div>
              <div className="mlegend">
                {[['present','Present'],['half_day','Half day'],['leave','Leave'],['absent','Absent']].map(([k,l])=>(
                  <div key={k} className="mleg"><span className="mleg-dot" style={{background:stColor[k]}} /><span className="mleg-n">{l}</span><span className="mleg-v">{donutC[k]||0}</span></div>
                ))}
              </div>
            </div>
          </div>
          <div className="acard">
            <div className="card-h bd"><span className="card-t">Working history</span><span className="card-sub">last {Math.min(history.length,6)} days</span></div>
            <div className="tbl-wrap"><table className="dtbl"><thead><tr><th>Date</th><th>Arrival</th><th>Departure</th><th className="r">Worked</th><th className="r">Status</th></tr></thead>
              <tbody>{history.length===0 ? <tr><td colSpan={5} style={{textAlign:'center',color:'var(--muted)',padding:'30px'}}>No punches yet.</td></tr> : history.slice(0,6).map(h=>{ const meta=STATUS_META[h.status]||STATUS_META.absent; return (
                <tr key={h.date}><td style={{fontWeight:600}}>{new Date(h.date).toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short'})}</td>
                  <td style={{color:'var(--muted)'}}>{fmtTime(h.first_in)}</td>
                  <td style={{color:'var(--muted)'}}>{h.last_out?fmtTime(h.last_out):'—'}</td>
                  <td className="r">{h.worked_min?minToHrs(h.worked_min):'—'}</td>
                  <td className="r"><span className={'spill '+h.status}><span className="led" />{meta.label}</span></td></tr>
              )})}</tbody></table></div>
          </div>
        </div>

        {/* ── on leave + team (visible to everyone; presence-level data) ── */}
        <div className="agrid g-2">
          <div className="acard">
            <div className="card-h bd"><span className="card-t">On leave today</span><span className="card-count">{onLeaveToday.length}</span></div>
            {onLeaveToday.length===0 ? <div className="list-empty">Nobody's on leave today.</div> :
              <div className="plist">{onLeaveToday.map(s=>(
                <div key={s.id} className="prow" style={{cursor:'pointer'}} onClick={()=>navigate('/people/attendance/me?emp='+s.id)}>
                  <Av e={s} size={36} /><div className="prow-b"><div className="prow-n">{s.full_name}</div><div className="prow-s">{s.designation||'—'}</div></div>
                  <div className="prow-r"><span className="spill leave"><span className="led" />Leave</span></div></div>
              ))}</div>}
          </div>
          <div className="acard">
            <div className="card-h bd"><span className="card-t">My team · today</span><span className="card-count">{team.length}</span></div>
            {team.length===0 ? <div className="list-empty">No team members.</div> :
              <div className="plist">{team.map(r=>{ const st=r.today?.status||'absent'; return (
                <div key={r.id} className="prow" style={{cursor:'pointer'}} onClick={()=>navigate('/people/attendance/me?emp='+r.id)}>
                  <Av e={r} size={36} /><div className="prow-b"><div className="prow-n">{r.full_name}</div><div className="prow-s">{r.designation||'—'}</div></div>
                  <div className="prow-r"><span className={'spill '+st}><span className="led" />{st==='leave' ? 'On leave' : st==='present' ? 'In office' : 'Not in office'}</span></div></div>
              )})}</div>}
          </div>
        </div>
      </div>

      {camOpen && createPortal(
        <div style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(11,27,48,0.72)',display:'grid',placeItems:'center',padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'min(420px,94vw)',overflow:'hidden',boxShadow:'0 20px 60px rgba(0,0,0,0.35)',fontFamily:"'Geist','DM Sans',sans-serif"}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #EFF1F4',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontWeight:600,fontSize:15,color:'#0B1B30'}}>{nextDir==='in'?'Check In':'Check Out'} · Selfie</div>
              <button onClick={closeCam} style={{border:0,background:'none',fontSize:18,cursor:'pointer',color:'#5B6878'}}>✕</button>
            </div>
            <div style={{background:'#0B1B30',aspectRatio:'4 / 3',display:'grid',placeItems:'center'}}>
              {camErr
                ? <div style={{color:'#fff',fontSize:13,textAlign:'center',padding:24,lineHeight:1.5}}>{camErr}</div>
                : <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover',transform:'scaleX(-1)'}} />}
            </div>
            <div style={{padding:16,display:'flex',flexDirection:'column',gap:10}}>
              <div style={{fontSize:12,color:'#5B6878',textAlign:'center'}}>📍 Your location is captured with the punch.</div>
              <button onClick={capturePunch} disabled={punching}
                style={{width:'100%',border:0,borderRadius:10,padding:13,font:'inherit',fontSize:14.5,fontWeight:600,cursor:punching?'default':'pointer',color:'#fff',background:nextDir==='out'?'#C25A00':'#1a73e8',opacity:punching?0.65:1}}>
                {punching ? 'Saving…' : (camErr ? `Check ${nextDir==='in'?'In':'Out'} without photo` : `📸 Capture & Check ${nextDir==='in'?'In':'Out'}`)}
              </button>
            </div>
          </div>
        </div>, document.body)}
    </Layout>
  )
}
