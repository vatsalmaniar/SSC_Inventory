-- ROLLBACK for sql/c3_service_key_to_vault_up.sql
--
-- Restores the pre-2026-07-31 behaviour: both triggers embed the service_role JWT directly
-- in their header, and a dispatch failure propagates into the triggering insert.
--
-- The key is read back OUT of Vault and injected via dynamic SQL, so this file never
-- contains the credential itself. (The literal-bearing version of this rollback is
-- deliberately NOT version-controlled — committing it would recreate the very disclosure
-- the up-script removes.)
--
-- Rolling back re-exposes a credential valid to 2036-03-26 to anyone who can read function
-- source. Use it only to restore email dispatch if the Vault path fails, and re-apply a
-- corrected up-script promptly.

begin;

do $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_key';
  if k is null then
    raise exception 'no service_role_key in vault — cannot reconstruct the original functions';
  end if;

  execute format(
    'create or replace function public.on_notification_insert() returns trigger '
    'language plpgsql security definer as $body$ '
    'BEGIN PERFORM net.http_post('
    '  url := %L, '
    '  headers := %L::jsonb, '
    '  body := jsonb_build_object(''type'',''INSERT'',''table'',''notifications'',''record'', row_to_json(NEW))'
    '); RETURN NEW; END; $body$',
    'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/send-email-notification',
    '{"Content-Type": "application/json", "Authorization": "Bearer ' || k || '"}'
  );

  execute format(
    'create or replace function public.on_login_audit_insert() returns trigger '
    'language plpgsql security definer as $body$ '
    'BEGIN PERFORM net.http_post('
    '  url := %L, '
    '  headers := %L::jsonb, '
    '  body := jsonb_build_object(''type'',''INSERT'',''table'',''login_audit'',''record'', row_to_json(NEW))'
    '); RETURN NEW; END; $body$',
    'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/send-email-notification',
    '{"Content-Type": "application/json", "Authorization": "Bearer ' || k || '"}'
  );
end $$;

commit;
