import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { currentFyLabel } from '../lib/kpi'
import { isWeekOff } from '../lib/attendance'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import LeavePolicyDrawer from '../components/LeavePolicyDrawer'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const ymd = d => new Date(d).toLocaleDateString('en-CA')
const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'
// Going-forward leave auto-deduction starts here; anything earlier is already in the seeded baseline (no double-count).
const LEAVE_DEDUCT_FROM = '2026-08-01'
const ST = {
  pending:{l:'Pending manager',c:'#C25A00',b:'rgba(226,101,0,0.12)'},
  mgr_approved:{l:'Pending HR',c:'#0369a1',b:'rgba(3,105,161,0.10)'},
  approved:{l:'Approved',c:'#256F3A',b:'rgba(37,111,58,0.10)'},
  rejected:{l:'Rejected',c:'#BB0000',b:'rgba(187,0,0,0.08)'},
  cancelled:{l:'Cancelled',c:'#8C99A8',b:'rgba(140,153,168,0.12)'},
}
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
  const [fwdUsed, setFwdUsed] = useState(0)   // half-days×0.5 + leaves since LEAVE_DEDUCT_FROM
  const [mine, setMine] = useState([])
  const [inbox, setInbox] = useState([])
  const [holidays, setHolidays] = useState(new Set())
  const [show, setShow] = useState(false)
  const [policy, setPolicy] = useState(false)
  const [form, setForm] = useState({ from:'', to:'', is_half:false, half_period:'first', reason:'' })
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
    await load(me?.id, prof?.role)
    setLoading(false)
  }

  async function load(myId, r) {
    const [cfg, hol, bl, mn, ib, ad] = await Promise.all([
      sb.from('attendance_config').select('hr_approver_employee_id').maybeSingle(),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      myId ? sb.from('leave_balances').select('*').eq('employee_id', myId).eq('fy_label', currentFyLabel()).maybeSingle() : Promise.resolve({data:null}),
      myId ? sb.from('leave_requests').select('*').eq('employee_id', myId).order('created_at',{ascending:false}) : Promise.resolve({data:[]}),
      // inbox: pending/mgr_approved requests I'm allowed to see (RLS: reports + admin/mgmt) with requester info
      sb.from('leave_requests').select('*, emp:employees!leave_requests_employee_id_fkey(full_name,designation,reporting_manager_id)').in('status',['pending','mgr_approved']).order('created_at'),
      // going-forward consumption from the muster: half-days (0.5) + leave days (1) since the cutoff
      myId ? sb.from('attendance_days').select('status').eq('employee_id', myId).gte('work_date', LEAVE_DEDUCT_FROM).in('status',['half_day','leave']) : Promise.resolve({data:[]}),
    ])
    setHrId(cfg?.data?.hr_approver_employee_id || null)
    setHolidays(new Set((hol?.data||[]).map(h=>h.holiday_date)))
    setBal(bl?.data || null); setMine(mn?.data || [])
    setFwdUsed((ad?.data||[]).reduce((s,r)=> s + (r.status==='leave' ? 1 : 0.5), 0))
    // exclude my own from the approvals inbox
    setInbox((ib?.data||[]).filter(x => x.employee_id !== myId))
  }

  const balNum = bal ? Number(bal.credited)+Number(bal.carried_forward)-Number(bal.used)-Number(bal.encashed)-fwdUsed : null
  const days = useMemo(() => form.from && form.to ? leaveDays(form.from, form.to, form.is_half, holidays) : 0, [form, holidays])

  async function apply() {
    if (guard.current) return
    if (!form.from || !form.to) { toast('Pick dates.', 'error'); return }
    if (form.to < form.from) { toast('End date is before start.', 'error'); return }
    if (days <= 0) { toast('No working days in that range.', 'error'); return }
    if (balNum != null && days > balNum) { toast(`Only ${balNum} leave left — this will run into LOP.`, 'error') }
    guard.current = true
    try {
      const { error } = await sb.from('leave_requests').insert({ employee_id: meId, from_date: form.from, to_date: form.to, days, is_half_day: form.is_half, half_period: form.is_half?form.half_period:null, reason: form.reason.trim()||null })
      if (error) throw error
      toast('Leave applied — sent to your manager.', 'success')
      setShow(false); setForm({ from:'', to:'', is_half:false, half_period:'first', reason:'' })
      await load(meId, role)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function decide(req, step, approve) {
    let note = null
    if (!approve) { note = window.prompt('Reason for rejection (optional):') ?? null }
    try {
      const { error } = await sb.rpc('leave_decide', { p_id: req.id, p_step: step, p_approve: approve, p_note: note })
      if (error) throw error
      toast(approve ? (step==='hr'?'Approved.':'Sent to HR.') : 'Rejected.', 'success')
      await load(meId, role)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  async function cancelMine(req) {
    if (!window.confirm('Cancel this leave request?')) return
    try { await sb.from('leave_requests').update({ status:'cancelled' }).eq('id', req.id); toast('Cancelled.','success'); await load(meId, role) }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
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
            <div className="ph-sub">FY {currentFyLabel()} · single pool (PL/SL/CL)</div>
          </div>
          {meId && <button className="btn btn-primary" onClick={()=>setShow(true)}>+ Apply Leave</button>}
        </div>

        <AttendanceTabs role={role} isManager={inbox.length>0 || isMgmt} />

        {/* leave balance — single KPI tile */}
        {(() => {
          const credited = bal ? Number(bal.credited)+Number(bal.carried_forward) : 25
          const used = bal ? Number(bal.used) : 0
          const carried = bal ? Number(bal.carried_forward) : 0
          const lop = bal ? Number(bal.lop_days||0) : 0
          const pct = credited>0 && balNum!=null ? Math.max(0,Math.min(100, Math.round((balNum/credited)*100))) : 0
          return (
            <div className="acard" style={{marginBottom:14,padding:'18px 20px',display:'flex',alignItems:'flex-start',gap:16,flexWrap:'wrap'}}>
              <span style={{width:44,height:44,borderRadius:12,background:'var(--accent-soft)',color:'var(--accent)',display:'grid',placeItems:'center',flexShrink:0}}>
                <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7Z"/><path d="M10 10v5a2 2 0 0 0 3.4 1.4"/></svg>
              </span>
              <div style={{flex:1,minWidth:220}}>
                <div className="lv-tile-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
                  <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.04em',textTransform:'uppercase',color:'var(--muted)'}}>Leave balance · FY {currentFyLabel()}</div>
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
                <div style={{fontSize:30,fontWeight:600,letterSpacing:'-0.025em',lineHeight:1,marginTop:6,fontFamily:"'Geist Mono',monospace"}}>{balNum ?? '—'}<small style={{fontSize:14,color:'var(--muted-2)',fontWeight:500,fontFamily:"'Geist',sans-serif"}}> / {credited} left</small></div>
                <div style={{height:7,borderRadius:5,background:'var(--bg)',overflow:'hidden',marginTop:12,maxWidth:420}}><div style={{height:'100%',width:pct+'%',background:'var(--accent)',borderRadius:5}} /></div>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginTop:9}}>
                  <div style={{fontSize:11.5,color:'var(--muted)'}}><b style={{color:'var(--ink)'}}>{used}</b> used · <b style={{color:'var(--ink)'}}>{carried}</b> carried forward · <b style={{color:'var(--ink)'}}>{bal?Number(bal.credited):0}</b> credited{fwdUsed>0 && <> · <b style={{color:'var(--ink)'}}>{fwdUsed}</b> since Aug (half-days &amp; leave)</>}</div>
                  {lop>0 && <span title="Loss of Pay — unpaid days deducted from salary. Separate from your paid leave." style={{fontSize:11,fontWeight:600,color:'var(--st-absent)',background:'#FCEBEB',borderRadius:6,padding:'3px 8px',fontFamily:"'Geist Mono',monospace"}}>{lop} LOP · unpaid</span>}
                </div>
              </div>
            </div>
          )
        })()}

        {/* approvals inbox */}
        {inbox.length > 0 && (
          <div className="att-card" style={{marginBottom:14}}>
            <div className="att-card-h"><span className="att-card-t">Approvals · {inbox.length}</span></div>
            {inbox.map(r => {
              const iAmMgr = r.emp?.reporting_manager_id === meId, iAmHr = meId === hrId
              const canMgr = r.status==='pending' && (iAmMgr || isMgmt)
              const canHr  = r.status==='mgr_approved' && (iAmHr || isMgmt)
              const s = ST[r.status]
              return (
                <div key={r.id} className="lv-row" style={{display:'grid',gridTemplateColumns:'1.4fr 1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
                  <div><div style={{fontWeight:600,fontSize:13.5}}>{r.emp?.full_name}</div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}</div></div>
                  <div style={{fontSize:12.5}}>{fmtD(r.from_date)} → {fmtD(r.to_date)} · <b>{r.days}d</b>{r.is_half_day?' (half)':''}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center',justifyContent:'flex-end'}}>
                    <span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>
                    {canMgr && <><button className="btn btn-ghost btn-sm" onClick={()=>decide(r,'mgr',true)}>Approve</button><button className="btn btn-neutral btn-sm" onClick={()=>decide(r,'mgr',false)}>✕</button></>}
                    {canHr && <><button className="btn btn-ghost btn-sm" onClick={()=>decide(r,'hr',true)}>HR Approve</button><button className="btn btn-neutral btn-sm" onClick={()=>decide(r,'hr',false)}>✕</button></>}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* my requests */}
        <div className="att-card">
          <div className="att-card-h"><span className="att-card-t">My requests</span></div>
          {mine.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No leave requests yet.</div> : mine.map(r => { const s=ST[r.status]; return (
            <div key={r.id} className="lv-row" style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div><div style={{fontSize:13.5,fontWeight:600}}>{fmtD(r.from_date)} → {fmtD(r.to_date)} · {r.days}d{r.is_half_day?' (half)':''}</div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div></div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}><span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>{['pending','mgr_approved'].includes(r.status) && <button className="btn btn-neutral btn-sm" onClick={()=>cancelMine(r)}>Cancel</button>}</div>
            </div>
          )})}
        </div>
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
          <div className="pd-f"><label>Reason</label><input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="optional" /></div>
          <div style={{fontSize:12,color:'var(--muted)'}}>Working days: <b>{days}</b> (weekends &amp; holidays excluded). Goes to your manager, then Ankit (HR).</div>
        </Drawer>
      )}

      <LeavePolicyDrawer open={policy} onClose={()=>setPolicy(false)} />
    </Layout>
  )
}
