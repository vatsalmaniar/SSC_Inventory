-- RLS tightening — STEP 5: Procurement + Billing. 2026-09-05.
--
-- User's constraint: "order and procurement is something should not break." So this step
-- is deliberately READ-heavy. Almost every procurement table already has a CORRECT write
-- policy — is_grn_writer(), is_procurement_writer(), role_write — being overridden by a
-- blanket `auth_write` / `auth_read` with USING (true). Dropping the blanket therefore
-- RESTORES the rule the module was already written to follow, rather than inventing one.
-- Existing write policies are left untouched everywhere.
--
-- REUSING can_read_purchase(), which already gates po_items:
--     admin, management, ops, accounts, fc_kaveri, fc_godawari, demo  (no sales, no staff)
-- That is the established purchase-visibility rule in this database — sales must not see
-- purchase cost. Inventing a parallel helper would have given the same rule two homes and
-- let them drift.
--
-- TWO TABLES DELIBERATELY STAY BROADER (can_read_operational — everyone but 'staff'):
--   * grn  — OrderDetail.jsx:2671 reads the sample-return GRN, and OrderDetail is a SALES
--            page. Gating grn on can_read_purchase() would quietly blank that link.
--            grn_items is NOT read by any sales page, so it takes the purchase rule.
--   * the three dues/payment tables — these carry the CREDIT CHECK, read by OrderDetail,
--            CustomerDetail, CRMLeadDetail and CRMOpportunityDetail. Restricting them to
--            accounts would break credit display across Orders and CRM. Receivables are
--            visible to the commercial team by design; only 'staff' is excluded.
--
-- Policies are dropped by PREDICATE, not by name: every permissive SELECT whose qual is
-- literally 'true' is removed. The names vary across these tables (auth_read, po_rev_read,
-- cov_snap_read…) and guessing them is how step 4 aborted on a duplicate name.

do $$
declare
  t text; p text;
  purchase_tabs text[] := array[
    'grn_items','purchase_invoices','po_delivery_dates','po_revisions','coverage_snapshots',
    'po_comments','po_guard_config','po_guard_violations','po_workflow_owners',
    'procurement_forecast_config','procurement_forecast_sales',
    'procurement_forecast_snapshots','procurement_forecast_stock'];
  broad_tabs text[] := array[
    'grn','customer_dues_bills','customer_dues_runs','customer_payments_snapshot'];
begin
  -- 1. remove every blanket permissive SELECT (qual = true) on all of them
  foreach t in array (purchase_tabs || broad_tabs) loop
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t
                and permissive='PERMISSIVE' and cmd='SELECT' and qual='true'
    loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;

  -- 2. remove blanket permissive INSERT/UPDATE (with_check/qual = true) — the correct
  --    role-checked write policies beside them survive and take over.
  foreach t in array (purchase_tabs || broad_tabs) loop
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t and permissive='PERMISSIVE'
                and cmd in ('INSERT','UPDATE')
                and coalesce(with_check, qual) = 'true'
    loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
  end loop;

  -- 3. scoped reads
  foreach t in array purchase_tabs loop
    execute format('create policy purch_read on public.%I for select to authenticated using (public.can_read_purchase())', t);
  end loop;
  foreach t in array broad_tabs loop
    execute format('create policy ops_read on public.%I for select to authenticated using (public.can_read_operational())', t);
  end loop;
end $$;

-- po_comments had NO role-checked write policy of its own (only blanket auth_insert /
-- auth_update, now dropped), so it needs one. PurchaseOrderDetail.jsx posts both activity
-- entries and user comments; the e-mail webhook posts as service_role and bypasses RLS.
-- No UPDATE policy is created: nothing in the app edits a comment after posting.
create policy poc_insert on public.po_comments for insert to authenticated
  with check (public.is_procurement_writer());

-- ROLLBACK: per table,
--   create policy auth_read on public.<t> for select to authenticated using (true);
-- and for the four write tables, `create policy auth_write on public.<t> for insert to
-- authenticated with check (true);`
