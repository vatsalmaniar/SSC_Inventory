// Unit tests for the purchase-price rules. No test runner needed:
//
//     node src/lib/itemPricingRules.test.mjs
//
// Run this after ANY change to itemPricingRules.js. These rules decide what we
// pay a vendor; a silent regression here is money.

import { resolveFromRows, pickBestSpecial, isEligible, localToday } from './itemPricingRules.js'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else    { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`) }
}

const TODAY = '2026-08-11'
const CUST_A = 'cust-a', CUST_B = 'cust-b'
const comm = { list_price: '100000.00', standard_discount_pct: '64.00', discount_group: 'Servo - All Series' }
const commNoDisc = { list_price: '50000.00', standard_discount_pct: null, discount_group: null }

const sp = (o) => ({ price_scope: 'STOCK', customer_id: null, project_ref: null, amount: 0, min_qty: 1, valid_from: '2026-04-01', valid_to: null, ...o })
const ctx = (o = {}) => ({ today: TODAY, qty: 1, customerId: null, projectRef: null, ...o })

console.log('\nPRECEDENCE')
{
  const rows = [
    sp({ price_scope: 'STOCK',    amount: 30000 }),
    sp({ price_scope: 'CUSTOMER', amount: 28000, customer_id: CUST_A }),
    sp({ price_scope: 'PROJECT',  amount: 25000, customer_id: CUST_A, project_ref: 'ADANI-HYD21' }),
  ]
  t('project beats customer beats stock',
    pickBestSpecial(rows, ctx({ customerId: CUST_A, projectRef: 'ADANI-HYD21' })).amount, 25000)
  t('customer wins when no project on the line',
    pickBestSpecial(rows, ctx({ customerId: CUST_A })).amount, 28000)
  t('stock (blanket) applies to a customer with no special of their own',
    pickBestSpecial(rows, ctx({ customerId: CUST_B })).amount, 30000)
  t('stock applies to a stock line (no customer at all)',
    pickBestSpecial(rows, ctx()).amount, 30000)
}

console.log('\nLEAKAGE — the dangerous cases')
{
  const rows = [sp({ price_scope: 'CUSTOMER', amount: 20000, customer_id: CUST_A })]
  t("customer A's rate must NOT reach customer B", pickBestSpecial(rows, ctx({ customerId: CUST_B })), null)
  t("customer rate must NOT reach a stock line",   pickBestSpecial(rows, ctx()), null)
}
{
  const rows = [sp({ price_scope: 'PROJECT', amount: 19000, customer_id: CUST_A, project_ref: 'P1' })]
  t('project rate needs the matching project', pickBestSpecial(rows, ctx({ customerId: CUST_A, projectRef: 'P2' })), null)
  t('project rate needs the matching customer', pickBestSpecial(rows, ctx({ customerId: CUST_B, projectRef: 'P1' })), null)
}

console.log('\nQUANTITY SCALES')
{
  const rows = [
    sp({ amount: 36000, min_qty: 1 }),
    sp({ amount: 34000, min_qty: 50 }),
    sp({ amount: 32000, min_qty: 100 }),
  ]
  t('qty 1   → the qty-1 rung',   pickBestSpecial(rows, ctx({ qty: 1 })).amount, 36000)
  t('qty 49  → still the qty-1 rung', pickBestSpecial(rows, ctx({ qty: 49 })).amount, 36000)
  t('qty 50  → the 50 rung',      pickBestSpecial(rows, ctx({ qty: 50 })).amount, 34000)
  t('qty 99  → still the 50 rung', pickBestSpecial(rows, ctx({ qty: 99 })).amount, 34000)
  t('qty 500 → the 100 rung',     pickBestSpecial(rows, ctx({ qty: 500 })).amount, 32000)
  t('a more specific scope beats a deeper scale of a weaker scope',
    pickBestSpecial([sp({ amount: 30000, min_qty: 100 }),
                     sp({ price_scope: 'CUSTOMER', customer_id: CUST_A, amount: 35000, min_qty: 1 })],
      ctx({ qty: 500, customerId: CUST_A })).amount, 35000)
}

console.log('\nVALIDITY WINDOW')
{
  t('not yet started',  isEligible(sp({ valid_from: '2026-12-01' }), ctx()), false)
  t('starts today',     isEligible(sp({ valid_from: TODAY }), ctx()), true)
  t('expired',          isEligible(sp({ valid_to: '2026-08-10' }), ctx()), false)
  t('ends today',       isEligible(sp({ valid_to: TODAY }), ctx()), true)
  t('open ended',       isEligible(sp({ valid_to: null }), ctx()), true)
}

console.log('\nFALLBACK TO STANDARD')
{
  const r = resolveFromRows({ commercials: comm, specials: [], qty: 1, today: TODAY })
  t('standard discount applied', [r.source, r.discountPct, r.unitPrice], ['STANDARD', 64, 36000])
  const n = resolveFromRows({ commercials: commNoDisc, specials: [], qty: 1, today: TODAY })
  t('superseded series → list price, no invented discount',
    [n.source, n.discountPct, n.unitPrice], ['STANDARD', null, 50000])
  t('no list price on file → null, caller leaves the line alone',
    resolveFromRows({ commercials: null, specials: [], today: TODAY }), null)
}

console.log('\nDERIVED DISCOUNT')
{
  const r = resolveFromRows({ commercials: comm, specials: [sp({ amount: 28000 })], qty: 1, today: TODAY })
  t('special back-computes its discount off list', [r.source, r.discountPct, r.unitPrice], ['STOCK', 72, 28000])
}

console.log('\nLOCAL DATE (the IST/UTC trap)')
{
  // 00:30 IST on 12 Aug — toISOString() would say 11 Aug and wrongly exclude a
  // special that starts on the 12th.
  const early = new Date(2026, 7, 12, 0, 30, 0)
  t('local date, not UTC', localToday(early), '2026-08-12')
}

console.log('\nEXACT AMOUNT — never rebuild a price from a rounded percentage')
{
  // The real case: LP 1,970 with a negotiated 1,500. The derived discount is
  // 23.9% to one decimal; 1970 × (1 − 0.239) = 1,499.17. The special IS 1,500.
  const r = resolveFromRows({ commercials: { list_price: 1970, standard_discount_pct: 20 },
    specials: [sp({ price_scope: 'CUSTOMER', customer_id: CUST_A, amount: 1500 })],
    qty: 1, customerId: CUST_A, today: TODAY })
  t('the special amount survives exactly', r.unitPrice, 1500)
  t('rebuilding from the rounded pct would have lost money',
    Number((r.listPrice * (1 - r.discountPct / 100)).toFixed(2)) === r.unitPrice, false)
  t('a special is flagged as fixed-amount (not STANDARD)', r.source, 'CUSTOMER')

  // A STANDARD price is exact under the same arithmetic, so it needs no fixing.
  const s = resolveFromRows({ commercials: { list_price: 20653, standard_discount_pct: 10 },
    specials: [], qty: 1, today: TODAY })
  t('standard: list × (1 − pct) is exact', s.unitPrice, 18587.7)
  t('standard: recomputing gives the same number',
    Number((s.listPrice * (1 - s.discountPct / 100)).toFixed(2)), s.unitPrice)
}

console.log('\nQUANTITY RUNG — the out-of-order-response case')
{
  // A slow reply for qty 500 must never be allowed to overwrite qty 5,000.
  // The rules pick the right rung; the SCREEN enforces which reply may land
  // (priceTicket in NewPurchaseOrder/ForecastPOModal). This asserts the rungs.
  const rows = [sp({ amount: 100, min_qty: 1 }), sp({ amount: 85, min_qty: 5000 })]
  t('qty 500  → ₹100 rung',  pickBestSpecial(rows, ctx({ qty: 500 })).amount, 100)
  t('qty 5000 → ₹85 rung',   pickBestSpecial(rows, ctx({ qty: 5000 })).amount, 85)
  t('the two rungs differ by ₹75,000 at qty 5,000',
    (100 - 85) * 5000, 75000)
}

console.log('\nAPPROVAL — an unapproved rate is a proposal, not a price')
{
  const proposed = sp({ amount: 12000, price_status: 'pending' })
  t('pending record is ignored',    pickBestSpecial([proposed], ctx()), null)
  t('superseded record is ignored', pickBestSpecial([sp({ amount: 11000, price_status: 'superseded' })], ctx()), null)
  t('approved record applies',      pickBestSpecial([sp({ amount: 10000, price_status: 'approved' })], ctx()).amount, 10000)
  // Every row written before approval existed defaults to 'approved' in the DB,
  // but a row with no status at all must still work — nothing may stop pricing.
  t('missing status is treated as approved', pickBestSpecial([sp({ amount: 9000 })], ctx()).amount, 9000)
  t('a pending rate never beats an approved one',
    pickBestSpecial([proposed, sp({ amount: 15000 })], ctx()).amount, 15000)
}

console.log('\nVENDOR — a rate given by one vendor is not payable to another')
{
  const V1 = 'vend-1', V2 = 'vend-2'
  const anyVendor  = sp({ amount: 30000 })
  const forV1      = sp({ amount: 26000, vendor_id: V1 })
  t('vendor rate applies on that vendor',   pickBestSpecial([forV1], ctx({ vendorId: V1 })).amount, 26000)
  t('vendor rate must NOT reach vendor 2',  pickBestSpecial([forV1], ctx({ vendorId: V2 })), null)
  t('vendor rate must NOT apply with no vendor chosen', pickBestSpecial([forV1], ctx()), null)
  t('vendor-specific beats any-vendor at the same scope',
    pickBestSpecial([anyVendor, forV1], ctx({ vendorId: V1 })).amount, 26000)
  t('any-vendor still applies on a vendor with no rate of its own',
    pickBestSpecial([anyVendor, forV1], ctx({ vendorId: V2 })).amount, 30000)
  t('scope still dominates the vendor bonus — customer beats stock+vendor',
    pickBestSpecial([sp({ amount: 20000, vendor_id: V1 }),
                     sp({ price_scope: 'CUSTOMER', customer_id: CUST_A, amount: 24000 })],
      ctx({ customerId: CUST_A, vendorId: V1 })).amount, 24000)
}

console.log('\nTIE-BREAK — the same rank must never depend on row order')
{
  // Two overlapping records, identical scope and rung. The database now refuses
  // to store this, but the resolver must still be deterministic if it ever sees
  // it — the winner is the one that took effect most recently.
  const older = sp({ id: 'a', amount: 18000, valid_from: '2026-04-01', valid_to: '2026-12-31' })
  const newer = sp({ id: 'b', amount: 17400, valid_from: '2026-08-01' })
  t('newest effective date wins',           pickBestSpecial([older, newer], ctx()).amount, 17400)
  t('…and the row order does not matter',   pickBestSpecial([newer, older], ctx()).amount, 17400)
  // Same date too: fall through to the id so the answer is still stable.
  const x = sp({ id: 'aaa', amount: 100, valid_from: '2026-08-01' })
  const y = sp({ id: 'bbb', amount: 200, valid_from: '2026-08-01' })
  t('same date → stable by id, either order',
    [pickBestSpecial([x, y], ctx()).id, pickBestSpecial([y, x], ctx()).id], ['bbb', 'bbb'])
}

console.log('\nCHEAPER-OPTION WARNING — specificity still decides, the buyer is told')
{
  const V1 = 'vend-1'
  // The case that raised this: a vendor rate recorded flat, against a blanket
  // rate that has a deep quantity rung. Specificity picks the vendor rate; at
  // qty 100 the blanket rate is ₹150/unit cheaper and nobody would ever notice.
  const rows = [
    sp({ amount: 2000, min_qty: 1 }),
    sp({ amount: 1500, min_qty: 100 }),
    sp({ amount: 1650, min_qty: 1, vendor_id: V1 }),
  ]
  const r = resolveFromRows({ commercials: comm, specials: rows, qty: 100, vendorId: V1, today: TODAY })
  t('vendor rate is still the price',   r.unitPrice, 1650)
  t('…and the cheaper blanket rung is flagged',
    [r.cheaper.unitPrice, r.cheaper.savingPerUnit, r.cheaper.label], [1500, 150, 'blanket rate from qty 100'])

  // Below the rung there is nothing cheaper, so no warning.
  const r1 = resolveFromRows({ commercials: comm, specials: rows, qty: 1, vendorId: V1, today: TODAY })
  t('no warning when the vendor rate really is the best', [r1.unitPrice, r1.cheaper], [1650, null])

  // A stale special sitting ABOVE the published partner discount. comm is
  // 100,000 at 64% = 36,000, so a 40,000 special is worse than doing nothing.
  const stale = resolveFromRows({ commercials: comm, specials: [sp({ amount: 40000 })], qty: 1, today: TODAY })
  t('a special worse than the standard discount is flagged',
    [stale.unitPrice, stale.cheaper.unitPrice, stale.cheaper.label], [40000, 36000, 'standard 64%'])

  t('a special better than standard raises nothing',
    resolveFromRows({ commercials: comm, specials: [sp({ amount: 30000 })], qty: 1, today: TODAY }).cheaper, null)
  t('a standard price never carries a warning',
    resolveFromRows({ commercials: comm, specials: [], qty: 1, today: TODAY }).cheaper, null)
  t('an INELIGIBLE cheaper rate is not offered (customer A rate, customer B line)',
    resolveFromRows({ commercials: comm, qty: 1, customerId: CUST_B, today: TODAY,
      specials: [sp({ price_scope: 'CUSTOMER', customer_id: CUST_B, amount: 38000 }),
                 sp({ price_scope: 'CUSTOMER', customer_id: CUST_A, amount: 20000 })] }).cheaper.unitPrice, 36000)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
