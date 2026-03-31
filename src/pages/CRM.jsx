import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm.css'

const STAGES = [
  { key: 'prospecting',    label: 'Prospecting',       short: 'Prospect' },
  { key: 'qualification',  label: 'Lead Qualification', short: 'Qualify'  },
  { key: 'discovery',      label: 'Discovery / Meeting', short: 'Discovery' },
  { key: 'proposal',       label: 'Proposal',           short: 'Proposal'  },
  { key: 'negotiation',    label: 'Negotiation',        short: 'Negotiate' },
  { key: 'quotation',      label: 'Quotation Given',    short: 'Quotation' },
  { key: 'won',            label: 'Closed Won',         short: 'Won'       },
  { key: 'lost',           label: 'Closed Lost',        short: 'Lost'      },
]

function stageLabel(key) { return STAGES.find(s => s.key === key)?.label || key }

function fmtDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()]
}

export default function CRM() {
  const navigate = useNavigate()
  const [view, setView]     = useState('kanban') // 'kanban' | 'list'
  const [leads, setLeads]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [filterStage, setFilterStage]   = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterType, setFilterType]     = useState('')
  const [dragging, setDragging]         = useState(null)
  const [dragOver, setDragOver]         = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
    }
    await loadLeads()
  }

  async function loadLeads() {
    setLoading(true)
    const { data } = await sb.from('leads').select('*').order('created_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  // ── Drag and Drop ──
  function onDragStart(e, lead) {
    setDragging(lead)
    e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e, stageKey) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(stageKey)
  }

  function onDragLeave() { setDragOver(null) }

  async function onDrop(e, stageKey) {
    e.preventDefault()
    setDragOver(null)
    if (!dragging || dragging.stage === stageKey) { setDragging(null); return }
    // Optimistic update
    setLeads(prev => prev.map(l => l.id === dragging.id ? { ...l, stage: stageKey } : l))
    await sb.from('leads').update({ stage: stageKey, updated_at: new Date().toISOString() }).eq('id', dragging.id)
    // Log stage change activity
    await sb.from('lead_activities').insert({
      lead_id: dragging.id,
      activity_type: 'stage_change',
      stage_from: dragging.stage,
      stage_to: stageKey,
    })
    setDragging(null)
  }

  // ── Filters ──
  const q = search.trim().toLowerCase()
  const filtered = leads.filter(l => {
    if (filterStage  && l.stage !== filterStage)       return false
    if (filterSource && l.lead_source !== filterSource) return false
    if (filterType   && l.customer_type !== filterType) return false
    if (q && !l.lead_name?.toLowerCase().includes(q) && !l.company_name?.toLowerCase().includes(q) && !l.contact_person?.toLowerCase().includes(q)) return false
    return true
  })

  // Group by stage for kanban
  const byStage = {}
  STAGES.forEach(s => { byStage[s.key] = [] })
  filtered.forEach(l => { if (byStage[l.stage]) byStage[l.stage].push(l) })

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <div className="crm-page">
        <div className="crm-body">

          {/* Header */}
          <div className="crm-header">
            <div>
              <div className="crm-title">CRM Pipeline</div>
              <div className="crm-sub">{leads.length} leads total · {leads.filter(l=>l.is_opportunity).length} opportunities</div>
            </div>
            <div className="crm-header-actions">
              <div className="crm-view-toggle">
                <button className={'crm-view-btn' + (view === 'kanban' ? ' active' : '')} onClick={() => setView('kanban')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
                  Kanban
                </button>
                <button className={'crm-view-btn' + (view === 'list' ? ' active' : '')} onClick={() => setView('list')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                  List
                </button>
              </div>
              <button className="crm-new-btn" onClick={() => navigate('/crm/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
              </button>
            </div>
          </div>

          {/* Search + filter (both views) */}
          <div className="crm-list-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, contact..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="crm-filter-select" value={filterStage} onChange={e => setFilterStage(e.target.value)}>
              <option value="">All Stages</option>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select className="crm-filter-select" value={filterSource} onChange={e => setFilterSource(e.target.value)}>
              <option value="">All Sources</option>
              {['Cold Call','LinkedIn','Principal Referral','Exhibition','Google','Customer Referral'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="crm-filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
              <option value="">All Types</option>
              {['OEM','Panel Builder','End User','Trader'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="crm-empty"><svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg><div className="crm-empty-title">Loading...</div></div>
          ) : view === 'kanban' ? (

            /* ── KANBAN ── */
            <div className="crm-kanban">
              {STAGES.map(stage => (
                <div
                  key={stage.key}
                  className={'crm-col' + (stage.key === 'won' || stage.key === 'lost' ? ' ' + stage.key : '')}
                  onDragOver={e => onDragOver(e, stage.key)}
                  onDragLeave={onDragLeave}
                  onDrop={e => onDrop(e, stage.key)}
                >
                  <div className="crm-col-header">
                    <span className="crm-col-label">{stage.label}</span>
                    <span className="crm-col-count">{byStage[stage.key].length}</span>
                  </div>
                  {byStage[stage.key].length === 0 ? (
                    <div className={'crm-drop-zone' + (dragOver === stage.key ? ' drag-over' : '')}>
                      Drop here
                    </div>
                  ) : (
                    byStage[stage.key].map(lead => (
                      <div
                        key={lead.id}
                        className={'crm-card' + (dragging?.id === lead.id ? ' dragging' : '')}
                        draggable
                        onDragStart={e => onDragStart(e, lead)}
                        onClick={() => navigate('/crm/' + lead.id)}
                      >
                        {lead.is_opportunity && <div className="crm-card-opp-badge" title="Opportunity" />}
                        {lead.lead_name && <div className="crm-card-lead-name">{lead.lead_name}</div>}
                        <div className="crm-card-company">{lead.company_name}</div>
                        <div className="crm-card-contact">{lead.contact_person || '—'}{lead.designation ? ' · ' + lead.designation : ''}</div>
                        <div className="crm-card-footer">
                          <span className="crm-card-source">{lead.lead_source || '—'}</span>
                          <span className="crm-card-date">{fmtDate(lead.updated_at)}</span>
                        </div>
                        {lead.owner_name && <div className="crm-card-owner" style={{marginTop:6}}>👤 {lead.owner_name}</div>}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>

          ) : (

            /* ── LIST ── */
            <div className="crm-table-card">
              {filtered.length === 0 ? (
                <div className="crm-empty">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
                  <div className="crm-empty-title">No leads found</div>
                  <div className="crm-empty-sub">Try adjusting your filters or add a new lead.</div>
                </div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Lead Name</th>
                      <th>Company</th>
                      <th>Contact</th>
                      <th>Mobile</th>
                      <th>Lead Source</th>
                      <th>Type</th>
                      <th>Stage</th>
                      <th>Owner</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(lead => (
                      <tr key={lead.id} onClick={() => navigate('/crm/' + lead.id)}>
                        <td className="company-cell">
                          {lead.is_opportunity && <span style={{color:'#f59e0b',marginRight:5}}>★</span>}
                          {lead.lead_name || '—'}
                        </td>
                        <td>{lead.company_name}</td>
                        <td>{lead.contact_person || '—'}</td>
                        <td className="mobile-cell">{lead.mobile || '—'}</td>
                        <td>{lead.lead_source || '—'}</td>
                        <td>{lead.customer_type || '—'}</td>
                        <td><span className={'crm-stage-pill ' + lead.stage}>{stageLabel(lead.stage)}</span></td>
                        <td>{lead.owner_name || '—'}</td>
                        <td>{fmtDate(lead.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

          )}
        </div>
      </div>
    </Layout>
  )
}
