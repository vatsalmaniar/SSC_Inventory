import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—'
const ST = {
  pending:{l:'Pending manager',c:'#C25A00',b:'rgba(226,101,0,0.12)'},
  mgr_approved:{l:'Pending HR',c:'#0369a1',b:'rgba(3,105,161,0.10)'},
  approved:{l:'Approved',c:'#256F3A',b:'rgba(37,111,58,0.10)'},
  rejected:{l:'Rejected',c:'#BB0000',b:'rgba(187,0,0,0.08)'},
  cancelled:{l:'Cancelled',c:'#8C99A8',b:'rgba(140,153,168,0.12)'},
}
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
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ work_date:'', requested_in:'10:00', requested_out:'18:30', reason:'' })
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
    if (preDate) { setForm(f => ({ ...f, work_date: preDate })); setShow(true) }
    await load(me?.id)
    setLoading(false)
  }

  async function load(myId) {
    const [cfg, mn, ib] = await Promise.all([
      sb.from('attendance_config').select('hr_approver_employee_id').maybeSingle(),
      myId ? sb.from('regularizations').select('*').eq('employee_id', myId).order('created_at',{ascending:false}) : Promise.resolve({data:[]}),
      sb.from('regularizations').select('*, emp:employees!regularizations_employee_id_fkey(full_name,designation,reporting_manager_id)').in('status',['pending','mgr_approved']).order('created_at'),
    ])
    setHrId(cfg?.data?.hr_approver_employee_id || null)
    setMine(mn?.data || [])
    setInbox((ib?.data||[]).filter(x => x.employee_id !== myId))
  }

  async function apply() {
    if (guard.current) return
    if (!form.work_date) { toast('Pick the date to fix.', 'error'); return }
    if (!form.requested_in && !form.requested_out) { toast('Enter at least an in or out time.', 'error'); return }
    if (form.requested_in && form.requested_out && form.requested_out < form.requested_in) { toast('Out time is before in time.', 'error'); return }
    guard.current = true
    try {
      const { error } = await sb.from('regularizations').insert({
        employee_id: meId, work_date: form.work_date,
        requested_in: form.requested_in || null, requested_out: form.requested_out || null,
        reason: form.reason.trim() || null,
      })
      if (error) throw error
      toast('Regularization sent to your manager.', 'success')
      setShow(false); setForm({ work_date:'', requested_in:'10:00', requested_out:'18:30', reason:'' })
      await load(meId)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { guard.current = false }
  }

  async function decide(req, step, approve) {
    let note = null
    if (!approve) { note = window.prompt('Reason for rejection (optional):') ?? null }
    try {
      const { error } = await sb.rpc('reg_decide', { p_id: req.id, p_step: step, p_approve: approve, p_note: note })
      if (error) throw error
      toast(approve ? (step==='hr'?'Approved — punch corrected.':'Sent to HR.') : 'Rejected.', 'success')
      await load(meId)
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  async function cancelMine(req) {
    if (!window.confirm('Cancel this request?')) return
    try { await sb.from('regularizations').update({ status:'cancelled' }).eq('id', req.id); toast('Cancelled.','success'); await load(meId) }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Regularize"><div className="people-app"><Spinner /></div></Layout>

  const timeRange = r => `${r.requested_in?r.requested_in.slice(0,5):'—'} → ${r.requested_out?r.requested_out.slice(0,5):'—'}`

  return (
    <Layout pageKey="people" pageTitle="Regularize">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people/attendance')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Attendance
            </button>
            <h1 className="ph-title">Regularize</h1>
            <div className="ph-sub">Fix a missed or wrong punch · manager → Ankit (HR)</div>
          </div>
          {meId && <button className="btn btn-primary" onClick={()=>setShow(true)}>+ New Request</button>}
        </div>

        <AttendanceTabs role={role} isManager={inbox.length>0 || isMgmt} />

        {inbox.length > 0 && (
          <div className="att-card" style={{marginBottom:14}}>
            <div className="att-card-h"><span className="att-card-t">Approvals · {inbox.length}</span></div>
            {inbox.map(r => {
              const iAmMgr = r.emp?.reporting_manager_id === meId, iAmHr = meId === hrId
              const canMgr = r.status==='pending' && (iAmMgr || isMgmt)
              const canHr  = r.status==='mgr_approved' && (iAmHr || isMgmt)
              const s = ST[r.status]
              return (
                <div key={r.id} style={{display:'grid',gridTemplateColumns:'1.3fr 1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
                  <div><div style={{fontWeight:600,fontSize:13.5}}>{r.emp?.full_name}</div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{fmtD(r.work_date)}{r.reason?` · ${r.reason}`:''}</div></div>
                  <div className="mono" style={{fontSize:12.5}}>{timeRange(r)}</div>
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

        <div className="att-card">
          <div className="att-card-h"><span className="att-card-t">My requests</span></div>
          {mine.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No regularization requests yet.</div> : mine.map(r => { const s=ST[r.status]; return (
            <div key={r.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div><div style={{fontSize:13.5,fontWeight:600}}>{fmtD(r.work_date)} · <span className="mono">{timeRange(r)}</span></div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div></div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}><span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>{['pending','mgr_approved'].includes(r.status) && <button className="btn btn-neutral btn-sm" onClick={()=>cancelMine(r)}>Cancel</button>}</div>
            </div>
          )})}
        </div>
      </div>

      {show && (
        <Drawer title="Regularize a day" sub="Correct in/out for a missed or wrong punch" onClose={()=>setShow(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShow(false)}>Cancel</button><button className="pd-btn primary" onClick={apply}>Send request</button></>}>
          <div className="pd-f"><label>Date to fix</label><input type="date" value={form.work_date} max={new Date().toLocaleDateString('en-CA')} onChange={e=>setForm({...form,work_date:e.target.value})} /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Correct in-time</label><input type="time" value={form.requested_in} onChange={e=>setForm({...form,requested_in:e.target.value})} /></div>
            <div className="pd-f"><label>Correct out-time</label><input type="time" value={form.requested_out} onChange={e=>setForm({...form,requested_out:e.target.value})} /></div>
          </div>
          <div className="pd-f"><label>Reason</label><input value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} placeholder="e.g. forgot to punch out" /></div>
          <div style={{fontSize:12,color:'var(--muted)'}}>On approval, a correction punch is added <b>alongside</b> the original record (nothing is overwritten). Goes to your manager, then Ankit (HR).</div>
        </Drawer>
      )}
    </Layout>
  )
}
