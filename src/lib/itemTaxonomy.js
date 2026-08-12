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

  // ── nVent Hoffman and Connectwell ──────────────────────────────────────────
  // Generated from what is actually loaded in the database, not typed by hand,
  // so the dropdowns can only offer values that real items already use.
  //
  // These two were missed when their price books went in, which meant a curated
  // brand offered NO categories at all and a new Hoffman or Connectwell item
  // could not be created. Same failure as the LVS omission noted above — if you
  // load a price book, add its taxonomy here in the same change.
  'nVent Hoffman': {
    'Cable Tray & Wire Way': {
      'Cable Tray & Wire Way': ['CT'],
    },
    'Enclosure Accessories': {
      'Accessories': ['Floor Stand', 'Inner Door', 'Mounting Plate', 'Plinth', 'Rain Hood'],
    },
    'Hazardous SS Enclosure': {
      'Accessories': ['Floor Stand'],
      'Hazardous Location': ['EXE'],
      'Wall Mounted': ['EXE'],
    },
    'Mild Steel Enclosure': {
      'Accessories': ['Floor Stand', 'Inner Door', 'Mounting Plate', 'Rain Hood'],
      'Floor Standing': [
        'EKSS', 'MCD', 'MCS', 'Mounting Plate', 'NCD', 'NCD-HT', 'NCS', 'NCS-HT', 'Plinth',
      ],
      'HMI Enclosure': ['Mounting Plate'],
      'Junction Box': ['STB'],
      'Terminal Box': ['SSTB', 'STB'],
      'Wall Mounted': [
        'Door Hardware', 'Inner Door', 'MAD', 'MAS', 'Mounting Plate', 'Plain Door',
        'Rain Hood',
      ],
    },
    'Stainless Steel Enclosure': {
      'Floor Standing': ['EKDS', 'EKSS', 'MSC', 'Mounting Plate'],
      'Hazardous Location': ['EXE'],
      'Terminal Box': ['MSC', 'SSTB'],
      'Wall Mounted': ['ADR', 'ASR', 'EXE', 'MSC'],
    },
    'Terminal Box': {
      'Terminal Box': [],
    },
    'Thermal Management': {
      'Thermal Management': [],
    },
  },
  'Connectwell': {
    'Terminal Block Accessories': {
      'DIN Rail': ['CA', 'CDINS', 'CDS', 'ECAP'],
      'End / Partition Plate': [
        'CBDT', 'CBS', 'CDL', 'CM', 'CMB', 'CP', 'CSB', 'CSC', 'CSTS', 'CX', 'CY', 'DDFL',
        'EP',
      ],
      'End Clamp': ['CA'],
      'Marker': ['GMH', 'MC'],
      'Mounting / Hardware': ['CA', 'CSB', 'DDFL', 'SCS'],
      'Plug / Isolation': ['CX'],
      'Shorting Link / Jumper': ['CA', 'CBDT', 'CP', 'JX'],
      'Tool': ['SCM'],
    },
    'Terminal Blocks': {
      'Component': ['CX'],
      'Disconnect / Knife': ['CKT', 'CY', 'DDFL'],
      'Feed Through': ['CBB', 'CBS', 'CM', 'CP', 'CSC', 'CTS', 'CX', 'CY'],
      'Fuse': ['CF', 'CP', 'CX', 'CY', 'DDFL'],
      'Grounding / Earth': ['CENC', 'CGT', 'CP', 'CSC', 'CTS', 'CX'],
      'Panel Mount': ['CM', 'CMB'],
      'Pluggable': ['CX'],
      'Power Distribution': ['CDB', 'CMDB', 'CX', 'DB', 'PDB'],
      'Stud / Heavy Duty': ['CSTS'],
      'Three Level': ['CP', 'CTL'],
      'Two Level': ['CDL', 'CP', 'CX'],
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

/**
 * The one correct spelling of a brand.
 *
 * Matching case-insensitively (above) stops a typo escaping the taxonomy, but
 * it does not stop the typo being SAVED — someone typing "connectwell" would
 * create a second brand that every brand filter, discount-group lookup and
 * report then treats as a different company. There is exactly one Connectwell.
 *
 * So anything that writes a brand runs it through here first: a curated brand
 * is forced to its canonical spelling, and everything else is just trimmed.
 */
export function canonicalBrand(brand) {
  return brandKey(brand) || (brand || '').trim()
}
