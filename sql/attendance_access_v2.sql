-- ─────────────────────────────────────────────────────────────────────────
-- Attendance access model v2 — ROLE-BASED (replaces the hierarchy model)
--   normal user  → own attendance only
--   management   → all users EXCEPT admin
--   admin        → everyone
-- Apply in the Supabase SQL editor. Safe to re-run (create or replace).
-- ─────────────────────────────────────────────────────────────────────────

-- att_can_see() backs every SELECT policy on attendance_punches / attendance_days
-- / leave_balances / leave_requests / regularizations (see attendance_phase1.sql).
create or replace function public.att_can_see(emp uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select
    emp = public.my_employee_id()                                     -- self
    or public.expense_role() = 'admin'                                 -- admin: everyone
    or (
      public.expense_role() = 'management'                             -- management: everyone EXCEPT admin
      and coalesce(
        (select p.role
           from public.employees e
           join public.profiles p on p.id = e.profile_id
          where e.id = emp), ''
      ) <> 'admin'
    )
$$;
grant execute on function public.att_can_see(uuid) to authenticated;

-- Dashboard "who's in the office" board — visible to ALL authenticated users,
-- but returns ONLY today's in/out + name/dept (no punch times, geo, or photos).
-- security definer so a normal user can see presence without gaining row access
-- to anyone else's attendance detail.
create or replace function public.office_presence()
  returns table(employee_id uuid, full_name text, designation text,
                department text, photo_url text, is_in boolean, on_leave boolean)
  language sql stable security definer set search_path=public as $$
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
         coalesce(lp.direction = 'in', false) as is_in,
         (lv.employee_id is not null)        as on_leave
    from public.employees e
    left join last_punch lp on lp.employee_id = e.id
    left join lv          on lv.employee_id = e.id
   where e.lifecycle_status <> 'exited'
$$;
grant execute on function public.office_presence() to authenticated;
