-- Staff never receive email — 2026-09-05 (user: "they do not need any emails just remove
-- staff for any email").
--
-- WHY THIS MATTERS: the nine warehouse logins have no mailbox. The address exists only as
-- a login name, so every mail sent to them bounces, and a stream of bounces teaches Gmail
-- to distrust the whole ssccontrol.com domain — at which point genuine customer and vendor
-- mail starts landing in spam. The cost is not the wasted email, it is the sender reputation.
--
-- WHY NOT email_preferences: those four switches (mentions / status_changes / login_alerts /
-- crm_alerts) are already set false for all nine, but the dispatcher keeps an ALWAYS_SEND
-- list — approval_request, approval_decision and the celebration types — which deliberately
-- bypasses preferences so nobody misses a decision waiting on them. So preferences alone
-- can never be airtight.
--
-- HOW THIS WORKS: send-email-notification returns 'no email_type, skipped' for any
-- notification row whose email_type is null — that is exactly how bell-only events already
-- behave. Stripping email_type at INSERT therefore blocks EVERY type, including the
-- ALWAYS_SEND ones, with no Edge Function deploy. The bell notification itself is
-- untouched: staff still see it in the app, which is where they read it anyway.

create or replace function public.strip_email_for_staff() returns trigger
language plpgsql as $body$
begin
  if new.email_type is not null
     and (select p.role from public.profiles p where p.id = new.user_id) = 'staff' then
    new.email_type := null;   -- bell only; the dispatcher skips rows with no email_type
  end if;
  return new;
end $body$;

drop trigger if exists trg_strip_email_for_staff on public.notifications;
create trigger trg_strip_email_for_staff before insert on public.notifications
  for each row execute function public.strip_email_for_staff();

-- ROLLBACK: drop trigger trg_strip_email_for_staff on public.notifications;
