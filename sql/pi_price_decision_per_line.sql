-- ═══════════════════════════════════════════════════════════════════════════
-- THE PRICE DECISION BELONGS ON THE LINE, NOT THE BILL
--
-- The first cut asked "which price is right?" once per bill. That only works
-- when a bill has one item. On a real invoice with five items where three are
-- wrong on our side and two are the vendor overcharging, a single answer is
-- untrue whichever way you answer it — and it would either raise a debit note
-- for money we do not claim, or waive money we do.
--
--   item A   PO 100  billed 120   -> their price is right, our PO was wrong
--   item B   PO 250  billed 250   -> agrees, nothing to decide
--   item C   PO  80  billed  95   -> they overcharged, recover 15 x qty
--
-- So the answer is per line, and the debit note is the SUM of only the lines
-- where our PO was right. A header-level answer is kept for the common
-- single-item bill and for reporting, with 'mixed' when the lines disagree.
--
-- ⛔ NO DATA IS DELETED. One nullable column, one relaxed CHECK on a column
--    added minutes ago and written on no historical row.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.purchase_invoice_items
  add column if not exists price_decision text;

alter table public.purchase_invoice_items drop constraint if exists pii_price_decision_check;
alter table public.purchase_invoice_items add constraint pii_price_decision_check check (
  price_decision is null or price_decision in ('invoice_correct','po_correct'));

comment on column public.purchase_invoice_items.price_decision is
  'Per line, when the rates disagree. invoice_correct = their rate is our real cost and the PO was raised wrong (nothing to recover). po_correct = they overcharged this line; its difference goes into the debit note.';

-- The header answer now summarises the lines, so it needs a third value.
alter table public.purchase_invoices drop constraint if exists pi_price_decision_check;
alter table public.purchase_invoices add constraint pi_price_decision_check check (
  price_decision is null or price_decision in ('invoice_correct','po_correct','mixed'));

comment on column public.purchase_invoices.price_decision is
  'Summary of the LINE decisions: invoice_correct / po_correct when they all agree, mixed when they do not. The lines are the authority — the debit note is computed from them, never from this.';

commit;

-- What our PO prices got wrong, by vendor — the list to fix in the price book:
--   select pin.vendor_name, pii.item_code, count(*) as times,
--          round(avg(pii.inv_unit_price - pii.po_unit_price), 2) as avg_diff_per_unit
--     from public.purchase_invoice_items pii
--     join public.purchase_invoices pin on pin.id = pii.invoice_id
--    where pii.price_decision = 'invoice_correct'
--    group by 1,2 order by times desc;
