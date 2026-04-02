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
    pending:            'Pending Approval',
    inv_check:          'Inv. Check',
    inventory_check:    'Inventory Check',
    dispatch:           'Ready to Ship',
    partial_dispatch:   'Partially Shipped',
    gen_invoice:        'Delivery Created',
    delivery_created:   'Delivery Created',
    picking:            'Picking',
    packing:            'Packing',
    goods_issued:       'Goods Issued',
    pending_billing:    'Pending Billing',
    credit_check:       'Credit Check',
    goods_issue_posted: 'GI Posted',
    invoice_generated:  'Invoice Generated',
    delivery_ready:     'Delivery Ready',
    eway_pending:       'E-Way Pending',
    eway_generated:     'E-Way Generated',
    dispatched_fc:      'Delivered',
    cancelled:          'Cancelled',
  }[s] || s
}

function isPartiallyDispatched(o) {
  const items = o.order_items || []
  return items.some(i => (i.dispatched_qty || 0) > 0) && items.some(i => i.qty > (i.dispatched_qty || 0))
}

const FC_ACTIVE_STATUSES = ['delivery_created','picking','packing','goods_issued','pending_billing','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_pending','eway_generated']

function isPendingDelivery(o) {
  if (['dispatched_fc', 'cancelled'].includes(o.status)) return false
  if (FC_ACTIVE_STATUSES.includes(o.status)) return false
  const items = o.order_items || []
  if (items.length > 0 && items.every(i => (i.dispatched_qty || 0) >= i.qty)) return false
  return true
}

function isInFCFlow(o) {
  return FC_ACTIVE_STATUSES.includes(o.status)
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

// Sum of all dispatched batch values — prefer confirmed INV batches, fall back to any batch with dispatched_items
function confirmedDispatchedValue(o) {
  const allBatches = (o.order_dispatches || [])
  const confirmedBatches = allBatches.filter(b => b.invoice_number && !b.invoice_number.startsWith('Temp/'))
  const batchesToUse = confirmedBatches.length > 0 ? confirmedBatches : allBatches
  const batchTotal = batchesToUse.reduce((sum, b) =>
    sum + (b.dispatched_items || []).reduce((s, i) => s + (i.total_price || (i.unit_price * i.qty) || 0), 0), 0)
  if (batchTotal > 0) return batchTotal
  return dispatchedValue(o)
}

// Delivered filter: show confirmed dispatched value; all other filters: show pending for partial orders
function displayValue(o, currentFilter) {
  const hasDelivery = (o.order_dispatches || []).some(b => b.invoice_number && !b.invoice_number.startsWith('Temp/'))
  if (currentFilter === 'dispatched' || o.status === 'dispatched_fc') {
    return confirmedDispatchedValue(o) || totalValue(o)
  }
  if (isPartiallyDispatched(o) || hasDelivery) return pendingValue(o)
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
  { key: 'inflow',     label: 'In Progress (FC/Sales)' },
  { key: 'dispatched', label: 'Delivered' },
  { key: 'approval',   label: 'Pending Approval' },
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

function inTimeline(o, t, customFrom, customTo, dateMode) {
  let dateStr
  if (dateMode === 'delivery') {
    const dates = (o.order_items || []).map(i => i.dispatch_date).filter(Boolean).sort()
    dateStr = dates[0] || null
    if (!dateStr) return false
  } else {
    dateStr = o.order_date || o.created_at
  }
  const d = new Date(dateStr)
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
  const [dateMode, setDateMode]     = useState('order') // 'order' | 'delivery'
  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)

  const PAGE_SIZE = 50

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
    const { data } = await sb.from('orders').select('*, order_items(*), order_dispatches(*)')
      .gte('created_at', '2026-03-31').eq('is_test', false)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  // Has at least one confirmed (non-Temp) INV in order_dispatches — billing is complete for that batch
  function hasConfirmedDelivery(o) {
    return (o.order_dispatches || []).some(b => b.invoice_number && !b.invoice_number.startsWith('Temp/'))
  }

  function matchFilter(o, f) {
    if (f === 'all')         return true
    if (f === 'undelivered') return isPendingDelivery(o)
    if (f === 'partial')     return isPartiallyDispatched(o)
    if (f === 'inflow')      return isInFCFlow(o)
    if (f === 'dispatched')  return o.status === 'dispatched_fc' || hasConfirmedDelivery(o)
    if (f === 'approval')    return o.status === 'pending'
    if (f === 'cancelled')   return o.status === 'cancelled'
    return false
  }

  const timelineOrders = orders.filter(o => inTimeline(o, timeline, customFrom, customTo, dateMode))

  const counts = FILTERS.reduce((acc, { key }) => {
    acc[key] = timelineOrders.filter(o => matchFilter(o, key)).length
    return acc
  }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineOrders
    .filter(o => matchFilter(o, filter))
    .filter(o => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q) || o.engineer_name?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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
        'Value Type':   partial ? (filter === 'dispatched' ? 'Dispatched Value' : 'Pending Value') : 'Total Value',
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

        <div className="od-timeline-bar">
          {TIMELINES.map(({ key, label }) => (
            <button
              key={key}
              className={'od-timeline-btn' + (timeline === key ? ' active' : '')}
              onClick={() => { setTimeline(key); setPage(1) }}
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
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%' }}>
          <div className="od-search-wrap">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              className="od-search-input"
              placeholder="Search order, customer, engineer..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button className="od-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          <div style={{ display:'flex', borderRadius:8, border:'1px solid var(--gray-200)', overflow:'hidden', background:'#f9fafb', flexShrink:0 }}>
            <button onClick={() => { setDateMode('order'); setPage(1) }}
              style={{ padding:'6px 12px', fontSize:12, fontWeight: dateMode === 'order' ? 700 : 400, background: dateMode === 'order' ? 'white' : 'transparent', color: dateMode === 'order' ? 'var(--gray-900)' : 'var(--gray-500)', border:'none', cursor:'pointer', fontFamily:'var(--font)', boxShadow: dateMode === 'order' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', margin: dateMode === 'order' ? 2 : 0, borderRadius: dateMode === 'order' ? 6 : 0 }}
            >Order Date</button>
            <button onClick={() => { setDateMode('delivery'); setPage(1) }}
              style={{ padding:'6px 12px', fontSize:12, fontWeight: dateMode === 'delivery' ? 700 : 400, background: dateMode === 'delivery' ? 'white' : 'transparent', color: dateMode === 'delivery' ? 'var(--gray-900)' : 'var(--gray-500)', border:'none', cursor:'pointer', fontFamily:'var(--font)', boxShadow: dateMode === 'delivery' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', margin: dateMode === 'delivery' ? 2 : 0, borderRadius: dateMode === 'delivery' ? 6 : 0 }}
            >Delivery Date</button>
          </div>
          </div>
          <div className="filter-bar" style={{ margin: 0, padding: 0 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'partial' || key === 'approval' ? ' filter-chip-warn' : '') + (key === 'cancelled' ? ' filter-chip-danger' : '')}
                onClick={() => { setFilter(key); setPage(1) }}
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
                      <th>Order Date</th>
                      <th>Delivery Date</th>
                      <th>Account Owner</th>
                      <th>Items</th>
                      <th style={{ textAlign: 'right' }}>Value (₹)</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(o => {
                      const partial    = isPartiallyDispatched(o)
                      const pendingQty = (o.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)
                      const val        = displayValue(o, filter)
                      const ps         = pillStatus(o)
                      const dates      = (o.order_items || []).map(i => i.dispatch_date).filter(Boolean).sort()
                      const deliveryDate = dates.length > 0 ? dates[0] : null
                      const multiDate    = dates.length > 1 && dates[dates.length - 1] !== dates[0]
                      return (
                        <tr key={o.id} className={isInFCFlow(o) ? 'row-delivery' : ''} onClick={() => navigate('/orders/' + o.id)}>
                          <td className="order-num-cell">{o.order_number}</td>
                          <td className="customer-cell">{o.customer_name}</td>
                          <td>{fmt(o.order_date)}</td>
                          <td>
                            {deliveryDate ? fmt(deliveryDate) : '—'}
                            {multiDate && <span style={{ display:'block', fontSize:10, color:'var(--gray-400)' }}>to {fmt(dates[dates.length - 1])}</span>}
                          </td>
                          <td>{o.engineer_name || '—'}</td>
                          <td>{(o.order_items || []).length}</td>
                          <td className="amount-cell">{val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
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
                {paginated.map((o, i) => {
                  const partial    = isPartiallyDispatched(o)
                  const pendingQty = (o.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)
                  const val        = displayValue(o, filter)
                  const ps         = pillStatus(o)
                  const mdates     = (o.order_items || []).map(i => i.dispatch_date).filter(Boolean).sort()
                  const mDelivery  = mdates.length > 0 ? fmt(mdates[0]) : null
                  return (
                    <div key={o.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/orders/' + o.id)}>
                      <div className="order-card-top">
                        <div>
                          <div className="order-num">{o.order_number}</div>
                          <div className="order-customer">{o.customer_name}</div>
                          <div className="order-date">{fmt(o.order_date)} · {o.engineer_name || '—'}</div>
                          {mDelivery && <div className="order-date" style={{ color:'var(--gray-500)' }}>Delivery: {mDelivery}</div>}
                        </div>
                        <span className={'pill pill-' + ps}>{statusLabel(ps === 'partial' ? 'partial_dispatch' : o.status)}</span>
                      </div>
                      <div className="order-card-bottom">
                        <span className="order-items-count">
                          {(o.order_items || []).length} item{(o.order_items || []).length !== 1 ? 's' : ''}
                        </span>
                        <span className="order-total">₹{val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--gray-100)', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                  Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} orders
                </span>
                <div style={{ display:'flex', gap:4 }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === 1 ? 'default' : 'pointer', color: safePage === 1 ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}
                  >‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return (
                      <button key={p} onClick={() => setPage(p)}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor: p === safePage ? '#2563eb' : 'var(--gray-200)', background: p === safePage ? '#2563eb' : 'white', color: p === safePage ? 'white' : 'var(--gray-700)', fontWeight: p === safePage ? 700 : 400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}
                      >{p}</button>
                    )
                    if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 2px', color:'var(--gray-400)', fontSize:13, lineHeight:'28px' }}>…</span>
                    return null
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === totalPages ? 'default' : 'pointer', color: safePage === totalPages ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}
                  >Next ›</button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
    </Layout>
  )
}
