-- ─────────────────────────────────────────────────────────────
-- Regularization approvals — append-only, audit-preserving.
-- Raw device punches are NEVER edited or deleted. An approved
-- regularization writes a SEPARATE correction punch, tagged
-- method='regularization' and linked back to the request, so both
-- logs sit side by side with a full audit trail.
-- Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────

-- 1) audit link: which regularization produced a correction punch
alter table public.attendance_punches
  add column if not exists regularization_id uuid references public.regularizations(id) on delete set null;

-- 2) widen method to allow the correction tag (adds a value, removes none)
alter table public.attendance_punches drop constraint if exists attendance_punches_method_check;
alter table public.attendance_punches
  add constraint attendance_punches_method_check
  check (method in ('web','mobile','biometric','manual','regularization'));

-- 3) 2-step decision (manager -> Ankit/HR), mirrors leave_decide.
--    On final approve, append correction punches (raw punches untouched).
create or replace function public.reg_decide(p_id uuid, p_step text, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.regularizations;
  my       uuid;
  mgr      uuid;
  hr       uuid;
  is_mgmt  boolean;
begin
  select * into r from public.regularizations where id = p_id;
  if not found then raise exception 'Regularization not found'; end if;

  my      := public.my_employee_id();
  is_mgmt := public.expense_role() = any(array['admin','management']);
  select reporting_manager_id into mgr from public.employees where id = r.employee_id;
  select hr_approver_employee_id into hr from public.attendance_config limit 1;

  if p_step = 'mgr' then
    if r.status <> 'pending' then raise exception 'Not awaiting manager approval'; end if;
    if not (is_mgmt or my = mgr) then raise exception 'Not authorised for the manager step'; end if;
    if p_approve then
      update public.regularizations
        set status='mgr_approved', mgr_approver=my, mgr_at=now(), decision_note=p_note, updated_at=now()
        where id=p_id;
    else
      update public.regularizations
        set status='rejected', mgr_approver=my, mgr_at=now(), decision_note=p_note, updated_at=now()
        where id=p_id;
    end if;

  elsif p_step = 'hr' then
    if r.status <> 'mgr_approved' then raise exception 'Not awaiting HR approval'; end if;
    if not (is_mgmt or my = hr) then raise exception 'Not authorised for the HR step'; end if;
    if p_approve then
      update public.regularizations
        set status='approved', hr_approver=my, hr_at=now(), decision_note=coalesce(p_note, decision_note), updated_at=now()
        where id=p_id;
      -- append-only corrections (IST wall-clock -> timestamptz), linked to the request
      if r.requested_in is not null then
        insert into public.attendance_punches (employee_id, punch_at, direction, method, regularization_id, note, created_by)
        values (r.employee_id, (r.work_date + r.requested_in) at time zone 'Asia/Kolkata', 'in', 'regularization', p_id, r.reason, my);
      end if;
      if r.requested_out is not null then
        insert into public.attendance_punches (employee_id, punch_at, direction, method, regularization_id, note, created_by)
        values (r.employee_id, (r.work_date + r.requested_out) at time zone 'Asia/Kolkata', 'out', 'regularization', p_id, r.reason, my);
      end if;
    else
      update public.regularizations
        set status='rejected', hr_approver=my, hr_at=now(), decision_note=p_note, updated_at=now()
        where id=p_id;
    end if;

  else
    raise exception 'Invalid step (expected mgr or hr)';
  end if;
end $$;

grant execute on function public.reg_decide(uuid, text, boolean, text) to authenticated;

-- verify
-- select column_name from information_schema.columns where table_name='attendance_punches' and column_name='regularization_id';
-- select proname from pg_proc where proname='reg_decide';
