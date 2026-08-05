-- ═══════════════════════════════════════════════════════════════════════════
-- Procurement notifications go to the SIX people who run procurement
-- Applied: 2026-08-05        User: "admins do not want PO emails — only Mehul,
--                            Krisha, Saurabh, Om, Ankit and Hiral. No Jaypal,
--                            no Mayank. Mehul is MD and takes care of Ops."
--
-- Verified against the org chart — these six ARE the procurement chain:
--   Mehul Maniar    MD                       (no manager)
--     Ankit Dave    Head of Operations       -> Mehul
--       Hiral Patel O & S Manager            -> Ankit
--         Krisha Thakkar  Procurement Specialist -> Hiral
--         Saurabh Khot    Procurement Specialist -> Hiral
--         Om Panchal      Operations Associate   -> Hiral
-- Excluded correctly: Jaypal (Growth Head, Sales), Mayank (Director Finance),
-- Jital (CRO), Vatsal (CGO) — none sits in the procurement line.
--
-- WHY (measured before changing anything):
--   POs run at 12.5 per WORKING day. The seeded rules used the old broad role
--   arrays (ops + admin + management = 12 people), so the three lifecycle
--   events would have fired 30 emails per PO:
--       Mehul   4.9/day  ->  42/day   (8x)
--       Krisha  7.0/day  ->  32/day
--       Jaypal 31.3/day  ->  69/day
--       Mayank  2.2/day  ->  40/day   — and he has no procurement role at all
--   The person who must ACT would have buried their own action items under
--   notifications about steps other people had already taken.
--
-- Roles are cleared to '{}' and recipients named individually, so adding an
-- 'ops' or 'admin' user never silently subscribes them to procurement mail
-- again. Widening is one click in User Management -> Notifications; it does
-- not need a deploy.
--
-- NOTE — this also narrows TWO EXISTING events (po_cancelled and
-- po_linked_co_cancelled). Until now those reached all 12; from here they
-- reach the same six. That is a deliberate behaviour change, not parity.
-- ═══════════════════════════════════════════════════════════════════════════

-- Mehul Maniar   888b120e-cd21-43cf-a155-bca67d57da0d   MD / approver
-- Ankit Dave     7f5ca417-5076-4f81-9a05-4db5ddf1cb28   Head of Operations
-- Hiral Patel    7bbbe492-504c-48ad-8cf2-5f80e20ec7ac   O & S Manager
-- Krisha Thakkar c368ec10-ea4b-4106-9cbb-1b7aadafb665   placer
-- Saurabh Khot   65b83292-1c96-4a88-8507-5f76ea885920   creator
-- Om Panchal     64b1c033-eccc-4f31-b8c4-d457cf2251cb   creator

-- ── Lifecycle: only the person who owns the NEXT step ─────────────────────
-- The PO's own creator is added per-call by notify({ alsoUserIds }), because
-- who raised a given PO is not something a static rule can know.

-- Submitted -> the approver must act. 12.5/day, every one an approval to do.
UPDATE public.notification_rules
   SET roles = '{}', extra_user_ids = ARRAY['888b120e-cd21-43cf-a155-bca67d57da0d']::uuid[],
       updated_at = now()
 WHERE event_key = 'po_submitted';

-- Approved -> the placer must act (creator added per call, for visibility).
UPDATE public.notification_rules
   SET roles = '{}', extra_user_ids = ARRAY['c368ec10-ea4b-4106-9cbb-1b7aadafb665']::uuid[],
       updated_at = now()
 WHERE event_key = 'po_approved';

-- Placed -> nobody owns a next step; the creator is told via alsoUserIds only.
UPDATE public.notification_rules
   SET roles = '{}', extra_user_ids = '{}'::uuid[], updated_at = now()
 WHERE event_key = 'po_placed';

-- ── Exceptions and cancellations: all six should know ─────────────────────
UPDATE public.notification_rules
   SET roles = '{}',
       extra_user_ids = ARRAY['888b120e-cd21-43cf-a155-bca67d57da0d',
                              '7f5ca417-5076-4f81-9a05-4db5ddf1cb28',
                              '7bbbe492-504c-48ad-8cf2-5f80e20ec7ac',
                              'c368ec10-ea4b-4106-9cbb-1b7aadafb665',
                              '65b83292-1c96-4a88-8507-5f76ea885920',
                              '64b1c033-eccc-4f31-b8c4-d457cf2251cb']::uuid[],
       updated_at = now()
 WHERE event_key IN ('po_cancelled', 'po_linked_co_cancelled',
                     'po_sla_approval_overdue', 'po_sla_placement_overdue');

-- po_mention is left alone on purpose: its recipients are the people actually
-- @-tagged in the comment, which roles must never widen.

SELECT r.event_key,
       cardinality(r.roles)          AS role_count,
       cardinality(r.extra_user_ids) AS named_people,
       (SELECT string_agg(p.name, ', ' ORDER BY p.name)
          FROM public.profiles p WHERE p.id = ANY(r.extra_user_ids)) AS recipients
  FROM public.notification_rules r
 ORDER BY r.event_key;
