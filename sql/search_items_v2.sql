-- ═══════════════════════════════════════════════════════════════════════
-- search_items_v2 — deterministic, tiered item search
-- Applied 2026-08-30.  See docs/audits/search-quality-2026-08-30.md
--
-- Replaces the BEHAVIOUR of search_items_fuzzy(), which used trigram
-- similarity as the MEMBERSHIP FILTER (pg_trgm default threshold 0.3). On a
-- corpus of same-shaped part codes that admits every sibling in a family, so
-- typing more characters did not narrow the list; and it ranked on RAW strings,
-- so 45% of codes (4,423 carry legacy spaces) were scored against a query
-- punctuated differently. 12.5% of punctuated codes did not rank first.
--
-- search_items_fuzzy() is NOT modified. It stays live so rollback is reverting
-- one constant in src/lib/itemSearch.js — no database change.
--
-- DESIGN RULES — do not "simplify" these away:
--   R1 MEMBERSHIP IS DETERMINISTIC. Tiers 0-4 are exact / prefix / contains /
--      all-tokens-present / brand.
--      No similarity score decides whether an item is FINDABLE.
--   R2 FUZZY CAN ONLY ADD, NEVER DISPLACE. Tiers 5-6 are evaluated only when
--      the strict tiers cannot fill the page, and always sort last.
--   R3 NON-LOSSY ON THE STRICT TIERS. Tier 4a/4c reproduce v1's trigram clauses
--      with its RAW operands, tier 5 its reverse-containment clause, so nothing
--      v1 could MATCH is unmatchable here. If you change tier 4's operands you
--      break this. Re-run the suite.
--      DELIBERATE EXCEPTION: suggestions are capped at FUZZY_FILL (12) total
--      rows, so v1's long fuzzy tail is not reproduced at large p_limit. That
--      tail is what made an exact-code search on Item Master report "23 items".
--   R4 ONE INDEX-SERVED PREDICATE PER BRANCH, COMBINED WITH UNION ALL.
--      v1 ORed five predicates inside one CTE join, which made the whole WHERE
--      non-index-qualifiable: seq scan of all 9,848 rows + similarity() on every
--      one, 116ms per keystroke, both GIN indexes unused. NEVER OR across
--      differently-indexed columns here.
--   R5 SECURITY INVOKER — RLS on public.items still applies to the caller.
--
-- ORDERING — the rules that are easy to get wrong:
--   * SI ranks above CI across the WHOLE result list (user's rule, 2026-08-30) —
--     only 359 of 9,848 items are SI, and sales want the standard item first.
--     EXCEPTION: an exact (tier 0) match on the typed code still outranks it,
--     or typing a CI code in full could put an SI item above it.
--     This key must be FIRST in the per-tier inner sorts too — see below.
--   * Shortest-code-first applies to the PRECISION tiers (0-3) only. It is what
--     puts MAD 1401040R5 above MAD1401040R5X. Applying it to the FUZZY tiers
--     ranks a short near-miss above a long good match (BNS33-12Z beat
--     BNS33 - 12Z - 2187). Tiers 4-5 sort by similarity first.
--   * The per-tier LIMIT push-down is what bounds work to ~6 x limit rows
--     regardless of catalogue size. Its inner ORDER BY must match the outer one
--     EXACTLY or it cuts the wrong rows at the tier boundary — the top few
--     results still look right, so this is invisible to review.
--
-- Measured after these indexes: 1.3-22 ms, ZERO seq scans, vs 50-175 ms before.
-- ═══════════════════════════════════════════════════════════════════════

-- Additive, NON-UNIQUE (8 code pairs collide after normalisation: CTS2.5UNBK/
-- CTS25UNBK, FX-3U-32BL/FX3U-32BL, CGT-35U/CGT35U, ...). Collation is
-- en_US.UTF-8, so a plain btree CANNOT serve LIKE 'x%' — text_pattern_ops is
-- required for the prefix tier. Both already applied.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_code_norm_btree
  ON public.items (lower(regexp_replace(item_code, '[^a-zA-Z0-9]', '', 'g')));
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_code_norm_btree_pat
  ON public.items (lower(regexp_replace(item_code, '[^a-zA-Z0-9]', '', 'g')) text_pattern_ops);
-- Pre-existing and still used: idx_items_code_norm_trgm (tiers 2, 4b),
-- idx_items_item_code_trgm (4a), idx_items_brand_trgm (3, 4c), items_item_no_key (0).

-- NOTE: adding a column to RETURNS TABLE changes the return type, which
-- CREATE OR REPLACE cannot do — hence the DROP. Safe only while nothing in
-- production calls this; search_items_fuzzy is what production still uses.
DROP FUNCTION IF EXISTS public.search_items_v2(text, integer);
CREATE FUNCTION public.search_items_v2(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (
  id uuid, item_no text, item_code text, brand text, category text,
  subcategory text, type text, item_status text, superseded_by text,
  description text, sim real, tier smallint
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = public, pg_catalog
SET statement_timeout = '5s'
AS $fn$
WITH q AS (
  SELECT btrim(p_query)                                            AS raw,
         lower(btrim(p_query))                                     AS raw_lc,
         lower(regexp_replace(p_query,'[^a-zA-Z0-9]','','g'))      AS norm,
         length(lower(regexp_replace(p_query,'[^a-zA-Z0-9]','','g'))) AS nlen,
         upper(btrim(p_query))                                     AS ino,
         GREATEST(COALESCE(p_limit,20), 1)                         AS lim
),
-- Every substring of the query >= 4 chars. Equivalent to the legacy clause
-- q.norm LIKE '%'||code||'%' but expressed as an ARRAY so the btree index is
-- usable (= ANY(subquery) becomes a semi-join and hashes the whole table;
-- = ANY(ARRAY[...]) is a ScalarArrayOp and probes the index).
cands AS (
  SELECT array_agg(DISTINCT substr(q.norm, s, l)) AS arr
    FROM q, generate_series(1, LEAST(q.nlen,40)) s, generate_series(4, LEAST(q.nlen,40)) l
   WHERE s + l - 1 <= LEAST(q.nlen,40)
),
-- Normalised whitespace-separated tokens of the query, longest first. Feeds the
-- token-AND tier: normalisation glues "PA PG 21" into "papg21", which then has
-- to appear CONTIGUOUSLY, so "PA Slit Conduit,PG 21,Black" was missed and
-- "PG 21 PA" (same words, different order) found nothing at all.
toks AS (
  SELECT array_agg(t ORDER BY length(t) DESC) AS arr,
         (array_agg(t ORDER BY length(t) DESC))[1] AS lead
    FROM (SELECT DISTINCT lower(regexp_replace(w,'[^a-zA-Z0-9]','','g')) AS t
            FROM q, regexp_split_to_table(q.raw, '\s+') w
           WHERE lower(regexp_replace(w,'[^a-zA-Z0-9]','','g')) <> '') x
),
-- Each branch = ONE index-served predicate. Never OR across indexes.
strict AS (
  SELECT i.id, 0::smallint AS tier FROM public.items i, q
   WHERE q.nlen > 0 AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) = q.norm
  UNION ALL
  SELECT i.id, 0::smallint FROM public.items i, q
   WHERE q.ino ~ '^IN[0-9]+$' AND i.item_no = q.ino
  UNION ALL
  SELECT id, 1::smallint AS tier FROM (
    SELECT i.id FROM public.items i, q WHERE q.nlen > 0 AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE q.norm || '%'
     ORDER BY CASE WHEN i.type = 'SI' THEN 0 ELSE 1 END,
              length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
              similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
              i.item_code
     LIMIT (SELECT lim FROM q)) z
  UNION ALL
  SELECT id, 2::smallint AS tier FROM (
    SELECT i.id FROM public.items i, q WHERE q.nlen >= 3 AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE '%' || q.norm || '%'
     ORDER BY CASE WHEN i.type = 'SI' THEN 0 ELSE 1 END,
              length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
              similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
              i.item_code
     LIMIT (SELECT lim FROM q)) z
  UNION ALL
  -- Tier 3: ALL tokens present, in any order. Driven off the LONGEST token so
  -- the trigram index does the selection; the remaining tokens are a filter.
  SELECT id, 3::smallint AS tier FROM (
    SELECT i.id FROM public.items i, q, toks tk
     WHERE array_length(tk.arr,1) >= 2
       AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE '%' || tk.lead || '%'
       AND NOT EXISTS (SELECT 1 FROM unnest(tk.arr) t
                        WHERE lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) NOT LIKE '%' || t || '%')
     ORDER BY CASE WHEN i.type = 'SI' THEN 0 ELSE 1 END,
              length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
              similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
              i.item_code
     LIMIT (SELECT lim FROM q)) z
  UNION ALL
  SELECT id, 4::smallint AS tier FROM (
    SELECT i.id FROM public.items i, q WHERE q.nlen >= 3 AND i.brand ILIKE '%' || q.raw || '%'
     ORDER BY CASE WHEN i.type = 'SI' THEN 0 ELSE 1 END,
              length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
              similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
              i.item_code
     LIMIT (SELECT lim FROM q)) z
),
strict_best AS (SELECT id, min(tier) AS tier FROM strict GROUP BY id),
-- Tier 5-6: typo fallback. Evaluated ONLY when the strict tiers cannot fill the page.
fuzzy AS (
  -- 5a: v1's exact clause, raw operands  -> idx_items_item_code_trgm
  SELECT i.id, 5::smallint AS tier FROM public.items i, q
   WHERE NOT EXISTS (SELECT 1 FROM strict_best)
     AND q.nlen >= 4
     AND i.item_code % q.raw
  UNION ALL
  -- 5b: normalised trigram (punctuation-blind typos) -> idx_items_code_norm_trgm
  SELECT i.id, 5::smallint FROM public.items i, q
   WHERE NOT EXISTS (SELECT 1 FROM strict_best)
     AND q.nlen >= 4
     AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) % q.norm
  UNION ALL
  -- 5c: v1's brand trigram clause -> idx_items_brand_trgm
  SELECT i.id, 5::smallint FROM public.items i, q
   WHERE NOT EXISTS (SELECT 1 FROM strict_best)
     AND q.nlen >= 4
     AND i.brand % q.raw
  UNION ALL
  -- Tier 6: legacy reverse-containment ("the code is inside what I typed"),
  -- rewritten as equality against the enumerated substrings of the query so it
  -- is index-served rather than a seq scan. Identical semantics.
  SELECT i.id, 6::smallint FROM public.items i, cands c
   WHERE NOT EXISTS (SELECT 1 FROM strict_best)
     AND lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) = ANY (c.arr)
),
-- Suggestions are a LAST RESORT, never padding: they appear ONLY when the
-- strict tiers found NOTHING, and are then capped at 12. Typing a real part code
-- stem must return its family and stop — "MAD1401030" found 4 real matches and
-- the list was then padded to 12 with unrelated codes, which is noise, not help. Item Master asks for 200 rows; without this cap an exact-code search
-- returned 2 matches followed by 21 guesses and reported "23 items".
-- Deliberate consequence: fuzzy rows beyond the cap are not returned, so v2 is a
-- superset of v1 on the STRICT tiers only. See the note in section R3 above.
fuzzy_ranked AS (
  SELECT f.id, min(f.tier) AS tier
    FROM fuzzy f
   WHERE NOT EXISTS (SELECT 1 FROM strict_best s WHERE s.id = f.id)
   GROUP BY f.id
),
fuzzy_capped AS (
  SELECT fr.id, fr.tier
    FROM fuzzy_ranked fr JOIN public.items i ON i.id = fr.id, q
   ORDER BY fr.tier,
            similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
            length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
            i.item_code
   LIMIT LEAST((SELECT lim FROM q), 12)
),
best AS (SELECT id, tier FROM strict_best UNION ALL SELECT id, tier FROM fuzzy_capped)
SELECT i.id, i.item_no, i.item_code, i.brand, i.category, i.subcategory, i.type,
       i.item_status, i.superseded_by, i.description,
       similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) AS sim,
       b.tier
  FROM best b JOIN public.items i ON i.id = b.id, q
 ORDER BY CASE WHEN b.tier = 0 THEN 0 ELSE 1 END,
          CASE WHEN i.type = 'SI' THEN 0 ELSE 1 END,
          b.tier,
          CASE WHEN b.tier <= 4
               THEN length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g'))
               ELSE 0 END,
          similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) DESC,
          length(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')),
          i.item_code
 LIMIT (SELECT lim FROM q);
$fn$;

REVOKE ALL ON FUNCTION public.search_items_v2(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_items_v2(text, integer) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- search_items_similar — duplicate detection ONLY (New Item typeahead)
--
-- Deliberately NOT search_items_v2. The two jobs pull in opposite directions:
--   picking an item  -> PRECISION. Show what I typed, converge, no noise.
--   preventing a dup -> RECALL.    Show me anything close, ALWAYS, even when
--                                  something already matched exactly.
-- search_items_v2 suppresses suggestions the moment the strict tiers match
-- anything — correct for a picker, and exactly wrong here: typing a code that
-- happens to prefix-match one item would hide the six near-misses that are the
-- whole point of the check.
--
-- So: trigram near-misses, unconditionally, ranked by similarity. Never used by
-- a picker. Exact duplicates are still blocked at the DB by create_item().
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_items_similar(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (id uuid, item_no text, item_code text, brand text, category text,
               item_status text, superseded_by text, sim real)
LANGUAGE sql STABLE PARALLEL SAFE SECURITY INVOKER
SET search_path = public, pg_catalog
SET statement_timeout = '5s'
AS $fn$
  WITH q AS (SELECT lower(regexp_replace(p_query,'[^a-zA-Z0-9]','','g')) AS norm)
  SELECT i.id, i.item_no, i.item_code, i.brand, i.category,
         i.item_status, i.superseded_by,
         similarity(lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')), q.norm) AS sim
    FROM public.items i, q
   WHERE length(q.norm) >= 2
     AND ( lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) % q.norm
        OR lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE '%' || q.norm || '%' )
   ORDER BY sim DESC, length(i.item_code), i.item_code
   LIMIT GREATEST(COALESCE(p_limit,8), 1);
$fn$;
REVOKE ALL ON FUNCTION public.search_items_similar(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.search_items_similar(text, integer) TO authenticated;
