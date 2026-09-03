-- Week-off overrides — APPLIED LIVE 2026-09-03
--
-- The engine hardcodes Sundays + 2nd/4th Saturdays as week-offs (attendance.js isWeekOff).
-- Reality shifts: 22 Aug 2026 (4th Sat) was worked and 29 Aug (a working Sat) was given
-- off in exchange. Without a record of that swap, 22 Aug scores everyone week-off (a
-- worked day uncounted) and 29 Aug scores no-punchers absent + LOP (an off day docked).
--
-- One row per exceptional date. is_weekoff=false = "this off day was worked",
-- is_weekoff=true = "this working day was given off". Read by every page that judges a
-- day (Muster / My Attendance / dashboard / Leave day-count) via loadWeekOffOverrides().

create table if not exists attendance_weekoff_overrides (
  work_date  date primary key,
  is_weekoff boolean not null,
  note       text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table attendance_weekoff_overrides enable row level security;

-- Everyone signed in may read (their own attendance/leave math depends on it);
-- only admin/management may declare a swap.
drop policy if exists wo_read on attendance_weekoff_overrides;
create policy wo_read on attendance_weekoff_overrides
  for select to authenticated using (true);
drop policy if exists wo_write on attendance_weekoff_overrides;
create policy wo_write on attendance_weekoff_overrides
  for all to authenticated
  using (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));
revoke all on attendance_weekoff_overrides from anon;

insert into attendance_weekoff_overrides (work_date, is_weekoff, note) values
  ('2026-08-22', false, 'Worked — weekly off shifted to 29 Aug'),
  ('2026-08-29', true,  'Weekly off — shifted from 22 Aug')
on conflict (work_date) do nothing;
