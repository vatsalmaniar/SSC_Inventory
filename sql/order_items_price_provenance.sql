-- Price provenance on order_items — "which agreement priced this line?"
--
-- po_items has carried this since the purchase-pricing work; order_items never
-- did, so a sales line could be priced from an SPA and keep no record of it.
-- Same five columns, same names, same types, so the two sides stay legible
-- together.
--
-- ADDITIVE ONLY. Every column is nullable (or defaulted), nothing is backfilled
-- and no existing row is rewritten: ADD COLUMN does not fire row triggers, so
-- the 8,000+ existing order lines keep their real updated_at. Stamping them
-- would destroy the audit trail the column exists for.
--
-- price_record_id is deliberately NOT a foreign key to item_prices, matching
-- po_items. A price record can be superseded or withdrawn; the line must still
-- record which record priced it at the time. Provenance outlives its source.

alter table public.order_items
  add column if not exists price_source      text,          -- 'SPA' | 'MANUAL'
  add column if not exists price_record_id   uuid,          -- item_prices.id used
  add column if not exists spa_no            text,          -- human-readable agreement no.
  add column if not exists price_resolved_at timestamptz,   -- when it was looked up
  add column if not exists price_overridden  boolean not null default false;

comment on column public.order_items.price_source      is 'SPA when the line was priced from a sell-side agreement, MANUAL when typed.';
comment on column public.order_items.price_record_id   is 'item_prices.id that supplied the price. Intentionally not an FK — provenance outlives a superseded price record.';
comment on column public.order_items.spa_no            is 'Agreement number the price came from, e.g. SSC/SPA0006/26-27.';
comment on column public.order_items.price_overridden  is 'True when an agreed rate was changed by hand before saving.';

-- Reading provenance follows the row: anyone who can see the order line can see
-- where its price came from. No new policy needed — these are columns on a table
-- that is already governed.

-- ── replace_order_items must not let provenance LIE ────────────────────────
-- The edit path matches lines POSITIONALLY (row i of the payload updates row i
-- of the order). Provenance columns are not in its SET list, so they would
-- survive an edit untouched — including an edit that changed the row's item or
-- its price. The line would then name an agreement that never priced it.
--
-- So: carry provenance when the caller sends it, and otherwise CLEAR it the
-- moment the row's item code or unit price stops matching what was agreed.
-- Inside UPDATE ... SET, a bare column reference is the OLD value, which is
-- what makes the comparison below work.
--
-- Everything else in this function is unchanged from the deployed version.

create or replace function public.replace_order_items(p_order_id uuid, p_items jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
        description          = NULLIF(item->>'description', ''),
        -- provenance: explicit from the caller, else kept only while it is still true
        spa_no = CASE
                   WHEN item ? 'spa_no' THEN NULLIF(item->>'spa_no', '')
                   WHEN item_code IS DISTINCT FROM (item->>'item_code')
                     OR unit_price_after_disc IS DISTINCT FROM (item->>'unit_price_after_disc')::numeric
                   THEN NULL ELSE spa_no END,
        price_record_id = CASE
                   WHEN item ? 'price_record_id' THEN NULLIF(item->>'price_record_id', '')::uuid
                   WHEN item_code IS DISTINCT FROM (item->>'item_code')
                     OR unit_price_after_disc IS DISTINCT FROM (item->>'unit_price_after_disc')::numeric
                   THEN NULL ELSE price_record_id END,
        price_source = CASE
                   WHEN item ? 'price_source' THEN NULLIF(item->>'price_source', '')
                   WHEN item_code IS DISTINCT FROM (item->>'item_code')
                     OR unit_price_after_disc IS DISTINCT FROM (item->>'unit_price_after_disc')::numeric
                   THEN 'MANUAL' ELSE price_source END,
        price_resolved_at = CASE
                   WHEN item ? 'price_resolved_at' THEN NULLIF(item->>'price_resolved_at', '')::timestamptz
                   WHEN item_code IS DISTINCT FROM (item->>'item_code')
                     OR unit_price_after_disc IS DISTINCT FROM (item->>'unit_price_after_disc')::numeric
                   THEN NULL ELSE price_resolved_at END,
        price_overridden = CASE
                   WHEN item ? 'price_overridden' THEN (item->>'price_overridden')::boolean
                   -- an agreed line whose price was edited here IS an override
                   WHEN spa_no IS NOT NULL
                     AND unit_price_after_disc IS DISTINCT FROM (item->>'unit_price_after_disc')::numeric
                   THEN true ELSE price_overridden END
      WHERE id = matched_id;
      keep_ids := keep_ids || matched_id;
    ELSE
      INSERT INTO order_items (order_id, sr_no, item_code, qty, lp_unit_price, discount_pct, unit_price_after_disc, total_price, dispatch_date, customer_ref_no, description,
                               spa_no, price_record_id, price_source, price_resolved_at, price_overridden)
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
        NULLIF(item->>'description', ''),
        NULLIF(item->>'spa_no', ''),
        NULLIF(item->>'price_record_id', '')::uuid,
        COALESCE(NULLIF(item->>'price_source', ''), 'MANUAL'),
        NULLIF(item->>'price_resolved_at', '')::timestamptz,
        COALESCE((item->>'price_overridden')::boolean, false)
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
$function$;
