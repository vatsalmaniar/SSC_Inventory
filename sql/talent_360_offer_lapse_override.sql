-- ═══════════════════════════════════════════════════════════════════════════
-- TALENT 360 — a lapsed offer can be extended, or accepted on the record
--
-- THE PROBLEM
--   Firdos Pathan accepted SSC/HR/OFR/0002/26-27 on 18 Sep. Its valid_till was
--   16 Sep, so set_offer_status() refused: "That offer lapsed on 16 Sep 2026."
--   There was no way to record what had actually happened. The offer would
--   have sat at 'sent' forever, the dashboard would have kept counting it as
--   awaiting response, and the eventual joiner would have had no accepted
--   offer behind them.
--
--   The guard treated a validity date as a legal cutoff. It is not. It is a
--   deadline we set to create urgency, and candidates routinely answer a few
--   days late. A system that cannot record a real event is worse than a stale
--   date: it makes the data untrue.
--
-- THE FIX — two honest paths, neither of which hides the lapse:
--   1. extend_offer_validity() — HR moves the date, with a reason. This is
--      what actually happens when someone asks for the weekend to decide.
--   2. set_offer_status(..., p_override_lapse => true) — accept it anyway.
--      The acceptance is recorded, AND the timeline says it was accepted after
--      the offer had lapsed, so the history stays true.
--
--   What is NOT done: silently dropping the check. Accepting a lapsed offer
--   stays a deliberate act that someone has to choose, because the date is
--   still worth defending by default.
--
-- ADDITIVE. No table changes at all. Replaces one function this module already
-- owns and adds one more.
-- Rollback: sql/talent_360_offer_lapse_override_down.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- The 3-argument form is dropped rather than left alongside the new one:
-- two overloads differing only by a defaulted trailing argument is how a
-- caller ends up silently hitting the one without the override.
drop function if exists public.set_offer_status(uuid, text, text);

create or replace function public.set_offer_status(
  p_id uuid, p_status text, p_reason text default null,
  p_override_lapse boolean default false
) returns public.offers
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.offers; v_cur public.offers; v_late boolean := false; v_who text;
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
    v_late := v_cur.valid_till is not null and v_cur.valid_till < current_date;
    if v_late and not coalesce(p_override_lapse, false) then
      raise exception
        'That offer lapsed on %. Extend the validity date, or accept it anyway and the lapse will be recorded.',
        to_char(v_cur.valid_till, 'DD Mon YYYY');
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

  v_who := coalesce((select name from public.profiles where id = auth.uid()), 'System');

  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (v_row.application_id,
          'Offer ' || v_row.offer_no || ' → ' || p_status
            || coalesce(' · ' || nullif(btrim(coalesce(p_reason,'')), ''), ''),
          v_who, true, v_row.is_test);

  -- A separate line, deliberately: the lapse is a fact about the decision and
  -- should be legible on the timeline without reading the offer record.
  if v_late then
    insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
    values (v_row.application_id,
            'Accepted after the offer had lapsed on ' || to_char(v_cur.valid_till, 'DD Mon YYYY')
              || ' — allowed by ' || v_who,
            v_who, true, v_row.is_test);
  end if;

  return v_row;
end $$;

revoke execute on function public.set_offer_status(uuid,text,text,boolean) from public, anon;
grant  execute on function public.set_offer_status(uuid,text,text,boolean) to authenticated;

-- ── Extend the validity date ───────────────────────────────────────────────
create or replace function public.extend_offer_validity(
  p_id uuid, p_valid_till date, p_reason text default null
) returns public.offers
language plpgsql security definer set search_path to public, pg_temp
as $$
declare v_row public.offers; v_old date; v_who text;
begin
  perform public.talent_guard();
  if p_valid_till is null then raise exception 'Pick the new validity date.'; end if;
  if p_valid_till < current_date then
    raise exception 'That date has already passed — pick today or later.';
  end if;

  select valid_till into v_old from public.offers where id = p_id for update;
  if not found then raise exception 'Offer not found.'; end if;

  update public.offers set valid_till = p_valid_till
   where id = p_id and status in ('draft','sent')
   returning * into v_row;
  if not found then
    raise exception 'Only a draft or sent offer can have its validity changed.';
  end if;

  v_who := coalesce((select name from public.profiles where id = auth.uid()), 'System');
  insert into public.talent_comments (application_id, message, author_name, is_activity, is_test)
  values (v_row.application_id,
          'Offer validity ' || coalesce(to_char(v_old, 'DD Mon YYYY'), 'open-ended')
            || ' → ' || to_char(p_valid_till, 'DD Mon YYYY')
            || coalesce(' · ' || nullif(btrim(coalesce(p_reason,'')), ''), ''),
          v_who, true, v_row.is_test);
  return v_row;
end $$;

revoke execute on function public.extend_offer_validity(uuid,date,text) from public, anon;
grant  execute on function public.extend_offer_validity(uuid,date,text) to authenticated;

comment on function public.extend_offer_validity(uuid,date,text) is
  'Moves an offer''s validity date and records the change on the application timeline. Draft or sent offers only.';
