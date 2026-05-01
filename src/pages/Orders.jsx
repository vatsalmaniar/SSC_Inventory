import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { MO, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

function fmtCr(val) {
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function statusLabel(s) {
  return {
    pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partly Shipped',
    inv_check:'Order Approved', inventory_check:'Inventory Check',
    delivery_created:'At FC', picking:'Picking', packing:'Packing',
    goods_issued:'Goods Issued', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
    invoice_generated:'Invoiced', delivery_ready:'Delivery Ready',
    eway_generated:'E-Way Done', dispatched_fc:'Delivered', cancelled:'Cancelled',
  }[s] || s
}

// Build a sparkline path from an array of values, edge-to-edge
function sparklinePath(values, w = 300, h = 56) {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * (h - 8) - 4
    return [x, y]
  })
  // smooth curve
  let d = `M ${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    const cx = (x0 + x1) / 2
    d += ` C ${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`
  }
  return { path: d, pts }
}

function buildMonthlyData(orders) {
  const now = new Date()
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 3 + i, 1)
    months.push({
      label: MO[d.getMonth()],
      year: d.getFullYear(), month: d.getMonth(), count: 0, value: 0,
      ordered: 0, dispatched: 0,
    })
  }
  const curIdx = months.findIndex(m => m.year === now.getFullYear() && m.month === now.getMonth())
  orders.forEach(o => {
    const d = new Date(o.created_at)
    const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
    if (slot) {
      slot.count++
      slot.value += (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
      slot.ordered++
      if (o.status === 'dispatched_fc') slot.dispatched++
    }
  })
  months.forEach((m, i) => { m.isCurrent = i === curIdx; m.isFuture = curIdx >= 0 && i > curIdx })
  return months
}

function OrderVsDispatchChart({ data }) {
  const PL = 52, PR = 22, PT = 30, PB = 38
  const W = 760, H = 280
  const innerW = W - PL - PR
  const innerH = H - PT - PB
  const active = data.filter(d => !d.isFuture)
  const maxVal = Math.max(...active.map(d => Math.max(d.ordered, d.dispatched)), 1)
  const niceMax = maxVal <= 10 ? Math.ceil(maxVal) : maxVal <= 50 ? Math.ceil(maxVal / 5) * 5 : Math.ceil(maxVal / 10) * 10
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0

  const xy = (i, v) => [PL + i * stepX, PT + innerH - (v / niceMax) * innerH]
  const orderedPts = active.map(d => xy(data.indexOf(d), d.ordered))
  const dispatchedPts = active.map(d => xy(data.indexOf(d), d.dispatched))
  const toPath = pts => pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: Math.round(niceMax * t), y: PT + innerH - t * innerH }))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:'block' }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PL} y1={t.y} x2={W - PR} y2={t.y} stroke="#f1f5f9" strokeWidth="1"/>
          <text x={PL - 10} y={t.y + 4} fontSize="12" textAnchor="end" fill="#94a3b8" fontFamily="Geist, sans-serif">{t.v}</text>
        </g>
      ))}
      <path d={toPath(orderedPts)} fill="none" stroke="#1a4dab" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d={toPath(dispatchedPts)} fill="none" stroke="#059669" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 4"/>
      {data.map((d, i) => {
        const [ox, oy] = xy(i, d.ordered)
        const [dx, dy] = xy(i, d.dispatched)
        const isCur = d.isCurrent
        const showOrdered = !d.isFuture && d.ordered > 0
        const showDispatched = !d.isFuture && d.dispatched > 0
        const gapPct = d.ordered > 0 ? Math.round(((d.ordered - d.dispatched) / d.ordered) * 100) : null
        const showGap = !d.isFuture && d.ordered > 0
        return (
          <g key={i}>
            {showOrdered && <circle cx={ox} cy={oy} r={isCur ? 5.5 : 4.5} fill="#1a4dab"/>}
            {showDispatched && <circle cx={dx} cy={dy} r={isCur ? 5.5 : 4.5} fill="#059669"/>}
            <text x={PL + i * stepX} y={H - 16} textAnchor="middle" fontSize="13"
              fill={d.isFuture ? '#cbd5e1' : isCur ? '#0e2d6a' : '#64748b'}
              fontWeight={isCur ? 700 : 500}
              fontFamily="Geist, sans-serif">{d.label}</text>
            {showGap && (
              <text x={PL + i * stepX} y={H - 2} textAnchor="middle" fontSize="11"
                fill={gapPct >= 70 ? '#dc2626' : gapPct >= 40 ? '#d97706' : '#059669'}
                fontWeight="700"
                fontFamily="Geist, sans-serif">{gapPct === 0 ? '✓' : '−' + gapPct + '%'}</text>
            )}
            {showOrdered && (
              <text x={ox} y={oy - 10} textAnchor="middle" fontSize="13" fontWeight="700" fill="#1a4dab" fontFamily="Geist, sans-serif">{d.ordered}</text>
            )}
            {showDispatched && (
              <text x={dx} y={dy + 18} textAnchor="middle" fontSize="13" fontWeight="700" fill="#059669" fontFamily="Geist, sans-serif">{d.dispatched}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export default function Orders() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (location.state?.success) {
      setSuccessMsg('Order ' + location.state.success + ' submitted successfully!')
      setTimeout(() => setSuccessMsg(''), 5000)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
    await loadOrders(role === 'demo', role === 'sales' ? session.user.id : null)
  }

  async function loadOrders(testMode = false, salesUserId = null) {
    setLoading(true)
    let query = sb.from('orders')
      .select('id,order_number,customer_name,status,order_type,created_at,order_items(qty,dispatched_qty,total_price,unit_price_after_disc,dispatch_date),order_dispatches(id,created_at,dispatched_items,status,delivered_at)')
      .gte('created_at', FY_START).eq('is_test', testMode)
      .order('created_at', { ascending: false })
    if (salesUserId) query = query.eq('created_by', salesUserId)
    const { data } = await query
    setOrders(data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)

  const totalValue      = orders.reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0)
  const dispatchedValue = orders.reduce((s, o) => {
    const deliveredBatches = (o.order_dispatches || []).filter(b => b.status === 'dispatched_fc')
    const batchTotal = deliveredBatches.reduce((bs, b) =>
      bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
    if (batchTotal > 0) return s + batchTotal
    // fallback for old orders without dispatched_items
    if (o.status === 'dispatched_fc') return s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0)
    return s
  }, 0)
  const pendingApproval = orders.filter(o => o.status === 'pending').length
  const activeOrders    = orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length
  // Use order_dispatches.created_at to find today's batches — sum dispatched_items.total_price for accurate invoice value
  const todayDispatched = orders.filter(o => (o.order_dispatches || []).some(b => b.created_at?.slice(0,10) === today))

  const todayDispatchValue = todayDispatched.reduce((s, o) => {
    const todayBatches = (o.order_dispatches || []).filter(b => b.created_at?.slice(0,10) === today)
    return s + todayBatches.reduce((bs, b) =>
      bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)

  // Tile 3: orders with a batch confirmed delivered today (delivered_at = today)
  const todayDelivered = orders.filter(o =>
    (o.order_dispatches || []).some(b => b.delivered_at?.slice(0,10) === today)
  )
  const todayDeliveredValue = todayDelivered.reduce((s, o) => {
    const todayBatches = (o.order_dispatches || []).filter(b => b.delivered_at?.slice(0,10) === today)
    return s + todayBatches.reduce((bs, b) =>
      bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)

  const sampleOrders = orders.filter(o => o.order_type === 'SAMPLE')
  const sampleValue  = sampleOrders.reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0)

  const topCustomers = Object.values(
    orders.reduce((m, o) => {
      const val = (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0)
      if (!m[o.customer_name]) m[o.customer_name] = { name: o.customer_name, value: 0, count: 0 }
      m[o.customer_name].value += val
      m[o.customer_name].count++
      return m
    }, {})
  ).sort((a, b) => b.value - a.value).slice(0, 6)

  const inOps     = orders.filter(o => ['pending','inv_check','inventory_check','dispatch'].includes(o.status)).length
  const inFC      = orders.filter(o => ['delivery_created','picking','packing'].includes(o.status)).length
  const inBilling = orders.filter(o => ['goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated'].includes(o.status)).length
  const delivered = orders.filter(o => o.status === 'dispatched_fc').length
  const cancelled = orders.filter(o => o.status === 'cancelled').length

  const monthlyData = buildMonthlyData(orders)

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  // Sparkline values: monthly order count last 6 months
  const sparkValues = monthlyData.map(m => m.value)
  const spark = sparklinePath(sparkValues, 300, 56)

  // month-over-month change for badge
  const curIdx     = monthlyData.findIndex(m => m.isCurrent)
  const prevMonth  = curIdx > 0 ? monthlyData[curIdx - 1].count : 0
  const thisMonth  = curIdx >= 0 ? monthlyData[curIdx].count : 0
  const momPct     = prevMonth ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : null

  const PIPELINE = [
    { label: 'Ops Review',       count: inOps,     color: '#1a4dab' },
    { label: 'Fulfilment Centre',count: inFC,      color: '#7c3aed' },
    { label: 'Billing / Accts',  count: inBilling, color: '#d97706' },
    { label: 'Delivered',        count: delivered,  color: '#059669' },
    { label: 'Cancelled',        count: cancelled,  color: '#e11d48' },
  ]
  const pipelineMax = Math.max(...PIPELINE.map(p => p.count), 1)

  return (
    <Layout pageTitle="Orders" pageKey="orders">
      <div className="dash-page">
        <div className="dash-body">

          {/* Header */}
          <div className="dash-header-row">
            <div>
              <div className="dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="dash-date">{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
            </div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              {user.role !== 'ops' && user.role !== 'demo' && (
                <button className="new-order-btn" onClick={() => navigate('/orders/new')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Order
                </button>
              )}
              <button className="od-dash-viewall-btn" onClick={() => navigate('/orders/list')}>
                All Orders
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>

          {successMsg && <div className="orders-success-banner" style={{ marginBottom:16 }}>✓ {successMsg}</div>}

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/></div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Tile 1 — Total Order Value */}
              <div className="dash-tile" style={{ background: '#0e2d6a' }} onClick={() => navigate('/orders/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Total Order Value</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{fmtCr(totalValue)}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">{orders.length} orders</span>
                  {momPct !== null && <span className="dash-tile-badge">{momPct >= 0 ? '+' : ''}{momPct}%</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 48" preserveAspectRatio="none" style={{ height: 48 }}>
                    <defs>
                      <linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.25)"/>
                        <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                      </linearGradient>
                    </defs>
                    {spark.pts && <path d={spark.path + ` L 300 56 L 0 56 Z`} fill="url(#spfill)" />}
                    {spark.path && <path d={spark.path} fill="none" stroke="rgba(255,255,255,0.70)" strokeWidth="2" strokeLinecap="round"/>}
                    {spark.pts && <circle cx={spark.pts[spark.pts.length-1][0]} cy={spark.pts[spark.pts.length-1][1]} r="3.5" fill="white"/>}
                  </svg>
                </div>
              </div>

              {/* Tile 2 — Dispatched Value */}
              <div className="dash-tile" style={{ background: '#059669' }} onClick={() => navigate('/orders/list', { state: { filter: 'dispatched' } })}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Dispatched Value</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{fmtCr(dispatchedValue)}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">lifetime delivered</span>
                  <span className="dash-tile-badge">{delivered} orders</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height: 36 }}>
                    {[0,1,2,3,4,5].map(i => {
                      const h = [20,28,18,34,24,36][i]
                      return <rect key={i} x={i*50+8} y={36-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.20)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 3 — Today's Delivered Value */}
              <div className="dash-tile" style={{ background: '#0891b2' }} onClick={() => navigate('/orders/list', { state: { filter: 'dispatched', timeline: 'today', dateMode: 'delivered_at' } })}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Today's Delivered</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{fmtCr(todayDeliveredValue)}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">{todayDelivered.length} order{todayDelivered.length !== 1 ? 's' : ''} today</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height: 36 }}>
                    <circle cx="60"  cy="18" r="48" fill="rgba(255,255,255,0.07)"/>
                    <circle cx="240" cy="18" r="60" fill="rgba(255,255,255,0.07)"/>
                    <circle cx="150" cy="36" r="36" fill="rgba(255,255,255,0.07)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 4 — Pending Approval (white) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/ops')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Pending Approval</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: pendingApproval > 0 ? '#b45309' : undefined }}>{pendingApproval}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">orders need review</span>
                  {pendingApproval > 0 && <span className="dash-tile-badge" style={{ background:'#fef3c7', color:'#92400e' }}>Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height: 36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(180,83,9,0.05)"/>
                    <circle cx="150" cy="18" r="36" fill="rgba(180,83,9,0.05)"/>
                    <circle cx="150" cy="18" r="18" fill="rgba(180,83,9,0.07)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 5 — Today's Dispatch Value (white) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/dispatch/today')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Today's Dispatch</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{fmtCr(todayDispatchValue)}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">{todayDispatched.length} order{todayDispatched.length !== 1 ? 's' : ''} today</span>
                  {todayDispatched.length > 0 && <span className="dash-tile-badge" style={{ background:'#e8f2fc', color:'#1a4dab' }}>View plan</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height: 36 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [12,20,15,26,18,24,13,28][i]
                      return <rect key={i} x={i*38+4} y={36-h} width={28} height={h} rx={4} fill="rgba(26,77,171,0.08)"/>
                    })}
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Order vs Dispatch chart */}
              <div className="dash-card dash-card-chart">
                <div className="dash-card-head">
                  <div>
                    <div className="dash-card-title">Order Summary</div>
                    <div className="dash-card-sub">Orders placed vs Delivered · this FY</div>
                  </div>
                  <div style={{ display:'flex', gap:14, alignItems:'center' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#475569' }}>
                      <span style={{ width:14, height:2, background:'#1a4dab', borderRadius:1 }}/>Placed
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#475569' }}>
                      <span style={{ width:14, height:2, background:'#059669', borderRadius:1, borderTop:'1px dashed #059669' }}/>Delivered
                    </div>
                  </div>
                </div>
                <div style={{ padding:'12px 16px 16px' }}>
                  <OrderVsDispatchChart data={monthlyData} />
                </div>
              </div>

              {/* Pipeline */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Order Pipeline</div>
                  <span className="dash-badge">{activeOrders} active</span>
                </div>
                <div style={{ padding:'4px 0 0' }}>
                  {PIPELINE.map((p, i) => {
                    const pct = pipelineMax > 0 ? Math.round((p.count / pipelineMax) * 100) : 0
                    const minW = p.count > 0 ? Math.max(pct, 6) : 0
                    return (
                      <div key={i} style={{ padding:'10px 18px', borderBottom: i < PIPELINE.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                          <span style={{ fontSize:12, color: p.count > 0 ? '#334155' : '#94a3b8', fontWeight: p.count > 0 ? 600 : 400 }}>{p.label}</span>
                          <span style={{ fontSize:14, fontWeight:800, color: p.count > 0 ? '#0f172a' : '#cbd5e1', minWidth:24, textAlign:'right' }}>{p.count}</span>
                        </div>
                        <div style={{ height:6, background:'#f1f5f9', borderRadius:6 }}>
                          {p.count > 0 && (
                            <div style={{ height:'100%', width: minW + '%', background: p.color, borderRadius:6, transition:'width 0.6s ease', minWidth:8 }} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>

            {/* Bottom row — 3 cards */}
            <div className="dash-bottom">

              {/* Today's dispatch */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Today's Dispatch</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="dash-badge" style={{ background: todayDispatched.length > 0 ? '#e8f2fc' : '#f1f5f9', color: todayDispatched.length > 0 ? '#1a4dab' : '#94a3b8' }}>{todayDispatched.length} orders</span>
                    <button onClick={() => navigate('/dispatch/today')} className="dash-icon-btn">
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </button>
                  </div>
                </div>
                {todayDispatched.length === 0
                  ? <div className="dash-empty">No dispatches scheduled today</div>
                  : todayDispatched.slice(0, 6).map(o => {
                      const val = (o.order_items || []).filter(i => i.dispatch_date === today).reduce((s, i) => s + (i.total_price || 0), 0)
                      return (
                        <div key={o.id} className="dash-list-row" onClick={() => navigate('/orders/' + o.id)}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#1a4dab' }}>{o.order_number}</div>
                            <div className="dash-row-cust">{o.customer_name}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>₹{val.toLocaleString('en-IN', { maximumFractionDigits:0 })}</div>
                            <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                          </div>
                        </div>
                      )
                    })
                }
              </div>

              {/* Top Customers */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Top Customers</div>
                  <span className="dash-badge">by value</span>
                </div>
                {topCustomers.length === 0
                  ? <div className="dash-empty">No data yet</div>
                  : topCustomers.map((c, i) => {
                      const maxVal = topCustomers[0].value || 1
                      const pct    = Math.round((c.value / maxVal) * 100)
                      return (
                        <div key={c.name} style={{ padding:'9px 18px', borderBottom: i < topCustomers.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                            <div style={{ minWidth:0 }}>
                              <div style={{ fontSize:12, fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:140 }}>{c.name}</div>
                              <div style={{ fontSize:11, color:'#94a3b8' }}>{c.count} order{c.count !== 1 ? 's' : ''}</div>
                            </div>
                            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', flexShrink:0, marginLeft:8 }}>
                              {fmtCr(c.value)}
                            </div>
                          </div>
                          <div style={{ height:4, background:'#f1f5f9', borderRadius:4 }}>
                            <div style={{ height:'100%', width: pct + '%', background:'#1a4dab', borderRadius:4, transition:'width 0.6s ease' }} />
                          </div>
                        </div>
                      )
                    })
                }
              </div>

              {/* Sample Issues */}
              <div className="dash-card" style={{ cursor:'pointer' }} onClick={() => navigate('/orders/list', { state: { filter: 'sample' } })}>
                <div className="dash-card-head">
                  <div className="dash-card-title">Sample Issues</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="dash-badge" style={{ background:'#f5f3ff', color:'#7e22ce' }}>{sampleOrders.length} total</span>
                    <button className="dash-icon-btn" onClick={e => { e.stopPropagation(); navigate('/orders/list', { state: { filter: 'sample' } }) }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </button>
                  </div>
                </div>
                {/* Summary strip */}
                <div style={{ display:'flex', gap:0, borderBottom:'1px solid #f1f5f9', padding:'12px 18px 14px' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:24, fontWeight:300, letterSpacing:'-1px', color:'#0d1f4c', lineHeight:1 }}>{sampleOrders.length}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>total samples</div>
                  </div>
                  <div style={{ flex:1, borderLeft:'1px solid #f1f5f9', paddingLeft:16 }}>
                    <div style={{ fontSize:24, fontWeight:300, letterSpacing:'-1px', color:'#0d1f4c', lineHeight:1 }}>{fmtCr(sampleValue)}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>total value</div>
                  </div>
                </div>
                {sampleOrders.length === 0
                  ? <div className="dash-empty">No sample orders yet</div>
                  : sampleOrders.slice(0, 5).map(o => {
                      const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
                      return (
                        <div key={o.id} className="dash-list-row" onClick={() => navigate('/orders/' + o.id)}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#7e22ce' }}>{o.order_number}</div>
                            <div className="dash-row-cust">{o.customer_name}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>₹{val.toLocaleString('en-IN', { maximumFractionDigits:0 })}</div>
                            <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                          </div>
                        </div>
                      )
                    })
                }
              </div>

            </div>

          </>)}
        </div>
      </div>
    </Layout>
  )
}
