-- Presence board: non-punching staff are not "out of office" — 2026-09-07.
--
-- office_presence() derived is_in purely from the last punch direction, so anyone who
-- never punches showed as OUT all day. That is the four admins (attendance_exempt = true,
-- zero punches — they do not use the biometric device by design), who were displayed as
-- out of office while sitting in the building.
--
-- The rest of the app already takes the opposite view: computeDay() returns
-- { status: 'present', code: 'EX' } for an exempt employee "regardless of what the device
-- recorded". The board was the one place still equating "no punch" with "absent".
--
-- RULE: exempt employees show as IN unless they are on approved leave — which is exactly
-- how the muster scores them. Everyone else is unchanged: last punch decides.
--
-- The management-cannot-see-admin filter from sql/people_access_rules.sql is preserved
-- verbatim; this only changes the is_in expression.

create or replace function public.office_presence()
returns table(employee_id uuid, full_name text, designation text, department text,
              photo_url text, is_in boolean, on_leave boolean)
language sql stable security definer set search_path to 'public' as $function$
  with today as (select current_date as d),
  last_punch as (
    select distinct on (p.employee_id) p.employee_id, p.direction
      from public.attendance_punches p, today
     where p.punch_at >= today.d and p.punch_at < today.d + 1
     order by p.employee_id, p.punch_at desc
  ),
  lv as (
    select distinct r.employee_id
      from public.leave_requests r, today
     where r.status = 'approved' and today.d between r.from_date and r.to_date
  )
  select e.id, e.full_name, e.designation, e.department, e.photo_url,
         case
           -- non-punchers are present unless on leave (matches computeDay's 'EX')
           when coalesce(e.attendance_exempt, false) then (lv.employee_id is null)
           else coalesce(lp.direction = 'in', false)
         end as is_in,
         (lv.employee_id is not null) as on_leave
    from public.employees e
    left join last_punch lp on lp.employee_id = e.id
    left join lv          on lv.employee_id = e.id
   where e.lifecycle_status <> 'exited'
     and not (public.expense_role() = 'management'
              and coalesce((select p.role from public.profiles p where p.id = e.profile_id), '') = 'admin')
$function$;
revoke execute on function public.office_presence() from public, anon;
grant  execute on function public.office_presence() to authenticated, service_role;
