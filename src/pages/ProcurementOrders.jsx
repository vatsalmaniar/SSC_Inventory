import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtShort, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import ProcSubNav from '../components/ProcSubNav'
import '../styles/orderdetail.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const STATUS_LABELS = {
  inv_check: 'Inventory Check', inventory_check: 'Inventory Check', dispatch: 'Ready to Ship',
}
const STATUS_COLORS = {
  inv_check: { bg:'#eff6ff', color:'#1d4ed8' }, inventory_check: { bg:'#eff6ff', color:'#1d4ed8' }, dispatch: { bg:'#f0fdf4', color:'#15803d' },
}

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

    // Fetch CO orders that are approved but don't have a PO yet
    const { data: coData } = await sb.from('orders')
      .select('id,order_number,customer_name,status,created_at,order_items(total_price)')
      .eq('is_test', false)
      .eq('order_type', 'CO')
      .in('status', ['inv_check','inventory_check','dispatch'])
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })

    let coNeedingPo = coData || []
    if (coNeedingPo.length) {
      const coIds = coNeedingPo.map(o => o.id)
      const { data: linkedPos } = await sb.from('purchase_orders').select('order_id').in('order_id', coIds)
      const linkedSet = new Set((linkedPos || []).map(p => p.order_id))
      coNeedingPo = coNeedingPo.filter(o => !linkedSet.has(o.id))
    }

    setOrders(coNeedingPo)
    setLoading(false)
  }

  return (
    <Layout pageTitle="CO Orders" pageKey="procurement">
      <ProcSubNav active="orders" />
      <div className="od-page">
        <div className="od-body">

          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Procurement</div>
                <div className="od-header-title">Custom Orders Needing PO</div>
                <div className="od-header-num">{orders.length} order{orders.length !== 1 ? 's' : ''} pending PO creation</div>
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>Loading...
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
                    <th style={{ textAlign:'right' }}>Value</th>
                    <th>Created</th>
                    <th style={{ textAlign:'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => {
                    const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
                    const sSc = STATUS_COLORS[o.status] || STATUS_COLORS.inv_check
                    return (
                      <tr key={o.id}>
                        <td>
                          <span onClick={() => navigate('/orders/' + o.id)} style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, color:'#1a4dab', cursor:'pointer' }}>{o.order_number}</span>
                        </td>
                        <td style={{ fontWeight:500, color:'var(--gray-800)' }}>{o.customer_name}</td>
                        <td>
                          <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background:sSc.bg, color:sSc.color }}>
                            {STATUS_LABELS[o.status] || o.status}
                          </span>
                        </td>
                        <td style={{ textAlign:'right', fontWeight:600 }}>{fmtCr(val)}</td>
                        <td style={{ fontSize:12, color:'var(--gray-500)' }}>{fmtShort(o.created_at)}</td>
                        <td style={{ textAlign:'center' }}>
                          <button className="od-btn od-btn-approve" onClick={() => navigate('/procurement/po/new?order_id=' + o.id)}
                            style={{ fontSize:11, padding:'4px 12px' }}>
                            Create PO →
                          </button>
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
