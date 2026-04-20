import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'

import '../styles/orders.css'

const WITH_ACCOUNTS = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']


function statusLabel(s) {
  return {
    pi_requested:       'Awaiting PI',
    pi_generated:       'PI Sent',
    pi_payment_pending: 'PI Payment Pending',
    delivery_created:   'Picking',
    picking:            'Packing',
    packing:            'Goods Issue',
    goods_issued:       'With Accounts',
    credit_check:       'Credit Check',
    goods_issue_posted: 'GI Posted',
    invoice_generated:  'Delivery Ready',
    delivery_ready:     'E-Way Pending',
    eway_generated:     'Ready to Deliver',
    dispatched_fc:      'Delivered',
  }[s] || s
}

// Effective status: treat null (newly created batch) as delivery_created
function effStatus(b) { return b.status || 'delivery_created' }

export default function FCModule() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '', center: '' })
  const [batches, setBatches] = useState([])
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
    await loadBatches(center)
  }

  async function loadBatches(center, testMode = false, silent) {
    if (!silent) setLoading(true)
    let q = sb.from('order_dispatches')
      .select('id, order_id, batch_no, dc_number, invoice_number, status, fulfilment_center, dispatched_items, created_at, orders!inner(id, order_number, customer_name, order_type, order_date, status, is_test, freight, order_items(id, qty, dispatched_qty))')
      .eq('orders.is_test', testMode)
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
      .limit(500)
    if (center) q = q.eq('fulfilment_center', center)
    q = q.not('status', 'in', '(pi_requested,pi_generated,pi_payment_pending)')
    const { data } = await q
    setBatches(data || [])
    setLoading(false)
  }

  const actionStatuses = ['delivery_created','picking','packing','invoice_generated','eway_generated']
  const waitStatuses   = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']

  function matchFilter(b) {
    const s = effStatus(b)
    if (filter === 'all')           return actionStatuses.includes(s) || waitStatuses.includes(s)
    if (filter === 'action')        return actionStatuses.includes(s)
    if (filter === 'waiting')       return waitStatuses.includes(s)
    if (filter === 'dispatched_fc') return s === 'dispatched_fc'
    return s === filter
  }

  const counts = {
    action:        batches.filter(b => actionStatuses.includes(effStatus(b))).length,
    waiting:       batches.filter(b => waitStatuses.includes(effStatus(b))).length,
    dispatched_fc: batches.filter(b => effStatus(b) === 'dispatched_fc').length,
  }

  const q = search.trim().toLowerCase()
  const filtered = batches.filter(matchFilter).filter(b =>
    !q ||
    b.orders?.customer_name?.toLowerCase().includes(q) ||
    b.orders?.order_number?.toLowerCase().includes(q) ||
    b.dc_number?.toLowerCase().includes(q)
  )

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
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadBatches(user.center, e.target.checked) }} style={{accentColor:'#b45309',width:13,height:13}} />
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
              <div className="od-stat-sub">dispatched {FY_LABEL}</div>
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
                placeholder="Search DC, order, customer..."
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
              {FILTERS.map(({ key, label }) => {
                const count = key === 'all' ? counts.action + counts.waiting : counts[key]
                return (
                  <button key={key}
                    className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'dispatched_fc' ? ' filter-chip-green' : '')}
                    onClick={() => setFilter(key)}>
                    {label}{count > 0 ? ` (${count})` : ''}
                  </button>
                )
              })}
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
                <div className="orders-empty-title">No batches here</div>
                <div className="orders-empty-sub">Nothing to action right now.</div>
              </div>
            ) : (
              <>
                <div className="orders-table-wrap" style={{ border:'none', borderRadius:0 }}>
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>DC #</th>
                        <th>Customer</th>
                        <th>Fulfilment Centre</th>
                        <th>Batch Date</th>
                        <th>Items</th>
                        <th style={{ textAlign:'right' }}>Value</th>
                        <th style={{ textAlign:'right' }}>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(b => {
                        const s = effStatus(b)
                        const isCancelled = b.orders?.status === 'cancelled'
                        const isWaiting   = WITH_ACCOUNTS.includes(s)
                        const isDelivered = s === 'dispatched_fc'
                        const isTempDC    = b.dc_number?.startsWith('Temp/')
                        const batchVal    = (b.dispatched_items || []).length
                          ? (b.dispatched_items).reduce((sum, i) => sum + (i.total_price || 0), 0)
                          : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
                        return (
                          <tr key={b.id} onClick={() => navigate('/fc/' + b.order_id, { state: { dispatch_id: b.id } })}>
                            <td className="order-num-cell">
                              <span style={{ fontFamily:'var(--mono)', fontWeight:700, color: isTempDC ? '#92400e' : isDelivered ? '#166534' : 'var(--gray-800)' }}>
                                {b.dc_number || '—'}
                              </span>
                              {b.batch_no > 1 && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:3,padding:'1px 5px',verticalAlign:'middle'}}>BATCH {b.batch_no}</span>}
                              <div style={{ fontSize:11, color:'var(--gray-400)', fontFamily:'var(--mono)', marginTop:2 }}>{b.orders?.order_number}</div>
                            </td>
                            <td className="customer-cell">{b.orders?.customer_name}</td>
                            <td>{b.orders?.fulfilment_center || '—'}</td>
                            <td>{fmt(b.created_at)}</td>
                            <td>{(b.dispatched_items || b.orders?.order_items || []).length}</td>
                            <td className="amount-cell">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</td>
                            <td className="status-cell">
                              <span className={'pill pill-' + (isCancelled ? 'cancelled' : isDelivered ? 'dispatched_fc' : isWaiting ? 'waiting' : s)}>{isCancelled ? 'Cancelled' : statusLabel(s)}</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding:'0 4px 4px' }}>
                  {filtered.map((b, i) => {
                    const s = effStatus(b)
                    const isCancelled = b.orders?.status === 'cancelled'
                    const isDelivered = s === 'dispatched_fc'
                    const isTempDC    = b.dc_number?.startsWith('Temp/')
                    const batchVal    = (b.dispatched_items || []).length
                      ? (b.dispatched_items).reduce((sum, i) => sum + (i.total_price || 0), 0)
                      : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
                    return (
                      <div key={b.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/fc/' + b.order_id, { state: { dispatch_id: b.id } })}>
                        <div className="order-card-top">
                          <div>
                            <div className="order-num" style={{ fontFamily:'var(--mono)', color: isCancelled ? '#be123c' : isTempDC ? '#92400e' : isDelivered ? '#166534' : 'var(--gray-800)' }}>
                              {b.dc_number || '—'}
                              {b.batch_no > 1 && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:3,padding:'1px 5px',verticalAlign:'middle'}}>BATCH {b.batch_no}</span>}
                            </div>
                            <div style={{ fontSize:11, color:'var(--gray-400)', fontFamily:'var(--mono)' }}>{b.orders?.order_number}</div>
                            <div className="order-customer">{b.orders?.customer_name}</div>
                            <div className="order-date">{b.orders?.fulfilment_center || '—'} · {fmt(b.created_at)}</div>
                          </div>
                          <span className={'pill pill-' + (isCancelled ? 'cancelled' : isDelivered ? 'dispatched_fc' : s)}>{isCancelled ? 'Cancelled' : statusLabel(s)}</span>
                        </div>
                        <div className="order-card-bottom">
                          <span className="order-items-count">{(b.dispatched_items || b.orders?.order_items || []).length} items</span>
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
