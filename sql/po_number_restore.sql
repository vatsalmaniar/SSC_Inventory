-- ═══════════════════════════════════════════════════════════════════════════
-- RESTORE the PO numbers destroyed by re-approval    (prepared 2026-08-05)
--
-- CAUSE: PurchaseOrderDetail.handleApprove() calls next_po_number()
-- unconditionally. When an already-approved PO is amended it returns to
-- pending_approval; approving it AGAIN mints a brand-new number and overwrites
-- po_number, approved_at and placed_at. Five POs were renamed on 2026-08-04.
-- The vendor holds the ORIGINAL numbers, so the original numbers are correct.
--
-- Original numbers proved by bracketing each PO's true first-approval time
-- (from po_comments, which was never overwritten) against the approved_at of
-- the numbers either side. Every gap in the series is accounted for, with no
-- ambiguity:
--     PO0185  approved 10-Jul 11:00  between PO0184 10:41 and PO0186 13:11
--     PO0155  approved 25-Jun 11:57  between PO0154 24-Jun and PO0156 26-Jun
--     PO0167  approved 04-Jul 10:49  between PO0166 03-Jul and PO0168 04-Jul 10:52
--     PCO0401 approved 27-May 08:24  between PCO0400 08:02 and PCO0402 08:29
--
-- NOT RESTORED — SSC/PO0240 (was 0238 → 0239 → 0240). It was created, amended
-- twice and emailed to nVent all on 04-Aug, and the email went out at 12:18,
-- AFTER the final renumber. The vendor therefore holds 0240. Restoring it would
-- create the very mismatch this script exists to remove. Its burned numbers
-- 0238/0239 were never seen by anyone.
--
-- SAFETY CHECKED BEFORE WRITING:
--   • No other table stores our PO number. orders.po_number is the CUSTOMER's
--     reference — 0 of 2,544 rows contain an 'SSC/P%' value. All real links
--     (po_items, grn_items, po_delivery_dates, notifications) are by uuid.
--   • No duplicate risk: next_po_number is MAX+1, and the series maxima
--     (PO 240, PCO 886) are unchanged by this script because PO0240/PCO0886
--     both remain. Freed numbers 0232/0233/0234/0235/0881 will never be reused.
--   • po_comments keeps its own historical text — deliberately left alone, it
--     is the evidence trail that made this reconstruction possible.
--
-- approved_at / placed_at are restored to their TRUE original values, recovered
-- from po_comments. Leaving them at 04-Aug would keep claiming these POs were
-- approved and placed yesterday, which corrupts PO aging, the unplaced-PO
-- report and the new 24h/48h SLA measurements.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- SSC/PO0232 → SSC/PO0185   HCE Dynamics · ₹3,25,024
UPDATE public.purchase_orders SET
  po_number   = 'SSC/PO0185/26-27',
  approved_at = '2026-07-10 11:00:10.886190+00',
  placed_at   = '2026-07-10 12:34:58.996275+00'
WHERE id = 'd5c87038-b016-4895-ac0a-23aea8a2c22d' AND po_number = 'SSC/PO0232/26-27';

-- SSC/PO0233 → SSC/PO0155   HCE Dynamics · ₹6,14,450
UPDATE public.purchase_orders SET
  po_number   = 'SSC/PO0155/26-27',
  approved_at = '2026-06-25 11:57:13.119964+00',
  placed_at   = '2026-06-25 12:10:03.175620+00'
WHERE id = 'a6fc185c-09ff-46fb-8af9-974fa57786ff' AND po_number = 'SSC/PO0233/26-27';

-- SSC/PO0235 → SSC/PO0167   HCE Dynamics · ₹11,22,439
UPDATE public.purchase_orders SET
  po_number   = 'SSC/PO0167/26-27',
  approved_at = '2026-07-04 10:49:52.507447+00',
  placed_at   = '2026-07-08 07:26:28.476591+00'
WHERE id = '0969cdd4-f81a-469a-9f1c-f9229ae13020' AND po_number = 'SSC/PO0235/26-27';

-- SSC/PCO0881 → SSC/PCO0401   HCE Dynamics · ₹17,833 · CO0438
UPDATE public.purchase_orders SET
  po_number   = 'SSC/PCO0401/26-27',
  approved_at = '2026-05-27 08:24:56.476727+00',
  placed_at   = '2026-05-27 11:30:56.581501+00'
WHERE id = 'eab91c41-9034-403e-9da0-8a688d535de3' AND po_number = 'SSC/PCO0881/26-27';

-- Expect exactly 4 rows, and no duplicate numbers anywhere.
SELECT po_number, approved_at, placed_at, total_amount, vendor_name
FROM public.purchase_orders
WHERE id IN ('d5c87038-b016-4895-ac0a-23aea8a2c22d','a6fc185c-09ff-46fb-8af9-974fa57786ff',
             '0969cdd4-f81a-469a-9f1c-f9229ae13020','eab91c41-9034-403e-9da0-8a688d535de3')
ORDER BY po_number;

SELECT po_number, count(*) FROM public.purchase_orders
GROUP BY po_number HAVING count(*) > 1;   -- must return ZERO rows

COMMIT;
