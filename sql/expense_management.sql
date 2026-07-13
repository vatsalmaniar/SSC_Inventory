-- ═══════════════════════════════════════════════════════════════════
-- EXPENSE MANAGEMENT — People ▸ Expenses  (canonical schema)
--
-- Field/sales staff submit expense claims with bill copies.
--   Management approves (L1) → Admin signs off (L2) → Accounts/Admin pays.
-- Reimbursement is ALWAYS the bill amount that was approved — the budget is
-- only a ceiling, never the payout.
--
-- BUDGETS — mileage only:
--   • mileage categories (is_mileage)  → budget by LOCATION, with an optional
--     per-person override.  Resolution: person override → location → 0.
--   • all other categories             → NO budget. Bill is paid once approved.
--   Over-budget is a WARNING in the UI, never blocked here.
--
-- Tables:
--   expense_categories        master data (+ vendor_options, gl_code, is_mileage)
--   expense_location_budgets  location × mileage-category budget
--   expense_budgets           per-person override of that mileage budget
--   expenses                  the claims
--   expense_bills             receipts (private bucket + sha-256 for dup detect)
--   expense_status_history    append-only audit of every transition
--
-- State machine:
--   pending ─L1(mgmt)→ mgmt_approved ─L2(admin)→ approved ─pay→ reimbursed
--      └──────────── rejected (either level, reason required) ─────────┘
--             └── owner edits & resubmits → pending
--
-- IDEMPOTENT. Reuses set_audit_cols()/trg_audit_cols from audit_columns_rollout.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── 0. Role helper (SECURITY DEFINER — avoids RLS recursion on profiles) ──
CREATE OR REPLACE FUNCTION public.expense_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() $$;
GRANT EXECUTE ON FUNCTION public.expense_role() TO authenticated;

-- ── 1. Person location (drives the mileage budget) ───────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_location_chk;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_location_chk
  CHECK (location IS NULL OR location IN ('Ahmedabad','Baroda'));

-- ═══════════════════════════════════════════════
-- 2. TABLES
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL UNIQUE,
  color          text NOT NULL DEFAULT '#5B6878',   -- auto-assigned from SSC theme (see lib/expense.js)
  gl_code        text,                              -- Tally ledger, optional
  monthly_cap    numeric CHECK (monthly_cap IS NULL OR monthly_cap >= 0),
  is_mileage     boolean NOT NULL DEFAULT false,    -- true => location-budgeted track
  vendor_options text[],                            -- if set, claim form requires picking one (Uber/Ola…, Airtel/Jio…)
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0
);

-- location × mileage-category budget
CREATE TABLE IF NOT EXISTS public.expense_location_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location      text NOT NULL CHECK (location IN ('Ahmedabad','Baroda')),
  category_id   uuid NOT NULL REFERENCES public.expense_categories(id),
  month_start   date,                               -- NULL = ongoing default
  budget_amount numeric NOT NULL CHECK (budget_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_loc_budget_default
  ON public.expense_location_budgets (location, category_id) WHERE month_start IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_loc_budget_month
  ON public.expense_location_budgets (location, category_id, month_start) WHERE month_start IS NOT NULL;

-- per-person override of the location mileage budget
CREATE TABLE IF NOT EXISTS public.expense_budgets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES public.profiles(id),
  category_id   uuid REFERENCES public.expense_categories(id),
  month_start   date,                               -- NULL = ongoing default
  budget_amount numeric NOT NULL CHECK (budget_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_budget_default
  ON public.expense_budgets (profile_id, category_id) WHERE month_start IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_budget_month
  ON public.expense_budgets (profile_id, category_id, month_start) WHERE month_start IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.expenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id),
  category_id     uuid NOT NULL REFERENCES public.expense_categories(id),
  expense_date    date NOT NULL,
  -- make_date (not date_trunc): date_trunc on a date is NOT immutable → can't be generated
  month_start     date GENERATED ALWAYS AS (make_date(EXTRACT(YEAR FROM expense_date)::int, EXTRACT(MONTH FROM expense_date)::int, 1)) STORED,
  amount          numeric NOT NULL CHECK (amount > 0 AND amount <= 100000),   -- the BILL amount
  approved_amount numeric CHECK (approved_amount IS NULL OR (approved_amount >= 0 AND approved_amount <= amount)),
  payment_method  text NOT NULL CHECK (payment_method IN ('card','cash','gpay')),  -- how the EMPLOYEE paid the vendor
  vendor          text,                             -- selected from category.vendor_options (Uber / Airtel / …)
  notes           text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','mgmt_approved','approved','rejected','reimbursed')),
  mgmt_reviewed_by uuid, mgmt_reviewed_at timestamptz,      -- L1
  reviewed_by     uuid, reviewed_at timestamptz, review_note text,  -- L2
  reimbursed_by   uuid, reimbursed_at timestamptz,
  payment_ref     text,                             -- reimbursement transaction no. (company → employee)
  is_test         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_expenses_profile_month ON public.expenses (profile_id, month_start);
CREATE INDEX IF NOT EXISTS idx_expenses_status        ON public.expenses (status);
CREATE INDEX IF NOT EXISTS idx_expenses_category      ON public.expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date          ON public.expenses (expense_date);

CREATE TABLE IF NOT EXISTS public.expense_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id),   -- denormalized (dup-detect + storage RLS)
  file_path   text NOT NULL, file_url text, filename text,
  mime_type   text, size_bytes bigint,
  file_hash   text,                                 -- sha-256, duplicate WARNING (never blocks)
  uploaded_at timestamptz NOT NULL DEFAULT now(), uploaded_by uuid
);
CREATE INDEX IF NOT EXISTS idx_expense_bills_expense ON public.expense_bills (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_bills_hash    ON public.expense_bills (profile_id, file_hash);

CREATE TABLE IF NOT EXISTS public.expense_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL,
  changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now(), note text
);
CREATE INDEX IF NOT EXISTS idx_expense_history_expense ON public.expense_status_history (expense_id);

-- ═══════════════════════════════════════════════
-- 3. AUDIT COLUMNS
-- ═══════════════════════════════════════════════
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories','expense_budgets','expense_location_budgets','expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_by uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_by uuid', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now()', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at timestamptz', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_cols ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_cols BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_audit_cols()', t);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════
-- 4. RLS — sales see ONLY their own; admin/management/accounts see all
-- ═══════════════════════════════════════════════
ALTER TABLE public.expense_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_budgets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_location_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_bills            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_status_history   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cat_read"  ON public.expense_categories;
DROP POLICY IF EXISTS "cat_write" ON public.expense_categories;
CREATE POLICY "cat_read"  ON public.expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "cat_write" ON public.expense_categories FOR ALL TO authenticated
  USING (public.expense_role() IN ('admin','management')) WITH CHECK (public.expense_role() IN ('admin','management'));

DROP POLICY IF EXISTS "bud_read"  ON public.expense_budgets;
DROP POLICY IF EXISTS "bud_write" ON public.expense_budgets;
CREATE POLICY "bud_read"  ON public.expense_budgets FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.expense_role() IN ('admin','management','accounts'));
CREATE POLICY "bud_write" ON public.expense_budgets FOR ALL TO authenticated
  USING (public.expense_role() IN ('admin','management')) WITH CHECK (public.expense_role() IN ('admin','management'));

DROP POLICY IF EXISTS "locbud_read"  ON public.expense_location_budgets;
DROP POLICY IF EXISTS "locbud_write" ON public.expense_location_budgets;
CREATE POLICY "locbud_read"  ON public.expense_location_budgets FOR SELECT TO authenticated USING (true);
CREATE POLICY "locbud_write" ON public.expense_location_budgets FOR ALL TO authenticated
  USING (public.expense_role() IN ('admin','management')) WITH CHECK (public.expense_role() IN ('admin','management'));

DROP POLICY IF EXISTS "exp_read"   ON public.expenses;
DROP POLICY IF EXISTS "exp_insert" ON public.expenses;
DROP POLICY IF EXISTS "exp_update" ON public.expenses;
DROP POLICY IF EXISTS "exp_delete" ON public.expenses;
CREATE POLICY "exp_read" ON public.expenses FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.expense_role() IN ('admin','management','accounts'));
CREATE POLICY "exp_insert" ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (profile_id = auth.uid());                       -- submit only for yourself
CREATE POLICY "exp_update" ON public.expenses FOR UPDATE TO authenticated
  USING ((profile_id = auth.uid() AND status IN ('pending','rejected'))   -- owner edits only while open
         OR public.expense_role() IN ('admin','management','accounts'));  -- reviews go via RPC
CREATE POLICY "exp_delete" ON public.expenses FOR DELETE TO authenticated
  USING ((profile_id = auth.uid() AND status = 'pending') OR public.expense_role() = 'admin');

DROP POLICY IF EXISTS "bill_read"   ON public.expense_bills;
DROP POLICY IF EXISTS "bill_insert" ON public.expense_bills;
DROP POLICY IF EXISTS "bill_delete" ON public.expense_bills;
CREATE POLICY "bill_read" ON public.expense_bills FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.expense_role() IN ('admin','management','accounts'));
CREATE POLICY "bill_insert" ON public.expense_bills FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
CREATE POLICY "bill_delete" ON public.expense_bills FOR DELETE TO authenticated
  USING (profile_id = auth.uid() OR public.expense_role() = 'admin');

DROP POLICY IF EXISTS "hist_read"   ON public.expense_status_history;
DROP POLICY IF EXISTS "hist_insert" ON public.expense_status_history;
CREATE POLICY "hist_read" ON public.expense_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.expenses e WHERE e.id = expense_id
                 AND (e.profile_id = auth.uid() OR public.expense_role() IN ('admin','management','accounts'))));
CREATE POLICY "hist_insert" ON public.expense_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════
-- 5. RPCs (atomic, guarded)
-- ═══════════════════════════════════════════════

-- 5a. Two-level review. Same person may not do both levels; nobody reviews their own.
CREATE OR REPLACE FUNCTION public.expense_review(
  p_id uuid, p_decision text, p_approved_amount numeric DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS public.expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := public.expense_role(); v_uid uuid := auth.uid();
        e public.expenses; v_from text; v_to text;
BEGIN
  IF v_role NOT IN ('admin','management') THEN RAISE EXCEPTION 'Not authorised to review expenses'; END IF;
  SELECT * INTO e FROM public.expenses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.profile_id = v_uid THEN RAISE EXCEPTION 'You cannot review your own expense'; END IF;
  v_from := e.status;

  IF p_decision = 'reject' THEN
    IF e.status NOT IN ('pending','mgmt_approved') THEN
      RAISE EXCEPTION 'Only pending/mgmt-approved claims can be rejected (current: %)', e.status; END IF;
    IF p_note IS NULL OR btrim(p_note) = '' THEN RAISE EXCEPTION 'A reason is required to reject'; END IF;
    v_to := 'rejected';
    UPDATE public.expenses SET status='rejected', review_note=p_note, updated_at=now() WHERE id=p_id;

  ELSIF p_decision = 'approve' THEN
    IF e.status = 'pending' THEN                          -- L1
      v_to := 'mgmt_approved';
      UPDATE public.expenses SET status='mgmt_approved', mgmt_reviewed_by=v_uid, mgmt_reviewed_at=now(), updated_at=now()
        WHERE id=p_id;
    ELSIF e.status = 'mgmt_approved' THEN                 -- L2 (admin only)
      IF v_role <> 'admin' THEN RAISE EXCEPTION 'Final approval requires Admin'; END IF;
      IF e.mgmt_reviewed_by = v_uid THEN RAISE EXCEPTION 'The same person cannot perform both approval levels'; END IF;
      v_to := 'approved';
      UPDATE public.expenses
         SET status='approved', reviewed_by=v_uid, reviewed_at=now(),
             approved_amount=COALESCE(p_approved_amount, e.amount),   -- pay the BILL amount by default
             review_note=COALESCE(p_note, review_note), updated_at=now()
       WHERE id=p_id;
    ELSE RAISE EXCEPTION 'Claim is not awaiting approval (current: %)', e.status;
    END IF;
  ELSE RAISE EXCEPTION 'Unknown decision: %', p_decision;
  END IF;

  INSERT INTO public.expense_status_history (expense_id, from_status, to_status, changed_by, note)
    VALUES (p_id, v_from, v_to, v_uid, p_note);
  SELECT * INTO e FROM public.expenses WHERE id = p_id;
  RETURN e;
END; $$;
GRANT EXECUTE ON FUNCTION public.expense_review(uuid, text, numeric, text) TO authenticated;

-- 5b. Pay Now — transaction no. only.
CREATE OR REPLACE FUNCTION public.expense_mark_reimbursed(p_id uuid, p_txn text)
RETURNS public.expenses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text := public.expense_role(); v_uid uuid := auth.uid(); e public.expenses;
BEGIN
  IF v_role NOT IN ('admin','accounts') THEN RAISE EXCEPTION 'Only Admin or Accounts can mark reimbursed'; END IF;
  IF p_txn IS NULL OR btrim(p_txn) = '' THEN RAISE EXCEPTION 'Transaction number is required'; END IF;
  SELECT * INTO e FROM public.expenses WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Expense not found'; END IF;
  IF e.status <> 'approved' THEN RAISE EXCEPTION 'Only approved claims can be paid (current: %)', e.status; END IF;

  UPDATE public.expenses SET status='reimbursed', reimbursed_by=v_uid, reimbursed_at=now(), payment_ref=p_txn, updated_at=now()
    WHERE id=p_id;
  INSERT INTO public.expense_status_history (expense_id, from_status, to_status, changed_by, note)
    VALUES (p_id, 'approved', 'reimbursed', v_uid, 'Txn ' || p_txn);
  SELECT * INTO e FROM public.expenses WHERE id = p_id;
  RETURN e;
END; $$;
GRANT EXECUTE ON FUNCTION public.expense_mark_reimbursed(uuid, text) TO authenticated;

-- 5c. Summary — server-side aggregation (never trips the 1000-row cap).
--     Mileage budget: person override → location → 0.  General: spend only.
CREATE OR REPLACE FUNCTION public.expense_summary(p_month date, p_is_test boolean DEFAULT false)
RETURNS TABLE (
  profile_id uuid, role text, location text,
  mileage_budget numeric, mileage_approved numeric, mileage_pending numeric,
  general_approved numeric, general_pending numeric,
  reimbursed numeric, payable numeric, rejected numeric
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (SELECT (date_trunc('month', p_month))::date AS ms),
  people AS (
    SELECT p.id, p.role, p.location FROM public.profiles p WHERE p.role IN ('sales','management','admin')
    UNION
    SELECT p.id, p.role, p.location FROM public.profiles p
      JOIN public.expenses e ON e.profile_id = p.id, m
     WHERE e.month_start = m.ms AND e.is_test = p_is_test
  ),
  agg AS (
    SELECT e.profile_id, c.is_mileage,
      COALESCE(SUM(e.approved_amount) FILTER (WHERE e.status IN ('approved','reimbursed')),0) AS approved,
      COALESCE(SUM(e.amount)          FILTER (WHERE e.status IN ('pending','mgmt_approved')),0) AS pending,
      COALESCE(SUM(e.approved_amount) FILTER (WHERE e.status='reimbursed'),0) AS reimbursed,
      COALESCE(SUM(e.approved_amount) FILTER (WHERE e.status='approved'),0)   AS payable,
      COALESCE(SUM(e.amount)          FILTER (WHERE e.status='rejected'),0)   AS rejected
    FROM public.expenses e JOIN public.expense_categories c ON c.id=e.category_id, m
    WHERE e.month_start = m.ms AND e.is_test = p_is_test
    GROUP BY e.profile_id, c.is_mileage
  ),
  gen AS (SELECT profile_id, approved, pending FROM agg WHERE is_mileage=false),
  mil AS (SELECT profile_id, approved, pending FROM agg WHERE is_mileage=true),
  ovr AS (SELECT profile_id, SUM(reimbursed) reimbursed, SUM(payable) payable, SUM(rejected) rejected FROM agg GROUP BY profile_id)
  SELECT pe.id, pe.role, pe.location,
    COALESCE((
      SELECT SUM(COALESCE(
        (SELECT b.budget_amount FROM public.expense_budgets b, m
          WHERE b.profile_id=pe.id AND b.category_id=c.id AND b.month_start=m.ms),
        (SELECT b.budget_amount FROM public.expense_budgets b
          WHERE b.profile_id=pe.id AND b.category_id=c.id AND b.month_start IS NULL),
        (SELECT lb.budget_amount FROM public.expense_location_budgets lb, m
          WHERE lb.location=pe.location AND lb.category_id=c.id AND lb.month_start=m.ms),
        (SELECT lb.budget_amount FROM public.expense_location_budgets lb
          WHERE lb.location=pe.location AND lb.category_id=c.id AND lb.month_start IS NULL),
        0))
      FROM public.expense_categories c WHERE c.is_mileage AND c.is_active
    ),0) AS mileage_budget,
    COALESCE(mil.approved,0), COALESCE(mil.pending,0),
    COALESCE(gen.approved,0), COALESCE(gen.pending,0),
    COALESCE(ovr.reimbursed,0), COALESCE(ovr.payable,0), COALESCE(ovr.rejected,0)
  FROM people pe
  LEFT JOIN gen ON gen.profile_id=pe.id
  LEFT JOIN mil ON mil.profile_id=pe.id
  LEFT JOIN ovr ON ovr.profile_id=pe.id
  WHERE public.expense_role() IN ('admin','management','accounts') OR pe.id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.expense_summary(date, boolean) TO authenticated;

-- 5d. Config people list — ACTIVE sales/management/admin only.
--     Suspension lives in auth.users.banned_until (not readable by the anon key),
--     and admin_list_users is admin-only, so management needs this.
CREATE OR REPLACE FUNCTION public.expense_budget_people()
RETURNS TABLE (id uuid, name text, role text, location text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.name, p.role, p.location
  FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.role IN ('sales','management','admin')
    AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND public.expense_role() IN ('admin','management')
  ORDER BY p.name;
$$;
GRANT EXECUTE ON FUNCTION public.expense_budget_people() TO authenticated;

-- 5e. Set a person's location (admin/management)
CREATE OR REPLACE FUNCTION public.expense_set_person_location(p_id uuid, p_location text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.expense_role() NOT IN ('admin','management') THEN RAISE EXCEPTION 'Not authorised to set location'; END IF;
  IF p_location IS NOT NULL AND p_location NOT IN ('Ahmedabad','Baroda') THEN RAISE EXCEPTION 'Invalid location'; END IF;
  UPDATE public.profiles SET location = p_location WHERE id = p_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.expense_set_person_location(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════
-- 6. STORAGE — private bucket for bills
--    Path: {profile_id}/{uuid}_{filename}
-- ═══════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('expense-bills','expense-bills', false, 8388608,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=8388608,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];

DROP POLICY IF EXISTS "expbill_insert" ON storage.objects;
DROP POLICY IF EXISTS "expbill_read"   ON storage.objects;
DROP POLICY IF EXISTS "expbill_delete" ON storage.objects;
CREATE POLICY "expbill_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='expense-bills' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "expbill_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='expense-bills' AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.expense_role() IN ('admin','management','accounts')));
CREATE POLICY "expbill_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='expense-bills' AND ((storage.foldername(name))[1] = auth.uid()::text
         OR public.expense_role() = 'admin'));

-- ═══════════════════════════════════════════════
-- 7. SEED — categories (colours from the SSC theme palette)
-- ═══════════════════════════════════════════════
INSERT INTO public.expense_categories (name, color, is_mileage, sort_order, vendor_options) VALUES
  ('Petrol',                 '#1a73e8', true,   10, NULL),
  ('Food',                   '#0F766E', false,  20, NULL),
  ('Lunch',                  '#14B8B5', false,  21, NULL),
  ('Dinner',                 '#0891B2', false,  22, NULL),
  ('Telephone',              '#163E68', false,  30, NULL),
  ('Mobile Bill',            '#1B4E8F', false,  31, ARRAY['Airtel','Jio','Vi','BSNL','Other']),
  ('Cab / Ride',             '#4338CA', false,  41, ARRAY['Uber','Ola','Rapido','Porter','Auto','Other']),
  ('Travel (Bus/Train/Air)', '#0369A1', false,  50, NULL),
  ('Hotel / Lodging',        '#475569', false,  60, NULL),
  ('Toll & Parking',         '#5B6878', false,  70, NULL),
  ('Vehicle Maintenance',    '#0F766E', false,  80, NULL),
  ('Courier / Postage',      '#0891B2', false,  90, NULL),
  ('Printing & Stationery',  '#475569', false, 100, NULL),
  ('Client Entertainment',   '#1a73e8', false, 110, NULL),
  ('Internet / Data',        '#14B8B5', false, 120, NULL),
  ('Miscellaneous',          '#5B6878', false, 130, NULL),
  ('Marketing',              '#4338CA', false, 140, NULL),
  ('Website Hosting',        '#0369A1', false, 150, NULL),
  ('Software Subscription',  '#1B4E8F', false, 160, NULL)
ON CONFLICT (name) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════
-- END expense_management.sql
-- ═══════════════════════════════════════════════════════════════════
