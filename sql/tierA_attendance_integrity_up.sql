-- Tier A — attendance capture integrity (ADDITIVE: CREATE OR REPLACE + CREATE INDEX only).
--
-- These protect the PERMANENT record ahead of the 2026-08-01 payroll cutover. Unlike the
-- derivation bugs (muster truncation, early-out grace) which recompute from raw punches and
-- can be fixed later, everything here writes rows that cannot be reconstructed afterwards.
--
-- Rollback: sql/tierA_attendance_integrity_down.sql
-- Verified safe against live data 2026-07-31:
--   * 0 duplicate (regularization_id, direction) punch pairs  -> uq_punch_reg_dir will build
--   * the only duplicate (employee_id, work_date) regularizations are pending+pending,
--     so uq_reg_live_day (scoped to mgr_approved/approved) will build
--   * 6 admin/management approvers + HR approver 092 exist, so blocking self-approval
--     strands nobody

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. One correction punch per (regularization, direction).
--    reg_decide inserts unconditionally, so a retried/double-clicked approval wrote a
--    second 'in' punch — which silently widens the working day (computeDay takes
--    times[0] and times[last]).
-- ─────────────────────────────────────────────────────────────
create unique index if not exists uq_punch_reg_dir
  on public.attendance_punches (regularization_id, direction)
  where regularization_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 2. One LIVE regularization per employee per day.
--    Scoped to the statuses that actually produce punches. Pending duplicates already
--    exist (2 rows) and are left untouched — the index stops the second one from
--    progressing to approval rather than deleting anything.
-- ─────────────────────────────────────────────────────────────
create unique index if not exists uq_reg_live_day
  on public.regularizations (employee_id, work_date)
  where status in ('mgr_approved','approved');

-- ─────────────────────────────────────────────────────────────
-- 3. reg_decide — row lock, self-approval block, idempotent punch insert.
-- ─────────────────────────────────────────────────────────────
create or replace function public.reg_decide(p_id uuid, p_step text, p_approve boolean, p_note text default null::text)
  returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  r        public.regularizations;
  my       uuid;
  mgr      uuid;
  hr       uuid;
  is_mgmt  boolean;
begin
  -- for update: without it two approvers clicking together both read 'pending', both pass
  -- the status guard, and both insert correction punches.
  select * into r from public.regularizations where id = p_id for update;
  if not found then raise exception 'Regularization not found'; end if;

  my      := public.my_employee_id();
  is_mgmt := public.expense_role() = any(array['admin','management']);
  select reporting_manager_id into mgr from public.employees where id = r.employee_id;
  select hr_approver_employee_id into hr from public.attendance_config limit 1;

  -- Two-person control. Previously a management user could satisfy BOTH steps on their own
  -- request, so the approval chain was decorative.
  if my is not null and my = r.employee_id then
    raise exception 'You cannot decide your own regularization — ask a manager, HR or an admin';
  end if;

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
      -- append-only corrections (IST wall-clock -> timestamptz), linked to the request.
      -- on conflict do nothing makes a retry idempotent instead of duplicating the punch.
      if r.requested_in is not null then
        insert into public.attendance_punches (employee_id, punch_at, direction, method, regularization_id, note, created_by)
        values (r.employee_id, (r.work_date + r.requested_in) at time zone 'Asia/Kolkata', 'in', 'regularization', p_id, r.reason, my)
        on conflict (regularization_id, direction) where regularization_id is not null do nothing;
      end if;
      if r.requested_out is not null then
        insert into public.attendance_punches (employee_id, punch_at, direction, method, regularization_id, note, created_by)
        values (r.employee_id, (r.work_date + r.requested_out) at time zone 'Asia/Kolkata', 'out', 'regularization', p_id, r.reason, my)
        on conflict (regularization_id, direction) where regularization_id is not null do nothing;
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

-- ─────────────────────────────────────────────────────────────
-- 4. leave_decide — row lock, self-approval block, and the double-deduction fix.
--    The balance update previously ran UNCONDITIONALLY, while the status update was guarded
--    by `and status='mgr_approved'`. So calling the HR step twice moved the status once but
--    added r.days to leave_balances.used TWICE. Now the deduction only happens if this call
--    is the one that actually moved the row.
-- ─────────────────────────────────────────────────────────────
create or replace function public.leave_decide(p_id uuid, p_step text, p_approve boolean, p_note text default null::text)
  returns text language plpgsql security definer set search_path to 'public'
as $function$
declare r public.leave_requests; my uuid; mgr uuid; hr uuid; crole text; n int;
begin
  select * into r from public.leave_requests where id=p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  my := public.my_employee_id();
  select reporting_manager_id into mgr from public.employees where id=r.employee_id;
  select hr_approver_employee_id into hr from public.attendance_config limit 1;
  crole := public.expense_role();

  if my is not null and my = r.employee_id then
    raise exception 'You cannot decide your own leave request — ask a manager, HR or an admin';
  end if;

  if p_step='mgr' then
    if not (my=mgr or crole = any(array['admin','management'])) then raise exception 'Not authorized (manager step)'; end if;
    if not p_approve then update public.leave_requests set status='rejected', mgr_approver=my, mgr_at=now(), decision_note=p_note where id=p_id; return 'rejected'; end if;
    update public.leave_requests set status='mgr_approved', mgr_approver=my, mgr_at=now() where id=p_id and status='pending';
    return 'mgr_approved';
  elsif p_step='hr' then
    if not (my=hr or crole='admin' or crole='management') then raise exception 'Not authorized (HR step)'; end if;
    if not p_approve then update public.leave_requests set status='rejected', hr_approver=my, hr_at=now(), decision_note=p_note where id=p_id; return 'rejected'; end if;
    update public.leave_requests set status='approved', hr_approver=my, hr_at=now() where id=p_id and status='mgr_approved';
    get diagnostics n = row_count;
    if n = 1 then
      update public.leave_balances set used = used + r.days
        where employee_id=r.employee_id and fy_label = public.fy_label(r.from_date);
    end if;
    return 'approved';
  end if;
  return 'noop';
end $function$;

commit;
