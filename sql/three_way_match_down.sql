-- ═══════════════════════════════════════════════════════════════════════════
-- THREE-WAY MATCH — PHASE 1 REVERSAL
--
-- ⚠️ READ THIS BEFORE RUNNING ANY OF IT.
--
-- You almost certainly do NOT want this file. Phase 1 blocks nothing and
-- removes nothing: mode = 'log', every existing write path still works, every
-- existing field is still on screen. To neutralise it, the correct move is to
-- stop reading the new columns in the app — not to drop them.
--
-- This file is here because a migration without a written reversal is not a
-- finished migration. It is deliberately split into two parts.
--
-- PART A is safe and is the ONLY part that should normally be used: it removes
-- the functions and leaves every table, column and row untouched.
--
-- PART B DESTROYS DATA and is commented out. purchase_invoice_items holds the
-- vendor rates keyed in by accounts — the one fact that exists nowhere else in
-- the system, and the whole point of the exercise. three_way_match_log is the
-- audit trail of every match and override. Dropping them is unrecoverable.
-- Do not uncomment without an explicit decision and a fresh pg_dump.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — remove the API only. No data is touched.
-- ─────────────────────────────────────────────────────────────────────────────
begin;

drop function if exists public.pi_override_match(uuid,text,text);
drop function if exists public.pi_record_match(uuid,text,date,numeric,numeric,numeric,jsonb,text,uuid,text);
drop function if exists public.pi_last_paid(text);
drop function if exists public.pi_match_basis(uuid);
drop function if exists public.tw_actor();
-- po_item_unit_price is left in place on purpose: it is the one correct
-- statement of the nullif price rule, it is harmless, and other work will want
-- it. Drop it only if you are certain nothing references it.

commit;


-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — ⛔ DESTROYS DATA. Commented out. Requires an explicit decision.
-- ─────────────────────────────────────────────────────────────────────────────
-- Before uncommenting, take the backup and check what you would lose:
--
--   select count(*) as bill_lines,
--          count(inv_unit_price) as vendor_rates_keyed_in,
--          count(*) filter (where line_status = 'over_tolerance') as variances_found
--     from public.purchase_invoice_items;
--
--   select count(*) as log_rows,
--          count(*) filter (where would_block) as would_have_been_blocked
--     from public.three_way_match_log;
--
--   select count(*) as bills_with_a_verdict,
--          count(*) filter (where payment_block) as payment_blocked
--     from public.purchase_invoices where match_status is not null;
--
-- begin;
--
-- -- Columns on purchase_invoices. Dropping these discards every verdict,
-- -- every override reason, and every payment block ever recorded.
-- alter table public.purchase_invoices
--   drop constraint if exists pi_match_status_check,
--   drop column if exists match_status,
--   drop column if exists match_expected_taxable,
--   drop column if exists match_billed_taxable,
--   drop column if exists match_variance_amount,
--   drop column if exists match_worst_line_pct,
--   drop column if exists match_qty_variance_amt,
--   drop column if exists match_no_basis_lines,
--   drop column if exists match_lines,
--   drop column if exists match_tol_pct,
--   drop column if exists match_tol_abs,
--   drop column if exists match_computed_at,
--   drop column if exists match_computed_by,
--   drop column if exists match_computed_by_id,
--   drop column if exists override_reason_code,
--   drop column if exists override_reason,
--   drop column if exists override_by,
--   drop column if exists override_by_id,
--   drop column if exists override_at,
--   drop column if exists payment_block,
--   drop column if exists duplicate_of_invoice_id,
--   drop column if exists duplicate_ack_reason,
--   drop column if exists freight_amount,
--   drop column if exists taxable_amount;
--
-- drop index if exists public.idx_pi_vendor_invno_norm;
-- drop index if exists public.idx_pi_vendor_date_amt;
-- drop index if exists public.idx_pi_payment_block;
-- drop index if exists public.idx_pi_match_status;
--
-- -- ⛔ The vendor rates. Nowhere else in the system holds these.
-- drop table if exists public.purchase_invoice_items;
-- -- ⛔ The audit trail of every match, override and duplicate.
-- drop table if exists public.three_way_match_log;
-- drop table if exists public.three_way_tolerance;
--
-- commit;
--
-- NOTE: purchase_invoices.invoice_amount, grn.invoice_amount and every other
-- pre-existing column and row are untouched by this file in either part.
-- Phase 1 never wrote to them.
