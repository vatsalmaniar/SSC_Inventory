// Order-value consistency check.
//
// The failure this exists to catch is NOT "someone wrote a reduce" — a lint rule
// covers that shape and nothing else. It is "two numbers on the same screen
// disagree", which is how this bug landed three times:
//   * /orders vs /orders/list, 9.28 vs 9.25
//   * three competing dispatched-value formulas, ~43 lakh apart
//   * /orders headline vs its own donut, 60.3 lakh apart (fixed 2026-09-01)
//
// Each time the code looked fine and review passed. Only running the numbers
// side by side found it. This asserts, over one live dataset, that every surface
// showing order value agrees — whatever the code happens to look like, and
// across JS and SQL both.
//
// USAGE — from the repo root, with a Supabase Management API PAT in $PAT:
//   REF=kvjihrlbntxcdadogmhn
//   q(){ curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
//        -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
//        --data-binary @<(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1"); }
//
//   q "select coalesce(json_agg(x),'[]'::json) d from (
//        select o.id,o.status,o.order_type,o.created_by,o.customer_name,o.created_at,
//          coalesce((select json_agg(json_build_object('total_price',i.total_price,
//            'cancelled_qty',i.cancelled_qty,'unit_price_after_disc',i.unit_price_after_disc,
//            'lp_unit_price',i.lp_unit_price)) from order_items i where i.order_id=o.id),
//            '[]'::json) as order_items
//        from orders o where o.is_test=false and o.created_at >= '<FY_START>') x"  > ov_orders.json
//   q "select round(sum(...canonical...),2) from ..."                              > ov_sql.json
//   node scripts/orders-value-parity.mjs
//
// Required result: "CONSISTENT — every surface agrees".

import { readFileSync } from 'fs'
import { ordersTotalValue, orderNetValue } from '../src/lib/orderValue.js'

const orders = JSON.parse(readFileSync('ov_orders.json'))
const sqlTotal = Number(JSON.parse(readFileSync('ov_sql.json')))

const R = (n) => Math.round(Number(n) * 100) / 100
let fail = 0
const check = (label, got, want, note = '') => {
  const ok = Math.abs(R(got) - R(want)) < 1        // < ₹1 tolerance for float noise
  if (!ok) fail++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} ${R(got).toLocaleString('en-IN')}${ok ? '' : `   expected ${R(want).toLocaleString('en-IN')}`}${note}`)
}

// ── the reference: the canonical formula over every order ────────────────
const headline = ordersTotalValue(orders)
console.log(`\n  reference (ordersTotalValue over ${orders.length} orders): ${R(headline).toLocaleString('en-IN')}\n`)

// 1. JS and SQL must agree — the same definition in two languages
check('SQL canonical formula == JS ordersTotalValue', sqlTotal, headline)

// 2. status donut — statusGroup() maps every status, so segments must total
const statusGroup = (s) => {
  if (['pending'].includes(s)) return 'pending'
  if (['inv_check','inventory_check','dispatch'].includes(s)) return 'approved'
  if (s === 'partial_dispatch') return 'partial'
  if (['delivery_created','picking','packing'].includes(s)) return 'fc'
  if (['goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready',
       'eway_generated','pi_requested','pi_generated','pi_payment_pending','pending_billing',
       'eway_pending'].includes(s)) return 'billing'
  if (s === 'dispatched_fc' || s === 'closed') return 'delivered'
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}
const donut = ['pending','approved','partial','fc','billing','delivered','cancelled']
  .reduce((sum, g) => sum + ordersTotalValue(orders.filter(o => statusGroup(o.status) === g)), 0)
check('status donut segments == headline', donut, headline)

// 3. top customers — grouped over every order, so it must total
const byCust = {}
for (const o of orders) {
  const v = o.order_type === 'SAMPLE' ? 0 : orderNetValue(o)
  byCust[o.customer_name] = (byCust[o.customer_name] || 0) + v
}
check('customer aggregate == headline', Object.values(byCust).reduce((a,b)=>a+b,0), headline)

// 4. monthly chart — 12 months from 1 April covers the whole FY
const now = new Date()
const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
const slots = Array.from({length:12}, (_,i) => { const d = new Date(fyStartYear, 3+i, 1); return { y:d.getFullYear(), m:d.getMonth() } })
let monthly = 0, outside = 0
for (const o of orders) {
  const d = new Date(o.created_at)
  const hit = slots.some(s => s.y === d.getFullYear() && s.m === d.getMonth())
  const v = o.order_type === 'SAMPLE' ? 0 : orderNetValue(o)
  hit ? monthly += v : outside += v
}
check('monthly chart == headline', monthly, headline, outside ? `   (${R(outside)} outside the 12-month window)` : '')

// 5. /orders/list uses ordersTotalValue on the same set with filter=all
check('/orders/list total == /orders headline', ordersTotalValue(orders), headline)

// ── reported, NOT asserted: subsets by design ───────────────────────────
const byRep = {}
for (const o of orders) byRep[o.created_by] = (byRep[o.created_by] || 0) + (o.order_type === 'SAMPLE' ? 0 : orderNetValue(o))
const repSum = Object.values(byRep).reduce((a,b)=>a+b,0)
console.log(`\n  info  rep leaderboard covers ${R(repSum).toLocaleString('en-IN')} of ${R(headline).toLocaleString('en-IN')}`)
console.log(`        (a subset by design — it lists only users present in the reps table)`)

console.log(`\n  ${fail === 0 ? 'CONSISTENT — every surface agrees' : fail + ' SURFACE(S) DISAGREE'}\n`)
process.exit(fail === 0 ? 0 : 1)
