-- RLS tightening — STEP 0: the one-off backup / undo tables. 2026-09-05.
--
-- Part of the module-by-module RLS project. Doing this one first because it carries no
-- application risk at all: these four tables were created by past incident-recovery
-- migrations and NOTHING in the app reads them (grep of src/ and supabase/ = 0 hits; the
-- only references are inside sql/coverage_stock_backfill.sql, which created the table).
--
-- WHAT WAS WRONG: all four had RLS switched OFF entirely, and `authenticated` held
-- arwdDxtm — every privilege, including DELETE and TRUNCATE. With no RLS, the grant is
-- the only gate, so any logged-in user could read the recovery data or destroy it.
-- These are the undo records for the PO renumbering incident and the coverage backfill:
-- exactly the thing you need intact on the day something goes wrong.
--
-- WHAT THIS DOES: revoke from authenticated/anon, and switch RLS on with NO policies, so
-- the tables are reachable only by postgres and service_role (backend/admin SQL). Belt
-- and braces — either alone would do, but a future GRANT would silently undo the first.
--
-- The DATA IS NOT TOUCHED. No drop, no delete (see feedback_database_safety).

revoke all on public.close_from_stock_undo_20260812        from authenticated, anon;
revoke all on public.po_peg_undo_20260812                  from authenticated, anon;
revoke all on public.po_number_restore_backup_20260805      from authenticated, anon;
revoke all on public.coverage_stock_backfill_undo_20260812  from authenticated, anon;

alter table public.close_from_stock_undo_20260812       enable row level security;
alter table public.po_peg_undo_20260812                 enable row level security;
alter table public.po_number_restore_backup_20260805     enable row level security;
alter table public.coverage_stock_backfill_undo_20260812 enable row level security;

-- ROLLBACK (only if some forgotten job needs one of them):
--   grant select on public.<table> to authenticated;
-- Prefer running such a job as service_role instead of re-opening the table.
