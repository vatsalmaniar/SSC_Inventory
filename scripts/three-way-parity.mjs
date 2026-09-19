// Three-way-match parity check — the same guard as scripts/po-value-parity.mjs
// and scripts/orders-value-parity.mjs, for the inward-billing match.
//
// WHAT IT EXISTS TO CATCH. The verdict is computed twice on purpose: SQL
// (public.pi_record_match) computes the one that gets STORED, because a rule
// enforced only in React is bypassable straight through PostgREST. JS
// (src/lib/threeWayMatch.js) computes the one the screen shows BEFORE you submit.
// If those two ever disagree, accounts sees "within tolerance" and the database
// records "over tolerance" — or worse, the reverse. This asserts they agree over
// the live dataset.
//
// IT ALSO PINS THE TRAP THIS DATA CONTAINS. Every po_items row has
// unit_price_after_disc = 0.00 — verified again 2026-09-19 on the Connectwell
// line: after_disc 0, unit_price 132.76, lp_unit_price 179.40. JS `0 || x` falls
// through and is right. SQL coalesce() does NOT, because it only skips NULL, so
// it returns the 0 and every bill reads as a 100% over-bill. Check 2 below fails
// loudly if anyone writes the coalesce version.
//
// USAGE — from the repo root, with a Management API PAT in $PAT:
//
//   REF=kvjihrlbntxcdadogmhn
//   q(){ curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
//        -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
//        --data-binary @<(python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1"); }
//
//   # (a) every GRN line, with the raw price columns AND what SQL prices it at
//   q "select coalesce(json_agg(x),'[]'::json) d from (
//        select gi.id as grn_item_id, gi.item_code,
//               coalesce(gi.accepted_qty, gi.received_qty, 0) as accepted_qty,
//               p.unit_price, p.unit_price_after_disc, p.lp_unit_price,
//               public.po_item_unit_price(gi.po_item_id) as sql_unit_price,
//               coalesce(p.unit_price_after_disc, p.unit_price, p.lp_unit_price, 0)
//                 as sql_unit_price_coalesce_BAD
//          from grn_items gi
//          left join po_items p on p.id = gi.po_item_id
//          join grn g on g.id = gi.grn_id
//         where g.grn_type='po_inward' and g.status <> 'cancelled'
//           and coalesce(g.is_test,false)=false) x" > tw_lines.json
//
//   # (b) the tolerance actually configured
//   q "select coalesce(json_agg(t),'[]'::json) d from three_way_tolerance t" > tw_tol.json
//
//   node scripts/three-way-parity.mjs

import { readFileSync } from 'node:fs'
import { basisUnitPrice, lineVerdict, billVerdict, landedUnitPrice } from '../src/lib/threeWayMatch.js'

const lines = JSON.parse(readFileSync('tw_lines.json', 'utf8'))[0].d
const tol   = JSON.parse(readFileSync('tw_tol.json',   'utf8'))[0].d[0]

const r2 = n => Math.round(n * 100) / 100
let fail = 0
const bad = (msg) => { console.log('  ✗ ' + msg); fail++ }

console.log(`\nthree-way-match parity — ${lines.length} GRN lines, tolerance:`)
console.log(`  over ${tol.rate_tol_pct_over}%  under ${tol.rate_tol_pct_under}%  ` +
            `floor ₹${tol.rate_tol_abs}  ignore ₹${tol.rate_tol_abs_ignore}  mode ${tol.mode}\n`)

// ── 1. JS price basis must equal SQL's, line for line ─────────────────────
console.log('1. price basis: src/lib/poValue.js poUnitPrice() vs SQL po_item_unit_price()')
let mismatch = 0, priced = 0, noBasis = 0
for (const l of lines) {
  const js  = basisUnitPrice(l)            // null when there is no basis
  const sql = Number(l.sql_unit_price) || 0
  if (js === null) { noBasis++; if (sql !== 0) { mismatch++; bad(`${l.item_code}: JS null, SQL ${sql}`) }; continue }
  priced++
  if (r2(js) !== r2(sql)) { mismatch++; if (mismatch <= 5) bad(`${l.item_code}: JS ${js} vs SQL ${sql}`) }
}
console.log(`   ${priced} priced, ${noBasis} without a basis, ${mismatch} mismatched`)
if (!mismatch) console.log('   ✓ identical\n'); else console.log('')

// ── 2. THE TRAP: the coalesce() version must be provably wrong ─────────────
console.log('2. the nullif trap — what plain coalesce() would have priced these at')
const zeroed = lines.filter(l => l.po_item_id !== null || l.unit_price !== null)
  .filter(l => Number(l.sql_unit_price_coalesce_BAD) === 0 && Number(l.sql_unit_price) > 0)
const valCorrect = lines.reduce((s, l) => s + (Number(l.accepted_qty)||0) * (Number(l.sql_unit_price)||0), 0)
const valCoalesce = lines.reduce((s, l) => s + (Number(l.accepted_qty)||0) * (Number(l.sql_unit_price_coalesce_BAD)||0), 0)
console.log(`   correct  (nullif):   ₹${valCorrect.toLocaleString('en-IN', {maximumFractionDigits:0})}`)
console.log(`   coalesce (WRONG):    ₹${valCoalesce.toLocaleString('en-IN', {maximumFractionDigits:0})}`)
console.log(`   lines the coalesce version would price at ₹0: ${zeroed.length}`)
if (zeroed.length === 0 && lines.length > 0) {
  bad('expected coalesce() to zero out lines — has unit_price_after_disc been populated? ' +
      'If so, re-read this check: the nullif rule is still correct, but the trap no longer bites ' +
      'and this assertion needs updating deliberately, not deleting.')
} else {
  console.log('   ✓ trap confirmed — SQL must use nullif(), never coalesce()\n')
}

// ── 3. Verdict arithmetic, re-implemented independently ───────────────────
// Deliberately NOT importing lineVerdict for the expected side, so a bug inside
// threeWayMatch.js cannot agree with itself.
console.log('3. verdict arithmetic vs an independent re-implementation')
const independent = ({ m, bq, pp, ip }) => {
  if (!pp || ip === null) return 'no_basis'
  const d = ip - pp
  if (bq > m * (1 + Number(tol.qty_tol_pct) / 100)) return 'over_tolerance'
  if (Math.abs(d) <= Number(tol.rate_tol_abs_ignore)) return 'matched'
  const band = Math.max(Number(tol.rate_tol_abs),
    pp * (d > 0 ? Number(tol.rate_tol_pct_over) : Number(tol.rate_tol_pct_under)) / 100)
  return Math.abs(d) <= band ? 'within_tolerance' : 'over_tolerance'
}

// Exercise each priced line at five rates: exact, +-inside the band, +-outside.
let cases = 0, disagree = 0
for (const l of lines) {
  const pp = basisUnitPrice(l); if (pp === null) continue
  const m  = Number(l.accepted_qty) || 0
  for (const ip of [pp, pp + 0.05, pp * 1.005, pp * 0.90, pp * 1.30]) {
    cases++
    const got  = lineVerdict({ matchedQty: m, billedQty: m, poPrice: pp, invPrice: ip, tol }).status
    const want = independent({ m, bq: m, pp, ip })
    if (got !== want) { disagree++; if (disagree <= 5) bad(`${l.item_code} @ ${r2(ip)} vs ${pp}: got ${got}, want ${want}`) }
  }
  // and the over-delivery case: billed 10% more than accepted, at the right rate
  cases++
  const gotQ  = lineVerdict({ matchedQty: m, billedQty: m * 1.1, poPrice: pp, invPrice: pp, tol }).status
  const wantQ = independent({ m, bq: m * 1.1, pp, ip: pp })
  if (gotQ !== wantQ) { disagree++; if (disagree <= 5) bad(`${l.item_code} qty ${m}->${m*1.1}: got ${gotQ}, want ${wantQ}`) }
}
console.log(`   ${cases} cases, ${disagree} disagreements`)
if (!disagree) console.log('   ✓ identical\n'); else console.log('')

// ── 4. The decomposition must be exact ────────────────────────────────────
// billed - expected === rateVariance + qtyVariance, to the paisa. If this drifts
// the two numbers on screen stop adding up to the total and nobody trusts either.
console.log('4. billed - expected === rate variance + qty variance')
let drift = 0
for (const l of lines.slice(0, 2000)) {
  const pp = basisUnitPrice(l); if (pp === null) continue
  const m = Number(l.accepted_qty) || 0
  const v = lineVerdict({ matchedQty: m, billedQty: m + 7, poPrice: pp, invPrice: pp * 0.87, tol })
  const lhs = v.billed - v.expected
  const rhs = v.rateVariance + v.qtyVariance
  // Compared UNROUNDED with a relative epsilon. Rounding each side to 2dp first
  // reports a spurious 1-paisa gap whenever the two floats straddle a half-paisa
  // boundary — which they did on T4VH335-20Z-RVA and SSTB151508. The identity is
  // exact in real arithmetic; only the float representation differs.
  const eps = 1e-6 * Math.max(1, Math.abs(lhs))
  if (Math.abs(lhs - rhs) > eps) { drift++; if (drift <= 3) bad(`${l.item_code}: ${lhs} vs ${rhs}`) }
}
console.log(drift ? '' : '   ✓ exact on every line\n')

// ── 5. The Connectwell case, pinned ───────────────────────────────────────
// The whole reason this exists. PO 179.40 less 26% = 132.76; the vendor billed
// 179.40 less 40% = 107.64. The bill advanced anyway on a typed note reading
// "Mismatch in Price".
console.log('5. the case that started this — PCO0816 / CP4/4(E)D1, 100 pcs')
const cw = billVerdict([{ matchedQty: 100, billedQty: 100, poPrice: 132.76, invPrice: 107.64 }], tol)
console.log(`   expected ₹${r2(cw.expected)}  billed ₹${r2(cw.billed)}  variance ₹${r2(cw.varianceAmount)}`)
console.log(`   status ${cw.status}  worst line ${r2(cw.worstLinePct)}%  needsOverride ${cw.needsOverride}`)
if (cw.status !== 'over_tolerance') bad(`Connectwell must be over_tolerance, got ${cw.status}`)
if (r2(cw.varianceAmount) !== -2512) bad(`Connectwell variance must be -2512.00, got ${r2(cw.varianceAmount)}`)
if (!cw.needsOverride) bad('Connectwell must require an override')
if (r2(cw.rateVariance) !== -2512) bad(`rate variance must carry all of it, got ${r2(cw.rateVariance)}`)
if (r2(cw.qtyVariance) !== 0) bad(`qty variance must be 0, got ${r2(cw.qtyVariance)}`)

// and the over-delivery case: same rate, 10 extra billed -> ALL of it is qty
const od = billVerdict([{ matchedQty: 100, billedQty: 110, poPrice: 132.76, invPrice: 132.76 }], tol)
if (od.status !== 'over_tolerance') bad(`over-delivery must be over_tolerance, got ${od.status}`)
if (r2(od.rateVariance) !== 0) bad(`over-delivery rate variance must be 0, got ${r2(od.rateVariance)}`)
if (r2(od.qtyVariance) !== 1327.6) bad(`over-delivery qty variance must be 1327.60, got ${r2(od.qtyVariance)}`)
console.log(`   over-delivery 110 vs 100: rate ₹${r2(od.rateVariance)}  qty ₹${r2(od.qtyVariance)}  ${od.status}`)

// ── 6. landedUnitPrice must not silently fall back over a real invoice rate ──
console.log('\n6. landedUnitPrice — invoice rate wins, PO rate is the fallback')
if (landedUnitPrice({ unit_price: 132.76 }, { inv_unit_price: 107.64 }) !== 107.64)
  bad('a real invoice rate must win')
if (landedUnitPrice({ unit_price: 132.76 }, null) !== 132.76)
  bad('with no invoice line, the PO rate must be used')
if (landedUnitPrice({ unit_price: 132.76 }, { inv_unit_price: 0 }) !== 132.76)
  bad('a zero invoice rate is not a price — must fall back to the PO rate')
console.log('   ✓ ok')

console.log(fail ? `\n✗ ${fail} FAILED\n` : '\n✓ all parity checks passed\n')
process.exit(fail ? 1 : 0)
