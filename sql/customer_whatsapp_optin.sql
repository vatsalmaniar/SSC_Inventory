-- WhatsApp point-of-contact for payment reminders, next to the existing POC.
--
-- Separate from poc_no on purpose: the POC is usually the purchase contact,
-- while dues statements need whoever handles payments — often a different
-- person and a different number.
--
-- whatsapp_auto is the send switch. The CHECK makes "auto on with no number"
-- unrepresentable, so the send job can trust the flag alone and never has to
-- re-derive whether a customer is actually reachable.

alter table public.customers
  add column if not exists whatsapp_no   text,
  add column if not exists whatsapp_name text,
  add column if not exists whatsapp_auto boolean not null default false;

alter table public.customers drop constraint if exists customers_whatsapp_auto_needs_number;
alter table public.customers add constraint customers_whatsapp_auto_needs_number
  check (whatsapp_auto = false or coalesce(btrim(whatsapp_no), '') <> '');

comment on column public.customers.whatsapp_no   is 'WhatsApp number for dues statements (E.164, e.g. +919925246595)';
comment on column public.customers.whatsapp_name is 'Optional name of the person on that WhatsApp number';
comment on column public.customers.whatsapp_auto is 'Send payment reminders automatically. Cannot be true without whatsapp_no.';

-- Store one shape only. The send job posts this string straight to Meta's API,
-- so "9925246595", "+91 99252 46595" and "0919925246595" must never all be
-- allowed to mean the same customer — E.164 or nothing.
alter table public.customers drop constraint if exists customers_whatsapp_no_e164;
alter table public.customers add constraint customers_whatsapp_no_e164
  check (whatsapp_no is null or whatsapp_no ~ '^\+[1-9][0-9]{7,14}$');
