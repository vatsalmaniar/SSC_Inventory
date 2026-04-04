import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SOURCES = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const STATUSES = ['New','Contacted','Converted','Not a Fit']

function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}

export default function CRMLeads() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [leads, setLeads]     = useState([])
  const [reps, setReps]       = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [filterRep, setFilterRep] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    const [leadsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_leads').select('*, crm_companies(company_name), crm_principals(name), profiles(name)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])
    setLeads(leadsRes.data || [])
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  const q = search.trim().toLowerCase()
  const isManager = ['admin','ops'].includes(user.role)
  const filtered = leads
    .filter(l => isManager || l.assigned_rep_id === user.id)
    .filter(l => !q || (l.crm_companies?.company_name||l.freetext_company||'').toLowerCase().includes(q) || (l.contact_name_freetext||'').toLowerCase().includes(q) || (l.product_notes||'').toLowerCase().includes(q))
    .filter(l => !filterStatus || l.status === filterStatus)
    .filter(l => !filterSource || l.source === filterSource)
    .filter(l => !filterPrincipal || l.principal_id === filterPrincipal)
    .filter(l => !filterRep || l.assigned_rep_id === filterRep)

  return (
    <Layout pageTitle="CRM — Leads" pageKey="crm">
      <CRMSubNav active="leads" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Leads</div>
              <div className="crm-page-sub">{filtered.length} leads</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn crm-btn-primary" onClick={() => navigate('/crm/leads/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
              </button>
            </div>
          </div>

          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, contact, product..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="crm-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="crm-filter-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              <option value="">All Sources</option>
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="crm-filter-select" value={filterPrincipal} onChange={e => setFilterPrincipal(e.target.value)}>
              <option value="">All Principals</option>
              {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Source</th>
                      <th>Principal</th>
                      <th>Scenario</th>
                      <th>Rep</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(l => (
                      <tr key={l.id} onClick={() => navigate('/crm/leads/' + l.id)}>
                        <td><div className="crm-table-name">{l.crm_companies?.company_name || l.freetext_company || '—'}</div></td>
                        <td>{l.contact_name_freetext || '—'}</td>
                        <td>{l.source || '—'}</td>
                        <td>{l.crm_principals?.name || '—'}</td>
                        <td>{l.scenario_type ? <span className={'crm-scenario-pill crm-scenario-' + l.scenario_type}>{scenarioLabel(l.scenario_type)}</span> : '—'}</td>
                        <td>{l.profiles?.name || '—'}</td>
                        <td style={{whiteSpace:'nowrap'}}>{fmt(l.created_at)}</td>
                        <td>
                          <span style={{fontSize:11,fontWeight:700,borderRadius:4,padding:'2px 7px',
                            background: l.status==='New'?'#e8f2fc': l.status==='Contacted'?'#fff7ed': l.status==='Converted'?'#f0fdf4':'#fef2f2',
                            color: l.status==='New'?'#1a4dab': l.status==='Contacted'?'#c2410c': l.status==='Converted'?'#15803d':'#dc2626'
                          }}>{l.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile */}
              <div className="crm-card-list">
                {filtered.map(l => (
                  <div key={l.id} className="crm-list-card" onClick={() => navigate('/crm/leads/' + l.id)}>
                    <div className="crm-list-card-top">
                      <div>
                        <div className="crm-list-card-name">{l.crm_companies?.company_name || l.freetext_company || '—'}</div>
                        <div className="crm-list-card-sub">{l.contact_name_freetext || ''}{l.crm_principals?.name ? ' · ' + l.crm_principals.name : ''}</div>
                      </div>
                      <span style={{fontSize:11,fontWeight:700,borderRadius:4,padding:'2px 7px',whiteSpace:'nowrap',
                        background: l.status==='New'?'#e8f2fc': l.status==='Contacted'?'#fff7ed': l.status==='Converted'?'#f0fdf4':'#fef2f2',
                        color: l.status==='New'?'#1a4dab': l.status==='Contacted'?'#c2410c': l.status==='Converted'?'#15803d':'#dc2626'
                      }}>{l.status}</span>
                    </div>
                    <div className="crm-list-card-bottom">
                      {l.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + l.scenario_type}>{scenarioLabel(l.scenario_type)}</span>}
                      <span style={{fontSize:11,color:'var(--gray-400)'}}>{fmt(l.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="crm-empty"><div className="crm-empty-title">No leads found</div></div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
