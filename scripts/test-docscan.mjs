// Document scanner — the maths, held to real numbers.
//
// The pixel pushing needs a DOM, so it is not tested here. The pixel pushing is also not
// where the bugs are: the bugs are in corner ordering (a rotated quad silently produces a
// mirrored scan), in the perspective solve (a degenerate system returning NaN instead of
// null), and in the risk rule that decides whether the ORIGINAL BILL IS KEPT. That last
// one is the whole reason this file exists — if assessRisk is wrong, a faint thermal
// receipt gets thresholded to a blank page and the original is thrown away with it.
//
// Run: node scripts/test-docscan.mjs
import {
  orderCorners, solvePerspective, quadSize, assessRisk, MODES, OUT_MAX,
} from '../src/lib/docScan.js'

let pass = 0, fail = 0
const t = (label, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`) }
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e

console.log('\nCORNER ORDER  (a rotated quad must not produce a mirrored scan)')
{
  const tl = { x: 10, y: 10 }, tr = { x: 90, y: 14 }, br = { x: 94, y: 120 }, bl = { x: 6, y: 116 }
  const want = JSON.stringify([tl, tr, br, bl])
  t('already in order', JSON.stringify(orderCorners([tl, tr, br, bl])) === want)
  t('shuffled', JSON.stringify(orderCorners([br, tl, bl, tr])) === want)
  t('reversed', JSON.stringify(orderCorners([bl, br, tr, tl])) === want)
  // A photo of a bill on a desk is rarely straight — 20° of tilt must still resolve.
  const rot = (p, d) => ({ x: Math.round(p.x * Math.cos(d) - p.y * Math.sin(d)) + 200,
                           y: Math.round(p.x * Math.sin(d) + p.y * Math.cos(d)) + 200 })
  const d = 20 * Math.PI / 180
  const o = orderCorners([tl, tr, br, bl].map(p => rot(p, d)))
  t('20° of tilt still orders correctly',
    !!o && o[0].y < o[2].y && o[0].x < o[1].x && o[3].x < o[2].x)
  t('three points is not a quad', orderCorners([tl, tr, br]) === null)
  t('null in, null out', orderCorners(null) === null)
  t('a collapsed quad is rejected', orderCorners([tl, tl, tl, tl]) === null)
}

console.log('\nPERSPECTIVE SOLVE')
{
  const dst = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }]
  // An identity-shaped mapping must come back as the identity, or every warp is skewed.
  const H = solvePerspective(dst, dst)
  t('mapping a rectangle to itself is the identity',
    !!H && near(H[0], 1) && near(H[1], 0) && near(H[2], 0)
        && near(H[3], 0) && near(H[4], 1) && near(H[5], 0)
        && near(H[6], 0) && near(H[7], 0))

  // A real tilted photo: check the solved map sends each output corner to its source.
  const src = [{ x: 30, y: 40 }, { x: 210, y: 18 }, { x: 250, y: 300 }, { x: 12, y: 280 }]
  const K = solvePerspective(dst, src)
  const apply = (K, x, y) => {
    const den = K[6] * x + K[7] * y + 1
    return { x: (K[0] * x + K[1] * y + K[2]) / den, y: (K[3] * x + K[4] * y + K[5]) / den }
  }
  t('every corner maps back to its source point',
    !!K && dst.every((p, i) => {
      const q = apply(K, p.x, p.y)
      return near(q.x, src[i].x, 1e-6) && near(q.y, src[i].y, 1e-6)
    }))
  // Degenerate input must return null, not NaN — NaN paints a canvas of transparent
  // noise and looks like a broken camera rather than a bad crop.
  const bad = solvePerspective(
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 4 }])
  t('a degenerate quad returns null, never NaN', bad === null)
}

console.log('\nOUTPUT SIZE')
{
  const q = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 1200 }, { x: 0, y: 1200 }]
  const s = quadSize(q)
  t('keeps aspect for a portrait page', near(s.w / s.h, 800 / 1200, 0.02))
  t('caps the long edge', quadSize(
    [{ x: 0, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 12000 }, { x: 0, y: 12000 }]).h <= OUT_MAX)
  t('never returns a zero dimension',
    quadSize([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]).w >= 1)
}

console.log('\nRISK  (decides whether the ORIGINAL BILL is kept)')
{
  t('a clean printed invoice needs no original',
    assessRisk({ ink: 0.09, saturation: 0.04, mode: 'xerox' }) === null)
  t('an almost-blank scan keeps the original',
    /faint/.test(assessRisk({ ink: 0.004, mode: 'xerox' }) || ''))
  t('an almost-black scan keeps the original',
    /dark/.test(assessRisk({ ink: 0.7, mode: 'xerox' }) || ''))
  t('a bill with a coloured stamp keeps the original',
    /colour|stamp/.test(assessRisk({ ink: 0.1, saturation: 0.3, mode: 'xerox' }) || ''))
  t('hand-adjusted edges keep the original',
    /edges/.test(assessRisk({ ink: 0.1, saturation: 0.05, mode: 'xerox', moved: true }) || ''))
  t('original-colour mode destroys nothing, so no second copy',
    assessRisk({ ink: 0.001, saturation: 0.9, mode: 'plain', moved: true }) === null)
  t('a thermal receipt in greyscale mode is still checked for blankness',
    assessRisk({ ink: 0.005, mode: 'grey' }) !== null)
  t('defaults alone flag a blank result rather than passing it',
    assessRisk() !== null)
}

console.log('\nMODES')
t('three modes, each with a label and a hint',
  Object.keys(MODES).length === 3 && Object.values(MODES).every(m => m.label && m.hint))

console.log(`\n${'═'.repeat(62)}\n  ${pass} passed, ${fail} failed\n${'═'.repeat(62)}\n`)
process.exit(fail ? 1 : 0)
