-- ROLLBACK for sql/tierA_attendance_integrity_up.sql
-- Restores reg_decide and leave_decide to their exact pre-2026-07-31 definitions (captured
-- live via pg_get_functiondef before any change) and removes the two indexes that script added.
-- Dropping those indexes is safe: they were created by the up-script, they hold no data, and
-- no existing row was modified to satisfy them.
--
-- NOTE: rolling back re-opens the double-deduction bug in leave_decide (the balance update
-- runs unconditionally) and the self-approval hole in both functions. Roll back only to
-- unblock production, then re-apply a corrected up-script.

begin;

drop index if exists public.uq_punch_reg_dir;
drop index if exists public.uq_reg_live_day;

CREATE OR REPLACE FUNCTION public.reg_decide(p_id uuid, p_step text, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.leave_decide(p_id uuid, p_step text, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.leave_requests; my uuid; mgr uuid; hr uuid; crole text;
begin
  select * into r from public.leave_requests where id=p_id;
  if r.id is null then raise exception 'Request not found'; end if;
  my := public.my_employee_id();
  select reporting_manager_id into mgr from public.employees where id=r.employee_id;
  select hr_approver_employee_id into hr from public.attendance_config limit 1;
  crole := public.expense_role();

  if p_step='mgr' then
    if not (my=mgr or crole = any(array['admin','management'])) then raise exception 'Not authorized (manager step)'; end if;
    if not p_approve then update public.leave_requests set status='rejected', mgr_approver=my, mgr_at=now(), decision_note=p_note where id=p_id; return 'rejected'; end if;
    update public.leave_requests set status='mgr_approved', mgr_approver=my, mgr_at=now() where id=p_id and status='pending';
    return 'mgr_approved';
  elsif p_step='hr' then
    if not (my=hr or crole='admin' or crole='management') then raise exception 'Not authorized (HR step)'; end if;
    if not p_approve then update public.leave_requests set status='rejected', hr_approver=my, hr_at=now(), decision_note=p_note where id=p_id; return 'rejected'; end if;
    update public.leave_requests set status='approved', hr_approver=my, hr_at=now() where id=p_id and status='mgr_approved';
    update public.leave_balances set used = used + r.days
      where employee_id=r.employee_id and fy_label = public.fy_label(r.from_date);
    return 'approved';
  end if;
  return 'noop';
end $function$;

commit;
