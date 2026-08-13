-- ============================================================================
-- SPECIAL PRICE AGREEMENTS  (2026-08-13)
-- ============================================================================
-- Applied on top of item_pricing_baseline.sql + item_pricing_hardening.sql.
-- Additive: one new table, two nullable columns, two indexes, three functions.
-- Nothing existing is altered or back-filled.
--
-- WHY: a negotiated rate was a loose row in item_prices with no document
-- identity. "The EIT April 2026 agreement" existed only inside a spreadsheet on
-- one laptop. You could see WHAT we pay but not what it belonged to, when it
-- was agreed, who agreed it, or which purchase orders had used it.
--
-- An SPA is that document, numbered like every other document in the system
-- (SSC/SPA0001/26-27) and immutable once issued.
--
-- A published price book or a vendor scheme flyer is NOT an SPA — that is a
-- price_lists row. An SPA is something two parties negotiated.
-- ============================================================================

begin;

-- ── SPECIAL PRICE AGREEMENTS ────────────────────────────────────────────────
-- A negotiated rate used to be a loose row in item_prices with no document
-- identity: "the EIT April 2026 agreement" existed only in a spreadsheet. You
-- could see a price but not what it belonged to, when it was agreed, or which
-- POs and orders had used it.
--
-- An SPA is that document. One number covers BOTH legs — what we pay and what
-- the customer pays — because they were agreed together and must be superseded
-- together. The legs stay separate RECORDS (item_prices rows) so either can be
-- re-negotiated on its own, but they share one agreement.
--
-- A published price book or vendor scheme flyer is NOT an SPA; that is a
-- price_list. An SPA is something two parties agreed.
create table if not exists public.special_price_agreements (
  id                uuid primary key default gen_random_uuid(),
  spa_no            text not null unique,
  title             text not null,
  counterparty_type text not null check (counterparty_type in ('CUSTOMER','VENDOR')),
  customer_id       uuid references public.customers(id),
  vendor_id         uuid references public.vendors(id),
  reference         text,                -- their PO / quote reference
  valid_from        date not null,
  valid_to          date,
  status            text not null default 'draft'
                      check (status in ('draft','approved','superseded','cancelled')),
  source_file       text,
  notes             text,
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  superseded_by     uuid references public.special_price_agreements(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id),
  -- The counterparty must actually be there. Without this an agreement could
  -- name a customer type and carry no customer, and every rate under it would
  -- apply to everyone.
  constraint spa_counterparty_shape check (
    (counterparty_type = 'CUSTOMER' and customer_id is not null)
    or (counterparty_type = 'VENDOR' and vendor_id is not null)
  ),
  constraint spa_dates check (valid_to is null or valid_to >= valid_from)
);

alter table public.item_prices
  add column if not exists spa_id uuid references public.special_price_agreements(id);

-- Stamped on the PO line, not derived. The document must still explain itself
-- years later even if the agreement is superseded — same reason
-- list_price_at_entry is stored rather than looked up.
alter table public.po_items add column if not exists spa_no text;

create index if not exists ix_item_prices_spa on public.item_prices (spa_id);
create index if not exists ix_po_items_spa    on public.po_items (spa_no);

alter table public.special_price_agreements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='spa_read') then
    create policy spa_read on public.special_price_agreements for select
      using (expense_role() = any (array['admin','management','ops','accounts']));
  end if;
  if not exists (select 1 from pg_policy where polname='spa_write') then
    create policy spa_write on public.special_price_agreements for all
      using      (expense_role() = any (array['admin','management']))
      with check (expense_role() = any (array['admin','management']));
  end if;
end $$;

drop trigger if exists trg_audit_cols on public.special_price_agreements;
create trigger trg_audit_cols before insert or update on public.special_price_agreements
  for each row execute function set_audit_cols();

-- SSC/SPA0001/26-27 — same shape and same immutability as po_number.
create or replace function public.next_spa_no() returns text
language plpgsql security invoker set search_path = public as $$
declare fy text; n int;
begin
  fy := case when extract(month from current_date) >= 4
             then to_char(current_date,'YY') || '-' || to_char(current_date + interval '1 year','YY')
             else to_char(current_date - interval '1 year','YY') || '-' || to_char(current_date,'YY') end;
  perform pg_advisory_xact_lock(hashtext('spa_no'));   -- two people, one number
  select coalesce(max((regexp_match(spa_no,'SPA(\d+)'))[1]::int),0) + 1 into n
  from special_price_agreements where spa_no like '%/' || fy;
  return 'SSC/SPA' || lpad(n::text,4,'0') || '/' || fy;
end $$;

create or replace function public.spa_no_immutable() returns trigger
language plpgsql as $$
begin
  if new.spa_no is distinct from old.spa_no then
    raise exception 'spa_no is immutable (% -> %)', old.spa_no, new.spa_no;
  end if;
  return new;
end $$;
drop trigger if exists trg_spa_no_immutable on public.special_price_agreements;
create trigger trg_spa_no_immutable before update on public.special_price_agreements
  for each row execute function spa_no_immutable();

-- Approving the AGREEMENT approves its rates, in one transaction. Otherwise a
-- 50-record agreement means 50 separate approvals and someone will stop halfway,
-- leaving the buy leg live and the sell leg pending.
create or replace function public.approve_spa(p_spa_id uuid)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_me uuid := auth.uid(); v_creator uuid; v_n int;
begin
  select created_by into v_creator from special_price_agreements where id = p_spa_id for update;
  if not found then raise exception 'agreement % not found', p_spa_id; end if;
  if v_creator is not null and v_creator = v_me then
    raise exception 'you entered this agreement - someone else has to approve it';
  end if;
  update special_price_agreements
     set status='approved', approved_by=v_me, approved_at=now() where id=p_spa_id;
  update item_prices set price_status='approved', approved_by_user=v_me, approved_at=now()
   where spa_id = p_spa_id and price_status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.approve_spa(uuid) from public;
grant execute on function public.approve_spa(uuid) to authenticated;

commit;

-- ── As-built note ───────────────────────────────────────────────────────────
-- First two agreements, both created 2026-08-13:
--   SSC/SPA0001/26-27  EIT Automation Pvt Ltd (CUSTOMER) — 23 items, both legs
--                      (23 PURCHASE locked to Connectwell + 23 SALES) from
--                      "EIT Automation - CW discount.xlsx", ref EAPL/26-27/PO-46
--   SSC/SPA0002/26-27  Connectwell direct (VENDOR) — the 8-channel relay card
--                      at 5,000 qty
-- Both left in 'draft': approve_spa() must be called by someone other than the
-- creator, and until then every rate stays 'pending' and prices nothing.
