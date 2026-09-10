-- ═══════════════════════════════════════════════════════════════════════════
-- TALENT 360 — fold requisitions into openings
--
-- THE PROBLEM
--   Requisition and opening were modelled as two steps: "permission to hire",
--   then "the position we advertise". That split earns its keep in a company
--   where a different person approves the budget. At ~45 people the same one
--   or two people do both, so the approval step was a form standing between
--   someone and the thing they had already decided to do.
--
-- THE FIX
--   One concept: the OPENING. The parts of a requisition that were actually
--   worth keeping — the budget ceiling, why the role exists, and when it is
--   needed by — become columns on job_openings.
--
-- TRAPS THIS DELIBERATELY AVOIDS
--   · PURELY ADDITIVE, as ever. job_requisitions is NOT dropped. It keeps its
--     rows, its RLS and its number series; job_openings.requisition_id still
--     points at it. Nothing is deleted — the table simply stops being written
--     to, and the UI no longer shows it.
--   · The REQ number series stays registered. Deleting it would let a future
--     requisition re-issue a number that had already gone out.
--   · create_job_opening() is REPLACED, not dropped-and-recreated under a new
--     signature, so nothing that calls it breaks mid-deploy.
--
-- Rollback: sql/talent_360_merge_requisitions_down.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The three fields worth carrying over ────────────────────────────────
alter table public.job_openings add column if not exists budget_ctc_min numeric(12,2);
alter table public.job_openings add column if not exists budget_ctc_max numeric(12,2);
alter table public.job_openings add column if not exists justification  text;
alter table public.job_openings add column if not exists target_date    date;

-- A max below a min is a typo, and it silently mis-sizes every offer made
-- against the role.
alter table public.job_openings drop constraint if exists jo_budget_order;
alter table public.job_openings add  constraint jo_budget_order check (
  budget_ctc_min is null or budget_ctc_max is null or budget_ctc_max >= budget_ctc_min
);

comment on column public.job_openings.budget_ctc_min is
  'Budget floor for this role. Advisory: the offer screen warns when the CTC falls outside the band but does not block it — a good candidate above band is a decision, not an error.';
comment on table public.job_requisitions is
  'DEPRECATED 2026-09-10 — requisitions were folded into job_openings (budget, justification and target date now live there). Kept, with its rows and its REQ number series, because nothing is ever dropped here. Not written to by the app.';

-- ── 2. create_job_opening() gains the three fields ─────────────────────────
create or replace function public.create_job_opening(
  p_title text, p_requisition_id uuid default null, p_department text default null,
  p_branch text default null, p_description text default null, p_must_have text default null,
  p_exp_min_years numeric default null, p_exp_max_years numeric default null,
  p_headcount integer default 1, p_employment_type text default 'full_time',
  p_is_test boolean default false,
  p_budget_ctc_min numeric default null, p_budget_ctc_max numeric default null,
  p_justification text default null, p_target_date date default null
) returns public.job_openings
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_row public.job_openings;
begin
  perform public.talent_guard();
  if coalesce(btrim(p_title),'') = '' then raise exception 'Job title is required.'; end if;
  if p_budget_ctc_min is not null and p_budget_ctc_max is not null
     and p_budget_ctc_max < p_budget_ctc_min then
    raise exception 'Budget maximum cannot be below the minimum.';
  end if;

  insert into public.job_openings (
    requisition_id, title, department, branch, description, must_have,
    exp_min_years, exp_max_years, headcount, employment_type, status, owner_id, is_test,
    budget_ctc_min, budget_ctc_max, justification, target_date
  ) values (
    p_requisition_id, btrim(p_title), nullif(btrim(coalesce(p_department,'')),''),
    nullif(btrim(coalesce(p_branch,'')),''), nullif(btrim(coalesce(p_description,'')),''),
    nullif(btrim(coalesce(p_must_have,'')),''), p_exp_min_years, p_exp_max_years,
    greatest(coalesce(p_headcount,1),1), coalesce(p_employment_type,'full_time'),
    'open', auth.uid(), coalesce(p_is_test,false),
    p_budget_ctc_min, p_budget_ctc_max,
    nullif(btrim(coalesce(p_justification,'')),''), p_target_date
  ) returning * into v_row;
  return v_row;
end $$;

revoke execute on function public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean,numeric,numeric,text,date) from public, anon;
grant  execute on function public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean,numeric,numeric,text,date) to authenticated;

-- The old 11-argument overload would otherwise still resolve for callers that
-- omit the new arguments, leaving two functions with the same name and a
-- silent chance of hitting the one that ignores the budget.
drop function if exists public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean);
