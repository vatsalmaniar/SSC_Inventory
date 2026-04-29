-- Items master catalog table
-- Run this ONCE in Supabase SQL editor before running items_import.sql

CREATE TABLE IF NOT EXISTS items (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_no     text UNIQUE,                          -- IN0001, IN0002 …
  item_code   text UNIQUE NOT NULL,                 -- unique product code from XLS
  brand       text,
  category    text,
  subcategory text,
  series      text,
  type        text CHECK (type IN ('CI', 'SI')),    -- Customised / Standard
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Indexes for list-page search / filters
CREATE INDEX IF NOT EXISTS idx_items_item_code  ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_items_brand      ON items(brand);
CREATE INDEX IF NOT EXISTS idx_items_category   ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_item_no    ON items(item_no);

-- RLS
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read"   ON items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert" ON items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update" ON items FOR UPDATE TO authenticated USING (true);
