-- Tier B / ATT-4 — early-out grace becomes a real, configurable setting (ADDITIVE).
--
-- computeDay fell back to office_end because config.early_grace did not exist, so leaving at
-- 18:29 cost half a day while the leave policy shown to every employee in three languages
-- promises grace until 18:15 (LeavePolicyDrawer.jsx). The code was wrong; the policy stands.
--
-- Stored as MINUTES BEFORE the shift end, not a clock time: staff on a custom shift
-- (employees.shift_end, e.g. 16:30) get the same allowance against their own end time. A
-- fixed 18:15 would have required them to stay two hours past their shift.
--
-- Reconciled against real July 2026 data (35 employees x 31 days) before applying. 66
-- employee-days change status, every one of them a correction in the employee's favour:
--     23  half_day -> present   early-out grace now honoured
--     28  half_day -> present   lone punch no longer penalised
--      8  absent   -> present   lone punch no longer read as a late arrival
--      6  absent/half_day -> present   exempt staff no longer scored from stray scans
--      1  leave    -> half_day  half-day leave charged 0.5 instead of a full paid day
-- Totals: absent 164->153, half_day 150->97, present 559->624. Nobody moves to a worse status.
--
-- Rollback: sql/tierB_early_grace_down.sql

begin;

alter table public.attendance_config
  add column if not exists early_grace_min integer not null default 15;

comment on column public.attendance_config.early_grace_min is
  'Minutes before shift end an employee may leave and still keep the afternoon half. 15 = the published 18:15 grace against an 18:30 end. Applied relative to employees.shift_end when set.';

commit;
