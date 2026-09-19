-- ═══════════════════════════════════════════════════════════════════════════
-- The vendor invoice document, attached at the GRN
--
-- WHY IT BELONGS ON THE GRN. The invoice arrives with the truck: the driver hands
-- over the material and the bill together, so the person at the gate is holding
-- it first. Making accounts chase paper sitting in a Godawari drawer is how
-- invoices go missing, and the numbers say it does:
--
--   bills at three_way_check   209   with the invoice attached:  0
--   bills at invoice_pending    15   with the invoice attached:  0
--   bills inward_complete    1,327   with the invoice attached: 29
--   ------------------------------------------------------------------
--   1,551 bills, 29 attached — 1.9%.   (SSC invoice: 1, all year.)
--
-- Worse, the upload panel only rendered at invoice_pending or later
-- (PurchaseInvoiceDetail.jsx:614) — AFTER the check. So the person performing the
-- three-way check had the paper on their desk, quantities on screen, and one
-- free-text box. On SSC/GRN0683 they typed "Mismatch in Price" into it, which was
-- the only thing the screen allowed, and the bill advanced. The operator was
-- right; the screen had nowhere to put the finding.
--
-- Stored on the GRN (where it arrived), displayed on the bill beside the rates.
--
-- ⛔ NO DATA IS DELETED. One ADD COLUMN IF NOT EXISTS, nullable.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

alter table public.grn
  add column if not exists vendor_invoice_url text;

comment on column public.grn.vendor_invoice_url is
  'Photo or PDF of the vendor invoice, attached by FC at goods receipt. Shown on the bill beside the rate grid so whoever matches the prices can actually read the invoice. Bucket: vendor-docs, path grn-vendor-invoices/<grn_id>/.';

commit;

-- The bill reads it through the linked GRN, so nothing needs copying:
--   select pin.id, pin.invoice_number, coalesce(pin.vendor_invoice_url, g.vendor_invoice_url) as doc
--     from purchase_invoices pin left join grn g on g.id = pin.grn_id;
--
-- Bucket choice: vendor-docs, NOT po-documents. po-documents has a 200 KB
-- file_size_limit, and a phone photo of an invoice — even after the scanner has
-- flattened and compressed it — does not fit. vendor-docs has no limit, is
-- public like the other document buckets, and is semantically the right home.
