-- Log of every WhatsApp payment reminder sent.
--
-- A reminder is a customer-facing claim about money, so what was sent has to be
-- answerable months later: which number, which amounts, which statement, what
-- Meta did with it. The amounts are SNAPSHOTTED here rather than joined back to
-- customer_dues_bills, because that table is overwritten on every Tally upload —
-- by next week the figures behind an August message would be gone.

create table if not exists public.whatsapp_messages (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id),
  -- who it went to, as it was at send time (numbers change)
  to_number        text not null,
  to_name          text,
  template_name    text not null default 'statement_of_dues',
  -- what the customer was told, frozen
  as_on            date,
  outstanding_inr  numeric not null default 0,
  overdue_inr      numeric not null default 0,
  bill_count       integer not null default 0,
  statement_path   text,                       -- Storage path of the PDF actually sent
  -- Meta's side
  wa_message_id    text,
  status           text not null default 'queued',
    -- queued | sent | delivered | read | failed
  error_message    text,
  sent_at          timestamptz not null default now(),
  delivered_at     timestamptz,
  read_at          timestamptz,
  failed_at        timestamptz,
  -- who pressed the button
  sent_by          uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  constraint whatsapp_messages_status_valid
    check (status in ('queued','sent','delivered','read','failed'))
);

create index if not exists whatsapp_messages_customer  on public.whatsapp_messages (customer_id, sent_at desc);
create index if not exists whatsapp_messages_wa_id     on public.whatsapp_messages (wa_message_id);
create index if not exists whatsapp_messages_sent_at   on public.whatsapp_messages (sent_at desc);

alter table public.whatsapp_messages enable row level security;

-- Everyone with Customer 360 sees the send history (it explains why a customer
-- is calling about a statement). Only the Edge Function (service role, which
-- bypasses RLS) writes. No client-side insert path exists at all.
drop policy if exists auth_read on public.whatsapp_messages;
create policy auth_read on public.whatsapp_messages
  for select to authenticated using (true);

revoke insert, update, delete on public.whatsapp_messages from authenticated, anon;
