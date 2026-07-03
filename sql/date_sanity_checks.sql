-- ─────────────────────────────────────────────────────────────────────
-- DATE SANITY BACKSTOP — blocks garbage-year dates at the DB level
-- (frontend rule lives in fmt.js: deliveryDateIssue / orderDateIssue).
-- NOT VALID: enforced for NEW writes only, so the known bad rows
-- (CO0514 year 0026, SO0208 year 20026, CO0877 2025, CO0868) do not
-- block the constraint; they are corrected separately.
-- Purely additive. Bounds are generous anti-typo rails, not business rules.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_dispatch_date_sane') THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_dispatch_date_sane
      CHECK (dispatch_date IS NULL OR dispatch_date BETWEEN '2024-01-01' AND '2035-12-31')
      NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_date_sane') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_date_sane
      CHECK (order_date IS NULL OR order_date BETWEEN '2024-01-01' AND '2035-12-31')
      NOT VALID;
  END IF;
END $$;

SELECT conname, convalidated FROM pg_constraint
WHERE conname IN ('order_items_dispatch_date_sane','orders_order_date_sane');
