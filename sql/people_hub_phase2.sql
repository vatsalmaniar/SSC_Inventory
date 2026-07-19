-- People Hub Phase 2 — sensitive personal data (RLS admin/management ONLY),
-- documents, and asset/device register extensions. Additive.
-- Sensitive fields go in their OWN restricted table because `employees` is
-- world-readable (directory). Never put PAN/Aadhaar/family on `employees`.

-- 1. employee_private — personal & family data, admin/management only
create table if not exists public.employee_private (
  employee_id       uuid primary key references public.employees(id) on delete cascade,
  date_of_birth     date,
  gender            text,
  marital_status    text,
  personal_phone    text,
  personal_email    text,
  emergency_contact text,
  pan               text,
  aadhaar           text,
  spouse_name       text,
  spouse_phone      text,
  spouse_dob        date,
  is_permanent      boolean not null default true,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.employee_private enable row level security;
drop policy if exists epriv_read  on public.employee_private;
drop policy if exists epriv_write on public.employee_private;
create policy epriv_read on public.employee_private for select
  using (expense_role() = any(array['admin','management']));
create policy epriv_write on public.employee_private for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

-- seed a private row per employee, carrying over any values already on employees
insert into public.employee_private (employee_id, date_of_birth, personal_phone, personal_email, emergency_contact)
select id, date_of_birth, phone, personal_email, emergency_contact
from public.employees
on conflict (employee_id) do nothing;

-- 2. employee_documents — doc register (files in a private storage bucket), admin/management only
create table if not exists public.employee_documents (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  doc_type    text not null,           -- PAN Card, Aadhaar Card, Offer Letter, Appointment Letter, Other
  file_path   text,                    -- storage object path
  file_name   text,
  uploaded_at timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (employee_id, doc_type)
);
alter table public.employee_documents enable row level security;
drop policy if exists edoc_read  on public.employee_documents;
drop policy if exists edoc_write on public.employee_documents;
create policy edoc_read on public.employee_documents for select
  using (expense_role() = any(array['admin','management']));
create policy edoc_write on public.employee_documents for all
  using      (expense_role() = any(array['admin','management']))
  with check (expense_role() = any(array['admin','management']));

-- 3. assets / devices register extensions
alter table public.assets add column if not exists name         text;   -- e.g. "MacBook Pro 16"
alter table public.assets add column if not exists sticker_type text;   -- Asset Tag | QR Code | Barcode | None
alter table public.assets add column if not exists condition    text not null default 'inuse'; -- inuse | repair | returned

-- 4. celebrations RPC now reads DOB from employee_private (SECURITY DEFINER can see it);
--    anniversary still uses employees.join_date (not sensitive).
create or replace function public.celebrations_today()
returns table(employee_id uuid, full_name text, kind text, years int)
language sql stable security definer set search_path=public as $$
  select e.id, e.full_name, 'birthday'::text, null::int
  from public.employees e
  join public.employee_private pv on pv.employee_id = e.id
  where coalesce(e.lifecycle_status,'') <> 'exited' and coalesce(e.is_test,false) = false
    and pv.date_of_birth is not null
    and extract(month from pv.date_of_birth) = extract(month from current_date)
    and extract(day   from pv.date_of_birth) = extract(day   from current_date)
  union all
  select e.id, e.full_name, 'anniversary'::text,
         (extract(year from current_date) - extract(year from e.join_date))::int
  from public.employees e
  where coalesce(e.lifecycle_status,'') <> 'exited' and coalesce(e.is_test,false) = false
    and e.join_date is not null
    and extract(month from e.join_date) = extract(month from current_date)
    and extract(day   from e.join_date) = extract(day   from current_date)
    and (extract(year from current_date) - extract(year from e.join_date)) >= 1;
$$;
grant execute on function public.celebrations_today() to authenticated;
