import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { currentFyLabel } from '../lib/kpi'
import Layout from '../components/Layout'
import { ProfileSkeleton } from '../components/PeopleLoaders'
import '../styles/people.css'

const DEPT_HEX = { 'Management':'#6D28D9','Sales':'#1E54B7','Operation & Support':'#0E7C6B','Opeartion & Support':'#0E7C6B','Account':'#C2255C','Back Office':'#8C99A8','People & Culture':'#C2255C' }
const ROLE_LABELS = { admin:'Admin', sales:'Sales', ops:'Operations', accounts:'Accounts', management:'Management', fc_kaveri:'FC Kaveri', fc_godawari:'FC Godawari', demo:'Demo' }
const STATUS_LABEL = { probation:'Probation', confirmed:'Confirmed', notice:'Notice', exited:'Exited' }
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n='') { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function initials(n='') { return n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??' }
function deptColor(d) { return DEPT_HEX[d] || '#5B738B' }
function fmtD(d) { if(!d) return '—'; const x=new Date(d); return isNaN(x)?'—':x.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) }
function tenure(j) { if(!j) return '—'; const d=new Date(j),n=new Date(); let m=(n.getFullYear()-d.getFullYear())*12+(n.getMonth()-d.getMonth()); if(m<0)return '—'; const y=Math.floor(m/12); m%=12; return (y?y+'y ':'')+m+'m' }
function ageFrom(d) { if(!d) return '—'; const b=new Date(d),n=new Date(); let a=n.getFullYear()-b.getFullYear(); if(n.getMonth()<b.getMonth()||(n.getMonth()===b.getMonth()&&n.getDate()<b.getDate()))a--; return a>0?a+' yrs':'—' }
function inr(n) { return n==null?'—':'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:0}) }
function maskPan(v){ return v?v.slice(0,3)+'••••'+v.slice(-1):'—' }
function maskAad(v){ return v?'•••• •••• '+String(v).replace(/\s/g,'').slice(-4):'—' }
const Avatar = ({ name, cls, exited, photo }) => (
  <div className={'avatar '+cls} style={photo
    ? { backgroundImage:`url(${photo})`, backgroundSize:'cover', backgroundPosition:'center', filter:exited?'grayscale(.5)':'none' }
    : { background:ownerColor(name), filter:exited?'grayscale(.5)':'none' }}>{photo?'':initials(name)}</div>
)
function EditDrawer({ title, sub, onClose, children, footer }) {
  return createPortal(<>
    <div className="people-drawer-scrim" onClick={onClose} />
    <div className="people-drawer" role="dialog">
      <div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub && <div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div>
      <div className="pd-b">{children}</div>
      {footer && <div className="pd-foot">{footer}</div>}
    </div>
  </>, document.body)
}

const IC = {
  id:<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="7" r="1.6"/><path d="M9 6h3M9 8.5h3M4 11c.4-1 1.1-1.5 2-1.5s1.6.5 2 1.5"/></svg>,
  job:<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="5" width="12" height="8" rx="1.5"/><path d="M6 5V4a2 2 0 0 1 4 0v1"/></svg>,
  heart:<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 13S2.5 9.5 2.5 5.8A2.8 2.8 0 0 1 8 4.6 2.8 2.8 0 0 1 13.5 5.8C13.5 9.5 8 13 8 13Z"/></svg>,
  lock:<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="6.5" rx="1.2"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>,
}
const Spec = ({ l, children }) => <div className="spec"><span className="spec-l">{l}</span><span className="spec-v">{children}</span></div>
const PCard = ({ icon, title, right, wide, children }) => (
  <div className={'pcard'+(wide?' pcard-wide':'')}>
    <div className="pcard-h" style={right?{justifyContent:'space-between'}:undefined}><span style={{display:'inline-flex',alignItems:'center',gap:9}}>{icon}{title}</span>{right}</div>
    <div className="pcard-b">{children}</div>
  </div>
)

export default function EmployeeDetail() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [role, setRole] = useState('')
  const [uid, setUid] = useState(null)
  const [emp, setEmp] = useState(null)
  const [priv, setPriv] = useState(null)
  const [profile, setProfile] = useState(null)
  const [allEmps, setAllEmps] = useState([])
  const [comp, setComp] = useState([])
  const [assign, setAssign] = useState([])
  const [docs, setDocs] = useState([])
  const [kpi, setKpi] = useState(null)
  const [kpiMonthly, setKpiMonthly] = useState([])
  const [secUser, setSecUser] = useState(null)
  const [tab, setTab] = useState('overview')
  const [reveal, setReveal] = useState({})
  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [uploading, setUploading] = useState(false)
  const guard = useRef(false)

  const isAdmin = role === 'admin'
  const isMgmt = ['admin','management'].includes(role)
  const isSelf = emp && profile && emp.profile_id === uid
  const targetIsAdmin = profile?.role === 'admin'
  const canComp = isAdmin || (role === 'management' && !targetIsAdmin)
  const canKPI = isMgmt || isSelf

  useEffect(() => { init() }, [id])   // eslint-disable-line

  async function init() {
    setLoading(true); setNotFound(false)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    setUid(session.user.id)
    const { data: p } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(p?.role || '')
    await load(p?.role || '')
    setLoading(false)
  }

  async function load(r) {
    const mgmt = ['admin','management'].includes(r)
    const { data: e } = await sb.from('employees').select('*').eq('id', id).maybeSingle()
    if (!e) { setNotFound(true); return }
    setEmp(e)
    const [pv, pr, all, cp, aa, dc] = await Promise.all([
      sb.from('employee_private').select('*').eq('employee_id', id).maybeSingle(),
      e.profile_id ? sb.from('profiles').select('id,username,role').eq('id', e.profile_id).maybeSingle() : Promise.resolve({data:null}),
      sb.from('employees').select('id,full_name,designation,department,reporting_manager_id,profile_id,lifecycle_status').eq('is_test', false),
      sb.from('employee_compensation').select('*').eq('employee_id', id).order('fy_label',{ascending:false}),
      sb.from('asset_assignments').select('*, asset:assets(*)').eq('employee_id', id).is('assigned_to', null),
      sb.from('employee_documents').select('*').eq('employee_id', id),
    ])
    setPriv(pv?.data || null); setProfile(pr?.data || null); setAllEmps(all?.data || [])
    setComp(cp?.data || []); setAssign(aa?.data || []); setDocs(dc?.data || [])
    if (e.profile_id) {
      const { data: k } = await sb.from('kpi_assignments').select('*').eq('profile_id', e.profile_id).eq('is_active', true).order('fy_label',{ascending:false}).limit(1).maybeSingle()
      setKpi(k || null)
      if (k) { const { data: md } = await sb.from('kpi_monthly_data').select('month_start,kpi_key,value').eq('assignment_id', k.id); setKpiMonthly(md || []) }
    }
    if (mgmt && r === 'admin' && e.profile_id) {
      const { data: users } = await sb.rpc('admin_list_users')
      setSecUser((users || []).find(u => u.id === e.profile_id) || null)
    }
  }

  const mgr = useMemo(() => emp?.reporting_manager_id ? allEmps.find(x=>x.id===emp.reporting_manager_id) : null, [emp, allEmps])
  const reports = useMemo(() => emp ? allEmps.filter(x=>x.reporting_manager_id===emp.id && x.lifecycle_status!=='exited') : [], [emp, allEmps])
  const mgrOptions = useMemo(() => allEmps.filter(x=>x.id!==emp?.id && x.lifecycle_status!=='exited').sort((a,b)=>a.full_name.localeCompare(b.full_name)), [allEmps, emp])
  const fyComp = comp[0] || null

  // KPI headline metric graph (actual_sales else first key)
  const kpiSeries = useMemo(() => {
    if (!kpiMonthly.length) return []
    const keys = Array.from(new Set(kpiMonthly.map(m=>m.kpi_key)))
    const key = keys.includes('actual_sales') ? 'actual_sales' : keys.includes('actual_sales_without_gst') ? 'actual_sales_without_gst' : keys[0]
    return kpiMonthly.filter(m=>m.kpi_key===key).sort((a,b)=>a.month_start.localeCompare(b.month_start)).map(m=>({ m:m.month_start, v:Number(m.value)||0, key }))
  }, [kpiMonthly])
  const kpiAvg = kpiSeries.length ? Math.round(kpiSeries.reduce((s,x)=>s+x.v,0)/kpiSeries.length) : 0
  const kpiMax = kpiSeries.length ? Math.max(...kpiSeries.map(x=>x.v),1) : 1

  async function reassignManager(newId) {
    try { await sb.from('employees').update({ reporting_manager_id: newId || null }).eq('id', emp.id); toast('Reporting manager updated.','success'); await load(role) }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
  }
  async function onPhoto(ev) {
    const file = ev.target.files?.[0]; if (!file) return
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${emp.id}/photo_${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('employee-photos').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: { publicUrl } } = sb.storage.from('employee-photos').getPublicUrl(path)
      await sb.from('employees').update({ photo_url: publicUrl }).eq('id', emp.id)
      toast('Photo updated.', 'success'); await load(role)
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { setUploading(false) }
  }
  function openEdit() {
    setEditForm({
      full_name: emp.full_name, employee_code: emp.employee_code || '', designation: emp.designation || '',
      department: emp.department || '', branch: emp.branch || '', join_date: emp.join_date || '', lifecycle_status: emp.lifecycle_status,
      gender: priv?.gender || '', date_of_birth: priv?.date_of_birth || '', personal_phone: priv?.personal_phone || '',
      personal_email: priv?.personal_email || '', emergency_contact: priv?.emergency_contact || '', pan: priv?.pan || '', aadhaar: priv?.aadhaar || '',
      spouse_name: priv?.spouse_name || '', spouse_phone: priv?.spouse_phone || '', spouse_dob: priv?.spouse_dob || '', is_permanent: priv?.is_permanent ?? true,
    })
    setShowEdit(true)
  }
  async function saveEdit() {
    if (guard.current) return
    if (!editForm.full_name.trim()) { toast('Full name is required.', 'error'); return }
    guard.current = true
    try {
      await sb.from('employees').update({
        full_name: editForm.full_name.trim(), employee_code: editForm.employee_code.trim() || null,
        designation: editForm.designation.trim() || null, department: editForm.department.trim() || null,
        branch: editForm.branch.trim() || null, join_date: editForm.join_date || null,
        lifecycle_status: editForm.lifecycle_status, is_active: editForm.lifecycle_status !== 'exited',
      }).eq('id', emp.id)
      if (isMgmt) {
        const { error } = await sb.from('employee_private').upsert({
          employee_id: emp.id, gender: editForm.gender || null, date_of_birth: editForm.date_of_birth || null,
          personal_phone: editForm.personal_phone || null, personal_email: editForm.personal_email || null,
          emergency_contact: editForm.emergency_contact || null, pan: editForm.pan || null, aadhaar: editForm.aadhaar || null,
          spouse_name: editForm.spouse_name || null, spouse_phone: editForm.spouse_phone || null,
          spouse_dob: editForm.spouse_dob || null, is_permanent: editForm.is_permanent,
        }, { onConflict: 'employee_id' })
        if (error) throw error
      }
      toast('Saved.', 'success'); setShowEdit(false); await load(role)
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  async function togglePermanent() {
    const on = !(priv?.is_permanent)
    try { await sb.from('employee_private').update({ is_permanent: on }).eq('employee_id', emp.id); toast('Updated.','success'); await load(role) }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Employee"><div className="people-app"><ProfileSkeleton /></div></Layout>
  if (notFound || !emp) return (
    <Layout pageKey="people" pageTitle="Employee"><div className="people-app"><div className="e-empty">Employee not found. <button className="btn btn-neutral btn-sm" onClick={()=>navigate('/people/team')}>← Team</button></div></div></Layout>
  )

  const band = deptColor(emp.department)
  const st = emp.lifecycle_status || 'confirmed'
  const perm = priv?.is_permanent
  const tabs = [
    { k:'overview', l:'Overview' },
    ...(canComp ? [{ k:'comp', l:'Salary' }] : []),
    ...(canKPI && kpi ? [{ k:'kpi', l:'KPI' }] : []),
    { k:'assets', l:'Assets', c:assign.length },
    { k:'expense', l:'Expense & Budget' },
    ...(isMgmt ? [{ k:'documents', l:'Documents', c:docs.length }] : []),
    ...(isAdmin && emp.profile_id ? [{ k:'security', l:'Security' }] : []),
  ]

  return (
    <Layout pageKey="people" pageTitle={emp.full_name}>
      <div className="people-app">
        <div className="pv">
          {/* Cover */}
          <div className="pcover">
            <div className="pcover-band" style={{background:'#fff', height:72, borderBottom:'1px solid var(--line-2)'}}>
              <div className="pcover-actions">
                <button className="btn btn-neutral" onClick={()=>navigate('/people/org')}>Org</button>
                {isMgmt && <button className="btn btn-neutral" onClick={openEdit}>Edit</button>}
                <button className="btn btn-neutral" onClick={()=>navigate('/people/team')}>← Back</button>
              </div>
            </div>
            <div className="pcover-body">
              <div className="pcover-av">
                {isMgmt ? (
                  <label className="photo-slot" title={uploading?'Uploading…':'Upload photo'}>
                    <Avatar name={emp.full_name} cls="av-cover" exited={st==='exited'} photo={emp.photo_url} />
                    <span className="photo-edit"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12l7-7 3 3-7 7H2z"/><path d="M9 4l2-2 2 2-2 2"/></svg></span>
                    <input type="file" accept="image/*" onChange={onPhoto} />
                  </label>
                ) : <Avatar name={emp.full_name} cls="av-cover" exited={st==='exited'} photo={emp.photo_url} />}
              </div>
              <div className="pcover-id">
                <h1 className="pcover-name">{emp.full_name}</h1>
                <div className="pcover-sub">ID {emp.employee_code||'—'} · {emp.designation||'—'}{profile?.username?' · @'+profile.username:''}</div>
                <div className="prof-tags">
                  <span className="tag dept" style={{background:band}}>{emp.department||'—'}</span>
                  <span className={'tag status-'+st}>{STATUS_LABEL[st]||st}</span>
                  {priv && <span className="tag">{perm?'Permanent':'Contract'}</span>}
                </div>
              </div>
            </div>
            <div className="pmicro">
              <div className="pmicro-cell"><div className="pmc-l">Tenure</div><div className="pmc-v">{tenure(emp.join_date)}</div></div>
              <div className="pmicro-cell"><div className="pmc-l">Joined</div><div className="pmc-v" style={{fontSize:14}}>{fmtD(emp.join_date)}</div></div>
              <div className="pmicro-cell"><div className="pmc-l">Direct Reports</div><div className="pmc-v">{reports.length}</div></div>
              <div className="pmicro-cell"><div className="pmc-l">Assets</div><div className="pmc-v">{assign.length}</div></div>
              {priv && <div className="pmicro-cell"><div className="pmc-l">Age</div><div className="pmc-v">{ageFrom(priv.date_of_birth)}</div></div>}
            </div>
          </div>

          {/* Side */}
          <aside className="pside">
            <PCard icon={IC.job} title="Contact & Details">
              <Spec l="User ID">{profile?.username ? <span className="mono">{profile.username}</span> : <span className="no-access">No login</span>}</Spec>
              <Spec l="Work Location">{emp.branch||'—'}</Spec>
              {isMgmt && <Spec l="Emergency">{priv?.emergency_contact ? <span className="mono">{priv.emergency_contact}</span> : '—'}</Spec>}
              <Spec l="Login Role">{profile ? (ROLE_LABELS[profile.role]||profile.role) : '—'}</Spec>
            </PCard>

            <div className="pcard">
              <div className="pcard-h"><svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="4" r="2.2"/><path d="M3.5 13.5c0-2.2 2-3.6 4.5-3.6s4.5 1.4 4.5 3.6"/></svg>Reporting Line</div>
              <div className="chain">
                {mgr ? (
                  <><button className="chain-node up" onClick={()=>navigate('/people/team/'+mgr.id)}><Avatar name={mgr.full_name} cls="av-28" /><div className="cn-txt"><div className="cn-name">{mgr.full_name}</div><div className="cn-role">Manager · {mgr.designation||'—'}</div></div></button><div className="chain-link" /></>
                ) : <div className="chain-top">Top of organisation</div>}
                <div className="chain-node me"><Avatar name={emp.full_name} cls="av-28" /><div className="cn-txt"><div className="cn-name">{emp.full_name}</div><div className="cn-role">{emp.designation||'—'}</div></div></div>
                {reports.length ? <><div className="chain-link" /><div className="chain-reps">{reports.slice(0,8).map(r=><span key={r.id} title={r.full_name} onClick={()=>navigate('/people/team/'+r.id)}><Avatar name={r.full_name} cls="av-28" /></span>)}{reports.length>8 && <span className="chain-more">+{reports.length-8}</span>}</div></> : <div className="chain-empty">No direct reports</div>}
                {isMgmt && (
                  <div className="chain-reassign"><span className="ra-l">Reassign manager</span>
                    <select className="rm-sel" value={emp.reporting_manager_id||''} onChange={e=>reassignManager(e.target.value)}>
                      <option value="">— Top of org —</option>
                      {mgrOptions.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Main */}
          <div className="pmain">
            <div className="ptabs2">
              {tabs.map(t=><button key={t.k} className={'ptab2'+(tab===t.k?' on':'')} onClick={()=>setTab(t.k)}>{t.l}{t.c!=null&&<span className="pt-count">{t.c}</span>}</button>)}
            </div>

            {tab==='overview' && (
              <div className="pmain-grid">
                <PCard icon={IC.id} title="Identity">
                  <Spec l="Employee ID"><span className="mono">{emp.employee_code||'—'}</span></Spec>
                  <Spec l="Full Name">{emp.full_name}</Spec>
                  {isMgmt && <Spec l="Gender">{priv?.gender||'—'}</Spec>}
                  {isMgmt && <Spec l="Date of Birth">{priv?.date_of_birth?fmtD(priv.date_of_birth)+' · '+ageFrom(priv.date_of_birth):'—'}</Spec>}
                  <Spec l="Department"><span className="dept-pill"><span className="dept-dot" style={{background:band}} />{emp.department||'—'}</span></Spec>
                  <Spec l="Branch / Location">{emp.branch||'—'}</Spec>
                </PCard>
                <PCard icon={IC.job} title="Employment">
                  <Spec l="Date of Joining">{fmtD(emp.join_date)}</Spec>
                  <Spec l="Tenure">{tenure(emp.join_date)} with company</Spec>
                  <Spec l="Lifecycle"><span className={'status '+st}><span className="led" />{STATUS_LABEL[st]||st}</span></Spec>
                  {priv && <Spec l="Employment Type">{perm?'Permanent':'Contract / Probation'}</Spec>}
                  <Spec l="Login Role">{profile?(ROLE_LABELS[profile.role]||profile.role):'—'}</Spec>
                  <Spec l="User ID">{profile?.username?<span className="mono">{profile.username}</span>:'—'}</Spec>
                </PCard>
                {isMgmt && (
                  <PCard icon={IC.heart} title="Personal & Family">
                    <Spec l="Spouse Name">{priv?.spouse_name||'—'}</Spec>
                    <Spec l="Spouse Contact">{priv?.spouse_phone?<span className="mono">{priv.spouse_phone}</span>:'—'}</Spec>
                    <Spec l="Spouse Birthdate">{priv?.spouse_dob?fmtD(priv.spouse_dob):'—'}</Spec>
                    <Spec l="Emergency Contact">{priv?.emergency_contact?<span className="mono">{priv.emergency_contact}</span>:'—'}</Spec>
                  </PCard>
                )}
                <PCard icon={IC.lock} title="Legal & Statutory" wide>
                  {isMgmt ? (
                    <>
                      <Spec l={<>PAN <span className="lock-tag">Restricted</span></>}>
                        <span className="masked"><span className="masked-val">{reveal.pan?(priv?.pan||'—'):maskPan(priv?.pan)}</span><button className="eye-btn" onClick={()=>setReveal(r=>({...r,pan:!r.pan}))}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="1.8"/></svg></button></span>
                      </Spec>
                      <Spec l={<>Aadhaar <span className="lock-tag">Restricted</span></>}>
                        <span className="masked"><span className="masked-val">{reveal.aad?(priv?.aadhaar||'—'):maskAad(priv?.aadhaar)}</span><button className="eye-btn" onClick={()=>setReveal(r=>({...r,aad:!r.aad}))}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"/><circle cx="8" cy="8" r="1.8"/></svg></button></span>
                      </Spec>
                    </>
                  ) : (
                    <div className="legal-locked"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><div>PAN &amp; Aadhaar are hidden for your role.<br/>Visible to Admin &amp; Management only.</div></div>
                  )}
                </PCard>
              </div>
            )}

            {tab==='comp' && canComp && (
              <PCard icon={<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6.2"/><path d="M8 5v6M6.3 6.3h2.4a1.3 1.3 0 0 1 0 2.6H6.3M6.3 8.9h2.6"/></svg>} title="Salary" right={<span className="sec-sub">Annual CTC · FY {fyComp?.fy_label||currentFyLabel()}</span>}>
                {!fyComp ? <div className="comp-locked">No salary recorded.</div> : (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)'}}>
                      <div style={{padding:'18px 20px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Annual CTC</div><div className="pmc-v" style={{fontSize:22}}>{inr(fyComp.annual_ctc_inr)}</div></div>
                      <div style={{padding:'18px 20px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Monthly (approx)</div><div className="pmc-v" style={{fontSize:18}}>{inr(fyComp.annual_ctc_inr/12)}</div></div>
                      {kpi && <div style={{padding:'18px 20px'}}><div className="pmc-l">KPI Target</div><div className="pmc-v" style={{fontSize:18}}>{inr(kpi.annual_target_inr)}</div></div>}
                    </div>
                    {comp.length>1 && <div style={{padding:'12px 20px',borderTop:'1px solid var(--line-2)',fontSize:12,color:'var(--muted)'}}>History · {comp.map(c=>`${c.fy_label}: ${inr(c.annual_ctc_inr)}`).join('  ·  ')}</div>}
                    <div style={{padding:'0 20px 14px',fontSize:11.5,color:'var(--muted-2)'}}>Detailed salary breakup will be added once you share the structure.</div>
                  </>
                )}
              </PCard>
            )}

            {tab==='kpi' && canKPI && kpi && (
              <PCard icon={<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 14V2M2 14h12M5 11l3-4 2 2 4-5"/></svg>} title="KPI Performance" right={<span className="sec-sub">FY {kpi.fy_label}</span>}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',borderBottom:'1px solid var(--line-2)'}}>
                  <div style={{padding:'14px 18px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Annual Target</div><div className="pmc-v">{inr(kpi.annual_target_inr)}</div></div>
                  <div style={{padding:'14px 18px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Monthly Target</div><div className="pmc-v">{inr(kpi.monthly_target_inr)}</div></div>
                  <div style={{padding:'14px 18px'}}><div className="pmc-l">Avg / month{kpiSeries[0]?` · ${kpiSeries[0].key.replace(/_/g,' ')}`:''}</div><div className="pmc-v">{kpiSeries.length?inr(kpiAvg):'—'}</div></div>
                </div>
                {kpiSeries.length ? (
                  <div style={{padding:'20px 18px'}}>
                    <div style={{display:'flex',alignItems:'flex-end',gap:8,height:150}}>
                      {kpiSeries.map((x,i)=>(
                        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
                          <div style={{fontSize:10,color:'var(--muted-2)',fontFamily:'Geist Mono,monospace'}}>{x.v>=1000?Math.round(x.v/1000)+'k':x.v}</div>
                          <div title={inr(x.v)} style={{width:'100%',maxWidth:36,height:Math.max(4,Math.round(x.v/kpiMax*110)),background:x.v>=kpiAvg?'var(--accent)':'#bcd3f5',borderRadius:'5px 5px 0 0'}} />
                          <div style={{fontSize:10,color:'var(--muted)'}}>{new Date(x.m).toLocaleDateString('en-IN',{month:'short'})}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <div className="e-empty" style={{padding:'30px 0'}}>No monthly data yet.</div>}
                <div style={{padding:'0 18px 16px'}}><button className="btn btn-ghost btn-sm" onClick={()=>navigate('/people/kpi')}>View full scorecard →</button></div>
              </PCard>
            )}

            {tab==='assets' && (
              <PCard icon={<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="4" width="11" height="7" rx="1"/><path d="M5.5 13.5h5M8 11v2.5"/></svg>} title={`Assigned Assets · ${assign.length}`} right={isMgmt && <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/people/assets')}>Manage Devices</button>}>
                {!assign.length ? <div className="e-empty" style={{padding:'30px 0'}}>No devices assigned to {emp.full_name.split(' ')[0]}.</div> : (
                  <div className="atiles">{assign.map(a=>(
                    <div key={a.id} className="atile">
                      <div className="at-top">
                        <div className="arow-ico"><svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="4" width="13" height="8.5" rx="1"/><path d="M6 15.5h6M9 12.5v3"/></svg></div>
                        <div><div className="a-name">{a.asset?.name||a.asset?.make_model||a.asset?.asset_type}</div><div className="a-tag">{a.asset?.asset_tag} · {a.asset?.asset_type}</div></div>
                        <span className={'a-cond '+(a.asset?.condition||'inuse')}><span className="led" />{({inuse:'In use',repair:'In repair',returned:'Returned'})[a.asset?.condition]||'In use'}</span>
                      </div>
                      <div className="at-grid">
                        <div><div className="a-meta-l">Serial</div><div className="a-meta-v mono" style={{fontSize:12}}>{a.asset?.serial_no||'—'}</div></div>
                        <div><div className="a-meta-l">Issued</div><div className="a-meta-v">{fmtD(a.assigned_from)}</div></div>
                      </div>
                    </div>
                  ))}</div>
                )}
              </PCard>
            )}

            {tab==='expense' && (
              <PCard icon={<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M2 7h12M4 10h3"/></svg>} title="Expense & Budget">
                <Spec l="Login">{profile?profile.username:'No login — not in expense budget'}</Spec>
                <Spec l="Branch">{emp.branch||'—'}</Spec>
                {isMgmt
                  ? <div style={{fontSize:12.5,color:'var(--muted)',marginTop:8}}>Per-person expense limits are set here (migrating from the Config page). <button className="btn btn-ghost btn-sm" style={{marginLeft:8}} onClick={()=>navigate('/people/expenses/config')}>Open Expense Config →</button></div>
                  : <div style={{fontSize:12.5,color:'var(--muted-2)',marginTop:8}}>Budget limits are visible to Admin &amp; Management.</div>}
              </PCard>
            )}

            {tab==='documents' && isMgmt && (
              <PCard icon={<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/></svg>} title={`Documents · ${docs.length}`}>
                {['PAN Card','Aadhaar Card','Offer Letter','Appointment Letter'].map(dt=>{
                  const d = docs.find(x=>x.doc_type===dt)
                  return <div key={dt} className="dchip" style={{margin:'0 0 10px'}}>
                    <div className={'doc-ico '+(d?'up':'miss')}>{d?<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8l3 3 7-7"/></svg>:<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 3v10M3 8h10"/></svg>}</div>
                    <div className="doc-info"><div className="doc-name">{dt}</div><div className="doc-sub">{d?('Uploaded '+fmtD(d.uploaded_at||d.created_at)):'Not uploaded'}</div></div>
                  </div>
                })}
                <div style={{fontSize:11.5,color:'var(--muted-2)'}}>Document upload storage is admin/management-only. Upload wiring can be enabled next.</div>
              </PCard>
            )}

            {tab==='security' && isAdmin && emp.profile_id && (
              <PCard icon={IC.lock} title="Security & Login">
                {!secUser ? <div className="e-empty" style={{padding:'20px 0'}}>Loading login…</div> : (
                  <>
                    <Spec l="Username"><span className="mono">{secUser.username}</span></Spec>
                    <Spec l="Email">{secUser.email||secUser.username+'@ssccontrol.com'}</Spec>
                    <Spec l="Status">{secUser.is_suspended?'Suspended':'Active'}</Spec>
                    <Spec l="2FA">{secUser.has_mfa?'Enabled':'Not set'}</Spec>
                    <div style={{display:'flex',gap:8,marginTop:12,flexWrap:'wrap'}}>
                      <button className="btn btn-neutral btn-sm" onClick={async()=>{const on=!secUser.is_suspended;if(!window.confirm(on?`Suspend ${emp.full_name}?`:`Reactivate ${emp.full_name}?`))return;const{error}=await sb.rpc('admin_set_user_suspended',{p_user_id:emp.profile_id,p_suspend:on});if(error){toast(error.message,'error');return}toast(on?'Suspended':'Reactivated','success');load(role)}}>{secUser.is_suspended?'Reactivate':'Suspend'}</button>
                      <button className="btn btn-neutral btn-sm" onClick={async()=>{if(!window.confirm(`Reset ${emp.full_name}'s 2FA?`))return;const{error}=await sb.rpc('admin_reset_user_mfa',{p_user_id:emp.profile_id});if(error){toast(error.message,'error');return}toast('2FA reset','success');load(role)}}>Reset 2FA</button>
                    </div>
                  </>
                )}
              </PCard>
            )}
          </div>
        </div>
      </div>

      {showEdit && editForm && (
        <EditDrawer title={`Edit · ${emp.full_name}`} sub={isMgmt ? 'Employee + personal details' : 'Basic details'} onClose={()=>setShowEdit(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShowEdit(false)}>Cancel</button><button className="pd-btn primary" onClick={saveEdit}>Save</button></>}>
          <div className="pd-f"><label>Full name *</label><input value={editForm.full_name} onChange={e=>setEditForm({...editForm,full_name:e.target.value})} /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Employee ID</label><input value={editForm.employee_code} onChange={e=>setEditForm({...editForm,employee_code:e.target.value})} /></div>
            <div className="pd-f"><label>Join date</label><input type="date" value={editForm.join_date||''} onChange={e=>setEditForm({...editForm,join_date:e.target.value})} /></div>
          </div>
          <div className="pd-f"><label>Designation</label><input value={editForm.designation} onChange={e=>setEditForm({...editForm,designation:e.target.value})} /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Department</label><input value={editForm.department} onChange={e=>setEditForm({...editForm,department:e.target.value})} /></div>
            <div className="pd-f"><label>Branch / Location</label><input value={editForm.branch} onChange={e=>setEditForm({...editForm,branch:e.target.value})} /></div>
          </div>
          <div className="pd-f"><label>Lifecycle status</label><select value={editForm.lifecycle_status} onChange={e=>setEditForm({...editForm,lifecycle_status:e.target.value})}><option value="probation">Probation</option><option value="confirmed">Confirmed</option><option value="notice">Notice</option><option value="exited">Exited</option></select></div>
          {isMgmt && <>
            <div style={{fontSize:10.5,fontWeight:600,letterSpacing:'0.05em',textTransform:'uppercase',color:'#8C99A8',marginTop:6}}>Personal &amp; Statutory (restricted)</div>
            <div className="pd-2">
              <div className="pd-f"><label>Gender</label><input value={editForm.gender} onChange={e=>setEditForm({...editForm,gender:e.target.value})} /></div>
              <div className="pd-f"><label>Date of birth</label><input type="date" value={editForm.date_of_birth||''} onChange={e=>setEditForm({...editForm,date_of_birth:e.target.value})} /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Personal phone</label><input value={editForm.personal_phone} onChange={e=>setEditForm({...editForm,personal_phone:e.target.value})} /></div>
              <div className="pd-f"><label>Emergency contact</label><input value={editForm.emergency_contact} onChange={e=>setEditForm({...editForm,emergency_contact:e.target.value})} /></div>
            </div>
            <div className="pd-f"><label>Personal email</label><input value={editForm.personal_email} onChange={e=>setEditForm({...editForm,personal_email:e.target.value})} /></div>
            <div className="pd-2">
              <div className="pd-f"><label>PAN</label><input value={editForm.pan} onChange={e=>setEditForm({...editForm,pan:e.target.value.toUpperCase()})} placeholder="ABCPM1234A" /></div>
              <div className="pd-f"><label>Aadhaar</label><input value={editForm.aadhaar} onChange={e=>setEditForm({...editForm,aadhaar:e.target.value})} placeholder="1234 5678 9012" /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Spouse name</label><input value={editForm.spouse_name} onChange={e=>setEditForm({...editForm,spouse_name:e.target.value})} /></div>
              <div className="pd-f"><label>Spouse phone</label><input value={editForm.spouse_phone} onChange={e=>setEditForm({...editForm,spouse_phone:e.target.value})} /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Spouse DOB</label><input type="date" value={editForm.spouse_dob||''} onChange={e=>setEditForm({...editForm,spouse_dob:e.target.value})} /></div>
              <div className="pd-f"><label>Employment</label><select value={editForm.is_permanent?'1':'0'} onChange={e=>setEditForm({...editForm,is_permanent:e.target.value==='1'})}><option value="1">Permanent</option><option value="0">Contract</option></select></div>
            </div>
          </>}
        </EditDrawer>
      )}
    </Layout>
  )
}
