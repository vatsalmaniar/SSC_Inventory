import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

const BILLING_MODULE_STATUSES = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc']


function statusLabel(s) {
  return {
    pi_requested:       'PI Requested',
    pi_generated:       'PI Issued',
    pi_payment_pending: 'PI Payment Pending',
    goods_issued:       'Credit Check',
    credit_check:       'GI Posted',
    goods_issue_posted: 'Invoice Gen.',
    invoice_generated:  'Invoice Generated',
    delivery_ready:     'E-Way Bill',
    eway_generated:     'E-Way Generated',
    dispatched_fc:      'Delivered',
  }[s] || s
}

export default function SalesModule() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')
  const [search, setSearch]   = useState('')
  const [showTest, setShowTest] = useState(false)

  useEffect(() => { init() }, [])

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
    const role   = profile?.role || 'accounts'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    if (!['accounts','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, avatar, role })
  }

  async function loadOrders(testMode = false) {
    setLoading(true)
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,status,order_type,credit_override,created_at,order_items(id,qty,dispatched_qty,total_price,unit_price_after_disc),order_dispatches(id,batch_no,invoice_number,eway_bill_number,dispatched_items)')
      .in('status', BILLING_MODULE_STATUSES)
      .gte('created_at', FY_START)
      .eq('is_test', testMode)
      .neq('order_type', 'SAMPLE')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  const piStatuses     = ['pi_requested','pi_generated','pi_payment_pending']
  const activeStatuses = [...piStatuses,'goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready']

  const ewayRows = orders.flatMap(o =>
    (o.order_dispatches || [])
      .filter(b => b.eway_bill_number)
      .sort((a, b) => a.batch_no - b.batch_no)
      .map(b => ({ order: o, batch: b }))
  )

  function matchFilter(o) {
    if (filter === 'all')    return activeStatuses.includes(o.status)
    if (filter === 'pi')     return piStatuses.includes(o.status)
    return o.status === filter
  }

  const counts = {
    all:                orders.filter(o => activeStatuses.includes(o.status)).length,
    pi:                 orders.filter(o => piStatuses.includes(o.status)).length,
    goods_issued:       orders.filter(o => o.status === 'goods_issued').length,
    credit_check:       orders.filter(o => o.status === 'credit_check').length,
    goods_issue_posted: orders.filter(o => o.status === 'goods_issue_posted').length,
    invoice_generated:  orders.filter(o => o.status === 'invoice_generated').length,
    delivery_ready:     orders.filter(o => o.status === 'delivery_ready').length,
    eway_generated:     ewayRows.length,
  }

  const q = search.trim().toLowerCase()
  const baseFiltered = filter === 'eway_generated' ? [] : orders.filter(matchFilter)
  const filtered = filter === 'eway_generated'
    ? ewayRows.filter(({ order: o }) => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q))
    : baseFiltered.filter(o => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q))

  const FILTERS = [
    { key: 'all',                label: 'All'           },
    { key: 'pi',                 label: 'PI Orders'     },
    { key: 'goods_issued',       label: 'Credit Check'  },
    { key: 'credit_check',       label: 'GI Posted'     },
    { key: 'goods_issue_posted', label: 'Invoice Gen.'  },
    { key: 'invoice_generated',  label: 'Waiting FC'    },
    { key: 'delivery_ready',     label: 'E-Way Bill'    },
    { key: 'eway_generated',     label: 'E-Way Done'    },
  ]

  return (
    <Layout pageTitle="Billing" pageKey="billing">
      <div className="od-list-page">
        <div className="od-list-body">

          {/* Header */}
          <div className="od-list-header">
            <div className="od-list-title">Billing</div>
            {user.role === 'admin' && (
              <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:showTest ? '#b45309' : 'var(--gray-500)',fontWeight:showTest ? 600 : 400,background:showTest ? '#fef3c7' : 'transparent',border:showTest ? '1px solid #fde68a' : '1px solid var(--gray-200)',borderRadius:8,padding:'6px 12px',transition:'all 0.15s'}}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadOrders(e.target.checked) }} style={{accentColor:'#b45309',width:13,height:13}} />
                Test Mode
              </label>
            )}
          </div>

          {/* Summary */}
          <div className="od-stat-grid">
            <div className="od-stat-card od-stat-blue" onClick={() => setFilter('all')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">All Active</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.all}</div>
              <div className="od-stat-sub">in billing pipeline</div>
            </div>
            <div className="od-stat-card od-stat-amber" onClick={() => setFilter('goods_issued')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Credit Check</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.goods_issued}</div>
              <div className="od-stat-sub">awaiting credit check</div>
            </div>
            <div className="od-stat-card od-stat-purple" onClick={() => setFilter('delivery_ready')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">E-Way Pending</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.delivery_ready}</div>
              <div className="od-stat-sub">awaiting e-way bill</div>
            </div>
            <div className="od-stat-card od-stat-green" onClick={() => setFilter('eway_generated')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">E-Way Done</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.eway_generated}</div>
              <div className="od-stat-sub">ready to dispatch</div>
            </div>
          </div>

          {/* Search + Filters */}
          <div className="od-list-controls">
            <div className="od-search-wrap">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                className="od-search-input"
                placeholder="Search order, customer..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="od-search-clear" onClick={() => setSearch('')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14,height:14 }}>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            <div className="filter-bar" style={{ margin:0, padding:0 }}>
              {FILTERS.map(({ key, label }) => (
                <button key={key}
                  className={'filter-chip' + (filter === key ? ' active' : '')}
                  onClick={() => setFilter(key)}>
                  {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="od-table-card">
            {loading ? (
              <div className="loading-state" style={{ padding:40 }}><div className="loading-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="orders-empty" style={{ border:'none' }}>
                <div className="orders-empty-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                  </svg>
                </div>
                <div className="orders-empty-title">No orders here</div>
                <div className="orders-empty-sub">Nothing to action right now.</div>
              </div>
            ) : filter === 'eway_generated' ? (
              <>
                <div className="orders-table-wrap" style={{ border:'none', borderRadius:0 }}>
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Customer</th>
                        <th>Fulfilment Centre</th>
                        <th>Order Date</th>
                        <th style={{ textAlign:'right' }}>Batch Value</th>
                        <th style={{ textAlign:'right' }}>E-Way #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(({ order: o, batch: b }) => {
                        const batchVal = (b.dispatched_items || []).reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0)
                        return (
                          <tr key={b.id} onClick={() => navigate('/billing/' + o.id, { state: { dispatch_id: b.id } })}>
                            <td className="order-num-cell">
                              {o.order_number}
                              {b.dc_number      && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)', marginTop:2 }}>{b.dc_number}</div>}
                              {b.invoice_number && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)', marginTop:1 }}>{b.invoice_number}</div>}
                            </td>
                            <td className="customer-cell">{o.customer_name}</td>
                            <td>{o.fulfilment_center || '—'}</td>
                            <td>{fmt(o.order_date)}</td>
                            <td className="amount-cell">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</td>
                            <td className="status-cell" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{b.eway_bill_number}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding:'0 4px 4px' }}>
                  {filtered.map(({ order: o, batch: b }, i) => {
                    const batchVal = (b.dispatched_items || []).reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0)
                    return (
                      <div key={b.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/billing/' + o.id, { state: { dispatch_id: b.id } })}>
                        <div className="order-card-top">
                          <div>
                            <div className="order-num">{o.order_number}</div>
                            {b.dc_number      && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)' }}>{b.dc_number}</div>}
                            {b.invoice_number && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)' }}>{b.invoice_number}</div>}
                            <div className="order-customer">{o.customer_name}</div>
                            <div className="order-date">{o.fulfilment_center || '—'} · {fmt(o.order_date)}</div>
                          </div>
                          <span className="pill pill-eway_generated">E-Way Done</span>
                        </div>
                        <div className="order-card-bottom">
                          <span className="order-items-count">{b.eway_bill_number}</span>
                          <span className="order-total">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="orders-table-wrap" style={{ border:'none', borderRadius:0 }}>
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Customer</th>
                        <th>Fulfilment Centre</th>
                        <th>Order Date</th>
                        <th style={{ textAlign:'right' }}>Value</th>
                        <th style={{ textAlign:'right' }}>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(o => {
                        const activeBatch = (o.order_dispatches || []).sort((a, b) => b.batch_no - a.batch_no)[0]
                        const batchTotal = activeBatch?.dispatched_items
                          ? activeBatch.dispatched_items.reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0) + (o.freight || 0)
                          : (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                        const dcNum  = activeBatch?.dc_number || o.dc_number
                        const invNum = activeBatch?.invoice_number || o.invoice_number
                        return (
                          <tr key={o.id} onClick={() => navigate('/billing/' + o.id)}>
                            <td className="order-num-cell">
                              {o.order_number}
                              {dcNum  && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)', marginTop:2 }}>{dcNum}</div>}
                              {invNum && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)', marginTop:1 }}>{invNum}</div>}
                            </td>
                            <td className="customer-cell">{o.customer_name}</td>
                            <td>{o.fulfilment_center || '—'}</td>
                            <td>{fmt(o.order_date)}</td>
                            <td className="amount-cell">₹{batchTotal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</td>
                            <td className="status-cell">
                              <span className={'pill pill-' + o.status}>{statusLabel(o.status)}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding:'0 4px 4px' }}>
                  {filtered.map((o, i) => {
                    const activeBatch = (o.order_dispatches || []).sort((a, b) => b.batch_no - a.batch_no)[0]
                    const batchTotal = activeBatch?.dispatched_items
                      ? activeBatch.dispatched_items.reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0) + (o.freight || 0)
                      : (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                    const dcNum  = activeBatch?.dc_number || o.dc_number
                    const invNum = activeBatch?.invoice_number || o.invoice_number
                    return (
                      <div key={o.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/billing/' + o.id)}>
                        <div className="order-card-top">
                          <div>
                            <div className="order-num">{o.order_number}</div>
                            {dcNum  && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)' }}>{dcNum}</div>}
                            {invNum && <div style={{ fontSize:11, color:'var(--gray-500)', fontFamily:'var(--mono)' }}>{invNum}</div>}
                            <div className="order-customer">{o.customer_name}</div>
                            <div className="order-date">{o.fulfilment_center || '—'} · {fmt(o.order_date)}</div>
                          </div>
                          <span className={'pill pill-' + o.status}>{statusLabel(o.status)}</span>
                        </div>
                        <div className="order-card-bottom">
                          <span className="order-items-count">{(o.order_items || []).length} items</span>
                          <span className="order-total">₹{batchTotal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </Layout>
  )
}
