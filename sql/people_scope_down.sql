-- Rollback for sql/people_scope_up.sql.
--
-- Drops ONLY the restrictive policies that migration added. Every pre-existing policy
-- (day_read/day_write, punch_read/punch_admin, lr_read/lr_admin, epriv_read/epriv_write,
-- comp_read/comp_read_self/comp_write) was never touched, so this restores the previous
-- behaviour exactly -- including the FOR ALL read hole it was written to close.

drop policy if exists comp_scope  on public.employee_compensation;
drop policy if exists epriv_scope on public.employee_private;
drop policy if exists lr_scope    on public.leave_requests;
drop policy if exists punch_scope on public.attendance_punches;
drop policy if exists day_scope   on public.attendance_days;
