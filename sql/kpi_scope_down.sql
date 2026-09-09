-- Rollback for sql/kpi_scope_up.sql.
--
-- Removes ONLY the objects that migration created. The pre-existing permissive policies
-- (ka_read, ka_write, km_read, km_write, auth_read, admin_write, kact_read, kact_write)
-- were never touched, so dropping these restores the original behaviour exactly:
-- management can once again read every scorecard, admins' included.

drop policy if exists kact_scope on public.kpi_activity;
drop policy if exists ks_scope   on public.kpi_snapshots;
drop policy if exists km_scope   on public.kpi_monthly_data;
drop policy if exists ka_scope   on public.kpi_assignments;

drop function if exists public.kpi_assignment_profile(uuid);
drop function if exists public.kpi_can_see_profile(uuid);
