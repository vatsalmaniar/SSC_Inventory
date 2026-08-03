-- ROLLBACK for sql/sync_alert_up.sql
begin;
select cron.unschedule('attendance-sync-alert');
drop function if exists public.sync_alert_check();
-- last_alert_at is left in place: dropping a column is destructive and it is harmless empty.
commit;
