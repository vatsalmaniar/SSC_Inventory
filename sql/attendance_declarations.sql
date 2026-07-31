-- ─────────────────────────────────────────────────────────────────────────
-- Special-Day Declarations — bulk attendance status for a location on a date
-- (e.g. rainfall → Work From Home for all Kaveri staff). Overrides only the
-- would-be-absent days; real punches / approved leave still win. Admin/management
-- declare; everyone reads (so it reflects in their own attendance).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.attendance_declarations (
  id          uuid primary key default gen_random_uuid(),
  from_date   date not null,
  to_date     date not null,
  branch      text,                                   -- NULL = all locations
  status      text not null check (status in ('present','wfh','holiday','half_day')),
  reason      text not null,                          -- rainfall | flood | strike | festival | maintenance | other
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (to_date >= from_date)
);

alter table public.attendance_declarations enable row level security;
drop policy if exists decl_read  on public.attendance_declarations;
drop policy if exists decl_write on public.attendance_declarations;
create policy decl_read  on public.attendance_declarations for select using (auth.uid() is not null);
create policy decl_write on public.attendance_declarations for all
  using (public.expense_role() = any(array['admin','management']))
  with check (public.expense_role() = any(array['admin','management']));
grant select, insert, update, delete on public.attendance_declarations to authenticated;

create index if not exists idx_att_decl_dates on public.attendance_declarations (from_date, to_date);
