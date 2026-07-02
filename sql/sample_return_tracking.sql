-- Sample Return tracking — 30-day policy with extensions and 60-day hard cap
-- Applied: 2026-07-02 (via Management API)
--
-- Policy (user-defined):
--   • Returnable samples must come back within 30 days of delivery.
--   • Overdue → DAILY bell notification to the ACCOUNT OWNER only (no email,
--     no management/admin copies) until a return GRN or an extension exists.
--     Dedup: max one bell per order per ~day (20h guard against cron drift).
--   • Owner must record an extension on the order page: next date + reason.
--   • 2nd extension: max +15 days. Hard stop 60 days from delivery — after
--     that (or 2 extensions) no more extensions, material must be returned.
--   • Cycle closes when a sample_return GRN exists.
--   • orders.sample_returnable = false exempts the order entirely.
--
-- SERVER-SAFETY (after the 2026-04-21 cron incident): the daily job is pure
-- SQL via pg_cron — no Edge Function, no HTTP, no email. It scans only SAMPLE
-- orders (~32 rows today), inserts at most 50 notifications per run, and each
-- milestone notifies exactly once (dedup on notifications after the due date).
-- Dry-run measured in milliseconds.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sample_returnable boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.sample_extensions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  extended_until  date NOT NULL,
  reason          text NOT NULL,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.sample_extensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_read ON public.sample_extensions FOR SELECT TO authenticated USING (true);
-- NO write policies + writes revoked: the SECURITY DEFINER RPC below is the
-- ONLY door in, so the 2-extension / +15-day / 60-day caps cannot be bypassed
-- by direct API inserts. Extensions are immutable history (no update/delete).
REVOKE INSERT, UPDATE, DELETE ON public.sample_extensions FROM authenticated;
CREATE INDEX IF NOT EXISTS idx_sample_ext_order ON public.sample_extensions(order_id);

-- Extension rules enforced server-side (UI calls this; direct table insert is
-- possible but the card + cron read the same data either way).
CREATE OR REPLACE FUNCTION add_sample_extension(p_order_id uuid, p_until date, p_reason text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_order record; v_base timestamptz; v_cap date; v_ext_count int; v_prev_until date;
BEGIN
  SELECT id, order_type, status, sample_returnable INTO v_order FROM orders WHERE id = p_order_id;
  IF v_order.id IS NULL OR v_order.order_type <> 'SAMPLE' THEN RETURN json_build_object('ok', false, 'error', 'Not a sample order'); END IF;
  IF v_order.status = 'cancelled' THEN RETURN json_build_object('ok', false, 'error', 'Order is cancelled'); END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RETURN json_build_object('ok', false, 'error', 'Reason is mandatory'); END IF;
  IF EXISTS (SELECT 1 FROM grn g WHERE g.order_id = p_order_id AND g.grn_type = 'sample_return') THEN
    RETURN json_build_object('ok', false, 'error', 'Sample already returned via GRN'); END IF;
  SELECT coalesce((SELECT max(od.delivered_at) FROM order_dispatches od WHERE od.order_id = p_order_id AND od.delivered_at IS NOT NULL), o.order_date::timestamptz)
    INTO v_base FROM orders o WHERE o.id = p_order_id;
  v_cap := (v_base + interval '60 days')::date;
  SELECT count(*), max(extended_until) INTO v_ext_count, v_prev_until FROM sample_extensions WHERE order_id = p_order_id;
  IF v_ext_count >= 2 THEN RETURN json_build_object('ok', false, 'error', 'Maximum 2 extensions reached — material must be returned (60-day policy)'); END IF;
  IF now() > v_base + interval '60 days' THEN RETURN json_build_object('ok', false, 'error', '60-day limit crossed — no further extensions, material must be returned'); END IF;
  IF p_until <= current_date THEN RETURN json_build_object('ok', false, 'error', 'Extension date must be in the future'); END IF;
  IF p_until > v_cap THEN RETURN json_build_object('ok', false, 'error', 'Extension cannot go beyond 60 days from delivery (max ' || to_char(v_cap, 'DD Mon YYYY') || ')'); END IF;
  IF v_ext_count = 1 AND p_until > v_prev_until + 15 THEN
    RETURN json_build_object('ok', false, 'error', 'Second extension is limited to 15 days (max ' || to_char(least(v_prev_until + 15, v_cap), 'DD Mon YYYY') || ')'); END IF;
  INSERT INTO sample_extensions (order_id, extended_until, reason, created_by, created_by_name)
  VALUES (p_order_id, p_until, trim(p_reason), auth.uid(), (SELECT name FROM profiles WHERE id = auth.uid()));
  RETURN json_build_object('ok', true, 'until', p_until, 'extension_no', v_ext_count + 1);
END $fn$;
GRANT EXECUTE ON FUNCTION add_sample_extension(uuid, date, text) TO authenticated;

-- Daily flagger: bell notification to the account owner EVERY DAY while the
-- sample is overdue and unactioned; stops when a sample_return GRN exists, an
-- extension pushes due_at into the future, or the order is marked
-- non-returnable. Owner matched by profiles.name = orders.account_owner;
-- unmatched owners are skipped. Function has statement_timeout=10s.
CREATE OR REPLACE FUNCTION flag_overdue_samples() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_count int;
BEGIN
  WITH due AS (
    SELECT o.id, o.order_number, o.customer_name, o.account_owner, o.created_by,
      (SELECT count(*) FROM sample_extensions se WHERE se.order_id = o.id) AS ext_count,
      greatest(
        coalesce((SELECT max(od.delivered_at) FROM order_dispatches od WHERE od.order_id = o.id AND od.delivered_at IS NOT NULL), o.order_date::timestamptz) + interval '30 days',
        coalesce((SELECT max(se.extended_until)::timestamptz + interval '1 day' FROM sample_extensions se WHERE se.order_id = o.id), '-infinity'::timestamptz)
      ) AS due_at,
      coalesce((SELECT max(od.delivered_at) FROM order_dispatches od WHERE od.order_id = o.id AND od.delivered_at IS NOT NULL), o.order_date::timestamptz) + interval '60 days' AS hard_cap_at
    FROM orders o
    WHERE o.order_type = 'SAMPLE' AND o.is_test = false AND o.status <> 'cancelled'
      AND o.sample_returnable = true
      AND NOT EXISTS (SELECT 1 FROM grn g WHERE g.order_id = o.id AND g.grn_type = 'sample_return')
  ),
  overdue AS (
    -- Recipient = account owner matched by profile name; if the owner is a
    -- team label (no matching user), fall back to the order CREATOR.
    SELECT d.*, coalesce(p.id, pc.id) AS recipient_id, coalesce(p.name, pc.name) AS recipient_name
    FROM due d
    LEFT JOIN profiles p  ON p.name = d.account_owner
    LEFT JOIN profiles pc ON pc.id = d.created_by
    WHERE d.due_at < now()
      AND coalesce(p.id, pc.id) IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.email_type = 'sample_return_overdue' AND n.order_id = d.id AND n.created_at > now() - interval '20 hours')
    LIMIT 50
  )
  INSERT INTO notifications (user_name, user_id, message, order_id, order_number, from_name, email_type)
  SELECT recipient_name, recipient_id,
    order_number || ' — sample with ' || customer_name || ' is past its return date. ' ||
    CASE WHEN now() > hard_cap_at OR ext_count >= 2
      THEN '60-day limit: no further extensions — the material must be returned (Sample Return GRN).'
      ELSE 'Record the Sample Return GRN or add an extension (reason + next date) on the order page.' END,
    id, order_number, 'Sample Return Tracker', 'sample_return_overdue'
  FROM overdue;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $fn$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- 03:30 UTC = 09:00 IST daily
SELECT cron.schedule('flag-overdue-samples', '30 3 * * *', 'select flag_overdue_samples()');
