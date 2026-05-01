// KPI module shared utilities

export const KPI_DEFS = [
  { key: 'collection_ratio',  kra: 'C', label: 'Collection Efficiency',     unit: 'ratio',  format: 'pct',  source: 'derived', help: 'Collection ÷ Overdue (1st of month)' },
  { key: 'new_customers',     kra: 'C', label: 'New Customers Added',       unit: 'count',  format: 'int',  source: 'auto+manual', help: 'Auto from customers by account owner. Admin can override.' },
  { key: 'sales_achievement', kra: 'O', label: 'Sales Achievement',         unit: 'pct',    format: 'pct',  source: 'derived', help: 'Actual Sales ÷ Monthly Target' },
  { key: 'field_visits',      kra: 'R', label: 'Field Visits',              unit: 'count',  format: 'int',  source: 'auto+manual', help: 'Solo + joint SSC-team visits. Admin can override.' },
  { key: 'principal_visits',  kra: 'R', label: 'Joint Visit with Principal',unit: 'count',  format: 'int',  source: 'auto+manual', help: 'Visits with principal rep. Admin can override.' },
  { key: 'lost_orders',       kra: 'R', label: 'Lost Orders Highlighted',   unit: 'count',  format: 'int',  source: 'manual',  help: 'Lost / no-go orders reported by salesperson' },
  { key: 'hero_products',     kra: 'I', label: 'Hero Products Sold',        unit: 'count',  format: 'int',  source: 'auto+manual', help: 'Orders containing this month\'s hero products. Admin can override.' },
  { key: 'sales_ideas',       kra: 'I', label: 'Sales Ideas Submitted',     unit: 'count',  format: 'int',  source: 'manual',  help: 'Internal sales improvement ideas submitted' },
  { key: 'complaints',        kra: 'M', label: 'Customer Complaints',       unit: 'count',  format: 'int',  source: 'manual',  help: 'Complaints received (0 = best)' },
]

// Inputs feeding derived KPIs (manual entries)
export const KPI_INPUTS = [
  { key: 'overdue_amount',    kra: 'C', label: 'Overdue Amount (₹)',          unit: 'inr',   format: 'inr',  source: 'manual',  help: '1st of month' },
  { key: 'collection_amount', kra: 'C', label: 'Collection Done (₹)',         unit: 'inr',   format: 'inr',  source: 'manual',  help: 'Last day of month' },
  { key: 'actual_sales',      kra: 'O', label: 'Actual Sales (₹)',            unit: 'inr',   format: 'inr',  source: 'auto+manual', help: 'Auto from orders by account owner; admin can override' },
]

export const ALL_KPI_KEYS = [...KPI_DEFS.map(d => d.key), ...KPI_INPUTS.map(d => d.key)]

export const KRA_LABELS = {
  C: 'Collection',
  O: 'Output / Sales',
  R: 'Routine',
  I: 'Innovation',
  M: 'Management',
}

export const KRA_COLORS = {
  C: '#0891b2',
  O: '#1d4ed8',
  R: '#7c3aed',
  I: '#b45309',
  M: '#dc2626',
}

// Compute current FY label (e.g., "26-27" if month >= April of 2026, else "25-26")
export function currentFyLabel(d = new Date()) {
  const y = d.getFullYear()
  const m = d.getMonth() // 0-11
  const start = m >= 3 ? y : y - 1
  return String(start % 100).padStart(2, '0') + '-' + String((start + 1) % 100).padStart(2, '0')
}

// FY months: April → March (12 months) starting from FY label like "26-27"
export function fyMonths(fyLabel) {
  const startYr = 2000 + parseInt(fyLabel.split('-')[0], 10)
  const out = []
  for (let i = 0; i < 12; i++) {
    const m = 3 + i
    const yr = startYr + Math.floor(m / 12)
    const month = m % 12
    out.push(new Date(yr, month, 1))
  }
  return out
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
export function monthLabel(d) { return MONTH_LABELS[d.getMonth()] }
export function monthKey(d)   { return d.toISOString().slice(0, 10) }

// Compute the value at which the KPI hits its max points (the "target to score full")
export function maxPointsThreshold(threshold) {
  if (!threshold || !Array.isArray(threshold.thresholds)) return null
  const maxPoints = Math.max(...threshold.thresholds.map(t => Number(t.points) || 0))
  if (maxPoints === 0) return null
  if (threshold.match_type === 'exact') {
    const hit = threshold.thresholds.find(t => Number(t.points) === maxPoints)
    return hit ? Number(hit.value) : null
  }
  // gte: smallest min with max points
  const sorted = [...threshold.thresholds].sort((a, b) => (a.min || 0) - (b.min || 0))
  const hit = sorted.find(t => Number(t.points) === maxPoints)
  return hit ? Number(hit.min) : null
}

// Score lookup
export function scoreFor(value, threshold) {
  if (!threshold || !Array.isArray(threshold.thresholds)) return 0
  const v = Number(value) || 0
  if (threshold.match_type === 'exact') {
    const exact = threshold.thresholds.find(t => Number(t.value) === v)
    if (exact) return exact.points
    // 3+ rule: if value > max defined, use lowest points (likely 0)
    const sorted = [...threshold.thresholds].sort((a, b) => a.value - b.value)
    const max = sorted[sorted.length - 1]
    if (max && v > max.value) return max.points
    return 0
  }
  // gte: find largest min ≤ value
  const sorted = [...threshold.thresholds].sort((a, b) => a.min - b.min)
  let pts = 0
  for (const t of sorted) {
    if (v >= t.min) pts = t.points
  }
  return pts
}

// Derived KPI computation
export function computeDerived(rawByKpi, monthlyTarget) {
  const overdue    = Number(rawByKpi.overdue_amount)    || 0
  const collection = Number(rawByKpi.collection_amount) || 0
  const actualSales = Number(rawByKpi.actual_sales)     || 0
  const collectionRatio  = overdue > 0 ? collection / overdue : 0
  const salesAchievement = monthlyTarget > 0 ? actualSales / monthlyTarget : 0
  return { collection_ratio: collectionRatio, sales_achievement: salesAchievement }
}

export function fmtInr(n) {
  if (n == null || isNaN(n)) return '—'
  const v = Number(n)
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + ' L'
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
// Ceiling-rounded INR — used for sales targets (round up to next 0.01 Cr / 0.01 L)
export function fmtInrCeil(n) {
  if (n == null || isNaN(n)) return '—'
  const v = Number(n)
  if (v <= 0) return '₹0.00'
  if (v >= 1e7) return '₹' + (Math.ceil(v / 1e7 * 100) / 100).toFixed(2) + ' Cr'
  if (v >= 1e5) return '₹' + (Math.ceil(v / 1e5 * 100) / 100).toFixed(2) + ' L'
  return '₹' + Math.ceil(v).toLocaleString('en-IN')
}
export function fmtPct(n) {
  if (n == null || isNaN(n)) return '—'
  return Math.round(Number(n) * 100) + '%'
}
export function fmtVal(n, format) {
  if (n == null || isNaN(n)) return '—'
  if (format === 'inr') return fmtInr(n)
  if (format === 'pct') return fmtPct(n)
  return String(Math.round(Number(n) * 100) / 100)
}
