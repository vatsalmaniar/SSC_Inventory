// Tiny Leaflet map for visit drawer.
// Two markers + a connecting line. Loaded only when drawer renders this component.
import { useEffect, useRef } from 'react'

export default function MiniMap({ origin, destination, height = 220 }) {
  const ref = useRef(null)
  const mapRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    if (!origin || !destination) return

    ;(async () => {
      const L = (await import('leaflet')).default
      // Ensure leaflet css is injected once
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link')
        link.id = 'leaflet-css'
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
        link.crossOrigin = ''
        document.head.appendChild(link)
      }
      if (cancelled || !ref.current) return
      // Avoid re-init on hot reload
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

      const o = [Number(origin.lat), Number(origin.lng)]
      const d = [Number(destination.lat), Number(destination.lng)]
      const map = L.map(ref.current, { zoomControl: true, attributionControl: true }).fitBounds([o, d], { padding: [24, 24] })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(map)

      // Origin (blue), Destination (red)
      const blueIcon = L.divIcon({ html: '<div style="width:18px;height:18px;background:#1d4ed8;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>', iconSize: [18,18], iconAnchor: [9,9], className: '' })
      const redIcon  = L.divIcon({ html: '<div style="width:18px;height:18px;background:#dc2626;border:3px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>', iconSize: [18,18], iconAnchor: [9,9], className: '' })
      L.marker(o, { icon: blueIcon }).addTo(map).bindTooltip('Origin', { permanent: false })
      L.marker(d, { icon: redIcon  }).addTo(map).bindTooltip('Destination', { permanent: false })
      L.polyline([o, d], { color: '#0F766E', weight: 3, dashArray: '6 4', opacity: 0.85 }).addTo(map)
    })()

    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng])

  if (!origin || !destination) return null
  return <div ref={ref} style={{ width:'100%', height, borderRadius:10, overflow:'hidden', border:'1px solid #e2e8f0' }} />
}
