-- Probation-end auto credit — APPLIED LIVE 2026-09-03 (user rule)
--
-- When lifecycle_status flips probation → confirmed (the manual edit on the employee
-- page), leave is credited automatically for the rest of the FY, counted FROM THE
-- CONFIRMATION DATE (user decision 2026-09-03; not join date, not flat 25) and rounded
-- UP to whole days ("credit leaves by rounding off, like 10.5 do 11 — just for credit";
-- deductions stay in halves).
--
-- Months counted: the confirmation month itself when confirmed on/before the 15th, else
-- from the next month, through March. credited = ceil(25 × months / 12).
--   confirmed 28 Oct → Nov–Mar = 5 → 11 days
--   confirmed 18 Aug → Sep–Mar = 7 → 15 days
--   confirmed 10 Apr → Apr–Mar = 12 → 25 days
--
-- leave_balances.credited_on records WHEN (shown in the leave ledger). The upsert never
-- reduces an existing credit (greatest), so an HR hand-set figure survives. Rollback-
-- tested on real data 2026-09-03 (flip → credit appears → rolled back).

alter table leave_balances add column if not exists credited_on date;

create or replace function leave_prorata_credit(p_conf date) returns numeric
language plpgsql immutable as $body$
declare fy_end date; sm date; months int;
begin
  if extract(month from p_conf) >= 4 then fy_end := make_date(extract(year from p_conf)::int + 1, 3, 31);
  else fy_end := make_date(extract(year from p_conf)::int, 3, 31); end if;
  sm := date_trunc('month', p_conf)::date
        + (case when extract(day from p_conf) > 15 then interval '1 month' else interval '0' end);
  months := least(12, greatest(0,
    (extract(year from fy_end)::int*12 + extract(month from fy_end)::int)
    - (extract(year from sm)::int*12 + extract(month from sm)::int) + 1));
  return ceil(25.0 * months / 12);
end $body$;

create or replace function probation_confirm_credit() returns trigger
language plpgsql security definer set search_path = public as $body$
declare conf date; fy text; y int;
begin
  if old.lifecycle_status = 'probation' and new.lifecycle_status = 'confirmed' then
    conf := coalesce(new.lifecycle_date, (now() at time zone 'Asia/Kolkata')::date);
    new.lifecycle_date := conf;
    y := case when extract(month from conf) >= 4 then extract(year from conf)::int
         else extract(year from conf)::int - 1 end;
    fy := lpad((y % 100)::text, 2, '0') || '-' || lpad(((y+1) % 100)::text, 2, '0');
    insert into leave_balances (employee_id, fy_label, credited, carried_forward, used, encashed, lop_days, credited_on)
    values (new.id, fy, leave_prorata_credit(conf), 0, 0, 0, 0, conf)
    on conflict (employee_id, fy_label) do update
      set credited = greatest(leave_balances.credited, excluded.credited),
          credited_on = coalesce(leave_balances.credited_on, excluded.credited_on);
  end if;
  return new;
end $body$;

drop trigger if exists trg_probation_credit on employees;
create trigger trg_probation_credit before update on employees
  for each row execute function probation_confirm_credit();
