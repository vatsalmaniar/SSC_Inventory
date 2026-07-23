-- Per-employee shift override. General shift lives in attendance_config
-- (office_start/office_end = 10:00–18:30). Employees with a shift_start/shift_end
-- use their own; everyone else falls back to the general shift.
alter table public.employees add column if not exists shift_start time;
alter table public.employees add column if not exists shift_end   time;

update public.attendance_config set office_start='10:00', office_end='18:30' where id;

-- Hiral Patel — part-time 10:00–16:30
update public.employees set shift_start='10:00', shift_end='16:30' where full_name ilike '%hiral%';
