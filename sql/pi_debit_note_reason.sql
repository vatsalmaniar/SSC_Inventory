-- ═══════════════════════════════════════════════════════════════════════════
-- WHY is a debit note needed — price, or quantity?
--
-- "Recover ₹900" is not enough to write a Tally debit note against. Accounts has
-- to state the ground, and the vendor will argue it. There are exactly two, they
-- can both appear on one bill, and they are recovered for different reasons:
--
--   PRICE     they charged more per unit than the PO agreed, AND we decided our
--             PO was right. (If we decided THEIR price was right, nothing is
--             recoverable — our PO was simply raised wrong.)
--   QUANTITY  they billed for more than the store accepted. Always recoverable,
--             no decision needed: we never took the goods.
--
-- Both figures are already computed inside pi_record_match; they were just being
-- added together and the reason thrown away.
--
-- ⛔ NO DATA IS DELETED. Two nullable columns.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.purchase_invoices
  add column if not exists debit_note_rate_amount numeric,
  add column if not exists debit_note_qty_amount  numeric;

comment on column public.purchase_invoices.debit_note_rate_amount is
  'Part of the debit note arising from an over-charged RATE on lines where we decided our PO was right. Zero when we accepted the vendor''s price.';
comment on column public.purchase_invoices.debit_note_qty_amount is
  'Part of the debit note arising from being billed for MORE THAN WAS ACCEPTED. Always recoverable — the goods were never taken in.';

commit;
