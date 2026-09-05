-- Web punch enabled for FC and staff — 2026-09-05 (user request).
--
-- BEFORE: web check-in was sales/admin/management only, enforced in TWO places —
--   1. PunchButton.jsx:33  setCanPunch(['sales','admin','management'].includes(role))
--   2. this trigger, enforce_web_punch_role, which raises
--      "Web check-in is restricted to sales, admin & management — please use the
--       biometric device" on any INSERT with method = 'web'.
-- Changing only the component would have produced a button that always errors, so both
-- move together.
--
-- WHY IT WORKS GEOGRAPHICALLY (checked before changing anything): office_locations
-- already holds FC Kaveri (22.9814, 72.4911) and FC Godawari (22.2919, 73.1882) at 150 m,
-- alongside Ahmedabad. The people being enabled sit exactly there:
--     fc_kaveri   Anil Meena      Ahmedabad
--     fc_godawari Sunil Dodiya    Vadodara
--     staff       6 Ahmedabad (Ashvin, Devendra, Gaurav, Habibmiya, Kamlesh, …)
--                 3 Vadodara  (Ishwar, Shailesh, Vasant)
-- So their punches resolve to a real office_id and within_geofence = true. No new
-- geofence row is needed.
--
-- NOTE: this ADDS a web route; it does not remove the biometric one. Both feed
-- attendance_punches, and attendance_days is still built from whatever punches exist.
-- Staff who continue to use the fingerprint device are unaffected.

create or replace function public.enforce_web_punch_role() returns trigger
language plpgsql as $body$
declare v_role text;
begin
  if NEW.method = 'web' then
    select p.role into v_role
      from employees e join profiles p on p.id = e.profile_id
     where e.id = NEW.employee_id;
    if v_role is null or v_role not in
       ('sales','admin','management','fc_kaveri','fc_godawari','staff') then
      raise exception 'Web check-in is not enabled for your role — please use the biometric device';
    end if;
  end if;
  return NEW;
end $body$;

-- ROLLBACK: restore the role list to ('sales','admin','management').
