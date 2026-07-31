import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { signPhotos } from '../lib/photos'
import { computeStructure, RATIOS } from '../lib/salaryStructure'
import { FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'
import { TeamSkeleton } from '../components/PeopleLoaders'
import '../styles/people.css'

const FY = FY_LABEL.replace(/^FY\s*/, '')   // 'FY 26-27' → '26-27'
const LOGIN_ROLES = [['sales','Sales'],['accounts','Accounts'],['management','Management'],['ops','Operations'],['fc_kaveri','FC Kaveri'],['fc_godawari','FC Godawari']]
const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN')
const autoUsername = (name='') => {
  const p = name.trim().toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(Boolean)
  return p.length === 0 ? '' : p.length === 1 ? p[0] : `${p[0]}.${p[p.length-1]}`
}
const genPassword = () => 'Ssc@' + Math.floor(1000 + Math.random() * 9000)
// Local date, NOT toISOString().slice(0,10) — that yields UTC, so between 00:00 and
// 05:30 IST it returns yesterday and back-dates the salary effective_from by a day.
const today = () => new Date().toLocaleDateString('en-CA')
// Money must reach the DB at paise precision; computeStructure works in JS floats.
const round2 = n => Math.round((Number(n) || 0) * 100) / 100
// Statutory IDs: blank and placeholder text ("NA", "-", "N/A") must land as NULL, never as
// a literal value — a stored 'NA' collides across employees and breaks PF/ESI filing.
const statutory = (v, upper = false) => {
  const s = String(v ?? '').trim()
  if (!s || /^(na|n\/a|nil|none|-+)$/i.test(s)) return null
  return upper ? s.toUpperCase() : s
}

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

function Section({ title, sub, open, onToggle, children }) {
  return (
    <div style={{ border:'1px solid #E4E7EC', borderRadius:10, marginBottom:12, overflow:'hidden' }}>
      <button type="button" onClick={onToggle} style={{ width:'100%', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 14px', background:'#FAFBFC', border:0, cursor:'pointer', fontFamily:'inherit' }}>
        <span style={{ fontSize:12.5, fontWeight:600, color:'#1D2D3E' }}>{title}{sub && <span style={{ fontWeight:400, color:'#8C99A8' }}> · {sub}</span>}</span>
        <span style={{ fontSize:11, color:'#8C99A8' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div style={{ padding:'12px 14px' }}>{children}</div>}
    </div>
  )
}

const EMPTY_FORM = {
  // basic (employees)
  full_name:'', employee_code:'', department:'', designation:'', branch:'', join_date:'',
  reporting_manager_id:'', lifecycle_status:'probation', tax_regime:'new',
  // statutory & personal (employee_private)
  gender:'', marital_status:'', date_of_birth:'', personal_phone:'', personal_email:'',
  emergency_contact:'', pan:'', aadhaar:'', uan_no:'', esic_no:'',
  spouse_name:'', spouse_phone:'', spouse_dob:'', is_permanent:true,
  // salary (employee_compensation)
  annual_ctc:'', salary_ratio:'50 / 20 / 10 / 20', pf_applicable:false, professional_tax:'200', accidental_insurance:'128',
  // login
  create_login:false, username:'', login_role:'sales', password:'', team_id:'',
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
  const [isMgmt, setIsMgmt] = useState(false)   // admin OR management — can onboard
  const [teams, setTeams] = useState([])
  const [rows, setRows] = useState([])
  const [search, setSearch] = useState('')
  const [fStatus, setFStatus] = useState('all')
  const [fLogin, setFLogin] = useState('all')
  const [fDept, setFDept] = useState('all')
  const [fLoc, setFLoc] = useState('all')
  const [testMode, setTestMode] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [openSec, setOpenSec] = useState({ basic:true, statutory:false, salary:false, login:false })
  const [createdCreds, setCreatedCreds] = useState(null)   // { username, password } after a login is made
  const guard = useRef(false)

  useEffect(() => { init() }, [])
  useEffect(() => { if (!loading) load() }, [testMode])  // eslint-disable-line

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setIsAdmin(profile?.role === 'admin')
    setIsMgmt(profile?.role === 'admin' || profile?.role === 'management')
    const { data: tm } = await sb.from('kpi_teams_safe').select('id,name').eq('is_active', true).order('name')
    setTeams(tm || [])
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
    setRows(built)   // render instantly with initials
    signPhotos(built).then(() => setRows([...built])).catch(() => {})   // photos pop in when signed
  }

  const set = patch => setAddForm(f => ({ ...f, ...patch }))
  const toggleLogin = on => {
    if (on) set({ create_login:true, username: addForm.username || autoUsername(addForm.full_name), password: addForm.password || genPassword() })
    else set({ create_login:false })
  }

  // live salary breakup preview (mgmt only) — recomputed as CTC/ratio/regime change
  const salPreview = useMemo(() => {
    const ctc = parseFloat(addForm.annual_ctc) || 0
    if (!ctc) return null
    return computeStructure({
      annualCtc: ctc, ratio: addForm.salary_ratio, regime: addForm.tax_regime,
      pfApplicable: addForm.pf_applicable,
      professionalTax: parseFloat(addForm.professional_tax) || 0,
      accidentalInsurance: parseFloat(addForm.accidental_insurance) || 0,
    })
  }, [addForm.annual_ctc, addForm.salary_ratio, addForm.tax_regime, addForm.pf_applicable, addForm.professional_tax, addForm.accidental_insurance])

  const resetAdd = () => { setAddForm({ ...EMPTY_FORM }); setCreatedCreds(null); setOpenSec({ basic:true, statutory:false, salary:false, login:false }) }
  const closeAdd = () => { setShowAdd(false); resetAdd() }

  async function addMember() {
    if (guard.current) return
    const f = addForm
    if (!f.full_name.trim()) { toast('Full name is required.', 'error'); return }
    if (f.create_login) {
      if (!f.username.trim()) { toast('Username is required for the login.', 'error'); return }
      if ((f.password || '').length < 6) { toast('Temp password must be at least 6 characters.', 'error'); return }
      if (f.login_role === 'sales' && !f.team_id) { toast('Pick a team for the sales login (target auto-assigns).', 'error'); return }
    }
    guard.current = true
    try {
      // 1) base employee record
      const { data: emp, error } = await sb.from('employees').insert({
        full_name: f.full_name.trim(),
        employee_code: f.employee_code.trim() || null,
        department: f.department.trim() || null,
        designation: f.designation.trim() || null,
        branch: f.branch.trim() || null,
        join_date: f.join_date || null,
        reporting_manager_id: f.reporting_manager_id || null,
        lifecycle_status: f.lifecycle_status,
        is_active: f.lifecycle_status !== 'exited',
        tax_regime: f.tax_regime,
        is_test: testMode,
      }).select('id').single()
      if (error) throw error
      const empId = emp.id

      // 2) statutory & personal (mgmt) — only if something was entered
      if (isMgmt) {
        const hasPriv = [f.gender,f.marital_status,f.date_of_birth,f.personal_phone,f.personal_email,f.emergency_contact,f.pan,f.aadhaar,f.uan_no,f.esic_no,f.spouse_name,f.spouse_phone,f.spouse_dob].some(v => (v||'').trim && v.trim())
        if (hasPriv || f.is_permanent === false) {
          const { error: e2 } = await sb.from('employee_private').upsert({
            employee_id: empId, gender: f.gender || null, marital_status: f.marital_status || null,
            date_of_birth: f.date_of_birth || null, personal_phone: f.personal_phone || null, personal_email: f.personal_email || null,
            emergency_contact: f.emergency_contact || null, pan: statutory(f.pan, true), aadhaar: statutory(f.aadhaar),
            uan_no: statutory(f.uan_no), esic_no: statutory(f.esic_no),
            spouse_name: f.spouse_name || null, spouse_phone: f.spouse_phone || null, spouse_dob: f.spouse_dob || null,
            is_permanent: f.is_permanent,
          }, { onConflict: 'employee_id' })
          if (e2) throw e2
        }
      }

      // 3) salary breakup (mgmt) — only if a CTC was entered
      const ctc = parseFloat(f.annual_ctc) || 0
      if (isMgmt && ctc > 0) {
        const s = computeStructure({ annualCtc: ctc, ratio: f.salary_ratio, regime: f.tax_regime, pfApplicable: f.pf_applicable, professionalTax: parseFloat(f.professional_tax) || 0, accidentalInsurance: parseFloat(f.accidental_insurance) || 0 })
        // Every money value is rounded to paise here: computeStructure works in JS floats and
        // its output has never been reconciled against the payroll sheet, so these rows are
        // tagged 'computed_unverified' — payroll must treat them as needing sign-off, unlike
        // the 'sheet_june_2026' rows which came from the real sheet.
        const { error: e3 } = await sb.from('employee_compensation').insert({
          employee_id: empId, fy_label: FY, annual_ctc_inr: round2(ctc), effective_from: f.join_date || today(),
          source: 'onboarding', revision_reason: 'Onboarding', is_current: true,
          monthly_ctc: round2(s.monthlyCtc), monthly_gross: round2(s.gross), basic: round2(s.basic), hra: round2(s.hra),
          travel_allowance: round2(s.travelAllowance), special_allowance: round2(s.specialAllowance), salary_ratio: f.salary_ratio,
          pf_employer: round2(s.employerPf), esic_employer: round2(s.employerEsic), pf_employee: round2(s.pfEmployee), esic_employee: round2(s.esicEmployee),
          professional_tax: round2(s.professionalTax), accidental_insurance: round2(s.accidentalInsurance),
          gratuity: round2(s.gratuity), bonus: round2(s.bonus), tds: round2(s.tds), total_deductions: round2(s.totalDeductions),
          net_payable: round2(s.netPayable), breakup_source: 'computed_unverified', updated_at: new Date().toISOString(),
        })
        if (e3) throw e3
      }

      // 4) app login (optional) — links employees.profile_id server-side
      if (f.create_login) {
        const uname = f.username.trim().toLowerCase()
        const { data: newUid, error: e4 } = await sb.rpc('admin_create_login', {
          p_employee_id: empId, p_username: uname, p_password: f.password, p_role: f.login_role, p_name: f.full_name.trim(),
        })
        if (e4) throw e4
        // 5) sales → KPI team + auto target (multiplier resolved server-side)
        if (f.login_role === 'sales' && f.team_id) {
          const { error: e5 } = await sb.rpc('assign_kpi_target', { p_profile_id: newUid, p_team_id: f.team_id, p_fy_label: FY, p_annual_ctc: ctc })
          if (e5) throw e5
        }
        setCreatedCreds({ username: uname, password: f.password })
      }

      toast(f.create_login ? 'Onboarded — share the login below.' : 'Team member onboarded.', 'success')
      await load()
      if (!f.create_login) closeAdd()   // no creds to show → close straight away
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  const depts = useMemo(() => Array.from(new Set(rows.map(r=>r.department).filter(Boolean))).sort(), [rows])
  const locs  = useMemo(() => Array.from(new Set(rows.map(r=>r.branch).filter(Boolean))).sort(), [rows])
  const managers = useMemo(() => rows.filter(r=>r.lifecycle_status!=='exited').map(r=>({ id:r.id, name:r.full_name })).sort((a,b)=>a.name.localeCompare(b.name)), [rows])

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
            {isAdmin && <button className="btn btn-neutral" onClick={()=>navigate('/people/assets')}>Devices</button>}
            {isMgmt && <button className="btn btn-primary" onClick={()=>{ resetAdd(); setShowAdd(true) }}>
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
          {/* Mobile cards (≤560px) — same rows as the table below */}
          <div className="team-cards">
            {filtered.length === 0 ? (
              <div className="e-empty">No people match your filters.</div>
            ) : filtered.map(e => {
              const st = (e.lifecycle_status || 'confirmed')
              return (
                <div key={e.id} className="team-card" onClick={()=>navigate('/people/team/'+e.id)}>
                  <div className="avatar av-36" style={e.signedPhoto?{backgroundImage:`url(${e.signedPhoto})`,backgroundSize:'cover',backgroundPosition:'center',filter:st==='exited'?'grayscale(.5)':'none'}:{background:ownerColor(e.full_name), filter: st==='exited'?'grayscale(.5)':'none'}}>{e.signedPhoto?'':initials(e.full_name)}</div>
                  <div className="team-card-mid">
                    <div className="e-nm-name">{e.full_name}</div>
                    <div className="team-card-sub">{e.designation || '—'}{e.branch ? ' · ' + e.branch : ''}</div>
                    <div className="team-card-tags">
                      <span className="dept-pill"><span className="dept-dot" style={{background:deptColor(e.department)}} />{e.department || '—'}</span>
                      <span className={'status '+st}><span className="led" />{STATUS_LABEL[st]||st}</span>
                    </div>
                  </div>
                  <div className="team-card-right">
                    <span className="e-id">{e.employee_code || '—'}</span>
                    <span className={'asset-badge'+(e.assets?'':' zero')}>{e.assets}</span>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="tbl-wrap">
            <div className="etbl">
              <div className="etbl-head">
                <div>Emp ID</div><div>Name</div><div>Department</div><div>Designation · Location</div>
                <div>Login / Role</div><div>Last Login</div><div>Status</div><div style={{textAlign:'right'}}>Devices</div>
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
        <Drawer
          title={createdCreds ? 'Login created' : 'Onboard Team Member'}
          sub={createdCreds ? 'Share these credentials — the password is shown only once.' : 'Record, statutory details, salary & app login — all in one step.'}
          onClose={closeAdd}
          footer={createdCreds
            ? <button className="pd-btn primary" onClick={closeAdd} style={{ marginLeft:'auto' }}>Done</button>
            : <><button className="pd-btn neutral" onClick={closeAdd}>Cancel</button><button className="pd-btn primary" onClick={addMember}>{addForm.create_login ? 'Onboard & create login' : 'Onboard'}</button></>}>

          {createdCreds ? (
            <div style={{ padding:'4px 2px' }}>
              <div style={{ fontSize:13, color:'#276749', background:'#F2FBF6', border:'1px solid #cdeede', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
                ✓ Onboarded. The member must change this password on first login.
              </div>
              {[['Username', createdCreds.username], ['Temp password', createdCreds.password]].map(([l,v]) => (
                <div key={l} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, border:'1px solid #E4E7EC', borderRadius:9, padding:'10px 13px', marginBottom:9 }}>
                  <div><div style={{ fontSize:11, color:'#8C99A8', fontWeight:600 }}>{l}</div><div style={{ fontSize:14, fontFamily:'var(--mono, monospace)', color:'#1D2D3E' }}>{v}</div></div>
                  <button className="btn btn-neutral btn-sm" onClick={()=>{ navigator.clipboard?.writeText(v); toast('Copied.', 'success') }}>Copy</button>
                </div>
              ))}
              <div style={{ fontSize:11.5, color:'#8C99A8', marginTop:6 }}>Login: <b>{createdCreds.username}@ssccontrol.com</b></div>
            </div>
          ) : (<>

          {/* ── Basic ── */}
          <Section title="Basic details" open={openSec.basic} onToggle={()=>setOpenSec(s=>({...s,basic:!s.basic}))}>
            <div className="pd-f"><label>Full name *</label><input value={addForm.full_name} onChange={e=>{ const v=e.target.value; set({ full_name:v, ...(addForm.create_login ? { username: autoUsername(v) } : {}) }) }} placeholder="First Last" autoFocus /></div>
            <div className="pd-2">
              <div className="pd-f"><label>Employee ID</label><input value={addForm.employee_code} onChange={e=>set({employee_code:e.target.value})} placeholder="e.g. 101" /></div>
              <div className="pd-f"><label>Join date</label><input type="date" value={addForm.join_date} onChange={e=>set({join_date:e.target.value})} max={today()} /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Department</label><input value={addForm.department} onChange={e=>set({department:e.target.value})} list="dept-list" placeholder="Department" /><datalist id="dept-list">{depts.map(d=><option key={d} value={d} />)}</datalist></div>
              <div className="pd-f"><label>Branch / Location</label><input value={addForm.branch} onChange={e=>set({branch:e.target.value})} list="loc-list" placeholder="Location" /><datalist id="loc-list">{locs.map(l=><option key={l} value={l} />)}</datalist></div>
            </div>
            <div className="pd-f"><label>Designation</label><input value={addForm.designation} onChange={e=>set({designation:e.target.value})} placeholder="Designation" /></div>
            <div className="pd-2">
              <div className="pd-f"><label>Reporting manager</label><select value={addForm.reporting_manager_id} onChange={e=>set({reporting_manager_id:e.target.value})}><option value="">— none —</option>{managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
              <div className="pd-f"><label>Lifecycle status</label><select value={addForm.lifecycle_status} onChange={e=>set({lifecycle_status:e.target.value})}><option value="probation">Probation (default · 3 months)</option><option value="confirmed">Confirmed</option><option value="notice">Notice</option></select></div>
            </div>
            {addForm.lifecycle_status==='probation' && addForm.join_date && (
              <div style={{fontSize:11.5,color:'#5B738B',background:'#FAFBFC',border:'1px solid #E4E7EC',borderRadius:8,padding:'8px 11px'}}>
                Probation ends <strong style={{color:'#1D2D3E'}}>{new Date(new Date(addForm.join_date).setMonth(new Date(addForm.join_date).getMonth()+3)).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</strong> — confirm them then.
              </div>
            )}
          </Section>

          {/* ── Statutory & Personal (mgmt) ── */}
          {isMgmt && (
          <Section title="Statutory & personal" sub="PAN · Aadhaar · UAN · ESIC" open={openSec.statutory} onToggle={()=>setOpenSec(s=>({...s,statutory:!s.statutory}))}>
            <div className="pd-2">
              <div className="pd-f"><label>Gender</label><select value={addForm.gender} onChange={e=>set({gender:e.target.value})}><option value="">—</option><option>Male</option><option>Female</option><option>Other</option></select></div>
              <div className="pd-f"><label>Marital status</label><select value={addForm.marital_status} onChange={e=>set({marital_status:e.target.value})}><option value="">—</option><option>Single</option><option>Married</option></select></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Date of birth</label><input type="date" value={addForm.date_of_birth} onChange={e=>set({date_of_birth:e.target.value})} max={today()} /></div>
              <div className="pd-f"><label>Personal phone</label><input value={addForm.personal_phone} onChange={e=>set({personal_phone:e.target.value})} placeholder="10-digit" /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Personal email</label><input value={addForm.personal_email} onChange={e=>set({personal_email:e.target.value})} placeholder="name@example.com" /></div>
              <div className="pd-f"><label>Emergency contact</label><input value={addForm.emergency_contact} onChange={e=>set({emergency_contact:e.target.value})} placeholder="Name · phone" /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>PAN</label><input value={addForm.pan} onChange={e=>set({pan:e.target.value})} placeholder="ABCDE1234F" style={{textTransform:'uppercase'}} maxLength={10} /></div>
              <div className="pd-f"><label>Aadhaar</label><input value={addForm.aadhaar} onChange={e=>set({aadhaar:e.target.value})} placeholder="12 digits" maxLength={12} /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>UAN (PF)</label><input value={addForm.uan_no} onChange={e=>set({uan_no:e.target.value})} placeholder="12-digit UAN" /></div>
              <div className="pd-f"><label>ESIC No.</label><input value={addForm.esic_no} onChange={e=>set({esic_no:e.target.value})} placeholder="17-digit IP number" /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Spouse name</label><input value={addForm.spouse_name} onChange={e=>set({spouse_name:e.target.value})} placeholder="—" /></div>
              <div className="pd-f"><label>Spouse phone</label><input value={addForm.spouse_phone} onChange={e=>set({spouse_phone:e.target.value})} placeholder="—" /></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Spouse birthdate</label><input type="date" value={addForm.spouse_dob} onChange={e=>set({spouse_dob:e.target.value})} max={today()} /></div>
              <div className="pd-f"><label>Employment type</label><select value={addForm.is_permanent ? 'perm' : 'contract'} onChange={e=>set({is_permanent: e.target.value==='perm'})}><option value="perm">Permanent</option><option value="contract">Contract</option></select></div>
            </div>
          </Section>
          )}

          {/* ── Salary (mgmt) ── */}
          {isMgmt && (
          <Section title="Salary" sub={salPreview ? `Net ${inr(salPreview.netPayable)}/mo` : 'optional'} open={openSec.salary} onToggle={()=>setOpenSec(s=>({...s,salary:!s.salary}))}>
            <div className="pd-2">
              <div className="pd-f"><label>Annual CTC (₹)</label><input value={addForm.annual_ctc} onChange={e=>set({annual_ctc:e.target.value.replace(/[^\d.]/g,'')})} placeholder="e.g. 600000" inputMode="numeric" /></div>
              <div className="pd-f"><label>Structure ratio</label><select value={addForm.salary_ratio} onChange={e=>set({salary_ratio:e.target.value})}>{Object.keys(RATIOS).map(r=><option key={r} value={r}>{r}</option>)}</select></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Tax regime</label><select value={addForm.tax_regime} onChange={e=>set({tax_regime:e.target.value})}><option value="new">New</option><option value="old">Old</option></select></div>
              <div className="pd-f"><label>PF applicable</label><select value={addForm.pf_applicable ? 'y':'n'} onChange={e=>set({pf_applicable: e.target.value==='y'})}><option value="n">No</option><option value="y">Yes</option></select></div>
            </div>
            <div className="pd-2">
              <div className="pd-f"><label>Professional tax /mo</label><input value={addForm.professional_tax} onChange={e=>set({professional_tax:e.target.value.replace(/[^\d.]/g,'')})} inputMode="numeric" /></div>
              <div className="pd-f"><label>Accidental insurance /mo</label><input value={addForm.accidental_insurance} onChange={e=>set({accidental_insurance:e.target.value.replace(/[^\d.]/g,'')})} inputMode="numeric" /></div>
            </div>
            {salPreview && (
              <div style={{ border:'1px solid #E4E7EC', borderRadius:9, overflow:'hidden', marginTop:4 }}>
                <div style={{ background:'#FAFBFC', padding:'8px 12px', fontSize:11, fontWeight:600, color:'#5B738B', letterSpacing:'0.03em' }}>MONTHLY BREAKUP · {addForm.tax_regime==='old'?'Old':'New'} regime</div>
                <div style={{ padding:'4px 0' }}>
                  {[['Basic',salPreview.basic],['HRA',salPreview.hra],['Travel',salPreview.travelAllowance],['Special',salPreview.specialAllowance],['Gross',salPreview.gross],['PF (employee)',salPreview.pfEmployee],['Gratuity',salPreview.gratuity],['Bonus',salPreview.bonus],['TDS',salPreview.tds],['Total deductions',salPreview.totalDeductions]].map(([l,v])=>(
                    <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'4px 12px', fontSize:12.5, color:'#374151' }}><span style={{color:'#5B738B'}}>{l}</span><span style={{fontFamily:'var(--mono, monospace)'}}>{inr(v)}</span></div>
                  ))}
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'8px 12px', fontSize:13.5, fontWeight:600, color:'#0B1B30', borderTop:'1px solid #E4E7EC', marginTop:2 }}><span>Net payable</span><span style={{fontFamily:'var(--mono, monospace)'}}>{inr(salPreview.netPayable)}</span></div>
                </div>
              </div>
            )}
          </Section>
          )}

          {/* ── App login ── */}
          <Section title="App login" sub={addForm.create_login ? 'will be created' : 'optional'} open={openSec.login} onToggle={()=>setOpenSec(s=>({...s,login:!s.login}))}>
            <label style={{ display:'flex', alignItems:'center', gap:9, cursor:'pointer', fontSize:13, color:'#1D2D3E', marginBottom:addForm.create_login?12:0 }}>
              <input type="checkbox" checked={addForm.create_login} onChange={e=>toggleLogin(e.target.checked)} style={{ width:16, height:16 }} />
              Also create an app login for this member
            </label>
            {addForm.create_login && (<>
              <div className="pd-2">
                <div className="pd-f"><label>Username</label><input value={addForm.username} onChange={e=>set({username:e.target.value.toLowerCase().replace(/[^a-z0-9._]/g,'')})} placeholder="first.last" /></div>
                <div className="pd-f"><label>Role</label><select value={addForm.login_role} onChange={e=>set({login_role:e.target.value})}>{LOGIN_ROLES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
              </div>
              <div className="pd-f"><label>Temp password</label>
                <div style={{ display:'flex', gap:8 }}>
                  <input value={addForm.password} onChange={e=>set({password:e.target.value})} style={{ flex:1 }} />
                  <button className="btn btn-neutral btn-sm" type="button" onClick={()=>set({password:genPassword()})}>New</button>
                </div>
              </div>
              <div style={{ fontSize:11.5, color:'#8C99A8', marginTop:2 }}>Login email will be <b>{(addForm.username||'username')}@ssccontrol.com</b>. They'll be asked to change this password on first login.</div>
              {addForm.login_role==='sales' && (
                <div className="pd-f" style={{ marginTop:12 }}><label>Sales team (target auto-assigns)</label>
                  <select value={addForm.team_id} onChange={e=>set({team_id:e.target.value})}><option value="">— select team —</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
                </div>
              )}
            </>)}
            {!addForm.create_login && (
              <div style={{ fontSize:11.5, color:'#8C99A8', marginTop:8 }}>Sales members appear in KRA/KPI only once a login exists — turn this on to assign their team & target now.</div>
            )}
          </Section>
          </>)}
        </Drawer>
      )}
    </Layout>
  )
}
