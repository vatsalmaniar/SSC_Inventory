-- ============================================================================
-- ITEM PRICING — AS-BUILT BASELINE  (recorded 2026-08-12)
-- ============================================================================
-- These objects were created directly against production while the Mitsubishi
-- FA / LVS and nVent Hoffman price books were being loaded, and existed ONLY
-- in the database — there was no migration file for them, so nothing about the
-- pricing schema was reviewable or rebuildable. This file is that record,
-- transcribed from the live catalogue (information_schema, pg_constraint,
-- pg_indexes, pg_policy, pg_get_viewdef).
--
-- It is IDEMPOTENT and safe to re-run: it creates only what is missing. On the
-- production database every statement here is already satisfied — running it
-- changes nothing. Its job is to make the schema readable in the repo and
-- reproducible on a fresh database.
--
-- Changes made AFTER this baseline live in item_pricing_hardening.sql.
--
-- Model, in one line: a price is a DATED RECORD, never an overwritten field.
-- ============================================================================

-- ── price_lists — one published book (Mitsubishi FA FY26, LVS, Hoffman Aug-26)
create table if not exists public.price_lists (
  id           uuid primary key default gen_random_uuid(),
  brand        text not null,
  name         text not null,
  version      text,
  currency     char(3) not null default 'INR',
  valid_from   date not null,
  valid_to     date,
  source_file  text,
  status       text not null default 'active'
                 check (status in ('draft','active','superseded')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_by   uuid references auth.users(id)
);

-- Only one OPEN-ENDED book per brand+name. A superseding edition must close the
-- previous one (valid_to) rather than sit alongside it.
create unique index if not exists uq_price_list_open
  on public.price_lists (brand, name) where valid_to is null;

-- ── price_discount_groups — our partner discount per product group ──────────
-- "Progressive Partner" is SSC's tier with Mitsubishi. The discount belongs to
-- the GROUP (e.g. "Servo - All Series"), not to the part, which is exactly how
-- the vendor publishes it.
create table if not exists public.price_discount_groups (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  code          text not null,
  name          text not null,
  partner_tier  text not null default 'Progressive',
  discount_pct  numeric not null check (discount_pct >= 0 and discount_pct < 100),
  valid_from    date not null,
  valid_to      date,
  source        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create unique index if not exists uq_disc_group_open
  on public.price_discount_groups (brand, code, partner_tier) where valid_to is null;

-- ── item_prices — every price we hold, of any kind ──────────────────────────
--   price_type  LIST      the published list price (what the book says)
--               PURCHASE  what WE pay          → drives New PO / Forecast PO
--               SALES     what the customer pays (recorded for margin only;
--                         sales documents do NOT auto-price from it)
--   price_scope null      a LIST row — belongs to the book, not to anyone
--               CUSTOMER  negotiated for one customer
--               PROJECT   negotiated for one customer on one project
--               STOCK     blanket: every customer AND our own stock buys
--   min_qty     quantity break. The highest rung the line reaches wins.
create table if not exists public.item_prices (
  id                uuid primary key default gen_random_uuid(),
  item_code         text not null references public.items(item_code) on update cascade,
  price_type        text not null default 'LIST'
                      check (price_type in ('LIST','PURCHASE','SALES')),
  price_list_id     uuid references public.price_lists(id),
  discount_group_id uuid references public.price_discount_groups(id),
  customer_id       uuid references public.customers(id),
  model_as_printed  text,          -- the code exactly as the book prints it
  amount            numeric not null check (amount >= 0),
  currency          char(3) not null default 'INR',
  uom               text not null default 'NOS',
  stock_indicator   text check (stock_indicator in ('Stock','Non Stock')),
  page_ref          integer,       -- page of the source PDF, for disputes
  project_ref       text,
  approved_by       uuid references auth.users(id),
  valid_from        date not null,
  valid_to          date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  price_scope       text check (price_scope in ('CUSTOMER','PROJECT','STOCK')),
  min_qty           integer not null default 1 check (min_qty >= 1),

  -- A scope is only meaningful with the fields it needs. Without this a
  -- CUSTOMER price with no customer would silently apply to everyone.
  constraint item_prices_scope_shape check (
    price_type = 'LIST'
    or (price_scope = 'CUSTOMER' and customer_id is not null)
    or (price_scope = 'PROJECT'  and customer_id is not null and project_ref is not null)
    or (price_scope = 'STOCK'    and customer_id is null)
  )
);

create index if not exists ix_item_prices_item on public.item_prices (item_code);

-- At most one OPEN record per (item, type, scope, customer, project, rung).
-- Re-pricing means closing the old record, not adding a second live one.
-- NOTE: this does not stop two records whose windows merely OVERLAP (one
-- closed, one open) — that gap is closed in item_pricing_hardening.sql.
create unique index if not exists uq_item_price_open
  on public.item_prices (
    item_code, price_type,
    coalesce(price_scope, 'LIST'),
    coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(project_ref, ''),
    min_qty
  ) where valid_to is null;

-- ── RLS — the ONLY thing keeping purchase prices from sales ─────────────────
-- /items/:id has no route guard, so a salesperson can open any item page. The
-- Commercials tab renders nothing because these policies return no rows. If
-- these are ever relaxed, the whole purchase-price book is exposed.
alter table public.item_prices           enable row level security;
alter table public.price_lists           enable row level security;
alter table public.price_discount_groups enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'comm_read_ip') then
    create policy comm_read_ip on public.item_prices for select
      using (expense_role() = any (array['admin','management','ops','accounts']));
  end if;
  if not exists (select 1 from pg_policy where polname = 'comm_write_ip') then
    create policy comm_write_ip on public.item_prices for all
      using       (expense_role() = any (array['admin','management']))
      with check  (expense_role() = any (array['admin','management']));
  end if;
end $$;

-- ── v_item_commercials — today's list price + today's partner discount ──────
-- security_invoker so the caller's RLS applies; without it the view would be a
-- hole straight through the policies above.
--
-- Two deliberate details:
--   • The discount is re-read LIVE by (brand, code, tier) rather than through
--     the discount_group_id captured on the price row, so a re-negotiated tier
--     applies without rewriting 902 price rows.
--   • distinct on (...) order by valid_from desc → the most recently effective
--     list price wins when a book is superseded mid-year.
create or replace view public.v_item_commercials
with (security_invoker = true) as
select distinct on (ip.item_code, ip.price_type)
  ip.item_code,
  ip.amount            as list_price,
  ip.currency,
  ip.stock_indicator,
  ip.model_as_printed,
  ip.page_ref,
  ip.min_qty,
  ip.valid_from        as price_valid_from,
  pl.name || coalesce(' v' || pl.version, '') as price_source,
  dg.code              as discount_group_code,
  dg.name              as discount_group,
  dg.discount_pct      as standard_discount_pct,
  case when dg.discount_pct is null then null
       else round(ip.amount * (1 - dg.discount_pct / 100), 2) end as standard_purchase_price
from public.item_prices ip
left join public.price_lists pl on pl.id = ip.price_list_id
left join public.price_discount_groups captured on captured.id = ip.discount_group_id
left join lateral (
  select g.* from public.price_discount_groups g
  where g.brand = captured.brand
    and g.code  = captured.code
    and g.partner_tier = captured.partner_tier
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
  order by g.valid_from desc
  limit 1
) dg on true
where ip.price_type = 'LIST'
  and ip.valid_from <= current_date
  and (ip.valid_to is null or ip.valid_to >= current_date)
order by ip.item_code, ip.price_type, ip.valid_from desc;

-- ── As-built row counts at the time this file was written ───────────────────
--   price_lists              3
--   price_discount_groups   26
--   item_prices            902   — ALL price_type = 'LIST', all open-ended.
--                                  Zero PURCHASE and zero SALES rows: no
--                                  special price has ever been entered.
--   items                9,832   — 1,145 with a description
