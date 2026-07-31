-- C3 — remove the hardcoded service_role JWT from live function source (ADDITIVE).
--
-- on_notification_insert and on_login_audit_insert both post to send-email-notification
-- via pg_net, carrying a service_role JWT valid to 2036-03-26 as a literal in their body.
-- Anyone able to read function source — a Management API PAT, a direct connection, a
-- backup or dump — gets a ten-year credential that bypasses every RLS policy.
--
-- send-email-notification has verify_jwt=true, so the token genuinely is required and the
-- header cannot simply be dropped. It is moved into Supabase Vault instead: the secret is
-- encrypted at rest and the function reads it at call time, so `pg_get_functiondef` no
-- longer discloses it.
--
-- The key is lifted out of the existing function definition by regex, so the literal never
-- has to be typed, pasted, or logged anywhere during the migration.
--
-- Also makes both triggers NON-FATAL. They fire on every notifications/login_audit insert,
-- and celebrations_dispatch() runs on app load — an exception here would surface as a
-- failed insert across dispatch, PO, GRN and CRM flows. Email dispatch must never be able
-- to break the write that triggered it.
--
-- Rollback: sql/c3_service_key_to_vault_down.sql
-- NOTE: this does NOT rotate the key — it stops disclosing it. Rotating the underlying
-- service_role key is a separate operation that also requires updating every edge
-- function's environment, and should be done once this is confirmed stable.

begin;

-- 1. Move the key into Vault, reading it from the function that currently embeds it.
do $$
declare k text; sid uuid;
begin
  select (regexp_match(pg_get_functiondef(p.oid),
           'Bearer (eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'))[1]
    into k
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'on_notification_insert';

  if k is null or length(k) < 40 then
    raise exception 'C3: could not extract the service_role key from on_notification_insert — aborting rather than writing an empty secret';
  end if;

  select id into sid from vault.secrets where name = 'service_role_key';
  if sid is null then
    perform vault.create_secret(k, 'service_role_key',
      'service_role JWT used by the notification triggers to call send-email-notification (verify_jwt=true)');
  else
    perform vault.update_secret(sid, k);
  end if;
end $$;

-- 2. Read the key from Vault at call time instead of embedding it, and never let a
--    dispatch failure propagate into the triggering insert.
create or replace function public.on_notification_insert()
  returns trigger language plpgsql security definer set search_path = public
as $function$
declare k text;
begin
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_key';
    if k is not null then
      perform net.http_post(
        url     := 'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/send-email-notification',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k),
        body    := jsonb_build_object('type','INSERT','table','notifications','record', row_to_json(NEW))
      );
    end if;
  exception when others then
    null;   -- email dispatch is best-effort; the notification row still stands
  end;
  return NEW;
end;
$function$;

create or replace function public.on_login_audit_insert()
  returns trigger language plpgsql security definer set search_path = public
as $function$
declare k text;
begin
  begin
    select decrypted_secret into k from vault.decrypted_secrets where name = 'service_role_key';
    if k is not null then
      perform net.http_post(
        url     := 'https://kvjihrlbntxcdadogmhn.supabase.co/functions/v1/send-email-notification',
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || k),
        body    := jsonb_build_object('type','INSERT','table','login_audit','record', row_to_json(NEW))
      );
    end if;
  exception when others then
    null;   -- a failed alert must never block a login being recorded
  end;
  return NEW;
end;
$function$;

commit;
