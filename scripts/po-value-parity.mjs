// Purchase-order value consistency check — the same guard as
// scripts/orders-value-parity.mjs, for the PO side.
//
// What it exists to catch: the PO list's on-screen "pending" figure and the
// Detailed Excel export's pending_value column drifting apart, which is exactly
// how the sales-side value bugs landed three times (see orderValue.js header).
// Both now call src/lib/poValue.js, and this asserts that what that library
// computes over the LIVE dataset equals what SQL computes independently.
//
// It also pins the one trap this data actually contains: EVERY po_items row has
// unit_price_after_disc = 0.00 (verified 2026-09-01, 4,959/4,959 rows), so the
// real price comes from the unit_price fallback. JS `0 || x` falls through and
// gets this right; SQL `coalesce` does NOT, because coalesce only skips NULL.
// Any SQL that reprices a PO line must use nullif(col,0) — the check below
// fails loudly if someone writes the coalesce version.
//
// USAGE — from the repo root, with a Management API PAT in $PAT:
//   REF=kvjihrlbntxcdadogmhn
//   q(){ curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
//        -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
//        --data-binary @<(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1"); }
//   q "select coalesce(json_agg(x),'[]'::json) d from (
//        select p.id, p.status,
//          coalesce((select json_agg(json_build_object('qty',i.qty,'received_qty',i.received_qty,
//            'unit_price',i.unit_price,'unit_price_after_disc',i.unit_price_after_disc,
//            'lp_unit_price',i.lp_unit_price)) from po_items i where i.po_id=p.id),'[]'::json) as po_items
//        from purchase_orders p
//        where coalesce(p.is_test,false)=false and p.created_at >= '<FY_START>') x"  > pv_pos.json
//   node scripts/po-value-parity.mjs

import { readFileSync } from 'node:fs'
import { poPendingValue, posPendingValue, poUnitPrice } from '../src/lib/poValue.js'

const pos = JSON.parse(readFileSync('pv_pos.json', 'utf8'))[0].d
const r2 = n => Math.round(n * 100) / 100

// Independent re-implementation — deliberately NOT importing the library, so a
// bug inside poValue.js cannot agree with itself.
const sqlLike = p => p.status === 'cancelled' ? 0 : (p.po_items || []).reduce((s, i) => {
  const unit = [i.unit_price_after_disc, i.unit_price, i.lp_unit_price]
    .map(Number).find(v => v) || 0                       // first NON-ZERO, like JS ||
  return s + Math.max(0, (Number(i.qty) || 0) - (Number(i.received_qty) || 0)) * unit
}, 0)

let bad = 0
for (const p of pos) {
  if (r2(poPendingValue(p)) !== r2(sqlLike(p))) {
    if (bad++ < 10) console.log(`  MISMATCH ${p.id}: lib ${r2(poPendingValue(p))} vs ref ${r2(sqlLike(p))}`)
  }
}

const libTotal = r2(posPendingValue(pos))
const refTotal = r2(pos.reduce((s, p) => s + sqlLike(p), 0))

// The coalesce trap, asserted rather than trusted: if unit_price_after_disc were
// ever read with coalesce semantics, pending would collapse toward zero.
const coalesceTotal = r2(pos.reduce((s, p) => p.status === 'cancelled' ? s : s + (p.po_items || [])
  .reduce((t, i) => {
    const c = [i.unit_price_after_disc, i.unit_price, i.lp_unit_price].find(v => v !== null && v !== undefined)
    return t + Math.max(0, (Number(i.qty) || 0) - (Number(i.received_qty) || 0)) * (Number(c) || 0)
  }, 0), 0))

console.log(`POs                 : ${pos.length}`)
console.log(`poValue.js pending  : ₹${libTotal.toLocaleString('en-IN')}`)
console.log(`independent pending : ₹${refTotal.toLocaleString('en-IN')}`)
console.log(`coalesce(0-blind)   : ₹${coalesceTotal.toLocaleString('en-IN')}  <- what the WRONG SQL gives`)
console.log(`per-PO mismatches   : ${bad}`)

if (bad || libTotal !== refTotal) { console.log('\nFAIL'); process.exit(1) }
console.log('\nPASS — every PO agrees.')
