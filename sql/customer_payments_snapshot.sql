-- Customer payment receivables snapshot — sourced from accounts' "Pending Payment" Excel.
-- One row per party. Cleared and reloaded on each import.
-- v1: data-only, no UI upload yet (use seeded data from initial import).

CREATE TABLE IF NOT EXISTS public.customer_payments_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_name_raw  text NOT NULL,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  outstanding_inr numeric NOT NULL DEFAULT 0,
  overdue_inr     numeric NOT NULL DEFAULT 0,
  bill_count      int NOT NULL DEFAULT 0,
  imported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cps_customer ON public.customer_payments_snapshot(customer_id);
CREATE INDEX IF NOT EXISTS idx_cps_name_lower ON public.customer_payments_snapshot(lower(party_name_raw));

-- RLS: any authenticated user can read (used by Customer 360 widget).
-- Inserts/updates handled by admin/accounts during upload.
ALTER TABLE public.customer_payments_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read" ON public.customer_payments_snapshot;
CREATE POLICY "auth_read" ON public.customer_payments_snapshot FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "role_write" ON public.customer_payments_snapshot;
CREATE POLICY "role_write" ON public.customer_payments_snapshot
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','accounts','management'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','accounts','management'))
  );
