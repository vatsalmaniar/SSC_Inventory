# CO / Procurement Module — Red-Team Audit
**Date:** 2026-08-03 · **Scope:** code-level only (no DB writes; no live-DB reads in this audit run) · **Repo:** `~/code/ssc-inventory` @ `6eb0b0f`
**Method:** 4 parallel source tracers (schema/RPC · CO→PO flow · PO lifecycle · GRN/forecast/inventory), full-file reads, every claim cited file:line.

---

## TERMINOLOGY CORRECTIONS (code vs. the brief — read first)

1. **"CO" is not a procurement record.** It is the sales order itself: `orders.order_type='CO'`. The Procurement "CO Orders" screen is a filtered view of sales orders. SO and CO are the same row; "SO line pegged to CO" is a non-question — they are one object.
2. **"Group CO" has no entity.** A group is a single PO whose lines point at different orders' lines. No group table, no group id, no group status. Membership is *inferred* from `po_items.order_item_id` at query time (reconstructed in `ProcurementOrders.jsx:106-132`, `PurchaseOrderDetail.jsx:192-216`).
3. **CI item** = `items.type='CI'` (`sql/items_schema.sql:12`). Matches the brief.

**First-line requirement answered:** the SO-line↔PO-line peg **is a first-class persisted relationship** — `po_items.order_item_id`, written at `NewPurchaseOrder.jsx:449`, and (verified live on 2026-06-22 in an earlier session) enforced by FK `po_items_order_item_id_fkey → order_items`. **However, the column has no creation statement anywhere in `sql/`** — the single most load-bearing column in procurement exists only out-of-band (see F-15, governance).

---

## 1. VERDICT (12 lines)

**Not SAP-grade.** This is a **diligent document-flow tracker with honest queues** — statuses move, per-line pegging exists and is real, a few RPCs (cancel, dispatch, GRN-confirm) are genuinely atomic and locked. But it is not a system of record for quantity, money, or commitments:
1. **Goods receipt never touches stock.** The only writer to `inventory` is the daily XLS upload (`Accounts.jsx:170`). Received material — including custom material for dead orders — exists as no quantity anywhere.
2. **An approved PO is freely rewritable** — qty, price, lines — with no re-approval, no field diff logged, and the "PO document" re-renders current data under the original approver's name (`PurchaseOrderDetail.jsx:1230-1234, 1159-1204, 933`).
3. **The vendor is never told anything automatically.** Their reality is the last manually emailed PDF; the ERP can diverge from it without limit (§6 of lifecycle trace).
4. **UI role gates are cosmetic** — any ops/accounts user can PATCH any PO status/amount via the API (`sql/procurement_patch_v2.sql:296-297`; no PO transition trigger exists).
5. All money/qty is `numeric` in the DB but computed in client floats first, including a float product persisted inside `dispatched_items` JSONB and re-read as numeric (`OrderDetail.jsx:757` → `posted_qty_model.sql:90`).
Blockers to "robust": DB-enforced PO immutability-after-approval + re-approval; a pegged receiving/inventory model; vendor-facing event discipline; migration governance (repo ≠ DB).

---

## 2. THE SEVEN STATED BUSINESS RULES vs. REALITY

| # | Stated rule | Verdict | Evidence & real behaviour |
|---|---|---|---|
| 1 | CI items are not held in stock | **Not implemented (unenforced)** | Nothing prevents CI in `inventory`: XLS upload takes any code, no validation against `items`, no type filter (`Accounts.jsx:119-123, 170`). Forecast excludes CI (`ProcurementForecast.jsx:742`) but items with `type IS NULL` pass, and `ForecastPOModal` item search has no type filter at all (`ForecastPOModal.jsx:69-75`). CI stock can exist and be read by Waitlist/Sales/Forecast. |
| 2 | SO with CI must surface in CO Orders | **Partial** | Surfacing is keyed on `order_type='CO'` (`ProcurementOrders.jsx:49`). New Order auto-upgrades SO→CO when a CI line is present (`NewOrder.jsx:147-148`). Gap: the CRM convert-to-order flow lets the user pick SO/CO manually; no auto-upgrade verified there. An order mistyped SO with CI lines never reaches procurement. |
| 3 | CO may be closed from stock, closing the PO | **Implemented differently + defective** | "Close from stock" writes `order_items.stock_qty`/`procurement_source` only — it verifies no stock, reserves nothing, decrements nothing, creates no record (`NewPurchaseOrder.jsx:322-335, 344-355`; no `inventory` read in the file). It closes no PO (none exists on that path). Two live defects: prefill omits `stock_qty` (`:121` vs picker `:90`) so partial allocations are invisible on reopen; and `applyStockAllocs` **overwrites** instead of accumulating (`:322-335`) — a second entry can silently shrink the allocation. This is the users' reported bug, confirmed. |
| 4 | Customer cancels → orphan PO notification | **Partial** | Event-driven broadcast to all ops/admin/management on cancel (`OrderDetail.jsx:958-1005`). Defects: partial cancellations send the message "*CO cancelled — relink PO*" for orders that are still alive (`:985-987`); POs at `material_received`/`closed` match neither message branch → **no notification at all** (`:982-998`); linked-PO discovery is unbatched `.in()` (`:966`) and under-discovers on large orders; failures are swallowed (`:1002-1004`). |
| 5 | No new orders → vendor informed for PO closure | **Not implemented** | No aging clock, no "same item" matching logic, no closure action (PO status `closed` has **no set-site anywhere** — dead state, `PurchaseOrderDetail.jsx:29` vs. grep), no vendor communication of any kind except the manual Send-PO email (single call site `PurchaseOrderDetail.jsx:584`). |
| 6 | PO qty must match customer qty | **Partial** | Prefill defaults to the qty-precise remaining (`NewPurchaseOrder.jsx:163`), and the coverage Map is quantity-aware (`coverage.js:26-41`). But: qty freely editable at creation with no re-check against a stale `co_remaining` snapshot; post-approval edits unbounded (F-01); relink re-pegs lines by `item_code` only, **never comparing qty** — a 500-unit PO line can bind to a 5-unit CO line (`PurchaseOrderDetail.jsx:322-346`); OrderDetail's own coverage uses existence-Set semantics, so a 1-of-100 PO shows "Fully Covered" (`OrderDetail.jsx:266, 1415-1417`). |
| 7 | Group CO to meet vendor MOQ | **Implemented differently** | Clubbing exists and per-line pegs survive; one leg's cancellation is separable (multi-CO banner + per-line removal, `PurchaseOrderDetail.jsx:1357-1404`). But there is no group entity, **no MOQ data anywhere**, no aging alert while a CO waits for grouping, no vendor-amendment automation on leg removal, and no cost/freight re-allocation to member orders (nothing exists — grep §7 of flow trace). |

---

## 3. FINDINGS TABLE

Severity per brief: **Critical** = wrong qty/money reaching customer or vendor, loss with no detection, or unrecoverable without SQL.

| ID | Title | Category | Sev | Evidence | What breaks | Blast radius | Silence | Fix | Effort |
|---|---|---|---|---|---|---|---|---|---|
| F-01 | PO fully rewritable after approval; no re-approval; no diff audit; lines deleted+reinserted losing `received_qty`, breaking `grn_items.po_item_id` & delivery-date links; "View PO" re-renders new numbers under old approver | Business logic / Financial | **Critical** | `PurchaseOrderDetail.jsx:1230-1234` (canEdit incl. placed/ack/partially_received), `:1159-1204` (saveEdit; delete `:1182`, re-insert `:1185-1196`, audit = literal "Purchase Order edited" `:1200`), `:933` (viewPoPdf re-render) | Approved ₹50k PO becomes ₹50L under same approval stamp; partial receipts reset; GRN/date history orphans; pre-edit state unrecoverable (no diff anywhere) | purchase_orders, po_items, po_delivery_dates, grn_items links; vendor money; 3-way check inputs | **Unbounded — nothing records what changed** | Lock lines post-approval; amendments via re-approval path with field diff logged; never delete+reinsert | M |
| F-02 | Stock-close split-brain + overwrite (the reported bug) | Business logic | **Critical** | Prefill select missing `stock_qty` `NewPurchaseOrder.jsx:121` (picker has it `:90`); fallback path `coverage.js:44-52`; overwrite `NewPurchaseOrder.jsx:322-335` | Partial allocations invisible on reopen → offered for re-procurement (over-order) or re-entered → allocation silently shrinks; ghost COs unfixable via UI (`procurement_source='stock'` + partial `stock_qty` state) | order_items truth, procurement queue, PO over-orders | Weeks (users already hit it; 12 latent lines + 1 live ghost measured in prior session) | Add `stock_qty` to prefill; accumulate in applyStockAllocs | S |
| F-03 | Stock-close verifies nothing; no reservation, no inventory read/decrement anywhere | Data model / Business logic | **Critical** | `NewPurchaseOrder.jsx:322-355` (no inventory query in file); only `inventory` writers are XLS upload `Accounts.jsx:170,179-183`; `posted_qty_model.sql:45-50` admits it | Two COs closeable against the same non-existent unit; "from stock" is an unverified human claim; self-feeding orphan loop possible (PO left open while line stock-closed → material arrives with no owner, §16) | order_items, dispatch promises, customer dates | **None — no detection mechanism exists** | Phase 1: warn against `inventory` qty at close; Phase 2: reservation model | M/L |
| F-04 | GRN mis-pegging on clubbed POs: line picker shows no customer; prefill auto-fills all lines at full pending | Business logic / UX | **Critical** | `NewGRN.jsx:626-632` (picker: item+sr_no only), `:78-108` (prefill all pending) | Short vendor shipment → receiver's uninformed click decides which customer's line is "received"; wrong customer gets material/dates | po_items.received_qty, customer commitments, billing sequence | Until a customer complains (weeks) | Show CO/customer per line; force allocation prompt on short receipts | S |
| F-05 | Partial cancellation leaves zero durable signal on the PO; broadcast text falsely says order "cancelled"; OrderDetail Set-coverage shows Fully Covered regardless of qty | Business logic | **Critical** | `cancel_order_lines_v2.sql:168,213` (line stays active, header untouched); `OrderDetail.jsx:950,985-987` (same misleading message), `:266,1415-1417` (existence semantics); PO banners keyed on order status only `PurchaseOrderDetail.jsx:115,166-181,1357,1412` | Qty 100→60: vendor keeps 100 committed, PO unchanged, ops told to "relink" a live order; 40 surplus arrives unowned | po_items, vendor commitments, inventory-that-isn't | Until goods arrive (lead-time weeks/months) | Correct message for partial; PO-line "CO shrank" flag; qty-aware coverage on OrderDetail | M |
| F-06 | Server-side authorization cosmetic: any ops/accounts can PATCH PO status/amount; order triggers bypassable | Concurrency / Security | **Critical** (latent) | `procurement_patch_v2.sql:296-297` + no PO transition trigger (grep); `order_status_integrity.sql:177` (GUC bypass), `security_rls_orders.sql:326` (`auth.uid() IS NULL` early return), `:56,:63` (orders/order_items `USING(true)`) | Approval, cancellation and amount gates exist only in React; one curl call forges any PO state | Everything downstream of PO status | Until audited (never, today) | PO status-transition trigger + role checks in DB; remove GUC bypass or gate it | M |
| F-07 | Relink re-pegs by item_code only, qty ignored, greedy; unmatched links silently nulled; per-line remaps unlogged; header-only rewrite; failures swallowed while UI says success | Business logic | High | `PurchaseOrderDetail.jsx:307-363` (matching `:322-346`, catch `:351`) | Coverage lies on the new CO; provenance destroyed; same-name customer collision (`:170-178` name-ILIKE candidates) | po_items pegs, coverage, both COs' histories | Permanent (nulled links leave no trace) | Match by explicit user mapping; log every remap; forbid qty-mismatched binds | M |
| F-08 | Failed PO submit "rollback" is a silent no-op → ghost headers | Reliability | High | `NewPurchaseOrder.jsx:453-458, 463-471` (unchecked deletes); no DELETE policy on purchase_orders in `sql/` (procurement_setup.sql:293-307, patch_v2:291-297) | Ghost POs with zero/partial lines consume temp numbers, appear in lists/KPIs | purchase_orders, dashboards | Until someone opens the ghost | Server-side transactional create RPC | S/M |
| F-09 | Draft/pending POs count as full coverage | Business logic | High | `coverage.js:30-38` (`neq('cancelled')` only) | An abandoned draft suppresses a real requirement from queue and picker indefinitely | procurement queue | Until someone questions a missing order | Count only approved+ statuses (business decision needed for pending_approval) | S |
| F-10 | CO picker LIMIT 20 applied before coverage filter → uncovered COs unfindable | UX / Business logic | High | `NewPurchaseOrder.jsx:98-109` | Search returns "nothing" while an uncovered CO exists beyond the newest 20 matches | buyer workflow | Immediate but confusing | Filter server-side or raise limit + qty-aware RPC | S |
| F-11 | Approval burns sequence numbers; "PDF" is live-rendered HTML; stored artifact ≠ emailed artifact | Reliability | High | `PurchaseOrderDetail.jsx:649-667` (two-statement approve), `:923-933` | Two approvers can collide on a number; no immutable approved document exists anywhere | po numbering, audit | On incident | Number+update in one RPC; store the actual emailed PDF immutably | M |
| F-12 | Concurrent GRN drafts on one line → second confirm permanently stuck at `checking`, delivery fields already committed | Concurrency | High | `NewGRN.jsx:147-154` (client pending snapshot); `GRNDetail.jsx:271-275` (pre-RPC write); `procurement_patch_v2.sql:206-208` (raise); GRN header not locked (`:193`, no FOR UPDATE) | Unconfirmable GRN, partial write, manual SQL to clean | grn, po_items | Immediate error but unrecoverable in UI | Re-read pending server-side at confirm; allow GRN void/edit path | M |
| F-13 | Self-approval allowed; `demo` role can submit; approver check UI-only | Business logic | High | `PurchaseOrderDetail.jsx:1241` (role gate only), `:649` (no submitter≠approver check), page gate `:141` incl. demo | Requester approves own spend; approval means little | governance | Never detected structurally | DB check submitter≠approver (with small-team override policy) | S |
| F-14 | No automatic vendor communication for ANY event (cancel/edit/relink/date change/line removal) | Business logic | High | Lifecycle trace §6 table: `handleCancel :1041-1046`, `saveEdit :1159`, `relinkPO :307`, `saveDeliveryDates :990`, `removeLineForCancelledCO :274` — none email; single outbound path `:584` | Vendor produces to a superseded PO; closure requests never sent (rule 5) | vendor relationship, cash | Until vendor ships/invoices wrong | Vendor-event outbox (even if manual-send, queued+visible) | M |
| F-15 | Schema/migration governance: load-bearing columns & live function versions absent from repo | Data model | High | `po_items.order_item_id`, `po_pdf_url`, `ack_document_url`, `order_items.dispatched_qty` etc. — no DDL in `sql/` (schema trace §1.14); duplicated function definitions (confirm_grn ×2, cancel_order_lines ×2, next_grn_number overloads coexist) | Cannot know what production enforces; disaster recovery impossible from repo | everything | N/A (chronic) | Introspect DB → commit authoritative schema dump; single migration ledger | M |
| F-16 | Float pipeline into numeric columns; float qty inside `dispatched_items` JSONB re-read as numeric; epsilon risks in cancel comparison and coverage `>0` | Financial / Data model | High | `NewPurchaseOrder.jsx:294-295,308→427,443-447`; `OrderDetail.jsx:757` (float product into JSONB), `:929` (cancel qty); `posted_qty_model.sql:90`; DB itself all-numeric (schema trace §1.13) | Spurious "exceeds cancellable" raises; epsilon-positive lines re-enter queue; totals drift | money fields, queue | Sporadic, confusing | Integer/string-decimal discipline at boundaries; server-side computation of totals | M |
| F-17 | Cancelled-CO banner blind spots: line-only-linked single-CO POs show nothing; received/closed POs on cancelled COs invisible everywhere | Business logic | High | `PurchaseOrderDetail.jsx:166-181` (sourceCOStatus from header only); `ProcurementOrders.jsx:20` (orphan statuses exclude material_received/closed); `OrderDetail.jsx:982-998` (notify skips them) | Bought-and-received goods for dead orders vanish from all worklists (3 real cases found in prior live-data session) | finance exposure | **Months — no view exists** | Add received/closed×cancelled-CO section + valuation | S/M |
| F-18 | Notifications: no dead-letter/redrive; email fn always returns 200; DB trigger swallows exceptions; PO-cancel notifies nobody at all | Reliability | Med | `send-email-notification/index.ts:21-41,353-368`; `c3_service_key_to_vault_up.sql:60-68`; `PurchaseOrderDetail.jsx:1041-1046` | Lost alerts look delivered; PO cancellation is a silent event | alerting | Indefinite | email_log redrive job; notify on PO cancel | S/M |
| F-19 | Misc collection: PostgREST `.or()` interpolation (`NewPurchaseOrder.jsx:97`); posByCo route-1 unfiltered by is_test/status (`ProcurementOrders.jsx:116-120`) incl. test↔live coverage leak (`:117,126`); `grn_items` zero CHECKs (negative accepted_qty would decrement received via `patch_v2:210`); write-once `cancel_reason` (`cancel_order_lines_v2.sql:176`); non-transactional delivery-date loop (`PurchaseOrderDetail.jsx:995-1007`); `is_procurement_writer` lacks search_path pin (`patch_v2:260`); FY literal hardcoded in `next_po_number` (`patch_v2:145-157`); full-cancel audit row says "Partial cancellation" (`v2.sql:228-246`); RPC returns stale `header_status` (`:252`) | Various | Med | as cited | paper cuts, each exploitable or confusing in the wrong week | various | varies | batch as a hardening sprint | M |

---

## 4. SCENARIO RESULTS (31)

**A. Cancellation**
1. **Full cancel after PO placed, before GRN:** `cancel_order_lines` (SECURITY DEFINER, admin/management only — `v2.sql:61-63`) cancels lines/batches atomically with row locks; order → `cancelled`. PO: **untouched** — status, lines, qty all stay. Notification: broadcast to all ops/admin/management "relink PO … to a new CO" (`OrderDetail.jsx:987`). Vendor: **only an internal flag; never told** (F-14). Gap: PO holds a live vendor commitment for a dead order until a human acts on a scrollable bell.
2. **Qty 100→60:** partial cancel is supported *on the order side* (`cancelled_qty`, line stays `active` — `v2.sql:166-168`). **No 40-unit partial-orphan concept exists on the PO side**; no banner, no flag, and the broadcast wrongly says the CO was cancelled (F-05).
3. **Cancel after GRN, before dispatch:** RPC forbids header `cancelled` when anything posted; goes `closed`/`short_closed`. The material: **exists in no system bucket** (F-03) — not commingled, *absent*. The PO line can't be removed (received-guard, `PurchaseOrderDetail.jsx:276`) and the received/closed×cancelled class is invisible to every worklist (F-17).
4. **Cancel one CI line of a multi-line SO:** per-line cancel works; PO-side signal only if the *whole order* is cancelled (banners key on order status). Notification fires with the misleading "cancelled" text for the whole CO (F-05 variant).
5. **Cancel then reinstate:** impossible — no un-cancel path exists in UI or SQL (`v2.sql:69-71` blocks; grep confirms no status reversal). Practical path = raise a new CO → new PO; **nothing prevents the old PO and the new PO both being live at the same vendor** (duplicate-PO exposure).

**B. Group CO**
6. **3 grouped, 1 cancels:** the good path — multi-CO banner lists exactly the dead CO's lines with per-line "Remove line" (received-guard, role-guard, post-approval confirm) (`PurchaseOrderDetail.jsx:1357-1404, 274-289`). Group survives; other pegs preserved. Vendor: window.confirm *assumes* you phoned them; nothing sent (F-14). Total recalcs client-side (race risk noted).
7. **All 3 cancel:** banner switches to "all linked cancelled — cancel this PO" (`:1365-1371`). Notifications: one broadcast **per cancellation event** (3 events × all ops/admin/mgmt recipients). Orphan tab: lists each cancelled CO (line-level union, `ProcurementOrders.jsx:84-94,108-132`) — fires per CO, not per PO. Nothing auto-cancels the PO.
8. **Short GRN (80 of 100 across 3 customers):** allocation rule = **whichever PO lines the receiving user picks in a dropdown that shows no customer** (F-04). Not visible to the buyer. Default prefill = all lines at full pending → mis-peg by default.
9. **Over GRN:** hard-blocked at three layers — UI clamp (`NewGRN.jsx:195-205`), save check (`:315-319`), DB CHECK (`procurement_setup.sql:77`) + RPC raise (`patch_v2:206-208`). Tolerance = zero. Physical excess: nowhere to record it (F-03) — it simply doesn't exist on paper.
10. **Add/remove CO on a placed PO:** Remove: only via the cancelled-CO banner path (guarded), or via generic edit (destructive, F-01). Add: possible through edit "Add Row" — the new line gets **no `order_item_id` peg** (`:1185-1195` payload) → invisible to coverage forever. Vendor-facing PO: unchanged unless manually re-emailed.
11. **Same CO grouped twice concurrently:** both succeed. No unique constraint on `po_items.order_item_id` (repo SQL), coverage check is read-then-insert with no lock (flow trace §5) → line >100% covered, double vendor order. Last-write-wins doesn't even apply — **both writes persist**.
12. **Grouping delay / aging:** nothing exists — no aging, no SLA, no MOQ data, no release-below-MOQ override (grep-verified, flow trace §7). Promise date is visible only as the prefilled line delivery date; never compared or alerted.
13. **Cost allocation of grouped PO (price break, freight):** **absent entirely.** No landed-cost concept, no freight split, no margin feedback to the SO. Not pro-rata — nothing.

**C. Stock-close**
14. **Where does CI stock come from?** In the code's model: only the warehouse XLS (`Accounts.jsx:119-123,170`) — unvalidated codes, no CI filter, no distinct bucket, commingled by construction. GRN-received CI exists nowhere as stock. Orphan material has no bucket, no flag, no report.
15. **Two users, same stock unit:** no reservation object, no lock, no `SELECT FOR UPDATE`, no inventory read at all on the allocation path (F-03). Silent double-allocation is the designed behaviour, not an edge case.
16. **CO closed from stock — is the PO cancelled with the vendor?** No linkage in either direction. The close-only path (`NewPurchaseOrder.jsx:344-355`) writes two columns on `order_items` and navigates away — it doesn't look for related POs. If a PO already covered the line, it stays open, goods arrive, no stock record exists → **the self-feeding orphan loop is real and unmonitored.**
17. **Nominally-same SKU, different spec:** all reconciliation is by `item_code` string. The stock-close itself is per order-line (safe), but relink (F-07) and the GRN picker (F-04) both bind by item_code where two different custom builds share a code — the code cannot distinguish them.

**D. Orphans**
18. **"Orphan PO" is:** a computed condition — cancelled CO × PO status ∈ {approved…partially_received} (`ProcurementOrders.jsx:20,157`) — plus fire-and-forget notification rows. **No persisted status.**
19. **"No new orders for the same PO":** no such logic exists anywhere. Relink candidates = same **customer name string** (ILIKE), any status but cancelled (`PurchaseOrderDetail.jsx:170-178`) — two customers named identically collide; item/spec matching is absent, so both false-same and false-different are trivially constructible.
20. **Aging clock:** none. A human decides from memory; default if no one acts = the PO stays open forever (and `closed` is unreachable anyway).
21. **Re-pegging on new SO:** manual relink only; partially audited (3 activity rows) but the per-line remaps and nulled links are **not** logged (F-07).
22. **Orphan liability valued for finance:** nowhere. No dashboard, no export, no figure. (Prior live-data session found 3 received/closed-PO-on-cancelled-CO cases + 12 latent split-brain lines — none visible in any view.)

**E. Amendments**
23. **Qty increase after PO placed:** no amendment concept. Either destructive edit (F-01) or a second PO for the delta (picker remaining-qty is Map/qty-aware, so the delta path works); nothing guides the choice; grouped items behave the same.
24. **SO delivery-date change:** no propagation to PO, no divergence warning. (`order_items.dispatch_date` is read once at prefill, never re-compared.)
25. **Price change after approval:** allowed, silent, no re-approval; audit = "Purchase Order edited" with zero fields (F-01). The approval trail isn't overwritten — worse, it's **preserved and now vouches for numbers it never approved.**
26. **Vendor ack of different qty/date:** not representable. Ack = timestamp + optional opaque file (`PurchaseOrderDetail.jsx:949-967`); no confirmed-qty/confirmed-date columns; no comparison. Not SAP-style — the confirmation overwrites nothing because it stores nothing.

**F. Reliability**
27. **Notification send fails:** email path retries 5× only for 429/5xx, logs `email_log.status='failed'`, then returns HTTP 200 to the trigger; DB trigger swallows all exceptions; **no dead-letter, no redrive, no delivery confirmation** (`send-email-notification/index.ts:13-41,353-368`; `c3_service_key_to_vault_up.sql:60-68`). In-app rows: inserted or console-error'd.
28. **Idempotency:** sample cron deduped (20h window); orphan broadcasts are per-event (re-fire only if the event re-occurs — RPC blocks re-cancel); **vendor emails have no dedupe** — a human can re-send indefinitely; no idempotency key on `send-po-to-vendor`.
29. **Double-submit:** client-side `useRef` guard only (`NewPurchaseOrder.jsx:338`), never reset on success; two tabs = two POs with different temp numbers, both valid — **duplicate POs can reach the vendor**; identical-temp-number collisions fail loudly on the unique constraint instead (`:393-407`; `procurement_setup.sql:41`).
30. **GRN reversal after close/dispatch:** no reversal exists (deliberate — `GRNDetail.jsx:169-176`); the only "workaround" is the destructive PO edit which resets receipts (F-01). Dispatch is unaffected because dispatch never consumed stock in the first place.
31. **Forecast × CI:** CI excluded from forecast items **except** `type IS NULL` (`ProcurementForecast.jsx:742`); ForecastPOModal accepts any item incl. CI (`ForecastPOModal.jsx:69-75`); nothing auto-creates POs (human-driven throughout). CI stock rows in `inventory` are ignored unless the item is NULL-typed (then they suppress reordering). **Forecast POs carry no order/line pegs at all** (`ForecastPOModal.jsx:124-160`) — their receipts land in the no-stock void (F-03).

---

## 5. SAP-GRADE GAP ANALYSIS

| Capability | Status | Evidence / consequence |
|---|---|---|
| Document-chain traceability | **Partial** | Forward pegs exist (order_item_id; grn_items.po_item_id; purchase_invoices.grn_id/po_id) but no chain view; invoice `po_id` falls back to "first GRN item's PO" — arbitrary on multi-PO GRNs (`GRNDetail.jsx:285-293`); forecast POs unpegged. You cannot answer "show me everything for CO-X" from any single screen. |
| Hard pegging (MTO) | **Partial** | Peg is real at PO-line level, but material is not just fungible on arrival — it's *nonexistent* (no stock record); pegs are silently mutable (relink F-07) and destructible (edit F-01). |
| Commitment accounting | **Absent** | Open-PO value appears only as a page KPI; no finance surface, no per-customer exposure, no period cut. Exposure appears at GRN → invoice, late. |
| Three-way match | **Absent in substance** | Mandatory free-text note is the entire control (`PurchaseInvoiceDetail.jsx:347-359`); zero amount/qty comparison, zero tolerance logic. |
| Vendor confirmation as object | **Absent** | Timestamp + optional file; no confirmed qty/date/price fields (lifecycle §3). Reliability measurement impossible. |
| Immutable audit trail | **Absent where it matters** | Status changes logged without from-state; PO edits logged as one wordless row; line rewrites change row ids; qty/price diffs unrecoverable (F-01). |
| Approval integrity | **Absent** | Self-approval unchecked (F-13); post-approval edit without re-approval (F-01); approver gate UI-only (F-06). |
| Tolerances & UoM | **Absent** | Over-receipt hard-blocked at 0% (a policy, not a tolerance); no under-delivery closure logic; no UoM concept; fractional qty allowed everywhere. |
| Cancellation liability | **Absent** | No WIP/charge concept for CI already in production; the only nod is a confirm-dialog sentence (`PurchaseOrderDetail.jsx:279`). |
| Reason codes | **Partial** | Orders: initiator type + free-text reason; hold reasons ARE whitelisted (`waiting_for_clearance.sql:25-39`) — proof the pattern exists; PO cancel/date changes: free text; nothing analyzable across the board. |
| Period/date integrity | **Partial** | Client-clock dates throughout; FY suffix literal `'26-27'` hardcoded inside `next_po_number` (`patch_v2:145-157`) — **numbering breaks silently next FY**; date sanity CHECKs are NOT VALID (unvalidated backlog). |
| Numeric integrity | **Partial** | DB layer: fully `numeric`, zero float columns (verified). Client layer: float everywhere before persistence; float inside `dispatched_items` JSONB round-trips into posted/forecast math (F-16). |

---

## 6. BLAST RADIUS & PRIORITY

Ranking by **silence × financial exposure × frequency** (volume basis: ~150-200 CO lines/month, 8 active procurement users):

| Rank | Finding | Silence | Financial mechanism | Freq/mo (est.) | Recovery |
|---|---|---|---|---|---|
| 1 | **F-05 partial-cancel void** | until vendor delivers (4-8 wks) | unowned surplus custom inventory + cash out | 2-5 (partial changes are routine per the 2-hr SLA culture) | SQL-only reconciliation once goods land |
| 2 | **F-01 edit-after-approval** | **unbounded** (no diff exists) | wrong money to vendor under valid approval; receipts reset | 1-3 edits/mo post-approval (SLA culture makes it normal) | unrecoverable (state overwritten) |
| 3 | **F-02+F-03 stock-close truth** | weeks (already surfaced via users) | duplicate procurement of stocked items; phantom availability promised to customers | 5-10 closes/mo | UI-fixable after F-02; F-03 needs model |
| 4 | F-04 GRN mis-peg | until customer escalates | wrong customer served; expedite costs | 1-2 short shipments/mo | SQL re-peg |
| 5 | F-06 authz | until incident | unlimited, insider-shaped | rare but total | forensic only |
| 6 | F-17 invisible received-for-dead-orders | **months** (3 real cases already) | written-off custom stock | ~0.5 | manual investigation |
| 7 | F-11/F-08/F-12 concurrency family | days-weeks | numbering/ghost/stuck docs | 1-2 | SQL cleanup |

### The three fixes that matter, in dependency order
1. **Make the PO trustworthy at the database** (F-06 + F-01 + F-13): transition trigger, post-approval line-lock with an explicit amendment path that forces re-approval and writes a field diff, submitter≠approver check. *Everything else assumes PO numbers mean something; today they don't.*
2. **Make coverage arithmetic tell the truth end-to-end** (F-02 + F-05 + F-09 + OrderDetail Set→Map): one quantity-precise coverage source consumed identically by picker, prefill, queue, dashboard and order page; partial-cancel writes a PO-line flag + correct notification. *This kills the double-order/under-order class.*
3. **Give received material an identity** (F-04 + F-03 phase-1 + F-17): customer-labelled GRN allocation, a "received-for-cancelled/closed" worklist with values, and a stock-existence check at stock-close. *Full inventory/reservation model can follow; these three steps stop the bleeding first.*

Payroll-grade trust for this module requires, at minimum: #1 complete, #2 complete, the F-15 schema reconciliation committed to the repo, and an immutable approved-document artifact (F-11).

---

## 7. DELIBERATE NON-ISSUES (do not re-raise)

- **No GRN reversal** — acceptable at volume; pre-confirm editing exists and reversal-by-RPC is a known deliberate deferral (`GRNDetail.jsx:169-173`).
- **Manual vendor emailing** as the *sending* mechanism — acceptable for this team size *provided* F-14's event queue makes pending communications visible; the humans are fast, the system just never tells them.
- **Client-side pagination/loading of FY-scale lists** on procurement pages — fine at current volumes given fetchAll discipline.
- **Zero over-receipt tolerance** — stricter than SAP defaults but coherent for CI-heavy purchasing.
- **`create_order_dispatch` batch_no race** — real but per-order serialized in practice at this volume.
- **Advisory-lock scope on next_grn/po_number** (lock released before client insert) — collisions land on UNIQUE constraints with visible errors, not corruption.
- **pg_cron minimal footprint** (2 jobs, pure SQL) — deliberately conservative after the 2026-04-21 incident; correct call.

---

## 8. UNVERIFIED (needs DB introspection or wider reads — none performed in this run)

1. Live schema vs repo: which of the duplicated function versions is installed (`confirm_grn`, `cancel_order_lines`, `next_po_number`, `next_grn_number`, `validate_dispatch_status_change`); whether permissive legacy policies were actually dropped; the real constraint set on `po_items.order_item_id` (FK was live-verified 2026-06-22 in-session; uniqueness never was), `inventory (product_code,location)` uniqueness.
2. Base column types for `orders`, `order_items` (`qty`, `dispatched_qty`, prices), `notifications`, `inventory`, `order_dispatches` — no CREATE TABLE in repo; numeric-vs-float undecidable from source.
3. `increment_dispatched_qty` and `confirm_dispatch_dc` bodies — absent from `sql/`; their locking is asserted only in comments.
4. Writers of `grn.status='invoice_matched'/'inward_posted'` — none found in `src/` or `sql/`; `PurchaseInvoiceDetail.jsx` was grepped, not fully read.
5. Whether the CRM convert-to-order flow auto-upgrades SO→CO on CI items (rule 2).
6. Exploitability of the `.or()` interpolation (`NewPurchaseOrder.jsx:97`) beyond result-set widening within the or-group.
7. `po_comments` mutability (RLS) — whether "audit" rows can be edited/deleted by users.
8. Deployed build vs `src/` (dist/ not inspected).

*Prior live-data figures referenced (1 live ghost line, 12 latent split-brain lines, 3 received-for-cancelled cases, 7 orphan COs exactly matching the tab) were measured earlier on 2026-08-03 in this working session, before the no-DB instruction; they are labeled as such wherever used.*
