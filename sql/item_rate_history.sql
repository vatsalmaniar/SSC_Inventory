-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT DO WE ACTUALLY PAY FOR THIS PART?
--
-- Item detail shows what a part was ORDERED at, line by line, off po_items.
-- Nowhere shows what it was BILLED at — so "our price is drifting" or "this
-- vendor is dearer than that one" could not be answered from the app at all.
--
-- One row per matched bill line, newest first: what the PO said, what the vendor
-- charged, and which of the two we decided was right. The last column is the
-- point — a run of "their price" on the same part is a price book that needs
-- fixing, not a vendor overcharging.
--
-- Test bills are excluded. Cancelled bills are excluded.
--
-- ⛔ Read-only. Creates nothing but a function.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.item_rate_history(p_item_code text, p_limit int default 24)
returns table (
  paid_on        date,
  vendor_name    text,
  po_number      text,
  grn_number     text,
  invoice_number text,
  qty            numeric,
  po_rate        numeric,
  billed_rate    numeric,
  difference     numeric,
  whose_price    text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Purchase pricing. Sales must never reach it — the same leak class closed in
  -- sql/definer_view_leaks.sql.
  if not public.is_procurement_writer() then
    raise exception 'Not authorised to read purchase pricing.' using errcode = '42501';
  end if;

  return query
  select coalesce(pin.invoice_date, pin.created_at::date),
         pin.vendor_name,
         po.po_number,
         g.grn_number,
         pin.invoice_number,
         pii.matched_qty,
         pii.po_unit_price,
         pii.inv_unit_price,
         pii.inv_unit_price - pii.po_unit_price,
         case pii.price_decision
           when 'invoice_correct' then 'their price stood'
           when 'po_correct'      then 'our PO stood'
           else null end
    from public.purchase_invoice_items pii
    join public.purchase_invoices pin on pin.id = pii.invoice_id
    left join public.grn g            on g.id  = pin.grn_id
    left join public.po_items p       on p.id  = pii.po_item_id
    left join public.purchase_orders po on po.id = p.po_id
   where pii.item_code = p_item_code
     and pii.inv_unit_price is not null
     and coalesce(pin.is_test, false) = false
     and pin.status <> 'cancelled'
   order by coalesce(pin.invoice_date, pin.created_at::date) desc, pii.created_at desc
   limit greatest(coalesce(p_limit, 24), 1);
end $$;

revoke all     on function public.item_rate_history(text,int) from public, anon;
grant  execute on function public.item_rate_history(text,int) to authenticated;

commit;

-- The parts worth fixing in the price book — where the vendor's price kept
-- turning out to be the right one:
--   select item_code, count(*) as times, round(avg(inv_unit_price - po_unit_price),2) as avg_gap
--     from purchase_invoice_items pii
--     join purchase_invoices pin on pin.id = pii.invoice_id
--    where pii.price_decision = 'invoice_correct' and coalesce(pin.is_test,false) = false
--    group by 1 having count(*) > 1 order by times desc;
