import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const STATUS_LABELS = { inv_check:'Order Approved', inventory_check:'Inventory Check', dispatch:'Ready to Ship', cancelled:'Cancelled' }
const STATUS_COLORS = { inv_check:'#1E54B7', inventory_check:'#0EA5E9', dispatch:'#06B6D4', cancelled:'#EF4444' }

const PRE_APPROVAL_PO_STATUSES = ['draft', 'pending_approval']
const ORPHAN_PO_STATUSES = ['approved','placed','acknowledged','delivery_confirmation','partially_received']

export default function ProcurementOrders() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [tab, setTab] = useState('pending')
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['ops','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }

    const [coDataRes, orphanPosRes] = await Promise.all([
      sb.from('orders')
        .select('id,order_number,customer_name,status,created_at,order_items(id,total_price)')
        .eq('is_test', false).eq('order_type', 'CO')
        .neq('status', 'pending')
        .gte('created_at', FY_START)
        .order('created_at', { ascending: false }),
      sb.from('purchase_orders').select('id,order_id,status').in('status', ORPHAN_PO_STATUSES).not('order_id', 'is', null),
    ])

    let coOrders = coDataRes.data || []
    const orphanPosAll = orphanPosRes.data || []
    if (orphanPosAll.length) {
      const existingIds = new Set(coOrders.map(o => o.id))
      const missingIds = [...new Set(orphanPosAll.map(p => p.order_id))].filter(id => !existingIds.has(id))
      if (missingIds.length) {
        const { data: extraCos } = await sb.from('orders')
          .select('id,order_number,customer_name,status,created_at,order_items(id,total_price)')
          .in('id', missingIds).eq('status', 'cancelled')
        if (extraCos?.length) coOrders = [...coOrders, ...extraCos]
      }
    }

    if (coOrders.length) {
      const coIds = coOrders.map(o => o.id)
      const { data: linkedPos } = await sb.from('purchase_orders').select('id,order_id,status').in('order_id', coIds)
      let coveredSet = new Set()
      const posByCo = {}
      if (linkedPos?.length) {
        for (const p of linkedPos) {
          if (!posByCo[p.order_id]) posByCo[p.order_id] = []
          posByCo[p.order_id].push({ id: p.id, status: p.status })
        }
        const poIds = linkedPos.map(p => p.id)
        const { data: poItems } = await sb.from('po_items').select('order_item_id').in('po_id', poIds).not('order_item_id', 'is', null)
        coveredSet = new Set((poItems || []).map(pi => pi.order_item_id))
      }
      coOrders = coOrders.map(o => {
        const total = (o.order_items || []).length
        const covered = (o.order_items || []).filter(oi => coveredSet.has(oi.id)).length
        const linkedPosList = posByCo[o.id] || []
        const orphanPOs = linkedPosList.filter(p => ORPHAN_PO_STATUSES.includes(p.status))
        const hasPostApprovalPO = linkedPosList.some(p => !PRE_APPROVAL_PO_STATUSES.includes(p.status))
        return { ...o, _totalItems: total, _coveredItems: covered, _hasPostApprovalPO: hasPostApprovalPO, _orphanPOs: orphanPOs }
      })
    }
    setOrders(coOrders)
    setLoading(false)
  }

  const pendingOrders = orders.filter(o => {
    if (o.status === 'cancelled') return !o._hasPostApprovalPO
    return o._coveredItems < o._totalItems
  })
  const orphanOrders = orders.filter(o => o.status === 'cancelled' && (o._orphanPOs?.length > 0))

  const visible = tab === 'orphan' ? orphanOrders : pendingOrders
  const q = search.trim().toLowerCase()
  const filtered = !q ? visible : visible.filter(o =>
    (o.order_number||'').toLowerCase().includes(q) || (o.customer_name||'').toLowerCase().includes(q)
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const totalUncovered = pendingOrders.reduce((s, o) => s + (o._totalItems - o._coveredItems), 0)
  const totalValue = pendingOrders.reduce((s, o) => s + (o.order_items || []).reduce((a,i) => a + (i.total_price||0), 0), 0)

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
          <KpiTile label="Fully Covered" value={orders.filter(o => o.status !== 'cancelled' && o._coveredItems >= o._totalItems).length} sub="all items linked"/>
          <KpiTile label="Cancelled COs" value={orders.filter(o => o.status === 'cancelled').length} sub="this FY"/>
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
                  const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
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
