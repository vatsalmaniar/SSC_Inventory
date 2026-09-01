// Item picker search — ONE implementation for every item dropdown in the app.
//
// Backed by the search_items_v2 RPC (sql/search_items_v2.sql). Read the design
// rules in that file before changing anything here.
//
// Why it exists: pickers used to do
//     .ilike('item_code', '%' + q + '%').order('item_code').limit(10)
// which ranks ALPHABETICALLY and then truncates, so an exact code could be
// hidden entirely — and it cannot match across punctuation at all, which
// matters because 4,423 of 9,848 codes carry legacy spaces. Silently missing an
// item in an order or PO picker is the worst kind of bug: the user concludes
// the part does not exist and creates a duplicate.
//
// Its replacement, search_items_fuzzy, ranked by trigram similarity — but used
// similarity as the MEMBERSHIP FILTER too, so typing more characters did not
// narrow the list, and it compared RAW strings, so a stored "MAD 1401040R5"
// lost to "MAD1401040R5X" when the user typed the code without its space.
// Measured: 12.5% of punctuated codes did not rank first.
//
// search_items_v2 decides membership deterministically (exact -> prefix ->
// contains -> brand) and uses fuzzy only to APPEND suggestions below those.
// Rows carry `tier`: 0-3 are real matches, 4-5 are fuzzy suggestions. Render a
// separator where tier crosses 4 — a fuzzy guess must never look like a match.
//
// search_items_fuzzy is still deployed and untouched. To roll back, change RPC
// below and redeploy; no database change is required.

import { sb } from './supabase'

const RPC = 'search_items_v2'          // rollback: 'search_items_fuzzy'
const RPC_SIMILAR   = 'search_items_similar'
const RPC_INVENTORY = 'search_inventory'

/** Tiers 0-4 are real matches (exact, prefix, contains, all-tokens, brand).
 *  Tiers 5-6 are fuzzy suggestions. */
export const FUZZY_TIER = 5

/** True when the row is a fuzzy suggestion rather than a real match. */
export const isSuggestion = row => (row?.tier ?? 0) >= FUZZY_TIER

/**
 * Separator rule shared by every item picker: a grey line the moment the list
 * crosses from real matches into suggestions. Pass as Typeahead's `separator`.
 * A suggestion that looks like a match is how someone orders the wrong part —
 * rows 1 and 9 of a "Conduit PA PG 21" search differ by a single digit.
 */
export function itemSuggestionBreak(prev, row) {
  return isSuggestion(row) && !isSuggestion(prev) ? 'Similar codes' : null
}

/**
 * @param {string} q            what the user typed
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.activeOnly=false]  drop de-activated items
 * @returns {Promise<Array>}    ranked: id, item_no, item_code, brand, category,
 *                              subcategory, type, item_status, superseded_by,
 *                              sim, tier — a superset of what every picker
 *                              renders, so call sites need no reshaping.
 */
export async function searchItems(q, { limit = 20, activeOnly = false, brand = null, category = null, type = null } = {}) {
  const query = (q || '').trim()
  if (!query) return []

  // brand/category/type are applied BY THE DATABASE, before the limit. Filtering
  // the fetched page in the browser instead is what made Item 360 report
  // "No items found" for brands whose items all ranked past the limit.
  const { data, error } = await sb.rpc(RPC, {
    p_query: query, p_limit: limit,
    p_brand: brand || null, p_category: category || null, p_type: type || null,
  })
  if (error || !data) return []
  if (!activeOnly || !data.length) return data

  // The RPC doesn't return is_active, so confirm in one small follow-up rather
  // than showing a retired part. (Zero items are inactive today, but the
  // caller asked for the guarantee, so honour it.)
  const { data: live } = await sb.from('items')
    .select('id').eq('is_active', true).in('id', data.map(r => r.id))
  if (!live) return data
  const ok = new Set(live.map(r => r.id))
  return data.filter(r => ok.has(r.id))
}

/**
 * Duplicate detection ONLY (New Item). Deliberately a different function from
 * searchItems: a picker wants precision and suppresses guesses as soon as
 * anything matches, which is exactly wrong when the whole point is to surface
 * near-misses before someone creates a twin. Never use this in a picker.
 */
export async function searchSimilarItems(q, { limit = 8 } = {}) {
  const query = (q || '').trim()
  if (query.length < 2) return []
  const { data, error } = await sb.rpc(RPC_SIMILAR, { p_query: query, p_limit: limit })
  return error || !data ? [] : data
}

/**
 * Punctuation-blind code comparison for CLIENT-SIDE list filters (Waitlist,
 * Procurement Forecast, ATP). Those filter rows already on screen rather than
 * searching the master, so they never hit the RPC — but they must follow the
 * same rule, or typing "MAD140" hides a row showing "MAD 1401040R5".
 * 54% of open order lines carry a spaced code.
 * Use ONLY for part codes. Names and free text keep plain matching.
 */
export const normCode = v => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const codeIncludes = (code, query) => {
  const n = normCode(query)
  return n ? normCode(code).includes(n) : true
}

/**
 * Live stock search for /inventory (Sales stock check). Searches the Tally
 * `inventory` table, NOT the item master — different table, same tier rules,
 * see sql/search_inventory.sql.
 *
 * Lives here so every search RPC name sits in one file: that is what makes a
 * rollback a one-line change, and why the lint rule forbids naming these RPCs
 * anywhere else.
 */
export async function searchInventory(q, { limit = 200 } = {}) {
  const query = (q || '').trim()
  if (!query) return { data: [], error: null }
  return sb.rpc(RPC_INVENTORY, { p_query: query, p_limit: limit })
}
