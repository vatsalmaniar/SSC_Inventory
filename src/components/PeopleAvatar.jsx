import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { signPhotos } from '../lib/photos'

// Shared people-photo directory (name -> signed photo URL), loaded once and cached.
// Lets any module render an owner/rep avatar with the employee's photo, falling
// back to coloured initials when there's no photo or no matching employee.
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
export function ownerColor(n = '') { let h = 0; for (let i = 0; i < n.length; i++) h = n.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] }
export function initials(n = '') { return (n || '').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??' }
const norm = s => (s || '').trim().toLowerCase()

let dir = {}
let loaded = false
let inflight = null
const listeners = new Set()

async function loadDir() {
  if (loaded || inflight) return inflight
  inflight = (async () => {
    try {
      // key by BOTH the employee full_name AND the linked login/profile name,
      // because Orders/CRM reference reps by their profile name (e.g. "Jaypal Jadeja"
      // vs employee "Jaypalsinh Jadeja").
      const { data } = await sb.from('employees').select('full_name,photo_url,profile:profiles(name)').eq('is_test', false)
      const rows = (data || []).filter(e => e.photo_url)
      await signPhotos(rows)
      rows.forEach(e => {
        if (!e.signedPhoto) return
        dir[norm(e.full_name)] = e.signedPhoto
        const pn = e.profile?.name
        if (pn) dir[norm(pn)] = e.signedPhoto
      })
    } catch (_) { /* leave dir empty -> initials fallback */ }
    loaded = true
    listeners.forEach(l => l())
  })()
  return inflight
}

export function usePeopleDir() {
  const [, force] = useState(0)
  useEffect(() => { const l = () => force(x => x + 1); listeners.add(l); loadDir(); return () => listeners.delete(l) }, [])
  return dir
}

export default function PeopleAvatar({ name, className, style, title }) {
  const d = usePeopleDir()
  const photo = d[norm(name)]
  const st = photo
    ? { ...style, backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { ...style, background: ownerColor(name) }
  return <div className={className} style={st} title={title}>{photo ? '' : initials(name)}</div>
}
