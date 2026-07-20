import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { signPhotos } from '../lib/photos'
import Layout from '../components/Layout'
import { TeamSkeleton } from '../components/PeopleLoaders'
import '../styles/people.css'

function Drawer({ title, sub, onClose, children, footer }) {
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer" role="dialog">
        <div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub && <div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div>
        <div className="pd-b">{children}</div>
        {footer && <div className="pd-foot">{footer}</div>}
      </div>
    </>, document.body)
}

const DEPT_HEX = { 'Management':'#6D28D9', 'Sales':'#1E54B7', 'Operation & Support':'#0E7C6B', 'Opeartion & Support':'#0E7C6B', 'Account':'#C2255C', 'Back Office':'#8C99A8', 'People & Culture':'#C2255C' }
const ROLE_LABELS = { admin:'Admin', sales:'Sales', ops:'Operations', accounts:'Accounts', management:'Management', fc_kaveri:'FC Kaveri', fc_godawari:'FC Godawari', demo:'Demo' }
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n='') { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function initials(n='') { return n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??' }
function deptColor(d) { return DEPT_HEX[d] || '#8C99A8' }
const STATUS_LABEL = { probation:'Probation', confirmed:'Confirmed', notice:'Notice', exited:'Exited' }

const LocIcon = () => <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 1.5c2.2 0 4 1.8 4 4 0 2.8-4 6.5-4 6.5s-4-3.7-4-6.5c0-2.2 1.8-4 4-4z"/><circle cx="7" cy="5.5" r="1.4"/></svg>

export default function PeopleTeam() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState('all')
  const [fLogin, setFLogin] = useState('all')
  const [fDept, setFDept] = useState('all')
  const [fLoc, setFLoc] = useState('all')
  const [testMode, setTestMode] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ full_name:'', employee_code:'', department:'', designation:'', branch:'', join_date:'', lifecycle_status:'probation' })
  const guard = useRef(false)

  useEffect(() => { init() }, [])
  useEffect(() => { if (!loading) load() }, [testMode])  // eslint-disable-line

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setIsAdmin(profile?.role === 'admin')
    await load(); setLoading(false)
  }

  async function load() {
    const [emp, profs, held] = await Promise.all([
      sb.from('employees').select('*').eq('is_test', testMode).order('full_name'),
      sb.from('profiles').select('id,username,role'),
      sb.from('asset_assignments').select('employee_id').is('assigned_to', null),
    ])
    const roleById = {}; (profs.data || []).forEach(p => { roleById[p.id] = p })
    const heldCount = {}; (held.data || []).forEach(a => { heldCount[a.employee_id] = (heldCount[a.employee_id]||0)+1 })
    const built = (emp.data || []).map(e => ({
      ...e,
      role: e.profile_id ? roleById[e.profile_id]?.role : null,
      username: e.profile_id ? roleById[e.profile_id]?.username : null,
      assets: heldCount[e.id] || 0,
    }))
    await signPhotos(built)
    setRows(built)
  }

  async function addMember() {
    if (guard.current) return
    if (!addForm.full_name.trim()) { toast('Full name is required.', 'error'); return }
    guard.current = true
    try {
      const { error } = await sb.from('employees').insert({
        full_name: addForm.full_name.trim(),
        employee_code: addForm.employee_code.trim() || null,
        department: addForm.department.trim() || null,
        designation: addForm.designation.trim() || null,
        branch: addForm.branch.trim() || null,
        join_date: addForm.join_date || null,
        lifecycle_status: addForm.lifecycle_status,
        is_active: addForm.lifecycle_status !== 'exited',
      })
      if (error) throw error
      toast('Team member added.', 'success')
      setShowAdd(false); setAddForm({ full_name:'', employee_code:'', department:'', designation:'', branch:'', join_date:'', lifecycle_status:'probation' })
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  const depts = useMemo(() => Array.from(new Set(rows.map(r=>r.department).filter(Boolean))).sort(), [rows])
  const locs  = useMemo(() => Array.from(new Set(rows.map(r=>r.branch).filter(Boolean))).sort(), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      const st = STATUS_LABEL[r.lifecycle_status] || r.lifecycle_status
      if (fStatus !== 'all' && st !== fStatus) return false
      if (fLogin === 'has' && !r.profile_id) return false
      if (fLogin === 'no' && r.profile_id) return false
      if (fDept !== 'all' && r.department !== fDept) return false
      if (fLoc !== 'all' && r.branch !== fLoc) return false
      if (!q) return true
      return (r.full_name||'').toLowerCase().includes(q) || (r.employee_code||'').toLowerCase().includes(q)
        || (r.designation||'').toLowerCase().includes(q) || (r.username||'').toLowerCase().includes(q)
    })
  }, [rows, search, fStatus, fLogin, fDept, fLoc])

  const stats = useMemo(() => ({
    total: rows.length,
    active: rows.filter(r=>r.lifecycle_status!=='exited').length,
    nologin: rows.filter(r=>!r.profile_id).length,
    exited: rows.filter(r=>r.lifecycle_status==='exited').length,
  }), [rows])

  const Sel = ({ value, onChange, children }) => (
    <div className="f-sel"><select value={value} onChange={e=>onChange(e.target.value)}>{children}</select></div>
  )

  if (loading) return <Layout pageKey="people" pageTitle="Team"><div className="people-app"><TeamSkeleton /></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Team">
      <div className="people-app">
        <div className="ph">
          <div>
            <h1 className="ph-title">Team</h1>
            <div className="ph-sub">
              <span><b>{stats.total}</b> people</span><span className="sd" />
              <span><b>{stats.active}</b> active</span><span className="sd" />
              <span>{stats.nologin} no-login</span>
              {stats.exited>0 && <><span className="sd" /><span className="exit">{stats.exited} exited</span></>}
            </div>
          </div>
          <div className="ph-actions">
            <div className="vswitch">
              <button className="on"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 4h12M2 8h12M2 12h12"/></svg>List</button>
              <button onClick={()=>navigate('/people/org')}><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="6" y="1.5" width="4" height="3.5" rx="1"/><rect x="1.5" y="11" width="4" height="3.5" rx="1"/><rect x="10.5" y="11" width="4" height="3.5" rx="1"/><path d="M8 5v3M3.5 11V8h9v3"/></svg>Org</button>
            </div>
            {isAdmin && <button className="btn btn-neutral" onClick={()=>navigate('/people/assets')}>Assets</button>}
            {isAdmin && <button className="btn btn-primary" onClick={()=>setShowAdd(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3v10M3 8h10" strokeLinecap="round"/></svg>Add Member
            </button>}
          </div>
        </div>

        <div className="filters">
          <div className="f-search">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by name, emp ID, designation…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <Sel value={fStatus} onChange={setFStatus}><option value="all">Status: All</option><option>Confirmed</option><option>Probation</option><option>Notice</option><option>Exited</option></Sel>
          <Sel value={fLogin} onChange={setFLogin}><option value="all">Login: All</option><option value="has">Has login</option><option value="no">No login</option></Sel>
          <Sel value={fDept} onChange={setFDept}><option value="all">All Depts</option>{depts.map(d=><option key={d}>{d}</option>)}</Sel>
          <Sel value={fLoc} onChange={setFLoc}><option value="all">All Locations</option>{locs.map(l=><option key={l}>{l}</option>)}</Sel>
          {isAdmin && <button className="btn btn-neutral btn-sm" onClick={()=>setTestMode(v=>!v)} style={testMode?{borderColor:'#C25A00',color:'#C25A00',background:'var(--crit-bg)'}:undefined}>{testMode?'● Test':'Test Mode'}</button>}
        </div>

        <div className="card">
          <div className="tbl-wrap">
            <div className="etbl">
              <div className="etbl-head">
                <div>Emp ID</div><div>Name</div><div>Department</div><div>Designation · Location</div>
                <div>Login / Role</div><div>Last Login</div><div>Status</div><div style={{textAlign:'right'}}>Assets</div>
              </div>
              <div>
                {filtered.length === 0 ? (
                  <div className="e-empty">No people match your filters.</div>
                ) : filtered.map(e => {
                  const st = (e.lifecycle_status || 'confirmed')
                  return (
                    <div key={e.id} className="etbl-row" onClick={()=>navigate('/people/team/'+e.id)}>
                      <div className="e-id">{e.employee_code || '—'}</div>
                      <div className="e-name-cell">
                        <div className="avatar av-36" style={e.signedPhoto?{backgroundImage:`url(${e.signedPhoto})`,backgroundSize:'cover',backgroundPosition:'center',filter:st==='exited'?'grayscale(.5)':'none'}:{background:ownerColor(e.full_name), filter: st==='exited'?'grayscale(.5)':'none'}}>{e.signedPhoto?'':initials(e.full_name)}</div>
                        <div className="e-nm">
                          <div className="e-nm-name">{e.full_name}</div>
                          <div className="e-nm-user">{e.username || 'no login'}</div>
                        </div>
                      </div>
                      <div><span className="dept-pill"><span className="dept-dot" style={{background:deptColor(e.department)}} />{e.department || '—'}</span></div>
                      <div>
                        <div className="e-desig">{e.designation || '—'}</div>
                        {e.branch && <div className="e-loc"><LocIcon />{e.branch}</div>}
                      </div>
                      <div>
                        {e.role ? <span className="role-chip has">{ROLE_LABELS[e.role]||e.role}</span> : <span className="role-chip no">No login</span>}
                      </div>
                      <div style={{fontSize:12.5, color:'var(--muted)'}}>—</div>
                      <div><span className={'status '+st}><span className="led" />{STATUS_LABEL[st]||st}</span></div>
                      <div className="assets-cell"><span className={'asset-badge'+(e.assets?'':' zero')}>{e.assets}</span></div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showAdd && (
        <Drawer title="Add Team Member" sub="Creates an employee record (no login — link a login later)" onClose={()=>setShowAdd(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShowAdd(false)}>Cancel</button><button className="pd-btn primary" onClick={addMember}>Add Member</button></>}>
          <div className="pd-f"><label>Full name *</label><input value={addForm.full_name} onChange={e=>setAddForm({...addForm,full_name:e.target.value})} placeholder="Full name" autoFocus /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Employee ID</label><input value={addForm.employee_code} onChange={e=>setAddForm({...addForm,employee_code:e.target.value})} placeholder="e.g. 101" /></div>
            <div className="pd-f"><label>Join date</label><input type="date" value={addForm.join_date} onChange={e=>setAddForm({...addForm,join_date:e.target.value})} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Department</label><input value={addForm.department} onChange={e=>setAddForm({...addForm,department:e.target.value})} list="dept-list" placeholder="Department" /><datalist id="dept-list">{depts.map(d=><option key={d} value={d} />)}</datalist></div>
            <div className="pd-f"><label>Branch / Location</label><input value={addForm.branch} onChange={e=>setAddForm({...addForm,branch:e.target.value})} list="loc-list" placeholder="Location" /><datalist id="loc-list">{locs.map(l=><option key={l} value={l} />)}</datalist></div>
          </div>
          <div className="pd-f"><label>Designation</label><input value={addForm.designation} onChange={e=>setAddForm({...addForm,designation:e.target.value})} placeholder="Designation" /></div>
          <div className="pd-f"><label>Lifecycle status</label><select value={addForm.lifecycle_status} onChange={e=>setAddForm({...addForm,lifecycle_status:e.target.value})}><option value="probation">Probation (default · 3 months)</option><option value="confirmed">Confirmed</option><option value="notice">Notice</option></select></div>
          {addForm.lifecycle_status==='probation' && addForm.join_date && (
            <div style={{fontSize:11.5,color:'#5B738B',background:'#FAFBFC',border:'1px solid #E4E7EC',borderRadius:8,padding:'8px 11px'}}>
              Probation ends <strong style={{color:'#1D2D3E'}}>{new Date(new Date(addForm.join_date).setMonth(new Date(addForm.join_date).getMonth()+3)).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</strong> — confirm them then.
            </div>
          )}
        </Drawer>
      )}
    </Layout>
  )
}
