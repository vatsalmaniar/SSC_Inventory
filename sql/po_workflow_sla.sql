-- ═══════════════════════════════════════════════════════════════════════════
-- PO workflow hand-off stamps + owner map   (Phase 1 of the 24h/48h SLA work)
-- Applied: 2026-08-04
--
-- The PO passes through THREE different people — creator (Saurabh / Om),
-- approver (Mehul), placer (Krisha) — but only two hand-offs were recorded:
--
--   created_at / created_by      ✓
--   approved_at / approved_by    ✓
--   placed_at                    ✓  but WHO placed it was never stored
--   submitted for approval       ✗  no timestamp at all
--
-- Consequences this fixes:
--   • The approver's 24h clock ran from PO CREATION, so a PO drafted Monday
--     and submitted Friday read as a 4-day approval breach. Unfair, and it
--     understates real approval performance (measured 87% within 24h).
--   • A 48h placement breach could not be attributed to anyone, and the
--     placer's performance could not be measured at all.
--
-- Owners live in a TABLE, not in code: measured 2026-08-04, Mehul approves
-- 1088 POs but Ankit (8) and Vatsal (3) cover when he is away, and six people
-- create POs. Hardcoding names would chase the wrong person the first time
-- someone takes leave.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS submitted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS placed_by      uuid,
  ADD COLUMN IF NOT EXISTS placed_by_name text;

COMMENT ON COLUMN public.purchase_orders.submitted_at IS
  'When the PO entered Pending Approval. Start of the 24h approval SLA. Reset when an amended PO is sent back for re-approval.';
COMMENT ON COLUMN public.purchase_orders.placed_by IS
  'Who marked the PO as Placed with the vendor. End of the 48h placement SLA.';

-- ── Who owns each hand-off (data, not code) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.po_workflow_owners (
  step        text PRIMARY KEY CHECK (step IN ('approver','placer')),
  profile_id  uuid REFERENCES public.profiles(id),
  sla_hours   numeric NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid
);

INSERT INTO public.po_workflow_owners (step, profile_id, sla_hours) VALUES
  ('approver', '888b120e-cd21-43cf-a155-bca67d57da0d', 24),   -- Mehul Maniar
  ('placer',   'c368ec10-ea4b-4106-9cbb-1b7aadafb665', 48)    -- Krisha Thakkar
ON CONFLICT (step) DO NOTHING;

ALTER TABLE public.po_workflow_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS po_owners_read ON public.po_workflow_owners;
CREATE POLICY po_owners_read ON public.po_workflow_owners FOR SELECT TO authenticated USING (true);
-- Changed via SQL only: reassigning who is chased is a deliberate act.
REVOKE INSERT, UPDATE, DELETE ON public.po_workflow_owners FROM authenticated;

-- To hand over during leave:
--   UPDATE po_workflow_owners SET profile_id = '<profile uuid>', updated_at = now()
--    WHERE step = 'approver';

-- ── Backfill note ──────────────────────────────────────────────────────────
-- Deliberately NOT backfilled. submitted_at and placed_by are unknowable for
-- historical POs — inventing them would make the SLA scorecard look precise
-- while being fiction. Per-person SLA reporting is therefore accurate from
-- 2026-08-04 forward; older POs keep the cruder created→approved measure and
-- must be labelled as such wherever they are shown.
