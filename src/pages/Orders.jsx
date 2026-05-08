import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { MO, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const STATUS_LABELS = {
  pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partly Shipped',
  inv_check:'Order Approved', inventory_check:'Inventory Check',
  delivery_created:'At FC', picking:'Picking', packing:'Packing',
  goods_issued:'Goods Issued', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
  invoice_generated:'Invoiced', delivery_ready:'Delivery Ready',
  eway_generated:'E-Way Done', dispatched_fc:'Delivered', cancelled:'Cancelled',
}

function statusGroup(s) {
  if (['pending'].includes(s)) return 'pending'
  if (['inv_check','inventory_check','dispatch','partial_dispatch'].includes(s)) return 'approved'
  if (['delivery_created','picking','packing'].includes(s)) return 'fc'
  if (['goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated'].includes(s)) return 'billing'
  if (s === 'dispatched_fc') return 'delivered'
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const REP_PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function repColor(id) {
  if (!id) return '#94A3B8'
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff
  return REP_PALETTE[Math.abs(h) % REP_PALETTE.length]
}

function buildMonthlyData(orders) {
  const now = new Date()
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 3 + i, 1)
    months.push({
      label: MO[d.getMonth()],
      year: d.getFullYear(), month: d.getMonth(),
      ordered: 0, delivered: 0, orderedValue: 0, deliveredValue: 0,
    })
  }
  const curIdx = months.findIndex(m => m.year === now.getFullYear() && m.month === now.getMonth())
  orders.forEach(o => {
    const d = new Date(o.created_at)
    const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
    if (!slot) return
    slot.ordered++
    slot.orderedValue += (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
    if (o.status === 'dispatched_fc') {
      slot.delivered++
      slot.deliveredValue += (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
    }
  })
  months.forEach((m, i) => { m.isCurrent = i === curIdx; m.isFuture = curIdx >= 0 && i > curIdx })
  return months
}

export default function Orders() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState({ name: '', role: '', id: '' })
  const [orders, setOrders] = useState([])
  const [reps, setReps] = useState([])
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
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    await loadData(profile?.role || 'sales', session.user.id)
  }

  async function loadData(role, uid) {
    setLoading(true)
    let q = sb.from('orders')
      .select('id,order_number,customer_name,status,order_type,created_at,created_by,order_items(qty,dispatched_qty,total_price,unit_price_after_disc,dispatch_date),order_dispatches(id,created_at,dispatched_items,status,delivered_at)')
      .gte('created_at', FY_START).eq('is_test', role === 'demo')
      .order('created_at', { ascending: false })
    if (role === 'sales') q = q.eq('created_by', uid)
    const [ordersRes, repsRes] = await Promise.all([
      q,
      sb.from('profiles').select('id,name,role').in('role',['sales','admin']),
    ])
    setOrders(ordersRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const totalValue = orders.reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0)
  const dispatchedValue = orders.reduce((s, o) => {
    const delivered = (o.order_dispatches || []).filter(b => b.status === 'dispatched_fc')
    const v = delivered.reduce((bs, b) => bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
    if (v > 0) return s + v
    if (o.status === 'dispatched_fc') return s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0)
    return s
  }, 0)
  const pendingApproval = orders.filter(o => o.status === 'pending').length
  const activeOrders = orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length
  const todayDispatched = orders.filter(o => (o.order_dispatches || []).some(b => b.created_at?.slice(0,10) === today))
  const todayDispatchValue = todayDispatched.reduce((s, o) => {
    const td = (o.order_dispatches || []).filter(b => b.created_at?.slice(0,10) === today)
    return s + td.reduce((bs, b) => bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)
  const todayDelivered = orders.filter(o => (o.order_dispatches || []).some(b => b.delivered_at?.slice(0,10) === today))
  const todayDeliveredValue = todayDelivered.reduce((s, o) => {
    const td = (o.order_dispatches || []).filter(b => b.delivered_at?.slice(0,10) === today)
    return s + td.reduce((bs, b) => bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)
  const sampleOrders = orders.filter(o => o.order_type === 'SAMPLE')

  // Status pipeline counts + values
  const statusGroups = ['pending','approved','fc','billing','delivered','cancelled'].map(g => {
    const list = orders.filter(o => statusGroup(o.status) === g)
    return {
      id: g,
      label: { pending:'Pending Approval', approved:'Approved · Ops', fc:'At Fulfilment Centre', billing:'Billing / Accounts', delivered:'Delivered', cancelled:'Cancelled' }[g],
      count: list.length,
      value: list.reduce((s,o) => s + (o.order_items || []).reduce((a,i) => a + (i.total_price || 0), 0), 0),
      color: { pending:'#F59E0B', approved:'#1E54B7', fc:'#0F766E', billing:'#D97706', delivered:'#10B981', cancelled:'#EF4444' }[g],
    }
  }).filter(s => s.count > 0)
  const totalActiveCount = statusGroups.filter(s => s.id !== 'delivered' && s.id !== 'cancelled').reduce((a,b) => a+b.count, 0)

  // Sales reps leaderboard (orders placed by created_by)
  const repAgg = reps.map(r => {
    const own = orders.filter(o => o.created_by === r.id)
    return {
      id: r.id, name: r.name,
      count: own.length,
      value: own.reduce((s,o) => s + (o.order_items || []).reduce((a,i) => a + (i.total_price || 0), 0), 0),
      color: repColor(r.id),
    }
  }).filter(r => r.count > 0).sort((a,b) => b.value - a.value)
  const repMax = Math.max(...repAgg.map(r => r.value), 1)

  // Top customers
  const customerAgg = Object.values(orders.reduce((m, o) => {
    const val = (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0)
    if (!m[o.customer_name]) m[o.customer_name] = { name: o.customer_name, value: 0, count: 0, last: o.created_at, delivered: 0 }
    m[o.customer_name].value += val
    m[o.customer_name].count++
    if (o.status === 'dispatched_fc') m[o.customer_name].delivered++
    if (o.created_at > m[o.customer_name].last) m[o.customer_name].last = o.created_at
    return m
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6)
  const custMax = customerAgg[0]?.value || 1

  const monthlyData = buildMonthlyData(orders)
  const fyOrdered = monthlyData.reduce((s,m) => s + m.ordered, 0)
  const fyDelivered = monthlyData.reduce((s,m) => s + m.delivered, 0)
  const fillRate = fyOrdered > 0 ? Math.round((fyDelivered / fyOrdered) * 100) : 0

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <Layout pageTitle="Orders" pageKey="orders">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">{new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} · {orders.length} orders FYTD · {fmtCr(totalValue)} value</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/orders/list')}>All Orders</button>
            {user.role !== 'ops' && user.role !== 'demo' && (
              <button className="btn-primary" onClick={() => navigate('/orders/new')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Order
              </button>
            )}
          </div>
        </div>

        {successMsg && (
          <div style={{ background:'#dcfce7', color:'#166534', padding:'10px 16px', borderRadius:9, fontSize:13, fontWeight:500, marginBottom:12 }}>✓ {successMsg}</div>
        )}

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            <div className="kpi-row">
              <KpiTile variant="hero" tone="deep" label="Total Order Value" value={fmtCr(totalValue)} sub={`${orders.length} orders FYTD`} chart="line" onClick={() => navigate('/orders/list')}/>
              <KpiTile variant="hero" tone="forest" label="Dispatched · Lifetime" value={fmtCr(dispatchedValue)} sub={`${fillRate}% fill rate`} chart="bars" onClick={() => navigate('/orders/list', { state: { filter: 'dispatched' } })}/>
              <KpiTile variant="hero" tone="teal" label="Today's Delivered" value={fmtCr(todayDeliveredValue)} sub={`${todayDelivered.length} order${todayDelivered.length === 1 ? '' : 's'}`} chart="bars" onClick={() => navigate('/orders/list', { state: { filter: 'dispatched', timeline: 'today', dateMode: 'delivered_at' } })}/>
              <KpiTile label="Pending Approval" value={pendingApproval} sub="orders need review" accent={pendingApproval > 0 ? 'amber' : null} badge={pendingApproval > 0 ? 'Action needed' : null} onClick={() => navigate('/ops')}/>
              <KpiTile label="Today's Dispatch" value={fmtCr(todayDispatchValue)} sub={`${todayDispatched.length} order${todayDispatched.length === 1 ? '' : 's'}`} onClick={() => navigate('/dispatch/today')}/>
            </div>

            <div className="o-mid">
              <div className="rep-panel">
                <div className="rp-head">
                  <div className="rp-title">Sales Reps</div>
                  <div className="rp-sub">FYTD · By order value</div>
                </div>
                <div className="rp-list">
                  {repAgg.length === 0 ? (
                    <div className="o-empty">No rep activity yet</div>
                  ) : repAgg.map((r, i) => (
                    <div key={r.id} className="rp-row" onClick={() => navigate('/orders/list')}>
                      <div className="rp-rank">{i+1}</div>
                      <div className="rp-avatar" style={{ background: r.color }}>{initials(r.name)}</div>
                      <div className="rp-info">
                        <div className="rp-name">{r.name}{r.id === user.id && <span style={{ fontSize: 9, color: 'var(--ssc-blue)', marginLeft: 4, fontWeight: 700 }}>YOU</span>}</div>
                        <div className="rp-bar"><div className="rp-fill" style={{ width: `${(r.value/repMax)*100}%`, background: r.color }}/></div>
                      </div>
                      <div className="rp-val">{fmtCr(r.value)}</div>
                    </div>
                  ))}
                </div>
                <div className="rp-foot">
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">ACTIVE REPS</div>
                    <div className="rp-foot-val">{repAgg.length}</div>
                  </div>
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">TOTAL VALUE</div>
                    <div className="rp-foot-val">{fmtCr(repAgg.reduce((s,r)=>s+r.value,0))}</div>
                  </div>
                </div>
              </div>

              <div className="o-anal">
                <div className="card anal-card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Performance · This FY</div>
                      <div className="card-title">Dispatch Efficiency</div>
                    </div>
                    <span className="trend-pill mono">{fyOrdered} placed</span>
                  </div>
                  <DispatchGauge ordered={fyOrdered} delivered={fyDelivered}/>
                </div>

                <div className="card anal-card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Pipeline · By Status</div>
                      <div className="card-title">Order Pipeline</div>
                    </div>
                    <span className="trend-pill mono">{totalActiveCount} active</span>
                  </div>
                  <div className="funnel">
                    {statusGroups.length === 0 ? <div className="o-empty">No orders yet</div> : statusGroups.map(s => {
                      const max = Math.max(...statusGroups.map(x => x.count))
                      return (
                        <div key={s.id} className="funnel-row">
                          <div className="funnel-label">
                            <span className="funnel-dot" style={{ background: s.color }}/>
                            <span className="funnel-name">{s.label}</span>
                          </div>
                          <div className="funnel-bar-wrap">
                            <div className="funnel-bar" style={{ width: `${(s.count/max)*100}%`, background: s.color }}/>
                          </div>
                          <div className="funnel-val">{s.count}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="card anal-card full">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Distribution · By Value</div>
                      <div className="card-title">Order Mix</div>
                    </div>
                    <span className="trend-pill mono">{fmtCr(totalValue)}</span>
                  </div>
                  <StatusDonut groups={statusGroups} total={statusGroups.reduce((s,g) => s + g.value, 0)}/>
                </div>
              </div>
            </div>

            <div className="card o-chart-card">
              <OrderVsDispatchChart data={monthlyData}/>
            </div>

            <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
              <div className="card-head" style={{ padding: '18px 20px 0', marginBottom: 12 }}>
                <div>
                  <div className="card-eyebrow">FYTD · By order value</div>
                  <div className="card-title">Top Customers</div>
                </div>
                <span className="trend-pill mono">{customerAgg.length} customers</span>
              </div>
              <div className="cust-table" style={{ border: 0, borderRadius: 0 }}>
                <div className="cust-row cust-head">
                  <div></div>
                  <div>Customer</div>
                  <div className="num">Orders</div>
                  <div className="num">Delivered</div>
                  <div>Share</div>
                  <div className="num">Value</div>
                </div>
                {customerAgg.length === 0 ? (
                  <div className="o-empty">No data yet</div>
                ) : customerAgg.map((c, i) => (
                  <div key={c.name} className="cust-row cust-data" onClick={() => navigate('/orders/list')}>
                    <div className="cust-rank">#{i+1}</div>
                    <div className="cust-name">{c.name}</div>
                    <div className="cust-num">{c.count}</div>
                    <div className="cust-num" style={{ color: 'var(--o-good)' }}>{c.delivered}</div>
                    <div className="cust-bar-wrap"><div className="cust-bar" style={{ width: `${(c.value/custMax)*100}%` }}/></div>
                    <div className="cust-num bold">{fmtCr(c.value)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="o-bottom">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Today · Active</div>
                    <div className="card-title">Today's Dispatch</div>
                  </div>
                  <button className="btn-ghost" onClick={() => navigate('/dispatch/today')} style={{ padding: '5px 10px', fontSize: 12 }}>View plan</button>
                </div>
                <div className="o-list">
                  {todayDispatched.length === 0 ? (
                    <div className="o-empty">No dispatches scheduled today</div>
                  ) : todayDispatched.slice(0, 6).map(o => {
                    const val = (o.order_items || []).filter(i => i.dispatch_date === today).reduce((s, i) => s + (i.total_price || 0), 0)
                    return (
                      <div key={o.id} className="o-list-row" onClick={() => navigate('/orders/' + o.id)}>
                        <div style={{ minWidth: 0 }}>
                          <div className="o-list-num">{o.order_number}</div>
                          <div className="o-list-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="o-list-val">{fmtCr(val)}</div>
                          <span className={`o-list-status o-status-${statusGroup(o.status)}`}>{STATUS_LABELS[o.status]}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/orders/list', { state: { filter: 'sample' } })}>
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">FYTD · Sample issues</div>
                    <div className="card-title">Sample Orders</div>
                  </div>
                  <span className="trend-pill mono">{sampleOrders.length} total</span>
                </div>
                <div style={{ display: 'flex', gap: 0, padding: '0 0 12px', borderBottom: '1px solid var(--o-line-2)', marginBottom: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--o-ink)', lineHeight: 1, fontFamily: 'Geist Mono, monospace' }}>{sampleOrders.length}</div>
                    <div style={{ fontSize: 11, color: 'var(--o-muted)', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>SAMPLES</div>
                  </div>
                  <div style={{ flex: 1, borderLeft: '1px solid var(--o-line-2)', paddingLeft: 16 }}>
                    <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--o-ink)', lineHeight: 1, fontFamily: 'Geist Mono, monospace' }}>{fmtCr(sampleOrders.reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0))}</div>
                    <div style={{ fontSize: 11, color: 'var(--o-muted)', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>VALUE</div>
                  </div>
                </div>
                <div className="o-list">
                  {sampleOrders.length === 0 ? (
                    <div className="o-empty">No sample orders yet</div>
                  ) : sampleOrders.slice(0, 5).map(o => {
                    const val = (o.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
                    return (
                      <div key={o.id} className="o-list-row" onClick={e => { e.stopPropagation(); navigate('/orders/' + o.id) }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="o-list-num" style={{ color: '#7C3AED' }}>{o.order_number}</div>
                          <div className="o-list-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="o-list-val">{fmtCr(val)}</div>
                          <span className={`o-list-status o-status-${statusGroup(o.status)}`}>{STATUS_LABELS[o.status]}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, badge, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">
        {sub && <div className="kt-sub mono">{sub}</div>}
        {badge && <span className="kt-badge mono">{badge}</span>}
      </div>
    </div>
  )
}

function KpiChart({ kind }) {
  if (kind === 'bars') {
    return (
      <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
        {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
          <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
        ))}
      </svg>
    )
  }
  if (kind === 'line') {
    return (
      <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
        <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
      </svg>
    )
  }
  return null
}

function DispatchGauge({ ordered, delivered }) {
  const pct = ordered > 0 ? Math.round((delivered / ordered) * 100) : 0
  const size = 140, r = size/2 - 12, c = 2 * Math.PI * r, dash = (pct/100) * c
  return (
    <div className="gauge-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="oGaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0A2540"/>
            <stop offset="100%" stopColor="#10B981"/>
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="8"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#oGaugeGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
        <text x={size/2} y={size/2 - 2} textAnchor="middle" fontSize="32" fontWeight="600" fill="#0B1B30" style={{letterSpacing: '-0.02em'}}>{pct}<tspan fontSize="16" fill="#6B7280">%</tspan></text>
        <text x={size/2} y={size/2 + 18} textAnchor="middle" fontSize="9" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">FILL RATE</text>
      </svg>
      <div className="gauge-stats">
        <div className="gs-row">
          <span className="gs-dot" style={{background: '#1E54B7'}}/>
          <span className="gs-label">Placed</span>
          <span className="gs-val">{ordered}</span>
        </div>
        <div className="gs-row">
          <span className="gs-dot" style={{background: '#10B981'}}/>
          <span className="gs-label">Delivered</span>
          <span className="gs-val">{delivered}</span>
        </div>
        <div className="gs-row gs-total">
          <span className="gs-label">Pending</span>
          <span className="gs-val">{Math.max(0, ordered - delivered)}</span>
        </div>
      </div>
    </div>
  )
}

function StatusDonut({ groups, total }) {
  if (!groups.length || !total) return <div className="donut-wrap"><div style={{ color:'var(--o-muted-2)', fontSize:12 }}>No order value</div></div>
  const size = 130, r = size/2 - 8, inner = r - 18, cx = size/2, cy = size/2
  let angle = -Math.PI/2
  const arcs = groups.filter(s => s.value > 0).map(s => {
    const portion = s.value / total
    const next = angle + portion * 2 * Math.PI
    const large = portion > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle)
    const x1 = cx + r * Math.cos(next),  y1 = cy + r * Math.sin(next)
    const ix0 = cx + inner * Math.cos(angle), iy0 = cy + inner * Math.sin(angle)
    const ix1 = cx + inner * Math.cos(next),  iy1 = cy + inner * Math.sin(next)
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
    angle = next
    return { path, color: s.color, label: s.label, value: s.value, count: s.count, pct: Math.round(portion*100) }
  })
  return (
    <div className="donut-wrap">
      <svg width={size} height={size}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} opacity="0.92"/>)}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="14" fontWeight="600" fill="#0B1B30" fontFamily="Geist Mono, monospace">{fmtCr(total)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="8" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">FYTD</text>
      </svg>
      <div className="donut-legend">
        {arcs.slice(0, 6).map((a, i) => (
          <div key={i} className="dlg-row">
            <span className="dlg-dot" style={{background: a.color}}/>
            <span className="dlg-name">{a.label}</span>
            <span className="dlg-pct mono">{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Forecast-styled smooth chart for Order vs Dispatch
function OrderVsDispatchChart({ data }) {
  const [hover, setHover] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [showLines, setShowLines] = useState({ ordered: true, delivered: true })
  const svgRef = useRef(null)

  const W = 1000, H = 320, P = { l: 0, r: 56, t: 24, b: 50 }
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b
  const active = data.filter(d => !d.isFuture)

  if (active.length === 0) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--o-muted-2)' }}>No order data this FY</div>
  }

  const maxY = Math.max(...active.flatMap(d => [d.ordered, d.delivered]), 1) * 1.15
  const x = i => P.l + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const y = v => P.t + innerH - (v / maxY) * innerH

  const smoothPath = (pts) => {
    if (pts.length < 2) return ''
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] || p2
      d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const orderedPts = active.map(d => ({ x: x(data.indexOf(d)), y: y(d.ordered) }))
  const deliveredPts = active.map(d => ({ x: x(data.indexOf(d)), y: y(d.delivered) }))
  const orderedPath = smoothPath(orderedPts)
  const deliveredPath = smoothPath(deliveredPts)
  const orderedArea = orderedPts.length ? `${orderedPath} L ${orderedPts[orderedPts.length-1].x} ${y(0)} L ${orderedPts[0].x} ${y(0)} Z` : ''

  const axisVals = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(maxY * p))

  const handleMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W - P.l
    const idx = Math.round((px / innerW) * (data.length - 1))
    if (idx >= 0 && idx < data.length && !data[idx].isFuture) {
      setHover(data[idx])
      setHoverIdx(idx)
    }
  }

  const totalOrdered = active.reduce((s, m) => s + m.ordered, 0)
  const totalDelivered = active.reduce((s, m) => s + m.delivered, 0)
  const fillPct = totalOrdered > 0 ? Math.round((totalDelivered / totalOrdered) * 100) : 0

  return (
    <div>
      <div className="sc-headline">
        <div>
          <div className="sc-eyebrow mono">ORDER FLOW · FY</div>
          <div className="sc-title">Orders Placed vs Delivered</div>
          <div className="sc-headline-sub">
            <span className="sc-coverage">{fillPct}% fill rate</span>
            <span className="sc-dot">·</span>
            <span>{totalOrdered} placed · {totalDelivered} delivered</span>
          </div>
        </div>
      </div>

      <div className="sc-legend">
        <button className={`scl-item ${showLines.ordered ? '' : 'off'}`} onClick={() => setShowLines({...showLines, ordered: !showLines.ordered})}>
          <span className="scl-swatch scl-ordered"/> Placed
        </button>
        <button className={`scl-item ${showLines.delivered ? '' : 'off'}`} onClick={() => setShowLines({...showLines, delivered: !showLines.delivered})}>
          <span className="scl-swatch scl-delivered"/> Delivered
        </button>
      </div>

      <svg
        className="stock-chart"
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => { setHover(null); setHoverIdx(null) }}
      >
        <defs>
          <linearGradient id="oOrderedFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1E54B7" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="#1E54B7" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {axisVals.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeDasharray={i === 0 ? '0' : '2 4'}/>
            <text x={W - P.r + 10} y={y(v) + 4} fontSize="11" fill="#94A3B8" fontFamily="Geist Mono, monospace">{v}</text>
          </g>
        ))}

        {showLines.delivered && <path d={deliveredPath} stroke="#10B981" strokeWidth="2" fill="none" strokeDasharray="6 4" opacity="0.9"/>}

        {showLines.ordered && (
          <>
            <path d={orderedArea} fill="url(#oOrderedFill)"/>
            <path d={orderedPath} stroke="#1E54B7" strokeWidth="2.5" fill="none" strokeLinejoin="round"/>
          </>
        )}

        {hoverIdx !== null && hover && !hover.isFuture && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={P.t} y2={P.t + innerH} stroke="#94A3B8" strokeDasharray="2 3" strokeWidth="1"/>
            {showLines.ordered && <circle cx={x(hoverIdx)} cy={y(hover.ordered)} r="5" fill="#fff" stroke="#1E54B7" strokeWidth="2.5"/>}
            {showLines.delivered && <circle cx={x(hoverIdx)} cy={y(hover.delivered)} r="4" fill="#fff" stroke="#10B981" strokeWidth="2"/>}
          </g>
        )}

        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 20} fontSize="11" fill={d.isFuture ? '#CBD5E1' : d.isCurrent ? '#0A2540' : '#94A3B8'}
            fontWeight={d.isCurrent ? 700 : 400}
            textAnchor="middle"
            fontFamily="Geist Mono, monospace">{d.label}</text>
        ))}

        {hover && hoverIdx !== null && (() => {
          const cx = x(hoverIdx)
          const tipX = cx > W * 0.6 ? cx - 200 : cx + 16
          const gapPct = hover.ordered > 0 ? Math.round(((hover.ordered - hover.delivered) / hover.ordered) * 100) : 0
          return (
            <g transform={`translate(${tipX}, ${P.t + 8})`}>
              <rect width="188" height="138" rx="10" fill="#0A2540"/>
              <text x="14" y="22" fontSize="10" fill="#3DD9D6" fontFamily="Geist Mono, monospace" letterSpacing="0.06em">{hover.label} {hover.year}</text>
              <line x1="14" x2="174" y1="32" y2="32" stroke="rgba(255,255,255,0.1)"/>
              <text x="14" y="50" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">PLACED</text>
              <text x="174" y="50" fontSize="13" fill="#fff" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.ordered}</text>
              <text x="14" y="68" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">DELIVERED</text>
              <text x="174" y="68" fontSize="13" fill="#6EE7B7" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.delivered}</text>
              <text x="14" y="86" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">PENDING</text>
              <text x="174" y="86" fontSize="13" fill="#FCA5A5" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{Math.max(0, hover.ordered - hover.delivered)}</text>
              <line x1="14" x2="174" y1="100" y2="100" stroke="rgba(255,255,255,0.1)"/>
              <text x="14" y="118" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">PLACED VALUE</text>
              <text x="174" y="118" fontSize="11" fill="#fff" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{fmtCr(hover.orderedValue)}</text>
            </g>
          )
        })()}
      </svg>

      <div className="sc-stats">
        <div className="sc-stat">
          <span>FY PLACED</span>
          <b>{totalOrdered}</b>
          <span className="sc-stat-sub">orders this FY</span>
        </div>
        <div className="sc-stat">
          <span>FY DELIVERED</span>
          <b className="up">{totalDelivered}</b>
          <span className="sc-stat-sub">closed orders</span>
        </div>
        <div className="sc-stat">
          <span>FILL RATE</span>
          <b className={fillPct >= 70 ? 'up' : 'down'}>{fillPct}%</b>
          <span className="sc-stat-sub">delivered ÷ placed</span>
        </div>
        <div className="sc-stat">
          <span>IN PIPELINE</span>
          <b>{Math.max(0, totalOrdered - totalDelivered)}</b>
          <span className="sc-stat-sub">awaiting delivery</span>
        </div>
      </div>
    </div>
  )
}
