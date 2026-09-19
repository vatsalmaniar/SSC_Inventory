-- ═══════════════════════════════════════════════════════════════════════════
-- MAKE "KEEP ALL" ACTUALLY WORK
--
-- The bug: po_allow_overage() sets over_delivery_unlimited, the screen says
-- "Keeping all 25. Recorded on the PO." — and then confirm_grn refuses, because
-- neither it nor chk_po_received_qty knew the column existed. The authorisation
-- was real, the receipt was impossible. A button that promises something the
-- next step rejects is worse than no button.
--
-- I shipped the UI for this in Phase 1 and left the constraint work in Phase 3,
-- which is what produced a half-feature. This closes it.
--
-- ⚠️ THE CONSTRAINT IS REPLACED, AND IT IS LOOSER THAN BEFORE. A looser CHECK
--    can never fail validation against existing rows — verified anyway:
--    0 of 5,268 po_items rows violate the new form. No row is read or written,
--    and the default (tol 0, not unlimited) reproduces today's behaviour
--    exactly, so every PO that has never been given an overage behaves as it
--    always has.
--
-- ⛔ NO DATA IS DELETED.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Postgres cannot alter a CHECK in place, so this is a DROP + ADD of a RULE.
-- No row is touched.
alter table public.po_items drop constraint if exists chk_po_received_qty;
alter table public.po_items add constraint chk_po_received_qty check (
  received_qty <= case
    when over_delivery_unlimited then received_qty          -- always true
    else qty * (1 + coalesce(over_delivery_tol_pct, 0) / 100.0)
  end);

-- confirm_grn must honour the same rule, or it refuses what the constraint now
-- permits. Only the over-receipt test changes; everything else is byte-identical
-- to the version in grn_void_and_confirm_guard.sql.
CREATE OR REPLACE FUNCTION public.confirm_grn(p_grn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_grn record; v_item record;
  v_po_qty numeric; v_po_received numeric; v_all_received boolean; v_this numeric;
  v_tol numeric; v_unlimited boolean; v_cap numeric;
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
    SELECT qty, COALESCE(received_qty, 0),
           COALESCE(over_delivery_tol_pct, 0), COALESCE(over_delivery_unlimited, false)
      INTO v_po_qty, v_po_received, v_tol, v_unlimited
      FROM po_items WHERE id = v_item.po_item_id FOR UPDATE;

    v_this := COALESCE(v_item.accepted_qty, v_item.received_qty, 0);

    -- The ceiling this line may reach. With no overage allowed (the default, and
    -- every PO line that has not been deliberately opened) this is exactly qty,
    -- which is the behaviour that has always applied.
    v_cap := CASE WHEN v_unlimited THEN NULL
                  ELSE v_po_qty * (1 + v_tol / 100.0) END;

    IF v_cap IS NOT NULL AND v_po_received + v_this > v_cap THEN
      RAISE EXCEPTION
        'Cannot confirm %: PO line has qty %, of which % is already received, and this GRN adds % (total %). Another GRN for this line was most likely confirmed first. Either reduce this GRN to %, or void it if the goods were already booked.',
        v_item.item_code, v_po_qty, v_po_received, v_this, v_po_received + v_this,
        greatest(v_cap - v_po_received, 0)
        USING ERRCODE = '23514';
    END IF;

    UPDATE po_items SET received_qty = v_po_received + v_this WHERE id = v_item.po_item_id;
  END LOOP;

  UPDATE grn SET status = 'confirmed' WHERE id = p_grn_id;

  -- A line that has met or passed its ordered quantity is satisfied; so is one
  -- deliberately closed short. >= rather than = because an allowed overage now
  -- takes received_qty past qty.
  IF v_grn.po_id IS NOT NULL THEN
    SELECT NOT EXISTS(SELECT 1 FROM po_items
                       WHERE po_id = v_grn.po_id
                         AND received_qty < qty
                         AND NOT COALESCE(delivery_closed, false))
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
      SELECT NOT EXISTS(SELECT 1 FROM po_items
                         WHERE po_id = v_item.po_id
                           AND received_qty < qty
                           AND NOT COALESCE(delivery_closed, false))
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

revoke all     on function public.confirm_grn(uuid) from public, anon;
grant  execute on function public.confirm_grn(uuid) to authenticated;

commit;
