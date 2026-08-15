-- ═══════════════════════════════════════════════════════════════════════════
-- ORDERS  ·  SSC/CO####  SSC/SO####  SSC/SR####
--
-- approve_order() is what turns Temp/CO1435 into SSC/CO1436 when sales accepts
-- an order. It read MAX+1 over `orders` with NO LOCK AT ALL — weaker than the
-- PO version, which at least took an advisory lock. Two acceptances at the same
-- instant both read the same maximum and both write the same number; only
-- orders_order_number_key (UNIQUE) stopped that becoming two live orders on one
-- number, at the cost of one acceptance failing in the user's face.
--
-- Seeding is the dangerous half. A seed that is too LOW makes the next
-- acceptance collide with a number a customer already holds. Verified against
-- production before writing: all 2,770 numbered orders match
-- ^SSC/(CO|SO|SR)[0-9]{4}/[0-9]{2}-[0-9]{2}$ with zero exceptions, and every
-- one is FY 26-27. The seed below derives itself from that same data rather
-- than hardcoding, and GREATEST() means re-running it can only ever move a
-- counter forward.
-- ═══════════════════════════════════════════════════════════════════════════

insert into doc_number_counters (fy, doc_type, last_seq)
select right(o.order_number, 5) as fy,
       substring(o.order_number from 5 for 2) as doc_type,
       max((regexp_match(o.order_number, '^SSC/(?:CO|SO|SR)([0-9]+)'))[1]::int)
  from orders o
 where o.order_number ~ '^SSC/(CO|SO|SR)[0-9]+/[0-9]{2}-[0-9]{2}$'
 group by 1, 2
on conflict (fy, doc_type) do update
  set last_seq = greatest(doc_number_counters.last_seq, excluded.last_seq),
      updated_at = now();

-- ── The acceptance itself ───────────────────────────────────────────────────
-- Signature unchanged, output format unchanged — OrderDetail calls this exactly
-- as it does today and needs no edit.
--
-- Left SECURITY INVOKER on purpose: it UPDATEs orders, and that write must
-- stay subject to the caller's RLS. Only the allocation is privileged, and
-- that is next_doc_seq()'s job.
--
-- Allocation and the UPDATE are one statement apart in one transaction, so if
-- the write is refused — order_number_is_immutable fires on a double
-- acceptance, or an RLS policy denies it — the counter rolls back with it and
-- NOTHING is consumed. This is the property the PO series lacked when it burnt
-- seven numbers.
create or replace function approve_order(order_id uuid, approver_name text, order_type text)
returns void
language plpgsql
set search_path to public
as $$
declare
  v_prefix  text;
  v_type    text;
  v_seq     int;
  v_fy      text;
  v_current text;
begin
  -- Refuse a second acceptance BEFORE allocating. order_number_is_immutable
  -- would catch it anyway, but it would report a renumbering attempt rather
  -- than the thing that actually happened: someone accepted twice, usually a
  -- double-click.
  select o.order_number into v_current from orders o where o.id = order_id;
  if not found then
    raise exception 'Order % not found.', order_id using errcode = 'no_data_found';
  end if;
  if v_current is not null and v_current not like 'Temp/%' then
    raise exception 'Order % has already been accepted and cannot be accepted again.', v_current
      using errcode = 'check_violation';
  end if;

  v_type := case order_type
              when 'CO'     then 'CO'
              when 'SAMPLE' then 'SR'
              else               'SO'
            end;
  v_prefix := 'SSC/' || v_type;

  -- fy_suffix() rather than an inline copy of the April-boundary calculation,
  -- so every series in the ERP rolls over on the same date by construction.
  v_fy  := fy_suffix();
  v_seq := next_doc_seq(v_type, v_fy);

  update orders
     set order_number = v_prefix || lpad(v_seq::text, 4, '0') || '/' || v_fy,
         status       = 'inv_check',
         approved_by  = approver_name,
         updated_at   = now()
   where id = order_id;
end $$;

revoke execute on function approve_order(uuid, text, text) from public, anon;
grant  execute on function approve_order(uuid, text, text) to authenticated;
