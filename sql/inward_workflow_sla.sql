-- ═══════════════════════════════════════════════════════════════════════════
-- INWARD WORKFLOW SLA — 24h / 48h, mirroring sql/po_workflow_sla.sql
--
-- Same pattern as the PO SLA, deliberately: OWNERS LIVE IN A TABLE, NOT IN CODE.
-- Mehul approves 99% of POs but Ankit and Vatsal cover his leave — hardcoding
-- names chases the wrong person the first time someone is away, and the same is
-- true of Anil, Sunil, Jayshree and Nirmita here.
--
-- MEASURED BASELINE, this FY, before choosing any number:
--
--   step                              n      median    <=24h    <=48h
--   A  GRN created -> confirmed    1,551     18.7h     58.7%    73.6%
--   B  bill -> 3-way checked       1,342     72.2h     21.9%    39.7%
--   C  3-way checked -> complete   1,327      0.0h     99.6%    99.6%
--
-- Two things that follow:
--   * STEP B IS THE BOTTLENECK. 60% of bills miss 48h, median three days, worst
--     78 days. That is where an SLA earns its keep.
--   * STEP C IS INSTANTANEOUS (median 0.0h) because accounts does both stages in
--     one sitting. The match work merges them anyway, so there is no separate
--     clock for C — bill_match runs created_at -> inward_completed_at.
--
-- ⚠️ Step A's baseline is APPROXIMATE. There was no grn.confirmed_at, so it was
--    measured from updated_at, which any later edit moves. This file adds the
--    column and stamps it going forward. Historical step A must be LABELLED
--    approximate wherever it is shown — the same honesty the PO work applied to
--    POs raised before 2026-08-04.
--
-- ⛔ NO DATA IS DELETED, AND NOTHING IS BACKFILLED. grn.confirmed_at is
--    unknowable for the 1,551 already-confirmed GRNs; inventing a value would
--    make the scorecard look precise while being fiction. It stays NULL for them.
--    Per-warehouse SLA is therefore honest from the day this runs, forward.
--
-- OPENING BACKLOG — the scorecard must not read as this month's performance:
--   bills at three_way_check   209   of which 175 already past 48h,  92 > 30 days
--   bills at invoice_pending    15   of which  15 already past 48h,  13 > 30 days
--   GRNs draft/checking          6   of which   1 already past 24h
-- 190 bills are already breaching. That is a WORKLIST, not a score. The
-- scorecard measures forward from sla_from; the breach list shows everything.
--
-- NO AUTOMATED CHASE. Visual flags only — the same call made on the PO SLA
-- ("I do not think it is require right now park it", 2026-08-05). If the 190 do
-- not get worked off, a pg_cron digest can follow on an explicit go: ONE DIGEST
-- PER PERSON, never one mail per bill — 26 at once is what tripped Resend's
-- 10/sec limit on birthdays.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. The missing stamp ───────────────────────────────────────────────────
alter table public.grn
  add column if not exists confirmed_at timestamptz;

comment on column public.grn.confirmed_at is
  'When the GRN was confirmed. Start of nothing, END of the 24h grn_confirm SLA. NULL on every GRN confirmed before this column existed — deliberately not backfilled, because updated_at moves on any later edit and would be fiction. Label historical step-A SLA as approximate.';

-- Stamped by a trigger rather than by editing confirm_grn, so the function every
-- GRN confirm depends on is left completely alone in Phase 1. The trigger only
-- fills a new nullable column on the transition into 'confirmed', and never
-- overwrites a value that is already there.
create or replace function public.grn_stamp_confirmed_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'confirmed'
     and coalesce(old.status, '') <> 'confirmed'
     and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_grn_stamp_confirmed_at on public.grn;
create trigger trg_grn_stamp_confirmed_at
  before update on public.grn
  for each row
  execute function public.grn_stamp_confirmed_at();

revoke all on function public.grn_stamp_confirmed_at() from public, anon;


-- ── 2. Who owns each hand-off, and their clock (data, not code) ────────────
-- scope is NOT NULL with an '' sentinel because a PK column cannot be null.
-- '' = the step is not per-warehouse.
create table if not exists public.inward_workflow_owners (
  step       text not null check (step in ('grn_confirm','bill_match','debit_note')),
  scope      text not null default '',
  profile_id uuid references public.profiles(id),
  sla_hours  numeric not null,
  updated_at timestamptz default now(),
  updated_by uuid,
  primary key (step, scope)
);

-- Owners chosen from MEASURED volume this FY, not from an org chart:
--   Anil Meena     926 Kaveri GRNs      Sunil Dodiya   481 Godawari GRNs
--   Jayshree Negi  773 bills matched    Nirmita Bhoi   462 (cover)
insert into public.inward_workflow_owners (step, scope, profile_id, sla_hours) values
  ('grn_confirm', 'Kaveri',   'bc03c372-6eb8-4d21-8a81-6a3d0477402c', 24),  -- Anil Meena
  ('grn_confirm', 'Godawari', 'd29b5e91-f75b-4017-a441-27ac920c7782', 24),  -- Sunil Dodiya
  ('bill_match',  '',         '01def927-7c5b-4bbc-92b1-b10111e7470b', 48),  -- Jayshree Negi
  ('debit_note',  '',         '01def927-7c5b-4bbc-92b1-b10111e7470b', 48)   -- Jayshree Negi
on conflict (step, scope) do nothing;

alter table public.inward_workflow_owners enable row level security;
drop policy if exists iwo_read on public.inward_workflow_owners;
create policy iwo_read on public.inward_workflow_owners
  for select to authenticated using (true);
-- Changed via SQL only: reassigning who gets chased is a deliberate act.
revoke insert, update, delete on public.inward_workflow_owners from authenticated;
revoke all on public.inward_workflow_owners from anon;

comment on table public.inward_workflow_owners is
  'Who owns each inward hand-off and their SLA in hours. Mirrors po_workflow_owners. To hand over during leave: update profile_id here — never in code.';

-- To hand over while someone is on leave:
--   update public.inward_workflow_owners
--      set profile_id = '<profile uuid>', updated_at = now()
--    where step = 'bill_match' and scope = '';


-- ── 3. Where the scorecard starts measuring ────────────────────────────────
-- 190 bills are already past 48h, 105 of them over a month old. They must be
-- visible and workable, but they are not this month's performance. The scorecard
-- measures forward from here; the live breach list ignores it and shows all.
create table if not exists public.inward_sla_config (
  id       int primary key default 1,
  constraint inward_sla_config_singleton check (id = 1),
  sla_from timestamptz not null default now()
);
insert into public.inward_sla_config (id) values (1) on conflict (id) do nothing;

alter table public.inward_sla_config enable row level security;
drop policy if exists isc_read on public.inward_sla_config;
create policy isc_read on public.inward_sla_config
  for select to authenticated using (true);
revoke insert, update, delete on public.inward_sla_config from authenticated;
revoke all on public.inward_sla_config from anon;

comment on column public.inward_sla_config.sla_from is
  'The scorecard percentage measures only hand-offs starting at or after this instant. Protects the opening backlog of 190 already-breaching bills from being read as current performance. The live breach list is NOT filtered by it.';

commit;
