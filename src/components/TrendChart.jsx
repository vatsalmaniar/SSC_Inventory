import { useEffect, useMemo, useRef, useState } from 'react'

// Shared area + line chart for the People dashboards — the "market chart" look.
//
// Drawn at the container's REAL pixel width, measured with a ResizeObserver, rather
// than a fixed viewBox stretched with preserveAspectRatio="none". Stretching scales x
// and y by different factors, which squashes the curve and turns dots into ellipses;
// vector-effect fixes stroke weight but not geometry.
//
// props
//   points   [{ key, label, value, bad? }]  value = number, bad = paint this point red
//   refValue optional horizontal reference line (e.g. shift start time)
//   refLabel label for that line
//   fmt      (value) => string, for tooltips and the axis range
//   invert   true when LOWER is better (arrival times): flips the fill direction
export default function TrendChart({ points = [], refValue = null, refLabel = '', fmt = v => String(v), invert = false, height = 96 }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(0)
  const [hover, setHover] = useState(null)   // index of the point under the cursor

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  const H = height, PAD_X = 5, PAD_T = 10, PAD_B = 16
  const n = points.length

  // Hooks run before any early return (react-hooks/rules-of-hooks).
  const geo = useMemo(() => {
    if (n < 2 || w < 40) return null
    const vals = points.map(p => p.value)
    const lo0 = Math.min(...vals, ...(refValue != null ? [refValue] : []))
    const hi0 = Math.max(...vals, ...(refValue != null ? [refValue] : []))
    // Pad the range so a nearly-flat series is not pinned to one edge.
    const pad = Math.max(1, (hi0 - lo0) * 0.18)
    const lo = lo0 - pad, hi = hi0 + pad
    const span = Math.max(1, hi - lo)
    const x = i => PAD_X + (i / (n - 1)) * (w - PAD_X * 2)
    const y = v => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B)
    const pts = points.map((p, i) => [x(i), y(p.value)])
    let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
      const cx = (x0 + x1) / 2
      line += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
    }
    // For "lower is better" the fill reads better hanging from the top.
    const base = invert ? PAD_T : H - PAD_B
    const area = `${line} L ${pts[n-1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`
    return { pts, line, area, lo, hi, refY: refValue != null ? y(refValue) : null }
  }, [points, n, w, refValue, invert, H])

  if (!n) return <div className="ph-chart-empty">Nothing to plot yet</div>
  if (n === 1) return <div className="ph-chart-empty">{fmt(points[0].value)} on {points[0].label}</div>

  return (
    <div className="ph-chart" ref={wrapRef}>
      {geo && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="ph-chart-svg">
          <defs>
            <linearGradient id="ph-trend-fill" x1="0" y1={invert ? '1' : '0'} x2="0" y2={invert ? '0' : '1'}>
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.20" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {geo.refY != null && (
            <>
              <line x1="0" y1={geo.refY} x2={w} y2={geo.refY} className="ph-chart-ref" />
              {refLabel && <text x="2" y={geo.refY - 4} className="ph-chart-reflabel">{refLabel}</text>}
            </>
          )}
          <path d={geo.area} fill="url(#ph-trend-fill)" />
          <path d={geo.line} fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
          {hover != null && geo.pts[hover] && (
            <line x1={geo.pts[hover][0]} y1={PAD_T} x2={geo.pts[hover][0]} y2={H - PAD_B} className="ph-chart-cursor" />
          )}
          {geo.pts.map(([px, py], i) => (
            <circle key={points[i].key} cx={px} cy={py} r={hover === i ? 5 : (i === n - 1 ? 4 : 2.6)}
              className={points[i].bad ? 'ph-chart-pt is-bad' : (i === n - 1 ? 'ph-chart-head' : 'ph-chart-pt')}>
              <title>{`${points[i].label} · ${fmt(points[i].value)}`}</title>
            </circle>
          ))}
          {/* Wide invisible hit strips: the dots are 3-5px, which is a hard target.
              These make the whole column hoverable. */}
          {geo.pts.map(([px], i) => (
            <rect key={'h' + points[i].key} x={px - (w / n) / 2} y={0} width={w / n} height={H}
              fill="transparent" style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          ))}
        </svg>
      )}
      {hover != null && geo && (
        <div className="ph-chart-tip"
          style={{ left: `${(geo.pts[hover][0] / w) * 100}%`, top: `${geo.pts[hover][1]}px` }}>
          <div className="ph-chart-tip-l">{points[hover].label}</div>
          <div className="ph-chart-tip-v">{fmt(points[hover].value)}</div>
          {points[hover].note && <div className="ph-chart-tip-n">{points[hover].note}</div>}
        </div>
      )}
      <div className="ph-chart-axis">
        <span>{points[0].label}</span>
        <span>{geo ? `${fmt(geo.lo)} – ${fmt(geo.hi)}` : ''}</span>
        <span>{points[n-1].label}</span>
      </div>
    </div>
  )
}
