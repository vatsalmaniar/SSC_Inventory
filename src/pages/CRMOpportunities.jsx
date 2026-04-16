import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
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
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }

    const [oppsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_opportunities').select('id,opportunity_name,product_notes,estimated_value_inr,stage,expected_close_date,assigned_rep_id,scenario_type,created_at,updated_at,company_id,contact_id,principal_id,customer_id,quotation_value_inr,won_lost_on_hold_reason,revisit_date, crm_companies(company_name), crm_principals(name), crm_contacts(name), profiles(name), customers(customer_name), crm_activities(created_at)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])

    const enriched = (oppsRes.data || []).map(o => {
      const acts = (o.crm_activities || []).map(a => a.created_at).filter(Boolean).sort().reverse()
      return { ...o, _lastActivity: acts[0] || null }
    })
    setOpps(enriched)
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  async function moveStage(oppId, newStage) {
    const opp = opps.find(o => o.id === oppId)
    if (!opp || opp.stage === newStage) return
    const { error } = await sb.from('crm_opportunities').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', oppId)
    if (error) { toast('Failed to move: ' + error.message); return }
    await sb.from('crm_activities').insert({ opportunity_id: oppId, rep_id: user.id, activity_type: 'Stage Change', notes: `Stage changed from ${STAGE_LABELS[opp.stage]} → ${STAGE_LABELS[newStage]}` })
    setOpps(prev => prev.map(o => o.id === oppId ? { ...o, stage: newStage } : o))
    toast(`Moved to ${STAGE_LABELS[newStage]}`, 'success')
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = view === 'list' ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : filtered

  return (
    <Layout pageTitle="CRM — Opportunities" pageKey="crm">
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
              <button className="new-order-btn" onClick={() => navigate('/crm/leads/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
              </button>
            </div>
          </div>

          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, product, principal..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
            </div>
            <select className="crm-filter-select" value={filterStage} onChange={e => { setFilterStage(e.target.value); setPage(1) }}>
              <option value="">All Stages</option>
              {[...STAGES,...TERMINAL].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
            <select className="crm-filter-select" value={filterScenario} onChange={e => { setFilterScenario(e.target.value); setPage(1) }}>
              <option value="">All Scenarios</option>
              {SCENARIOS.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}
            </select>
            <select className="crm-filter-select" value={filterPrincipal} onChange={e => { setFilterPrincipal(e.target.value); setPage(1) }}>
              <option value="">All Principals</option>
              {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {isManager && (
              <select className="crm-filter-select" value={filterRep} onChange={e => { setFilterRep(e.target.value); setPage(1) }}>
                <option value="">All Reps</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/>Loading...</div>
          ) : view === 'kanban' ? (
            <KanbanView opps={filtered} navigate={navigate} onMoveStage={moveStage} />
          ) : (
            <>
              <ListView opps={paged} navigate={navigate} />
              {totalPages > 1 && (
                <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:8,padding:'16px 0'}}>
                  <button className="crm-btn crm-btn-sm" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Prev</button>
                  <span style={{fontSize:12,color:'var(--gray-500)'}}>Page {safePage} of {totalPages} ({filtered.length} results)</span>
                  <button className="crm-btn crm-btn-sm" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}

const COL_COLORS = {
  LEAD_CAPTURED:'#6366f1', CONTACTED:'#0ea5e9', QUALIFIED:'#8b5cf6',
  BOM_RECEIVED:'#a855f7', QUOTATION_SENT:'#1a4dab', FOLLOW_UP:'#f59e0b',
  FINAL_NEGOTIATION:'#d97706', WON:'#22c55e', LOST:'#ef4444', ON_HOLD:'#94a3b8',
}

function KanbanView({ opps, navigate, onMoveStage }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const allCols = [...STAGES, ...TERMINAL]

  function onDragStart(e, id) {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
    e.currentTarget.classList.add('kb-dragging')
  }
  function onDragEnd(e) {
    e.currentTarget.classList.remove('kb-dragging')
    setDragId(null)
    setOverCol(null)
  }
  function onDragOver(e, stage) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverCol(stage)
  }
  function onDragLeave(e, stage) {
    if (!e.currentTarget.contains(e.relatedTarget)) setOverCol(null)
  }
  function onDrop(e, stage) {
    e.preventDefault()
    setOverCol(null)
    if (dragId) onMoveStage(dragId, stage)
  }

  return (
    <div className="kb-board">
      {allCols.map(stage => {
        const cards = opps.filter(o => o.stage === stage)
        if (cards.length === 0 && TERMINAL.includes(stage)) return null
        const colTotal = cards.reduce((s, o) => s + (o.estimated_value_inr || 0), 0)
        const isOver = overCol === stage && dragId
        return (
          <div key={stage} className={'kb-col' + (isOver ? ' kb-col-over' : '')}
            onDragOver={e => onDragOver(e, stage)}
            onDragLeave={e => onDragLeave(e, stage)}
            onDrop={e => onDrop(e, stage)}>
            <div className="kb-col-head">
              <div className="kb-col-head-top">
                <span className="kb-col-dot" style={{background: COL_COLORS[stage] || '#94a3b8'}} />
                <span className="kb-col-title">{STAGE_LABELS[stage]}</span>
                <span className="kb-col-count">{cards.length}</span>
              </div>
              {colTotal > 0 && <div className="kb-col-total">{fmtINR(colTotal)}</div>}
            </div>
            <div className="kb-col-body">
              {cards.map(o => (
                <div key={o.id} className="kb-card" draggable
                  onDragStart={e => onDragStart(e, o.id)}
                  onDragEnd={onDragEnd}
                  onClick={() => navigate('/crm/opportunities/' + o.id)}>
                  <div className="kb-card-top">
                    <div className="kb-card-title">{o.opportunity_name || '—'}</div>
                    {o.profiles?.name && (
                      <div className="kb-avatar" style={{background: ownerColor(o.profiles.name)}}>{o.profiles.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</div>
                    )}
                  </div>
                  {(o.crm_companies?.company_name || o.freetext_company) && (
                    <div className="kb-card-company">{o.crm_companies?.company_name || o.freetext_company}</div>
                  )}
                  {o.product_notes && o.product_notes !== o.opportunity_name && <div className="kb-card-desc">{o.product_notes.length > 50 ? o.product_notes.slice(0,50)+'…' : o.product_notes}</div>}
                  <div className="kb-card-bottom">
                    <div className="kb-card-bottom-left">
                      {o.expected_close_date && (
                        <span className="kb-card-date">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:11,height:11}}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          {fmtDate(o.expected_close_date)}
                        </span>
                      )}
                      {isOverdue(o) && <span className="kb-tag kb-tag-overdue">Overdue</span>}
                    </div>
                    {o.estimated_value_inr && <div className="kb-card-amount">{fmtINR(o.estimated_value_inr)}</div>}
                  </div>
                </div>
              ))}
              {cards.length === 0 && <div className="kb-empty">No items</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) }
function daysAgo(d) { if (!d) return null; const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday'; return diff + 'd ago' }

function ListView({ opps, navigate }) {
  return (
    <div className="crm-card">
      <div className="crm-table-wrap">
        <table className="crm-table crm-deals-table">
          <thead>
            <tr>
              <th style={{width:'32%'}}>Deal</th>
              <th style={{width:'14%'}}>Principal</th>
              <th style={{width:'12%'}}>Close Date</th>
              <th style={{width:'12%',textAlign:'right'}}>Value</th>
              <th style={{width:'15%'}}>Stage</th>
              <th style={{width:'15%'}}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {opps.map(o => {
              const company = o.crm_companies?.company_name || o.customers?.customer_name || o.freetext_company || ''
              const overdue = isOverdue(o)
              const lastAct = daysAgo(o._lastActivity)
              return (
                <tr key={o.id} onClick={() => navigate('/crm/opportunities/' + o.id)} className={overdue ? 'crm-row-overdue' : ''}>
                  <td>
                    <div className="crm-deal-name">{o.opportunity_name || '—'}</div>
                    <div className="crm-deal-company">
                      {company}
                      {o.product_notes && <span className="crm-deal-dot">·</span>}
                      {o.product_notes && <span className="crm-deal-product">{o.product_notes.length > 40 ? o.product_notes.slice(0,40)+'…' : o.product_notes}</span>}
                    </div>
                    {overdue && <span className="crm-overdue-badge" style={{marginTop:3,display:'inline-block'}}>Overdue</span>}
                  </td>
                  <td><span className="crm-deal-principal">{o.crm_principals?.name || '—'}</span></td>
                  <td>
                    <div className="crm-deal-date">{fmtDate(o.expected_close_date)}</div>
                    {lastAct && <div className="crm-deal-activity">Last: {lastAct}</div>}
                  </td>
                  <td style={{textAlign:'right'}}>
                    <span className="crm-deal-value">{fmtINR(o.estimated_value_inr) || '—'}</span>
                  </td>
                  <td><StagePill stage={o.stage} /></td>
                  <td><OwnerChip name={o.profiles?.name} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile */}
      <div className="crm-card-list">
        {opps.map(o => {
          const company = o.crm_companies?.company_name || o.customers?.customer_name || o.freetext_company || ''
          const overdue = isOverdue(o)
          return (
          <div key={o.id} className="crm-list-card" onClick={() => navigate('/crm/opportunities/' + o.id)}>
            <div className="crm-list-card-top">
              <div style={{flex:1,minWidth:0}}>
                <div className="crm-list-card-name">{o.opportunity_name || '—'}</div>
                <div className="crm-list-card-sub">{company}{o.crm_principals?.name ? ' · ' + o.crm_principals.name : ''}</div>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                <StagePill stage={o.stage} />
                {o.estimated_value_inr && <span style={{fontSize:13,fontWeight:700,fontFamily:'var(--mono)',color:'var(--gray-800)'}}>{fmtINR(o.estimated_value_inr)}</span>}
              </div>
            </div>
            <div className="crm-list-card-bottom">
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                {o.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type}>{scenarioLabel(o.scenario_type)}</span>}
                {overdue && <span className="crm-overdue-badge">Overdue</span>}
                {o.expected_close_date && <span style={{fontSize:10,color:'var(--gray-400)'}}>Close: {fmtDate(o.expected_close_date)}</span>}
              </div>
              {o.profiles?.name && <OwnerChip name={o.profiles.name} />}
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
