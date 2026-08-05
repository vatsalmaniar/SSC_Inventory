-- ═══════════════════════════════════════════════════════════════════════════
-- Close two notification data leaks found during the 2a blast-radius audit
-- Applied: 2026-08-05
--
-- LEAK 1 — public.notifications was readable by EVERY logged-in user:
--     auth_read              SELECT  qual = true
--     authenticated_full_access ALL   qual = true
--   So any user — including Sales, who are deliberately excluded from
--   procurement EMAILS — could read every notification row addressed to anyone
--   else straight off the PostgREST API: PO cancellations, prices in messages,
--   @-mentions, customer-order comments. Excluding someone from the mail while
--   leaving the row world-readable is not exclusion.
--
-- LEAK 2 — public.email_preferences: auth_read qual = true (read anyone's) and
--   auth_insert with NO with_check, so any user could insert a preferences row
--   for ANY user_id and silently switch off someone else's email.
--
-- METHOD: RESTRICTIVE policies only. A permissive policy can never take access
-- away — effective access is (any permissive) AND (every restrictive) — so this
-- closes both holes without dropping a single existing policy, per the
-- additive-only DB doctrine. Reversible by dropping just these.
--
-- BLAST RADIUS (audited before applying):
--   • The ONLY app read of notifications is Layout.jsx:304, already
--     .eq('user_id', userId) — self-scoped, unaffected.
--   • Realtime already subscribes with filter `user_id=eq.<uid>` (Layout.jsx:292).
--   • markAllRead / markOneRead act on the user's own rows only.
--   • send-email-notification and the monthly cleanup run as SERVICE ROLE,
--     which bypasses RLS entirely — unaffected.
--   • INSERT is deliberately left open: notify() must create rows for OTHER
--     people. See the residual risk note at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── LEAK 1: you may only read your own notifications (admins see all) ──────
DROP POLICY IF EXISTS notif_select_own_only ON public.notifications;
CREATE POLICY notif_select_own_only ON public.notifications
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ── LEAK 1b: you may only mark your own notifications read ────────────────
DROP POLICY IF EXISTS notif_update_own_only ON public.notifications;
CREATE POLICY notif_update_own_only ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ── LEAK 2: email preferences are yours alone (admins may administer) ──────
DROP POLICY IF EXISTS eprefs_own_only ON public.email_preferences;
CREATE POLICY eprefs_own_only ON public.email_preferences
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- RESIDUAL RISK — deliberately NOT closed here
--
-- notifications INSERT stays open to any authenticated user, because dispatch
-- happens in the browser: notify() writes rows addressed to other people. A
-- determined user with the anon key could therefore forge a notification.
-- Closing it properly means moving dispatch into a SECURITY DEFINER RPC so the
-- client asks for an EVENT and the database decides the recipients. That is a
-- worthwhile follow-up; it is not a regression introduced by 2a — the old
-- inline inserts had exactly the same exposure.
-- ═══════════════════════════════════════════════════════════════════════════
