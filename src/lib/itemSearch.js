// Item picker search — ONE implementation for every item dropdown in the app.
//
// Why this exists: most pickers used to do
//     .ilike('item_code', '%' + q + '%').order('item_code').limit(10)
// which ranks ALPHABETICALLY and then truncates. Typing an exact code could
// therefore fail to show it: "T 25" is one of 21 codes containing "T 25" and
// sorts 19th, behind sixteen "FT 25-…" codes, so a limit of 15 hid the very
// item the user typed. Silently missing an item in a PO or order picker is the
// worst kind of bug — the user concludes the part does not exist and creates a
// duplicate.
//
// search_items_fuzzy ranks by trigram similarity instead, so an exact match is
// always first (similarity 1.0), and it also matches across punctuation —
// typing "12A230HBAC" finds "12A 230HBAC".

import { sb } from './supabase'

/**
 * @param {string} q            what the user typed
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {boolean} [opts.activeOnly=false]  drop de-activated items
 * @returns {Promise<Array>}    ranked: id, item_no, item_code, brand, category,
 *                              subcategory, type, sim — a superset of what the
 *                              pickers render, so call sites need no reshaping.
 */
export async function searchItems(q, { limit = 20, activeOnly = false } = {}) {
  const query = (q || '').trim()
  if (!query) return []

  const { data, error } = await sb.rpc('search_items_fuzzy', { p_query: query, p_limit: limit })
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
