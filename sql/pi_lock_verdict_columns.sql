-- ═══════════════════════════════════════════════════════════════════════════
-- LOCK THE VERDICT — found by red-teaming, 2026-09-19
--
-- THE BREACH. Every rule was enforced inside pi_record_match / pi_override_match
-- and none of it mattered: purchase_invoices carried a TABLE-LEVEL grant of
-- UPDATE, DELETE and TRUNCATE to `authenticated`. Signed in as accounts, through
-- PostgREST, one statement was enough:
--
--   update purchase_invoices set payment_block = false,
--          debit_note_required = false, match_status = 'matched' where id = '…';
--
-- That clears the payment hold, deletes the claim against the vendor, and forges
-- a clean verdict on a bill nobody matched. DELETE removed the bill entirely.
-- This is the P1 / F-06 pattern again — the gate was somewhere the caller never
-- had to walk through.
--
-- ⚠️ A COLUMN-LEVEL REVOKE DOES NOT WORK HERE, and my first attempt at this
--    failed silently because of it: in Postgres a table-level UPDATE grant
--    covers every column, and `REVOKE UPDATE (col)` does not override it. The
--    table grant has to go first, then UPDATE is granted back column by column.
--    The re-run of the attack is the only reason I caught it.
--
-- ⛔ NO DATA IS DELETED. Privileges only. SECURITY DEFINER functions run as the
--    owner, so every RPC is unaffected.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1. Take back the blanket grants. TRUNCATE and DELETE on a financial document
--    table should never have been reachable from a browser session.
revoke update, delete, truncate on public.purchase_invoices from authenticated;

-- 2. Hand UPDATE back ONLY for what the client still legitimately writes — the
--    stage-2 completion, which has not yet moved into pi_complete_inward().
--    Everything omitted here (the verdict, the payment hold, the vendor claim,
--    who approved it, whose price stood) is now RPC-only.
grant update (
  status,
  invoice_number, invoice_date, invoice_amount, gst_amount, total_amount,
  taxable_amount, freight_amount, cgst_amount, sgst_amount, igst_amount,
  vendor_invoice_url, ssc_invoice_url,
  three_way_notes, three_way_checked_at, three_way_checked_by,
  inward_completed_at, inward_completed_by,
  po_id, vendor_id, vendor_name,
  updated_at, updated_by
) on public.purchase_invoices to authenticated;

revoke all on public.purchase_invoices from anon;

commit;
