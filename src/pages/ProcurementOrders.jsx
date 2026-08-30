import { useState, useEffect } from 'react'
import { codeIncludes } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { isDeliveredish } from '../lib/orderStatus'
import { lineIsHandled, lineToProcureQty, COVERING_PO_STATUSES, UNPLACED_PO_STATUSES, unplacedPoLabel,
         poSlaState, fmtSlaAge, fetchWorkflowOwners, SLA_APPROVE_HOURS, SLA_PLACE_HOURS } from '../lib/coverage'
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
// PO is live with the vendor while its customer order is dead → relink or stop it.
const ORPHAN_PO_STATUSES = ['approved','placed','acknowledged','delivery_confirmation','partially_received']
// PO already landed while its customer order is dead → the MATERIAL exists and
// needs a home. Previously excluded from the orphan tab entirely, so goods
// bought for cancelled orders were invisible in every worklist (audit F-17).
// Kept separate from ORPHAN_PO_STATUSES because the required action is different.
const DELIVERED_PO_STATUSES = ['material_received','closed']

export default function ProcurementOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  // step -> { name, id, slaHours }. Who to chase for each SLA breach; read
  // from po_workflow_owners so leave cover is a data change, not a deploy.
  const [owners, setOwners] = useState({})
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
    fetchWorkflowOwners().then(setOwners)   // non-blocking: the list must render regardless

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
      sb.from('purchase_orders').select('id,order_id,status').in('status', [...ORPHAN_PO_STATUSES, ...DELIVERED_PO_STATUSES]).eq('is_test', testMode),
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
      const addPo = (coId, poId, status, meta) => {
        if (!coId || !poId) return
        if (!posByCo[coId]) posByCo[coId] = []
        const existing = posByCo[coId].find(x => x.id === poId)
        if (existing) { if (meta && !existing.po_number) Object.assign(existing, meta); return }
        posByCo[coId].push({ id: poId, status, ...(meta || {}) })
      }
      const linkedPos = await chunkedFetch(
        // is_test must match the page mode — without it a test PO supplies
        // coverage/orphan state to a LIVE customer order, and vice versa.
        // po_number + dates come along so an unplaced PO can be named and aged.
        (slice) => sb.from('purchase_orders').select('id,order_id,status,po_number,approved_at,submitted_at,created_at').in('order_id', slice).eq('is_test', testMode),
        coIds
      )
      for (const p of linkedPos) addPo(p.order_id, p.id, p.status, { po_number: p.po_number, approved_at: p.approved_at, submitted_at: p.submitted_at, created_at: p.created_at })
      // Coverage by po_items.order_item_id directly — not via the PO header's
      // order_id — so lines on a PO clubbing multiple COs still count.
      // Only COVERING_PO_STATUSES count (cancelled and DRAFT do not) — the
      // status list is owned by lib/coverage.js so this query and the helper
      // can never drift apart.
      const allItemIds = coOrders.flatMap(o => (o.order_items || []).map(oi => oi.id))
      const poItems = await chunkedFetch(
        (slice) => sb.from('po_items').select('order_item_id, qty, po_id, purchase_orders!inner(status,po_number,approved_at,submitted_at,created_at)').in('order_item_id', slice).neq('purchase_orders.status', 'cancelled'),
        allItemIds
      )
      // Map of order_item_id -> FIRM covered qty (placed onwards). POs that
      // exist but are not yet with the vendor are tracked separately so the
      // requirement stays visible AND the buyer is told exactly where the PO is
      // stuck — never silently hidden, never silently duplicated.
      const coveredSet = new Map()
      const unplacedPoByCo = {}
      for (const pi of poItems) {
        const po = pi.purchase_orders || {}
        const st = po.status
        if (COVERING_PO_STATUSES.includes(st)) {
          coveredSet.set(pi.order_item_id, (coveredSet.get(pi.order_item_id) || 0) + (Number(pi.qty) || 0))
        } else if (UNPLACED_PO_STATUSES.includes(st)) {
          const coId = oiToCo[pi.order_item_id]
          if (coId) (unplacedPoByCo[coId] = unplacedPoByCo[coId] || new Set()).add(pi.po_id)
        }
        addPo(oiToCo[pi.order_item_id], pi.po_id, st, { po_number: po.po_number, approved_at: po.approved_at, created_at: po.created_at })
      }
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
        const deliveredOrphanPOs = linkedPosList.filter(p => DELIVERED_PO_STATUSES.includes(p.status))
        const hasPostApprovalPO = linkedPosList.some(p => !PRE_APPROVAL_PO_STATUSES.includes(p.status))
        // Unplaced POs on this CO, oldest first — the oldest is the one that
        // needs chasing, and its age drives the colour.
        const unplacedPOs = linkedPosList
          .filter(p => (unplacedPoByCo[o.id] || new Set()).has(p.id))
          // Each PO is aged against ITS OWN clock — 24h if it is waiting on an
          // approver, 48h if it is approved and waiting to be placed. Breaches
          // sort to the top, then by how far over they are.
          .map(p => ({ ...p, _sla: poSlaState(p) }))
          .sort((a, b) => (b._sla?.overdueBy || 0) - (a._sla?.overdueBy || 0) || (b._sla?.hours || 0) - (a._sla?.hours || 0))
        // Units still needing a PO that have ALREADY left the building. Purchase no
        // longer HIDES these (that was the byShipped bug — see lib/coverage.js), but
        // the buyer must know: this is a replenishment decision at today's price, not
        // a supply gap. Display only; it never affects coverage.
        const shippedPending = activeItems.filter(oi =>
          lineToProcureQty(oi, coveredSet) > 0 && (Number(oi.dispatched_qty) || 0) > 0).length
        return { ...o, _totalItems: total, _coveredItems: covered, _shippedPending: shippedPending, _stockClosed: stockClosed, _hasPostApprovalPO: hasPostApprovalPO, _orphanPOs: orphanPOs, _deliveredOrphanPOs: deliveredOrphanPOs, _unplacedPOs: unplacedPOs }
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
  // Customer orders whose only PO has not reached the vendor yet, and how many
  // of those have gone stale — the "approved and forgotten" measure.
  const staleUnplaced = timelineOrders.reduce((acc, o) => {
    const top = o._unplacedPOs?.[0]
    if (!top) return acc
    acc.count++
    if (top._sla?.breached) acc.stale++
    return acc
  }, { count: 0, stale: 0 })

  // Orphans = a cancelled CO whose PO is either still live with the vendor, or
  // already landed (material bought for an order that no longer exists).
  const orphanOrders = timelineOrders.filter(o => o.status === 'cancelled' &&
    ((o._orphanPOs?.length > 0) || (o._deliveredOrphanPOs?.length > 0)))

  // Every CO whose PO has not reached the vendor — INCLUDING ones already
  // delivered from stock, which never appear in Pending (nothing left to
  // procure) yet still hold a live PO that must be cancelled, not placed.
  // Oldest first: that is the cleanup order.
  const unplacedOrders = timelineOrders
    .filter(o => o._unplacedPOs?.length > 0)
    .sort((a, b) => (b._unplacedPOs[0]._sla?.overdueBy || 0) - (a._unplacedPOs[0]._sla?.overdueBy || 0))

  const visible = tab === 'orphan' ? orphanOrders : tab === 'unplaced' ? unplacedOrders : pendingOrders
  const q = search.trim().toLowerCase()
  const filtered = !q ? visible : visible.filter(o =>
    codeIncludes(o.order_number, q) || (o.customer_name||'').toLowerCase().includes(q)
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
          {/* PO exists but the vendor does not have it — the failure that hid 13 POs
              for 74-99 days. Counted so it can be managed, not just noticed. */}
          <KpiTile label="PO Not Placed" value={staleUnplaced.count}
            sub={staleUnplaced.stale > 0 ? `${staleUnplaced.stale} past SLA` : 'awaiting despatch to vendor'}
            accent={staleUnplaced.stale > 0 ? 'amber' : null}
            onClick={() => setTab('unplaced')}/>
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
          <button className={`o-chip ${tab === 'unplaced' ? 'on' : ''} ${staleUnplaced.stale > 0 ? 'warn' : ''}`} onClick={() => { setTab('unplaced'); setPage(1) }}>
            PO Not Placed
            {unplacedOrders.length > 0 && <span className="o-chip-n">{unplacedOrders.length}</span>}
          </button>
          <button className={`o-chip ${tab === 'orphan' ? 'on' : ''} danger`} onClick={() => { setTab('orphan'); setPage(1) }}>
            Orphan POs
            {orphanOrders.length > 0 && <span className="o-chip-n">{orphanOrders.length}</span>}
          </button>
        </div>

        {tab === 'unplaced' && (
          <div style={{ margin: '0 0 12px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
            A purchase order exists for these customer orders but the <b>vendor does not have it yet</b> — so nothing is on order.
            Each one needs one of three decisions:
            <div style={{ marginTop: 6, lineHeight: 1.7 }}>
              <b>1 · Place it</b> — the customer is still waiting, or the price was negotiated and you want the material
              (e.g. the order shipped from old stock and this replenishes it).<br/>
              <b>2 · Material already received?</b> Common for older POs raised before the GRN module existed — the goods came in
              but the receipt was never recorded. Mark the PO <b>Placed</b>, then create the <b>GRN</b> to close it properly.<br/>
              <b>3 · Cancel it</b> — genuinely not needed and nothing was received.
            </div>
            Orders marked <b>Delivered</b> have already reached the customer — on its own that does <b>not</b> mean cancel;
            it usually means option 2 or 1. SLA: approve within <b>{SLA_APPROVE_HOURS}h</b>, place with the vendor within <b>{SLA_PLACE_HOURS}h</b> of approval —
            rows past their own SLA are shown in red, with the person who owns that step.
          </div>
        )}

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
                <div className="ol-empty-title">{search ? `No orders match "${search}"` : tab === 'orphan' ? 'No orphan POs — all clean' : tab === 'unplaced' ? 'Every PO has reached its vendor' : 'All COs covered'}</div>
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
                      <div className="ol-cell ol-cust" title={o.customer_name}>
                        {o.customer_name}
                        {o._shippedPending > 0 && (
                          <span title={`${o._shippedPending} line${o._shippedPending>1?'s':''} on this order already went out to the customer but still has no PO. It most likely shipped from stock — confirm whether you need to buy replacement stock at today's price, or close the line from stock.`}
                            style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#fef3c7', color: '#92400e' }}>
                            ALREADY SHIPPED
                          </span>
                        )}
                        {tab === 'unplaced' && isDeliveredish(o) && (
                          <span title="Delivered to the customer — usually served from stock. Do NOT assume the PO should be cancelled: the material may already have been received without a GRN (common for POs raised before the GRN module), in which case mark the PO Placed and create the GRN. Or the price was negotiated and you still want the material."
                            style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#dcfce7', color: '#166534' }}>
                            DELIVERED
                          </span>
                        )}
                      </div>
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
                        ) : tab === 'orphan' && isCancelled && o._deliveredOrphanPOs?.length > 0 ? (
                          // Material already arrived for a dead order — different problem,
                          // different action: find out where the goods went.
                          <button onClick={(e) => { e.stopPropagation(); navigate('/procurement/po/' + o._deliveredOrphanPOs[0].id) }}
                            title="Goods were received against this PO but the customer order was cancelled — trace where the material went"
                            style={{ fontSize: 11, padding: '5px 12px', fontWeight: 600, border: 'none', borderRadius: 6, background: '#7C2D12', color: 'white', cursor: 'pointer' }}>
                            Material received — trace →{o._deliveredOrphanPOs.length > 1 ? ` (${o._deliveredOrphanPOs.length})` : ''}
                          </button>
                        ) : isCancelled && tab !== 'unplaced' ? (
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#B91C1C' }}>Cancel draft PO</span>
                        ) : o._unplacedPOs?.length > 0 ? (() => {
                          // A PO exists but the vendor does not have it yet, so this
                          // requirement is NOT firm coverage. Name where it is stuck and
                          // how long it has waited — red once stale — so it gets chased
                          // instead of duplicated. (13 POs sat approved-but-unplaced for
                          // 74-99 days before this existed.)
                          const top = o._unplacedPOs[0]
                          const sla = top._sla
                          const stale = !!sla?.breached
                          // Name the owner on the chip: a breach with no owner
                          // is a complaint, a breach with a name is a task.
                          const ownerName = sla?.owner && owners[sla.owner]?.name
                          return (
                            <button onClick={(e) => { e.stopPropagation(); navigate('/procurement/po/' + top.id) }}
                              title={`${top.po_number || 'PO'} — ${unplacedPoLabel(top.status)}\n`
                                + (sla?.slaHours
                                    ? `Waiting ${fmtSlaAge(sla.hours)} against a ${sla.slaHours}h SLA`
                                      + (stale ? ` — ${fmtSlaAge(sla.overdueBy)} over` : '')
                                      + (ownerName ? `\nOwner: ${ownerName}` : '')
                                      + (sla.approximate ? '\n(Approximate — this PO predates submitted-time tracking)' : '')
                                    : `Draft for ${fmtSlaAge(sla?.hours)} — not yet submitted`)
                                + '\nThe vendor does not have this order yet.'}
                              style={{ fontSize: 11, padding: '5px 12px', fontWeight: 600, borderRadius: 6, cursor: 'pointer',
                                border: stale ? 'none' : '1px solid #FDE68A',
                                background: stale ? '#B91C1C' : '#FEF3C7',
                                color: stale ? 'white' : '#92400E' }}>
                              {unplacedPoLabel(top.status)} →{o._unplacedPOs.length > 1 ? ` (${o._unplacedPOs.length})` : ''}
                              {stale ? ` · ${fmtSlaAge(sla.hours)}` : ''}
                            </button>
                          )
                        })() : (
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
