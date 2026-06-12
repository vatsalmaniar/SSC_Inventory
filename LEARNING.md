# SSC Inventory — Engineering Learnings

A consolidated reference for **two audiences**:
1. **Future agents working on this same app** — read before touching any module, check the relevant section, follow the patterns.
2. **Future SSC projects** (SSC Automation, SSC Field, SSC Vendor Portal, etc.) — this is the foundation document. Start every new SSC app from these conventions.

Captures every hard-won lesson from building the ERP: bugs, security findings, performance pitfalls, deferred features, future ideas, and user expectations.

### How to read this file
- Each section is independent. Use it as a checklist when starting any new feature or app.
- Quoted user instructions are constraints with the same weight as a spec.
- §24 is the **deferred / future** list — what's planned but not yet built, and what's known-broken-but-accepted.

### How to MAINTAIN this file (rules for every agent)

This document must stay alive. After every meaningful change:

- **If you fixed a bug that could happen again** (any data corruption, silent failure, race, integration quirk) → add a sub-section under the relevant chapter OR a new entry in §12 "war stories", with: symptom, root cause, fix.
- **If you built a feature with non-trivial logic** (state machines, multi-step flows, edge-case-heavy UI, cross-page invariants) → add a section describing the rules so the next agent doesn't have to re-derive them from the code.
- **If you made a groundbreaking change** (new state machine, new pipeline gate, schema redesign, security model change) → add a section before §24 with: what changed, why, what it replaces, what cannot be done after this change.
- **If you found a problem but deferred the fix** → add it under §24 "Deferred / future work" with: the problem, scoped fix, what triggers picking it back up, smoke-test checklist.
- **If the user gives a rule or preference** ("don't do X", "always do Y", "this should never happen") → quote it and add to the relevant chapter. The user's rules are higher-weight than your preferences.

Every commit that closes one of these qualifies → update LEARNING.md in the same commit. Don't let the doc drift from reality.

---

## 0. The five hard rules

Carry these into every change. They override convenience and aesthetics.

1. **Never break a working flow.** Before changing a single line, trace every dependent path. What is working must keep working. No data must be lost or hidden as a side effect.
2. **"Confirm twice" is on you, not the user.** Read the code twice — pass 1 to list dependents, pass 2 to reason about each one under your change. Only then edit. Never ship-and-hope; the user is not your safety net.
3. **Never push to git or deploy to Vercel without explicit "go live" from the user.** Always build, test on localhost, walk the user through the change, get approval, then push.
4. **Database safety:** Never DELETE/DROP rows, columns, tables, or policies from Supabase without explicit user confirmation. Schema changes are additive by default.
5. **Never load a full table/filter in one query — PostgREST silently caps at 1,000 rows.** Any `sb.from(X).select(...)` that intends to load "all of something" returns at most 1,000 rows with NO error — the rest vanish, and every count/total/chip computed from it is silently wrong. This already bit us twice: items (only 1,000 of 9,700 searchable) and orders (Cancelled chip read 11 not 25; Total Order Value read 6.8 Cr not 9.2 Cr once orders crossed 1,000/FY). For a full set use `fetchAll()` ([src/lib/fetchAll.js](src/lib/fetchAll.js)); for a big list use server-side pagination (`.range(from, to)` per page). Before writing any `.select()` that loads a collection, ask: *"can this table exceed 1,000 rows in a year?"* If yes, you may not load it in one query. See §2.10.

These were not theoretical — each one is the scar of a real incident in this project.

---

## 1. Tech stack & baseline conventions

### Stack
- **Frontend:** React 19 + Vite 6 SPA. No SSR. Hosted on **Vercel** (auto-deploys on push to `main`).
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + Realtime).
- **Email:** Resend via Supabase Edge Functions.
- **PDFs:** `html2pdf.js` (browser-rendered) for invoices, POs, DCs, GRNs.
- **Excel:** `xlsx` (SheetJS) for simple lists; `exceljs` for styled detailed exports.
- **Fonts:** Geist + Geist Mono, self-hosted at `/public/fonts/` (never load from Google Fonts — see §6).
- **Maps:** Leaflet + OpenStreetMap tiles + Nominatim geocoding.

### File / route conventions
- Each major feature is one page under `src/pages/`, lazy-loaded in `src/App.jsx`.
- Shared utilities in `src/lib/` — `fmt.js` (date helpers + `FY_START`), `toast.js`, `geo.js`, `errorMsg.js`. **Never duplicate these locally** in pages.
- Styles in `src/styles/`. Page-specific CSS files (e.g. `orderdetail.css`) plus a `theme.css` for dark-mode overrides.
- SQL migrations as plain `.sql` files in `sql/`. Apply via Supabase SQL editor or Management API. Keep them additive.

### Code style guardrails
- **Edit tool only — never bash sed.** `sed` corrupted 18 files in one go in this repo. Use the `Edit` tool with `replace_all` when you need to change all occurrences in a file.
- **No emojis in code unless explicitly requested.**
- **Default to terse responses.** No trailing summaries, no narrating internal deliberation.

---

## 2. Supabase: the gotchas that have actually bitten us

### 2.1 PostgREST `.in()` URL truncation
**Symptom:** Coverage queries silently returned partial results once a customer order list grew to ~360 entries. Some orders marked "pending" forever because their linked PO was lost to truncation.

**Cause:** `.in('order_id', coIds)` puts every UUID in the URL. PostgREST's URL cap is ~8 KB. Each UUID + delimiters is ~40 chars → above ~200 IDs the request is silently truncated.

**Fix pattern:**
```js
async function chunkedFetch(builderFn, ids, chunkSize = 150) {
  const all = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data } = await builderFn(ids.slice(i, i + chunkSize))
    if (data?.length) all.push(...data)
  }
  return all
}
```
Use whenever an `.in(col, ids)` list could exceed ~150 entries.

### 2.2 PostgREST `.in()` silently drops values with embedded quotes / parens
**Symptom:** Item codes like `8" Filter Kit (238X238)` returned no rows from `.in('item_code', codes)`. Free-text matching broke for ~30% of CO line items.

**Cause:** The Supabase JS client wraps values containing `,` `(` `)` in double quotes but does NOT escape embedded `"`. The resulting `in.(...)` URL is malformed; PostgREST parses entries until the first bad one, then silently drops the rest.

**Fix:** For free-text key lookups (item codes, customer names, vendor names — anything a human typed), don't use `.in()`. Use parallel `.eq()` via `Promise.all`:
```js
const results = await Promise.all(
  codes.map(code => sb.from('items').select('item_code,type').eq('item_code', code).maybeSingle())
)
```
N+1 queries are fine when N ≤ 50.

### 2.3 Order of embedded resources is unstable
**Symptom:** Items rendered as 3, 1, 2 instead of 1, 2, 3 after partial dispatches/edits.

**Cause:** `select('*, order_items(*)')` has no ORDER BY on the embed. PostgREST returns rows in Postgres heap order, which shifts after every UPDATE.

**Fix:** Always specify ordering for embedded resources via supabase-js `referencedTable` syntax, or sort client-side immediately after fetch:
```js
if (data?.order_items) data.order_items.sort((a, b) => (a.sr_no || 0) - (b.sr_no || 0))
```
Apply for any embed where row order matters in the UI.

### 2.4 Edge function deploys via the Management API can corrupt source
**Symptom:** Notification emails silently failed for 2 days. `pg_net` was returning 503 BOOT_ERROR on every call.

**Cause:** Deploying via the Management API's `PATCH /v1/projects/{ref}/functions/{slug}` endpoint with a JSON body containing the source code dropped the first 4 characters (`impo` from `import`). Deno couldn't parse `rt { serve }` and refused to boot. No error surfaced in the API response.

**Fix — never use the raw-body PATCH endpoint.** Always deploy with the official CLI:
```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
npx -y supabase@latest functions deploy <slug> --project-ref <ref>
```
The CLI packages the function as an ESZIP bundle and uploads via a different endpoint that doesn't corrupt.

**Always smoke-test after deploy.** For notification functions:
```sql
-- 1. Insert a test notification
INSERT INTO notifications (user_id, user_name, message, email_type, from_name)
SELECT id, name, '[TEST]', 'mention', 'System' FROM profiles WHERE username = 'admin.user'
RETURNING id;

-- 2. Wait 5s, check pg_net response
SELECT created, status_code, content::text FROM net._http_response
WHERE created > now() - interval '30 seconds' ORDER BY created DESC LIMIT 3;
```
Expected: `status_code = 200`, `content = "sent"`. Anything else → roll back.

### 2.5 RPC RLS interplay — triggers run as the caller
**Symptom:** Order creation broke in production after enabling RLS on `order_number_counters`.

**Cause:** The `orders` BEFORE INSERT trigger that generates order numbers reads/writes `order_number_counters`. Triggers without `SECURITY DEFINER` run as the calling user, so they hit RLS. RPCs without `SECURITY DEFINER` do too.

**Fix:** When enabling RLS on a counter/sequence/audit table, either:
- Mark the relevant trigger function `SECURITY DEFINER`, OR
- Add an explicit authenticated read/write policy on the table.

The advisor wants RLS enabled, but the trigger inserts must still succeed.

### 2.6 Supabase `.catch()` is not on the query builder
**Symptom:** `sb.from(...).insert(...).catch is not a function` runtime errors in edge functions.

**Cause:** The Supabase v2 query builder is "thenable" but doesn't expose `.catch()` directly.

**Fix:** Use `await` with try/catch instead of `.catch(...)`:
```ts
// WRONG
await sb.from('logs').insert(row).catch(() => {})
// RIGHT
try { await sb.from('logs').insert(row) } catch (_) {}
```

### 2.7 Supabase JS auto-refresh on offline
`sb.auth.getSession()` reads from localStorage — no network call usually. But if the access token is expired, it triggers a refresh, which fails offline. Handle the offline path: don't redirect users away from their current page just because a profile fetch failed mid-load.

### 2.8 `.from('grn_items').order('sr_no')` will 500
`grn_items` has no `sr_no` column. Default order it by `id` or `created_at`. Per-table column awareness matters — always verify against `information_schema.columns` before writing a query.

### 2.9 Never trial-and-error SQL
If you're guessing at a column or table name, you'll guess wrong. Always verify via:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = '<name>' ORDER BY ordinal_position;
```
Frontend code referencing a column is **not proof** that column exists — code can lie.

### 2.10 The 1,000-row cap is the most dangerous bug in this codebase (Hard Rule #5)
**Symptom:** A list/dashboard silently shows wrong totals once a table crosses 1,000 rows. The page looks fine — no error, no blank screen — the numbers are just quietly wrong. Hit twice: items (only 1,000 of 9,700 searchable) and orders (Cancelled chip read 11 not 25; Total Order Value read 6.8 Cr not the true 9.2 Cr once FY orders passed 1,000).

**Cause:** PostgREST caps any single `select` at `db.max-rows` (1,000 here). `sb.from('orders').select(...).gte('created_at', FY_START)` returns the **newest 1,000 rows and silently drops the rest**. Every count/sum/chip computed in the browser from that array is then understated. `.limit(500)` is the same trap, lower.

**Fix — for a FULL set, use `fetchAll` ([src/lib/fetchAll.js](src/lib/fetchAll.js)):**
```js
const { data, error, truncated } = await fetchAll((from, to) =>
  sb.from('orders').select('...').gte('created_at', FY_START).eq('is_test', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })   // unique tiebreaker — REQUIRED for stable paging
    .range(from, to)
)
```
It pages in 1,000-row windows until done, with a 100k-row ceiling that sets `truncated` + logs (never silent). Always add a unique tiebreaker (`.order('id')`) alongside your sort, or rows at a page boundary can skip/duplicate.

**Fix — for a BIG list the user browses, use server-side pagination** (`.range(from, to)` for the visible page only + a count) rather than loading everything. ItemMaster / CustomerMaster / VendorMaster already do this.

**The rule (Hard Rule #5):** before any `.select()` that loads a collection, ask *"can this table exceed 1,000 rows in a year?"* If yes, you may **not** load it in one query. Pages already converted: OrdersList, Orders, OpsOrders, BillingList, BillingDashboard, FCModule, FCDashboard, SalesModule, Dashboard. Tables already past 1,000 (audit any new page touching them): notifications (10k), items (9.7k), customers (4.2k), po_items (2.5k), orders/dispatches (1.4k each).

### 2.11 One canonical formula per business metric — never inline math twice
**Symptom:** `/orders` showed 9.28 Cr and `/orders/list` showed 9.25 Cr on the same data. Not a bug in either — each page had rolled its own "order value" formula and they disagreed (one included cancelled orders, the other added freight).

**Cause:** the same business number was computed inline in multiple files. They drift the moment one is edited.

**Fix:** any metric shown in more than one place gets ONE shared helper. Order value lives in [src/lib/orderValue.js](src/lib/orderValue.js): `orderNetValue(order)` / `ordersTotalValue(orders)` — **cancelled orders contribute 0, partial cancels are netted out, freight is excluded** (freight is logistics, not order value). Every page imports it; no page re-derives the math. Same principle as fmt.js, fetchAll.js — if you catch yourself writing a value/total/ratio reduce() that exists elsewhere, extract it to lib instead.

---

## 3. Authentication, sessions, and password policy

### 3.1 Conservative password-age check
**Bug:** Login.jsx and Layout.jsx both had:
```js
const ageMs = profile?.password_changed_at
  ? (Date.now() - new Date(profile.password_changed_at).getTime())
  : Infinity   // ← treats missing as "infinitely old"
if (ageMs > 90 days || profile?.must_change_password) navigate('/change-password')
```
When the profile fetch failed (network glitch, RLS race, internet flicker on an offline-capable PWA), `profile` was null → `ageMs = Infinity` → user got bounced to `/change-password` mid-task.

**Fix:**
```js
const ageMs = profile?.password_changed_at
  ? (Date.now() - new Date(profile.password_changed_at).getTime())
  : null   // ← unknown, don't force
const expiredByAge = ageMs !== null && ageMs > 90 days
const needsPwdChange = (profile?.must_change_password === true) || expiredByAge
```
Force a change ONLY on definite evidence: an explicit `must_change_password = true` flag OR a `password_changed_at` that is actually older than the policy.

Apply this in every place that checks password age. Layout/AuthGuard especially — it runs on EVERY page navigation.

### 3.2 Username → email convention
Users log in with a `username` (e.g. `vatsal.maniar`). The app appends `@<company-domain>.com` to construct the email for `signInWithPassword`. This keeps Supabase Auth happy without exposing emails to the UI.

### 3.3 MFA / TOTP for admins
TOTP MFA is enabled for admin role. The login flow checks AAL (authentication assurance level):
- If user has MFA enrolled but session is AAL1, prompt for TOTP.
- Password changes require AAL2 — if the session is AAL1, sign out and require fresh login.

Standard Supabase MFA APIs work — `sb.auth.mfa.getAuthenticatorAssuranceLevel()`, `sb.auth.mfa.challenge()`, `sb.auth.mfa.verify()`.

### 3.4 Admin password reset SQL
```sql
UPDATE auth.users
SET encrypted_password = crypt('NEWPASS', gen_salt('bf')),
    updated_at = now()
WHERE email = 'username@company.com';
```
Used when a user is locked out. Combine with clearing the force-change loop:
```sql
UPDATE public.profiles
SET must_change_password = false, password_changed_at = now()
WHERE username = 'username';
```

### 3.5 Add new user SQL pattern

**Two invariants you MUST respect — getting either wrong silently breaks login:**

1. **`auth.users.email` must equal `username || '@ssccontrol.com'`.** Login takes a username, the frontend appends the domain, then calls `signInWithPassword`. If auth.users.email is anything else (e.g. a shared role-mailbox), login silently fails. If you want emails to route to a shared mailbox, store *that* address in `profiles.email` (separate display/contact field), NOT in auth.users.email.

2. **A `handle_new_user` trigger on auth.users auto-creates the profiles row** (id, name, role from `raw_user_meta_data`), with `on conflict (id) do nothing`. So **do NOT** also `INSERT INTO profiles` — it will violate the PK. UPDATE the auto-created row instead to fill `username`, `email`, `must_change_password`.

**Canonical pattern:**

```sql
do $$
declare uid uuid := gen_random_uuid();
declare uname text := 'firstname.lastname';                  -- username (lowercase, dot)
declare display text := 'First Last';                        -- display name
declare urole text := 'sales';                               -- sales | accounts | admin | ops
declare display_email text := 'firstname.lastname@ssccontrol.com'; -- contact mailbox (often same as login; can be a shared role-mailbox)
declare pw text := 'StrongInitialPassword123!';
begin
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at, aud, role,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    uid, '00000000-0000-0000-0000-000000000000',
    uname || '@ssccontrol.com',                              -- MUST match username
    crypt(pw, gen_salt('bf')),
    now(), 'authenticated', 'authenticated',
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('name', display, 'role', urole),
    now(), now(), '', '', '', ''
  );

  -- handle_new_user trigger has inserted profiles row with id/name/role.
  -- Fill the rest:
  update public.profiles
  set username = uname,
      email = display_email,
      must_change_password = true
  where id = uid;
end $$;
```

### 3.6 Role-mailbox handovers (purchase.brd, salessupport.brd, accounts.amd)

When an employee leaves and their **shared role mailbox** must transfer to a new hire:

- **Never delete the outgoing user** — every `created_by`, `updated_by`, `account_owner` reference (across 25+ audited tables) would orphan or lose attribution. Suspend the login instead: `update auth.users set banned_until='2099-12-31' where id=...;`.
- Move the role-mailbox off the outgoing user's `profiles.email` so it doesn't collide with the new hire. Reassign the suspended user's `profiles.email` to their own name (e.g. `rajkumar.rohit@ssccontrol.com`). Their `auth.users.email` should already be `<username>@ssccontrol.com` per rule 3.5 invariant 1.
- Create the new hire with their own username (e.g. `krisha.thakkar`), `auth.users.email = krisha.thakkar@ssccontrol.com`, and **`profiles.email = purchase.brd@ssccontrol.com`** (the role mailbox).
- Result: new hire logs in with her own username, but the user-management UI and email routing for shared-inbox use cases point at the role mailbox.

**Canonical incident:** 2026-05-18 — Rajkumar Rohit (suspended, `ops`) was holding `profiles.email = purchase.brd@ssccontrol.com`. Krisha Thakkar joined to replace him. First insert attempt set `auth.users.email='purchase.brd@…'` AND `profiles.username='krisha.thakkar'` → login broke (username derived `krisha.thakkar@…` ≠ auth email). Fix: `auth.users.email = krisha.thakkar@ssccontrol.com`, keep `profiles.email = purchase.brd@ssccontrol.com`.

---

## 4. VAPT / Security baseline

This system passed an external VAPT audit on 2026-05-05. The following are non-negotiable from day one of any new SSC app.

### 4.1 Vercel `vercel.json` headers
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "X-XSS-Protection", "value": "1; mode=block" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
      { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
      { "key": "Cross-Origin-Resource-Policy", "value": "same-origin" },
      { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com; style-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com; font-src 'self' data:; img-src 'self' data: blob: https:; connect-src 'self' https://<PROJECT>.supabase.co wss://<PROJECT>.supabase.co https://api.pwnedpasswords.com https://*.hcaptcha.com https://hcaptcha.com; frame-src https://*.hcaptcha.com https://hcaptcha.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests" },
      { "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate, max-age=0" },
      { "key": "Access-Control-Allow-Origin", "value": "https://<APP-DOMAIN>" },
      { "key": "Vary", "value": "Origin" }
    ]
  }]
}
```

### 4.2 CSP fallout
The CSP above blocks Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). If any printable HTML template embeds a `<link>` to Google Fonts, html2pdf will throw "Failed to fetch" during PDF generation — `friendlyError` translates it to "Network problem", which is a *very* misleading user-facing error.

**Solution — self-host fonts:**
1. Download the woff2 from Google Fonts under their license.
2. Put them in `public/fonts/`.
3. Write `public/fonts/fonts.css` with `@font-face` rules.
4. Preload in `index.html`:
   ```html
   <link rel="preload" as="font" type="font/woff2" href="/fonts/geist-latin.woff2" crossorigin />
   <link rel="stylesheet" href="/fonts/fonts.css" />
   ```
5. Print templates reference `${window.location.origin}/fonts/fonts.css` (absolute URL, because `window.open('','_blank')` tabs have an `about:blank` base URI and won't resolve relative paths).

### 4.3 hCaptcha on login
Login uses hCaptcha. Bypassed on localhost via a hostname check:
```js
const IS_LOCALHOST = window.location.hostname === 'localhost' || ...
```
Configure both site key (in code) and secret key (in Supabase Auth settings) — Supabase Auth verifies the captcha server-side before allowing `signInWithPassword`.

### 4.4 RLS by default
**Every new public table ships with RLS enabled and explicit policies.** Never leave a table without RLS — VAPT audit flags this, and an anon key with no RLS is equivalent to publishing your data.

Standard pattern for an internal-tool table:
```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON public.<table> FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert" ON public.<table> FOR INSERT TO authenticated WITH CHECK (true);
-- For role-restricted writes:
CREATE POLICY "role_write" ON public.<table>
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','accounts')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','accounts')));
```

### 4.5 Anon-role revocation
After VAPT, the anon role was revoked from sensitive tables. Anon key can hit `auth.signInWithPassword` and that's it. Everything else requires an authenticated JWT.

### 4.6 No public.users — use auth.users + profiles
- `auth.users` stays in the `auth` schema (managed by Supabase).
- `public.profiles` has the user-facing fields (`name`, `role`, `username`, `must_change_password`, `password_changed_at`) joined by `id`.
- Always reference `profiles.id` from foreign keys, not auth.users directly.

---

## 5. Frontend patterns to copy

### 5.1 Submit guards
**Every form INSERT must use a `useRef` submit guard**, not just `disabled={saving}` — disabled state has React-update timing windows that can let a fast double-click through.
```jsx
const submitGuard = useRef(false)
async function submit() {
  if (submitGuard.current) return
  submitGuard.current = true
  try {
    // ... do work
  } finally {
    submitGuard.current = false  // or leave true if navigating away
  }
}
```
Saved orders, POs, GRNs, CRM tasks — all must have this.

### 5.2 Test Mode toggle
Every list/module page used by users carrying out real work must have an **admin-only Test Mode toggle** (amber-styled). Toggle drives `.eq('is_test', testMode)` on the data fetch.

Pattern:
```jsx
{user.role === 'admin' && (
  <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
    <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); reload(e.target.checked) }} />
    Test Mode
  </label>
)}
```
Every list table query filters by `is_test`. Every INSERT writes `is_test` from a state flag (default false).

### 5.3 Pagination
Standard 50-per-page client-side pagination for list pages. Pattern:
```jsx
const PAGE_SIZE = 50
const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
const safePage = Math.min(page, totalPages)
const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
```
For large datasets, switch to server-side `.range()` pagination.

### 5.4 Owner / Rep chip
Account owner and assigned-rep displays use a colored avatar circle + initials + name, never plain text. The color hashes deterministically from the name string.
```jsx
const PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<(n||'').length;i++) h=(n||'').charCodeAt(i)+((h<<5)-h); return PALETTE[Math.abs(h)%PALETTE.length] }
function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }
```

### 5.5 Shared utilities — never duplicate locally
- `src/lib/fmt.js` — `fmt(date)`, `fmtTs(ts)`, `FY_START` constant, `MO` month names.
- `src/lib/toast.js` — `toast(msg, 'success'|'error')`.
- `src/lib/errorMsg.js` — `friendlyError(err, fallback)` that maps Postgres / Supabase errors to human-readable strings.
- `src/lib/geo.js` — `geocodeAddress`, `haversineKm`, `SSC_OFFICES`.

Any new module imports these. Local re-implementations cause subtle date-format drift across the app.

### 5.6 Dropdown / select role filters
Role filters in profile lookups MUST include all roles that can own data. We had bugs where the management role was missing from the rep dropdown filter — users couldn't be assigned tasks.

Pattern across CRM dropdowns:
```js
sb.from('profiles').select('id,name').in('role', ['sales','admin','management']).order('name')
```
Add roles when new ones are introduced. Never hardcode `['sales','admin']` in 13 places — make a `REP_ROLES` constant.

### 5.7 Avatar / OwnerChip on the rep selector itself
When showing the current account owner in a header, use the chip — never bare text. User feedback: *"Always use avatar chip (colored circle + initials + name) for account owner / assigned rep, never plain text."*

### 5.8 Confirmation modal pattern for destructive actions
For cancel order, delete batch, etc.: a two-step modal that summarizes what will change and warns if the action is unusually destructive (e.g., "will mark >50% of stock as out-of-stock"). Red CTA color for the danger case.

---

## 6. PDF generation reliability

### 6.1 Render in an isolated iframe, not a wrapper div
**Bug:** The PO email PDF wrapper used:
```js
const wrapper = document.createElement('div')
wrapper.style.cssText = 'position:fixed;left:-99999px;...'
wrapper.innerHTML = html  // includes <style>body{...}</style>
document.body.appendChild(wrapper)
```
Two problems:
1. Inline `<style>` rules with global selectors (`*`, `body`) leaked onto the main app, briefly shifting/flickering the UI while the capture ran.
2. html2canvas in newer Chrome silently skipped capturing elements positioned far off-canvas → blank PDFs sent to real vendors.

**Fix — use an iframe:**
```js
const iframe = document.createElement('iframe')
iframe.style.cssText = 'position:fixed;left:0;top:0;width:860px;height:1px;opacity:0;pointer-events:none;z-index:-1;border:0'
document.body.appendChild(iframe)
const doc = iframe.contentDocument
doc.open(); doc.write(html); doc.close()
// Wait for <link>s and <img>s in the iframe to load
// Grow iframe height to doc.body.scrollHeight before capture
const blob = await html2pdf().set({...}).from(doc.body).outputPdf('blob')
```

### 6.2 Wait for stylesheets AND images before snapshot
```js
const linkPromises = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(l => new Promise(resolve => {
  if (l.sheet) return resolve()
  l.addEventListener('load', resolve, { once: true })
  l.addEventListener('error', resolve, { once: true })
  setTimeout(resolve, 3000)
}))
const imgPromises = Array.from(doc.querySelectorAll('img')).map(img => new Promise(resolve => {
  if (img.complete && img.naturalHeight > 0) return resolve()
  img.addEventListener('load', resolve, { once: true })
  img.addEventListener('error', resolve, { once: true })
  setTimeout(resolve, 4000)
}))
await Promise.all([...linkPromises, ...imgPromises])
if (iframe.contentWindow?.document?.fonts?.ready) {
  try { await iframe.contentWindow.document.fonts.ready } catch (_) {}
}
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
await new Promise(r => setTimeout(r, 300))
```
A 350 ms blanket wait is not enough. Wait for fonts AND each asset explicitly with a per-asset timeout cap.

### 6.3 Sanity-check the blob before sending
```js
if (!blob || blob.size < 2 * 1024) {
  toast('PDF rendered blank — email not sent. Please retry.', 'error')
  return
}
```
A real multi-line PO is 50-200 KB. Anything under 2 KB is a render failure (BOOT_ERROR, blocked CSP, missing assets). Refuse to attach it.

### 6.4 "Preview PDF" button before Send
For any email-out flow, give the user a Preview button next to Send. Click → renders the same PDF the email would carry, opens in a new tab. User verifies visually, then clicks Send. The Send path re-renders so it's identical. This is the only foolproof way to avoid emailing blank PDFs to vendors.

### 6.5 PDF email payload size
Supabase Edge Function request bodies are capped at ~6 MB. A base64-encoded PDF can hit this quickly if you also inline supporting documents. For supporting docs, send `{ url: '...' }` and let the edge function fetch them, instead of inlining base64.

### 6.6 Resend rate limits
Resend allows 5 req/sec by default. For batch goods-issue emails (multiple recipients per batch), serialize sends or batch into one email with multiple `to` addresses. Otherwise expect `429 rate_limit_exceeded` for late recipients.

---

## 7. Email notification architecture

### 7.1 The pipeline (Supabase native)
```
App → INSERT into public.notifications
   ↓ (database trigger on_notification_insert_trigger)
SECURITY DEFINER plpgsql function on_notification_insert()
   ↓ (calls net.http_post via pg_net)
Edge function send-email-notification
   ↓
Resend API → user's inbox
   ↓ (logs)
public.email_log table
```

### 7.2 Trigger function template
```sql
CREATE OR REPLACE FUNCTION public.on_notification_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/send-email-notification',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <SERVICE_ROLE_JWT>"}'::jsonb,
    body := jsonb_build_object('type', 'INSERT', 'table', 'notifications', 'record', row_to_json(NEW))
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_notification_insert_trigger
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION on_notification_insert();
```

### 7.3 Notification row schema
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  user_name text,
  message text,
  email_type text,    -- 'mention' | 'assignment' | 'order_dispatched' | 'goods_issued' | 'order_delivered' | ...
  order_id uuid,
  order_number text,
  from_name text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
```

### 7.4 Per-user opt-out
`email_preferences` table with boolean columns per category (`status_changes`, `mentions`, `crm_alerts`). NULL = opted in (default). The edge function checks the relevant column before sending.

### 7.5 Always log to email_log
Every send attempt — success, fail, skip — gets a row in `email_log` with the status and (if failed) the error_message. This is THE diagnostic table when "emails aren't coming" — read it first.

### 7.6 Diagnostic SQL when "emails not coming"
```sql
-- Recent notifications + email_log status
SELECT n.created_at, n.email_type, n.user_name, n.message,
       l.status, l.error_message
FROM notifications n
LEFT JOIN email_log l ON l.notification_id = n.id
WHERE n.created_at > now() - interval '2 days'
ORDER BY n.created_at DESC LIMIT 15;

-- If status is null for all rows → trigger or edge function broken
-- Check pg_net responses:
SELECT created, status_code, content::text FROM net._http_response
WHERE created > now() - interval '1 hour' ORDER BY created DESC LIMIT 10;
```

### 7.7 Don't ship cron / heavy automation on a Micro plan
We had a daily-summary cron job DoS the database on a Nano plan (2026-04-21). Even after upgrading to Micro, the burstable t4g.micro can choke if scheduled jobs pile up. Rule: **flag risk before adding any scheduled job, edge function cron, webhook polling, or table-trigger that fan-outs**. Test compute usage before going live.

---

## 8. Order / dispatch state machine

Even if the next SSC app isn't an ERP, these patterns generalize to any "lifecycle of an entity" workflow.

### 8.1 Two-gate model for partial fulfilment
For order_items, store three quantities:
- `qty` — what the customer ordered.
- `dispatched_qty` — incremented when a delivery batch is created (gate 1: delivery_created).
- `posted_qty` — incremented when accounts confirms goods-issue (gate 2: goods_issue_posted).
- `delivered_qty` — set when the batch reaches `dispatched_fc` (final delivery confirmation).
- `cancelled_qty` — increments on partial cancellation.

**Pending = qty − posted_qty − cancelled_qty** (what's not yet GI-posted).
**Undispatched = qty − dispatched_qty − cancelled_qty** (what's not yet reserved in a batch — gates the "Next Batch" button).

Use the right counter for the right check. Confusing dispatched_qty with posted_qty is what caused our "PARTIAL badge on full delivery" bug.

### 8.2 Status pipeline + cancel cutoff
```
pending → inv_check → inventory_check → dispatch → delivery_created → goods_issued → ... → dispatched_fc
                                                                       ^
                                                               cancel cutoff
```
After `goods_issue_posted` you can no longer cancel the line. Validate this in DB trigger AND in UI.

### 8.3 Forecast = delivered_qty
For "delivered orders this FY", use `delivered_qty`, not `posted_qty` or `dispatched_qty`. Got bitten by this when forecast counts were wrong.

### 8.4 Item type drives order type
Each item has `type` IN ('CI', 'SI'):
- CI = Customised Item → triggers Customer Order (CO) auto-routing
- SI = Standard Item → can be Stock Order (SO)

When any line is CI, the order auto-routes to CO. Confirm with the user if a pure-SI order is incorrectly typed CO.

### 8.5 From-stock procurement source
`order_items.procurement_source` IN ('po', 'stock'). Default 'po'. Allows closing a CO line "from stock" without creating a sham PO that gets cancelled later. Coverage queries treat both `po_items.order_item_id IS NOT NULL` and `procurement_source = 'stock'` as "covered".

### 8.6 sr_no preservation
When user edits an order's line items, **preserve original sr_no values** even when items are added/removed in the middle. Don't renumber. The current `replace_order_items` RPC uses positional matching which silently rotates `item_code` across rows — to be replaced with id-based matching. See `project_order_items_sr_no_rpc_fix.md` for the deferred fix plan.

---

## 9. CO → PO coverage

### 9.1 Coverage rule
A CO line is "covered" if either:
- A `po_items` row references it via `order_item_id`, OR
- `procurement_source = 'stock'` (closed without procurement).

Apply consistently across `ProcurementOrders`, `ProcurementDashboard`, `NewPurchaseOrder` (loadCO + fetchPendingCOs), and `OrderDetail`.

### 9.2 Cancelled-PO ghost coverage (known gap)
Currently, coverage queries don't filter out PO status — a cancelled PO's `po_items` rows still claim coverage of their CO lines. Users have exploited this: place a sham PO → cancel → CO drops out of pending queue.

**The fix:** add `.neq('status', 'cancelled')` on the linked-PO fetch in all four call sites.

Deferred (2026-05-12) because re-enabling will resurface every historical CO whose only PO was cancelled. When you do apply it, first run:
```sql
SELECT count(distinct po.order_id) AS affected_cos
FROM purchase_orders po
WHERE po.status = 'cancelled' AND po.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM purchase_orders po2 WHERE po2.order_id = po.order_id AND po2.status != 'cancelled');
```
…to see how many orders will resurface. Plan the cleanup wave.

### 9.3 Half-baked PO rollback
When creating a PO, the header insert + items insert + procurement_source update are three round-trips. If items insert fails, the header is left as an empty PO. Always wrap with rollback:
```js
const { data: po, error: hdrErr } = await sb.from('purchase_orders').insert(headerRow).select('id').single()
if (hdrErr) { toast(...); return }
const { error: itemsErr } = await sb.from('po_items').insert(lineItems)
if (itemsErr) {
  // Roll back the header so we don't leave a ghost PO with no items
  await sb.from('purchase_orders').delete().eq('id', po.id)
  toast('Failed to save PO items — rolled back.')
  return
}
```

---

## 10. CSS and theming

### 10.1 Dark mode is opt-in by `data-theme="dark"` on `<html>`
Persist preference in localStorage. Toggle via header button. Login page forces light mode (white right-panel is unreadable in dark).

### 10.2 Theme variables
Use CSS custom properties in `theme.css` — `--c-bg`, `--c-bg-2`, `--c-surface`, `--c-text`, `--c-muted`, `--c-muted-2`, `--c-line`. Component CSS uses `var(--c-text)` not hardcoded hex. Override the variables in `html[data-theme="dark"]` once.

For inline-styled "tiles" (e.g., a light-blue info banner with hex colors), give the tile a className and add a `html[data-theme="dark"] .tile-name { ... }` override in theme.css — don't try to make the inline color theme-aware.

### 10.3 Drawer pattern
Side drawers use `.od-drawer-scrim` + `.od-drawer` + `.od-drawer-head` + `.od-drawer-body`. These already have theme overrides — reuse, don't reinvent. Form drawer and view drawer use the same chrome.

### 10.4 Kanban scroll
For horizontally-scrolling kanban boards, the wheel handler should NOT always translate `deltaY` to horizontal scroll. Check if the cursor is inside a column body that still has vertical room, and let native vertical scroll happen first. Only translate to horizontal when at the column's top/bottom.

---

## 11. Excel exports

### 11.1 Two flavors
- **Summary** (SheetJS) — one row per parent entity. Fast, minimal styling.
- **Detailed** (ExcelJS) — one row per child line item with continuous serial numbers across parents. Frozen header (dark blue #0A2540, white bold text), color-coded status cells, conditional highlights (red for rejected qty, amber for short receipts), zebra striping, auto-filter.

### 11.2 Bypass the 1000-row PostgREST default
Excel exports should fetch ALL matching rows, not just page 1. Paginate the fetch:
```js
const all = []
const PAGE = 1000
let from = 0
while (true) {
  const { data, error } = await query.range(from, from + PAGE - 1)
  if (error) { toast(...); return }
  if (!data?.length) break
  all.push(...data)
  if (data.length < PAGE) break
  from += PAGE
}
```

### 11.3 File naming
`SSC_<Entity>_<FilterLabel>_<YYYY-MM-DD>.xlsx`. Use `Filtered_` prefix when any filter is active so users know it's not the full set.

---

## 12. The eight bugs that should never happen again

These are the war stories. Read each as "if you do X, this happens".

### 1. Notifications stop arriving after edge function deploy
Caused by Management API JSON-body endpoint truncating source. Always use CLI + smoke test (see §2.4).

### 2. Vendor receives a blank PDF
Caused by html2canvas snapshotting before fonts/images loaded, or before the CSP-blocked Google Fonts request errored. Use iframe rendering, wait for all assets, size-check the blob, and offer Preview before Send (see §6).

### 3. Order line items render out of order after edit/dispatch
Caused by `select('*, order_items(*)')` with no embed ORDER BY. Sort client-side by `sr_no` immediately after fetch (see §2.3).

### 4. CO marked "pending" forever despite a real PO existing
Caused by `.in('order_id', coIds)` URL truncation past ~200 IDs. Chunk in batches of 150 (see §2.1).

### 5. User stuck in change-password loop
Caused by treating missing `password_changed_at` as "infinitely old" in Login.jsx AND Layout.jsx. Both must use the conservative null-handling pattern (see §3.1).

### 6. Items with quotes or parens disappear from .in() results
Caused by PostgREST `.in()` not escaping embedded `"`. Use parallel `.eq()` for any free-text key (see §2.2).

### 7. CO drops off pending after a PO is cancelled (sham-PO loophole)
Coverage queries don't filter cancelled POs. Known gap — see §9.2.

### 8. Page flickers / UI shifts during PO email send
Caused by global CSS rules in print-template `<style>` leaking onto the main app. Render PDF in an iframe instead of a div wrapper (see §6.1).

---

## 13. Reference: standard SQL the user expects

### 13.1 Monthly notifications cleanup
Trigger phrase: "notification clean up" or "monthly cleanup". Surface these queries immediately, no questions asked.
```sql
-- Notifications older than 60 days
DELETE FROM public.notifications WHERE created_at < now() - interval '60 days';
-- email_log older than 60 days
DELETE FROM public.email_log WHERE created_at < now() - interval '60 days';
```

### 13.2 Check inventory by location
```sql
SELECT location, count(*) FROM inventory GROUP BY location;
```

### 13.3 Customer Payments Snapshot reload (Tally Bills Receivable)
Stored in `customer_payments_snapshot`. Refresh by deleting all rows + inserting parsed data from the Tally export. Overdue is defined as **bills > 90 days old** (90-120 + 120-240 + >240 buckets), not just > 30 days.

---

## 14. Supabase Management API (PAT) usage

User shares `sbp_` PATs short-term (~1 hour). Use them for diagnostic SQL and edge function ops:

```bash
# Run SQL
curl -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1"}'

# List functions
curl -X GET "https://api.supabase.com/v1/projects/<ref>/functions" \
  -H "Authorization: Bearer $PAT"

# Get function source (read-only — uploads via raw PATCH are broken; use CLI)
curl -X GET "https://api.supabase.com/v1/projects/<ref>/functions/<slug>/body" \
  -H "Authorization: Bearer $PAT"
```

PATs expire silently. If a curl returns `{"message":"Unauthorized"}`, ask the user for a fresh one.

---

## 15. Workflow rules (process, not code)

### 15.1 Never push without "go live"
Build locally. Test on localhost. Show the user what changed. Wait for explicit approval ("go live", "push", "yes push"). Only then `git push`.

### 15.2 Ask twice before changing order history
Any `UPDATE` on `order_items.item_code`, `po_items.item_code`, or `grn_items.item_code` requires preview + double confirmation. These columns are referenced in dispatch batches, invoices, and audit logs — changing them after the fact corrupts traceability.

### 15.3 Page-by-page testing for multi-file changes
After a multi-file change, walk every affected page on localhost. Staged rollout. If anything looks off, revert first, debug after. This rule was written after the 2026-05-08 prod outage.

### 15.4 Always set item_no on items insert
When inserting into `public.items`, assign the next `IN####` code in the same statement. Never leave `item_no` null.

### 15.5 Always include the human reason in commit messages
Two-line minimum. First line: what changed. Body: why. Future-you will thank present-you when debugging months later.

---

## 16. Quick-reference checklist for a new feature

Use this before opening a PR / pushing:

- [ ] Schema additive only? (No DROP / DELETE / RENAME without explicit user confirmation)
- [ ] Every new table has RLS enabled with explicit policies?
- [ ] Role checks in INSERT/UPDATE paths AND in the UI?
- [ ] `useRef` submit guard on every form INSERT?
- [ ] `is_test` column on the table + Test Mode toggle on the list page (admin only)?
- [ ] Audit / activity log entry written?
- [ ] Error surfacing — `friendlyError` wrapping every Supabase error toast?
- [ ] Embedded resources have an explicit `order` (or client-side sort)?
- [ ] `.in()` calls chunked or replaced with `.eq()` for free-text keys?
- [ ] Print templates use self-hosted fonts (`${origin}/fonts/fonts.css`), not Google CDN?
- [ ] PDF generation in iframe with asset-wait + size-check?
- [ ] Notification path (if any) writes a `notifications` row with `email_type`?
- [ ] Pagination on list pages (50/page default)?
- [ ] Dark theme variables used; no hardcoded hex for backgrounds/text in JSX?
- [ ] Owner / rep displays use `OwnerChip`, not plain text?
- [ ] Smoke-tested on localhost across at least the golden path + one edge case?
- [ ] Built locally (`npm run build`) without errors?
- [ ] User has explicitly said "push" / "go live"?

If any box is unchecked and you can't justify it, fix it before pushing.

---

## 17. The May 8, 2026 production outage — multi-page changes

On 2026-05-08, a 17-file deploy (partial-cancel + dispatch model split) was pushed after a green build and 2 manually-tested orders. Within a minute, every page in production went blank — Orders list, Procurement, Billing, Customer 360. User had to ask for an immediate revert. Data was safe (additive changes only), but the entire frontend was unusable for everyone for several minutes.

### The hard rules that came out of this

1. **A green build is not a working app.** TypeScript / Vite / lint catch syntax. They do NOT catch:
   - PostgREST schema-cache lag after a migration
   - Undefined property access at render time
   - SELECT statements referencing newly-added columns before cache reload
   - JSX errors in conditional branches the test path didn't hit
   - Realtime subscription mismatches with new column shapes
   - Cross-page side effects

2. **Walk every affected page on localhost before pushing a multi-file change.** Not "the page I built the feature on." Every page the diff touches, even tangentially.

3. **Stage rollouts.** Schema migration alone → backfill alone → RPC alone → frontend in small chunks (never 14 surfaces in one push). User eyeballs localhost after each stage.

4. **After applying a schema change**, force PostgREST cache reload (`NOTIFY pgrst, 'reload schema'`) AND verify a real REST query works before any frontend depends on the new column.

5. **When something breaks in production: revert first (within seconds), debug after.** Do NOT try to patch forward under pressure.

6. **Big PRs are a risk smell.** Diff list with 15+ files is already too risky — split it.

7. **Smell-test before any push to main:**
   - "Have I clicked through every page this change touches, signed in as the actual roles?" → if no, do not push.
   - "Could this break a page I haven't tested?" → if yes, do not push.
   - "Is the user expecting changes to N pages but I've verified 2?" → do not push.

---

## 18. Compute & infrastructure constraints

### 18.1 Supabase plan
Project runs on **t4g.micro** (2-core ARM burstable CPU, 1GB RAM) in **ap-southeast-2 (Sydney)** — upgraded from Nano on 2026-04-21 after the Nano instance went Unhealthy under normal load. Pro plan ($25/mo base) includes complimentary Micro compute.

(CLAUDE.md historically said "Mumbai" — the actual region is Sydney.)

### 18.2 What killed the Nano
On 2026-04-21: Database + PostgREST + Auth + Storage all went Unhealthy simultaneously. Users couldn't log in, SQL editor timed out. Root cause: t4g.nano CPU credits exhausted by RLS on 22 tables + BEFORE UPDATE triggers + a single Edge Function preview call spiking load.

### 18.3 Rules for staying inside Micro budget
- **No realtime subscriptions on list/dashboard pages.** Only on detail pages filtered by ID + the notification bell.
- Replication enabled only on ~6-7 tables: `notifications`, `orders`, `order_dispatches`, `order_comments`, `crm_opportunities`, `crm_activities`.
- Avoid full table scans. Always filter + paginate + index.
- Cap file upload sizes (200 KB per file in current app).
- Keep RLS policies simple — complex predicates multiply CPU cost.
- Keep triggers lean — BEFORE UPDATE on orders already stressed the instance.
- Mental test for any new feature: "Will this still work fine with 10x the current data?"
- Escalation path if Micro flaps: Small tier (+~$11/month, 2 GB RAM) — only after auditing what changed.

### 18.4 No heavy automation / scheduled jobs
Do NOT freely propose cron jobs, scheduled Edge Functions, webhooks, background workers, or polling loops. If a feature needs automation:
- Call out load implications up front ("fires X times per day, each call runs Y queries")
- Default to lowest acceptable frequency — daily > hourly > 15-min (never every-minute on this DB)
- Always pair with a manual-trigger path so it can be tested once before enabling the schedule
- Prefer event-driven triggers (on-insert) over polling/cron, but only on low-churn tables
- Never schedule a job with fan-out queries (multiple joins, full-table scans, N+1) more than once per day

### 18.5 daily-summary Edge Function — removed, do not re-add
A `daily-summary` Edge Function (end-of-day admin email with dispatches/POs/orders) was built on 2026-04-21, fired its preview call into an already-saturated Nano, and contributed to the outage. Removed same day from both local repo and Supabase.

**Never re-add without explicit user ask.** And if it comes back, fix these known bugs first:
1. Missing `.eq('is_test', false)` on `order_dispatches` query — test data leaks
2. Missing `.eq('is_test', false)` on `purchase_orders` query — test POs leak
3. Broken PostgREST `.not()` syntax `.not('status','in','("draft",...)')` — use `'(draft,...)'` (no quotes inside)
4. Sequential Resend calls risk 60s Edge Function timeout — parallelize with Promise.all
5. Silent catch returning 200 — surface errors properly
6. No auth check on function URL — public
7. Deep nested joins under RLS on Micro are expensive — fine for once-daily, dangerous higher

Strongly prefer an **on-demand Dashboard page** over an automated email for any future "end-of-day summary" feature.

---

## 19. Dispatch pipeline — gates, columns, what counts as "delivered"

Already summarized in §8. This is the canonical, longer-form description.

### 19.1 Two gates + one delivered-truth

- **Gate 1 — `delivery_created`** (Ops creates a batch). Qty crosses from "available pool" into "in active batch at FC". Tracked by `order_items.dispatched_qty`. Increments via RPC `increment_dispatched_qty`. Once past Gate 1, that qty cannot be re-batched (DB CHECK enforces).
- **Gate 2 — `goods_issue_posted`** (Accounts posts the GI). Last cancellable point. After this, only credit/debit-note workflow. Cancellation walks `order_dispatches.status` per batch.
- **"Delivered" — `dispatched_fc`** (FC clicks delivered, `delivered_at` timestamp set). The reporting truth. Tracked by `order_items.delivered_qty`. Forecast / "delivered total" KPIs must read this, NOT `dispatched_qty`.

### 19.2 Column ledger on `order_items`

| Column | Means | When it changes |
|---|---|---|
| `qty` | Ordered qty | Order creation; immutable thereafter |
| `dispatched_qty` | In-flight at FC, post-Gate-1, pre-final-delivery | Increments at `delivery_created`; decrements only via cancel-of-in-flight or full batch cancel |
| `posted_qty` | GI-posted (irrevocable from the cancellable side) | Increments at `goods_issue_posted` |
| `delivered_qty` | Customer has goods (FC marked delivered) | Increments at `dispatched_fc` only |
| `cancelled_qty` | Cancelled, terminal | Increments via `cancel_order_lines` RPC only |

**Invariant** (DB CHECK): `dispatched_qty + cancelled_qty <= qty`. `delivered_qty` is a subset of historical `dispatched_qty` — they don't add separately.

### 19.3 Formulas every feature must use
- **Pending-for-new-batch** (Ops dispatch drawer): `qty − dispatched_qty − cancelled_qty`
- **Pending-for-cancel** (Cancel drawer): `qty − cancelled_qty − (sum of qty in batches at status ≥ goods_issue_posted)`
- **Delivered for reporting/forecast**: `delivered_qty`

### 19.4 Hard rules
1. Do NOT increment `dispatched_qty` at any point other than `delivery_created`.
2. Do NOT decrement `dispatched_qty` outside the cancel RPC.
3. `delivered_qty` only increments inside `mark_delivered_qty` RPC, fired at `dispatched_fc`. Idempotent — second call no-ops.
4. Forecast and "delivered" KPIs read `delivered_qty`, never `dispatched_qty`.
5. Cancellation cutoff is per-batch status, not per-line column flag.
6. Old orders (pre-2026-05-08) run under legacy semantics — do NOT backfill.

### 19.5 Existing safety mechanisms (no work needed)
- Row-level locks (FOR UPDATE) prevent concurrent over-dispatch / over-cancel
- CHECK `dispatched_qty + cancelled_qty <= qty`
- CHECK `posted_qty <= dispatched_qty`
- CHECK `cancelled_qty >= 0`
- `posted_qty_applied_at` idempotency guard
- Batch number monotonic via `MAX(batch_no)+1`
- Cancel RPC role-gated (admin/management only)
- `validate_order_status_change` trigger gates `orders.status` by role

### 19.6 Parked dispatch hardening (apply when revisiting)
Deferred items not in main index — pick up only if a related bug surfaces:

1. **Audit row for GI-post** — `mark_batch_posted` writes nothing to `order_comments`. Add INSERT inside RPC.
2. **Friendly preflight in `replace_order_items`** — editing qty below `dispatched_qty + cancelled_qty` triggers raw CHECK error. RAISE EXCEPTION with clear message.
3. **Block deletion of lines with `cancelled_qty > 0` or `posted_qty > 0`** — mirror existing po_items-reference protection.
4. **Reverse-GI-post RPC** — no undo path today. Admin-only `unmark_batch_posted`.
5. **Reversal-aware FC status transitions** — CHECK / trigger preventing backwards moves past `goods_issue_posted`.
6. **Trigger guard on qty columns** — reject direct UPDATEs to `dispatched_qty/posted_qty/cancelled_qty` unless via RPC (use `current_setting('app.via_rpc', true)` flag).
7. **JSON schema validation on `dispatched_items`** — trigger validating jsonb shape.

---

## 20. Audit-fix patterns (the safety net that's already in place)

The full app audit (April 2026) shipped 16 fixes. The relevant Supabase DB objects every new feature should leverage:

### 20.1 Atomic multi-step ops via RPC
Use a SECURITY DEFINER plpgsql function any time you need delete-then-insert, decrement-then-insert, or "do A only if B succeeds". Reference: `replace_order_items` (transactional item replacement) and `increment_dispatched_qty` (row-lock + CHECK).

### 20.2 CHECK constraints over JS validation
Define DB invariants via CHECK, not just frontend validation. Examples already in place:
- `chk_dispatched_qty` on `order_items` (dispatched_qty <= qty)
- `posted_qty <= dispatched_qty`
- `cancelled_qty >= 0`

### 20.3 Server-side filters via `!inner` joins
BillingList and FCModule pattern: `orders!inner(...)` for server-side filtering on `is_test` and `order_type` — replaces client-side `.filter()` after the fetch. Faster on large lists and respects RLS properly.

### 20.4 Input validation regex (use these, don't reinvent)
```js
GST:    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i
PAN:    /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i
Phone:  /^[6-9][0-9]{9}$/   // Indian mobile
Email:  standard RFC pattern
```

### 20.5 Not-found fallback on detail pages
All detail pages (Order, PO, Customer, Vendor, Item, GRN, FC, Billing) show "X not found" inside Layout instead of a blank white screen when the entity doesn't exist or RLS hides it.

### 20.6 Centralized utilities (never duplicate locally)
- **`src/lib/fmt.js`** — `FY_START`, `fmt(d)` "5 Mar 2026", `fmtNum(d)` "05-03-2026", `fmtShort(d)` "5 Mar", `fmtTs(d)` "5 Mar, 14:30", `fmtDateTime(d)` "5 Mar 2026 14:30", `MO` month names array
- **`src/lib/toast.js`** — DOM-based, no React deps, `toast(msg, 'success'|'error'|'warning'|'info')`. All 18 page files use this; zero `alert()` calls remain.
- **`src/lib/errorMsg.js`** — `friendlyError(err, fallback)` maps Postgres errors / network errors to human-readable strings.
- **`src/lib/geo.js`** — `geocodeAddress`, `haversineKm`, `SSC_OFFICES`.

### 20.7 No console.log in production
Console logs were cleaned from OrderDetail, CRMOpportunityDetail, Login during the audit. New code should not introduce them — `console.error` for caught exceptions is fine; `console.log` for debugging is not.

---

## 21. SSC Automation merge-readiness — patterns for the NEXT app

When SSC Automation (the manufacturing sibling project) is built, follow these patterns so a future business merger can be done in ~4-6 weeks of cleanup instead of a full rebuild.

### 21.1 Why separate, not shared
- Different workflows: Distribution (Order → Dispatch → Invoice) vs Manufacturing (RFQ → Design → BOM → Production → QA)
- Shared DB would double load on Micro and widen blast radius
- SSC Control outages must not affect Automation and vice versa
- Decided after discussion 2026-04-23: "I also want another project only" — clean separation

### 21.2 Setup
- **New git repo** (new folder), not built inside `ssc-inventory/`
- **New Supabase project** under the same Pro organization (unified billing/MFA). Second Micro compute is not free — roughly $10/month extra on top of the $25 Pro base.
- **New Vercel deployment** at a different URL (e.g., `app.sscautomation.com`)
- Independent DB, auth, storage

### 21.3 Patterns to keep identical across both projects
1. **UUIDs for all primary keys** (`gen_random_uuid()`) — prevents ID collisions during merge.
2. **Distinct document-number prefixes** — SSC Control uses `SSC/PO`, `SSC/GRN`, `SSC/SO`. SSC Automation should use `SSCA/PO`, `SSCA/GRN`, `SSCA/SO`. **Never overlap.**
3. **FY-suffixed numbering** — keep `YY-YY` fiscal year suffix (e.g., `SSCA/PO0001/26-27`), reset counters each FY. Reuse the `fy_suffix()` SQL helper pattern.
4. **Identical `profiles` table** — same columns (`id`, `name`, `role`, `username`, `must_change_password`, `password_changed_at`, `email`), same role values (`admin`, `ops`, `sales` — add manufacturing roles like `production`, `design` as needed but keep the existing three identical).
5. **Identical RLS pattern** — RLS enabled on every table, authenticated-only policies, same policy naming (`auth_read`, `auth_write`, `auth_update`). Document in a `security_rls.sql` file.
6. **Identical shared utilities** — `src/lib/fmt.js`, `src/lib/toast.js`, `src/lib/supabase.js`, `src/lib/errorMsg.js`. Copy-paste from SSC Control as starter; let them diverge only with clear reason.
7. **Identical schema for shared concepts** — `customers`, `vendors`, `items`, `profiles` tables should have the same column names and types across both projects. Add extra columns if needed; never rename or retype existing ones.
8. **Test Mode toggle on every list page** — admin-only amber toggle, `.eq('is_test', testMode)`.
9. **Never push without user approval.**
10. **Avoid heavy automation / cron jobs** — same Micro constraint applies.

### 21.4 What would break a future merge (AVOID)
- Different ID types (int vs UUID) across the two projects
- Number prefix collisions (both using `SSC/PO`)
- Schema drift on shared concepts (e.g., customer address as one text field in one project, three structured fields in the other)
- Diverging auth/role models
- Letting duplicate customer/vendor records accumulate for years without a dedup plan

### 21.5 Future-merge estimate (if business decides to merge)
- Data migration (pg_dump + import with `company_id` tag): 2-5 days
- Customer/vendor dedup (match by GST, manual fuzzy review): 3-7 days
- Schema unification (add `company_id` to shared tables, update RLS): 3-5 days
- App merge or keep-two-apps-one-DB decision: weeks to months
- Storage + auth merge: 2-3 days

**Total: ~4-6 weeks.** Acceptable cost for clean isolation now.

---

## 22. Production-rollout discipline (consolidated)

This is the single most important section. If you only read one, read this.

### 22.1 Before any change
- Trace dependents in code (grep, read both directions).
- Confirm twice **against the code**, not by asking the user.
- State impact: what changes, what stays, which pages touch this, why none of them break.

### 22.2 Before any deploy
- `npm run build` passes (necessary but not sufficient).
- Walked every affected page on localhost — including pages NOT directly edited but that share state, RPCs, or tables.
- Tested as the actual roles (admin, ops, sales, accounts, fc_kaveri, fc_godawari).
- Where data is involved: ran a SELECT preview before any UPDATE/DELETE.

### 22.3 Before push to main
- User has explicitly said "push" / "go live" / "deploy".
- For changes affecting many pages, user has eyeballed on localhost.
- For schema changes, applied via Supabase SQL editor (or Management API), confirmed via `information_schema.columns`, then notified PostgREST (`NOTIFY pgrst, 'reload schema'`).

### 22.4 After push
- Smoke-test the golden path on the deployed URL within 60 seconds.
- For email/edge-function changes: insert a test notification + check `net._http_response` + check `email_log`.
- For multi-user features: roll out in waves (1 user → 3-5 users → everyone).

### 22.5 When something breaks in production
1. **Revert first** (`git revert <bad-sha> && git push`). Do not debug forward under pressure.
2. Acknowledge to the user immediately.
3. Diagnose on a branch, not on main.
4. Re-deploy only after smoke test on localhost.

### 22.6 Phased rollout for auth/security changes
The 2026-05-05 password-rotation push affected all users at once and stuck multiple people. Rule:
1. **Wave 1**: yourself (1 user). End-to-end test. Fix bugs.
2. **Wave 1.5**: one other user (different role).
3. **Wave 2**: 3-5 users covering all roles.
4. **Wave 3**: everyone else, ideally Friday after-hours so they hit it Monday morning.

Communicate before each wave — exact step-by-step in WhatsApp/email. For password rotation: tell users to save the new password before clicking confirm (we now show plaintext + Copy button on the confirmation step).

### 22.7 Stuck-user emergency runbook
```sql
-- Check state
SELECT username, must_change_password, password_changed_at FROM profiles WHERE username = '<u>';
SELECT created_at, event_type FROM login_audit WHERE email = '<u>@<domain>' ORDER BY created_at DESC LIMIT 10;

-- Reset to temp password (admin → DM the temp privately)
UPDATE auth.users SET encrypted_password = crypt('TempPass@2026', gen_salt('bf')), updated_at = now()
WHERE email = '<u>@<domain>';

-- Force change on next login
UPDATE profiles SET must_change_password = true WHERE username = '<u>';
```

If many users are stuck → **emergency unstick** (saved ops on 2026-05-05):
```sql
UPDATE public.profiles SET must_change_password = false, password_changed_at = now();
```
Breaks any forced-rotation loop instantly. Users keep whatever password currently works.

---

## 23. Procurement Forecast — brand-level reorder planning

The Procurement Forecast module (`/procurement/forecast`) is a quarter-by-quarter, brand-by-brand reorder planner for standard items only (CI items are made-to-order and never forecasted). It generates suggested POs from historical sales × stock-on-hand × brand lead time.

### 23.1 Tables

```sql
-- Per-brand lead time configuration
CREATE TABLE procurement_forecast_config (
  brand            text PRIMARY KEY,
  lead_time_days   int  DEFAULT 0,   -- vendor manufacturing time
  transit_days     int  DEFAULT 0,   -- shipping time
  processing_days  int  DEFAULT 0,   -- inward / inspection time
  inventory_days   int  DEFAULT 45,  -- safety stock buffer
  updated_at       timestamptz DEFAULT now()
);

-- Per-item, per-month sales projection (manual overrides historical)
CREATE TABLE procurement_forecast_sales (
  item_code   text,
  month       text,  -- 'YYYY-MM'
  manual_qty  numeric,
  PRIMARY KEY (item_code, month)
);

-- Per-item current stock override (when accounting figure differs from physical)
CREATE TABLE procurement_forecast_stock (
  item_code   text PRIMARY KEY,
  manual_qty  numeric
);

-- Snapshot of a forecast → PO conversion event (audit trail)
CREATE TABLE procurement_forecast_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       text,
  created_at  timestamptz DEFAULT now(),
  created_by  uuid,
  items       jsonb,    -- snapshot of confirmed items + qtys at PO time
  po_id       uuid
);
```

Enable RLS on all four. Auth-read for anyone; admin/management write.

### 23.2 The lead-time math
```
reorder_days       = lead_time_days + transit_days + processing_days
replenishment_days = reorder_days + inventory_days
```
Reorder window says "when must I place a PO so the stock arrives in time?". Replenishment window says "what stock do I need on the day the PO arrives so I don't go to zero before the next cycle?".

Both shown in the brand bar header. Without a config row, the forecast won't run for that brand — yellow "No config — set lead times" banner shown.

### 23.3 Previous-quarter helper
Forecast pulls historical sales from the **previous fiscal quarter** (delivered orders only):
- If today is Apr-Jun → last quarter = Jan-Feb-Mar (Q4 of prior FY)
- If today is Jul-Sep → last quarter = Apr-May-Jun (Q1 of current FY)
- If today is Oct-Dec → last quarter = Jul-Aug-Sep (Q2)
- If today is Jan-Mar → last quarter = Oct-Nov-Dec (Q3 of prior FY)

`DELIVERED_STATUSES = ['dispatched_fc', 'goods_issued', 'invoice_generated', 'closed']` — only orders in these states feed historical sales. (Note: this uses status-based filter, but for newer code prefer `delivered_qty > 0` from the column ledger in §19.)

### 23.4 Forecast algorithm
For each standard item under the selected brand:
1. **Avg monthly sales** = sum of `delivered_qty` for that item across the 3 months of previous quarter ÷ 3.
2. **Projected need** = avg × forecast horizon (configurable, default 3 months).
3. **Manual override** — if a row exists in `procurement_forecast_sales(item_code, month, manual_qty)`, use that instead of the historical number for that month.
4. **Current stock** = sum from `inventory` across all locations (or override from `procurement_forecast_stock.manual_qty`).
5. **Reorder qty** = `projected_need − current_stock − (any in-transit POs)`. Negative or zero → no reorder triggered.
6. Items where reorder_qty > 0 → "triggered" → counted in the "Generate PO (N)" button label.

### 23.5 Generate PO from forecast
`openForecastPO()` collects all triggered items, opens `ForecastPOModal` which:
- Pre-fills line items with item_code + qty
- Lets user pick vendor + delivery date
- Saves to `purchase_orders` + `po_items` like a normal PO insert
- Writes a row into `procurement_forecast_snapshots` capturing the forecast state at PO time
- These POs have `po_type = 'SO'` (stock order) and `order_id = NULL` (not against a customer order)

The Forecast PO flow is **the one exception** to the rule "all PO creation goes through `NewPurchaseOrder.jsx`". It uses its own modal because the line item set is auto-generated, not user-typed. Don't try to merge the two flows.

### 23.6 Edit + recompute pattern
- Edit a single cell in the table → updates local state.
- "Save Overrides" button → batched upsert into `procurement_forecast_sales` (compound key `item_code,month`) and `procurement_forecast_stock` (key `item_code`).
- After save, recompute the projection client-side — don't refetch the entire view.

### 23.7 Things to watch
- **Don't run on the Micro instance at high frequency.** The forecast query does an aggregate over delivered order_items grouped by item_code — heavy. Once per browser session is fine; per-keystroke recompute is not. Always debounce.
- **Brands with no historical sales** show 0 across the board — fine. Users add manual_qty rows to seed the projection for new SKUs.
- **Inventory location aggregation** — current code sums across `Kaveri + Godawari`. If new warehouses are added, the SUM in the forecast query must include them.
- **Forecast horizon** is hardcoded to 3 months. If product wants a config row for "horizon_months", add it to `procurement_forecast_config` and avoid a separate global table.
- **Auto-recompute on inventory upload.** Right now the forecast page recomputes only when user opens it. If you add a watcher that recomputes on inventory CSV upload, that's a fan-out write under Micro — flag the load implications before building.

### 23.8 Forecast page URLs
- `/procurement/forecast` — main forecast view (brand picker + item table + Generate PO button)
- `/procurement/forecast/config` — per-brand lead-time configuration page (admin/ops only)

The config page is reached via the gear icon on the brand bar. Both pages share the same `procurement_forecast_config` table — don't duplicate the read.

---

## 24. Deferred / future work — pick up when ready

This is the **single source of truth for known-but-not-yet-fixed issues and planned features**. Don't lose any of these. When the user asks "what was that thing we were going to fix later?", look here.

Format per item: **what it is**, **why deferred**, **what triggers picking it up**, **scoped fix** (when known).

### 24.1 Cancelled-PO ghost coverage (deferred 2026-05-12)
**What:** Coverage queries in `ProcurementOrders`, `ProcurementDashboard`, `NewPurchaseOrder` (loadCOOrder + fetchPendingCOs), and `OrderDetail` count a CO line as "covered" if any `po_items` row references it — regardless of the parent PO's status. Cancelled POs don't delete their `po_items` rows, so cancelling a PO leaves the CO falsely marked as covered.

**Why deferred:** Users were exploiting this (place sham PO → cancel → CO drops off pending queue). The "From Stock" toggle was built as the legitimate alternative. Fixing the cancelled-PO bug will resurface every historical CO whose only PO was cancelled — could be many orders. User wasn't ready for the cleanup wave.

**Trigger to revisit:** When the cancelled-PO list becomes a priority OR when audit demands clean coverage data.

**Scoped fix:** Add `.neq('status', 'cancelled')` to the `purchase_orders` SELECT in all four call sites. Before applying, run the count query in §9.2 to know how many orders will resurface. Plan A: let them resurface naturally (users either place real POs or use "From Stock"). Plan B: audit + bulk `UPDATE order_items SET procurement_source = 'stock'` for the ones that genuinely shipped from stock.

### 24.2 `replace_order_items` RPC matches positionally (deferred 2026-05-15)
**What:** The `replace_order_items` RPC matches `p_items[i]` to `existing_ids[i]` (sorted by sr_no). When the frontend sends items out of sr_no order, OR when a middle item is deleted, the RPC silently rotates `item_code` across rows or orphans dispatch/PO FK references. Stage 1 (display sort by sr_no on load) already shipped — covers the most common case. Stage 2 (RPC fix) still owed.

**Why deferred:** Stage 1 prevents the visible bug. Stage 2 requires a DB function rewrite + careful smoke-testing with PO-linked / dispatched / billed orders.

**Trigger to revisit:** When a user reports item_code mismatch on a heavily-edited order, OR when adding the next major feature touching `order_items`.

**Scoped fix:** Rewrite `replace_order_items` to match by `id` instead of position. Frontend sends `id` in each p_items entry. New items have null id → INSERT. Delete rows whose id is not in keep_ids AND not FK-referenced. Full plan + smoke-test checklist in `project_order_items_sr_no_rpc_fix.md`.

### 24.3 Parked dispatch-pipeline hardening (deferred 2026-05-08)
Seven items already detailed in §19.6. Summary list:
1. Audit row for GI-post (5 SQL lines, no risk)
2. Friendly preflight in `replace_order_items` for qty-below-dispatched
3. Block deletion of lines with `cancelled_qty > 0` or `posted_qty > 0`
4. Reverse-GI-post RPC for accidental posts
5. Reversal-aware FC status transitions
6. Trigger guard on direct qty-column writes
7. JSON schema validation on `dispatched_items`

**Trigger to revisit:** When the next dispatch/cancel feature is being built, OR when a related corruption incident occurs.

### 24.4 Email rate-limit + half-baked PO rollback hardening
**What:** When sending PO emails to vendor with multiple supporting docs, payload can approach Supabase Edge Function's ~6 MB limit. Also, the PO-creation rollback exists but the test coverage is implicit (only catches failures on the items-insert step).

**Why deferred:** Hasn't bitten in production. Current size-checks and rollback are sufficient for typical workloads.

**Trigger to revisit:** When a vendor reports a partial / corrupt email OR when a payload-too-large 413 surfaces in production.

**Scoped fix:** For supporting docs, switch from base64-inline to URL-passed (edge function fetches). For PO creation, add a transaction-style RPC `create_po_with_items(header, items)` so insert is atomic at DB level instead of two round-trips.

### 24.5 Per-stage email notification fan-out reduction
**What:** Today, when accounts marks GI-posted on a CO, ALL accounts-role users get a notification email — once per batch. A CO with 3 batches = 3 emails per accounts user. Considered intentional fan-out but spams inboxes.

**Why deferred:** User confirmed this is by-design ("each batch is its own event"). Volume is currently acceptable.

**Trigger to revisit:** When user complains about email noise OR when accounts headcount grows.

**Scoped fix:** Add an `order_id` dedup check — skip notification if a row exists for the same `(user_id, order_id, email_type)` within the last 24 hours.

### 24.6 Edge function deploy verification gate
**What:** The 2026-05-13 incident (Management API silently corrupted 4 chars of source) silently broke email for 2 days. The CLI deploy is now the standard, but there's no automated post-deploy smoke test.

**Why deferred:** Manual smoke-test SQL is documented in §2.4. Hasn't bitten since.

**Trigger to revisit:** Before deploying ANY new edge function. Build a CI step.

**Scoped fix:** Add a GitHub Action or local script that runs after `supabase functions deploy`: insert a test notification, wait 5s, check `net._http_response` for status_code = 200. Fail the action otherwise.

### 24.7 SSC Automation kickoff
**What:** Sibling project (manufacturing workflows) not yet built. Patterns to keep identical with SSC Control are documented in §21.

**Trigger to revisit:** When the user decides to start building it.

**Scoped fix:** N/A — net-new project. Copy `src/lib/*`, `vercel.json` headers, `index.html` font preload, `profiles` table schema, RLS policy templates, `is_admin()` function. Use `SSCA/` prefix for all document numbers.

### 24.8 New module candidates (mentioned but not built)
Items the user has discussed but not committed to. Don't build proactively — wait for the explicit ask.

- **Vendor Portal** — vendors log in to acknowledge POs / upload acknowledgement docs without us emailing every time.
- **Customer Portal** — customers see their order status, invoices, payment history.
- **Inventory transfer Slack/WhatsApp alerts** — currently email only.
- **AI-assisted Item-code matching** for XLS uploads where account team types item codes slightly differently each time.
- **Auto-reconcile** of `customer_payments_snapshot` against `orders.invoice_amount` to flag mismatches.

### 24.9 Performance budget items
**What:** Things to watch as data grows.
- ProcurementForecast aggregate query under RLS gets expensive past ~5,000 delivered order_items.
- Realtime subscription on notifications fan-out can saturate Micro if many users open the app at once.
- CO coverage chunked-fetch (§2.1) is already in place but each chunk is a round-trip — past ~2,000 COs in FY, page load gets sluggish.

**Trigger to revisit:** Page load > 3 seconds anywhere OR Supabase Advisor flags slow queries.

**Scoped fix:** Move heavy aggregates into materialized views with periodic refresh. Move list-page coverage computation into a Supabase RPC instead of client-side join.

---

## 25. Module-by-module quick reference

A one-line "what each page does" map for the new agent — saves them from grepping.

### Orders
- `OrdersList` — all SOs + COs, filters by status/customer/owner, summary/detailed Excel export
- `NewOrder` — punch order, CI/SI split auto-sets order_type
- `OrderDetail` — view + edit, partial cancel, partial dispatch, batches, status pipeline, linked POs (for CO)
- `OpsOrders` — ops view (pending acceptance, inventory_check, ready to dispatch)
- `TodayDispatch` — ops view (orders being dispatched today)

### Procurement
- `ProcurementDashboard` — KPIs + "CO Orders Need PO" tile
- `ProcurementOrders` — CO coverage list (which COs still need POs)
- `ProcurementForecast` — brand-level reorder planning (§23)
- `PurchaseOrderList` — all POs, filters, exports
- `NewPurchaseOrder` — create PO (SO type or against CO with pre-fill + From-Stock toggle)
- `PurchaseOrderDetail` — view PO, approve, place, acknowledge, receive, email to vendor, From-Stock chips for linked CO
- `PurchaseInvoiceList` / `PurchaseInvoiceDetail` — vendor invoice + 3-way match + inward complete

### Fulfilment Center
- `FCDashboard` / `FCModule` — FC ops queue
- `FCOrderDetail` — picking → packing → goods issue → goods issue posted → delivery created → dispatched_fc
- `GRNList` / `NewGRN` / `GRNDetail` — goods receipt (against PO or returns)
- `StockTransferList` / `NewStockTransfer` / `StockTransferDetail` — inter-warehouse

### Billing
- `BillingDashboard` / `BillingList` — orders ready for invoice
- `BillingOrderDetail` — generate PI, post payment, generate invoice, e-way, dispatched_fc

### CRM
- `CRMDashboard` — overdue follow-ups, won/lost, KPIs
- `CRMCompanies` / `CRMCompanyDetail` — companies (non-Customer 360 leads)
- `CRMLeads` / `CRMLeadDetail` / `CRMNewLead` — lead funnel
- `CRMOpportunities` / `CRMOpportunityDetail` / `CRMNewOpportunity` — pipeline + Kanban
- `CRMQuotations` — quote module with revisions (SSC/QU#### shared across revisions)
- `CRMFieldVisits` — visit log with map (Leaflet + Nominatim + haversine)
- `CRMSampleRequests` — sample tracking
- `CRMTargets` — quarterly target tracking

### Masters
- `CustomerMaster` / `CustomerDetail` / `NewCustomer` — Customer 360
- `ItemMaster` / `ItemDetail` — Item 360
- `VendorMaster` / `VendorDetail` / `NewVendor` — Vendor 360

### People
- `PeopleHub` / `PeopleKpi` / `PeopleKpiConfig` — KPI dashboard
- `UserManagement` (admin only) — user roles, email overrides, MFA enrollment status

### Misc
- `Login` / `ChangePassword` — auth flow with TOTP MFA + hCaptcha + 90-day rotation
- `Sales` — Live Inventory search (used by sales + FC roles)
- `Accounts` (`/uploads`) — daily warehouse XLS upload + Pending Payments (Tally) upload
- `Dashboard` — home tiles

---

## 26. Early Credit Check — moving a pipeline gate earlier (2026-06-07, shipped)

Moved the credit check from **late** (`goods_issued`, after FC had already picked/packed/issued) to **early** (`delivery_created`, before picking) so held orders don't waste warehouse effort. Reusable lessons:

### 26.1 Model a gate as a FLAG, not a new status
A new pipeline *status* would touch ~15 label/filter maps (the 2026-05-08 blank-page risk) + the cancel RPC + any status constraint, and an order can vanish if one map is missed. Instead we used a boolean **`order_dispatches.credit_checked`** flag *on the existing* `delivery_created` status. Zero new status → no map sweep, orders can't disappear. This is how **SAP SD / Oracle OM** do it: credit is a **block/hold on the document**, evaluated at a milestone, released from a worklist — not a workflow stage.

### 26.2 Inert-first rollout (grandfather existing rows)
- Add the column **`DEFAULT true`** so every existing row is auto-cleared the moment the column is added (no separate backfill). In-flight orders never get blocked; only NEW orders (RPC sets `false`) hit the gate.
- Add a **`credit_checked_at` timestamp** (null for backfilled rows, set on a genuine approval) to **disambiguate in-flight (legacy flow) from genuinely-processed (new flow)**. This let the old late-stage credit-check code stay 100% intact for the 20+ in-flight orders while new orders auto-skip it.

### 26.3 Enforce in the TRIGGER, not RLS
`order_dispatches` RLS is `authenticated_full_access` (wide open) and picking is a **direct client UPDATE** (no RPC). The only server-side enforcement point is the `BEFORE UPDATE` trigger (`validate_dispatch_status_change`). Put the credit check **before** the `IF auth.uid() IS NULL THEN RETURN NEW` early-return so it's **universal** (covers service-role/RPC writes) AND **PAT-testable**.

### 26.4 Zero-footprint DB verification (when you can't create dummy data)
Wrap the whole test — DDL + `CREATE OR REPLACE FUNCTION` + insert rows + asserts — inside a `DO $$ ... RAISE EXCEPTION 'results=...' $$`. The final RAISE forces a **full rollback** (Postgres DDL is transactional), so **nothing persists**; results come back in the error message. We proved the gate + RPC bypass against **real** orders without creating a single row. Always add a post-check `count(*)` to confirm zero footprint.

### 26.5 Test-only switch for single-DB testing
One Supabase, no staging. To let the user test the real flow without touching production, scope the new behavior to test orders inside the RPC: `IF is_test THEN <new logic> ELSE credit_checked := true`. Real orders behave exactly as before during testing; swap to the all-orders version at go-live.

### 26.6 Go-live ordering — deploy frontend BEFORE activating the DB
If you apply the gate+RPC first, new orders get `credit_checked=false`, the gate blocks picking, but the OLD deployed frontend has no Approve button → **stranded orders**. Correct order: (1) push frontend, (2) **confirm it's live**, (3) then apply the DB gate/RPC. Never reverse.

### 26.7 Verify a Vercel deploy without the vercel/gh CLI
Both CLIs were unauthenticated in this env. Vite **content-hashes** bundles, so poll production `index.html` for `assets/index-<hash>.js`; when it matches your local `dist/index.html`, the new build is live.

### 26.8 Gotchas hit this session
- **Supabase Management API via Python `urllib`** → Cloudflare **error 1010** unless you send a browser-like `User-Agent` (e.g. `curl/8.4.0`). Plain `curl` works out of the box.
- **Test orders share the real number counter.** Testing burned real CO numbers (~0624–0631), leaving permanent gaps — can't roll the counter back once a real order lands above the gap. TODO: give test orders a separate series (e.g. `TEST-CO####`). `order_number_counters` also has pre-existing corrupted rows (full order numbers in the `fy` column).
- **BillingList hardcoded `is_test=false`** — was missing the admin Test Mode toggle every list page is supposed to have. Added it.
- **UI:** drop jargon (renamed "Credit Override" → **"On Hold"** everywhere); avoid bright emoji (🔴/⏳) that clash with the palette — use small **muted CSS dots** instead.
- The final `create_order_dispatch` return jsonb **omits `credit_checked`** — read the column directly if a caller needs it.

---

*This document is a living summary of every incident, fix, and convention from the SSC Inventory project. Treat it as the foundation for any new SSC application. When you learn something the hard way, add it here so the next agent doesn't.*
