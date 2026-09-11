-- The Kaveri device sends NO location — 2026-09-11.
--
-- essl_location_map already has Sarkhej -> FC Kaveri, but the device at Kaveri posts an
-- empty location string instead of "Sarkhej", so essl-sync stored office_id = null for
-- every punch from it. 36 punches in the last 7 days, all six of the Ahmedabad fulfilment
-- team (Devendra, Habibmiya, Anil, Gaurav, Kamlesh, Ashvin).
--
-- This never affected ATTENDANCE — an unmapped location only leaves office_id blank; only
-- an unmatched EMPLOYEE CODE drops a punch. It affects geofence/office reporting.
--
-- A sentinel row rather than a constant in the Edge Function, so the fallback can be
-- repointed or removed from the database without a deploy.
--
-- CAVEAT worth knowing: this makes EVERY location-less punch count as Kaveri. Today only
-- Kaveri's device omits the location, so that is correct. If another device ever stops
-- sending one — device 23 "Automation" at Moraiya is the obvious candidate — its punches
-- would be silently labelled Kaveri. The real fix is the device sending "Sarkhej"; this is
-- the safety net.
insert into public.essl_location_map (essl_location, office_id, active)
select '__default__', id, true from public.office_locations where branch = 'FC Kaveri'
on conflict (essl_location) do update set office_id = excluded.office_id, active = true;

select essl_location, office_id, active from public.essl_location_map order by essl_location;
