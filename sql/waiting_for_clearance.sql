-- ─────────────────────────────────────────────────────────────────────
-- WAITING FOR CLEARANCE — manual hold flags on orders
-- Apply via Supabase SQL editor BEFORE deploying the page code.
-- Purely additive: four nullable columns + CHECK whitelists.
-- No row deleted, no existing value modified.
--
-- Auto flags (Credit Hold, Out of Stock, PI Payment) need NO schema —
-- they come from existing credit_override / stock_status / status.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS hold_party    text,         -- 'sales' | 'customer'
  ADD COLUMN IF NOT EXISTS hold_reason   text,         -- whitelisted per party
  ADD COLUMN IF NOT EXISTS hold_set_by   text,         -- display name of flagger (for sales holds: the responsible rep)
  ADD COLUMN IF NOT EXISTS hold_set_at   timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_hold_party_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_hold_party_check
      CHECK (hold_party IS NULL OR hold_party IN ('sales','customer'));
  END IF;
  -- (re)create so reason edits are idempotent — must mirror REASONS in Waitlist.jsx
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_hold_reason_check') THEN
    ALTER TABLE public.orders DROP CONSTRAINT orders_hold_reason_check;
  END IF;
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_hold_reason_check
    CHECK (hold_reason IS NULL OR hold_reason IN (
      -- held by sales
      'Payment follow-up','Customer confirmation pending','Order change expected','PO/price issue',
      -- held by customer
      'Project not ready','Machines not ready',
      -- either
      'Other'
    ));
  -- a reason requires a party and vice versa (flag is set/cleared as a unit)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_hold_pair_check') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_hold_pair_check
      CHECK ((hold_party IS NULL) = (hold_reason IS NULL));
  END IF;
END $$;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders'
  AND column_name IN ('hold_party','hold_reason','hold_set_by','hold_set_at');
