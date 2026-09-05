-- RLS tightening — STEP 4: Inventory + Item/Vendor master + Stock transfers. 2026-09-05.
--
-- MEASURED as a warehouse 'staff' login created this morning:
--     items   read 9,855   UPDATE: ALLOWED   <- could rename a part code
--     vendors read    58   INSERT: ALLOWED   <- could invent a vendor
--     inventory        ALL=true (read, write AND delete)
-- Renaming a part code is a standing prohibition here, and stock comes from the XLS
-- upload only — the app must never inc/dec inventory. Both were enforced by convention;
-- the database allowed anyone to do either.
--
-- Dead-code pattern again — every one of these tables ALREADY had a correct policy that a
-- blanket `true` was overriding: items.admin_write, vendors.role_insert/role_update,
-- inventory."Accounts can upsert inventory", stock_transfers.st_write.
--
-- CHECKED FIRST (step-1 lesson): no RESTRICTIVE policies on any of these tables.
--
-- FOUR THINGS THE MAPPING PASS CAUGHT, each of which would have broken something:
--   1. `items` has ZERO write paths in src/. Items are maintained by admin SQL running as
--      postgres, which bypasses RLS — so leaving write at admin-only costs the app nothing.
--   2. STOCK TRANSFER WRITES ARE ALREADY SCOPED (st_write/sti_write/sta_write, with FC
--      included). Only the reads were open. My first draft re-created those write policies
--      and the migration aborted on a duplicate name — which is why this file only
--      replaces the three *_read policies. The abort was atomic; nothing half-applied.
--   3. inventory."Accounts can upsert inventory" is accounts+admin ONLY, but Accounts.jsx
--      guards on ['accounts','admin','management']. Dropping the blanket without adding
--      management would have silently broken uploads for Ankit and Jaypal. Hence inv_write
--      below covers all three.
--   4. FC roles create GRNs and stock transfers, so anything gated on
--      is_procurement_writer() (admin/ops/accounts/management — no FC) would lock the two
--      warehouses out. Reads here use can_read_operational() instead.

create or replace function public.can_read_operational() returns boolean
  language sql stable security definer set search_path = public as $$
  -- every business role; only 'staff' (People-360 warehouse logins) is excluded
  select public.expense_role() = any (array[
    'sales','ops','admin','management','accounts','fc_kaveri','fc_godawari','demo'])
$$;
revoke execute on function public.can_read_operational() from public, anon;
grant  execute on function public.can_read_operational() to authenticated, service_role;

-- ── inventory: read widely, write ONLY from the XLS upload ──────────────────
-- Sales.jsx (stock search), Waitlist, AvailableToPromise and Dashboard read it.
-- Accounts.jsx is the ONLY writer — an upsert on (product_code, location).
-- DELETE gets no policy at all: nothing in the app deletes a stock row.
drop policy if exists authenticated_full_access on public.inventory;
drop policy if exists auth_read   on public.inventory;
drop policy if exists auth_insert on public.inventory;
drop policy if exists auth_update on public.inventory;
drop policy if exists "Authenticated users can read inventory" on public.inventory;

create policy inv_read on public.inventory for select to authenticated
  using (public.can_read_operational());
create policy inv_write on public.inventory for insert to authenticated
  with check (public.expense_role() = any (array['accounts','admin','management']));
create policy inv_upd on public.inventory for update to authenticated
  using (public.expense_role() = any (array['accounts','admin','management']));

-- ── items: the part master is read-only to the app ──────────────────────────
drop policy if exists auth_read   on public.items;
drop policy if exists auth_insert on public.items;
drop policy if exists auth_update on public.items;
drop policy if exists authenticated_read_items on public.items;
-- admin_write (ALL, admin) is CORRECT and stays — it was simply being overridden.
create policy items_read on public.items for select to authenticated
  using (public.can_read_operational());

-- ── vendors / vendor_contacts ───────────────────────────────────────────────
-- Read includes both FC roles: NewGRN.jsx loads the vendor list to raise a GRN.
-- Sales and staff are excluded — neither has a page that shows a vendor.
-- DELETE mirrors the customers decision: NewVendor.jsx deletes the vendor it just created
-- when a document upload fails, so created_by must be able to remove its own row.
drop policy if exists auth_read  on public.vendors;
drop policy if exists auth_write on public.vendors;
create policy vend_read on public.vendors for select to authenticated
  using (public.expense_role() = any (array['ops','admin','management','accounts','fc_kaveri','fc_godawari','demo']));
create policy vend_delete on public.vendors for delete to authenticated
  using (public.expense_role() = 'admin' or created_by = auth.uid());
-- role_insert / role_update (is_procurement_writer) already exist and are correct.

drop policy if exists auth_read  on public.vendor_contacts;
drop policy if exists auth_write on public.vendor_contacts;
create policy vc_read on public.vendor_contacts for select to authenticated
  using (public.expense_role() = any (array['ops','admin','management','accounts','fc_kaveri','fc_godawari','demo']));
-- role_insert / role_update / role_delete (is_procurement_writer) already exist.

-- ── stock transfers: READS ONLY — the writes are already correct ────────────
drop policy if exists st_read  on public.stock_transfers;
drop policy if exists sti_read on public.stock_transfer_items;
drop policy if exists sta_read on public.stock_transfer_activity;

create policy st_read  on public.stock_transfers        for select to authenticated using (public.can_read_operational());
create policy sti_read on public.stock_transfer_items   for select to authenticated using (public.can_read_operational());
create policy sta_read on public.stock_transfer_activity for select to authenticated using (public.can_read_operational());

-- ROLLBACK: per table, `create policy auth_read on public.<t> for select to authenticated
-- using (true);` and for inventory also
--   create policy authenticated_full_access on public.inventory for all to authenticated
--     using (true) with check (true);
