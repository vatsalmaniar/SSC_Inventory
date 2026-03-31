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
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear()
}
function statusLabel(s) {
  return { pending:'Pending', processing:'Processing', dispatched:'Dispatched', dispatched_fc:'Dispatched', dispatch:'Shipped', partial_dispatch:'Partially Shipped', completed:'Completed', cancelled:'Cancelled' }[s] || s
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
    await loadOrders()
  }

  async function loadOrders() {
    setLoading(true)
    const { data } = await sb.from('orders').select('*, order_items(*)')
      .gte('created_at', '2026-03-31')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  // ── Stats ──
  const today = new Date().toISOString().slice(0, 10)
  const dispatchedValue = orders
    .filter(o => o.status === 'dispatched_fc')
    .reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0) + (o.freight || 0), 0)
  const tempOrders    = orders.filter(o => o.status === 'pending').length
  const pendingOrders = orders.filter(o => !['dispatched_fc', 'cancelled'].includes(o.status)).length
  const todayDispatched = orders.filter(o =>
    (o.order_items || []).some(i => i.dispatch_date === today)
  )
  const totalValue = orders.reduce((s, o) =>
    s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0) + (o.freight || 0), 0
  )

  // ── Popular products ──
  const itemCounts = {}
  orders.forEach(o => {
    ;(o.order_items || []).forEach(item => {
      if (item.item_code) itemCounts[item.item_code] = (itemCounts[item.item_code] || 0) + (item.qty || 1)
    })
  })
  const popularItems = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 7)
  const maxQty = popularItems[0]?.[1] || 1

  // Navigate to list with optional filter
  function goList(filter) {
    navigate('/orders/list', { state: { filter: filter || 'all' } })
  }

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'
  const dateStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <Layout pageTitle="Orders" pageKey="orders">
    <div className="od-dash-page">

      <div className="od-dash-body">

        {/* Greeting + actions */}
        <div className="od-dash-greeting-row">
          <div>
            <div className="od-dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
            <div className="od-dash-date">{dateStr}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {user.role !== 'ops' && (
              <button className="new-order-btn" onClick={() => navigate('/orders/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Order
              </button>
            )}
            <button className="od-dash-viewall-btn" onClick={() => goList()}>
              View All Orders
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
          </div>
        </div>

        {successMsg && (
          <div className="orders-success-banner">✓ {successMsg}</div>
        )}

        {/* ── Stat tiles ── */}
        {loading ? (
          <div className="loading-state" style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--gray-200)', padding: 40 }}>
            <div className="loading-spin" />Loading...
          </div>
        ) : (
          <>
            <div className="od-dash-tiles">
              <div className="od-dash-tile" onClick={() => goList('dispatched')}>
                <div className="od-dash-tile-icon green">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>
                </div>
                <div className="od-dash-tile-num" style={{ fontSize: 18 }}>{fmtCr(dispatchedValue)}</div>
                <div className="od-dash-tile-label">Total Dispatched</div>
                <div className="od-dash-tile-sub">Dispatched orders →</div>
              </div>

              <div className="od-dash-tile" onClick={() => goList('approval')}>
                <div className="od-dash-tile-icon amber">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                </div>
                <div className="od-dash-tile-num">{tempOrders}</div>
                <div className="od-dash-tile-label">Pending Approval</div>
                <div className="od-dash-tile-sub">Awaiting approval →</div>
              </div>

              <div className="od-dash-tile" onClick={() => goList('undelivered')}>
                <div className="od-dash-tile-icon red">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                </div>
                <div className="od-dash-tile-num">{pendingOrders}</div>
                <div className="od-dash-tile-label">Pending Orders</div>
                <div className="od-dash-tile-sub">Not yet dispatched →</div>
              </div>

              <div className="od-dash-tile" onClick={() => navigate('/dispatch/today')}>
                <div className="od-dash-tile-icon blue">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div className="od-dash-tile-num">{todayDispatched.length}</div>
                <div className="od-dash-tile-label">Today's Dispatch</div>
                <div className="od-dash-tile-sub">View dispatch plan →</div>
              </div>
            </div>

            {/* Total value wide card */}
            <div className="od-dash-value-card">
              <div className="od-dash-value-left">
                <div className="od-dash-value-label">Total Order Value</div>
                <div className="od-dash-value-num">
                  ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </div>
                <div className="od-dash-value-sub">{orders.length} orders total</div>
              </div>
              <button className="od-dash-value-btn" onClick={() => goList()}>
                View Orders List
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </div>

            {/* ── Two-col: Today's dispatch + Popular products ── */}
            <div className="od-dash-panels">

              {/* Today's Dispatch */}
              <div className="od-panel">
                <div className="od-panel-header">
                  <div className="od-panel-title">Today's Dispatch List</div>
                  <span className="od-panel-badge">{todayDispatched.length}</span>
                </div>
                {todayDispatched.length === 0 ? (
                  <div className="od-panel-empty">No dispatches today</div>
                ) : (
                  <div>
                    {todayDispatched.map(o => {
                      const total = (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                      return (
                        <div key={o.id} className="od-dispatch-row" onClick={() => navigate('/orders/' + o.id)}>
                          <div>
                            <div className="od-dispatch-num">{o.order_number}</div>
                            <div className="od-dispatch-customer">{o.customer_name}</div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div className="od-dispatch-total">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                            <span className={'pill pill-' + o.status} style={{ marginTop: 3, display: 'inline-block' }}>{statusLabel(o.status)}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Popular Products */}
              <div className="od-panel">
                <div className="od-panel-header">
                  <div className="od-panel-title">Popular Products</div>
                  <span className="od-panel-badge">Top {popularItems.length}</span>
                </div>
                {popularItems.length === 0 ? (
                  <div className="od-panel-empty">No order data yet</div>
                ) : (
                  <div className="od-popular-list">
                    {popularItems.map(([code, qty], i) => (
                      <div key={code} className="od-popular-row">
                        <div className="od-popular-rank">{i + 1}</div>
                        <div className="od-popular-info">
                          <div className="od-popular-code">{code}</div>
                          <div className="od-popular-bar-track">
                            <div className="od-popular-bar" style={{ width: Math.round((qty / maxQty) * 100) + '%' }} />
                          </div>
                        </div>
                        <div className="od-popular-qty">{qty}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          </>
        )}

      </div>
    </div>
    </Layout>
  )
}
