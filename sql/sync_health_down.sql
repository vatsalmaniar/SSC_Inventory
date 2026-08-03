-- ROLLBACK for sql/sync_health_up.sql
-- Everything here was created by that script; no pre-existing object is touched.
begin;
drop function if exists public.sync_uptime_daily(integer);
drop function if exists public.sync_status();
drop function if exists public.sync_record_beat(text, integer);
drop table if exists public.sync_devices;
drop table if exists public.sync_health;
commit;
