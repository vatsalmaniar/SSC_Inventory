-- ═══════════════════════════════════════════════════════════════════════════
-- REAL THREE-WAY MATCH ON INWARD BILLING — PHASE 1 (purely additive)
--
-- WHY: the stage called "3-Way Check" validates that a notes box is non-empty
-- and then advances the bill. Nothing is ever compared. Proof from production:
--
--   SSC/PCO0816/26-27 -> SSC/GRN0683/KAV/26-27, item CP4/4(E)D1, 100 pcs
--     PO   179.40 list, 26% disc -> net 132.76   (expected taxable 13,276.00)
--     Bill 179.40 list, 40% disc -> net 107.64   (billed   taxable 10,764.41)
--     variance  -2,511.59  (-18.9%)
--     three_way_notes = 'Mismatch in Price'   <-- typed by a human
--     status          = 'invoice_pending'     <-- and it advanced anyway
--
-- A person wrote "Mismatch in Price" into the only field the screen offered and
-- the bill moved on. They behaved correctly; the screen had nowhere to put it.
-- Measured: only 29 of 1,551 bills (1.9%) have the vendor invoice attached at
-- all, and the upload panel does not even render until AFTER the check.
--
-- WHY LINE-LEVEL RATES, not a header total. Measured over 1,547 non-test
-- po_inward GRNs (3,693 lines, 12.69 Cr of expected value):
--   * grn.invoice_amount is the WHOLE vendor invoice, GROSS of GST — not this
--     GRN's share. Only 1,010 GRNs (66%) sit at ratio ~1.18 against the PO.
--   * 19 invoice numbers span 40 GRNs, the same full amount typed onto each.
--     One invoice covering several receipts is routine (Hummel, Schmersal,
--     Unison, HCE, Mitsubishi) — so a UNIQUE index on the number is impossible.
--   * The 17 GRNs at ratio >3 (up to 67x) are consolidated/whole-invoice
--     amounts on a partial receipt. All 17 were read individually. NOT
--     over-billings.
-- A header total would therefore flag ~29% of bills for legitimate reasons and
-- be overridden away inside a week. A RATE is immune to all of it: 107.64 vs
-- 132.76 is wrong regardless of consolidation, GST, freight or partial receipt.
--
-- FEASIBLE: 3,607 of 3,693 lines (97.7%) have a usable PO net price. 86 do not,
-- 0 are unpegged. The 2.3% get an explicit no_basis path, never a silent zero.
--
-- ⛔ NO DATA IS DELETED BY THIS FILE. No DELETE, no TRUNCATE, no DROP TABLE, no
--    DROP COLUMN. Every table is CREATE IF NOT EXISTS, every column is ADD
--    COLUMN IF NOT EXISTS, every function is a NEW name. The existing
--    purchase_invoices.status CHECK is untouched. Nothing is backfilled —
--    the 1,327 inward_complete bills keep match_status NULL forever, because
--    the absence of a match IS the audit fact and a synthetic verdict would be
--    a fabricated trail.
--
-- ⚠️ PHASE 1 DELIBERATELY DOES **NOT**:
--      * replace confirm_grn                       (Phase 2)
--      * touch chk_po_received_qty                 (Phase 3, and only if the
--                                                   keep-the-excess option is
--                                                   wanted — the default path
--                                                   never needs it)
--      * change procurement_received_by_month      (Phase 2 — it changes a
--                                                   number already in use)
--      * revoke any existing grant or policy       (Phase 3, after prove)
--    So after this file runs, the current flow still works end to end. The
--    variance merely becomes VISIBLE. mode = 'log': nothing is blocked.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. The canonical PO-line price, in ONE place ───────────────────────────
-- ⚠️ nullif, NOT plain coalesce. EVERY po_items row has
-- unit_price_after_disc = 0.00 (4,959/4,959 — scripts/po-value-parity.mjs:10).
-- coalesce() only skips NULL, so it would return the 0 and every single bill
-- would read as a 100% over-bill. Verified live on PCO0816: after_disc 0,
-- unit_price 132.76, lp 179.40.
-- Mirrors src/lib/poValue.js:18 poUnitPrice() exactly. If one changes, both do,
-- and scripts/three-way-parity.mjs fails until they agree again.
create or replace function public.po_item_unit_price(p_po_item_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce( nullif(unit_price_after_disc, 0),
                   nullif(unit_price,            0),
                   nullif(lp_unit_price,         0), 0 )
    from public.po_items
   where id = p_po_item_id
$$;

comment on function public.po_item_unit_price(uuid) is
  'Net purchase price of one PO line. MUST use nullif — every po_items row has unit_price_after_disc = 0, so coalesce() silently returns 0. Mirrors poUnitPrice() in src/lib/poValue.js.';


-- ── 2. Tolerance + mode switch (config, not a constant) ────────────────────
-- Mirrors po_guard_config (sql/po_status_integrity.sql:42) so procurement has
-- ONE way of expressing a policy switch. Hardcoding these would make every
-- policy change a deployment.
create table if not exists public.three_way_tolerance (
  id                    int primary key default 1,
  constraint three_way_tolerance_singleton check (id = 1),

  mode                  text not null default 'log'
                          check (mode in ('log','enforce')),
  -- Bills created before this instant are NEVER refused, whatever the mode.
  -- This is what guarantees the 224 bills currently in flight cannot strand.
  enforce_from          timestamptz,

  -- Rate band per unit = GREATEST(rate_tol_abs, po_price * rate_tol_pct/100).
  -- A percentage alone makes every 20-rupee item a permanent flag; an absolute
  -- floor alone lets a big-ticket variance through. Neither works alone.
  -- Separate over/under: an over-bill is money leaving, an under-bill means our
  -- PO price is wrong. Different consequences, different appetite.
  rate_tol_pct_over     numeric not null default 1.0,
  rate_tol_pct_under    numeric not null default 5.0,
  rate_tol_abs          numeric not null default 1.0,

  -- SAP's BD key: "form small differences automatically". Below this per-unit
  -- difference nothing is recorded at all. Without it, 1.50-rupee rounding
  -- generates flags and then nobody reads the flags.
  rate_tol_abs_ignore   numeric not null default 0.10,

  -- Quantity billed vs quantity accepted. 0 = any mismatch is flagged.
  qty_tol_pct           numeric not null default 0,

  gst_rates             numeric[] not null default array[0,5,12,18,28],
  override_roles        text[]    not null default array['admin','management'],
  override_reason_codes text[]    not null default array[
    'price_revision_agreed','discount_slab_corrected','rejected_goods_billed',
    'excess_billed','po_price_wrong','po_price_missing','consolidated_invoice',
    'freight_on_invoice','partial_billing','rounding','other'],

  updated_at            timestamptz default now(),
  updated_by            uuid
);

insert into public.three_way_tolerance (id) values (1) on conflict (id) do nothing;

alter table public.three_way_tolerance enable row level security;
drop policy if exists twt_read on public.three_way_tolerance;
create policy twt_read on public.three_way_tolerance
  for select to authenticated using (true);
-- Changed by SQL only: loosening a money control is a deliberate act.
revoke insert, update, delete on public.three_way_tolerance from authenticated;
revoke all on public.three_way_tolerance from anon;

comment on column public.three_way_tolerance.enforce_from is
  'Bills created before this are never refused even in enforce mode. Set it when flipping to enforce so nothing already in flight can strand.';
comment on column public.three_way_tolerance.rate_tol_abs_ignore is
  'SAP BD equivalent. Per-unit differences below this are not recorded at all — without it, rounding noise drowns the real findings.';


-- ── 3. The audit log (also the log-only evidence base) ─────────────────────
-- Same shape and same revokes as po_guard_violations. would_block records what
-- enforce mode WOULD have refused, so the tolerance is tuned from real rows
-- instead of guessed.
create table if not exists public.three_way_match_log (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid,
  grn_id            uuid,
  invoice_number    text,
  vendor_id         uuid,
  vendor_name       text,
  event             text not null,   -- match | override | duplicate_suspect | reassert_failed
  match_status      text,
  expected_taxable  numeric,
  billed_taxable    numeric,
  variance_amount   numeric,
  worst_line_pct    numeric,
  qty_variance_amt  numeric,
  no_basis_lines    int,
  reason_code       text,
  reason            text,
  duplicate_of      uuid,
  actor_id          uuid,
  actor_name        text,
  actor_role        text,
  would_block       boolean not null default false,
  created_at        timestamptz default now()
);
create index if not exists idx_twml_invoice on public.three_way_match_log (invoice_id);
create index if not exists idx_twml_created on public.three_way_match_log (created_at desc);
create index if not exists idx_twml_would_block
  on public.three_way_match_log (would_block, created_at desc) where would_block;

alter table public.three_way_match_log enable row level security;
drop policy if exists twml_read on public.three_way_match_log;
create policy twml_read on public.three_way_match_log
  for select to authenticated using (public.can_read_purchase());
-- Written only by the definer RPCs below.
revoke insert, update, delete on public.three_way_match_log from authenticated;
revoke all on public.three_way_match_log from anon;


-- ── 4. The missing third leg: bill LINES ───────────────────────────────────
-- purchase_invoices is a header row; its "lines" were read-only borrowings from
-- grn_items, which carries no price. So there was nowhere a per-item invoice
-- rate of 107.64 could even be written down, let alone compared.
--
-- FOUR numbers per line. Two are inherited READ-ONLY, two are entered by
-- accounts — that split IS the control:
--   matched_qty     <- GRN accepted_qty   (quantity is decided at the GRN)
--   po_unit_price   <- PO line            (snapshot, so a later PO edit cannot
--                                          rewrite history)
--   billed_qty      <- the vendor invoice (accounts)
--   inv_unit_price  <- the vendor invoice (accounts)
--
-- and the variance decomposes into two INDEPENDENT parts, because the fixes
-- differ — a rate variance means our PO/price book is wrong, a quantity
-- variance means the vendor owes us money back:
--   Connectwell:  100/100 @ 132.76 vs 107.64 -> qty 0,  rate -2,512
--   Over-deliver: 100/110 @ 132.76 vs 132.76 -> rate 0, qty +1,327.60
create table if not exists public.purchase_invoice_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.purchase_invoices(id) on delete cascade,
  -- NO ACTION on both FKs below is deliberate and protective: it is the same
  -- guard that already makes a received PO line undeletable. Once a line is
  -- matched, PurchaseOrderDetail's delete-and-reinsert on PO edit (audit P6)
  -- can no longer silently destroy it — the FK refuses.
  grn_item_id       uuid references public.grn_items(id),
  po_item_id        uuid references public.po_items(id),
  po_id             uuid,
  item_code         text not null,
  description       text,

  matched_qty       numeric not null default 0,   -- read-only, from the GRN
  po_unit_price     numeric,                      -- read-only, from the PO
  billed_qty        numeric,                      -- accounts
  inv_unit_price    numeric,                      -- accounts  <- the new fact

  -- Generated so no caller can disagree with the arithmetic. NULL (not 0) when
  -- there is no price basis: a missing basis must never masquerade as a zero
  -- variance, nor make every rupee billed look like an over-bill.
  rate_variance     numeric generated always as (
    case when po_unit_price is null or po_unit_price = 0 or inv_unit_price is null
         then null else inv_unit_price - po_unit_price end) stored,
  rate_variance_pct numeric generated always as (
    case when po_unit_price is null or po_unit_price = 0 or inv_unit_price is null
         then null
         else round(100.0 * (inv_unit_price - po_unit_price) / po_unit_price, 2) end) stored,
  qty_variance      numeric generated always as (
    case when billed_qty is null then null else billed_qty - matched_qty end) stored,

  line_status       text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.purchase_invoice_items
  drop constraint if exists pii_line_status_check;
alter table public.purchase_invoice_items
  add constraint pii_line_status_check check (
    line_status is null or line_status = any (array[
      'matched',           -- no difference worth recording
      'within_tolerance',
      'over_tolerance',
      'no_basis'           -- pegged but unpriced, or not pegged at all
    ]));

alter table public.purchase_invoice_items
  drop constraint if exists pii_qty_nonneg;
alter table public.purchase_invoice_items
  add constraint pii_qty_nonneg check (
    matched_qty >= 0 and (billed_qty is null or billed_qty >= 0));

-- One bill line per GRN line. Stops the same receipt line being billed twice
-- inside one bill.
create unique index if not exists uq_pii_invoice_grn_item
  on public.purchase_invoice_items (invoice_id, grn_item_id)
  where grn_item_id is not null;
create index if not exists idx_pii_invoice  on public.purchase_invoice_items (invoice_id);
create index if not exists idx_pii_po_item  on public.purchase_invoice_items (po_item_id);
create index if not exists idx_pii_item     on public.purchase_invoice_items (item_code);
-- Feeds "last actually paid" on the New PO screen — the cheapest prevention we
-- have, since 92 of 5,268 PO lines were priced from the book and 551 by hand.
create index if not exists idx_pii_item_recent
  on public.purchase_invoice_items (item_code, created_at desc)
  where inv_unit_price is not null;

alter table public.purchase_invoice_items enable row level security;
drop policy if exists pii_read on public.purchase_invoice_items;
create policy pii_read on public.purchase_invoice_items
  for select to authenticated using (public.can_read_purchase());
-- Definer RPCs are the only writers. NOT a USING(true) write policy anywhere —
-- that is the privilege-escalation shape the VAPT work closed on profiles.
revoke insert, update, delete on public.purchase_invoice_items from authenticated;
revoke all on public.purchase_invoice_items from anon;

comment on table public.purchase_invoice_items is
  'Vendor bill LINES. matched_qty and po_unit_price are inherited read-only (quantity is decided at the GRN, price at Inward Billing); billed_qty and inv_unit_price are entered by accounts. Written only via pi_record_match().';


-- ── 5. Verdict + override columns on the bill header ───────────────────────
-- All nullable or defaulted. No existing value is read or rewritten.
alter table public.purchase_invoices
  add column if not exists match_status            text,
  add column if not exists match_expected_taxable  numeric,
  add column if not exists match_billed_taxable    numeric,
  add column if not exists match_variance_amount   numeric,
  add column if not exists match_worst_line_pct    numeric,
  add column if not exists match_qty_variance_amt  numeric,
  add column if not exists match_no_basis_lines    int,
  add column if not exists match_lines             int,
  -- The tolerance ACTUALLY applied, snapshotted. A later policy change must not
  -- retro-judge a bill that was cleared under the old numbers.
  add column if not exists match_tol_pct           numeric,
  add column if not exists match_tol_abs           numeric,
  add column if not exists match_computed_at       timestamptz,
  add column if not exists match_computed_by       text,
  add column if not exists match_computed_by_id    uuid,
  -- The override — SAP's payment block, not a document block.
  add column if not exists override_reason_code    text,
  add column if not exists override_reason         text,
  add column if not exists override_by             text,
  add column if not exists override_by_id          uuid,
  add column if not exists override_at             timestamptz,
  add column if not exists payment_block           boolean not null default false,
  -- Duplicate handling. A consolidated invoice is legal but must be deliberate.
  add column if not exists duplicate_of_invoice_id uuid references public.purchase_invoices(id),
  add column if not exists duplicate_ack_reason    text,
  -- Honest home for charges no PO line can explain. Without this, freight lands
  -- in the variance and becomes the biggest single source of false positives.
  add column if not exists freight_amount          numeric not null default 0,
  add column if not exists taxable_amount          numeric;

alter table public.purchase_invoices drop constraint if exists pi_match_status_check;
alter table public.purchase_invoices add constraint pi_match_status_check check (
  match_status is null or match_status = any (array[
    'matched','within_tolerance','over_tolerance','overridden',
    'no_basis','partial_basis']));

comment on column public.purchase_invoices.match_status is
  'NULL = a legacy bill matched before the three-way match existed. NEVER backfilled: the absence of a match is itself the audit fact, and a synthetic verdict would be a fabricated trail.';
comment on column public.purchase_invoices.payment_block is
  'Operational flag on the hand-off to Tally, NOT an accounting posting block (accounting is Tally, permanently). True whenever an out-of-tolerance or duplicate-suspect bill was overridden.';
comment on column public.purchase_invoices.freight_amount is
  'Charges on the invoice that no PO line can explain. Excluded from the matched base so freight stops corrupting the price variance.';
comment on column public.purchase_invoices.taxable_amount is
  'Taxable (ex-GST) value as billed. This is what the match compares. invoice_amount is left exactly as it is for every existing row.';

-- Duplicate-invoice lookup. NOT unique, and that is a measured decision: 19
-- invoice numbers legitimately span 40 GRNs today, so a UNIQUE index would both
-- fail to build and forbid a legal transaction. The RPC pre-check is the
-- control; this index just makes it fast.
create index if not exists idx_pi_vendor_invno_norm
  on public.purchase_invoices (vendor_id, lower(btrim(invoice_number)))
  where invoice_number is not null and btrim(invoice_number) <> '';
-- Retyped-number probe (same vendor, same amount, near date). Soft signal only.
create index if not exists idx_pi_vendor_date_amt
  on public.purchase_invoices (vendor_id, invoice_date, invoice_amount);
create index if not exists idx_pi_payment_block
  on public.purchase_invoices (payment_block) where payment_block;
create index if not exists idx_pi_match_status on public.purchase_invoices (match_status);

commit;
