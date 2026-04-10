-- =============================================
-- PROCUREMENT MODULE — FULL SQL SETUP
-- Run in Supabase SQL Editor (single execution)
-- =============================================

-- 1. Vendors
CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_code text UNIQUE NOT NULL,
  vendor_name text NOT NULL,
  vendor_type text DEFAULT 'Manufacturer',
  gst text,
  pan text,
  billing_address text,
  shipping_address text,
  poc_name text,
  poc_phone text,
  poc_email text,
  payment_terms text,
  account_owner text,
  status text DEFAULT 'active',
  notes text,
  is_test boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE vendor_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  name text,
  designation text,
  phone text,
  whatsapp text,
  email text
);

-- 2. Purchase Orders
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text UNIQUE NOT NULL,
  vendor_id uuid REFERENCES vendors(id),
  vendor_name text,
  order_id uuid,
  order_number text,
  status text DEFAULT 'draft',
  po_date date DEFAULT CURRENT_DATE,
  expected_delivery date,
  total_amount numeric DEFAULT 0,
  currency text DEFAULT 'INR',
  notes text,
  approved_by text,
  approved_at timestamptz,
  placed_at timestamptz,
  acknowledged_at timestamptz,
  closed_at timestamptz,
  cancelled_reason text,
  created_by uuid,
  submitted_by_name text,
  fulfilment_center text,
  is_test boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE po_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sr_no int,
  item_code text,
  description text,
  qty numeric NOT NULL,
  received_qty numeric DEFAULT 0,
  unit_price numeric DEFAULT 0,
  total_price numeric DEFAULT 0,
  hsn_code text,
  CONSTRAINT chk_po_received_qty CHECK (received_qty <= qty)
);

CREATE TABLE po_delivery_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  expected_date date NOT NULL,
  reason text,
  changed_by text,
  created_at timestamptz DEFAULT now()
);

-- 3. GRN (Goods Receipt Note)
CREATE TABLE grn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_number text UNIQUE NOT NULL,
  grn_type text NOT NULL DEFAULT 'po_inward',
  po_id uuid REFERENCES purchase_orders(id),
  order_id uuid,
  vendor_id uuid REFERENCES vendors(id),
  vendor_name text,
  fulfilment_center text,
  received_by text,
  received_at timestamptz DEFAULT now(),
  invoice_number text,
  invoice_date date,
  invoice_amount numeric,
  status text DEFAULT 'draft',
  notes text,
  is_test boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE grn_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_id uuid REFERENCES grn(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES po_items(id),
  item_code text,
  description text,
  expected_qty numeric DEFAULT 0,
  received_qty numeric DEFAULT 0,
  accepted_qty numeric DEFAULT 0,
  rejected_qty numeric DEFAULT 0,
  rejection_reason text
);

-- 4. Purchase Invoices
CREATE TABLE purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text,
  vendor_id uuid REFERENCES vendors(id),
  vendor_name text,
  invoice_date date,
  invoice_amount numeric DEFAULT 0,
  gst_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  status text DEFAULT 'pending_match',
  matched_grn_ids uuid[] DEFAULT '{}',
  matched_po_ids uuid[] DEFAULT '{}',
  invoice_pdf_url text,
  posted_at timestamptz,
  posted_by text,
  is_test boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- 5. RPC FUNCTIONS
-- =============================================

-- FY helper: returns '26-27' style string
CREATE OR REPLACE FUNCTION fy_suffix()
RETURNS text AS $$
DECLARE
  y int := EXTRACT(YEAR FROM NOW())::int;
  m int := EXTRACT(MONTH FROM NOW())::int;
  start_yy int;
BEGIN
  IF m >= 4 THEN start_yy := y % 100;
  ELSE start_yy := (y - 1) % 100;
  END IF;
  RETURN LPAD(start_yy::text, 2, '0') || '-' || LPAD((start_yy + 1)::text, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- Vendor code: V-0001, V-0002, ...
CREATE OR REPLACE FUNCTION next_vendor_code()
RETURNS text AS $$
DECLARE v_num int;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(vendor_code FROM 3) AS int)), 0) + 1
  INTO v_num FROM vendors;
  RETURN 'V-' || LPAD(v_num::text, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- PO number: SSC/PO0001/26-27 or SSC/PCO0001/26-27
CREATE OR REPLACE FUNCTION next_po_number(p_is_co boolean DEFAULT false)
RETURNS text AS $$
DECLARE
  v_fy text;
  v_prefix text;
  v_num int;
  v_like text;
BEGIN
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

-- GRN number: SSC/GRN0001/26-27
CREATE OR REPLACE FUNCTION next_grn_number()
RETURNS text AS $$
DECLARE
  v_fy text;
  v_prefix text := 'SSC/GRN';
  v_num int;
  v_like text;
BEGIN
  v_fy := fy_suffix();
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
  WHERE grn_number LIKE v_like;

  RETURN v_prefix || LPAD(v_num::text, 4, '0') || '/' || v_fy;
END;
$$ LANGUAGE plpgsql;

-- Atomic GRN confirmation
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
  IF v_grn.status != 'draft' THEN RAISE EXCEPTION 'GRN is not in draft status'; END IF;

  FOR v_item IN SELECT * FROM grn_items WHERE grn_id = p_grn_id AND po_item_id IS NOT NULL LOOP
    SELECT qty, COALESCE(received_qty, 0) INTO v_po_qty, v_po_received
    FROM po_items WHERE id = v_item.po_item_id FOR UPDATE;

    IF v_po_received + v_item.accepted_qty > v_po_qty THEN
      RAISE EXCEPTION 'Received qty would exceed PO qty for item %', v_item.item_code;
    END IF;

    UPDATE po_items SET received_qty = v_po_received + v_item.accepted_qty
    WHERE id = v_item.po_item_id;
  END LOOP;

  UPDATE grn SET status = 'confirmed' WHERE id = p_grn_id;

  IF v_grn.po_id IS NOT NULL THEN
    SELECT NOT EXISTS(
      SELECT 1 FROM po_items WHERE po_id = v_grn.po_id AND received_qty < qty
    ) INTO v_all_received;

    IF v_all_received THEN
      UPDATE purchase_orders SET status = 'received', updated_at = now() WHERE id = v_grn.po_id;
    ELSE
      UPDATE purchase_orders SET status = 'partially_received', updated_at = now()
      WHERE id = v_grn.po_id AND status NOT IN ('partially_received', 'received');
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- 6. ROW LEVEL SECURITY
-- =============================================

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_delivery_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn ENABLE ROW LEVEL SECURITY;
ALTER TABLE grn_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_invoices ENABLE ROW LEVEL SECURITY;

-- Read policies
CREATE POLICY "auth_read" ON vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON vendor_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON po_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON po_delivery_dates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON grn FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON grn_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_read" ON purchase_invoices FOR SELECT TO authenticated USING (true);

-- Write policies
CREATE POLICY "auth_insert" ON vendors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON vendors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON vendor_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON vendor_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete" ON vendor_contacts FOR DELETE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON purchase_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON purchase_orders FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON po_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON po_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_delete" ON po_items FOR DELETE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON po_delivery_dates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_insert" ON grn FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON grn FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON grn_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON grn_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_insert" ON purchase_invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON purchase_invoices FOR UPDATE TO authenticated USING (true);

-- =============================================
-- 7. INDEXES
-- =============================================

CREATE INDEX idx_vendor_status ON vendors(status);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_po_order ON purchase_orders(order_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_items_po ON po_items(po_id);
CREATE INDEX idx_po_dates_po ON po_delivery_dates(po_id);
CREATE INDEX idx_grn_po ON grn(po_id);
CREATE INDEX idx_grn_order ON grn(order_id);
CREATE INDEX idx_grn_type ON grn(grn_type);
CREATE INDEX idx_grn_status ON grn(status);
CREATE INDEX idx_grn_items_grn ON grn_items(grn_id);
CREATE INDEX idx_pi_vendor ON purchase_invoices(vendor_id);
CREATE INDEX idx_pi_status ON purchase_invoices(status);
