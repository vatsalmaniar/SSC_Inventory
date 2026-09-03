-- Approval notifications for leave + regularization — APPLIED LIVE 2026-09-03
--
-- Org-structure-driven, per the user's rule: the request follows employees.
-- reporting_manager_id (change the RM on the employee page and routing + notification
-- follow automatically — the trigger reads it at event time), and Ankit — the HR
-- approver in attendance_config — gets the second step.
--
-- One AFTER trigger on both tables:
--   INSERT (pending)              → notify the reporting manager (in-app + email)
--   pending → mgr_approved        → notify the HR approver — EXCEPT when the request is
--                                   the HR approver's own (they cannot self-approve, so
--                                   the RPC would dead-end): then all admins are notified
--   → approved / rejected         → notify the requester (with the rejection reason)
--
-- Email rides the existing pipeline: inserting into `notifications` fires
-- on_notification_insert_trigger → send-email-notification (Resend). Unknown
-- email_type falls back to a generic subject — the edge function was NOT touched
-- (CLI-only deploys). Every notify insert is wrapped in its own exception block so a
-- mail failure can NEVER block the leave/regularization write itself.
-- Rollback-tested 2026-09-03: apply as Hiral → notification to Ankit Dave (her RM).

create or replace function attendance_request_notify() returns trigger
language plpgsql security definer set search_path = public as $body$
declare
  kind text := case when TG_TABLE_NAME = 'leave_requests' then 'Leave' else 'Regularization' end;
  emp record; rm record; hr record; detail text;
begin
  select e.full_name, e.reporting_manager_id, e.profile_id into emp
    from employees e where e.id = new.employee_id;
  if TG_TABLE_NAME = 'leave_requests' then
    detail := to_char(new.from_date,'DD Mon YYYY')
              || case when new.to_date <> new.from_date then ' to ' || to_char(new.to_date,'DD Mon YYYY') else '' end
              || ' (' || new.days || ' day' || case when new.days <> 1 then 's' else '' end || ')';
  else
    detail := to_char(new.work_date,'DD Mon YYYY');
  end if;

  if TG_OP = 'INSERT' and new.status = 'pending' then
    begin
      if emp.reporting_manager_id is not null then
        select m.full_name, m.profile_id into rm from employees m where m.id = emp.reporting_manager_id;
        if rm.profile_id is not null then
          insert into notifications (user_id, user_name, message, from_name, email_type)
          values (rm.profile_id, rm.full_name,
            kind || ' request from ' || emp.full_name || ' — ' || detail
              || coalesce('. Reason: ' || new.reason, '') || '. Awaiting your approval.',
            emp.full_name, 'approval_request');
        end if;
      end if;
    exception when others then null; end;
  elsif TG_OP = 'UPDATE' and new.status = 'mgr_approved' and old.status = 'pending' then
    begin
      select e2.full_name, e2.profile_id, e2.id into hr from employees e2
        where e2.id = (select hr_approver_employee_id from attendance_config limit 1);
      if hr.id = new.employee_id then
        -- HR's own request: leave_decide/reg_decide block self-approval, so route the
        -- second step to the admins who can actually complete it.
        insert into notifications (user_id, user_name, message, from_name, email_type)
        select p.id, p.name,
          kind || ' request from ' || emp.full_name || ' (the HR approver) — ' || detail
            || '. Manager approved. HR cannot approve their own request — an admin must complete this step.',
          emp.full_name, 'approval_request'
        from profiles p where p.role = 'admin';
      elsif hr.profile_id is not null then
        insert into notifications (user_id, user_name, message, from_name, email_type)
        values (hr.profile_id, hr.full_name,
          kind || ' request from ' || emp.full_name || ' — ' || detail
            || '. Manager approved — awaiting your HR approval.',
          emp.full_name, 'approval_request');
      end if;
    exception when others then null; end;
  elsif TG_OP = 'UPDATE' and new.status in ('approved','rejected') and old.status in ('pending','mgr_approved') then
    begin
      if emp.profile_id is not null then
        insert into notifications (user_id, user_name, message, from_name, email_type)
        values (emp.profile_id, emp.full_name,
          'Your ' || lower(kind) || ' request for ' || detail || ' was ' || new.status
            || case when new.status = 'rejected' and new.decision_note is not null
                    then '. Reason: ' || new.decision_note else '' end || '.',
          'SSC ERP', 'approval_decision');
      end if;
    exception when others then null; end;
  end if;
  return new;
end $body$;

drop trigger if exists trg_leave_notify on leave_requests;
create trigger trg_leave_notify after insert or update on leave_requests
  for each row execute function attendance_request_notify();
drop trigger if exists trg_reg_notify on regularizations;
create trigger trg_reg_notify after insert or update on regularizations
  for each row execute function attendance_request_notify();
