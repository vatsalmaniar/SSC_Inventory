-- 2nd & 4th Saturday are WORKING days for the fulfilment team — 2026-09-05 (user decision).
--
-- Company-wide the week off is Sunday plus the 2nd and 4th Saturday. The fulfilment team
-- works those Saturdays; the Office Boys do not. So their muster must show a working day,
-- not "weekly off", and an absence on one counts as absent.
--
-- SAME SET AS OT — att_ot_eligible() is reused rather than copied: FC + staff, minus
-- anyone whose designation matches 'office boy'. One definition, so the two rules can
-- never drift apart.
--
-- AN EXPLICIT COMPANY OVERRIDE STILL WINS (user confirmed). attendance_weekoff_overrides
-- is how the 22-Aug/29-Aug swap was recorded; if the company declares a specific Saturday
-- off for everyone, the fulfilment team is off too. The client applies that first and only
-- falls through to the standing 2nd/4th rule when no override exists for the date.

create or replace function public.att_saturday_workers()
returns table (employee_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id
    from public.employees e
   where e.lifecycle_status <> 'exited'
     and public.att_ot_eligible(e.id)
$$;
revoke execute on function public.att_saturday_workers() from public, anon;
grant  execute on function public.att_saturday_workers() to authenticated, service_role;
