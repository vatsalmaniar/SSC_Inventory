-- Leave hardening — APPLIED LIVE 2026-09-03 ("harden": server-side versions of rules
-- that were UI-only). Rollback-tested on real data; all three guards fire and roll back.
--
-- 1. INSERT guard on leave_requests (admin/management exempt):
--    reason mandatory · to >= from · days > 0 · half-day must be single-date ·
--    no overlap with a live (pending/mgr_approved/approved) request.
-- 2. leave_decide + reg_decide: rejecting WITHOUT a note now raises — the guard was
--    inserted right after BEGIN in both live functions (their full bodies live in the
--    DB; the inserted block is exactly the one below).
--
--    -- HARDENED 2026-09-03: a rejection must carry a reason (was UI-only).
--    if not p_approve and (p_note is null or btrim(p_note) = '') then
--      raise exception 'Rejection needs a reason — tell the person why.';
--    end if;
--
-- Deliberately NOT moved to SQL: the sandwich/ledger arithmetic — it stays in
-- src/lib/leaveLedger.js as the single read-time formula (two copies would drift).

create or replace function leave_request_guard() returns trigger language plpgsql as $body$
begin
  if expense_role() = any(array['admin','management']) then return new; end if;
  if new.reason is null or btrim(new.reason) = '' then
    raise exception 'Leave request needs a reason.';
  end if;
  if new.to_date < new.from_date then raise exception 'End date is before the start date.'; end if;
  if coalesce(new.days,0) <= 0 then raise exception 'Leave request must cover at least one working day.'; end if;
  if coalesce(new.is_half_day,false) and new.from_date <> new.to_date then
    raise exception 'A half-day leave must be a single date.';
  end if;
  if exists (select 1 from leave_requests r
             where r.employee_id = new.employee_id
               and r.status in ('pending','mgr_approved','approved')
               and r.from_date <= new.to_date and r.to_date >= new.from_date) then
    raise exception 'You already have a live leave request covering these dates.';
  end if;
  return new;
end $body$;

drop trigger if exists trg_leave_request_guard on leave_requests;
create trigger trg_leave_request_guard before insert on leave_requests
  for each row execute function leave_request_guard();
