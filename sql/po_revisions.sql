-- ═══════════════════════════════════════════════════════════════════════════
-- PO REVISIONS — a purchase order becomes a versioned document
-- Applied: 2026-08-05        Phase 1 of 3: schema + backfill (additive, no UI)
--
-- WHY (measured on production 2026-08-05, not assumed):
--   • 168 edits happened AFTER approval, across 129 POs.
--   • 91 of those edits were on POs ALREADY PLACED with the vendor — 77 POs
--     were changed after the supplier had them, with no record anywhere of
--     what the supplier holds versus what we now expect.
--   • The consequence surfaced on 2026-08-04: five POs were amended, silently
--     renumbered, and the supplier ended up holding two different numbers for
--     the same order. See sql/po_number_restore.sql.
--
-- The header can only ever describe ONE state, so every amendment destroys the
-- previous one. `po_pdf_url` already stores a frozen document per approval, but
-- viewPoPdf() ignores it and re-renders from CURRENT data — so the "approved
-- document" shows today's quantities under the original approver's signature
-- (audit finding F-11). This table gives each state a permanent home.
--
-- Rev 0 = the PO as first approved. Each post-approval amendment adds Rev N.
-- The PO NUMBER never changes across revisions — that is now enforced by
-- trg_po_number_immutable. The vendor sees "SSC/PO0185 Rev 2".
--
-- ADDITIVE ONLY: nothing reads this yet. No existing page changes behaviour
-- until Phase 2 wires it. Safe to apply on a live system.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.po_revisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id            uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  rev_no           integer NOT NULL,               -- 0 = original approval
  po_number        text,                           -- as printed on THIS revision
  change_summary   text,                           -- the line-level diff; null for rev 0
  total_amount     numeric,                        -- value at this revision
  approved_by      text,
  approved_at      timestamptz,
  doc_url          text,                           -- FROZEN document for this revision
  sent_to_vendor_at timestamptz,                   -- when this exact revision went out
  sent_to          text[],                         -- and to whom
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  CONSTRAINT po_revisions_unique_rev UNIQUE (po_id, rev_no),
  CONSTRAINT po_revisions_rev_no_nonneg CHECK (rev_no >= 0)
);

CREATE INDEX IF NOT EXISTS idx_po_revisions_po ON public.po_revisions (po_id, rev_no DESC);

COMMENT ON TABLE public.po_revisions IS
  'Append-only version history of each purchase order. Rev 0 is the first approval; each post-approval amendment adds a revision. The PO number is constant across revisions.';
COMMENT ON COLUMN public.po_revisions.doc_url IS
  'Frozen document as approved at THIS revision. Never re-render it from current data — that is the bug this table exists to fix.';
COMMENT ON COLUMN public.po_revisions.sent_to_vendor_at IS
  'Null = this revision was never sent. That is the amended-but-not-communicated worklist.';

-- ── Backfill Rev 0 for every PO that has a real (non-Temp) number ──────────
-- Historical amendments before 2026-08-04 CANNOT be reconstructed as separate
-- revisions: the diff text did not exist before the amendment logging shipped,
-- so there is no honest way to say what changed. Those POs get a single Rev 0
-- reflecting their CURRENT state, which is what the header has always claimed.
-- Revision history is therefore trustworthy from 2026-08-05 forward.
INSERT INTO public.po_revisions
  (po_id, rev_no, po_number, total_amount, approved_by, approved_at, doc_url)
SELECT p.id, 0, p.po_number, p.total_amount, p.approved_by, p.approved_at,
       -- The four restored POs' stored PDFs were regenerated on 2026-08-04 and
       -- print the WRONG (renumbered) po_number, so they are not valid Rev 0
       -- documents. Left null rather than pointing at a misleading file.
       CASE WHEN p.po_number IN ('SSC/PO0185/26-27','SSC/PO0155/26-27',
                                 'SSC/PO0167/26-27','SSC/PCO0401/26-27')
            THEN NULL ELSE p.po_pdf_url END
FROM public.purchase_orders p
WHERE p.po_number IS NOT NULL
  AND p.po_number NOT LIKE 'Temp/%'
ON CONFLICT (po_id, rev_no) DO NOTHING;

-- ── Access ─────────────────────────────────────────────────────────────────
ALTER TABLE public.po_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS po_rev_read ON public.po_revisions;
CREATE POLICY po_rev_read ON public.po_revisions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS po_rev_insert ON public.po_revisions;
CREATE POLICY po_rev_insert ON public.po_revisions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- Only the vendor-dispatch stamp may be updated; the approved facts are frozen.
DROP POLICY IF EXISTS po_rev_update_send_stamp ON public.po_revisions;
CREATE POLICY po_rev_update_send_stamp ON public.po_revisions
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.po_revision_is_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.po_id          IS DISTINCT FROM OLD.po_id
  OR NEW.rev_no         IS DISTINCT FROM OLD.rev_no
  OR NEW.po_number      IS DISTINCT FROM OLD.po_number
  OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
  OR NEW.total_amount   IS DISTINCT FROM OLD.total_amount
  OR NEW.approved_by    IS DISTINCT FROM OLD.approved_by
  OR NEW.approved_at    IS DISTINCT FROM OLD.approved_at
  OR NEW.doc_url        IS DISTINCT FROM OLD.doc_url
  THEN
    RAISE EXCEPTION 'A PO revision is a historical record and cannot be altered. Create a new revision instead.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_revision_append_only ON public.po_revisions;
CREATE TRIGGER trg_po_revision_append_only
  BEFORE UPDATE ON public.po_revisions
  FOR EACH ROW EXECUTE FUNCTION public.po_revision_is_append_only();

-- No DELETE policy: deletes silently affect zero rows, as with purchase_orders.
