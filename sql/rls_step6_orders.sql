-- RLS tightening — STEP 6: Orders. 2026-09-05.
--
-- The user's constraint was explicit: "order and procurement is something should not
-- break" and "my data should not be affected". So this step is deliberately the MINIMUM
-- that removes the demonstrated danger:
--     * 'staff' (the 9 warehouse People-360 logins) loses all access to the order book
--     * the blanket ALL/true policies that let ANY login DELETE an order are removed
-- Every existing role keeps exactly the access it had. This is NOT the place to also
-- re-scope sales to their own orders — that is a behaviour change and needs the user's
-- decision, not a side effect of a security pass. Noted as an open question instead.
--
-- NO DATA IS TOUCHED. Policies govern visibility only; no row is created, altered or
-- deleted by this file.
--
-- DRY-RUN FIRST: the whole change was applied inside a transaction, exercised as admin,
-- ops, sales, accounts, FC, management and staff, then ROLLED BACK. Results:
--     admin/ops/sales/accounts/FC/management  ord 3171, items 8270, disp 3720 — unchanged
--     staff                                   0 / 0 / 0 / 0, every write DENIED
-- Only then was it applied for real.
--
-- WHAT THE MAPPING PASS FOUND — three things that would each have broken production:
--
--  1. sales_select_own_orders lists admin, ops, accounts, fc_kaveri, fc_godawari and NOT
--     'management'. select_order_items lists admin, ops, sales and NOT accounts, FC or
--     management. These narrow policies are STALE — written before those roles existed.
--     Simply dropping the blankets and trusting them would have left Ankit and Jaypal
--     seeing only orders they personally created, and stripped order lines from Billing
--     and FC entirely. Hence the new can_read_operational() policies below rather than
--     relying on what was already there.
--
--  2. generate_order_number, dispatch_order_batch, create_order_dispatch,
--     confirm_dispatch_dc/invoice and assign_dispatch_invoice are SECURITY INVOKER — they
--     run under the caller's RLS. Removing write access on order_number_counters or
--     order_dispatches would have broken order creation and the entire dispatch flow.
--     Both therefore keep INSERT/UPDATE for every business role.
--
--  3. Nothing in the app deletes an order, order line, dispatch or comment. The only
--     delete path is replace_order_items(), which is SECURITY DEFINER and bypasses RLS.
--     So no DELETE policy is created here. The pre-existing narrow delete policies
--     (delete_order_items, ops_delete_order_items) are LEFT ALONE — removing capability
--     admin/ops already have is not needed to close this hole, and "don't affect what
--     works" outranks tidiness.
--
-- Policies dropped are only the blanket ones: USING (true), and the
-- `auth.uid() IS NOT NULL` pair on order_comments / order_items, which would otherwise
-- have granted the new staff logins access to the order book.

-- ── orders ──────────────────────────────────────────────────────────────────
drop policy if exists authenticated_full_access on public.orders;
drop policy if exists auth_read   on public.orders;
drop policy if exists auth_insert on public.orders;
drop policy if exists auth_update on public.orders;
create policy ord_read on public.orders for select to authenticated using (public.can_read_operational());
create policy ord_ins  on public.orders for insert to authenticated with check (public.can_read_operational());
create policy ord_upd  on public.orders for update to authenticated using (public.can_read_operational());

-- ── order_items ─────────────────────────────────────────────────────────────
-- order_items_update was `auth.uid() IS NOT NULL` — i.e. any logged-in user, staff included.
drop policy if exists authenticated_full_access on public.order_items;
drop policy if exists auth_read    on public.order_items;
drop policy if exists auth_insert  on public.order_items;
drop policy if exists auth_update  on public.order_items;
drop policy if exists auth_delete  on public.order_items;
drop policy if exists order_items_update on public.order_items;
create policy oi_read on public.order_items for select to authenticated using (public.can_read_operational());
create policy oi_ins  on public.order_items for insert to authenticated with check (public.can_read_operational());
create policy oi_upd  on public.order_items for update to authenticated using (public.can_read_operational());

-- ── order_dispatches (invoker RPCs write here — see note 2) ─────────────────
drop policy if exists authenticated_full_access on public.order_dispatches;
drop policy if exists auth_read   on public.order_dispatches;
drop policy if exists auth_insert on public.order_dispatches;
drop policy if exists auth_update on public.order_dispatches;
create policy od_read on public.order_dispatches for select to authenticated using (public.can_read_operational());
create policy od_ins  on public.order_dispatches for insert to authenticated with check (public.can_read_operational());
create policy od_upd  on public.order_dispatches for update to authenticated using (public.can_read_operational());

-- ── order_comments ──────────────────────────────────────────────────────────
-- No UPDATE policy: nothing in the app edits a comment after posting.
drop policy if exists auth_read       on public.order_comments;
drop policy if exists auth_insert     on public.order_comments;
drop policy if exists auth_update     on public.order_comments;
drop policy if exists comments_select on public.order_comments;
drop policy if exists comments_insert on public.order_comments;
create policy oc_read on public.order_comments for select to authenticated using (public.can_read_operational());
create policy oc_ins  on public.order_comments for insert to authenticated with check (public.can_read_operational());

-- ── order_number_counters (generate_order_number is INVOKER — see note 2) ───
drop policy if exists auth_read   on public.order_number_counters;
drop policy if exists auth_write  on public.order_number_counters;
drop policy if exists auth_update on public.order_number_counters;
create policy onc_read on public.order_number_counters for select to authenticated using (public.can_read_operational());
create policy onc_ins  on public.order_number_counters for insert to authenticated with check (public.can_read_operational());
create policy onc_upd  on public.order_number_counters for update to authenticated using (public.can_read_operational());

-- ── dispatch_skip_log ───────────────────────────────────────────────────────
drop policy if exists auth_all on public.dispatch_skip_log;
create policy dsl_read on public.dispatch_skip_log for select to authenticated using (public.can_read_operational());
create policy dsl_ins  on public.dispatch_skip_log for insert to authenticated with check (public.can_read_operational());

-- OPEN QUESTION for the user, deliberately NOT decided here: should a sales user see
-- only their own orders? OrdersList.jsx already filters client-side
-- (role === 'sales' ? session.user.id : null), so the UI behaves that way already, but
-- the API still returns every order to a sales login. Making that a policy is a small
-- change — `(created_by = auth.uid() OR role <> 'sales')` — but it is a behaviour change.
--
-- ROLLBACK: per table,
--   create policy auth_read on public.<t> for select to authenticated using (true);
--   create policy authenticated_full_access on public.<t> for all to authenticated
--     using (true) with check (true);

-- ── the last two order-module reads (added same day, after verification) ────
-- sample_extensions and stock_outage_log were read-only exposure — no write hole — but
-- there is no reason a People-360 warehouse login should read either.
do $$
declare t text; p text;
begin
  foreach t in array array['sample_extensions','stock_outage_log'] loop
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t and permissive='PERMISSIVE'
                and cmd='SELECT' and qual='true' loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
    execute format('create policy ops_read on public.%I for select to authenticated using (public.can_read_operational())', t);
  end loop;
end $$;
