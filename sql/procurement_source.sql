-- procurement_source: lets an SI line on a CO be marked "From Stock"
-- so the user doesn't need to place a sham PO + cancel it just to close the CO.
-- Additive only. No FC / GRN / dispatch changes.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS procurement_source text NOT NULL DEFAULT 'po'
    CHECK (procurement_source IN ('po','stock'));

CREATE INDEX IF NOT EXISTS idx_order_items_procurement_source
  ON public.order_items(procurement_source)
  WHERE procurement_source = 'stock';
