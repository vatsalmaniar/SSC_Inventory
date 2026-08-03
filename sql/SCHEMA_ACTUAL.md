# Authoritative schema — order & procurement core

**Introspected from the LIVE database on 2026-08-03.** This is what production
actually has, not what the patch scripts in `sql/` imply.

Why this file exists (audit finding F-15): `sql/` is a folder of hand-applied
patch scripts, not a migration history. Several load-bearing columns — most
importantly **`po_items.order_item_id`, the peg the entire procurement module
depends on** — had no `CREATE`/`ALTER` statement anywhere in the repo. The repo
could not rebuild the database, and nobody could tell from source what
production enforces. Regenerate this file after any schema change.

Legend: `!` = NOT NULL.

---

## orders
`id` uuid! (gen_random_uuid) · `order_number` text! **UNIQUE** · `customer_name` text! ·
`customer_gst` text · `dispatch_address` text · `po_number` text ·
`order_date` date! (CURRENT_DATE) · `order_type` text ('SO') · `engineer_name` text ·
`received_via` text · `freight` numeric (0) · `status` text! ('pending') ·
`notes` text · `created_by` uuid → auth.users · `created_at`/`updated_at` timestamptz (now) ·
`cancelled_reason` text · `cancelled_at` timestamptz · `approved_by` text ·
`po_document_url` text · `credit_terms` text · `edited_by` text · `submitted_by_name` text ·
`dispatch_mode`/`vehicle_type`/`vehicle_number`/`driver_name` text · `is_test` bool (false) ·
`fulfilment_center` text · `eway_bill_number`/`dc_number`/`invoice_number` text ·
`credit_override` bool (false) · `invoice_pdf_url`/`eway_pdf_url`/`einvoice_pdf_url` text ·
`account_owner` text · `crm_opportunity_id` uuid · `low_value_reason` text · `updated_by` uuid ·
`partial_deliveries_allowed` bool! (false) · `sample_returnable` bool! (true) ·
`hold_party`/`hold_reason`/`hold_set_by` text · `hold_set_at` timestamptz

CHECK: `hold_pair` (party and reason both set or both null) · `hold_party` ∈ sales/customer/stock ·
`hold_reason` ∈ 10-value whitelist · `order_date` between 2024-01-01 and 2035-12-31
**No CHECK on `status`** — the 21-value whitelist lives only in `enforce_order_status_integrity()`.
Triggers: `set_order_number` (BEFORE INSERT, generates order_number) ·
`trg_validate_order_status` (role gate) · `trg_enforce_order_integrity` (status + qty invariants) ·
`trg_audit_cols`

## order_items
`id` uuid! · `order_id` uuid → orders **ON DELETE CASCADE** · `sr_no` int · `item_code` text! ·
`qty` numeric! · `lp_unit_price`/`discount_pct`/`unit_price_after_disc`/`total_price` numeric (0) ·
`dispatch_date` date · `dispatched_qty` numeric (0) · `customer_ref_no` text · `stock_status` text ·
`description` text · `cancelled_qty` numeric! (0) · `line_status` text! ('active') ·
`cancelled_at` timestamptz · `cancelled_by` uuid → auth.users · `cancel_reason` text ·
`posted_qty` numeric! (0) · `procurement_source` text! ('po') · `stock_qty` numeric! (0) ·
audit cols

CHECK: `dispatched_qty <= qty` · `cancelled_qty >= 0 AND dispatched+cancelled <= qty` ·
`posted_qty >= 0 AND posted_qty <= dispatched_qty` · `line_status` ∈ active/cancelled/short_closed ·
`procurement_source` ∈ po/stock · `stock_qty >= 0` · dispatch_date sane

## purchase_orders
`id` uuid! · `po_number` text! **UNIQUE** · `vendor_id` uuid → vendors · `vendor_name` text ·
`order_id` uuid → orders **ON DELETE SET NULL** · `order_number` text · `status` text ('draft') ·
`po_date` date (CURRENT_DATE) · `expected_delivery` date · `total_amount` numeric (0) ·
`currency` text ('INR') · `notes` text · `approved_by` text · `approved_at`/`placed_at`/
`acknowledged_at`/`closed_at`/`received_at`/`cancelled_at` timestamptz · `created_by` uuid ·
`created_by_name`/`submitted_by_name` text · `fulfilment_center` text · `is_test` bool (false) ·
`reference` text · `payment_terms` text · `purchase_requisition` text · `po_document_url` text ·
`ssc_notes` text · `po_pdf_url` text · `ack_document_url` text · `po_type` text ('SO') ·
`po_file_url` text · `delivery_address` text · `delivery_customer_name` text ·
`cancelled_reason` text · audit cols

**No CHECK on `status`.** Enforced only by `trg_enforce_po_status`
(`enforce_po_status_integrity()`, applied 2026-08-03, currently **log-only** — see
`sql/po_status_integrity.sql`).
Triggers: `trg_enforce_po_status` · `trg_audit_cols`

## po_items
`id` uuid! · `po_id` uuid → purchase_orders **ON DELETE CASCADE** · `sr_no` int ·
`item_code` text · `description` text · `qty` numeric! · `received_qty` numeric (0) ·
`unit_price`/`total_price`/`discount_pct`/`unit_price_after_disc` numeric (0) ·
`lp_unit_price` numeric · `hsn_code` text · `delivery_date` date ·
**`order_item_id` uuid → order_items (NO ON DELETE ⇒ NO ACTION)** · audit cols

CHECK: `received_qty <= qty`
⚠️ **No UNIQUE on `order_item_id`** — two POs can both cover the same customer order line;
nothing at the database level prevents double-covering (audit F-11/clubbing race).

## grn
`id` uuid! · `grn_number` text! **UNIQUE** · `grn_type` text! ('po_inward') ·
`po_id` uuid → purchase_orders · `order_id` uuid → orders **ON DELETE SET NULL** ·
`vendor_id` uuid → vendors · `vendor_name`/`fulfilment_center`/`received_by` text ·
`received_at` timestamptz (now) · `invoice_number` text · `invoice_date` date ·
`invoice_amount` numeric · `status` text ('draft') · `notes` text · `is_test` bool (false) ·
`dispatch_mode`/`vehicle_type`/`vehicle_number`/`driver_name`/`transporter_name`/
`transporter_id`/`delivery_person` text · `credit_note_number`/`credit_note_url`/
`credit_note_uploaded_by` text · `credit_note_uploaded_at` timestamptz · audit cols

CHECK: `status` ∈ draft/checking/confirmed/invoice_matched/inward_posted
⚠️ **No CHECK on `grn_type`** — the four types exist only as a JS label map.

## grn_items
`id` uuid! · `grn_id` uuid → grn **ON DELETE CASCADE** ·
`po_item_id` uuid → po_items (NO ON DELETE ⇒ NO ACTION, so a received PO line cannot be deleted) ·
`po_id` uuid · `item_code`/`description` text ·
`expected_qty`/`received_qty`/`accepted_qty`/`rejected_qty`/`ordered_qty` numeric (0) ·
`rejection_reason` text · audit cols

⚠️ **Zero CHECK constraints.** `accepted + rejected <= received` is not enforced, and a negative
`accepted_qty` would *decrement* `po_items.received_qty` via `confirm_grn`.
Note both `expected_qty` (original DDL) and `ordered_qty` (added later, what the app writes) exist.

## purchase_invoices
`id` uuid! · `invoice_number` text · `vendor_id` uuid → vendors · `vendor_name` text ·
`invoice_date` date · `invoice_amount`/`gst_amount`/`total_amount` numeric (0) ·
`status` text ('three_way_check') · `matched_grn_ids`/`matched_po_ids` uuid[] ·
`invoice_pdf_url`/`vendor_invoice_url`/`ssc_invoice_url` text · `posted_at` timestamptz ·
`posted_by` text · `is_test` bool · `grn_id` uuid → grn · `po_id` uuid (**no FK**) ·
`three_way_notes` text · `three_way_checked_at` timestamptz · `three_way_checked_by` text ·
`inward_completed_at` timestamptz · `inward_completed_by` text · audit cols

CHECK: `status` ∈ three_way_check/invoice_pending/inward_complete/pending_match/matched/posted/paid

## order_dispatches
`id` uuid! · `order_id` uuid → orders **ON DELETE CASCADE** · `batch_no` int! (1) ·
**UNIQUE (order_id, batch_no)** · `fulfilment_center` text · `dc_number`/`invoice_number`/
`eway_bill_number` text · `status` text ('delivery_created') · `dispatch_mode`/`vehicle_type`/
`vehicle_number`/`driver_name` text · `credit_override` bool (false) · `dispatched_items` **jsonb** ·
`invoice_pdf_url`/`eway_pdf_url`/`einvoice_pdf_url` text · `pi_required` bool (false) ·
`pi_number` varchar · `pi_pdf_url` text · `pi_generated_date`/`pi_payment_date` date ·
`pi_payment_ref` text · `delivered_at` timestamptz · `posted_qty_applied_at` timestamptz ·
`credit_checked` bool! (true) · `credit_checked_at` timestamptz · `credit_checked_by` uuid · audit cols

Triggers: `trg_validate_dispatch_status` (role + credit gate) ·
`trg_enforce_dispatch_integrity` · `trg_audit_cols`
⚠️ `dispatched_items` jsonb carries client-computed float products
(`OrderDetail.jsx` dispatch path) that are later read back as numeric — audit F-16.

## po_delivery_dates
`id` uuid! · `po_id` uuid → purchase_orders **ON DELETE CASCADE** · `po_item_id` uuid (**no FK**) ·
`item_code` text · `expected_date` date! · `previous_date` date · `reason` text ·
`changed_by` text · audit cols

⚠️ `po_item_id` has **no FK**, so delivery-date history silently orphans when a PO line is deleted.

## inventory
`id` uuid! · `product_code` text! · `quantity` **integer**! (0) · `category_brand` text ·
`location` text · `updated_at` timestamptz (now)
**UNIQUE (product_code, location)**

⚠️ `quantity` is **integer**, not numeric — fractional stock cannot be represented.
Only writer is the daily XLS upload (`Accounts.jsx`) — by design, see
[[no-inventory-plusminus-rely-on-xls]]. No item-type column, so CI and SI stock are
indistinguishable here.

## items
`id` uuid! · `item_code` text! **UNIQUE** · `item_no` text · `brand`/`category`/`subcategory`/
`series` text · `type` text · `notes` text · `is_active` bool (true) · audit cols

CHECK: `type IS NULL OR type ∈ ('CI','SI')` — note NULL is allowed, so an un-typed item
passes CI filters (audit: forecast CI-exclusion hole).

---

## Corrections this introspection made to the 2026-08-03 audit

The audit was written from `sql/` alone (no DB access, by instruction). Live reality differs:

| Audit claim | Reality |
|---|---|
| `po_items.order_item_id` has no definition / FK unverified | Column **and FK exist** (`po_items_order_item_id_fkey`). Still **no UNIQUE** — the double-cover risk stands. |
| "FY hardcoded in `next_po_number`" | **False.** It calls `fy_suffix()`, which computes from `now()`. Verified live. `FY_START` in `lib/fmt.js` is also dynamic. **PO numbering will not break on 31 March.** |
| No CHECK on `grn.status` | **A CHECK exists** with the five statuses. |
| `inventory` unique (product_code, location) missing | **Exists.** |
| No CHECK on `purchase_orders.status` / `orders.status` | **Confirmed** — both rely on triggers only. |
| `grn_items` has no CHECKs | **Confirmed.** |
