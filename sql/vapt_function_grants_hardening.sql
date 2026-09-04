-- VAPT follow-up: close the anon-EXECUTE regression on public functions.
-- APPLIED LIVE 2026-09-04.
--
-- WHY THIS REGRESSED AFTER THE MAY-2026 AUDIT
-- The audit removed anon from the DEFAULT PRIVILEGES for TABLES but not for FUNCTIONS:
--
--   public / TABLES    -> postgres, authenticated, service_role          (anon removed)
--   public / FUNCTIONS -> postgres, anon, authenticated, service_role    (anon still there)
--
-- PostgreSQL applies default privileges to every NEWLY CREATED object, so every function
-- written after the audit was automatically granted to anon again. Individual migrations
-- did carry explicit `revoke execute ... from public, anon` lines (next_doc_seq,
-- resolve_customer_by_name, next_vendor_code and others) — but that depends on remembering
-- the line every time, and the ones that were missed were live:
--
--   get_inventory_status -> live warehouse stock + upload times, unauthenticated
--   office_presence      -> employee names, designations, who is in the office
--   celebrations_*       -> could TRIGGER company-wide notification emails (proven 2026-09-04)
--   search_items_v2 / search_inventory / resolve_customer_by_name -> catalogue + customers
--   next_* / generate_*  -> an outsider could burn document numbers, creating gaps
--
-- The publishable key ships inside the frontend bundle, so "anon" means anyone on the internet.
--
-- NOT AT RISK (verified): every admin_* function guards itself internally
-- (`if caller_role not in ('admin','management') then raise exception`), so logins,
-- password resets and suspensions were never exposed.
--
-- PART 1 is the one that makes this permanent. Without it PART 2 rots again in months.

-- PART 1 — new functions are never auto-granted to anon again.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

-- PART 2 — retro-fix the 127 functions that already exist.
-- Extension-owned functions (btree_gist, pg_trgm — 219 of them) are deliberately skipped:
-- they are Postgres internals, not app surface.
do $body$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant  execute on function %s to authenticated, service_role', r.sig);
    n := n + 1;
  end loop;
  raise notice 'hardened % functions', n;
end $body$;

-- VERIFIED 2026-09-04, in this order:
--   127 app functions: 0 anon grants, 0 PUBLIC grants, 127 granted to authenticated
--   anon over PostgREST: get_inventory_status / office_presence / celebrations_today /
--     sync_status all HTTP 401 (were 200 and returning real data)
--   anon table reads (orders / inventory / employees): still 401
--   as authenticated: celebrations_today, get_inventory_status, search_items_v2,
--     office_presence all return normally
--   execute privilege intact on all 15 critical write RPCs (next_doc_seq,
--     dispatch_order_batch, replace_order_items, confirm_grn, approve_po, att_mark_day,
--     leave_decide, reg_decide, mark_batch_posted, resolve_sales_prices, create_item_v3,
--     next_po_number, forecast_brand_data, atp_allocation, search_inventory)
--
-- Nothing pre-login is affected: the login page calls no RPC, and all 50 RPCs used by the
-- frontend run after sign-in as `authenticated`.
--
-- ROLLBACK (only if something unexpected breaks):
--   alter default privileges for role postgres in schema public grant execute on functions to anon;
--   -- then the same loop with: grant execute on function %s to anon;
--
-- NOTE: the supabase_admin default ACL still lists anon for functions. That covers
-- Supabase's own managed/extension objects, not app code, and is left alone deliberately.
