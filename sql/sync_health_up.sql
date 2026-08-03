-- Attendance sync observability (ADDITIVE — new tables/functions only).
--
-- Why: the connector stopped on 2026-07-31 10:39 and nobody knew until payroll needed the
-- data three days later. It only ever contacted the server when it had punches, so "quiet"
-- and "dead" were indistinguishable. The connector now sends a heartbeat every poll; these
-- tables turn that into something you can look at and be alerted on.
--
-- Rollup is HOURLY, not per-beat: at a 2-minute poll that is 30 beats/hour, so storing every
-- beat would be ~21k rows a month for no extra insight. 24 rows/day is negligible on Micro.
--
-- Rollback: sql/sync_health_down.sql

begin;

-- ── hourly heartbeat rollup ──────────────────────────────────────────────────
create table if not exists public.sync_health (
  source        text        not null,
  hour_start    timestamptz not null,
  beats         integer     not null default 0,   -- heartbeats received this hour
  punches       integer     not null default 0,   -- punches ingested this hour
  first_beat_at timestamptz not null default now(),
  last_beat_at  timestamptz not null default now(),
  -- Rows for dates before heartbeats existed are derived from punch activity, which only
  -- evidences the hours people actually punched. Flagged so the uptime chart never presents
  -- an inference as a measurement.
  inferred      boolean     not null default false,
  primary key (source, hour_start)
);
create index if not exists idx_sync_health_hour on public.sync_health (hour_start desc);

comment on table public.sync_health is
  'Hourly rollup of connector heartbeats. A gap here means attendance collection stopped — the failure mode that went unnoticed for three days in Aug 2026.';

-- ── device state, mirrored from eTimeTrackLite ───────────────────────────────
-- The biometric readers report their own last-ping to the eSSL server; that is the only
-- authoritative "is this device alive". The connector reads it and forwards it here, so the
-- app can show device health without anyone opening the eSSL console.
create table if not exists public.sync_devices (
  device_id   text        primary key,
  name        text,
  serial_no   text,
  location    text,
  last_ping   timestamptz,
  status      text,                                -- as reported by eSSL: online | offline
  seen_at     timestamptz not null default now(),  -- when WE last heard about it
  updated_at  timestamptz not null default now()
);


-- hour_start is the IST hour boundary. date_trunc('hour', <timestamptz>) truncates in UTC and
-- IST hours fall at :30 past the UTC hour, so a UTC-truncated key never matches an IST lookup.

CREATE OR REPLACE FUNCTION public.sync_record_beat(p_source text, p_punches integer DEFAULT 0)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.sync_health (source, hour_start, beats, punches)
  values (p_source,
          date_trunc('hour', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata',
          1, greatest(coalesce(p_punches,0), 0))
  on conflict (source, hour_start) do update
     set beats        = sync_health.beats + 1,
         punches      = sync_health.punches + greatest(coalesce(excluded.punches,0), 0),
         last_beat_at = now();
$function$;

CREATE OR REPLACE FUNCTION public.sync_status()
 RETURNS TABLE(source text, last_beat_at timestamp with time zone, minutes_since numeric, is_stale boolean, last_punch_at timestamp with time zone, punches_today bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.source,
         s.last_run_at,
         round(extract(epoch from (now() - s.last_run_at)) / 60, 1),
         -- 15 min is ~7 missed polls at the 2-minute cadence: comfortably past a transient blip
         (now() - s.last_run_at) > interval '15 minutes',
         s.last_punch_at,
         (select count(*) from public.attendance_punches p
           where p.method = 'biometric'
             and p.punch_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
  from public.biometric_sync_state s;
$function$;

CREATE OR REPLACE FUNCTION public.sync_uptime_daily(p_days integer DEFAULT 30)
 RETURNS TABLE(day date, active_hours integer, hours_up integer, uptime_pct numeric, inferred boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with hours as (
    select generate_series(
             date_trunc('day', (now() at time zone 'Asia/Kolkata') - make_interval(days => p_days - 1)),
             date_trunc('hour', now() at time zone 'Asia/Kolkata'),
             interval '1 hour') as h
  ),
  active as (   -- 07:00-21:00 IST: hours the office could plausibly be punching
    select h::date as day, h from hours where extract(hour from h) between 7 and 21
  ),
  joined as (
    select a.day, a.h, sh.beats, sh.inferred
    from active a
    left join public.sync_health sh
           on sh.hour_start = (a.h at time zone 'Asia/Kolkata') and sh.beats > 0
  )
  select j.day,
         count(*)::int,
         count(j.beats)::int,
         -- Days before heartbeats existed are INFERRED from punch activity, which only proves
         -- the hours people actually punched. Scoring those per-hour would report ~30% for a
         -- day the connector was up throughout, so for those days the honest answer is binary:
         -- punches arrived, therefore it was working.
         case when bool_or(j.inferred) then (case when count(j.beats) > 0 then 100.0 else 0.0 end)
              else round(100.0 * count(j.beats) / nullif(count(*), 0), 1) end,
         coalesce(bool_or(j.inferred), false)
  from joined j
  group by j.day order by j.day;
$function$;

-- ── access: admin + management only (same as the Muster) ────────────────────
alter table public.sync_health  enable row level security;
alter table public.sync_devices enable row level security;

drop policy if exists sync_health_read  on public.sync_health;
drop policy if exists sync_devices_read on public.sync_devices;
create policy sync_health_read  on public.sync_health  for select
  using (public.expense_role() = any(array['admin','management']));
create policy sync_devices_read on public.sync_devices for select
  using (public.expense_role() = any(array['admin','management']));

grant execute on function public.sync_status()              to authenticated;
grant execute on function public.sync_uptime_daily(integer) to authenticated;

commit;
