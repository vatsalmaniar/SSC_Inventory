import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const REP_PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?' }
function OwnerChip({ name }) {
  if (!name) return <span style={{color:'var(--o-muted-2)'}}>—</span>
  return (
    <div className="ol-owner" title={name}>
      <div className="ol-owner-avatar" style={{background: ownerColor(name)}}>{initials(name)}</div>
      <span className="ol-owner-name">{name}</span>
    </div>
  )
}

const STATUS_COLORS = {
  pending:            '#F59E0B', // amber
  inv_check:          '#1E54B7', // SSC blue
  inventory_check:    '#0EA5E9', // sky
  dispatch:           '#06B6D4', // cyan
  partial:            '#C2410C', partial_dispatch: '#C2410C', // deep orange
  delivery_created:   '#0F766E', // teal
  picking:            '#14B8A6', // light teal
  packing:            '#0D9488', // mid teal
  pi_requested:       '#B45309', // dark amber
  pi_generated:       '#92400E', // deeper amber
  pi_payment_pending: '#78350F', // brown
  goods_issued:       '#D97706', // orange
  pending_billing:    '#EAB308', // yellow
  credit_check:       '#65A30D', // olive
  goods_issue_posted: '#16A34A', // green
  invoice_generated:  '#059669', // emerald
  delivery_ready:     '#15803D', // forest
  eway_pending:       '#84CC16', // lime
  eway_generated:     '#22C55E', // bright green
  dispatched_fc:      '#047857', // deep emerald
  cancelled:          '#EF4444', // red
}
function statusColor(s) { return STATUS_COLORS[s] || '#94A3B8' }

function statusLabel(s) {
  return {
    pending:'Pending Approval',
    inv_check:'Order Approved', inventory_check:'Inventory Check',
    dispatch:'Ready to Ship', partial_dispatch:'Partially Shipped',
    gen_invoice:'Delivery Created', delivery_created:'Delivery Created',
    picking:'Picking', packing:'Packing',
    pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
    goods_issued:'Goods Issued', pending_billing:'Pending Billing', credit_check:'Credit Check',
    goods_issue_posted:'GI Posted', invoice_generated:'Invoice Generated',
    delivery_ready:'Delivery Ready', eway_pending:'E-Way Pending', eway_generated:'E-Way Generated',
    dispatched_fc:'Delivered', cancelled:'Cancelled',
  }[s] || s
}

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

function isPartiallyDispatched(o) {
  const items = o.order_items || []
  return items.some(i => (i.dispatched_qty || 0) > 0) && items.some(i => i.qty > (i.dispatched_qty || 0))
}

const FC_ACTIVE_STATUSES = ['delivery_created','picking','packing','pi_requested','pi_generated','pi_payment_pending','goods_issued','pending_billing','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_pending','eway_generated']

function isPendingDelivery(o) {
  if (['dispatched_fc','cancelled'].includes(o.status)) return false
  if (o.status === 'partial_dispatch') return true
  if (FC_ACTIVE_STATUSES.includes(o.status)) return false
  const items = o.order_items || []
  if (items.length > 0 && items.every(i => (i.dispatched_qty || 0) >= i.qty)) return false
  return true
}
function isInFCFlow(o) { return FC_ACTIVE_STATUSES.includes(o.status) }
function totalValue(o) { return (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0) }
function pendingValue(o) {
  return (o.order_items || []).reduce((s, i) => {
    const pq = Math.max(0, i.qty - (i.dispatched_qty || 0))
    return s + pq * (i.unit_price_after_disc || 0)
  }, 0) + (o.freight || 0)
}
function pillStatus(o) {
  if (isPartiallyDispatched(o)) return 'partial'
  if (o.status === 'partial_dispatch') return 'partial'
  return o.status
}

const FILTERS = [
  { key: 'all',         label: 'All' },
  { key: 'undelivered', label: 'Pending' },
  { key: 'partial',     label: 'Partial', tone: 'warn' },
  { key: 'inflow',      label: 'In Progress' },
  { key: 'dispatched',  label: 'Delivered' },
  { key: 'sample',      label: 'Samples' },
  { key: 'approval',    label: 'Approval', tone: 'warn' },
  { key: 'cancelled',   label: 'Cancelled', tone: 'danger' },
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
  if (dateMode === 'delivered_at') {
    const dates = (o.order_dispatches || []).map(b => b.delivered_at).filter(Boolean).sort()
    dateStr = dates[0] || null
    if (!dateStr) return false
  } else if (dateMode === 'delivery') {
    const dates = (o.order_items || []).map(i => i.dispatch_date).filter(Boolean).sort()
    dateStr = dates[0] || null
    if (!dateStr) return false
  } else {
    dateStr = o.order_date || o.created_at
  }
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  if (t === 'all') return true
  if (t === 'today') return d.getTime() === now.getTime()
  if (t === 'week') { const start = new Date(now); start.setDate(now.getDate() - now.getDay()); return d >= start }
  if (t === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (t === 'year')  return d.getFullYear() === now.getFullYear()
  if (t === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0,0,0,0); if (d < f) return false }
    if (customTo)   { const t2 = new Date(customTo); t2.setHours(0,0,0,0); if (d > t2) return false }
    return true
  }
  return true
}

export default function OrdersList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(location.state?.filter || 'all')
  const [timeline, setTimeline] = useState(location.state?.timeline || 'all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [dateMode, setDateMode] = useState(location.state?.dateMode || 'order')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showTest, setShowTest] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUser({ name: profile?.name || '', role, id: session.user.id })
    await loadOrders(role === 'demo', role === 'sales' ? session.user.id : null)
  }

  async function loadOrders(testMode = false, salesUserId = null) {
    setLoading(true)
    let q = sb.from('orders')
      .select('id,order_number,customer_name,customer_gst,account_owner,engineer_name,order_date,order_type,status,freight,credit_terms,po_number,dispatch_address,received_via,notes,credit_override,created_at,order_items(id,sr_no,item_code,qty,dispatched_qty,lp_unit_price,discount_pct,unit_price_after_disc,total_price,dispatch_date,customer_ref_no),order_dispatches(id,batch_no,invoice_number,dc_number,eway_bill_number,dispatched_items,delivered_at,status)')
      .gte('created_at', FY_START).eq('is_test', testMode)
      .order('created_at', { ascending: false })
    if (salesUserId) q = q.eq('created_by', salesUserId)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  function matchFilter(o, f) {
    if (f === 'all') return true
    if (f === 'undelivered') return isPendingDelivery(o)
    if (f === 'partial') return isPartiallyDispatched(o) || o.status === 'partial_dispatch'
    if (f === 'inflow') return isInFCFlow(o)
    if (f === 'dispatched') return o.status !== 'cancelled' && (o.status === 'dispatched_fc' || (o.order_dispatches || []).some(b => b.status === 'dispatched_fc'))
    if (f === 'sample') return o.order_type === 'SAMPLE'
    if (f === 'approval') return o.status === 'pending'
    if (f === 'cancelled') return o.status === 'cancelled'
    return false
  }

  const timelineOrders = orders.filter(o => inTimeline(o, timeline, customFrom, customTo, dateMode))
  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = timelineOrders.filter(o => matchFilter(o, key)).length; return acc }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineOrders
    .filter(o => matchFilter(o, filter))
    .filter(o => !q || o.customer_name?.toLowerCase().includes(q) || o.order_number?.toLowerCase().includes(q) || o.engineer_name?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const sumTotal = filtered.filter(o => o.status !== 'cancelled').reduce((s, o) => s + totalValue(o), 0)
  const sumPending = filtered.filter(o => o.status !== 'cancelled').reduce((s, o) => s + pendingValue(o), 0)

  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'Orders'
  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || ''}–${customTo || ''}` : 'Custom')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fileName = `SSC_Orders_${activeFilterLabel}_${timelineLabel}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    const rows = filtered.map(o => {
      const partial = isPartiallyDispatched(o)
      return {
        'Order #': o.order_number,
        'Customer': o.customer_name,
        'Order Date': fmt(o.order_date),
        'Account Owner': o.engineer_name || '',
        'PO Number': o.po_number || '',
        'Items': (o.order_items || []).length,
        'Value (₹)': totalValue(o),
        'Pending (₹)': pendingValue(o),
        'Status': statusLabel(pillStatus(o) === 'partial' ? 'partial_dispatch' : o.status),
      }
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Orders')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  async function downloadDetailed() {
    if (!filtered.length) { alert('No orders to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    const uniqueNames = [...new Set(filtered.map(o => o.customer_name).filter(Boolean))]
    const custIdMap = {}
    if (uniqueNames.length) {
      const { data } = await sb.from('customers').select('customer_id,customer_name').in('customer_name', uniqueNames)
      ;(data || []).forEach(c => { custIdMap[c.customer_name] = c.customer_id || '' })
    }
    try {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'SSC ERP'; wb.created = new Date()
    const ws = wb.addWorksheet('Orders Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
    const cols = [
      { header: 'Sr No', key: 'sr_no', width: 6 },
      { header: 'Order Date', key: 'order_date', width: 12 },
      { header: 'Order No', key: 'order_number', width: 22 },
      { header: 'Cust ID', key: 'cust_id', width: 10 },
      { header: 'Customer Name', key: 'customer_name', width: 32 },
      { header: 'Owner', key: 'owner', width: 18 },
      { header: 'Item', key: 'item_code', width: 26 },
      { header: 'Total Qty', key: 'total_qty', width: 10 },
      { header: 'Pending Qty', key: 'pending_qty', width: 11 },
      { header: 'Total Value', key: 'total_value', width: 14, style: { numFmt: '₹#,##,##0.00' } },
      { header: 'Pending Value', key: 'pending_value', width: 14, style: { numFmt: '₹#,##,##0.00' } },
      { header: 'Delivery Date', key: 'delivery_date', width: 13 },
      { header: 'Delivered Date', key: 'delivered_date', width: 13 },
      { header: 'Status', key: 'status', width: 18 },
    ]
    ws.columns = cols
    const statusStyle = (s) => {
      switch (s) {
        case 'pending': case 'pending_approval': return { bg: 'FFFEF9C3', fg: 'FF854D0E' }
        case 'partial_dispatch': return { bg: 'FFFFF7ED', fg: 'FFC2410C' }
        case 'inv_check': case 'inventory_check': case 'dispatch': return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
        case 'delivery_created': return { bg: 'FFDCFCE7', fg: 'FF166534' }
        case 'picking': case 'packing': return { bg: 'FFE0E7FF', fg: 'FF3730A3' }
        case 'goods_issued': case 'credit_check': case 'goods_issue_posted':
        case 'invoice_generated': case 'pending_billing': return { bg: 'FFFEF3C7', fg: 'FF92400E' }
        case 'delivery_ready': case 'eway_pending': case 'eway_generated': return { bg: 'FFD1FAE5', fg: 'FF065F46' }
        case 'dispatched_fc': return { bg: 'FFBBF7D0', fg: 'FF14532D' }
        case 'cancelled': return { bg: 'FFFEE2E2', fg: 'FFB91C1C' }
        default: return { bg: 'FFF1F5F9', fg: 'FF334155' }
      }
    }
    filtered.forEach(o => {
      const items = o.order_items || []
      const dispatches = o.order_dispatches || []
      const deliveredAt = dispatches.find(d => d.delivered_at)?.delivered_at
      const psKey = pillStatus(o) === 'partial' ? 'partial_dispatch' : o.status
      const sStyle = statusStyle(psKey)
      const baseRow = {
        order_date: o.order_date ? fmt(o.order_date) : '',
        order_number: o.order_number,
        cust_id: custIdMap[o.customer_name] || '',
        customer_name: o.customer_name,
        owner: o.engineer_name || o.account_owner || '',
        delivered_date: deliveredAt ? fmt(deliveredAt) : '',
        status: statusLabel(psKey),
      }
      const pushRow = (data) => {
        const row = ws.addRow(data)
        const sCell = row.getCell('status')
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
        sCell.font = { bold: true, color: { argb: sStyle.fg } }
        sCell.alignment = { horizontal: 'center', vertical: 'middle' }
        if ((data.pending_qty || 0) > 0) {
          const pq = row.getCell('pending_qty')
          pq.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
          pq.font = { bold: true, color: { argb: 'FF92400E' } }
          const pv = row.getCell('pending_value')
          pv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
          pv.font = { bold: true, color: { argb: 'FF92400E' } }
        }
      }
      if (items.length === 0) {
        pushRow({ ...baseRow, sr_no:'', item_code:'', total_qty:'', pending_qty:'', total_value:'', pending_value:'', delivery_date:'' })
      } else {
        items.forEach(item => {
          const pendingQty = Math.max(0, item.qty - (item.dispatched_qty || 0))
          const pendingValueLocal = pendingQty * (item.unit_price_after_disc || 0)
          pushRow({
            ...baseRow,
            sr_no: item.sr_no, item_code: item.item_code,
            total_qty: item.qty, pending_qty: pendingQty,
            total_value: item.total_price || 0, pending_value: pendingValueLocal,
            delivery_date: item.dispatch_date ? fmt(item.dispatch_date) : '',
          })
        })
      }
    })
    const header = ws.getRow(1)
    header.height = 24
    header.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2540' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF143055' } } }
    })
    const lastRow = ws.rowCount
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r)
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
      })
      if (r % 2 === 0) {
        row.eachCell({ includeEmpty: true }, cell => {
          const isTinted = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor?.argb !== 'FFFFFFFF'
          if (!isTinted) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
        })
      }
    }
    ws.autoFilter = { from: { row:1, column:1 }, to: { row:1, column: cols.length } }
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = fileName + '_Detailed.xlsx'
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  return (
    <Layout pageTitle="Orders List" pageKey="orders">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Orders</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> {activeFilterLabel.toLowerCase()}</span>
              <span className="o-sep">·</span>
              <span><b>{fmtCr(sumTotal)}</b> total value</span>
              {sumPending > 0 && (<><span className="o-sep">·</span><span style={{color:'#B45309'}}><b style={{color:'#B45309'}}>{fmtCr(sumPending)}</b> pending</span></>)}
            </div>
          </div>
          <div className="page-meta">
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadOrders(e.target.checked, null) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSummary} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Summary
              </button>
              <button className="o-dl-btn" onClick={downloadDetailed} title="Detailed Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Detailed
              </button>
            </div>
            {user.role !== 'ops' && (
              <button className="btn-primary" onClick={() => navigate('/orders/new')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Order
              </button>
            )}
          </div>
        </div>

        {/* KPI tiles */}
        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label={activeFilterLabel} value={filtered.length} sub="matching orders" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Total Value" value={fmtCr(sumTotal)} sub="filtered total" chart="bars"/>
          <KpiTile variant="hero" tone="teal" label="Pending Value" value={fmtCr(sumPending)} sub="awaiting delivery" chart="bars"/>
          <KpiTile label="Pending Approval" value={counts.approval || 0} sub="awaiting approval" accent={(counts.approval || 0) > 0 ? 'amber' : null} onClick={() => { setFilter('approval'); setPage(1) }}/>
          <KpiTile label="Partially Shipped" value={counts.partial || 0} sub="partial deliveries" onClick={() => { setFilter('partial'); setPage(1) }}/>
        </div>

        {/* Timeline + date mode */}
        <div className="o-timeline">
          {TIMELINES.map(({ key, label }) => (
            <button key={key} className={timeline === key ? 'on' : ''} onClick={() => { setTimeline(key); setPage(1) }}>{label}</button>
          ))}
          {timeline === 'custom' && (
            <div className="o-timeline-custom">
              <span>From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}/>
              <span>To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)}/>
              {(customFrom || customTo) && <button className="o-search-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }} style={{ marginLeft: 6, fontSize: 11, color: 'var(--o-bad)' }}>Clear</button>}
            </div>
          )}
        </div>

        {/* Toolbar: search + date mode */}
        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search order, customer, owner…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="o-datemode">
            <button className={dateMode === 'order' ? 'on' : ''} onClick={() => { setDateMode('order'); setPage(1) }}>Order Date</button>
            <button className={dateMode === 'delivery' ? 'on' : ''} onClick={() => { setDateMode('delivery'); setPage(1) }}>Delivery Date</button>
            <button className={dateMode === 'delivered_at' ? 'on' : ''} onClick={() => { setDateMode('delivered_at'); setPage(1) }}>Delivered On</button>
          </div>
        </div>

        {/* Filter chips */}
        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => { setFilter(key); setPage(1) }}>
              {label}
              {counts[key] > 0 && <span className="o-chip-n">{counts[key]}</span>}
            </button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div className="o-loading">Loading orders…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head">
              <div>Order #</div>
              <div>Customer</div>
              <div>Order Date</div>
              <div>{['dispatched','partial'].includes(filter) ? 'Delivered On' : 'Delivery Date'}</div>
              <div>Owner</div>
              <div className="ol-numgroup">
                <div className="num num-label" style={{ textAlign:'right' }}>Items</div>
                <div className="num num-label" style={{ textAlign:'right' }}>Value</div>
                <div className="num num-label" style={{ textAlign:'right' }}>Pending</div>
              </div>
              <div className="num">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No orders found</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{search ? 'Try a different search term.' : 'Nothing matches the selected filters.'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(o => {
                  const orderTotal = totalValue(o)
                  const pendingVal = pendingValue(o)
                  const ps = pillStatus(o)
                  const dates = (o.order_items || []).map(i => i.dispatch_date).filter(Boolean).sort()
                  const deliveryDate = dates.length > 0 ? dates[0] : null
                  const multiDate = dates.length > 1 && dates[dates.length - 1] !== dates[0]
                  const deliveredBatches = (o.order_dispatches || []).filter(b => b.status === 'dispatched_fc' && b.delivered_at)
                  const latestDeliveredAt = deliveredBatches.length > 0
                    ? deliveredBatches.sort((a,b) => b.delivered_at.localeCompare(a.delivered_at))[0].delivered_at
                    : null
                  return (
                    <div key={o.id} className="ol-row ol-data" onClick={() => navigate('/orders/' + o.id)}>
                      <div className="ol-cell">
                        <div className="ol-num">{o.order_number}</div>
                        {o.order_type === 'SAMPLE' && <span className="ol-sample-tag">Sample</span>}
                      </div>
                      <div className="ol-cell ol-cust" title={o.customer_name}>{o.customer_name}</div>
                      <div className="ol-cell ol-date">{fmt(o.order_date)}</div>
                      <div className="ol-cell">
                        {latestDeliveredAt ? (
                          <div className="ol-date delivered">{fmt(latestDeliveredAt)}</div>
                        ) : deliveryDate ? (
                          <>
                            <div className="ol-date">{fmt(deliveryDate)}</div>
                            {multiDate && <div className="ol-date-sub">to {fmt(dates[dates.length - 1])}</div>}
                          </>
                        ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                      </div>
                      <div className="ol-cell"><OwnerChip name={o.account_owner || o.engineer_name}/></div>
                      <div className="ol-numgroup">
                        <div className="ol-items">{(o.order_items || []).length}</div>
                        <div className="ol-val">₹{orderTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                        <div className={`ol-pending ${pendingVal > 0 ? 'has' : ''}`}>{pendingVal > 0 ? '₹' + pendingVal.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—'}</div>
                      </div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': statusColor(ps) }}>
                          <span className="ol-status-dot"/>
                          {statusLabel(ps === 'partial' ? 'partial_dispatch' : o.status)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 4px', color:'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {onClick && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">{sub && <div className="kt-sub mono">{sub}</div>}</div>
    </div>
  )
}
function KpiChart({ kind }) {
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
        <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
      ))}
    </svg>
  )
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}
