-- ============================================================================
-- Atomic dispatch — PHASE 2: dispatch_order_batch RPC
-- ============================================================================
-- Replaces the frontend's 4 separate network calls per dispatch
-- (N x increment_dispatched_qty -> orders.update -> create_order_dispatch ->
--  PI follow-up update) with ONE transactional RPC. Any failure rolls back
-- every step, eliminating the half-dispatched states documented in
-- LEARNING.md §26 / sql/stock_waitlist_phase1.sql.
--
-- FAITHFUL WRAPPER, NOT NEW LOGIC:
--   - Per-line increments still go through increment_dispatched_qty
--     (row lock + overage guard, untouched).
--   - Batch creation still goes through create_order_dispatch
--     (batch_no, DC counter, credit-check bypass, untouched).
--   - orders.status update is role-gated by trg_validate_order_status exactly
--     as the direct client UPDATE was (function is invoker-rights on purpose —
--     do NOT add SECURITY DEFINER, it would bypass the role gates).
--   - PI derivation uses the same case-insensitive expression
--     create_order_dispatch already uses (lower/btrim). The old frontend used
--     exact match; live data audit 2026-06-10 found all credit_terms values
--     clean, so behaviour is identical for every existing row.
--
-- KNOWN PRE-EXISTING QUIRK (kept for parity, NOT fixed here): the frontend's
-- full-dispatch p_items lists ALL order lines at FULL ordered qty, even lines
-- partially cancelled — so dispatched_items can overstate vs the increments.
-- mark_batch_posted walks dispatched_items at GI-post; a full dispatch after a
-- partial cancel could then trip order_items_posted_within_dispatched.
-- Fix belongs in the frontend itemsJson builder, as a separate change.
--
-- ROLLOUT: applied to DB first (inert — nothing calls it), frontend cutover
-- deployed after localhost testing. Rollback = revert the frontend commit;
-- this function is harmless to leave in place.
--
-- Parity-verified 2026-06-10 via zero-footprint rollback test (old 4-step flow
-- vs this RPC on the same real order inside one aborted transaction).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dispatch_order_batch(
  p_order_id          uuid,
  p_fulfilment_center text,
  p_items             jsonb,  -- batch contents for order_dispatches.dispatched_items (same shape the frontend builds today)
  p_increments        jsonb   -- [{order_item_id, qty}] exact per-line dispatched_qty increments
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_inc            jsonb;
  v_item_id        uuid;
  v_qty            numeric;
  v_order_type     text;
  v_credit_terms   text;
  v_is_pi          boolean;
  v_batch          jsonb;
  v_credit_checked boolean;
  v_lines          int := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'dispatch_order_batch: p_items must be a non-empty json array';
  END IF;
  IF p_increments IS NULL OR jsonb_typeof(p_increments) <> 'array' OR jsonb_array_length(p_increments) = 0 THEN
    RAISE EXCEPTION 'dispatch_order_batch: p_increments must be a non-empty json array';
  END IF;

  SELECT order_type, COALESCE(credit_terms, '') INTO v_order_type, v_credit_terms
  FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispatch_order_batch: order % not found', p_order_id;
  END IF;

  -- Against PI / Advance (non-sample) -> order goes to pi_requested instead of
  -- delivery_created. Same expression create_order_dispatch uses for the
  -- credit-check bypass, so the two can never disagree again.
  v_is_pi := upper(coalesce(v_order_type, '')) <> 'SAMPLE'
         AND lower(btrim(v_credit_terms)) IN ('against pi', 'advance');

  -- 1. Per-line increments (existing proven function: FOR UPDATE lock + overage guard).
  FOR v_inc IN SELECT * FROM jsonb_array_elements(p_increments) LOOP
    v_item_id := (v_inc->>'order_item_id')::uuid;
    v_qty     := (v_inc->>'qty')::numeric;
    IF v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'dispatch_order_batch: invalid increment entry %', v_inc;
    END IF;
    PERFORM public.increment_dispatched_qty(v_item_id, v_qty);
    v_lines := v_lines + 1;
  END LOOP;

  -- 2. Order status + FC (role-gated by trg_validate_order_status, same as the
  --    direct client UPDATE it replaces).
  UPDATE orders
     SET status            = CASE WHEN v_is_pi THEN 'pi_requested' ELSE 'delivery_created' END,
         fulfilment_center = p_fulfilment_center,
         updated_at        = now()
   WHERE id = p_order_id;

  -- 3. Batch row (existing proven function: batch_no, DC number, credit bypass).
  v_batch := public.create_order_dispatch(p_order_id, p_fulfilment_center, p_items);

  -- 4. PI follow-up on the new batch (was a separate, silently-unchecked client call).
  IF v_is_pi THEN
    UPDATE order_dispatches
       SET pi_required = true, status = 'pi_requested'
     WHERE id = (v_batch->>'id')::uuid;
  END IF;

  SELECT credit_checked INTO v_credit_checked
  FROM order_dispatches WHERE id = (v_batch->>'id')::uuid;

  -- Superset of create_order_dispatch's return; also closes the §26.8 gap
  -- (credit_checked was never returned to callers).
  RETURN v_batch || jsonb_build_object('is_pi', v_is_pi, 'lines', v_lines, 'credit_checked', v_credit_checked);
END;
$function$;

-- Lock down execution: app users only (VAPT baseline — anon gets nothing).
REVOKE ALL ON FUNCTION public.dispatch_order_batch(uuid, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_order_batch(uuid, text, jsonb, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (only if abandoning Phase 2 entirely; safe to leave in place):
--   DROP FUNCTION public.dispatch_order_batch(uuid, text, jsonb, jsonb);
-- Frontend rollback = revert the cutover commit (restores the 4-call flow).
-- ============================================================================
