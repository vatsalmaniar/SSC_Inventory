-- Sales see only their own orders — 2026-09-05 (user decision).
--
-- OrdersList.jsx already filtered client-side (role === 'sales' ? session.user.id : null),
-- so the UI behaved this way; the API did not, and still returned all 3,171 orders to any
-- sales login. This closes that gap. Deliberately left out of rls_step6_orders.sql because
-- it is a behaviour change, not a security cleanup, and needed the user's call.
--
-- PERFORMANCE: every helper is wrapped in a scalar subquery so it evaluates ONCE per
-- statement rather than per row. Calling them bare is what timed out the app this morning
-- (see sql/rls_step8_perf_fix_subquery.sql). Measured after: 6-7 ms for every role.
--
-- MEASURED:
--   admin / ops / accounts / management / FC   3,173  (unchanged)
--   darsh.chauhan (sales)      404  = exactly the 404 he created
--   harshadba.zala (sales)     530  = exactly the 530 she created
--   staff                        0
--
-- NOTE: order_items, order_dispatches and order_comments are NOT scoped to the creator.
-- Scoping them would break Billing and FC, which read lines for orders they did not raise.
-- A sales user could still read another rep's order LINES through the API, though not the
-- order header. Tightening that needs a join-based policy and its own performance check.

drop policy if exists ord_read on public.orders;
create policy ord_read on public.orders for select to authenticated
  using (
    created_by = (select auth.uid())
    or ((select public.expense_role()) <> 'sales'
        and (select public.can_read_operational()))
  );

-- ROLLBACK:
--   drop policy ord_read on public.orders;
--   create policy ord_read on public.orders for select to authenticated
--     using ((select public.can_read_operational()));
