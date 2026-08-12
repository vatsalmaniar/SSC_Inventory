-- ============================================================================
-- ITEM PRICING — HARDENING  (2026-08-12)
-- ============================================================================
-- Applied on top of item_pricing_baseline.sql. Every change here is ADDITIVE:
-- new nullable columns, new defaults chosen so existing rows keep their current
-- meaning, and one index replaced by a wider version of itself. No data is
-- deleted, no column is dropped or renamed.
--
-- Measured before writing this (production, read-only):
--   item_prices          902 rows, ALL price_type='LIST', ALL open-ended
--   overlapping records    0  (nothing to clean up before the new constraint)
--   PURCHASE / SALES rows  0  (no special price has ever been entered)
-- So every constraint below creates clean and blocks nothing that exists.
--
-- What it fixes, in order:
--   1. a PO line could not say where its price came from
--   2. `approved_by` recorded the person who TYPED the price
--   3. two overlapping records could both be eligible, with no defined winner
--   4. a purchase price could not be tied to the vendor it was negotiated with
-- ============================================================================

begin;

-- ── 1 · PO LINE PROVENANCE ──────────────────────────────────────────────────
-- A PO line used to store lp_unit_price / discount_pct / unit_price and nothing
-- about WHY. Months later there was no way to tell a resolved price from a
-- hand-typed one, or to find the record behind it. SAP copies the condition
-- record onto the document line for exactly this reason.
--
-- Existing rows stay NULL — honestly "unknown, raised before provenance". They
-- are deliberately NOT back-filled: inventing a source would be worse than
-- admitting we don't have one.
alter table public.po_items
  add column if not exists price_source        text
    check (price_source in ('PROJECT','CUSTOMER','STOCK','STANDARD','MANUAL')),
  add column if not exists price_record_id     uuid references public.item_prices(id),
  add column if not exists list_price_at_entry numeric,
  add column if not exists price_resolved_at   timestamptz,
  -- TRUE when the buyer typed over a price the system had resolved. Recorded,
  -- never blocked: a vendor giving a one-off rate on the phone is normal, and
  -- a PO that cannot be raised moves to Excel. Visible on the PO instead.
  add column if not exists price_overridden    boolean not null default false;

comment on column public.po_items.price_source is
  'Where this line''s price came from at entry: the winning scope, or MANUAL when the buyer typed it. NULL = raised before provenance was recorded.';
comment on column public.po_items.price_overridden is
  'The system resolved a price and the buyer changed it. Advisory — never blocks.';

-- ── 2 · REAL APPROVAL ON A PRICE RECORD ─────────────────────────────────────
-- `approved_by` was written with the session of whoever filled in the drawer,
-- so every price recorded itself as approved by its own author. That column is
-- LEFT IN PLACE and simply stops being written; these replace it.
alter table public.item_prices
  add column if not exists price_status     text not null default 'approved'
    check (price_status in ('pending','approved','superseded')),
  add column if not exists approved_by_user uuid references auth.users(id),
  add column if not exists approved_at      timestamptz,
  add column if not exists superseded_by    uuid references public.item_prices(id);

-- Default 'approved' is what keeps this additive: the 902 LIST rows came from a
-- published price book and are approved by publication. It is the NEGOTIATED
-- prices (PURCHASE / SALES) that need a second person, and there are none yet.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_prices_approval_shape') then
    alter table public.item_prices add constraint item_prices_approval_shape check (
      price_type = 'LIST'                       -- book prices: no approver needed
      or price_status <> 'approved'
      -- Four eyes. created_by must be present too: `approved_by_user is
      -- distinct from created_by` would silently PASS when created_by is null,
      -- which is exactly the case for a row written outside a user session.
      or (created_by is not null
          and approved_by_user is not null
          and approved_by_user <> created_by)
    );
  end if;
end $$;

-- ── 3 · VENDOR DIMENSION ────────────────────────────────────────────────────
-- A purchase price is something a particular VENDOR gives us. Until now it
-- could only be scoped by our own customer, so the same number applied no
-- matter who the PO was raised on.
--
-- NULL means "any vendor", which is exactly how every existing row behaves, so
-- nothing changes until someone deliberately records a vendor-specific rate.
alter table public.item_prices
  add column if not exists vendor_id uuid references public.vendors(id);

comment on column public.item_prices.vendor_id is
  'Vendor this rate was negotiated with. NULL = applies to any vendor (the behaviour of every row created before 2026-08-12).';

-- The open-record uniqueness must now allow the SAME item at different rates
-- from different vendors. Index-only change: no data is touched, and the new
-- index is strictly wider than the one it replaces.
drop index if exists public.uq_item_price_open;
create unique index uq_item_price_open on public.item_prices (
  item_code, price_type,
  coalesce(price_scope, 'LIST'),
  coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(vendor_id,   '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(project_ref, ''),
  min_qty
) where valid_to is null;

-- ── 4 · NO OVERLAPPING RECORDS ──────────────────────────────────────────────
-- uq_item_price_open only ever covered records with no end date. Two records
-- whose windows OVERLAP (Apr→Dec, and Aug→open) were both eligible today, rank
-- identically, and the winner came down to physical row order — which can
-- change after a vacuum. Two buyers could get two prices on the same afternoon.
--
-- Measured: 0 overlapping pairs exist today, so this creates clean.
create extension if not exists btree_gist;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_prices_no_overlap') then
    alter table public.item_prices add constraint item_prices_no_overlap
      exclude using gist (
        item_code with =,
        price_type with =,
        (coalesce(price_scope, 'LIST')) with =,
        (coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
        (coalesce(vendor_id,   '00000000-0000-0000-0000-000000000000'::uuid)) with =,
        (coalesce(project_ref, '')) with =,
        min_qty with =,
        daterange(valid_from, coalesce(valid_to, 'infinity'::date), '[]') with &&
      )
      -- Superseded history must be allowed to overlap freely; only records that
      -- can actually WIN a resolution are constrained.
      where (price_status = 'approved');
  end if;
end $$;

-- ── 5 · SUPERSEDE, ATOMICALLY ───────────────────────────────────────────────
-- The constraint above makes "just add the new rate" fail, correctly. Without a
-- supported way to replace a price, that reads as a bug to whoever hits it
-- mid-negotiation. This closes the old record and opens the new one in ONE
-- transaction, so the two can never be half-applied.
create or replace function public.supersede_item_price(
  p_old_id     uuid,
  p_amount     numeric,
  p_valid_from date,
  p_valid_to   date default null,
  p_notes      text default null
) returns uuid
language plpgsql
security invoker            -- the caller's RLS decides; this is not a back door
set search_path = public
as $$
declare v_old public.item_prices; v_new_id uuid;
begin
  select * into v_old from public.item_prices where id = p_old_id for update;
  if not found then raise exception 'price record % not found', p_old_id; end if;
  if p_valid_from <= v_old.valid_from then
    raise exception 'the new price must start after the one it replaces (% starts %)',
      p_old_id, v_old.valid_from;
  end if;

  update public.item_prices
     set valid_to = p_valid_from - 1,
         price_status = 'superseded',
         updated_at = now()
   where id = p_old_id;

  insert into public.item_prices (
    item_code, price_type, price_list_id, discount_group_id, customer_id,
    vendor_id, amount, currency, uom, project_ref, valid_from, valid_to,
    min_qty, price_scope, notes, price_status
  ) values (
    v_old.item_code, v_old.price_type, v_old.price_list_id, v_old.discount_group_id,
    v_old.customer_id, v_old.vendor_id, p_amount, v_old.currency, v_old.uom,
    v_old.project_ref, p_valid_from, p_valid_to, v_old.min_qty, v_old.price_scope,
    coalesce(p_notes, 'Supersedes ' || p_old_id::text),
    -- A replacement price is a NEW negotiation and needs approving on its own
    -- merits. It must not inherit the old record's approval.
    case when v_old.price_type = 'LIST' then 'approved' else 'pending' end
  ) returning id into v_new_id;

  update public.item_prices set superseded_by = v_new_id where id = p_old_id;
  return v_new_id;
end $$;

revoke all on function public.supersede_item_price(uuid, numeric, date, date, text) from public;
grant execute on function public.supersede_item_price(uuid, numeric, date, date, text) to authenticated;

commit;
