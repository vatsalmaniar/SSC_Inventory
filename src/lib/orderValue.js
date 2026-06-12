// Canonical "order value" — ONE definition, used everywhere, so totals never
// drift between pages. (Before this, /orders and /orders/list each rolled their
// own math and disagreed: 9.28 vs 9.25 on the same data.)
//
// Definition (agreed with the user):
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

// Sum across a list of orders (cancelled ones already count as 0).
export function ordersTotalValue(orders) {
  return (orders || []).reduce((s, o) => s + orderNetValue(o), 0)
}
