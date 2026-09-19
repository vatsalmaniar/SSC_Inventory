-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS ON A VENDOR BILL
--
-- Orders and POs have had real comments with @mentions for a long time. Inward
-- Billing had a READ-ONLY timeline synthesised from timestamps — you could see
-- that a bill was matched, but you could not ask anyone about it. On a bill
-- carrying a price dispute and a debit note, "why did we accept their price?"
-- is exactly the conversation that needs to live on the document.
--
-- Same shape as po_comments / order_comments deliberately — a fourth table with
-- a different column set is how these drift. (A single generic comments table
-- would be better still, but that means migrating three live pages and belongs
-- in its own change, not bolted onto this one.)
--
-- ⚠️ is_activity IS NOT WRITABLE BY USERS. It marks a SYSTEM event, and a user
--    able to set it could forge "Matched by Jayshree" into the trail. The
--    insert policy pins it false; system rows are written by definer functions.
--
-- ⛔ NO DATA IS DELETED. One new table.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.purchase_invoice_comments (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.purchase_invoices(id) on delete cascade,
  author_name   text not null,
  message       text not null,
  tagged_users  text[],
  is_activity   boolean not null default false,
  created_at    timestamptz default now()
);

create index if not exists idx_pic_invoice on public.purchase_invoice_comments (invoice_id, created_at);

alter table public.purchase_invoice_comments enable row level security;

drop policy if exists pic_read on public.purchase_invoice_comments;
create policy pic_read on public.purchase_invoice_comments
  for select to authenticated using (public.can_read_purchase());

-- Anyone who can work a bill can comment on it. NOT a USING(true) write policy:
-- is_activity is pinned false so the system trail cannot be forged.
drop policy if exists pic_write on public.purchase_invoice_comments;
create policy pic_write on public.purchase_invoice_comments
  for insert to authenticated
  with check (public.is_procurement_writer() and is_activity = false);

-- A comment is a record of what someone said. Editing or deleting it would make
-- the trail worthless, so neither is granted to anyone.
revoke update, delete, truncate on public.purchase_invoice_comments from authenticated;
revoke all on public.purchase_invoice_comments from anon;

commit;
