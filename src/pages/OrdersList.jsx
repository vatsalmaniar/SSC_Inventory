import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders.css'


function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear()
}

function statusLabel(s) {
  return {
    pending: 'Pending Approval', inv_check: 'Inv. Check', dispatch: 'Shipped',
    partial_dispatch: 'Partially Shipped', gen_invoice: 'Gen. Invoice',
    dispatched_fc: 'Dispatched', cancelled: 'Cancelled',
  }[s] || s
}

function isPartiallyDispatched(o) {
  const items = o.order_items || []
  return items.some(i => (i.dispatched_qty || 0) > 0) && items.some(i => i.qty > (i.dispatched_qty || 0))
}

function isPendingDelivery(o) {
  if (['dispatched_fc', 'cancelled'].includes(o.status)) return false
  const items = o.order_items || []
  if (items.length > 0 && items.every(i => (i.dispatched_qty || 0) >= i.qty)) return false
  return true
}

function totalValue(o) {
  return (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
}

function pendingValue(o) {
  return (o.order_items || []).reduce((s, i) => {
    const pendingQty = Math.max(0, i.qty - (i.dispatched_qty || 0))
    return s + pendingQty * (i.unit_price_after_disc || 0)
  }, 0) + (o.freight || 0)
}

function dispatchedValue(o) {
  return (o.order_items || []).reduce((s, i) => s + (i.unit_price_after_disc || 0) * (i.dispatched_qty || 0), 0)
}

// In All Orders: show full total. Dispatched filter: show dispatched value. Other filters: show pending value for partial orders
function displayValue(o, currentFilter) {
  if (currentFilter === 'dispatched' && isPartiallyDispatched(o)) return dispatchedValue(o)
  if (currentFilter !== 'all' && currentFilter !== 'dispatched' && isPartiallyDispatched(o)) return pendingValue(o)
  return totalValue(o)
}

function pillStatus(o) {
  if (isPartiallyDispatched(o)) return 'partial'
  if (o.status === 'partial_dispatch') return 'partial'
  return o.status
}

const FILTERS = [
  { key: 'all',        label: 'All Orders' },
  { key: 'undelivered',label: 'Pending' },
  { key: 'partial',    label: 'Partially Shipped' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'approval',   label: 'Pending for Approval' },
  { key: 'cancelled',  label: 'Cancelled' },
]

const TIMELINES = [
  { key: 'all',    label: 'All Time' },
  { key: 'today',  label: 'Today' },
  { key: 'week',   label: 'This Week' },
  { key: 'month',  label: 'This Month' },
  { key: 'year',   label: 'This Year' },
  { key: 'custom', label: 'Custom' },
]

function inTimeline(o, t, customFrom, customTo) {
  const d = new Date(o.order_date || o.created_at)
  d.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (t === 'all') return true
  if (t === 'today') return d.getTime() === now.getTime()
  if (t === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay())
    return d >= start
  }
  if (t === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (t === 'year')  return d.getFullYear() === now.getFullYear()
  if (t === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0,0,0,0); if (d < f) return false }
    if (customTo)   { const t2 = new Date(customTo);  t2.setHours(0,0,0,0); if (d > t2) return false }
    return true
  }
  return true
}

export default function OrdersList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [orders, setOrders]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]     = useState(location.state?.filter || 'all')
  const [timeline, setTimeline] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [search, setSearch]     = useState('')

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
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
    await loadOrders()
  }

  async function loadOrders() {
    setLoading(true)
    const { data } = await sb.from('orders').select('*, order_items(*)')
      .gte('created_at', '2026-03-31').eq('is_test', false)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  function matchFilter(o, f) {
    if (f === 'all')         return true
    if (f === 'undelivered') return isPendingDelivery(o)
    if (f === 'partial')     return isPartiallyDispatched(o)
    if (f === 'dispatched')  return o.status === 'dispatched_fc' || (o.order_items || []).some(i => (i.dispatched_qty || 0) > 0)
    if (f === 'approval')    return o.status === 'pending'
    if (f === 'cancelled')   return o.status === 'cancelled'
    return false
  }

  const timelineOrders = orders.filter(o => inTimeline(o, timeline, customFrom, customTo))

  const counts = FILTERS.reduce((acc, { key }) => {
    acc[key] = timelineOrders.filter(o => matchFilter(o, key)).length
    return acc
  }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineOrders
    .filter(o => matchFilter(o, filter))
    .filter(o => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q) || o.engineer_name?.toLowerCase().includes(q))

  const sumTotal = filtered.reduce((s, o) => s + displayValue(o, filter), 0)

  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'Orders'
  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || ''}–${customTo || ''}` : 'Custom')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fileName = `SSC_Orders_${activeFilterLabel}_${timelineLabel}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    const rows = filtered.map(o => {
      const partial = isPartiallyDispatched(o)
      const val     = displayValue(o, filter)
      return {
        'Order #':      o.order_number,
        'Customer':     o.customer_name,
        'Order Date':   fmt(o.order_date),
        'Account Owner':     o.engineer_name || '',
        'PO Number':    o.po_number || '',
        'Items':        (o.order_items || []).length,
        'Value (₹)':    val,
        'Value Type':   partial && filter !== 'all' ? 'Pending Value' : 'Total Value',
        'Status':       statusLabel(pillStatus(o) === 'partial' ? 'partial_dispatch' : o.status),
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Orders')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  function downloadDetailed() {
    const rows = []
    filtered.forEach(o => {
      const items = o.order_items || []
      if (items.length === 0) {
        rows.push({
          'Order #': o.order_number, 'Customer': o.customer_name,
          'Order Date': fmt(o.order_date), 'Account Owner': o.engineer_name || '',
          'PO Number': o.po_number || '', 'Status': statusLabel(pillStatus(o) === 'partial' ? 'partial_dispatch' : o.status),
          'Sr No': '', 'Item Code': '', 'Total Qty': '', 'Dispatched Qty': '',
          'Pending Qty': '', 'LP Price': '', 'Disc %': '', 'Unit Price': '',
          'Total Price': '', 'Dispatch Date': '', 'Cust. Ref No': '',
          'Freight (₹)': o.freight || 0, 'Order Total (₹)': totalValue(o),
        })
      } else {
        items.forEach((item, idx) => {
          const pending = Math.max(0, item.qty - (item.dispatched_qty || 0))
          rows.push({
            'Order #':        idx === 0 ? o.order_number : '',
            'Customer':       idx === 0 ? o.customer_name : '',
            'Order Date':     idx === 0 ? fmt(o.order_date) : '',
            'Account Owner':       idx === 0 ? (o.engineer_name || '') : '',
            'PO Number':      idx === 0 ? (o.po_number || '') : '',
            'Status':         idx === 0 ? statusLabel(pillStatus(o) === 'partial' ? 'partial_dispatch' : o.status) : '',
            'Sr No':          item.sr_no,
            'Item Code':      item.item_code,
            'Total Qty':      item.qty,
            'Dispatched Qty': item.dispatched_qty || 0,
            'Pending Qty':    pending,
            'LP Price':       item.lp_unit_price || 0,
            'Disc %':         item.discount_pct || 0,
            'Unit Price':     item.unit_price_after_disc || 0,
            'Total Price':    item.total_price || 0,
            'Dispatch Date':  item.dispatch_date ? fmt(item.dispatch_date) : '',
            'Cust. Ref No':   item.customer_ref_no || '',
            'Freight (₹)':    idx === items.length - 1 ? (o.freight || 0) : '',
            'Order Total (₹)':idx === items.length - 1 ? totalValue(o) : '',
          })
        })
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Orders Detailed')
    XLSX.writeFile(wb, fileName + '_Detailed.xlsx')
  }

  return (
    <Layout pageTitle="Orders List" pageKey="orders">
    <div className="od-list-page">
      <div className="od-list-body">

        {/* Header */}
        <div className="od-list-header">
          <div>
            <div className="od-list-title">Orders</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="od-download-group">
              <button className="od-download-btn" onClick={downloadSummary} title="Download summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Summary
              </button>
              <button className="od-download-btn" onClick={downloadDetailed} title="Download detailed Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Detailed
              </button>
            </div>
            {user.role !== 'ops' && (
              <button className="new-order-btn" onClick={() => navigate('/orders/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                New Order
              </button>
            )}
          </div>
        </div>

        {/* Summary tile */}
        <div className="od-summary-tile">
          <div className="od-summary-stat">
            <div className="od-summary-val">{filtered.length}</div>
            <div className="od-summary-label">{FILTERS.find(f => f.key === filter)?.label || 'Orders'}</div>
          </div>
          <div className="od-summary-divider" />
          <div className="od-summary-stat">
            <div className="od-summary-val">₹{sumTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
            <div className="od-summary-label">Total Value</div>
          </div>
          <div className="od-summary-divider" />
          <div className="od-summary-stat">
            <div className="od-summary-val">{counts.approval}</div>
            <div className="od-summary-label">Pending Approval</div>
          </div>
          <div className="od-summary-divider" />
          <div className="od-summary-stat">
            <div className="od-summary-val">{counts.partial}</div>
            <div className="od-summary-label">Partially Shipped</div>
          </div>
        </div>

        {/* Timeline filter */}
        <div className="od-timeline-bar">
          {TIMELINES.map(({ key, label }) => (
            <button
              key={key}
              className={'od-timeline-btn' + (timeline === key ? ' active' : '')}
              onClick={() => setTimeline(key)}
            >
              {label}
            </button>
          ))}
          {timeline === 'custom' && (
            <div className="od-custom-range">
              <span className="od-range-label">From</span>
              <input type="date" className="od-range-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              <span className="od-range-label">To</span>
              <input type="date" className="od-range-input" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)} />
              {(customFrom || customTo) && (
                <button className="od-range-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }}>Clear</button>
              )}
            </div>
          )}
        </div>

        {/* Search + Filter bar */}
        <div className="od-list-controls">
          <div className="od-search-wrap">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="od-search-input"
              placeholder="Search order, customer, engineer..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="od-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          <div className="filter-bar" style={{ margin: 0, padding: 0 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'partial' || key === 'approval' ? ' filter-chip-warn' : '') + (key === 'cancelled' ? ' filter-chip-danger' : '')}
                onClick={() => setFilter(key)}
              >
                {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="od-table-card">
          {loading ? (
            <div className="loading-state" style={{ padding: 40 }}><div className="loading-spin" />Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="orders-empty" style={{ border: 'none' }}>
              <div className="orders-empty-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/>
                </svg>
              </div>
              <div className="orders-empty-title">No orders found</div>
              <div className="orders-empty-sub">{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="orders-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Order #</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Account Owner</th>
                      <th>Items</th>
                      <th style={{ textAlign: 'right' }}>Value (₹)</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(o => {
                      const partial    = isPartiallyDispatched(o)
                      const pendingQty = (o.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)
                      const val        = displayValue(o, filter)
                      const ps         = pillStatus(o)
                      return (
                        <tr key={o.id} onClick={() => navigate('/orders/' + o.id)}>
                          <td className="order-num-cell">{o.order_number}</td>
                          <td className="customer-cell">{o.customer_name}</td>
                          <td>{fmt(o.order_date)}</td>
                          <td>{o.engineer_name || '—'}</td>
                          <td>
                            {(o.order_items || []).length}
                            {partial && filter !== 'dispatched' && <span style={{ marginLeft: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>{pendingQty} pending</span>}
                          </td>
                          <td className="amount-cell">
                            {val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            {partial && filter !== 'all' && filter !== 'dispatched' && <span style={{ display: 'block', fontSize: 10, color: '#92400e', fontWeight: 600 }}>pending value</span>}
                          </td>
                          <td className="status-cell">
                            <span className={'pill pill-' + ps}>{statusLabel(ps === 'partial' ? 'partial_dispatch' : o.status)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div style={{ padding: '0 4px 4px' }}>
                {filtered.map((o, i) => {
                  const partial    = isPartiallyDispatched(o)
                  const pendingQty = (o.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)
                  const val        = displayValue(o, filter)
                  const ps         = pillStatus(o)
                  return (
                    <div key={o.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/orders/' + o.id)}>
                      <div className="order-card-top">
                        <div>
                          <div className="order-num">{o.order_number}</div>
                          <div className="order-customer">{o.customer_name}</div>
                          <div className="order-date">{fmt(o.order_date)} · {o.engineer_name || '—'}</div>
                        </div>
                        <span className={'pill pill-' + ps}>{statusLabel(ps === 'partial' ? 'partial_dispatch' : o.status)}</span>
                      </div>
                      <div className="order-card-bottom">
                        <span className="order-items-count">
                          {(o.order_items || []).length} item{(o.order_items || []).length !== 1 ? 's' : ''}
                          {partial && filter !== 'dispatched' && <span style={{ marginLeft: 6, color: '#92400e', fontWeight: 600 }}>{pendingQty} pending</span>}
                        </span>
                        <span className="order-total">
                          ₹{val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          {partial && filter !== 'dispatched' && <span style={{ fontSize: 10, color: '#92400e', fontWeight: 600, marginLeft: 4 }}>pending</span>}
                        </span>
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
