// Canonical "order value" — ONE definition, used everywhere, so totals never
// drift between pages. (Before this, /orders and /orders/list each rolled their
// own math and disagreed: 9.28 vs 9.25 on the same data.)
//
// Definition (agreed with the user; RE-CONFIRMED 2026-09-01 — "this is perfect"
// — after it was enforced across all 16 value sites, so treat any proposal to
// change it as a business decision that needs asking, never a refactor):
//   - A CANCELLED order contributes 0 (excluded entirely — no revenue).
//   - Per LINE: total_price minus the value of cancelled qty (partial cancels
//     are always netted out).
//   - Freight is a logistics charge, NOT order value → EXCLUDED.
//
// If freight ever needs to be shown, do it as a separate line, never folded
// into "order value".

// Net goods value of a single order line, after partial cancellation.
export function lineNetValue(item) {
  const gross = Number(item?.total_price) || 0
  const unit  = Number(item?.unit_price_after_disc) || Number(item?.lp_unit_price) || Number(item?.unit_price) || 0
  const cancelledVal = (Number(item?.cancelled_qty) || 0) * unit
  return Math.max(0, gross - cancelledVal)
}

// Net goods value of one order. Cancelled orders contribute 0.
export function orderNetValue(order) {
  if (!order || order.status === 'cancelled') return 0
  return (order.order_items || []).reduce((s, i) => s + lineNetValue(i), 0)
}

// Sum across a list of orders = REVENUE. Cancelled orders already count as 0;
// SAMPLE orders are excluded too (a sample is not a sale — no revenue). Callers
// summing revenue must fetch order_type for this to apply.
export function ordersTotalValue(orders) {
  return (orders || []).reduce((s, o) => s + (o?.order_type === 'SAMPLE' ? 0 : orderNetValue(o)), 0)
}

// ── Dispatched (delivered) value — ONE definition ─────────────────────────────
// The DATABASE has already chosen this boundary: enforce_order_status_integrity
// refuses to let an order reach 'dispatched_fc'/'closed' unless
//     COALESCE(posted_qty,0) + COALESCE(cancelled_qty,0) >= qty
// so posted_qty IS the system's enforced definition of "delivered". Pending
// (qty - posted - cancelled) already uses it, which is why these two must agree:
// dispatched + pending + cancelled = ordered, on every screen.
//
// Before this, THREE different calculations existed and disagreed by up to
// ₹43 lakh: the order-page total used dispatched_qty (ALLOCATED — counted goods
// still sitting in the godown), while the dashboard and the order-items table
// summed dispatched_fc batch JSON (a later milestone that excludes goods already
// goods-issued but not yet stamped out of the FC).
export function lineDispatchedValue(item) {
  // Same price fallback as lineNetValue above. order_items has no `unit_price`
  // column — the pair is unit_price_after_disc then lp_unit_price. 613 lines are
  // genuinely zero-priced and have no lp either, so they contribute 0 correctly.
  const unit = Number(item?.unit_price_after_disc) || Number(item?.lp_unit_price) || 0
  return (Number(item?.posted_qty) || 0) * unit
}
export function orderDispatchedValue(order) {
  if (!order || order.status === 'cancelled') return 0
  return (order.order_items || []).reduce((s, i) => s + lineDispatchedValue(i), 0)
}
export function ordersDispatchedValue(orders) {
  return (orders || []).reduce((s, o) => s + (o?.order_type === 'SAMPLE' ? 0 : orderDispatchedValue(o)), 0)
}
