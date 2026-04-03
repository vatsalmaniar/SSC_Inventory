import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const INDUSTRIES = ['Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal','Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG','Energy','Automobile','Power Electronics','Datacenters','Road Construction','Cement','Tyre','Petroleum','Chemical']
const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']
const STATUSES = ['Active','Dormant','Blacklisted']

export default function CRMCompanies() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', role: '', id: '' })
  const [companies, setCompanies] = useState([])
  const [reps, setReps]       = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterType, setFilterType]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({ company_name:'', gstin:'', city:'', address:'', customer_type:'', industry:'', status:'Active', assigned_rep_id:'' })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    const [compRes, repsRes] = await Promise.all([
      sb.from('crm_companies').select('*, profiles(name)').order('company_name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])
    setCompanies(compRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)
  }

  async function saveCompany() {
    if (!form.company_name.trim()) { alert('Company name is required'); return }
    setSaving(true)
    const { data, error } = await sb.from('crm_companies').insert({
      ...form,
      assigned_rep_id: form.assigned_rep_id || user.id,
    }).select('*, profiles(name)').single()
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setCompanies(prev => [data, ...prev])
    setShowForm(false)
    setForm({ company_name:'', gstin:'', city:'', address:'', customer_type:'', industry:'', status:'Active', assigned_rep_id:'' })
    setSaving(false)
    navigate('/crm/companies/' + data.id)
  }

  const q = search.trim().toLowerCase()
  const filtered = companies
    .filter(c => !q || c.company_name?.toLowerCase().includes(q) || c.city?.toLowerCase().includes(q))
    .filter(c => !filterType || c.customer_type === filterType)
    .filter(c => !filterStatus || c.status === filterStatus)
    .filter(c => !filterIndustry || c.industry === filterIndustry)

  function statusColor(s) {
    if (s === 'Active') return { background:'#f0fdf4', color:'#15803d' }
    if (s === 'Dormant') return { background:'#fffbeb', color:'#b45309' }
    if (s === 'Blacklisted') return { background:'#fef2f2', color:'#dc2626' }
    return {}
  }

  return (
    <Layout pageTitle="CRM — Companies" pageKey="crm">
      <CRMSubNav active="companies" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Companies</div>
              <div className="crm-page-sub">{companies.length} companies</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn crm-btn-primary" onClick={() => setShowForm(true)}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Company
              </button>
            </div>
          </div>

          {/* Add form */}
          {showForm && (
            <div className="crm-card">
              <div className="crm-card-header">
                <div className="crm-card-title">New Company</div>
                <button className="crm-btn crm-btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
              </div>
              <div className="crm-card-body">
                <div className="crm-form">
                  <div className="crm-edit-row">
                    <div className="crm-edit-field">
                      <label>Company Name *</label>
                      <input value={form.company_name} onChange={e => setForm(p=>({...p,company_name:e.target.value}))} placeholder="ABC Industries Pvt. Ltd." />
                    </div>
                    <div className="crm-edit-field">
                      <label>City</label>
                      <input value={form.city} onChange={e => setForm(p=>({...p,city:e.target.value}))} placeholder="Ahmedabad" />
                    </div>
                  </div>
                  <div className="crm-edit-row three">
                    <div className="crm-edit-field">
                      <label>Customer Type</label>
                      <select value={form.customer_type} onChange={e => setForm(p=>({...p,customer_type:e.target.value}))}>
                        <option value="">— Select —</option>
                        {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="crm-edit-field">
                      <label>Industry</label>
                      <select value={form.industry} onChange={e => setForm(p=>({...p,industry:e.target.value}))}>
                        <option value="">— Select —</option>
                        {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                    <div className="crm-edit-field">
                      <label>Assigned Rep</label>
                      <select value={form.assigned_rep_id} onChange={e => setForm(p=>({...p,assigned_rep_id:e.target.value}))}>
                        <option value="">— Self —</option>
                        {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="crm-edit-row">
                    <div className="crm-edit-field">
                      <label>GSTIN</label>
                      <input value={form.gstin} onChange={e => setForm(p=>({...p,gstin:e.target.value}))} placeholder="24ABCDE1234F1Z5" />
                    </div>
                    <div className="crm-edit-field">
                      <label>Address</label>
                      <input value={form.address} onChange={e => setForm(p=>({...p,address:e.target.value}))} placeholder="Full address" />
                    </div>
                  </div>
                  <div className="crm-form-actions">
                    <button className="crm-btn" onClick={() => setShowForm(false)}>Cancel</button>
                    <button className="crm-btn crm-btn-primary" onClick={saveCompany} disabled={saving}>{saving ? 'Saving...' : 'Save & Open'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company or city..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="crm-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="crm-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="crm-filter-select" value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)}>
              <option value="">All Industries</option>
              {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin" />Loading...</div>
          ) : (
            <div className="crm-card">
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Type</th>
                      <th>Industry</th>
                      <th>City</th>
                      <th>Rep</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(c => (
                      <tr key={c.id} onClick={() => navigate('/crm/companies/' + c.id)}>
                        <td>
                          <div className="crm-table-name">{c.company_name}</div>
                          {c.gstin && <div className="crm-table-sub">{c.gstin}</div>}
                        </td>
                        <td>{c.customer_type || '—'}</td>
                        <td>{c.industry || '—'}</td>
                        <td>{c.city || '—'}</td>
                        <td>{c.profiles?.name || '—'}</td>
                        <td><span style={{...statusColor(c.status), fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 7px'}}>{c.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile */}
              <div className="crm-card-list">
                {filtered.map(c => (
                  <div key={c.id} className="crm-list-card" onClick={() => navigate('/crm/companies/' + c.id)}>
                    <div className="crm-list-card-top">
                      <div>
                        <div className="crm-list-card-name">{c.company_name}</div>
                        <div className="crm-list-card-sub">{c.customer_type || ''}{c.industry ? ' · ' + c.industry : ''}{c.city ? ' · ' + c.city : ''}</div>
                      </div>
                      <span style={{...statusColor(c.status), fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap'}}>{c.status}</span>
                    </div>
                    <div className="crm-list-card-bottom">
                      <span style={{fontSize:12,color:'var(--gray-500)'}}>{c.profiles?.name || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="crm-empty">
                  <div className="crm-empty-title">No companies found</div>
                  <div className="crm-empty-sub">Try adjusting your filters or add a new company.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
