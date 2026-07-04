import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { lineIsHandled } from '../lib/coverage'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const STATUS_LABELS = { inv_check:'Order Approved', inventory_check:'Inventory Check', dispatch:'Ready to Ship', cancelled:'Cancelled' }
const STATUS_COLORS = { inv_check:'#1a73e8', inventory_check:'#0EA5E9', dispatch:'#06B6D4', cancelled:'#EF4444' }

const PRE_APPROVAL_PO_STATUSES = ['draft', 'pending_approval']
const ORPHAN_PO_STATUSES = ['approved','placed','acknowledged','delivery_confirmation','partially_received']

export default function ProcurementOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState('pending')
  const [timeline, setTimeline] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [testMode])

  async function init() {
    setLoading(true)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['ops','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    setIsAdmin(profile?.role === 'admin')

    const [coDataRes, orphanPosRes] = await Promise.all([
      sb.from('orders')
        .select('id,order_number,customer_name,status,created_at,order_items(id,qty,total_price,unit_price_after_disc,cancelled_qty,dispatched_qty,stock_qty,line_status,procurement_source)')
        .eq('is_test', testMode).eq('order_type', 'CO')
        // Pull every non-pending CO; whether a line still needs a PO is decided
        // per LINE by the shared coverage helper (active + not stock + not yet
        // dispatched + no active PO), NOT by the order's header status. A
        // partly-dispatched CO keeps showing its unprocured lines; a fully
        // handled one drops out because every line is handled.
        .neq('status', 'pending')
        .gte('created_at', FY_START)
        .order('created_at', { ascending: false }),
      sb.from('purchase_orders').select('id,order_id,status').in('status', ORPHAN_PO_STATUSES).eq('is_test', testMode),
    ])

    // Chunk .in() lookups — once we cross ~150 UUIDs the URL exceeds PostgREST's
    // 8 KB cap and the query gets silently truncated (= COs falsely shown as
    // uncovered because their POs fall outside the truncated set).
    async function chunkedFetch(builderFn, ids, chunkSize = 150) {
      const all = []
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize)
        const { data, error } = await builderFn(slice)
        if (error) { console.error('chunkedFetch error:', error); continue }
        if (data?.length) all.push(...data)
      }
      return all
    }

    let coOrders = coDataRes.data || []
    const orphanPosAll = orphanPosRes.data || []
    if (orphanPosAll.length) {
      // Cancelled COs touched by post-approval POs but missing from the main
      // list (e.g. pre-FY). Checked via BOTH the PO header and the PO lines —
      // a clubbed PO's non-header COs only connect at line level.
      const existingIds = new Set(coOrders.map(o => o.id))
      const orphanPoIds = orphanPosAll.map(p => p.id)
      const lineOiRows = await chunkedFetch(
        (slice) => sb.from('po_items').select('order_item_id').in('po_id', slice).not('order_item_id', 'is', null),
        orphanPoIds
      )
      const lineCoRows = await chunkedFetch(
        (slice) => sb.from('order_items').select('id,order_id').in('id', slice),
        [...new Set(lineOiRows.map(r => r.order_item_id))]
      )
      const candidateIds = [...new Set([
        ...orphanPosAll.map(p => p.order_id).filter(Boolean),
        ...lineCoRows.map(r => r.order_id).filter(Boolean),
      ])]
      const missingIds = candidateIds.filter(cid => !existingIds.has(cid))
      if (missingIds.length) {
        const { data: extraCos } = await sb.from('orders')
          .select('id,order_number,customer_name,status,created_at,order_items(id,qty,total_price,unit_price_after_disc,cancelled_qty,dispatched_qty,stock_qty,line_status,procurement_source)')
          .in('id', missingIds).eq('status', 'cancelled').eq('is_test', testMode)
        if (extraCos?.length) coOrders = [...coOrders, ...extraCos]
      }
    }

    if (coOrders.length) {
      const coIds = coOrders.map(o => o.id)
      // CO → POs map, built from BOTH routes: header order_id AND line-level
      // links (clubbed POs carry lines of COs the header doesn't mention).
      const oiToCo = {}
      for (const o of coOrders) for (const oi of (o.order_items || [])) oiToCo[oi.id] = o.id
      const posByCo = {}
      const addPo = (coId, poId, status) => {
        if (!coId || !poId) return
        if (!posByCo[coId]) posByCo[coId] = []
        if (!posByCo[coId].some(x => x.id === poId)) posByCo[coId].push({ id: poId, status })
      }
      const linkedPos = await chunkedFetch(
        (slice) => sb.from('purchase_orders').select('id,order_id,status').in('order_id', slice),
        coIds
      )
      for (const p of linkedPos) addPo(p.order_id, p.id, p.status)
      // Coverage by po_items.order_item_id directly — not via the PO header's
      // order_id — so lines on a PO clubbing multiple COs still count.
      // Cancelled POs do NOT count (their items need procuring again).
      const allItemIds = coOrders.flatMap(o => (o.order_items || []).map(oi => oi.id))
      const poItems = await chunkedFetch(
        (slice) => sb.from('po_items').select('order_item_id, qty, po_id, purchase_orders!inner(status)').in('order_item_id', slice).neq('purchase_orders.status', 'cancelled'),
        allItemIds
      )
      // Map of order_item_id -> covered qty (quantity-precise, shared helper).
      const coveredSet = new Map()
      for (const pi of poItems) coveredSet.set(pi.order_item_id, (coveredSet.get(pi.order_item_id) || 0) + (Number(pi.qty) || 0))
      for (const pi of poItems) addPo(oiToCo[pi.order_item_id], pi.po_id, pi.purchase_orders?.status)
      coOrders = coOrders.map(o => {
        // Only count active (non-cancelled / non-short-closed) lines for coverage
        const activeItems = (o.order_items || []).filter(oi => (oi.line_status || 'active') === 'active')
        const total = activeItems.length
        // "Handled" = covered by an active PO, from stock, OR already dispatched.
        // Shared helper is the single definition (see lib/coverage.js).
        const covered = activeItems.filter(oi => lineIsHandled(oi, coveredSet)).length
        const stockClosed = activeItems.filter(oi => oi.procurement_source === 'stock').length
        const linkedPosList = posByCo[o.id] || []
        const orphanPOs = linkedPosList.filter(p => ORPHAN_PO_STATUSES.includes(p.status))
        const hasPostApprovalPO = linkedPosList.some(p => !PRE_APPROVAL_PO_STATUSES.includes(p.status))
        return { ...o, _totalItems: total, _coveredItems: covered, _stockClosed: stockClosed, _hasPostApprovalPO: hasPostApprovalPO, _orphanPOs: orphanPOs }
      })
    }
    setOrders(coOrders)
    setLoading(false)
  }

  // Timeline filters on created date (order_date isn't fetched on this worklist)
  const timelineOrders = orders.filter(o => dateInTimeline(o.created_at, timeline, customFrom, customTo))
  const pendingOrders = timelineOrders.filter(o => {
    if (o.status === 'cancelled') return !o._hasPostApprovalPO
    return o._coveredItems < o._totalItems
  })
  const orphanOrders = timelineOrders.filter(o => o.status === 'cancelled' && (o._orphanPOs?.length > 0))

  const visible = tab === 'orphan' ? orphanOrders : pendingOrders
  const q = search.trim().toLowerCase()
  const filtered = !q ? visible : visible.filter(o =>
    (o.order_number||'').toLowerCase().includes(q) || (o.customer_name||'').toLowerCase().includes(q)
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const totalUncovered = pendingOrders.reduce((s, o) => s + (o._totalItems - o._coveredItems), 0)
  const totalValue = pendingOrders.reduce((s, o) => s + (o.order_items || []).reduce((a,i) => a + ((i.total_price||0) - ((i.cancelled_qty||0) * (i.unit_price_after_disc || i.unit_price || 0))), 0), 0)

  return (
    <Layout pageTitle="CO Orders" pageKey="procurement">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Custom Orders — PO Coverage</h1>
            <div className="o-summary">
              <span><b>{tab === 'orphan' ? orphanOrders.length : pendingOrders.length}</b> {tab === 'orphan' ? 'cancelled with orphan POs' : 'with uncovered items'}</span>
              {tab === 'pending' && totalUncovered > 0 && (<><span className="o-sep">·</span><span><b>{totalUncovered}</b> items to cover</span></>)}
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-ghost" onClick={() => navigate('/procurement/po')}>All POs</button>
            <button className="btn-primary" onClick={() => navigate('/procurement/po/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New PO
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="Pending Coverage" value={pendingOrders.length} sub={`${totalUncovered} items`} chart="bars" onClick={() => setTab('pending')}/>
          <KpiTile variant="hero" tone="forest" label="Total CO Value" value={fmtCr(totalValue)} sub="across pending COs" chart="line"/>
          <KpiTile variant="hero" tone="teal" label="Orphan POs" value={orphanOrders.length} sub="post-approval · CO cancelled" chart="bars" onClick={() => setTab('orphan')}/>
          <KpiTile label="Fully Covered" value={timelineOrders.filter(o => o.status !== 'cancelled' && o._coveredItems >= o._totalItems).length} sub="all items linked"/>
          <KpiTile label="Cancelled COs" value={timelineOrders.filter(o => o.status === 'cancelled').length} sub="this FY"/>
        </div>

        {/* Timeline — filters on CO created date */}
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
            <input placeholder="Search order number or customer…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => { setSearch(''); setPage(1) }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          {isAdmin && (
            <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:testMode ? '#b45309' : 'var(--gray-500)',fontWeight:testMode ? 600 : 400,background:testMode ? '#fef3c7' : 'transparent',border:testMode ? '1px solid #fde68a' : '1px solid transparent',borderRadius:8,padding:'6px 12px',transition:'all 0.15s',marginLeft:10,flexShrink:0}}>
              <input type="checkbox" checked={testMode} onChange={e => { setTestMode(e.target.checked); setPage(1) }} style={{accentColor:'#b45309',width:14,height:14}} />
              Test Mode
            </label>
          )}
        </div>

        <div className="o-filter-row">
          <button className={`o-chip ${tab === 'pending' ? 'on' : ''}`} onClick={() => { setTab('pending'); setPage(1) }}>
            Pending POs
            {pendingOrders.length > 0 && <span className="o-chip-n">{pendingOrders.length}</span>}
          </button>
          <button className={`o-chip ${tab === 'orphan' ? 'on' : ''} danger`} onClick={() => { setTab('orphan'); setPage(1) }}>
            Orphan POs
            {orphanOrders.length > 0 && <span className="o-chip-n">{orphanOrders.length}</span>}
          </button>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 130px 120px 110px 110px 130px' }}>
              <div>Order #</div>
              <div>Customer</div>
              <div>Status</div>
              <div>Coverage</div>
              <div className="num">Value</div>
              <div>Created</div>
              <div style={{ textAlign: 'right' }}>Action</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">{search ? `No orders match "${search}"` : tab === 'orphan' ? 'No orphan POs — all clean' : 'All COs covered'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(o => {
                  const val = (o.order_items || []).reduce((s, i) => s + ((i.total_price || 0) - ((i.cancelled_qty||0) * (i.unit_price_after_disc || i.unit_price || 0))), 0)
                  const covered = o._coveredItems || 0
                  const total = o._totalItems || 0
                  const hasPartial = covered > 0 && covered < total
                  const isCancelled = o.status === 'cancelled'
                  const statusColor = STATUS_COLORS[o.status] || '#94A3B8'
                  return (
                    <div key={o.id} className="ol-row ol-data" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 130px 120px 110px 110px 130px' }}>
                      <div className="ol-cell">
                        <div className="ol-num" style={{ color: isCancelled ? '#B91C1C' : 'var(--ssc-blue)', textDecoration: isCancelled ? 'line-through' : 'none' }} onClick={() => navigate('/orders/' + o.id)}>{o.order_number}</div>
                      </div>
                      <div className="ol-cell ol-cust" title={o.customer_name}>{o.customer_name}</div>
                      <div className="ol-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': statusColor }}>
                          <span className="ol-status-dot"/>
                          {STATUS_LABELS[o.status] || o.status}
                        </span>
                      </div>
                      <div className="ol-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': hasPartial ? '#D97706' : isCancelled ? '#94A3B8' : '#EF4444' }}>
                          <span className="ol-status-dot"/>
                          {covered}/{total} items
                        </span>
                      </div>
                      <div className="ol-cell ol-val">{fmtCr(val)}</div>
                      <div className="ol-cell ol-date">{fmtShort(o.created_at)}</div>
                      <div className="ol-cell" style={{ textAlign: 'right' }}>
                        {tab === 'orphan' && isCancelled && o._orphanPOs?.length > 0 ? (
                          <button onClick={(e) => { e.stopPropagation(); navigate('/procurement/po/' + o._orphanPOs[0].id) }}
                            style={{ fontSize: 11, padding: '5px 12px', fontWeight: 600, border: 'none', borderRadius: 6, background: '#EA580C', color: 'white', cursor: 'pointer' }}>
                            Relink PO →{o._orphanPOs.length > 1 ? ` (${o._orphanPOs.length})` : ''}
                          </button>
                        ) : isCancelled ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#B91C1C' }}>Cancel draft PO</span>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); navigate('/procurement/po/new?order_id=' + o.id) }}
                            style={{ fontSize: 11, padding: '5px 12px', fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--ssc-deep)', color: 'white', cursor: 'pointer' }}>
                            {hasPartial ? 'Add PO →' : 'Create PO →'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
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
