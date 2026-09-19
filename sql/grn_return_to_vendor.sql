-- ═══════════════════════════════════════════════════════════════════════════
-- DID THE REJECTED GOODS ACTUALLY GO BACK?
--
-- Until now: a storekeeper could record "10 of the 110 are going back" and the
-- system then forgot. No queue, no document, nobody assigned, and no record of
-- whether the 10 ever left the building. And because stock comes from the
-- warehouse XLS, 10 pieces still sitting in the godown quietly reappear as
-- sellable stock.
--
-- Recording a problem is not the same as closing it. This closes it:
--
--   goods go back   -> recorded HERE, on the GRN, by whoever handed them over
--   money comes back-> recorded on the BILL, as the Tally debit note
--
-- Same split as everywhere else in this work: quantity is the GRN's business,
-- money is Inward Billing's. A GRN with a rejected quantity and no return
-- confirmation is an open item, and that is what makes it chaseable.
--
-- ⚠️ A FLAG, NEVER A GATE. Nothing here blocks anything. confirm_grn does not
--    look at returned_at, the bill is created regardless, and the PO closes on
--    the accepted quantity exactly as before. The GRN never waits for the goods
--    to physically leave — the receipt is a fact about what arrived, and the
--    return is a separate fact that follows later, sometimes days later.
--    All this does is make the open item visible and chaseable instead of
--    invisible and forgotten.
--
-- ⛔ NO DATA IS DELETED. Five nullable columns and one new function.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.grn
  add column if not exists returned_at   timestamptz,
  add column if not exists returned_by   text,
  add column if not exists return_mode   text,
  add column if not exists return_ref    text,
  add column if not exists return_note   text;

alter table public.grn drop constraint if exists grn_return_mode_check;
alter table public.grn add constraint grn_return_mode_check check (
  return_mode is null or return_mode in
    ('vendor_driver','courier','vendor_collected','not_returned','other'));

comment on column public.grn.returned_at is
  'When the rejected goods physically left. NULL with a rejected quantity on any line = still here, still open, still chaseable.';
comment on column public.grn.return_mode is
  'How they went back. not_returned = a deliberate decision to keep or scrap them, which still has to be stated rather than left blank.';

-- The open queue: rejected goods that have not been confirmed as gone.
create index if not exists idx_grn_return_pending
  on public.grn (received_at desc) where returned_at is null;

create or replace function public.grn_confirm_return(
  p_grn_id uuid,
  p_mode   text,
  p_ref    text default null,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_grn   record;
  v_rej   numeric;
begin
  select p.id, p.name, p.role into v_actor
    from public.profiles p where p.id = auth.uid();
  if v_actor.id is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- FC hands the goods over, so FC can confirm it. This is a physical fact, not
  -- a commercial decision.
  if v_actor.role not in ('admin','management','ops','accounts','fc_kaveri','fc_godawari') then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if p_mode is null or p_mode = '' then
    raise exception 'Say how the goods went back.' using errcode = '23514';
  end if;

  select * into v_grn from public.grn where id = p_grn_id for update;
  if v_grn is null then
    raise exception 'GRN not found.' using errcode = 'P0002';
  end if;

  select coalesce(sum(rejected_qty), 0) into v_rej
    from public.grn_items where grn_id = p_grn_id;
  if v_rej <= 0 then
    raise exception 'Nothing was rejected on %, so there is nothing to send back.', v_grn.grn_number
      using errcode = '23514';
  end if;
  if v_grn.returned_at is not null then
    return jsonb_build_object('already_confirmed', true, 'at', v_grn.returned_at);
  end if;

  update public.grn set
    returned_at = now(),
    returned_by = v_actor.name,
    return_mode = p_mode,
    return_ref  = nullif(btrim(coalesce(p_ref,'')),  ''),
    return_note = nullif(btrim(coalesce(p_note,'')), ''),
    updated_at  = now()
  where id = p_grn_id;

  return jsonb_build_object('returned', true, 'qty', v_rej, 'by', v_actor.name);
end $$;

revoke all     on function public.grn_confirm_return(uuid,text,text,text) from public, anon;
grant  execute on function public.grn_confirm_return(uuid,text,text,text) to authenticated;

commit;

-- THE OPEN QUEUE — goods rejected and not yet confirmed gone. This is the list
-- that stops the 10 pieces being forgotten:
--
--   select g.grn_number, g.vendor_name, g.fulfilment_center,
--          sum(gi.rejected_qty) as going_back,
--          string_agg(distinct gi.rejection_reason, ', ') as why,
--          (now() - g.received_at) as waiting
--     from grn g join grn_items gi on gi.grn_id = g.id
--    where g.returned_at is null and coalesce(g.is_test,false) = false
--    group by g.id, g.grn_number, g.vendor_name, g.fulfilment_center, g.received_at
--   having sum(gi.rejected_qty) > 0
--    order by g.received_at;
