-- ═══════════════════════════════════════════════════════════════════════════
-- F-12 — a GRN that cannot be confirmed must have a way out
-- Written: 2026-08-05
--
-- WHAT ACTUALLY HAPPENS (diagnosed on live data, not from the audit text):
--   NewGRN filters PO lines to `qty > received_qty` when the DRAFT IS CREATED.
--   If another GRN for the same line is confirmed first, that draft is now
--   stale. confirm_grn correctly refuses to over-receive — but GRNDetail has
--   already written the delivery fields, and there is NO void path for a
--   po_inward GRN, so the document is stranded forever.
--
--   4 GRNs are stuck in 'checking' today:
--     GRN0212/GOD 20-Jun  all 5 lines already fully received   -> duplicate
--     GRN0462/KAV 13-Jul  all 6 lines already fully received   -> duplicate
--     GRN0481/KAV 14-Jul  CYF4L6-60V over by exactly 1 unit    -> adjust
--     GRN0587/KAV 28-Jul  not blocked at all, just unconfirmed -> confirm
--
-- The RPC's guard is CORRECT and is deliberately left in place — it is the only
-- thing that stopped 11 lines of double-receipt being booked. What was missing
-- is a reversal path and an error a human can act on.
--
-- SAP-shaped: a void is a REVERSAL DOCUMENT, not a delete. The GRN keeps its
-- number, its lines and its history, gains a status of 'cancelled' plus who,
-- when and why. Nothing is ever removed — the numbering stays gap-free and the
-- audit trail survives.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Allow the new terminal status ───────────────────────────────────────
ALTER TABLE public.grn DROP CONSTRAINT IF EXISTS grn_status_check;
ALTER TABLE public.grn ADD CONSTRAINT grn_status_check
  CHECK (status = ANY (ARRAY['draft','checking','confirmed','invoice_matched','inward_posted','cancelled']));

ALTER TABLE public.grn
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   text;

COMMENT ON COLUMN public.grn.void_reason IS
  'Why this GRN was voided. Mandatory — a cancelled receipt without a reason is indistinguishable from a mistake.';

-- ── 2. void_grn: the reversal ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_grn(p_grn_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp      -- pinned; the audit flagged the omission
AS $$
DECLARE
  v_grn  record;
  v_role text;
  v_name text;
BEGIN
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to void a GRN.' USING ERRCODE = '23514';
  END IF;

  SELECT role, name INTO v_role, v_name FROM public.profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin','management') THEN
    RAISE EXCEPTION 'Only admin or management may void a GRN.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grn FROM public.grn WHERE id = p_grn_id FOR UPDATE;
  IF v_grn IS NULL THEN
    RAISE EXCEPTION 'GRN not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_grn.status = 'cancelled' THEN RETURN; END IF;   -- idempotent

  -- A confirmed GRN has already moved po_items.received_qty and may have a
  -- purchase invoice against it. Reversing that safely is a different document
  -- (a return/debit note), not a void. Refuse rather than corrupt.
  IF v_grn.status <> ALL (ARRAY['draft','checking']) THEN
    RAISE EXCEPTION
      'GRN % is already %. Only a draft or checking GRN can be voided — a confirmed receipt must be reversed with a rejection/return GRN so stock and billing stay correct.',
      v_grn.grn_number, v_grn.status
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.grn
     SET status      = 'cancelled',
         void_reason = btrim(p_reason),
         voided_at   = now(),
         voided_by   = coalesce(v_name, 'Unknown'),
         updated_at  = now()
   WHERE id = p_grn_id;

  -- Visible on the PO's own timeline, so the void is not buried in the GRN.
  IF v_grn.po_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.po_comments (po_id, author_name, message, is_activity)
      VALUES (v_grn.po_id, coalesce(v_name,'System'),
              format('GRN %s was VOIDED. Reason: %s', v_grn.grn_number, btrim(p_reason)), true);
    EXCEPTION WHEN OTHERS THEN NULL;   -- never fail the void on a log write
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.void_grn(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_grn(uuid, text) TO authenticated;

-- ── 3. confirm_grn: same guard, an error a human can act on ────────────────
-- Unchanged in behaviour. The old message was
--   'Received qty would exceed PO qty for item X'
-- which says nothing about why or what to do. It now reports the real numbers
-- and names the two ways out.
CREATE OR REPLACE FUNCTION public.confirm_grn(p_grn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grn record;
  v_item record;
  v_po_qty numeric;
  v_po_received numeric;
  v_all_received boolean;
  v_this numeric;
BEGIN
  SELECT * INTO v_grn FROM grn WHERE id = p_grn_id;
  IF v_grn IS NULL THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF v_grn.status IN ('confirmed', 'invoice_matched', 'inward_posted') THEN RETURN; END IF;
  IF v_grn.status = 'cancelled' THEN
    RAISE EXCEPTION 'GRN % was voided and cannot be confirmed.', v_grn.grn_number USING ERRCODE = '23514';
  END IF;
  IF v_grn.status NOT IN ('draft', 'checking') THEN
    RAISE EXCEPTION 'GRN must be in draft or checking status to confirm';
  END IF;

  FOR v_item IN SELECT * FROM grn_items WHERE grn_id = p_grn_id AND po_item_id IS NOT NULL LOOP
    SELECT qty, COALESCE(received_qty, 0) INTO v_po_qty, v_po_received
    FROM po_items WHERE id = v_item.po_item_id FOR UPDATE;

    v_this := COALESCE(v_item.accepted_qty, v_item.received_qty, 0);

    IF v_po_received + v_this > v_po_qty THEN
      RAISE EXCEPTION
        'Cannot confirm %: PO line has qty %, of which % is already received, and this GRN adds % (total %). Another GRN for this line was most likely confirmed first. Either reduce this GRN to %, or void it if the goods were already booked.',
        v_item.item_code, v_po_qty, v_po_received, v_this, v_po_received + v_this,
        greatest(v_po_qty - v_po_received, 0)
        USING ERRCODE = '23514';
    END IF;

    UPDATE po_items SET received_qty = v_po_received + v_this WHERE id = v_item.po_item_id;
  END LOOP;

  UPDATE grn SET status = 'confirmed' WHERE id = p_grn_id;

  IF v_grn.po_id IS NOT NULL THEN
    SELECT NOT EXISTS(SELECT 1 FROM po_items WHERE po_id = v_grn.po_id AND received_qty < qty)
      INTO v_all_received;
    IF v_all_received THEN
      UPDATE purchase_orders SET status='material_received', received_at=now(), updated_at=now()
       WHERE id = v_grn.po_id;
    ELSE
      UPDATE purchase_orders SET status='partially_received', updated_at=now()
       WHERE id = v_grn.po_id AND status NOT IN ('partially_received','material_received');
    END IF;
  ELSE
    FOR v_item IN SELECT DISTINCT gi.po_id FROM grn_items gi
                   WHERE gi.grn_id = p_grn_id AND gi.po_id IS NOT NULL LOOP
      SELECT NOT EXISTS(SELECT 1 FROM po_items WHERE po_id = v_item.po_id AND received_qty < qty)
        INTO v_all_received;
      IF v_all_received THEN
        UPDATE purchase_orders SET status='material_received', received_at=now(), updated_at=now()
         WHERE id = v_item.po_id;
      ELSE
        UPDATE purchase_orders SET status='partially_received', updated_at=now()
         WHERE id = v_item.po_id AND status NOT IN ('partially_received','material_received');
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ── 4. What a voided GRN must never do ─────────────────────────────────────
-- Voided GRNs must drop out of every "received" reading. Anything selecting
-- grn_items for receipt totals must exclude status='cancelled' — the same way
-- cancelled POs are excluded from coverage.
COMMENT ON COLUMN public.grn.status IS
  'draft -> checking -> confirmed -> invoice_matched -> inward_posted, or cancelled (voided before confirmation). EXCLUDE cancelled from any receipt/qty aggregation.';
