// ═══════════════════════════════════════════════════════════════════
// Expense module — single source of truth for budget math, status /
// payment metadata, file validation, and avatar helpers.
//
// One-formula-per-metric rule: every "spent / remaining / % used / over"
// calculation lives HERE and is imported. Never inline the math in a page.
// ═══════════════════════════════════════════════════════════════════
import { fmt } from './fmt'

// ── Roles ────────────────────────────────────────────────────────
export const CAN_APPROVE = ['admin', 'management']   // review (L1/L2)
export const CAN_PAY     = ['admin', 'accounts']     // Pay Now
export const CAN_SEE_ALL = ['admin', 'management', 'accounts']
export const CAN_CONFIG  = ['admin', 'management']

// ── Locations (drive the mileage budget) ─────────────────────────
// Mileage is the ONLY budgeted track. Budget resolves:
//   person override → location budget → 0.
// General categories (Food, Telephone…) have NO budget — spend only.
export const LOCATIONS = ['Ahmedabad', 'Baroda']
export const locLabel = l => l || '—'

// ── Status metadata (the claim state machine) ────────────────────
export const STATUS_META = {
  pending:       { label: 'Pending',       queue: 'Awaiting Mgmt',  color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  mgmt_approved: { label: 'Mgmt Approved', queue: 'Awaiting Admin', color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd' },
  approved:      { label: 'Approved',      queue: 'Payable',        color: '#047857', bg: '#f0fdf4', border: '#86efac' },
  rejected:      { label: 'Rejected',      queue: 'Rejected',       color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  reimbursed:    { label: 'Reimbursed',    queue: 'Paid',           color: '#6d28d9', bg: '#f5f3ff', border: '#c4b5fd' },
}
export function statusMeta(s) { return STATUS_META[s] || { label: s, color: '#64748b', bg: '#f1f5f9', border: '#cbd5e1' } }

// ARGB fills for the Excel export — mirrors xlsStatusStyle() in xlsExport.js
// so the Expenses sheet reads like the Orders sheets.
export function xlsStatusFill(s) {
  switch (s) {
    case 'pending':       return { bg: 'FFFEF9C3', fg: 'FF854D0E' }
    case 'mgmt_approved': return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
    case 'approved':      return { bg: 'FFDCFCE7', fg: 'FF166534' }
    case 'rejected':      return { bg: 'FFFEE2E2', fg: 'FFB91C1C' }
    case 'reimbursed':    return { bg: 'FFEDE9FE', fg: 'FF5B21B6' }
    default:              return { bg: 'FFF1F5F9', fg: 'FF334155' }
  }
}

// ── Payment methods (how the employee paid the vendor) ───────────
export const PAYMENT_METHODS = [
  { key: 'card', label: 'Card' },
  { key: 'cash', label: 'Cash' },
  { key: 'gpay', label: 'GPay / UPI' },
]
export const PAYMENT_LABEL = Object.fromEntries(PAYMENT_METHODS.map(p => [p.key, p.label]))

// ── Budget math (single source) ──────────────────────────────────
// "spent" against a budget = approved + reimbursed (uses approved_amount).
export function pctUsed(spent, budget) {
  const b = Number(budget) || 0, s = Number(spent) || 0
  if (b <= 0) return s > 0 ? 100 : 0
  return Math.min(999, Math.round((s / b) * 100))
}
export function remaining(budget, spent) { return (Number(budget) || 0) - (Number(spent) || 0) }
export function isOver(spent, budget)    { return (Number(budget) || 0) > 0 && (Number(spent) || 0) > (Number(budget) || 0) }
export function meterColor(spent, budget) {
  const p = pctUsed(spent, budget)
  if (p >= 100) return '#dc2626'
  if (p >= 80)  return '#f59e0b'
  return '#10b981'
}

// ── Date guard (expenses are already incurred → past/today only) ─
export function expenseDateIssue(d) {
  if (!d) return 'is required'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return `(${d}) is not a valid date — check the year`
  const today = new Date().toISOString().slice(0, 10)
  if (d > today) return `(${fmt(d)}) is in the future — an expense must already be incurred`
  const min = (parseInt(today.slice(0, 4)) - 1) + today.slice(4)
  if (d < min) return `(${fmt(d)}) is more than a year old — check the year`
  return null
}
export function monthStartOf(dateStr) { return (dateStr || '').slice(0, 7) + '-01' }
export function currentMonthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
// Build a list of {value, label} months for a picker (this month back N months)
export function monthOptions(count = 12) {
  const out = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    out.push({ value, label })
  }
  return out
}

// ── Bill file validation + hashing (duplicate detection) ─────────
export const MAX_BILL_BYTES = 8 * 1024 * 1024      // 8 MB (matches bucket limit)
export const MAX_BILLS = 5
export const ALLOWED_BILL_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
export const BILL_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/*,application/pdf'

export function validateBillFile(f) {
  const okType = ALLOWED_BILL_MIME.includes(f.type) || /\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(f.name)
  if (!okType) return `${f.name}: only images or PDF are allowed`
  if (f.size > MAX_BILL_BYTES) return `${f.name}: larger than 8 MB`
  return null
}
export async function hashFile(f) {
  const buf = await f.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
// sanitize a filename for the storage path
export function safeName(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

// ── Category colour — auto-assigned from the SSC theme, never hand-picked.
// Drawn from the KPI/brand tokens (ssc-deep, ssc-mid, ssc-cyan, teal, slate)
// so the module reads as one system instead of a rainbow.
const CAT_COLORS = [
  '#1a73e8', // ssc-deep
  '#0F766E', // teal
  '#163E68', // ssc-mid
  '#14B8B5', // ssc-cyan (dark)
  '#1B4E8F', // brand blue mid
  '#0369A1', // steel blue
  '#0891B2', // cyan-600
  '#4338CA', // indigo
  '#475569', // slate
  '#10B981', // good
  '#F59E0B', // warn
  '#5B6878', // muted
]
export function autoCatColor(name) {
  let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return CAT_COLORS[h % CAT_COLORS.length]
}

// ── Avatars (deterministic per profile id) — mirrors PeopleKpi ───
const AVATAR_COLORS = ['#1E40AF','#0F766E','#9333EA','#DC2626','#EA580C','#0369A1','#0891B2','#BE185D','#059669','#7C2D12','#4338CA','#A21CAF']
export function colorFor(seed) {
  let h = 0; for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export function initialsFor(name) {
  return (name || '').split(' ').map(w => w[0]).filter(Boolean).join('').toUpperCase().slice(0, 2)
}
