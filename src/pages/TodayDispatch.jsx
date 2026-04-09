import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'


function statusLabel(s) {
  return {
    pending:'Pending', inv_check:'Inv. Check', inventory_check:'Inventory Check',
    dispatch:'Ready to Ship', partial_dispatch:'Partially Shipped',
    gen_invoice:'Delivery Created', delivery_created:'Delivery Created', picking:'Picking', packing:'Packing',
    goods_issued:'Goods Issued', pending_billing:'Pending Billing',
    credit_check:'Credit Check', goods_issue_posted:'GI Posted',
    invoice_generated:'Invoice Generated', delivery_ready:'Delivery Ready',
    eway_pending:'E-Way Pending', eway_generated:'E-Way Generated',
    dispatched_fc:'Delivered', cancelled:'Cancelled',
  }[s] || s
}

export default function TodayDispatch() {
  const navigate = useNavigate()
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)

  const today     = new Date().toISOString().slice(0, 10)
  const todayFmt  = fmt(today)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
    }
    await load()
  }

  async function load() {
    setLoading(true)
    // Step 1: find which order IDs have items dispatching today
    const { data: items } = await sb.from('order_items')
      .select('order_id')
      .eq('dispatch_date', today)
    const orderIds = [...new Set((items || []).map(i => i.order_id))]
    if (orderIds.length === 0) { setOrders([]); setLoading(false); return }
    // Step 2: fetch only those orders
    const { data } = await sb.from('orders')
      .select('*, order_items(*)')
      .in('id', orderIds)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  // For each order, split items into today's items vs rest
  const totalItems = orders.reduce((s, o) =>
    s + (o.order_items || []).filter(i => i.dispatch_date === today).length, 0)
  const totalValue = orders.reduce((s, o) =>
    s + (o.order_items || []).filter(i => i.dispatch_date === today)
      .reduce((a, i) => a + (i.total_price || 0), 0), 0)

  return (
    <Layout pageTitle="Today's Dispatch" pageKey="orders">
      <div className="od-list-page">
        <div className="od-list-body">

          {/* Header */}
          <div className="od-list-header">
            <div>
              <div className="od-list-title">Today's Dispatch Plan</div>
              <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 3 }}>{todayFmt}</div>
            </div>
            <button className="od-download-btn" onClick={() => navigate('/orders/list')} style={{ padding: '8px 16px' }}>
              ← All Orders
            </button>
          </div>

          {/* Summary tile */}
          <div className="od-summary-tile">
            <div className="od-summary-stat">
              <div className="od-summary-val">{orders.length}</div>
              <div className="od-summary-label">Orders</div>
            </div>
            <div className="od-summary-divider" />
            <div className="od-summary-stat">
              <div className="od-summary-val">{totalItems}</div>
              <div className="od-summary-label">Items to Dispatch</div>
            </div>
            <div className="od-summary-divider" />
            <div className="od-summary-stat">
              <div className="od-summary-val">₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
              <div className="od-summary-label">Total Value</div>
            </div>
          </div>

          {loading ? (
            <div className="loading-state" style={{ padding: 40 }}><div className="loading-spin" />Loading...</div>
          ) : orders.length === 0 ? (
            <div className="orders-empty" style={{ background: 'white', border: '1px solid var(--gray-200)', borderRadius: 'var(--radius)' }}>
              <div className="orders-empty-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className="orders-empty-title">No dispatches scheduled for today</div>
              <div className="orders-empty-sub">Orders with dispatch date {todayFmt} will appear here.</div>
            </div>
          ) : (
            <div className="od-table-card">
              {orders.map(o => {
                const todayItems  = (o.order_items || []).filter(i => i.dispatch_date === today)
                const otherItems  = (o.order_items || []).filter(i => i.dispatch_date !== today)
                const todayVal    = todayItems.reduce((s, i) => s + (i.total_price || 0), 0)
                return (
                  <div key={o.id} style={{ borderBottom: '1px solid var(--gray-100)', padding: '16px 20px' }}>
                    {/* Order header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <span
                          className="order-num-cell"
                          style={{ fontWeight: 700, fontSize: 14, color: 'var(--blue-800)', cursor: 'pointer' }}
                          onClick={() => navigate('/orders/' + o.id)}
                        >
                          {o.order_number}
                        </span>
                        <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--gray-700)', fontWeight: 600 }}>{o.customer_name}</span>
                        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--gray-400)' }}>{o.engineer_name || '—'}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>
                          ₹{todayVal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </span>
                        <span className={'pill pill-' + o.status}>{statusLabel(o.status)}</span>
                      </div>
                    </div>

                    {/* Today's items */}
                    <table className="od-items-table" style={{ marginBottom: otherItems.length ? 8 : 0 }}>
                      <thead>
                        <tr>
                          <th style={{ paddingLeft: 12 }}>#</th>
                          <th>Item Code</th>
                          <th style={{ textAlign: 'center' }}>Qty</th>
                          <th>Unit Price</th>
                          <th>Cust. Ref No</th>
                          <th className="right" style={{ paddingRight: 12 }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayItems.map(item => (
                          <tr key={item.id} style={{ background: '#f0fdf4' }}>
                            <td style={{ paddingLeft: 12, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                            <td className="mono" style={{ fontWeight: 700 }}>{item.item_code}</td>
                            <td style={{ textAlign: 'center', fontWeight: 700 }}>{item.qty}</td>
                            <td>₹{item.unit_price_after_disc}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.customer_ref_no || '—'}</td>
                            <td className="right" style={{ paddingRight: 12, fontWeight: 700 }}>₹{(item.total_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {otherItems.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                        + {otherItems.length} other item{otherItems.length !== 1 ? 's' : ''} on different dates
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
