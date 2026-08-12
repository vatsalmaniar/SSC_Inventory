-- ═══════════════════════════════════════════════════════════════════════════
-- Record what was only ever inferred: 849 CO lines that shipped from stock
-- Applied: 2026-08-12   Step 1 of 2. Step 2 removes the byShipped cap.
--
-- WHY THIS MUST RUN FIRST
-- lineToProcureQty() capped "still to procure" by (qty - cancelled - dispatched),
-- i.e. it assumed "if it shipped, it must have been sourced". That assumption
-- hides real demand: SSC/CO1253 (Ammann, Rs 2,28,980) was never bought, never
-- shipped, and invisible — because creating the DELIVERY PAPERWORK increments
-- dispatched_qty, before any goods move.
--
-- The cap cannot simply be deleted. 849 CO lines genuinely DID ship from stock
-- and were never recorded as such (stock lives in the daily XLS, not the app,
-- so nobody ever filled the Stock box). Delete the cap first and all 343 of
-- those orders flood the procurement queue.
--
-- So: state the fact that was previously guessed. These units shipped and were
-- not bought, therefore they came from stock. That is not an inference about an
-- open line — it is a record of a completed event.
--
-- SCOPE — deliberately narrow:
--   * order_type = 'CO' ONLY. ProcurementOrders.jsx:61 and NewPurchaseOrder.jsx:95
--     both filter to CO, so SO (1,925 lines) and SAMPLE (71) never appear in any
--     procurement view and are left untouched.
--   * Only lines already fully dispatched (byShipped <= 0) AND confirmed shipped
--     by a dispatch batch at a real shipping status. The 73 lines whose batch is
--     merely created (pi_generated / delivery_created / picking) are EXCLUDED —
--     those are the bug, and they must surface.
--   * Only the still-unsourced portion is credited to stock; existing stock_qty
--     and PO coverage are preserved.
--
-- 849 rows · 242,881 units · 343 customer orders.
-- Reversal: undo table below, plus coverage snapshot 'pre-byshipped-removal'.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Undo trail. Nothing here is destructive, but 849 rows deserve a way back.
CREATE TABLE IF NOT EXISTS public.coverage_stock_backfill_undo_20260812 (
  order_item_id uuid PRIMARY KEY,
  old_stock_qty numeric,
  new_stock_qty numeric,
  backfilled_at timestamptz DEFAULT now()
);

WITH cov AS (
  SELECT pit.order_item_id, SUM(pit.qty) covered
    FROM public.po_items pit
    JOIN public.purchase_orders p ON p.id = pit.po_id
   WHERE p.status IN ('placed','acknowledged','delivery_confirmation',
                      'partially_received','material_received','closed')
     AND COALESCE(p.is_test,false) = false
   GROUP BY pit.order_item_id
),
f AS (
  SELECT oi.id, oi.order_id, COALESCE(oi.stock_qty,0) sq,
         (oi.qty - COALESCE(oi.cancelled_qty,0)
            - CASE WHEN COALESCE(oi.stock_qty,0) > 0
                     THEN LEAST(oi.stock_qty, GREATEST(oi.qty-COALESCE(oi.cancelled_qty,0),0))
                   WHEN oi.procurement_source = 'stock'
                     THEN GREATEST(oi.qty-COALESCE(oi.cancelled_qty,0),0)
                   ELSE 0 END
            - COALESCE(c.covered,0)) buy
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN cov c ON c.order_item_id = oi.id
   WHERE COALESCE(o.is_test,false) = false
     AND o.status <> 'cancelled'
     AND COALESCE(oi.line_status,'active') = 'active'
     AND o.order_type = 'CO'
     AND (oi.qty - COALESCE(oi.cancelled_qty,0) - COALESCE(oi.dispatched_qty,0)) <= 0
),
shipped AS (
  SELECT f.id, f.sq, f.buy
    FROM f
    LEFT JOIN public.order_dispatches od
           ON od.order_id = f.order_id
          AND od.dispatched_items @> jsonb_build_array(jsonb_build_object('order_item_id', f.id::text))
   WHERE f.buy > 0
   GROUP BY f.id, f.sq, f.buy
  HAVING COALESCE(bool_or(od.status IN ('dispatched_fc','delivered','goods_issue_posted',
                                        'goods_issued','invoice_generated','eway_generated')), false)
)
INSERT INTO public.coverage_stock_backfill_undo_20260812 (order_item_id, old_stock_qty, new_stock_qty)
SELECT id, sq, sq + buy FROM shipped
ON CONFLICT (order_item_id) DO NOTHING;

UPDATE public.order_items oi
   SET stock_qty = u.new_stock_qty
  FROM public.coverage_stock_backfill_undo_20260812 u
 WHERE u.order_item_id = oi.id
   AND oi.stock_qty IS DISTINCT FROM u.new_stock_qty;

COMMIT;

-- To reverse:
--   UPDATE public.order_items oi SET stock_qty = u.old_stock_qty
--     FROM public.coverage_stock_backfill_undo_20260812 u WHERE u.order_item_id = oi.id;
