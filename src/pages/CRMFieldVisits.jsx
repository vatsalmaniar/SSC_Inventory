import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const VISIT_TYPES = ['SOLO','JOINT_PRINCIPAL','JOINT_SSC_TEAM']
const VISIT_TYPE_LABELS = { SOLO:'Solo', JOINT_PRINCIPAL:'Joint w/ Principal', JOINT_SSC_TEAM:'Joint SSC Team' }

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}

export default function CRMFieldVisits() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [visits, setVisits]   = useState([])
  const [companies, setCompanies] = useState([])
  const [reps, setReps]       = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [search, setSearch]   = useState('')
  const [filterRep, setFilterRep] = useState('')

  const [form, setForm] = useState({
    visit_date: new Date().toISOString().slice(0,10),
    visit_type: 'SOLO',
    company_id: '',
    company_freetext: '',
    purpose: '',
    outcome: '',
    next_action: '',
    next_action_date: '',
    principal_id: '',
    principal_rep_name: '',
    ssc_team_members: [],
  })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })

    const [visitsRes, companiesRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_field_visits').select('*, crm_companies(company_name), profiles(name), crm_principals(name)').order('visit_date', { ascending: false }),
      sb.from('crm_companies').select('id,company_name').order('company_name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])
    setVisits(visitsRes.data || [])
    setCompanies(companiesRes.data || [])
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  async function saveVisit() {
    if (!form.visit_date) { alert('Visit date is required'); return }
    if (form.visit_type === 'JOINT_PRINCIPAL' && !form.principal_id) { alert('Principal is required for joint principal visits'); return }
    setSaving(true)

    const payload = {
      rep_id: user.id,
      visit_date: form.visit_date,
      visit_type: form.visit_type,
      company_id: form.company_id || null,
      purpose: form.purpose.trim() || null,
      outcome: form.outcome.trim() || null,
      next_action: form.next_action.trim() || null,
      next_action_date: form.next_action_date || null,
      principal_id: form.visit_type === 'JOINT_PRINCIPAL' ? (form.principal_id || null) : null,
      principal_rep_name: form.visit_type === 'JOINT_PRINCIPAL' ? (form.principal_rep_name.trim() || null) : null,
      ssc_team_members: form.visit_type === 'JOINT_SSC_TEAM' ? form.ssc_team_members : [],
    }

    const { error } = await sb.from('crm_field_visits').insert(payload)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }

    const { data: fresh } = await sb.from('crm_field_visits').select('*, crm_companies(company_name), profiles(name), crm_principals(name)').order('visit_date', { ascending: false })
    setVisits(fresh || [])
    setForm({ visit_date: new Date().toISOString().slice(0,10), visit_type:'SOLO', company_id:'', company_freetext:'', purpose:'', outcome:'', next_action:'', next_action_date:'', principal_id:'', principal_rep_name:'', ssc_team_members:[] })
    setShowForm(false); setSaving(false)
  }

  const isManager = ['admin','ops'].includes(user.role)
  const q = search.trim().toLowerCase()
  const filtered = visits
    .filter(v => isManager || v.rep_id === user.id)
    .filter(v => !q || (v.crm_companies?.company_name||'').toLowerCase().includes(q) || (v.purpose||'').toLowerCase().includes(q))
    .filter(v => !filterRep || v.rep_id === filterRep)

  const toggleTeamMember = (repId) => {
    setForm(p => ({
      ...p,
      ssc_team_members: p.ssc_team_members.includes(repId)
        ? p.ssc_team_members.filter(id => id !== repId)
        : [...p.ssc_team_members, repId]
    }))
  }

  return (
    <Layout pageTitle="CRM — Field Visits" pageKey="crm">
      <CRMSubNav active="visits" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Field Visits</div>
              <div className="crm-page-sub">{filtered.length} visits</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn crm-btn-primary" onClick={() => setShowForm(true)}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Log Visit
              </button>
            </div>
          </div>

          {/* Log visit form */}
          {showForm && (
            <div className="crm-card">
              <div className="crm-card-header">
                <div className="crm-card-title">Log Field Visit</div>
                <button className="crm-btn crm-btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
              <div className="crm-card-body">
                <div className="crm-form">
                  <div className="crm-edit-row three">
                    <div className="crm-edit-field">
                      <label>Visit Date *</label>
                      <input type="date" value={form.visit_date} onChange={e => setForm(p=>({...p,visit_date:e.target.value}))} />
                    </div>
                    <div className="crm-edit-field">
                      <label>Visit Type</label>
                      <select value={form.visit_type} onChange={e => setForm(p=>({...p,visit_type:e.target.value}))}>
                        {VISIT_TYPES.map(t => <option key={t} value={t}>{VISIT_TYPE_LABELS[t]}</option>)}
                      </select>
                    </div>
                    <div className="crm-edit-field">
                      <label>Company</label>
                      <select value={form.company_id} onChange={e => setForm(p=>({...p,company_id:e.target.value}))}>
                        <option value="">— Select —</option>
                        {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                      </select>
                    </div>
                  </div>

                  {form.visit_type === 'JOINT_PRINCIPAL' && (
                    <div className="crm-edit-row">
                      <div className="crm-edit-field">
                        <label>Principal *</label>
                        <select value={form.principal_id} onChange={e => setForm(p=>({...p,principal_id:e.target.value}))}>
                          <option value="">— Select —</option>
                          {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="crm-edit-field">
                        <label>Principal Rep Name</label>
                        <input value={form.principal_rep_name} onChange={e => setForm(p=>({...p,principal_rep_name:e.target.value}))} placeholder="Name of principal representative" />
                      </div>
                    </div>
                  )}

                  {form.visit_type === 'JOINT_SSC_TEAM' && (
                    <div className="crm-edit-field">
                      <label>SSC Team Members (select who joined)</label>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                        {reps.filter(r => r.id !== user.id).map(r => (
                          <label key={r.id} style={{display:'flex',alignItems:'center',gap:6,fontSize:13,cursor:'pointer',padding:'4px 10px',border:'1px solid var(--gray-200)',borderRadius:20,background:form.ssc_team_members.includes(r.id)?'#e8f2fc':'white',color:form.ssc_team_members.includes(r.id)?'#1A3A8F':'var(--gray-600)'}}>
                            <input type="checkbox" checked={form.ssc_team_members.includes(r.id)} onChange={() => toggleTeamMember(r.id)} style={{display:'none'}}/>
                            {r.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="crm-edit-field">
                    <label>Purpose / Agenda</label>
                    <textarea rows={2} value={form.purpose} onChange={e => setForm(p=>({...p,purpose:e.target.value}))} className="crm-activity-textarea" style={{minHeight:50}} placeholder="What was the visit about?"/>
                  </div>
                  <div className="crm-edit-field">
                    <label>Outcome</label>
                    <textarea rows={2} value={form.outcome} onChange={e => setForm(p=>({...p,outcome:e.target.value}))} className="crm-activity-textarea" style={{minHeight:50}} placeholder="What was discussed / decided?"/>
                  </div>
                  <div className="crm-edit-row">
                    <div className="crm-edit-field">
                      <label>Next Action</label>
                      <input value={form.next_action} onChange={e => setForm(p=>({...p,next_action:e.target.value}))} placeholder="Follow-up action (optional)"/>
                    </div>
                    <div className="crm-edit-field">
                      <label>Next Action Date</label>
                      <input type="date" value={form.next_action_date} onChange={e => setForm(p=>({...p,next_action_date:e.target.value}))}/>
                    </div>
                  </div>
                  <div className="crm-form-actions">
                    <button className="crm-btn" onClick={() => setShowForm(false)}>Cancel</button>
                    <button className="crm-btn crm-btn-primary" onClick={saveVisit} disabled={saving}>{saving?'Saving...':'Save Visit'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, purpose..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isManager && (
              <select className="crm-filter-select" value={filterRep} onChange={e => setFilterRep(e.target.value)}>
                <option value="">All Reps</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/>Loading...</div>
          ) : (
            <div className="crm-card">
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Type</th>
                      <th>Purpose</th>
                      <th>Outcome</th>
                      <th>Next Action</th>
                      <th>Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(v => (
                      <tr key={v.id} style={{cursor:'default'}}>
                        <td style={{whiteSpace:'nowrap',fontWeight:600}}>{fmt(v.visit_date)}</td>
                        <td><div className="crm-table-name">{v.crm_companies?.company_name || '—'}</div></td>
                        <td>
                          <span style={{fontSize:10,fontWeight:700,borderRadius:4,padding:'2px 7px',
                            background: v.visit_type==='SOLO'?'#f1f5f9':v.visit_type==='JOINT_PRINCIPAL'?'#e8f2fc':'#f5f3ff',
                            color: v.visit_type==='SOLO'?'#475569':v.visit_type==='JOINT_PRINCIPAL'?'#1a4dab':'#6d28d9'
                          }}>{VISIT_TYPE_LABELS[v.visit_type]}</span>
                          {v.visit_type==='JOINT_PRINCIPAL' && v.crm_principals?.name && <div className="crm-table-sub">{v.crm_principals.name}{v.principal_rep_name?' · '+v.principal_rep_name:''}</div>}
                        </td>
                        <td style={{maxWidth:200}}>{v.purpose || '—'}</td>
                        <td style={{maxWidth:200}}>{v.outcome || '—'}</td>
                        <td>{v.next_action ? <div><div style={{fontSize:12}}>{v.next_action}</div>{v.next_action_date && <div style={{fontSize:11,color:'var(--gray-400)'}}>{fmt(v.next_action_date)}</div>}</div> : '—'}</td>
                        <td>{v.profiles?.name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile */}
              <div className="crm-card-list">
                {filtered.map(v => (
                  <div key={v.id} className="crm-list-card" style={{cursor:'default'}}>
                    <div className="crm-list-card-top">
                      <div>
                        <div className="crm-list-card-name">{v.crm_companies?.company_name || '—'}</div>
                        <div className="crm-list-card-sub">{VISIT_TYPE_LABELS[v.visit_type]}{v.crm_principals?.name?' · '+v.crm_principals.name:''}</div>
                      </div>
                      <span style={{fontSize:11,color:'var(--gray-500)',whiteSpace:'nowrap'}}>{fmt(v.visit_date)}</span>
                    </div>
                    {v.purpose && <div style={{fontSize:12,color:'var(--gray-600)',margin:'4px 0'}}>{v.purpose}</div>}
                    {v.outcome && <div style={{fontSize:12,color:'var(--gray-600)'}}>{v.outcome}</div>}
                    {v.next_action && <div style={{fontSize:12,color:'#1A3A8F',marginTop:4}}>Next: {v.next_action}{v.next_action_date?' · '+fmt(v.next_action_date):''}</div>}
                    <div style={{fontSize:11,color:'var(--gray-400)',marginTop:6}}>{v.profiles?.name}</div>
                  </div>
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="crm-empty"><div className="crm-empty-title">No visits found</div></div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
