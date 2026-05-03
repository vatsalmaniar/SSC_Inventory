import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtNum } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm-redesign.css'

const SOURCES = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const STATUSES = ['New','Contacted','Converted','Not a Fit']
const STATUS_COLORS = { New:'#1E54B7', Contacted:'#F59E0B', Converted:'#22C55E', 'Not a Fit':'#EF4444' }
const SCENARIO_LABELS = { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }

const _OC = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function initials(name) { return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }

export default function CRMLeads() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [leads, setLeads] = useState([])
  const [reps, setReps] = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterPrincipal, setFilterPrincipal] = useState('')
  const [filterRep, setFilterRep] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    const [leadsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_leads').select('*, crm_companies(company_name), crm_principals(name), profiles(name)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])
    setLeads(leadsRes.data || [])
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  const isManager = ['admin','management'].includes(user.role)
  const q = search.trim().toLowerCase()
  const filtered = leads
    .filter(l => isManager || l.assigned_rep_id === user.id)
    .filter(l => !q || (l.crm_companies?.company_name||l.freetext_company||'').toLowerCase().includes(q) || (l.contact_name_freetext||'').toLowerCase().includes(q) || (l.product_notes||'').toLowerCase().includes(q))
    .filter(l => !filterStatus || l.status === filterStatus)
    .filter(l => !filterSource || l.source === filterSource)
    .filter(l => !filterPrincipal || l.principal_id === filterPrincipal)
    .filter(l => !filterRep || l.assigned_rep_id === filterRep)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const counts = {
    New: leads.filter(l => l.status === 'New').length,
    Contacted: leads.filter(l => l.status === 'Contacted').length,
    Converted: leads.filter(l => l.status === 'Converted').length,
    'Not a Fit': leads.filter(l => l.status === 'Not a Fit').length,
  }

  return (
    <Layout pageTitle="CRM — Leads" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Leads</h1>
            <div className="opps-summary">
              <span><b>{filtered.length}</b> leads</span>
              {counts.New > 0 && (<><span className="opps-dot">·</span><span><b>{counts.New}</b> new</span></>)}
              {counts.Converted > 0 && (<><span className="opps-dot">·</span><span style={{ color:'#047857' }}><b style={{ color:'#047857' }}>{counts.Converted}</b> converted</span></>)}
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={() => navigate('/crm/leads/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Lead
            </button>
          </div>
        </div>

        <div className="opps-filters">
          <div className="opps-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search company, contact, product…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
          </div>
          <select className="filt-select" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}>
            <option value="">Status: All</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="filt-select" value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1) }}>
            <option value="">Source: All</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
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
          {(search || filterStatus || filterSource || filterPrincipal || filterRep) && (
            <button className="opps-clear" onClick={() => { setSearch(''); setFilterStatus(''); setFilterSource(''); setFilterPrincipal(''); setFilterRep(''); setPage(1) }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="crm-loading">Loading leads…</div>
        ) : (
          <div className="dl-wrap">
            <div className="dl-row dl-head" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 130px 110px minmax(0, 1fr) 110px 100px 130px' }}>
              <div>Company</div>
              <div>Contact</div>
              <div>Source</div>
              <div>Principal</div>
              <div>Date</div>
              <div>Owner</div>
              <div>Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="dl-empty">No leads found</div>
            ) : (
              <div className="dl-table">
                {paged.map(l => {
                  const statusColor = STATUS_COLORS[l.status] || '#94A3B8'
                  return (
                    <div key={l.id} className="dl-row dl-data" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) 130px 110px minmax(0, 1fr) 110px 100px 130px' }} onClick={() => navigate('/crm/leads/' + l.id)}>
                      <div className="dl-cell dl-deal">
                        <div className="dl-title">{l.crm_companies?.company_name || l.freetext_company || '—'}</div>
                        {l.product_notes && <div className="dl-deal-meta"><span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{l.product_notes.length > 40 ? l.product_notes.slice(0,40)+'…' : l.product_notes}</span></div>}
                      </div>
                      <div className="dl-cell" style={{ fontSize: 12.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.contact_name_freetext || '—'}</div>
                      <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)' }}>{l.source || '—'}</div>
                      <div className="dl-cell"><span className="dl-pr-tag">{l.crm_principals?.name || '—'}</span></div>
                      <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)' }}>{fmtNum(l.created_at)}</div>
                      <div className="dl-cell">
                        {l.profiles?.name ? (
                          <div style={{ display:'flex', alignItems:'center', gap:6, minWidth: 0 }} title={l.profiles.name}>
                            <div className="dl-owner-avatar" style={{ background: ownerColor(l.profiles.name), width: 22, height: 22, fontSize: 9 }}>{initials(l.profiles.name)}</div>
                          </div>
                        ) : <span style={{ color:'var(--c-muted-2)' }}>—</span>}
                      </div>
                      <div className="dl-cell">
                        <span className="dl-stage-pill" style={{ '--stage-color': statusColor }}>
                          <span className="dl-stage-dot"/>
                          {l.status}
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
                  <button className="btn-ghost" disabled={safePage<=1} onClick={() => setPage(p => p - 1)}>Prev</button>
                  <span style={{ padding: '6px 8px', fontSize: 12 }}>Page {safePage} / {totalPages}</span>
                  <button className="btn-ghost" disabled={safePage>=totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
