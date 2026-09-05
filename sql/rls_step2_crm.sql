-- RLS tightening — STEP 2: CRM. 2026-09-05.
--
-- BEFORE: all 13 crm_* tables carried `authenticated_full_access` (ALL, USING true) plus
-- auth_read/auth_insert/auth_update, all `true`. Any logged-in user — including the nine
-- warehouse 'staff' logins created today — could read the entire pipeline, every lead,
-- quote and contact, and UPDATE or DELETE any of it.
--
-- Checked first, after the notifications incident in step 1: NO crm_ table has a
-- RESTRICTIVE policy, so dropping the permissive ones genuinely removes access rather
-- than silently leaving the table with no grant at all.
--
-- TWO SETS, because read and write have different audiences. This is the whole design:
--
--   WRITE = sales, admin, management, demo
--     Exactly the roles every CRM page already guards on
--     (`if (!['sales','admin','management','demo'].includes(role)) navigate away`).
--
--   READ  = write set + ops + accounts
--     NOT decoration: Customer 360 is open to sales/ops/admin/management/accounts and
--     CustomerDetail.jsx reads crm_opportunities, crm_field_visits and crm_quotes to
--     build the customer page. Restricting read to the CRM roles would blank three
--     sections of Customer 360 for ops and accounts. Verified by reading the page, not
--     assumed.
--
--   Excluded from both: 'staff' (the new warehouse logins) and both FC roles — FC cannot
--   open CRM or Customer 360, so they have no path that needs this data.
--
-- DELETE is granted only on the three tables the app actually deletes from
-- (crm_field_visits, crm_quotes, crm_quote_items — quote editing and visit removal).
-- Everywhere else DELETE now has no policy at all.

create or replace function public.can_read_crm() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.expense_role() = any (array['sales','ops','admin','management','accounts','demo'])
$$;
create or replace function public.can_write_crm() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.expense_role() = any (array['sales','admin','management','demo'])
$$;
revoke execute on function public.can_read_crm()  from public, anon;
revoke execute on function public.can_write_crm() from public, anon;
grant  execute on function public.can_read_crm()  to authenticated, service_role;
grant  execute on function public.can_write_crm() to authenticated, service_role;

do $$
declare t text;
  tabs text[] := array['crm_activities','crm_companies','crm_contacts','crm_field_visits',
                       'crm_leads','crm_opportunities','crm_principals','crm_quote_items',
                       'crm_quotes','crm_sample_requests','crm_targets','crm_tasks'];
  deletable text[] := array['crm_field_visits','crm_quotes','crm_quote_items'];
begin
  foreach t in array tabs loop
    execute format('drop policy if exists authenticated_full_access on public.%I', t);
    execute format('drop policy if exists auth_read   on public.%I', t);
    execute format('drop policy if exists auth_insert on public.%I', t);
    execute format('drop policy if exists auth_update on public.%I', t);
    execute format('drop policy if exists auth_delete on public.%I', t);

    execute format('create policy crm_read on public.%I for select to authenticated using (public.can_read_crm())', t);
    execute format('create policy crm_insert on public.%I for insert to authenticated with check (public.can_write_crm())', t);
    execute format('create policy crm_update on public.%I for update to authenticated using (public.can_write_crm())', t);
    if t = any (deletable) then
      execute format('create policy crm_delete on public.%I for delete to authenticated using (public.can_write_crm())', t);
    end if;
  end loop;
end $$;

-- crm_sales_targets is handled separately: its INSERT/UPDATE are already correctly
-- scoped to the owning user (cst_insert_own / cst_update_own, user_id = auth.uid()).
-- Only the read needed narrowing, so those two are left exactly as they are.
drop policy if exists cst_read_all on public.crm_sales_targets;
create policy crm_read on public.crm_sales_targets for select to authenticated
  using (public.can_read_crm());

-- ROLLBACK: for each table,
--   create policy auth_read on public.<t> for select to authenticated using (true);
--   create policy authenticated_full_access on public.<t> for all to authenticated using (true) with check (true);
