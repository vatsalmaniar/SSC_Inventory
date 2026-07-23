# SSC Inventory System

## Project Overview
Internal inventory management system for SSC Control Pvt. Ltd.
Built with plain HTML + Supabase (no framework).
Deployed on Vercel: https://ssc-inventory.vercel.app

## Tech Stack
- **Frontend**: React + Vite (SPA). Page components in `src/pages`, shared UI in `src/components`, styles in `src/styles`.
- **Database + Auth**: Supabase
- **Hosting**: Vercel (GitHub auto-deploy)
- **Fonts**: Geist + Geist Mono (self-hosted, `public/fonts`, loaded in `index.html`)
- **XLS Parsing**: SheetJS / ExcelJS

## UI Conventions — READ BEFORE BUILDING ANY UI
New components keep drifting from the rest of the app (mismatched fonts, colours,
one-off spinners). To stop this:

1. **Design tokens are the single source of truth** — `src/styles/global.css :root`.
   It defines the font families (`--font`, `--mono`), the **type scale**
   (`--fs-eyebrow … --fs-3xl`), **weights** (`--fw-regular/medium/semibold/bold` —
   the app never goes above `600`/semibold for numbers or titles), tracking, radii,
   and the colour palette. **Never hardcode `font-family`, `font-size`, `font-weight`,
   or colours in a component or stylesheet — reference the tokens.**
2. **One shared `<Loading/>`** — `src/components/Loading.jsx` (renders the standard
   `.o-loading` look). Use it for every page/section loading state. Do **not** hand-roll
   another spinner (`.loading-spin`, `.p-spin`, inline `<div>Loading…</div>` are retired).
3. **Reuse before you build.** Before creating any new UI, search `src/components`
   and `src/styles` for something that already does the job and use it. Cross-module
   chrome (e.g. the **Live** pill = `.meta-pill.live` + `.meta-dot` in global.css) is
   defined once and shared — do not re-create it per module.
4. **New pages must visually match existing pages.** The Orders dashboard
   (`Orders.jsx` / `orders-redesign.css`) is the reference design language: Geist,
   `#1a73e8` accent, `#f8f9fa` page background, 14px `--o-radius`, 600-max weights.
   Adding a new one-off style is a **last resort — flag it to the user first.**

### Shared components & helpers (find these before searching blind)
| What | Where |
|---|---|
| Loading state (spinner) | `src/components/Loading.jsx` |
| People skeletons | `src/components/PeopleLoaders.jsx` (TeamSkeleton / AssetsSkeleton / ProfileSkeleton; `Spinner` delegates to `<Loading/>`) |
| Page shell (sidebar + topbar) | `src/components/Layout.jsx` |
| Avatar (photo → initials) | `src/components/PeopleAvatar.jsx` |
| Attendance punch button | `src/components/PunchButton.jsx` |
| Sub-navs | `CRMSubNav` / `BillingSubNav` / `FCSubNav` / `ProcSubNav` / `AttendanceTabs` |
| History timeline filter | `src/components/HistoryFilter.jsx` |
| Month/year filter | `src/components/MonthYearFilter.jsx` |
| Typeahead / PhoneInput / PhotoCropper / MiniMap | `src/components/*.jsx` |
| Date/number formatting, FY constant | `src/lib/fmt.js` |
| Toasts | `src/lib/toast.js` |
| Friendly error messages | `src/lib/errorMsg.js` |
| Order value (single formula) | `src/lib/orderValue.js` |
| Paginated fetch (avoids 1000-row cap) | `src/lib/fetchAll.js` |
| Supabase client | `src/lib/supabase.js` |
| Excel export | `src/lib/xlsExport.js` |
| Live "meta-pill" / status pill | `.meta-pill` / `.meta-pill.live` / `.meta-dot` in `src/styles/global.css` |

## Supabase Config
- **URL**: https://kvjihrlbntxcdadogmhn.supabase.co
- **Anon Key**: sb_publishable_kgrGHkw1jDvlLIOF3cPKiw_2ucunE3P
- **Region**: Asia-Pacific (Mumbai)

## Database Schema

### inventory
| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| product_code | text | Not null |
| quantity | integer | Default 0 |
| category_brand | text | Optional |
| location | text | Warehouse name |
| updated_at | timestamptz | Auto |

**Unique constraint**: `product_code + location` together

### profiles
| Column | Type | Notes |
|---|---|---|
| id | uuid | FK to auth.users |
| name | text | Display name |
| role | text | 'sales', 'accounts', or 'admin' |
| username | text | Unique, used for login |

## User Roles
- **admin** — Full access (sales + accounts). Currently: vatsal.maniar
- **accounts** — Can upload XLS files. Currently: accounts.amd
- **sales** — Can search stock. All sales team members

## Login Flow
- User enters **username** (not email)
- App appends `@ssccontrol.com` to get email
- Authenticates via Supabase `signInWithPassword`
- Profile fetched → role determines redirect:
  - `admin` → shows choice screen (Sales or Accounts)
  - `accounts` → goes to `ssc_accounts.html`
  - `sales` → goes to `ssc_sales_inventory.html`

## Files
- `ssc_login.html` — Login page with username field, admin view selector
- `ssc_accounts.html` — Accounts upload page (drag & drop XLS)
- `ssc_sales_inventory.html` — Sales search page (search by product code)
- `vercel.json` — Vercel routing config
- `index.html` — Redirects to ssc_login.html

## XLS Upload Logic (ssc_accounts.html)
- Column A → product_code
- Column B → quantity
- Filename prefix → location (e.g. `Amd_28032026.xls` → `Kaveri`, `BRD_28032026.xls` → `Godawari`)
- Location name map: AMD → Kaveri, BRD → Godawari
- Uses SheetJS to parse, batches of 100 rows upserted to Supabase
- Conflict resolution: `product_code + location` (so AMD and BRD stock stay separate)
- RPC function `get_inventory_status()` shows per-warehouse last upload time

## Warehouses
- **Kaveri** (AMD files) — Ahmedabad warehouse
- **Godawari** (BRD files) — Baroda warehouse

## Daily Workflow
1. Accounts team logs in
2. Uploads Amd_DDMMYYYY.xls → pushes to Kaveri
3. Uploads BRD_DDMMYYYY.xls → pushes to Godawari
4. Both warehouses show 🟢 UP TO DATE
5. Sales team searches by product code from their phone

## Users (18 total)
| Username | Role | Name |
|---|---|---|
| vatsal.maniar | admin | Vatsal Maniar |
| accounts.amd | accounts | Accounts AMD |
| jaypal.jadeja | sales | Jaypal Jadeja |
| bhavesh.patel | sales | Bhavesh Patel |
| aarth.joshi | sales | Aarth Joshi |
| jay.patel | sales | Jay Patel |
| kaustubh.soni | sales | Kaustubh Soni |
| akash.devda | sales | Akash Devda |
| harshadba.zala | sales | Harshadba Zala |
| darsh.chauhan | sales | Darsh Chauhan |
| khushbu.panchal | sales | Khushbu Panchal |
| dimple.bhatiya | sales | Dimple Bhatiya |
| salessupport.brd | sales | Sales Support BRD |
| jital.maniar | sales | Jital Maniar |
| mayank.maniar | sales | Mayank Maniar |
| ankit.dave | sales | Ankit Dave |
| hiral.patel | sales | Hiral Patel |
| mehul.maniar | sales | Mehul Maniar |

## Key Supabase SQL Reference

### Add new user
```sql
do $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (uid, '00000000-0000-0000-0000-000000000000', 'EMAIL@ssccontrol.com', crypt('PASSWORD', gen_salt('bf')), now(), 'authenticated', 'authenticated', '{"provider":"email","providers":["email"]}', '{"name":"NAME","role":"ROLE"}', now(), now(), '', '', '', '');
  insert into public.profiles (id, name, role, username) values (uid, 'NAME', 'ROLE', 'USERNAME') on conflict (id) do update set name='NAME', role='ROLE', username='USERNAME';
end $$;
```

### Reset password
```sql
update auth.users set encrypted_password = crypt('NEWPASS', gen_salt('bf')), updated_at = now() where email = 'EMAIL@ssccontrol.com';
```

### Check inventory by location
```sql
select location, count(*) from inventory group by location;
```

## GitHub Repo
- Repo: github.com/vatsalmaniar/ssc_inventory
- Auto-deploys to Vercel on push to main
