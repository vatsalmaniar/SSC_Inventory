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

// Map of order_item_id -> total qty on NON-cancelled PO lines.
// Chunked: >~150 UUIDs in one .in() exceeds PostgREST's 8 KB URL cap.
// Cancelled POs are excluded in the same round-trip so they never count.
export async function fetchActivePoCoveredQty(itemIds) {
  const map = new Map()
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('po_items')
      .select('order_item_id, qty, purchase_orders!inner(status)')
      .in('order_item_id', ids.slice(i, i + 150))
      .neq('purchase_orders.status', 'cancelled')
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
