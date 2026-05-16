-- ═══════════════════════════════════════════════════════════════════
-- Audit columns rollout — created_by / updated_by / created_at / updated_at
-- across all operational tables.
--
-- Strategy:
--   1. Add nullable audit columns to every target table (idempotent).
--   2. Single trigger function set_audit_cols() that:
--        BEFORE INSERT: sets created_by = auth.uid() if NULL
--                       sets created_at = now() if NULL
--        BEFORE UPDATE: sets updated_by = auth.uid()
--                       sets updated_at = now()
--   3. Attach the trigger to every target table.
--
-- Historical rows keep NULL for new columns — that's expected; we can't
-- reconstruct who created them.
-- ═══════════════════════════════════════════════════════════════════

-- ── Trigger function ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_audit_cols()
RETURNS trigger AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL AND v_uid IS NOT NULL THEN NEW.created_by := v_uid; END IF;
    IF NEW.created_at IS NULL THEN NEW.created_at := now(); END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_uid IS NOT NULL THEN NEW.updated_by := v_uid; END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Helper to add columns + trigger idempotently ─────────────────
CREATE OR REPLACE FUNCTION _ensure_audit_cols(p_table text)
RETURNS void AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by uuid', p_table);
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by uuid', p_table);
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()', p_table);
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz', p_table);
  EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_cols ON public.%I', p_table);
  EXECUTE format('CREATE TRIGGER trg_audit_cols BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_audit_cols()', p_table);
END;
$$ LANGUAGE plpgsql;

-- ── Apply to all operational tables ──────────────────────────────
DO $$
DECLARE
  t text;
  targets text[] := ARRAY[
    -- Sales
    'orders','order_items','order_dispatches',
    -- Procurement
    'purchase_orders','po_items','po_delivery_dates',
    'grn','grn_items','purchase_invoices',
    -- Master data
    'customers','customer_contacts',
    'vendors','vendor_contacts',
    'items',
    -- CRM
    'crm_leads','crm_opportunities','crm_companies','crm_contacts',
    'crm_tasks','crm_quotes','crm_quote_items',
    'crm_field_visits','crm_sample_requests',
    -- Stock
    'stock_transfers','stock_transfer_items'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    -- Skip tables that don't exist (safety net)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      PERFORM _ensure_audit_cols(t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION _ensure_audit_cols(text);
