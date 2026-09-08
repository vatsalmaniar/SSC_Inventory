-- Attendance nudge — 10:30 IST, Monday to Saturday.
--
-- WHY: a day with no punch and no leave becomes Loss of Pay at month end. By then the
-- 48-hour regularization window has closed and only HR can fix it. A prompt the same
-- morning lets the person sort it themselves.
--
-- The function was deployed 2026-09-07 and worked when called by hand, but nothing ever
-- scheduled it, so nobody was ever nudged. This is that missing piece.
--
-- 05:00 UTC = 10:30 IST. Days 1-6 = Mon-Sat; the function itself skips week-offs, public
-- holidays and declared holidays (including the rule that the fulfilment team works the
-- 2nd and 4th Saturday), so the schedule does not need to know the calendar.
--
-- ?send=1 is REQUIRED: the function is dry-run by default, so a schedule that forgot the
-- flag would report and mail nobody. That is the safe failure direction and why it is
-- spelled out here rather than defaulted inside the function.
--
-- Both secrets come from Vault, never inline: cron.job.command is stored in plaintext, so
-- a key sitting in it would let anyone who can read the scheduler mail the whole team.
--   service_role_key -> satisfies the platform verify_jwt check
--   NUDGE_SECRET     -> the function's own x-cron-secret check
--
-- LOAD: one HTTP post a day. Nothing like the daily-summary job that took the database
-- down in April 2026 — no scan, no aggregation, the work happens in the function.

select cron.unschedule('attendance-nudge')
  where exists (select 1 from cron.job where jobname = 'attendance-nudge');

select cron.schedule(
  'attendance-nudge',
  '0 5 * * 1-6',
  $$
  select net.http_post(
    url     := 'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/attendance-nudge?send=1',
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'Authorization',   'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
                 'x-cron-secret',   (select decrypted_secret from vault.decrypted_secrets where name = 'NUDGE_SECRET')),
    timeout_milliseconds := 20000
  );
  $$
);

-- Nothing in the app needs to read the scheduler.
revoke all on cron.job             from anon, authenticated;
revoke all on cron.job_run_details from anon, authenticated;
