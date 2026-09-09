-- Close the FOR ALL read hole on the five person-scoped People tables.
--
-- THE BUG
-- Each of these tables pairs a careful read policy with a write policy declared
-- `FOR ALL` whose only condition is `expense_role() in ('admin','management')`:
--
--   attendance_days       day_read  = att_can_see(employee_id)          + day_write   FOR ALL
--   attendance_punches    punch_read= att_can_see(employee_id)          + punch_admin FOR ALL
--   leave_requests        lr_read   = att_can_see() OR is_my_report()   + lr_admin    FOR ALL
--   employee_private      epriv_read= role in (admin,management)        + epriv_write FOR ALL
--   employee_compensation comp_read + comp_read_self                    + comp_write  FOR ALL
--
-- In Postgres `FOR ALL` includes SELECT, and permissive policies are OR'd. So each
-- write policy silently grants management SELECT on every row, bypassing the read
-- policy beside it. Measured as ankit.dave (management) before this migration:
-- 580 admin attendance rows and 4 admin PAN/Aadhaar rows readable, and admin salary
-- would be readable the moment an admin is given a compensation row.
--
-- THE FIX
-- One RESTRICTIVE policy per table whose predicate is that table's REAL read rule.
-- Restrictive policies AND with the permissive ones, so they can only ever remove
-- access, never grant it. Nothing is dropped or altered; no row is touched.
-- Rollback: sql/people_scope_down.sql.
--
-- WHY att_can_see() AND NOT A HAND-WRITTEN PREDICATE
-- att_can_see(emp) is already the standing rule -- self, OR admin, OR management-and-
-- the-owner-is-not-an-admin (sql/people_access_rules.sql). Reusing it keeps one
-- definition of the rule instead of five copies that drift.
--
-- TRAPS THIS DELIBERATELY AVOIDS
--   * leave_requests MUST keep `OR is_my_report(...)`, or every manager loses sight of
--     their own reports' leave requests.
--   * employee_compensation MUST keep the self arm (att_can_see covers it), or people
--     lose the ability to see their own salary via comp_read_self.
--   * Writes still work because att_can_see() is true for self: an employee punching in
--     writes their own attendance_punches row, and files their own leave_requests row.
--     The eSSL sync and pg_cron run as service_role/postgres, which bypass RLS entirely.
--
-- BEHAVIOUR CHANGE, DELIBERATE
-- employee_private's read policy was `role in ('admin','management')` and never excluded
-- admin-owned rows, so management could read the four directors' PAN/Aadhaar. This
-- migration applies the standing rule there too: management no longer sees admin-owned
-- private data. That is a real change, made on the explicit instruction that management
-- sees everyone EXCEPT admin.

drop policy if exists day_scope on public.attendance_days;
create policy day_scope on public.attendance_days as restrictive for all
  using (public.att_can_see(employee_id))
  with check (public.att_can_see(employee_id));

drop policy if exists punch_scope on public.attendance_punches;
create policy punch_scope on public.attendance_punches as restrictive for all
  using (public.att_can_see(employee_id))
  with check (public.att_can_see(employee_id));

-- The manager arm is what keeps approvals working.
drop policy if exists lr_scope on public.leave_requests;
create policy lr_scope on public.leave_requests as restrictive for all
  using (public.att_can_see(employee_id) or public.is_my_report(employee_id))
  with check (public.att_can_see(employee_id) or public.is_my_report(employee_id));

drop policy if exists epriv_scope on public.employee_private;
create policy epriv_scope on public.employee_private as restrictive for all
  using (public.att_can_see(employee_id))
  with check (public.att_can_see(employee_id));

-- att_can_see() includes the self arm, so comp_read_self keeps working.
drop policy if exists comp_scope on public.employee_compensation;
create policy comp_scope on public.employee_compensation as restrictive for all
  using (public.att_can_see(employee_id))
  with check (public.att_can_see(employee_id));
