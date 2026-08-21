-- Dispatch notice: one WhatsApp message with the invoice, when FC marks a
-- batch delivered.
--
-- The order flow must not depend on this. A notification is a notification: if
-- WhatsApp is down, the delivery still happens. So nothing is added to the
-- order code at all — the trigger fires on the write confirmDelivered() already
-- makes, hands the request to pg_net (which sends it on a background worker),
-- and swallows every error. A trigger that raises would roll back the UPDATE
-- and stop deliveries being recorded; that is the one risk here and it is
-- closed by the exception block below.

-- ── opt-in, separate from payment reminders ──────────────────────────────
-- whatsapp_auto means "chase me for money". A customer may want dispatch
-- notices and no reminders, or the reverse.
alter table public.customers
  add column if not exists whatsapp_dispatch_auto boolean not null default false;

-- On for everyone who already has a number (the user's call): the notice is
-- useful to the customer, unlike a reminder.
update public.customers
   set whatsapp_dispatch_auto = true
 where whatsapp_no is not null and whatsapp_dispatch_auto = false;

alter table public.customers drop constraint if exists customers_dispatch_auto_needs_number;
alter table public.customers add constraint customers_dispatch_auto_needs_number
  check (whatsapp_dispatch_auto = false or coalesce(btrim(whatsapp_no), '') <> '');

-- ── one message per dispatch, ever ───────────────────────────────────────
alter table public.whatsapp_messages
  add column if not exists kind        text not null default 'statement',
  add column if not exists dispatch_id uuid references public.order_dispatches(id);
alter table public.whatsapp_messages drop constraint if exists whatsapp_messages_kind_valid;
alter table public.whatsapp_messages add constraint whatsapp_messages_kind_valid
  check (kind in ('statement','dispatch'));

-- The guarantee against spam: a dispatch can be notified once. Re-clicking
-- Delivered, a replayed trigger or a retried send cannot produce a second
-- message.
create unique index if not exists whatsapp_messages_one_per_dispatch
  on public.whatsapp_messages (dispatch_id) where dispatch_id is not null;

-- ── the trigger ──────────────────────────────────────────────────────────
create or replace function public.notify_dispatch_delivered()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  fn_url text := 'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/send-dispatch-invoice';
  secret text;
begin
  -- only the moment it becomes delivered, never on later edits
  if new.delivered_at is null or old.delivered_at is not null then
    return new;
  end if;

  begin
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'JOB_SECRET';
    if secret is null then return new; end if;

    perform net.http_post(
      url     := fn_url,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object('dispatch_id', new.id, 'secret', secret),
      timeout_milliseconds := 5000
    );
  exception when others then
    -- Deliberately silent. A delivery must never fail because a notification
    -- could not be queued.
    null;
  end;

  return new;
end;
$$;

drop trigger if exists trg_notify_dispatch_delivered on public.order_dispatches;
create trigger trg_notify_dispatch_delivered
  after update of delivered_at on public.order_dispatches
  for each row execute function public.notify_dispatch_delivered();
