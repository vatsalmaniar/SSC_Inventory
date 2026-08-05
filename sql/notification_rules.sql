-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 2a — notification recipients become DATA, not code
-- Applied: 2026-08-05
--
-- Before this, every recipient list was a hardcoded role array inside a React
-- page component, e.g. PurchaseOrderDetail.jsx:1084
--     .filter(p => ['ops','admin','management'].includes(p.role) && p.id !== userId)
-- copy-pasted (and already drifted) across PurchaseOrderDetail / OrderDetail /
-- GRNDetail. Adding one person meant a code change and a Vercel deploy, and
-- there was no way to reach anyone who did not hold one of those roles.
--
-- SAFETY: seeded to reproduce today's behaviour EXACTLY. On the day this ships
-- nobody's inbox changes. Only PROCUREMENT events are routed through the new
-- helper; the ~20,600 sales/dispatch/billing emails a month keep their existing
-- inline inserts untouched.
--
-- Sales is deliberately NOT a recipient of any procurement event (user, 2026-08-05).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── External CC ────────────────────────────────────────────────────────────
-- notifications.user_id references profiles, so an address without a login can
-- never have a notification row — which is why no CC exists today. Addresses
-- with no login ride along here and are passed to Resend as a real cc.
-- Attached to ONE row per dispatch only, otherwise a 12-person fan-out would
-- CC the same outsider 12 times.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS cc_emails text[];

COMMENT ON COLUMN public.notifications.cc_emails IS
  'External addresses (no login) to CC. Set on the FIRST row of a dispatch only — see src/lib/notify.js.';

-- ── The rule table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_rules (
  event_key       text PRIMARY KEY,
  label           text NOT NULL,
  description     text,
  module          text NOT NULL DEFAULT 'procurement',
  roles           text[] NOT NULL DEFAULT '{}',   -- everyone holding these roles
  extra_user_ids  uuid[] NOT NULL DEFAULT '{}',   -- named people regardless of role
  exclude_user_ids uuid[] NOT NULL DEFAULT '{}',  -- opted out of this event
  cc_emails       text[] NOT NULL DEFAULT '{}',   -- outsiders, no login needed
  exclude_actor   boolean NOT NULL DEFAULT true,  -- don't notify whoever did it
  email_enabled   boolean NOT NULL DEFAULT true,
  bell_enabled    boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz DEFAULT now(),
  updated_by      uuid
);

-- ── Seed: EXISTING events, verbatim from the code they replace ─────────────
INSERT INTO public.notification_rules
  (event_key, label, description, module, roles, exclude_actor, email_enabled) VALUES
  ('po_cancelled', 'PO Cancelled',
   'A purchase order was cancelled.',
   'procurement', '{ops,admin,management}', true, true),
  ('po_linked_co_cancelled', 'Customer Order Cancelled (PO linked)',
   'A customer order behind an open PO was cancelled or reduced.',
   'procurement', '{ops,admin,management}', true, true),
  ('po_mention', 'PO Comment Mention',
   'Someone @-mentioned you on a PO. Recipients are the tagged people — roles do not apply.',
   'procurement', '{}', true, true)
ON CONFLICT (event_key) DO NOTHING;

-- ── Seed: NEW PO lifecycle events (rows only — nothing fires until 2c) ─────
-- These are the emails procurement never had. Krisha receives 213 emails a
-- month and every one is an @-mention, because no PO lifecycle event exists.
INSERT INTO public.notification_rules
  (event_key, label, description, module, roles, exclude_actor, email_enabled) VALUES
  ('po_submitted', 'PO Submitted for Approval',
   'A PO was sent for approval. Starts the 24h approval SLA.',
   'procurement', '{admin,management}', true, true),
  ('po_approved', 'PO Approved',
   'A PO was approved and is ready to place. Starts the 48h placement SLA.',
   'procurement', '{ops,admin,management}', true, true),
  ('po_placed', 'PO Placed with Vendor',
   'A PO was placed. Closes both SLA clocks.',
   'procurement', '{ops,admin,management}', true, true),
  ('po_sla_approval_overdue', 'PO Approval Overdue (24h)',
   'A PO has been waiting for approval beyond the 24h SLA.',
   'procurement', '{admin,management}', false, true),
  ('po_sla_placement_overdue', 'PO Placement Overdue (48h)',
   'An approved PO has not been placed with the vendor within 48h.',
   'procurement', '{ops,admin,management}', false, true)
ON CONFLICT (event_key) DO NOTHING;

-- ── Access ─────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nrules_read ON public.notification_rules;
CREATE POLICY nrules_read ON public.notification_rules
  FOR SELECT TO authenticated USING (true);   -- notify() must resolve for any actor

DROP POLICY IF EXISTS nrules_admin_write ON public.notification_rules;
CREATE POLICY nrules_admin_write ON public.notification_rules
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ── Per-person opt-out needs a row before the UI can toggle it ─────────────
-- email_preferences had NO UI at all; rows only ever existed if someone wrote
-- SQL, and the table is empty today. Defaults are all-on, matching the edge
-- function's behaviour when no row is found (index.ts:327-334).
ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eprefs_self_or_admin ON public.email_preferences;
CREATE POLICY eprefs_self_or_admin ON public.email_preferences
  FOR ALL TO authenticated
  USING      (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
