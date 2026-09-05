import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { currentFyLabel } from '../lib/kpi'
import { isWeekOff, istYmd, loadWeekOffOverrides, REQ_ST } from '../lib/attendance'
import { buildLedger, sandwichDays, fyStart, fyEnd } from '../lib/leaveLedger.js'
import LedgerCard, { fetchLedgerInputs } from '../components/LeaveLedger'
import PeoplePager from '../components/PeoplePager'
import { fetchAll } from '../lib/fetchAll'
import { visibleEmployees } from '../lib/peopleScope'
import Layout from '../components/Layout'
import PeopleAvatar from '../components/PeopleAvatar'
import AttendanceTabs from '../components/AttendanceTabs'
import LeavePolicyDrawer from '../components/LeavePolicyDrawer'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const ymd = istYmd   // IST work date — never the viewer's timezone
const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'
// All leave maths (cutover window, half-day charging, sandwich rule) lives in
// src/lib/leaveLedger.js — ONE formula for the tile, the ledger and the team table.
const ST = REQ_ST   // one request-status palette for the whole suite (lib/attendance.js)
// Fixed leave reasons (user rule 2026-09-03) — "Other" needs a real explanation,
// minimum 7 words, same bar as the below-₹8,000 order rule.
const LEAVE_REASONS = [
  { k:'personal', l:'Personal work' },
  { k:'sick',     l:'Sick / medical' },
  { k:'family',   l:'Family function / event' },
  { k:'travel',   l:'Travel / out of station' },
  { k:'festival', l:'Festival / religious' },
  { k:'other',    l:'Other reason' },
]
const LEAVE_REASON_LABEL = Object.fromEntries(LEAVE_REASONS.map(r => [r.k, r.l]))
// "29 Aug 2026" for one day, "29 Aug – 2 Sep 2026" for a range — never "x → x"
const fmtRange = (from, to) => from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`
function leaveDays(from, to, half, holidays) {
  if (half) return 0.5
  let d=new Date(from), e=new Date(to), n=0
  while(d<=e){ if(!isWeekOff(d) && !holidays.has(ymd(d))) n++; d.setDate(d.getDate()+1) }
  return n
}
function Drawer({title,sub,onClose,children,footer}){return createPortal(<><div className="people-drawer-scrim" onClick={onClose}/><div className="people-drawer"><div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub&&<div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div><div className="pd-b">{children}</div>{footer&&<div className="pd-foot">{footer}</div>}</div></>,document.body)}

export default function PeopleLeave() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('')
  const [meId, setMeId] = useState(null)
  const [hrId, setHrId] = useState(null)
  const [bal, setBal] = useState(null)
  const [selfInputs, setSelfInputs] = useState(null)  // my raw ledger inputs (bal/requests/attDays)
  const [team, setTeam] = useState(null)              // admin/mgmt/HR bulk data for the team view
  const [teamSel, setTeamSel] = useState('')
  const [teamPage, setTeamPage] = useState(1)
  const [mine, setMine] = useState([])
  const [inbox, setInbox] = useState([])
  const [holidays, setHolidays] = useState(new Set())
  const [show, setShow] = useState(false)
  const [policy, setPolicy] = useState(false)
  const [form, setForm] = useState({ from:'', to:'', is_half:false, half_period:'first', reason_type:'personal', reason:'' })
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
    await loadWeekOffOverrides(sb)   // swapped week-offs (22/29 Aug) before any leave-day maths
    await load(me?.id, prof?.role)
    setLoading(false)
  }

  async function load(myId, r) {
    const [cfg, hol, mn, ib, inputs] = await Promise.all([
      sb.from('attendance_config').select('hr_approver_employee_id').maybeSingle(),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      myId ? sb.from('leave_requests').select('*').eq('employee_id', myId).order('created_at',{ascending:false}) : Promise.resolve({data:[]}),
      // inbox: pending/mgr_approved requests I'm allowed to see (RLS: reports + admin/mgmt) with requester info
      sb.from('leave_requests').select('*, emp:employees!leave_requests_employee_id_fkey(full_name,designation,reporting_manager_id)').in('status',['pending','mgr_approved']).order('created_at'),
      // Raw inputs for buildLedger — the ONE leave formula (half-days, HR marks, sandwich).
      myId ? fetchLedgerInputs(sb, myId, currentFyLabel()) : Promise.resolve(null),
    ])
    const hrEmp = cfg?.data?.hr_approver_employee_id || null
    setHrId(hrEmp)
    setHolidays(new Set((hol?.data||[]).map(h=>h.holiday_date)))
    setBal(inputs?.bal || null); setMine(mn?.data || [])
    if (inputs?.error) toast('Could not load the full leave record — figures may be incomplete.', 'error')
    setSelfInputs(inputs)
    // exclude my own from the approvals inbox
    setInbox((ib?.data||[]).filter(x => x.employee_id !== myId))
    // team view + person picker: ADMIN/MANAGEMENT ONLY (user rule 2026-09-03 — everyone
    // else sees only their own leave; the HR approver still gets the approvals inbox)
    if (['admin','management'].includes(r)) loadTeam(r)
  }

  // Bulk inputs for every employee, pushed through the same buildLedger — never a second formula.
  async function loadTeam(r) {
    try {
      const [empRes, balRes, reqRes, attRes] = await Promise.all([
        visibleEmployees('requests'),   // who this user may pick — decided in the DB
        fetchAll((f,t) => sb.from('leave_balances').select('*').eq('fy_label', currentFyLabel()).order('employee_id').range(f,t)),
        fetchAll((f,t) => sb.from('leave_requests').select('employee_id,from_date,to_date,days,is_half_day,half_period,reason,status').in('status',['approved','pending','mgr_approved','rejected']).gte('from_date', fyStart()).lte('from_date', fyEnd()).order('from_date').order('id').range(f,t)),
        // a month of team attendance rows already exceeds the 1000-row cap — must page
        fetchAll((f,t) => sb.from('attendance_days').select('employee_id,work_date,status,source,source_code,first_in,is_lop').gte('work_date', fyStart()).lte('work_date', fyEnd()).in('status',['half_day','leave','absent']).order('work_date').order('id').range(f,t)),
      ])
      const list = empRes.data || []
      const err = empRes.error || balRes.error || reqRes.error || attRes.error
      if (err) toast('Team leave data loaded partially — some figures may be missing.', 'error')
      setTeam({ emps: list, bals: balRes.data || [], reqs: reqRes.data || [], atts: attRes.data || [] })
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); setTeam({ emps: [], bals: [], reqs: [], atts: [] }) }
  }

  // Off-day judge for the ledger/sandwich maths — holidays table + week-off rule (overrides loaded in init)
  const isOffDay = useMemo(() => d => holidays.has(d) ? 'holiday' : (isWeekOff(d) ? 'weekoff' : null), [holidays])
  const myLedger = useMemo(() => selfInputs
    ? buildLedger({ bal: selfInputs.bal, requests: selfInputs.requests, attDays: selfInputs.attDays, isOffDay })
    : null, [selfInputs, isOffDay])
  // Tile shows a number only when HR has seeded a balance row (old behaviour) —
  // the ledger card still lists movements either way.
  const balNum = (meId && myLedger && !myLedger.noBalance) ? myLedger.closing : null
  const teamRows = useMemo(() => {
    if (!team) return null
    const balBy = {}; team.bals.forEach(b => { balBy[b.employee_id] = b })
    const group = (arr) => { const m = {}; arr.forEach(x => { (m[x.employee_id] ||= []).push(x) }); return m }
    const reqBy = group(team.reqs), attBy = group(team.atts)
    return team.emps.map(e => ({ emp: e, bal: balBy[e.id] || null, ledger: buildLedger({ bal: balBy[e.id] || null, requests: reqBy[e.id] || [], attDays: attBy[e.id] || [], isOffDay }) }))
  }, [team, isOffDay])
  // Whole-page person switch (My Attendance pattern): picking a name in the header shows
  // THAT person's balance tile + ledger; empty selection = me.
  const viewed = teamSel ? (teamRows || []).find(x => x.emp.id === teamSel) : null
  const viewingOther = !!viewed && teamSel !== meId
  const viewLedger = viewed ? viewed.ledger : myLedger
  const viewBal = viewed ? viewed.bal : bal
  const viewBalNum = viewLedger && !viewLedger.noBalance ? viewLedger.closing : null
  const days = useMemo(() => form.from && form.to ? leaveDays(form.from, form.to, form.is_half, holidays) : 0, [form, holidays])
  // Sandwich rule preview: off days this draft would newly debit (leave on both flanks of an off block)
  const sandwichPrev = useMemo(() => {
    if (!form.from || !form.to || !selfInputs) return []
    const approved = selfInputs.requests || []
    const already = new Set(sandwichDays(approved, isOffDay).map(s => s.date))
    const draft = { from_date: form.from, to_date: form.to, is_half_day: form.is_half, half_period: form.is_half ? form.half_period : null }
    return sandwichDays([...approved, draft], isOffDay).filter(s => !already.has(s.date))
  }, [form, selfInputs, isOffDay])

  async function apply() {
    if (guard.current) return
    if (!form.from || !form.to) { toast('Pick dates.', 'error'); return }
    if (form.to < form.from) { toast('End date is before start.', 'error'); return }
    if (days <= 0) { toast('No working days in that range.', 'error'); return }
    // "Other reason" is held to the same bar as a below-₹8,000 order: minimum 7 words.
    if (form.reason_type === 'other') {
      const words = form.reason.trim().split(/\s+/).filter(Boolean)
      if (words.length < 7) { toast('"Other reason" needs a proper explanation — minimum 7 words.', 'error'); return }
    }
    // Overlap: an already-live request covering any of these dates would be double-counted
    // against the balance on approval, since leave_decide adds days without checking overlap.
    const clash = mine.find(r => ['pending','mgr_approved','approved'].includes(r.status)
      && r.from_date <= form.to && r.to_date >= form.from)
    if (clash) { toast(`You already have a ${clash.status.replace('_',' ')} request covering ${clash.from_date} to ${clash.to_date}.`, 'error'); return }
    if (form.from < ymd(new Date())) {
      if (!window.confirm(`${form.from} is in the past. Apply anyway?`)) return
    }
    // Over-quota used to warn and submit regardless — the balance would silently go negative.
    // Now it needs an explicit acknowledgement that the excess is unpaid. The sandwich rule's
    // extra off days count toward the total debit here too.
    const totalDebit = days + sandwichPrev.length
    if (balNum != null && totalDebit > balNum) {
      const excess = Math.round((totalDebit - balNum) * 10) / 10
      if (!window.confirm(`You have ${balNum} leave left but this will debit ${totalDebit} day(s)${sandwichPrev.length ? ` (incl. ${sandwichPrev.length} sandwiched off day(s))` : ''}. The extra ${excess} day(s) will be treated as loss of pay. Continue?`)) return
    }
    guard.current = true
    try {
      const reasonText = [LEAVE_REASON_LABEL[form.reason_type], form.reason.trim()].filter(Boolean).join(' — ')
      const { error } = await sb.from('leave_requests').insert({ employee_id: meId, from_date: form.from, to_date: form.to, days, is_half_day: form.is_half, half_period: form.is_half?form.half_period:null, reason: reasonText })
      if (error) throw error
      toast('Leave applied — sent to your manager.', 'success')
      setShow(false); setForm({ from:'', to:'', is_half:false, half_period:'first', reason_type:'personal', reason:'' })
      await load(meId, role)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function decide(req, step, approve) {
    // Guarded: leave_decide adds r.days to leave_balances.used, so a double-click
    // deducts the leave twice.
    if (guard.current) return
    let note = null
    if (!approve) {
      // A rejection must carry a reason — the person needs to know why (user rule 2026-09-03)
      note = (window.prompt('Reason for rejection (required):') || '').trim()
      if (!note) { toast('Rejection needs a reason — tell the person why.', 'error'); return }
    }
    guard.current = true
    try {
      const { error } = await sb.rpc('leave_decide', { p_id: req.id, p_step: step, p_approve: approve, p_note: note })
      if (error) throw error
      toast(approve ? (step==='hr'?'Approved.':'Sent to HR.') : 'Rejected.', 'success')
      await load(meId, role)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function cancelMine(req) {
    if (!window.confirm('Cancel this leave request?')) return
    if (guard.current) return
    guard.current = true
    try {
      // .select() is what makes this honest: an RLS denial returns zero rows and NO error,
      // so the old code reported "Cancelled." while the row was untouched.
      const { data, error } = await sb.from('leave_requests').update({ status:'cancelled' }).eq('id', req.id).select('id')
      if (error) throw error
      if (!data?.length) throw new Error('Could not cancel — the request may already be approved, or you may not have permission.')
      toast('Cancelled.','success'); await load(meId, role)
    }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Leave"><div className="people-app"><Spinner /></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Leave">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people/attendance')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Attendance
            </button>
            <h1 className="ph-title">Leave</h1>
            <div className="ph-sub">Financial year {currentFyLabel()} · one combined leave pool</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            {teamRows && <div className="f-sel"><select value={teamSel} onChange={e=>setTeamSel(e.target.value)}>
              <option value="">My leave</option>
              {teamRows.map(t=><option key={t.emp.id} value={t.emp.id}>{t.emp.full_name}</option>)}
            </select></div>}
            {meId && !viewingOther && <button className="btn btn-primary" onClick={()=>setShow(true)}>+ Apply Leave</button>}
          </div>
        </div>

        <AttendanceTabs role={role} isManager={inbox.length>0 || isMgmt} />

        {/* leave balance — single KPI tile */}
        {(() => {
          const credited = viewBal ? Number(viewBal.credited)+Number(viewBal.carried_forward) : 25
          const used = viewBal ? Number(viewBal.used) : 0
          const carried = viewBal ? Number(viewBal.carried_forward) : 0
          const lop = viewBal ? Number(viewBal.lop_days||0) : 0
          const pct = credited>0 && viewBalNum!=null ? Math.max(0,Math.min(100, Math.round((viewBalNum/credited)*100))) : 0
          // Traffic-light health (orders palette): ≤20% left = red, ≤50% = amber, else green
          const health = viewBalNum == null ? { dot:'var(--accent)', text:'var(--ink)', bg:'var(--accent-soft)', label:null }
            : pct <= 20 ? { dot:'#EF4444', text:'#B63A3F', bg:'rgba(239,68,68,0.12)', label:'Low balance' }
            : pct <= 50 ? { dot:'#F59E0B', text:'#BA7D14', bg:'rgba(245,158,11,0.12)', label:'Running low' }
            : { dot:'#10B981', text:'#0F926D', bg:'rgba(16,185,129,0.12)', label:'Healthy' }
          return (
            <div className="acard" style={{marginBottom:14,padding:'18px 20px',display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap',borderLeft:`3px solid ${health.dot}`}}>
              <span style={{width:44,height:44,borderRadius:12,background:health.bg,color:health.text,display:'grid',placeItems:'center',flexShrink:0}}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="m9 15.5 2 2 4-4"/></svg>
              </span>
              <div style={{flex:1,minWidth:220}}>
                <div className="lv-tile-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <div style={{fontSize:10,fontWeight:500,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--muted)'}}>{viewingOther ? `${viewed.emp.full_name} · ` : ''}Leave balance · FY {currentFyLabel()}</div>
                  <div style={{display:'inline-flex',alignItems:'center',gap:12,flexShrink:0}}>
                    <button onClick={()=>setPolicy(true)} style={{background:'none',border:0,cursor:'pointer',color:'var(--accent)',fontSize:11.5,fontWeight:500,display:'inline-flex',alignItems:'center',gap:4,padding:0}}>
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
                      How leave &amp; LOP work
                    </button>
                    <button onClick={()=>navigate('/people/handbook')} style={{background:'none',border:0,cursor:'pointer',color:'var(--accent)',fontSize:11.5,fontWeight:500,display:'inline-flex',alignItems:'center',gap:4,padding:0}} title="Employee Handbook">
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h9a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4z" strokeLinejoin="round"/><path d="M4 4v11"/></svg>
                      Handbook
                    </button>
                  </div>
                </div>
                <div style={{display:'flex',alignItems:'baseline',gap:10,marginTop:6,flexWrap:'wrap'}}>
                  <div style={{fontSize:30,fontWeight:600,letterSpacing:'-0.025em',lineHeight:1,fontFamily:"'Geist Mono',monospace",color:health.text}}>{viewBalNum ?? '—'}<small style={{fontSize:14,color:'var(--muted-2)',fontWeight:500,fontFamily:"'Geist',sans-serif"}}> / {credited} left</small></div>
                  {health.label && <span className="att-badge" style={{color:health.text,background:health.bg}}><span style={{width:6,height:6,borderRadius:99,background:health.dot,display:'inline-block'}} />{health.label}</span>}
                </div>
                <div style={{height:7,borderRadius:5,background:'var(--bg)',overflow:'hidden',marginTop:12,maxWidth:420}}><div style={{height:'100%',width:pct+'%',background:health.dot,borderRadius:5}} /></div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:9}}>
                  <div style={{fontSize:11.5,color:'var(--muted)'}}><b style={{color:'var(--ink)'}}>{used}</b> used · <b style={{color:'var(--ink)'}}>{carried}</b> carried forward · <b style={{color:'var(--ink)'}}>{viewBal?Number(viewBal.credited):0}</b> credited{viewLedger?.totals.extras>0 && <> · <b style={{color:'var(--ink)'}}>{viewLedger.totals.extras}</b> policy deductions since Aug</>}</div>
                  {lop>0 && <span title="Loss of Pay — unpaid days deducted from salary. Separate from your paid leave." style={{fontSize:11,fontWeight:600,color:'#B63A3F',background:'rgba(239,68,68,0.12)',borderRadius:6,padding:'3px 8px',fontFamily:"'Geist Mono',monospace"}}>{lop} LOP · unpaid</span>}
                </div>
              </div>
            </div>
          )
        })()}

        {/* transaction ledger for whoever the header picker shows — every deduction traceable */}
        {viewLedger && <LedgerCard ledger={viewLedger} fyLabel={currentFyLabel()} title={viewingOther ? `${viewed.emp.full_name} — leave ledger` : 'My leave ledger'} />}

        {/* Approvals, two cards (user-approved layout 2026-09-03):
            1. "Approvals for you" — requests where YOU are the current-step approver.
            2. Admins additionally see "Waiting on other approvers" with WHO each request
               waits on ("waiting on Jaypalsinh…"), and can step in when needed. */}
        {!viewingOther && inbox.length > 0 && (() => {
          const forMe = inbox.filter(r =>
            (r.status === 'pending' && r.emp?.reporting_manager_id === meId) ||
            (r.status === 'mgr_approved' && meId === hrId))
          const others = isMgmt ? inbox.filter(r => !forMe.includes(r)) : []
          const rmName = id => (team?.emps || []).find(e => e.id === id)?.full_name || 'their manager'
          const row = (r, showWaiting) => {
            const iAmMgr = r.emp?.reporting_manager_id === meId, iAmHr = meId === hrId
            const canMgr = r.status==='pending' && (iAmMgr || isMgmt)
            const canHr  = r.status==='mgr_approved' && (iAmHr || isMgmt)
            const s = ST[r.status]
            return (
              <div key={r.id} className="lv-row" style={{display:'grid',gridTemplateColumns:'1.4fr 1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
                <div><div style={{fontWeight:600,fontSize:13.5}}>{r.emp?.full_name}</div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{showWaiting && <> · waiting on <b style={{color:'var(--ink)'}}>{r.status==='pending' ? rmName(r.emp?.reporting_manager_id) : 'HR'}</b></>}</div></div>
                <div style={{fontSize:12.5}}>{fmtRange(r.from_date, r.to_date)} · <b>{r.days}d</b>{r.is_half_day?' (half)':''}</div>
                <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end'}}>
                  <span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>
                  {canMgr && <><button className="btn btn-ghost btn-sm" onClick={()=>decide(r,'mgr',true)}>Approve</button><button className="btn btn-neutral btn-sm" onClick={()=>decide(r,'mgr',false)}>✕</button></>}
                  {canHr && <><button className="btn btn-ghost btn-sm" onClick={()=>decide(r,'hr',true)}>HR Approve</button><button className="btn btn-neutral btn-sm" onClick={()=>decide(r,'hr',false)}>✕</button></>}
                </div>
              </div>
            )
          }
          return (
            <>
              {forMe.length > 0 && (
                <div className="att-card" style={{marginBottom:14}}>
                  <div className="att-card-h"><span className="att-card-t">Approvals for you · {forMe.length}</span></div>
                  {forMe.map(r => row(r, false))}
                </div>
              )}
              {others.length > 0 && (
                <div className="att-card" style={{marginBottom:14}}>
                  <div className="att-card-h">
                    <span className="att-card-t" style={{color:'var(--muted)'}}>Waiting on other approvers · {others.length}</span>
                    <span className="card-sub">admin view — step in only if needed</span>
                  </div>
                  {others.map(r => row(r, true))}
                </div>
              )}
            </>
          )
        })()}

        {/* my requests (hidden while viewing someone else — their ledger holds the record) */}
        {!viewingOther && <div className="att-card">
          <div className="att-card-h"><span className="att-card-t">My requests</span></div>
          {mine.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No leave requests yet.</div> : mine.map(r => { const s=ST[r.status]; return (
            <div key={r.id} className="lv-row" style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div><div style={{fontSize:13.5,fontWeight:600}}>{fmtRange(r.from_date, r.to_date)} · {r.days}d{r.is_half_day?' (half)':''}</div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div></div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}><span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>{['pending','mgr_approved'].includes(r.status) && <button className="btn btn-neutral btn-sm" onClick={()=>cancelMine(r)}>Cancel</button>}</div>
            </div>
          )})}
        </div>}

        {/* team overview — balances at a glance; clicking a row switches the whole page
            to that person (same as picking them in the header) */}
        {teamRows && !viewingOther && (
          <div className="att-card" style={{marginTop:14}}>
            <div className="att-card-h"><span className="att-card-t">Team leave · {teamRows.length}</span><span className="card-sub">click a person for their full record</span></div>
            <div style={{overflowX:'auto'}}>
              <div style={{minWidth:560}}>
                <div className="tbl-h" style={{display:'grid',gridTemplateColumns:'minmax(160px,1.4fr) 70px 70px 84px 70px 56px',gap:10,padding:'8px 0 6px',borderBottom:'1px solid var(--line-2)'}}>
                  <span>Employee</span><span style={{textAlign:'right'}}>Credited</span><span style={{textAlign:'right'}}>Used</span><span style={{textAlign:'right'}}>Policy ded.</span><span style={{textAlign:'right'}}>Balance</span><span style={{textAlign:'right'}}>LOP</span>
                </div>
                {teamRows.slice((Math.min(teamPage, Math.ceil(teamRows.length/50)||1)-1)*50, Math.min(teamPage, Math.ceil(teamRows.length/50)||1)*50).map(({emp:e, ledger:l}) => {
                  const lop = l.rows.filter(x=>x.lop).length
                  return (
                    <div key={e.id} onClick={()=>setTeamSel(e.id)} title="Open full record" style={{display:'grid',gridTemplateColumns:'minmax(160px,1.4fr) 70px 70px 84px 70px 56px',gap:10,alignItems:'center',padding:'8px 0',borderBottom:'1px solid var(--line-2)',cursor:'pointer'}}>
                      <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
                        <PeopleAvatar name={e.full_name} className="avatar" style={{width:30,height:30,fontSize:11,flexShrink:0}} />
                        <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.full_name}</div><div style={{fontSize:11,color:'var(--muted-2)'}}>{e.department||'—'}</div></div>
                      </div>
                      <span style={{textAlign:'right',fontSize:12.5,fontFamily:"'Geist Mono',monospace"}}>{l.opening}</span>
                      <span style={{textAlign:'right',fontSize:12.5,fontFamily:"'Geist Mono',monospace"}}>{l.totals.used}</span>
                      <span style={{textAlign:'right',fontSize:12.5,fontFamily:"'Geist Mono',monospace",color:l.totals.extras>0?'var(--st-half)':'var(--muted-2)'}}>{l.totals.extras||'—'}</span>
                      <span style={{textAlign:'right',fontSize:12.5,fontWeight:600,fontFamily:"'Geist Mono',monospace",color:l.closing<0?'var(--st-absent)':'var(--ink)'}}>{l.closing}</span>
                      <span style={{textAlign:'right',fontSize:12.5,fontFamily:"'Geist Mono',monospace",color:lop>0?'var(--st-absent)':'var(--muted-2)'}}>{lop||'—'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            <PeoplePager page={teamPage} setPage={setTeamPage} total={teamRows.length} />
          </div>
        )}
      </div>

      {show && (
        <Drawer title="Apply Leave" sub={`Balance: ${balNum ?? '—'} / 25`} onClose={()=>setShow(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShow(false)}>Cancel</button><button className="pd-btn primary" onClick={apply}>Apply · {days}d</button></>}>
          <div className="pd-2">
            <div className="pd-f"><label>From</label><input type="date" value={form.from} onChange={e=>setForm({...form,from:e.target.value,to:form.to||e.target.value})} /></div>
            <div className="pd-f"><label>To</label><input type="date" value={form.to} min={form.from} onChange={e=>setForm({...form,to:e.target.value})} /></div>
          </div>
          <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13}}><input type="checkbox" checked={form.is_half} onChange={e=>setForm({...form,is_half:e.target.checked, to:e.target.checked?form.from:form.to})} /> Half day</label>
          {form.is_half && <div className="pd-f"><label>Half</label><select value={form.half_period} onChange={e=>setForm({...form,half_period:e.target.value})}><option value="first">First half</option><option value="second">Second half</option></select></div>}
          <div className="pd-f"><label>Reason <span className="req">*</span></label>
            <select value={form.reason_type} onChange={e=>setForm({...form,reason_type:e.target.value})}>
              {LEAVE_REASONS.map(r=><option key={r.k} value={r.k}>{r.l}</option>)}
            </select>
          </div>
          <div className="pd-f"><label>Note {form.reason_type==='other'?<span className="req">*</span>:<span style={{color:'var(--muted)',fontWeight:400}}>(optional)</span>}</label>
            <input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder={form.reason_type==='other'?'Explain properly — minimum 7 words':'Add any detail (optional)'} /></div>
          {days > 0 && balNum != null && (() => {
            const after = Math.round((balNum - days - sandwichPrev.length) * 10) / 10
            return (
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',background:'var(--bg-2)',border:'1px solid var(--line-2)',borderRadius:8,padding:'9px 12px',fontSize:12.5}}>
                <span style={{color:'var(--muted)'}}>Balance after this leave</span>
                <b className="mono" style={{fontSize:14,color: after < 0 ? '#B63A3F' : after <= 3 ? '#BA7D14' : '#0F926D'}}>{after}</b>
              </div>
            )
          })()}
          <div style={{fontSize:12,color:'var(--muted)'}}>Working days: <b>{days}</b> — weekends and holidays excluded. Sent to your manager, then HR for final approval.</div>
          {sandwichPrev.length > 0 && (
            <div style={{fontSize:12,color:'#BA7D14',background:'rgba(245,158,11,0.12)',borderRadius:8,padding:'8px 12px',lineHeight:1.5}}>
              <b>Sandwich rule:</b> this leave also debits <b>{sandwichPrev.length}</b> off day(s) in between
              ({sandwichPrev.map(s=>fmtD(s.date)).join(', ')}) — total debit <b>{days + sandwichPrev.length}</b> day(s).
            </div>
          )}
        </Drawer>
      )}

      <LeavePolicyDrawer open={policy} onClose={()=>setPolicy(false)} />
    </Layout>
  )
}
