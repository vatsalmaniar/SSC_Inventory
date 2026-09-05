-- RLS tightening — STEP 1: Comms & Logs. 2026-09-05.
--
-- THE DISEASE (same as Orders): Postgres ORs permissive policies, so the widest one wins.
-- Correct narrow policies were written here long ago and have been DEAD CODE ever since,
-- because a blanket `USING (true)` sits beside them. notifications is the clearest case:
-- notif_select_own_only and notif_update_own_only already say "your own rows", and
-- authenticated_full_access (ALL, true) overrides both. So most of this file DELETES the
-- blanket policies rather than writing new logic — the intended rules are already there.
--
-- MEASURED BEFORE (as a warehouse 'staff' user, who should see none of this):
--   notifications  read+write+DELETE all · email_log 60,024 rows · login_audit 3,055
--   whatsapp_messages 811 (customer numbers + message text) · every reminder job
--
-- WRITE PATHS MAPPED FIRST (grep of src/ and supabase/functions/), because dropping a
-- policy the app is standing on is how you take the app down:
--   * All edge functions write with SUPABASE_SERVICE_ROLE_KEY, which BYPASSES RLS — so
--     the WhatsApp and e-mail senders are unaffected by anything below. The anon-key
--     clients in run-reminder-job / send-po-to-vendor only identify the caller.
--   * email_log and email_preferences have ZERO references in src/ — server-side only.
--   * notifications are INSERTED by 10+ client pages FOR OTHER USERS (notify.js,
--     OrderDetail, GRNDetail, CRM, NewCustomer, FCOrderDetail…), so INSERT must stay open
--     to any logged-in user. Scoping INSERT to self would break every approval alert.
--   * login_audit's 'login_failed' row is written while the user is still ANONYMOUS
--     (Login.jsx, in the authErr branch). anon INSERT must survive or failed-login
--     auditing dies silently — the exact thing you want during an attack.

-- ── notifications: your own bell, not everyone's ────────────────────────────
-- !! THE TRAP, and I fell in it: notif_select_own_only / notif_update_own_only are
-- RESTRICTIVE policies, not permissive. A restrictive policy only NARROWS; it never
-- grants. So the blanket permissive policies below were the only thing granting access,
-- and dropping them left notifications with no permissive SELECT at all — the bell went
-- empty for every user, admin included, with no error. Caught in verification because
-- admin showed 0 of 65,471; fixed by adding the permissive pair further down.
--
-- It also means notifications was NEVER read-exposed: the restrictive policy already
-- scoped SELECT/UPDATE to own-or-admin. The genuine hole here was DELETE and nothing
-- else — authenticated_full_access allowed any user to delete any notification.
--
-- ALWAYS check pg_policies.permissive before dropping anything.
drop policy if exists authenticated_full_access on public.notifications;  -- ALL, true — the real hole (DELETE)
drop policy if exists auth_read   on public.notifications;                -- SELECT, true
drop policy if exists auth_update on public.notifications;                -- UPDATE, true
drop policy if exists notif_select on public.notifications;               -- any logged-in
drop policy if exists notif_update on public.notifications;               -- any logged-in
drop policy if exists auth_insert on public.notifications;                -- dup of notif_insert

-- The permissive grant, scoped. Same predicate as the restrictive pair, so the two agree
-- and a future reader sees the rule stated once in each form rather than inferring it.
create policy notif_select_own on public.notifications for select to authenticated
  using ((user_id = auth.uid()) or (public.expense_role() = 'admin'));
create policy notif_update_own on public.notifications for update to authenticated
  using ((user_id = auth.uid()) or (public.expense_role() = 'admin'));
-- INSERT stays open (notif_insert): pages create notifications FOR OTHER USERS.
-- DELETE now has no policy at all — nothing in the app deletes a notification.

-- ── email_log: admin only ───────────────────────────────────────────────────
-- admin_read was NAMED for admins and its expression was `true` — every one of the
-- 60,024 records (recipients, subjects, delivery state) was readable by any login.
-- No INSERT policy is needed: the senders are service_role.
drop policy if exists admin_read     on public.email_log;
drop policy if exists service_insert on public.email_log;
create policy admin_read on public.email_log for select to authenticated
  using (public.expense_role() = 'admin');

-- ── email_preferences: self or admin ────────────────────────────────────────
-- eprefs_self_or_admin already said the right thing; auth_read/auth_insert (both true)
-- made it moot. own_update and eprefs_own_only are redundant with it.
-- eprefs_self_or_admin is also RESTRICTIVE, so the same permissive grant is needed here.
-- The table is empty today and only the (service_role) mailer touches it, so nothing
-- visibly broke — but it would have, the moment a preference row existed.
drop policy if exists auth_read       on public.email_preferences;
drop policy if exists auth_insert     on public.email_preferences;
drop policy if exists own_update      on public.email_preferences;
drop policy if exists eprefs_own_only on public.email_preferences;
create policy eprefs_read on public.email_preferences for select to authenticated
  using ((user_id = auth.uid()) or (public.expense_role() = 'admin'));

-- ── login_audit: admins read, everyone (incl. anon) still writes ────────────
drop policy if exists auth_read on public.login_audit;
create policy admin_read on public.login_audit for select to authenticated
  using (public.expense_role() = 'admin');

-- ── WhatsApp: the commercial team, not the whole company ────────────────────
-- Customer phone numbers and message text. Read by CustomerMaster, CustomerDetail and
-- ReminderRunModal — pages reachable by sales/ops/admin/management (+accounts for dues).
-- Excludes 'staff', both FC roles and 'demo'. Writes stay with service_role.
create or replace function public.can_see_customer_comms() returns boolean
  language sql stable security definer set search_path = public as $$
  select public.expense_role() = any (array['admin','management','ops','accounts','sales'])
$$;
revoke execute on function public.can_see_customer_comms() from public, anon;
grant  execute on function public.can_see_customer_comms() to authenticated, service_role;

drop policy if exists auth_read on public.whatsapp_messages;
create policy comms_read on public.whatsapp_messages for select to authenticated
  using (public.can_see_customer_comms());

drop policy if exists auth_read on public.whatsapp_replies;
create policy comms_read on public.whatsapp_replies for select to authenticated
  using (public.can_see_customer_comms());

drop policy if exists auth_read on public.whatsapp_reminder_jobs;
create policy comms_read on public.whatsapp_reminder_jobs for select to authenticated
  using (public.can_see_customer_comms());

drop policy if exists auth_read on public.whatsapp_reminder_job_items;
create policy comms_read on public.whatsapp_reminder_job_items for select to authenticated
  using (public.can_see_customer_comms());

-- ── notification_rules: DELIBERATELY left readable by all ───────────────────
-- src/lib/notify.js reads a rule on every notification any user creates, so restricting
-- SELECT would break notifications for everyone. It is configuration (event_key, module,
-- recipients) with no personal data, and writes are already admin-only via
-- nrules_admin_write. Tightening here would cost function and buy nothing.

-- ROLLBACK (per table): recreate the dropped policy as
--   create policy auth_read on public.<t> for select to authenticated using (true);
