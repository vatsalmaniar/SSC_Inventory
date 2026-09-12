import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MODES, loadImage, toWorkCanvas, detectQuad, fullFrameQuad, quadSize,
  warpQuad, cleanPage, meanSaturation, assessRisk, canvasToBlob, orderCorners,
} from '../lib/docScan'

// Scan a photographed bill into a flat, readable page.
//
// Corners are detected automatically and shown as four draggable handles. Detection is
// the convenience; the handles are the guarantee — when detection declines to guess
// (a bill on a white desk, a photo taken at an angle) the handles start at the full frame
// and the person drags them, rather than being shown a bad crop with no way out.
//
// Skip is always available and always uploads the untouched original. A screenshot of a
// UPI payment is not a document and should not be run through a document scanner.
//
// Rendered INLINE, as a step inside the Add Expense drawer — not as a modal over it. A
// dialog stacked on a drawer is two scrims deep, and on a phone the drawer is already the
// whole screen so the modal was just a smaller box inside a full-screen box.

export default function DocScanner({ file, onCancel, onDone }) {
  const [stage, setStage] = useState('load')       // load | adjust | preview | failed
  const [mode, setMode] = useState('xerox')
  const [quad, setQuad] = useState(null)
  const [moved, setMoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)       // { blob, url, ink, risk }
  const [note, setNote] = useState('')

  const work = useRef(null)                        // { canvas, w, h }
  const satRef = useRef(0)
  const viewRef = useRef(null)
  const drag = useRef(null)
  const srcUrl = useRef(null)

  useEffect(() => {
    let dead = false
    ;(async () => {
      srcUrl.current = URL.createObjectURL(file)
      try {
        const img = await loadImage(srcUrl.current)
        if (dead) return
        const w = toWorkCanvas(img)
        work.current = w
        const data = w.ctx.getImageData(0, 0, w.w, w.h)
        satRef.current = meanSaturation(data.data)
        const found = detectQuad(data, w.w, w.h)
        setQuad(found || fullFrameQuad(w.w, w.h))
        setNote(found ? '' : 'Could not find the edges — drag the corners to the bill.')
        setStage('adjust')
      } catch {
        // HEIC is the common case: iPhone photos are HEIC and Chrome cannot decode them
        // to a canvas at all. That is not an error the person can do anything about, so
        // say what will happen and let them carry on.
        if (!dead) setStage('failed')
      }
    })()
    return () => { dead = true; if (srcUrl.current) URL.revokeObjectURL(srcUrl.current) }
  }, [file])

  useEffect(() => () => { if (result?.url) URL.revokeObjectURL(result.url) }, [result])

  // ── Corner dragging ────────────────────────────────────────────────────────
  const toImage = useCallback((clientX, clientY) => {
    const el = viewRef.current
    if (!el || !work.current) return null
    const r = el.getBoundingClientRect()
    const sx = work.current.w / r.width, sy = work.current.h / r.height
    return {
      x: Math.max(0, Math.min(work.current.w, (clientX - r.left) * sx)),
      y: Math.max(0, Math.min(work.current.h, (clientY - r.top) * sy)),
    }
  }, [])

  function onPointerDown(e, i) {
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = i
  }
  function onPointerMove(e) {
    if (drag.current == null) return
    const p = toImage(e.clientX, e.clientY)
    if (!p) return
    setQuad(q => q.map((c, i) => (i === drag.current ? p : c)))
    setMoved(true)
  }
  function onPointerUp() {
    if (drag.current == null) return
    drag.current = null
    // Re-order after a drag: pulling the top-left handle past the top-right one would
    // otherwise leave the quad crossed, and a crossed quad warps to a mirrored page.
    setQuad(q => orderCorners(q) || q)
  }

  // ── Produce the scan ───────────────────────────────────────────────────────
  async function run(nextMode = mode) {
    if (!work.current || busy) return
    setBusy(true)
    try {
      const out = quadSize(quad)
      const warped = warpQuad(work.current.canvas, quad, out)
      if (!warped) { setNote('Those four corners do not form a page — move them apart.'); return }
      const { imageData, ink } = cleanPage(warped, nextMode)
      const c = document.createElement('canvas')
      c.width = out.w; c.height = out.h
      c.getContext('2d').putImageData(imageData, 0, 0)
      const blob = await canvasToBlob(c, 'image/jpeg', nextMode === 'plain' ? 0.9 : 0.95)
      const risk = assessRisk({ ink, saturation: satRef.current, mode: nextMode, moved })
      if (result?.url) URL.revokeObjectURL(result.url)
      setResult({ blob, url: URL.createObjectURL(blob), ink, risk })
      setStage('preview')
    } finally { setBusy(false) }
  }

  function accept() {
    if (!result) return
    const name = file.name.replace(/\.(jpe?g|png|webp|heic|heif)$/i, '') + '-scan.jpg'
    onDone({
      scan: new File([result.blob], name, { type: 'image/jpeg' }),
      mode,
      risk: result.risk,
      // The original is kept only when the scan looks risky — a measured judgement, not
      // a hunch. See assessRisk() for what counts.
      original: result.risk ? file : null,
    })
  }

  const view = work.current
  const pct = p => view ? { left: `${(p.x / view.w) * 100}%`, top: `${(p.y / view.h) * 100}%` } : {}
  // Whole frame, then the quad as a second subpath — with fill-rule evenodd the quad
  // becomes a hole, so only the background dims.
  const holePath = view && quad
    ? `M0 0 H${view.w} V${view.h} H0 Z `
      + `M${quad[0].x} ${quad[0].y} ` + quad.slice(1).map(p => `L${p.x} ${p.y}`).join(' ') + ' Z'
    : ''

  return (
      <div className="ds-card">
        <div className="ds-head">
          <div>
            <div className="ds-title">{stage === 'preview' ? 'Check the scan' : 'Scan the bill'}</div>
            <div className="ds-sub">
              {stage === 'preview'
                ? 'This is what gets attached to the claim.'
                : 'Drag the corners to the edges of the bill.'}
            </div>
          </div>
          <button className="ds-x" onClick={onCancel} aria-label="Close">×</button>
        </div>

        <div className="ds-body">
          {stage === 'load' && <div className="ds-msg">Opening the photo…</div>}

          {stage === 'failed' && (
            <div className="ds-msg">
              This photo cannot be scanned in your browser — iPhone HEIC photos in
              particular. It will be attached exactly as it is, which is perfectly fine.
            </div>
          )}

          {stage === 'adjust' && view && (
            <>
              <div className="ds-view" ref={viewRef}
                   onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                   onPointerCancel={onPointerUp}>
                <img src={srcUrl.current} alt="" draggable={false} />
                {/* The dimming is an SVG path with a hole, not a clip-path on a div:
                    `clip-path: polygon(quad)` clips the overlay TO the quad and dims the
                    bill instead of the background — the exact opposite. An even-odd path
                    of "whole frame, then the quad" cuts the quad out. */}
                <svg className="ds-edges" viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none">
                  <path className="ds-dim" fillRule="evenodd" d={holePath} />
                  <polygon points={quad.map(p => `${p.x},${p.y}`).join(' ')} />
                </svg>
                {quad.map((p, i) => (
                  <button key={i} className="ds-handle" style={pct(p)}
                          onPointerDown={e => onPointerDown(e, i)}
                          aria-label={['Top left', 'Top right', 'Bottom right', 'Bottom left'][i]} />
                ))}
              </div>
              {note && <div className="ds-note">{note}</div>}
            </>
          )}

          {stage === 'preview' && result && (
            <>
              <div className="ds-view ds-preview"><img src={result.url} alt="Scanned bill" /></div>
              <div className="ds-modes">
                {Object.entries(MODES).map(([k, m]) => (
                  <button key={k} className={'ds-mode' + (mode === k ? ' on' : '')} disabled={busy}
                          onClick={() => { setMode(k); run(k) }}>{m.label}</button>
                ))}
              </div>
              <div className="ds-hint">{MODES[mode].hint}</div>
              {result.risk && (
                <div className="ds-risk">
                  <b>The original photo will be kept too</b> — {result.risk}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="ds-foot">
          <button className="ds-btn" onClick={() => onDone({ scan: null, mode: null, risk: null, original: null })}>
            Skip, use the photo
          </button>
          {stage === 'adjust' && (
            <button className="ds-btn ds-go" disabled={busy} onClick={() => run()}>
              {busy ? 'Scanning…' : 'Scan'}
            </button>
          )}
          {stage === 'preview' && (
            <>
              <button className="ds-btn" onClick={() => setStage('adjust')}>Edges</button>
              <button className="ds-btn ds-go" disabled={busy} onClick={accept}>Use this scan</button>
            </>
          )}
        </div>
      </div>
  )
}
