-- ═══════════════════════════════════════════════════════════════════════════
-- F-16 — the PO total becomes a DERIVED value, as in SAP
-- Written: 2026-08-05
--
-- SAP never lets a document total float free: the header net value is computed
-- from the item lines (plus condition lines for freight, packing and the like),
-- and cannot be set independently. Here it was computed in the BROWSER with
-- IEEE-754 doubles and written into a numeric column, which produced two very
-- different problems — measured, not assumed:
--
--   1. FLOAT NOISE — 81 of 1,236 POs carry values like 2149.7000000000003.
--      The LINES are clean (0 of 4,261 po_items, 0 of 6,745 order_items), so
--      the drift comes purely from summing in JavaScript. Error is ~3e-11 of a
--      rupee: financially nothing, but it makes exact comparison unreliable and
--      looks wrong in exports.
--
--   2. FOUR MATERIAL MISMATCHES totalling ₹2,85,664, where the header and the
--      lines genuinely disagree. These are NOT float — every gap is a round
--      number that divides into a plausible unit price:
--        SSC/PO0056   ₹2,10,000  = 12 x 17,500
--        SSC/PO0060   ₹  54,720  = 12 x  4,560
--        SSC/PO0089   ₹  18,944  =  8 x  2,368
--        SSC/PCO0480  ₹   2,000  =  2 x  1,000
--      PCO0480 is proven: Krisha wrote "Need to add cutout charges 1000/nos" on
--      23-Jun, its 4 product lines total ₹37,040.88, and 37,040.88 + 2,000 is
--      EXACTLY the header ₹39,040.88. 'CUTOUT CHARGES' is a real item code used
--      43 times elsewhere for ₹1.25L — so charges DO belong on the PO as lines.
--      The header is right; the CHARGE LINE IS MISSING.
--
-- Therefore this migration deliberately does NOT "correct" those four. Pulling
-- the header down to the line sum would erase ₹2.85L of real cost from four
-- documents that have already been received and invoiced against. They need a
-- human to add the missing line — after which this trigger reconciles them
-- automatically.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The header total is now computed from the lines ─────────────────────
CREATE OR REPLACE FUNCTION public.po_recalc_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_po_id uuid := COALESCE(NEW.po_id, OLD.po_id);
  v_total numeric;
BEGIN
  IF v_po_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  -- round(): the sum is exact numeric arithmetic, but historical line values
  -- may themselves carry float residue from the old client-side pipeline.
  SELECT COALESCE(ROUND(SUM(total_price)::numeric, 2), 0)
    INTO v_total
    FROM public.po_items
   WHERE po_id = v_po_id;

  UPDATE public.purchase_orders
     SET total_amount = v_total
   WHERE id = v_po_id
     AND total_amount IS DISTINCT FROM v_total;   -- no-op write avoided

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_po_recalc_total ON public.po_items;
CREATE TRIGGER trg_po_recalc_total
  AFTER INSERT OR UPDATE OF qty, unit_price, unit_price_after_disc, total_price, po_id
  OR DELETE
  ON public.po_items
  FOR EACH ROW EXECUTE FUNCTION public.po_recalc_total();

-- ── 2. Clean the float noise ONLY ──────────────────────────────────────────
-- Strictly limited to differences of a paisa or less, i.e. provably the IEEE-754
-- residue and never a real amount. The four material gaps are untouched.
UPDATE public.purchase_orders p
   SET total_amount = ROUND(s.line_sum::numeric, 2)
  FROM (SELECT po_id, SUM(total_price) line_sum FROM public.po_items GROUP BY po_id) s
 WHERE s.po_id = p.id
   AND p.total_amount IS DISTINCT FROM ROUND(s.line_sum::numeric, 2)
   AND ABS(p.total_amount - s.line_sum) <= 0.01;

-- ── 3. Surface the real mismatches instead of hiding them ──────────────────
-- Anything left here is a genuine header-vs-lines disagreement needing a human.
-- Expected to hold exactly 4 rows on first run, and to empty itself as ops adds
-- the missing charge lines.
CREATE OR REPLACE VIEW public.po_total_mismatch AS
SELECT p.id, p.po_number, p.status, p.vendor_name, p.created_at::date AS po_date,
       p.total_amount           AS header_total,
       ROUND(s.line_sum::numeric, 2) AS line_total,
       ROUND((p.total_amount - s.line_sum)::numeric, 2) AS gap,
       s.n_lines
  FROM public.purchase_orders p
  JOIN (SELECT po_id, SUM(total_price) line_sum, COUNT(*) n_lines
          FROM public.po_items GROUP BY po_id) s ON s.po_id = p.id
 WHERE ABS(p.total_amount - s.line_sum) > 0.01
 ORDER BY ABS(p.total_amount - s.line_sum) DESC;

COMMENT ON VIEW public.po_total_mismatch IS
  'POs whose header total disagrees with their lines by more than a paisa. Each is a MISSING LINE (usually a charge such as CUTOUT CHARGES), not a rounding error — add the line rather than editing the header, and trg_po_recalc_total will reconcile it.';
