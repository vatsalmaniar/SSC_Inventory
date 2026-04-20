import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

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

export default function ProcurementOrders() {
  const navigate = useNavigate()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['ops','admin'].includes(profile?.role)) { navigate('/dashboard'); return }

    // Fetch CO orders — include cancelled so procurement can react before PO is approved
    const { data: coData } = await sb.from('orders')
      .select('id,order_number,customer_name,status,created_at,order_items(id,total_price)')
      .eq('is_test', false)
      .eq('order_type', 'CO')
      .in('status', ['inv_check','inventory_check','dispatch','cancelled'])
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })

    let coOrders = coData || []
    if (coOrders.length) {
      // Get item-level coverage + PO status for each CO
      const coIds = coOrders.map(o => o.id)
      const { data: linkedPos } = await sb.from('purchase_orders').select('id,order_id,status').in('order_id', coIds)
      let coveredSet = new Set()
      // Map order_id → array of linked PO statuses (so we know if any PO is past approval)
      const poStatusByCo = {}
      if (linkedPos?.length) {
        for (const p of linkedPos) {
          if (!poStatusByCo[p.order_id]) poStatusByCo[p.order_id] = []
          poStatusByCo[p.order_id].push(p.status)
        }
        const poIds = linkedPos.map(p => p.id)
        const { data: poItems } = await sb.from('po_items').select('order_item_id').in('po_id', poIds).not('order_item_id', 'is', null)
        coveredSet = new Set((poItems || []).map(pi => pi.order_item_id))
      }
      coOrders = coOrders.map(o => {
        const total = (o.order_items || []).length
        const covered = (o.order_items || []).filter(oi => coveredSet.has(oi.id)).length
        const poStatuses = poStatusByCo[o.id] || []
        const hasPostApprovalPO = poStatuses.some(s => !PRE_APPROVAL_PO_STATUSES.includes(s))
        return { ...o, _totalItems: total, _coveredItems: covered, _hasPostApprovalPO: hasPostApprovalPO }
      }).filter(o => {
        // Cancelled COs: show only if no PO placed beyond approval (procurement can still act)
        if (o.status === 'cancelled') return !o._hasPostApprovalPO
        // Active COs: hide fully covered
        return o._coveredItems < o._totalItems
      })
    }

    setOrders(coOrders)
    setLoading(false)
  }

  return (
    <Layout pageTitle="CO Orders" pageKey="procurement">
      <div className="od-page">
        <div className="od-body">

          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Procurement</div>
                <div className="od-header-title">Custom Orders — PO Coverage</div>
                <div className="od-header-num">{orders.length} order{orders.length !== 1 ? 's' : ''} with uncovered items</div>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>
            </div>
          ) : !orders.length ? (
            <div className="od-card" style={{ textAlign:'center', padding:'60px 20px', color:'var(--gray-400)' }}>
              <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ width:40, height:40, margin:'0 auto 12px', color:'var(--gray-300)' }}>
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>All caught up!</div>
              <div style={{ fontSize:13 }}>All Custom Orders have linked Purchase Orders.</div>
            </div>
          ) : (
            <div className="od-card">
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
                  {orders.map(o => {
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
                          {isCancelled ? (
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
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
