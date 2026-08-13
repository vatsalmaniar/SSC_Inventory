// Purchase-price DECISION RULES — pure functions, no imports, no I/O.
//
// Kept separate from itemPricing.js (which does the Supabase reads) for two
// reasons: the rules can be unit-tested with plain `node` (see
// itemPricingRules.test.mjs — no test runner needed), and the precedence lives
// in exactly one place instead of being re-derived per screen.
//
// Precedence, most specific first:
//   1. PROJECT   this customer + this project, one-off, limited timeline
//   2. CUSTOMER  this customer, for the financial year
//   3. STOCK     blanket — every customer AND our own stock orders
//   4. STANDARD  list price × the partner discount for the product group
//
// Quantity scales: a special may carry min_qty (better rate from 50 up). We take
// the highest break the line quantity actually reaches, so changing the qty
// re-resolves to the correct rung.

export const SCOPE_RANK = { PROJECT: 3, CUSTOMER: 2, STOCK: 1 }

/**
 * How specific a record is. Scope dominates; within a scope, a rate negotiated
 * with THIS vendor beats a rate that applies to any vendor.
 *   project+vendor 7 · project 6 · customer+vendor 5 · customer 4
 *   stock+vendor   3 · stock   2
 */
export function specificity(row) {
  return (SCOPE_RANK[row.price_scope] || 0) * 2 + (row.vendor_id ? 1 : 0)
}

/** Is this special in force on `today` and reachable at `qty`? */
export function isEligible(row, { today, qty, customerId, projectRef, vendorId }) {
  if (!row) return false
  // Only an APPROVED record may price a document. A rate someone typed but
  // nobody countersigned is a proposal, not a price. Records written before
  // approval existed carry price_status='approved' by default, so nothing that
  // worked before stops working.
  if (row.price_status && row.price_status !== 'approved') return false
  if (row.valid_from && row.valid_from > today) return false
  if (row.valid_to && row.valid_to < today) return false
  if ((row.min_qty || 1) > (Number(qty) || 1)) return false
  // A rate tied to one vendor must never be paid to another. A record with no
  // vendor applies to any of them — which is every record written before the
  // vendor dimension existed.
  if (row.vendor_id && row.vendor_id !== vendorId) return false
  if (row.price_scope === 'PROJECT') {
    // A project belongs to a customer, so BOTH must match — otherwise one
    // customer's project rate would leak onto another's purchase order.
    return Boolean(projectRef) && row.project_ref === projectRef && row.customer_id === customerId
  }
  if (row.price_scope === 'CUSTOMER') return Boolean(customerId) && row.customer_id === customerId
  if (row.price_scope === 'STOCK')    return true          // blanket
  return false
}

/**
 * Most specific record wins; within that, the highest quantity break reached.
 *
 * The sort is TOTAL — it never returns 0 for two different records. It used to
 * stop after scope and quantity, and Array.sort is stable, so a genuine tie was
 * settled by whatever order Postgres happened to return the rows in. That can
 * change after a vacuum: two buyers, same item, same customer, same afternoon,
 * different prices, no explanation. The database now refuses to store
 * overlapping records at all (item_prices_no_overlap), and this is the second
 * line of defence: newest effective date wins, then newest record.
 */
export function pickBestSpecial(rows, ctx) {
  const eligible = (rows || []).filter(r => isEligible(r, ctx))
  if (!eligible.length) return null
  return eligible.slice().sort((a, b) =>
    (specificity(b) - specificity(a)) ||
    ((b.min_qty || 1) - (a.min_qty || 1)) ||
    String(b.valid_from || '').localeCompare(String(a.valid_from || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''))
  )[0]
}

/** Short human name for a record, used when pointing at a cheaper option. */
function describe(row) {
  const who = row.price_scope === 'PROJECT'  ? `project${row.project_ref ? ' ' + row.project_ref : ''}`
            : row.price_scope === 'CUSTOMER' ? 'customer rate'
            : 'blanket rate'
  const scale  = (row.min_qty || 1) > 1 ? ` from qty ${row.min_qty}` : ''
  const vendor = row.vendor_id ? ' (this vendor)' : ''
  return who + scale + vendor
}

/**
 * Is something CHEAPER than the price we picked also available right now?
 *
 * Specificity decides the price, as in SAP: a rate negotiated with this vendor
 * is used even when a broader rate happens to be lower. That is predictable,
 * but it means an incompletely recorded vendor scale can make us pay more than
 * a rate we already hold — e.g. vendor rate ₹1,650 flat vs a blanket ₹1,500
 * from qty 100. The chosen price does NOT change; the buyer is simply told.
 *
 * The standard partner discount counts as a candidate too: a stale special can
 * sit above the published discount and nobody would notice.
 */
export function findCheaperOption(rows, ctx, chosenUnit, standardUnit, standardLabel) {
  const candidates = (rows || [])
    .filter(r => isEligible(r, ctx))
    .map(r => ({ unitPrice: Number(r.amount), label: describe(r) }))
  if (standardUnit != null) candidates.push({ unitPrice: Number(standardUnit), label: standardLabel })

  let best = null
  for (const c of candidates) {
    if (!(c.unitPrice < chosenUnit - 0.005)) continue      // not actually cheaper
    if (!best || c.unitPrice < best.unitPrice) best = c
  }
  if (!best) return null
  return { ...best, savingPerUnit: round2(chosenUnit - best.unitPrice) }
}

/**
 * Final price for a line. `commercials` is one row of v_item_commercials.
 * Returns null when the item has no list price on file — the caller must then
 * leave the line exactly as the user typed it.
 */
export function resolveFromRows({ commercials, specials, qty = 1, customerId = null, projectRef = null, vendorId = null, today }) {
  if (!commercials) return null
  const listPrice = Number(commercials.list_price)
  const best = pickBestSpecial(specials, { today, qty, customerId, projectRef, vendorId })

  const stdPct  = commercials.standard_discount_pct == null ? null : Number(commercials.standard_discount_pct)
  const stdUnit = stdPct == null ? listPrice : round2(listPrice * (1 - stdPct / 100))

  if (best) {
    const unitPrice = Number(best.amount)
    const forVendor = best.vendor_id ? ' (this vendor)' : ''
    return {
      uom: commercials.uom || null,
      cheaper: findCheaperOption(
        specials, { today, qty, customerId, projectRef, vendorId },
        unitPrice, stdUnit,
        stdPct == null ? 'list price' : `standard ${stdPct}%`,
      ),
      recordId: best.id || null,
      // The agreement this rate came from, so the PO line can name it.
      spaNo: best.special_price_agreements?.spa_no || null,
      listPrice,
      discountPct: listPrice ? round1((1 - unitPrice / listPrice) * 100) : null,
      unitPrice,
      source: best.price_scope,
      label: (best.price_scope === 'PROJECT'  ? `Project special${best.project_ref ? ' · ' + best.project_ref : ''}`
           :  best.price_scope === 'CUSTOMER' ? 'Customer special'
           :  'Blanket special (all customers & stock)') + forVendor,
      // shortLabel fits the PO grid on one line; label is the tooltip.
      shortLabel: best.price_scope === 'PROJECT'  ? 'Project price'
                : best.price_scope === 'CUSTOMER' ? 'Customer price'
                : 'Special price',
      minQty: best.min_qty || 1,
    }
  }

  // A superseded series (FR-D700) has no partner discount. Show the list price
  // and say so — never invent a discount to fill the gap.
  const pct = stdPct
  return {
    // Nothing to point at: the standard price is the least specific option
    // there is, so no eligible record can be "the cheaper one we skipped".
    cheaper: null,
    uom: commercials.uom || null,
    recordId: null,          // a standard price comes from the book, not a record
    spaNo: null,
    listPrice,
    discountPct: pct,
    unitPrice: stdUnit,
    source: 'STANDARD',
    label: pct == null
      ? 'List price only — no partner discount for this series'
      : `Standard ${pct}% · ${commercials.discount_group || ''}`.trim(),
    shortLabel: pct == null ? 'List price only' : `Standard ${pct}%`,
    minQty: 1,
  }
}

/** Local calendar date. toISOString() is UTC — in IST that reads as yesterday
 *  until 05:30 and would exclude a special that starts today. */
export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const round1 = n => Math.round(n * 10) / 10
const round2 = n => Math.round(n * 100) / 100
