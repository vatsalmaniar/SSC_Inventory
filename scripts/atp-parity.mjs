// ATP parity harness — proves the server-side allocation (sql/atp_allocation.sql)
// returns exactly what the browser implementation (src/lib/dispatchability.js)
// returns, on real data. Run it before trusting any change to either.
//
// Compares, per order AND per line: bucket, allocation, warehouse split,
// coverage, alloc_value, stock_loc, near-miss flag, plus the headline counts,
// bucket counts and the reconciliation invariant.
//
// Last run 2026-09-01: 466 orders / 1,334 lines / 0 differences.
//
// USAGE — from the repo root, with a Supabase Management API PAT:
//   REF=kvjihrlbntxcdadogmhn
//   q(){ curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
//        -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
//        --data-binary @<(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1"); }
//
//   # inputs the page feeds allocateFifo (live, non-SAMPLE, this FY)
//   q "select coalesce(json_agg(x),'[]'::json) d from (
//        select o.id,o.order_number,o.customer_name,o.account_owner,o.engineer_name,
//               o.order_date,o.order_type,o.status,o.partial_deliveries_allowed,
//               o.hold_party,o.hold_reason,o.fulfilment_center,
//               coalesce((select json_agg(json_build_object('id',i.id,'sr_no',i.sr_no,
//                 'item_code',i.item_code,'qty',i.qty,'dispatched_qty',i.dispatched_qty,
//                 'cancelled_qty',i.cancelled_qty,'line_status',i.line_status,
//                 'unit_price_after_disc',i.unit_price_after_disc))
//                 from order_items i where i.order_id=o.id),'[]'::json) as order_items
//        from orders o where o.is_test=false and o.created_at >= '<FY_START>'
//          and o.status not in ('dispatched_fc','closed','cancelled')
//          and o.order_type <> 'SAMPLE') x" > js_orders.json   # unwrap [0].d
//   q "select coalesce(json_agg(x),'[]'::json) d from
//        (select product_code,quantity,location,updated_at from inventory) x" > js_inv.json
//   q "select atp_allocation(false) r" > rpc.json               # unwrap [0].r
//
//   node scripts/atp-parity.mjs        # expects the three files in cwd
//
// Required result: "PARITY CLEAN — 0 differences".
import { readFileSync } from 'fs'
import { buildStockMap, allocateFifo } from '../src/lib/dispatchability.js'

const orders = JSON.parse(readFileSync('js_orders.json'))
const inv    = JSON.parse(readFileSync('js_inv.json'))
const rpc    = JSON.parse(readFileSync('rpc.json'))

const js = allocateFifo(orders, buildStockMap(inv))

const n = (v) => Number(v ?? 0)
let diffs = 0, checked = 0
const jsById  = new Map(js.orders.map(o => [o.order_id, o]))
const rpcById = new Map(rpc.orders.map(o => [o.order_id, o]))

// 1. same set of orders
for (const id of jsById.keys()) if (!rpcById.has(id)) { console.log('  MISSING in RPC:', jsById.get(id).order_number); diffs++ }
for (const id of rpcById.keys()) if (!jsById.has(id)) { console.log('  EXTRA in RPC:', rpcById.get(id).order_number); diffs++ }

// 2. order-level fields
const OF = ['bucket','line_count','covered_lines','pend_qty','alloc_qty','from_kaveri','from_godawari','stock_loc','partials_allowed']
for (const [id, a] of jsById) {
  const b = rpcById.get(id); if (!b) continue
  checked++
  for (const f of OF) {
    const x = typeof a[f] === 'number' ? n(a[f]) : a[f]
    const y = typeof a[f] === 'number' ? n(b[f]) : b[f]
    if (String(x) !== String(y)) { console.log(`  ORDER ${a.order_number} ${f}: js=${x} rpc=${y}`); diffs++ }
  }
  if (Math.abs(n(a.alloc_value) - n(b.alloc_value)) > 0.01) {
    console.log(`  ORDER ${a.order_number} alloc_value: js=${n(a.alloc_value)} rpc=${n(b.alloc_value)}`); diffs++
  }
  // 3. line-level
  const al = [...a.lines].sort((p,q)=> (p.sr_no-q.sr_no) || p.item_code.localeCompare(q.item_code))
  const bl = [...b.lines].sort((p,q)=> (p.sr_no-q.sr_no) || p.item_code.localeCompare(q.item_code))
  if (al.length !== bl.length) { console.log(`  ORDER ${a.order_number} line count ${al.length} vs ${bl.length}`); diffs++; continue }
  for (let i=0;i<al.length;i++) {
    for (const f of ['item_code','pend','alloc','from_kaveri','from_godawari','bucket','near_miss']) {
      const x = typeof al[i][f]==='number'? n(al[i][f]) : al[i][f]
      const y = typeof al[i][f]==='number'? n(bl[i][f]) : bl[i][f]
      if (String(x) !== String(y)) { console.log(`  LINE ${a.order_number}#${al[i].sr_no} ${f}: js=${x} rpc=${y}`); diffs++ }
    }
  }
}
console.log(`\n  orders compared      : ${checked}`)
console.log(`  js counts            : ${JSON.stringify(js.counts)}`)
console.log(`  rpc counts           : ${JSON.stringify(rpc.counts)}`)
console.log(`  js bucketCounts      : ${JSON.stringify(js.bucketCounts)}`)
console.log(`  rpc bucketCounts     : ${JSON.stringify(rpc.bucketCounts)}`)
console.log(`  js nearMiss/reconciled : ${js.nearMissCount} / ${js.reconciled}`)
console.log(`  rpc nearMiss/reconciled: ${rpc.nearMissCount} / ${rpc.reconciled}`)
// key ORDER differs between JS object literals and jsonb_build_object — compare by value
const sameCounts = ['so','co','soTotal','coTotal'].every(k => n(js.counts[k]) === n(rpc.counts[k]))
if (!sameCounts) { console.log('  COUNTS DIFFER'); diffs++ }
const sameBuckets = ['full','partial','no_stock','not_in_sheet']
  .every(k => n(js.bucketCounts[k]) === n(rpc.bucketCounts[k]))
if (!sameBuckets) { console.log('  BUCKET COUNTS DIFFER'); diffs++ }
if (n(js.nearMissCount) !== n(rpc.nearMissCount)) { console.log('  NEARMISS DIFFERS'); diffs++ }
if (js.reconciled !== rpc.reconciled) { console.log('  RECONCILED DIFFERS'); diffs++ }
console.log(`\n  ${diffs === 0 ? 'PARITY CLEAN — 0 differences' : diffs + ' DIFFERENCES'}`)
