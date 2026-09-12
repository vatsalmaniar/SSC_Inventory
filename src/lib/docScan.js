// Document scanner — turn a phone photo of a bill into a flat, readable scan.
//
//   photo → downscale → find the four corners → perspective-warp → clean up
//
// Everything runs in the browser on a plain 2D canvas. No OpenCV: that is ~8 MB of
// WebAssembly downloaded to a phone on mobile data, for a convenience feature, and this
// needs about 250 lines of arithmetic instead. No Edge Function either — the Supabase
// plan is Micro and image processing is exactly the kind of load that flattened it before.
//
// ── The maths is separated from the canvas on purpose ────────────────────────
// orderCorners / solvePerspective / quadSize / assessRisk are pure functions over plain
// numbers, so they are unit-tested in node (scripts/test-docscan.mjs). Only the pixel
// pushing needs a DOM, and pixel pushing is not where the bugs are.

// A 12 MP phone photo is ~4000×3000. Warping that per-pixel in JS stalls a mid-range
// Android for seconds and can run it out of memory; nothing on a bill needs more than
// this to stay legible.
export const WORK_EDGE = 1600
export const OUT_MAX = 2200

export const MODES = {
  xerox: { label: 'Xerox', hint: 'Black on white — printed bills and invoices' },
  grey:  { label: 'Greyscale', hint: 'Softer — thermal receipts and faint print' },
  plain: { label: 'Original colour', hint: 'Keeps stamps, signatures and logos' },
}

// ── Pure geometry ────────────────────────────────────────────────────────────

/**
 * Put four arbitrary points into a consistent top-left, top-right, bottom-right,
 * bottom-left order. Everything downstream — the warp, the corner handles, the output
 * aspect — assumes that order, and a quad that arrives rotated produces a scan that is
 * mirrored or upside down with no error to explain it.
 */
export function orderCorners(pts) {
  if (!pts || pts.length !== 4) return null
  // x+y is smallest at the top-left and largest at the bottom-right; x−y separates the
  // other two. Robust to rotation up to ~45°, which is far more tilt than a photo of a
  // bill on a desk ever has.
  const sum = p => p.x + p.y
  const dif = p => p.x - p.y
  const byS = [...pts].sort((a, b) => sum(a) - sum(b))
  const byD = [...pts].sort((a, b) => dif(a) - dif(b))
  const tl = byS[0], br = byS[3], bl = byD[0], tr = byD[3]
  // Four distinct points, or the ordering has collapsed (a degenerate quad).
  const uniq = new Set([tl, tr, br, bl])
  return uniq.size === 4 ? [tl, tr, br, bl] : null
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/** Output size for a quad — the longer of each opposing pair, so nothing is squashed. */
export function quadSize([tl, tr, br, bl], cap = OUT_MAX) {
  const w = Math.max(dist(tl, tr), dist(bl, br))
  const h = Math.max(dist(tl, bl), dist(tr, br))
  const s = Math.min(1, cap / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

/**
 * Solve the 8 coefficients mapping dst → src (the INVERSE map, which is what a warp
 * actually needs: for each output pixel, ask where it came from). Straight Gaussian
 * elimination on the 8×8 system; no library, and it is the same arithmetic every
 * perspective transform uses.
 *   x = (a·u + b·v + c) / (g·u + h·v + 1)
 *   y = (d·u + e·v + f) / (g·u + h·v + 1)
 */
export function solvePerspective(dst, src) {
  const A = [], B = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = dst[i], { x, y } = src[i]
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x)
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y)
  }
  for (let col = 0; col < 8; col++) {
    let piv = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-9) return null          // degenerate — caller falls back
    ;[A[col], A[piv]] = [A[piv], A[col]]; [B[col], B[piv]] = [B[piv], B[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (!f) continue
      for (let c = col; c < 8; c++) A[r][c] -= f * A[col][c]
      B[r] -= f * B[col]
    }
  }
  return A.map((row, i) => B[i] / row[i])
}

/**
 * Is this scan safe to keep on its own, or should the original be preserved beside it?
 *
 * The user's rule: keep the original only when the scan looks risky. So "risky" has to be
 * measured rather than felt. A bill is a financial document — if a threshold wiped the
 * total off a faint thermal receipt, nobody finds out until an auditor asks.
 *
 * @param ink        fraction of pixels that ended up dark (0..1)
 * @param saturation mean colour saturation of the SOURCE (0..1)
 * @param mode       which output mode produced this
 * @param moved      did the user drag the corners away from what was detected
 * @returns a reason string, or null when the scan stands on its own
 */
export function assessRisk({ ink = 0, saturation = 0, mode = 'xerox', moved = false } = {}) {
  if (mode === 'plain') return null                 // nothing was destroyed
  if (ink < 0.012) return 'the scan came out almost blank, so the print may have been faint'
  if (ink > 0.55) return 'the scan came out very dark, so detail may be lost in the black'
  if (saturation > 0.18) return 'the bill has colour — a stamp, signature or logo that black-and-white drops'
  if (mode === 'xerox' && ink < 0.03) return 'very little ink survived the black-and-white pass'
  if (moved) return 'the edges were adjusted by hand, so the crop may have cut something'
  return null
}

// ── Canvas work ──────────────────────────────────────────────────────────────

export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    // HEIC is the big one: iPhone photos are HEIC and Chrome/Android cannot decode them
    // to a canvas at all. The caller must treat a rejection as "upload the original
    // untouched", never as an error the person has to deal with.
    i.onerror = () => rej(new Error('This image cannot be opened for scanning'))
    i.src = src
  })
}

/** Draw the image at working size and return { canvas, ctx, w, h, scale }. */
export function toWorkCanvas(img, maxEdge = WORK_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return { canvas, ctx, w, h, scale }
}

const grayOf = d => {
  const g = new Uint8ClampedArray(d.length / 4)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    g[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0
  }
  return g
}

/** Mean saturation of the source — how much colour would black-and-white throw away. */
export function meanSaturation(data) {
  let t = 0, n = 0
  for (let i = 0; i < data.length; i += 4 * 17) {       // every 17th pixel is plenty
    const mx = Math.max(data[i], data[i + 1], data[i + 2])
    const mn = Math.min(data[i], data[i + 1], data[i + 2])
    if (mx > 24) { t += (mx - mn) / mx; n++ }           // ignore near-black, where hue is noise
  }
  return n ? t / n : 0
}

/** Separable box blur — two 1-D passes, O(n) per radius rather than O(n·r²). */
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1)
      acc -= src[y * w + Math.min(w - 1, Math.max(0, x - r))]
      acc += src[y * w + Math.min(w - 1, Math.max(0, x + r + 1))]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1)
      acc -= tmp[Math.min(h - 1, Math.max(0, y - r)) * w + x]
      acc += tmp[Math.min(h - 1, Math.max(0, y + r + 1)) * w + x]
    }
  }
  return out
}

/**
 * Find the document's four corners.
 *
 * Not a contour finder: it marks pixels with a strong gradient, then takes the extreme
 * points of that mask along the two diagonals. On the actual case — a bill lying on a
 * desk, filling most of the frame, against a contrasting surface — that lands on the
 * corners, and it costs two passes instead of a convex-hull search.
 *
 * Returns null when the result is not plausibly a document. Null is a fine answer: the
 * caller falls back to the full frame and the user drags the handles. Detection is the
 * convenience; the handles are the guarantee.
 */
export function detectQuad(imgData, w, h) {
  const gray = grayOf(imgData.data)
  const blur = boxBlur(Float32Array.from(gray), w, h, 2)

  let maxMag = 0
  const mag = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = blur[i - w + 1] + 2 * blur[i + 1] + blur[i + w + 1]
               - blur[i - w - 1] - 2 * blur[i - 1] - blur[i + w - 1]
      const gy = blur[i + w - 1] + 2 * blur[i + w] + blur[i + w + 1]
               - blur[i - w - 1] - 2 * blur[i - w] - blur[i - w + 1]
      const m = Math.abs(gx) + Math.abs(gy)
      mag[i] = m
      if (m > maxMag) maxMag = m
    }
  }
  if (maxMag < 40) return null                      // flat image — nothing to find

  const cut = maxMag * 0.28
  // Ignore a 2% frame: phone cameras vignette, and the picture's own border is the
  // strongest edge in the image if you let it count.
  const pad = Math.round(Math.min(w, h) * 0.02)
  let best = null, n = 0
  const ext = { sMin: Infinity, sMax: -Infinity, dMin: Infinity, dMax: -Infinity }
  const pick = {}
  for (let y = pad; y < h - pad; y++) {
    for (let x = pad; x < w - pad; x++) {
      if (mag[y * w + x] < cut) continue
      n++
      const s = x + y, d = x - y
      if (s < ext.sMin) { ext.sMin = s; pick.tl = { x, y } }
      if (s > ext.sMax) { ext.sMax = s; pick.br = { x, y } }
      if (d < ext.dMin) { ext.dMin = d; pick.bl = { x, y } }
      if (d > ext.dMax) { ext.dMax = d; pick.tr = { x, y } }
    }
  }
  if (n < 200 || !pick.tl || !pick.tr || !pick.br || !pick.bl) return null

  best = orderCorners([pick.tl, pick.tr, pick.br, pick.bl])
  if (!best) return null

  // Sanity: a detection covering a sliver of the frame is noise, not a document.
  const { w: qw, h: qh } = quadSize(best, Infinity)
  if (qw * qh < w * h * 0.14) return null
  if (qw < w * 0.25 || qh < h * 0.25) return null
  return best
}

/** The whole frame, inset slightly — the fallback when detection declines to guess. */
export const fullFrameQuad = (w, h) => {
  const m = Math.round(Math.min(w, h) * 0.03)
  return [{ x: m, y: m }, { x: w - m, y: m }, { x: w - m, y: h - m }, { x: m, y: h - m }]
}

/** Perspective-warp the quad out of `srcCanvas` into a flat rectangle. */
export function warpQuad(srcCanvas, quad, out) {
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  const src = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height)
  const sw = src.width, sh = src.height, sd = src.data

  const H = solvePerspective(
    [{ x: 0, y: 0 }, { x: out.w, y: 0 }, { x: out.w, y: out.h }, { x: 0, y: out.h }], quad)
  if (!H) return null
  const [a, b, c, d, e, f, g, hh] = H

  const dst = new ImageData(out.w, out.h)
  const dd = dst.data
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const den = g * x + hh * y + 1
      const sx = (a * x + b * y + c) / den
      const sy = (d * x + e * y + f) / den
      const o = (y * out.w + x) * 4
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) { dd[o] = dd[o + 1] = dd[o + 2] = 255; dd[o + 3] = 255; continue }
      // Bilinear — nearest-neighbour makes small print look chewed.
      const x0 = sx | 0, y0 = sy | 0
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1)
      const fx = sx - x0, fy = sy - y0
      for (let ch = 0; ch < 3; ch++) {
        const p00 = sd[(y0 * sw + x0) * 4 + ch], p10 = sd[(y0 * sw + x1) * 4 + ch]
        const p01 = sd[(y1 * sw + x0) * 4 + ch], p11 = sd[(y1 * sw + x1) * 4 + ch]
        dd[o + ch] = (p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy)
                    + p01 * (1 - fx) * fy + p11 * fx * fy) | 0
      }
      dd[o + 3] = 255
    }
  }
  return dst
}

/**
 * Clean the warped page. Returns { imageData, ink } where `ink` is the fraction of dark
 * pixels — the number assessRisk() uses to notice a blank or solid-black result.
 *
 * The threshold is ADAPTIVE (local mean), never global. Every phone photo has a lighting
 * gradient across the page; a single global cut turns the shaded half solid black.
 */
export function cleanPage(imageData, mode = 'xerox') {
  const { width: w, height: h, data } = imageData
  const gray = grayOf(data)
  let ink = 0

  if (mode === 'plain') {
    for (let i = 0; i < gray.length; i++) if (gray[i] < 110) ink++
    return { imageData, ink: ink / gray.length }
  }

  const r = Math.max(8, Math.round(Math.min(w, h) / 28))
  const local = boxBlur(Float32Array.from(gray), w, h, r)

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v
    if (mode === 'xerox') {
      // 6% below the local mean = ink. Lower and paper texture prints as speckle; higher
      // and a light thermal print disappears entirely.
      v = gray[p] < local[p] * 0.94 ? 0 : 255
    } else {
      // Greyscale: normalise against the local mean so the page whitens evenly but the
      // faint strokes survive as grey rather than being forced to a decision.
      v = Math.max(0, Math.min(255, 255 - (local[p] - gray[p]) * 2.6))
    }
    if (v < 110) ink++
    data[i] = data[i + 1] = data[i + 2] = v
    data[i + 3] = 255
  }
  return { imageData, ink: ink / gray.length }
}

export function canvasToBlob(canvas, type = 'image/jpeg', q = 0.92) {
  return new Promise(res => canvas.toBlob(res, type, q))
}
