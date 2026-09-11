-- When the biometric sync is down, tell the whole team — 2026-09-11 (user request:
-- "if system is down send notification to all, that system is down do not panic your
-- attendance will be recorded").
--
-- WHY: the connector stopped on 10 Sep at 18:06 and nobody knew until the 09:00 alert the
-- next morning — which goes to ONE inbox. Meanwhile every punching employee opens the app,
-- sees a blank day, and assumes their attendance is lost. It is not: eSSL keeps the logs on
-- the device and the connector backfills from its watermark on restart. People need to be
-- told that, at the moment they would otherwise worry.
--
-- WHAT CHANGES: the admin alert is untouched. A second, reassuring BELL notification now
-- goes to every active employee who is expected to punch.
--
-- Bell only, never e-mail: email_type stays NULL, which send-email-notification treats as
-- "no email_type, skipped". That keeps an outage from becoming 30 emails, and it means the
-- nine warehouse staff — who have no mailbox — still get told, in the app where they read
-- everything else anyway.
--
-- Rate limiting is inherited, not re-invented: this sits inside the existing 6-hourly,
-- working-hours-only guard, so a two-day outage produces at most a handful of messages.
-- attendance_exempt people are excluded — they never punch, so nothing looks wrong to them.

create or replace function public.sync_alert_check() returns void
language plpgsql security definer set search_path = public as $body$
declare
  s        public.biometric_sync_state;
  ist_now  timestamp;
  quiet    interval;
  target   uuid;
  hrs      int;
  told     int;
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

  hrs := floor(extract(epoch from quiet) / 3600);

  -- 1. the admin alert — unchanged, still e-mailed via email_type 'sync_down'
  select id into target from public.profiles where username = 'vatsal.maniar';
  if target is not null then
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
  end if;

  -- 2. reassure everyone who punches. Bell only (email_type NULL).
  insert into public.notifications (user_name, message, from_name, user_id, email_type)
  select p.name,
         'The fingerprint attendance system is temporarily not syncing, so today may look '
         || 'blank in the app. Please do not worry — your punches are still being recorded '
         || 'on the device and will appear automatically once the connection is restored. '
         || 'You do not need to do anything, and no attendance will be lost. '
         || 'Please keep punching as usual.',
         'Attendance monitor',
         p.id,
         null
    from public.employees e
    join public.profiles p on p.id = e.profile_id
   where e.lifecycle_status <> 'exited'
     and coalesce(e.attendance_exempt, false) = false
     and (target is null or p.id <> target);   -- Vatsal already has the alert above
  get diagnostics told = row_count;
  raise notice 'sync_down: told % employees', told;

  update public.biometric_sync_state set last_alert_at = now() where source = s.source;
end $body$;
