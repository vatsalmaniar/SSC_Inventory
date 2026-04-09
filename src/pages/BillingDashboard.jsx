import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

function fmtCr(val) {
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function statusLabel(s) {
  return {
    pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
    goods_issued:'Credit Check', credit_check:'GI Posted', goods_issue_posted:'Invoice Gen.',
    invoice_generated:'Invoice Generated', delivery_ready:'E-Way Pending',
    eway_generated:'E-Way Done', dispatched_fc:'Delivered',
  }[s] || s
}

const PI_STATUSES      = ['pi_requested','pi_generated','pi_payment_pending']
const BILLING_STATUSES = [...PI_STATUSES,'goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc']

export default function BillingDashboard() {
  const navigate = useNavigate()
  const [user, setUser]     = useState({ name: '', role: '' })
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name = profile?.name || session.user.email.split('@')[0]
    const role = profile?.role || 'accounts'
    if (!['accounts','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, role })
    setLoading(true)
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,status,credit_override,order_type,created_at,order_dispatches(id,batch_no,invoice_number,pi_number,pi_required,credit_override)')
      .in('status', BILLING_STATUSES)
      .gte('created_at', FY_START).eq('is_test', false)
      .neq('order_type', 'SAMPLE')
      .order('updated_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  const piOrders          = orders.filter(o => PI_STATUSES.includes(o.status))
  const creditCheckOrders = orders.filter(o => o.status === 'goods_issued')
  const giPostedOrders    = orders.filter(o => o.status === 'credit_check')
  const invoiceOrders     = orders.filter(o => o.status === 'goods_issue_posted')
  const waitingFCOrders   = orders.filter(o => o.status === 'invoice_generated')
  const ewayOrders        = orders.filter(o => o.status === 'delivery_ready')
  const ewayDoneOrders    = orders.filter(o => o.status === 'eway_generated')
  const deliveredOrders   = orders.filter(o => o.status === 'dispatched_fc')
  const overrideOrders    = orders.filter(o => o.credit_override === true)

  const activeOrders = orders.filter(o => o.status !== 'dispatched_fc')

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const PIPELINE = [
    { label: 'PI Phase',          count: piOrders.length,          color: '#7e22ce' },
    { label: 'Credit Check',      count: creditCheckOrders.length, color: '#d97706' },
    { label: 'GI Posted',         count: giPostedOrders.length,    color: '#1a4dab' },
    { label: 'Invoice Pending',   count: invoiceOrders.length,     color: '#0369a1' },
    { label: 'Waiting for FC',    count: waitingFCOrders.length,   color: '#0891b2' },
    { label: 'E-Way Pending',     count: ewayOrders.length,        color: '#0f766e' },
    { label: 'E-Way Done',        count: ewayDoneOrders.length,    color: '#059669' },
    { label: 'Delivered',         count: deliveredOrders.length,   color: '#059669' },
  ]
  const pipelineMax = Math.max(...PIPELINE.map(p => p.count), 1)

  // Action needed = things billing must act on now
  const actionNeeded = [...creditCheckOrders, ...piOrders.filter(o => o.status === 'pi_requested'), ...invoiceOrders, ...ewayOrders]

  return (
    <Layout pageTitle="Billing" pageKey="billing">
      <div className="dash-page">
        <div className="dash-body">

          {/* Header */}
          <div className="dash-header-row">
            <div>
              <div className="dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="dash-date">
                Billing &amp; Accounts &nbsp;·&nbsp;
                {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            <button className="od-dash-viewall-btn" onClick={() => navigate('/billing/list')}>
              All Orders
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/>Loading...</div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Tile 1 — Credit Check */}
              <div className="dash-tile" style={{ background: '#78350f' }} onClick={() => navigate('/billing/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Credit Check</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{creditCheckOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">goods issued — awaiting check</span>
                  {creditCheckOrders.length > 0 && <span className="dash-tile-badge">Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="80"  cy="18" r="48" fill="rgba(255,255,255,0.08)"/>
                    <circle cx="220" cy="18" r="60" fill="rgba(255,255,255,0.08)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 2 — PI Orders */}
              <div className="dash-tile" style={{ background: '#3b0764' }} onClick={() => navigate('/billing/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">PI Orders</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{piOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">PI · payment · confirmation</span>
                  {piOrders.filter(o => o.status === 'pi_requested').length > 0 && (
                    <span className="dash-tile-badge">{piOrders.filter(o => o.status === 'pi_requested').length} to issue</span>
                  )}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <rect x="0"   y="10" width="90" height="26" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="105" y="4"  width="90" height="32" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="210" y="14" width="90" height="22" rx="6" fill="rgba(255,255,255,0.10)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 3 — Invoice Pending */}
              <div className="dash-tile" style={{ background: '#0c4a6e' }} onClick={() => navigate('/billing/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Invoice Pending</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{invoiceOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">GI posted — awaiting invoice</span>
                  {invoiceOrders.length > 0 && <span className="dash-tile-badge">Generate invoice</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5].map(i => {
                      const h = [20,28,18,34,24,36][i]
                      return <rect key={i} x={i*50+8} y={36-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.15)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 4 — E-Way Pending (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/billing/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">E-Way Pending</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: ewayOrders.length > 0 ? '#0f766e' : undefined }}>{ewayOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">delivery ready — need e-way</span>
                  {ewayOrders.length > 0 && <span className="dash-tile-badge" style={{ background:'#f0fdfa', color:'#0f766e' }}>Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [10,18,12,24,16,22,12,26][i]
                      return <rect key={i} x={i*38+4} y={36-h} width={28} height={h} rx={4} fill="rgba(15,118,110,0.08)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 5 — Credit Overrides (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/billing/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Credit Overrides</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: overrideOrders.length > 0 ? '#dc2626' : undefined }}>{overrideOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">payment pending — take approval</span>
                  {overrideOrders.length > 0 && <span className="dash-tile-badge" style={{ background:'#fef2f2', color:'#dc2626' }}>⚠️ Review</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(220,38,38,0.04)"/>
                    <circle cx="150" cy="18" r="32" fill="rgba(220,38,38,0.04)"/>
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Pipeline */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Billing Pipeline</div>
                  <span className="dash-badge">{activeOrders.length} active</span>
                </div>
                <div style={{ padding:'4px 0 0' }}>
                  {PIPELINE.map((p, i) => {
                    const pct  = Math.round((p.count / pipelineMax) * 100)
                    const minW = p.count > 0 ? Math.max(pct, 6) : 0
                    return (
                      <div key={i} style={{ padding:'10px 18px', borderBottom: i < PIPELINE.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                          <span style={{ fontSize:12, color: p.count > 0 ? '#334155' : '#94a3b8', fontWeight: p.count > 0 ? 600 : 400 }}>{p.label}</span>
                          <span style={{ fontSize:14, fontWeight:800, color: p.count > 0 ? '#0f172a' : '#cbd5e1', minWidth:24, textAlign:'right' }}>{p.count}</span>
                        </div>
                        <div style={{ height:6, background:'#f1f5f9', borderRadius:6 }}>
                          {p.count > 0 && <div style={{ height:'100%', width: minW + '%', background: p.color, borderRadius:6, transition:'width 0.6s ease', minWidth:8 }} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Action Needed list */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Action Needed</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="dash-badge" style={{ background: actionNeeded.length > 0 ? '#fffbeb' : '#f1f5f9', color: actionNeeded.length > 0 ? '#d97706' : '#94a3b8' }}>{actionNeeded.length} orders</span>
                    <button onClick={() => navigate('/billing/list')} className="dash-icon-btn">
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </button>
                  </div>
                </div>
                {actionNeeded.length === 0
                  ? <div className="dash-empty">No pending billing actions</div>
                  : actionNeeded.slice(0, 8).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/billing/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#d97706' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                          {o.credit_override && <div style={{ fontSize:10, color:'#dc2626', fontWeight:600, marginTop:2 }}>⚠️ Override</div>}
                        </div>
                      </div>
                    ))
                }
              </div>

            </div>

            {/* Bottom row */}
            <div className="dash-bottom">

              {/* PI Orders */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">PI Orders</div>
                  <span className="dash-badge" style={{ background:'#faf5ff', color:'#7e22ce' }}>{piOrders.length} orders</span>
                </div>
                {piOrders.length === 0
                  ? <div className="dash-empty">No PI orders in progress</div>
                  : piOrders.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/billing/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#7e22ce' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                        </div>
                      </div>
                    ))
                }
              </div>

              {/* Credit Overrides */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Credit Overrides</div>
                  <span className="dash-badge" style={{ background: overrideOrders.length > 0 ? '#fef2f2' : '#f1f5f9', color: overrideOrders.length > 0 ? '#dc2626' : '#94a3b8' }}>{overrideOrders.length} orders</span>
                </div>
                {overrideOrders.length === 0
                  ? <div className="dash-empty">No credit overrides</div>
                  : overrideOrders.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/billing/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#dc2626' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                        </div>
                      </div>
                    ))
                }
              </div>

              {/* Waiting for FC + E-Way Done */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Waiting for FC / E-Way Done</div>
                  <span className="dash-badge">{waitingFCOrders.length + ewayDoneOrders.length} orders</span>
                </div>
                {(waitingFCOrders.length + ewayDoneOrders.length) === 0
                  ? <div className="dash-empty">None at this stage</div>
                  : [...waitingFCOrders, ...ewayDoneOrders].slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/billing/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#0891b2' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                        </div>
                      </div>
                    ))
                }
              </div>

            </div>

          </>)}
        </div>
      </div>
    </Layout>
  )
}
