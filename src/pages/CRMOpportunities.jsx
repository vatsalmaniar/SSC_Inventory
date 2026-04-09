import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import NewOppModal from './CRMNewOpportunity'
import '../styles/crm.css'
import '../styles/orders.css'

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }

const STAGES = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','BOM_RECEIVED','QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION']
const TERMINAL = ['WON','LOST','ON_HOLD']
const LEAD_STAGES = ['LEAD_CAPTURED','CONTACTED','QUALIFIED']
function recordType(stage) { return LEAD_STAGES.includes(stage) ? 'Lead' : 'Opportunity' }
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
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
  const [view, setView]       = useState('list')
  const [search, setSearch]   = useState('')
  const [filterStage, setFilterStage]     = useState('')
  const [filterRep, setFilterRep]         = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [filterScenario, setFilterScenario]   = useState('')
  const [showNewModal, setShowNewModal]   = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }

    const [oppsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*, crm_companies(company_name), crm_principals(name), crm_contacts(name), profiles(name), customers(customer_name)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
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

  const isManager = user.role === 'admin'
  const q = search.trim().toLowerCase()
  const filtered = opps
    .filter(o => isManager || o.assigned_rep_id === user.id)
    .filter(o => !q || (o.crm_companies?.company_name||o.customers?.customer_name||o.freetext_company||'').toLowerCase().includes(q) || (o.product_notes||'').toLowerCase().includes(q) || (o.crm_principals?.name||'').toLowerCase().includes(q))
    .filter(o => !filterStage || o.stage === filterStage)
    .filter(o => !filterRep || o.assigned_rep_id === filterRep)
    .filter(o => !filterPrincipal || o.principal_id === filterPrincipal)
    .filter(o => !filterScenario || o.scenario_type === filterScenario)

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
              <button className="new-order-btn" onClick={() => setShowNewModal(true)}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
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
      {showNewModal && (
        <NewOppModal
          currentUser={user}
          onClose={() => setShowNewModal(false)}
          onCreated={newId => { setShowNewModal(false); navigate('/crm/opportunities/' + newId) }}
        />
      )}
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
            {cards.map(o => {
              const type = recordType(o.stage)
              return (
              <div key={o.id} className="crm-kanban-card" onClick={() => navigate('/crm/opportunities/' + o.id)}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:4,marginBottom:2}}>
                  <div className="crm-kanban-company">{o.opportunity_name || o.crm_companies?.company_name || '—'}</div>
                  <span style={{ fontSize:9, fontWeight:700, borderRadius:4, padding:'1px 5px', flexShrink:0, background: type==='Lead'?'#fef3c7':'#eff6ff', color: type==='Lead'?'#b45309':'#1d4ed8' }}>{type}</span>
                </div>
                {o.crm_companies?.company_name && o.opportunity_name && <div style={{fontSize:10,color:'var(--gray-400)',marginBottom:2}}>{o.crm_companies.company_name}</div>}
                {o.product_notes && <div className="crm-kanban-product">{o.product_notes.slice(0,60)}{o.product_notes.length > 60 ? '…' : ''}</div>}
                <div className="crm-kanban-meta">
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',alignItems:'center'}}>
                    {o.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type} style={{fontSize:9}}>{scenarioLabel(o.scenario_type)}</span>}
                    {isOverdue(o) && <span className="crm-kanban-overdue">OVERDUE</span>}
                  </div>
                  {o.estimated_value_inr && <div className="crm-kanban-value">{fmtINR(o.estimated_value_inr)}</div>}
                </div>
                {o.profiles?.name && <div style={{marginTop:6}}><OwnerChip name={o.profiles.name} /></div>}
              </div>
            )})}
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
              <th>Opportunity</th>
              <th>Company</th>
              <th>Account Owner</th>
              <th>Stage</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {opps.map(o => {
              const type = recordType(o.stage)
              return (
                <tr key={o.id} onClick={() => navigate('/crm/opportunities/' + o.id)}>
                  <td>
                    <div className="crm-table-name">{o.opportunity_name || '—'}</div>
                    {isOverdue(o) && <span className="crm-overdue-badge" style={{marginTop:3,display:'inline-block'}}>Overdue</span>}
                  </td>
                  <td>
                    <div style={{fontWeight:500,fontSize:13}}>{o.crm_companies?.company_name || o.customers?.customer_name || o.freetext_company || '—'}</div>
                    {o.crm_principals?.name && <div className="crm-table-sub">{o.crm_principals.name}</div>}
                  </td>
                  <td><OwnerChip name={o.profiles?.name} /></td>
                  <td><StagePill stage={o.stage} /></td>
                  <td style={{whiteSpace:'nowrap',fontWeight:600}}>{fmtINR(o.estimated_value_inr) || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="crm-card-list">
        {opps.map(o => {
          const type = recordType(o.stage)
          return (
          <div key={o.id} className="crm-list-card" onClick={() => navigate('/crm/opportunities/' + o.id)}>
            <div className="crm-list-card-top">
              <div>
                <div className="crm-list-card-name">{o.opportunity_name || o.crm_companies?.company_name || '—'}</div>
                <div className="crm-list-card-sub">{o.crm_companies?.company_name || o.customers?.customer_name || o.freetext_company || ''}{o.crm_principals?.name ? ' · ' + o.crm_principals.name : ''}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                <span style={{ fontSize:9, fontWeight:700, borderRadius:4, padding:'2px 6px', background: type==='Lead'?'#fef3c7':'#eff6ff', color: type==='Lead'?'#b45309':'#1d4ed8' }}>{type}</span>
                <StagePill stage={o.stage} />
              </div>
            </div>
            <div className="crm-list-card-bottom">
              {o.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type}>{scenarioLabel(o.scenario_type)}</span>}
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                {isOverdue(o) && <span className="crm-overdue-badge">Overdue</span>}
                {o.estimated_value_inr && <span style={{fontSize:12,fontWeight:700,color:'var(--gray-700)'}}>{fmtINR(o.estimated_value_inr)}</span>}
              </div>
              {o.profiles?.name && <div style={{marginTop:4}}><OwnerChip name={o.profiles.name} /></div>}
            </div>
          </div>
        )})}
      </div>
      {opps.length === 0 && <div className="crm-empty"><div className="crm-empty-title">No leads or opportunities found</div></div>}
    </div>
  )
}

function StagePill({ stage }) {
  const styles = {
    WON:  { background:'#f0fdf4', color:'#15803d' },
    LOST: { background:'#fef2f2', color:'#dc2626' },
    ON_HOLD: { background:'#fffbeb', color:'#b45309' },
    FOLLOW_UP: { background:'#fff7ed', color:'#c2410c' },
    QUOTATION_SENT: { background:'#e8f2fc', color:'#1a4dab' },
    BOM_RECEIVED:      { background:'#f5f3ff', color:'#7c3aed' },
    FINAL_NEGOTIATION: { background:'#fef9c3', color:'#854d0e' },
  }
  const s = styles[stage] || { background:'#f1f5f9', color:'#475569' }
  return <span style={{...s, fontSize:10, fontWeight:700, borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap'}}>{STAGE_LABELS[stage] || stage}</span>
}
