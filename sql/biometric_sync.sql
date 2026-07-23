-- ─────────────────────────────────────────────────────────────
-- Biometric ingest (eSSL / eTimeTrackLite → app). ADDITIVE ONLY.
-- Nothing existing is modified or dropped. Safe to re-run.
-- The connector reads eTimeTrackLite's SQL Server DB (read-only)
-- and POSTs punches to the essl-sync Edge Function, which inserts
-- here with method='biometric' (already an allowed method).
-- ─────────────────────────────────────────────────────────────

-- 1) idempotency key on punches (nullable → existing rows untouched)
alter table public.attendance_punches add column if not exists external_ref text;
create unique index if not exists uq_punch_external_ref
  on public.attendance_punches (external_ref) where external_ref is not null;

-- 2) eSSL location name → office map (drives location tagging)
create table if not exists public.essl_location_map (
  essl_location text primary key,
  office_id     uuid references public.office_locations(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.essl_location_map enable row level security;
drop policy if exists esslmap_read  on public.essl_location_map;
drop policy if exists esslmap_admin on public.essl_location_map;
create policy esslmap_read  on public.essl_location_map for select using (auth.uid() is not null);
create policy esslmap_admin on public.essl_location_map for all
  using      (public.expense_role() = any(array['admin','management']))
  with check (public.expense_role() = any(array['admin','management']));

-- seed (BEST GUESS — confirm Ahmedabad vs Sarkhej; Baroda→Godawari is certain)
insert into public.essl_location_map (essl_location, office_id) values
  ('Baroda',    (select id from public.office_locations where branch='FC Godawari')),
  ('Ahmedabad', (select id from public.office_locations where branch='Ahmedabad')),
  ('Sarkhej',   (select id from public.office_locations where branch='FC Kaveri'))
on conflict (essl_location) do nothing;

-- 3) connector sync watermark (so it resumes after Sunday-off / outages)
create table if not exists public.biometric_sync_state (
  source          text primary key,          -- 'essl-etimetracklite'
  last_external_ref text,
  last_punch_at   timestamptz,
  last_run_at     timestamptz,
  rows_ingested   bigint not null default 0,
  updated_at      timestamptz not null default now()
);
alter table public.biometric_sync_state enable row level security;
drop policy if exists syncstate_admin on public.biometric_sync_state;
create policy syncstate_admin on public.biometric_sync_state for all
  using      (public.expense_role() = any(array['admin','management']))
  with check (public.expense_role() = any(array['admin','management']));
