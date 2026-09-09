-- Upcoming birthdays + work anniversaries for the People home page.
--
-- celebrations_today() answers "is it today"; the home page needs a look-ahead so the team
-- can actually plan something. Same shape, a window instead of a single day.
--
-- PRIVACY: date_of_birth lives in employee_private, which RLS restricts to admin/management
-- (epriv_read). This is SECURITY DEFINER so every employee can see that a colleague's
-- birthday is coming, but it returns only the NAME and the DAY-AND-MONTH — never the birth
-- year, never an age, never the underlying row. Anniversaries may show years, because
-- join_date is not private.
--
-- Wraps the year end: on 20 Dec a 30-day window includes 5 Jan.

create or replace function public.celebrations_upcoming(p_days integer default 30)
  returns table (employee_id uuid, full_name text, kind text, on_date date, days_away int, years int)
  language sql stable security definer set search_path = public
as $$
  with span as (select current_date as d0, current_date + make_interval(days => greatest(p_days,0)) as d1),
  people as (
    select e.id, e.full_name, e.join_date, pv.date_of_birth
    from public.employees e
    left join public.employee_private pv on pv.employee_id = e.id
    where coalesce(e.lifecycle_status,'') <> 'exited' and coalesce(e.is_test,false) = false
  ),
  -- this year's occurrence, and next year's, so a window crossing 31 Dec still matches
  occ as (
    select id, full_name, 'birthday'::text as kind, date_of_birth as src,
           make_date(extract(year from g.y)::int, extract(month from date_of_birth)::int, extract(day from date_of_birth)::int) as on_date
    from people, lateral (select generate_series(current_date, current_date + interval '1 year', interval '1 year') as y) g
    where date_of_birth is not null
    union all
    select id, full_name, 'anniversary'::text, join_date,
           make_date(extract(year from g.y)::int, extract(month from join_date)::int, extract(day from join_date)::int)
    from people, lateral (select generate_series(current_date, current_date + interval '1 year', interval '1 year') as y) g
    where join_date is not null
  )
  select o.id, o.full_name, o.kind, o.on_date,
         (o.on_date - current_date)::int as days_away,
         case when o.kind = 'anniversary'
              then (extract(year from o.on_date) - extract(year from o.src))::int end as years
  from occ o, span s
  where o.on_date between s.d0 and s.d1::date
    -- a joining date is not an anniversary on the day itself
    and (o.kind = 'birthday' or (extract(year from o.on_date) - extract(year from o.src)) >= 1)
  order by o.on_date, o.full_name;
$$;

-- ALTER DEFAULT PRIVILEGES re-grants PUBLIC/anon on every NEW function, so a one-time
-- revoke elsewhere does not cover this one. Revoke first, then grant only what we mean.
revoke all on function public.celebrations_upcoming(integer) from anon, public;
grant execute on function public.celebrations_upcoming(integer) to authenticated;
