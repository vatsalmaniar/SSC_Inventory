-- Procurement dashboard: value actually RECEIVED, per month.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE SUM
-- The receipt link lives at LINE level, not header level: grn.po_id is NULL on 1,451 of
-- 1,452 GRNs this FY, while grn_items.po_item_id is set on 3,369 of 3,424 rows. So
-- "what did we actually receive" is a three-table join over ~3,400 line rows, and pulling
-- that into the browser to add it up would be a second copy of the calculation plus a
-- payload nobody needs. It is computed once, here.
--
-- ⚠️ THE PRICE TRAP — po_items.unit_price_after_disc IS ZERO ON ALL 5,088 ROWS.
-- coalesce(unit_price_after_disc, unit_price) would therefore return 0 for every line,
-- because 0 is not NULL and coalesce only skips NULL. It must be
-- nullif(unit_price_after_disc, 0) so the zero falls through to unit_price.
-- This is the documented repo-wide rule for this column; see the price-zero note in
-- CLAUDE.md's reference list. Getting it wrong yields a confident, silent ₹0.
--
-- SECURITY INVOKER (the default — deliberately NOT security definer). Procurement rows
-- are RLS-scoped, and a definer function here would hand every signed-in user the whole
-- purchase ledger regardless of their role. Running as the caller means the figure a
-- user sees is exactly the set of rows they may already read.
--
-- READ ONLY. No table is written, no row is touched. Rollback is the drop at the bottom
-- of this comment block:
--   drop function if exists public.procurement_received_by_month(date);

create or replace function public.procurement_received_by_month(p_from date)
  returns table(month_start date, received_value numeric, grn_lines bigint)
  language sql
  stable
  set search_path = public
as $$
  select date_trunc('month', g.created_at)::date as month_start,
         sum(gi.accepted_qty * coalesce(nullif(pi.unit_price_after_disc, 0), pi.unit_price, 0)) as received_value,
         count(*) as grn_lines
    from public.grn g
    join public.grn_items gi on gi.grn_id = g.id
    join public.po_items  pi on pi.id = gi.po_item_id
   where g.is_test = false
     and g.created_at >= p_from
   group by 1
   order by 1
$$;

-- ALTER DEFAULT PRIVILEGES re-grants EXECUTE to PUBLIC on every NEW function in this
-- database, so a one-time revoke elsewhere does not cover this one. Revoke, then grant
-- deliberately — the standing VAPT rule.
revoke all on function public.procurement_received_by_month(date) from anon, public;
grant execute on function public.procurement_received_by_month(date) to authenticated;
