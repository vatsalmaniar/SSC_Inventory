// Category glyphs for the Expenses module. Categories are DB-driven, so icons
// are matched on keywords in the name with a sane fallback — no emoji anywhere.
const P = {
  // Standard 24x24 stroke glyphs. The originals were hand-drawn approximations: the
  // "fuel pump" was a two-bar shape nobody read as a pump, Toll & Parking got a HOUSE,
  // and both Vehicle and Office Maintenance got a sun/gear.
  fuel:      <><line x1="3" x2="15" y1="22" y2="22" /><line x1="4" x2="14" y1="9" y2="9" /><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" /><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 4 0V9.83a2 2 0 0 0-.59-1.42L18 5" /></>,
  food:      <><path d="M3 2v7c0 1.1.9 2 2 2h1a2 2 0 0 0 2-2V2" /><path d="M5.5 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" /></>,
  phone:     <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M11 18h2" /></>,
  cab:       <><path d="M5 17h14" /><path d="M4 17v-4l1.7-4.2A2 2 0 0 1 7.6 7.5h8.8a2 2 0 0 1 1.9 1.3L20 13v4" /><path d="M4 13h16" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" /><path d="M9 7.5V5h6v2.5" /></>,
  car:       <><path d="M5 17h14" /><path d="M4 17v-4l1.7-4.2A2 2 0 0 1 7.6 7.5h8.8a2 2 0 0 1 1.9 1.3L20 13v4" /><path d="M4 13h16" /><circle cx="7.5" cy="17" r="1.6" /><circle cx="16.5" cy="17" r="1.6" /></>,
  truck:     <><path d="M14 17V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1" /><path d="M14 9h3.6a1 1 0 0 1 .8.4l2.4 3.2a1 1 0 0 1 .2.6V17a1 1 0 0 1-1 1h-1" /><path d="M9 18h5" /><circle cx="6.5" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></>,
  travel:    <><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-.5 1 3 2 2 3 1-.5V17l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></>,
  hotel:     <><path d="M2 4v16" /><path d="M2 9h16a4 4 0 0 1 4 4v7" /><path d="M2 16h20" /><circle cx="7" cy="12.5" r="1.8" /></>,
  parking:   <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" /></>,
  wrench:    <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.7-3.7a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" /></>,
  building:  <><path d="M6 22V4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v18" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M16 9h4a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4" /><path d="M10 6h2M10 10h2M10 14h2M10 18h2" /></>,
  courier:   <><path d="m7.5 4.3 9 5.1" /><path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>,
  print:     <><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /><rect x="6" y="14" width="12" height="8" rx="1" /></>,
  entertain: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
  internet:  <><path d="M12 20h.01" /><path d="M2 8.8a15 15 0 0 1 20 0" /><path d="M5 12.9a10 10 0 0 1 14 0" /><path d="M8.5 16.4a5 5 0 0 1 7 0" /></>,
  marketing: <><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>,
  hosting:   <><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path d="M6 6h.01M6 18h.01" /></>,
  software:  <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 9h20" /><path d="M6 6.5h.01M9 6.5h.01" /></>,
  legal:     <><path d="m16 16 3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1Z" /><path d="m2 16 3-8 3 8c-.9.7-1.9 1-3 1s-2.1-.3-3-1Z" /><path d="M7 21h10" /><path d="M12 3v18" /><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" /></>,
  misc:      <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
}

// keyword -> glyph, FIRST MATCH WINS, so the order matters.
// Checked against all 23 live categories: "Toll & Parking" must beat the vehicle rule,
// "Transport / Logistics" must beat nothing and land on truck, and "Office Maintenance"
// must beat the generic maintenance rule so it gets a building, not a car.
const RULES = [
  [/petrol|fuel|diesel|mileage/i,                 'fuel'],
  [/food|lunch|dinner|meal|snack|tea|coffee/i,    'food'],
  [/mobile|telephone|phone/i,                     'phone'],
  [/toll|parking/i,                               'parking'],
  [/cab|ride|taxi|auto|uber|ola|rapido/i,         'cab'],
  [/transport|logistic|freight|cargo|porter/i,    'truck'],
  [/travel|bus|train|air|flight/i,                'travel'],
  [/hotel|lodg|stay|accom/i,                      'hotel'],
  [/office|building|premis|rent|electric/i,       'building'],
  [/vehicle|car\b/i,                              'car'],
  [/maint|repair|service/i,                       'wrench'],
  [/courier|postage|shipping|parcel/i,            'courier'],
  [/print|stationery/i,                           'print'],
  [/entertain|client|guest/i,                     'entertain'],
  [/internet|data|broadband|wifi/i,               'internet'],
  [/marketing|advert|promo/i,                     'marketing'],
  [/hosting|website|domain|server/i,              'hosting'],
  [/software|subscription|saas|licen/i,           'software'],
  [/statutory|tax|govt|compliance|legal|licence/i,'legal'],
]

export function iconKeyFor(name) {
  for (const [re, key] of RULES) if (re.test(name || '')) return key
  return 'misc'
}

/** Rounded-square tile with the category glyph.
 *
 * The tile used to be filled with a 12% tint of the category colour. With 23 DB-driven
 * categories -- and six of them near-identical navy/slate (#475569, #5B6878, #4338CA,
 * #163E68, #1B4E8F, #0369A1) -- that produced a column of muddy, indistinguishable
 * blobs. The colour now paints the GLYPH only, on a neutral surface: still colour-coded,
 * far cleaner, and it matches the restrained look of the rest of the app. Category
 * colours are DB data and are left exactly as they are.
 */
export default function ExpenseIcon({ name, color = '#64748b', small = false }) {
  const key = iconKeyFor(name)
  return (
    <div className={'exp-tile' + (small ? ' sm' : '')} style={{ color }} title={name}>
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        {P[key]}
      </svg>
    </div>
  )
}
