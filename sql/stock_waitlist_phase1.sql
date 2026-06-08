-- ============================================================================
-- Stock Waitlist + FIFO dispatch priority — PHASE 1 (additive)
-- ============================================================================
-- All changes here are ADDITIVE and were applied live before the frontend deploy.
-- No dispatch RPC is changed in Phase 1 (the atomic dispatch fix is Phase 2).
--
-- Frontend behaviour these support:
--   - "Partial Deliveries Allowed" toggle on orders (gates partial-dispatch).
--   - FIFO warning when dispatching ahead of an older order waiting on the same
--     out-of-stock item (logs the reason to dispatch_skip_log).
--   - "Waiting for Stock" page (read-only, derived from order_items).
--   - Out-of-stock log insert fixed in the frontend (column names now match this
--     table: item_id / logged_by / logged_by_name — no schema change needed).
-- ============================================================================

-- 1. Per-order flag: does the customer accept partial deliveries?
--    DEFAULT false for NEW orders (full-only unless toggled on). Existing rows
--    were grandfathered to TRUE so in-flight orders keep partial-dispatch.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS partial_deliveries_allowed boolean NOT NULL DEFAULT false;

-- 2. Audit trail for FIFO queue-jumps: who dispatched ahead of whom, and why.
CREATE TABLE IF NOT EXISTS dispatch_skip_log (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatched_order_id      uuid,
  dispatched_order_number  text,
  skipped_order_id         uuid,
  skipped_order_number     text,
  item_code                text,
  reason                   text,
  reason_note              text,
  created_by               uuid,
  created_by_name          text,
  created_at               timestamptz DEFAULT now()
);
ALTER TABLE dispatch_skip_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_all ON dispatch_skip_log;
CREATE POLICY auth_all ON dispatch_skip_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PHASE 2 (separate, later): make dispatch atomic — a single
-- dispatch_order_batch RPC wrapping increment_dispatched_qty + create_order_dispatch
-- + status update in one transaction. Parity-tested vs the current flow first.
-- ============================================================================
