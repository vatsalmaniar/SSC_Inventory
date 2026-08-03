-- ═══════════════════════════════════════════════════════════════════════════
-- Coverage reconciliation harness — READ-ONLY proof that a change did not
-- hide anything.
--
-- WHY: every change to coverage logic moves what the procurement screens show.
-- Verifying that by hand-writing a one-off query each time is not repeatable
-- and not complete. This takes a full snapshot of what every CO and PO looks
-- like, so a before/after diff answers "did anything disappear?" with numbers.
--
-- The dangerous direction is DISAPPEARANCE: an order silently dropping off the
-- queue is invisible until a customer calls. Things newly appearing are almost
-- always a fix working.
--
-- USAGE
--   SELECT take_coverage_snapshot('before');     -- before deploying a change
--   ... deploy ...
--   SELECT take_coverage_snapshot('after');      -- after
--   SELECT * FROM coverage_diff('before','after');
--   -- Any row with change_type = 'DISAPPEARED' is a hard stop.
--
-- The line formula below MIRRORS src/lib/coverage.js lineToProcureQty(). If
-- that helper ever changes, change this too — they are meant to agree.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.coverage_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label             text NOT NULL,
  taken_at          timestamptz NOT NULL DEFAULT now(),
  kind              text NOT NULL,              -- 'co' | 'po'
  ref_id            uuid NOT NULL,
  ref_number        text,
  status            text,
  -- CO metrics
  active_lines      int,
  lines_needing_po  int,
  units_needing_po  numeric,
  in_pending_queue  boolean,
  -- PO metrics
  line_count        int,
  total_qty         numeric,
  total_amount      numeric,
  linked_co_count   int
);
CREATE INDEX IF NOT EXISTS idx_cov_snap_label ON public.coverage_snapshots(label, kind, ref_id);

ALTER TABLE public.coverage_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cov_snap_read ON public.coverage_snapshots;
CREATE POLICY cov_snap_read ON public.coverage_snapshots FOR SELECT TO authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.coverage_snapshots FROM authenticated;  -- snapshots are taken via SQL only

-- ── Per-line remaining-to-procure — mirrors lib/coverage.js ─────────────────
CREATE OR REPLACE FUNCTION public.line_to_procure_qty(p_line_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT CASE WHEN COALESCE(oi.line_status,'active') <> 'active' THEN 0 ELSE
    GREATEST(0, LEAST(
      -- by source: not yet covered by stock or an active PO
      oi.qty - COALESCE(oi.cancelled_qty,0)
        - (CASE WHEN COALESCE(oi.stock_qty,0) > 0
                  THEN LEAST(oi.stock_qty, GREATEST(0, oi.qty - COALESCE(oi.cancelled_qty,0)))
                WHEN oi.procurement_source = 'stock'
                  THEN GREATEST(0, oi.qty - COALESCE(oi.cancelled_qty,0))
                ELSE 0 END)
        - COALESCE((SELECT SUM(pi.qty) FROM po_items pi
                    JOIN purchase_orders po ON po.id = pi.po_id
                    WHERE pi.order_item_id = oi.id AND po.status <> 'cancelled'), 0),
      -- by shipped: can never need more than is still unshipped
      oi.qty - COALESCE(oi.cancelled_qty,0) - COALESCE(oi.dispatched_qty,0)
    )) END
  FROM order_items oi WHERE oi.id = p_line_id
$fn$;

-- ── Take a snapshot ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.take_coverage_snapshot(p_label text)
RETURNS TABLE(kind text, rows_captured bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_fy_start date;
BEGIN
  DELETE FROM coverage_snapshots WHERE label = p_label;   -- re-taking replaces

  -- Indian FY start, matching the app's FY_START scoping
  v_fy_start := make_date(CASE WHEN EXTRACT(MONTH FROM now()) >= 4
                               THEN EXTRACT(YEAR FROM now())::int
                               ELSE EXTRACT(YEAR FROM now())::int - 1 END, 4, 1);

  -- Customer orders (the procurement queue's universe)
  INSERT INTO coverage_snapshots (label, kind, ref_id, ref_number, status,
                                  active_lines, lines_needing_po, units_needing_po, in_pending_queue)
  SELECT p_label, 'co', o.id, o.order_number, o.status,
         COUNT(*) FILTER (WHERE COALESCE(oi.line_status,'active') = 'active'),
         COUNT(*) FILTER (WHERE line_to_procure_qty(oi.id) > 0),
         COALESCE(SUM(line_to_procure_qty(oi.id)), 0),
         COUNT(*) FILTER (WHERE line_to_procure_qty(oi.id) > 0) > 0
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.order_type = 'CO' AND o.is_test = false
    AND o.status <> 'pending' AND o.created_at >= v_fy_start
  GROUP BY o.id, o.order_number, o.status;

  -- Purchase orders (so a PO vanishing from any list is caught too)
  INSERT INTO coverage_snapshots (label, kind, ref_id, ref_number, status,
                                  line_count, total_qty, total_amount, linked_co_count)
  SELECT p_label, 'po', po.id, po.po_number, po.status,
         COUNT(pi.id), COALESCE(SUM(pi.qty),0), MAX(po.total_amount),
         COUNT(DISTINCT oi.order_id)
  FROM purchase_orders po
  LEFT JOIN po_items pi ON pi.po_id = po.id
  LEFT JOIN order_items oi ON oi.id = pi.order_item_id
  WHERE po.is_test = false
  GROUP BY po.id, po.po_number, po.status;

  RETURN QUERY SELECT s.kind, COUNT(*) FROM coverage_snapshots s
               WHERE s.label = p_label GROUP BY s.kind;
END $fn$;

-- ── Diff two snapshots ─────────────────────────────────────────────────────
-- change_type:
--   DISAPPEARED  — was in the pending queue, now is not.  ← the hard stop
--   APPEARED     — newly in the queue (usually a fix revealing real work)
--   REDUCED      — still there, but fewer units flagged
--   INCREASED    — more units flagged
--   PO_VANISHED  — a PO row present before is missing after
--   PO_CHANGED   — a PO's line count / qty / amount moved
CREATE OR REPLACE FUNCTION public.coverage_diff(p_before text, p_after text)
RETURNS TABLE(change_type text, ref_number text, status text, detail text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  -- COs that left the queue
  SELECT 'DISAPPEARED', b.ref_number, b.status,
         format('was %s units on %s lines, now %s',
                b.units_needing_po, b.lines_needing_po,
                CASE WHEN a.ref_id IS NULL THEN 'not in snapshot at all' ELSE a.units_needing_po::text || ' units' END)
  FROM coverage_snapshots b
  LEFT JOIN coverage_snapshots a ON a.label = p_after AND a.kind = 'co' AND a.ref_id = b.ref_id
  WHERE b.label = p_before AND b.kind = 'co' AND b.in_pending_queue
    AND (a.ref_id IS NULL OR NOT a.in_pending_queue)

  UNION ALL
  SELECT 'APPEARED', a.ref_number, a.status,
         format('%s units on %s lines now need a PO', a.units_needing_po, a.lines_needing_po)
  FROM coverage_snapshots a
  LEFT JOIN coverage_snapshots b ON b.label = p_before AND b.kind = 'co' AND b.ref_id = a.ref_id
  WHERE a.label = p_after AND a.kind = 'co' AND a.in_pending_queue
    AND (b.ref_id IS NULL OR NOT b.in_pending_queue)

  UNION ALL
  SELECT CASE WHEN a.units_needing_po < b.units_needing_po THEN 'REDUCED' ELSE 'INCREASED' END,
         a.ref_number, a.status,
         format('units needing a PO: %s → %s', b.units_needing_po, a.units_needing_po)
  FROM coverage_snapshots a
  JOIN coverage_snapshots b ON b.label = p_before AND b.kind = 'co' AND b.ref_id = a.ref_id
  WHERE a.label = p_after AND a.kind = 'co'
    AND a.in_pending_queue AND b.in_pending_queue
    AND a.units_needing_po IS DISTINCT FROM b.units_needing_po

  UNION ALL
  SELECT 'PO_VANISHED', b.ref_number, b.status,
         format('%s lines / %s qty present before, missing after', b.line_count, b.total_qty)
  FROM coverage_snapshots b
  LEFT JOIN coverage_snapshots a ON a.label = p_after AND a.kind = 'po' AND a.ref_id = b.ref_id
  WHERE b.label = p_before AND b.kind = 'po' AND a.ref_id IS NULL

  UNION ALL
  SELECT 'PO_CHANGED', a.ref_number, a.status,
         format('lines %s→%s, qty %s→%s, amount %s→%s',
                b.line_count, a.line_count, b.total_qty, a.total_qty, b.total_amount, a.total_amount)
  FROM coverage_snapshots a
  JOIN coverage_snapshots b ON b.label = p_before AND b.kind = 'po' AND b.ref_id = a.ref_id
  WHERE a.label = p_after AND a.kind = 'po'
    AND (a.line_count IS DISTINCT FROM b.line_count
      OR a.total_qty IS DISTINCT FROM b.total_qty
      OR a.total_amount IS DISTINCT FROM b.total_amount)
$fn$;

GRANT EXECUTE ON FUNCTION public.line_to_procure_qty(uuid)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.take_coverage_snapshot(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.coverage_diff(text, text)      TO authenticated;
