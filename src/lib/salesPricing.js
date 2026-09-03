// Sell-side price resolution for sales orders — the mirror of itemPricing.js,
// which is PURCHASE-only and must stay that way.
//
// WHY A SEPARATE MODULE AND NOT A FLAG ON itemPricing.js
// The two sides differ in the one place that matters: what lands on the form.
// A purchase line keeps the LIST price in lp_unit_price and carries the exact
// negotiated amount separately in _fixedUnit, because a purchase special is a
// discount off a published list. A SALES line, by the user's decision, puts the
// AGREED NET PRICE straight into lp_unit_price with discount 0.
//
// That is not a shortcut — it is stronger here. With discount 0 the form's own
// arithmetic, lp x (1 - 0/100), reproduces the agreed figure EXACTLY, so the
// rounding loss that _fixedUnit exists to prevent cannot occur at all. Compare
// the alternative: 207 of 232 sell rates do not land on a clean percentage, and
// rebuilding one from a 1-decimal discount is out by up to Rs 27.24 per unit
// (S-N300: agreed 31,849, rebuilt 31,876.24). We never store a percentage that
// could be used to re-derive the price, so it can never be re-derived wrongly.
//
// The trade-off, accepted deliberately: the order line does not record what the
// LIST price was, and discount_pct reads 0 for every SPA line, so "discount
// given" reporting will understate these customers.
//
// WHAT IS SHARED
// The decision rules are NOT duplicated. Eligibility (approval, validity window,
// quantity break, scope match) and precedence come from itemPricingRules.js, the
// same functions the purchase side uses. Only the I/O and the form-field shape
// live here.
//
// ACCESS
// Reads go through the resolve_sales_prices RPC, never the item_prices table.
// The sales role cannot read that table at all - see sql/resolve_sales_prices.sql
// for why that is deliberate and must not be "fixed" with an RLS policy.

import { sb } from './supabase'
import { pickBestSpecial, localToday } from './itemPricingRules'

/** Sales orders are small. Well under the RPC's own 500 cap. */
const MAX_CODES = 500

/**
 * Fetch every sell-side rate on file for one customer and a set of item codes.
 *
 * Item codes travel in the POST body, not the URL — so unlike a .in() filter
 * this is immune to both PostgREST's 8 KB URL cap and its quoting bug on codes
 * containing quotes, commas or parentheses.
 *
 * @returns {Promise<{byCode: Map<string, object[]>, failed: boolean}>}
 *   `failed` distinguishes "the lookup broke" from "no agreement exists". They
 *   are not the same and must not produce the same message on screen.
 */
export async function fetchSalesPrices(customerId, itemCodes, on = null) {
  const codes = [...new Set((itemCodes || []).map(c => (c || '').trim()).filter(Boolean))]
  const byCode = new Map()
  if (!customerId || !codes.length) return { byCode, failed: false }
  if (codes.length > MAX_CODES) return { byCode, failed: true }

  const { data, error } = await sb.rpc('resolve_sales_prices', {
    p_customer_id: customerId,
    p_item_codes: codes,
    p_on: on,
  })
  if (error || !data) return { byCode, failed: true }

  for (const row of data) {
    const list = byCode.get(row.item_code) || []
    list.push(row)
    byCode.set(row.item_code, list)
  }
  return { byCode, failed: false }
}

/**
 * Pick the rate that applies, using the SHARED precedence rules.
 * @returns {{state:'PRICED'|'NO_PRICE'|'ERROR', amount?:number, spaNo?:string, recordId?:string, label?:string}}
 */
export function resolveSalesPrice(rows, { qty = 1, customerId = null, failed = false, today = localToday() } = {}) {
  if (failed) return { state: 'ERROR' }
  if (!rows || !rows.length) return { state: 'NO_PRICE' }

  // Same eligibility and precedence the purchase side uses — approval status,
  // validity window, quantity break, scope. vendorId is null: a sell rate is
  // never vendor-scoped, and every SALES row on file has vendor_id null.
  const best = pickBestSpecial(rows, { today, qty, customerId, projectRef: null, vendorId: null })
  if (!best) return { state: 'NO_PRICE' }

  const amount = Number(best.amount)
  if (!Number.isFinite(amount) || amount <= 0) return { state: 'NO_PRICE' }

  return {
    state: 'PRICED',
    amount,
    spaNo: best.spa_no || null,
    recordId: best.id || null,
    label: best.spa_no ? `Agreed price · ${best.spa_no}` : 'Agreed price',
  }
}

/**
 * The ONE place a sell price is put onto a form line, so the agreed figure
 * cannot be altered on its way to the screen.
 *
 * Net price goes into lp_unit_price with discount 0 — see the header.
 */
export function salesLineFields(line, res) {
  if (!res || res.state !== 'PRICED') {
    return {
      _priceState: res?.state || 'ERROR',
      // 'ERROR' must stay silent: the lookup failed, so we do not know whether
      // an agreement exists and must not tell the salesperson there isn't one.
      _priceShort: res?.state === 'NO_PRICE' ? '' : '',
      _priceLabel: '', _spaNo: null, _priceRecordId: null,
      _autoPriced: false,
    }
  }
  const qty  = parseFloat(line?.qty) || 0
  const unit = res.amount
  return {
    lp_unit_price: String(unit),
    discount_pct: '0',
    unit_price_after_disc: unit.toFixed(2),
    total_price: qty ? (unit * qty).toFixed(2) : '',
    _priceState: 'PRICED',
    _priceLabel: res.label,
    _priceShort: res.spaNo || 'Agreed price',
    _spaNo: res.spaNo,
    _priceRecordId: res.recordId,
    _autoPriced: true,
  }
}

/**
 * Fields that mark a line as hand-priced. The salesperson may always override —
 * the agreed rate is a default, not a lock — but the line must stop claiming it
 * came from an agreement the moment it no longer matches one.
 */
export function salesOverrideFields(wasAutoPriced) {
  return {
    _autoPriced: false,
    _priceLabel: '',
    _priceShort: wasAutoPriced ? 'Overridden by sales' : '',
    _priceState: '',
    _spaNo: null,
    _priceRecordId: null,
    _overridden: true,
  }
}
