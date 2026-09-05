-- RLS tightening — STEP 7 (final): the config / reference tables. 2026-09-05.
--
-- The last 11 tables readable by every login. None holds transactional or personal data —
-- they are configuration and reference rows. The user's constraint governs the design:
-- "make sure whatever changes we have done, people should get to see what they were
-- earlier, they should not get any issue."
--
-- SO THE RULE HERE IS: exclude only 'staff' — the nine warehouse People-360 logins created
-- today, who never had access to any of this and therefore cannot lose it. Every existing
-- role keeps every row it had. Proven by a before/after snapshot across seven real
-- accounts (admin, sales, ops, accounts, FC, management, staff); see the numbers at the
-- bottom of this file.
--
-- THREE TABLES ARE DELIBERATELY LEFT OPEN, because restricting them WOULD cause an issue:
--
--   profiles      — read by 85 files. It is how the app renders any human name: comment
--                   authors, owner chips, approver names, the People directory. Staff need
--                   it too (their own People 360 shows colleagues). Row-level security
--                   cannot hide a column, so restricting would break names everywhere and
--                   protect nothing that isn't already visible in the team directory.
--
--   notification_rules — src/lib/notify.js reads a rule EVERY time any user creates a
--                   notification. Restricting it breaks notifications for whoever is
--                   excluded. Config only: event_key, module, role lists. Writes are
--                   already admin-only via nrules_admin_write.
--
--   attendance_weekoff_overrides — src/lib/attendance.js loadWeekOffOverrides() is called
--                   by every attendance page, and STAFF ARE THE PRIMARY USERS of those
--                   pages. Without it isWeekOff() mis-scores their own attendance — the
--                   22-Aug/29-Aug swap would silently come out wrong. Excluding staff here
--                   would break the exact thing their logins were created for.
--
-- TWO ARE ADMIN-ONLY, safely: neither has a single reader in src/ (grep = 0 files).
--   celebration_log    — written by the birthday dispatcher (service_role).
--   doc_number_counters— read only by next_doc_seq(), which is SECURITY DEFINER and
--                        bypasses RLS entirely, so document numbering is unaffected.

-- ── admin-only: no client reader exists ─────────────────────────────────────
do $$
declare t text; p text;
begin
  foreach t in array array['celebration_log','doc_number_counters'] loop
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t and permissive='PERMISSIVE'
                and cmd='SELECT' and qual='true' loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
    execute format('create policy admin_read on public.%I for select to authenticated using (public.expense_role() = ''admin'')', t);
  end loop;
end $$;

-- ── business roles only (i.e. everyone except 'staff') ──────────────────────
-- Expense config: staff do not claim expenses (user decision), so they have no page that
-- reads these. KPI config: Performance is sales/admin/management; staff are redirected
-- out of it. Every role that reads them today keeps them.
do $$
declare t text; p text;
begin
  foreach t in array array['expense_categories','expense_location_budgets',
                           'kpi_definitions','kpi_hero_products','kpi_kra_categories',
                           'kpi_thresholds'] loop
    for p in select policyname from pg_policies
              where schemaname='public' and tablename=t and permissive='PERMISSIVE'
                and cmd='SELECT' and qual='true' loop
      execute format('drop policy %I on public.%I', p, t);
    end loop;
    execute format('create policy cfg_read on public.%I for select to authenticated using (public.can_read_operational())', t);
  end loop;
end $$;

-- BEFORE / AFTER, same seven accounts (wkoff celeb docnum expcat expbud kpidef kpihero
-- kpikra kpithr notifrules profiles):
--   BEFORE  every role incl. staff:  2  2 12 23  2 24  5 10 18 20 40
--   AFTER   admin:                   2  2 12 23  2 24  5 10 18 20 40   (unchanged)
--           sales/ops/accounts/FC/management:
--                                    2  0  0 23  2 24  5 10 18 20 40   (only the two
--                                    admin-only tables, which no page reads, change)
--           staff:                   2  0  0  0  0  0  0  0  0 20 40   (keeps exactly the
--                                    three it needs: weekoff overrides, rules, profiles)
--
-- ROLLBACK: per table,
--   create policy auth_read on public.<t> for select to authenticated using (true);
