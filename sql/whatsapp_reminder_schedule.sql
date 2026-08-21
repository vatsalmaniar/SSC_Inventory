-- Scheduled WhatsApp payment reminders — MONDAY, 12:00 noon IST.
--
-- 06:30 UTC = 12:00 IST; day 1 is Monday. Was Mon + Thu, cut to Monday only on
-- 2026-08-21: twice a week to the same overdue customer is nagging, and the
-- resend guard is 7 days anyway, so the Thursday run would mostly have skipped.
--
-- On load: this is deliberately unlike the daily-summary job that took the
-- database down in April. That one scanned and aggregated everything, daily.
-- This inserts ~200 rows, then works twelve at a time with a pause, over about
-- five minutes, twice a week. It never scans the whole database.
--
-- On safety: run-reminder-job REFUSES to send unless the Tally sheet was
-- uploaded the same day. Yesterday's figures would chase customers who have
-- since paid, and an automated mistake is a silent one. It also skips if a run
-- is already in progress, and notifies every admin whether it runs or skips.
--
-- On the secret: it lives in Vault, NOT inline. cron.job's command is stored in
-- plaintext, and a secret sitting there would let anyone who can read the
-- scheduler trigger a reminder run to every customer.

select vault.create_secret('REPLACE_WITH_JOB_SECRET', 'JOB_SECRET',
  'Shared secret for run-reminder-job scheduled + chained calls')
where not exists (select 1 from vault.secrets where name = 'JOB_SECRET');

select cron.unschedule('whatsapp-reminders')
  where exists (select 1 from cron.job where jobname = 'whatsapp-reminders');

select cron.schedule(
  'whatsapp-reminders',
  '30 6 * * 1',
  $$
  select net.http_post(
    url     := 'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/run-reminder-job',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
                 'action', 'scheduled',
                 'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'JOB_SECRET')),
    timeout_milliseconds := 20000
  );
  $$
);

-- Nothing in the app needs to read the scheduler.
revoke all on cron.job             from anon, authenticated;
revoke all on cron.job_run_details from anon, authenticated;
