export const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Financial year start — auto-computed, never needs manual update
// FY runs Apr 1 → Mar 31. If today is Jan-Mar, FY started last year's April.
const _now = new Date()
const _fyYear = _now.getMonth() >= 3 ? _now.getFullYear() : _now.getFullYear() - 1
export const FY_START = `${_fyYear}-04-01`
export const FY_LABEL = `FY ${String(_fyYear).slice(2)}-${String(_fyYear + 1).slice(2)}`

// 5 Mar 2026
export function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()] + ' ' + dt.getFullYear()
}

// 05-03-2026
export function fmtNum(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}

// 5 Mar (no year)
export function fmtShort(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()]
}

// 5 Mar, 14:30
export function fmtTs(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}

// 5 Mar 2026 14:30
export function fmtDateTime(d) {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  const h = dt.getHours(), m = dt.getMinutes()
  return dt.getDate()+' '+MO[dt.getMonth()]+' '+dt.getFullYear()+' '+(h<10?'0':'')+h+':'+(m<10?'0':'')+m
}

// Standard timeline chip set — pair with dateInTimeline below
export const TIMELINE_OPTIONS = [
  { key: 'all',       label: 'All Time' },
  { key: 'today',     label: 'Today' },
  { key: 'week',      label: 'This Week' },
  { key: 'lastweek',  label: 'Last Week' },
  { key: 'month',     label: 'This Month' },
  { key: 'lastmonth', label: 'Last Month' },
  { key: 'year',      label: 'This Year' },
  { key: 'custom',    label: 'Custom' },
]

// ── Generic timeline bucket for a single date (Monday-start weeks) ──
// Shared by list-page time filters (orders, field visits, …).
export function dateInTimeline(dateStr, t, customFrom, customTo) {
  if (t === 'all') return true
  if (!dateStr) return false
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (t === 'today') return d.getTime() === now.getTime()
  if (t === 'week' || t === 'lastweek') {
    const start = new Date(now); start.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    if (t === 'week') return d >= start
    const prev = new Date(start); prev.setDate(start.getDate() - 7)
    return d >= prev && d < start
  }
  if (t === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (t === 'lastmonth') { const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d.getFullYear() === lm.getFullYear() && d.getMonth() === lm.getMonth() }
  if (t === 'year') return d.getFullYear() === now.getFullYear()
  if (t === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0, 0, 0, 0); if (d < f) return false }
    if (customTo) { const t2 = new Date(customTo); t2.setHours(0, 0, 0, 0); if (d > t2) return false }
    return true
  }
  return true
}

// ── Delivery-date sanity — ONE rule shared by New Order, CRM convert, Order edit ──
// Blocks the typo class found 2026-07-03 (years 0026 / 20026 / 2025, delivery
// before order): a delivery date must be a real YYYY-MM-DD between the order
// date and order date + 2 years. Returns a message fragment, or null if OK.
export function deliveryDateIssue(dispatchDate, orderDate) {
  if (!dispatchDate) return 'is required'
  // 4-digit year enforced — HTML date inputs happily emit "0026-…" or "20026-…"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dispatchDate)) return `(${dispatchDate}) is not a valid date — check the year`
  const base = orderDate && /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : new Date().toISOString().slice(0, 10)
  if (dispatchDate < base) return `(${fmt(dispatchDate)}) cannot be before the order date (${fmt(base)})`
  const max = (parseInt(base.slice(0, 4)) + 2) + base.slice(4)
  if (dispatchDate > max) return `(${fmt(dispatchDate)}) is more than 2 years after the order date — check the year`
  return null
}

// Order-date sanity — new orders are punched with today's or a future date
// (user rule 2026-07-03: no backdating), capped at +1 year to block year typos.
// allowPast is for editing existing orders, whose dates are legitimately old.
export function orderDateIssue(orderDate, { allowPast = false } = {}) {
  if (!orderDate) return 'is required'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(orderDate)) return `(${orderDate}) is not a valid date — check the year`
  const today = new Date().toISOString().slice(0, 10)
  if (!allowPast && orderDate < today) return `(${fmt(orderDate)}) cannot be in the past — use today's or a future date`
  const max = (parseInt(today.slice(0, 4)) + 1) + today.slice(4)
  if (orderDate > max) return `(${fmt(orderDate)}) is more than 1 year ahead — check the year`
  return null
}

// max attribute for delivery-date inputs (order date + 2 years)
export function deliveryDateMax(orderDate) {
  const base = orderDate && /^\d{4}-\d{2}-\d{2}$/.test(orderDate) ? orderDate : new Date().toISOString().slice(0, 10)
  return (parseInt(base.slice(0, 4)) + 2) + base.slice(4)
}

// HTML-escape for safe injection into document.write / innerHTML templates
export function esc(str) {
  if (!str && str !== 0) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

// ── Money formatters ──
// Compact: ₹12.50 L / ₹1.25 Cr — for KPI tiles, hero numbers
export function fmtMoneyShort(val) {
  if (val == null || val === '' || isNaN(val)) return '—'
  const n = Number(val)
  if (n === 0) return '₹0'
  if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr'
  if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}

// Standard: ₹1,25,000 — for tables, list cells, totals (no decimals)
export function fmtMoney(val) {
  if (val == null || val === '' || isNaN(val)) return '—'
  return '₹' + Math.round(Number(val)).toLocaleString('en-IN')
}

// Full: ₹1,25,000.50 — for invoices, receipts (2 decimals)
export function fmtMoneyFull(val) {
  if (val == null || val === '' || isNaN(val)) return '—'
  return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Plain number with Indian comma format (no ₹)
export function fmtN(val) {
  if (val == null || val === '' || isNaN(val)) return '—'
  return Number(val).toLocaleString('en-IN')
}
