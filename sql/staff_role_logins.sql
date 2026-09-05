-- 'staff' role — People-360-only logins for warehouse & back office. 2026-09-05.
--
-- WHY: 9 employees (7 Operation & Support, 2 Back Office) had no login at all, so they
-- could not apply for leave or raise a regularization; someone filed on their behalf.
-- They are NOT to get FC access, orders, CRM or expenses — People 360 and nothing else.
--
-- WHY THIS IS SAFE BY DEFAULT: the app is allow-list throughout
-- (`if (!['a','b'].includes(role)) navigate away`), and Layout's NAV_ITEMS has no 'all'
-- entry, so an unrecognised role is denied everywhere and Layout.accessDenied turns the
-- omission into a hard block. The work was GRANTING People, not blocking the rest.
--
-- MEASURED before writing any of this, with a throwaway staff account inside a rolled-back
-- transaction (impersonating via request.jwt.claims):
--     employee_compensation      1   <- his OWN row (comp_read_self, same for every role)
--     employee_private           0
--     kpi_snapshots              0
--     leave_requests             0   own only
--     regularizations            0   own only
--     attendance_days          146   own only (his biometric punches)
--     att_visible_employees      1   self only -> no person dropdown, as intended
--     employees                 41   directory, open by decision (see people_access_rules)
-- No RLS change was needed: att_can_see(), the expense policies and att_visible_employees()
-- all fall through to self-only for a role they do not recognise. That is the payoff from
-- sql/people_access_rules.sql having put the rule in ONE place.
--
-- KNOWN, ACCEPTED: `orders` and `inventory` have no per-role RLS, so any authenticated
-- user can read them through the API even with no nav link. Already true of all 25
-- existing logins; this adds 9 more holders of that key. Flagged to the user 2026-09-05,
-- deliberately NOT bundled here — it is a separate tightening pass.

-- ── 1. The role must be permitted by the CHECK before any insert ────────────
-- profiles_role_check is what rejected the first probe; forget this and user creation
-- fails with a constraint violation that looks like a typo.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role = any (array[
  'sales','ops','admin','accounts','fc_kaveri','fc_godawari','management','demo','staff'
]));

-- ── 2. Create one login ─────────────────────────────────────────────────────
-- NOTE the upsert on profiles: a trigger on auth.users already creates the profile row,
-- so a plain INSERT here fails on profiles_pkey. (Found the hard way.)
--
-- The employees.profile_id link is NOT optional — it is what makes their biometric
-- attendance and leave balance resolve as theirs. Without it they log in to an empty page.
--
-- No mailbox is required: email_confirmed_at is stamped at creation, so Supabase never
-- sends or checks a verification mail, and signInWithPassword only validates the password.
-- The address is an identifier; the login page builds it from the username.
-- Consequences: no self-service password reset (admin resets), and outbound mail to these
-- addresses will BOUNCE — so notifications must be off for them (step 3).
--
-- MFA needs no work: Login.jsx runs checkAdminMFA() for every role except 'demo', so
-- these users are forced into TOTP enrolment on first login.

do $$
declare uid uuid := gen_random_uuid();
  v_name text := 'Ashvin Chunara';
  v_user text := 'ashvin.chunara';
begin
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
    aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values (uid, '00000000-0000-0000-0000-000000000000', v_user || '@ssccontrol.com',
    crypt('Ssc@2026', gen_salt('bf')), now(), 'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    json_build_object('name', v_name, 'role', 'staff')::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, name, role, username, must_change_password)
  values (uid, v_name, 'staff', v_user, true)
  on conflict (id) do update set name = excluded.name, role = excluded.role,
    username = excluded.username, must_change_password = true;

  update public.employees set profile_id = uid
   where full_name = v_name and profile_id is null;

  if not found then raise exception 'employee % not found or already linked', v_name; end if;
end $$;

-- ── 3. Suppress outbound mail to the non-existent mailboxes ─────────────────
-- Bounces to addresses that do not exist damage the Resend sending reputation for the
-- whole domain. Their MANAGER still receives the approval mail — that is the one that
-- matters; the requester only needs the in-app bell.
-- (Set once the notification preference rows exist for the new users.)

-- ROLLBACK for one user:
--   delete from public.profiles where username = '<username>';
--   delete from auth.users where email = '<username>@ssccontrol.com';
--   update public.employees set profile_id = null where full_name = '<name>';
-- The employee row itself must NEVER be deleted (see feedback_never_delete_users).
