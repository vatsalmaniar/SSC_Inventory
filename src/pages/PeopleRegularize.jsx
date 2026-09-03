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
import { adminEmpIds } from '../lib/attScope'
import '../styles/people.css'
import '../styles/attendance-ui.css'

const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—'
// Policy (user, 2026-09-03): a regularization must be raised within 48 HOURS of the day
// (today or up to 2 days back — older days are HR's to fix via the Muster mark) — and at
// most 7 per calendar month. sql/regularization_policy_guard.sql is the DB-side gate.
const REG_MONTHLY_CAP = 7
const REG_WINDOW_DAYS = 2
const todayStr = () => new Date().toLocaleDateString('en-CA')
const minRegDate = () => { const d = new Date(); d.setDate(d.getDate() - REG_WINDOW_DAYS); return d.toLocaleDateString('en-CA') }
const ST = {
  pending:{l:'Pending manager',c:'#C25A00',b:'rgba(226,101,0,0.12)'},
  mgr_approved:{l:'Pending HR',c:'#0369a1',b:'rgba(3,105,161,0.10)'},
  approved:{l:'Approved',c:'#256F3A',b:'rgba(37,111,58,0.10)'},
  rejected:{l:'Rejected',c:'#BB0000',b:'rgba(187,0,0,0.08)'},
  cancelled:{l:'Cancelled',c:'#8C99A8',b:'rgba(140,153,168,0.12)'},
}
const REG_REASONS = [
  { k:'forgot_in',  l:'Forgot to punch in' },
  { k:'forgot_out', l:'Forgot to punch out' },
  { k:'field',      l:'On field / client visit' },
  { k:'wfh',        l:'Work from home' },
  { k:'biometric',  l:'Biometric / device issue' },
  { k:'on_duty',    l:'On duty' },
  { k:'other',      l:'Other' },
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
    // full team ledger for admin/management + HR — every request, badge shows what's not approved
    if (['admin','management'].includes(r) || (myId && hrEmp === myId)) {
      const [all, empRes] = await Promise.all([
        fetchAll((f,t) => sb.from('regularizations')
          .select('id,employee_id,work_date,requested_in,requested_out,reason,status,decision_note, emp:employees!regularizations_employee_id_fkey(full_name,department)')
          .order('work_date',{ascending:false}).order('id').range(f,t)),
        sb.from('employees').select('id,full_name,department').neq('lifecycle_status','exited').order('full_name'),
      ])
      setTeamRegs(all.data || [])
      let list = empRes.data || []
      if (r === 'management') { const ex = await adminEmpIds(); list = list.filter(e => !ex.includes(e.id)) }
      setTeam(list)
    }
  }

  // Count this month's live requests (rejected / cancelled don't consume the quota)
  const usedThisMonth = mine.filter(r =>
    ['pending','mgr_approved','approved'].includes(r.status) &&
    r.work_date.slice(0,7) === todayStr().slice(0,7)).length

  async function apply() {
    if (guard.current) return
    if (!form.work_date) { toast('Pick the date to fix.', 'error'); return }
    if (form.work_date > todayStr() || form.work_date < minRegDate()) { toast('Regularization is allowed within 48 hours of the day — for older days, ask HR to mark them from the Muster.', 'error'); return }
    if (usedThisMonth >= REG_MONTHLY_CAP) { toast(`Monthly limit reached — ${REG_MONTHLY_CAP} regularizations per month. Ask HR for anything beyond that.`, 'error'); return }
    const t = form.side === 'in' ? form.requested_in : form.requested_out
    if (!t) { toast(`Enter the correct ${form.side === 'in' ? 'in' : 'out'}-time.`, 'error'); return }
    if (form.reason_type === 'other' && !form.note.trim()) { toast('Add a note describing the reason.', 'error'); return }
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
    if (!approve) { note = window.prompt('Reason for rejection (optional):') ?? null }
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

  if (loading) return <Layout pageKey="people" pageTitle="Regularize"><div className="people-app"><Spinner /></div></Layout>

  const timeRange = r => `${r.requested_in?r.requested_in.slice(0,5):'—'} → ${r.requested_out?r.requested_out.slice(0,5):'—'}`
  // Whole-page person switch (same pattern as Leave / My Attendance)
  const viewedEmp = viewSel ? (team || []).find(e => e.id === viewSel) : null
  const viewingOther = !!viewedEmp && viewSel !== meId
  const viewedRegs = viewedEmp ? (teamRegs || []).filter(r => r.employee_id === viewSel) : null

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
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            {team && <div className="f-sel"><select value={viewSel} onChange={e=>setViewSel(e.target.value)}>
              <option value="">My requests</option>
              {team.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select></div>}
            {meId && !viewingOther && <button className="btn btn-primary" onClick={()=>setShow(true)}>+ New Request</button>}
          </div>
        </div>

        <AttendanceTabs role={role} isManager={inbox.length>0 || isMgmt} />

        {/* person view — the picked employee's full regularization record */}
        {viewingOther && (
          <div className="att-card" style={{marginBottom:14}}>
            <div className="card-h bd" style={{flexWrap:'wrap',gap:16,padding:'12px 0'}}>
              <div className="mcal-person">
                <PeopleAvatar name={viewedEmp.full_name} className="avatar" style={{width:40,height:40,fontSize:14,flexShrink:0}} />
                <div><div className="mcal-name">{viewedEmp.full_name}</div><div className="mcal-desig">{viewedEmp.department||'—'}</div></div>
              </div>
              <div className="mcal-summary">
                <div className="mcal-stat"><div className="mcal-stat-v" style={{color:'var(--ink)'}}>{viewedRegs.length}</div><div className="mcal-stat-l">Requests</div></div>
                <div className="mcal-stat"><div className="mcal-stat-v" style={{color:'var(--st-present)'}}>{viewedRegs.filter(r=>r.status==='approved').length}</div><div className="mcal-stat-l">Approved</div></div>
                <div className="mcal-stat"><div className="mcal-stat-v" style={{color:'#C25A00'}}>{viewedRegs.filter(r=>['pending','mgr_approved'].includes(r.status)).length}</div><div className="mcal-stat-l">Not approved</div></div>
                <div className="mcal-stat"><div className="mcal-stat-v" style={{color:'var(--st-absent)'}}>{viewedRegs.filter(r=>r.status==='rejected').length}</div><div className="mcal-stat-l">Rejected</div></div>
              </div>
            </div>
            {viewedRegs.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No regularization requests.</div> : viewedRegs.map(r => { const s=ST[r.status]||ST.pending; return (
              <div key={r.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)',opacity:r.status==='cancelled'?0.55:1}}>
                <div><div style={{fontSize:13.5,fontWeight:600}}>{fmtD(r.work_date)} · <span className="mono">{timeRange(r)}</span></div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div></div>
                <span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>
              </div>
            )})}
          </div>
        )}

        {!viewingOther && inbox.length > 0 && (
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

        {!viewingOther && <div className="att-card">
          <div className="att-card-h"><span className="att-card-t">My requests</span></div>
          {mine.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No regularization requests yet.</div> : mine.map(r => { const s=ST[r.status]; return (
            <div key={r.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,alignItems:'center',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
              <div><div style={{fontSize:13.5,fontWeight:600}}>{fmtD(r.work_date)} · <span className="mono">{timeRange(r)}</span></div><div style={{fontSize:11.5,color:'var(--muted-2)'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</div></div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}><span className="att-badge" style={{color:s.c,background:s.b}}>{s.l}</span>{['pending','mgr_approved'].includes(r.status) && <button className="btn btn-neutral btn-sm" onClick={()=>cancelMine(r)}>Cancel</button>}</div>
            </div>
          )})}
        </div>}

        {/* team regularization ledger — admin/management + HR; badge shows what's not approved */}
        {teamRegs && !viewingOther && (
          <div className="att-card" style={{marginTop:14}}>
            <div className="att-card-h">
              <span className="att-card-t">Team regularizations · {teamRegs.length}</span>
              <span className="card-sub">{teamRegs.filter(r=>['pending','mgr_approved'].includes(r.status)).length} awaiting approval</span>
            </div>
            {teamRegs.length===0 ? <div className="e-empty" style={{padding:'24px 0'}}>No regularizations yet.</div> : teamRegs.map(r => { const s=ST[r.status]||ST.pending; return (
              <div key={r.id} onClick={()=>setViewSel(r.employee_id)} title="Open this person's record" style={{display:'grid',gridTemplateColumns:'minmax(150px,1.3fr) auto 1fr auto',gap:12,alignItems:'center',padding:'9px 0',borderBottom:'1px solid var(--line-2)',opacity:r.status==='cancelled'?0.55:1,cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'center',gap:9,minWidth:0}}>
                  <PeopleAvatar name={r.emp?.full_name||'—'} className="avatar" style={{width:30,height:30,fontSize:11,flexShrink:0}} />
                  <div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.emp?.full_name||'—'}</div><div style={{fontSize:11,color:'var(--muted-2)'}}>{fmtD(r.work_date)}</div></div>
                </div>
                <span className="mono" style={{fontSize:12.5}}>{timeRange(r)}</span>
                <span style={{fontSize:11.5,color:'var(--muted-2)',minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.reason||'—'}{r.decision_note?` · ${r.decision_note}`:''}</span>
                <span className="att-badge" style={{color:s.c,background:s.b,justifySelf:'end'}}>{s.l}</span>
              </div>
            )})}
          </div>
        )}
      </div>

      {show && (
        <Drawer title="Regularize a day" sub="Correct one punch — in-time or out-time — for a missed or wrong entry" onClose={()=>setShow(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShow(false)}>Cancel</button><button className="pd-btn primary" onClick={apply}>Send request</button></>}>
          <div className="pd-f"><label>Date to fix <span style={{color:'var(--muted)',fontWeight:400}}>(within 48 hours)</span></label><input type="date" value={form.work_date} min={minRegDate()} max={todayStr()} onChange={e=>setForm({...form,work_date:e.target.value})} /></div>
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
            <input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder={form.reason_type==='other'?'Describe the reason':'Add any detail (optional)'} /></div>
          <div style={{fontSize:12,color:'var(--muted)'}}>On approval, a correction punch is added <b>alongside</b> the original record (nothing is overwritten). Goes to your manager, then Ankit (HR).</div>
          <div style={{fontSize:12,color:usedThisMonth>=REG_MONTHLY_CAP?'var(--st-absent)':'var(--muted)'}}>
            <b>{usedThisMonth}</b> of <b>{REG_MONTHLY_CAP}</b> regularizations used this month · allowed within 48 hours of the day.
          </div>
        </Drawer>
      )}
    </Layout>
  )
}
