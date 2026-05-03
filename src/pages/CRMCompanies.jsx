import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm.css'
import '../styles/crm-redesign.css'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'

const INDUSTRIES = ['Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal','Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG','Energy','Automobile','Power Electronics','Datacenters','Road Construction','Cement','Tyre','Petroleum','Chemical']
const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']
const STATUSES = ['Active','Dormant','Blacklisted']
const STATUS_COLORS = { Active:'#22C55E', Dormant:'#F59E0B', Blacklisted:'#EF4444' }

const _OC = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function initials(name) { return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }

export default function CRMCompanies() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [companies, setCompanies] = useState([])
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ company_name:'', gstin:'', city:'', address:'', customer_type:'', industry:'', status:'Active', assigned_rep_id:'' })
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    const [compRes, repsRes] = await Promise.all([
      sb.from('crm_companies').select('*, profiles(name)').order('company_name'),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    setCompanies(compRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)
  }

  async function saveCompany() {
    if (!form.company_name.trim()) { toast('Company name is required'); return }
    setSaving(true)
    const { data, error } = await sb.from('crm_companies').insert({
      ...form, assigned_rep_id: form.assigned_rep_id || user.id,
    }).select('*, profiles(name)').single()
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    setCompanies(prev => [data, ...prev])
    setShowForm(false)
    setForm({ company_name:'', gstin:'', city:'', address:'', customer_type:'', industry:'', status:'Active', assigned_rep_id:'' })
    toast('Company created', 'success')
    setSaving(false)
    navigate('/crm/companies/' + data.id)
  }

  const q = search.trim().toLowerCase()
  const filtered = companies
    .filter(c => !q || c.company_name?.toLowerCase().includes(q) || c.city?.toLowerCase().includes(q))
    .filter(c => !filterType || c.customer_type === filterType)
    .filter(c => !filterStatus || c.status === filterStatus)
    .filter(c => !filterIndustry || c.industry === filterIndustry)
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const counts = {
    Active: companies.filter(c => c.status === 'Active').length,
    Dormant: companies.filter(c => c.status === 'Dormant').length,
    Blacklisted: companies.filter(c => c.status === 'Blacklisted').length,
  }

  return (
    <Layout pageTitle="CRM — Companies" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Companies</h1>
            <div className="opps-summary">
              <span><b>{filtered.length}</b> companies</span>
              {counts.Active > 0 && (<><span className="opps-dot">·</span><span style={{ color:'#047857' }}><b style={{ color:'#047857' }}>{counts.Active}</b> active</span></>)}
              {counts.Dormant > 0 && (<><span className="opps-dot">·</span><span style={{ color:'#B45309' }}><b style={{ color:'#B45309' }}>{counts.Dormant}</b> dormant</span></>)}
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              Add Company
            </button>
          </div>
        </div>

        {/* Add company form */}
        {showForm && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <div>
                <div className="card-eyebrow">Create</div>
                <div className="card-title">New Company</div>
              </div>
              <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, padding:'4px 0' }}>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>Company Name *</label>
                <input value={form.company_name} onChange={e => setForm(p=>({...p,company_name:e.target.value}))} placeholder="ABC Industries Pvt. Ltd." style={inpStyle}/>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>City</label>
                <input value={form.city} onChange={e => setForm(p=>({...p,city:e.target.value}))} placeholder="Ahmedabad" style={inpStyle}/>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>Customer Type</label>
                <select value={form.customer_type} onChange={e => setForm(p=>({...p,customer_type:e.target.value}))} style={inpStyle}>
                  <option value="">— Select —</option>
                  {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>Industry</label>
                <select value={form.industry} onChange={e => setForm(p=>({...p,industry:e.target.value}))} style={inpStyle}>
                  <option value="">— Select —</option>
                  {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>Assigned Rep</label>
                <select value={form.assigned_rep_id} onChange={e => setForm(p=>({...p,assigned_rep_id:e.target.value}))} style={inpStyle}>
                  <option value="">— Self —</option>
                  {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>GSTIN</label>
                <input value={form.gstin} onChange={e => setForm(p=>({...p,gstin:e.target.value}))} placeholder="24ABCDE1234F1Z5" style={inpStyle}/>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--c-muted)', display:'block', marginBottom:4 }}>Address</label>
                <input value={form.address} onChange={e => setForm(p=>({...p,address:e.target.value}))} placeholder="Full address" style={inpStyle}/>
              </div>
              <div style={{ gridColumn: '1 / -1', display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveCompany} disabled={saving}>{saving ? 'Saving…' : 'Save & Open'}</button>
              </div>
            </div>
          </div>
        )}

        <div className="opps-filters">
          <div className="opps-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search company or city…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
          </div>
          <select className="filt-select" value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1) }}>
            <option value="">Type: All</option>
            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="filt-select" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
            <option value="">Status: All</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filt-select" value={filterIndustry} onChange={e => { setFilterIndustry(e.target.value); setPage(1) }}>
            <option value="">Industry: All</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          {(search || filterType || filterStatus || filterIndustry) && (
            <button className="opps-clear" onClick={() => { setSearch(''); setFilterType(''); setFilterStatus(''); setFilterIndustry(''); setPage(1) }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="crm-loading">Loading companies…</div>
        ) : (
          <div className="dl-wrap">
            <div className="dl-row dl-head" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) 130px minmax(0, 1fr) 130px 130px 120px' }}>
              <div>Company</div>
              <div>Type</div>
              <div>Industry</div>
              <div>City</div>
              <div>Owner</div>
              <div>Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="dl-empty">No companies found</div>
            ) : (
              <div className="dl-table">
                {paged.map(c => {
                  const color = STATUS_COLORS[c.status] || '#94A3B8'
                  return (
                    <div key={c.id} className="dl-row dl-data" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) 130px minmax(0, 1fr) 130px 130px 120px' }} onClick={() => navigate('/crm/companies/' + c.id)}>
                      <div className="dl-cell dl-deal">
                        <div className="dl-title">{c.company_name}</div>
                        {c.gstin && <div className="dl-deal-meta"><span style={{ fontFamily:'Geist Mono, monospace', fontSize: 10.5 }}>{c.gstin}</span></div>}
                      </div>
                      <div className="dl-cell"><span className="dl-pr-tag">{c.customer_type || '—'}</span></div>
                      <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.industry || '—'}</div>
                      <div className="dl-cell" style={{ fontSize: 12.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.city || '—'}</div>
                      <div className="dl-cell">
                        {c.profiles?.name ? (
                          <div className="dl-owner" title={c.profiles.name}>
                            <div className="dl-owner-avatar" style={{ background: ownerColor(c.profiles.name) }}>{initials(c.profiles.name)}</div>
                            <span className="dl-owner-name">{c.profiles.name}</span>
                          </div>
                        ) : <span style={{color:'var(--c-muted-2)'}}>—</span>}
                      </div>
                      <div className="dl-cell">
                        <span className="dl-stage-pill" style={{ '--stage-color': color }}>
                          <span className="dl-stage-dot"/>
                          {c.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length > 0 && totalPages > 1 && (
              <div className="dl-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div style={{ display:'flex', gap:6 }}>
                  <button className="btn-ghost" disabled={safePage <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span style={{ padding: '6px 8px', fontSize: 12 }}>Page {safePage} / {totalPages}</span>
                  <button className="btn-ghost" disabled={safePage >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

const inpStyle = {
  width:'100%', padding:'8px 12px', border:'1px solid var(--c-line)', borderRadius:7, fontSize:13,
  fontFamily:'inherit', outline:'none', boxSizing:'border-box', background:'#fff',
}
