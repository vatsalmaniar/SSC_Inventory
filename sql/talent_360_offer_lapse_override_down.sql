-- ROLLBACK for sql/talent_360_offer_lapse_override.sql
-- Restores the 3-argument set_offer_status (no override) and removes the
-- validity-extension function. Timeline rows already written are left alone —
-- they record things that actually happened.
drop function if exists public.extend_offer_validity(uuid, date, text);
drop function if exists public.set_offer_status(uuid, text, text, boolean);

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
    if v_cur.status <> 'sent' then raise exception 'Only an offer that has been sent can be accepted.'; end if;
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
          'Offer ' || v_row.offer_no || ' → ' || p_status || coalesce(' · ' || nullif(btrim(coalesce(p_reason,'')), ''), ''),
          coalesce((select name from public.profiles where id = auth.uid()), 'System'), true, v_row.is_test);
  return v_row;
end $$;
revoke execute on function public.set_offer_status(uuid,text,text) from public, anon;
grant  execute on function public.set_offer_status(uuid,text,text) to authenticated;
