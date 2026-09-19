-- ═══════════════════════════════════════════════════════════════════════════
-- Allowing an overage on a PO line, from the receiving screen
--
-- WHY. Without this the receiver hits a dead end: 10 arrived against an order of
-- 1, the line does not permit keeping extra, and the only way forward is to
-- abandon the GRN, go and edit the PO, and come back. Meanwhile the goods are
-- physically on the floor. That is how material ends up recorded as 1 while 10
-- sit in the godown — the exact invisibility this whole change set out to fix.
--
-- WHO. NOT FC staff. Keeping unordered material is a commercial decision — it
-- commits money to stock nobody asked for — so it stays with admin, management
-- or ops, the same people who raise and approve the PO. An FC-only receiver
-- still sees the locked checkbox and sends the extra back.
--
-- WHAT IT SETS. over_delivery_unlimited on that ONE line, not a percentage.
-- A percentage cannot express this case: 10 against an order of 1 is 900%, and
-- the sanity CHECK caps the column at 100. "This specific line, authorised by a
-- named person, for a stated reason" is the honest shape — and the line is fully
-- received moments later anyway, so the flag has no future blast radius.
--
-- ⛔ NO DATA IS DELETED. Three ADD COLUMN IF NOT EXISTS plus one new function.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.po_items
  add column if not exists over_delivery_allowed_by     text,
  add column if not exists over_delivery_allowed_at     timestamptz,
  add column if not exists over_delivery_reason         text;

comment on column public.po_items.over_delivery_reason is
  'Why an overage was authorised on this line, and by whom. Set via po_allow_overage() from the receiving screen; never a silent edit.';

create or replace function public.po_allow_overage(
  p_po_item_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor record;
  v_item  record;
begin
  select p.id, p.name, p.role into v_actor
    from public.profiles p where p.id = auth.uid();
  if v_actor.id is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  -- Deliberately NOT fc_kaveri / fc_godawari: see the note above.
  if v_actor.role not in ('admin','management','ops') then
    raise exception 'Keeping material that was not ordered is a purchase decision. Ask ops, management or admin to allow it — or send the extra back.'
      using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception 'Say why this overage is being kept — it goes on the PO line.'
      using errcode = '23514';
  end if;

  select pi.id, pi.item_code, pi.qty, pi.over_delivery_unlimited, po.status, po.po_number
    into v_item
    from public.po_items pi
    join public.purchase_orders po on po.id = pi.po_id
   where pi.id = p_po_item_id
   for update;

  if v_item.id is null then
    raise exception 'PO line not found.' using errcode = 'P0002';
  end if;
  -- A cancelled or closed PO must not quietly start accepting stock again.
  if v_item.status in ('cancelled','closed') then
    raise exception 'PO % is %, so material cannot be received against it.',
      v_item.po_number, v_item.status using errcode = '23514';
  end if;
  if v_item.over_delivery_unlimited then
    return jsonb_build_object('already_allowed', true);
  end if;

  update public.po_items set
    over_delivery_unlimited  = true,
    over_delivery_allowed_by = v_actor.name,
    over_delivery_allowed_at = now(),
    over_delivery_reason     = btrim(p_reason)
  where id = p_po_item_id;

  -- Visible on the PO's own timeline, so purchase sees it without being told.
  -- Wrapped: a logging failure must never cost the authorisation.
  begin
    insert into public.po_comments (po_id, comment, created_by, created_at)
    select pi.po_id,
           format('Overage allowed on %s by %s — %s', pi.item_code, v_actor.name, btrim(p_reason)),
           v_actor.name, now()
      from public.po_items pi where pi.id = p_po_item_id;
  exception when others then null;
  end;

  return jsonb_build_object('allowed', true, 'item_code', v_item.item_code,
                            'by', v_actor.name);
end $$;

revoke all on function public.po_allow_overage(uuid,text) from public, anon;
grant execute on function public.po_allow_overage(uuid,text) to authenticated;

commit;

-- What has been allowed, and by whom:
--   select po.po_number, p.item_code, p.qty, p.received_qty,
--          p.over_delivery_allowed_by, p.over_delivery_allowed_at, p.over_delivery_reason
--     from po_items p join purchase_orders po on po.id = p.po_id
--    where p.over_delivery_unlimited order by p.over_delivery_allowed_at desc;
