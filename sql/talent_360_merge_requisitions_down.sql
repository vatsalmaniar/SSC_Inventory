-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for sql/talent_360_merge_requisitions.sql
--
-- Restores create_job_opening() to its 11-argument form and drops the
-- 15-argument one, so the Requisitions flow can be brought back.
--
-- DELIBERATELY NOT REVERSED: the four columns on job_openings
-- (budget_ctc_min, budget_ctc_max, justification, target_date). They are
-- nullable and may hold real data typed by a user; dropping them to undo a
-- UI decision would destroy it. They simply stop being written to.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.create_job_opening(text,uuid,text,text,text,text,numeric,numeric,integer,text,boolean,numeric,numeric,text,date);

create or replace function public.create_job_opening(
  p_title text, p_requisition_id uuid default null, p_department text default null,
  p_branch text default null, p_description text default null, p_must_have text default null,
  p_exp_min_years numeric default null, p_exp_max_years numeric default null,
  p_headcount integer default 1, p_employment_type text default 'full_time',
  p_is_test boolean default false
) returns public.job_openings
language plpgsql
security definer
set search_path to public, pg_temp
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

comment on table public.job_requisitions is null;
