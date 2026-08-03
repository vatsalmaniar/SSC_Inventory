-- ═══════════════════════════════════════════════════════════════════════════
-- PO status-transition + approval integrity guard   (F-06 of the 2026-08-03
-- CO/Procurement red-team audit)
--
-- ⚠️  NOT APPLIED. This file is for review only. Read the rollout plan at the
--     bottom before running anything.
--
-- WHY: today the approval gate, the admin-only cancel gate and the pipeline
-- order exist ONLY in React (PurchaseOrderDetail.jsx:1241, :1307). At the
-- database, `role_update` (procurement_patch_v2.sql:296-297) lets any
-- admin/ops/accounts/management user PATCH purchase_orders.status or
-- total_amount to anything via PostgREST. There is no PO-side equivalent of
-- the orders trigger (order_status_integrity.sql).
--
-- SHIPS IN LOG-ONLY MODE. Nothing is blocked until you flip the switch. For a
-- week it records what it WOULD have blocked, so a missing legitimate
-- transition shows up as a log row instead of a production outage.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Violation log (also the audit trail of attempted forgeries) ──────────
CREATE TABLE IF NOT EXISTS public.po_guard_violations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         uuid,
  po_number     text,
  violation     text NOT NULL,          -- 'transition' | 'approval_role' | 'self_approval' | 'cancel_role'
  detail        text NOT NULL,
  old_status    text,
  new_status    text,
  actor_id      uuid,
  actor_name    text,
  actor_role    text,
  would_block   boolean NOT NULL,       -- true = enforce mode would have rejected
  created_at    timestamptz DEFAULT now()
);
ALTER TABLE public.po_guard_violations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_guard_read ON public.po_guard_violations;
CREATE POLICY po_guard_read ON public.po_guard_violations FOR SELECT TO authenticated USING (true);
-- writes only from the SECURITY DEFINER trigger below
REVOKE INSERT, UPDATE, DELETE ON public.po_guard_violations FROM authenticated;

-- ── 2. Mode switch: 'log' (default) or 'enforce' ────────────────────────────
CREATE TABLE IF NOT EXISTS public.po_guard_config (
  id       int PRIMARY KEY DEFAULT 1,
  mode     text NOT NULL DEFAULT 'log' CHECK (mode IN ('log','enforce')),
  CONSTRAINT po_guard_config_singleton CHECK (id = 1)
);
INSERT INTO public.po_guard_config (id, mode) VALUES (1, 'log') ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.po_guard_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_guard_cfg_read ON public.po_guard_config;
CREATE POLICY po_guard_cfg_read ON public.po_guard_config FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.po_guard_config FROM authenticated;  -- change via SQL only

-- ── 3. The guard ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_po_status_integrity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_mode        text;
  v_role        text;
  v_name        text;
  v_allowed     text[];
  v_block       boolean;
  v_violation   text := NULL;
  v_detail      text := NULL;
BEGIN
  -- Only interested in status changes.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  SELECT mode INTO v_mode FROM public.po_guard_config WHERE id = 1;
  v_mode := COALESCE(v_mode, 'log');
  v_block := (v_mode = 'enforce');

  -- Service-role / migration paths (no auth.uid()) are exempt: repair scripts
  -- and the GRN RPC (confirm_grn) must keep working.
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT role, name INTO v_role, v_name FROM public.profiles WHERE id = auth.uid();
  v_role := COALESCE(v_role, '');

  -- 3a. Legal transitions. 'pending_approval' is reachable from every live
  --     post-approval state on purpose — that is the amendment path
  --     (PurchaseOrderDetail.saveEdit sends a commercially-changed PO back).
  v_allowed := CASE OLD.status
    WHEN 'draft'                 THEN ARRAY['pending_approval','cancelled']
    WHEN 'pending_approval'      THEN ARRAY['approved','draft','cancelled']
    WHEN 'approved'              THEN ARRAY['placed','pending_approval','cancelled']
    WHEN 'placed'                THEN ARRAY['acknowledged','delivery_confirmation','partially_received','material_received','pending_approval','cancelled']
    WHEN 'acknowledged'          THEN ARRAY['delivery_confirmation','partially_received','material_received','pending_approval','cancelled']
    WHEN 'delivery_confirmation' THEN ARRAY['partially_received','material_received','pending_approval','cancelled']
    WHEN 'partially_received'    THEN ARRAY['partially_received','material_received','pending_approval','cancelled']
    WHEN 'material_received'     THEN ARRAY['closed','cancelled']
    WHEN 'received'              THEN ARRAY['closed','cancelled','material_received']  -- legacy rows
    WHEN 'closed'                THEN ARRAY[]::text[]
    WHEN 'cancelled'             THEN ARRAY[]::text[]
    ELSE NULL                                   -- unknown current status: don't judge
  END;

  IF v_allowed IS NOT NULL AND NOT (NEW.status = ANY(v_allowed)) THEN
    v_violation := 'transition';
    v_detail := format('%s → %s is not a legal PO transition', OLD.status, NEW.status);
  END IF;

  -- 3b. Approval is admin/management only.
  IF v_violation IS NULL AND NEW.status = 'approved' AND v_role NOT IN ('admin','management') THEN
    v_violation := 'approval_role';
    v_detail := format('role "%s" may not approve a PO', v_role);
  END IF;

  -- 3c. No self-approval: the person who raised it cannot approve it.
  --     Name-based because submitted_by_name is what the PO stores.
  IF v_violation IS NULL AND NEW.status = 'approved'
     AND NEW.submitted_by_name IS NOT NULL AND v_name IS NOT NULL
     AND lower(btrim(NEW.submitted_by_name)) = lower(btrim(v_name)) THEN
    v_violation := 'self_approval';
    v_detail := format('%s raised this PO and cannot approve it', v_name);
  END IF;

  -- 3d. Cancellation is admin only (mirrors the UI gate).
  IF v_violation IS NULL AND NEW.status = 'cancelled' AND v_role <> 'admin' THEN
    v_violation := 'cancel_role';
    v_detail := format('role "%s" may not cancel a PO', v_role);
  END IF;

  IF v_violation IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.po_guard_violations
    (po_id, po_number, violation, detail, old_status, new_status, actor_id, actor_name, actor_role, would_block)
  VALUES
    (NEW.id, NEW.po_number, v_violation, v_detail, OLD.status, NEW.status, auth.uid(), v_name, v_role, v_block);

  IF v_block THEN
    RAISE EXCEPTION 'PO integrity: %', v_detail USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;   -- log-only mode: allow, but recorded
END $fn$;

DROP TRIGGER IF EXISTS trg_enforce_po_status ON public.purchase_orders;
CREATE TRIGGER trg_enforce_po_status
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_po_status_integrity();

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLOUT
--   1. Apply this file. Nothing is blocked — mode is 'log'.
--   2. Run for ~1 week. Review daily:
--        SELECT violation, old_status, new_status, actor_role, count(*)
--        FROM po_guard_violations GROUP BY 1,2,3,4 ORDER BY 5 DESC;
--      Every row is either (a) a real forgery/mistake — good, we caught it, or
--      (b) a legitimate transition missing from the map above — fix the map,
--      re-apply, keep logging. Do NOT enforce while (b) rows are appearing.
--   3. When a full week is clean of type-(b) rows:
--        UPDATE po_guard_config SET mode = 'enforce' WHERE id = 1;
--      Takes effect immediately, no redeploy.
--   4. Panic switch (instant, no downtime):
--        UPDATE po_guard_config SET mode = 'log' WHERE id = 1;
--
-- ROLLBACK (removes the guard entirely; keeps the log table):
--   DROP TRIGGER IF EXISTS trg_enforce_po_status ON public.purchase_orders;
--   DROP FUNCTION IF EXISTS public.enforce_po_status_integrity();
--
-- NOT COVERED by this trigger (deliberate, needs its own decision):
--   • total_amount / qty / price edits are not blocked here — F-01 handles
--     those in the app by forcing re-approval. A DB-side rule would also need
--     to allow the amendment path, and belongs in a second phase.
--   • auth.uid() IS NULL is exempt, so a service-role key still bypasses
--     everything. That is required for confirm_grn and repair scripts today.
-- ═══════════════════════════════════════════════════════════════════════════
