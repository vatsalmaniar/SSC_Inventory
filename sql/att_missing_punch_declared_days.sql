-- Nudge: honour every declared day, not just declared holidays.
--
-- att_missing_punch_today skipped attendance_declarations with status 'holiday' only. A
-- rainfall or event day declared 'present' (or 'wfh') means nobody is expected to punch —
-- but the nudge still counted those people as missing and would have emailed them. On the
-- 23 Jul Ahmedabad rainfall declaration that is 23 people told they had not checked in on a
-- day HR had already excused.
--
-- Rollback: the previous definition is identical except the status filter, which read
--   and ad.status = 'holiday'
--
CREATE OR REPLACE FUNCTION public.att_missing_punch_today(p_date date DEFAULT NULL::date)
 RETURNS TABLE(employee_id uuid, profile_id uuid, full_name text, email text, branch text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     -- Any declaration that means "no punch is expected today". It was 'holiday' only,
     -- which missed the common case: a rainfall/event day declared 'present' or 'wfh' has
     -- everyone counted present without punching, so the nudge told them they had not
     -- checked in on a day HR had already excused (23 people on the 23 Jul rainfall day).
     -- 'half_day' is deliberately NOT here — they still attend, so a punch is still expected.
     and not exists (select 1 from public.attendance_declarations ad
                      where d.day between ad.from_date and ad.to_date
                        and ad.status in ('holiday','present','wfh')
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
$function$

