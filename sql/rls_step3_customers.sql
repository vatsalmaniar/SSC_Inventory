-- RLS tightening — STEP 3: Customers. 2026-09-05.
--
-- BEFORE: customers carried authenticated_full_access (ALL, true) plus auth_read,
-- auth_insert, auth_update AND auth_delete, every one of them `true`. Measured earlier
-- today: a warehouse 'staff' login could UPDATE a customer name, INSERT a customer and
-- DELETE an order. Same dead-code pattern as everywhere else — a correct policy
-- ("Admin can delete customers", with a real role check) sat beside auth_delete USING
-- (true), which overrode it.
--
-- Checked pg_policies.permissive first: none of these three tables uses a RESTRICTIVE
-- policy, so dropping the permissive ones actually removes access (the step-1 lesson).
--
-- THREE AUDIENCES, because customers is master data read far beyond the pages that edit it:
--
--   READ   = every business role (incl. both FC roles). Orders, FC, Billing and
--            Procurement all display customer names; scoping read to the editors would
--            blank customer names across half the app. Only 'staff' is excluded.
--
--   WRITE  = sales, ops, admin, management, accounts, demo
--            NewCustomer.jsx guards on ['sales','ops','admin','management']; accounts is
--            included because Customer 360 is in their nav and they maintain billing
--            details. FC and staff cannot create or edit a customer.
--
--   DELETE = admin, OR the user who created the row.
--            The `created_by` clause is NOT a convenience: NewCustomer.jsx and
--            NewCustomerModal.jsx DELETE the customer they just inserted when the GST or
--            MSME upload fails (rollback, 4 call sites). An admin-only delete would leave
--            an orphan customer behind every failed upload. Rejecting a submission
--            (CustomerDetail.reject) is admin-only in the UI and stays admin-only here.

create or replace function public.can_read_customers() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.expense_role() = any (array[
    'sales','ops','admin','management','accounts','fc_kaveri','fc_godawari','demo'])
$$;
create or replace function public.can_write_customers() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.expense_role() = any (array['sales','ops','admin','management','accounts','demo'])
$$;
revoke execute on function public.can_read_customers()  from public, anon;
revoke execute on function public.can_write_customers() from public, anon;
grant  execute on function public.can_read_customers()  to authenticated, service_role;
grant  execute on function public.can_write_customers() to authenticated, service_role;

-- ── customers ───────────────────────────────────────────────────────────────
drop policy if exists authenticated_full_access                on public.customers;
drop policy if exists auth_read                                on public.customers;
drop policy if exists auth_insert                              on public.customers;
drop policy if exists auth_update                              on public.customers;
drop policy if exists auth_delete                              on public.customers;
drop policy if exists "Authenticated users can read all customers"  on public.customers;
drop policy if exists "Authenticated users can insert customers"    on public.customers;
drop policy if exists "Authenticated users can update customers"    on public.customers;
drop policy if exists authenticated_read_customers             on public.customers;
drop policy if exists "Admin can delete customers"              on public.customers;

create policy cust_read   on public.customers for select to authenticated
  using (public.can_read_customers());
create policy cust_insert on public.customers for insert to authenticated
  with check (public.can_write_customers());
create policy cust_update on public.customers for update to authenticated
  using (public.can_write_customers());
create policy cust_delete on public.customers for delete to authenticated
  using (public.expense_role() = 'admin' or created_by = auth.uid());

-- ── customer_contacts ───────────────────────────────────────────────────────
-- Had two duplicate sets of the same true-everything policies. No delete path in the app.
drop policy if exists auth_read   on public.customer_contacts;
drop policy if exists auth_insert on public.customer_contacts;
drop policy if exists auth_update on public.customer_contacts;
drop policy if exists "Authenticated can read customer contacts"   on public.customer_contacts;
drop policy if exists "Authenticated can insert customer contacts" on public.customer_contacts;
drop policy if exists "Authenticated can update customer contacts" on public.customer_contacts;

create policy cc_read   on public.customer_contacts for select to authenticated
  using (public.can_read_customers());
create policy cc_insert on public.customer_contacts for insert to authenticated
  with check (public.can_write_customers());
create policy cc_update on public.customer_contacts for update to authenticated
  using (public.can_write_customers());

-- ── address_geocodes ────────────────────────────────────────────────────────
-- A lat/long cache written by src/lib/geo.js whenever a map renders, so INSERT must stay
-- available to anyone who can see a customer address. Not sensitive in itself; the point
-- is simply that 'staff' has no reason to read or write it.
drop policy if exists auth_read  on public.address_geocodes;
drop policy if exists auth_write on public.address_geocodes;

create policy geo_read  on public.address_geocodes for select to authenticated
  using (public.can_read_customers());
create policy geo_write on public.address_geocodes for insert to authenticated
  with check (public.can_read_customers());

-- ROLLBACK: recreate per table
--   create policy auth_read on public.<t> for select to authenticated using (true);
--   create policy authenticated_full_access on public.customers for all to authenticated
--     using (true) with check (true);
