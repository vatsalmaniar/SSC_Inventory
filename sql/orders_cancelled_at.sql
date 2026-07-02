-- ─────────────────────────────────────────────────────────────────────
-- ORDERS.CANCELLED_AT — header-level cancellation timestamp + backfill
-- Apply via Supabase SQL editor BEFORE deploying the OrdersList/OrderDetail
-- changes that read/write this column.
-- Purely additive: one new nullable column, backfill only fills NULLs on
-- already-cancelled orders. No row deleted, no existing value modified.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Column
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 2. Backfill existing cancelled orders, best source first:
--    a) latest is_cancellation activity comment (exact moment of cancellation —
--       written by BOTH the full-cancel path and the cancel_order_lines RPC)
UPDATE public.orders o
SET cancelled_at = c.cancelled_at
FROM (
  SELECT order_id, max(created_at) AS cancelled_at
  FROM public.order_comments
  WHERE is_cancellation = true
  GROUP BY order_id
) c
WHERE o.id = c.order_id
  AND o.status = 'cancelled'
  AND o.cancelled_at IS NULL;

--    b) latest line-level cancelled_at (RPC-cancelled orders without a comment)
UPDATE public.orders o
SET cancelled_at = i.cancelled_at
FROM (
  SELECT order_id, max(cancelled_at) AS cancelled_at
  FROM public.order_items
  WHERE cancelled_at IS NOT NULL
  GROUP BY order_id
) i
WHERE o.id = i.order_id
  AND o.status = 'cancelled'
  AND o.cancelled_at IS NULL;

--    c) last resort: updated_at (cancellation is normally the final update
--       on a cancelled order)
UPDATE public.orders
SET cancelled_at = updated_at
WHERE status = 'cancelled'
  AND cancelled_at IS NULL
  AND updated_at IS NOT NULL;

-- 3. Verify: every cancelled order should now have a date
SELECT count(*) AS cancelled_missing_date
FROM public.orders
WHERE status = 'cancelled' AND cancelled_at IS NULL;
