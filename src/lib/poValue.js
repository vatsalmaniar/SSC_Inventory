// Canonical PURCHASE-ORDER value — ONE definition, so a PO's outstanding figure
// never differs between the list, the detail page and the Excel export.
//
// This is deliberately SEPARATE from src/lib/orderValue.js. A customer order
// line has cancelled_qty and its value nets partial cancellations; po_items has
// NO cancelled_qty column at all, so a PO line is simply ordered-minus-received.
// Routing PO value through orderValue.js would quietly apply order semantics to
// a different shape. If po_items ever gains cancelled_qty, change it HERE.
//
// Written 2026-09-01 because the same arithmetic already existed in three
// places — PurchaseOrderList's Excel export, its (new) on-screen column, and
// PurchaseOrderDetail's items tab. orderValue.js exists because that exact
// pattern drifted three times on the sales side; not repeating it here.

// Unit price for a PO line. The fallback order matters: unit_price_after_disc is
// what the vendor actually charges, unit_price is the pre-discount figure, and
// lp_unit_price is the list price of last resort.
export function poUnitPrice(item) {
  return Number(item?.unit_price_after_disc) || Number(item?.unit_price) || Number(item?.lp_unit_price) || 0
}

/** Quantity still to be received on one line. Never negative — an over-receipt
 *  (received > ordered) is a GRN matter, not a negative outstanding. */
export function poLinePendingQty(item) {
  return Math.max(0, (Number(item?.qty) || 0) - (Number(item?.received_qty) || 0))
}

/** Value still to be received on one line. */
export function poLinePendingValue(item) {
  return poLinePendingQty(item) * poUnitPrice(item)
}

/** Value still to be received across a whole PO. A cancelled PO has nothing
 *  outstanding, so it contributes 0 — matching how the list already excludes
 *  cancelled POs from its total value. */
export function poPendingValue(po) {
  if (!po || po.status === 'cancelled') return 0
  return (po.po_items || []).reduce((s, i) => s + poLinePendingValue(i), 0)
}

/** Sum of outstanding value across a list of POs. */
export function posPendingValue(pos) {
  return (pos || []).reduce((s, po) => s + poPendingValue(po), 0)
}
