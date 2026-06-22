// Canonical "does this CO line still need a purchase order?" — ONE definition,
// used by the procurement queue, dashboard, New-PO clubbing search/prefill, and
// the order page. Before this, four pages each re-derived coverage and drifted;
// one even used the ORDER's status as a proxy, so a partly-dispatched order
// (header flipped to dispatched_fc) hid its still-unprocured lines from the
// queue AND the clubbing search. See [[clubbed-po-phase1]].
//
// Definition (Stage A — existence-based stock/PO + dispatch guard):
// A line STILL NEEDS A PO when ALL hold:
//   1. line is active (not cancelled / short-closed)
//   2. not flagged "From Stock"
//   3. not already (fully) dispatched — dispatched_qty < qty − cancelled_qty
//   4. no active (non-cancelled) PO line covers it
//
// Stage B will make this quantity-precise (per-line stock_qty + partial PO qty)
// without changing this module's callers — they only ask the two questions below.

import { sb } from './supabase'

// Set of order_item_ids that have at least one line on a NON-cancelled PO.
// Chunked: >~150 UUIDs in one .in() exceeds PostgREST's 8 KB URL cap.
// The embedded purchase_orders!inner(status) + .neq excludes cancelled POs in
// the same round-trip, so a cancelled PO never counts as coverage.
export async function fetchActivePoCoveredItemIds(itemIds) {
  const covered = new Set()
  const ids = [...new Set((itemIds || []).filter(Boolean))]
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await sb.from('po_items')
      .select('order_item_id, purchase_orders!inner(status)')
      .in('order_item_id', ids.slice(i, i + 150))
      .neq('purchase_orders.status', 'cancelled')
    if (error) { console.error('fetchActivePoCoveredItemIds:', error); continue }
    for (const r of (data || [])) if (r.order_item_id) covered.add(r.order_item_id)
  }
  return covered
}

// Is this order line still awaiting procurement?
// `coveredSet` = result of fetchActivePoCoveredItemIds for the relevant items.
export function lineNeedsProcurement(oi, coveredSet) {
  if (!oi) return false
  if ((oi.line_status || 'active') !== 'active') return false
  if (oi.procurement_source === 'stock') return false
  const qty       = Number(oi.qty) || 0
  const cancelled = Number(oi.cancelled_qty) || 0
  const dispatched = Number(oi.dispatched_qty) || 0
  // Already (fully) shipped → it was sourced somehow; no new PO needed.
  if (dispatched >= qty - cancelled) return false
  // Covered by an active PO line.
  if (coveredSet && coveredSet.has(oi.id)) return false
  return true
}

// Inverse, for "X / Y covered" counts. A line is "handled" when it does not
// need procurement (covered by PO, from stock, dispatched, or inactive).
export function lineIsHandled(oi, coveredSet) {
  if ((oi?.line_status || 'active') !== 'active') return false // inactive: excluded from totals
  return !lineNeedsProcurement(oi, coveredSet)
}
