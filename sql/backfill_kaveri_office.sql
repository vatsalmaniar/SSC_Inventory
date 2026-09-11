-- Backfill the office on Kaveri's location-less punches — 2026-09-11.
--
-- The Kaveri device posts an empty location, so essl-sync stored office_id = null.
-- sql/essl_default_location_kaveri.sql fixes this going forward; this repairs history.
--
-- SCOPE IS DELIBERATELY NARROW. There are 3,608 biometric punches with no office, and
-- MOST OF THEM ARE NOT KAVERI:
--   * note 'ESSL'  (uppercase) 1 Apr – 22 Jul, 3,334 punches — the original import, both
--     cities, before location mapping existed. LEFT ALONE.
--   * note 'eSSL'  24 Jul, 5 punches — Krisha, Jyotsana, Sudheer, Maunang, Vasant, all
--     VADODARA, on the day the new connector started before it sent locations. LEFT ALONE.
--   * note 'eSSL'  from 1 Aug — 274 punches, only the six Ahmedabad fulfilment staff.
--     THIS is the Kaveri device, and the only thing updated here.
-- A blanket "office_id is null -> Kaveri" would have mislabelled Vadodara staff.
--
-- trg_audit_cols is disabled for the statement: this is a repair of data the system got
-- wrong, not a human edit, and stamping updated_at/updated_by today would make 274 punches
-- look as though someone changed them (see feedback_backfill_must_not_stamp_audit_cols).

begin;
alter table public.attendance_punches disable trigger trg_audit_cols;

update public.attendance_punches ap
   set office_id = (select id from public.office_locations where branch = 'FC Kaveri')
  from public.employees e
 where e.id = ap.employee_id
   and ap.method = 'biometric'
   and ap.office_id is null
   and ap.note = 'eSSL'
   and ap.punch_at >= timestamptz '2026-08-01 00:00+05:30'
   and e.full_name in ('Anil Meena','Ashvin Chunara','Devendra Meena',
                       'Gaurav Parmar','Habibmiya Momin','Kamlesh Parmar');

alter table public.attendance_punches enable trigger trg_audit_cols;
commit;
