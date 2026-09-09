import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import PeopleAvatar from '../components/PeopleAvatar'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import { fetchAll } from '../lib/fetchAll'
import { visibleEmployees } from '../lib/peopleScope'
import { REQ_ST, fmtTime } from '../lib/attendance'
import PeoplePager from '../components/PeoplePager'
import Stat from '../components/StatTile'
import '../styles/people.css'
import '../styles/attendance-ui.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—'
// Policy (user, 2026-09-03): a regularization must be raised within 48 HOURS of the day
// (today or up to 2 days back — older days are HR's to fix via the Muster mark) — and at
// most 7 per calendar month. sql/regularization_policy_guard.sql is the DB-side gate.
const REG_MONTHLY_CAP = 7
const REG_WINDOW_DAYS = 2
const todayStr = () => new Date().toLocaleDateString('en-CA')
const minRegDate = () => { const d = new Date(); d.setDate(d.getDate() - REG_WINDOW_DAYS); return d.toLocaleDateString('en-CA') }
const ST = REQ_ST   // one request-status palette for the whole suite (lib/attendance.js)
const REG_REASONS = [
  { k:'forgot_in',  l:'Forgot to punch in' },
  { k:'forgot_out', l:'Forgot to punch out' },
  { k:'field',      l:'Client / site visit' },
  { k:'wfh',        l:'Worked from home' },
  { k:'biometric',  l:'Punch machine not working' },
  { k:'on_duty',    l:'Official work outside office' },
  { k:'other',      l:'Other reason' },
]
const REG_LABEL = Object.fromEntries(REG_REASONS.map(r => [r.k, r.l]))
function Drawer({title,sub,onClose,children,footer}){return createPortal(<><div className="people-drawer-scrim" onClick={onClose}/><div className="people-drawer"><div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub&&<div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div><div className="pd-b">{children}</div>{footer&&<div className="pd-foot">{footer}</div>}</div></>,document.body)}

export default function PeopleRegularize() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('')
  const [meId, setMeId] = useState(null)
  const [hrId, setHrId] = useState(null)
  const [mine, setMine] = useState([])
  const [inbox, setInbox] = useState([])
  const [teamRegs, setTeamRegs] = useState(null)   // admin/mgmt/HR: the whole team's ledger
  const [team, setTeam] = useState(null)           // employee list for the header picker
  const [viewSel, setViewSel] = useState('')       // '' = my view; an employee id = whole-page switch
  const [regPage, setRegPage] = useState(1)        // team ledger pagination (house pattern: 50/page)
  const [daySwipes, setDaySwipes] = useState(null)  // actual punches on the date being regularized
  const [swipesBy, setSwipesBy] = useState({})      // `${employee_id}|${work_date}` -> [punch times] for visible request rows
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ work_date:todayStr(), side:'in', requested_in:'10:00', requested_out:'18:30', reason_type:'forgot_in', note:'' })
  const guard = useRef(false)
  const isMgmt = ['admin','management'].includes(role)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    const { data: me } = await sb.from('employees').select('id').eq('profile_id', session.user.id).maybeSingle()
    setMeId(me?.id || null)
    const preDate = params.get('date')
    if (preDate) {
      // 48-hour rule: a link from inside the window keeps its date; older days open
      // pinned to today with a pointer to the HR route.
      const ok = preDate >= minRegDate() && preDate <= todayStr()
      if (!ok) toast('Regularization is allowed within 48 hours of the day — for older days, ask HR to mark them from the Muster.', 'error')
      setForm(f => ({ ...f, work_date: ok ? preDate : todayStr() })); setShow(true)
    }
    await load(me?.id, prof?.role)
    setLoading(false)
  }

  async function load(myId, r = role) {
    const [cfg, mn, ib] = await Promise.all([
      sb.from('attendance_config').select('hr_approver_employee_id').maybeSingle(),
      myId ? sb.from('regularizations').select('*').eq('employee_id', myId).order('created_at',{ascending:false}) : Promise.resolve({data:[]}),
      sb.from('regularizations').select('*, emp:employees!regularizations_employee_id_fkey(full_name,designation,reporting_manager_id)').in('status',['pending','mgr_approved']).order('created_at'),
    ])
    const hrEmp = cfg?.data?.hr_approver_employee_id || null
    setHrId(hrEmp)
    setMine(mn?.data || [])
    setInbox((ib?.data||[]).filter(x => x.employee_id !== myId))
    // full team ledger + person picker: ADMIN/MANAGEMENT ONLY (user rule 2026-09-03 —
    // everyone else sees only their own record; approvals still arrive via the inbox)
    if (['admin','management'].includes(r)) {
      const [all, empRes] = await Promise.all([
        fetchAll((f,t) => sb.from('regularizations')
          .select('id,employee_id,work_date,requested_in,requested_out,reason,status,decision_note, emp:employees!regularizations_employee_id_fkey(full_name,department)')
          .order('work_date',{ascending:false}).order('id').range(f,t)),
        visibleEmployees('requests'),   // who this user may pick — decided in the DB
      ])
      setTeamRegs(all.data || [])
      setTeam(empRes.data || [])
    }
  }

  // Count this month's live requests (rejected / cancelled don't consume the quota)
  // Month filter for the LISTS and the summary tiles only. The quota check in apply()
  // deliberately keeps using usedThisMonth below, which is pinned to the real current
  // month -- browsing August must never change what you are allowed to file today.
  // Defaults to the current month: the quota is monthly and almost every visit is about
  // this month. "All" widens it. ('' = all months.)
  const [monthSel, setMonthSel] = useState(() => todayStr().slice(0,7))
  const inMonth = r => !monthSel || (r.work_date||'').slice(0,7) === monthSel
  const monthLabel = m => { const [y,mo] = m.split('-').map(Number)
    return new Date(y, mo-1, 1).toLocaleDateString('en-IN', { month:'long', year:'numeric' }) }
  const MON_SHORT = m => { const [y,mo] = m.split('-').map(Number)
    return new Date(y, mo-1, 1).toLocaleDateString('en-IN', { month:'short' }) }

  const usedThisMonth = mine.filter(r =>
    ['pending','mgr_approved','approved'].includes(r.status) &&
    r.work_date.slice(0,7) === todayStr().slice(0,7)).length

  // Actual swipes beside every visible request (inbox, my rows, person view) — the
  // approver judges against reality, and after approval the history keeps both figures.
  // One ranged query per view, filtered to the exact (person, day) pairs client-side.
  async function loadSwipesFor(reqRows) {
    const rows2 = (reqRows || []).filter(Boolean)
    if (!rows2.length) return
    const ids = [...new Set(rows2.map(r => r.employee_id))]
    const dates = rows2.map(r => r.work_date).sort()
    const start = new Date(`${dates[0]}T00:00:00+05:30`)
    const end = new Date(`${dates[dates.length-1]}T00:00:00+05:30`); end.setDate(end.getDate() + 1)
    const wanted = new Set(rows2.map(r => `${r.employee_id}|${r.work_date}`))
    // Pages: the team ledger spans months across ~30 people, which runs well past
    // PostgREST's 1000-row cap. A capped query would drop punches and the column would
    // read "no punches" for days that were actually swiped — the worst possible lie on
    // a screen an approver uses to judge a correction.
    const { data, error } = await fetchAll((f, t) => sb.from('attendance_punches')
      .select('employee_id,punch_at')
      .in('employee_id', ids).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString())
      .order('punch_at').order('id').range(f, t))
    if (error) { toast('Could not load all swipes — some rows may look empty.', 'error'); return }
    const m = {}
    ;(data || []).forEach(p => {
      const k = `${p.employee_id}|${new Date(p.punch_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}`
      if (wanted.has(k)) (m[k] ||= []).push(p.punch_at)
    })
    setSwipesBy(prev => ({ ...prev, ...m }))
  }
  useEffect(() => { loadSwipesFor([...inbox, ...mine]) }, [inbox, mine]) // eslint-disable-line
  useEffect(() => { if (viewSel && teamRegs) loadSwipesFor(teamRegs.filter(r => r.employee_id === viewSel)) }, [viewSel, teamRegs]) // eslint-disable-line
  // The team ledger shows a Swiped column, so it needs the punches for every row it lists.
  useEffect(() => { if (teamRegs?.length) loadSwipesFor(teamRegs) }, [teamRegs]) // eslint-disable-line
  const actualLine = r => {
    const s = swipesBy[`${r.employee_id ?? meId}|${r.work_date}`]
    return s === undefined ? null : s.length ? s.map(t => fmtTime(t)).join(', ') : 'no punches'
  }
  // The raw device swipes for that day, as chips -- the same treatment My Attendance
  // uses. This is what the request is correcting FROM, so it should be legible rather
  // than a grey run-on line.
  const Swipes = ({ r }) => {
    const s = swipesBy[`${r.employee_id ?? meId}|${r.work_date}`]
    if (s === undefined) return null
    return (
      <div className="ph-swipes" style={{marginTop:4}}>
        <span className="ph-swipe-l">swiped</span>
        {s.length === 0
          ? <span className="ph-noswipe">no punches</span>
          : s.map((t,i) => <span key={i} className="ph-swipe">{fmtTime(t)}</span>)}
      </div>
    )
  }

  // Show the person what they are correcting FROM: the actual swipes on the chosen date.
  useEffect(() => {
    if (!show || !form.work_date || !meId) { setDaySwipes(null); return }
    let dead = false
    ;(async () => {
      const start = new Date(`${form.work_date}T00:00:00+05:30`)
      const end = new Date(start); end.setDate(end.getDate() + 1)
      const { data } = await sb.from('attendance_punches').select('punch_at,method')
        .eq('employee_id', meId).gte('punch_at', start.toISOString()).lt('punch_at', end.toISOString())
        .order('punch_at')
      if (!dead) setDaySwipes(data || [])
    })()
    return () => { dead = true }
  }, [show, form.work_date, meId]) // eslint-disable-line

  async function apply() {
    if (guard.current) return
    if (!form.work_date) { toast('Pick the date to fix.', 'error'); return }
    if (form.work_date > todayStr() || form.work_date < minRegDate()) { toast('Regularization is allowed within 48 hours of the day — for older days, ask HR to mark them from the Muster.', 'error'); return }
    if (usedThisMonth >= REG_MONTHLY_CAP) { toast(`Monthly limit reached — ${REG_MONTHLY_CAP} regularizations per month. Ask HR for anything beyond that.`, 'error'); return }
    const t = form.side === 'in' ? form.requested_in : form.requested_out
    if (!t) { toast(`Enter the correct ${form.side === 'in' ? 'in' : 'out'}-time.`, 'error'); return }
    // "Other reason" is held to the same bar as a below-₹8,000 order: a real explanation,
    // minimum 7 words — not "personal work".
    if (form.reason_type === 'other') {
      const words = form.note.trim().split(/\s+/).filter(Boolean)
      if (words.length < 7) { toast('"Other reason" needs a proper explanation — minimum 7 words.', 'error'); return }
    }
    // One live request per day: reg_decide inserts a correction punch per approval with no
    // duplicate check, so two approved requests for the same date create two punches.
    const dup = mine.find(r => r.work_date === form.work_date && ['pending','mgr_approved','approved'].includes(r.status))
    if (dup) { toast(`You already have a ${dup.status.replace('_',' ')} regularization for ${form.work_date}.`, 'error'); return }
    const reason = [REG_LABEL[form.reason_type], form.note.trim()].filter(Boolean).join(' — ')
    guard.current = true
    try {
      const { error } = await sb.from('regularizations').insert({
        employee_id: meId, work_date: form.work_date,
        requested_in:  form.side === 'in'  ? form.requested_in  : null,
        requested_out: form.side === 'out' ? form.requested_out : null,
        reason,
      })
      if (error) throw error
      toast('Regularization sent to your manager.', 'success')
      setShow(false); setForm({ work_date:'', side:'in', requested_in:'10:00', requested_out:'18:30', reason_type:'forgot_in', note:'' })
      await load(meId)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function decide(req, step, approve) {
    // Guarded: approving at the HR step inserts correction punches, so a double-click
    // writes duplicate punches that silently widen the working day.
    if (guard.current) return
    let note = null
    if (!approve) {
      // A rejection must carry a reason — the person needs to know why (user rule 2026-09-03)
      note = (window.prompt('Reason for rejection (required):') || '').trim()
      if (!note) { toast('Rejection needs a reason — tell the person why.', 'error'); return }
    }
    guard.current = true
    try {
      const { error } = await sb.rpc('reg_decide', { p_id: req.id, p_step: step, p_approve: approve, p_note: note })
      if (error) throw error
      toast(approve ? (step==='hr'?'Approved — punch corrected.':'Sent to HR.') : 'Rejected.', 'success')
      await load(meId)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function cancelMine(req) {
    if (!window.confirm('Cancel this request?')) return
    if (guard.current) return
    guard.current = true
    try {
      // .select() so an RLS denial (zero rows, no error) can't report success.
      const { data, error } = await sb.from('regularizations').update({ status:'cancelled' }).eq('id', req.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Could not cancel — the request may already be decided, or you may not have permission.')
      toast('Cancelled.','success'); await load(meId)
    }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Regularize"><div className="orders-app"><div className="o-loading">Loading…</div></div></Layout>

  // A request corrects ONE side — show just that ("In 10:00"), not "10:00 → —" with a
  // dangling arrow for the side that wasn't touched.
  const timeRange = r => r.requested_in ? `In ${r.requested_in.slice(0,5)}`
    : r.requested_out ? `Out ${r.requested_out.slice(0,5)}` : '—'
  // Whole-page person switch (same pattern as Leave / My Attendance)
  const viewedEmp = viewSel ? (team || []).find(e => e.id === viewSel) : null
  const viewingOther = !!viewedEmp && viewSel !== meId
  const viewedRegs = viewedEmp ? (teamRegs || []).filter(r => r.employee_id === viewSel) : null

  return (
    <Layout pageKey="people" pageTitle="Regularize">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={()=>navigate('/people')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="page-title">Regularize</h1>
            <div className="page-sub">Correct a missed or wrong punch · manager approves, then HR</div>
          </div>
          <div className="page-meta">
            <button className="ph-link" onClick={()=>navigate('/people/handbook')} title="Employee Handbook">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h9a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4z" strokeLinejoin="round"/><path d="M4 4v11"/></svg>
              Handbook
            </button>
            {/* Same control as My Attendance. A month input cannot express "no filter",
                so the clear button carries that instead of a second widget type. */}
            <span className="ph-monthwrap">
              <input className="ph-month" type="month" value={monthSel} max={todayStr().slice(0,7)}
                onChange={e=>{ setMonthSel(e.target.value); setRegPage(1) }} title="Filter by month" />
              {monthSel && (
                <button className="ph-month-x" onClick={()=>{ setMonthSel(''); setRegPage(1) }} title="Show all months">All</button>
              )}
            </span>
            {team && (
              <select className="ph-picker" value={viewSel} onChange={e=>setViewSel(e.target.value)}>
                <option value="">My requests</option>
                {team.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            )}
            {meId && !viewingOther && (
              <button className="btn-primary" onClick={()=>setShow(true)}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Request
              </button>
            )}
          </div>
        </div>

        <AttendanceTabs role={role} isManager={inbox.length>0 || isMgmt} />

        {/* quota tile — mirrors the Leave balance tile (traffic-light on the 7/month cap).
            Same tile for the viewed person, so the picker switches the WHOLE page. */}
        {(viewingOther || meId) && (() => {
          // Tiles describe the month in view. With "All months" selected that is the
          // current month, which is what the 7-per-month cap is about.
          const tileMonth = monthSel || todayStr().slice(0,7)
          const regs = (viewingOther ? viewedRegs : mine).filter(r => (r.work_date||'').slice(0,7) === tileMonth)
          const applied = regs.filter(r=>r.status!=='cancelled').length
          const approved = regs.filter(r=>r.status==='approved').length
          const waiting = regs.filter(r=>['pending','mgr_approved'].includes(r.status)).length
          const rejected = regs.filter(r=>r.status==='rejected').length
          const usedMonth = (viewingOther ? viewedRegs : mine).filter(r =>
            ['pending','mgr_approved','approved'].includes(r.status) &&
            (r.work_date||'').slice(0,7) === tileMonth).length
          const left = Math.max(0, REG_MONTHLY_CAP - usedMonth)
          const health = left === 0 ? { dot:'#EF4444', text:'#B63A3F', bg:'rgba(239,68,68,0.12)', label:'Limit reached' }
            : left <= 2 ? { dot:'#F59E0B', text:'#BA7D14', bg:'rgba(245,158,11,0.12)', label:'Running low' }
            : { dot:'#10B981', text:'#0F926D', bg:'rgba(16,185,129,0.12)', label:'Available' }
          return (
            <div className="ph-bento lv-bento">
              <Stat label={`${viewingOther ? viewedEmp.full_name + ' · ' : ''}Left${tileMonth === todayStr().slice(0,7) ? ' this month' : ' in ' + MON_SHORT(tileMonth)}`}
                value={<span style={{color:health.text}}>{left}</span>} unit={`/ ${REG_MONTHLY_CAP}`}
                foot={<span className="lv-mini">
                  <span className="lv-mini-bar"><span style={{width:(left/REG_MONTHLY_CAP*100)+'%',background:health.dot}} /></span>
                  {health.label}
                </span>} />
              <Stat label="Applied" value={applied} foot={monthLabel(tileMonth)} />
              <Stat label="Approved" value={approved} foot="accepted by HR" />
              <Stat label="Awaiting" value={waiting} warn={waiting>0} foot={waiting>0 ? 'in the queue' : 'nothing pending'} />
              <Stat label="Rejected" value={rejected} foot={rejected>0 ? 'not accepted' : 'none'} />
            </div>
          )
        })()}

        {/* person view — the picked employee's full regularization record */}
        {viewingOther && (
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-eyebrow">{viewedEmp.department||'—'}</div>
                <div className="card-title" style={{display:'inline-flex',alignItems:'center',gap:9}}>
                  <PeopleAvatar name={viewedEmp.full_name} className="avatar" style={{width:26,height:26,fontSize:10,flexShrink:0}} />
                  {viewedEmp.full_name} — regularization ledger
                </div>
              </div>
              <span className="trend-pill mono">{viewedRegs.filter(inMonth).length}</span>
            </div>
            {viewedRegs.filter(inMonth).length===0 ? <div className="o-empty">No regularization requests{monthSel ? ` in ${monthLabel(monthSel)}` : ''}.</div> : viewedRegs.filter(inMonth).map(r => { const s=ST[r.status]||ST.pending; return (
              <div key={r.id} className="lv-req" style={{gridTemplateColumns:'minmax(0,1fr) auto',opacity:r.status==='cancelled'?0.55:1}}>
                <div className="lv-req-b">
                  <div className="lv-req-n">{fmtD(r.work_date)} · <span className="mono">{timeRange(r)}</span></div>
                  <div className="lv-req-s">{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div>
                  <Swipes r={r} />
                </div>
                <div className="lv-req-a"><span className="ol-status-pill" style={{ '--stage-color': s.dot }}><span className="ol-status-dot" />{s.l}</span></div>
              </div>
            )})}
          </div>
        )}

        {/* Approvals, two cards (matches Leave): "for you" = your current-step items;
            admins also see "Waiting on other approvers" with who owns each, can step in. */}
        {!viewingOther && inbox.length > 0 && (() => {
          const forMe = inbox.filter(r =>
            (r.status === 'pending' && r.emp?.reporting_manager_id === meId) ||
            (r.status === 'mgr_approved' && meId === hrId))
          const others = isMgmt ? inbox.filter(r => !forMe.includes(r)) : []
          const rmName = id => (team || []).find(e => e.id === id)?.full_name || 'their manager'
          const row = (r, showWaiting) => {
            const iAmMgr = r.emp?.reporting_manager_id === meId, iAmHr = meId === hrId
            const canMgr = r.status==='pending' && (iAmMgr || isMgmt)
            const canHr  = r.status==='mgr_approved' && (iAmHr || isMgmt)
            const s = ST[r.status]
            return (
              <div key={r.id} className="lv-req">
                <div className="lv-req-b">
                  <div className="lv-req-n">{r.emp?.full_name}</div>
                  <div className="lv-req-s">{fmtD(r.work_date)}{r.reason?` · ${r.reason}`:''}{showWaiting && <> · waiting on <b>{r.status==='pending' ? rmName(r.emp?.reporting_manager_id) : 'HR'}</b></>}</div>
                </div>
                <div className="lv-req-d">
                  <div title="Requested correction">{timeRange(r)}</div>
                  <Swipes r={r} />
                </div>
                <div className="lv-req-a">
                  <span className="ol-status-pill" style={{ '--stage-color': s.dot }}><span className="ol-status-dot" />{s.l}</span>
                  {canMgr && <><button className="btn-primary btn-xs" onClick={()=>decide(r,'mgr',true)}>Approve</button><button className="btn-ghost btn-xs" onClick={()=>decide(r,'mgr',false)}>Reject</button></>}
                  {canHr && <><button className="btn-primary btn-xs" onClick={()=>decide(r,'hr',true)}>HR Approve</button><button className="btn-ghost btn-xs" onClick={()=>decide(r,'hr',false)}>Reject</button></>}
                </div>
              </div>
            )
          }
          return (
            <>
              {forMe.length > 0 && (
                <div className="card" style={{marginTop:16}}>
                  <div className="card-head">
                    <div><div className="card-eyebrow">Waiting on you</div><div className="card-title">Approvals</div></div>
                    <span className="trend-pill mono">{forMe.length}</span>
                  </div>
                  {forMe.map(r => row(r, false))}
                </div>
              )}
              {others.length > 0 && (
                <div className="card" style={{marginTop:16}}>
                  <div className="card-head">
                    <div><div className="card-eyebrow">Admin view — step in only if needed</div><div className="card-title">Waiting on Other Approvers</div></div>
                    <span className="trend-pill mono">{others.length}</span>
                  </div>
                  {others.map(r => row(r, true))}
                </div>
              )}
            </>
          )
        })()}

        {!viewingOther && (
          <div className="card" style={{marginTop:16}}>
            <div className="card-head">
              <div><div className="card-eyebrow">Your history</div><div className="card-title">My Requests</div></div>
              <span className="trend-pill mono">{mine.filter(inMonth).length}</span>
            </div>
            {mine.filter(inMonth).length===0 ? <div className="o-empty">No regularization requests{monthSel ? ` in ${monthLabel(monthSel)}` : ' yet'}.</div> : mine.filter(inMonth).map(r => { const s=ST[r.status]; return (
              <div key={r.id} className="lv-req" style={{gridTemplateColumns:'minmax(0,1fr) auto'}}>
                <div className="lv-req-b">
                  <div className="lv-req-n">{fmtD(r.work_date)} · <span className="mono">{timeRange(r)}</span></div>
                  <div className="lv-req-s">{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div>
                  <Swipes r={r} />
                </div>
                <div className="lv-req-a">
                  <span className="ol-status-pill" style={{ '--stage-color': s.dot }}><span className="ol-status-dot" />{s.l}</span>
                  {['pending','mgr_approved'].includes(r.status) && <button className="btn-ghost btn-xs" onClick={()=>cancelMine(r)}>Cancel</button>}
                </div>
              </div>
            )})}
          </div>
        )}

        {/* team regularization ledger — admin/management + HR; badge shows what's not approved */}
        {teamRegs && !viewingOther && (() => {
          const PAGE = 50
          // Page the FILTERED rows: paging the unfiltered list would show "50 of 100"
          // while rendering three, and page 2 could come back empty.
          const shown = teamRegs.filter(inMonth)
          const pages = Math.max(1, Math.ceil(shown.length / PAGE))
          const page = Math.min(regPage, pages)
          const slice = shown.slice((page-1)*PAGE, page*PAGE)
          return (
          <div className="card" style={{marginTop:16}}>
            <div className="card-head">
              <div>
                <div className="card-eyebrow">{shown.filter(r=>['pending','mgr_approved'].includes(r.status)).length} awaiting approval{monthSel ? ` · ${monthLabel(monthSel)}` : ''}</div>
                <div className="card-title">Team Regularizations</div>
              </div>
              <span className="trend-pill mono">{shown.length}</span>
            </div>
            {shown.length===0 ? <div className="o-empty">No regularizations{monthSel ? ` in ${monthLabel(monthSel)}` : ' yet'}.</div> : (
              <div className="ph-tbl-wrap">
                <table className="ph-tbl">
                  <thead><tr><th>Employee</th><th>Requested</th><th>Swiped</th><th>Reason</th><th className="r">Status</th></tr></thead>
                  <tbody>{slice.map(r => { const s=ST[r.status]||ST.pending; return (
                    <tr key={r.id} onClick={()=>setViewSel(r.employee_id)} title="Open this person's record"
                      style={{cursor:'pointer',opacity:r.status==='cancelled'?0.55:1}}>
                      <td>
                        <div className="lv-emp">
                          <PeopleAvatar name={r.emp?.full_name||'—'} className="avatar" style={{width:30,height:30,fontSize:11,flexShrink:0}} />
                          <div style={{minWidth:0}}>
                            <div className="lv-emp-n">{r.emp?.full_name||'—'}</div>
                            <div className="lv-emp-d">{fmtD(r.work_date)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="m">{timeRange(r)}</td>
                      <td className="ph-swipes">{(() => {
                        const sw = swipesBy[`${r.employee_id}|${r.work_date}`]
                        if (sw === undefined) return <span className="ph-noswipe">—</span>
                        if (!sw.length) return <span className="ph-noswipe">no punches</span>
                        return sw.map((t,i) => <span key={i} className="ph-swipe">{fmtTime(t)}</span>)
                      })()}</td>
                      <td className="lv-reason">{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</td>
                      <td className="r"><span className="ol-status-pill" style={{ '--stage-color': s.dot }}><span className="ol-status-dot" />{s.l}</span></td>
                    </tr>
                  )})}</tbody>
                </table>
              </div>
            )}
            <PeoplePager page={page} setPage={setRegPage} total={shown.length} pageSize={PAGE} />
          </div>
          )
        })()}
      </div>

      {show && (
        <Drawer title="Regularize a day" sub="Correct one punch — in-time or out-time — for a missed or wrong entry" onClose={()=>setShow(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShow(false)}>Cancel</button><button className="pd-btn primary" onClick={apply}>Send request</button></>}>
          <div className="pd-f"><label>Date to fix <span style={{color:'var(--muted)',fontWeight:400}}>(within 48 hours)</span></label><input type="date" value={form.work_date} min={minRegDate()} max={todayStr()} onChange={e=>setForm({...form,work_date:e.target.value})} /></div>
          {daySwipes && (
            <div style={{fontSize:12,color:'var(--muted)',background:'var(--bg-2)',border:'1px solid var(--line-2)',borderRadius:8,padding:'8px 12px',lineHeight:1.6}}>
              <b style={{color:'var(--ink)'}}>Recorded swipes that day:</b>{' '}
              {daySwipes.length === 0 ? 'none — no punches recorded.' :
                daySwipes.map((p,i) => <span key={i} className="mono" style={{marginRight:8,color:'var(--ink)'}}>{fmtTime(p.punch_at)}</span>)}
            </div>
          )}
          <div className="pd-f"><label>What to correct</label>
            <div className="reg-seg">
              {[['in','In-time','forgot_in'],['out','Out-time','forgot_out']].map(([s,lbl,rt])=>(
                <button key={s} type="button" className={'reg-seg-b'+(form.side===s?' on':'')}
                  onClick={()=>setForm(f=>({...f, side:s, reason_type: (f.reason_type==='forgot_in'||f.reason_type==='forgot_out')?rt:f.reason_type}))}>{lbl}</button>
              ))}
            </div>
          </div>
          {form.side==='in'
            ? <div className="pd-f"><label>Correct in-time</label><input type="time" value={form.requested_in} onChange={e=>setForm({...form,requested_in:e.target.value})} /></div>
            : <div className="pd-f"><label>Correct out-time</label><input type="time" value={form.requested_out} onChange={e=>setForm({...form,requested_out:e.target.value})} /></div>}
          <div className="pd-f"><label>Reason</label>
            <select value={form.reason_type} onChange={e=>setForm({...form,reason_type:e.target.value})}>
              {REG_REASONS.map(r=><option key={r.k} value={r.k}>{r.l}</option>)}
            </select>
          </div>
          <div className="pd-f"><label>Note {form.reason_type==='other'?'':<span style={{color:'var(--muted)',fontWeight:400}}>(optional)</span>}</label>
            <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder={form.reason_type==='other'?'Explain properly — minimum 7 words':'Add any detail (optional)'} /></div>
          <div style={{fontSize:12,color:'var(--muted)'}}>On approval, a correction punch is added <b>alongside</b> the original record — nothing is overwritten. Sent to your manager, then HR for final approval.</div>
          <div style={{fontSize:12,color:usedThisMonth>=REG_MONTHLY_CAP?'var(--st-absent)':'var(--muted)'}}>
            <b>{usedThisMonth}</b> of <b>{REG_MONTHLY_CAP}</b> regularizations used this month · allowed within 48 hours of the day.
          </div>
        </Drawer>
      )}
    </Layout>
  )
}
