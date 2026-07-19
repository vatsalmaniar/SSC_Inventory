-- People Hub — Phase 1 (ADDITIVE ONLY)
-- New tables: employees, assets, asset_assignments.
-- No ALTER / DROP on any existing table. No existing RLS policy touched.
-- RLS mirrors the existing expense_role() pattern:
--   read  = own row OR admin/management ; write = admin/management.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- 1. employees — the person master (login is OPTIONAL via profile_id)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.employees (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid unique references public.profiles(id) on delete set null,  -- null = no login (FC staff)
  employee_code         text unique,
  full_name             text not null,
  designation           text,
  department            text,
  branch                text,
  reporting_manager_id  uuid references public.employees(id) on delete set null,
  date_of_birth         date,
  join_date             date,
  phone                 text,
  personal_email        text,
  emergency_contact     text,
  lifecycle_status      text not null default 'confirmed'
                          check (lifecycle_status in ('probation','confirmed','notice','exited')),
  lifecycle_date        date,
  exit_date             date,
  is_active             boolean not null default true,
  is_test               boolean not null default false,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 2. assets — the register (one row per physical asset)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.assets (
  id           uuid primary key default gen_random_uuid(),
  asset_tag    text not null unique,          -- your internal Asset ID
  asset_type   text not null default 'Laptop'
                 check (asset_type in ('Laptop','Desktop','SIM','Other')),
  make_model   text,
  serial_no    text,
  status       text not null default 'in_use'
                 check (status in ('in_use','spare','retired')),
  notes        text,
  is_test      boolean not null default false,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 3. asset_assignments — the movement log (issue / transfer / return)
--    assigned_to IS NULL  => currently held.  Reason captured on every move.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.asset_assignments (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references public.assets(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  action          text not null default 'issued'
                    check (action in ('issued','transferred','returned')),
  assigned_from   date not null default current_date,
  assigned_to     date,                        -- null = current holder
  reason          text,
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_asset_assign_asset on public.asset_assignments(asset_id);
create index if not exists idx_asset_assign_emp   on public.asset_assignments(employee_id);
-- an asset can have only ONE current (open) holder
create unique index if not exists uq_asset_open_holder
  on public.asset_assignments(asset_id) where assigned_to is null;

-- ─────────────────────────────────────────────────────────────
-- RLS — mirrors expense_role() pattern used across the app
-- ─────────────────────────────────────────────────────────────
alter table public.employees        enable row level security;
alter table public.assets           enable row level security;
alter table public.asset_assignments enable row level security;

drop policy if exists emp_read  on public.employees;
drop policy if exists emp_write on public.employees;
create policy emp_read on public.employees for select using (
  profile_id = auth.uid() or expense_role() = any(array['admin','management'])
);
create policy emp_write on public.employees for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

drop policy if exists asset_read  on public.assets;
drop policy if exists asset_write on public.assets;
create policy asset_read on public.assets for select using (
  expense_role() = any(array['admin','management'])
  or exists (
    select 1 from public.asset_assignments aa
    join public.employees e on e.id = aa.employee_id
    where aa.asset_id = assets.id and aa.assigned_to is null and e.profile_id = auth.uid()
  )
);
create policy asset_write on public.assets for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

drop policy if exists aa_read  on public.asset_assignments;
drop policy if exists aa_write on public.asset_assignments;
create policy aa_read on public.asset_assignments for select using (
  expense_role() = any(array['admin','management'])
  or exists (select 1 from public.employees e
             where e.id = asset_assignments.employee_id and e.profile_id = auth.uid())
);
create policy aa_write on public.asset_assignments for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

-- ─────────────────────────────────────────────────────────────
-- 4. employee_compensation — effective-dated CTC (SENSITIVE)
--    Read = admin/management ONLY (NOT self — salary hidden from the person).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.employee_compensation (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.employees(id) on delete cascade,
  fy_label        text not null,                 -- e.g. '26-27'
  annual_ctc_inr  numeric not null,
  effective_from  date,
  source          text,                          -- 'sheet_26_27' | 'kpi'
  revision_reason text,
  is_current      boolean not null default true,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists idx_comp_emp on public.employee_compensation(employee_id);
-- one current row per (employee, FY)
create unique index if not exists uq_comp_current
  on public.employee_compensation(employee_id, fy_label) where is_current;

alter table public.employee_compensation enable row level security;
drop policy if exists comp_read  on public.employee_compensation;
drop policy if exists comp_write on public.employee_compensation;
create policy comp_read on public.employee_compensation for select
  using (expense_role() = any(array['admin','management']));   -- self CANNOT read salary
create policy comp_write on public.employee_compensation for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

-- NOTE: employee rows are seeded explicitly from the salary workbook in
--       sql/people_hub_seed.sql (generated) — no generic profile backfill,
--       so system accounts (accounts.amd, demo.user) are intentionally excluded.
