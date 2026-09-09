-- KPI visibility: enforce the standing People rule IN THE DATABASE.
--
-- The rule (sql/people_access_rules.sql): admin sees everyone; management sees everyone
-- EXCEPT anyone whose login is an admin; everybody else sees only themselves.
--
-- Attendance enforces this with att_can_see() and expenses with exp_read. KPI did NOT:
-- km_read / auth_read are `is_kpi_admin() OR kpi_is_mine(...)`, and is_kpi_admin() is
-- `role in ('admin','management')` — so the database would hand a MANAGEMENT user an
-- ADMIN's scorecard, including the assignment row that carries annual_ctc_inr. The page
-- filtered the picker client-side, which is a UI convenience, not a boundary.
--
-- ADDITIVE ONLY: nothing is dropped or altered. The existing permissive policies stay
-- exactly as they are; these RESTRICTIVE policies AND with them, so they can only ever
-- REMOVE access, never grant it. Rollback is sql/kpi_scope_down.sql.

-- ── helpers ──────────────────────────────────────────────────────────────────
-- Mirrors att_can_see(), but keyed on the PROFILE that owns the KPI row.
create or replace function public.kpi_can_see_profile(p_profile uuid)
  returns boolean language sql stable security definer set search_path = public
as $$
  select
    p_profile = auth.uid()                       -- self, always
    or public.expense_role() = 'admin'           -- admin: everyone
    or (
      public.expense_role() = 'management'       -- management: everyone except admin logins
      and coalesce((select p.role from public.profiles p where p.id = p_profile), '') <> 'admin'
    )
$$;

-- kpi_monthly_data / kpi_snapshots / kpi_activity key on assignment_id, not profile_id.
-- SECURITY DEFINER so the lookup itself is not re-filtered by the policy we are adding
-- to kpi_assignments (which would recurse).
create or replace function public.kpi_assignment_profile(p_assignment uuid)
  returns uuid language sql stable security definer set search_path = public
as $$
  select profile_id from public.kpi_assignments where id = p_assignment
$$;

-- ALTER DEFAULT PRIVILEGES re-grants EXECUTE to PUBLIC on every NEW function, so a
-- revoke done once elsewhere does not cover these two. Revoke, then grant deliberately.
revoke all on function public.kpi_can_see_profile(uuid) from anon, public;
revoke all on function public.kpi_assignment_profile(uuid) from anon, public;
grant execute on function public.kpi_can_see_profile(uuid) to authenticated;
grant execute on function public.kpi_assignment_profile(uuid) to authenticated;

-- ── restrictive scoping ──────────────────────────────────────────────────────
-- FOR ALL so the rule holds on write too: management must not be able to edit (or
-- delete) an admin's scorecard either, which the permissive `role in (admin,management)`
-- write policies would otherwise allow.
drop policy if exists ka_scope on public.kpi_assignments;
create policy ka_scope on public.kpi_assignments as restrictive for all
  using (public.kpi_can_see_profile(profile_id))
  with check (public.kpi_can_see_profile(profile_id));

drop policy if exists km_scope on public.kpi_monthly_data;
create policy km_scope on public.kpi_monthly_data as restrictive for all
  using (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)))
  with check (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)));

drop policy if exists ks_scope on public.kpi_snapshots;
create policy ks_scope on public.kpi_snapshots as restrictive for all
  using (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)))
  with check (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)));

drop policy if exists kact_scope on public.kpi_activity;
create policy kact_scope on public.kpi_activity as restrictive for all
  using (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)))
  with check (public.kpi_can_see_profile(public.kpi_assignment_profile(assignment_id)));

-- NOTE on the kpi_self view: it is not security_invoker, so it reads kpi_assignments as
-- its owner and is unaffected by the policy above. That is correct and required — it is
-- how a sales user reads their OWN assignment, and it already filters
-- `profile_id = auth.uid()` and omits annual_ctc_inr.
