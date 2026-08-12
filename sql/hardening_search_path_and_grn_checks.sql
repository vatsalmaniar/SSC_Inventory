-- ═══════════════════════════════════════════════════════════════════════════
-- Hardening batch — audit Medium items
-- Written: 2026-08-12
--
-- 1. search_path pinned on every SECURITY DEFINER function
--    A SECURITY DEFINER function runs with the OWNER's rights. If its
--    search_path is not pinned, a caller can put a schema in front of `public`
--    and have the function resolve `profiles`, `orders` etc. to THEIR tables —
--    executing their code as the owner. The audit flagged
--    is_procurement_writer specifically; introspection found 15 unpinned.
--    ALTER FUNCTION ... SET search_path changes only resolution, never logic.
--
-- 2. grn_items CHECK constraints
--    The table had ZERO CHECKs. confirm_grn does
--        received_qty = received_qty + COALESCE(accepted_qty, received_qty, 0)
--    so a NEGATIVE accepted_qty silently DECREMENTS what the PO has received —
--    quietly reopening a closed PO line and corrupting the three-way match.
--    Verified against all 2,727 live rows before adding: zero negatives, zero
--    rows where accepted+rejected exceeds received. Nothing existing breaks.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Pin search_path (15 functions) ──────────────────────────────────────
ALTER FUNCTION public.handle_new_user()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.get_inventory_status()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_customer_id()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.replace_order_items(uuid, jsonb)           SET search_path = public, pg_temp;
ALTER FUNCTION public.is_procurement_writer()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_order_status_change()             SET search_path = public, pg_temp;
ALTER FUNCTION public.validate_dispatch_status_change()          SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_stock_transfer_dc(uuid)           SET search_path = public, pg_temp;
ALTER FUNCTION public.is_grn_writer()                            SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_set_user_suspended(uuid, boolean)    SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_list_users()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.admin_reset_user_mfa(uuid)                 SET search_path = public, pg_temp;
ALTER FUNCTION public.create_item(text,text,text,text,text,text,text)                          SET search_path = public, pg_temp;
ALTER FUNCTION public.create_item_v2(text,text,text,text,text,text,text,text,integer)          SET search_path = public, pg_temp;
ALTER FUNCTION public.create_item_v3(text,text,text,text,text,text,text,integer,text,numeric,text) SET search_path = public, pg_temp;

-- ── 2. grn_items sanity constraints ────────────────────────────────────────
-- NOT VALID is deliberately NOT used: the data is already clean (checked), so
-- these validate immediately and protect retrospectively too.
ALTER TABLE public.grn_items
  ADD CONSTRAINT grn_items_qty_nonneg
  CHECK (COALESCE(received_qty,0) >= 0
     AND COALESCE(accepted_qty,0) >= 0
     AND COALESCE(rejected_qty,0) >= 0);

-- You cannot accept + reject more than actually arrived.
ALTER TABLE public.grn_items
  ADD CONSTRAINT grn_items_split_within_received
  CHECK (COALESCE(accepted_qty,0) + COALESCE(rejected_qty,0) <= COALESCE(received_qty,0));

COMMENT ON CONSTRAINT grn_items_qty_nonneg ON public.grn_items IS
  'A negative accepted_qty would DECREMENT po_items.received_qty inside confirm_grn, silently reopening a closed PO line.';
