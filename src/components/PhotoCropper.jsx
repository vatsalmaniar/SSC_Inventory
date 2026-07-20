import { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Cropper from 'react-easy-crop'

// Crop to a centred square and export a normalized 512px JPEG (keeps files small/fast).
async function getCroppedBlob(src, area) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, 512, 512)
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9))
}

const btn = { borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }

export default function PhotoCropper({ src, onCancel, onDone }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState(null)
  const [busy, setBusy] = useState(false)
  const onComplete = useCallback((_, px) => setArea(px), [])

  async function done() {
    if (!area || busy) return
    setBusy(true)
    try { const blob = await getCroppedBlob(src, area); onDone(blob) }
    finally { setBusy(false) }
  }

  return createPortal(
    <div className="people-drawer-scrim" style={{ display: 'grid', placeItems: 'center' }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{ width: 400, maxWidth: '92vw', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 16px 40px rgba(10,37,64,.3)', fontFamily: "'Geist','DM Sans',sans-serif" }}>
        <div style={{ padding: '15px 18px', borderBottom: '1px solid #EFF1F4', fontSize: 15, fontWeight: 600, color: '#1D2D3E' }}>Crop photo</div>
        <div style={{ position: 'relative', height: 320, background: '#0A2540' }}>
          <Cropper image={src} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
            onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onComplete} />
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#5B738B' }}>
            Zoom
            <input type="range" min="1" max="3" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ flex: 1, accentColor: '#1a73e8' }} />
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
            <button onClick={onCancel} style={{ ...btn, background: '#fff', border: '1px solid #E4E7EC', color: '#1D2D3E' }}>Cancel</button>
            <button onClick={done} disabled={busy} style={{ ...btn, background: '#1a73e8', border: '1px solid #1a73e8', color: '#fff', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : 'Use photo'}</button>
          </div>
        </div>
      </div>
    </div>, document.body)
}
