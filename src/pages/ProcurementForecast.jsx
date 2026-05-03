import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import ForecastPOModal from './ForecastPOModal'
import '../styles/procurement-forecast.css'

const MONTH_NAMES = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' }
const DELIVERED_STATUSES = ['dispatched_fc', 'goods_issued', 'invoice_generated', 'closed']

function getPrevQuarter() {
  const now = new Date()
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  let months, label
  if (m >= 4 && m <= 6) {
    months = [`${y}-01`, `${y}-02`, `${y}-03`]; label = `Q4 FY${String(y-1).slice(-2)}-${String(y).slice(-2)}`
  } else if (m >= 7 && m <= 9) {
    months = [`${y}-04`, `${y}-05`, `${y}-06`]; label = `Q1 FY${String(y).slice(-2)}-${String(y+1).slice(-2)}`
  } else if (m >= 10 && m <= 12) {
    months = [`${y}-07`, `${y}-08`, `${y}-09`]; label = `Q2 FY${String(y).slice(-2)}-${String(y+1).slice(-2)}`
  } else {
    months = [`${y-1}-10`, `${y-1}-11`, `${y-1}-12`]; label = `Q3 FY${String(y-1).slice(-2)}-${String(y).slice(-2)}`
  }
  return { months, label }
}

function lastDayOf(yyyyMM) {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// =================== Brand Selector ===================
function BrandSelector({ brand, brands, allConfigs, brandItemCount, onChange, onConfigOpen }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const cfg = brand ? allConfigs[brand] : null
  const reorderDays   = cfg ? (cfg.lead_time_days||0)+(cfg.transit_days||0)+(cfg.processing_days||0) : 0
  const replenishDays = cfg ? reorderDays + (cfg.inventory_days||45) : 0
  const filtered = brands.filter(b => !filter || b.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="card brand-bar" style={{ padding: '10px 14px' }}>
      <div className="brand-picker" ref={ref}>
        <button className="brand-btn" onClick={() => setOpen(o => !o)}>
          <div className="brand-btn-inner">
            <div className="brand-avatar">{brand ? brand[0].toUpperCase() : '—'}</div>
            <div>
              <div className="brand-name">{brand || 'Select a brand'}</div>
              <div className="brand-sub mono">{brand ? `${brandItemCount} standard items` : `${brands.length} brands available`}</div>
            </div>
          </div>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 6 L8 10 L12 6"/></svg>
        </button>
        {open && (
          <div className="brand-menu" onClick={e => e.stopPropagation()}>
            <div className="brand-menu-search">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
              <input placeholder="Search brands…" autoFocus value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
            {filtered.map(b => {
              const c = allConfigs[b]
              const lead = c ? (c.lead_time_days||0)+(c.transit_days||0)+(c.processing_days||0) : null
              return (
                <button key={b} className={`brand-menu-item ${b === brand ? 'on' : ''}`} onClick={() => { onChange(b); setOpen(false); setFilter('') }}>
                  <div className="brand-menu-avatar">{b[0].toUpperCase()}</div>
                  <div className="brand-menu-info">
                    <div className="brand-menu-name">{b}</div>
                    <div className="brand-menu-sub mono">{lead != null ? `${lead}d lead` : 'no config'}</div>
                  </div>
                  {b === brand && <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#3DD9D6" strokeWidth="2"><path d="M3 8 L7 12 L13 4"/></svg>}
                </button>
              )
            })}
            {filtered.length === 0 && <div style={{ padding: '12px', textAlign: 'center', color: 'var(--pf-muted)', fontSize: 12 }}>No matches</div>}
          </div>
        )}
      </div>
      {brand && cfg && (
        <div className="brand-meta">
          <div className="bm-pill bm-reorder">
            <span className="bm-label">Reorder</span>
            <span className="bm-val">{reorderDays}d</span>
          </div>
          <div className="bm-pill bm-replen">
            <span className="bm-label">Replenishment</span>
            <span className="bm-val">{replenishDays}d</span>
          </div>
        </div>
      )}
      {brand && !cfg && (
        <div className="brand-meta">
          <div className="bm-pill" style={{ borderColor: '#FCD34D', background: 'rgba(245,158,11,0.08)' }}>
            <span className="bm-label" style={{ color: '#B45309' }}>No config — set lead times to enable forecast</span>
          </div>
        </div>
      )}
      <div className="brand-actions">
        <button className="btn-ghost" onClick={onConfigOpen} disabled={!brand}>
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5 V3.5 M8 12.5 V14.5 M14.5 8 H12.5 M3.5 8 H1.5 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6 M12.6 12.6 L11.2 11.2 M4.8 4.8 L3.4 3.4"/></svg>
          Configure Lead Times
        </button>
      </div>
    </div>
  )
}

// =================== Stock Chart ===================
function StockChart({ items, brand, cfg, totalStats }) {
  const [hover, setHover] = useState(null)
  const [hoverIdx, setHoverIdx] = useState(null)
  const [filter, setFilter] = useState('all')
  const [showLines, setShowLines] = useState({ stock: true, min: true, po: true })
  const svgRef = useRef(null)

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter)
  const visible = filtered.slice(0, 60)

  const W = 1000, H = 360, P = { l: 0, r: 64, t: 24, b: 50 }
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b

  const reorderDays = (cfg?.lead_time_days||0)+(cfg?.transit_days||0)+(cfg?.processing_days||0)

  if (visible.length === 0) {
    return <div className="sc-empty">No items match this filter.</div>
  }

  const allVals = visible.flatMap(i => [i.stock, i.minQty, i.poQty])
  const maxY = Math.max(1, ...allVals) * 1.08
  const x = i => P.l + (visible.length === 1 ? innerW / 2 : (i / (visible.length - 1)) * innerW)
  const y = v => P.t + innerH - (v / maxY) * innerH

  const smoothPath = (pts) => {
    if (pts.length < 2) return ''
    let d = `M ${pts[0].x} ${pts[0].y}`
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] || p2
      d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
    }
    return d
  }

  const stockPts = visible.map((it, i) => ({ x: x(i), y: y(it.stock) }))
  const minPts = visible.map((it, i) => ({ x: x(i), y: y(it.minQty) }))
  const poPts = visible.map((it, i) => ({ x: x(i), y: y(it.poQty) }))
  const stockPath = smoothPath(stockPts)
  const minPath = smoothPath(minPts)
  const poPath = smoothPath(poPts)
  const stockArea = `${stockPath} L ${x(visible.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`

  const axisVals = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(maxY * p / 100) * 100)

  const xLabels = visible.length > 1 ? [
    { i: 0, label: visible[0].label },
    { i: Math.floor(visible.length / 4), label: visible[Math.floor(visible.length / 4)].label },
    { i: Math.floor(visible.length / 2), label: visible[Math.floor(visible.length / 2)].label },
    { i: Math.floor(visible.length * 3 / 4), label: visible[Math.floor(visible.length * 3 / 4)].label },
    { i: visible.length - 1, label: visible[visible.length - 1].label },
  ] : [{ i: 0, label: visible[0].label }]

  const handleMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W - P.l
    const idx = Math.round((px / innerW) * (visible.length - 1))
    if (idx >= 0 && idx < visible.length) {
      setHover(visible[idx])
      setHoverIdx(idx)
    }
  }

  const fullList = items
  const totalDemand = fullList.reduce((a, b) => a + b.qAvg, 0)
  const totalStock = fullList.reduce((a, b) => a + b.stock, 0)
  const aboveMin = fullList.filter(v => v.stock >= v.minQty && !v.noConfig).length
  const coveragePct = fullList.length > 0 ? Math.round((aboveMin / fullList.length) * 100) : 0
  const avgDaysOfSupply = fullList.length ? Math.round(fullList.reduce((a, b) => a + (b.qAvg > 0 ? (b.stock / b.qAvg) * 30 : 0), 0) / fullList.length) : 0
  const stockoutRisk = fullList.filter(v => v.qAvg > 0 && (v.stock / v.qAvg) * 30 < reorderDays).length

  return (
    <div className="sc-wrap">
      <div className="sc-headline">
        <div>
          <div className="sc-eyebrow mono">FORECAST ANALYSIS · {brand}</div>
          <div className="sc-title">Stock Coverage vs Reorder Threshold</div>
          <div className="sc-headline-sub">
            <span className="sc-coverage">{coveragePct}% coverage</span>
            <span className="sc-dot">·</span>
            <span>{fullList.length} items · showing {visible.length}</span>
            <span className="sc-dot">·</span>
            <span>{stockoutRisk} at stockout risk</span>
          </div>
        </div>
        <div className="sc-controls">
          <div className="sc-filter-bar">
            {[
              { v: 'all', l: 'All' },
              { v: 'critical', l: 'Critical' },
              { v: 'ok', l: 'OK' },
            ].map(f => (
              <button key={f.v} className={filter === f.v ? 'on' : ''} onClick={() => setFilter(f.v)}>{f.l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="sc-legend">
        <button className={`scl-item ${showLines.stock ? 'on' : 'off'}`} onClick={() => setShowLines({...showLines, stock: !showLines.stock})}>
          <span className="scl-swatch scl-stock"/> Current Stock
        </button>
        <button className={`scl-item ${showLines.min ? 'on' : 'off'}`} onClick={() => setShowLines({...showLines, min: !showLines.min})}>
          <span className="scl-swatch scl-min"/> Min Qty (Reorder)
        </button>
        <button className={`scl-item ${showLines.po ? 'on' : 'off'}`} onClick={() => setShowLines({...showLines, po: !showLines.po})}>
          <span className="scl-swatch scl-po"/> PO Target Qty
        </button>
      </div>

      <svg
        className="stock-chart"
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        onMouseMove={handleMove}
        onMouseLeave={() => { setHover(null); setHoverIdx(null) }}
      >
        <defs>
          <linearGradient id="stockFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#1E54B7" stopOpacity="0.22"/>
            <stop offset="100%" stopColor="#1E54B7" stopOpacity="0"/>
          </linearGradient>
        </defs>

        {axisVals.map((v, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeDasharray={i === 0 ? '0' : '2 4'}/>
            <text x={W - P.r + 10} y={y(v) + 4} fontSize="11" fill="#94A3B8" fontFamily="Geist Mono, monospace">{v >= 1000 ? (v/1000).toFixed(1) + 'K' : v}</text>
          </g>
        ))}

        {showLines.po && <path d={poPath} stroke="#94A3B8" strokeWidth="1.5" fill="none" strokeDasharray="2 4" opacity="0.7"/>}
        {showLines.min && <path d={minPath} stroke="#EF4444" strokeWidth="1.6" fill="none" strokeDasharray="6 4" opacity="0.85"/>}

        {showLines.stock && (
          <>
            <path d={stockArea} fill="url(#stockFill)"/>
            <path d={stockPath} stroke="#1E54B7" strokeWidth="2.4" fill="none" strokeLinejoin="round"/>
          </>
        )}

        {hoverIdx !== null && hover && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={P.t} y2={P.t + innerH} stroke="#94A3B8" strokeDasharray="2 3" strokeWidth="1"/>
            {showLines.stock && <circle cx={x(hoverIdx)} cy={y(hover.stock)} r="5" fill="#fff" stroke="#1E54B7" strokeWidth="2.5"/>}
            {showLines.min && <circle cx={x(hoverIdx)} cy={y(hover.minQty)} r="3.5" fill="#fff" stroke="#EF4444" strokeWidth="2"/>}
            {showLines.po && <circle cx={x(hoverIdx)} cy={y(hover.poQty)} r="3.5" fill="#fff" stroke="#94A3B8" strokeWidth="2"/>}
          </g>
        )}

        {xLabels.map((l, i) => (
          <text key={i} x={x(l.i)} y={H - 16} fontSize="10.5" fill="#94A3B8"
            textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'}
            fontFamily="Geist Mono, monospace">{l.label}</text>
        ))}

        {hover && hoverIdx !== null && (() => {
          const cx = x(hoverIdx)
          const tipX = cx > W * 0.6 ? cx - 232 : cx + 16
          const days = hover.qAvg > 0 ? Math.round((hover.stock / hover.qAvg) * 30) : 0
          const codeStr = (hover.code || '').length > 28 ? hover.code.slice(0, 26) + '…' : (hover.code || '')
          return (
            <g transform={`translate(${tipX}, ${P.t + 8})`}>
              <rect width="220" height="156" rx="10" fill="#0A2540"/>
              <text x="14" y="22" fontSize="10" fill="#3DD9D6" fontFamily="Geist Mono, monospace" letterSpacing="0.06em">{hover.label}</text>
              <text x="14" y="40" fontSize="11.5" fill="#fff" fontWeight="600">{codeStr}</text>
              <line x1="14" x2="206" y1="50" y2="50" stroke="rgba(255,255,255,0.1)"/>
              <text x="14" y="68" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">CURRENT STOCK</text>
              <text x="206" y="68" fontSize="12" fill="#fff" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.stock.toLocaleString()}</text>
              <text x="14" y="84" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">MIN QTY</text>
              <text x="206" y="84" fontSize="12" fill="#FCA5A5" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.minQty.toLocaleString()}</text>
              <text x="14" y="100" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">PO TARGET</text>
              <text x="206" y="100" fontSize="12" fill="#94A3B8" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.poQty.toLocaleString()}</text>
              <line x1="14" x2="206" y1="112" y2="112" stroke="rgba(255,255,255,0.1)"/>
              <text x="14" y="130" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">DAYS OF SUPPLY</text>
              <text x="206" y="130" fontSize="12" fill={days < reorderDays && reorderDays > 0 ? '#FCA5A5' : '#3DD9D6'} fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{days}d</text>
              <text x="14" y="146" fontSize="10" fill="rgba(255,255,255,0.55)" fontFamily="Geist Mono, monospace">MONTHLY DEMAND</text>
              <text x="206" y="146" fontSize="12" fill="#fff" fontWeight="600" textAnchor="end" fontFamily="Geist Mono, monospace">{hover.qAvg.toLocaleString()}</text>
            </g>
          )
        })()}
      </svg>

      <div className="sc-stats">
        <div className="sc-stat sc-stat-need">
          <span>NEED ORDER</span>
          <span className="mono"><b className="down">{totalStats.needOrder}</b></span>
          <span className="sc-stat-sub">below reorder level</span>
        </div>
        <div className="sc-stat sc-stat-good">
          <span>SUFFICIENT</span>
          <span className="mono"><b className="up">{totalStats.sufficient}</b></span>
          <span className="sc-stat-sub">above reorder level</span>
        </div>
        <div className="sc-stat">
          <span>COVERAGE</span>
          <span className="mono"><b className={coveragePct < 70 ? 'down' : 'up'}>{coveragePct}%</b></span>
          <span className="sc-stat-sub">{aboveMin} of {fullList.length} above min</span>
        </div>
        <div className="sc-stat">
          <span>AVG DAYS OF SUPPLY</span>
          <span className="mono"><b>{avgDaysOfSupply}d</b></span>
          <span className="sc-stat-sub">target {reorderDays}d</span>
        </div>
        <div className="sc-stat">
          <span>FILL RATIO</span>
          <span className="mono"><b>{totalDemand > 0 ? (totalStock / totalDemand).toFixed(2) : '—'}×</b></span>
          <span className="sc-stat-sub">stock ÷ monthly demand</span>
        </div>
      </div>
    </div>
  )
}

// =================== Items Table ===================
function StatusPill({ status }) {
  const map = {
    critical: { label: 'Order',    cls: 'pill-critical' },
    noconfig: { label: 'No Cfg',   cls: 'pill-noconfig' },
    ok:       { label: 'OK',       cls: 'pill-ok' },
  }
  const v = map[status] || map.ok
  return <span className={`pill ${v.cls}`}>{v.label}</span>
}

function ItemRow({ item, monthsKeys, salesData, stockData, calc, onSalesEdit, onCopySys, onStockEdit, onCopySysStock }) {
  const c  = calc(item.item_code)
  const st = stockData[item.item_code] || { kaveri: 0, godawari: 0, manual: null }
  const sysStock = (st.kaveri || 0) + (st.godawari || 0)
  const status = c.noConfig ? 'noconfig' : c.needsOrder ? 'critical' : 'ok'

  return (
    <div className={`it-row it-data status-${status}`}>
      <div className="it-cell it-code">
        {item.item_no && <div className="it-id mono">{item.item_no}</div>}
        <div className="it-name">{item.item_code}</div>
      </div>
      <div className="it-sales-months it-sales-cells">
        {monthsKeys.map(m => {
          const s = salesData[item.item_code]?.[m] || { sys: 0, manual: null }
          return (
            <div key={m} className="it-cell it-month">
              <div className="it-orig mono">
                {s.sys > 0 ? s.sys : '—'}
                {s.sys > 0 && (
                  <button title="Copy to override" onClick={() => onCopySys(item.item_code, m)}
                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--pf-muted-2)', padding:'0 0 0 4px', fontSize:11, lineHeight:1 }}>↓</button>
                )}
              </div>
              <input
                type="number" min="0"
                className={`it-input mono ${s.manual === null ? 'empty' : ''}`}
                value={s.manual !== null ? s.manual : ''}
                placeholder="—"
                onChange={e => onSalesEdit(item.item_code, m, e.target.value)}
              />
            </div>
          )
        })}
      </div>
      <div className="it-cell it-num mono">{c.qAvg || '—'}</div>
      <div className="it-cell it-num it-min mono">{c.noConfig ? '—' : c.minQty.toLocaleString()}</div>
      <div className="it-cell it-num it-po mono">{c.noConfig ? '—' : c.poQty.toLocaleString()}</div>
      <div className="it-cell it-stock-col">
        <div className="it-stock-bd mono">
          {st.kaveri || 0} <span>+</span> {st.godawari || 0}
          {sysStock > 0 && (
            <button title="Copy system stock" onClick={() => onCopySysStock(item.item_code)}
              style={{ background:'none', border:'none', cursor:'pointer', color:'var(--pf-muted-2)', padding:'0 0 0 4px', fontSize:11, lineHeight:1 }}>↓</button>
          )}
        </div>
        <input type="number" min="0"
          className={`it-input mono ${st.manual === null ? 'empty' : ''}`}
          value={st.manual !== null ? st.manual : ''}
          placeholder={String(sysStock)}
          onChange={e => onStockEdit(item.item_code, e.target.value)}
          style={{ width: 86, marginTop: 4 }}
        />
      </div>
      <div className="it-cell it-status-col">
        <StatusPill status={status}/>
      </div>
    </div>
  )
}

// =================== PO Review Modal ===================
function POReviewModalNew({ open, onClose, onNext, brand, qLabel, seedItems }) {
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (open && seedItems?.length) {
      setRows(seedItems.map(s => ({ ...s, pendingQty: s.pendingQty || 0, include: true })))
      setFilter('')
    }
  }, [open, seedItems])

  if (!open) return null

  const filteredRows = filter ? rows.filter(r =>
    (r.item_code || '').toLowerCase().includes(filter.toLowerCase()) ||
    (r.itemNo || '').toLowerCase().includes(filter.toLowerCase())
  ) : rows
  const allChecked = rows.length > 0 && rows.every(r => r.include)
  const included = rows.filter(r => r.include)
  const totalSelected = included.length
  const totalQty = included.reduce((a, r) => a + Math.max(0, r.poQty - (r.pendingQty || 0)), 0)
  const canNext = included.some(r => Math.max(0, r.poQty - (r.pendingQty || 0)) > 0)

  function setPending(idx, val) {
    setRows(prev => prev.map((r, i) => i !== idx ? r : { ...r, pendingQty: Math.max(0, parseInt(val) || 0) }))
  }
  function toggleOne(item_code) {
    setRows(prev => prev.map(r => r.item_code !== item_code ? r : { ...r, include: !r.include }))
  }
  function toggleAll() {
    const flag = !allChecked
    setRows(prev => prev.map(r => ({ ...r, include: flag })))
  }
  function handleNext() {
    const items = included
      .map(r => ({ ...r, netQty: Math.max(0, r.poQty - (r.pendingQty || 0)) }))
      .filter(r => r.netQty > 0)
    if (items.length) onNext(items)
  }

  return (
    <div className="pf-modal-scrim" onClick={onClose}>
      <div className="pf-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-eyebrow mono">{qLabel} · {rows.length} items need reorder</div>
            <div className="modal-title">{brand} — PO Review</div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4 L12 12 M12 4 L4 12"/></svg>
          </button>
        </div>

        <div className="modal-summary">
          <div className="ms-cell">
            <div className="ms-label mono">SELECTED</div>
            <div className="ms-val">{totalSelected}<span className="ms-max">/ {rows.length}</span></div>
          </div>
          <div className="ms-cell">
            <div className="ms-label mono">TOTAL ORDER QTY</div>
            <div className="ms-val">{totalQty.toLocaleString()}</div>
          </div>
          <div className="ms-cell">
            <div className="ms-label mono">QUARTER</div>
            <div className="ms-val" style={{ fontSize: 16 }}>{qLabel}</div>
          </div>
          <div className="ms-cell">
            <div className="ms-label mono">BRAND</div>
            <div className="ms-val" style={{ fontSize: 16 }}>{brand}</div>
          </div>
        </div>

        <div className="modal-toolbar">
          <button className="chk-all" onClick={toggleAll}>
            <span className={`cb ${allChecked ? 'on' : ''}`}>
              {allChecked && <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#fff" strokeWidth="2"><path d="M2.5 6 L5 8.5 L9.5 3.5"/></svg>}
            </span>
            Select all
          </button>
          <div className="modal-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Filter by item code or ID…" value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
        </div>

        <div className="modal-table">
          <div className="mt-row mt-head">
            <div className="mt-chk"></div>
            <div>Item Code</div>
            <div className="mt-num">Formula Qty</div>
            <div className="mt-num">Pending PO</div>
            <div className="mt-num">Order Qty</div>
          </div>
          {filteredRows.map(r => {
            const idx = rows.findIndex(x => x.item_code === r.item_code)
            const orderQty = Math.max(0, r.poQty - (r.pendingQty || 0))
            return (
              <div key={r.item_code} className={`mt-row ${r.include ? '' : 'unchecked'}`}>
                <div className="mt-chk">
                  <button onClick={() => toggleOne(r.item_code)}>
                    <span className={`cb ${r.include ? 'on' : ''}`}>
                      {r.include && <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#fff" strokeWidth="2"><path d="M2.5 6 L5 8.5 L9.5 3.5"/></svg>}
                    </span>
                  </button>
                </div>
                <div className="mt-name">
                  {r.itemNo && <div className="mt-id mono">{r.itemNo}</div>}
                  <div className="mt-code">{r.item_code}</div>
                </div>
                <div className="mt-num mono">{r.poQty.toLocaleString()}</div>
                <div className="mt-num">
                  <input className="mt-input mono" type="number" min="0" value={r.pendingQty || 0}
                    disabled={!r.include}
                    onChange={e => setPending(idx, e.target.value)} />
                </div>
                <div className="mt-num mono mt-total">{orderQty > 0 ? orderQty.toLocaleString() : <span className="muted">—</span>}</div>
              </div>
            )
          })}
        </div>

        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleNext} disabled={!canNext}>
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 8 L7 12 L13 4"/></svg>
            Next: Create PO ({totalSelected})
          </button>
        </div>
      </div>
    </div>
  )
}

// =================== Lead Time Drawer ===================
function LeadTimeDrawer({ open, onClose, brand, cfg, onSaved }) {
  const [lead, setLead] = useState(0)
  const [transit, setTransit] = useState(0)
  const [proc, setProc] = useState(0)
  const [inv, setInv] = useState(45)
  const [saving, setSaving] = useState(false)
  const guard = useRef(false)

  useEffect(() => {
    if (open) {
      setLead(cfg?.lead_time_days || 0)
      setTransit(cfg?.transit_days || 0)
      setProc(cfg?.processing_days || 0)
      setInv(cfg?.inventory_days || 45)
    }
  }, [open, brand, cfg])

  if (!open) return null

  const reorderLevel = lead + transit + proc
  const replenLevel = reorderLevel + inv

  async function save() {
    if (guard.current) return
    guard.current = true; setSaving(true)
    const { error } = await sb.from('procurement_forecast_config').upsert({
      brand,
      lead_time_days: lead,
      transit_days: transit,
      processing_days: proc,
      inventory_days: inv,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand' })
    if (error) { toast('Failed to save: ' + error.message); guard.current = false; setSaving(false); return }
    toast(`${brand} lead times saved`, 'success')
    onSaved({ brand, lead_time_days: lead, transit_days: transit, processing_days: proc, inventory_days: inv })
    guard.current = false; setSaving(false)
    onClose()
  }

  return (
    <div className="pf-drawer-scrim" onClick={onClose}>
      <div className="pf-drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-eyebrow mono">Configure · {brand}</div>
            <div className="drawer-title">Lead Times</div>
            <div className="drawer-sub">Drag sliders to set days. Save when done.</div>
          </div>
          <button className="drawer-close" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4 L12 12 M12 4 L4 12"/></svg>
          </button>
        </div>
        <div className="drawer-body">
          <SliderField label="Supplier Lead Time" value={lead} max={120} onChange={setLead} color="#1E54B7"/>
          <SliderField label="Transportation Time" value={transit} max={30} onChange={setTransit} color="#7C3AED"/>
          <SliderField label="Order Processing Time" value={proc} max={14} onChange={setProc} color="#0F766E"/>
          <SliderField label="Inventory Buffer" value={inv} max={120} onChange={setInv} color="#3DD9D6"/>

          <div className="calc-card">
            <div className="calc-head mono">CALCULATED LEVELS</div>
            <div className="calc-bar">
              <div className="cb-seg" style={{flex: lead || 0.001, background: '#1E54B7'}}/>
              <div className="cb-seg" style={{flex: transit || 0.001, background: '#7C3AED'}}/>
              <div className="cb-seg" style={{flex: proc || 0.001, background: '#0F766E'}}/>
              <div className="cb-seg cb-buffer" style={{flex: inv || 0.001, background: '#3DD9D6'}}/>
            </div>
            <div className="calc-legend">
              <div className="cl-item"><span style={{background:'#1E54B7'}}/>Lead Time</div>
              <div className="cl-item"><span style={{background:'#7C3AED'}}/>Transit</div>
              <div className="cl-item"><span style={{background:'#0F766E'}}/>Processing</div>
              <div className="cl-item"><span style={{background:'#3DD9D6'}}/>Inventory Buffer ({inv}d)</div>
            </div>
            <div className="calc-cards">
              <div className="cc-card cc-reorder">
                <div className="cc-label mono">REORDER LEVEL</div>
                <div className="cc-val">{reorderLevel}<span> days</span></div>
                <div className="cc-formula mono">Lead + Transit + Processing</div>
              </div>
              <div className="cc-card cc-replen">
                <div className="cc-label mono">REPLENISHMENT LEVEL</div>
                <div className="cc-val">{replenLevel}<span> days</span></div>
                <div className="cc-formula mono">Reorder + {inv}d inventory</div>
              </div>
            </div>
          </div>
        </div>
        <div className="drawer-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Lead Times'}</button>
        </div>
      </div>
    </div>
  )
}

function SliderField({ label, value, max, onChange, color }) {
  return (
    <div className="sf">
      <div className="sf-head">
        <div className="sf-label">{label}</div>
        <div className="sf-val" style={{color}}>{value}<span className="sf-unit"> days</span></div>
      </div>
      <div className="sf-track-wrap">
        <input type="range" min="0" max={max} value={value} onChange={e => onChange(parseInt(e.target.value))} className="sf-slider" style={{'--c': color, '--p': `${(value/max)*100}%`}}/>
      </div>
      <div className="sf-scale mono">
        <span>0</span><span>{Math.round(max/2)}</span><span>{max}</span>
      </div>
    </div>
  )
}

// =================== Root Page ===================
export default function ProcurementForecast() {
  const navigate = useNavigate()
  const { months: QM, label: QLabel } = getPrevQuarter()

  const [userName, setUserName]     = useState('')
  const [brands, setBrands]         = useState([])
  const [allConfigs, setAllConfigs] = useState({})
  const [selectedBrand, setSelectedBrand] = useState('')
  const [brandItems, setBrandItems] = useState([])
  const [salesData, setSalesData]   = useState({})
  const [stockData, setStockData]   = useState({})
  const [loading, setLoading]       = useState(true)
  const [loadingBrand, setLoadingBrand] = useState(false)
  const [saving, setSaving]         = useState(false)
  const saveGuard = useRef(false)

  const [showPOReview, setShowPOReview]             = useState(false)
  const [reviewItems, setReviewItems]               = useState([])
  const [showForecastPO, setShowForecastPO]         = useState(false)
  const [forecastPOItems, setForecastPOItems]       = useState([])
  const [loadingForecastPO, setLoadingForecastPO]   = useState(false)
  const [snapshotting, setSnapshotting]             = useState(false)
  const snapshotGuard = useRef(false)
  const [userId, setUserId]                         = useState('')
  const [userRole, setUserRole]                     = useState('')
  const [cfgOpen, setCfgOpen]                       = useState(false)

  const brandConfig = selectedBrand ? allConfigs[selectedBrand] : null

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || ''
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserName(profile?.name || '')
    setUserId(session.user.id)
    setUserRole(role)

    const [brandsRes, configRes] = await Promise.all([
      sb.rpc('get_distinct_brands'),
      sb.from('procurement_forecast_config').select('*'),
    ])
    const uniqueBrands = (brandsRes.data || []).map(r => r.brand).filter(Boolean)
    const configMap = {}
    ;(configRes.data || []).forEach(r => { configMap[r.brand] = r })
    setBrands(uniqueBrands)
    setAllConfigs(configMap)
    setLoading(false)
  }

  async function selectBrand(brand) {
    setSelectedBrand(brand)
    if (!brand) { setBrandItems([]); setSalesData({}); setStockData({}); return }
    setLoadingBrand(true)
    setSalesData({}); setStockData({}); setBrandItems([])

    const { data: itemsData } = await sb.from('items')
      .select('id,item_code,item_no,brand,category')
      .eq('brand', brand)
      .or('type.is.null,type.neq.CI')
      .order('item_code')

    const items = itemsData || []
    if (!items.length) { setBrandItems([]); setLoadingBrand(false); return }
    setBrandItems(items)
    const itemCodes = items.map(i => i.item_code)

    const startDate = QM[0] + '-01'
    const endDate   = QM[2] + '-' + lastDayOf(QM[2])

    const [sysOrdersRes, manualSalesRes, invRes, manualStockRes] = await Promise.all([
      sb.from('order_items')
        .select('item_code, dispatched_qty, orders!inner(order_date, status, is_test)')
        .in('item_code', itemCodes)
        .in('orders.status', DELIVERED_STATUSES)
        .eq('orders.is_test', false)
        .gte('orders.order_date', startDate)
        .lte('orders.order_date', endDate),
      sb.from('procurement_forecast_sales').select('item_code, month, manual_qty').in('item_code', itemCodes).in('month', QM),
      sb.from('inventory').select('product_code, quantity, location').in('product_code', itemCodes),
      sb.from('procurement_forecast_stock').select('item_code, manual_qty').in('item_code', itemCodes),
    ])

    const sMap = {}
    items.forEach(i => { sMap[i.item_code] = {}; QM.forEach(m => { sMap[i.item_code][m] = { sys: 0, manual: null } }) })
    ;(sysOrdersRes.data || []).forEach(row => {
      const month = row.orders?.order_date?.slice(0, 7)
      if (month && QM.includes(month) && sMap[row.item_code]?.[month] !== undefined)
        sMap[row.item_code][month].sys += (row.dispatched_qty || 0)
    })
    ;(manualSalesRes.data || []).forEach(row => {
      if (sMap[row.item_code]?.[row.month] !== undefined) sMap[row.item_code][row.month].manual = row.manual_qty
    })

    const stMap = {}
    items.forEach(i => { stMap[i.item_code] = { kaveri: 0, godawari: 0, manual: null } })
    ;(invRes.data || []).forEach(row => {
      if (!stMap[row.product_code]) return
      if (row.location === 'Kaveri') stMap[row.product_code].kaveri += (row.quantity || 0)
      else if (row.location === 'Godawari') stMap[row.product_code].godawari += (row.quantity || 0)
    })
    ;(manualStockRes.data || []).forEach(row => { if (stMap[row.item_code]) stMap[row.item_code].manual = row.manual_qty })

    setSalesData(sMap)
    setStockData(stMap)
    setLoadingBrand(false)
  }

  function setSalesManual(item_code, month, val) {
    setSalesData(prev => ({ ...prev, [item_code]: { ...prev[item_code], [month]: { ...prev[item_code]?.[month], manual: val === '' ? null : parseInt(val) || 0 } } }))
  }
  function copySysToManual(item_code, month) { setSalesManual(item_code, month, salesData[item_code]?.[month]?.sys || 0) }
  function setStockManual(item_code, val) { setStockData(prev => ({ ...prev, [item_code]: { ...prev[item_code], manual: val === '' ? null : parseInt(val) || 0 } })) }
  function copySysStock(item_code) { const d = stockData[item_code] || {}; setStockManual(item_code, (d.kaveri || 0) + (d.godawari || 0)) }

  function calc(item_code) {
    const cfg = brandConfig || { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
    const reorderDays   = (cfg.lead_time_days || 0) + (cfg.transit_days || 0) + (cfg.processing_days || 0)
    const replenishDays = reorderDays + (cfg.inventory_days || 45)
    const sales = salesData[item_code] || {}
    const monthQtys = QM.map(m => { const s = sales[m] || { sys: 0, manual: null }; return s.manual !== null ? s.manual : s.sys })
    const qAvg = monthQtys.reduce((a,b) => a+b, 0) / 3
    const dailyRate = qAvg / 30
    const minQty = Math.ceil(dailyRate * reorderDays)
    const poQty  = Math.ceil(dailyRate * replenishDays)
    const st = stockData[item_code] || { kaveri: 0, godawari: 0, manual: null }
    const effectiveStock = st.manual !== null ? st.manual : (st.kaveri || 0) + (st.godawari || 0)
    const noConfig   = !brandConfig || reorderDays === 0
    const needsOrder = !noConfig && effectiveStock < minQty
    return { reorderDays, replenishDays, qAvg: Math.round(qAvg), dailyRate, minQty, poQty, effectiveStock, needsOrder, noConfig }
  }

  // chart-shaped item list (sorted critical first)
  const chartItems = useMemo(() => {
    return brandItems.filter(i => !calc(i.item_code).noConfig).map(i => {
      const c = calc(i.item_code)
      const status = c.needsOrder ? 'critical' : 'ok'
      return {
        label: i.item_no || i.item_code.slice(-7),
        code: i.item_code,
        stock: c.effectiveStock,
        minQty: c.minQty,
        poQty: c.poQty,
        qAvg: c.qAvg,
        status,
        noConfig: c.noConfig,
      }
    }).sort((a, b) => {
      const order = { critical: 0, noconfig: 1, ok: 2 }
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
      const ra = a.minQty > 0 ? a.stock / a.minQty : 1
      const rb = b.minQty > 0 ? b.stock / b.minQty : 1
      return ra - rb
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandItems, salesData, stockData, brandConfig])

  async function saveOverrides() {
    if (saveGuard.current) return
    saveGuard.current = true; setSaving(true)
    const salesRows = [], stockRows = []
    brandItems.forEach(item => {
      const s = salesData[item.item_code] || {}
      QM.forEach(m => { if (s[m]?.manual !== null && s[m]?.manual !== undefined) salesRows.push({ item_code: item.item_code, month: m, manual_qty: s[m].manual, created_by: userName, updated_at: new Date().toISOString() }) })
      const st = stockData[item.item_code] || {}
      if (st.manual !== null && st.manual !== undefined) stockRows.push({ item_code: item.item_code, manual_qty: st.manual, updated_by: userName, updated_at: new Date().toISOString() })
    })
    const errs = []
    if (salesRows.length) { const { error } = await sb.from('procurement_forecast_sales').upsert(salesRows, { onConflict: 'item_code,month' }); if (error) errs.push(error.message) }
    if (stockRows.length) { const { error } = await sb.from('procurement_forecast_stock').upsert(stockRows, { onConflict: 'item_code' }); if (error) errs.push(error.message) }
    if (errs.length) { toast('Save failed: ' + errs[0]); saveGuard.current = false; setSaving(false); return }
    toast('Overrides saved', 'success'); saveGuard.current = false; setSaving(false)
  }

  async function openForecastPO() {
    const triggered = brandItems.filter(i => calc(i.item_code).needsOrder)
    if (!triggered.length) { toast('No items need ordering'); return }
    setLoadingForecastPO(true)
    const { data: pendingRows } = await sb.from('po_items')
      .select('item_code, qty, received_qty, purchase_orders!inner(status)')
      .in('item_code', triggered.map(i => i.item_code))
      .in('purchase_orders.status', ['draft','pending_approval','approved','placed','acknowledged','partially_received'])
    const pendingMap = {}
    ;(pendingRows || []).forEach(r => {
      const p = Math.max(0, (r.qty || 0) - (r.received_qty || 0))
      pendingMap[r.item_code] = (pendingMap[r.item_code] || 0) + p
    })
    const seeds = triggered.map(i => {
      const c = calc(i.item_code)
      const item = brandItems.find(b => b.item_code === i.item_code)
      const pendingQty = pendingMap[i.item_code] || 0
      return { item_code: i.item_code, itemNo: item?.item_no || '', poQty: c.poQty, pendingQty }
    })
    setReviewItems(seeds)
    setLoadingForecastPO(false)
    setShowPOReview(true)
  }

  function handleReviewNext(confirmedItems) {
    setShowPOReview(false)
    setForecastPOItems(confirmedItems.map(r => ({
      item_code: r.item_code,
      qty: r.netQty,
      pendingQty: r.pendingQty,
      poQty: r.poQty,
    })))
    setShowForecastPO(true)
  }

  async function recordSnapshot() {
    if (snapshotGuard.current || !selectedBrand || !brandItems.length) return
    snapshotGuard.current = true; setSnapshotting(true)
    const needsOrderCount  = brandItems.filter(i => calc(i.item_code).needsOrder).length
    const noConfigCount    = brandItems.filter(i => calc(i.item_code).noConfig).length
    const snapshotData     = brandItems.map(i => {
      const c  = calc(i.item_code)
      const st = stockData[i.item_code] || {}
      const s  = salesData[i.item_code] || {}
      return { item_code: i.item_code, item_no: i.item_no, ...c, stock: st, sales: s }
    })
    const { error } = await sb.from('procurement_forecast_snapshots').insert({
      brand:             selectedBrand,
      quarter_label:     QLabel,
      quarter_months:    QM,
      recorded_by:       userName,
      total_items:       brandItems.length,
      needs_order_count: needsOrderCount,
      sufficient_count:  brandItems.length - needsOrderCount - noConfigCount,
      no_config_count:   noConfigCount,
      snapshot_data:     snapshotData,
    })
    if (error) { toast('Failed to record snapshot: ' + error.message); snapshotGuard.current = false; setSnapshotting(false); return }
    toast(`Snapshot recorded — ${selectedBrand} · ${QLabel}`, 'success')
    snapshotGuard.current = false; setSnapshotting(false)
  }

  const triggeredCount = brandItems.filter(i => calc(i.item_code).needsOrder).length
  const noConfigCount = brandItems.filter(i => calc(i.item_code).noConfig).length
  const sufficientCount = brandItems.length - triggeredCount - noConfigCount
  const monthLabels = QM.map(m => `${MONTH_NAMES[m.slice(5)]} ${m.slice(2,4)}`)

  return (
    <Layout>
      <div className="pf-app">

        <div className="page-head">
          <div>
            <h1 className="page-title">Procurement Forecast</h1>
            <div className="page-sub">{QLabel} · Standard items only · Auto-calculated reorder & replenishment levels</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill">
              <span className="meta-label">Quarter</span>
              <span className="meta-val">{QLabel}</span>
            </div>
            <div className="meta-pill live">
              <span className="meta-dot"/> Live
            </div>
          </div>
        </div>

        <BrandSelector
          brand={selectedBrand}
          brands={brands}
          allConfigs={allConfigs}
          brandItemCount={brandItems.length}
          onChange={selectBrand}
          onConfigOpen={() => setCfgOpen(true)}
        />

        {loading ? (
          <div className="pf-empty">Loading…</div>
        ) : !selectedBrand ? (
          <div className="card pf-empty">
            <div style={{ fontSize:15, fontWeight:600, marginBottom:6, color:'var(--pf-ink)' }}>Select a brand to begin</div>
            <div style={{ fontSize:13 }}>Choose a brand from the picker above to load forecast data</div>
          </div>
        ) : loadingBrand ? (
          <div className="card pf-empty">Loading {selectedBrand} data…</div>
        ) : brandItems.length === 0 ? (
          <div className="card pf-empty">No standard items found for {selectedBrand}</div>
        ) : (
          <>
            <div className="card forecast-card">
              <StockChart
                items={chartItems}
                brand={selectedBrand}
                cfg={brandConfig}
                totalStats={{ needOrder: triggeredCount, sufficient: sufficientCount, critical: triggeredCount }}
              />
            </div>

            <div className="card items-card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">{brandItems.length} standard items · {QLabel}</div>
                  <div className="card-title">Item-level forecast</div>
                </div>
                <div className="action-row">
                  <button className="btn-ghost" onClick={recordSnapshot} disabled={snapshotting}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2 V11 M4 7 L8 11 L12 7 M3 14 H13"/></svg>
                    {snapshotting ? 'Recording…' : 'Record Snapshot'}
                  </button>
                  <button className="btn-ghost" onClick={saveOverrides} disabled={saving}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 8 L7 12 L13 4"/></svg>
                    {saving ? 'Saving…' : 'Save Overrides'}
                  </button>
                  {triggeredCount > 0 && (
                    <button className="btn-primary" onClick={openForecastPO} disabled={loadingForecastPO}>
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M8 2 V11 M4 7 L8 11 L12 7"/></svg>
                      {loadingForecastPO ? 'Loading…' : `Generate PO (${triggeredCount})`}
                    </button>
                  )}
                </div>
              </div>

              <div className="items-table-wrap">
                <div className="items-table">
                  <div className="it-row it-head">
                    <div className="it-cell it-code">
                      <div className="it-head-l1">ERP Code</div>
                      <div className="it-head-l2">Item Code · sorted by urgency</div>
                    </div>
                    <div className="it-cell-group it-sales-group">
                      <div className="it-sales-head">
                        <div className="it-head-l1">{QLabel} — Sales Qty</div>
                        <div className="it-head-l2 mono">System value · edit to override</div>
                      </div>
                      <div className="it-sales-months">
                        {monthLabels.map(m => <div key={m} className="it-cell it-month" style={{ fontSize: 11, color: 'var(--pf-muted)' }}>{m}</div>)}
                      </div>
                    </div>
                    <div className="it-cell it-num">Q Avg</div>
                    <div className="it-cell it-num it-min">Min Qty</div>
                    <div className="it-cell it-num it-po">PO Qty</div>
                    <div className="it-cell it-stock-col">
                      <div className="it-head-l1">Stock</div>
                      <div className="it-head-l2 mono">Kaveri + Godawari</div>
                    </div>
                    <div className="it-cell it-status-col">Status</div>
                  </div>
                  <div className="it-body">
                    {brandItems
                      .slice()
                      .sort((a, b) => {
                        const ca = calc(a.item_code), cb = calc(b.item_code)
                        const oa = ca.noConfig ? 1 : ca.needsOrder ? 0 : 2
                        const ob = cb.noConfig ? 1 : cb.needsOrder ? 0 : 2
                        if (oa !== ob) return oa - ob
                        return a.item_code.localeCompare(b.item_code)
                      })
                      .map(item => (
                        <ItemRow
                          key={item.item_code}
                          item={item}
                          monthsKeys={QM}
                          salesData={salesData}
                          stockData={stockData}
                          calc={calc}
                          onSalesEdit={setSalesManual}
                          onCopySys={copySysToManual}
                          onStockEdit={setStockManual}
                          onCopySysStock={copySysStock}
                        />
                      ))}
                  </div>
                </div>
              </div>
              <div className="table-foot mono">
                {brandItems.length} items · {triggeredCount} need order · {sufficientCount} sufficient · {noConfigCount} no config
              </div>
            </div>
          </>
        )}
      </div>

      <POReviewModalNew
        open={showPOReview}
        onClose={() => setShowPOReview(false)}
        onNext={handleReviewNext}
        brand={selectedBrand}
        qLabel={QLabel}
        seedItems={reviewItems}
      />

      <LeadTimeDrawer
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        brand={selectedBrand}
        cfg={brandConfig}
        onSaved={(saved) => setAllConfigs(prev => ({ ...prev, [saved.brand]: { ...prev[saved.brand], ...saved } }))}
      />

      <ForecastPOModal
        open={showForecastPO}
        onClose={() => setShowForecastPO(false)}
        seedItems={forecastPOItems}
        brand={selectedBrand}
        qLabel={QLabel}
        userName={userName}
        userId={userId}
        userRole={userRole}
        navigate={navigate}
      />
    </Layout>
  )
}
