-- Scanned expense bills — keep the original when the scan looked risky.  2026-09-12
--
-- Photographed bills now go through a client-side document scanner (src/lib/docScan.js):
-- corners detected, perspective flattened, adaptive threshold applied. What gets attached
-- to the claim is the scan.
--
-- ⚠️ WHY THE ORIGINAL IS SOMETIMES KEPT
-- A bill is a financial document — reimbursement now, possibly an audit or an assessment
-- later. An adaptive threshold on a faint thermal receipt can erase the total, and nobody
-- finds out until someone asks for the receipt. The user's rule is to keep the original
-- only when the scan LOOKS RISKY, so "risky" is measured rather than guessed:
-- assessRisk() in src/lib/docScan.js flags a near-blank result, a near-black result, a
-- source with real colour (a stamp or signature that black-and-white drops), or a crop
-- the person adjusted by hand. scan_risk records which of those it was, in words, so the
-- reason survives next to the file.
--
-- ADDITIVE: three nullable columns. No drop, no rename, no trigger, no backfill —
-- every existing bill keeps NULL, which correctly reads as "not scanned".

begin;

alter table public.expense_bills
  add column if not exists original_path text,
  add column if not exists scan_mode     text,
  add column if not exists scan_risk     text;

comment on column public.expense_bills.original_path is
  'Storage path of the UNTOUCHED photo, kept only when the scan looked risky. NULL = the scan stands on its own, or the bill was never scanned.';
comment on column public.expense_bills.scan_mode is
  'xerox | grey | plain. NULL = uploaded as-is (a PDF, a HEIC that could not be decoded, or the person skipped scanning).';
comment on column public.expense_bills.scan_risk is
  'Why the original was kept, in plain words. NULL when the scan needed no second copy.';

-- A path without a reason, or a reason without a path, means the upload half-failed.
alter table public.expense_bills
  drop constraint if exists eb_scan_original_pairs;
alter table public.expense_bills
  add constraint eb_scan_original_pairs
  check ((original_path is null) = (scan_risk is null)) not valid;

commit;

-- NOT VALID: existing rows are all NULL/NULL and satisfy it anyway, but declaring it
-- NOT VALID means the migration cannot fail on data it did not create.
do $$
declare v_bad int;
begin
  select count(*) into v_bad from public.expense_bills
   where (original_path is null) <> (scan_risk is null);
  if v_bad > 0 then raise exception 'STOP: % bill(s) have an original with no reason, or the reverse', v_bad; end if;
  raise notice 'expense_bills ready for scanned uploads.';
end $$;
