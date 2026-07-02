-- grn credit-note trigger fields — Material Return Policy Phase 1
-- Applied: 2026-07-02 (via Management API)
--
-- Accounting lives in Tally; the system only TRIGGERS the credit/Dr-note step
-- and stores the resulting document. On confirming a return/rejection GRN,
-- accounts+admin+management are notified; the GRN then shows "Credit note
-- pending" until the Tally credit note (number + file) is uploaded here.

ALTER TABLE public.grn
  ADD COLUMN IF NOT EXISTS credit_note_number       text,
  ADD COLUMN IF NOT EXISTS credit_note_url          text,
  ADD COLUMN IF NOT EXISTS credit_note_uploaded_by  text,
  ADD COLUMN IF NOT EXISTS credit_note_uploaded_at  timestamptz;
