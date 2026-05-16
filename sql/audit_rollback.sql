-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK for audit_columns_rollout.sql
--
-- Applied: 2026-05-16. Adds created_by/updated_by/created_at/updated_at
-- + trg_audit_cols trigger to 25 operational tables.
--
-- This rollback:
--   1. Drops the trigger from every table it's attached to.
--   2. Drops the trigger function.
--   3. Leaves the audit COLUMNS in place (additive, harmless).
--      If you want to drop the columns too, see the optional block at
--      the bottom — but only do that if you're sure no UI reads them.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT DISTINCT event_object_table
    FROM information_schema.triggers
    WHERE trigger_name = 'trg_audit_cols'
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS trg_audit_cols ON public.' || quote_ident(t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS set_audit_cols();

-- ─── OPTIONAL: drop the audit columns too ───────────────────────
-- Only run this if you're certain no UI or RPC reads them.
-- Skip tables that originally had created_at/updated_at; only drop
-- created_by / updated_by which were definitively added by the
-- rollout. (created_at/updated_at may have pre-existed on some tables.)
/*
DO $$
DECLARE t text;
  targets text[] := ARRAY[
    'orders','order_items','order_dispatches',
    'purchase_orders','po_items','po_delivery_dates',
    'grn','grn_items','purchase_invoices',
    'customers','customer_contacts',
    'vendors','vendor_contacts',
    'items',
    'crm_leads','crm_opportunities','crm_companies','crm_contacts',
    'crm_tasks','crm_quotes','crm_quote_items',
    'crm_field_visits','crm_sample_requests',
    'stock_transfers','stock_transfer_items'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE 'ALTER TABLE public.' || quote_ident(t) || ' DROP COLUMN IF EXISTS created_by';
      EXECUTE 'ALTER TABLE public.' || quote_ident(t) || ' DROP COLUMN IF EXISTS updated_by';
    END IF;
  END LOOP;
END $$;
*/
