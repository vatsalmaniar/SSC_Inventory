import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const REP_PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?' }

const GRN_TYPE_LABELS = { po_inward:'PO Inward', customer_rejection:'Customer Rejection', sample_return:'Sample Return', cancellation_return:'Cancellation Return' }
const GRN_STATUS_LABELS = { draft:'GRN Created', checking:'Checking', confirmed:'Confirmed', invoice_matched:'Invoice Matched', inward_posted:'Inward Posted' }
const GRN_STATUS_COLORS = { draft:'#94A3B8', checking:'#F59E0B', confirmed:'#1E54B7', invoice_matched:'#0F766E', inward_posted:'#22C55E' }

const FILTERS = [
  { key:'all', label:'All' },
  { key:'draft', label:'Created' },
  { key:'checking', label:'Checking', tone:'warn' },
  { key:'confirmed', label:'Confirmed' },
  { key:'invoice_matched', label:'Matched' },
  { key:'inward_posted', label:'Posted' },
]
const TYPE_FILTERS = [
  { key:'all', label:'All Types' },
  { key:'po_inward', label:'PO Inward' },
  { key:'customer_rejection', label:'Cust Rej' },
  { key:'sample_return', label:'Sample Ret' },
  { key:'cancellation_return', label:'Cancel Ret' },
]

const PAGE_SIZE = 50

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

export default function GRNList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [grns, setGrns] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadGrns()
  }

  async function loadGrns() {
    setLoading(true)
    const { data } = await sb.from('grn').select('*').eq('is_test', false).gte('created_at', FY_START).order('received_at', { ascending: false })
    setGrns(data || [])
    setLoading(false)
  }

  function matchFilter(g, f) { return f === 'all' ? true : g.status === f }
  function matchType(g, t) { return t === 'all' ? true : g.grn_type === t }

  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = grns.filter(g => matchFilter(g, key) && matchType(g, typeFilter)).length; return acc }, {})

  const q = search.trim().toLowerCase()
  const filtered = grns.filter(g => matchFilter(g, filter)).filter(g => matchType(g, typeFilter))
    .filter(g => !q || g.grn_number?.toLowerCase().includes(q) || g.vendor_name?.toLowerCase().includes(q) || g.invoice_number?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const totalValue = filtered.reduce((s, g) => s + (g.total_amount || 0), 0)
  const pendingCount = grns.filter(g => (g.status === 'draft' || g.status === 'checking') && matchType(g, typeFilter)).length
  const confirmedCount = grns.filter(g => g.status === 'confirmed' && matchType(g, typeFilter)).length

  return (
    <Layout pageTitle="Goods Receipt Notes" pageKey="fc">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Goods Receipt Notes</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> GRNs</span>
              {totalValue > 0 && (<><span className="o-sep">·</span><span><b>{fmtCr(totalValue)}</b> value</span></>)}
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={() => navigate('/fc/grn/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New GRN
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label={FILTERS.find(f => f.key === filter)?.label || 'GRNs'} value={filtered.length} sub="matching GRNs" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Total Value" value={fmtCr(totalValue)} sub="across filtered" chart="bars"/>
          <KpiTile variant="hero" tone="teal" label="Confirmed" value={confirmedCount} sub="confirmed GRNs" chart="bars" onClick={() => { setFilter('confirmed'); setPage(1) }}/>
          <KpiTile label="Pending" value={pendingCount} sub="created + checking" accent={pendingCount > 0 ? 'amber' : null} onClick={() => { setFilter('checking'); setPage(1) }}/>
          <KpiTile label="Posted" value={counts.inward_posted || 0} sub="inward posted" onClick={() => { setFilter('inward_posted'); setPage(1) }}/>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search GRN #, vendor, invoice…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="o-datemode">
            {TYPE_FILTERS.map(({ key, label }) => (
              <button key={key} className={typeFilter === key ? 'on' : ''} onClick={() => { setTypeFilter(key); setPage(1) }}>{label}</button>
            ))}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => { setFilter(key); setPage(1) }}>
              {label}
              {counts[key] > 0 && <span className="o-chip-n">{counts[key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="o-loading">Loading GRNs…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 100px minmax(0, 1fr) 130px 100px 130px' }}>
              <div>GRN #</div>
              <div>Vendor / Source</div>
              <div>Type</div>
              <div>Centre</div>
              <div>Received By</div>
              <div>Invoice #</div>
              <div>Date</div>
              <div className="num">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No GRNs found</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(g => (
                  <div key={g.id} className="ol-row ol-data" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 100px minmax(0, 1fr) 130px 100px 130px' }} onClick={() => navigate('/fc/grn/' + g.id)}>
                    <div className="ol-cell">
                      <div className="ol-num">{g.grn_number}</div>
                      {g.grn_type !== 'po_inward' && <span className="ol-sample-tag">{GRN_TYPE_LABELS[g.grn_type]}</span>}
                    </div>
                    <div className="ol-cell ol-cust" title={g.vendor_name}>{g.vendor_name || '—'}</div>
                    <div className="ol-cell ol-date">{GRN_TYPE_LABELS[g.grn_type] || g.grn_type}</div>
                    <div className="ol-cell ol-date">{g.fulfilment_center || '—'}</div>
                    <div className="ol-cell">
                      {g.received_by ? (
                        <div className="ol-owner" title={g.received_by}>
                          <div className="ol-owner-avatar" style={{background: ownerColor(g.received_by)}}>{initials(g.received_by)}</div>
                          <span className="ol-owner-name">{g.received_by}</span>
                        </div>
                      ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                    </div>
                    <div className="ol-cell ol-date" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5, color: 'var(--o-muted)' }}>{g.invoice_number || '—'}</div>
                    <div className="ol-cell ol-date">{fmt(g.received_at || g.created_at)}</div>
                    <div className="ol-cell ol-status-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': GRN_STATUS_COLORS[g.status] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>
                        {GRN_STATUS_LABELS[g.status] || g.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                {totalPages > 1 && (
                  <div className="ol-pages">
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                      const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                      const ellipsis = !show && Math.abs(p - safePage) === 2
                      if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                      if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 4px', color:'var(--o-muted-2)' }}>…</span>
                      return null
                    })}
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {onClick && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">{sub && <div className="kt-sub mono">{sub}</div>}</div>
    </div>
  )
}
function KpiChart({ kind }) {
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
        <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
      ))}
    </svg>
  )
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}
