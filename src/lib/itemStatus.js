// Item status — the one place that decides whether a part may go on a document.
//
// Mirrors customers.account_status, which this ERP already gets right: a
// blacklisted customer still APPEARS in the picker wearing a red pill, and
// selecting it says why and what to use instead. Marked, not hidden. Hiding a
// part makes it vanish for the person who typed its code and teaches them
// nothing; marking it hands them the replacement.
//
// The database enforces this too (block_superseded_item on order_items and
// po_items), so an import or an API call is refused with the same sentence.
// What this file adds is telling the user BEFORE they save, not after.
import { sb } from './supabase'

const TTL_MS = 5 * 60 * 1000
let cache = null
let cachedAt = 0

/**
 * Every non-Active item, as a Map of item_code → { item_status, superseded_by }.
 *
 * Loaded whole and cached rather than queried per keystroke: the set is tiny
 * (14 today, out of 9,846) and indexed, so one small query beats an extra round
 * trip on every character typed into a typeahead.
 */
export async function retiredItems() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache
  const { data, error } = await sb.from('items')
    .select('item_code,item_status,superseded_by')
    .neq('item_status', 'Active')
  if (error) { console.error('retiredItems:', error); return cache || new Map() }
  cache = new Map((data || []).map(r => [r.item_code, r]))
  cachedAt = Date.now()
  return cache
}

/** Drop the cache — call after changing a status so the change shows at once. */
export function forgetRetiredItems() { cache = null; cachedAt = 0 }

/** The short pill shown next to a retired code in a picker, or null. */
export function itemStatusPill(row) {
  if (!row || row.item_status === 'Active' || !row.item_status) return null
  return row.item_status === 'Superseded'
    ? { label: 'SUPERSEDED', bg: '#fffbeb', color: '#b45309' }
    : { label: 'DISCONTINUED', bg: '#fef2f2', color: '#dc2626' }
}

/**
 * Why this item may not go on a new document, or null if it may.
 * Wording matches block_superseded_item() so the user reads the same sentence
 * whether the app caught it or the database did.
 */
export function itemBlockReason(row) {
  if (!row || !row.item_status || row.item_status === 'Active') return null
  if (row.item_status === 'Superseded')
    return `Item ${row.item_code} has been superseded — use ${row.superseded_by} instead.`
  return `Item ${row.item_code} is discontinued and cannot be added to a new document.`
}

/** Convenience: decorate rows from any item search with their status. */
export async function withItemStatus(rows) {
  if (!rows?.length) return rows || []
  const map = await retiredItems()
  if (!map.size) return rows
  return rows.map(r => {
    const hit = map.get(r.item_code)
    return hit ? { ...r, item_status: hit.item_status, superseded_by: hit.superseded_by } : r
  })
}

/**
 * SI / CI type badge. Item 360 renders this inline via .ol-status-pill; every
 * picker uses <span className="item-type-pill"> with the same --stage-color, so
 * the two cannot drift. Returns null when an item has no type.
 */
export function itemTypeColor(type) {
  if (type === 'SI') return 'var(--blue-800)'
  if (type === 'CI') return '#C2410C'
  return null
}
