-- active_people — the ONE list of people who may still be PICKED. 2026-09-10.
--
-- Bhavesh Patel and Akash Devda have left (employees.lifecycle_status = 'exited',
-- auth.users.banned_until set), yet both still appeared in every owner picker,
-- @mention list and CRM rep dropdown, because those all query `profiles` filtered
-- only by role — and a leaver keeps their role.
--
-- WHY A VIEW AND NOT A FILTER IN 46 PLACES: there are 46 people-lists in the app.
-- Patching each is how they drift apart again. One view, and a picker asks it.
--
-- WHAT THIS IS *NOT* FOR: resolving a name for a historical record. An old order,
-- comment or approval must still render "Bhavesh Patel" as its owner, so those
-- lookups keep reading `profiles`. Filtering them would blank the owner on every
-- record a leaver ever touched. The rule is:
--     picking a person  -> active_people
--     showing a name    -> profiles
--
-- NOT security_invoker, deliberately. The suspension flag lives in auth.users, which
-- `authenticated` has no rights on — with security_invoker the view failed outright for
-- every normal user ("permission denied for table users"). Caught by testing as a real
-- role rather than as postgres. Running with the owner's rights lets it read auth.users.
--
-- What that costs: RLS on public.profiles is not applied inside the view. That is
-- acceptable TODAY because profiles is readable by every authenticated user anyway, and
-- the view exposes no column profiles does not. If profiles is ever scoped per-user,
-- this view must be revisited or it becomes a way around that scoping.
create or replace view public.active_people as
  select p.id, p.name, p.username, p.role, p.email, p.location
    from public.profiles p
    left join auth.users      u on u.id = p.id
    left join public.employees e on e.profile_id = p.id
   where coalesce(u.banned_until, '-infinity'::timestamptz) <= now()
     and coalesce(e.lifecycle_status, '') <> 'exited';

revoke all on public.active_people from public, anon;
grant select on public.active_people to authenticated, service_role;
