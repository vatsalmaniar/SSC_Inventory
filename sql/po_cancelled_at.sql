-- ─────────────────────────────────────────────────────────────────────
-- PURCHASE_ORDERS.CANCELLED_AT — cancellation timestamp + backfill
-- Mirrors sql/orders_cancelled_at.sql. Run in Supabase SQL editor BEFORE
-- deploying the PO-list "Cancelled On" filter code.
-- Purely additive: one nullable column; backfill fills NULLs on already-
-- cancelled POs only. No row deleted, no existing value modified.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Backfill 1: latest cancellation activity comment (exact moment)
UPDATE public.purchase_orders p
SET cancelled_at = c.cancelled_at
FROM (
  SELECT po_id, max(created_at) AS cancelled_at
  FROM public.po_comments
  WHERE is_activity = true AND message ILIKE '%cancel%'
  GROUP BY po_id
) c
WHERE p.id = c.po_id
  AND p.status = 'cancelled'
  AND p.cancelled_at IS NULL;

-- Backfill 2: last resort — updated_at (cancellation is normally the
-- final update on a cancelled PO)
UPDATE public.purchase_orders
SET cancelled_at = updated_at
WHERE status = 'cancelled'
  AND cancelled_at IS NULL
  AND updated_at IS NOT NULL;

-- Verify: should be 0
SELECT count(*) AS cancelled_missing_date
FROM public.purchase_orders
WHERE status = 'cancelled' AND cancelled_at IS NULL;
