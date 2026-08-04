// Canonical "how much of this CO line still needs a purchase order?" — ONE
// definition, used by the procurement queue, dashboard, New-PO clubbing
// search/prefill, and the order page. Before this, four pages each re-derived
// coverage and drifted; one used the ORDER's status as a proxy, so a
// partly-dispatched order (header → dispatched_fc) hid its still-unprocured
// lines from the queue AND the clubbing search. See [[clubbed-po-phase1]].
//
// Quantity-precise (Stage B). A line's remaining-to-procure is:
//   to_procure = max(0, min(
//        qty − cancelled − stock_qty − po_covered_qty,   ← not yet sourced
//        qty − cancelled − dispatched_qty                ← can't need more than unshipped
//   ))
// The min() floor is essential: it stops stock/PO units that were ALSO already
// dispatched from being subtracted twice (which would hide real demand, e.g. a
// 6-from-stock / 4-on-PO line whose 6 stock units shipped).
//
// stock_qty fallback (Stage B migration-safety): a line's stock portion is
// stock_qty when set, else — for the 585 legacy whole-line 'stock' rows that
// have stock_qty = 0 — the full remaining qty. So legacy rows are untouched.

import { sb } from './supabase'

// PO statuses that COUNT as covering a customer requirement.
//
// A requirement is covered only by a FIRM commitment — one the vendor actually
// holds. Coverage therefore starts at 'placed'. Everything before that is
// intent, not supply:
//   draft            — one person's unsubmitted work
//   pending_approval — waiting on an approver
//   approved         — approved but never sent to the vendor
// Measured 2026-08-04: 13 POs had been approved 74-99 days earlier and never
// placed (₹4.5L), and every one of those customer orders read as "covered".
// Nothing was on order anywhere.
//
// This mirrors how an ERP treats firm vs planned receipts: an untransmitted
// order does not cover demand. Excluding these creates the opposite risk (a
// second buyer raising a duplicate), so every unplaced PO stays VISIBLE
// against its customer order with its state and age — see UNPLACED_PO_STATUSES,
// ProcurementOrders (_unplacedPOs) and the NewPurchaseOrder addCO warning.
export const COVERING_PO_STATUSES = [
  'placed', 'acknowledged', 'delivery_confirmation',
  'partially_received', 'material_received', 'closed',
]

// A PO exists for the line but the vendor does not have it yet. Shown on the
// customer order so the requirement is never silently hidden AND never
// duplicated — the row tells you exactly where the PO is stuck.
export const UNPLACED_PO_STATUSES = ['draft', 'pending_approval', 'approved']

// Days an unplaced PO may sit before it is treated as stuck rather than in
// flight. Under this it is normal work; over it, something has been forgotten.
export const UNPLACED_PO_STALE_DAYS = 14

export function unplacedPoLabel(status) {
  if (status === 'draft')            return 'Open draft PO'
  if (status === 'pending_approval') return 'PO awaiting approval'
  if (status === 'approved')         return 'Approved — place it'
  return 'PO not placed'
}

// Map of order_item_id -> total qty on PO lines whose PO actually covers.
// Chunked: >~150 UUIDs in one .in() exceeds PostgREST's 8 KB URL cap.
// `isTest` scopes to the matching PO mode — a test PO must never mark a LIVE
// requirement covered (and vice versa). Defaults to live.
export async function fetchActivePoCoveredQty(itemIds, isTest = false) {
  const map = new Map()
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('po_items')
      .select('order_item_id, qty, purchase_orders!inner(status,is_test)')
      .in('order_item_id', ids.slice(i, i + 150))
      .in('purchase_orders.status', COVERING_PO_STATUSES)
      .eq('purchase_orders.is_test', isTest)
    if (error) { console.error('fetchActivePoCoveredQty:', error); continue }
    for (const r of (data || [])) {
      if (!r.order_item_id) continue
      map.set(r.order_item_id, (map.get(r.order_item_id) || 0) + (Number(r.qty) || 0))
    }
  }
  return map
}

// Stock portion of a line, with the legacy fallback (see header note).
function stockPortion(oi) {
  const qty = Number(oi.qty) || 0
  const cancelled = Number(oi.cancelled_qty) || 0
  const remaining = Math.max(0, qty - cancelled)
  const sq = Number(oi.stock_qty) || 0
  if (sq > 0) return Math.min(sq, remaining)
  if (oi.procurement_source === 'stock') return remaining   // legacy whole-line stock
  return 0
}

// PO-covered qty from either a Map (qty-precise) or a Set (legacy existence ⇒
// treat as fully covered). Lets callers that only have existence info still work.
function poCoveredQtyOf(oi, covered) {
  if (!covered) return 0
  if (covered instanceof Map) return Number(covered.get(oi.id)) || 0
  if (covered instanceof Set) return covered.has(oi.id) ? Number.MAX_SAFE_INTEGER : 0
  return 0
}

// Units of this line still needing a (new) PO. 0 if inactive.
export function lineToProcureQty(oi, covered) {
  if (!oi) return 0
  if ((oi.line_status || 'active') !== 'active') return 0
  const qty = Number(oi.qty) || 0
  const cancelled = Number(oi.cancelled_qty) || 0
  const dispatched = Number(oi.dispatched_qty) || 0
  const bySource  = qty - cancelled - stockPortion(oi) - poCoveredQtyOf(oi, covered)
  const byShipped = qty - cancelled - dispatched
  return Math.max(0, Math.min(bySource, byShipped))
}

// Does this line still need any procurement? `covered` = Map from
// fetchActivePoCoveredQty (preferred) or a legacy Set of covered ids.
export function lineNeedsProcurement(oi, covered) {
  return lineToProcureQty(oi, covered) > 0
}

// Inverse, for "X / Y covered" counts. A line is "handled" when nothing is left
// to procure (covered by PO, from stock, or already dispatched). Inactive lines
// are excluded from totals (return false).
export function lineIsHandled(oi, covered) {
  if ((oi?.line_status || 'active') !== 'active') return false
  return lineToProcureQty(oi, covered) <= 0
}
