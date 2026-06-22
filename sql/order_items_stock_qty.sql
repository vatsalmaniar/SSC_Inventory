-- order_items.stock_qty — quantity-precise procurement (clubbed-PO Stage B)
-- Applied: 2026-06-22 (via Management API)
--
-- Lets a SINGLE CO line be split across sources, e.g. 10 ordered = 6 from stock
-- + 4 on a PO. Before this, "From Stock" was a whole-line flag
-- (procurement_source = 'po' | 'stock') — all or nothing.
--
-- NO BACKFILL ON PURPOSE (avoids a migration trap). The coverage helper uses a
-- FALLBACK: stock portion = (stock_qty > 0 ? stock_qty
--                            : procurement_source='stock' ? qty - cancelled_qty : 0).
-- So the 585 legacy procurement_source='stock' rows (stock_qty defaults 0) keep
-- behaving exactly as before — fully from stock — with nothing to migrate.
-- See src/lib/coverage.js and [[clubbed-po-phase1]].

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_qty numeric NOT NULL DEFAULT 0
    CHECK (stock_qty >= 0);
