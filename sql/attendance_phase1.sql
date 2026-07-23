-- Attendance module — Phase 1 schema (ADDITIVE). Micro-safe: no cron, on-demand day-close.
-- Reuses employees (roster), employees.reporting_manager_id (approvals),
-- employee_private.date_of_birth (birthday rule), employees.branch (geofence).
-- RLS mirrors the app: own row (via employees.profile_id = auth.uid()),
-- manager sees their reports, admin/management see all. Audit + search_path pinned.

-- ── helpers ──────────────────────────────────────────────
create or replace function public.my_employee_id() returns uuid
  language sql stable security definer set search_path=public as $$
  select id from public.employees where profile_id = auth.uid() limit 1 $$;
grant execute on function public.my_employee_id() to authenticated;

create or replace function public.att_can_see(emp uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select public.expense_role() = any(array['admin','management'])         -- HR/admin see all
      or emp = public.my_employee_id()                                     -- self
      or exists (select 1 from public.employees e                          -- direct manager
                 where e.id = emp and e.reporting_manager_id = public.my_employee_id())
$$;
grant execute on function public.att_can_see(uuid) to authenticated;

-- ── config (single row) ──────────────────────────────────
create table if not exists public.attendance_config (
  id                 boolean primary key default true check (id),
  office_start       time not null default '10:00',
  grace_until        time not null default '10:15',   -- <= grace = on time
  half_day_cutoff    time not null default '14:30',    -- after this arrival = absent
  office_end         time not null default '18:30',
  birthday_leave_at  time not null default '17:00',    -- may leave by 5pm on birthday
  annual_leave_quota numeric not null default 25,
  max_carry_forward  numeric not null default 5,
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into public.attendance_config (id) values (true) on conflict (id) do nothing;
alter table public.attendance_config enable row level security;
drop policy if exists att_cfg_read on public.attendance_config;
drop policy if exists att_cfg_write on public.attendance_config;
create policy att_cfg_read  on public.attendance_config for select using (auth.uid() is not null);
create policy att_cfg_write on public.attendance_config for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── office locations (geofence) ──────────────────────────
create table if not exists public.office_locations (
  id uuid primary key default gen_random_uuid(),
  branch text not null, lat numeric, lng numeric, radius_m int not null default 150,
  is_active boolean not null default true, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into public.office_locations (branch) values ('Ahmedabad'),('FC Kaveri'),('FC Godawari')
  on conflict do nothing;   -- lat/lng to be set by admin in Config
alter table public.office_locations enable row level security;
drop policy if exists office_read on public.office_locations;
drop policy if exists office_write on public.office_locations;
create policy office_read  on public.office_locations for select using (auth.uid() is not null);
create policy office_write on public.office_locations for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── holidays (actual public holidays; weekly offs computed in code) ──
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique, name text not null, is_active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now()
);
alter table public.holidays enable row level security;
drop policy if exists hol_read on public.holidays;
drop policy if exists hol_write on public.holidays;
create policy hol_read  on public.holidays for select using (auth.uid() is not null);
create policy hol_write on public.holidays for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── punches ──────────────────────────────────────────────
create table if not exists public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  punch_at timestamptz not null default now(),
  direction text not null check (direction in ('in','out')),
  method text not null default 'web' check (method in ('web','mobile','biometric','manual')),
  lat numeric, lng numeric, accuracy_m numeric, within_geofence boolean, office_id uuid,
  ip text, note text, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_punch_emp_at on public.attendance_punches(employee_id, punch_at);
alter table public.attendance_punches enable row level security;
drop policy if exists punch_read on public.attendance_punches;
drop policy if exists punch_ins  on public.attendance_punches;
drop policy if exists punch_admin on public.attendance_punches;
create policy punch_read on public.attendance_punches for select using (public.att_can_see(employee_id));
create policy punch_ins  on public.attendance_punches for insert with check (employee_id = public.my_employee_id());  -- only punch for yourself
create policy punch_admin on public.attendance_punches for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── computed day (on-demand close) ───────────────────────
create table if not exists public.attendance_days (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  first_in timestamptz, last_out timestamptz, worked_minutes int,
  status text not null default 'absent'
    check (status in ('present','half_day','absent','leave','holiday','weekoff','lop')),
  late_minutes int default 0, early_minutes int default 0, ot_minutes int default 0,
  leave_deducted numeric default 0, is_lop boolean default false, is_regularized boolean default false,
  notes text, computed_at timestamptz, created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists idx_day_emp_date on public.attendance_days(employee_id, work_date);
alter table public.attendance_days enable row level security;
drop policy if exists day_read on public.attendance_days;
drop policy if exists day_write on public.attendance_days;
create policy day_read  on public.attendance_days for select using (public.att_can_see(employee_id));
create policy day_write on public.attendance_days for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── leave balances (25 upfront per FY) ───────────────────
create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  fy_label text not null,
  credited numeric not null default 25, carried_forward numeric not null default 0,
  used numeric not null default 0, encashed numeric not null default 0,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (employee_id, fy_label)
);
alter table public.leave_balances enable row level security;
drop policy if exists lb_read on public.leave_balances;
drop policy if exists lb_write on public.leave_balances;
create policy lb_read  on public.leave_balances for select using (public.att_can_see(employee_id));
create policy lb_write on public.leave_balances for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));
-- seed 25 upfront for FY 26-27 for every active employee
insert into public.leave_balances (employee_id, fy_label, credited)
select id, '26-27', 25 from public.employees where lifecycle_status <> 'exited'
on conflict (employee_id, fy_label) do nothing;

-- ── leave requests (2-step: manager -> HR/Ankit) ─────────
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_date date not null, to_date date not null, days numeric not null,
  is_half_day boolean not null default false, half_period text check (half_period in ('first','second')),
  reason text, status text not null default 'pending'
    check (status in ('pending','mgr_approved','approved','rejected','cancelled')),
  mgr_approver uuid, mgr_at timestamptz, hr_approver uuid, hr_at timestamptz, decision_note text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists idx_lr_emp on public.leave_requests(employee_id);
alter table public.leave_requests enable row level security;
drop policy if exists lr_read on public.leave_requests;
drop policy if exists lr_ins  on public.leave_requests;
drop policy if exists lr_admin on public.leave_requests;
create policy lr_read on public.leave_requests for select using (public.att_can_see(employee_id));
create policy lr_ins  on public.leave_requests for insert with check (employee_id = public.my_employee_id());
create policy lr_admin on public.leave_requests for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── regularizations (missed punch fixes; 2-step approval) ─
create table if not exists public.regularizations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null, requested_in time, requested_out time, reason text,
  status text not null default 'pending' check (status in ('pending','mgr_approved','approved','rejected','cancelled')),
  mgr_approver uuid, mgr_at timestamptz, hr_approver uuid, hr_at timestamptz, decision_note text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.regularizations enable row level security;
drop policy if exists reg_read on public.regularizations;
drop policy if exists reg_ins  on public.regularizations;
drop policy if exists reg_admin on public.regularizations;
create policy reg_read on public.regularizations for select using (public.att_can_see(employee_id));
create policy reg_ins  on public.regularizations for insert with check (employee_id = public.my_employee_id());
create policy reg_admin on public.regularizations for all
  using (public.expense_role()=any(array['admin','management'])) with check (public.expense_role()=any(array['admin','management']));

-- ── audit triggers on all new tables ─────────────────────
do $$ declare t text; begin
  foreach t in array array['attendance_config','office_locations','holidays','attendance_punches',
                           'attendance_days','leave_balances','leave_requests','regularizations'] loop
    execute format('drop trigger if exists trg_audit_cols on public.%I', t);
    execute format('create trigger trg_audit_cols before insert or update on public.%I for each row execute function set_audit_cols()', t);
  end loop; end $$;
