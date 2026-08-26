-- forecast_brand_data — ONE server-side call for everything the Procurement
-- Forecast needs per brand: system sales, manual overrides, live stock split,
-- manual stock, and PENDING PO QTY (on order).
--
-- WHY (2026-08-26): the page made four separate .in('item_code', [...]) /
-- .in('product_code', [...]) requests. PostgREST's .in() list parsing BREAKS
-- when any code contains quotes/commas/parens (e.g. Hicool's
-- '4" Filter Kit Screw Type RAL-7035 (130X130)') — the whole request errors,
-- the error was swallowed, and the UI showed silent zeros. The create-PO
-- wizard therefore seeded Pending PO = 0 for entire brands → over-ordering
-- risk on items with material already on the way. forecast_delivered_qty had
-- already solved this for sales by taking text[]; this function finishes the
-- job by keying everything on ONE clean parameter (the brand) so item codes
-- never cross the wire at all. See feedback_postgrest_in_quoting.
--
-- Pending PO semantics: every PO status except 'cancelled' counts, EXCEPT
-- drafts older than 7 days (user rule 2026-08-28). A fresh draft is live
-- intent — usually raised from this very forecast — and must count so the
-- wizard doesn't double-order; a week-old draft is a dead intention and must
-- stop masking real need (two 10-week-old strays proved the risk). Closed /
-- material_received are harmless because qty = received_qty there, and
-- GREATEST(0, …) guards over-receipts. Test POs excluded.

CREATE OR REPLACE FUNCTION forecast_brand_data(
  p_brand  text,
  p_start  timestamptz,
  p_end    timestamptz,
  p_months text[]
)
RETURNS TABLE(
  item_code    text,
  item_no      text,
  category     text,
  sys_sales    jsonb,   -- {'YYYY-MM': qty} delivered per month (dispatched_fc + delivered_at)
  manual_sales jsonb,   -- {'YYYY-MM': manual_qty} from procurement_forecast_sales
  kaveri       numeric,
  godawari     numeric,
  manual_stock numeric, -- NULL when no override
  pending_po   numeric  -- qty on open POs, not yet received
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  WITH it AS (
    SELECT i.item_code, i.item_no, i.category
    FROM items i
    WHERE i.brand = p_brand
      AND (i.type IS NULL OR i.type <> 'CI')
  ),
  del AS (
    SELECT (e->>'item_code')                    AS item_code,
           to_char(od.delivered_at, 'YYYY-MM')  AS month,
           sum((e->>'qty')::numeric)            AS qty
    FROM order_dispatches od
    JOIN orders o ON o.id = od.order_id
    CROSS JOIN LATERAL jsonb_array_elements(od.dispatched_items) e
    WHERE o.is_test = false
      AND od.status = 'dispatched_fc'
      AND od.delivered_at IS NOT NULL
      AND od.delivered_at >= p_start
      AND od.delivered_at <= p_end
      AND (e->>'item_code') IN (SELECT item_code FROM it)
    GROUP BY 1, 2
  ),
  ms AS (
    SELECT s.item_code, jsonb_object_agg(s.month, s.manual_qty) AS j
    FROM procurement_forecast_sales s
    WHERE s.item_code IN (SELECT item_code FROM it) AND s.month = ANY(p_months)
    GROUP BY 1
  ),
  inv AS (
    SELECT v.product_code AS item_code,
           coalesce(sum(v.quantity) FILTER (WHERE v.location = 'Kaveri'),   0) AS k,
           coalesce(sum(v.quantity) FILTER (WHERE v.location = 'Godawari'), 0) AS g
    FROM inventory v
    WHERE v.product_code IN (SELECT item_code FROM it)
    GROUP BY 1
  ),
  mst AS (
    SELECT t.item_code, t.manual_qty
    FROM procurement_forecast_stock t
    WHERE t.item_code IN (SELECT item_code FROM it)
  ),
  pp AS (
    SELECT pi.item_code, sum(GREATEST(0, pi.qty - coalesce(pi.received_qty, 0))) AS pend
    FROM po_items pi
    JOIN purchase_orders po ON po.id = pi.po_id
    WHERE po.status <> 'cancelled'
      AND (po.status <> 'draft' OR po.created_at >= now() - interval '7 days')
      AND coalesce(po.is_test, false) = false
      AND pi.item_code IN (SELECT item_code FROM it)
    GROUP BY 1
  )
  SELECT it.item_code, it.item_no, it.category,
         coalesce((SELECT jsonb_object_agg(d.month, d.qty) FROM del d WHERE d.item_code = it.item_code), '{}'::jsonb),
         coalesce(ms.j, '{}'::jsonb),
         coalesce(inv.k, 0),
         coalesce(inv.g, 0),
         mst.manual_qty,
         coalesce(pp.pend, 0)
  FROM it
  LEFT JOIN ms  ON ms.item_code  = it.item_code
  LEFT JOIN inv ON inv.item_code = it.item_code
  LEFT JOIN mst ON mst.item_code = it.item_code
  LEFT JOIN pp  ON pp.item_code  = it.item_code
  ORDER BY it.item_code;
$fn$;

REVOKE ALL ON FUNCTION forecast_brand_data(text, timestamptz, timestamptz, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forecast_brand_data(text, timestamptz, timestamptz, text[]) TO authenticated, service_role;
