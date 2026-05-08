-- ─────────────────────────────────────────────────────────────────────
-- POSTED QTY MODEL — splits "in-flight at FC" from "GI-posted by Accounts".
-- Apply via Supabase. Purely additive: no existing column/value modified.
--
-- Semantic recap (see project_dispatch_pipeline_rules memory):
--   * dispatched_qty (existing) — incremented at delivery_created. Reserves
--     the qty in an active batch so Ops cannot double-batch. Internal use.
--   * posted_qty (NEW) — incremented at goods_issue_posted. This is the
--     cancellation cutoff and the user-visible "pending" pivot.
--   * "Delivered" total — computed at runtime from order_dispatches
--     where status='dispatched_fc'. No column needed.
--
-- Pending (user-visible)   = qty − posted_qty − cancelled_qty
-- Cancellable              = same formula
-- Available for NEW batch  = qty − dispatched_qty − cancelled_qty
-- ─────────────────────────────────────────────────────────────────────

-- 1. New column on order_items
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS posted_qty numeric NOT NULL DEFAULT 0;

-- Invariant: posted_qty cannot exceed dispatched_qty (you can only post what
-- was actually dispatched), and (dispatched + cancelled) cannot exceed qty.
-- The dispatched+cancelled rule already exists (order_items_cancel_within_pending).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_posted_within_dispatched'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_posted_within_dispatched
      CHECK (posted_qty >= 0 AND posted_qty <= COALESCE(dispatched_qty, 0));
  END IF;
END $$;

-- 2. Tracking column on order_dispatches so the GI-post RPC is idempotent.
ALTER TABLE public.order_dispatches
  ADD COLUMN IF NOT EXISTS posted_qty_applied_at timestamptz;

-- 3. RPC: mark_batch_posted
--    Called by BillingOrderDetail after flipping a batch's status to
--    goods_issue_posted. Walks dispatched_items, increments posted_qty
--    per line by that batch's qty contribution. Idempotent.
--
--    Note for FUTURE inventory work:
--      ▸ This is the canonical "Accounts has posted GI" event.
--      ▸ When inventory tracking is added, deduct inventory HERE
--        (or call a helper RPC from inside this function).
--      ▸ Reversal of GI-post is not currently supported; any reversal
--        must also reverse inventory.
CREATE OR REPLACE FUNCTION public.mark_batch_posted(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatch       record;
  v_item           jsonb;
  v_item_id        uuid;
  v_qty            numeric;
  v_total_applied  numeric := 0;
  v_lines          int := 0;
BEGIN
  SELECT id, order_id, status, dispatched_items, posted_qty_applied_at
    INTO v_dispatch
    FROM public.order_dispatches
    WHERE id = p_dispatch_id
    FOR UPDATE;

  IF v_dispatch IS NULL THEN
    RAISE EXCEPTION 'mark_batch_posted: dispatch % not found', p_dispatch_id;
  END IF;

  -- Idempotency: if already applied, no-op
  IF v_dispatch.posted_qty_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_applied', true, 'applied_at', v_dispatch.posted_qty_applied_at);
  END IF;

  -- Safety: must be at goods_issue_posted (or beyond) before this fires
  IF v_dispatch.status NOT IN ('goods_issue_posted', 'invoice_generated', 'dispatched_fc') THEN
    RAISE EXCEPTION 'mark_batch_posted: dispatch % is at status %, expected goods_issue_posted or beyond',
      p_dispatch_id, v_dispatch.status;
  END IF;

  -- Walk dispatched_items, increment posted_qty per line
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_dispatch.dispatched_items)
  LOOP
    v_item_id := (v_item->>'order_item_id')::uuid;
    v_qty     := (v_item->>'qty')::numeric;
    IF v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.order_items
      SET posted_qty = COALESCE(posted_qty, 0) + v_qty
      WHERE id = v_item_id;

    v_total_applied := v_total_applied + v_qty;
    v_lines := v_lines + 1;
  END LOOP;

  -- Mark applied so subsequent calls no-op
  UPDATE public.order_dispatches
    SET posted_qty_applied_at = now()
    WHERE id = p_dispatch_id;

  RETURN jsonb_build_object('ok', true, 'applied_qty', v_total_applied, 'lines', v_lines);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_batch_posted(uuid) TO authenticated;

-- 4. Backfill posted_qty for HISTORICAL orders.
--    For any line whose batches have already reached goods_issue_posted (or
--    beyond), set posted_qty to the sum of those batches' contributions and
--    mark those batches as already-applied so the RPC stays idempotent.
--
--    Run inside a single transaction. Safe: only writes the new column +
--    new tracking column, never touches qty / dispatched_qty / cancelled_qty.
DO $$
DECLARE
  v_total_lines int := 0;
  v_total_batches int := 0;
BEGIN
  -- 4a. Per-line: sum qty across already-posted batches
  WITH posted_lines AS (
    SELECT
      (di->>'order_item_id')::uuid AS item_id,
      SUM((di->>'qty')::numeric)   AS posted_total
    FROM public.order_dispatches od,
         jsonb_array_elements(od.dispatched_items) di
    WHERE od.status IN ('goods_issue_posted','invoice_generated','dispatched_fc')
      AND (di->>'order_item_id') IS NOT NULL
    GROUP BY (di->>'order_item_id')::uuid
  )
  UPDATE public.order_items oi
    SET posted_qty = LEAST(pl.posted_total, COALESCE(oi.dispatched_qty, 0))
    FROM posted_lines pl
    WHERE oi.id = pl.item_id
      AND oi.posted_qty = 0;  -- only touch never-backfilled rows

  GET DIAGNOSTICS v_total_lines = ROW_COUNT;

  -- 4b. Mark those batches as applied so future GI-post RPC calls no-op
  UPDATE public.order_dispatches
    SET posted_qty_applied_at = now()
    WHERE status IN ('goods_issue_posted','invoice_generated','dispatched_fc')
      AND posted_qty_applied_at IS NULL;

  GET DIAGNOSTICS v_total_batches = ROW_COUNT;

  RAISE NOTICE 'Backfill complete: % order_items lines updated, % batches marked applied.',
    v_total_lines, v_total_batches;
END $$;
