-- ═══════════════════════════════════════════════════════════════════════════
-- GST SPLIT — CGST + SGST, or IGST
--
-- A single gst_amount cannot be handed to Tally: an Indian purchase invoice is
-- either intra-state (CGST + SGST, half the rate each) or inter-state (IGST at
-- the full rate), and the two post to different ledgers. Recording only the
-- total loses which.
--
-- IT IS DERIVED, NOT ASKED. The first two digits of a GSTIN are the state code,
-- and every active vendor has one — checked: 39 vendors at 24 (Gujarat, ours),
-- 17 at 27 (Maharashtra), plus 29 / 33 / 19 / 02, and ZERO without a GSTIN. So
-- the screen knows which pair of boxes to show before the user touches anything:
--
--   NUTRON SYSTEMS      24AADCN0347D1Z0  -> 24 -> ours    -> CGST + SGST
--   CONNECTWELL         27AAACC4125D1Z8  -> 27 -> not ours-> IGST
--
-- The user can still override — a vendor billing from a different registration
-- is a real thing — but they should not have to choose on a normal bill.
--
-- gst_amount IS KEPT as the sum of the three. Everything that already reads it
-- (the list, the Excel exports, total_amount) keeps working untouched; the split
-- is additional detail, not a replacement.
--
-- ⛔ NO DATA IS DELETED. Three defaulted columns and one config column.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.purchase_invoices
  add column if not exists cgst_amount numeric not null default 0,
  add column if not exists sgst_amount numeric not null default 0,
  add column if not exists igst_amount numeric not null default 0;

comment on column public.purchase_invoices.cgst_amount is
  'Central GST. Intra-state bills only, and always equal to sgst_amount. gst_amount stays the total of all three.';
comment on column public.purchase_invoices.igst_amount is
  'Integrated GST. Inter-state bills only — never alongside CGST/SGST on the same invoice.';

-- Never both halves and IGST on one bill: that is not a thing GST allows, and a
-- bill carrying both would post twice in Tally.
alter table public.purchase_invoices drop constraint if exists pi_gst_split_sane;
alter table public.purchase_invoices add constraint pi_gst_split_sane check (
  cgst_amount >= 0 and sgst_amount >= 0 and igst_amount >= 0
  and not (igst_amount > 0 and (cgst_amount > 0 or sgst_amount > 0))
);

-- Our own state, so "is this vendor local?" is config rather than a constant
-- buried in a page. 24 = Gujarat; both warehouses (Kaveri, Godawari) are here.
alter table public.three_way_tolerance
  add column if not exists home_state_code text not null default '24';

comment on column public.three_way_tolerance.home_state_code is
  'First two digits of our own GSTIN. A vendor whose GSTIN starts with this bills CGST+SGST; anyone else bills IGST.';

commit;

-- Sanity, once bills start carrying the split:
--   select pin.vendor_name, left(v.gst,2) as vendor_state,
--          pin.cgst_amount, pin.sgst_amount, pin.igst_amount, pin.gst_amount
--     from purchase_invoices pin join vendors v on v.id = pin.vendor_id
--    where pin.gst_amount > 0
--      and ( (left(v.gst,2) = '24' and pin.igst_amount > 0)      -- local billed IGST
--         or (left(v.gst,2) <> '24' and pin.cgst_amount > 0) );  -- outsider billed CGST
--   -- rows here are worth a look before the bill reaches Tally
