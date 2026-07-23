-- Punch selfie photos for app-based attendance (interim, before biometric). ADDITIVE.
alter table public.attendance_punches add column if not exists photo_path text;

-- private bucket for punch selfies
insert into storage.buckets (id, name, public)
values ('attendance-photos', 'attendance-photos', false)
on conflict (id) do nothing;

-- upload only to your own folder ({employee_id}/...); read = self or admin/management
drop policy if exists att_photo_ins  on storage.objects;
drop policy if exists att_photo_read on storage.objects;
create policy att_photo_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-photos' and (storage.foldername(name))[1] = public.my_employee_id()::text);
create policy att_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-photos' and (
    public.expense_role() = any(array['admin','management'])
    or (storage.foldername(name))[1] = public.my_employee_id()::text));
