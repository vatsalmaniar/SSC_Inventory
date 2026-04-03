import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const STAGES = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','TECHNO_COMMERCIAL','FOLLOW_UP','QUOTATION_SENT','PO_RECEIVED']
const TERMINAL = ['WON','LOST','ON_HOLD']
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  TECHNO_COMMERCIAL:'Techno-Comm', FOLLOW_UP:'Follow Up', QUOTATION_SENT:'Quote Sent',
  PO_RECEIVED:'PO Received', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']

function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function fmtINR(v) {
  if (!v) return null
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}
function isOverdue(opp) {
  if (opp.stage !== 'FOLLOW_UP') return false
  const lastAct = opp._lastActivity
  if (!lastAct) return true
  return (Date.now() - new Date(lastAct).getTime()) > 7 * 24 * 60 * 60 * 1000
}

export default function CRMOpportunities() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [opps, setOpps]       = useState([])
  const [reps, setReps]       = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView]       = useState('kanban')
  const [search, setSearch]   = useState('')
  const [filterStage, setFilterStage]     = useState('')
  const [filterRep, setFilterRep]         = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [filterScenario, setFilterScenario]   = useState('')
  const [showTerminal, setShowTerminal]   = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })

    const [oppsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*, crm_companies(company_name), crm_principals(name), crm_contacts(name), profiles(name)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])

    // Fetch last activity per opportunity
    const oppIds = (oppsRes.data || []).map(o => o.id)
    let actMap = {}
    if (oppIds.length > 0) {
      const { data: acts } = await sb.from('crm_activities').select('opportunity_id, created_at').in('opportunity_id', oppIds).order('created_at', { ascending: false })
      ;(acts || []).forEach(a => { if (!actMap[a.opportunity_id]) actMap[a.opportunity_id] = a.created_at })
    }

    const enriched = (oppsRes.data || []).map(o => ({ ...o, _lastActivity: actMap[o.id] || null }))
    setOpps(enriched)
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  const isManager = ['admin','ops'].includes(user.role)
  const q = search.trim().toLowerCase()
  const filtered = opps
    .filter(o => isManager || o.assigned_rep_id === user.id)
    .filter(o => !q || (o.crm_companies?.company_name||'').toLowerCase().includes(q) || (o.product_notes||'').toLowerCase().includes(q) || (o.crm_principals?.name||'').toLowerCase().includes(q))
    .filter(o => !filterStage || o.stage === filterStage)
    .filter(o => !filterRep || o.assigned_rep_id === filterRep)
    .filter(o => !filterPrincipal || o.principal_id === filterPrincipal)
    .filter(o => !filterScenario || o.scenario_type === filterScenario)
    .filter(o => showTerminal ? true : !TERMINAL.includes(o.stage))

  const totalValue = filtered.filter(o => !TERMINAL.includes(o.stage) || o.stage === 'WON').reduce((s, o) => s + (o.estimated_value_inr || 0), 0)
  const overdueCount = filtered.filter(o => isOverdue(o)).length

  return (
    <Layout pageTitle="CRM — Opportunities" pageKey="crm">
      <CRMSubNav active="opportunities" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Opportunities</div>
              <div className="crm-page-sub">
                {filtered.filter(o => !TERMINAL.includes(o.stage)).length} open
                {totalValue > 0 ? ' · ' + fmtINR(totalValue) + ' pipeline' : ''}
                {overdueCount > 0 ? <span style={{color:'#dc2626',marginLeft:6}}>· {overdueCount} overdue</span> : null}
              </div>
            </div>
            <div className="crm-header-actions">
              <div style={{display:'flex',gap:0,border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden'}}>
                <button className={'crm-btn crm-btn-sm' + (view==='kanban'?' crm-btn-primary':'')} style={{borderRadius:0,border:'none'}} onClick={() => setView('kanban')}>Kanban</button>
                <button className={'crm-btn crm-btn-sm' + (view==='list'?' crm-btn-primary':'')} style={{borderRadius:0,border:'none',borderLeft:'1px solid var(--gray-200)'}} onClick={() => setView('list')}>List</button>
              </div>
              <button className="crm-btn crm-btn-primary" onClick={() => navigate('/crm/opportunities/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Opportunity
              </button>
            </div>
          </div>

          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, product, principal..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="crm-filter-select" value={filterStage} onChange={e => setFilterStage(e.target.value)}>
              <option value="">All Stages</option>
              {[...STAGES,...TERMINAL].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
            <select className="crm-filter-select" value={filterScenario} onChange={e => setFilterScenario(e.target.value)}>
              <option value="">All Scenarios</option>
              {SCENARIOS.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}
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
            <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:'var(--gray-500)',cursor:'pointer',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={showTerminal} onChange={e => setShowTerminal(e.target.checked)} />
              Show Won/Lost/Hold
            </label>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/>Loading...</div>
          ) : view === 'kanban' ? (
            <KanbanView opps={filtered} navigate={navigate} />
          ) : (
            <ListView opps={filtered} navigate={navigate} />
          )}
        </div>
      </div>
    </Layout>
  )
}

function KanbanView({ opps, navigate }) {
  const allCols = [...STAGES, ...TERMINAL]
  return (
    <div className="crm-kanban">
      {allCols.map(stage => {
        const cards = opps.filter(o => o.stage === stage)
        if (cards.length === 0 && TERMINAL.includes(stage)) return null
        return (
          <div key={stage} className="crm-kanban-col">
            <div className="crm-kanban-col-header">
              <div className="crm-kanban-col-label">{STAGE_LABELS[stage]}</div>
              <div className="crm-kanban-col-count">{cards.length}</div>
            </div>
            {cards.map(o => (
              <div key={o.id} className="crm-kanban-card" onClick={() => navigate('/crm/opportunities/' + o.id)}>
                <div className="crm-kanban-company">{o.crm_companies?.company_name || '—'}</div>
                {o.product_notes && <div className="crm-kanban-product">{o.product_notes.slice(0,60)}{o.product_notes.length > 60 ? '…' : ''}</div>}
                <div className="crm-kanban-meta">
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                    {o.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type} style={{fontSize:9}}>{scenarioLabel(o.scenario_type)}</span>}
                    {isOverdue(o) && <span className="crm-kanban-overdue">OVERDUE</span>}
                  </div>
                  {o.estimated_value_inr && <div className="crm-kanban-value">{fmtINR(o.estimated_value_inr)}</div>}
                </div>
                {o.profiles?.name && <div style={{fontSize:10,color:'var(--gray-400)',marginTop:4}}>{o.profiles.name}</div>}
              </div>
            ))}
            {cards.length === 0 && (
              <div style={{textAlign:'center',fontSize:11,color:'var(--gray-300)',padding:'12px 0'}}>Empty</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ListView({ opps, navigate }) {
  return (
    <div className="crm-card">
      <div className="crm-table-wrap">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Principal</th>
              <th>Scenario</th>
              <th>Stage</th>
              <th>Value</th>
              <th>Rep</th>
              <th>Close Date</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {opps.map(o => (
              <tr key={o.id} onClick={() => navigate('/crm/opportunities/' + o.id)}>
                <td>
                  <div className="crm-table-name">{o.crm_companies?.company_name || '—'}</div>
                  {o.product_notes && <div className="crm-table-sub">{o.product_notes.slice(0,40)}{o.product_notes.length > 40 ? '…' : ''}</div>}
                </td>
                <td>{o.crm_principals?.name || '—'}</td>
                <td>{o.scenario_type ? <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type}>{scenarioLabel(o.scenario_type)}</span> : '—'}</td>
                <td><StagePill stage={o.stage} /></td>
                <td style={{whiteSpace:'nowrap',fontWeight:600}}>{fmtINR(o.estimated_value_inr) || '—'}</td>
                <td>{o.profiles?.name || '—'}</td>
                <td style={{whiteSpace:'nowrap'}}>{fmt(o.expected_close_date)}</td>
                <td>{isOverdue(o) && <span className="crm-overdue-badge">Overdue</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="crm-card-list">
        {opps.map(o => (
          <div key={o.id} className="crm-list-card" onClick={() => navigate('/crm/opportunities/' + o.id)}>
            <div className="crm-list-card-top">
              <div>
                <div className="crm-list-card-name">{o.crm_companies?.company_name || '—'}</div>
                <div className="crm-list-card-sub">{o.crm_principals?.name || ''}{o.product_notes ? ' · ' + o.product_notes.slice(0,40) : ''}</div>
              </div>
              <StagePill stage={o.stage} />
            </div>
            <div className="crm-list-card-bottom">
              {o.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type}>{scenarioLabel(o.scenario_type)}</span>}
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                {isOverdue(o) && <span className="crm-overdue-badge">Overdue</span>}
                {o.estimated_value_inr && <span style={{fontSize:12,fontWeight:700,color:'var(--gray-700)'}}>{fmtINR(o.estimated_value_inr)}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {opps.length === 0 && <div className="crm-empty"><div className="crm-empty-title">No opportunities found</div></div>}
    </div>
  )
}

function StagePill({ stage }) {
  const styles = {
    WON:  { background:'#f0fdf4', color:'#15803d' },
    LOST: { background:'#fef2f2', color:'#dc2626' },
    ON_HOLD: { background:'#fffbeb', color:'#b45309' },
    FOLLOW_UP: { background:'#fff7ed', color:'#c2410c' },
    QUOTATION_SENT: { background:'#eff6ff', color:'#1d4ed8' },
    PO_RECEIVED: { background:'#f0fdf4', color:'#15803d' },
  }
  const s = styles[stage] || { background:'#f1f5f9', color:'#475569' }
  return <span style={{...s, fontSize:10, fontWeight:700, borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap'}}>{STAGE_LABELS[stage] || stage}</span>
}
