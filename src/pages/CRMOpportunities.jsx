import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/crm-redesign.css'

const STAGES = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','BOM_RECEIVED','QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION']
const TERMINAL = ['WON','LOST','ON_HOLD']
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const STAGE_COLORS = {
  LEAD_CAPTURED:'#6366f1', CONTACTED:'#0ea5e9', QUALIFIED:'#8b5cf6',
  BOM_RECEIVED:'#a855f7', QUOTATION_SENT:'#1a4dab', FOLLOW_UP:'#f59e0b',
  FINAL_NEGOTIATION:'#d97706', WON:'#22c55e', LOST:'#ef4444', ON_HOLD:'#94a3b8',
}
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const SCENARIO_LABELS = { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }

const _OC = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }

function fmtINR(v) {
  if (!v) return null
  if (v >= 1e7) return '₹' + (v/1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (v/1e5).toFixed(2) + ' L'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'2-digit' }) }
function isOverdue(opp) {
  if (opp.stage !== 'FOLLOW_UP') return false
  if (!opp._lastActivity) return true
  return (Date.now() - new Date(opp._lastActivity).getTime()) > 7 * 86400 * 1000
}

export default function CRMOpportunities() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [opps, setOpps] = useState([])
  const [reps, setReps] = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('kanban')
  const [search, setSearch] = useState('')
  const [filterStage, setFilterStage] = useState('')
  const [filterRep, setFilterRep] = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [filterScenario, setFilterScenario] = useState('')
  const [scope, setScope] = useState('mine')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
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

  const isManager = ['admin','management'].includes(user.role)
  const q = search.trim().toLowerCase()
  const filtered = opps
    .filter(o => scope === 'all' ? true : scope === 'mine' ? o.assigned_rep_id === user.id : o.assigned_rep_id !== user.id)
    .filter(o => !q || (o.crm_companies?.company_name||o.customers?.customer_name||'').toLowerCase().includes(q) || (o.product_notes||'').toLowerCase().includes(q) || (o.crm_principals?.name||'').toLowerCase().includes(q) || (o.opportunity_name||'').toLowerCase().includes(q))
    .filter(o => !filterStage || o.stage === filterStage)
    .filter(o => !filterRep || o.assigned_rep_id === filterRep)
    .filter(o => !filterPrincipal || o.principal_id === filterPrincipal)
    .filter(o => !filterScenario || o.scenario_type === filterScenario)

  const openCount = filtered.filter(o => !TERMINAL.includes(o.stage)).length
  const totalValue = filtered.filter(o => !TERMINAL.includes(o.stage) || o.stage === 'WON').reduce((s, o) => s + (o.estimated_value_inr || 0), 0)
  const overdueCount = filtered.filter(o => isOverdue(o)).length
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = view === 'list' ? filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : filtered

  return (
    <Layout pageTitle="CRM — Opportunities" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Opportunities</h1>
            <div className="opps-summary">
              <span><b>{openCount}</b> open</span>
              {totalValue > 0 && <><span className="opps-dot">·</span><span><b>{fmtINR(totalValue)}</b> pipeline</span></>}
              {overdueCount > 0 && <><span className="opps-dot">·</span><span className="opps-overdue"><span className="opps-od-dot"/>{overdueCount} overdue</span></>}
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={() => navigate('/crm/leads/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Lead
            </button>
          </div>
        </div>

        <div className="opps-bar">
          <div className="view-toggle">
            <button className={view==='kanban' ? 'on' : ''} onClick={() => setView('kanban')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="10" rx="1"/></svg>
              Board
            </button>
            <button className={view==='list' ? 'on' : ''} onClick={() => setView('list')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              List
            </button>
          </div>
          <div className="view-toggle">
            <button className={scope==='mine' ? 'on' : ''} onClick={() => { setScope('mine'); setPage(1) }}>My View</button>
            <button className={scope==='team' ? 'on' : ''} onClick={() => { setScope('team'); setPage(1) }}>Team</button>
            <button className={scope==='all' ? 'on' : ''} onClick={() => { setScope('all'); setPage(1) }}>All</button>
          </div>
        </div>

        <div className="opps-filters">
          <div className="opps-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search deals, companies, principals…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          <select className="filt-select" value={filterStage} onChange={e => { setFilterStage(e.target.value); setPage(1) }}>
            <option value="">Stage: All</option>
            {[...STAGES,...TERMINAL].map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
          <select className="filt-select" value={filterScenario} onChange={e => { setFilterScenario(e.target.value); setPage(1) }}>
            <option value="">Scenario: All</option>
            {SCENARIOS.map(s => <option key={s} value={s}>{SCENARIO_LABELS[s]}</option>)}
          </select>
          <select className="filt-select" value={filterPrincipal} onChange={e => { setFilterPrincipal(e.target.value); setPage(1) }}>
            <option value="">Principal: All</option>
            {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {isManager && (
            <select className="filt-select" value={filterRep} onChange={e => { setFilterRep(e.target.value); setPage(1) }}>
              <option value="">Rep: All</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {(search || filterStage || filterScenario || filterPrincipal || filterRep) && (
            <button className="opps-clear" onClick={() => { setSearch(''); setFilterStage(''); setFilterScenario(''); setFilterPrincipal(''); setFilterRep(''); setPage(1) }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="crm-loading">Loading…</div>
        ) : view === 'kanban' ? (
          <KanbanView opps={filtered} navigate={navigate} onMoveStage={moveStage} />
        ) : (
          <>
            <ListView opps={paged} navigate={navigate} />
            {totalPages > 1 && (
              <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:10,padding:'16px 0',fontSize:12,color:'var(--c-muted)'}}>
                <button className="btn-ghost" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Prev</button>
                <span>Page {safePage} of {totalPages} ({filtered.length} results)</span>
                <button className="btn-ghost" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}

function KanbanView({ opps, navigate, onMoveStage }) {
  const wheelHandler = (e) => {
    // Translate vertical wheel into horizontal scroll for kanban
    if (e.deltaY === 0 || e.shiftKey) return
    const el = e.currentTarget
    const max = el.scrollWidth - el.clientWidth
    if (max <= 0) return
    if ((e.deltaY > 0 && el.scrollLeft >= max) || (e.deltaY < 0 && el.scrollLeft <= 0)) return
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const allCols = [...STAGES, ...TERMINAL]

  function onDragStart(e, id) { setDragId(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }
  function onDragEnd() { setDragId(null); setOverCol(null) }
  function onDragOver(e, stage) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverCol(stage) }
  function onDrop(e, stage) { e.preventDefault(); setOverCol(null); if (dragId) onMoveStage(dragId, stage) }

  return (
    <div className="kb-wrap" onWheel={wheelHandler}>
      <div className="kb-board">
        {allCols.map(stage => {
          const cards = opps.filter(o => o.stage === stage)
          const colTotal = cards.reduce((s, o) => s + (o.estimated_value_inr || 0), 0)
          const isOver = overCol === stage && dragId
          const stageColor = STAGE_COLORS[stage]
          return (
            <div key={stage}
              className={`kb-col ${isOver ? 'drag-over' : ''}`}
              style={{ '--stage-color': stageColor }}
              onDragOver={e => onDragOver(e, stage)}
              onDrop={e => onDrop(e, stage)}>
              <div className="kb-col-head">
                <div className="kb-col-title">
                  <span className="kb-col-dot"/>
                  <span className="kb-col-name">{STAGE_LABELS[stage]}</span>
                  <span className="kb-col-count">{cards.length}</span>
                </div>
                {colTotal > 0 && (
                  <div className="kb-col-meta">
                    <span className="kb-col-val">{fmtINR(colTotal)}</span>
                  </div>
                )}
              </div>
              <div className="kb-col-body">
                {cards.map(o => {
                  const company = o.crm_companies?.company_name || o.customers?.customer_name || ''
                  const title = o.opportunity_name || o.product_notes || 'Untitled'
                  const overdue = isOverdue(o)
                  return (
                    <div key={o.id} className={`kb-card ${overdue ? 'overdue' : ''} ${dragId === o.id ? 'dragging' : ''}`}
                      style={{ '--stage-color': stageColor }}
                      draggable
                      onDragStart={e => onDragStart(e, o.id)}
                      onDragEnd={onDragEnd}
                      onClick={() => navigate('/crm/opportunities/' + o.id)}>
                      <div className="kb-card-bar"/>
                      <div className="kb-card-head">
                        {o.crm_principals?.name && <span className="kb-principal-tag">{o.crm_principals.name}</span>}
                        {overdue && <span className="kb-tag tag-overdue">Overdue</span>}
                      </div>
                      <div className="kb-card-title">{title}</div>
                      {company && (
                        <div className="kb-card-customer">
                          <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 11, height: 11 }}><path d="M3 21V8a2 2 0 012-2h6V3h8v18M9 21V11h2v10M13 21V11h2v10"/></svg>
                          <span>{company}</span>
                        </div>
                      )}
                      <div className="kb-card-foot">
                        <div className="kb-card-value">{o.estimated_value_inr ? fmtINR(o.estimated_value_inr) : '—'}</div>
                        <div className="kb-card-meta">
                          {o.expected_close_date && (
                            <span className={`kb-card-date ${overdue ? 'overdue' : ''}`}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:10,height:10}}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                              {fmtDate(o.expected_close_date)}
                            </span>
                          )}
                          {o.profiles?.name && (
                            <div className="kb-card-avatar" title={o.profiles.name} style={{background: ownerColor(o.profiles.name)}}>
                              {initials(o.profiles.name)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                {cards.length === 0 && <div className="kb-empty">No items</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ListView({ opps, navigate }) {
  if (!opps.length) {
    return <div className="dl-wrap"><div className="dl-empty">No opportunities match your filters</div></div>
  }
  return (
    <div className="dl-wrap">
      <div className="dl-row dl-head">
        <div>Deal</div>
        <div>Principal</div>
        <div>Close Date</div>
        <div className="num">Value</div>
        <div>Stage</div>
        <div>Owner</div>
      </div>
      <div className="dl-table">
        {opps.map(o => {
          const company = o.crm_companies?.company_name || o.customers?.customer_name || ''
          const overdue = isOverdue(o)
          const stageColor = STAGE_COLORS[o.stage]
          return (
            <div key={o.id} className="dl-row dl-data" onClick={() => navigate('/crm/opportunities/' + o.id)}>
              <div className="dl-cell dl-deal">
                <div className="dl-title">{o.opportunity_name || '—'}</div>
                <div className="dl-deal-meta">
                  <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{company}</span>
                  {o.product_notes && <><span className="opps-dot">·</span><span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{o.product_notes.length > 40 ? o.product_notes.slice(0,40)+'…' : o.product_notes}</span></>}
                </div>
              </div>
              <div className="dl-cell"><span className="dl-pr-tag">{o.crm_principals?.name || '—'}</span></div>
              <div className="dl-cell">
                <div className={`dl-date-main ${overdue ? 'overdue' : ''}`}>{fmtDate(o.expected_close_date)}</div>
              </div>
              <div className="dl-cell dl-value">{fmtINR(o.estimated_value_inr) || '—'}</div>
              <div className="dl-cell">
                <span className="dl-stage-pill" style={{ '--stage-color': stageColor }}>
                  <span className="dl-stage-dot"/>
                  {STAGE_LABELS[o.stage]}
                </span>
              </div>
              <div className="dl-cell dl-owner">
                {o.profiles?.name ? (
                  <>
                    <div className="dl-owner-avatar" style={{background: ownerColor(o.profiles.name)}}>{initials(o.profiles.name)}</div>
                    <span className="dl-owner-name">{o.profiles.name}</span>
                  </>
                ) : <span style={{color:'var(--c-muted-2)'}}>—</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
