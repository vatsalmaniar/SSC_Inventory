import { sb } from './supabase'

// Session cache: path -> { url, exp }. Reusing the same signed URL lets the
// browser cache the image across navigations and skips re-signing.
const cache = new Map()
const TTL_MS = 55 * 60 * 1000  // refresh a bit before the 1h signed-URL expiry

// Attach `signedPhoto` (a signed URL) to each row that has a private-bucket
// `photo_url` path. One batched storage call for any not already cached.
// Mutates + returns the same array.
export async function signPhotos(rows) {
  const now = Date.now()
  const need = []
  ;(rows || []).forEach(e => {
    if (!e || !e.photo_url || /^https?:\/\//.test(e.photo_url)) return
    const c = cache.get(e.photo_url)
    if (c && c.exp > now) { e.signedPhoto = c.url }
    else need.push(e)
  })
  if (need.length) {
    const { data } = await sb.storage.from('employee-photos').createSignedUrls(need.map(e => e.photo_url), 3600)
    const byPath = {}
    ;(data || []).forEach(r => { if (r.signedUrl) byPath[r.path] = r.signedUrl })
    need.forEach(e => {
      const u = byPath[e.photo_url]
      if (u) { e.signedPhoto = u; cache.set(e.photo_url, { url: u, exp: now + TTL_MS }) }
    })
  }
  return rows
}
