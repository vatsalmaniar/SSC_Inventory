-- ═══════════════════════════════════════════════════════════════════════════
-- REMAINING SERIES  ·  vendor code · stock transfer · quote · SPA · GRN · item
--
-- Same treatment as orders and POs: the counter owns the series. Every
-- signature and every output format below is UNCHANGED, so no application file
-- needs to change and no flow can break — NewVendor, NewGRN, NewItem, the CRM
-- quote builder and the stock-transfer trigger all keep calling exactly what
-- they call today.
--
-- Every seed is derived from the live data in the same statement that writes
-- it, and GREATEST() means re-running this file can only move a counter
-- forward, never backwards onto a number somebody already holds.
--
-- Validated against production before writing:
--   vendors      55 × VN####  (max 57) + 1 legacy 'V00001' the old function
--                scored as 0, so 57 is the correct seed and the legacy row is
--                deliberately excluded
--   stock_transfers  52 rows, max 52, zero malformed
--   crm_quotes   546 rows, max 391, zero null numbers or revisions
--   special_price_agreements  3 rows, max 3
--   grn          KAV 740 (max 741) · GOD 436 · Customer 1, plus one legacy
--                'TEST-GRN-CN-1' excluded by the regex
--   items        9,834 rows, max IN9834, zero malformed
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1 · VENDOR CODE ─────────────────────────────────────────────────────────
-- A lifetime series, not per financial year, so it is keyed on the fixed FY
-- 'ALL'. It had NO LOCK of any kind: two people saving a vendor in the same
-- second both read the same maximum, and only the UNIQUE index on vendor_code
-- turned that into one visible error instead of two vendors sharing VN0058.
insert into doc_number_counters (fy, doc_type, last_seq)
select 'ALL', 'VENDOR', max((regexp_replace(vendor_code, '\D', '', 'g'))::int)
  from vendors where vendor_code ~ '^VN[0-9]+$'
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

create or replace function next_vendor_code()
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
begin
  -- lpad TRUNCATES past its width, so VN10000 must not be padded to 4.
  return 'VN' || (
    select case when n > 9999 then n::text else lpad(n::text, 4, '0') end
      from (select next_doc_seq('VENDOR', 'ALL') as n) s
  );
end $$;

revoke execute on function next_vendor_code() from public, anon;
grant  execute on function next_vendor_code() to authenticated;


-- ── 2 · STOCK TRANSFER ──────────────────────────────────────────────────────
-- A BEFORE INSERT trigger, so allocation is already inside the transaction
-- that writes the row: a rolled-back transfer gives its number back.
insert into doc_number_counters (fy, doc_type, last_seq)
select right(transfer_number, 5), 'ST',
       max((regexp_match(transfer_number, '^SSC/ST([0-9]+)'))[1]::int)
  from stock_transfers where transfer_number ~ '^SSC/ST[0-9]+/[0-9]{2}-[0-9]{2}$'
 group by 1
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

create or replace function generate_stock_transfer_number()
returns trigger
language plpgsql
set search_path to public
as $$
declare v_fy text; v_seq int;
begin
  -- An explicitly supplied number still wins, exactly as before.
  if new.transfer_number is not null and new.transfer_number <> '' then
    return new;
  end if;
  v_fy  := fy_suffix();
  v_seq := next_doc_seq('ST', v_fy);
  new.transfer_number := 'SSC/ST' ||
    case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end ||
    '/' || v_fy;
  return new;
end $$;


-- ── 3 · CRM QUOTE ───────────────────────────────────────────────────────────
-- Revisions of one quote SHARE its number — 98 numbers are held by more than
-- one row and that is correct. (quote_number, revision) is unique across all
-- 546 rows, but nothing enforced it; it held by application discipline alone.
-- Enforce it now, while it is still true.
create unique index if not exists crm_quotes_number_revision_key
  on crm_quotes (quote_number, revision);

insert into doc_number_counters (fy, doc_type, last_seq)
select right(quote_number, 5), 'QU',
       max((regexp_match(quote_number, '^SSC/QU([0-9]+)'))[1]::int)
  from crm_quotes where quote_number ~ '^SSC/QU[0-9]+/[0-9]{2}-[0-9]{2}$'
 group by 1
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

-- Signature keeps its p_fy argument: the caller decides the year, and a
-- revision must be able to take the year its original was raised in.
create or replace function generate_crm_quote_number(p_fy text)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_seq int;
begin
  v_seq := next_doc_seq('QU', p_fy);
  return 'SSC/QU' ||
    case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end ||
    '/' || p_fy;
end $$;

revoke execute on function generate_crm_quote_number(text) from public, anon;
grant  execute on function generate_crm_quote_number(text) to authenticated;


-- ── 4 · SPECIAL PRICE AGREEMENT ─────────────────────────────────────────────
insert into doc_number_counters (fy, doc_type, last_seq)
select right(spa_no, 5), 'SPA', max((regexp_match(spa_no, '^SSC/SPA([0-9]+)'))[1]::int)
  from special_price_agreements where spa_no ~ '^SSC/SPA[0-9]+/[0-9]{2}-[0-9]{2}$'
 group by 1
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

create or replace function next_spa_no()
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_fy text; v_seq int;
begin
  v_fy  := fy_suffix();
  v_seq := next_doc_seq('SPA', v_fy);
  return 'SSC/SPA' ||
    case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end ||
    '/' || v_fy;
end $$;

revoke execute on function next_spa_no() from public, anon;
grant  execute on function next_spa_no() to authenticated;


-- ── 5 · GRN ─────────────────────────────────────────────────────────────────
-- GRN numbers run PER FULFILMENT CENTRE: KAV and GOD each have their own
-- series, so the counter is keyed 'GRN:<fc>'.
--
-- Two overloads of next_grn_number existed, taking two DIFFERENT advisory
-- locks ('grn_number_seq' and 'grn_number') — so they never locked against
-- each other and the locking was decorative. The no-argument one was also
-- filtering on '/AMD/' and '/BRD/', warehouse codes that appear NOWHERE in the
-- data (the real codes are KAV and GOD), so its exclusion did nothing. Only
-- the p_fc version is ever called; NewGRN.jsx always passes a centre.
insert into doc_number_counters (fy, doc_type, last_seq)
select right(grn_number, 5), 'GRN:' || split_part(grn_number, '/', 3),
       max((regexp_match(grn_number, '^SSC/GRN([0-9]+)'))[1]::int)
  from grn where grn_number ~ '^SSC/GRN[0-9]+/[^/]+/[0-9]{2}-[0-9]{2}$'
 group by 1, 2
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

-- and the no-centre shape, for the fallback branch
insert into doc_number_counters (fy, doc_type, last_seq)
select right(grn_number, 5), 'GRN',
       max((regexp_match(grn_number, '^SSC/GRN([0-9]+)'))[1]::int)
  from grn where grn_number ~ '^SSC/GRN[0-9]+/[0-9]{2}-[0-9]{2}$'
 group by 1
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

create or replace function next_grn_number(p_fc text default null)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_fy text; v_fc text; v_seq int; v_num text;
begin
  v_fy := fy_suffix();
  v_fc := nullif(btrim(coalesce(p_fc, '')), '');
  v_seq := next_doc_seq(case when v_fc is null then 'GRN' else 'GRN:' || v_fc end, v_fy);
  v_num := 'SSC/GRN' || case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end;
  return case when v_fc is null then v_num || '/' || v_fy
              else v_num || '/' || v_fc || '/' || v_fy end;
end $$;

revoke execute on function next_grn_number(text) from public, anon;
grant  execute on function next_grn_number(text) to authenticated;


-- ── 6 · ITEM NUMBER ─────────────────────────────────────────────────────────
-- item_no is a lifetime series (IN####), 9,834 issued. create_item_v3 read
-- MAX+1 with no lock; two admins adding an item at the same moment would both
-- compute the same IN number.
insert into doc_number_counters (fy, doc_type, last_seq)
select 'ALL', 'ITEM', max((substring(item_no from 3))::int)
  from items where item_no ~ '^IN[0-9]+$'
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

-- create_item_v3 rewritten with ONLY the numbering block changed. Every
-- validation, the near-duplicate check, the discount-group/list-price pairing
-- and the item_prices insert are byte-identical to what is live today.
create or replace function create_item_v3(p_item_code text, p_brand text, p_category text, p_subcategory text, p_type text, p_series text, p_description text, p_moq integer, p_notes text DEFAULT NULL::text, p_list_price numeric DEFAULT NULL::numeric, p_discount_group_code text DEFAULT NULL::text)
returns items
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
DECLARE
  v_role text; v_next integer; v_item_no text; v_dup record; v_row public.items;
  v_group_id uuid; v_list_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','management') THEN
    RAISE EXCEPTION 'Only admin or management can create items';
  END IF;

  IF p_item_code   IS NULL OR btrim(p_item_code)   = '' THEN RAISE EXCEPTION 'Item code is required'; END IF;
  IF p_brand       IS NULL OR btrim(p_brand)       = '' THEN RAISE EXCEPTION 'Brand is required'; END IF;
  IF p_type        IS NULL OR btrim(p_type)        = '' THEN RAISE EXCEPTION 'Type is required'; END IF;
  IF p_type NOT IN ('SI','CI') THEN RAISE EXCEPTION 'Type must be SI or CI'; END IF;
  IF p_category    IS NULL OR btrim(p_category)    = '' THEN RAISE EXCEPTION 'Category is required'; END IF;
  IF p_subcategory IS NULL OR btrim(p_subcategory) = '' THEN RAISE EXCEPTION 'Subcategory is required'; END IF;
  IF p_description IS NULL OR btrim(p_description) = '' THEN RAISE EXCEPTION 'Description is required'; END IF;
  IF p_moq IS NULL OR p_moq < 1 THEN RAISE EXCEPTION 'MOQ is required and must be at least 1'; END IF;

  IF (p_list_price IS NULL) <> (p_discount_group_code IS NULL) THEN
    RAISE EXCEPTION 'List price and discount group must be given together';
  END IF;
  IF p_list_price IS NOT NULL AND p_list_price <= 0 THEN
    RAISE EXCEPTION 'List price must be greater than zero';
  END IF;
  IF p_discount_group_code IS NOT NULL THEN
    SELECT id INTO v_group_id FROM public.price_discount_groups
    WHERE code = p_discount_group_code AND brand = btrim(p_brand) AND valid_to IS NULL
    ORDER BY valid_from DESC LIMIT 1;
    IF v_group_id IS NULL THEN RAISE EXCEPTION 'Unknown discount group % for %', p_discount_group_code, p_brand; END IF;
    SELECT id INTO v_list_id FROM public.price_lists
    WHERE brand = btrim(p_brand) AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1;
  END IF;

  SELECT item_no, item_code INTO v_dup FROM public.items
  WHERE lower(regexp_replace(item_code, '[^a-zA-Z0-9]', '', 'g'))
      = lower(regexp_replace(btrim(p_item_code), '[^a-zA-Z0-9]', '', 'g')) LIMIT 1;
  IF v_dup.item_no IS NOT NULL THEN
    RAISE EXCEPTION 'A near-identical item already exists: "%" (%). Use that item or change the code.', v_dup.item_code, v_dup.item_no;
  END IF;

  -- Was MAX(item_no)+1 over 9,834 rows with no lock. The near-duplicate check
  -- above runs FIRST, so a rejected item never reaches the allocator, and if
  -- the INSERT below fails the number rolls back with it.
  v_next := next_doc_seq('ITEM', 'ALL');
  -- lpad TRUNCATES past its width: lpad('10000',4,'0') = '1000', which
  -- already exists. Keep 4-digit padding below 10000, then just widen.
  v_item_no := 'IN' || CASE WHEN v_next > 9999 THEN v_next::text
                            ELSE lpad(v_next::text, 4, '0') END;

  INSERT INTO public.items (item_no, item_code, brand, category, subcategory, series, type, notes, description, moq, is_active)
  VALUES (v_item_no, btrim(p_item_code), btrim(p_brand),
    btrim(p_category), btrim(p_subcategory), NULLIF(btrim(COALESCE(p_series,'')), ''),
    p_type, NULLIF(btrim(COALESCE(p_notes,'')), ''), btrim(p_description), p_moq, true)
  RETURNING * INTO v_row;

  IF v_group_id IS NOT NULL THEN
    INSERT INTO public.item_prices (item_code, price_type, price_list_id, discount_group_id,
                                    model_as_printed, amount, valid_from, min_qty)
    VALUES (v_row.item_code, 'LIST', v_list_id, v_group_id,
            btrim(p_item_code), p_list_price, current_date, 1);
  END IF;

  RETURN v_row;
END;
$$;

-- The two superseded item creators are unreachable from the app but still
-- callable over the API by any signed-in user, and they mint item_no under the
-- old rules. Same for the no-argument GRN numberer. Execute revoked rather
-- than dropped — reversible, and dropping needs a decision from the owner.
revoke execute on function create_item(text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function create_item_v2(text,text,text,text,text,text,text,text,integer) from public, anon, authenticated;
revoke execute on function next_grn_number() from public, anon, authenticated;

-- create_item_v3 is SECURITY DEFINER and checks the caller's role internally,
-- so anon already gets "Only admin or management can create items" — but a
-- definer function that mints numbers should not be reachable signed-out.
revoke execute on function create_item_v3(text,text,text,text,text,text,text,integer,text,numeric,text) from public, anon;
grant  execute on function create_item_v3(text,text,text,text,text,text,text,integer,text,numeric,text) to authenticated;


-- ── 7 · CUSTOMER ID ─────────────────────────────────────────────────────────
-- customers.customer_id is a lifetime CU#### series, 4,235 issued, highest
-- CU4248. It was MAX+1 with NO LOCK, wrapped in a LOOP that skipped numbers
-- already taken — which papers over reuse-after-deletion but does nothing about
-- a race: two concurrent creates both compute CU4249, both find it free, and
-- both return it. Only the UNIQUE index turned that into one visible error.
--
-- The LOOP is dropped with the MAX: a counter cannot hand out a number it has
-- already handed out, so there is nothing to skip past.
insert into doc_number_counters (fy, doc_type, last_seq)
select 'ALL', 'CUSTOMER', max((regexp_replace(customer_id, '\D', '', 'g'))::int)
  from customers where customer_id ~ '^CU[0-9]+$'
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq), updated_at = now();

create or replace function generate_customer_id()
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_seq int;
begin
  v_seq := next_doc_seq('CUSTOMER', 'ALL');
  -- lpad TRUNCATES past its width, so CU10000 must not be padded to 4.
  return 'CU' || case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end;
end $$;

revoke execute on function generate_customer_id() from public, anon;
grant  execute on function generate_customer_id() to authenticated;
