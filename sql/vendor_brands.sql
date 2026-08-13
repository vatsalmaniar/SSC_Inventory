-- ============================================================================
-- VENDOR BRANDS + PREFERRED SOURCE  (2026-08-13)
-- ============================================================================
-- Which brands a vendor supplies us, and whether we buy that brand DIRECT from
-- them. Additive: one new table, one nullable column on purchase_orders.
--
-- WHY: SSC buys the same brand from the principal and from a tail of traders —
-- Connectwell from CONNECTWELL INDUSTRIES plus nine others, Mitsubishi from
-- MITSUBISHI ELECTRIC INDIA plus five. Nothing recorded which was which, so
-- nothing could tell a buyer they were about to raise a PO on a trader when a
-- direct source exists.
--
-- PREFERRED = we buy this brand direct from the principal. NOT a ranking, and
-- deliberately NOT unique per brand: nVent has two Indian entities and both are
-- direct sources, so a unique index would have been wrong. Confirmed with the
-- user 2026-08-13.
-- ============================================================================

create table if not exists public.vendor_brands (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors(id) on delete cascade,
  brand        text not null,
  is_preferred boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id),
  unique (vendor_id, brand)
);

-- "who supplies brand X" is the question the PO form asks on every keystroke.
create index if not exists ix_vendor_brands_brand on public.vendor_brands (brand);

alter table public.vendor_brands enable row level security;
do $$ begin
  -- Readable by any signed-in user: the New PO check must work for every buyer,
  -- and "who supplies this brand" is not commercially sensitive on its own.
  if not exists (select 1 from pg_policy where polname='vb_read') then
    create policy vb_read on public.vendor_brands for select using (auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policy where polname='vb_write') then
    create policy vb_write on public.vendor_brands for all
      using      (expense_role() = any (array['admin','management','ops']))
      with check (expense_role() = any (array['admin','management','ops']));
  end if;
end $$;

drop trigger if exists trg_audit_cols on public.vendor_brands;
create trigger trg_audit_cols before insert or update on public.vendor_brands
  for each row execute function set_audit_cols();

-- ── The stated reason ───────────────────────────────────────────────────────
-- Same treatment as an order below Rs 8,000: allowed, but explained. Advisory
-- by design — a buyer who genuinely needs to go to a trader (principal out of
-- stock, urgent requirement) must never be BLOCKED, because a PO that cannot be
-- raised in the system gets raised outside it.
alter table public.purchase_orders
  add column if not exists non_preferred_reason text;
comment on column public.purchase_orders.non_preferred_reason is
  'Why this PO went to a vendor that is not a recorded/direct source for one of its brands. Captured at entry (minimum 7 words). NULL when every brand is on a preferred vendor, or when the brand has no principal recorded.';

-- ── Seed, from actual purchase history ──────────────────────────────────────
-- 58 vendor-brand pairs derived from every non-cancelled PO ever raised, with
-- 18 marked preferred. Typing them by hand would have been 58 chances to miss
-- one, and the history is the most reliable statement of who actually supplies
-- what. Principals were confirmed brand by brand with the user; the rule was
-- "the company we buy direct from is preferred, traders are not".
--   (the seed INSERT is intentionally not repeated here — it is one-time data,
--    not schema. See scripts, or re-derive from po_items x items.brand.)


-- ── Appended 2026-08-13: the rule itself, and the approval gate ─────────────
-- (full text applied to production; see vendor_brand_flags / po_brand_flags /
--  po_require_non_preferred_reason.)
--
-- vendor_brand_flags(vendor_id, item_codes[]) is THE definition. The React form
-- calls it over RPC for its live warning and the trigger calls it to gate
-- approval, so the two can never drift — which is the whole reason it lives in
-- SQL rather than in the form.
--
-- The gate is at APPROVAL, not at entry: a buyer must always be able to record
-- what they did, or the purchase happens outside the system and both the reason
-- and the record are lost. An approver waving something through unexplained is
-- the actual risk.
--
-- Measured before it was created (FY 2026-27): 1,159 POs, 63 (5.4%) would need
-- a reason, 0 currently-unapproved POs blocked. Verified by rolled-back
-- transaction: no reason BLOCKED, short reason BLOCKED, proper reason ALLOWED,
-- and the same PO on the principal approves with no reason at all.
