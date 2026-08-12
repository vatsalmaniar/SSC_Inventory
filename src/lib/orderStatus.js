// ═══════════════════════════════════════════════════════════════════
// THE order state machine — single source of truth (SAP-style).
// Every page imports from here; no hand-rolled status lists anywhere.
// Mirrors the DB whitelist in sql/order_status_integrity.sql — keep in sync.
//
// Line truth (the DB-enforced invariant):
//   line resolved      ⟺ posted_qty + cancelled_qty ≥ qty
//   dispatched_fc      ⟺ every line resolved, goods went out
//   closed             ⟺ every line resolved, mix of delivered + cancelled
//   cancelled          ⟺ nothing ever posted AND no live batch
//   partial_dispatch   ⟺ some qty resolved, some still open (pending work)
// ═══════════════════════════════════════════════════════════════════

// Order is finished — no pending work can ever exist on it again
export const TERMINAL_STATUSES = ['dispatched_fc', 'closed', 'cancelled']

// Pre-dispatch approval pipeline (ops owns the order)
export const PRE_DISPATCH_STATUSES = ['pending', 'inv_check', 'inventory_check', 'dispatch']

// Proforma-invoice detour (accounts collects payment before FC picks)
export const PI_STAGES = ['pi_requested', 'pi_generated', 'pi_payment_pending']

// A delivery batch is actively moving through FC + billing
export const FC_PIPELINE_STATUSES = ['delivery_created', 'picking', 'packing', 'goods_issued', 'pending_billing', 'credit_check', 'goods_issue_posted', 'invoice_generated', 'delivery_ready', 'eway_pending', 'eway_generated']

// Complete whitelist — must equal the DB trigger's list
export const ORDER_STATUSES = [...PRE_DISPATCH_STATUSES, ...PI_STAGES, ...FC_PIPELINE_STATUSES, 'partial_dispatch', ...TERMINAL_STATUSES]

// ── Line-level helpers (quantities are the truth) ──
//
// ⚠️ TWO DIFFERENT QUANTITIES. Picking the wrong one is the single most
// repeated bug in this system — it has been "fixed" 3-4 times. Read this before
// writing `qty - something` by hand anywhere.
//
//   dispatched_qty = ALLOCATED. Set when a delivery BATCH IS CREATED
//     (dispatch_order_batch -> increment_dispatched_qty, which also carries the
//     over-allocation guard). The goods have NOT necessarily moved.
//
//   posted_qty     = ISSUED. Set by mark_batch_posted(), which refuses to run
//     before status 'goods_issue_posted'. The goods HAVE left. This is SAP's
//     Post Goods Issue boundary: stock moves, COGS books, billing opens.
//
// Which to use:
//   "how much can still go into a NEW batch?"  -> lineUndispatchedQty (allocated)
//        …used by the dispatch modals, ATP, waitlist, next-batch decisions.
//        NEVER swap this for posted_qty: units sitting in an unshipped batch
//        would look free and be allocated twice — goods ship twice.
//   "how much has actually SHIPPED / is still owed to the customer?"
//        -> lineIssuedQty / linePendingQty (posted)
//        …used by every value, count and status shown to a human.
//
// The gap between them is real and visible: SSC/SO0503 had 100 units allocated
// and 11 issued, because batch 1 stuck at credit_check on 9-Jun never moved.
// Anything that reported 100 as "dispatched" was wrong by 89 units.
export const linePendingQty      = (i) => Math.max(0, (i.qty || 0) - (i.posted_qty || 0) - (i.cancelled_qty || 0))
export const lineUndispatchedQty = (i) => Math.max(0, (i.qty || 0) - (i.dispatched_qty || 0) - (i.cancelled_qty || 0))
export const lineIssuedQty       = (i) => Math.max(0, i.posted_qty || 0)
export const lineIssuedValue     = (i) => lineIssuedQty(i) * (i.unit_price_after_disc || i.unit_price || 0)
// Units allocated into a batch that has NOT been goods-issued — i.e. sitting in
// an open delivery. This is what SO0503's 89 units are.
export const lineHeldInOpenBatch = (i) => Math.max(0, (i.dispatched_qty || 0) - (i.posted_qty || 0))
export const lineResolved        = (i) => (i.posted_qty || 0) + (i.cancelled_qty || 0) >= (i.qty || 0)

// ── Order-level questions pages actually ask ──
export const isTerminal      = (o) => TERMINAL_STATUSES.includes(o?.status)
export const isDeliveredish  = (o) => o?.status === 'dispatched_fc' || o?.status === 'closed'
export const isInFCFlow      = (o) => FC_PIPELINE_STATUSES.includes(o?.status) || PI_STAGES.includes(o?.status)

// Can ops create another delivery batch? (the CO0845 question)
export const canTakeNewBatch = (o) =>
  !!o && !isTerminal(o) &&
  (isInFCFlow(o) || o.status === 'partial_dispatch') &&
  (o.order_items || []).some(i => lineUndispatchedQty(i) > 0)

// Does undelivered, uncancelled quantity exist? (the Waiting-for-Clearance question)
export const hasPendingWork  = (o) =>
  !!o && !isTerminal(o) && (o.order_items || []).some(i => linePendingQty(i) > 0)
