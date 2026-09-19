-- ═══════════════════════════════════════════════════════════════════════════
-- GRN QUANTITY: recording physical excess, and the over-delivery options
-- PHASE 1 — columns only. Purely additive. Defaults preserve today's behaviour
-- exactly.
--
-- THE PROBLEM. If the PO says 100 and 110 physically arrive, the screen will not
-- let you type 110: it silently rewrites the value to 100 (NewGRN.jsx:228-238)
-- and blocks the save if you get past that (NewGRN.jsx:348-352). So the
-- storekeeper records 100, and those 10 pieces exist in the godown and NOWHERE
-- in the system. The 2026-08-03 red-team put it exactly: "Physical excess:
-- nowhere to record it."
--
-- THE GOOD NEWS: no constraint change is needed for the default path.
-- confirm_grn adds only COALESCE(accepted_qty, received_qty, 0) to
-- po_items.received_qty and checks only THAT against po_items.qty
-- (grn_void_and_confirm_guard.sql:130-145), and grn_items constrains only
-- accepted + rejected <= received (hardening_search_path_and_grn_checks.sql:45)
-- — there is NO upper bound on received_qty. So:
--
--     received 110 / accepted 100 / rejected 10  ("more than ordered")
--
-- is ALREADY legal, already satisfies the PO at exactly 100, and needs no DDL at
-- all. Only React forbids it. Refusing the excess is therefore a pure UI fix,
-- and it stays the DEFAULT.
--
-- ⛔ NO DATA IS DELETED OR REWRITTEN BY THIS FILE. Three ADD COLUMN IF NOT
--    EXISTS with defaults that describe today's behaviour (tolerance 0, not
--    unlimited, not closed), so every one of the 5,268 existing PO lines keeps
--    behaving precisely as it does now.
--
-- ⚠️ chk_po_received_qty IS NOT TOUCHED HERE. Only the "keep the extra 110"
--    option needs it relaxed, because only that pushes received_qty above qty.
--    That is Phase 3, it is written out at the bottom of this file, and it is
--    NOT run. Read the note there before ever running it.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.po_items
  -- Accept up to qty * (1 + pct/100) without asking anyone. 0 = refuse any
  -- excess, which is what the system does today.
  add column if not exists over_delivery_tol_pct   numeric not null default 0,
  -- For MOQ vendors who always ship a full carton and arguing costs more than
  -- the overage.
  add column if not exists over_delivery_unlimited boolean not null default false,
  -- The SHORT-supply case: 90 arrived against 100 and the balance is never
  -- coming. Without this the line sits in the pending list forever. SAP calls it
  -- the "delivery completed" indicator.
  add column if not exists delivery_closed         boolean not null default false,
  add column if not exists delivery_closed_at      timestamptz,
  add column if not exists delivery_closed_by      text,
  add column if not exists delivery_closed_reason  text;

alter table public.po_items drop constraint if exists po_items_over_tol_sane;
alter table public.po_items add constraint po_items_over_tol_sane
  check (over_delivery_tol_pct >= 0 and over_delivery_tol_pct <= 100);

comment on column public.po_items.over_delivery_tol_pct is
  'Percentage over the ordered quantity that may be accepted without a decision. 0 (the default, and every existing row) = refuse the excess, which is what the system does today.';
comment on column public.po_items.over_delivery_unlimited is
  'Accept whatever arrives on this line. For MOQ vendors who ship full cartons.';
comment on column public.po_items.delivery_closed is
  'Short supply, balance not coming. Stops the line showing as pending. NOT a receipt — received_qty is unchanged.';

-- Only the writers of these columns should be able to set them. Column-level,
-- because a blanket REVOKE on po_items would break PO creation and editing in
-- three pages (PurchaseOrderDetail, NewPurchaseOrder, ForecastPOModal).
-- ⚠️ Deliberately NOT done in Phase 1: revoking these needs the GRN write RPC to
--    exist first, or the FC screen cannot set them. Phase 3, with add-prove-drop.

-- Find the lines that would be affected if you set a tolerance:
--   select po.po_number, p.item_code, p.qty, p.received_qty, p.over_delivery_tol_pct
--     from po_items p join purchase_orders po on po.id = p.po_id
--    where p.received_qty < p.qty and po.status in ('placed','partially_received');

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- ⛔ PHASE 3 ONLY — NOT RUN BY THIS FILE. DO NOT PASTE THIS WITHOUT READING.
--
-- Needed ONLY to support "keep the extra 110". The default path (refuse the
-- excess into rejected_qty) never needs it, because accepted_qty stays at 100
-- and that is all confirm_grn ever adds to po_items.received_qty.
--
-- Postgres cannot alter a CHECK in place, so this is a DROP followed by an ADD.
-- It removes a RULE, not data: no row is read or written, and the replacement is
-- LOOSER than the constraint it replaces, so it cannot fail validation against
-- any of the 5,268 existing rows (a tighter constraint could; a looser one never
-- does). Run inside a transaction so a failure leaves the old rule in place.
--
-- It must ship together with the matching confirm_grn change, or the function
-- will still refuse the over-receipt that the constraint now permits.
--
-- begin;
--   alter table public.po_items drop constraint if exists chk_po_received_qty;
--   alter table public.po_items add constraint chk_po_received_qty check (
--     received_qty <= case
--       when over_delivery_unlimited then received_qty        -- always true
--       else qty * (1 + coalesce(over_delivery_tol_pct, 0) / 100.0)
--     end);
-- commit;
--
-- Prove it did not break anything before committing:
--   select count(*) as rows_violating_the_new_rule from po_items
--    where not (received_qty <= case when over_delivery_unlimited then received_qty
--               else qty * (1 + coalesce(over_delivery_tol_pct,0)/100.0) end);
--   -- must be 0
-- ═══════════════════════════════════════════════════════════════════════════
