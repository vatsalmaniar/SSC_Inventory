-- ═══════════════════════════════════════════════════════════════════════════
-- TAKE TRUNCATE AWAY — found by red-teaming, 2026-09-19
--
-- I locked the new tables with "revoke insert, update, delete … from
-- authenticated" and never checked what was left. TRUNCATE was left. It bypasses
-- RLS completely and cannot be filtered by a policy, so a logged-in session
-- could empty a whole table in one statement:
--
--   truncate three_way_match_log;      -- the entire audit trail of every match,
--                                      -- override and duplicate, gone
--   truncate purchase_invoice_items;   -- every vendor rate ever keyed in — the
--                                      -- one fact that exists nowhere else
--   truncate three_way_tolerance;      -- the money control's configuration
--
-- The same grant sits on grn, grn_items, po_items and purchase_orders, where it
-- predates this work.
--
-- ZERO RISK TO THE APP. PostgREST has no way to issue TRUNCATE — nothing in the
-- codebase can call it, which is exactly why nobody noticed it was granted.
-- DELETE is deliberately left alone: PurchaseOrderDetail genuinely deletes
-- po_items when a PO is edited, and taking that away here would break PO
-- editing. Narrowing DELETE belongs with the Phase 3 write-path work.
--
-- ⛔ NO DATA IS DELETED. Privileges only.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

revoke truncate on
  public.grn,
  public.grn_items,
  public.po_items,
  public.purchase_orders,
  public.purchase_invoices,
  public.purchase_invoice_items,
  public.three_way_tolerance,
  public.three_way_match_log,
  public.inward_workflow_owners,
  public.inward_sla_config
from authenticated;

commit;
