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
    delivery_created:'Delivery Created', picking:'Picking', packing:'Packing',
    pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
    goods_issued:'With Billing', credit_check:'With Billing', goods_issue_posted:'With Billing',
    invoice_generated:'Delivery Ready', delivery_ready:'E-Way Pending',
    eway_generated:'E-Way Done', dispatched_fc:'Delivered',
  }[s] || s
}

const ACTION_STATUSES  = ['delivery_created','picking','packing']
const BILLING_STATUSES = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']
const PI_STATUSES      = ['pi_requested','pi_generated','pi_payment_pending']
const FC_ALL_STATUSES  = [...ACTION_STATUSES, ...PI_STATUSES, ...BILLING_STATUSES, 'invoice_generated','eway_generated','dispatched_fc']

export default function FCDashboard() {
  const navigate = useNavigate()
  const [user, setUser]     = useState({ name: '', role: '', fc: '' })
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
    const role = profile?.role || 'fc_kaveri'
    const fc   = role === 'fc_kaveri' ? 'Kaveri' : role === 'fc_godawari' ? 'Godawari' : null
    if (!['fc_kaveri','fc_godawari','ops','admin','accounts'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, role, fc })
    await loadOrders(fc)
  }

  async function loadOrders(fc) {
    setLoading(true)
    let q = sb.from('orders')
      .select('id,order_number,customer_name,status,fulfilment_center,credit_override,order_type,created_at,order_dispatches(id,batch_no,dc_number,pi_number,pi_required,status)')
      .in('status', FC_ALL_STATUSES)
      .gte('created_at', FY_START).eq('is_test', false)
      .order('updated_at', { ascending: false })
    if (fc) q = q.eq('fulfilment_center', fc)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  const actionOrders  = orders.filter(o => ACTION_STATUSES.includes(o.status))
  const piOrders      = orders.filter(o => PI_STATUSES.includes(o.status))
  const billingOrders = orders.filter(o => BILLING_STATUSES.includes(o.status))
  const readyOrders   = orders.filter(o => o.status === 'invoice_generated')
  const ewayOrders    = orders.filter(o => o.status === 'eway_generated')
  const delivered     = orders.filter(o => o.status === 'dispatched_fc')

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const PIPELINE = [
    { label: 'Delivery Created', count: orders.filter(o => o.status === 'delivery_created').length, color: '#7c3aed' },
    { label: 'Picking',          count: orders.filter(o => o.status === 'picking').length,           color: '#7c3aed' },
    { label: 'Packing',          count: orders.filter(o => o.status === 'packing').length,           color: '#7c3aed' },
    { label: 'PI Phase',         count: piOrders.length,     color: '#7e22ce' },
    { label: 'With Billing',     count: billingOrders.length, color: '#d97706' },
    { label: 'Delivery Ready',   count: readyOrders.length,  color: '#0891b2' },
    { label: 'E-Way / Dispatch', count: ewayOrders.length,   color: '#059669' },
    { label: 'Delivered',        count: delivered.length,    color: '#059669' },
  ]
  const pipelineMax = Math.max(...PIPELINE.map(p => p.count), 1)

  return (
    <Layout pageTitle="Fulfilment Centre" pageKey="fc">
      <div className="dash-page">
        <div className="dash-body">

          {/* Header */}
          <div className="dash-header-row">
            <div>
              <div className="dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="dash-date">
                {user.fc ? `Fulfilment Centre — ${user.fc}` : 'All Fulfilment Centres'} &nbsp;·&nbsp;
                {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            <button className="od-dash-viewall-btn" onClick={() => navigate('/fc/list')}>
              All Orders
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/>Loading...</div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Tile 1 — Action Required */}
              <div className="dash-tile" style={{ background: '#3b0764' }} onClick={() => navigate('/fc/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Action Required</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{actionOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">picking · packing · dispatch</span>
                  {actionOrders.length > 0 && <span className="dash-tile-badge">Needs FC</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <rect x="0"   y="8"  width="60" height="28" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="70"  y="0"  width="60" height="36" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="140" y="12" width="60" height="24" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="210" y="4"  width="60" height="32" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="260" y="16" width="40" height="20" rx="6" fill="rgba(255,255,255,0.10)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 2 — With Billing */}
              <div className="dash-tile" style={{ background: '#78350f' }} onClick={() => navigate('/fc/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">With Billing</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{billingOrders.length + readyOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">credit check · invoicing · e-way</span>
                  {readyOrders.length > 0 && <span className="dash-tile-badge">{readyOrders.length} delivery ready</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="80"  cy="18" r="48" fill="rgba(255,255,255,0.08)"/>
                    <circle cx="200" cy="18" r="60" fill="rgba(255,255,255,0.08)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 3 — Delivered */}
              <div className="dash-tile" style={{ background: '#064e3b' }} onClick={() => navigate('/fc/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Delivered</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{delivered.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">completed this FY</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5].map(i => {
                      const h = [14,22,18,30,24,36][i]
                      return <rect key={i} x={i*50+8} y={36-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.15)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 4 — PI Phase (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/fc/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">PI Phase</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: piOrders.length > 0 ? '#7e22ce' : undefined }}>{piOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">with accounts — PI</span>
                  {piOrders.length > 0 && <span className="dash-tile-badge" style={{ background:'#faf5ff', color:'#7e22ce' }}>Awaiting payment</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(124,58,237,0.04)"/>
                    <circle cx="150" cy="18" r="36" fill="rgba(124,58,237,0.04)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 5 — E-Way / Dispatch (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/fc/list')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Ready to Dispatch</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: ewayOrders.length > 0 ? '#0891b2' : undefined }}>{ewayOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">e-way done · pending dispatch</span>
                  {ewayOrders.length > 0 && <span className="dash-tile-badge" style={{ background:'#ecfeff', color:'#0891b2' }}>Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [10,18,12,24,16,22,12,26][i]
                      return <rect key={i} x={i*38+4} y={36-h} width={28} height={h} rx={4} fill="rgba(8,145,178,0.08)"/>
                    })}
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Pipeline */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Order Pipeline</div>
                  <span className="dash-badge">{actionOrders.length + piOrders.length + billingOrders.length + readyOrders.length + ewayOrders.length} in progress</span>
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

              {/* Action Required list */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Action Required</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="dash-badge" style={{ background: actionOrders.length > 0 ? '#f5f3ff' : '#f1f5f9', color: actionOrders.length > 0 ? '#7c3aed' : '#94a3b8' }}>{actionOrders.length} orders</span>
                    <button onClick={() => navigate('/fc/list')} className="dash-icon-btn">
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </button>
                  </div>
                </div>
                {actionOrders.length === 0
                  ? <div className="dash-empty">No pending FC action</div>
                  : actionOrders.slice(0, 8).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/fc/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#7c3aed' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className={'pill pill-' + o.status} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                          {o.fulfilment_center && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{o.fulfilment_center}</div>}
                        </div>
                      </div>
                    ))
                }
              </div>

            </div>

            {/* Bottom row */}
            <div className="dash-bottom">

              {/* PI Phase */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">PI Phase — With Accounts</div>
                  <span className="dash-badge" style={{ background:'#faf5ff', color:'#7e22ce' }}>{piOrders.length} orders</span>
                </div>
                {piOrders.length === 0
                  ? <div className="dash-empty">No PI orders pending</div>
                  : piOrders.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/fc/' + o.id)}>
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

              {/* Delivery Ready */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Ready for Delivery</div>
                  <span className="dash-badge" style={{ background:'#ecfeff', color:'#0891b2' }}>{readyOrders.length + ewayOrders.length} orders</span>
                </div>
                {(readyOrders.length + ewayOrders.length) === 0
                  ? <div className="dash-empty">No orders ready for delivery</div>
                  : [...readyOrders, ...ewayOrders].slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/fc/' + o.id)}>
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

              {/* Recently Delivered */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Recently Delivered</div>
                  <span className="dash-badge" style={{ background:'#f0fdf4', color:'#059669' }}>{delivered.length} total</span>
                </div>
                {delivered.length === 0
                  ? <div className="dash-empty">No deliveries yet</div>
                  : delivered.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/fc/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#059669' }}>{o.order_number}</div>
                          <div className="dash-row-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <span className="pill pill-dispatched_fc" style={{ fontSize:10 }}>Delivered</span>
                          {o.fulfilment_center && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{o.fulfilment_center}</div>}
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
