-- ─────────────────────────────────────────────────────────────────────────────
-- notifications.po_id — proper PO link for PO-related notifications
-- Applied: 2026-06-11 (via Management API)
--
-- BUG FIXED: po_linked_co_cancelled and po_mention notifications stored the
-- PO's UUID in notifications.order_id ("repurposed for click-through"), but
-- order_id has a FK to orders(id) — so every such insert failed with 23503
-- and ops NEVER received "CO cancelled — cancel/relink PO" alerts, and PO
-- mentions never notified. Failures were silent (error not checked).
--
-- FIX: dedicated po_id column with its own FK. ON DELETE SET NULL because the
-- app deletes draft PO headers on insert-rollback paths.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS po_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;
