-- Who is due a WhatsApp payment reminder, already totalled up.
--
-- The Reminders modal used to pull every bill in the book — 2,017 rows across
-- three paged round trips — and sum them in the browser just to show each
-- customer's overdue figure. This returns ~200 pre-aggregated rows instead.
--
-- The bill LINES are still needed to build a customer's statement PDF, but only
-- for the one customer being sent at that moment, so they are fetched per
-- customer at send time rather than all of them upfront.
--
-- security_invoker: the view runs as the caller, so RLS on customers and
-- customer_dues_bills still applies. Without it a view is a hole in RLS.
create or replace view public.whatsapp_reminder_queue
with (security_invoker = on) as
select
  c.id                                          as customer_id,
  c.customer_name,
  c.customer_id                                 as code,
  c.account_owner,
  c.whatsapp_no,
  c.whatsapp_name,
  count(b.id)::int                              as bill_count,
  sum(b.pending_inr)                            as outstanding,
  sum(b.pdc_inr)                                as pdc,
  sum(case when b.is_overdue then b.pending_inr - b.pdc_inr else 0 end) as overdue,
  max(b.days_past_due)::int                     as oldest
from public.customers c
join public.customer_dues_bills b on b.customer_id = c.id
where c.whatsapp_auto = true
  and c.whatsapp_no is not null
group by c.id, c.customer_name, c.customer_id, c.account_owner, c.whatsapp_no, c.whatsapp_name
-- Overdue only. Someone inside their credit terms is not a reminder candidate.
having sum(case when b.is_overdue then b.pending_inr - b.pdc_inr else 0 end) > 0;

revoke all on public.whatsapp_reminder_queue from anon;
grant select on public.whatsapp_reminder_queue to authenticated;

-- Default privileges hand authenticated full CRUD on new relations; an
-- aggregated view is not updatable anyway, but leave nothing lying around.
revoke insert, update, delete, truncate, references, trigger
  on public.whatsapp_reminder_queue from authenticated;
