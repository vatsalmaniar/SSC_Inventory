-- Birthday / work-anniversary bell notifications + emails.
-- Mirrors the dispatch-email flow: insert into notifications -> on_notification_insert
-- trigger -> send-email-notification edge function. Deduped once/day via celebration_log.
-- No cron: celebrations_dispatch() is called on app load (piggyback).

create table if not exists public.celebration_log (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid references public.employees(id) on delete cascade,
  kind          text not null check (kind in ('birthday','anniversary')),
  celebrated_on date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (employee_id, kind, celebrated_on)
);
alter table public.celebration_log enable row level security;
drop policy if exists cel_log_read on public.celebration_log;
create policy cel_log_read on public.celebration_log for select using (true);
-- writes happen only inside the SECURITY DEFINER function below

create or replace function public.celebrations_dispatch()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c record; rec record; n int := 0;
  celebrant_pid uuid; nm text; msg_self text; msg_team text; et_self text; et_team text;
begin
  for c in select * from public.celebrations_today() loop
    -- dedup: log today's celebration; if already logged, skip entirely
    begin
      insert into public.celebration_log(employee_id, kind, celebrated_on)
      values (c.employee_id,
              case when c.kind = 'birthday' then 'birthday' else 'anniversary' end,
              current_date);
    exception when unique_violation then
      continue;
    end;

    nm := c.full_name;
    select profile_id into celebrant_pid from public.employees where id = c.employee_id;

    if c.kind = 'birthday' then
      et_self := 'birthday_self'; et_team := 'birthday_team';
      msg_self := 'Dear ' || nm || ',' || chr(10) || chr(10) ||
        'On behalf of everyone at SSC Control, we wish you a very Happy Birthday!' || chr(10) || chr(10) ||
        'Thank you for being a valued part of our family. Your dedication, energy and the spirit you bring to work make a real difference every single day. May this year bring you good health, happiness, success and everything your heart desires.' || chr(10) || chr(10) ||
        'Here''s to celebrating you today — enjoy your special day to the fullest!' || chr(10) || chr(10) ||
        'Warm wishes,' || chr(10) || 'Team SSC';
      msg_team := 'It''s ' || nm || '''s birthday today! Take a moment to drop by and wish them a wonderful day.';
    else
      et_self := 'anniv_self'; et_team := 'anniv_team';
      msg_self := 'Dear ' || nm || ',' || chr(10) || chr(10) ||
        'Congratulations on completing ' || c.years || ' year' || case when c.years > 1 then 's' else '' end || ' with SSC Control!' || chr(10) || chr(10) ||
        'Your hard work, commitment and contributions over these years have been invaluable to our growth. Thank you for your trust, your effort and for being an essential part of the SSC journey. We are proud to have you with us and look forward to achieving many more milestones together.' || chr(10) || chr(10) ||
        'Here''s to you, and to many more successful years ahead!' || chr(10) || chr(10) ||
        'With gratitude,' || chr(10) || 'Team SSC';
      msg_team := nm || ' completes ' || c.years || ' year' || case when c.years > 1 then 's' else '' end || ' with SSC today! Congratulate them on this milestone.';
    end if;

    -- one notification per active login employee (bell + email via trigger)
    for rec in
      select p.id, coalesce(p.name, p.username) as name
      from public.profiles p
      join public.employees e on e.profile_id = p.id
      where coalesce(e.lifecycle_status,'') <> 'exited'
    loop
      if celebrant_pid is not null and rec.id = celebrant_pid then
        insert into public.notifications(user_id, user_name, from_name, message, email_type)
        values (rec.id, rec.name, 'Team SSC', msg_self, et_self);
      else
        insert into public.notifications(user_id, user_name, from_name, message, email_type)
        values (rec.id, rec.name, nm, msg_team, et_team);
      end if;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

grant execute on function public.celebrations_dispatch() to authenticated;
