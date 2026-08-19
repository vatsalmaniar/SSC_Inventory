-- Pending Payment Due — bill-level receivables from the Tally "Bills Receivable" export.
--
-- Why: customer_payments_snapshot stores four TOTALS per party. The bill lines are
-- parsed in Accounts.jsx and thrown away, so the app knows a customer owes
-- ₹45,50,145 overdue but cannot say which bills. A customer-facing statement is
-- by definition the line list, so the lines have to be kept.
--
-- Doctrine (user, 2026-08-19): THE UPLOADED SHEET IS THE SOURCE OF TRUTH.
--   * rows are stored verbatim — no netting, no deriving from orders/invoices
--   * days_past_due is computed ONCE against the run's as_on date and frozen,
--     so a statement already sent to a customer re-renders identically forever
--   * each upload is one immutable dated run, retained (never delete-and-reinsert)

create table if not exists public.customer_dues_runs (
  id                     uuid primary key default gen_random_uuid(),
  as_on                  date        not null,        -- statement date = export date
  source_filename        text,
  party_count            integer     not null default 0,
  bill_count             integer     not null default 0,
  total_outstanding_inr  numeric     not null default 0,
  total_pdc_inr          numeric     not null default 0,   -- post-dated cheques in hand
  total_overdue_inr      numeric     not null default 0,
  matched_party_count    integer     not null default 0,
  is_current             boolean     not null default false,
  imported_at            timestamptz not null default now(),
  created_by             uuid
);

-- Exactly one current run. Partial unique index = the flip is atomic and cannot
-- leave two runs both claiming to be current.
create unique index if not exists customer_dues_runs_one_current
  on public.customer_dues_runs (is_current) where is_current;

create table if not exists public.customer_dues_bills (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid    not null references public.customer_dues_runs(id) on delete cascade,
  party_name_raw  text    not null,                       -- as printed in the sheet
  customer_id     uuid    references public.customers(id),-- for routing/contacts ONLY, never figures
  bill_date       date,
  bill_ref        text,                                   -- verbatim: "bill no 06776 hz"
  pending_inr     numeric not null default 0,
  pdc_inr         numeric not null default 0,
  due_date        date,
  days_past_due   integer not null default 0,             -- frozen against run.as_on
  is_overdue      boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists customer_dues_bills_run_customer
  on public.customer_dues_bills (run_id, customer_id);
create index if not exists customer_dues_bills_customer
  on public.customer_dues_bills (customer_id);
create index if not exists customer_dues_bills_party
  on public.customer_dues_bills (run_id, party_name_raw);

alter table public.customer_dues_runs  enable row level security;
alter table public.customer_dues_bills enable row level security;

-- Mirrors customer_payments_snapshot exactly: everyone with Customer 360 access
-- reads; only accounts/admin/management write (the upload).
drop policy if exists auth_read on public.customer_dues_runs;
create policy auth_read on public.customer_dues_runs
  for select to authenticated using (true);

drop policy if exists role_write on public.customer_dues_runs;
create policy role_write on public.customer_dues_runs
  for all to authenticated
  using      (exists (select 1 from public.profiles where id = auth.uid()
                        and role = any (array['admin','accounts','management'])))
  with check (exists (select 1 from public.profiles where id = auth.uid()
                        and role = any (array['admin','accounts','management'])));

drop policy if exists auth_read on public.customer_dues_bills;
create policy auth_read on public.customer_dues_bills
  for select to authenticated using (true);

drop policy if exists role_write on public.customer_dues_bills;
create policy role_write on public.customer_dues_bills
  for all to authenticated
  using      (exists (select 1 from public.profiles where id = auth.uid()
                        and role = any (array['admin','accounts','management'])))
  with check (exists (select 1 from public.profiles where id = auth.uid()
                        and role = any (array['admin','accounts','management'])));
