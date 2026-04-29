-- =============================================
-- PROCUREMENT MODULE — PATCH V2
-- Fixes schema mismatches, RPC bugs, missing columns
-- Run in Supabase SQL Editor AFTER procurement_setup.sql
--
-- PO statuses: draft → pending_approval → approved → placed →
--   acknowledged → delivery_confirmation → material_received → closed
--   (cancelled from any state)
--
-- GRN statuses: draft → checking → confirmed → invoice_matched → inward_posted
-- Purchase Invoice statuses: three_way_check → invoice_pending → inward_complete
-- =============================================

-- ─────────────────────────────────────────────
-- 1. MISSING COLUMNS — purchase_orders
-- ─────────────────────────────────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_type text DEFAULT 'SO';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_file_url text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS purchase_requisition text;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_at timestamptz;

-- ─────────────────────────────────────────────
-- 2. MISSING COLUMNS — po_items
-- ─────────────────────────────────────────────
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS lp_unit_price numeric DEFAULT 0;
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS unit_price_after_disc numeric DEFAULT 0;
ALTER TABLE po_items ADD COLUMN IF NOT EXISTS delivery_date date;

-- ─────────────────────────────────────────────
-- 3. MISSING COLUMNS — grn (delivery details)
-- ─────────────────────────────────────────────
ALTER TABLE grn ADD COLUMN IF NOT EXISTS dispatch_mode text;
ALTER TABLE grn ADD COLUMN IF NOT EXISTS driver_name text;
ALTER TABLE grn ADD COLUMN IF NOT EXISTS vehicle_number text;
ALTER TABLE grn ADD COLUMN IF NOT EXISTS vehicle_type text;
ALTER TABLE grn ADD COLUMN IF NOT EXISTS transporter_name text;
ALTER TABLE grn ADD COLUMN IF NOT EXISTS transporter_id text;

-- ─────────────────────────────────────────────
-- 4. MISSING COLUMNS — grn_items (po_id link)
-- ─────────────────────────────────────────────
ALTER TABLE grn_items ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id);
CREATE INDEX IF NOT EXISTS idx_grn_items_po ON grn_items(po_id);

-- ─────────────────────────────────────────────
-- 5. MISSING COLUMNS — purchase_invoices
-- ─────────────────────────────────────────────
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES grn(id);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS three_way_notes text;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS three_way_checked_at timestamptz;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS three_way_checked_by text;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS vendor_invoice_url text;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS ssc_invoice_url text;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS inward_completed_at timestamptz;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS inward_completed_by text;

-- Fix default status to match frontend
ALTER TABLE purchase_invoices ALTER COLUMN status SET DEFAULT 'three_way_check';

-- Indexes for new FK columns
CREATE INDEX IF NOT EXISTS idx_pi_grn ON purchase_invoices(grn_id);
CREATE INDEX IF NOT EXISTS idx_pi_po ON purchase_invoices(po_id);

-- ─────────────────────────────────────────────
-- 6. FIX next_grn_number — accept p_fc parameter
--    Generates: SSC/GRN0001/AMD/26-27
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_grn_number(p_fc text DEFAULT NULL)
RETURNS text AS $$
DECLARE
  v_fy text;
  v_prefix text := 'SSC/GRN';
  v_num int;
  v_like text;
  v_fc text;
BEGIN
  -- Advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('grn_number'));

  v_fy := fy_suffix();
  v_fc := COALESCE(p_fc, '');

  IF v_fc != '' THEN
    -- Format: SSC/GRN0001/AMD/26-27
    v_like := v_prefix || '%/' || v_fc || '/' || v_fy;
    SELECT COALESCE(
      MAX(
        CAST(
          REGEXP_REPLACE(
            SUBSTRING(grn_number FROM LENGTH(v_prefix) + 1),
            '/.*$', ''
          ) AS int
        )
      ), 0
    ) + 1
    INTO v_num
    FROM grn
    WHERE grn_number LIKE v_like;

    RETURN v_prefix || LPAD(v_num::text, 4, '0') || '/' || v_fc || '/' || v_fy;
  ELSE
    -- Fallback: SSC/GRN0001/26-27 (no FC code)
    v_like := v_prefix || '%/' || v_fy;
    SELECT COALESCE(
      MAX(
        CAST(
          REGEXP_REPLACE(
            SUBSTRING(grn_number FROM LENGTH(v_prefix) + 1),
            '/.*$', ''
          ) AS int
        )
      ), 0
    ) + 1
    INTO v_num
    FROM grn
    WHERE grn_number LIKE v_like
      AND grn_number NOT LIKE '%/AMD/%'
      AND grn_number NOT LIKE '%/BRD/%';

    RETURN v_prefix || LPAD(v_num::text, 4, '0') || '/' || v_fy;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 7. FIX next_po_number — add advisory lock
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_po_number(p_is_co boolean DEFAULT false)
RETURNS text AS $$
DECLARE
  v_fy text;
  v_prefix text;
  v_num int;
  v_like text;
BEGIN
  -- Advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('po_number'));

  v_fy := fy_suffix();
  IF p_is_co THEN v_prefix := 'SSC/PCO'; ELSE v_prefix := 'SSC/PO'; END IF;
  v_like := v_prefix || '%/' || v_fy;

  SELECT COALESCE(
    MAX(
      CAST(
        REGEXP_REPLACE(
          SUBSTRING(po_number FROM LENGTH(v_prefix) + 1),
          '/.*$', ''
        ) AS int
      )
    ), 0
  ) + 1
  INTO v_num
  FROM purchase_orders
  WHERE po_number LIKE v_like;

  RETURN v_prefix || LPAD(v_num::text, 4, '0') || '/' || v_fy;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 8. FIX next_vendor_code — add advisory lock
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION next_vendor_code()
RETURNS text AS $$
DECLARE v_num int;
BEGIN
  -- Advisory lock to prevent race conditions
  PERFORM pg_advisory_xact_lock(hashtext('vendor_code'));

  SELECT COALESCE(MAX(CAST(SUBSTRING(vendor_code FROM 3) AS int)), 0) + 1
  INTO v_num FROM vendors;
  RETURN 'V-' || LPAD(v_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 9. FIX confirm_grn — match frontend flow
--    Frontend: checking → confirmed (not draft → confirmed)
--    PO status: material_received (not received)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_grn(p_grn_id uuid)
RETURNS void AS $$
DECLARE
  v_grn record;
  v_item record;
  v_po_qty numeric;
  v_po_received numeric;
  v_all_received boolean;
BEGIN
  SELECT * INTO v_grn FROM grn WHERE id = p_grn_id;
  IF v_grn IS NULL THEN RAISE EXCEPTION 'GRN not found'; END IF;
  -- Idempotent: silently return if already confirmed (prevents double-click issues)
  IF v_grn.status IN ('confirmed', 'invoice_matched', 'inward_posted') THEN RETURN; END IF;
  IF v_grn.status NOT IN ('draft', 'checking') THEN
    RAISE EXCEPTION 'GRN must be in draft or checking status to confirm';
  END IF;

  -- Atomic: update each po_item's received_qty with row-level lock
  FOR v_item IN SELECT * FROM grn_items WHERE grn_id = p_grn_id AND po_item_id IS NOT NULL LOOP
    SELECT qty, COALESCE(received_qty, 0) INTO v_po_qty, v_po_received
    FROM po_items WHERE id = v_item.po_item_id FOR UPDATE;

    IF v_po_received + COALESCE(v_item.accepted_qty, v_item.received_qty, 0) > v_po_qty THEN
      RAISE EXCEPTION 'Received qty would exceed PO qty for item %', v_item.item_code;
    END IF;

    UPDATE po_items SET received_qty = v_po_received + COALESCE(v_item.accepted_qty, v_item.received_qty, 0)
    WHERE id = v_item.po_item_id;
  END LOOP;

  -- Update GRN status
  UPDATE grn SET status = 'confirmed' WHERE id = p_grn_id;

  -- Update PO status if applicable
  IF v_grn.po_id IS NOT NULL THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM po_items WHERE po_id = v_grn.po_id AND received_qty < qty
    ) INTO v_all_received;

    IF v_all_received THEN
      UPDATE purchase_orders SET status = 'material_received', received_at = now(), updated_at = now()
      WHERE id = v_grn.po_id;
    ELSE
      UPDATE purchase_orders SET status = 'partially_received', updated_at = now()
      WHERE id = v_grn.po_id AND status NOT IN ('partially_received', 'material_received');
    END IF;
  ELSE
    -- Check po_id from grn_items (per-row PO linking)
    FOR v_item IN
      SELECT DISTINCT gi.po_id FROM grn_items gi
      WHERE gi.grn_id = p_grn_id AND gi.po_id IS NOT NULL
    LOOP
      SELECT NOT EXISTS(
        SELECT 1 FROM po_items WHERE po_id = v_item.po_id AND received_qty < qty
      ) INTO v_all_received;

      IF v_all_received THEN
        UPDATE purchase_orders SET status = 'material_received', received_at = now(), updated_at = now()
        WHERE id = v_item.po_id;
      ELSE
        UPDATE purchase_orders SET status = 'partially_received', updated_at = now()
        WHERE id = v_item.po_id AND status NOT IN ('partially_received', 'material_received');
      END IF;
    END LOOP;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────
-- 10. TIGHTEN RLS — role-based write restrictions
--     Read: all authenticated users
--     Write (insert/update): only ops, admin, accounts
--     Sales users get read-only access to procurement data
-- ─────────────────────────────────────────────

-- Helper function: check if current user has a procurement-write role
CREATE OR REPLACE FUNCTION is_procurement_writer()
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'ops', 'accounts', 'management')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop overly permissive write policies and replace with role-checked ones
-- Vendors
DROP POLICY IF EXISTS "auth_insert" ON vendors;
DROP POLICY IF EXISTS "auth_update" ON vendors;
DROP POLICY IF EXISTS "role_insert" ON vendors;
DROP POLICY IF EXISTS "role_update" ON vendors;
CREATE POLICY "role_insert" ON vendors FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON vendors FOR UPDATE TO authenticated USING (is_procurement_writer());

-- Vendor Contacts
DROP POLICY IF EXISTS "auth_insert" ON vendor_contacts;
DROP POLICY IF EXISTS "auth_update" ON vendor_contacts;
DROP POLICY IF EXISTS "auth_delete" ON vendor_contacts;
DROP POLICY IF EXISTS "role_insert" ON vendor_contacts;
DROP POLICY IF EXISTS "role_update" ON vendor_contacts;
DROP POLICY IF EXISTS "role_delete" ON vendor_contacts;
CREATE POLICY "role_insert" ON vendor_contacts FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON vendor_contacts FOR UPDATE TO authenticated USING (is_procurement_writer());
CREATE POLICY "role_delete" ON vendor_contacts FOR DELETE TO authenticated USING (is_procurement_writer());

-- Purchase Orders
DROP POLICY IF EXISTS "auth_insert" ON purchase_orders;
DROP POLICY IF EXISTS "auth_update" ON purchase_orders;
DROP POLICY IF EXISTS "role_insert" ON purchase_orders;
DROP POLICY IF EXISTS "role_update" ON purchase_orders;
CREATE POLICY "role_insert" ON purchase_orders FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON purchase_orders FOR UPDATE TO authenticated USING (is_procurement_writer());

-- PO Items
DROP POLICY IF EXISTS "auth_insert" ON po_items;
DROP POLICY IF EXISTS "auth_update" ON po_items;
DROP POLICY IF EXISTS "auth_delete" ON po_items;
DROP POLICY IF EXISTS "role_insert" ON po_items;
DROP POLICY IF EXISTS "role_update" ON po_items;
DROP POLICY IF EXISTS "role_delete" ON po_items;
CREATE POLICY "role_insert" ON po_items FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON po_items FOR UPDATE TO authenticated USING (is_procurement_writer());
CREATE POLICY "role_delete" ON po_items FOR DELETE TO authenticated USING (is_procurement_writer());

-- PO Delivery Dates
DROP POLICY IF EXISTS "auth_insert" ON po_delivery_dates;
DROP POLICY IF EXISTS "role_insert" ON po_delivery_dates;
CREATE POLICY "role_insert" ON po_delivery_dates FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());

-- GRN
DROP POLICY IF EXISTS "auth_insert" ON grn;
DROP POLICY IF EXISTS "auth_update" ON grn;
DROP POLICY IF EXISTS "role_insert" ON grn;
DROP POLICY IF EXISTS "role_update" ON grn;
CREATE POLICY "role_insert" ON grn FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON grn FOR UPDATE TO authenticated USING (is_procurement_writer());

-- GRN Items
DROP POLICY IF EXISTS "auth_insert" ON grn_items;
DROP POLICY IF EXISTS "auth_update" ON grn_items;
DROP POLICY IF EXISTS "role_insert" ON grn_items;
DROP POLICY IF EXISTS "role_update" ON grn_items;
CREATE POLICY "role_insert" ON grn_items FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON grn_items FOR UPDATE TO authenticated USING (is_procurement_writer());

-- Purchase Invoices
DROP POLICY IF EXISTS "auth_insert" ON purchase_invoices;
DROP POLICY IF EXISTS "auth_update" ON purchase_invoices;
DROP POLICY IF EXISTS "role_insert" ON purchase_invoices;
DROP POLICY IF EXISTS "role_update" ON purchase_invoices;
CREATE POLICY "role_insert" ON purchase_invoices FOR INSERT TO authenticated WITH CHECK (is_procurement_writer());
CREATE POLICY "role_update" ON purchase_invoices FOR UPDATE TO authenticated USING (is_procurement_writer());

-- ─────────────────────────────────────────────
-- 11. COMPOSITE INDEXES for query performance
-- ─────────────────────────────────────────────
-- confirm_grn RPC: WHERE po_id = X AND received_qty < qty
CREATE INDEX IF NOT EXISTS idx_po_items_po_recv ON po_items(po_id, received_qty);
-- GRN items lookup by grn + po_item
CREATE INDEX IF NOT EXISTS idx_grn_items_grn_poitem ON grn_items(grn_id, po_item_id);
-- Purchase invoices by PO (for auto-close check)
CREATE INDEX IF NOT EXISTS idx_pi_po_status ON purchase_invoices(po_id, status);
-- Orders: status + order_type (for CO query in procurement dashboard)
CREATE INDEX IF NOT EXISTS idx_orders_type_status ON orders(order_type, status) WHERE order_type = 'CO';
-- Orders: created_at for FY filtering (covers all list pages)
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
-- Purchase orders: created_at for FY filtering
CREATE INDEX IF NOT EXISTS idx_po_created ON purchase_orders(created_at DESC);
-- GRN: created_at for FY filtering
CREATE INDEX IF NOT EXISTS idx_grn_created ON grn(created_at DESC);
-- Purchase invoices: created_at for FY filtering
CREATE INDEX IF NOT EXISTS idx_pi_created ON purchase_invoices(created_at DESC);

-- ─────────────────────────────────────────────
-- 12. FK CONSTRAINT — purchase_orders.order_id
--     Prevents orphaned POs if order is deleted
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_po_order_id' AND table_name = 'purchase_orders'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_po_order_id FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Same for grn.order_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_grn_order_id' AND table_name = 'grn'
  ) THEN
    ALTER TABLE grn
      ADD CONSTRAINT fk_grn_order_id FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
  END IF;
END $$;
