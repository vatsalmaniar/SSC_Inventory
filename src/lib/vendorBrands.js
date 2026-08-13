// "Should this purchase order be going to this vendor?" — ONE definition.
//
// Before this, the check lived inside NewPurchaseOrder and nowhere else, so a
// line added later from Purchase Order Detail, or a forecast buy, skipped it
// entirely. That is the same drift that made four pages each re-derive
// coverage (see lib/coverage.js) and three screens each re-derive a price.
// The rules are pure and unit-tested (vendorBrands.test.mjs); the I/O half is
// one function at the bottom.
//
// THE RULE — a brand on the PO needs an explanation when either is true:
//
//   1. NOT_SUPPLIED   this vendor has no record of carrying that brand.
//   2. NOT_PREFERRED  they carry it, but we buy that brand DIRECT from a
//                     principal and this vendor is not one of them.
//
// And deliberately NOT when:
//
//   • the vendor is a preferred (direct) source for the brand — that is the
//     normal case and must never nag;
//   • the brand has no preferred vendor recorded anywhere. If nobody has said
//     who the principal is, the form has no basis for an opinion. Flagging it
//     would train people to type "n/a" into the box, which is worse than not
//     asking — the reason has to mean something or it is theatre.
//
// A brand can have MORE THAN ONE preferred vendor. nVent has two Indian
// entities and we buy direct from both, so this is never "the one true vendor".

export const REASON_MIN_WORDS = 7

export const FLAG = {
  NOT_SUPPLIED:  'NOT_SUPPLIED',
  NOT_PREFERRED: 'NOT_PREFERRED',
}

const LABEL = {
  NOT_SUPPLIED:  'not a recorded supplier',
  NOT_PREFERRED: 'we buy this brand direct',
}

/**
 * Which brands on this PO need explaining.
 *
 * @param {string[]} brands   distinct brands on the PO lines
 * @param {string}   vendorId the PO's vendor
 * @param {Array<{brand:string, vendor_id:string, is_preferred:boolean}>} links
 *        vendor_brands rows for those brands — ALL vendors, not just this one,
 *        because "does a principal exist elsewhere" is half the rule.
 * @returns {Array<{brand:string, flag:string, why:string}>} empty when fine
 */
export function flagBrands(brands, vendorId, links) {
  if (!vendorId) return []                       // no vendor chosen yet: nothing to judge
  const rows = links || []
  const out = []
  for (const brand of [...new Set((brands || []).filter(Boolean))]) {
    const here = rows.find(r => r.brand === brand && r.vendor_id === vendorId)
    if (here?.is_preferred) continue             // direct source — the normal case
    if (!here) { out.push({ brand, flag: FLAG.NOT_SUPPLIED, why: LABEL.NOT_SUPPLIED }); continue }
    // They carry it but are not a principal. Only a problem if a principal exists.
    if (rows.some(r => r.brand === brand && r.is_preferred)) {
      out.push({ brand, flag: FLAG.NOT_PREFERRED, why: LABEL.NOT_PREFERRED })
    }
  }
  return out
}

/** Is the typed justification enough? Same bar as a below-₹8,000 order. */
export function reasonIsSufficient(reason) {
  return String(reason || '').trim().split(/\s+/).filter(Boolean).length >= REASON_MIN_WORDS
}

export function wordCount(reason) {
  return String(reason || '').trim().split(/\s+/).filter(Boolean).length
}

/** "Connectwell (we buy this brand direct) · Hummel (not a recorded supplier)" */
export function describeFlags(flags) {
  return (flags || []).map(f => `${f.brand} (${f.why})`).join(' · ')
}

/**
 * Ask the DATABASE which brands need explaining.
 *
 * The rule itself is public.vendor_brand_flags(vendor_id, item_codes) — see
 * sql/vendor_brands.sql. It is NOT reimplemented here, and flagBrands() above
 * is kept only so the rule can be reasoned about and unit-tested; the live
 * answer always comes from the same function the approval trigger uses, so the
 * warning on the form and the gate on approval can never disagree.
 *
 * One round trip regardless of how many lines the PO has. Returns [] on any
 * failure: the form warning is advisory and must never be able to stop work
 * because a lookup was slow. The trigger is what guarantees it.
 */
export async function flagsForPo(sb, { itemCodes, vendorId }) {
  const codes = [...new Set((itemCodes || []).map(c => (c || '').trim()).filter(Boolean))]
  if (!vendorId || !codes.length) return []
  const { data, error } = await sb.rpc('vendor_brand_flags', {
    p_vendor_id: vendorId, p_item_codes: codes,
  })
  if (error) { console.error('vendor_brand_flags:', error); return [] }
  return data || []
}
