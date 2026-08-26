// Purchase-side price resolution — ONE implementation, used by New PO and the
// forecast PO modal. Do not re-derive this anywhere else.
//
// Sales/CO documents deliberately do NOT call this: the partner discount is
// what WE pay Mitsubishi, so auto-filling it onto a sales order would quote the
// customer at our own cost. Sales specials are recorded on Item 360 so margin
// can be seen, but the salesperson still prices the order.
//
// This module is the I/O half. The decision rules — precedence and quantity
// scales — live in itemPricingRules.js so they can be unit-tested without a
// database. Change the rules there, not here.
//
// READ FIRST, three things that are deliberate:
//
// 1. EVERY call returns a result object with a `state`, never null. 'PRICED',
//    'NO_PRICE' (the item exists but has no list price — ~9,600 of 9,831 items)
//    or 'ERROR'. The screens used to get null for all three and could not tell
//    "no price on file" from "the lookup failed", so they said nothing at all
//    and the buyer could not tell either.
//
// 2. Reads are BATCHED. resolvePurchasePrices() takes every line at once and
//    issues three queries for the whole set, chunked at 150 codes (the same
//    PostgREST URL cap coverage.js chunks against). Pricing a 40-line customer
//    order used to fire 120 requests in a loop from one browser.
//
// 3. The EXACT amount is carried, never re-derived. A special is a rupee
//    figure; its percentage is display only, rounded to one decimal. Rebuilding
//    the price from that percentage loses money — LP 1,970 with a negotiated
//    1,500 came back as 1,499.17. priceLineFields() below is the single place
//    that puts a price onto a form line, so the exact figure cannot be lost on
//    the way to the screen.

import { sb } from './supabase'
import { selectByCodes } from './safeCodes'
import { resolveFromRows, localToday } from './itemPricingRules'

const CHUNK = 150   // >~150 codes in one .in() exceeds PostgREST's 8 KB URL cap

/**
 * One round of reads for a whole set of item codes.
 * @returns {Promise<{commercials:Map, items:Map, specials:Map, failed:boolean}>}
 */
export async function fetchPricingData(itemCodes) {
  const codes = [...new Set((itemCodes || []).map(c => (c || '').trim()).filter(Boolean))]
  const commercials = new Map(), items = new Map(), specials = new Map()
  if (!codes.length) return { commercials, items, specials, failed: false }

  // selectByCodes chunks internally AND handles codes that break PostgREST's
  // .in() parsing (quotes/commas/parens) via per-code .eq — [[postgrest-in-quoting]]
  const [commRes, itemRes, spRes] = await Promise.all([
    selectByCodes(() => sb.from('v_item_commercials').select('*'), 'item_code', codes, { chunk: CHUNK }),
    selectByCodes(() => sb.from('items').select('item_code,description,moq'), 'item_code', codes, { chunk: CHUNK }),
    selectByCodes(() => sb.from('item_prices')
      .select('id,item_code,price_scope,customer_id,vendor_id,project_ref,amount,min_qty,valid_from,valid_to,price_status,spa_id,special_price_agreements(spa_no)')
      .eq('price_type', 'PURCHASE'), 'item_code', codes, { chunk: CHUNK }),
  ])
  // A failed read is NOT the same as "no price". Flagged so the caller can
  // leave the line alone instead of labelling it "no list price on file".
  const failed = !!(commRes.error || itemRes.error || spRes.error)
  if (failed) console.error('fetchPricingData:', commRes.error || itemRes.error || spRes.error)
  for (const r of (commRes.data || [])) commercials.set(r.item_code, r)
  for (const r of (itemRes.data || [])) items.set(r.item_code, r)
  for (const r of (spRes.data  || [])) {
    if (!specials.has(r.item_code)) specials.set(r.item_code, [])
    specials.get(r.item_code).push(r)
  }
  return { commercials, items, specials, failed }
}

/** Resolve one line against already-fetched data. Pure, no I/O. */
export function resolveFromData(data, { itemCode, qty = 1, customerId = null, projectRef = null, vendorId = null, asOfDate = null }) {
  const code = (itemCode || '').trim()
  const item = data.items.get(code)
  const resolved = resolveFromRows({
    commercials: data.commercials.get(code),
    specials:    data.specials.get(code) || [],
    qty, customerId, projectRef, vendorId,
    // The DOCUMENT's date decides which records are in force, not the clock. A
    // PO dated 28-Dec but raised on 2-Jan must price on the December scheme,
    // and one dated forward must not pick up a rate that has not started. Falls
    // back to today when the caller has no date yet.
    today: asOfDate || localToday(),
  })
  const description = item?.description || null
  const moq = item?.moq ?? null

  if (!resolved) {
    return { state: data.failed ? 'ERROR' : 'NO_PRICE', description, moq }
  }
  return { state: 'PRICED', ...resolved, description, moq }
}

/**
 * Resolve many lines in one round of reads.
 * @param {Array<{itemCode:string, qty?:number, customerId?:string, projectRef?:string}>} lines
 * @returns {Promise<Array>} results aligned index-for-index with `lines`
 */
export async function resolvePurchasePrices(lines) {
  const list = lines || []
  if (!list.length) return []
  let data
  try { data = await fetchPricingData(list.map(l => l.itemCode)) }
  catch (e) {
    console.error('resolvePurchasePrices:', e)
    return list.map(() => ({ state: 'ERROR', description: null, moq: null }))
  }
  return list.map(l => resolveFromData(data, l))
}

/** Single-line convenience — the item picker path. Never throws. */
export async function resolvePurchasePrice(line) {
  const [res] = await resolvePurchasePrices([line])
  return res || { state: 'ERROR', description: null, moq: null }
}

/**
 * The ONE place a resolved price becomes form fields. Shared by New PO and the
 * forecast modal so the two can't drift.
 *
 * `_fixedUnit` is the exact negotiated amount, kept only for a special. The
 * forms recompute unit price as list × (1 − discount) whenever any field
 * changes; for a special that arithmetic is lossy, so they use _fixedUnit
 * instead. A STANDARD price leaves it null because list × (1 − pct) IS the
 * price there, exactly.
 *
 * @param {object} line  the current form line (its qty and description are read)
 * @param {object} res   a result from resolvePurchasePrice(s)
 * @returns {object}     fields to merge onto the line
 */
export function priceLineFields(line, res) {
  // Description fills even when there's no price — it comes off the item, not
  // the price list. Never overwrites what the user already typed.
  const description = line.description || res?.description || ''

  if (!res || res.state !== 'PRICED') {
    return {
      description,
      _moq: res?.moq ?? null,
      _priceState: res?.state || 'ERROR',
      _priceLabel: '', _priceSource: '',
      // 'ERROR' says nothing: the lookup failed, so we don't know whether a
      // price exists and must not claim there isn't one.
      _priceShort: res?.state === 'NO_PRICE' ? 'No list price on file' : '',
      _autoPriced: false,
      _fixedUnit: null, _cheaper: '', _uom: null, _spaNo: null,
      _priceRecordId: null, _listPriceAtEntry: null, _priceResolvedAt: null,
    }
  }

  const qty  = parseFloat(line.qty) || 0
  const unit = Number(res.unitPrice) || 0
  return {
    description,
    lp_unit_price: String(res.listPrice),
    discount_pct:  String(res.discountPct ?? 0),
    unit_price_after_disc: unit ? unit.toFixed(2) : '',
    total_price:   (unit && qty) ? (unit * qty).toFixed(2) : '',
    // A cheaper rate we already hold but did not pick — advisory, see
    // findCheaperOption(). Never changes the price, only tells the buyer.
    _cheaper: res.cheaper
      ? `₹${res.cheaper.unitPrice.toLocaleString('en-IN')} available on the ${res.cheaper.label} — ₹${res.cheaper.savingPerUnit.toLocaleString('en-IN')}/unit less`
      : '',
    // Provenance — written onto the PO line so the price can be explained later.
    _uom: res.uom || null,
    _spaNo: res.spaNo || null,
    _priceRecordId: res.recordId || null,
    _listPriceAtEntry: res.listPrice,
    _priceResolvedAt: new Date().toISOString(),
    _priceState:  'PRICED',
    _priceLabel:  res.label,
    _priceShort:  res.shortLabel,
    _priceSource: res.source,
    _moq:         res.moq ?? null,
    _autoPriced:  true,
    _fixedUnit:   res.source === 'STANDARD' ? null : unit,
  }
}

/**
 * Unit price for a line after any edit. Honours the exact special amount; falls
 * back to list × (1 − discount) for a standard price or a hand-typed one.
 */
export function unitPriceFor(line, { manualPriceEdit = false } = {}) {
  if (!manualPriceEdit && line._fixedUnit != null) return Number(line._fixedUnit)
  const lp   = parseFloat(line.lp_unit_price) || 0
  const disc = parseFloat(line.discount_pct)  || 0
  return lp * (1 - disc / 100)
}
