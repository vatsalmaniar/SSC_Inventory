// Curated item taxonomy — the single source of truth for brands whose
// category / subcategory / series we have standardised.
//
// Why this file exists: the New Item form used to offer free text with a
// `select distinct` suggestion list, so every typo and one-off ever saved came
// back as a suggestion (Mitsubishi FA had servo motors filed under `HMI`, and
// `Controller` / `VFD` with no series at all). For a brand listed here the form
// switches to cascading dropdowns, so only these values can be chosen.
//
// Brands NOT listed here keep the old free-text + datalist behaviour untouched.
// To standardise another brand, add it below — no schema change needed.
//
// Shape: { brand: { category: { subcategory: [series, …] } } }

export const TAXONOMY = {
  'Mitsubishi Electric': {
    FA: {
      'Compact PLC': [
        'FX2N', 'FX3G', 'FX3GA', 'FX3S', 'FX3U',
        'FX5S', 'FX5U', 'FX5UJ', 'FX5 Expansion',
      ],
      'Modular PLC': ['iQ-R', 'Q Series', 'PLC Cables'],
      'Modular I/O': ['MELSEC MIO'],
      'GOC': ['GOC'],
      'HMI (GOT)': ['GS', 'GT10', 'GT21', 'GT25', 'GT27'],
      'Inverter (VFD)': [
        'FR-A840', 'FR-CS', 'FR-D720', 'FR-D740',
        'FR-E740', 'FR-E840', 'Inverter Accessories',
      ],
      'Servo': [
        'HG-JR', 'HG-KN', 'HG-SN', 'HG-SR', 'HJ-KS',
        'MR-J4', 'MR-JE-A', 'MR-JE-AS', 'MR-JE-B', 'MR-JET',
        'Servo Cables', 'Servo Connectors', 'Servo Accessories',
      ],
    },
    // Low-voltage switchgear — a separate Mitsubishi price list we don't hold yet.
    // These MUST stay listed: a curated brand only offers the categories named
    // here, so omitting LVS would make 550 existing items impossible to add to.
    LVS: {
      'ACB':      ['Contactor', 'Distribution Box'],
      'MCCB':     [],
      'MCB':      [],
      'MPCB':     [],
      'RCCB':     [],
      'Contactor': ['Contactor'],
    },
  },
}

// Brand is free text elsewhere in the app, so match case-insensitively —
// otherwise someone typing "mitsubishi electric" silently escapes the taxonomy.
function brandKey(brand) {
  const b = (brand || '').trim().toLowerCase()
  return Object.keys(TAXONOMY).find(k => k.toLowerCase() === b)
}

/** Categories we have standardised for a brand. [] when the brand is free-form. */
export function taxonomyCategories(brand) {
  const k = brandKey(brand)
  return k ? Object.keys(TAXONOMY[k]) : []
}

/** Subcategories allowed for a brand + category. [] when not standardised. */
export function taxonomySubcategories(brand, category) {
  const k = brandKey(brand)
  if (!k) return []
  return Object.keys(TAXONOMY[k][(category || '').trim()] || {})
}

/** Series allowed for a brand + category + subcategory. [] when not standardised.
 *  An empty list is legitimate — some subcategories have no series at all. */
export function taxonomySeries(brand, category, subcategory) {
  const k = brandKey(brand)
  if (!k) return []
  const subs = TAXONOMY[k][(category || '').trim()]
  if (!subs) return []
  return subs[(subcategory || '').trim()] || []
}

/** True when this brand is standardised — the form should use dropdowns, not free text. */
export function isCuratedBrand(brand) {
  return Boolean(brandKey(brand))
}
