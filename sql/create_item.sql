-- ═══════════════════════════════════════════════════════════════════
-- Item creation + fuzzy search
--   1. idx_items_code_norm_trgm  — functional GIN trigram index on the
--      normalized (space/punct-stripped) item_code, so normalized
--      matching is index-served (no seq scan, lighter than %ILIKE%).
--   2. get_all_subcategories()   — subcategory dropdown source.
--   3. search_items_fuzzy()      — fuzzy item search used by New Order,
--      Item 360 search, and the New Item dup-prevention typeahead.
--      Matches item_code (trigram + normalized) AND brand. Server-side,
--      LIMIT on results only — every one of the 9,700+ items stays
--      searchable (no client preload, no 1000-row cap).
--   4. create_item()             — admin/management only, atomic IN####,
--      blocks NORMALIZED-identical duplicates (option C).
-- All additive. No table/column/policy changes.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Functional trigram index on normalized item_code
CREATE INDEX IF NOT EXISTS idx_items_code_norm_trgm ON public.items
USING gin (lower(regexp_replace(item_code, '[^a-zA-Z0-9]', '', 'g')) gin_trgm_ops);

-- 2. Subcategory dropdown source
CREATE OR REPLACE FUNCTION get_all_subcategories()
RETURNS TABLE (subcategory text) AS $$
  SELECT DISTINCT items.subcategory FROM public.items
  WHERE items.subcategory IS NOT NULL AND items.subcategory <> ''
  ORDER BY items.subcategory;
$$ LANGUAGE sql STABLE;
GRANT EXECUTE ON FUNCTION get_all_subcategories() TO authenticated;

-- 3. Fuzzy item search
--    p_limit caps the dropdown size (default 20). The WHERE is evaluated
--    against the FULL table via indexes, so the limit never makes an item
--    unsearchable — it only trims the top-N shown.
CREATE OR REPLACE FUNCTION search_items_fuzzy(p_query text, p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, item_no text, item_code text, brand text, category text, subcategory text, type text, sim real) AS $$
  WITH q AS (
    SELECT btrim(p_query) AS raw,
           lower(btrim(p_query)) AS raw_lc,
           lower(regexp_replace(p_query, '[^a-zA-Z0-9]', '', 'g')) AS norm,
           length(regexp_replace(p_query, '[^a-zA-Z0-9]', '', 'g')) AS norm_len
  )
  SELECT i.id, i.item_no, i.item_code, i.brand, i.category, i.subcategory, i.type,
         GREATEST(
           similarity(i.item_code, (SELECT raw FROM q)),
           similarity(COALESCE(i.brand,''), (SELECT raw FROM q))
         ) AS sim
  FROM public.items i, q
  WHERE q.norm <> ''
    AND (
      -- short queries (1-3 normalized chars): prefix/substring so nothing looks "missing"
      ( q.norm_len <= 3 AND (
          lower(regexp_replace(i.item_code, '[^a-zA-Z0-9]', '', 'g')) LIKE q.norm || '%'
          OR lower(i.item_code) LIKE '%' || q.raw_lc || '%'
          OR lower(COALESCE(i.brand,'')) LIKE '%' || q.raw_lc || '%'
      ))
      -- normal queries: trigram (indexed) + normalized substring (indexed) + brand
      OR ( q.norm_len > 3 AND (
          i.item_code % q.raw
          OR lower(regexp_replace(i.item_code, '[^a-zA-Z0-9]', '', 'g')) LIKE '%' || q.norm || '%'
          OR q.norm LIKE '%' || lower(regexp_replace(i.item_code, '[^a-zA-Z0-9]', '', 'g')) || '%'
          OR i.brand % q.raw
          OR lower(COALESCE(i.brand,'')) LIKE '%' || q.raw_lc || '%'
      ))
    )
  ORDER BY sim DESC, i.item_code
  LIMIT GREATEST(p_limit, 1);
$$ LANGUAGE sql STABLE;
GRANT EXECUTE ON FUNCTION search_items_fuzzy(text, integer) TO authenticated;

-- 4. Create item (admin/management only, atomic IN####, normalized-dup block)
CREATE OR REPLACE FUNCTION create_item(
  p_item_code   text,
  p_brand       text,
  p_category    text,
  p_subcategory text DEFAULT NULL,
  p_type        text DEFAULT NULL,
  p_series      text DEFAULT NULL,
  p_notes       text DEFAULT NULL
)
RETURNS public.items AS $$
DECLARE
  v_role     text;
  v_next     integer;
  v_item_no  text;
  v_dup      record;
  v_row      public.items;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','management') THEN
    RAISE EXCEPTION 'Only admin or management can create items';
  END IF;

  IF p_item_code IS NULL OR btrim(p_item_code) = '' THEN RAISE EXCEPTION 'Item code is required'; END IF;
  IF p_brand    IS NULL OR btrim(p_brand)    = '' THEN RAISE EXCEPTION 'Brand is required'; END IF;
  IF p_type     IS NULL OR btrim(p_type)     = '' THEN RAISE EXCEPTION 'Type is required'; END IF;
  IF p_type NOT IN ('SI','CI') THEN RAISE EXCEPTION 'Type must be SI or CI'; END IF;

  -- Option C: block NORMALIZED-identical (same after stripping spaces/punct/case)
  SELECT item_no, item_code INTO v_dup
  FROM public.items
  WHERE lower(regexp_replace(item_code, '[^a-zA-Z0-9]', '', 'g'))
      = lower(regexp_replace(btrim(p_item_code), '[^a-zA-Z0-9]', '', 'g'))
  LIMIT 1;
  IF v_dup.item_no IS NOT NULL THEN
    RAISE EXCEPTION 'A near-identical item already exists: "%" (%). Use that item or change the code.', v_dup.item_code, v_dup.item_no;
  END IF;

  SELECT COALESCE(MAX((substring(item_no from 3))::integer), 0) + 1
    INTO v_next
  FROM public.items
  WHERE item_no ~ '^IN[0-9]+$';
  v_item_no := 'IN' || lpad(v_next::text, 4, '0');

  INSERT INTO public.items (item_no, item_code, brand, category, subcategory, series, type, notes, is_active)
  VALUES (
    v_item_no,
    btrim(p_item_code),
    btrim(p_brand),
    NULLIF(btrim(COALESCE(p_category,'')), ''),
    NULLIF(btrim(COALESCE(p_subcategory,'')), ''),
    NULLIF(btrim(COALESCE(p_series,'')), ''),
    p_type,
    NULLIF(btrim(COALESCE(p_notes,'')), ''),
    true
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
GRANT EXECUTE ON FUNCTION create_item(text,text,text,text,text,text,text) TO authenticated;
