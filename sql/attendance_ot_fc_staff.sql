-- Overtime for the fulfilment team — 2026-09-05 (user rules).
--
-- THE RULES, as given:
--   * Applies to FC and staff ONLY, EXCEPT the Office Boys. That is two people, not one —
--     Naindrakumar Purabiya (Ahmedabad) and Ishwar Rathva (Vadodara).
--   * On a normal working day, OT starts after 19:00.
--   * On a week-off or holiday, the WHOLE day worked is OT ("otherwise yes OT") —
--     except that 2nd and 4th Saturday are NORMAL WORKING DAYS for this team
--     ("fc works on 2nd and 4th too"), so those follow the after-19:00 rule.
--   * Minimum threshold 15 minutes — anything under is not OT.
--   * Effective 2026-09-01 only. August is finalised and payroll is done, so this must
--     never alter an August figure.
--
-- WHY IT LIVES HERE AND NOT IN THE PAGE (user: "this should be from db"):
-- ot_minutes has existed on attendance_days all along and was NEVER populated — 0 of
-- 5,289 rows. The only writer was PeopleMuster.jsx pushing a client-computed `ot_min`,
-- and src/lib/attendance.js computed it as (isFC && outMin > shift_end), which could never
-- fire because shift_start/shift_end are NULL for all 11 FC and staff employees. So the
-- number was decorative. Now the database owns it: a BEFORE trigger sets ot_minutes on
-- every write and ignores whatever the client sends. One formula, and it decides pay.

-- ── who earns OT ────────────────────────────────────────────────────────────
create or replace function public.att_ot_eligible(p_employee uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
      join public.profiles p on p.id = e.profile_id
     where e.id = p_employee
       and p.role in ('fc_kaveri','fc_godawari','staff')
       -- Office Boys are excluded by DESIGNATION, not by name, so a new office boy is
       -- covered automatically and a rename never silently re-enables OT.
       and coalesce(e.designation,'') !~* 'office\s*boy'
  )
$$;

-- ── is this date a working day FOR THIS TEAM? ───────────────────────────────
-- Company-wide the week off is Sunday plus the 2nd and 4th Saturday (see isWeekOff in
-- src/lib/attendance.js). The fulfilment team works those Saturdays, so for OT purposes
-- only Sunday counts as the weekly off. attendance_weekoff_overrides still wins — that is
-- how the 22-Aug/29-Aug swap was recorded and it must keep working.
create or replace function public.att_ot_is_offday(p_date date) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.is_weekoff from public.attendance_weekoff_overrides o where o.work_date = p_date),
    extract(dow from p_date) = 0                                    -- Sunday only
      or exists (select 1 from public.holidays h
                  where h.holiday_date = p_date and h.is_active)
  )
$$;

-- ── the one OT formula ──────────────────────────────────────────────────────
create or replace function public.att_ot_minutes(p_employee uuid, p_date date) returns integer
  language plpgsql stable security definer set search_path = public as $$
declare
  v_first timestamptz; v_last timestamptz;
  v_out_min int; v_ot int;
  OT_FROM_MIN constant int := 19 * 60;   -- 19:00 IST
  MIN_OT      constant int := 15;        -- under 15 minutes is not OT
begin
  -- August and earlier are finalised and paid; never restate them.
  if p_date < date '2026-09-01' then return 0; end if;
  if not public.att_ot_eligible(p_employee) then return 0; end if;

  select min(punch_at), max(punch_at) into v_first, v_last
    from public.attendance_punches
   where employee_id = p_employee
     and (punch_at at time zone 'Asia/Kolkata')::date = p_date;

  if v_first is null or v_last is null or v_last <= v_first then return 0; end if;

  if public.att_ot_is_offday(p_date) then
    -- Week-off or holiday: the whole attendance is overtime.
    v_ot := floor(extract(epoch from (v_last - v_first)) / 60);
  else
    -- Normal day (including 2nd/4th Saturday for this team): only past 19:00 counts.
    v_out_min := extract(hour from (v_last at time zone 'Asia/Kolkata')) * 60
               + extract(minute from (v_last at time zone 'Asia/Kolkata'));
    v_ot := greatest(v_out_min - OT_FROM_MIN, 0);
  end if;

  if v_ot < MIN_OT then return 0; end if;
  return v_ot;
end $$;

revoke execute on function public.att_ot_eligible(uuid)    from public, anon;
revoke execute on function public.att_ot_is_offday(date)   from public, anon;
revoke execute on function public.att_ot_minutes(uuid,date) from public, anon;
grant  execute on function public.att_ot_eligible(uuid)    to authenticated, service_role;
grant  execute on function public.att_ot_is_offday(date)   to authenticated, service_role;
grant  execute on function public.att_ot_minutes(uuid,date) to authenticated, service_role;

-- ── the database owns the number ────────────────────────────────────────────
-- Runs on INSERT and on UPDATE, so a re-finalise recomputes rather than trusting the
-- client. Pre-September rows resolve to 0 through the guard inside att_ot_minutes.
create or replace function public.att_set_ot() returns trigger
language plpgsql as $$
begin
  new.ot_minutes := public.att_ot_minutes(new.employee_id, new.work_date);
  return new;
end $$;

drop trigger if exists trg_att_set_ot on public.attendance_days;
create trigger trg_att_set_ot before insert or update on public.attendance_days
  for each row execute function public.att_set_ot();

-- ROLLBACK:  drop trigger trg_att_set_ot on public.attendance_days;

-- ── what the muster reads ───────────────────────────────────────────────────
-- Per-employee OT total for a month, computed by the SAME function the trigger uses, so
-- the figure on screen and the figure written to attendance_days can never disagree.
-- Only eligible employees are iterated (9 people, not 41) to keep it cheap.
create or replace function public.att_month_ot(p_month date)
returns table (employee_id uuid, ot_minutes integer)
language sql stable security definer set search_path = public as $$
  select e.id,
         coalesce(sum(public.att_ot_minutes(e.id, g.d::date)), 0)::int
    from public.employees e
    cross join generate_series(
           date_trunc('month', p_month)::date,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date,
           interval '1 day') g(d)
   where public.att_ot_eligible(e.id)
   group by e.id
$$;
revoke execute on function public.att_month_ot(date) from public, anon;
grant  execute on function public.att_month_ot(date) to authenticated, service_role;
