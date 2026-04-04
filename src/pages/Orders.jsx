import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orders.css'

function fmtCr(val) {
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()]
}
function statusLabel(s) {
  return {
    pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partly Shipped',
    inv_check:'Inv. Check', inventory_check:'Inv. Check',
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
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()],
      year: d.getFullYear(), month: d.getMonth(), count: 0, value: 0,
    })
  }
  orders.forEach(o => {
    const d = new Date(o.created_at)
    const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
    if (slot) {
      slot.count++
      slot.value += (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
    }
  })
  return months
}

function BubbleChart({ data }) {
  const MAX_DOTS = 8       // rows
  const R        = 5       // dot radius — small like reference
  const GAP      = 4       // gap between dots vertically
  const SLOT     = R * 2 + GAP   // 14px per row
  const COL_GAP  = 18      // gap between columns
  const CHART_H  = MAX_DOTS * SLOT
  const LABEL_H  = 18
  const SVG_H    = CHART_H + LABEL_H
  const maxCount = Math.max(...data.map(d => d.count), 1)

  // column width = dot diameter; total width fills viewBox
  const COL_W = R * 2
  const W     = data.length * (COL_W + COL_GAP) - COL_GAP

  return (
    <svg viewBox={`0 0 ${W} ${SVG_H}`} width="100%" style={{ display:'block' }}>
      {data.map((d, i) => {
        const filled = Math.round((d.count / maxCount) * MAX_DOTS)
        const cx     = i * (COL_W + COL_GAP) + R
        const isCur  = i === data.length - 1

        // tooltip position — top of the filled stack
        const topFilledY = filled > 0 ? (MAX_DOTS - filled) * SLOT + R : CHART_H

        return (
          <g key={i}>
            {/* floating count badge on current month */}
            {isCur && d.count > 0 && (
              <g>
                <rect
                  x={cx - 18} y={topFilledY - SLOT - 16}
                  width={36} height={18} rx={9}
                  fill="white"
                  style={{ filter:'drop-shadow(0 2px 6px rgba(0,0,0,0.14))' }}
                />
                <text x={cx} y={topFilledY - SLOT - 4}
                  textAnchor="middle" fontSize="9" fontWeight="800" fill="#1a4dab">
                  {d.count}
                </text>
              </g>
            )}

            {/* dot grid */}
            {Array.from({ length: MAX_DOTS }).map((_, j) => {
              const cy      = j * SLOT + R
              const slotIdx = MAX_DOTS - 1 - j  // 0 = bottom
              const active  = slotIdx < filled
              return (
                <circle key={j} cx={cx} cy={cy} r={R}
                  fill={active ? (isCur ? '#1a4dab' : '#c2d9f5') : '#e2e8f0'} />
              )
            })}

            {/* month label */}
            <text x={cx} y={SVG_H - 3} textAnchor="middle"
              fontSize="9" fill={isCur ? '#1a4dab' : '#94a3b8'}
              fontWeight={isCur ? '700' : '400'}>
              {d.label}
            </text>
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
    const [{ data: profile }] = await Promise.all([
      sb.from('profiles').select('name,role').eq('id', session.user.id).single(),
      loadOrders(),
    ])
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
  }

  async function loadOrders() {
    setLoading(true)
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,status,order_type,created_at,order_items(qty,dispatched_qty,total_price,unit_price_after_disc,dispatch_date)')
      .gte('created_at', '2026-03-31').eq('is_test', false)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)

  const totalValue      = orders.reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0)
  const dispatchedValue = orders
    .filter(o => o.status === 'dispatched_fc' || (o.order_items || []).some(i => (i.dispatched_qty || 0) > 0))
    .reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.unit_price_after_disc || 0) * (i.dispatched_qty || 0), 0), 0)
  const pendingApproval = orders.filter(o => o.status === 'pending').length
  const activeOrders    = orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length
  const todayDispatched = orders.filter(o => (o.order_items || []).some(i => i.dispatch_date === today))

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
  const prevMonth  = monthlyData[monthlyData.length - 2]?.count || 0
  const thisMonth  = monthlyData[monthlyData.length - 1]?.count || 0
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
              {user.role !== 'ops' && (
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
            <div className="dash-loading"><div className="loading-spin"/>Loading...</div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Tile 1 — Total Order Value with sparkline */}
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
                  <svg viewBox="0 0 300 56" preserveAspectRatio="none" style={{ height: 56 }}>
                    {/* fill under line */}
                    <defs>
                      <linearGradient id="spfill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.25)"/>
                        <stop offset="100%" stopColor="rgba(255,255,255,0)"/>
                      </linearGradient>
                    </defs>
                    {spark.pts && <path d={spark.path + ` L 300 56 L 0 56 Z`} fill="url(#spfill)" />}
                    {spark.path && <path d={spark.path} fill="none" stroke="rgba(255,255,255,0.70)" strokeWidth="2" strokeLinecap="round"/>}
                    {/* highlight dot on last point */}
                    {spark.pts && <circle cx={spark.pts[spark.pts.length-1][0]} cy={spark.pts[spark.pts.length-1][1]} r="4" fill="white"/>}
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
                  <svg viewBox="0 0 300 40" preserveAspectRatio="none" style={{ height: 40 }}>
                    {[0,1,2,3,4,5].map(i => {
                      const h = [20,28,18,34,24,36][i]
                      return <rect key={i} x={i*50+8} y={40-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.20)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 3 — Pending Approval */}
              <div className="dash-tile" style={{ background: '#b45309' }} onClick={() => navigate('/orders/list', { state: { filter: 'approval' } })}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Pending Approval</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{pendingApproval}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">orders need review</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 40" preserveAspectRatio="none" style={{ height: 40 }}>
                    <circle cx="150" cy="20" r="60" fill="rgba(255,255,255,0.06)"/>
                    <circle cx="150" cy="20" r="40" fill="rgba(255,255,255,0.06)"/>
                    <circle cx="150" cy="20" r="20" fill="rgba(255,255,255,0.10)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 4 — Today's Dispatch */}
              <div className="dash-tile" style={{ background: '#6d28d9' }} onClick={() => navigate('/dispatch/today')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Today's Dispatch</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{todayDispatched.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">scheduled for today</span>
                  {todayDispatched.length > 0 && <span className="dash-tile-badge">View plan</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 40" preserveAspectRatio="none" style={{ height: 40 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [14,24,18,30,22,28,16,32][i]
                      return <rect key={i} x={i*38+4} y={40-h} width={28} height={h} rx={4} fill="rgba(255,255,255,0.18)"/>
                    })}
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Bar chart */}
              <div className="dash-card dash-card-chart">
                <div className="dash-card-head">
                  <div>
                    <div className="dash-card-title">Order Summary</div>
                    <div className="dash-card-sub">Last 6 months · by order count</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:28, fontWeight:800, color:'#0e2d6a', letterSpacing:'-1px', lineHeight:1 }}>{orders.length}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>total orders</div>
                  </div>
                </div>
                <div style={{ padding:'12px 16px 16px' }}>
                  <BubbleChart data={monthlyData} />
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

            {/* Bottom row */}
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

              {/* Recent orders */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Recent Orders</div>
                  <button onClick={() => navigate('/orders/list')} className="dash-icon-btn">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                  </button>
                </div>
                {orders.slice(0, 6).map(o => {
                  const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
                  const dot = o.status === 'dispatched_fc' ? '#059669' : o.status === 'cancelled' ? '#e11d48' : o.status === 'pending' ? '#d97706' : '#1a4dab'
                  return (
                    <div key={o.id} className="dash-list-row" onClick={() => navigate('/orders/' + o.id)}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, minWidth:0 }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', background:dot, flexShrink:0 }} />
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#1a4dab' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>₹{val.toLocaleString('en-IN', { maximumFractionDigits:0 })}</div>
                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{fmt(o.created_at)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>

            </div>

          </>)}
        </div>
      </div>
    </Layout>
  )
}
