// One place that turns a raw biometric device string into the site name people use.
//
// THE SITES (from sync_devices, read 2026-09-09):
//   device 22  "sarkhej"     serial NFZ8242800727  loc Ahemedabad  -> Kaveri
//   device 20  "Ahemedabad"  serial CGKK193360015  loc Ahemedabad  -> HO
//   device 19  "office"      serial CGKK193060771  loc vadodara    -> Godawari
//   device 23  "Automation"  serial NFZ823500684   loc Moraiya     -> Automation (Moraiya)
//   devices 1, 2, 18 are virtual (Manual Entry, Mobile), not physical readers.
//
// NORMALISE AT DISPLAY TIME, NEVER REWRITE THE STORED VALUE. attendance_punches.note
// is what the device reported when the punch happened; 4,900+ historical rows carry it
// and it is evidence. Same rule the part-code lookups follow.
//
// ⚠️ WHERE THE STORED NOTE COMES FROM: the connector writes `eSSL:<label>` where <label>
// is ETT_DEVICE_MAP[DeviceId] — an environment variable on the connector machine. So the
// note carries whatever THAT map says, not the device's own name. Today it yields
// "Ahmedabad" and "Baroda". Renaming the sites properly for FUTURE punches means updating
// ETT_DEVICE_MAP on the connector host; this file only fixes what is already recorded.

// Exact site names, keyed by the lowercased token after "eSSL:".
const NOTE_SITE = {
  ahmedabad: 'HO',
  ahemedabad: 'HO',
  baroda: 'Godawari',
  vadodara: 'Godawari',
  sarkhej: 'Kaveri',
  moraiya: 'Automation',
}

// Device registry names/locations -> site. Keyed by device_id, which is stable;
// the `name` column is free text and has already been misspelled once ("Ahemedabad").
const DEVICE_SITE = {
  19: 'Godawari',
  20: 'HO',
  22: 'Kaveri',
  23: 'Automation',
}

// A punch's note -> what to show in a Location column.
// Returns null when the note carries no site, so the caller can decide what to render
// rather than being handed a guess.
//
// IMPORTANT: a bare "eSSL"/"ESSL" note means the device was NOT in ETT_DEVICE_MAP when
// the punch synced, so the site is genuinely unknown. It is NOT safe to assume Kaveri
// just because Sarkhej is the unmapped one today — that would invent attribution for
// ~3,600 historical punches.
export function siteFromNote(note) {
  if (!note) return null
  const s = String(note).trim()
  const m = /^e?ssl[:\-\s]+(.+)$/i.exec(s)
  if (!m) return null
  const key = m[1].trim().toLowerCase()
  return NOTE_SITE[key] || m[1].trim()
}

// True when the note is a biometric reading with no site attached.
export function isBareEssl(note) {
  return !!note && /^e?ssl$/i.test(String(note).trim())
}

// Device registry row -> site name. Falls back to the device's own name.
export function siteFromDevice(device) {
  if (!device) return '—'
  const byId = DEVICE_SITE[Number(device.device_id)]
  if (byId) return byId
  const byLoc = NOTE_SITE[String(device.location || '').trim().toLowerCase()]
  return byLoc || device.name || `Device ${device.device_id}`
}
