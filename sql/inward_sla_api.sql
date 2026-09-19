-- ═══════════════════════════════════════════════════════════════════════════
-- INWARD SLA — the numbers behind the scorecard
--
-- Two functions, deliberately separate, because they answer different questions
-- and must not be conflated:
--
--   inward_sla_scorecard()  how are we doing?   FORWARD-LOOKING. Counts only
--                           hand-offs starting at or after inward_sla_config
--                           .sla_from, so the opening backlog — 190 bills
--                           already past 48h, 105 of them over a month old —
--                           does not read as this month's performance.
--
--   inward_sla_open()       what needs doing?   EVERYTHING, backlog included.
--                           A worklist that hides the oldest items is useless.
--
-- MEASURED BASELINE before any of this was built (this FY):
--   GRN created -> confirmed     1,551   median 18.7h   58.7% <=24h
--   bill -> matched/completed    1,342   median 72.2h   39.7% <=48h   <- the gap
--   3-way -> inward complete     1,327   median  0.0h   99.6%         <- merged
--
-- ⚠️ Step A is APPROXIMATE before grn.confirmed_at existed (added 2026-09-19).
--    Older GRNs have NULL and are excluded rather than measured from
--    updated_at, which any later edit moves. Excluding is honest; guessing is
--    not.
--
-- ⛔ Read-only. No table is written.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.inward_sla_scorecard()
returns table (
  step          text,
  owner_name    text,
  sla_hours     numeric,
  measured      bigint,
  within_sla    bigint,
  pct_within    numeric,
  median_hours  numeric,
  worst_hours   numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_from timestamptz;
begin
  if not public.is_procurement_writer() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select sla_from into v_from from public.inward_sla_config where id = 1;

  return query
  -- A. goods in -> GRN confirmed. Per warehouse, because they are different
  --    people with different queues.
  with a as (
    select g.fulfilment_center as scope,
           extract(epoch from (g.confirmed_at - g.created_at))/3600 as hrs
      from public.grn g
     where g.grn_type = 'po_inward' and g.status <> 'cancelled'
       and coalesce(g.is_test, false) = false
       and g.confirmed_at is not null           -- NULL = pre-dates the column
       and g.created_at >= v_from
  ),
  b as (
    select extract(epoch from (coalesce(pin.inward_completed_at, pin.match_computed_at)
                               - pin.created_at))/3600 as hrs
      from public.purchase_invoices pin
     where coalesce(pin.is_test, false) = false
       and coalesce(pin.inward_completed_at, pin.match_computed_at) is not null
       and pin.created_at >= v_from
  )
  select 'grn_confirm · ' || a.scope,
         coalesce(p.name, '—'),
         coalesce(o.sla_hours, 24),
         count(*)::bigint,
         count(*) filter (where a.hrs <= coalesce(o.sla_hours, 24))::bigint,
         round(100.0 * count(*) filter (where a.hrs <= coalesce(o.sla_hours, 24)) / nullif(count(*),0), 1),
         round(percentile_cont(0.5) within group (order by a.hrs)::numeric, 1),
         round(max(a.hrs)::numeric, 1)
    from a
    left join public.inward_workflow_owners o on o.step = 'grn_confirm' and o.scope = a.scope
    left join public.profiles p on p.id = o.profile_id
   group by a.scope, p.name, o.sla_hours

  union all
  select 'bill_match',
         coalesce(p.name, '—'),
         coalesce(o.sla_hours, 48),
         count(*)::bigint,
         count(*) filter (where b.hrs <= coalesce(o.sla_hours, 48))::bigint,
         round(100.0 * count(*) filter (where b.hrs <= coalesce(o.sla_hours, 48)) / nullif(count(*),0), 1),
         round(percentile_cont(0.5) within group (order by b.hrs)::numeric, 1),
         round(max(b.hrs)::numeric, 1)
    from b
    left join public.inward_workflow_owners o on o.step = 'bill_match' and o.scope = ''
    left join public.profiles p on p.id = o.profile_id
   group by p.name, o.sla_hours;
end $$;


-- The worklist. Backlog INCLUDED — that is the point of it.
create or replace function public.inward_sla_open()
returns table (
  kind        text,
  ref         text,
  id          uuid,
  who         text,
  detail      text,
  age_hours   numeric,
  sla_hours   numeric,
  breached    boolean
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_procurement_writer() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- Wrapped in a subquery: an ORDER BY on a UNION can only name result columns,
  -- and these are expressions.
  return query
  select * from (
  -- 1. received but not confirmed
  select 'GRN to confirm', g.grn_number, g.id, g.fulfilment_center,
         coalesce(g.vendor_name, ''),
         round(extract(epoch from (now() - g.created_at))/3600, 1),
         24::numeric,
         extract(epoch from (now() - g.created_at))/3600 > 24
    from public.grn g
   where g.grn_type = 'po_inward' and g.status in ('draft','checking')
     and coalesce(g.is_test, false) = false

  union all
  -- 2. bill waiting to be matched
  select 'Bill to match', coalesce(pin.invoice_number, g.grn_number, '—'), pin.id, 'accounts',
         coalesce(pin.vendor_name, ''),
         round(extract(epoch from (now() - pin.created_at))/3600, 1),
         48::numeric,
         extract(epoch from (now() - pin.created_at))/3600 > 48
    from public.purchase_invoices pin
    left join public.grn g on g.id = pin.grn_id
   where pin.status = 'three_way_check' and coalesce(pin.is_test, false) = false

  union all
  -- 3. flagged and nobody has approved it
  select 'Variance to approve', coalesce(pin.invoice_number,'—'), pin.id, 'admin / management',
         coalesce(pin.vendor_name,'') || ' · ' || to_char(abs(coalesce(pin.match_variance_amount,0)),'FM999,999,990.00'),
         round(extract(epoch from (now() - pin.match_computed_at))/3600, 1),
         48::numeric,
         extract(epoch from (now() - pin.match_computed_at))/3600 > 48
    from public.purchase_invoices pin
   where pin.match_status in ('over_tolerance','no_basis','partial_basis')
     and pin.override_at is null and pin.match_computed_at is not null
     and coalesce(pin.is_test, false) = false

  union all
  -- 4. money owed back that nobody has claimed. This is the one that goes
  --    quiet on its own: the bill completes, everyone moves on, and the claim
  --    sits there. It ages from the moment it was raised.
  select 'Debit note to raise', coalesce(pin.invoice_number,'—'), pin.id, 'accounts',
         coalesce(pin.vendor_name,'') || ' · ' || to_char(coalesce(pin.debit_note_amount,0),'FM999,999,990.00'),
         round(extract(epoch from (now() - pin.debit_note_raised_at))/3600, 1),
         48::numeric,
         extract(epoch from (now() - pin.debit_note_raised_at))/3600 > 48
    from public.purchase_invoices pin
   where pin.debit_note_required and pin.debit_note_uploaded_at is null
     and pin.debit_note_raised_at is not null
     and coalesce(pin.is_test, false) = false

  union all
  -- 5. rejected goods still sitting here
  select 'Goods to send back', g.grn_number, g.id, g.fulfilment_center,
         coalesce(g.vendor_name,'') || ' · ' ||
         (select sum(gi.rejected_qty)::text from public.grn_items gi where gi.grn_id = g.id) || ' pcs',
         round(extract(epoch from (now() - g.created_at))/3600, 1),
         48::numeric,
         extract(epoch from (now() - g.created_at))/3600 > 48
    from public.grn g
   where g.returned_at is null and coalesce(g.is_test, false) = false
     and exists (select 1 from public.grn_items gi
                  where gi.grn_id = g.id and coalesce(gi.rejected_qty,0) > 0)
  ) q(kind, ref, id, who, detail, age_hours, sla_hours, breached)
  order by q.breached desc nulls last, q.age_hours desc nulls last;
end $$;

revoke all     on function public.inward_sla_scorecard() from public, anon;
revoke all     on function public.inward_sla_open()      from public, anon;
grant  execute on function public.inward_sla_scorecard() to authenticated;
grant  execute on function public.inward_sla_open()      to authenticated;

commit;
