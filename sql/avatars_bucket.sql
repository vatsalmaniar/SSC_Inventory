-- One-off setup for user profile pictures.
-- Paste into Supabase SQL Editor and run once.

-- 1. Add avatar_url column to profiles (no-op if it already exists)
alter table public.profiles add column if not exists avatar_url text;

-- 2. Create the public 'avatars' bucket
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3. Storage policies — anyone authenticated can upload/update/delete their OWN avatar;
--    anyone (incl. anon) can read because the bucket is public.
drop policy if exists "Avatar read"   on storage.objects;
drop policy if exists "Avatar insert" on storage.objects;
drop policy if exists "Avatar update" on storage.objects;
drop policy if exists "Avatar delete" on storage.objects;

create policy "Avatar read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Avatar insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar update"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
