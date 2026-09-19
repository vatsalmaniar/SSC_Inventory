-- ═══════════════════════════════════════════════════════════════════════════
-- WHICH PRICE IS CORRECT — the PO's, or the invoice's?
--
-- A price difference is not one situation, it is two, and they need opposite
-- actions. Telling the user "over tolerance" describes neither:
--
--   PO 17,700   invoice 18,000
--
--   (a) THE INVOICE IS RIGHT. The PO was raised at the wrong price — as on
--       PCO0816, where the discount slab was 26% but Connectwell's real terms
--       are ~40%. Nobody owes anybody: our COST is 18,000 and our costing was
--       wrong. Fix the price book so the next PO is right.
--
--   (b) THE PO IS RIGHT. The vendor has overcharged. We pay 17,700 and recover
--       300 with a debit note.
--
-- Same numbers, same flag, completely different consequence. So the screen asks
-- the question in those words instead of announcing a variance, and the answer
-- drives what happens next.
--
-- ⛔ NO DATA IS DELETED. Two nullable columns.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.purchase_invoices
  add column if not exists price_decision        text,
  add column if not exists price_decision_note   text;

alter table public.purchase_invoices drop constraint if exists pi_price_decision_check;
alter table public.purchase_invoices add constraint pi_price_decision_check check (
  price_decision is null or price_decision in ('invoice_correct','po_correct'));

comment on column public.purchase_invoices.price_decision is
  'invoice_correct = the vendor is right and our PO price was wrong (our cost is the invoice rate; fix the price book). po_correct = the vendor overcharged (pay the PO rate, recover the difference with a debit note). NULL = no difference to decide, or a bill matched before this existed.';

commit;

-- Where our PO prices are wrong, which is what to fix upstream:
--   select vendor_name, count(*) as bills,
--          round(sum(match_variance_amount), 0) as total_difference
--     from public.purchase_invoices
--    where price_decision = 'invoice_correct'
--    group by 1 order by abs(sum(match_variance_amount)) desc;
--
-- What vendors owe us back:
--   select vendor_name, invoice_number, debit_note_amount, debit_note_uploaded_at
--     from public.purchase_invoices
--    where price_decision = 'po_correct' and debit_note_required
--    order by debit_note_raised_at;
