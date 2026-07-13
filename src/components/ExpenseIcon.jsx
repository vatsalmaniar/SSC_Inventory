// Category glyphs for the Expenses module. Categories are DB-driven, so icons
// are matched on keywords in the name with a sane fallback — no emoji anywhere.
const P = {
  fuel:      <><path d="M3 22V4a2 2 0 012-2h6a2 2 0 012 2v18" /><path d="M3 12h10" /><path d="M16 8l3 3v7a2 2 0 004 0V9l-3-3" /></>,
  food:      <><path d="M4 2v9a3 3 0 006 0V2" /><path d="M7 2v20" /><path d="M18 2c-1.5 2-2 4-2 7 0 2 1 3 2 3v10" /></>,
  phone:     <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></>,
  cab:       <><path d="M5 17h14M6 17V9l2-4h8l2 4v8" /><circle cx="8" cy="17" r="2" /><circle cx="16" cy="17" r="2" /><path d="M9 5V3h6v2" /></>,
  travel:    <><path d="M17.8 19.2L16 11l3.5-3.5a2.1 2.1 0 00-3-3L13 8 4.8 6.2a1 1 0 00-.9 1.7L9 11l-2 3H4l-1 2 4 1 1 4 2-1v-3l3-2 3.1 5.1a1 1 0 001.7-.9z" /></>,
  hotel:     <><path d="M3 21V6a1 1 0 011-1h16a1 1 0 011 1v15" /><path d="M3 21h18" /><path d="M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /><path d="M10 21v-4h4v4" /></>,
  toll:      <><path d="M4 20V9l8-5 8 5v11" /><path d="M2 20h20" /><path d="M9 20v-6h6v6" /></>,
  vehicle:   <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  courier:   <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  print:     <><path d="M6 9V2h12v7" /><rect x="2" y="9" width="20" height="8" rx="2" /><path d="M6 14h12v8H6z" /></>,
  entertain: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  internet:  <><path d="M5 12.55a11 11 0 0114 0M8.5 16.1a6 6 0 017 0M2 8.8a16 16 0 0120 0" /><circle cx="12" cy="20" r="1" /></>,
  marketing: <><path d="M3 11l18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 11-5.8-1.6" /></>,
  hosting:   <><rect x="2" y="3" width="20" height="7" rx="2" /><rect x="2" y="14" width="20" height="7" rx="2" /><path d="M6 6.5h.01M6 17.5h.01" /></>,
  software:  <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 9h6v6H9z" /></>,
  misc:      <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
}

// keyword → glyph (first match wins)
const RULES = [
  [/petrol|fuel|diesel|mileage/i, 'fuel'],
  [/food|lunch|dinner|meal|snack/i, 'food'],
  [/mobile|telephone|phone/i,     'phone'],
  [/cab|ride|taxi|auto|uber|ola|rapido|porter/i, 'cab'],
  [/travel|bus|train|air|flight/i, 'travel'],
  [/hotel|lodg|stay|accom/i,      'hotel'],
  [/toll|parking/i,               'toll'],
  [/vehicle|maint|repair|service/i, 'vehicle'],
  [/courier|postage|shipping/i,   'courier'],
  [/print|stationery/i,           'print'],
  [/entertain|client|guest/i,     'entertain'],
  [/internet|data|broadband|wifi/i, 'internet'],
  [/marketing|advert|promo/i,     'marketing'],
  [/hosting|website|domain|server/i, 'hosting'],
  [/software|subscription|saas|licen/i, 'software'],
]

export function iconKeyFor(name) {
  for (const [re, key] of RULES) if (re.test(name || '')) return key
  return 'misc'
}

/** Tinted rounded-square tile with the category glyph. */
export default function ExpenseIcon({ name, color = '#64748b', small = false }) {
  const key = iconKeyFor(name)
  return (
    <div className={'exp-tile' + (small ? ' sm' : '')} style={{ background: color + '1F', color }} title={name}>
      <svg fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        {P[key]}
      </svg>
    </div>
  )
}
