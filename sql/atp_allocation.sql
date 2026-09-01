-- ═══════════════════════════════════════════════════════════════════════
-- atp_allocation() — Available to Promise, computed ONCE on the server
--
-- Replaces the per-browser snapshot in src/pages/AvailableToPromise.jsx, which
-- had every user download all 3,070 FY orders + the whole 4,199-row stock sheet
-- (9 round trips, 3.2 MB of JSON) and run FIFO locally, caching the result in
-- that browser's localStorage. Consequences it removes:
--   * two users could see different allocations of the same stock
--   * a phone and a desktop disagreed
--   * accounts uploading a new sheet propagated to nobody — every user had to
--     notice a banner and press Sync themselves
-- One call, 143 kB, same numbers for everyone.
--
-- FAITHFUL PORT of src/lib/dispatchability.js — buildStockMap + allocateFifo +
-- deriveOrderBucket + computeCounts, rule for rule. It is NOT a re-derivation.
-- Keep that file until parity has run clean in production for a week; it is the
-- reference implementation this is tested against.
--
-- ── THINGS THAT WILL BREAK IF "SIMPLIFIED" ────────────────────────────────
--
-- 1. STOCK POOLS MUST BE A TEMP TABLE, NEVER A jsonb OBJECT.
--    Measured 2026-09-01 on live data (1,334 pending lines, 4,199 stock rows):
--        jsonb pools + jsonb_set per line ... 1,245 ms
--        temp table + indexed UPDATE ........   ~100 ms
--    jsonb_set copies the whole object every line, so the loop goes quadratic
--    in the number of stock codes. 12x difference. Do not "tidy" this back.
--
-- 2. MATCHING IS EXACT STRING EQUALITY on the raw code. Never substring, never
--    prefix, never the punctuation-stripped form used by item search. A short
--    inventory code matching inside a longer order code once inflated the
--    dispatchable figure badly.
--
-- 3. norm_code() here COLLAPSES WHITESPACE AND UPPERCASES ONLY — it does NOT
--    strip punctuation, unlike codeIncludes/normCode in src/lib/itemSearch.js.
--    It exists solely for the near-miss DIAGNOSTIC ("differs in spacing/case"),
--    never for matching or allocation. Using the search version here would
--    silently widen it.
--
-- 4. `known` counts a code the sheet carries even at qty 0 — the daily upload
--    zeroes out-of-stock codes rather than deleting them. Known+empty must read
--    "No Stock", not "Not in Sheet" (the SPMNCSHT1804R5 lesson).
--
-- 5. Sort is (order_date NULLS LAST, order_number, sr_no). An undated order
--    must never silently jump the queue.
--
-- 6. NEVER use a bare DELETE or UPDATE without WHERE on the temp tables. The
--    API connection preloads Supabase's `safeupdate`, which rejects them
--    ("DELETE requires a WHERE clause"). It is loaded via
--    session_preload_libraries at CONNECT time, so `SET LOCAL ROLE
--    authenticated` in a test session does NOT reproduce it — verify against
--    the real API path, not just SET ROLE.
--
-- READ-ONLY. Writes nothing. The list stays advisory — enforcement remains in
-- the dispatch flow (FIFO jump warning + dispatch_order_batch).
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.atp_norm_code(c text)
RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT upper(regexp_replace(btrim(coalesce(c,'')), '\s+', ' ', 'g')) $$;

CREATE OR REPLACE FUNCTION public.atp_allocation(p_test boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE                      -- creates temp tables; cannot be STABLE
SECURITY INVOKER              -- RLS on orders/order_items/inventory still applies
SET search_path = public, pg_catalog
SET statement_timeout = '20s'
AS $fn$
DECLARE
  l record;
  v_avail_pref numeric; v_avail_oth numeric;
  v_take_pref  numeric; v_take_oth  numeric;
  v_other text;
  v_orders jsonb; v_result jsonb;
BEGIN
  -- ── buildStockMap ──────────────────────────────────────────────────────
  CREATE TEMP TABLE IF NOT EXISTS _atp_pool
    (code text, loc text, q numeric, PRIMARY KEY (code, loc)) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _atp_alloc
    (order_id uuid, sr_no int, item_code text, pend numeric, alloc numeric,
     from_kaveri numeric, from_godawari numeric, bucket text, near_miss boolean,
     unit_price numeric) ON COMMIT DROP;
  -- `known` and `norm_index` are built ONCE here, exactly as buildStockMap does.
  -- Querying `inventory` per line instead measured 3,162 ms vs 100 ms.
  CREATE TEMP TABLE IF NOT EXISTS _atp_known (code text PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE IF NOT EXISTS _atp_norm  (norm text PRIMARY KEY) ON COMMIT DROP;
  -- TRUNCATE, never bare DELETE. Supabase loads the `safeupdate` extension via
  -- session_preload_libraries on the API's connection, which rejects any DELETE
  -- or UPDATE without a WHERE clause: "DELETE requires a WHERE clause". It loads
  -- at CONNECT time, so `SET LOCAL ROLE authenticated` does NOT pick it up —
  -- this passed every test here and failed for every real user (2026-09-01).
  TRUNCATE _atp_pool, _atp_alloc, _atp_known, _atp_norm;

  -- every code the sheet carries in a known godown, INCLUDING qty 0 (see note 4)
  INSERT INTO _atp_known (code)
  SELECT DISTINCT product_code FROM inventory
   WHERE product_code IS NOT NULL AND location IN ('Kaveri','Godawari');

  INSERT INTO _atp_pool (code, loc, q)
  SELECT product_code, location, sum(quantity)
    FROM inventory
   WHERE quantity > 0 AND location IN ('Kaveri','Godawari') AND product_code IS NOT NULL
   GROUP BY product_code, location;

  -- near-miss diagnostic index: normalised forms of codes that HAVE stock
  INSERT INTO _atp_norm (norm)
  SELECT DISTINCT atp_norm_code(code) FROM _atp_pool;

  -- ── allocateFifo: one pass, strict FIFO, preferred warehouse first ─────
  FOR l IN
    SELECT o.id AS order_id, oi.sr_no, oi.item_code,
           CASE WHEN o.fulfilment_center IN ('Kaveri','Godawari')
                THEN o.fulfilment_center ELSE 'Kaveri' END AS pref,
           greatest(0, oi.qty - coalesce(oi.dispatched_qty,0) - coalesce(oi.cancelled_qty,0)) AS pend,
           coalesce(oi.unit_price_after_disc,0) AS unit_price
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.is_test = p_test
       AND o.status NOT IN ('dispatched_fc','closed','cancelled')
       AND o.order_type <> 'SAMPLE'
       AND o.created_at >= (date_trunc('year', now()) + interval '3 months'
                            - CASE WHEN extract(month FROM now()) < 4 THEN interval '1 year'
                                   ELSE interval '0' END)
       AND coalesce(oi.line_status,'') <> 'cancelled'
       AND greatest(0, oi.qty - coalesce(oi.dispatched_qty,0) - coalesce(oi.cancelled_qty,0)) > 0
     ORDER BY o.order_date NULLS LAST, o.order_number, coalesce(oi.sr_no,0)
  LOOP
    v_other := CASE WHEN l.pref = 'Kaveri' THEN 'Godawari' ELSE 'Kaveri' END;
    SELECT q INTO v_avail_pref FROM _atp_pool WHERE code = l.item_code AND loc = l.pref;
    SELECT q INTO v_avail_oth  FROM _atp_pool WHERE code = l.item_code AND loc = v_other;

    IF NOT EXISTS (SELECT 1 FROM _atp_pool WHERE code = l.item_code) THEN
      -- No qty>0 row anywhere: the JS `if (!avail)` branch.
      INSERT INTO _atp_alloc VALUES (
        l.order_id, coalesce(l.sr_no,0), l.item_code, l.pend, 0, 0, 0,
        CASE WHEN EXISTS (SELECT 1 FROM _atp_known k WHERE k.code = l.item_code)
             THEN 'no_stock' ELSE 'not_in_sheet' END,
        NOT EXISTS (SELECT 1 FROM _atp_known k WHERE k.code = l.item_code)
          AND EXISTS (SELECT 1 FROM _atp_norm n WHERE n.norm = atp_norm_code(l.item_code)),
        l.unit_price);
      CONTINUE;
    END IF;

    v_avail_pref := coalesce(v_avail_pref, 0);
    v_avail_oth  := coalesce(v_avail_oth, 0);
    v_take_pref  := least(v_avail_pref, l.pend);
    v_take_oth   := least(v_avail_oth, l.pend - v_take_pref);

    UPDATE _atp_pool SET q = q - v_take_pref WHERE code = l.item_code AND loc = l.pref;
    UPDATE _atp_pool SET q = q - v_take_oth  WHERE code = l.item_code AND loc = v_other;

    INSERT INTO _atp_alloc VALUES (
      l.order_id, coalesce(l.sr_no,0), l.item_code, l.pend, v_take_pref + v_take_oth,
      CASE WHEN l.pref = 'Kaveri' THEN v_take_pref ELSE v_take_oth END,
      CASE WHEN l.pref = 'Godawari' THEN v_take_pref ELSE v_take_oth END,
      CASE WHEN v_take_pref + v_take_oth = 0 THEN 'no_stock'
           WHEN v_take_pref + v_take_oth < l.pend THEN 'partial'
           ELSE 'full' END,
      false, l.unit_price);
  END LOOP;

  -- ── Order rollup + deriveOrderBucket ──────────────────────────────────
  -- One grouped aggregate. A per-order correlated subquery for the nested lines
  -- was tried and measured SLOWER (300 ms vs 254 ms) — 466 correlated scans beat
  -- by one sorted group. Do not "optimise" it back.
  --
  -- SEND ONLY WHAT THE PAGE READS. The first cut also returned a top-level
  -- `lines` array — every line a second time — which nothing consumes (the page
  -- reads r.lines, nested). unit_price is likewise unused client-side; it is
  -- needed only to compute alloc_value here.
  SELECT jsonb_agg(x ORDER BY x.order_date NULLS LAST, x.order_number)
    INTO v_orders
  FROM (
    SELECT o.id AS order_id, o.order_number, o.order_date, o.customer_name,
           coalesce(o.account_owner, o.engineer_name, '') AS owner,
           coalesce(o.order_type,'SO') AS order_type, o.status AS order_status,
           o.hold_party, o.hold_reason,
           (o.partial_deliveries_allowed = true) AS partials_allowed,
           count(*)::int AS line_count,
           count(*) FILTER (WHERE a.bucket = 'full')::int AS covered_lines,
           sum(a.pend) AS pend_qty, sum(a.alloc) AS alloc_qty,
           sum(a.alloc * a.unit_price) AS alloc_value,
           sum(a.from_kaveri) AS from_kaveri, sum(a.from_godawari) AS from_godawari,
           CASE WHEN sum(a.from_kaveri) > 0 AND sum(a.from_godawari) > 0 THEN 'Both'
                WHEN sum(a.from_kaveri) > 0 THEN 'Kaveri'
                WHEN sum(a.from_godawari) > 0 THEN 'Godawari' ELSE '—' END AS stock_loc,
           CASE WHEN bool_and(a.bucket = 'full') THEN 'full'
                WHEN sum(a.alloc) > 0 THEN
                     CASE WHEN o.partial_deliveries_allowed = true THEN 'partial'
                          ELSE 'blocked_partial' END
                WHEN bool_and(a.bucket = 'not_in_sheet') THEN 'not_in_sheet'
                ELSE 'no_stock' END AS bucket,
           -- Line objects carry ONLY per-line facts. order_number / date /
           -- customer / type / owner are NOT repeated here: the Excel export
           -- flattens r.lines and already augments each line from `r`, so
           -- repeating them cost ~200 kB per call for nothing.
           jsonb_agg(jsonb_build_object(
             'order_id', a.order_id, 'sr_no', a.sr_no, 'item_code', a.item_code,
             'pend', a.pend, 'alloc', a.alloc,
             'from_kaveri', a.from_kaveri, 'from_godawari', a.from_godawari,
             'bucket', a.bucket, 'near_miss', a.near_miss)
             ORDER BY a.sr_no) AS lines
      FROM _atp_alloc a JOIN orders o ON o.id = a.order_id
     GROUP BY o.id, o.order_number, o.order_date, o.customer_name, o.account_owner,
              o.engineer_name, o.order_type, o.status, o.hold_party, o.hold_reason,
              o.partial_deliveries_allowed
  ) x;

  v_result := jsonb_build_object(
    'orders', coalesce(v_orders, '[]'::jsonb),
    'bucketCounts', (SELECT jsonb_object_agg(bucket, n) FROM
                      (SELECT bucket, count(*) n FROM _atp_alloc GROUP BY bucket) b),
    -- no-silent-drop invariant: every pending line landed in exactly one bucket
    'reconciled', (SELECT count(*) = count(*) FILTER (
                     WHERE bucket IN ('full','partial','no_stock','not_in_sheet'))
                     FROM _atp_alloc),
    'nearMissCount', (SELECT count(*) FROM _atp_alloc WHERE near_miss),
    'counts', (SELECT jsonb_build_object(
                 'so',      count(*) FILTER (WHERE e->>'order_type'='SO' AND e->>'bucket' IN ('full','partial')),
                 'co',      count(*) FILTER (WHERE e->>'order_type'='CO' AND e->>'bucket' IN ('full','partial')),
                 'soTotal', count(*) FILTER (WHERE e->>'order_type'='SO'),
                 'coTotal', count(*) FILTER (WHERE e->>'order_type'='CO'))
                 FROM jsonb_array_elements(coalesce(v_orders,'[]'::jsonb)) e),
    'ghostLocations', (SELECT coalesce(jsonb_agg(DISTINCT btrim(location) ORDER BY btrim(location)), '[]'::jsonb)
                         FROM inventory
                        WHERE btrim(coalesce(location,'')) <> ''
                          AND btrim(location) NOT IN ('Kaveri','Godawari')),
    'freshness', (SELECT coalesce(jsonb_object_agg(loc, jsonb_build_object('min', mn, 'max', mx)), '{}'::jsonb)
                    FROM (SELECT location loc, min(updated_at) mn, max(updated_at) mx
                            FROM inventory
                           WHERE quantity > 0 AND location IN ('Kaveri','Godawari')
                           GROUP BY location) f)
  );

  RETURN v_result;
END $fn$;

REVOKE ALL ON FUNCTION public.atp_allocation(boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.atp_allocation(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.atp_norm_code(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.atp_norm_code(text) TO authenticated;

-- Rollback: src/pages/AvailableToPromise.jsx keeps the client path behind one
-- constant until parity is clean. Reverting that constant restores the old
-- behaviour with no database change. To remove entirely:
--   DROP FUNCTION IF EXISTS public.atp_allocation(boolean);
--   DROP FUNCTION IF EXISTS public.atp_norm_code(text);
