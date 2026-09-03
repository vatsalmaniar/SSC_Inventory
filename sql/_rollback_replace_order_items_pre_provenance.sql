-- Live definition of replace_order_items captured 2026-09-01, BEFORE price
-- provenance was added. Apply this file verbatim to roll the function back.
-- The added order_items columns are nullable and can be left in place.

CREATE OR REPLACE FUNCTION public.replace_order_items(p_order_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  existing_ids uuid[];
  keep_ids uuid[];
  item jsonb;
  matched_id uuid;
  i int := 0;
BEGIN
  SELECT array_agg(id ORDER BY sr_no) INTO existing_ids
  FROM order_items WHERE order_id = p_order_id;

  keep_ids := '{}';

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    i := i + 1;
    matched_id := NULL;

    IF existing_ids IS NOT NULL AND i <= array_length(existing_ids, 1) THEN
      matched_id := existing_ids[i];
    END IF;

    IF matched_id IS NOT NULL THEN
      UPDATE order_items SET
        sr_no                = (item->>'sr_no')::int,
        item_code            = item->>'item_code',
        qty                  = (item->>'qty')::numeric,
        lp_unit_price        = (item->>'lp_unit_price')::numeric,
        discount_pct         = (item->>'discount_pct')::numeric,
        unit_price_after_disc= (item->>'unit_price_after_disc')::numeric,
        total_price          = (item->>'total_price')::numeric,
        dispatch_date        = NULLIF(item->>'dispatch_date', '')::date,
        customer_ref_no      = NULLIF(item->>'customer_ref_no', ''),
        description          = NULLIF(item->>'description', '')
      WHERE id = matched_id;
      keep_ids := keep_ids || matched_id;
    ELSE
      INSERT INTO order_items (order_id, sr_no, item_code, qty, lp_unit_price, discount_pct, unit_price_after_disc, total_price, dispatch_date, customer_ref_no, description)
      VALUES (
        p_order_id,
        (item->>'sr_no')::int,
        item->>'item_code',
        (item->>'qty')::numeric,
        (item->>'lp_unit_price')::numeric,
        (item->>'discount_pct')::numeric,
        (item->>'unit_price_after_disc')::numeric,
        (item->>'total_price')::numeric,
        NULLIF(item->>'dispatch_date', '')::date,
        NULLIF(item->>'customer_ref_no', ''),
        NULLIF(item->>'description', '')
      )
      RETURNING id INTO matched_id;
      keep_ids := keep_ids || matched_id;
    END IF;
  END LOOP;

  DELETE FROM order_items oi
  WHERE oi.order_id = p_order_id
    AND oi.id != ALL(keep_ids)
    AND NOT EXISTS (SELECT 1 FROM po_items pi WHERE pi.order_item_id = oi.id);
END;
$function$
;
