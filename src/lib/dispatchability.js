// ═══════════════════════════════════════════════════════════════════
// Available to Promise — stock matching + FIFO allocation.
// THE single place order item codes meet inventory product codes.
//
// Matching is EXACT string equality on the raw code — never substring,
// never prefix, never fuzzy. A short inventory code matching inside a
// longer order code once inflated the dispatchable figure badly; any
// change that relaxes this must go through a design review first.
//
// Allocation is a running FIFO decrement: stock a line consumes is gone
// for every later line. Sort is (order_date, order_number, sr_no) with
// null dates LAST — an undated order never silently jumps the queue.
//
// Pure data-in/data-out. No Supabase, no React — unit-testable in node,
// portable to a DB RPC if volumes ever outgrow the client.
// ═══════════════════════════════════════════════════════════════════

export const LOCATIONS = ['Kaveri', 'Godawari']

// Line buckets — every pending line lands in exactly one; nothing is dropped
export const BUCKET = {
  FULL: 'full',                 // sheet stock covers the whole pending qty
  PARTIAL: 'partial',           // some stock, not all
  NO_STOCK: 'no_stock',         // code in sheet, qty exhausted (or zero)
  NOT_IN_SHEET: 'not_in_sheet', // code absent from today's sheet entirely
}

// Order buckets (rollup of its pending lines)
export const ORDER_BUCKET = {
  FULL: 'full',
  PARTIAL: 'partial',                   // partly coverable AND partials allowed
  BLOCKED_PARTIAL: 'blocked_partial',   // partly coverable but partials OFF → not dispatchable
  NO_STOCK: 'no_stock',
  NOT_IN_SHEET: 'not_in_sheet',
}

// Diagnostics ONLY — never used for matching or allocation. Flags codes that
// would match if someone fixed spacing/casing, so ops can clean the master.
export const normCode = (c) => String(c || '').trim().replace(/\s+/g, ' ').toUpperCase()

// inventory rows → { stock, ghostLocations, normIndex, freshness }
//   stock[rawCode] = { Kaveri: n, Godawari: n }   (qty > 0 only)
//   ghostLocations = location strings outside LOCATIONS (upload typo → ghost godown)
//   normIndex: normCode → true, for the near-miss diagnostic
//   freshness[loc] = { min, max } of updated_at among qty>0 rows (torn-upload probe)
export function buildStockMap(invRows) {
  const stock = {}, normIndex = {}, ghost = new Set(), freshness = {}
  for (const r of invRows || []) {
    const loc = (r.location || '').trim()
    if (!LOCATIONS.includes(loc)) { if (loc) ghost.add(loc); continue }
    const qty = Number(r.quantity) || 0
    if (qty <= 0) continue
    const code = r.product_code
    if (!code) continue
    if (!stock[code]) stock[code] = { Kaveri: 0, Godawari: 0 }
    stock[code][loc] += qty
    normIndex[normCode(code)] = true
    const ts = r.updated_at || null
    if (ts) {
      if (!freshness[loc]) freshness[loc] = { min: ts, max: ts }
      else {
        if (ts < freshness[loc].min) freshness[loc].min = ts
        if (ts > freshness[loc].max) freshness[loc].max = ts
      }
    }
  }
  return { stock, ghostLocations: [...ghost].sort(), normIndex, freshness }
}

// Same formula as src/lib/orderStatus.js lineUndispatchedQty — dispatched_qty
// increments at batch creation (sql/dispatch_atomic_phase2.sql), so in-flight
// batches are already excluded. Inlined to keep this module dependency-free.
const pendQty = (i) => Math.max(0, (i.qty || 0) - (i.dispatched_qty || 0) - (i.cancelled_qty || 0))

// Strict FIFO sort key: order_date asc, nulls LAST, then order_number, then sr_no
function fifoCompare(a, b) {
  const da = a.order_date || null, db = b.order_date || null
  if (da !== db) {
    if (da === null) return 1
    if (db === null) return -1
    return da < db ? -1 : 1
  }
  const na = a.order_number || '', nb = b.order_number || ''
  if (na !== nb) return na < nb ? -1 : 1
  return (a.sr_no || 0) - (b.sr_no || 0)
}

// orders (with embedded order_items) + buildStockMap() output → allocation.
// Caller filters test/terminal/SAMPLE; this guards terminal again defensively.
const TERMINAL = ['dispatched_fc', 'closed', 'cancelled']

// Order bucket from its line buckets + the partial-deliveries toggle.
// Exported so a cached list can re-derive the bucket when the toggle changes
// between syncs without re-running the whole allocation.
export function deriveOrderBucket(ls, partialsAllowed) {
  if (ls.every(l => l.bucket === BUCKET.FULL)) return ORDER_BUCKET.FULL
  if (ls.some(l => l.alloc > 0)) return partialsAllowed ? ORDER_BUCKET.PARTIAL : ORDER_BUCKET.BLOCKED_PARTIAL
  if (ls.every(l => l.bucket === BUCKET.NOT_IN_SHEET)) return ORDER_BUCKET.NOT_IN_SHEET
  return ORDER_BUCKET.NO_STOCK
}

export const isOrderDispatchable = (r) => r.bucket === ORDER_BUCKET.FULL || r.bucket === ORDER_BUCKET.PARTIAL

// SO/CO headline counts for a set of order rows (exported for cached views)
export function computeCounts(orderRows) {
  return {
    so: orderRows.filter(r => r.order_type === 'SO' && isOrderDispatchable(r)).length,
    co: orderRows.filter(r => r.order_type === 'CO' && isOrderDispatchable(r)).length,
    soTotal: orderRows.filter(r => r.order_type === 'SO').length,
    coTotal: orderRows.filter(r => r.order_type === 'CO').length,
  }
}

export function allocateFifo(orders, stockMapResult) {
  const { stock } = stockMapResult
  // working copy — allocation must not mutate the caller's map
  const pool = {}
  for (const code of Object.keys(stock)) pool[code] = { ...stock[code] }

  const lines = []
  for (const o of orders || []) {
    if (TERMINAL.includes(o.status)) continue
    for (const it of o.order_items || []) {
      if (it.line_status === 'cancelled') continue
      const pend = pendQty(it)
      if (pend <= 0) continue
      lines.push({
        order_id: o.id,
        order_number: o.order_number,
        order_date: o.order_date || null,
        customer_name: o.customer_name,
        owner: o.account_owner || o.engineer_name || '',
        order_type: o.order_type || 'SO',
        order_status: o.status,
        hold_party: o.hold_party || null,
        hold_reason: o.hold_reason || null,
        partials_allowed: o.partial_deliveries_allowed === true,
        preferred_loc: LOCATIONS.includes(o.fulfilment_center) ? o.fulfilment_center : 'Kaveri',
        sr_no: it.sr_no || 0,
        item_code: it.item_code,
        unit_price: it.unit_price_after_disc || 0,
        pend,
      })
    }
  }

  lines.sort(fifoCompare)

  for (const l of lines) {
    const avail = pool[l.item_code] // EXACT key — the only lookup in the system
    if (!avail) {
      l.alloc = 0; l.from_kaveri = 0; l.from_godawari = 0
      l.bucket = BUCKET.NOT_IN_SHEET
      l.near_miss = !!stockMapResult.normIndex[normCode(l.item_code)]
      continue
    }
    const other = l.preferred_loc === 'Kaveri' ? 'Godawari' : 'Kaveri'
    const takePref = Math.min(avail[l.preferred_loc], l.pend)
    const takeOther = Math.min(avail[other], l.pend - takePref)
    avail[l.preferred_loc] -= takePref
    avail[other] -= takeOther
    l.from_kaveri = l.preferred_loc === 'Kaveri' ? takePref : takeOther
    l.from_godawari = l.preferred_loc === 'Godawari' ? takePref : takeOther
    l.alloc = takePref + takeOther
    l.near_miss = false
    l.bucket = l.alloc === 0 ? BUCKET.NO_STOCK : l.alloc < l.pend ? BUCKET.PARTIAL : BUCKET.FULL
  }

  // ── Order rollup ──
  const byOrder = new Map()
  for (const l of lines) {
    if (!byOrder.has(l.order_id)) byOrder.set(l.order_id, [])
    byOrder.get(l.order_id).push(l)
  }
  const orderRows = []
  for (const [, ls] of byOrder) {
    const first = ls[0]
    const bucket = deriveOrderBucket(ls, first.partials_allowed)
    const fromK = ls.reduce((s, l) => s + l.from_kaveri, 0)
    const fromG = ls.reduce((s, l) => s + l.from_godawari, 0)
    orderRows.push({
      order_id: first.order_id,
      order_number: first.order_number,
      order_date: first.order_date,
      customer_name: first.customer_name,
      owner: first.owner,
      order_type: first.order_type,
      order_status: first.order_status,
      hold_party: first.hold_party,
      hold_reason: first.hold_reason,
      partials_allowed: first.partials_allowed,
      bucket,
      lines: ls,
      line_count: ls.length,
      covered_lines: ls.filter(l => l.bucket === BUCKET.FULL).length,
      pend_qty: ls.reduce((s, l) => s + l.pend, 0),
      alloc_qty: ls.reduce((s, l) => s + l.alloc, 0),
      alloc_value: ls.reduce((s, l) => s + l.alloc * l.unit_price, 0),
      from_kaveri: fromK,
      from_godawari: fromG,
      stock_loc: fromK > 0 && fromG > 0 ? 'Both' : fromK > 0 ? 'Kaveri' : fromG > 0 ? 'Godawari' : '—',
    })
  }
  orderRows.sort(fifoCompare)

  // ── Reconciliation — every pending line accounted for, or the caller must
  // show an error instead of the list. This is the no-silent-drop invariant. ──
  const bucketCounts = { full: 0, partial: 0, no_stock: 0, not_in_sheet: 0 }
  for (const l of lines) bucketCounts[l.bucket]++
  const reconciled =
    bucketCounts.full + bucketCounts.partial + bucketCounts.no_stock + bucketCounts.not_in_sheet === lines.length

  return {
    lines,
    orders: orderRows,
    bucketCounts,
    reconciled,
    nearMissCount: lines.filter(l => l.near_miss).length,
    counts: computeCounts(orderRows),
  }
}
