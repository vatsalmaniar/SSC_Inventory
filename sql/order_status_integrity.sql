-- ═════════════════════════════════════════════════════════════════════
-- ORDER STATUS INTEGRITY — status is DERIVED from line reality, enforced
-- ═════════════════════════════════════════════════════════════════════
-- Root cause fixed: orders.status was ASSIGNED by scattered code paths.
-- Two orphan classes existed in production:
--   • cancelled orders with LIVE delivery batches (raw cancelFullOrder
--     bypassed cancel_order_lines) → phantom "pending" rows in Billing/FC
--   • dispatched_fc orders with qty never dispatched into any batch
--     (confirmDelivered checked "all batches done", not "all qty resolved")
--     → ₹1.71 Cr of real backlog hidden from Waiting for Clearance
--
-- Target semantics (SAP document-flow):
--   line resolved      ⟺ posted_qty + cancelled_qty ≥ qty
--   dispatched_fc      ⟺ every line resolved (goods went out)
--   closed             ⟺ every line resolved, mix of posted + cancelled
--   cancelled          ⟺ nothing ever posted AND no live batch
--   partial_dispatch   ⟺ some qty resolved, some still open (VISIBLE work)
--
-- USER DECISIONS APPLIED:
--   • The 177 prematurely-"Delivered" orders → partial_dispatch (Variant A:
--     surface for review — NOTHING written off silently; ops disposition
--     each via ship-remainder or cancel-remainder). Variant B (bulk
--     short-close) was designed and rejected by the user.
--   • No order is ever hidden; nothing working is hampered (risk-audited).
--
-- ONE TRANSACTION. UPDATE-only, no deletes. Audit comment per touched
-- order. Self-aborting: verification failures roll back EVERYTHING.
-- Apply via Supabase SQL editor / Management API. Idempotent re-runs.
-- ═════════════════════════════════════════════════════════════════════

BEGIN;

-- Bypass GUC: inert on first run (triggers created at the end);
-- makes re-runs of the backfill sections safe after triggers exist.
SET LOCAL app.order_integrity_bypass = 'on';

-- ─────────────────────────────────────────────────────────────────────
-- STEP 0 · PRE-FLIGHT ASSERTIONS (abort whole tx if the world changed)
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad int;
BEGIN
  -- 0a: no unknown status values beyond the whitelist
  SELECT count(DISTINCT status) INTO v_bad FROM public.orders
   WHERE status NOT IN ('pending','inv_check','inventory_check','dispatch',
     'pi_requested','pi_generated','pi_payment_pending',
     'delivery_created','picking','packing','goods_issued','invoice_generated',
     'delivery_ready','eway_generated','pending_billing','eway_pending','goods_issue_posted','credit_check',
     'partial_dispatch','dispatched_fc','closed','cancelled');
  IF v_bad > 0 THEN RAISE EXCEPTION 'PRE-FLIGHT: % unknown status value(s) in orders — extend whitelist first', v_bad; END IF;

  -- 0b: no live batch of a cancelled order has posted quantities applied
  SELECT count(*) INTO v_bad FROM public.order_dispatches d
    JOIN public.orders o ON o.id = d.order_id
   WHERE o.status = 'cancelled' AND d.status NOT IN ('cancelled','dispatched_fc')
     AND d.posted_qty_applied_at IS NOT NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'PRE-FLIGHT: % orphan batch(es) already posted — needs manual review', v_bad; END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 1 · Cancel the orphan live batches of cancelled orders (the 9)
-- ─────────────────────────────────────────────────────────────────────
WITH fixed AS (
  UPDATE public.order_dispatches od
     SET status = 'cancelled', updated_at = now()
   WHERE od.status NOT IN ('cancelled','dispatched_fc')
     AND od.posted_qty_applied_at IS NULL
     AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = od.order_id AND o.status = 'cancelled')
  RETURNING od.order_id, od.batch_no, od.dc_number
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity, is_cancellation)
SELECT order_id, 'system',
       'Data correction: batch '||batch_no||' ('||COALESCE(dc_number,'—')||') marked cancelled to match the cancelled order [order_status_integrity]',
       '{}'::text[], true, true
FROM fixed;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 2 · Stamp lines of cancelled orders with unresolved qty (the 39)
--   cancelled_qty absolute = qty − posted; dispatched pulled down to
--   posted (releases in-flight, satisfies dispatched+cancelled ≤ qty)
-- ─────────────────────────────────────────────────────────────────────
WITH touched AS (
  UPDATE public.order_items oi
     SET cancelled_qty  = oi.qty - COALESCE(oi.posted_qty,0),
         dispatched_qty = COALESCE(oi.posted_qty,0),
         line_status    = CASE WHEN COALESCE(oi.posted_qty,0) = 0 THEN 'cancelled' ELSE 'short_closed' END,
         cancelled_at   = COALESCE(oi.cancelled_at, o.cancelled_at, o.updated_at, now()),
         cancel_reason  = COALESCE(oi.cancel_reason, 'Backfilled from order cancellation [order_status_integrity]')
    FROM public.orders o
   WHERE o.id = oi.order_id AND o.status = 'cancelled'
     AND COALESCE(oi.posted_qty,0) + COALESCE(oi.cancelled_qty,0) < oi.qty
  RETURNING oi.order_id
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity, is_cancellation)
SELECT DISTINCT order_id, 'system',
       'Data correction: line quantities stamped cancelled to match the cancelled order [order_status_integrity]',
       '{}'::text[], true, true
FROM touched;

-- STEP 2b · Cancelled orders where goods WERE issued → reclassify closed
-- ("cancelled" means nothing ever went out; goods-issued + rest-cancelled
--  is a CLOSED order. cancelled_at / cancelled_reason kept for audit.)
WITH flipped AS (
  UPDATE public.orders o
     SET status = 'closed', updated_at = now()
   WHERE o.status = 'cancelled'
     AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND COALESCE(oi.posted_qty,0) > 0)
  RETURNING o.id
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity)
SELECT id, 'system',
       'Data correction: goods were issued before cancellation — status reclassified cancelled → closed [order_status_integrity]',
       '{}'::text[], true
FROM flipped;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 3 · partial_dispatch orders that are fully resolved → dispatched_fc
-- ─────────────────────────────────────────────────────────────────────
WITH flipped AS (
  UPDATE public.orders o
     SET status = 'dispatched_fc', updated_at = now()
   WHERE o.status = 'partial_dispatch'
     AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
                       AND COALESCE(oi.posted_qty,0) + COALESCE(oi.cancelled_qty,0) < oi.qty)
     AND NOT EXISTS (SELECT 1 FROM public.order_dispatches d WHERE d.order_id = o.id
                       AND d.status NOT IN ('cancelled','dispatched_fc'))
     AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
                       AND COALESCE(oi.cancelled_qty,0) > 0)     -- any cancelled part ⇒ closed, handled next
  RETURNING o.id
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity)
SELECT id, 'system', 'Data correction: all quantity delivered — status completed to Delivered [order_status_integrity]', '{}'::text[], true
FROM flipped;

WITH flipped AS (
  UPDATE public.orders o
     SET status = 'closed', updated_at = now()
   WHERE o.status = 'partial_dispatch'
     AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
                       AND COALESCE(oi.posted_qty,0) + COALESCE(oi.cancelled_qty,0) < oi.qty)
     AND NOT EXISTS (SELECT 1 FROM public.order_dispatches d WHERE d.order_id = o.id
                       AND d.status NOT IN ('cancelled','dispatched_fc'))
  RETURNING o.id
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity)
SELECT id, 'system', 'Data correction: delivered + cancelled remainder — status set to Closed [order_status_integrity]', '{}'::text[], true
FROM flipped;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 4 · The 177 "Delivered" orders with undispatched qty → SURFACE
--          as partial_dispatch (USER DECISION: Variant A — show, don't
--          write off). They re-enter Waiting for Clearance for review.
-- ─────────────────────────────────────────────────────────────────────
WITH surfaced AS (
  UPDATE public.orders o
     SET status = 'partial_dispatch', updated_at = now()
   WHERE o.status = 'dispatched_fc'
     AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id
                   AND COALESCE(oi.posted_qty,0) + COALESCE(oi.cancelled_qty,0) < oi.qty)
  RETURNING o.id
)
INSERT INTO public.order_comments (order_id, author_name, message, tagged_users, is_activity)
SELECT id, 'system',
       'Data correction: order was marked Delivered while ordered quantity was never dispatched — reopened as Partially Dispatched for clearance review [order_status_integrity]',
       '{}'::text[], true
FROM surfaced;

-- ─────────────────────────────────────────────────────────────────────
-- STEP 5 · THE PERMANENT LOCK — integrity triggers
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_order_status_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_unresolved int; v_posted int; v_live int;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF current_setting('app.order_integrity_bypass', true) = 'on' THEN RETURN NEW; END IF;

  -- Whitelist (enforced on CHANGE only, so legacy rows never block other updates)
  IF NEW.status NOT IN ('pending','inv_check','inventory_check','dispatch',
    'pi_requested','pi_generated','pi_payment_pending',
    'delivery_created','picking','packing','goods_issued','invoice_generated',
    'delivery_ready','eway_generated','pending_billing','eway_pending','goods_issue_posted','credit_check',
    'partial_dispatch','dispatched_fc','closed','cancelled') THEN
    RAISE EXCEPTION 'Invalid order status "%"', NEW.status USING ERRCODE = '23514';
  END IF;

  -- cancelled is terminal
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Order is cancelled and cannot be reactivated' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('dispatched_fc','closed') THEN
    SELECT count(*) INTO v_unresolved FROM order_items
     WHERE order_id = NEW.id AND COALESCE(posted_qty,0) + COALESCE(cancelled_qty,0) < qty;
    IF v_unresolved > 0 THEN
      RAISE EXCEPTION 'Order cannot be marked %: % line(s) still have quantity neither delivered nor cancelled', NEW.status, v_unresolved
        USING ERRCODE = '23514', HINT = 'Dispatch the remaining quantity or cancel it first.';
    END IF;
  ELSIF NEW.status = 'cancelled' THEN
    SELECT count(*) INTO v_posted FROM order_items
     WHERE order_id = NEW.id AND COALESCE(posted_qty,0) > 0;
    IF v_posted > 0 THEN
      RAISE EXCEPTION 'Order cannot be cancelled: goods already issued on % line(s)', v_posted
        USING ERRCODE = '23514', HINT = 'Cancel the remaining quantity via the cancel drawer — the order will close, not cancel.';
    END IF;
    SELECT count(*) INTO v_live FROM order_dispatches
     WHERE order_id = NEW.id AND status NOT IN ('cancelled','dispatched_fc');
    IF v_live > 0 THEN
      RAISE EXCEPTION 'Order cannot be cancelled: % delivery batch(es) still active', v_live
        USING ERRCODE = '23514', HINT = 'Use the cancel drawer (Recall & Cancel) — it reverses active batches first.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_order_integrity ON public.orders;
CREATE TRIGGER trg_enforce_order_integrity
  BEFORE UPDATE ON public.orders FOR EACH ROW
  EXECUTE FUNCTION public.enforce_order_status_integrity();

CREATE OR REPLACE FUNCTION public.enforce_dispatch_status_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF current_setting('app.order_integrity_bypass', true) = 'on' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'cancelled' THEN
      RAISE EXCEPTION 'Cancelled batch cannot be reactivated' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'dispatched_fc' THEN
      RAISE EXCEPTION 'Delivered batch cannot change status (use the Return flow)' USING ERRCODE = '23514';
    END IF;
  END IF;

  -- No batch may be created or advanced under a cancelled order.
  -- (Setting a batch TO cancelled is always allowed — that is cleanup.)
  IF NEW.status IS DISTINCT FROM 'cancelled' THEN
    SELECT status INTO v_order_status FROM orders WHERE id = NEW.order_id;
    IF v_order_status = 'cancelled' THEN
      RAISE EXCEPTION 'Order is cancelled — batch cannot be created or advanced' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_dispatch_integrity ON public.order_dispatches;
CREATE TRIGGER trg_enforce_dispatch_integrity
  BEFORE INSERT OR UPDATE ON public.order_dispatches FOR EACH ROW
  EXECUTE FUNCTION public.enforce_dispatch_status_integrity();

-- ─────────────────────────────────────────────────────────────────────
-- STEP 6 · VERIFICATION — raise (rolling back EVERYTHING) on any violation
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE v1 int; v2 int; v3 int; v4 int; v5 int; v6 int;
BEGIN
  SELECT count(*) INTO v1 FROM public.orders o WHERE o.status='cancelled'
    AND EXISTS (SELECT 1 FROM public.order_dispatches d WHERE d.order_id=o.id AND d.status NOT IN ('cancelled','dispatched_fc'));
  SELECT count(*) INTO v2 FROM public.orders o WHERE o.status='cancelled'
    AND EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=o.id AND COALESCE(i.posted_qty,0)>0);
  SELECT count(*) INTO v3 FROM public.orders o WHERE o.status='cancelled'
    AND EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=o.id AND COALESCE(i.posted_qty,0)+COALESCE(i.cancelled_qty,0)<i.qty);
  SELECT count(*) INTO v4 FROM public.orders o WHERE o.status IN ('dispatched_fc','closed')
    AND EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=o.id AND COALESCE(i.posted_qty,0)+COALESCE(i.cancelled_qty,0)<i.qty);
  SELECT count(*) INTO v5 FROM public.orders o WHERE o.status='partial_dispatch'
    AND NOT EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=o.id AND COALESCE(i.posted_qty,0)+COALESCE(i.cancelled_qty,0)<i.qty)
    AND NOT EXISTS (SELECT 1 FROM public.order_dispatches d WHERE d.order_id=o.id AND d.status NOT IN ('cancelled','dispatched_fc'));
  SELECT count(*) INTO v6 FROM public.order_items
    WHERE COALESCE(dispatched_qty,0)+COALESCE(cancelled_qty,0)>qty OR COALESCE(posted_qty,0)>COALESCE(dispatched_qty,0);
  IF v1+v2+v3+v4+v5+v6 > 0 THEN
    RAISE EXCEPTION 'VERIFICATION FAILED (v1=% v2=% v3=% v4=% v5=% v6=%) — ROLLING BACK', v1,v2,v3,v4,v5,v6;
  END IF;
END $$;

COMMIT;

-- Post-run census (informational)
SELECT status, count(*) FROM public.orders GROUP BY 1 ORDER BY 2 DESC;
