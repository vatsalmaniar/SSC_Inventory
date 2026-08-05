-- ═══════════════════════════════════════════════════════════════════════════
-- Procurement email scope, final    Applied: 2026-08-05
-- User: "only when Krisha places the PO and cancellations"
--
-- So: ONE routine email per PO — the moment it reaches the vendor — plus
-- exceptions. Submitted and approved are internal hand-offs the team can see in
-- the app; they do not need an inbox entry each.
--
--   po_placed              -> all six          ~12.5/day, one per PO
--   po_cancelled           -> all six          exception
--   po_linked_co_cancelled -> all six          exception
--   po_submitted           -> OFF
--   po_approved            -> OFF
--
-- Turned off via is_active rather than by deleting the rules or removing the
-- notify() calls: the code stays in place, so switching either back on later is
-- a data change (or one click in User Management), never a deploy.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_rules
   SET is_active = false, updated_at = now()
 WHERE event_key IN ('po_submitted', 'po_approved');

-- Placement is the milestone that matters: the vendor now holds the order.
UPDATE public.notification_rules
   SET is_active = true, roles = '{}',
       extra_user_ids = ARRAY['888b120e-cd21-43cf-a155-bca67d57da0d',   -- Mehul  (MD)
                              '7f5ca417-5076-4f81-9a05-4db5ddf1cb28',   -- Ankit  (Head of Ops)
                              '7bbbe492-504c-48ad-8cf2-5f80e20ec7ac',   -- Hiral  (O&S Manager)
                              'c368ec10-ea4b-4106-9cbb-1b7aadafb665',   -- Krisha (placer)
                              '65b83292-1c96-4a88-8507-5f76ea885920',   -- Saurabh
                              '64b1c033-eccc-4f31-b8c4-d457cf2251cb']::uuid[],  -- Om
       updated_at = now()
 WHERE event_key = 'po_placed';

SELECT event_key, is_active,
       (SELECT count(*) FROM public.profiles p WHERE p.id = ANY(r.extra_user_ids)) AS emails_per_event
  FROM public.notification_rules r ORDER BY is_active DESC, event_key;
