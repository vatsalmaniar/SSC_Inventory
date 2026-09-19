// Three-way match — ONE definition of the verdict, shared by every screen.
//
// This mirrors public.pi_record_match() in sql/three_way_match_api.sql exactly.
// The SQL is the authority: it computes the verdict that gets STORED, because a
// rule enforced only in React is bypassable straight through PostgREST (that is
// why audit findings P1 and F-06 exist). This library exists so the screen can
// show the user the same answer *before* they submit, and so the Excel exports
// and the PO/Item pages all describe a variance the same way.
//
// scripts/three-way-parity.mjs asserts the two agree across every line in the
// live dataset. If you change the arithmetic here, change it there, and run it.
//
// WHY RATES AND NOT BILL TOTALS. Measured over 1,547 non-test po_inward GRNs:
// grn.invoice_amount is the WHOLE vendor invoice, gross of GST, and 19 invoice
// numbers span 40 GRNs — one bill legitimately covering several receipts is
// routine here. Only 66% of GRNs reconcile at ~1.18 against their PO, so a
// total-level check would flag ~29% of bills for entirely legitimate reasons and
// be clicked past inside a week. A RATE is immune to all of it: 107.64 against a
// PO rate of 132.76 is wrong regardless of consolidation, GST, freight, or
// whether the receipt was partial.

import { poUnitPrice } from './poValue.js'

/** Quantity a GRN line is matched on. Accepted, NOT received — you do not owe
 *  money for goods you rejected. Mirrors COALESCE(accepted_qty, received_qty, 0). */
export function matchedQty(grnLine) {
  const a = Number(grnLine?.accepted_qty)
  if (Number.isFinite(a) && grnLine?.accepted_qty !== null) return a
  return Number(grnLine?.received_qty) || 0
}

/** Price basis for a GRN line. grn_items carries no price — it is always the PO
 *  line's. Returns null, never 0, when there is no basis: a missing basis must
 *  not masquerade as a zero variance, nor make every rupee billed look like an
 *  over-bill. `0 || x` falls through correctly in JS; the SQL side must use
 *  nullif() because coalesce() only skips NULL. */
export function basisUnitPrice(poItem) {
  return poUnitPrice(poItem) || null
}

/** Tolerance band in rupees per unit, for one direction.
 *  GREATEST(absolute floor, percentage of the rate) — a percentage alone makes
 *  every ₹20 item a permanent flag; an absolute floor alone lets a big-ticket
 *  variance through. Neither works on its own. */
export function toleranceBand(poPrice, tol, direction) {
  const pct = direction === 'under'
    ? Number(tol?.rate_tol_pct_under ?? 5)
    : Number(tol?.rate_tol_pct_over ?? 1)
  return Math.max(Number(tol?.rate_tol_abs ?? 1), (Number(poPrice) || 0) * pct / 100)
}

/** Verdict for one bill line.
 *  matchedQty and poPrice come from the GRN and the PO (read-only upstream);
 *  billedQty and invPrice are what accounts keyed in from the invoice. */
export function lineVerdict({ matchedQty: mq, billedQty, poPrice, invPrice, tol }) {
  const m  = Number(mq) || 0
  const bq = billedQty === null || billedQty === undefined ? m : Number(billedQty) || 0
  const pp = Number(poPrice) || 0
  const ip = invPrice === null || invPrice === undefined ? null : Number(invPrice)

  if (!pp || ip === null || !Number.isFinite(ip)) {
    return { status: 'no_basis', rateVariance: null, rateVariancePct: null,
             qtyVariance: bq - m, expected: 0, billed: 0, band: null }
  }

  const diff     = ip - pp
  const expected = m * pp
  const billed   = bq * ip
  // Exact decomposition: billed - expected === rateVariance + qtyVariance.
  const rateVar  = m * diff
  const qtyVar   = (bq - m) * ip

  let status
  const ignore = Number(tol?.rate_tol_abs_ignore ?? 0.10)
  let band = null
  if (Math.abs(diff) <= ignore) {
    status = 'matched'                  // SAP's BD key: small difference, ignored
  } else {
    band = toleranceBand(pp, tol, diff > 0 ? 'over' : 'under')
    status = Math.abs(diff) <= band ? 'within_tolerance' : 'over_tolerance'
  }

  // A quantity billed above what was accepted is a variance in its own right,
  // whatever the rate — this is the over-delivery-refused case.
  const qtyTol = Number(tol?.qty_tol_pct ?? 0)
  if (bq > m * (1 + qtyTol / 100)) status = 'over_tolerance'

  return {
    status,
    rateVariance: rateVar,
    rateVariancePct: Math.round(1000 * diff / pp) / 10,
    qtyVariance: qtyVar,
    expected, billed, band,
  }
}

/** Roll the lines up into the bill's verdict.
 *  Derived from the LINE statuses, never re-derived from the totals — those two
 *  disagree. A 5-paise-per-unit difference is `matched` on the line (inside the
 *  ignore band) but shows as a ₹5 difference on a 100-unit bill; re-deriving
 *  from the total would contradict the line and re-introduce exactly the
 *  rounding noise the ignore band exists to suppress. */
export function billVerdict(lines, tol) {
  const v = (lines || []).map(l => ({ ...l, v: lineVerdict({ ...l, tol }) }))

  const noBasis = v.filter(x => x.v.status === 'no_basis').length
  const over    = v.filter(x => x.v.status === 'over_tolerance').length
  const within  = v.filter(x => x.v.status === 'within_tolerance').length

  const expected = v.reduce((s, x) => s + x.v.expected, 0)
  const billed   = v.reduce((s, x) => s + x.v.billed, 0)
  const rateVar  = v.reduce((s, x) => s + (x.v.rateVariance || 0), 0)
  const qtyVar   = v.reduce((s, x) => s + (x.v.qtyVariance  || 0), 0)
  const worst    = v.reduce((s, x) => Math.max(s, Math.abs(x.v.rateVariancePct || 0)), 0)

  const status =
    (!v.length || noBasis === v.length) ? 'no_basis'
    : over    > 0                       ? 'over_tolerance'
    : noBasis > 0                       ? 'partial_basis'
    : within  > 0                       ? 'within_tolerance'
    :                                     'matched'

  return {
    status, lines: v, expected, billed,
    varianceAmount: billed - expected,
    rateVariance: rateVar,
    qtyVariance: qtyVar,
    worstLinePct: worst,
    noBasisLines: noBasis,
    // A flagged bill needs a SECOND person to release it. The matcher never
    // clears their own variance (SAP's MIRO / MRBR split).
    needsOverride: ['over_tolerance', 'no_basis', 'partial_basis'].includes(status),
  }
}

/** What the line ACTUALLY cost: the matched invoice rate where one exists,
 *  otherwise the PO rate.
 *
 *  Use this for COST reporting — received value, item cost, purchase register.
 *  Commitment reporting (open PO value, pending to receive) must keep using
 *  poUnitPrice(), because the PO price is what we are on the hook for and the
 *  invoice price is what we paid. The PO is never rewritten: it is the
 *  commitment record, and overwriting 132.76 with 107.64 would destroy the
 *  evidence that the PO was raised wrong — which is the fact worth surfacing. */
export function landedUnitPrice(poItem, invoiceLine) {
  const inv = Number(invoiceLine?.inv_unit_price)
  if (Number.isFinite(inv) && inv > 0) return inv
  return poUnitPrice(poItem)
}

/** GST sanity only — NEVER a gate.
 *  purchase_orders has no tax, GST or freight columns, so there is no expected
 *  GST anywhere to compare against. Matching a gross invoice against ex-tax PO
 *  value would fail every single bill by ~18%. So: check the implied rate lands
 *  near a real slab, show a note if it does not, and never block. */
export function gstPlausible(taxable, gst, rates = [0, 5, 12, 18, 28]) {
  const t = Number(taxable) || 0
  const g = Number(gst) || 0
  if (!t) return { ok: true, impliedPct: null, nearest: null }
  const implied = 100 * g / t
  const nearest = rates.reduce((a, b) => Math.abs(b - implied) < Math.abs(a - implied) ? b : a, rates[0])
  return { ok: Math.abs(implied - nearest) <= 0.5, impliedPct: implied, nearest }
}

/** Human label for a verdict. One place, so the chips, the table and the Excel
 *  exports never describe the same state three different ways. */
export const MATCH_LABELS = {
  matched:          { label: 'Matched',           tone: 'ok'   },
  within_tolerance: { label: 'Within tolerance',  tone: 'ok'   },
  over_tolerance:   { label: 'Over tolerance',    tone: 'warn' },
  overridden:       { label: 'Released',          tone: 'warn' },
  partial_basis:    { label: 'Partly unpriced',   tone: 'warn' },
  no_basis:         { label: 'No PO price',       tone: 'warn' },
}
