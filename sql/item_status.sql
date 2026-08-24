-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM STATUS  ·  a retired part is marked, not hidden
--
-- The item master accumulated duplicate codes for the same physical part:
-- BHW-T10 2P C6, BHW-T10 2P C6 6A 10KA and BHW-T10 2P C6A MCB 6A 2P 10KA are
-- one MCB under three codes. Only one carries the stock, so an order raised
-- against a twin reads as zero-on-hand and goes to procurement for something
-- already sitting on the shelf. That happened on 2026-08-20: SSC/CO1497 was
-- booked against BHW-T10 3P C63A while 34 pieces sat under BHW-T10 3P C63.
--
-- items.is_active existed but nothing read it, so switching it on would have
-- made a part vanish from every screen with no way back — a one-way door.
--
-- This follows customers.account_status instead, which the ERP already does
-- well: a blacklisted customer still APPEARS in the picker, wearing a red pill,
-- and selecting it explains why you cannot and what to use instead. Marked, not
-- hidden. Someone who types the old code learns the new one rather than finding
-- an empty dropdown and wondering.
--
-- SAP calls this a material status: the material stays in the master, and the
-- status blocks it for procurement or sales at DOCUMENT level, not just in the
-- search box.
-- ═══════════════════════════════════════════════════════════════════════════

alter table items add column if not exists item_status text not null default 'Active';
alter table items add column if not exists superseded_by text;

do $$ begin
  alter table items add constraint items_item_status_check
    check (item_status in ('Active','Superseded','Discontinued'));
exception when duplicate_object then null; end $$;

-- A superseded part must say what replaces it — that message is the whole point.
do $$ begin
  alter table items add constraint items_superseded_shape
    check (item_status <> 'Superseded' or superseded_by is not null);
exception when duplicate_object then null; end $$;

comment on column items.item_status is
  'Active | Superseded (a duplicate — superseded_by names the code to use) | Discontinued. Mirrors customers.account_status: marked in the pickers, never hidden.';

create index if not exists idx_items_item_status on items (item_status) where item_status <> 'Active';


-- ── The database guard ──────────────────────────────────────────────────────
-- The picker block stops someone CHOOSING a retired code. It does nothing about
-- an import, an API call, a copied order or an RPC. Every guard that mattered
-- this month ended up here rather than in the browser, and this is no different.
--
-- Two things it must not do, or it breaks live work:
--   · it fires on INSERT, and on UPDATE only when the item_code itself changes.
--     SSC/CO1497 already carries a superseded code; dispatching it, invoicing it
--     or editing its quantity must keep working.
--   · it never looks backwards. Superseding a part cannot invalidate history.
create or replace function block_superseded_item()
returns trigger
language plpgsql
set search_path to public
as $$
declare v_status text; v_use text;
begin
  if tg_op = 'UPDATE' and new.item_code is not distinct from old.item_code then
    return new;
  end if;

  select item_status, superseded_by into v_status, v_use
    from items where item_code = new.item_code;

  if v_status = 'Superseded' then
    raise exception 'Item % has been superseded — use % instead.', new.item_code, v_use
      using errcode = 'check_violation';
  elsif v_status = 'Discontinued' then
    raise exception 'Item % is discontinued and cannot be added to a new document.', new.item_code
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_superseded_item on order_items;
create trigger trg_block_superseded_item
  before insert or update of item_code on order_items
  for each row execute function block_superseded_item();

drop trigger if exists trg_block_superseded_item on po_items;
create trigger trg_block_superseded_item
  before insert or update of item_code on po_items
  for each row execute function block_superseded_item();


-- ── Changing a status ───────────────────────────────────────────────────────
-- There is no item edit anywhere in the app — items can only be created, via
-- create_item_v3. So without this, marking a part superseded from the database
-- would be a one-way door: no screen could show it, and nobody could undo it.
--
-- Not a plain UPDATE from the client: the items table carries auth_update
-- USING (true), so any signed-in user can rewrite any item. Retiring a part
-- decides what the whole company may sell and buy, so it takes the same
-- authority as creating one.
create or replace function set_item_status(p_item_code text, p_status text, p_superseded_by text default null)
returns items
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_role text; v_row items; v_target items;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','management') then
    raise exception 'Only admin or management can change an item status.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('Active','Superseded','Discontinued') then
    raise exception 'Status must be Active, Superseded or Discontinued.';
  end if;

  select * into v_row from items where item_code = p_item_code;
  if not found then raise exception 'Item % not found.', p_item_code; end if;

  if p_status = 'Superseded' then
    if p_superseded_by is null or btrim(p_superseded_by) = '' then
      raise exception 'Say which item replaces %.', p_item_code;
    end if;
    if p_superseded_by = p_item_code then
      raise exception 'An item cannot supersede itself.';
    end if;
    select * into v_target from items where item_code = p_superseded_by;
    if not found then raise exception 'Replacement item % does not exist.', p_superseded_by; end if;
    -- No chains. If the replacement is itself retired, whoever reads the
    -- message is sent to a dead end and has to work out the real answer.
    if v_target.item_status <> 'Active' then
      raise exception 'Replacement item % is itself %, so it cannot be the answer.',
        p_superseded_by, lower(v_target.item_status);
    end if;
  end if;

  update items
     set item_status   = p_status,
         superseded_by = case when p_status = 'Superseded' then p_superseded_by else null end,
         updated_at    = now()
   where item_code = p_item_code
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function set_item_status(text, text, text) from public, anon;
grant  execute on function set_item_status(text, text, text) to authenticated;


-- ── The trap this closes ────────────────────────────────────────────────────
-- replace_order_items DELETEs and re-INSERTs every line of an order when it is
-- edited. So if a retired code sits on a live order, the next edit re-inserts
-- that line, the trigger refuses it, and the order becomes uneditable — the
-- user sees a message about an item they never touched, on an order they cannot
-- save. Retiring a part would have quietly booby-trapped it.
--
-- The answer is not to weaken the trigger. It is that a part still in flight is
-- not ready to be retired: finish the open work, or move the lines first. The
-- function now says so, and names the documents.
create or replace function set_item_status(p_item_code text, p_status text, p_superseded_by text default null)
returns items
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_role text; v_row items; v_target items; v_docs text; v_n int;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','management') then
    raise exception 'Only admin or management can change an item status.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('Active','Superseded','Discontinued') then
    raise exception 'Status must be Active, Superseded or Discontinued.';
  end if;

  select * into v_row from items where item_code = p_item_code;
  if not found then raise exception 'Item % not found.', p_item_code; end if;

  if p_status <> 'Active' then
    select count(*), string_agg(doc, ', ' order by doc) into v_n, v_docs from (
      select distinct o.order_number as doc
        from order_items oi join orders o on o.id = oi.order_id
       where oi.item_code = p_item_code
         and o.status not in ('cancelled','dispatched_fc','closed')
      union
      select distinct p.po_number
        from po_items pi join purchase_orders p on p.id = pi.po_id
       where pi.item_code = p_item_code
         and p.status not in ('cancelled','closed')
    ) d;
    if v_n > 0 then
      raise exception
        '% is still on % open document(s): %. Finish or move those lines first — editing one of them would re-insert this code and fail.',
        p_item_code, v_n, left(v_docs, 300) using errcode = 'check_violation';
    end if;
  end if;

  if p_status = 'Superseded' then
    if p_superseded_by is null or btrim(p_superseded_by) = '' then
      raise exception 'Say which item replaces %.', p_item_code;
    end if;
    if p_superseded_by = p_item_code then
      raise exception 'An item cannot supersede itself.';
    end if;
    select * into v_target from items where item_code = p_superseded_by;
    if not found then raise exception 'Replacement item % does not exist.', p_superseded_by; end if;
    if v_target.item_status <> 'Active' then
      raise exception 'Replacement item % is itself %, so it cannot be the answer.',
        p_superseded_by, lower(v_target.item_status);
    end if;
  end if;

  update items
     set item_status   = p_status,
         superseded_by = case when p_status = 'Superseded' then p_superseded_by else null end,
         updated_at    = now()
   where item_code = p_item_code
  returning * into v_row;

  return v_row;
end $$;
