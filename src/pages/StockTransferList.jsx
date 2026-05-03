import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const STATUS_LABELS = { draft:'Draft', dispatched:'In Transit', received:'Received', cancelled:'Cancelled' }
const STATUS_COLORS = { draft:'#94A3B8', dispatched:'#1E54B7', received:'#22C55E', cancelled:'#EF4444' }

const FILTERS = [
  { key:'all', label:'All' },
  { key:'draft', label:'Draft' },
  { key:'dispatched', label:'In Transit' },
  { key:'received', label:'Received' },
  { key:'cancelled', label:'Cancelled', tone:'danger' },
]
const PAGE_SIZE = 50

export default function StockTransferList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [testMode, setTestMode] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadTransfers(role === 'demo')
  }

  async function loadTransfers(test) {
    setLoading(true)
    const { data } = await sb.from('stock_transfers')
      .select('*, stock_transfer_items(id)')
      .eq('is_test', test).gte('created_at', FY_START).order('created_at', { ascending: false })
    setTransfers(data || [])
    setLoading(false)
  }

  function matchFilter(t, f) { return f === 'all' ? true : t.status === f }
  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = transfers.filter(t => matchFilter(t, key)).length; return acc }, {})

  const q = search.trim().toLowerCase()
  const filtered = transfers.filter(t => matchFilter(t, filter))
    .filter(t => !q || (t.transfer_number || '').toLowerCase().includes(q) || (t.source_fc || '').toLowerCase().includes(q) || (t.destination_fc || '').toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const isAdmin = userRole === 'admin'
  const canCreate = ['ops','admin','management','fc_kaveri','fc_godawari'].includes(userRole)

  return (
    <Layout pageTitle="Stock Transfers" pageKey="fc">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Stock Transfers</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> transfers</span>
              <span className="o-sep">·</span>
              <span>Move stock between Kaveri & Godawari</span>
            </div>
          </div>
          <div className="page-meta">
            {isAdmin && (
              <label className={`o-test-toggle ${testMode ? 'on' : ''}`}>
                <input type="checkbox" checked={testMode} onChange={e => { setTestMode(e.target.checked); loadTransfers(e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            {canCreate && (
              <button className="btn-primary" onClick={() => navigate('/fc/transfers/new')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Transfer
              </button>
            )}
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="Total Transfers" value={transfers.length} sub="this FY" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Received" value={counts.received} sub="completed" chart="bars" onClick={() => setFilter('received')}/>
          <KpiTile variant="hero" tone="teal" label="In Transit" value={counts.dispatched} sub="dispatched" chart="bars" onClick={() => setFilter('dispatched')}/>
          <KpiTile label="Draft" value={counts.draft} sub="not yet dispatched" accent={counts.draft > 0 ? 'amber' : null} onClick={() => setFilter('draft')}/>
          <KpiTile label="Cancelled" value={counts.cancelled} sub="cancelled" onClick={() => setFilter('cancelled')}/>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search transfer # or FC…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
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
          <div className="o-loading">Loading transfers…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 100px 110px 130px' }}>
              <div>Transfer #</div>
              <div>Route</div>
              <div className="num">Items</div>
              <div>Created</div>
              <div className="num">Status</div>
            </div>
            {pageRows.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No transfers yet</div>
                {canCreate && <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Click "New Transfer" to create one.</div>}
              </div>
            ) : (
              <div className="ol-table">
                {pageRows.map(t => (
                  <div key={t.id} className="ol-row ol-data" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 100px 110px 130px' }} onClick={() => navigate('/fc/transfers/' + t.id)}>
                    <div className="ol-cell">
                      <div className="ol-num">{t.transfer_number || '—'}</div>
                    </div>
                    <div className="ol-cell ol-cust">
                      {t.source_fc} <span style={{ color:'var(--o-muted-2)', margin:'0 6px' }}>→</span> {t.destination_fc}
                    </div>
                    <div className="ol-cell ol-items">{(t.stock_transfer_items || []).length}</div>
                    <div className="ol-cell ol-date">{fmt(t.created_at)}</div>
                    <div className="ol-cell ol-status-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': STATUS_COLORS[t.status] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>
                        {STATUS_LABELS[t.status] || t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {filtered.length > 0 && totalPages > 1 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                  <span style={{ padding: '5px 10px', fontSize: 13, color: 'var(--o-muted)' }}>Page {safePage} of {totalPages}</span>
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                </div>
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
