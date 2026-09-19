-- ═══════════════════════════════════════════════════════════════════════════
-- THREE-WAY MATCH — RPC API (Phase 1)
--
-- Run sql/three_way_match_up.sql first.
--
-- EVERY RULE LIVES HERE, NOT IN REACT. The UI may hide, disable, prefill and
-- explain, but it is never the thing standing between a user and a bad write:
-- PostgREST goes straight past React. Audit findings P1 (PO creator approves own
-- PO) and F-06 exist precisely because those gates were only in a page.
--
-- THE SPLIT THAT IS THE CONTROL:
--   Quantity is decided at the GRN.  Price is decided at Inward Billing.
--   matched_qty and po_unit_price are inherited READ-ONLY — a caller cannot
--   supply either. If accounts could reshape the accepted quantity, the GRN
--   decision would mean nothing and a bill could be quietly bent to match
--   whatever the vendor sent.
--
-- MATCHER != RELEASER (SAP's MIRO / MRBR split). pi_record_match() computes and
-- advances a CLEAN bill. It never clears its own variance. Releasing an
-- out-of-tolerance bill is a second call, by a second person, with a reason.
--
-- PHASE 1 IS LOG MODE: an out-of-tolerance bill still advances, and the log
-- records would_block = true. Nothing is blocked until mode = 'enforce', and
-- even then enforce_from protects everything already in flight.
--
-- ⛔ Nothing in this file deletes data. The only DELETE-shaped statement is the
--    re-seed of a DRAFT bill's own lines inside pi_record_match, which rewrites
--    rows this same call is authoring, on a bill that has not yet advanced.
--
-- VAPT, every rule applied: SECURITY DEFINER + pinned search_path, role read
-- from profiles via auth.uid() (NEVER trusted from the client), and an explicit
-- revoke from anon/public on every function — `alter default privileges` rots
-- via pg_default_acl, so a one-time revoke elsewhere does not cover these.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Helper: who is calling, resolved server-side ───────────────────────────
create or replace function public.tw_actor()
returns table (uid uuid, name text, role text)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.name, p.role from public.profiles p where p.id = auth.uid()
$$;


-- ── 1. The match basis: quantities and PO prices for one GRN ───────────────
-- Reached through grn_items.po_item_id, NEVER through purchase_invoices.po_id.
-- That column is 'the first GRN line's PO' and is arbitrary on a multi-PO GRN
-- (grn.po_id is NULL on 1,451 of 1,452 GRNs). Walking the line peg makes the
-- problem irrelevant and prices each line against its OWN PO.
create or replace function public.pi_match_basis(p_grn_id uuid)
returns table (
  grn_item_id      uuid,
  po_item_id       uuid,
  po_id            uuid,
  item_code        text,
  description      text,
  ordered_qty      numeric,
  received_qty     numeric,
  accepted_qty     numeric,
  rejected_qty     numeric,
  po_unit_price    numeric,
  has_basis        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- ⚠️ MANDATORY. This returns PURCHASE PRICING. A SECURITY DEFINER function
  -- handing PO prices to any authenticated caller is exactly the leak class
  -- closed in sql/definer_view_leaks.sql. Sales must never reach it, and FC
  -- staff get the quantity-only picker instead.
  if not public.is_procurement_writer() then
    raise exception 'Not authorised to read purchase pricing.' using errcode = '42501';
  end if;

  return query
  select gi.id,
         gi.po_item_id,
         coalesce(pit.po_id, gi.po_id),
         gi.item_code,
         gi.description,
         coalesce(gi.ordered_qty, gi.expected_qty, 0),
         coalesce(gi.received_qty, 0),
         coalesce(gi.accepted_qty, gi.received_qty, 0),   -- you do not owe money
         coalesce(gi.rejected_qty, 0),                    -- for rejected goods
         case when gi.po_item_id is null then null
              else nullif(public.po_item_unit_price(gi.po_item_id), 0) end,
         gi.po_item_id is not null
           and coalesce(public.po_item_unit_price(gi.po_item_id), 0) > 0
    from public.grn_items gi
    left join public.po_items pit on pit.id = gi.po_item_id
   where gi.grn_id = p_grn_id
   order by gi.id;   -- grn_items has NO sr_no column; ordering by it 500s.
end $$;


-- ── 2. Last price actually paid for an item (the prevention) ───────────────
-- Feeds the New PO screen. 92 of 5,268 PO lines were priced from the book, 551
-- by hand — PCO0816's 26% was typed, with no price_record_id, no
-- list_price_at_entry and no price_resolved_at to show any lookup happened.
-- Showing "last paid 107.64" before the buyer types is the cheapest prevention
-- available, and is SAP's purchasing-info-record "last price" behaviour.
create or replace function public.pi_last_paid(p_item_code text)
returns table (
  inv_unit_price numeric,
  paid_on        date,
  grn_number     text,
  vendor_name    text,
  invoice_number text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_procurement_writer() then
    raise exception 'Not authorised to read purchase pricing.' using errcode = '42501';
  end if;

  return query
  select pii.inv_unit_price,
         coalesce(pin.invoice_date, pin.created_at::date),
         g.grn_number,
         pin.vendor_name,
         pin.invoice_number
    from public.purchase_invoice_items pii
    join public.purchase_invoices pin on pin.id = pii.invoice_id
    left join public.grn g on g.id = pin.grn_id
   where pii.item_code = p_item_code
     and pii.inv_unit_price is not null
     and coalesce(pin.is_test, false) = false
     and pin.status <> 'cancelled'
   order by coalesce(pin.invoice_date, pin.created_at::date) desc, pii.created_at desc
   limit 1;
end $$;


-- ── 3. Record the match ────────────────────────────────────────────────────
-- p_lines: [{"grn_item_id":"…","billed_qty":110,"inv_unit_price":107.64,
--            "price_decision":"po_correct"}, …]
-- price_decision is required on any line whose rate disagrees, because the
-- answer differs line by line: on one invoice three items can be our pricing
-- error and two can be the vendor overcharging.
-- The caller supplies ONLY billed_qty and inv_unit_price. matched_qty and
-- po_unit_price are read from the GRN and the PO here, server-side.
create or replace function public.pi_record_match(
  p_invoice_id               uuid,
  p_invoice_number           text,
  p_invoice_date             date,
  p_taxable                  numeric,
  p_gst                      numeric      default 0,
  p_freight                  numeric      default 0,
  p_lines                    jsonb        default '[]'::jsonb,
  p_notes                    text         default null,
  p_duplicate_ack_invoice_id uuid         default null,
  p_duplicate_ack_reason     text         default null,
  -- Which price is correct, when they differ. 'invoice_correct' = our PO was
  -- raised wrong, their rate is our real cost, nobody owes anybody.
  -- 'po_correct'      = they overcharged; pay the PO rate and recover the rest.
  -- Same numbers, opposite consequences — so the caller must say which.
  p_price_decision           text         default null,
  p_price_decision_note      text         default null,
  -- The GST split. Intra-state bills fill cgst+sgst, inter-state fills igst;
  -- p_gst stays the total and is what everything downstream already reads.
  p_cgst                     numeric      default 0,
  p_sgst                     numeric      default 0,
  p_igst                     numeric      default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv        record;
  v_cfg        record;
  v_actor      record;
  v_dup        record;
  v_line       record;
  v_expected   numeric := 0;
  v_billed     numeric := 0;
  v_rate_var   numeric := 0;
  v_qty_var    numeric := 0;
  v_worst      numeric := 0;
  v_no_basis   int     := 0;
  v_lines      int     := 0;
  v_over       int     := 0;
  v_within     int     := 0;
  v_undecided    text;
  v_recover_rate numeric := 0;
  v_recover_qty  numeric := 0;
  v_n_po_right   int     := 0;
  v_n_inv_right  int     := 0;
  v_status     text;
  v_enforcing  boolean;
  v_block      boolean;
  v_soft       jsonb   := '[]'::jsonb;
begin
  select * into v_actor from public.tw_actor();
  if v_actor.uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if not public.is_procurement_writer() then
    raise exception 'Only accounts, ops, management or admin can match a vendor bill.'
      using errcode = '42501';
  end if;

  select * into v_cfg from public.three_way_tolerance where id = 1;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv is null then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  -- Idempotent: already past this stage, hand back what is on record.
  if v_inv.status in ('invoice_pending','inward_complete') and v_inv.match_status is not null then
    return jsonb_build_object('already_matched', true, 'match_status', v_inv.match_status,
                              'variance_amount', v_inv.match_variance_amount);
  end if;
  if v_inv.status not in ('three_way_check','invoice_pending') then
    raise exception 'A bill in status % cannot be matched.', v_inv.status using errcode = '23514';
  end if;
  if v_inv.grn_id is null then
    raise exception 'This bill has no GRN, so there is nothing to match it against.'
      using errcode = '23514';
  end if;
  if coalesce(btrim(p_invoice_number), '') = '' then
    raise exception 'Enter the vendor invoice number.' using errcode = '23514';
  end if;

  -- ── Duplicate vendor invoice ────────────────────────────────────────────
  -- HARD signal: same vendor, same normalised number, live sibling. Refused
  -- unless explicitly acknowledged as a consolidated invoice — which is a real
  -- and common case here (19 numbers span 40 GRNs), so it must be recordable,
  -- but only as a deliberate, named, payment-blocked act.
  select id, invoice_number, invoice_date, invoice_amount, grn_id
    into v_dup
    from public.purchase_invoices
   where vendor_id = v_inv.vendor_id
     and id <> p_invoice_id
     and status <> 'cancelled'
     and invoice_number is not null
     and lower(btrim(invoice_number)) = lower(btrim(p_invoice_number))
   limit 1;

  if v_dup.id is not null and coalesce(p_duplicate_ack_invoice_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_dup.id then
    insert into public.three_way_match_log (invoice_id, grn_id, invoice_number, vendor_id,
      vendor_name, event, duplicate_of, actor_id, actor_name, actor_role, would_block)
    values (p_invoice_id, v_inv.grn_id, p_invoice_number, v_inv.vendor_id,
      v_inv.vendor_name, 'duplicate_suspect', v_dup.id, v_actor.uid, v_actor.name, v_actor.role, true);

    raise exception
      'Vendor invoice "%" from % is already booked on another bill (dated %, %). If this one invoice genuinely covers both receipts, acknowledge it as a consolidated invoice; if it is a re-entry, cancel this bill instead.',
      p_invoice_number, v_inv.vendor_name, to_char(v_dup.invoice_date, 'DD.MM.YYYY'),
      to_char(coalesce(v_dup.invoice_amount, 0), 'FM999,999,999.00')
      using errcode = '23505';
  end if;

  -- SOFT signal: same vendor, same amount, within 7 days, different number.
  -- Informational only — a vendor billing the same monthly amount would make
  -- this unusable as a gate.
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'invoice_number', invoice_number,
                                               'invoice_date', invoice_date)), '[]'::jsonb)
    into v_soft
    from public.purchase_invoices
   where vendor_id = v_inv.vendor_id and id <> p_invoice_id and status <> 'cancelled'
     and invoice_amount is not null and p_taxable is not null
     and abs(coalesce(invoice_amount, 0) - p_taxable) < 0.01
     and invoice_date between p_invoice_date - 7 and p_invoice_date + 7
     and lower(btrim(coalesce(invoice_number,''))) <> lower(btrim(p_invoice_number));

  -- ── Seed / refresh the lines ────────────────────────────────────────────
  -- Rewrites the lines this same call is authoring, on a bill that has not yet
  -- advanced. No historical data is touched.
  delete from public.purchase_invoice_items where invoice_id = p_invoice_id;

  insert into public.purchase_invoice_items (
    invoice_id, grn_item_id, po_item_id, po_id, item_code, description,
    matched_qty, po_unit_price, billed_qty, inv_unit_price, price_decision)
  select p_invoice_id, b.grn_item_id, b.po_item_id, b.po_id, b.item_code, b.description,
         b.accepted_qty,                    -- READ-ONLY from the GRN
         b.po_unit_price,                   -- READ-ONLY from the PO
         coalesce((l->>'billed_qty')::numeric, b.accepted_qty),
         (l->>'inv_unit_price')::numeric,
         nullif(l->>'price_decision','')
    from public.pi_match_basis(v_inv.grn_id) b
    left join jsonb_array_elements(p_lines) l
           on (l->>'grn_item_id')::uuid = b.grn_item_id;

  -- ── Verdict, per line ───────────────────────────────────────────────────
  for v_line in
    select pii.id, pii.matched_qty, pii.billed_qty, pii.po_unit_price, pii.inv_unit_price
      from public.purchase_invoice_items pii where pii.invoice_id = p_invoice_id
  loop
    v_lines := v_lines + 1;

    if v_line.po_unit_price is null or v_line.po_unit_price = 0
       or v_line.inv_unit_price is null then
      v_no_basis := v_no_basis + 1;
      update public.purchase_invoice_items set line_status = 'no_basis' where id = v_line.id;
      continue;
    end if;

    -- Exact decomposition: billed - expected = rate variance + qty variance.
    v_expected := v_expected + v_line.matched_qty * v_line.po_unit_price;
    v_billed   := v_billed   + coalesce(v_line.billed_qty, v_line.matched_qty) * v_line.inv_unit_price;
    v_rate_var := v_rate_var + v_line.matched_qty * (v_line.inv_unit_price - v_line.po_unit_price);
    v_qty_var  := v_qty_var
                + (coalesce(v_line.billed_qty, v_line.matched_qty) - v_line.matched_qty)
                  * v_line.inv_unit_price;

    declare
      v_diff numeric := v_line.inv_unit_price - v_line.po_unit_price;
      v_band numeric;
      v_ls   text;
    begin
      if abs(v_diff) <= v_cfg.rate_tol_abs_ignore then
        v_ls := 'matched';                       -- SAP BD: small difference, ignored
      else
        v_band := greatest(v_cfg.rate_tol_abs,
                    v_line.po_unit_price
                    * (case when v_diff > 0 then v_cfg.rate_tol_pct_over
                            else v_cfg.rate_tol_pct_under end) / 100.0);
        v_ls := case when abs(v_diff) <= v_band then 'within_tolerance' else 'over_tolerance' end;
        v_worst := greatest(v_worst, abs(100.0 * v_diff / v_line.po_unit_price));
      end if;

      -- A quantity billed above what was accepted is a variance in its own
      -- right, whatever the rate — this is the over-delivery-refused case.
      if coalesce(v_line.billed_qty, v_line.matched_qty) > v_line.matched_qty
           * (1 + coalesce(v_cfg.qty_tol_pct, 0) / 100.0) then
        v_ls := 'over_tolerance';
      end if;

      if v_ls = 'over_tolerance' then v_over := v_over + 1; end if;
      update public.purchase_invoice_items set line_status = v_ls where id = v_line.id;
    end;
  end loop;

  -- ── Roll up ─────────────────────────────────────────────────────────────
  -- Derived from the LINE verdicts, not re-derived from the totals. Those two
  -- disagree: a 5-paise-per-unit difference is 'matched' on the line (inside the
  -- ignore band) but shows as a 5-rupee difference on a 100-unit bill, and
  -- re-deriving from the total would contradict the line and re-introduce
  -- exactly the rounding noise the ignore band exists to suppress.
  select count(*) filter (where line_status = 'within_tolerance')
    into v_within
    from public.purchase_invoice_items where invoice_id = p_invoice_id;

  v_status := case
    when v_lines = 0 or v_no_basis = v_lines then 'no_basis'
    when v_over > 0                          then 'over_tolerance'
    when v_no_basis > 0                      then 'partial_basis'
    when v_within > 0                        then 'within_tolerance'
    else                                          'matched' end;

  -- A difference nobody has adjudicated is the old failure in a new coat: a flag
  -- on screen that means nothing. EVERY line whose rate disagrees needs its own
  -- answer — one per bill would be untrue on a mixed invoice.
  select string_agg(item_code, ', ' order by item_code) into v_undecided
    from public.purchase_invoice_items
   where invoice_id = p_invoice_id
     and line_status = 'over_tolerance'
     and po_unit_price is not null and inv_unit_price is not null
     and abs(inv_unit_price - po_unit_price) > 0.01
     and coalesce(price_decision,'') not in ('invoice_correct','po_correct');

  if v_undecided is not null then
    raise exception 'Say which price is right for %. One answer means our PO was raised wrong, the other means they have overcharged us — and they lead to opposite actions.', v_undecided
      using errcode = '23514';
  end if;

  -- A decision with no stated reason is an unexplained write-off, or an
  -- unexplained claim against a vendor. Whoever reads this in six months — or
  -- the vendor arguing the debit note — needs to know why.
  if exists (select 1 from public.purchase_invoice_items
              where invoice_id = p_invoice_id and price_decision is not null)
     and length(btrim(coalesce(p_price_decision_note, ''))) < 10 then
    raise exception 'Say in a sentence how you know which price is right — it goes on the record and, if we are claiming money back, it is what the vendor will be shown.'
      using errcode = '23514';
  end if;

  -- The debit note is the sum of ONLY the lines where our PO was right, plus
  -- every quantity billed above what was accepted (never ours to pay, whatever
  -- the rate). A line where their price is right owes nothing.
  select coalesce(sum(
           case when price_decision = 'po_correct'
                then greatest((inv_unit_price - po_unit_price) * matched_qty, 0) else 0 end
         ), 0),
         coalesce(sum(greatest((coalesce(billed_qty, matched_qty) - matched_qty)
                               * coalesce(inv_unit_price, 0), 0)), 0),
         count(*) filter (where price_decision = 'po_correct'),
         count(*) filter (where price_decision = 'invoice_correct')
    into v_recover_rate, v_recover_qty, v_n_po_right, v_n_inv_right
    from public.purchase_invoice_items
   where invoice_id = p_invoice_id and po_unit_price is not null;

  -- Is this bill actually subject to enforcement? Log mode and any bill older
  -- than enforce_from are recorded but never refused.
  v_enforcing := v_cfg.mode = 'enforce'
                 and (v_cfg.enforce_from is null or v_inv.created_at >= v_cfg.enforce_from);
  v_block := v_status in ('over_tolerance','no_basis','partial_basis');

  update public.purchase_invoices set
    invoice_number          = btrim(p_invoice_number),
    invoice_date            = p_invoice_date,
    taxable_amount          = p_taxable,
    -- The split is the detail; the total is what the rest of the app reads. If a
    -- caller sends a split, the total is derived from it so the two cannot drift.
    cgst_amount             = coalesce(p_cgst, 0),
    sgst_amount             = coalesce(p_sgst, 0),
    igst_amount             = coalesce(p_igst, 0),
    gst_amount              = case
                                when coalesce(p_cgst,0) + coalesce(p_sgst,0) + coalesce(p_igst,0) > 0
                                then coalesce(p_cgst,0) + coalesce(p_sgst,0) + coalesce(p_igst,0)
                                else coalesce(p_gst, 0) end,
    freight_amount          = coalesce(p_freight, 0),
    -- Freight charged BY THE SUPPLIER is part of the taxable value on a GST
    -- invoice — tax applies to it — so p_taxable already contains it and adding
    -- it again here double-counted it. p_freight records how much of the taxable
    -- value is NOT goods, so the match can compare goods against goods.
    total_amount            = coalesce(p_taxable,0)
                              + greatest(coalesce(p_cgst,0) + coalesce(p_sgst,0) + coalesce(p_igst,0),
                                         coalesce(p_gst,0)),
    match_status            = v_status,
    match_expected_taxable  = v_expected,
    match_billed_taxable    = v_billed,
    match_variance_amount   = v_billed - v_expected,
    match_worst_line_pct    = v_worst,
    match_qty_variance_amt  = v_qty_var,
    match_no_basis_lines    = v_no_basis,
    match_lines             = v_lines,
    match_tol_pct           = v_cfg.rate_tol_pct_over,
    match_tol_abs           = v_cfg.rate_tol_abs,
    match_computed_at       = now(),
    match_computed_by       = v_actor.name,
    match_computed_by_id    = v_actor.uid,
    three_way_notes         = coalesce(nullif(btrim(coalesce(p_notes,'')), ''), three_way_notes),
    three_way_checked_at    = now(),
    three_way_checked_by    = v_actor.name,
    duplicate_of_invoice_id = coalesce(p_duplicate_ack_invoice_id, duplicate_of_invoice_id),
    duplicate_ack_reason    = coalesce(nullif(btrim(coalesce(p_duplicate_ack_reason,'')),''), duplicate_ack_reason),
    price_decision          = case when v_n_po_right > 0 and v_n_inv_right > 0 then 'mixed'
                                   when v_n_po_right  > 0 then 'po_correct'
                                   when v_n_inv_right > 0 then 'invoice_correct' end,
    price_decision_note     = nullif(btrim(coalesce(p_price_decision_note,'')),''),
    payment_block           = payment_block or (p_duplicate_ack_invoice_id is not null),
    -- A clean bill advances. A flagged one waits for a SECOND person to release
    -- it (pi_override_match) — the matcher never clears their own variance.
    -- In log mode it advances regardless, so nothing is blocked today.
    status                  = case when v_block and v_enforcing then 'three_way_check'
                                   else 'invoice_pending' end,
    updated_at              = now()
  where id = p_invoice_id;

  -- "Our PO is right" means they billed us more than we agreed, so the
  -- difference is recoverable. Flag it for the debit note rather than leaving it
  -- as a number nobody acts on. The quantity difference is always recoverable —
  -- we never accepted those goods.
  if v_block and (v_recover_rate + v_recover_qty) > 0.01 then
    update public.purchase_invoices set
      debit_note_required    = true,
      debit_note_amount      = round(v_recover_rate + v_recover_qty, 2),
      -- Kept apart so the Tally note can state its ground. They are recovered
      -- for different reasons and a vendor will dispute them differently.
      debit_note_rate_amount = round(v_recover_rate, 2),
      debit_note_qty_amount  = round(v_recover_qty, 2),
      -- Money is owed back, so the bill must not be paid in full. Setting the
      -- amounts without the block left a claim recorded and a payment free to
      -- go out anyway, which is the whole thing this is meant to stop.
      payment_block          = true
    where id = p_invoice_id and debit_note_uploaded_at is null;
  end if;

  insert into public.three_way_match_log (invoice_id, grn_id, invoice_number, vendor_id,
    vendor_name, event, match_status, expected_taxable, billed_taxable, variance_amount,
    worst_line_pct, qty_variance_amt, no_basis_lines, duplicate_of, reason_code, reason,
    actor_id, actor_name, actor_role, would_block)
  values (p_invoice_id, v_inv.grn_id, btrim(p_invoice_number), v_inv.vendor_id,
    v_inv.vendor_name, 'match', v_status, v_expected, v_billed, v_billed - v_expected,
    v_worst, v_qty_var, v_no_basis, p_duplicate_ack_invoice_id,
    nullif(btrim(coalesce(p_price_decision,'')),''),
    nullif(btrim(coalesce(p_price_decision_note,'')),''),
    v_actor.uid, v_actor.name, v_actor.role, v_block);

  return jsonb_build_object(
    'match_status',      v_status,
    'expected_taxable',  v_expected,
    'billed_taxable',    v_billed,
    'variance_amount',   v_billed - v_expected,
    'rate_variance',     v_rate_var,
    'qty_variance',      v_qty_var,
    'worst_line_pct',    v_worst,
    'no_basis_lines',    v_no_basis,
    'lines',             v_lines,
    'needs_override',    v_block,
    'enforcing',         v_enforcing,
    'advanced',          not (v_block and v_enforcing),
    'to_recover',        round(v_recover_rate + v_recover_qty, 2),
    'lines_po_right',    v_n_po_right,
    'lines_invoice_right', v_n_inv_right,
    'possible_duplicates', v_soft
  );
end $$;


-- ── 4. Release a flagged bill — a SECOND person, with a reason ─────────────
-- SAP's MRBR. The document proceeds; the PAYMENT carries the block.
create or replace function public.pi_override_match(
  p_invoice_id  uuid,
  p_reason_code text,
  p_reason      text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_inv   record;
  v_cfg   record;
  v_actor record;
begin
  select * into v_actor from public.tw_actor();
  if v_actor.uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  select * into v_cfg from public.three_way_tolerance where id = 1;

  if not (v_actor.role = any (v_cfg.override_roles)) then
    raise exception 'Only % can release a bill that is outside tolerance. Accounts cannot clear a variance.',
      array_to_string(v_cfg.override_roles, ' or ') using errcode = '42501';
  end if;
  if not (p_reason_code = any (v_cfg.override_reason_codes)) then
    raise exception 'Pick a reason code from: %.', array_to_string(v_cfg.override_reason_codes, ', ')
      using errcode = '23514';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'Say in a sentence why this bill is being released — it goes on the record.'
      using errcode = '23514';
  end if;

  select * into v_inv from public.purchase_invoices where id = p_invoice_id for update;
  if v_inv is null then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  if v_inv.match_status is null then
    raise exception 'This bill has not been matched yet, so there is nothing to release.'
      using errcode = '23514';
  end if;
  if v_inv.override_at is not null then
    return jsonb_build_object('already_overridden', true, 'override_by', v_inv.override_by);
  end if;

  -- MATCHER != RELEASER. Being an admin is not enough to clear your own work.
  if v_inv.match_computed_by_id is not null and v_inv.match_computed_by_id = v_actor.uid then
    raise exception 'You matched this bill, so you cannot also release it. Ask someone else with admin or management access.'
      using errcode = '42501';
  end if;

  update public.purchase_invoices set
    match_status         = 'overridden',
    override_reason_code = p_reason_code,
    override_reason      = btrim(p_reason),
    override_by          = v_actor.name,
    override_by_id       = v_actor.uid,
    override_at          = now(),
    payment_block        = true,
    status               = case when status = 'three_way_check' then 'invoice_pending' else status end,
    updated_at           = now()
  where id = p_invoice_id;

  insert into public.three_way_match_log (invoice_id, grn_id, invoice_number, vendor_id,
    vendor_name, event, match_status, expected_taxable, billed_taxable, variance_amount,
    reason_code, reason, actor_id, actor_name, actor_role, would_block)
  values (p_invoice_id, v_inv.grn_id, v_inv.invoice_number, v_inv.vendor_id, v_inv.vendor_name,
    'override', 'overridden', v_inv.match_expected_taxable, v_inv.match_billed_taxable,
    v_inv.match_variance_amount, p_reason_code, btrim(p_reason),
    v_actor.uid, v_actor.name, v_actor.role, false);

  return jsonb_build_object('match_status','overridden','payment_block',true);
end $$;


-- ── 5. Grants — explicit, per VAPT ─────────────────────────────────────────
-- `alter default privileges … revoke execute … from anon, public` was applied
-- 2026-09-04, but pg_default_acl re-grants on every NEW function and that
-- revoke has already rotted once. Never rely on it.
revoke all on function public.tw_actor()                    from public, anon;
revoke all on function public.pi_match_basis(uuid)          from public, anon;
revoke all on function public.pi_last_paid(text)            from public, anon;
revoke all on function public.po_item_unit_price(uuid)      from public, anon;
revoke all on function public.pi_record_match(uuid,text,date,numeric,numeric,numeric,jsonb,text,uuid,text,text,text,numeric,numeric,numeric) from public, anon;
revoke all on function public.pi_override_match(uuid,text,text) from public, anon;

grant execute on function public.tw_actor()                 to authenticated;
grant execute on function public.pi_match_basis(uuid)       to authenticated;
grant execute on function public.pi_last_paid(text)         to authenticated;
grant execute on function public.po_item_unit_price(uuid)   to authenticated;
grant execute on function public.pi_record_match(uuid,text,date,numeric,numeric,numeric,jsonb,text,uuid,text,text,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.pi_override_match(uuid,text,text) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- Turning enforcement on, LATER, after ≥2 weeks of would_block evidence:
--   update public.three_way_tolerance
--      set mode = 'enforce', enforce_from = now(), updated_at = now() where id = 1;
-- Turning it back off:
--   update public.three_way_tolerance set mode = 'log' where id = 1;
--
-- What enforce mode would have refused so far:
--   select match_status, count(*), round(sum(abs(variance_amount)),0) as exposure
--     from public.three_way_match_log
--    where would_block and event = 'match' group by 1 order by 2 desc;
-- ═══════════════════════════════════════════════════════════════════════════
