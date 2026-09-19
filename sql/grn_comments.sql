-- ═══════════════════════════════════════════════════════════════════════════
-- COMMENTS ON A GRN
--
-- The GRN had no comments and no activity thread at all — the only document in
-- the inward chain without one. It is also where the quantity arguments happen:
-- "the vendor says they sent 110, we counted 100", "these 2 were damaged in
-- transit, not by us", "driver refused to take the extra back". That belongs on
-- the receipt, not in a WhatsApp thread nobody can find in six months.
--
-- Same shape as po_comments / order_comments / purchase_invoice_comments.
--
-- ⚠️ is_activity IS NOT WRITABLE BY USERS — it marks a SYSTEM event, and anyone
--    able to set it could forge "Confirmed by Anil Meena" into the trail.
--
-- WHO CAN POST: the FC roles are included, unlike most procurement tables. The
-- storekeeper is the person who saw the carton — excluding them from the
-- conversation about what was in it would be absurd.
--
-- ⛔ NO DATA IS DELETED. One new table.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

create table if not exists public.grn_comments (
  id           uuid primary key default gen_random_uuid(),
  grn_id       uuid not null references public.grn(id) on delete cascade,
  author_name  text not null,
  message      text not null,
  tagged_users text[],
  is_activity  boolean not null default false,
  created_at   timestamptz default now()
);

create index if not exists idx_grnc_grn on public.grn_comments (grn_id, created_at);

alter table public.grn_comments enable row level security;

drop policy if exists grnc_read on public.grn_comments;
-- can_read_PURCHASE, not can_read_operational. The GRN row itself is readable
-- by sales (OrderDetail shows sample-return GRNs), but a comment on a vendor
-- receipt routinely names rates and disputes — "they billed 220 against our
-- 200" — and sales must never see purchase pricing. FC roles ARE included.
create policy grnc_read on public.grn_comments
  for select to authenticated using (public.can_read_purchase());

drop policy if exists grnc_write on public.grn_comments;
create policy grnc_write on public.grn_comments
  for insert to authenticated
  with check (
    is_activity = false
    and exists (select 1 from public.profiles p
                 where p.id = auth.uid()
                   and p.role in ('admin','management','ops','accounts','fc_kaveri','fc_godawari'))
  );

-- A comment is a record of what someone said. Editing or deleting it would make
-- the trail worthless, so neither is granted — to anyone, admin included.
revoke update, delete, truncate on public.grn_comments from authenticated;
revoke all on public.grn_comments from anon;

commit;
