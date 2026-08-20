-- Background reminder runs.
--
-- The browser used to do the work: it built every PDF, so the tab had to stay
-- open for ~25 minutes and the laptop awake. These two tables let an Edge
-- Function pick the run up instead — it processes a batch, marks each item, and
-- calls itself for the next batch until the queue is empty.
--
-- Items are marked individually and on purpose: a crash, a token expiry or a
-- deploy mid-run leaves the finished ones finished, and resuming only picks up
-- what is still 'pending'. Nobody gets a second statement because the process
-- died halfway.

create table if not exists public.whatsapp_reminder_jobs (
  id            uuid primary key default gen_random_uuid(),
  status        text        not null default 'queued',
                -- queued | running | done | stopped | failed
  as_on         date,
  total         integer     not null default 0,
  sent          integer     not null default 0,
  failed        integer     not null default 0,
  passes        integer     not null default 0,   -- chained invocations, capped
  last_error    text,
  created_by    uuid        references auth.users(id),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  constraint whatsapp_reminder_jobs_status_valid
    check (status in ('queued','running','done','stopped','failed'))
);

create table if not exists public.whatsapp_reminder_job_items (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid        not null references public.whatsapp_reminder_jobs(id) on delete cascade,
  customer_id   uuid        not null references public.customers(id),
  status        text        not null default 'pending',
                -- pending | sent | failed | skipped
  overdue_inr   numeric     not null default 0,   -- as it stood when queued
  error         text,
  sent_at       timestamptz,
  constraint whatsapp_reminder_job_items_status_valid
    check (status in ('pending','sent','failed','skipped'))
);

-- One customer appears once per job. Belt and braces against a double-queue
-- inserting the same person twice.
create unique index if not exists whatsapp_reminder_job_items_unique
  on public.whatsapp_reminder_job_items (job_id, customer_id);
create index if not exists whatsapp_reminder_job_items_pending
  on public.whatsapp_reminder_job_items (job_id, status);

-- Only one run at a time. A second "Send" while one is in flight would send
-- everyone two statements.
create unique index if not exists whatsapp_reminder_jobs_one_active
  on public.whatsapp_reminder_jobs ((status in ('queued','running')))
  where status in ('queued','running');

alter table public.whatsapp_reminder_jobs      enable row level security;
alter table public.whatsapp_reminder_job_items enable row level security;

drop policy if exists auth_read on public.whatsapp_reminder_jobs;
create policy auth_read on public.whatsapp_reminder_jobs for select to authenticated using (true);
drop policy if exists auth_read on public.whatsapp_reminder_job_items;
create policy auth_read on public.whatsapp_reminder_job_items for select to authenticated using (true);

-- Admins may stop a run from the UI; everything else is written by the function
-- through the service role.
drop policy if exists admin_stop on public.whatsapp_reminder_jobs;
create policy admin_stop on public.whatsapp_reminder_jobs
  for update to authenticated
  using      (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
  with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

revoke insert, delete, truncate on public.whatsapp_reminder_jobs      from authenticated, anon;
revoke insert, update, delete, truncate on public.whatsapp_reminder_job_items from authenticated, anon;
revoke all on public.whatsapp_reminder_jobs      from anon;
revoke all on public.whatsapp_reminder_job_items from anon;
