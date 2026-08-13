// Unit tests for the vendor-brand rule. No test runner needed:
//
//     node src/lib/vendorBrands.test.mjs
//
// Run after ANY change to vendorBrands.js. This rule decides when a buyer is
// asked to justify a purchase order; a regression either nags on every PO
// (and gets ignored) or stops asking when it should.

import { flagBrands, reasonIsSufficient, describeFlags, FLAG } from './vendorBrands.js'

let pass = 0, fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok   ${name}`) }
  else    { fail++; console.log(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`) }
}

const PRINCIPAL = 'v-connectwell', TRADER = 'v-indus', OTHER = 'v-shaily'
const links = [
  { brand: 'Connectwell', vendor_id: PRINCIPAL, is_preferred: true  },
  { brand: 'Connectwell', vendor_id: TRADER,    is_preferred: false },
  // a brand nobody has called a principal for
  { brand: 'Seemaco',     vendor_id: TRADER,    is_preferred: false },
  // two principals for one brand — nVent's two Indian entities
  { brand: 'nVent Hoffman', vendor_id: 'v-nvent-enc',  is_preferred: true },
  { brand: 'nVent Hoffman', vendor_id: 'v-nvent-elec', is_preferred: true },
]

console.log('\nTHE NORMAL CASE MUST NEVER NAG')
{
  t('buying direct from the principal', flagBrands(['Connectwell'], PRINCIPAL, links), [])
  t('either of two principals is fine (nVent)',
    [flagBrands(['nVent Hoffman'], 'v-nvent-enc', links), flagBrands(['nVent Hoffman'], 'v-nvent-elec', links)], [[], []])
  t('no vendor chosen yet — nothing to judge', flagBrands(['Connectwell'], '', links), [])
  t('no lines yet', flagBrands([], PRINCIPAL, links), [])
}

console.log('\nWHEN A REASON IS REQUIRED')
{
  t('a trader, while a principal exists',
    flagBrands(['Connectwell'], TRADER, links), [{ brand: 'Connectwell', flag: FLAG.NOT_PREFERRED, why: 'we buy this brand direct' }])
  t('vendor has no record of carrying the brand at all',
    flagBrands(['Connectwell'], OTHER, links), [{ brand: 'Connectwell', flag: FLAG.NOT_SUPPLIED, why: 'not a recorded supplier' }])
  t('a brand with NO vendor_brands rows at all is treated as unsupplied',
    flagBrands(['Wago'], PRINCIPAL, links), [{ brand: 'Wago', flag: FLAG.NOT_SUPPLIED, why: 'not a recorded supplier' }])
}

console.log('\nWHEN IT MUST STAY QUIET — the rule that stops it becoming noise')
{
  // Nobody has said who the principal for Seemaco is, so there is no basis for
  // an opinion. Asking here would train people to type "n/a" and the reason
  // would stop meaning anything.
  t('carried, not preferred, and NO principal anywhere → silent',
    flagBrands(['Seemaco'], TRADER, links), [])
}

console.log('\nMIXED PO')
{
  const got = flagBrands(['Connectwell', 'Seemaco', 'Wago'], TRADER, links)
  t('flags only the two that qualify, in line order',
    got.map(f => [f.brand, f.flag]),
    [['Connectwell', FLAG.NOT_PREFERRED], ['Wago', FLAG.NOT_SUPPLIED]])
  t('reads as a sentence',
    describeFlags(got), 'Connectwell (we buy this brand direct) · Wago (not a recorded supplier)')
  t('duplicate brands are collapsed',
    flagBrands(['Wago', 'Wago', 'Wago'], TRADER, links).length, 1)
}

console.log('\nTHE JUSTIFICATION BAR — same as an order below ₹8,000')
{
  t('empty',             reasonIsSufficient(''), false)
  t('six words',         reasonIsSufficient('one two three four five six'), false)
  t('seven words',       reasonIsSufficient('principal had no stock so we bought locally'), true)
  t('whitespace padded', reasonIsSufficient('   principal   had no stock so we bought   '), true)
  t('null',              reasonIsSufficient(null), false)
}

console.log('\nDEFENSIVE — a missing links table must not fabricate flags')
{
  t('links undefined → everything reads as unsupplied, never as OK',
    flagBrands(['Connectwell'], PRINCIPAL, undefined).map(f => f.flag), [FLAG.NOT_SUPPLIED])
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
