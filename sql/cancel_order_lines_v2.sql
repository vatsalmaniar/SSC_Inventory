-- ─────────────────────────────────────────────────────────────────────
-- cancel_order_lines V2 — uses posted_qty as cancellation cutoff,
-- and properly reverses in-flight batch qty when applicable.
--
-- Cancellable per line = qty − posted_qty − cancelled_qty
-- The cancel may span two pools per line:
--   1. Truly-pending qty (no batch involvement) — just bump cancelled_qty
--   2. In-flight qty at FC (pre-GI-post) — also decrement dispatched_qty
--      AND reverse the batch(es) holding that qty
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_order_lines(
  p_order_id        uuid,
  p_lines           jsonb,    -- [{"item_id":"<uuid>","cancel_qty":<num>}, ...]
  p_reason          text,
  p_initiator_type  text,     -- 'staff' | 'customer'
  p_initiator_name  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role            text;
  v_user_id         uuid := auth.uid();
  v_user_name       text;
  v_line            jsonb;
  v_item_id         uuid;
  v_cancel_qty      numeric;
  v_qty             numeric;
  v_disp            numeric;
  v_posted          numeric;
  v_cur_cancel      numeric;
  v_cancellable     numeric;
  v_truly_pending   numeric;
  v_from_pending    numeric;
  v_from_inflight   numeric;
  v_remaining       numeric;
  v_batch           record;
  v_di              jsonb;
  v_di_item_id      uuid;
  v_di_qty          numeric;
  v_take            numeric;
  v_new_items       jsonb;
  v_new_status      text;
  v_total_cancel    numeric := 0;
  v_total_value     numeric := 0;
  v_cancelled_lines jsonb := '[]'::jsonb;
  v_unit_price      numeric;
  v_item_code       text;
  v_active_lines    int;
  v_total_lines     int;
  v_any_dispatched  boolean;
  v_order_status    text;
  v_batch_remaining numeric;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'cancel_order_lines: not authenticated';
  END IF;
  SELECT role, name INTO v_role, v_user_name FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('admin','management') THEN
    RAISE EXCEPTION 'cancel_order_lines: role % cannot cancel orders', v_role;
  END IF;

  SELECT status INTO v_order_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'cancel_order_lines: order % not found', p_order_id;
  END IF;
  IF v_order_status = 'cancelled' THEN
    RAISE EXCEPTION 'cancel_order_lines: order is already fully cancelled';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id    := (v_line->>'item_id')::uuid;
    v_cancel_qty := (v_line->>'cancel_qty')::numeric;
    IF v_cancel_qty IS NULL OR v_cancel_qty <= 0 THEN CONTINUE; END IF;

    SELECT qty,
           COALESCE(dispatched_qty, 0),
           COALESCE(posted_qty, 0),
           COALESCE(cancelled_qty, 0),
           COALESCE(unit_price_after_disc, lp_unit_price, 0),
           item_code
      INTO v_qty, v_disp, v_posted, v_cur_cancel, v_unit_price, v_item_code
      FROM public.order_items
      WHERE id = v_item_id AND order_id = p_order_id
      FOR UPDATE;

    IF v_qty IS NULL THEN
      RAISE EXCEPTION 'cancel_order_lines: line % not found on order %', v_item_id, p_order_id;
    END IF;

    -- Cancellable = qty − posted − cancelled (Gate 2 cutoff = goods_issue_posted)
    v_cancellable := v_qty - v_posted - v_cur_cancel;
    IF v_cancel_qty > v_cancellable THEN
      RAISE EXCEPTION 'cancel_order_lines: line % — cancel % exceeds cancellable %',
        v_item_code, v_cancel_qty, v_cancellable;
    END IF;

    -- Split the cancel between two pools:
    --   pool A = truly-pending = qty − dispatched − cancelled (no batch involvement)
    --   pool B = in-flight     = dispatched − posted          (sitting in active batch)
    v_truly_pending  := v_qty - v_disp - v_cur_cancel;
    IF v_truly_pending < 0 THEN v_truly_pending := 0; END IF;
    v_from_pending   := LEAST(v_cancel_qty, v_truly_pending);
    v_from_inflight  := v_cancel_qty - v_from_pending;

    -- ── Reverse in-flight batches (only if from_inflight > 0) ──
    IF v_from_inflight > 0 THEN
      v_remaining := v_from_inflight;
      -- Walk active (pre-GI-post) batches in chronological order
      FOR v_batch IN
        SELECT id, dispatched_items, status
        FROM public.order_dispatches
        WHERE order_id = p_order_id
          AND status IN ('delivery_created','picking','packing','goods_issued','pi_requested','pi_generated','pi_payment_pending','credit_check')
        ORDER BY batch_no
        FOR UPDATE
      LOOP
        v_new_items := '[]'::jsonb;
        v_batch_remaining := 0;
        FOR v_di IN SELECT * FROM jsonb_array_elements(v_batch.dispatched_items)
        LOOP
          v_di_item_id := (v_di->>'order_item_id')::uuid;
          v_di_qty     := (v_di->>'qty')::numeric;

          IF v_di_item_id = v_item_id AND v_remaining > 0 AND v_di_qty > 0 THEN
            v_take := LEAST(v_remaining, v_di_qty);
            v_remaining := v_remaining - v_take;
            IF v_di_qty - v_take > 0 THEN
              -- Partial reduction: keep the line with reduced qty
              v_new_items := v_new_items || jsonb_set(
                v_di,
                '{qty}',
                to_jsonb((v_di_qty - v_take))
              );
              v_batch_remaining := v_batch_remaining + (v_di_qty - v_take);
            END IF;
            -- If full reduction, line is dropped from dispatched_items
          ELSE
            -- Keep line as-is (different item or no remaining cancel)
            v_new_items := v_new_items || v_di;
            IF v_di_qty IS NOT NULL THEN
              v_batch_remaining := v_batch_remaining + v_di_qty;
            END IF;
          END IF;
        END LOOP;

        UPDATE public.order_dispatches
          SET dispatched_items = v_new_items,
              status = CASE WHEN v_batch_remaining = 0 THEN 'cancelled' ELSE status END,
              updated_at = now()
          WHERE id = v_batch.id;

        IF v_remaining <= 0 THEN EXIT; END IF;
      END LOOP;

      IF v_remaining > 0 THEN
        RAISE EXCEPTION 'cancel_order_lines: line % — could not reverse % units from active batches', v_item_code, v_remaining;
      END IF;
    END IF;

    -- Determine new line_status
    IF (v_cur_cancel + v_cancel_qty) + v_posted >= v_qty THEN
      v_new_status := CASE WHEN v_posted = 0 THEN 'cancelled' ELSE 'short_closed' END;
    ELSE
      v_new_status := 'active';
    END IF;

    -- Apply the line update: bump cancelled_qty, decrement dispatched_qty by in-flight portion
    UPDATE public.order_items SET
      cancelled_qty = v_cur_cancel + v_cancel_qty,
      dispatched_qty = v_disp - v_from_inflight,
      line_status   = v_new_status,
      cancelled_at  = CASE WHEN v_new_status IN ('cancelled','short_closed') THEN now() ELSE cancelled_at END,
      cancelled_by  = CASE WHEN v_new_status IN ('cancelled','short_closed') THEN v_user_id ELSE cancelled_by END,
      cancel_reason = CASE WHEN cancel_reason IS NULL THEN p_reason ELSE cancel_reason END
    WHERE id = v_item_id;

    v_total_cancel := v_total_cancel + v_cancel_qty;
    v_total_value  := v_total_value  + (v_cancel_qty * v_unit_price);
    v_cancelled_lines := v_cancelled_lines || jsonb_build_object(
      'item_id',         v_item_id,
      'item_code',       v_item_code,
      'cancel_qty',      v_cancel_qty,
      'from_pending',    v_from_pending,
      'from_inflight',   v_from_inflight,
      'unit_price',      v_unit_price,
      'value',           v_cancel_qty * v_unit_price,
      'new_status',      v_new_status
    );
  END LOOP;

  IF v_total_cancel = 0 THEN
    RAISE EXCEPTION 'cancel_order_lines: nothing to cancel (all qty = 0)';
  END IF;

  -- Header status: only flip to 'cancelled' if no line was ever dispatched/posted AND every line cancelled
  SELECT
    COUNT(*) FILTER (WHERE line_status = 'active'),
    COUNT(*),
    bool_or(COALESCE(dispatched_qty,0) > 0 OR COALESCE(posted_qty,0) > 0)
    INTO v_active_lines, v_total_lines, v_any_dispatched
    FROM public.order_items WHERE order_id = p_order_id;

  IF v_active_lines = 0 THEN
    IF NOT v_any_dispatched THEN
      -- No qty was ever delivered → full cancellation
      UPDATE public.orders SET status = 'cancelled', cancelled_reason = p_reason, updated_at = now()
        WHERE id = p_order_id;
    ELSE
      -- Some qty was delivered + rest cancelled → order is closed (no remaining work)
      UPDATE public.orders SET status = 'closed', updated_at = now()
        WHERE id = p_order_id AND status NOT IN ('cancelled','closed');
    END IF;
  END IF;

  -- Audit row
  -- Audit row: short, human-readable. The structured per-line detail lives on
  -- order_items.cancelled_qty / cancel_reason / cancelled_at / cancelled_by.
  INSERT INTO public.order_comments (
    order_id, author_name, message, is_activity, is_cancellation, tagged_users
  ) VALUES (
    p_order_id,
    COALESCE(v_user_name, 'system'),
    'Partial cancellation — ' || v_total_cancel::text || ' units (₹' ||
      to_char(v_total_value, 'FM999,999,999.00') || ')'
      || ' · Initiated by ' ||
      CASE
        WHEN p_initiator_type = 'customer' THEN 'Customer: '
        WHEN p_initiator_type = 'staff'    THEN 'Staff: '
        ELSE ''
      END
      || COALESCE(NULLIF(p_initiator_name, ''), '—')
      || ' · Reason: ' || COALESCE(p_reason, '—'),
    true,
    true,
    NULL
  );

  RETURN jsonb_build_object(
    'ok',              true,
    'cancelled_qty',   v_total_cancel,
    'cancelled_value', v_total_value,
    'header_status',   CASE WHEN v_active_lines = 0 AND NOT v_any_dispatched THEN 'cancelled' ELSE v_order_status END,
    'lines',           v_cancelled_lines
  );
END;
$$;
