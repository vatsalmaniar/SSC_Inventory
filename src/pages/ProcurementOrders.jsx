import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/orders.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const STATUS_LABELS = {
  inv_check: 'Order Approved', inventory_check: 'Inventory Check', dispatch: 'Ready to Ship', cancelled: 'Cancelled',
}
const STATUS_COLORS = {
  inv_check: { bg:'#eff6ff', color:'#1d4ed8' }, inventory_check: { bg:'#eff6ff', color:'#1d4ed8' }, dispatch: { bg:'#f0fdf4', color:'#15803d' }, cancelled: { bg:'#fef2f2', color:'#dc2626' },
}
const PRE_APPROVAL_PO_STATUSES = ['draft', 'pending_approval']
const ORPHAN_PO_STATUSES       = ['approved','placed','acknowledged','delivery_confirmation','partially_received']

export default function ProcurementOrders() {
  const navigate = useNavigate()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const [tab, setTab]         = useState('pending')
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['ops','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }

    // ── Query A: Pending tab — every approved CO this FY. Coverage filter (below) hides fully covered/done.
    // ── Query B: Orphan tab — every post-approval PO (any date) whose linked CO is cancelled
    const [coDataRes, orphanPosRes] = await Promise.all([
      sb.from('orders')
        .select('id,order_number,customer_name,status,created_at,order_items(id,total_price)')
        .eq('is_test', false).eq('order_type', 'CO')
        .neq('status', 'pending')
        .gte('created_at', FY_START)
        .order('created_at', { ascending: false }),
      sb.from('purchase_orders')
        .select('id,order_id,status')
        .in('status', ORPHAN_PO_STATUSES)
        .not('order_id', 'is', null),
    ])

    let coOrders = coDataRes.data || []
    const orphanPosAll = orphanPosRes.data || []

    // Merge: fetch any cancelled COs referenced by orphan POs that aren't already in Query A
    if (orphanPosAll.length) {
      const existingIds = new Set(coOrders.map(o => o.id))
      const missingIds  = [...new Set(orphanPosAll.map(p => p.order_id))].filter(id => !existingIds.has(id))
      if (missingIds.length) {
        const { data: extraCos } = await sb.from('orders')
          .select('id,order_number,customer_name,status,created_at,order_items(id,total_price)')
          .in('id', missingIds).eq('status', 'cancelled')
        if (extraCos?.length) coOrders = [...coOrders, ...extraCos]
      }
    }

    if (coOrders.length) {
      const coIds = coOrders.map(o => o.id)
      // Full PO list for these COs (pending-tab needs all; orphan-tab needs post-approval subset)
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
    if (o.status === 'cancelled') return !o._hasPostApprovalPO     // pre-approval cancelled
    return o._coveredItems < o._totalItems                         // active, not fully covered
  })
  const orphanOrders = orders.filter(o => o.status === 'cancelled' && (o._orphanPOs?.length > 0))

  const visible = tab === 'orphan' ? orphanOrders : pendingOrders
  const q = search.trim().toLowerCase()
  const filtered = !q ? visible : visible.filter(o =>
    (o.order_number||'').toLowerCase().includes(q) ||
    (o.customer_name||'').toLowerCase().includes(q)
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Layout pageTitle="CO Orders" pageKey="procurement">
      <div className="od-page">
        <div className="od-body">

          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Procurement</div>
                <div className="od-header-title">Custom Orders — PO Coverage</div>
                <div className="od-header-num">
                  {tab === 'orphan'
                    ? `${orphanOrders.length} cancelled CO${orphanOrders.length !== 1 ? 's' : ''} with orphan PO${orphanOrders.length !== 1 ? 's' : ''}`
                    : `${pendingOrders.length} order${pendingOrders.length !== 1 ? 's' : ''} with uncovered items`}
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>
            </div>
          ) : (
            <div className="od-card">
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <div style={{ display:'flex', borderRadius:8, border:'1px solid var(--gray-200)', overflow:'hidden', background:'#f9fafb', flexShrink:0 }}>
                  <button onClick={() => { setTab('pending'); setPage(1) }}
                    style={{ padding:'6px 14px', fontSize:12, fontWeight: tab === 'pending' ? 700 : 600, border:'none', cursor:'pointer', background: tab === 'pending' ? '#1a4dab' : 'transparent', color: tab === 'pending' ? 'white' : 'var(--gray-500)', fontFamily:'var(--font)' }}>
                    Pending POs
                    <span style={{ marginLeft:6, fontSize:11, opacity:0.8 }}>{pendingOrders.length}</span>
                  </button>
                  <button onClick={() => { setTab('orphan'); setPage(1) }}
                    style={{ padding:'6px 14px', fontSize:12, fontWeight: tab === 'orphan' ? 700 : 600, border:'none', cursor:'pointer', background: tab === 'orphan' ? '#dc2626' : 'transparent', color: tab === 'orphan' ? 'white' : 'var(--gray-500)', fontFamily:'var(--font)' }}>
                    Orphan POs
                    <span style={{ marginLeft:6, fontSize:11, opacity:0.8 }}>{orphanOrders.length}</span>
                  </button>
                </div>
                <div className="od-search-wrap" style={{ maxWidth:420, flex:1, minWidth:220 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                  <input
                    className="od-search-input"
                    placeholder="Search order number or customer..."
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1) }}
                  />
                  {search && (
                    <button className="od-search-clear" onClick={() => { setSearch(''); setPage(1) }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}>
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <table className="od-items-table">
                <thead>
                  <tr>
                    <th>Order Number</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th style={{ textAlign:'center' }}>PO Coverage</th>
                    <th style={{ textAlign:'right' }}>Value</th>
                    <th>Created</th>
                    <th style={{ textAlign:'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(o => {
                    const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
                    const sSc = STATUS_COLORS[o.status] || STATUS_COLORS.inv_check
                    const covered = o._coveredItems || 0
                    const total = o._totalItems || 0
                    const hasPartial = covered > 0 && covered < total
                    const isCancelled = o.status === 'cancelled'
                    return (
                      <tr key={o.id} style={isCancelled ? { background:'#fef2f2' } : undefined}>
                        <td>
                          <span onClick={() => navigate('/orders/' + o.id)} style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, color: isCancelled ? '#b91c1c' : '#1a4dab', cursor:'pointer', textDecoration: isCancelled ? 'line-through' : 'none' }}>{o.order_number}</span>
                        </td>
                        <td style={{ fontWeight:500, color:'var(--gray-800)' }}>{o.customer_name}</td>
                        <td>
                          <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background:sSc.bg, color:sSc.color }}>
                            {STATUS_LABELS[o.status] || o.status}
                          </span>
                        </td>
                        <td style={{ textAlign:'center' }}>
                          <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:6, background: hasPartial ? '#fffbeb' : '#fef2f2', color: hasPartial ? '#92400e' : '#dc2626' }}>
                            {covered}/{total} items
                          </span>
                        </td>
                        <td style={{ textAlign:'right', fontWeight:600 }}>{fmtCr(val)}</td>
                        <td style={{ fontSize:12, color:'var(--gray-500)' }}>{fmtShort(o.created_at)}</td>
                        <td style={{ textAlign:'center' }}>
                          {tab === 'orphan' && isCancelled && o._orphanPOs?.length > 0 ? (
                            <button onClick={() => navigate('/procurement/po/' + o._orphanPOs[0].id)}
                              style={{ fontSize:11, padding:'4px 12px', fontWeight:700, border:'none', borderRadius:6, background:'#ea580c', color:'white', cursor:'pointer', fontFamily:'var(--font)' }}>
                              Relink PO →{o._orphanPOs.length > 1 ? ` (${o._orphanPOs.length})` : ''}
                            </button>
                          ) : isCancelled ? (
                            <span style={{ fontSize:11, fontWeight:600, color:'#b91c1c' }}>Cancel draft PO →</span>
                          ) : (
                            <button className="od-btn od-btn-approve" onClick={() => navigate('/procurement/po/new?order_id=' + o.id)}
                              style={{ fontSize:11, padding:'4px 12px' }}>
                              {hasPartial ? 'Add PO →' : 'Create PO →'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)', fontSize:13 }}>
                  {search
                    ? `No orders match "${search}".`
                    : tab === 'orphan'
                      ? 'No cancelled COs with orphan POs. Everything looks clean.'
                      : 'All caught up! All Custom Orders have linked Purchase Orders.'}
                </div>
              )}
              {filtered.length > 0 && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--gray-100)', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                    Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} order{filtered.length !== 1 ? 's' : ''}
                  </span>
                  {totalPages > 1 && (
                    <div style={{ display:'flex', gap:4 }}>
                      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === 1 ? 'default' : 'pointer', color: safePage === 1 ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>‹ Prev</button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                        const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                        const ellipsis = !show && Math.abs(p - safePage) === 2
                        if (show) return (
                          <button key={p} onClick={() => setPage(p)}
                            style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor: p === safePage ? '#1a4dab' : 'var(--gray-200)', background: p === safePage ? '#1a4dab' : 'white', color: p === safePage ? 'white' : 'var(--gray-700)', fontWeight: p === safePage ? 700 : 400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{p}</button>
                        )
                        if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 2px', color:'var(--gray-400)', fontSize:13, lineHeight:'28px' }}>…</span>
                        return null
                      })}
                      <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === totalPages ? 'default' : 'pointer', color: safePage === totalPages ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>Next ›</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
