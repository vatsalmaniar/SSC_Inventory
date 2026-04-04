import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orders.css'

const FC_MODULE_STATUSES = ['dispatch','delivery_created','picking','packing','goods_issued','invoice_generated','delivery_ready','eway_generated','dispatched_fc']
const WITH_ACCOUNTS = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear()
}

function statusLabel(s) {
  return {
    delivery_created:   'Picking',
    picking:            'Packing',
    packing:            'Goods Issue',
    goods_issued:       'With Accounts',
    credit_check:       'Credit Check',
    goods_issue_posted: 'GI Posted',
    invoice_generated:  'Delivery Ready',
    delivery_ready:     'E-Way Pending',
    eway_generated:     'Delivered',
    dispatched_fc:      'Delivered',
  }[s] || s
}

function isPartiallyDispatched(o) {
  const items = o.order_items || []
  return items.some(i => (i.dispatched_qty || 0) > 0) && items.some(i => i.qty > (i.dispatched_qty || 0))
}

export default function FCModule() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '', center: '' })
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('action')
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
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'fc_kaveri'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const center = role === 'fc_godawari' ? 'Godawari' : role === 'fc_kaveri' ? 'Kaveri' : null
    if (!['fc_kaveri','fc_godawari','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, avatar, role, center })
    await loadOrders(center)
  }

  async function loadOrders(center, testMode = false) {
    setLoading(true)
    let q = sb.from('orders').select('id,order_number,customer_name,status,order_type,fulfilment_center,order_items(id,qty,dispatched_qty),order_dispatches(id,batch_no,dc_number,invoice_number)')
      .in('status', FC_MODULE_STATUSES)
      .gte('created_at', '2026-03-31')
      .eq('is_test', testMode)
      .order('created_at', { ascending: false })
    if (center) q = q.eq('fulfilment_center', center)
    const { data } = await q
    const filtered = (data || []).filter(o => o.status !== 'dispatch' || isPartiallyDispatched(o))
    setOrders(filtered)
    setLoading(false)
  }

  const actionStatuses = ['delivery_created','picking','packing','invoice_generated','eway_generated']
  const waitStatuses   = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']

  function matchFilter(o) {
    if (filter === 'all')           return true
    if (filter === 'action')        return actionStatuses.includes(o.status)
    if (filter === 'waiting')       return waitStatuses.includes(o.status)
    if (filter === 'dispatched_fc') return o.status === 'dispatched_fc'
    return o.status === filter
  }

  const counts = {
    all:           orders.filter(o => actionStatuses.includes(o.status) || waitStatuses.includes(o.status)).length,
    action:        orders.filter(o => actionStatuses.includes(o.status)).length,
    waiting:       orders.filter(o => waitStatuses.includes(o.status)).length,
    dispatched_fc: orders.filter(o => o.status === 'dispatched_fc').length,
  }

  const q = search.trim().toLowerCase()
  const filtered = orders.filter(matchFilter).filter(o => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q))

  const centerLabel = user.center ? ` — ${user.center}` : ''

  const FILTERS = [
    { key: 'action',        label: 'Action Required' },
    { key: 'waiting',       label: 'With Accounts'   },
    { key: 'all',           label: 'All Active'      },
    { key: 'dispatched_fc', label: 'Delivered'       },
  ]

  return (
    <Layout pageTitle="Fulfilment Center" pageKey="fc">
      <div className="od-list-page">
        <div className="od-list-body">

          {/* Header */}
          <div className="od-list-header">
            <div className="od-list-title">Fulfilment Center{centerLabel}</div>
            {user.role === 'admin' && (
              <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:showTest ? '#b45309' : 'var(--gray-500)',fontWeight:showTest ? 600 : 400,background:showTest ? '#fef3c7' : 'transparent',border:showTest ? '1px solid #fde68a' : '1px solid var(--gray-200)',borderRadius:8,padding:'6px 12px',transition:'all 0.15s'}}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadOrders(user.center, e.target.checked) }} style={{accentColor:'#b45309',width:13,height:13}} />
                Test Mode
              </label>
            )}
          </div>

          {/* Summary */}
          <div className="od-stat-grid">
            <div className="od-stat-card od-stat-blue" onClick={() => setFilter('action')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Action Required</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.action}</div>
              <div className="od-stat-sub">needs FC action</div>
            </div>
            <div className="od-stat-card od-stat-amber" onClick={() => setFilter('waiting')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">With Accounts</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.waiting}</div>
              <div className="od-stat-sub">with billing team</div>
            </div>
            <div className="od-stat-card od-stat-teal" onClick={() => setFilter('all')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Total Active</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.action + counts.waiting}</div>
              <div className="od-stat-sub">in pipeline</div>
            </div>
            <div className="od-stat-card od-stat-green" onClick={() => setFilter('dispatched_fc')} style={{ cursor:'pointer' }}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Delivered</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.dispatched_fc}</div>
              <div className="od-stat-sub">dispatched FY 26-27</div>
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
                  className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'dispatched_fc' ? ' filter-chip-green' : '')}
                  onClick={() => setFilter(key)}>
                  {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="od-table-card">
            {loading ? (
              <div className="loading-state" style={{ padding:40 }}><div className="loading-spin" />Loading...</div>
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
                        <th>Items</th>
                        <th style={{ textAlign:'right' }}>Value</th>
                        <th style={{ textAlign:'right' }}>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(o => {
                        const activeBatch = (o.order_dispatches || []).sort((a, b) => b.batch_no - a.batch_no)[0]
                        const batchVal = activeBatch?.dispatched_items?.length
                          ? activeBatch.dispatched_items.reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0)
                          : (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                        const dcNum = activeBatch?.dc_number || o.dc_number
                        const isWaiting = WITH_ACCOUNTS.includes(o.status)
                        const isDelivered = o.status === 'dispatched_fc'
                        return (
                          <tr key={o.id} onClick={() => navigate('/fc/' + o.id, { state: { dispatch_id: activeBatch?.id } })}>
                            <td className="order-num-cell">
                              {o.order_number}
                              {o.order_type === 'SAMPLE' && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:3,padding:'1px 5px',letterSpacing:'0.5px',verticalAlign:'middle'}}>SAMPLE</span>}
                              {dcNum && <div style={{ fontSize:11, color: dcNum.startsWith('Temp/') ? '#92400e' : isDelivered ? '#166534' : 'var(--gray-500)', fontFamily:'var(--mono)', marginTop:2, fontWeight: isDelivered ? 600 : 400 }}>{dcNum}</div>}
                            </td>
                            <td className="customer-cell">{o.customer_name}</td>
                            <td>{o.fulfilment_center || '—'}</td>
                            <td>{fmt(o.order_date)}</td>
                            <td>{(activeBatch?.dispatched_items || o.order_items || []).length}</td>
                            <td className="amount-cell">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</td>
                            <td className="status-cell">
                              <span className={'pill pill-' + (isDelivered ? 'dispatched_fc' : isWaiting ? 'waiting' : o.status)}>{statusLabel(o.status)}</span>
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
                    const batchVal = activeBatch?.dispatched_items?.length
                      ? activeBatch.dispatched_items.reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0)
                      : (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                    const dcNum = activeBatch?.dc_number || o.dc_number
                    const isDelivered = o.status === 'dispatched_fc'
                    return (
                      <div key={o.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/fc/' + o.id, { state: { dispatch_id: activeBatch?.id } })}>
                        <div className="order-card-top">
                          <div>
                            <div className="order-num">
                              {o.order_number}
                              {o.order_type === 'SAMPLE' && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:3,padding:'1px 5px',letterSpacing:'0.5px',verticalAlign:'middle'}}>SAMPLE</span>}
                            </div>
                            {dcNum && <div style={{ fontSize:11, color: dcNum.startsWith('Temp/') ? '#92400e' : isDelivered ? '#166534' : 'var(--gray-500)', fontFamily:'var(--mono)', fontWeight: isDelivered ? 600 : 400 }}>{dcNum}</div>}
                            <div className="order-customer">{o.customer_name}</div>
                            <div className="order-date">{o.fulfilment_center || '—'} · {fmt(o.order_date)}</div>
                          </div>
                          <span className={'pill pill-' + (isDelivered ? 'dispatched_fc' : o.status)}>{statusLabel(o.status)}</span>
                        </div>
                        <div className="order-card-bottom">
                          <span className="order-items-count">{(o.order_items || []).length} items</span>
                          <span className="order-total">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</span>
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
