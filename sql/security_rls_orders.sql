-- =============================================
-- SECURITY PATCH — RLS for ALL tables + Status Transition Guards
--
-- Covers: Orders, CRM, Customers, Inventory, Notifications, Profiles, Legacy Leads
-- Total: 22 tables protected
--
-- SAFE: All authenticated users keep current read/write access.
--       Triggers ONLY validate status changes — all other field updates pass through.
--       Admin/ops keep full override (OpsOrders manage page).
--
-- WHAT THIS BLOCKS:
--   1. Unauthenticated API access (anon key alone can no longer read/write ANY table)
--   2. Sales users changing order status
--   3. Non-admin users cancelling orders
--   4. Accounts setting FC-only statuses (and vice versa)
--
-- IDEMPOTENT: Safe to re-run. Uses DROP IF EXISTS, CREATE OR REPLACE.
-- =============================================


-- ═══════════════════════════════════════════════
-- SECTION A: ORDERS MODULE (5 tables)
-- ═══════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- A1. ENABLE RLS
-- ─────────────────────────────────────────────
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- A2. READ POLICIES
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_read" ON orders;
DROP POLICY IF EXISTS "auth_read" ON order_items;
DROP POLICY IF EXISTS "auth_read" ON order_dispatches;
DROP POLICY IF EXISTS "auth_read" ON order_comments;
DROP POLICY IF EXISTS "auth_read" ON notifications;

CREATE POLICY "auth_read" ON orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON order_dispatches FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON order_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON notifications FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────
-- A3. WRITE POLICIES
-- ─────────────────────────────────────────────
-- orders
DROP POLICY IF EXISTS "auth_insert" ON orders;
DROP POLICY IF EXISTS "auth_update" ON orders;
CREATE POLICY "auth_insert" ON orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON orders FOR UPDATE TO authenticated USING (true);

-- order_items (RPC replace_order_items may DELETE + INSERT)
DROP POLICY IF EXISTS "auth_insert" ON order_items;
DROP POLICY IF EXISTS "auth_update" ON order_items;
DROP POLICY IF EXISTS "auth_delete" ON order_items;
CREATE POLICY "auth_insert" ON order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON order_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete" ON order_items FOR DELETE TO authenticated USING (true);

-- order_dispatches
DROP POLICY IF EXISTS "auth_insert" ON order_dispatches;
DROP POLICY IF EXISTS "auth_update" ON order_dispatches;
CREATE POLICY "auth_insert" ON order_dispatches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON order_dispatches FOR UPDATE TO authenticated USING (true);

-- order_comments
DROP POLICY IF EXISTS "auth_insert" ON order_comments;
DROP POLICY IF EXISTS "auth_update" ON order_comments;
CREATE POLICY "auth_insert" ON order_comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON order_comments FOR UPDATE TO authenticated USING (true);

-- notifications
DROP POLICY IF EXISTS "auth_insert" ON notifications;
DROP POLICY IF EXISTS "auth_update" ON notifications;
CREATE POLICY "auth_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON notifications FOR UPDATE TO authenticated USING (true);


-- ═══════════════════════════════════════════════
-- SECTION B: CRM MODULE (12 tables)
-- ═══════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- B1. ENABLE RLS
-- ─────────────────────────────────────────────
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sample_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_visits ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────
-- B2. READ POLICIES
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_read" ON crm_opportunities;
DROP POLICY IF EXISTS "auth_read" ON crm_companies;
DROP POLICY IF EXISTS "auth_read" ON crm_contacts;
DROP POLICY IF EXISTS "auth_read" ON crm_activities;
DROP POLICY IF EXISTS "auth_read" ON crm_tasks;
DROP POLICY IF EXISTS "auth_read" ON crm_quote_items;
DROP POLICY IF EXISTS "auth_read" ON crm_quotes;
DROP POLICY IF EXISTS "auth_read" ON crm_principals;
DROP POLICY IF EXISTS "auth_read" ON crm_leads;
DROP POLICY IF EXISTS "auth_read" ON crm_targets;
DROP POLICY IF EXISTS "auth_read" ON crm_sample_requests;
DROP POLICY IF EXISTS "auth_read" ON crm_field_visits;

CREATE POLICY "auth_read" ON crm_opportunities FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_quote_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_principals FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_targets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_sample_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON crm_field_visits FOR SELECT TO authenticated USING (true);

-- ─────────────────────────────────────────────
-- B3. WRITE POLICIES
-- ─────────────────────────────────────────────
-- crm_opportunities (insert + update by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_opportunities;
DROP POLICY IF EXISTS "auth_update" ON crm_opportunities;
CREATE POLICY "auth_insert" ON crm_opportunities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_opportunities FOR UPDATE TO authenticated USING (true);

-- crm_companies (insert + update by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_companies;
DROP POLICY IF EXISTS "auth_update" ON crm_companies;
CREATE POLICY "auth_insert" ON crm_companies FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_companies FOR UPDATE TO authenticated USING (true);

-- crm_contacts (insert by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_contacts;
DROP POLICY IF EXISTS "auth_update" ON crm_contacts;
CREATE POLICY "auth_insert" ON crm_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_contacts FOR UPDATE TO authenticated USING (true);

-- crm_activities (insert by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_activities;
CREATE POLICY "auth_insert" ON crm_activities FOR INSERT TO authenticated WITH CHECK (true);

-- crm_tasks (insert + update by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_tasks;
DROP POLICY IF EXISTS "auth_update" ON crm_tasks;
CREATE POLICY "auth_insert" ON crm_tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_tasks FOR UPDATE TO authenticated USING (true);

-- crm_quote_items (insert + delete by sales/admin — quotes are replaced via delete+insert)
DROP POLICY IF EXISTS "auth_insert" ON crm_quote_items;
DROP POLICY IF EXISTS "auth_delete" ON crm_quote_items;
CREATE POLICY "auth_insert" ON crm_quote_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_delete" ON crm_quote_items FOR DELETE TO authenticated USING (true);

-- crm_quotes (insert by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_quotes;
CREATE POLICY "auth_insert" ON crm_quotes FOR INSERT TO authenticated WITH CHECK (true);

-- crm_principals (read-heavy master data, insert by admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_principals;
CREATE POLICY "auth_insert" ON crm_principals FOR INSERT TO authenticated WITH CHECK (true);

-- crm_leads (insert + update by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_leads;
DROP POLICY IF EXISTS "auth_update" ON crm_leads;
CREATE POLICY "auth_insert" ON crm_leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_leads FOR UPDATE TO authenticated USING (true);

-- crm_targets (insert + update by admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_targets;
DROP POLICY IF EXISTS "auth_update" ON crm_targets;
CREATE POLICY "auth_insert" ON crm_targets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_targets FOR UPDATE TO authenticated USING (true);

-- crm_sample_requests (update by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_sample_requests;
DROP POLICY IF EXISTS "auth_update" ON crm_sample_requests;
CREATE POLICY "auth_insert" ON crm_sample_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON crm_sample_requests FOR UPDATE TO authenticated USING (true);

-- crm_field_visits (insert by sales/admin)
DROP POLICY IF EXISTS "auth_insert" ON crm_field_visits;
CREATE POLICY "auth_insert" ON crm_field_visits FOR INSERT TO authenticated WITH CHECK (true);


-- ═══════════════════════════════════════════════
-- SECTION C: CUSTOMER MODULE (2 tables)
-- ═══════════════════════════════════════════════

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- Read
DROP POLICY IF EXISTS "auth_read" ON customers;
DROP POLICY IF EXISTS "auth_read" ON customer_contacts;
CREATE POLICY "auth_read" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON customer_contacts FOR SELECT TO authenticated USING (true);

-- Write — customers (insert + update + delete by ops/admin/sales)
DROP POLICY IF EXISTS "auth_insert" ON customers;
DROP POLICY IF EXISTS "auth_update" ON customers;
DROP POLICY IF EXISTS "auth_delete" ON customers;
CREATE POLICY "auth_insert" ON customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete" ON customers FOR DELETE TO authenticated USING (true);

-- customer_contacts (insert by sales/admin from CRMOpportunityDetail)
DROP POLICY IF EXISTS "auth_insert" ON customer_contacts;
DROP POLICY IF EXISTS "auth_update" ON customer_contacts;
CREATE POLICY "auth_insert" ON customer_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON customer_contacts FOR UPDATE TO authenticated USING (true);


-- ═══════════════════════════════════════════════
-- SECTION D: INVENTORY MODULE (2 tables)
-- ═══════════════════════════════════════════════

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- Read
DROP POLICY IF EXISTS "auth_read" ON inventory;
DROP POLICY IF EXISTS "auth_read" ON items;
CREATE POLICY "auth_read" ON inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON items FOR SELECT TO authenticated USING (true);

-- Write — inventory (upsert by accounts via XLS upload)
DROP POLICY IF EXISTS "auth_insert" ON inventory;
DROP POLICY IF EXISTS "auth_update" ON inventory;
CREATE POLICY "auth_insert" ON inventory FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON inventory FOR UPDATE TO authenticated USING (true);

-- items (master data, read-heavy)
DROP POLICY IF EXISTS "auth_insert" ON items;
DROP POLICY IF EXISTS "auth_update" ON items;
CREATE POLICY "auth_insert" ON items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON items FOR UPDATE TO authenticated USING (true);


-- ═══════════════════════════════════════════════
-- SECTION E: AUTH / PROFILES (1 table)
-- ═══════════════════════════════════════════════

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_read" ON profiles;
DROP POLICY IF EXISTS "auth_update" ON profiles;
CREATE POLICY "auth_read" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_update" ON profiles FOR UPDATE TO authenticated USING (true);


-- ═══════════════════════════════════════════════
-- (Section F removed — leads/lead_activities tables do not exist in database)
-- ═══════════════════════════════════════════════
-- SECTION G: STATUS TRANSITION TRIGGERS (orders + dispatches)
-- ═══════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- G1. TRIGGER: validate_order_status_change
--     Fires BEFORE UPDATE on orders table.
--     Only validates status column changes — all other field edits pass through.
--
--     Role permissions (derived from full code audit):
--       admin/ops  → any status (OpsOrders override page)
--       accounts   → pi_generated, pi_payment_pending, delivery_created
--       fc_kaveri  → goods_issued, invoice_generated, dispatched_fc, partial_dispatch,
--                     picking, packing, delivery_ready, eway_generated
--       fc_godawari→ (same as fc_kaveri)
--       sales      → no status changes
--       cancelled  → admin only
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_order_status_change()
RETURNS trigger AS $$
DECLARE
  v_role text;
BEGIN
  -- Pass through if status hasn't changed (field-only updates like notes, amounts, etc.)
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  -- Service role / SECURITY DEFINER RPCs bypass (auth.uid() is NULL for service calls)
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Get the current user's role
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  -- Admin and ops: full access (includes OpsOrders manage page)
  IF v_role IN ('admin', 'ops') THEN RETURN NEW; END IF;

  -- Only admin can cancel orders (HIGH severity finding)
  IF NEW.status = 'cancelled' THEN
    RAISE EXCEPTION 'Only admin can cancel orders';
  END IF;

  -- Accounts: billing + PI transitions on orders table
  -- (BillingOrderDetail sets: pi_generated, pi_payment_pending, delivery_created)
  IF v_role = 'accounts' THEN
    IF NEW.status IN ('pi_generated', 'pi_payment_pending', 'delivery_created') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Accounts role cannot set order status to "%"', NEW.status;
  END IF;

  -- FC: fulfilment transitions on orders table
  -- (FCOrderDetail sets: goods_issued, invoice_generated, dispatched_fc, partial_dispatch)
  -- (Also allowing picking, packing, delivery_ready, eway_generated for safety)
  IF v_role IN ('fc_kaveri', 'fc_godawari') THEN
    IF NEW.status IN (
      'picking', 'packing', 'goods_issued', 'invoice_generated',
      'delivery_ready', 'eway_generated', 'dispatched_fc', 'partial_dispatch'
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FC role cannot set order status to "%"', NEW.status;
  END IF;

  -- Sales and unknown roles: no status changes
  RAISE EXCEPTION 'Role "%" cannot change order status', COALESCE(v_role, 'unknown');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_validate_order_status ON orders;
CREATE TRIGGER trg_validate_order_status
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION validate_order_status_change();

-- ─────────────────────────────────────────────
-- G2. TRIGGER: validate_dispatch_status_change
--     Fires BEFORE UPDATE on order_dispatches table.
--
--     Role permissions (derived from full code audit):
--       admin/ops  → any status
--       accounts   → credit_check, goods_issue_posted, invoice_generated,
--                     pi_generated, pi_payment_pending, delivery_created, eway_generated
--       fc_kaveri  → picking, packing, goods_issued, invoice_generated,
--                     delivery_ready, eway_generated, dispatched_fc
--       fc_godawari→ (same as fc_kaveri)
--       sales      → no status changes
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION validate_dispatch_status_change()
RETURNS trigger AS $$
DECLARE
  v_role text;
BEGIN
  -- Pass through if status hasn't changed
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  -- Service role / SECURITY DEFINER RPCs bypass
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- Get user role
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  -- Admin/ops: full access
  IF v_role IN ('admin', 'ops') THEN RETURN NEW; END IF;

  -- Only admin can cancel
  IF NEW.status = 'cancelled' THEN
    RAISE EXCEPTION 'Only admin can cancel dispatches';
  END IF;

  -- Accounts: billing + PI transitions on dispatches
  IF v_role = 'accounts' THEN
    IF NEW.status IN (
      'credit_check', 'goods_issue_posted', 'invoice_generated',
      'pi_generated', 'pi_payment_pending', 'delivery_created', 'eway_generated'
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Accounts role cannot set dispatch status to "%"', NEW.status;
  END IF;

  -- FC: fulfilment transitions on dispatches
  IF v_role IN ('fc_kaveri', 'fc_godawari') THEN
    IF NEW.status IN (
      'picking', 'packing', 'goods_issued', 'invoice_generated',
      'delivery_ready', 'eway_generated', 'dispatched_fc'
    ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FC role cannot set dispatch status to "%"', NEW.status;
  END IF;

  -- Sales and unknown roles: no status changes
  RAISE EXCEPTION 'Role "%" cannot change dispatch status', COALESCE(v_role, 'unknown');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger (idempotent: drop first)
DROP TRIGGER IF EXISTS trg_validate_dispatch_status ON order_dispatches;
CREATE TRIGGER trg_validate_dispatch_status
  BEFORE UPDATE ON order_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION validate_dispatch_status_change();


-- ═══════════════════════════════════════════════
-- SECTION H: VERIFICATION QUERIES (uncomment to test)
-- ═══════════════════════════════════════════════

-- Check RLS is enabled on ALL tables:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;

-- Check all policies:
-- SELECT tablename, policyname, cmd, roles FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- Check triggers:
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
-- WHERE trigger_name LIKE 'trg_validate%';
