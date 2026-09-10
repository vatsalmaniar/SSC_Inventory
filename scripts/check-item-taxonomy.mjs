// Does the item master agree with the curated taxonomy?
//
// itemTaxonomy.js decides what the New Item form may offer for a curated brand,
// but nothing ever checked what is ALREADY stored. SRL1-24D — a slim relay —
// sat as 'Terminal Block Accessories / DIN Rail / ECAP' for a day, and 144
// Connectwell items carry no category at all, because the form had nothing
// correct to offer. Every value was individually legal; the combination was
// nonsense, and no build, lint or constraint could see it.
//
// This reports four things per curated brand:
//   MISSING      no category at all
//   BAD-CAT      category not in the taxonomy for that brand
//   BAD-SUB      subcategory not allowed under that category
//   BAD-SERIES   series not allowed under that subcategory
//
//   SUPABASE_PAT=sbp_... node scripts/check-item-taxonomy.mjs
//
// Exits non-zero when anything is wrong, so it can gate a release.
import { TAXONOMY } from '../src/lib/itemTaxonomy.js'

const PAT = process.env.SUPABASE_PAT
if (!PAT) { console.error('Set SUPABASE_PAT'); process.exit(2) }
const PROJ = 'kvjihrlbntxcdadogmhn'

async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const j = await r.json()
  if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300))
  return j
}

const brands = Object.keys(TAXONOMY)
const list = brands.map(b => `'${b.replace(/'/g, "''")}'`).join(',')
const rows = await sql(`
  select item_no, item_code, brand, category, subcategory, series, item_status
    from items where brand in (${list}) order by brand, item_code`)

const problems = []
for (const r of rows) {
  const t = TAXONOMY[r.brand]
  if (!r.category)                      { problems.push(['MISSING',    r, 'no category']); continue }
  if (!t[r.category])                   { problems.push(['BAD-CAT',    r, `'${r.category}' is not a ${r.brand} category`]); continue }
  const subs = t[r.category]
  if (r.subcategory && !(r.subcategory in subs))
                                          problems.push(['BAD-SUB',    r, `'${r.subcategory}' not allowed under '${r.category}'`])
  else if (r.series) {
    const allowed = subs[r.subcategory] || []
    if (allowed.length && !allowed.includes(r.series))
                                          problems.push(['BAD-SERIES', r, `'${r.series}' not allowed under '${r.category} / ${r.subcategory}'`])
  }
}

// ── SUSPECT ────────────────────────────────────────────────────────────────
// The four checks above are structural: every value legal, in a legal
// combination. They do NOT catch a legal combination that is factually wrong,
// which is exactly what happened to SRL1-24D — 'Terminal Block Accessories /
// DIN Rail / ECAP' is a permitted triple, and the item is a slim relay.
//
// This catches it. Once a series is declared in the taxonomy, an item whose
// code STARTS with that series but is filed under a different one is suspect:
// SRL1-24D begins 'SRL', the taxonomy says SRL lives under Relay / Slim Relay,
// and the item claims ECAP. It is a hint, not a verdict — a shared prefix can
// be coincidence — so these are reported apart from the errors.
const seriesHome = {}                      // brand -> series -> 'cat / sub'
for (const [b, cats] of Object.entries(TAXONOMY))
  for (const [cat, subs] of Object.entries(cats))
    for (const [sub, list] of Object.entries(subs))
      for (const ser of list) (seriesHome[b] ??= {})[ser] ??= `${cat} / ${sub}`

const suspects = []
for (const r of rows) {
  if (!r.category || !r.series) continue
  const home = seriesHome[r.brand] || {}
  // longest declared series that the code starts with
  const pref = Object.keys(home)
    .filter(s => r.item_code.toUpperCase().startsWith(s.toUpperCase()))
    .sort((a, b) => b.length - a.length)[0]
  if (!pref) continue
  if (pref !== r.series && home[pref] !== `${r.category} / ${r.subcategory}`)
    suspects.push([r, pref, home[pref]])
}

const byBrand = {}
for (const [kind, r] of problems) {
  byBrand[r.brand] ??= {}
  byBrand[r.brand][kind] = (byBrand[r.brand][kind] || 0) + 1
}
console.log(`\nchecked ${rows.length} items across ${brands.length} curated brands\n`)
for (const b of Object.keys(byBrand).sort()) {
  const c = byBrand[b]
  console.log(`  ${b.padEnd(22)} ` + Object.entries(c).map(([k, n]) => `${k} ${n}`).join('  ·  '))
}
const detail = problems.filter(([k]) => k !== 'MISSING')
if (detail.length) {
  console.log(`\n── wrongly classified (${detail.length}) ──`)
  for (const [kind, r, why] of detail.slice(0, 40))
    console.log(`  ${kind.padEnd(11)} ${r.item_no.padEnd(8)} ${r.item_code.slice(0, 34).padEnd(35)} ${why}`)
}
if (suspects.length) {
  console.log(`\n── suspect: the code's own series says otherwise (${suspects.length}) ──`)
  for (const [r, pref, home] of suspects.slice(0, 25))
    console.log(`  ${r.item_no.padEnd(8)} ${r.item_code.slice(0, 30).padEnd(31)} filed '${r.category} / ${r.subcategory} / ${r.series}'  but '${pref}' belongs to '${home}'`)
}
const missing = problems.filter(([k]) => k === 'MISSING').length
console.log(`\n${problems.length} problem(s): ${missing} with no category, ${detail.length} wrongly classified, ${suspects.length} suspect\n`)
process.exit(problems.length ? 1 : 0)
