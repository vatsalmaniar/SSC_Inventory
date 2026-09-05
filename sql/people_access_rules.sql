-- People module — THE access rule, in one place. APPLIED LIVE 2026-09-05.
--
-- STANDING RULE (user, 2026-09-05). On any People page every user can open:
--   * admin and management get a person dropdown
--   * management NEVER sees admin
--   * everyone else sees ONLY themselves
--   * a reporting manager sees THE REQUEST and nothing else
--   * salary must not leak from anywhere
-- Pages normal users have no business in are simply not given to them.
--
-- The rule used to live in two places that could drift: att_can_see() in the database,
-- and adminEmpIds() re-applied by hand in six pages, each of which fetched the whole
-- employees table and filtered it in JavaScript. It now lives HERE, and the pages ask.
-- This mirrors the expenses module, where exp_read enforces the same shape through
-- expense_owner_role().
--
-- Verified by impersonating real sessions (set_config('request.jwt.claims', …)), never
-- by reading code — see the measurements recorded at the bottom.

-- ── 1. A manager may see their direct reports' REQUESTS ─────────────────────
-- att_can_see() allows self / admin / management only; attendance_access_v2.sql dropped
-- the manager clause attendance_phase1.sql originally had. Consequence measured 2026-09-05:
-- six managers covering 19 of 34 employees received the "awaiting your approval" e-mail
-- and opened an EMPTY inbox (Hiral, 9 reports: 0 of 2 pending requests visible).
create or replace function public.is_my_report(emp uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
     where e.id = emp and e.reporting_manager_id = public.my_employee_id()
  )
$$;
revoke execute on function public.is_my_report(uuid) from public, anon;
grant  execute on function public.is_my_report(uuid) to authenticated, service_role;

-- Applied to the two REQUEST tables ONLY. attendance_days, attendance_punches and
-- leave_balances deliberately stay on plain att_can_see(): that is what makes this
-- "the request and nothing else" — the manager can action the request and gains no
-- muster, no punches, no leave balance.
drop policy if exists lr_read on public.leave_requests;
create policy lr_read on public.leave_requests for select to authenticated
  using (public.att_can_see(employee_id) or public.is_my_report(employee_id));

drop policy if exists reg_read on public.regularizations;
create policy reg_read on public.regularizations for select to authenticated
  using (public.att_can_see(employee_id) or public.is_my_report(employee_id));

-- ── 2. Performance scores are personal ─────────────────────────────────────
-- kpi_snapshots.auth_read was `USING (true)`. Measured 2026-09-05: a sales user could
-- read all 720 score rows — every colleague's performance — when 0 were his. The page
-- never showed it (it only requests its own assignment ids) but the REST API served it.
-- kpi_monthly_data already had the correct predicate; this table was missed.
drop policy if exists auth_read on public.kpi_snapshots;
create policy auth_read on public.kpi_snapshots for select to authenticated
  using (public.is_kpi_admin() or public.kpi_is_mine(assignment_id));

-- ── 3. One roster function — who may this caller pick from? ────────────────
-- Replaces five pages that each fetched all employees and filtered client-side.
-- Two scopes, and the split is the point:
--   'requests'   (Leave, Regularize) — a manager MAY pick a direct report, because they
--                 can act on the request.
--   'attendance' (Muster, Swipes, My Attendance) — a manager may NOT, because they cannot
--                 see attendance. Without the split the picker would offer a name whose
--                 data then comes back empty.
create or replace function public.att_visible_employees(p_scope text default 'attendance')
returns table (
  employee_id uuid, full_name text, employee_code text,
  designation text, department text, branch text, photo_url text
)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_employee_id() as eid),
       caller as (select public.expense_role() as role)
  select e.id, e.full_name, e.employee_code, e.designation, e.department, e.branch, e.photo_url
    from public.employees e, me, caller
   where e.lifecycle_status <> 'exited'
     and (
       -- admin: everyone
       caller.role = 'admin'
       -- management: everyone EXCEPT anyone whose login is an admin
       or (caller.role = 'management'
           and coalesce((select p.role from public.profiles p where p.id = e.profile_id), '') <> 'admin')
       -- self, always
       or e.id = me.eid
       -- a manager's direct reports, on the requests scope only
       or (p_scope = 'requests' and e.reporting_manager_id = me.eid)
     )
   order by e.full_name
$$;
revoke execute on function public.att_visible_employees(text) from public, anon;
grant  execute on function public.att_visible_employees(text) to authenticated, service_role;

-- MEASURED, before → after (same impersonation harness):
--   leave/reg requests visible   Hiral 0 → her reports' only · Khushbu 0 → hers · plain user 0 → 0
--   kpi_snapshots                Darsh 720 → 0 (his own) · admin 720 → 720
--   employee_compensation        35 / 35 / 1 / 1 for admin / management / ops / sales — UNCHANGED
--   attendance_days              unchanged for everyone — the manager gained nothing here
--
-- ROLLBACK: recreate the two request policies as `using (att_can_see(employee_id))`, and
-- kpi_snapshots auth_read as `using (true)`. Seconds; no data is touched.

-- ── 4. The presence board applies the same rule inside the function ─────────
-- office_presence() returned every non-exited employee, and PeopleAttendance.jsx then
-- filtered admins out for management callers in JavaScript — the last copy of the rule
-- living outside the database. Moved in here; the page now just renders what it is given.
-- The board itself stays visible to everyone: it is directory-level information (who is
-- in today), consistent with the decision to leave the team directory open.
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
         coalesce(lp.direction = 'in', false) as is_in,
         (lv.employee_id is not null)        as on_leave
    from public.employees e
    left join last_punch lp on lp.employee_id = e.id
    left join lv          on lv.employee_id = e.id
   where e.lifecycle_status <> 'exited'
     -- management never sees admin (the standing rule), enforced here rather than in the page
     and not (public.expense_role() = 'management'
              and coalesce((select p.role from public.profiles p where p.id = e.profile_id), '') = 'admin')
$function$;
revoke execute on function public.office_presence() from public, anon;
grant  execute on function public.office_presence() to authenticated, service_role;
