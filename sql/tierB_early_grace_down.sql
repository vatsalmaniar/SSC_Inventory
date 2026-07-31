-- ROLLBACK for sql/tierB_early_grace_up.sql
--
-- Removes the early_grace_min setting. computeDay falls back to 15 minutes in code
-- (DEFAULT_CFG), so the grace still applies after rollback — this only removes the ability
-- to configure it. To genuinely restore the old behaviour (no grace, half-day at 18:29) the
-- frontend must be reverted too.

begin;

alter table public.attendance_config drop column if exists early_grace_min;

commit;
