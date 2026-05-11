// Geocoding + distance helpers — uses OpenStreetMap Nominatim (free)
// with a Supabase-side cache so we don't re-hit Nominatim for known addresses.

import { sb } from './supabase'

// Hardcoded SSC office coordinates (geocoded once on 2026-05-11)
export const SSC_OFFICES = {
  office_ahmedabad: {
    label: 'SSC Ahmedabad — Makarba',
    address: 'E/12, Siddhivinayak Tower, Sarkhej-Gandhinagar Hwy, Makarba, Ahmedabad 380051',
    lat: 23.0004,
    lng: 72.4998,
  },
  office_baroda: {
    label: 'SSC Baroda — Makarpura GIDC',
    address: '31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara 390010',
    lat: 22.2574,
    lng: 73.1988,
  },
}

function normalize(addr) {
  return (addr || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Haversine — straight-line distance in km
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lat2 == null) return null
  const R = 6371
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return Math.round(R * c * 10) / 10
}

// Look up coords for an address. Cache-first, Nominatim fallback.
export async function geocodeAddress(address) {
  const norm = normalize(address)
  if (!norm) return null

  // 1. Check cache
  const { data: cached } = await sb.from('address_geocodes')
    .select('lat,lng,display_name')
    .eq('address_norm', norm)
    .maybeSingle()
  if (cached) return { lat: Number(cached.lat), lng: Number(cached.lng), display_name: cached.display_name }

  // 2. Hit Nominatim (with countrycodes=in to bias to India)
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=in`
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) return null
    const arr = await res.json()
    if (!arr || !arr.length) return null
    const r = arr[0]
    const lat = parseFloat(r.lat), lng = parseFloat(r.lon)
    if (!isFinite(lat) || !isFinite(lng)) return null

    // 3. Save to cache (ignore conflicts — concurrent inserts harmless)
    sb.from('address_geocodes').insert({
      address_norm: norm, lat, lng, display_name: r.display_name || null,
    }).then(() => {}, () => {})

    return { lat, lng, display_name: r.display_name }
  } catch (e) {
    console.error('geocode failed:', e)
    return null
  }
}
