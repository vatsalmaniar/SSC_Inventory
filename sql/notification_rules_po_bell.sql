-- ═══════════════════════════════════════════════════════════════════════════
-- PO lifecycle: bell for the team, email only where it matters
-- Applied: 2026-08-05   User: "only when Krisha places the PO and cancellations"
--                       then: "yes make it bell enabled"
--
--   po_submitted  bell ✓  email ✗   all six see it in the app
--   po_approved   bell ✓  email ✗
--   po_placed     bell ✓  email ✓   the vendor now holds the order
--   cancellations bell ✓  email ✓   exceptions
--
-- Everyone keeps full visibility of the flow; only ~12.5 routine emails a day
-- leave the building instead of ~225.
--
-- ⚠️ DEPLOY ORDER: the edge function must ship BEFORE (or with) the frontend.
-- email_enabled is honoured by send-email-notification, which reads this table.
-- If the Vercel build lands first, po_submitted / po_approved would email all
-- six until the function catches up.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.notification_rules
   SET is_active      = true,
       email_enabled  = false,          -- bell only
       bell_enabled   = true,
       roles          = '{}',
       extra_user_ids = ARRAY['888b120e-cd21-43cf-a155-bca67d57da0d',   -- Mehul  (MD)
                              '7f5ca417-5076-4f81-9a05-4db5ddf1cb28',   -- Ankit  (Head of Ops)
                              '7bbbe492-504c-48ad-8cf2-5f80e20ec7ac',   -- Hiral  (O&S Manager)
                              'c368ec10-ea4b-4106-9cbb-1b7aadafb665',   -- Krisha (placer)
                              '65b83292-1c96-4a88-8507-5f76ea885920',   -- Saurabh
                              '64b1c033-eccc-4f31-b8c4-d457cf2251cb']::uuid[],  -- Om
       updated_at     = now()
 WHERE event_key IN ('po_submitted', 'po_approved');

-- Everything else that is active keeps emailing.
UPDATE public.notification_rules
   SET email_enabled = true, updated_at = now()
 WHERE event_key IN ('po_placed','po_cancelled','po_linked_co_cancelled',
                     'po_mention','po_sla_approval_overdue','po_sla_placement_overdue');

SELECT event_key, is_active, bell_enabled, email_enabled,
       (SELECT count(*) FROM public.profiles p WHERE p.id = ANY(r.extra_user_ids)) AS people
  FROM public.notification_rules r ORDER BY email_enabled DESC, event_key;
