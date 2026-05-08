-- ─────────────────────────────────────────────────────────────────────
-- PARTIAL SO CANCELLATION — schema + atomic RPC
-- Apply via Supabase SQL editor.
-- Purely additive: no existing column/value modified, no row deleted.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Columns on order_items (default 0 / 'active' so existing rows keep current behaviour)
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS cancelled_qty   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_status     text    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancel_reason   text;

-- Status whitelist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_line_status_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_line_status_check
      CHECK (line_status IN ('active','cancelled','short_closed'));
  END IF;
END $$;

-- Ledger invariant: dispatched + cancelled <= ordered. Hard-stops over-cancellation
-- regardless of which path tries to write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'order_items_cancel_within_pending'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_cancel_within_pending
      CHECK (cancelled_qty >= 0 AND (COALESCE(dispatched_qty,0) + cancelled_qty) <= qty);
  END IF;
END $$;

-- Helpful index for filtering active lines fast (Customer 360, OrderDetail, exports)
CREATE INDEX IF NOT EXISTS idx_order_items_active
  ON public.order_items (order_id) WHERE line_status = 'active';

-- ─────────────────────────────────────────────────────────────────────
-- 2. RPC: cancel_order_lines
--    Atomic per-line cancel. Single transaction covers:
--      * per-line update of cancelled_qty / line_status / audit fields
--      * SO header status update (only when ALL lines fall to terminal state)
--      * one structured audit row in order_comments
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
  v_cur_cancel      numeric;
  v_pending         numeric;
  v_new_status      text;
  v_total_cancel    numeric := 0;
  v_total_value     numeric := 0;
  v_cancelled_lines jsonb := '[]'::jsonb;
  v_unit_price      numeric;
  v_item_code       text;
  v_active_lines    int;
  v_terminal_lines  int;
  v_total_lines     int;
  v_any_dispatched  boolean;
  v_order_status    text;
BEGIN
  -- Auth: admin or management may cancel (matches existing UI gate +
  -- gives a structured backstop in case the gate is bypassed).
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'cancel_order_lines: not authenticated';
  END IF;
  SELECT role, name INTO v_role, v_user_name FROM public.profiles WHERE id = v_user_id;
  IF v_role NOT IN ('admin','management') THEN
    RAISE EXCEPTION 'cancel_order_lines: role % cannot cancel orders', v_role;
  END IF;

  -- Sanity: order must exist and not already terminally cancelled
  SELECT status INTO v_order_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order_status IS NULL THEN
    RAISE EXCEPTION 'cancel_order_lines: order % not found', p_order_id;
  END IF;
  IF v_order_status = 'cancelled' THEN
    RAISE EXCEPTION 'cancel_order_lines: order is already fully cancelled';
  END IF;

  -- Per-line loop
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_item_id    := (v_line->>'item_id')::uuid;
    v_cancel_qty := (v_line->>'cancel_qty')::numeric;

    IF v_cancel_qty IS NULL OR v_cancel_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT qty, COALESCE(dispatched_qty,0), COALESCE(cancelled_qty,0),
           COALESCE(unit_price_after_disc, unit_price, 0), item_code
      INTO v_qty, v_disp, v_cur_cancel, v_unit_price, v_item_code
      FROM public.order_items
      WHERE id = v_item_id AND order_id = p_order_id
      FOR UPDATE;

    IF v_qty IS NULL THEN
      RAISE EXCEPTION 'cancel_order_lines: line % not found on order %', v_item_id, p_order_id;
    END IF;

    v_pending := v_qty - v_disp - v_cur_cancel;
    IF v_cancel_qty > v_pending THEN
      RAISE EXCEPTION
        'cancel_order_lines: line % — requested cancel % exceeds pending %',
        v_item_code, v_cancel_qty, v_pending;
    END IF;

    -- Determine new line_status
    IF (v_cur_cancel + v_cancel_qty) + v_disp >= v_qty THEN
      v_new_status := CASE WHEN v_disp = 0 THEN 'cancelled' ELSE 'short_closed' END;
    ELSE
      v_new_status := 'active';  -- partial cancel, still has pending qty
    END IF;

    UPDATE public.order_items SET
      cancelled_qty = v_cur_cancel + v_cancel_qty,
      line_status   = v_new_status,
      cancelled_at  = CASE WHEN v_new_status IN ('cancelled','short_closed') THEN now() ELSE cancelled_at END,
      cancelled_by  = CASE WHEN v_new_status IN ('cancelled','short_closed') THEN v_user_id ELSE cancelled_by END,
      cancel_reason = CASE WHEN cancel_reason IS NULL THEN p_reason ELSE cancel_reason END
    WHERE id = v_item_id;

    v_total_cancel := v_total_cancel + v_cancel_qty;
    v_total_value  := v_total_value  + (v_cancel_qty * v_unit_price);
    v_cancelled_lines := v_cancelled_lines || jsonb_build_object(
      'item_id',    v_item_id,
      'item_code',  v_item_code,
      'cancel_qty', v_cancel_qty,
      'unit_price', v_unit_price,
      'value',      v_cancel_qty * v_unit_price,
      'new_status', v_new_status
    );
  END LOOP;

  IF v_total_cancel = 0 THEN
    RAISE EXCEPTION 'cancel_order_lines: nothing to cancel (all qty = 0)';
  END IF;

  -- Header status logic:
  --   * if NO line was ever dispatched AND every line is now 'cancelled' → status = 'cancelled'
  --   * else leave orders.status as-is (pipeline keeps flowing for surviving active lines)
  SELECT
    COUNT(*) FILTER (WHERE line_status = 'active'),
    COUNT(*) FILTER (WHERE line_status IN ('cancelled','short_closed')),
    COUNT(*),
    bool_or(COALESCE(dispatched_qty,0) > 0)
    INTO v_active_lines, v_terminal_lines, v_total_lines, v_any_dispatched
    FROM public.order_items WHERE order_id = p_order_id;

  IF v_active_lines = 0 AND NOT v_any_dispatched THEN
    UPDATE public.orders SET status = 'cancelled', cancelled_reason = p_reason, updated_at = now()
      WHERE id = p_order_id;
  END IF;
  -- Otherwise leave status untouched. Surviving active lines continue through dispatch.

  -- Audit: ONE comments row, structured payload in message + flag
  INSERT INTO public.order_comments (
    order_id, author_name, message, is_activity, is_cancellation, tagged_users
  ) VALUES (
    p_order_id,
    COALESCE(v_user_name, 'system'),
    'Partial cancellation — ' || v_total_cancel::text || ' qty / ₹' || v_total_value::text
      || COALESCE(' (initiator: ' || p_initiator_type || ' / ' || p_initiator_name || ')', '')
      || ' | Reason: ' || COALESCE(p_reason, '—')
      || ' | __payload__=' || jsonb_build_object(
           'kind',            'partial_cancel',
           'initiator_type',  p_initiator_type,
           'initiator_name',  p_initiator_name,
           'reason',          p_reason,
           'total_qty',       v_total_cancel,
           'total_value',     v_total_value,
           'lines',           v_cancelled_lines,
           'header_changed',  (v_active_lines = 0 AND NOT v_any_dispatched)
         )::text,
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

GRANT EXECUTE ON FUNCTION public.cancel_order_lines(uuid, jsonb, text, text, text) TO authenticated;
