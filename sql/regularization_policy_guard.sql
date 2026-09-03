-- Regularization policy — APPLIED LIVE 2026-09-03 (user rule; widened same-day → 48h)
--
-- 1. A regularization must be raised within 48 HOURS of the day (IST): work_date may be
--    today or up to 2 days back. Older days are HR's to fix via the Muster mark
--    (att_mark_day), which is admin/HR only.
-- 2. At most 7 live regularizations (pending/mgr_approved/approved) per calendar month.
-- Admin/management are exempt so HR corrections stay possible.
-- The Regularize form mirrors both rules for UX; this trigger is the actual gate.

create or replace function reg_policy_guard() returns trigger language plpgsql as $body$
declare ist_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if expense_role() = any(array['admin','management']) then return new; end if;
  if new.work_date > ist_today or new.work_date < ist_today - 2 then
    raise exception 'Regularization must be raised within 48 hours of the day — older days need HR (Muster mark).';
  end if;
  if (select count(*) from regularizations r
      where r.employee_id = new.employee_id
        and r.status in ('pending','mgr_approved','approved')
        and date_trunc('month', r.work_date::timestamp) = date_trunc('month', new.work_date::timestamp)) >= 7 then
    raise exception 'Monthly regularization limit (7) reached.';
  end if;
  return new;
end $body$;

drop trigger if exists trg_reg_policy on regularizations;
create trigger trg_reg_policy before insert on regularizations
  for each row execute function reg_policy_guard();
