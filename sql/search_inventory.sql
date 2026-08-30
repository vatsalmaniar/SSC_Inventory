-- ═══════════════════════════════════════════════════════════════════════
-- search_inventory — /inventory (Sales stock check), the most-used screen
--
-- Was:  .ilike('product_code', '%'||q||'%')
-- which cannot find any of the 1,781 rows (42%) whose Tally code carries a
-- space. Typing "UNI704" returned 0 rows while the stock sat there under
-- "UNI 704-B ZDA 48 05 00"; "M124mm" returned 0 of 6; "MAD140" returned 4 of 7.
-- Sales concluded there was no stock when there was.
--
-- Same tier model as search_items_v2 (see sql/search_items_v2.sql for the
-- design rules) so the two screens behave identically:
--   0 exact  1 prefix  2 contains  3 all-tokens-present   -> real matches
--   5 trigram, ONLY when nothing above matched             -> suggestions
--
-- NOTHING IS RENAMED. Normalisation happens on both sides of the comparison at
-- query time only. inventory.product_code comes from the daily Tally XLS and
-- must keep Tally's exact spelling — see memory: never-rename-part-codes.
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_code_norm_btree
  ON public.inventory (lower(regexp_replace(product_code, '[^a-zA-Z0-9]', '', 'g')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_code_norm_btree_pat
  ON public.inventory (lower(regexp_replace(product_code, '[^a-zA-Z0-9]', '', 'g')) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_code_norm_trgm
  ON public.inventory USING gin (lower(regexp_replace(product_code, '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_inventory(p_query text, p_limit integer DEFAULT 200)
RETURNS TABLE (id uuid, product_code text, quantity integer, category_brand text,
               location text, updated_at timestamptz, tier smallint)
LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = public, pg_catalog
SET statement_timeout = '5s'
AS $fn$
  WITH q AS (
    SELECT btrim(p_query) AS raw,
           lower(regexp_replace(p_query,'[^a-zA-Z0-9]','','g')) AS norm,
           length(lower(regexp_replace(p_query,'[^a-zA-Z0-9]','','g'))) AS nlen,
           GREATEST(COALESCE(p_limit,200),1) AS lim
  ),
  toks AS (
    SELECT array_agg(t ORDER BY length(t) DESC) AS arr,
           (array_agg(t ORDER BY length(t) DESC))[1] AS lead
      FROM (SELECT DISTINCT lower(regexp_replace(w,'[^a-zA-Z0-9]','','g')) AS t
              FROM q, regexp_split_to_table(q.raw,'\s+') w
             WHERE lower(regexp_replace(w,'[^a-zA-Z0-9]','','g')) <> '') x
  ),
  -- One index-served predicate per branch, UNION ALL. Never OR across indexes.
  strict AS (
    SELECT v.id, 0::smallint AS tier FROM public.inventory v, q
     WHERE q.nlen > 0 AND lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) = q.norm
    UNION ALL
    SELECT v.id, 1::smallint FROM public.inventory v, q
     WHERE q.nlen > 0 AND lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) LIKE q.norm || '%'
    UNION ALL
    SELECT v.id, 2::smallint FROM public.inventory v, q
     WHERE q.nlen >= 3 AND lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) LIKE '%' || q.norm || '%'
    UNION ALL
    SELECT v.id, 3::smallint FROM public.inventory v, q, toks tk
     WHERE array_length(tk.arr,1) >= 2
       AND lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) LIKE '%' || tk.lead || '%'
       AND NOT EXISTS (SELECT 1 FROM unnest(tk.arr) t
                        WHERE lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) NOT LIKE '%' || t || '%')
  ),
  strict_best AS (SELECT id, min(tier) AS tier FROM strict GROUP BY id),
  -- Suggestions are a LAST RESORT, never padding: only when nothing matched.
  loose AS (
    SELECT v.id, 5::smallint AS tier FROM public.inventory v, q
     WHERE NOT EXISTS (SELECT 1 FROM strict_best) AND q.nlen >= 4
       AND lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) % q.norm
  ),
  best AS (SELECT id, tier FROM strict_best UNION ALL SELECT id, tier FROM loose)
  SELECT v.id, v.product_code, v.quantity, v.category_brand, v.location, v.updated_at, b.tier
    FROM best b JOIN public.inventory v ON v.id = b.id, q
   -- Warehouse rows for the same code must stay adjacent, hence code before location.
   ORDER BY b.tier,
            CASE WHEN b.tier <= 3 THEN length(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')) ELSE 0 END,
            similarity(lower(regexp_replace(v.product_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
            v.product_code, v.location
   LIMIT (SELECT lim FROM q);
$fn$;
REVOKE ALL ON FUNCTION public.search_inventory(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_inventory(text, integer) TO authenticated;
