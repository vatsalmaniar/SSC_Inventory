-- forecast_delivered_qty — server-side aggregate of delivered qty per item/month
-- Applied: 2026-07-01 (via Management API)
--
-- BUG FIXED: the Procurement Forecast pulled every dispatch batch for the quarter
-- with a plain select and summed dispatched_items in JS. PostgREST caps selects at
-- 1000 rows, so once a quarter had >1000 delivered batches (this quarter had 1735)
-- the extras were silently dropped and every item's "system sales" under-counted
-- (item CIMRE1SS8/24/OM showed 9 in June instead of the real 1377).
--
-- This function sums in Postgres and returns ONLY the passed item codes, so the
-- result set is tiny (<= items x 3 months) and the row cap can never bite. Passing
-- codes as a text[] param also sidesteps the PostgREST .in() quoting problem with
-- item codes that contain quotes/commas/parens.

CREATE OR REPLACE FUNCTION forecast_delivered_qty(
  p_start      timestamptz,
  p_end        timestamptz,
  p_item_codes text[]
)
RETURNS TABLE(item_code text, month text, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT (it->>'item_code')::text                AS item_code,
         to_char(od.delivered_at, 'YYYY-MM')     AS month,
         sum((it->>'qty')::numeric)              AS qty
  FROM order_dispatches od
  JOIN orders o ON o.id = od.order_id
  CROSS JOIN LATERAL jsonb_array_elements(od.dispatched_items) it
  WHERE o.is_test = false
    AND od.status = 'dispatched_fc'
    AND od.delivered_at IS NOT NULL
    AND od.delivered_at >= p_start
    AND od.delivered_at <= p_end
    AND (it->>'item_code') = ANY(p_item_codes)
  GROUP BY 1, 2;
$fn$;

GRANT EXECUTE ON FUNCTION forecast_delivered_qty(timestamptz, timestamptz, text[]) TO authenticated;
