import { useState, useEffect } from 'react'
import { codeIncludes } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import '../styles/orders-redesign.css'
// .ph-bento / .ph-stat — the shared tile the rest of the app uses.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

const STATUS_LABELS = { draft:'Draft', dispatched:'In Transit', received:'Received', cancelled:'Cancelled' }
const STATUS_COLORS = { draft:'#94A3B8', dispatched:'#1a73e8', received:'#22C55E', cancelled:'#EF4444' }

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
  const [timeline, setTimeline] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

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
    // Page past PostgREST's 1000-row cap
    const { data, error } = await fetchAll((from, to) => sb.from('stock_transfers')
      .select('*, stock_transfer_items(id)')
      .eq('is_test', test).gte('created_at', FY_START)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to))
    if (error) console.error('Stock transfers load error:', error)
    setTransfers(data || [])
    setLoading(false)
  }

  function matchFilter(t, f) { return f === 'all' ? true : t.status === f }
  // Timeline filters on transfer created date
  const timelineTransfers = transfers.filter(t => dateInTimeline(t.created_at, timeline, customFrom, customTo))
  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = timelineTransfers.filter(t => matchFilter(t, key)).length; return acc }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineTransfers.filter(t => matchFilter(t, filter))
    .filter(t => !q || codeIncludes(t.transfer_number, q) || (t.source_fc || '').toLowerCase().includes(q) || (t.destination_fc || '').toLowerCase().includes(q))

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

        {/* KPI tiles — the shared <Stat/>. Same values, same filter targets. */}
        <div className="ph-bento o-bento-flat">
          <Stat label="Total Transfers" value={transfers.length} foot="this FY" />
          <Stat label="Received" value={counts.received} foot="completed"
            onClick={() => setFilter('received')} />
          <Stat label="In Transit" value={counts.dispatched} foot="dispatched"
            onClick={() => setFilter('dispatched')} />
          <Stat label="Draft" value={counts.draft} warn={counts.draft > 0} foot="not yet dispatched"
            onClick={() => setFilter('draft')} />
          <Stat label="Cancelled" value={counts.cancelled} foot="cancelled"
            onClick={() => setFilter('cancelled')} />
        </div>

        {/* Timeline — filters on transfer created date */}
        <div className="o-timeline">
          {TIMELINE_OPTIONS.map(({ key, label }) => (
            <button key={key} className={timeline === key ? 'on' : ''} onClick={() => { setTimeline(key); setPage(1) }}>{label}</button>
          ))}
          {timeline === 'custom' && (
            <div className="o-timeline-custom">
              <span>From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}/>
              <span>To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)}/>
              {(customFrom || customTo) && <button className="o-search-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }} style={{ marginLeft: 6, fontSize: 11, color: 'var(--o-bad)' }}>Clear</button>}
            </div>
          )}
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
            <div className="ol-row ol-head stx-row">
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
                  <div key={t.id} className="ol-row ol-data stx-row" onClick={() => navigate('/fc/transfers/' + t.id)}>
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
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    if (ellipsis) return <span key={'e' + p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
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

// KpiTile / KpiChart lived here — the tiles above are the shared <Stat/>.
// .kpi-tile / .kt-* stay in orders-redesign.css; other pages still render them.

