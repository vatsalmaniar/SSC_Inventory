-- ============================================================================
-- Early Credit Check — move credit gate BEFORE picking (batch creation time)
-- ============================================================================
-- Design: credit check is a per-batch FLAG (order_dispatches.credit_checked),
-- not a new status. A batch cannot move to 'picking' until credit is cleared.
-- Sample / Against PI / Advance orders are auto-cleared at batch creation.
--
-- The 3 user-facing states are derived from two existing batch columns:
--   credit_checked=true                      -> Approved   (FC can pick)
--   credit_checked=false, credit_override=f  -> Pending    (awaiting Accounts)
--   credit_checked=false, credit_override=t  -> On Hold    (payment pending)
--
-- ROLLOUT ORDER:
--   STEP 0 (already applied, inert): ALTER TABLE ... ADD COLUMN credit_checked
--           boolean NOT NULL DEFAULT true;   (existing rows all true => safe)
--   STEP 1 (this file, APPLY AT GO-LIVE WITH THE FRONTEND DEPLOY):
--           the gate trigger + create_order_dispatch bypass below.
--
-- DO NOT apply STEP 1 before the frontend is deployed, or new normal orders
-- will require an Accounts approval the production UI can't yet give.
-- ============================================================================

-- Idempotent guard (no-op if STEP 0 already ran).
-- credit_checked_at distinguishes a GENUINE early approval (timestamp set) from a
-- pre-launch backfilled batch (null) so in-flight orders keep the old billing flow.
ALTER TABLE order_dispatches
  ADD COLUMN IF NOT EXISTS credit_checked boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS credit_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_checked_by uuid;

-- ----------------------------------------------------------------------------
-- 1. THE GATE — block delivery_created -> picking until credit_checked = true
--    (Verified 2026-06-07 via zero-footprint transaction-rollback test.)
--    Placed BEFORE the auth.uid() early-return so it is UNIVERSAL: no path —
--    client, RPC, or service role — can move a batch to picking uncleared.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_dispatch_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE v_role text;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  -- >>> EARLY CREDIT GATE <<<
  IF NEW.status = 'picking' AND COALESCE(NEW.credit_checked, false) = false THEN
    RAISE EXCEPTION 'Credit check not cleared - cannot move batch to picking';
  END IF;

  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IN ('admin', 'ops', 'management') THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN RAISE EXCEPTION 'Only admin can cancel dispatches'; END IF;

  IF v_role = 'accounts' THEN
    IF NEW.status IN ('credit_check', 'goods_issue_posted', 'invoice_generated',
                      'pi_generated', 'pi_payment_pending', 'delivery_created', 'eway_generated') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Accounts role cannot set dispatch status to "%"', NEW.status;
  END IF;

  IF v_role IN ('fc_kaveri', 'fc_godawari') THEN
    IF NEW.status IN ('picking', 'packing', 'goods_issued', 'invoice_generated',
                      'delivery_ready', 'eway_generated', 'dispatched_fc') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FC role cannot set dispatch status to "%"', NEW.status;
  END IF;

  RAISE EXCEPTION 'Role "%" cannot change dispatch status', COALESCE(v_role, 'unknown');
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. BATCH CREATION — set credit_checked at creation.
--    Normal orders -> false (need Accounts approval before picking).
--    Sample / Against PI / Advance -> true (auto-cleared; payment not on credit).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_order_dispatch(p_order_id uuid, p_fulfilment_center text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_batch_no int;
  v_yr1 int;
  v_fy text;
  v_seq int;
  v_dc text;
  v_dispatch_id uuid;
  v_order_type text;
  v_credit_terms text;
  v_credit_checked boolean;
BEGIN
  SELECT COALESCE(MAX(batch_no), 0) + 1 INTO v_batch_no FROM order_dispatches WHERE order_id = p_order_id;
  IF extract(month FROM current_date) >= 4 THEN v_yr1 := extract(year FROM current_date)::int;
  ELSE v_yr1 := extract(year FROM current_date)::int - 1; END IF;
  v_fy := lpad((v_yr1 % 100)::text, 2, '0') || '-' || lpad(((v_yr1+1) % 100)::text, 2, '0');
  INSERT INTO order_number_counters (fy, order_type, last_seq) VALUES (v_fy, 'DC', 1)
  ON CONFLICT (fy, order_type) DO UPDATE SET last_seq = order_number_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  v_dc := 'Temp/DC' || lpad(v_seq::text, 4, '0') || '/' || v_fy;

  -- Credit-check bypass: samples and prepaid terms skip the gate (case-insensitive).
  SELECT order_type, COALESCE(credit_terms, '') INTO v_order_type, v_credit_terms
  FROM orders WHERE id = p_order_id;
  v_credit_checked := (
    upper(coalesce(v_order_type, '')) = 'SAMPLE'
    OR lower(btrim(v_credit_terms)) IN ('against pi', 'advance')
  );

  INSERT INTO order_dispatches (order_id, batch_no, fulfilment_center, dc_number, dispatched_items, credit_checked)
  VALUES (p_order_id, v_batch_no, p_fulfilment_center, v_dc, p_items, v_credit_checked)
  RETURNING id INTO v_dispatch_id;

  RETURN jsonb_build_object('id', v_dispatch_id, 'dc_number', v_dc, 'batch_no', v_batch_no);
END;
$function$;

-- ============================================================================
-- ROLLBACK (if needed): restore the original trigger + RPC (no credit gate).
-- The credit_checked column is harmless to leave in place. Original definitions
-- are preserved in git history / the introspection dump from 2026-06-07.
-- ============================================================================
