-- resolve_sales_prices() — the ONLY way a sales user reads a sell price.
--
-- WHY THIS EXISTS, AND WHY IT IS NOT AN RLS POLICY
-- item_prices holds BOTH what we sell for (price_type='SALES') and what we PAY
-- (price_type='PURCHASE', 409 rows). Its read policy today is
--     expense_role() = any('admin','management','ops','accounts')
-- so the `sales` role — 11 of 31 users, and the only people who raise a sales
-- order — cannot read the table at all. Wiring New Order straight to the table
-- returns ZERO rows for exactly the users the feature is for, while working
-- perfectly when an admin tests it.
--
-- The fix is NOT to add `sales` to that policy: that would expose our purchase
-- cost to the sales team, and it would rely on every future query on this table
-- remembering to filter price_type. One forgotten `select *` leaks our margin.
-- Instead this function is the single narrow door. price_type = 'SALES' is a
-- LITERAL below — there is no parameter that can widen it, so no caller, now or
-- later, can reach a purchase price through here.
--
-- DESIGN RULES (change these only deliberately)
--  1. SECURITY DEFINER with search_path PINNED. Without the pin, a caller can
--     put a malicious schema ahead of public and have this run their table.
--  2. It returns ROWS, not a decision. Which row wins (scope precedence,
--     quantity breaks, validity) is decided ONCE in src/lib/itemPricingRules.js
--     and must not be re-implemented in SQL — that is how a second source of
--     truth for money gets born.
--  3. Guards RAISE, they do not silently return nothing. A caller that passes a
--     null customer has a bug; returning an empty set would look identical to
--     "this customer has no agreement" and hide it.
--  4. min_qty is INTEGER on item_prices and is cast to numeric here. The types
--     must match EXACTLY or the function creates cleanly and then fails at
--     RETURN QUERY for every caller — it did, until a run as a real sales user
--     caught it. Casting rather than redeclaring keeps CREATE OR REPLACE usable.
--  5. Callable only by roles that legitimately price a sales order. 'demo' is
--     excluded deliberately: a demo login must not see real customer pricing.
--
-- Applied: NOT YET — pending approval.

create or replace function public.resolve_sales_prices(
  p_customer_id uuid,
  p_item_codes  text[],
  p_on          date default null
)
returns table (
  id           uuid,
  item_code    text,
  price_scope  text,
  customer_id  uuid,
  vendor_id    uuid,
  project_ref  text,
  amount       numeric,
  min_qty      numeric,
  valid_from   date,
  valid_to     date,
  price_status text,
  spa_id       uuid,
  spa_no       text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := public.expense_role();
  v_n    int  := coalesce(array_length(p_item_codes, 1), 0);
begin
  if v_role is null or v_role <> all (array['admin','management','ops','accounts','sales']) then
    raise exception 'resolve_sales_prices: role % is not permitted', coalesce(v_role, '<none>')
      using errcode = '42501';
  end if;

  if p_customer_id is null then
    raise exception 'resolve_sales_prices: p_customer_id is required'
      using errcode = '22004';
  end if;

  -- A sales order is a handful of lines. A 500-code request is a bug or an
  -- attempt to enumerate the whole agreement, not a quote.
  if v_n = 0 then
    return;                                   -- nothing asked for, nothing to say
  end if;
  if v_n > 500 then
    raise exception 'resolve_sales_prices: % item codes requested, limit is 500', v_n
      using errcode = '22023';
  end if;

  return query
  select p.id, p.item_code, p.price_scope, p.customer_id, p.vendor_id,
         p.project_ref, p.amount, p.min_qty::numeric, p.valid_from, p.valid_to,
         p.price_status, p.spa_id, s.spa_no
  from   public.item_prices p
  left join public.special_price_agreements s on s.id = p.spa_id
  where  p.price_type = 'SALES'               -- LITERAL. Not a parameter. Ever.
    and  p.item_code = any (p_item_codes)
    -- Scope is honoured, not assumed: a CUSTOMER row must match this customer,
    -- a STOCK row is blanket. Every SALES row today is CUSTOMER-scoped, but the
    -- column allows more and this must not quietly leak one customer's rate.
    and  (   (p.price_scope = 'CUSTOMER' and p.customer_id = p_customer_id)
          or (p.price_scope = 'PROJECT'  and p.customer_id = p_customer_id)
          or (p.price_scope = 'STOCK'))
    -- Validity is filtered here to keep the payload small; itemPricingRules.js
    -- checks it AGAIN on the client. Both on purpose — this is money.
    and  coalesce(p.valid_from, '-infinity'::date) <= coalesce(p_on, current_date)
    and  coalesce(p.valid_to,    'infinity'::date) >= coalesce(p_on, current_date);
end;
$$;

comment on function public.resolve_sales_prices(uuid, text[], date) is
  'Sell-side (price_type=SALES) price rows for one customer and a set of item codes. '
  'The only path by which the sales role reads item_prices; purchase rates are unreachable through it.';

-- Least privilege: anon must never reach customer pricing.
revoke all on function public.resolve_sales_prices(uuid, text[], date) from public, anon;
grant execute on function public.resolve_sales_prices(uuid, text[], date) to authenticated;
