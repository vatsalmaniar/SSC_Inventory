-- ═══════════════════════════════════════════════════════════════════════════
-- TALENT 360 — hiring pipeline for People 360
--
-- THE PROBLEM
--   People 360 begins at the moment someone is already an employee. The
--   vacancy, the CVs, the interview feedback, the reference calls and the
--   offer all live in WhatsApp, mailboxes and a shared drive. When the person
--   joins, that context is gone and their details are re-keyed off a CV.
--
-- THE FIX
--   Requisition → Opening → Candidate → Interview → Reference → Offer →
--   Joined, with the documents and the decision trail kept, and the joined
--   candidate handed to the EXISTING employee-creation path.
--
-- TRAPS THIS DELIBERATELY AVOIDS
--   · PURELY ADDITIVE. New tables only. The single touch to an existing table
--     is two NULLABLE columns on notifications (a candidate has no profiles
--     row, so no current email path can reach them). No DROP, no ALTER TYPE,
--     no rename, no backfill, no existing policy/view/function/index changed,
--     and NO new trigger on any existing table — so no existing write path
--     gets slower.
--   · NO ANONYMOUS ACCESS. A public offer-viewer was considered and rejected.
--     anon gets zero grants here. Note DEFAULT PRIVILEGES silently re-grants
--     anon on every NEW function — the revokes below are therefore explicit
--     and must be re-verified AFTER this runs, not assumed.
--   · NO CRON, NO SWEEPER. An offer past valid_till is derived as lapsed on
--     read; nothing sweeps the table. A prior scheduled job took this database
--     down and the plan is burstable.
--   · admin + management ONLY. Offered CTC is as sensitive as
--     employee_compensation and never reaches a sales/staff role.
--   · Offer numbers come from next_doc_seq('OFR'), never MAX+1, allocated
--     inside the writing transaction. OFR is a NEW doc_type, so no existing
--     series moves.
--
-- IDEMPOTENT. Reuses expense_role(), fy_suffix(), next_doc_seq(),
-- set_audit_cols() — all pre-existing.
-- Rollback: sql/talent_360_down.sql (drops ONLY what this file creates).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ═══════════════════════════════════════════════
-- 1. REQUISITIONS — the sanctioned vacancy
-- ═══════════════════════════════════════════════
create table if not exists public.job_requisitions (
  id               uuid primary key default gen_random_uuid(),
  req_no           text unique,
  department       text,
  designation      text not null,
  headcount        integer not null default 1 check (headcount > 0),
  employment_type  text not null default 'full_time'
                     check (employment_type in ('full_time','contract','intern','part_time')),
  branch           text,
  budget_ctc_min   numeric(12,2),
  budget_ctc_max   numeric(12,2),
  justification    text,
  target_date      date,
  status           text not null default 'draft'
                     check (status in ('draft','pending','approved','rejected','closed')),
  raised_by        uuid references public.profiles(id) on delete set null,
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz,
  reject_reason    text,
  is_test          boolean not null default false,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint jr_budget_order check (
    budget_ctc_min is null or budget_ctc_max is null or budget_ctc_max >= budget_ctc_min
  )
);

-- ═══════════════════════════════════════════════
-- 2. OPENINGS — what we are actually advertising
-- ═══════════════════════════════════════════════
create table if not exists public.job_openings (
  id              uuid primary key default gen_random_uuid(),
  requisition_id  uuid references public.job_requisitions(id) on delete set null,
  title           text not null,
  department      text,
  branch          text,
  description     text,
  must_have       text,
  employment_type text not null default 'full_time'
                    check (employment_type in ('full_time','contract','intern','part_time')),
  exp_min_years   numeric(4,1),
  exp_max_years   numeric(4,1),
  headcount       integer not null default 1 check (headcount > 0),
  filled_count    integer not null default 0 check (filled_count >= 0),
  status          text not null default 'open'
                    check (status in ('open','on_hold','filled','closed')),
  owner_id        uuid references public.profiles(id) on delete set null,
  is_test         boolean not null default false,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 3. CANDIDATES — a PERSON, not an application.
--    The same person may apply more than once; the pipeline row is
--    applications, below.
-- ═══════════════════════════════════════════════
create table if not exists public.candidates (
  id                     uuid primary key default gen_random_uuid(),
  full_name              text not null,
  phone                  text,
  email                  text,
  location               text,
  current_employer       text,
  current_designation    text,
  total_experience_years numeric(4,1),
  current_ctc            numeric(12,2),
  expected_ctc           numeric(12,2),
  notice_period_days     integer,
  source                 text not null default 'direct'
                           check (source in ('referral','naukri','linkedin','consultant','walk_in','direct','other')),
  source_detail          text,                                   -- consultant name, portal ref…
  referred_by            uuid references public.employees(id) on delete set null,
  notes                  text,
  is_test                boolean not null default false,
  created_by             uuid,
  updated_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 4. APPLICATIONS — the pipeline row (candidate × opening)
--    Stage list mirrors src/lib/talentStage.js. Keep the two in step.
-- ═══════════════════════════════════════════════
create table if not exists public.applications (
  id               uuid primary key default gen_random_uuid(),
  candidate_id     uuid not null references public.candidates(id) on delete cascade,
  opening_id       uuid not null references public.job_openings(id) on delete cascade,
  stage            text not null default 'applied'
                     check (stage in ('applied','screening','interview','reference','offer','joined','rejected','dropped_out')),
  stage_changed_at timestamptz not null default now(),
  owner_id         uuid references public.profiles(id) on delete set null,
  applied_on       date not null default current_date,
  rejected_reason  text,
  dropout_reason   text,
  is_test          boolean not null default false,
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (candidate_id, opening_id)
);

-- ═══════════════════════════════════════════════
-- 5. INTERVIEWS — rounds + scorecards
--    ratings is per-competency jsonb: {"communication":4,"technical":3,…}
-- ═══════════════════════════════════════════════
create table if not exists public.interviews (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.applications(id) on delete cascade,
  round_no        integer not null default 1 check (round_no > 0),
  round_type      text not null default 'screening'
                    check (round_type in ('screening','technical','hr','management','other')),
  scheduled_at    timestamptz,
  interviewer_id  uuid references public.employees(id) on delete set null,
  outcome         text not null default 'pending'
                    check (outcome in ('pending','selected','rejected','on_hold','no_show')),
  overall_rating  integer check (overall_rating between 1 and 5),
  ratings         jsonb not null default '{}'::jsonb,
  notes           text,
  is_test         boolean not null default false,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 6. REFERENCE CHECKS — who we called and what they said
-- ═══════════════════════════════════════════════
create table if not exists public.reference_checks (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references public.applications(id) on delete cascade,
  referee_name       text not null,
  referee_company    text,
  referee_designation text,
  referee_phone      text,
  relationship       text,
  checked_by         uuid references public.profiles(id) on delete set null,
  checked_at         timestamptz,
  verdict            text not null default 'pending'
                       check (verdict in ('pending','positive','mixed','negative','unreachable')),
  notes              text,
  is_test            boolean not null default false,
  created_by         uuid,
  updated_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 7. OFFERS — one per application. The NUMBER lives here and never changes;
--    the money lives on offer_versions so a renegotiation is a new revision,
--    not an overwrite.
-- ═══════════════════════════════════════════════
create table if not exists public.offers (
  id                    uuid primary key default gen_random_uuid(),
  application_id        uuid not null references public.applications(id) on delete cascade,
  offer_no              text not null unique,
  designation           text not null,
  department            text,
  branch                text,
  -- An intern is offered a stipend for a fixed period, not a salary structure.
  -- The letter, the money field and the clauses all follow this.
  employment_type       text not null default 'full_time'
                          check (employment_type in ('full_time','contract','intern','part_time')),
  internship_months     integer check (internship_months is null or internship_months > 0),
  proposed_join_date    date,
  reporting_address     text,
  valid_till            date,
  status                text not null default 'draft'
                          check (status in ('draft','sent','accepted','declined','lapsed','revoked')),
  sent_at               timestamptz,
  responded_at          timestamptz,
  decline_reason        text,
  converted_employee_id uuid references public.employees(id) on delete set null,
  is_test               boolean not null default false,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 8. OFFER VERSIONS — the negotiation history.
--    inputs + the computed breakup are BOTH frozen per version: the inputs so
--    a revision can reopen the calculator where the last one left off, the
--    breakup so a letter reprints identically years later even if the salary
--    formula is retuned. Exactly one version is current per offer.
-- ═══════════════════════════════════════════════
create table if not exists public.offer_versions (
  id                   uuid primary key default gen_random_uuid(),
  offer_id             uuid not null references public.offers(id) on delete cascade,
  version              integer not null check (version > 0),
  -- For a salaried offer this is the real annual CTC and `breakup` carries the
  -- full structure. For an INTERN it is stipend_monthly x 12 — an annualised
  -- equivalent kept only so the Offers list has one comparable money column;
  -- the intern letter never prints it, and `breakup` is left empty because an
  -- internship has no PF/gratuity/Annexure A.
  annual_ctc           numeric(12,2) not null,
  stipend_monthly      numeric(12,2),
  salary_ratio         text,                     -- e.g. '50 / 20 / 10 / 20'
  tax_regime           text not null default 'new' check (tax_regime in ('old','new')),
  pf_applicable        boolean not null default false,
  professional_tax     numeric(10,2) not null default 200,
  accidental_insurance numeric(10,2) not null default 128,
  breakup              jsonb not null default '{}'::jsonb,   -- computeStructure() output, frozen
  letter_path          text,
  revision_reason      text,
  is_current           boolean not null default true,
  superseded_at        timestamptz,
  is_test              boolean not null default false,
  created_by           uuid,
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (offer_id, version)
);

-- Exactly one live version per offer.
create unique index if not exists ov_one_current
  on public.offer_versions(offer_id) where is_current;

-- ═══════════════════════════════════════════════
-- 9. DOCUMENTS — CV, ID proof, certificates, offer letter.
--    candidate_id is ALWAYS set (it is the storage folder); application_id /
--    offer_version_id narrow it when the document belongs to one of those.
-- ═══════════════════════════════════════════════
create table if not exists public.talent_documents (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references public.candidates(id) on delete cascade,
  application_id    uuid references public.applications(id) on delete set null,
  offer_version_id  uuid references public.offer_versions(id) on delete set null,
  doc_type          text not null default 'other'
                      check (doc_type in ('cv','id_proof','address_proof','education',
                                          'experience_letter','relieving_letter','salary_slip',
                                          'photograph','offer_letter','other')),
  file_path         text not null,
  file_name         text,
  uploaded_by       uuid references public.profiles(id) on delete set null,
  is_test           boolean not null default false,
  created_by        uuid,
  updated_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 10. COMMENTS + ACTIVITY — one table, is_activity separates system events
--     from human comments. Mirrors po_comments so the timeline renderer and
--     @mention handling carry over unchanged.
-- ═══════════════════════════════════════════════
create table if not exists public.talent_comments (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_name    text,
  message        text not null,
  tagged_users   text[],
  is_activity    boolean not null default false,
  is_test        boolean not null default false,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ═══════════════════════════════════════════════
-- 11. INDEXES — all on NEW tables only. No existing index is touched.
-- ═══════════════════════════════════════════════
create index if not exists jr_status_idx      on public.job_requisitions(status) where not is_test;
create index if not exists jo_req_idx         on public.job_openings(requisition_id);
create index if not exists jo_status_idx      on public.job_openings(status) where not is_test;
create index if not exists cand_name_idx      on public.candidates(lower(full_name));
create index if not exists cand_phone_idx     on public.candidates(phone);
create index if not exists cand_email_idx     on public.candidates(lower(email));
create index if not exists app_opening_idx    on public.applications(opening_id);
create index if not exists app_candidate_idx  on public.applications(candidate_id);
create index if not exists app_stage_idx      on public.applications(stage) where not is_test;
create index if not exists iv_app_idx         on public.interviews(application_id);
create index if not exists iv_sched_idx       on public.interviews(scheduled_at) where outcome = 'pending';
create index if not exists rc_app_idx         on public.reference_checks(application_id);
create index if not exists off_app_idx        on public.offers(application_id);
create index if not exists off_status_idx     on public.offers(status) where not is_test;
create index if not exists ov_offer_idx       on public.offer_versions(offer_id);
create index if not exists td_candidate_idx   on public.talent_documents(candidate_id);
create index if not exists td_app_idx         on public.talent_documents(application_id);
create index if not exists tc_app_idx         on public.talent_comments(application_id, created_at);

-- ═══════════════════════════════════════════════
-- 12. AUDIT TRIGGERS — on the NEW tables only.
--     set_audit_cols() already exists (audit_columns_rollout.sql).
-- ═══════════════════════════════════════════════
do $$
declare t text;
  targets text[] := array[
    'job_requisitions','job_openings','candidates','applications','interviews',
    'reference_checks','offers','offer_versions','talent_documents','talent_comments'
  ];
begin
  foreach t in array targets loop
    execute format('drop trigger if exists trg_audit_cols on public.%I', t);
    execute format('create trigger trg_audit_cols before insert or update on public.%I
                    for each row execute function set_audit_cols()', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════
-- 13. RLS + GRANTS — read-only to the client, admin + management ONLY.
--
--     THE MODEL: the browser may SELECT. It may NOT insert, update or delete
--     anything here. Every write goes through a SECURITY DEFINER RPC in
--     section 18, which checks the caller's role itself. This is the same
--     rule the item master runs under, and it is why a stray page bug (or a
--     forged PostgREST call from a signed-in browser) cannot rewrite a
--     candidate's offered CTC or quietly flip an application to 'joined'.
--
--     Two independent locks, deliberately:
--       1. RLS SELECT policy — admin/management only.
--       2. REVOKE insert/update/delete — so even a future policy mistake
--          cannot open a write path.
--
--     expense_role() is SECURITY DEFINER, so it does not recurse into
--     profiles' own RLS.
--
--     VERIFY AS A REAL AUTHENTICATED ADMIN — backend SQL runs as postgres and
--     bypasses RLS entirely, which is how a wide-open policy has shipped here
--     before.
-- ═══════════════════════════════════════════════
do $$
declare t text;
  targets text[] := array[
    'job_requisitions','job_openings','candidates','applications','interviews',
    'reference_checks','offers','offer_versions','talent_documents','talent_comments'
  ];
begin
  foreach t in array targets loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    -- PERMISSIVE (the default). A RESTRICTIVE policy ANDs against everything
    -- and is not what is wanted here.
    execute format($f$
      create policy %I on public.%I for select to authenticated
        using (public.expense_role() = any(array['admin','management']))
    $f$, t || '_read', t);

    -- The client reads. It never writes directly.
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ═══════════════════════════════════════════════
-- 14. OFFER NUMBER RANGE — 'OFR' is a brand-new doc_type, so no existing
--     series moves. Format matches the letters already issued by hand:
--     SSC/HR/OFR/0001/26-27
-- ═══════════════════════════════════════════════
create or replace function public.generate_offer_number(p_fy text default null)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_fy text; v_seq int;
begin
  v_fy  := coalesce(p_fy, fy_suffix());
  v_seq := next_doc_seq('OFR', v_fy);
  return 'SSC/HR/OFR/' ||
    case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end ||
    '/' || v_fy;
end $$;

-- DEFAULT PRIVILEGES re-grants anon on every NEW function. This revoke is not
-- optional and must be re-verified after this migration runs.
revoke execute on function public.generate_offer_number(text) from public, anon;
grant  execute on function public.generate_offer_number(text) to authenticated;

comment on function public.generate_offer_number(text) is
  'Allocates the next offer number from the OFR range via next_doc_seq(). Call INSIDE the transaction that writes the offer, so a failed write rolls the counter back. Never MAX+1.';

-- Requisitions get their own series — 'REQ' is likewise a brand-new doc_type.
create or replace function public.generate_requisition_number(p_fy text default null)
returns text
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_fy text; v_seq int;
begin
  v_fy  := coalesce(p_fy, fy_suffix());
  v_seq := next_doc_seq('REQ', v_fy);
  return 'SSC/HR/REQ/' ||
    case when v_seq > 9999 then v_seq::text else lpad(v_seq::text, 4, '0') end ||
    '/' || v_fy;
end $$;

revoke execute on function public.generate_requisition_number(text) from public, anon;
grant  execute on function public.generate_requisition_number(text) to authenticated;

-- ═══════════════════════════════════════════════
-- 14b. CREATORS — allocate AND write in ONE transaction.
--
--   This is the whole point of the number-range design and it is easy to get
--   wrong. Calling generate_*_number() from the browser and then INSERTing in
--   a second call means a refused insert leaves the counter advanced: the
--   number is burnt and the series has a hole with no document. The PO series
--   burnt seven numbers exactly that way. admin_create_item() is the model —
--   allocate inside the function that writes the row, so a failed write rolls
--   the counter back with it.
--
--   The generate_* functions above stay for previews and for a reissue that
--   deliberately wants a fresh number, but the CREATE path must use these.
-- ═══════════════════════════════════════════════
create or replace function public.create_job_requisition(
  p_designation      text,
  p_department       text default null,
  p_headcount        integer default 1,
  p_employment_type  text default 'full_time',
  p_branch           text default null,
  p_budget_ctc_min   numeric default null,
  p_budget_ctc_max   numeric default null,
  p_justification    text default null,
  p_target_date      date default null,
  p_status           text default 'draft',
  p_is_test          boolean default false
) returns public.job_requisitions
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_row public.job_requisitions; v_no text;
begin
  if public.expense_role() is distinct from 'admin' and public.expense_role() is distinct from 'management' then
    raise exception 'Not authorised to raise a requisition.';
  end if;
  if coalesce(btrim(p_designation), '') = '' then
    raise exception 'Designation is required.';
  end if;
  if p_status not in ('draft','pending') then
    raise exception 'A new requisition can only be created as draft or pending.';
  end if;

  v_no := public.generate_requisition_number(null);

  insert into public.job_requisitions (
    req_no, department, designation, headcount, employment_type, branch,
    budget_ctc_min, budget_ctc_max, justification, target_date, status, raised_by, is_test
  ) values (
    v_no, nullif(btrim(coalesce(p_department,'')), ''), btrim(p_designation),
    greatest(coalesce(p_headcount,1), 1), p_employment_type,
    nullif(btrim(coalesce(p_branch,'')), ''),
    p_budget_ctc_min, p_budget_ctc_max,
    nullif(btrim(coalesce(p_justification,'')), ''), p_target_date,
    p_status, auth.uid(), coalesce(p_is_test, false)
  ) returning * into v_row;

  return v_row;
end $$;

revoke execute on function public.create_job_requisition(text,text,integer,text,text,numeric,numeric,text,date,text,boolean) from public, anon;
grant  execute on function public.create_job_requisition(text,text,integer,text,text,numeric,numeric,text,date,text,boolean) to authenticated;

-- Offers: same rule. One application gets one offer; a renegotiation is a new
-- VERSION of it, never a second offer with a second number.
create or replace function public.create_offer(
  p_application_id     uuid,
  p_designation        text,
  p_department         text default null,
  p_branch             text default null,
  p_proposed_join_date date default null,
  p_reporting_address  text default null,
  p_valid_till         date default null,
  p_annual_ctc         numeric default 0,
  p_salary_ratio       text default null,
  p_tax_regime         text default 'new',
  p_pf_applicable      boolean default false,
  p_professional_tax   numeric default 200,
  p_accidental_insurance numeric default 128,
  p_breakup            jsonb default '{}'::jsonb,
  p_is_test            boolean default false,
  p_employment_type    text default 'full_time',
  p_internship_months  integer default null,
  p_stipend_monthly    numeric default null
) returns public.offers
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_row public.offers; v_no text; v_intern boolean; v_ctc numeric;
begin
  if public.expense_role() is distinct from 'admin' and public.expense_role() is distinct from 'management' then
    raise exception 'Not authorised to raise an offer.';
  end if;
  if exists (select 1 from public.offers where application_id = p_application_id) then
    raise exception 'This application already has an offer. Revise it instead of raising a second one.';
  end if;

  v_intern := coalesce(p_employment_type,'full_time') = 'intern';
  if v_intern then
    if coalesce(p_stipend_monthly, 0) <= 0 then
      raise exception 'Enter the monthly stipend for an internship.';
    end if;
    if coalesce(p_internship_months, 0) <= 0 then
      raise exception 'Enter how many months the internship runs for.';
    end if;
    -- Annualised equivalent only, so the Offers list has one comparable column.
    v_ctc := p_stipend_monthly * 12;
  else
    v_ctc := coalesce(p_annual_ctc, 0);
  end if;

  v_no := public.generate_offer_number(null);

  insert into public.offers (
    application_id, offer_no, designation, department, branch,
    employment_type, internship_months,
    proposed_join_date, reporting_address, valid_till, status, is_test
  ) values (
    p_application_id, v_no, btrim(p_designation),
    nullif(btrim(coalesce(p_department,'')), ''), nullif(btrim(coalesce(p_branch,'')), ''),
    coalesce(p_employment_type,'full_time'), case when v_intern then p_internship_months end,
    p_proposed_join_date, nullif(btrim(coalesce(p_reporting_address,'')), ''),
    p_valid_till, 'draft', coalesce(p_is_test, false)
  ) returning * into v_row;

  -- Version 1 is written in the same transaction: an offer with no money on it
  -- is not an offer, and a half-made one would show a number with a blank
  -- Annexure A. An internship carries a stipend and no breakup at all.
  insert into public.offer_versions (
    offer_id, version, annual_ctc, stipend_monthly, salary_ratio, tax_regime, pf_applicable,
    professional_tax, accidental_insurance, breakup, is_current, is_test
  ) values (
    v_row.id, 1, v_ctc, case when v_intern then p_stipend_monthly end,
    case when v_intern then null else p_salary_ratio end, coalesce(p_tax_regime,'new'),
    coalesce(p_pf_applicable, false), coalesce(p_professional_tax, 200),
    coalesce(p_accidental_insurance, 128),
    case when v_intern then '{}'::jsonb else coalesce(p_breakup, '{}'::jsonb) end, true,
    coalesce(p_is_test, false)
  );

  return v_row;
end $$;

revoke execute on function public.create_offer(uuid,text,text,text,date,text,date,numeric,text,text,boolean,numeric,numeric,jsonb,boolean,text,integer,numeric) from public, anon;
grant  execute on function public.create_offer(uuid,text,text,text,date,text,date,numeric,text,text,boolean,numeric,numeric,jsonb,boolean,text,integer,numeric) to authenticated;

-- A revision supersedes the current version atomically. Doing this as two
-- browser calls could leave an offer with two current versions (or none),
-- which the ov_one_current index would then reject at a random moment.
create or replace function public.revise_offer(
  p_offer_id           uuid,
  p_annual_ctc         numeric,
  p_salary_ratio       text default null,
  p_tax_regime         text default 'new',
  p_pf_applicable      boolean default false,
  p_professional_tax   numeric default 200,
  p_accidental_insurance numeric default 128,
  p_breakup            jsonb default '{}'::jsonb,
  p_revision_reason    text default null,
  p_stipend_monthly    numeric default null
) returns public.offer_versions
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_row public.offer_versions; v_next int; v_status text; v_test boolean;
        v_intern boolean; v_ctc numeric;
begin
  if public.expense_role() is distinct from 'admin' and public.expense_role() is distinct from 'management' then
    raise exception 'Not authorised to revise an offer.';
  end if;

  select status, is_test, employment_type = 'intern'
    into v_status, v_test, v_intern
    from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_status in ('accepted','revoked') then
    raise exception 'A % offer cannot be revised.', v_status;
  end if;

  if v_intern then
    if coalesce(p_stipend_monthly, 0) <= 0 then
      raise exception 'Enter the revised monthly stipend.';
    end if;
    v_ctc := p_stipend_monthly * 12;
  else
    v_ctc := coalesce(p_annual_ctc, 0);
  end if;

  update public.offer_versions
     set is_current = false, superseded_at = now()
   where offer_id = p_offer_id and is_current;

  select coalesce(max(version), 0) + 1 into v_next
    from public.offer_versions where offer_id = p_offer_id;

  insert into public.offer_versions (
    offer_id, version, annual_ctc, stipend_monthly, salary_ratio, tax_regime, pf_applicable,
    professional_tax, accidental_insurance, breakup, revision_reason, is_current, is_test
  ) values (
    p_offer_id, v_next, v_ctc, case when v_intern then p_stipend_monthly end,
    case when v_intern then null else p_salary_ratio end, coalesce(p_tax_regime,'new'),
    coalesce(p_pf_applicable,false), coalesce(p_professional_tax,200),
    coalesce(p_accidental_insurance,128),
    case when v_intern then '{}'::jsonb else coalesce(p_breakup,'{}'::jsonb) end,
    nullif(btrim(coalesce(p_revision_reason,'')), ''), true, coalesce(v_test,false)
  ) returning * into v_row;

  -- A revised offer is no longer the one that was sent.
  update public.offers set status = 'draft', sent_at = null
   where id = p_offer_id and status = 'sent';

  return v_row;
end $$;

revoke execute on function public.revise_offer(uuid,numeric,text,text,boolean,numeric,numeric,jsonb,text,numeric) from public, anon;
grant  execute on function public.revise_offer(uuid,numeric,text,text,boolean,numeric,numeric,jsonb,text,numeric) to authenticated;

-- ═══════════════════════════════════════════════
-- 15. NOTIFICATIONS — the ONLY existing table touched, two NULLABLE columns.
--     A candidate has no profiles row, so send-email-notification (which
--     resolves the recipient by user_id) cannot reach them. These carry an
--     external recipient; the edge function honours them ONLY when user_id is
--     null AND the email_type is on its candidate whitelist.
--     Nullable ADD COLUMN only — no default, no backfill, no rewrite, and
--     every existing row and code path is unaffected.
-- ═══════════════════════════════════════════════
alter table public.notifications add column if not exists recipient_email text;
alter table public.notifications add column if not exists recipient_name  text;

comment on column public.notifications.recipient_email is
  'External recipient (candidate) with no profiles row. Honoured by send-email-notification ONLY when user_id is null and email_type is whitelisted. Null for every normal in-app notification.';

-- ═══════════════════════════════════════════════
-- 16. STORAGE — two PRIVATE buckets, signed URLs only.
--     NOT the getPublicUrl pattern used by vendor-docs/po-documents: CVs and
--     ID proofs are personal data.
--     The foldername = auth.uid() idiom does NOT apply here — the folder is
--     the candidate/employee, not the uploader — so access is by role.
--     talent-docs   : <candidate_id>/<doc_type>/<ts>-<name>
--     employee-docs : <employee_id>/<doc_type>/<ts>-<name>
--                     (wires the employee_documents chips that have been
--                      rendered but dead on the People 360 profile)
-- ═══════════════════════════════════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talent-docs','talent-docs', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif',
              'application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/html'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-docs','employee-docs', false, 10485760,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif',
              'application/pdf','application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/html'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "talentdoc_insert" on storage.objects;
drop policy if exists "talentdoc_read"   on storage.objects;
drop policy if exists "talentdoc_update" on storage.objects;
drop policy if exists "talentdoc_delete" on storage.objects;
create policy "talentdoc_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'talent-docs' and public.expense_role() = any(array['admin','management']));
create policy "talentdoc_read" on storage.objects for select to authenticated
  using (bucket_id = 'talent-docs' and public.expense_role() = any(array['admin','management']));
create policy "talentdoc_update" on storage.objects for update to authenticated
  using (bucket_id = 'talent-docs' and public.expense_role() = any(array['admin','management']));
create policy "talentdoc_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'talent-docs' and public.expense_role() = 'admin');

-- employee-docs: admin/management write; the employee may READ their own.
drop policy if exists "empdoc_insert" on storage.objects;
drop policy if exists "empdoc_read"   on storage.objects;
drop policy if exists "empdoc_update" on storage.objects;
drop policy if exists "empdoc_delete" on storage.objects;
create policy "empdoc_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-docs' and public.expense_role() = any(array['admin','management']));
create policy "empdoc_read" on storage.objects for select to authenticated
  using (bucket_id = 'employee-docs' and (
    public.expense_role() = any(array['admin','management'])
    or exists (select 1 from public.employees e
                where e.profile_id = auth.uid()
                  and e.id::text = (storage.foldername(name))[1])
  ));
create policy "empdoc_update" on storage.objects for update to authenticated
  using (bucket_id = 'employee-docs' and public.expense_role() = any(array['admin','management']));
create policy "empdoc_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'employee-docs' and public.expense_role() = 'admin');

-- ═══════════════════════════════════════════════
-- 17. TABLE COMMENTS
-- ═══════════════════════════════════════════════
comment on table public.candidates is
  'A PERSON, not an application. The same person may apply to several openings; the pipeline row is applications.';
comment on table public.offer_versions is
  'Negotiation history. The offer number never changes; a revision is a new version. Exactly one is_current per offer (ov_one_current).';
comment on table public.talent_comments is
  'Timeline for an application. is_activity = system event, false = human comment. Same shape as po_comments.';
comment on column public.offers.valid_till is
  'An offer past this date DISPLAYS as lapsed and cannot be accepted — derived on read. Nothing sweeps this table; the status is stamped only when a human next acts on it.';

-- ═══════════════════════════════════════════════
-- 18. THE WRITE API — every mutation, admin + management only.
--
--   Section 13 revoked insert/update/delete from the browser, so these are the
--   ONLY way anything in Talent 360 changes. Each one is SECURITY DEFINER (it
--   runs as the owner, bypassing RLS) and therefore MUST check the caller's
--   role itself — a definer function that forgets is an open door.
--
--   auth.uid() still resolves inside a definer function, so the audit trigger
--   stamps the real actor rather than the owner.
-- ═══════════════════════════════════════════════

-- One guard, used by all of them. Raising here beats returning null: the page
-- shows the message instead of silently doing nothing.
create or replace function public.talent_guard()
returns void
language plpgsql
security definer
set search_path to public, pg_temp
as $$
begin
  if public.expense_role() is distinct from 'admin'
     and public.expense_role() is distinct from 'management' then
    raise exception 'Talent 360 is restricted to Admin and Management.';
  end if;
end $$;

revoke execute on function public.talent_guard() from public, anon;
grant  execute on function public.talent_guard() to authenticated;

-- ── Requisitions ───────────────────────────────────────────────────────────
create or replace function public.decide_requisition(
  p_id uuid, p_approved boolean, p_reason text default null
) returns public.job_requisitions
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.job_requisitions;
begin
  perform public.talent_guard();
  update public.job_requisitions
     set status = case when p_approved then 'approved' else 'rejected' end,
         approved_by = auth.uid(), approved_at = now(),
         reject_reason = case when p_approved then null else nullif(btrim(coalesce(p_reason,'')),'') end
   where id = p_id and status = 'pending'
   returning * into v_row;
  if not found then
    raise exception 'That requisition is not awaiting approval any more.';
  end if;
  return v_row;
end $$;
revoke execute on function public.decide_requisition(uuid,boolean,text) from public, anon;
grant  execute on function public.decide_requisition(uuid,boolean,text) to authenticated;

-- ── Openings ───────────────────────────────────────────────────────────────
create or replace function public.create_job_opening(
  p_title text, p_requisition_id uuid default null, p_department text default null,
  p_branch text default null, p_description text default null, p_must_have text default null,
  p_exp_min_years numeric default null, p_exp_max_years numeric default null,
  p_headcount integer default 1, p_employment_type text default 'full_time',
  p_is_test boolean default false
) returns public.job_openings
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.job_openings;
begin
  perform public.talent_guard();
  if coalesce(btrim(p_title),'') = '' then raise exception 'Job title is required.'; end if;

  insert into public.job_openings (
    requisition_id, title, department, branch, description, must_have,
    exp_min_years, exp_max_years, headcount, employment_type, status, owner_id, is_test
  ) values (
    p_requisition_id, btrim(p_title), nullif(btrim(coalesce(p_department,'')),''),
    nullif(btrim(coalesce(p_branch,'')),''), nullif(btrim(coalesce(p_description,'')),''),
    nullif(btrim(coalesce(p_must_have,'')),''), p_exp_min_years, p_exp_max_years,
    greatest(coalesce(p_headcount,1),1), coalesce(p_employment_type,'full_time'),
    'open', auth.uid(), coalesce(p_is_test,false)
  ) returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean) from public, anon;
grant  execute on function public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean) to authenticated;

create or replace function public.set_opening_status(p_id uuid, p_status text)
returns public.job_openings
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.job_openings;
begin
  perform public.talent_guard();
  if p_status not in ('open','on_hold','filled','closed') then
    raise exception 'Unknown opening status "%".', p_status;
  end if;
  update public.job_openings set status = p_status where id = p_id returning * into v_row;
  if not found then raise exception 'Opening not found.'; end if;
  return v_row;
end $$;
revoke execute on function public.set_opening_status(uuid,text) from public, anon;
grant  execute on function public.set_opening_status(uuid,text) to authenticated;

-- ── Candidate + application ────────────────────────────────────────────────
-- A candidate is a PERSON. Matching on phone/email here rather than in the
-- browser means two recruiters adding the same walk-in a minute apart still
-- end up with one person, not two.
create or replace function public.add_candidate_application(
  p_opening_id uuid, p_full_name text,
  p_phone text default null, p_email text default null, p_location text default null,
  p_current_employer text default null, p_current_designation text default null,
  p_total_experience_years numeric default null, p_current_ctc numeric default null,
  p_expected_ctc numeric default null, p_notice_period_days integer default null,
  p_source text default 'direct', p_source_detail text default null,
  p_notes text default null, p_is_test boolean default false
) returns public.applications
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_cand uuid; v_app public.applications; v_phone text; v_email text;
begin
  perform public.talent_guard();
  if coalesce(btrim(p_full_name),'') = '' then raise exception 'Candidate name is required.'; end if;
  if p_opening_id is null then raise exception 'Pick the opening they are applying for.'; end if;

  v_phone := nullif(btrim(coalesce(p_phone,'')),'');
  v_email := lower(nullif(btrim(coalesce(p_email,'')),''));

  if v_phone is not null or v_email is not null then
    select id into v_cand from public.candidates
     where (v_phone is not null and phone = v_phone)
        or (v_email is not null and lower(email) = v_email)
     limit 1;
  end if;

  if v_cand is null then
    insert into public.candidates (
      full_name, phone, email, location, current_employer, current_designation,
      total_experience_years, current_ctc, expected_ctc, notice_period_days,
      source, source_detail, notes, is_test
    ) values (
      btrim(p_full_name), v_phone, v_email, nullif(btrim(coalesce(p_location,'')),''),
      nullif(btrim(coalesce(p_current_employer,'')),''), nullif(btrim(coalesce(p_current_designation,'')),''),
      p_total_experience_years, p_current_ctc, p_expected_ctc, p_notice_period_days,
      coalesce(p_source,'direct'), nullif(btrim(coalesce(p_source_detail,'')),''),
      nullif(btrim(coalesce(p_notes,'')),''), coalesce(p_is_test,false)
    ) returning id into v_cand;
  end if;

  begin
    insert into public.applications (candidate_id, opening_id, stage, owner_id, is_test)
    values (v_cand, p_opening_id, 'applied', auth.uid(), coalesce(p_is_test,false))
    returning * into v_app;
  exception when unique_violation then
    raise exception 'This candidate is already in the pipeline for that opening.';
  end;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (v_app.id, 'Added to the pipeline · source: ' || coalesce(p_source,'direct'),
          coalesce((select name from public.profiles where id = auth.uid()), 'System'),
          true, coalesce(p_is_test,false));

  return v_app;
end $$;
revoke execute on function public.add_candidate_application(uuid,text,text,text,text,text,text,numeric,numeric,numeric,integer,text,text,text,boolean) from public, anon;
grant  execute on function public.add_candidate_application(uuid,text,text,text,text,text,text,numeric,numeric,numeric,integer,text,text,text,boolean) to authenticated;

-- ── Stage moves ────────────────────────────────────────────────────────────
-- 'joined' is refused here on purpose. Joining creates an employee, and a bare
-- stage flip would leave an application claiming a hire with nobody behind it.
-- complete_offer_join() owns that transition.
create or replace function public.move_application_stage(
  p_id uuid, p_stage text, p_reason text default null
) returns public.applications
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.applications; v_who text;
begin
  perform public.talent_guard();
  if p_stage = 'joined' then
    raise exception 'Use Mark joined — joining must create the employee record.';
  end if;
  if p_stage in ('rejected','dropped_out') and coalesce(btrim(coalesce(p_reason,'')),'') = '' then
    raise exception 'A reason is required when closing a candidate out.';
  end if;

  update public.applications
     set stage = p_stage, stage_changed_at = now(),
         rejected_reason = case when p_stage = 'rejected' then btrim(p_reason) else rejected_reason end,
         dropout_reason  = case when p_stage = 'dropped_out' then btrim(p_reason) else dropout_reason end
   where id = p_id
   returning * into v_row;
  if not found then raise exception 'Application not found.'; end if;

  v_who := coalesce((select name from public.profiles where id = auth.uid()), 'System');
  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (p_id, 'Stage → ' || p_stage || coalesce(' · ' || nullif(btrim(coalesce(p_reason,'')),''), ''),
          v_who, true, v_row.is_test);

  return v_row;
end $$;
revoke execute on function public.move_application_stage(uuid,text,text) from public, anon;
grant  execute on function public.move_application_stage(uuid,text,text) to authenticated;

-- ── Interviews ─────────────────────────────────────────────────────────────
create or replace function public.upsert_interview(
  p_application_id uuid, p_round_no integer, p_round_type text,
  p_scheduled_at timestamptz default null, p_interviewer_id uuid default null,
  p_outcome text default 'pending', p_overall_rating integer default null,
  p_ratings jsonb default '{}'::jsonb, p_notes text default null,
  p_id uuid default null
) returns public.interviews
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.interviews; v_test boolean;
begin
  perform public.talent_guard();
  select is_test into v_test from public.applications where id = p_application_id;
  if not found then raise exception 'Application not found.'; end if;

  if p_id is null then
    insert into public.interviews (application_id, round_no, round_type, scheduled_at,
      interviewer_id, outcome, overall_rating, ratings, notes, is_test)
    values (p_application_id, greatest(coalesce(p_round_no,1),1), p_round_type, p_scheduled_at,
      p_interviewer_id, coalesce(p_outcome,'pending'), p_overall_rating,
      coalesce(p_ratings,'{}'::jsonb), nullif(btrim(coalesce(p_notes,'')),''), coalesce(v_test,false))
    returning * into v_row;
  else
    update public.interviews
       set round_no = greatest(coalesce(p_round_no,1),1), round_type = p_round_type,
           scheduled_at = p_scheduled_at, interviewer_id = p_interviewer_id,
           outcome = coalesce(p_outcome,'pending'), overall_rating = p_overall_rating,
           ratings = coalesce(p_ratings,'{}'::jsonb), notes = nullif(btrim(coalesce(p_notes,'')),'')
     where id = p_id returning * into v_row;
    if not found then raise exception 'Interview round not found.'; end if;
  end if;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (p_application_id,
    'Round ' || v_row.round_no || ' (' || v_row.round_type || ') — ' || v_row.outcome,
    coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, coalesce(v_test,false));

  return v_row;
end $$;
revoke execute on function public.upsert_interview(uuid,integer,text,timestamptz,uuid,text,integer,jsonb,text,uuid) from public, anon;
grant  execute on function public.upsert_interview(uuid,integer,text,timestamptz,uuid,text,integer,jsonb,text,uuid) to authenticated;

-- ── Reference checks ───────────────────────────────────────────────────────
create or replace function public.upsert_reference_check(
  p_application_id uuid, p_referee_name text,
  p_referee_company text default null, p_referee_designation text default null,
  p_referee_phone text default null, p_relationship text default null,
  p_verdict text default 'pending', p_notes text default null, p_id uuid default null
) returns public.reference_checks
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.reference_checks; v_test boolean; v_done boolean;
begin
  perform public.talent_guard();
  if coalesce(btrim(p_referee_name),'') = '' then raise exception 'Referee name is required.'; end if;
  select is_test into v_test from public.applications where id = p_application_id;
  if not found then raise exception 'Application not found.'; end if;
  v_done := coalesce(p_verdict,'pending') <> 'pending';

  if p_id is null then
    insert into public.reference_checks (application_id, referee_name, referee_company,
      referee_designation, referee_phone, relationship, verdict, notes, checked_by, checked_at, is_test)
    values (p_application_id, btrim(p_referee_name), nullif(btrim(coalesce(p_referee_company,'')),''),
      nullif(btrim(coalesce(p_referee_designation,'')),''), nullif(btrim(coalesce(p_referee_phone,'')),''),
      nullif(btrim(coalesce(p_relationship,'')),''), coalesce(p_verdict,'pending'),
      nullif(btrim(coalesce(p_notes,'')),''),
      case when v_done then auth.uid() end, case when v_done then now() end, coalesce(v_test,false))
    returning * into v_row;
  else
    update public.reference_checks
       set referee_name = btrim(p_referee_name),
           referee_company = nullif(btrim(coalesce(p_referee_company,'')),''),
           referee_designation = nullif(btrim(coalesce(p_referee_designation,'')),''),
           referee_phone = nullif(btrim(coalesce(p_referee_phone,'')),''),
           relationship = nullif(btrim(coalesce(p_relationship,'')),''),
           verdict = coalesce(p_verdict,'pending'),
           notes = nullif(btrim(coalesce(p_notes,'')),''),
           checked_by = case when v_done then auth.uid() end,
           checked_at = case when v_done then now() end
     where id = p_id returning * into v_row;
    if not found then raise exception 'Reference not found.'; end if;
  end if;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (p_application_id, 'Reference ' || v_row.referee_name || ' — ' || v_row.verdict,
          coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, coalesce(v_test,false));

  return v_row;
end $$;
revoke execute on function public.upsert_reference_check(uuid,text,text,text,text,text,text,text,uuid) from public, anon;
grant  execute on function public.upsert_reference_check(uuid,text,text,text,text,text,text,text,uuid) to authenticated;

-- ── Documents ──────────────────────────────────────────────────────────────
-- The file itself is uploaded to storage by the browser (storage has its own
-- policies); this registers it. Storage upload + this call are two steps, so
-- the page removes the object if this fails — otherwise the bucket grows
-- orphans nobody can see.
create or replace function public.add_talent_document(
  p_candidate_id uuid, p_doc_type text, p_file_path text,
  p_file_name text default null, p_application_id uuid default null,
  p_offer_version_id uuid default null
) returns public.talent_documents
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.talent_documents; v_test boolean;
begin
  perform public.talent_guard();
  if coalesce(btrim(coalesce(p_file_path,'')),'') = '' then raise exception 'File path is required.'; end if;
  select is_test into v_test from public.candidates where id = p_candidate_id;
  if not found then raise exception 'Candidate not found.'; end if;

  insert into public.talent_documents (candidate_id, application_id, offer_version_id,
    doc_type, file_path, file_name, uploaded_by, is_test)
  values (p_candidate_id, p_application_id, p_offer_version_id, coalesce(p_doc_type,'other'),
    p_file_path, nullif(btrim(coalesce(p_file_name,'')),''), auth.uid(), coalesce(v_test,false))
  returning * into v_row;

  if p_application_id is not null then
    insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
    values (p_application_id, coalesce(p_doc_type,'Document') || ' uploaded',
            coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, coalesce(v_test,false));
  end if;
  return v_row;
end $$;
revoke execute on function public.add_talent_document(uuid,text,text,text,uuid,uuid) from public, anon;
grant  execute on function public.add_talent_document(uuid,text,text,text,uuid,uuid) to authenticated;

-- ── Comments ───────────────────────────────────────────────────────────────
-- is_activity is NOT a parameter: a human comment must never be able to
-- disguise itself as a system event on the timeline.
create or replace function public.add_talent_comment(p_application_id uuid, p_message text)
returns public.talent_comments
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.talent_comments; v_test boolean;
begin
  perform public.talent_guard();
  if coalesce(btrim(coalesce(p_message,'')),'') = '' then raise exception 'Write something first.'; end if;
  select is_test into v_test from public.applications where id = p_application_id;
  if not found then raise exception 'Application not found.'; end if;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (p_application_id, btrim(p_message),
          coalesce((select name from public.profiles where id = auth.uid()), 'Unknown'),
          false, coalesce(v_test,false))
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.add_talent_comment(uuid,text) from public, anon;
grant  execute on function public.add_talent_comment(uuid,text) to authenticated;

-- ── Offer status ───────────────────────────────────────────────────────────
-- The lapse rule lives here as well as in the UI: an offer past its validity
-- date cannot be accepted, whatever the page thinks. Nothing sweeps the table
-- — the check happens when someone actually tries to act.
create or replace function public.set_offer_status(
  p_id uuid, p_status text, p_reason text default null
) returns public.offers
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.offers; v_cur public.offers;
begin
  perform public.talent_guard();
  if p_status not in ('sent','accepted','declined','lapsed','revoked') then
    raise exception 'Unknown offer status "%".', p_status;
  end if;
  select * into v_cur from public.offers where id = p_id for update;
  if not found then raise exception 'Offer not found.'; end if;

  if p_status = 'accepted' then
    if v_cur.status <> 'sent' then
      raise exception 'Only an offer that has been sent can be accepted.';
    end if;
    if v_cur.valid_till is not null and v_cur.valid_till < current_date then
      raise exception 'That offer lapsed on %. Revise it and reissue.', to_char(v_cur.valid_till, 'DD Mon YYYY');
    end if;
  end if;
  if p_status = 'declined' and coalesce(btrim(coalesce(p_reason,'')),'') = '' then
    raise exception 'Record why they declined.';
  end if;

  update public.offers
     set status = p_status,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         responded_at = case when p_status in ('accepted','declined') then now() else responded_at end,
         decline_reason = case when p_status = 'declined' then btrim(p_reason) else decline_reason end
   where id = p_id returning * into v_row;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (v_row.application_id,
          'Offer ' || v_row.offer_no || ' → ' || p_status || coalesce(' · ' || nullif(btrim(coalesce(p_reason,'')),''), ''),
          coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, v_row.is_test);
  return v_row;
end $$;
revoke execute on function public.set_offer_status(uuid,text,text) from public, anon;
grant  execute on function public.set_offer_status(uuid,text,text) to authenticated;

-- ── Joining ────────────────────────────────────────────────────────────────
-- Called AFTER the employee exists (createEmployee() in the browser runs the
-- same five steps the Team page does). This closes the loop atomically: link
-- the offer, move the application, and consume a seat on the opening.
create or replace function public.complete_offer_join(p_offer_id uuid, p_employee_id uuid)
returns public.offers
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.offers; v_open uuid; v_filled int; v_head int;
begin
  perform public.talent_guard();
  update public.offers set converted_employee_id = p_employee_id
   where id = p_offer_id returning * into v_row;
  if not found then raise exception 'Offer not found.'; end if;

  update public.applications
     set stage = 'joined', stage_changed_at = now()
   where id = v_row.application_id
   returning opening_id into v_open;

  if v_open is not null then
    update public.job_openings
       set filled_count = filled_count + 1
     where id = v_open
     returning filled_count, headcount into v_filled, v_head;
    if v_filled >= v_head then
      update public.job_openings set status = 'filled' where id = v_open;
    end if;
  end if;

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (v_row.application_id, 'Joined — employee record created',
          coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, v_row.is_test);
  return v_row;
end $$;
revoke execute on function public.complete_offer_join(uuid,uuid) from public, anon;
grant  execute on function public.complete_offer_join(uuid,uuid) to authenticated;
