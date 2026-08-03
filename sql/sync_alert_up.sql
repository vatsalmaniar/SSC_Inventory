-- Alert when the attendance sync goes quiet (ADDITIVE).
--
-- The 31 Jul 2026 stop was found three days later, by accident, because payroll needed the
-- data. Nothing anywhere said the connector had stopped. The heartbeat makes the failure
-- detectable; this makes someone get told.
--
-- LOAD: one cron every 30 minutes, Mon–Sat, working hours only ≈ 24 runs/day. Each run is a
-- single indexed read of a one-row table and, at most, one insert. Existing crons on this
-- project are 3 daily jobs. This is deliberately far lighter than the daily-summary job that
-- overloaded the DB in Apr 2026 — no aggregation, no scans, no per-employee work.
--
-- Rollback: sql/sync_alert_down.sql

begin;

alter table public.biometric_sync_state
  add column if not exists last_alert_at timestamptz;

create or replace function public.sync_alert_check()
  returns void language plpgsql security definer set search_path = public
as $$
declare
  s        public.biometric_sync_state;
  ist_now  timestamp;
  quiet    interval;
  target   uuid;
  hrs      int;
begin
  select * into s from public.biometric_sync_state where source = 'essl-etimetracklite';
  if not found or s.last_run_at is null then return; end if;

  ist_now := now() at time zone 'Asia/Kolkata';
  -- Working hours only. A connector that stops at 9pm Saturday is a Monday problem; waking
  -- someone overnight for it would train them to ignore the alert.
  if extract(isodow from ist_now) = 7 then return; end if;                      -- Sunday
  if extract(hour from ist_now) < 9 or extract(hour from ist_now) >= 19 then return; end if;

  quiet := now() - s.last_run_at;
  if quiet < interval '2 hours' then return; end if;                            -- still plausibly a blip

  -- At most one alert per 6 hours, so a multi-day outage does not become a mailbox full of
  -- identical messages that get filtered.
  if s.last_alert_at is not null and now() - s.last_alert_at < interval '6 hours' then return; end if;

  select id into target from public.profiles where username = 'vatsal.maniar';
  if target is null then return; end if;

  hrs := floor(extract(epoch from quiet) / 3600);
  insert into public.notifications (user_name, message, from_name, user_id, email_type)
  values (
    'Vatsal Maniar',
    format('Fingerprint attendance sync has been down for %s hours (last contact %s IST). '
           || 'Punches are still being recorded on the office PC but are not reaching the app. '
           || 'Check People > Attendance > Sync.',
           hrs, to_char(s.last_run_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')),
    'Attendance monitor',
    target,
    'sync_down'
  );

  update public.biometric_sync_state set last_alert_at = now() where source = s.source;
end $$;

-- 30-minute cadence, Mon–Sat, 03:00–14:59 UTC (08:30–20:29 IST). The function re-checks IST
-- working hours itself, so the schedule is only there to keep the job count down.
select cron.schedule('attendance-sync-alert', '*/30 3-14 * * 1-6', $$select public.sync_alert_check()$$);

commit;
