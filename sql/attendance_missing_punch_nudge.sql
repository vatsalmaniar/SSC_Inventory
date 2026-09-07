-- "You have not checked in today" nudge — selection logic. 2026-09-07.
--
-- Sent at 10:30 IST on working days to anyone who has not punched and is not on leave, so
-- they can regularise or apply for leave before the day becomes Loss of Pay.
--
-- WHO IS EXCLUDED, and why each one matters:
--   * role 'admin'   — user decision. All four are attendance_exempt and never punch.
--
-- STAFF ARE INCLUDED, but they are NOT emailed personally: they have no mailbox. Their row
-- comes back with role = 'staff' and the job sends a single digest to people@ naming them,
-- so Ankit can act. (sql/staff_never_emailed.sql would strip any mail addressed to them.)
--   * attendance_exempt — non-punchers by design; nudging them is noise, and the muster
--                      already scores them present ('EX').
--   * on approved leave — nothing to fix.
--   * exited employees.
--   * anyone with no profile / no login — there is nowhere to send it.
--
-- WHICH DAYS ARE SKIPPED (all three the user listed):
--   * weekly off — Sunday, and 2nd/4th Saturday EXCEPT for the fulfilment team, who work
--     those (att_saturday_workers). attendance_weekoff_overrides wins over both.
--   * public holidays — holidays.is_active.
--   * DECLARED holidays — attendance_declarations with status 'holiday' covering the date,
--     either for the person's branch or company-wide (branch is null). This is the rainfall
--     / calamity / festival declaration, and a branch-specific row wins over a global one.
--
-- Returns the recipient list only. It sends nothing by itself.

create or replace function public.att_missing_punch_today(p_date date default null)
returns table (employee_id uuid, profile_id uuid, full_name text, email text, branch text, role text)
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(p_date, (now() at time zone 'Asia/Kolkata')::date) as day)
  select e.id, p.id, e.full_name,
         coalesce(p.email, p.username || '@ssccontrol.com'),
         e.branch, p.role
    from public.employees e
    join public.profiles p on p.id = e.profile_id
       , d
   where e.lifecycle_status <> 'exited'
     and coalesce(e.attendance_exempt, false) = false
     and p.role <> 'admin'
     -- not a weekly off for THIS person (fulfilment team works 2nd/4th Saturday)
     and not coalesce(
           (select o.is_weekoff from public.attendance_weekoff_overrides o where o.work_date = d.day),
           case
             when extract(dow from d.day) = 0 then true
             when extract(dow from d.day) = 6 then
                  (ceil(extract(day from d.day) / 7.0) in (2,4)
                   and not exists (select 1 from public.att_saturday_workers() w
                                    where w.employee_id = e.id))
             else false
           end)
     -- not a public holiday
     and not exists (select 1 from public.holidays h
                      where h.holiday_date = d.day and h.is_active)
     -- not a DECLARED holiday for this branch (branch-specific or company-wide)
     and not exists (select 1 from public.attendance_declarations ad
                      where d.day between ad.from_date and ad.to_date
                        and ad.status = 'holiday'
                        and (ad.branch is null or ad.branch = e.branch))
     -- not on approved leave
     and not exists (select 1 from public.leave_requests r
                      where r.employee_id = e.id and r.status = 'approved'
                        and d.day between r.from_date and r.to_date)
     -- and has not punched at all today
     and not exists (select 1 from public.attendance_punches ap
                      where ap.employee_id = e.id
                        and (ap.punch_at at time zone 'Asia/Kolkata')::date = d.day)
   order by e.full_name
$$;
revoke execute on function public.att_missing_punch_today(date) from public, anon;
grant  execute on function public.att_missing_punch_today(date) to authenticated, service_role;
