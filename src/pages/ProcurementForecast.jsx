import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import ForecastPOModal from './ForecastPOModal'

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

// SVG Line Chart
function ForecastLineChart({ items, calcFn, qLabel }) {
  const rows = items
    .map(item => ({ ...item, ...calcFn(item.item_code) }))
    .filter(r => !r.noConfig && (r.qAvg > 0 || r.effectiveStock > 0))
    .sort((a, b) => {
      if (a.needsOrder && !b.needsOrder) return -1
      if (!a.needsOrder && b.needsOrder) return 1
      const ra = a.minQty > 0 ? a.effectiveStock / a.minQty : 1
      const rb = b.minQty > 0 ? b.effectiveStock / b.minQty : 1
      return ra - rb
    })
    .slice(0, 20)

  if (rows.length < 2) return null

  const PL = 56, PR = 24, PT = 20, PB = 64
  const ITEM_W = Math.max(Math.floor(780 / rows.length), 44)
  const CW = ITEM_W * (rows.length - 1)
  const CH = 220
  const W  = PL + CW + PR
  const H  = PT + CH + PB

  const allVals = rows.flatMap(r => [r.effectiveStock, r.minQty, r.poQty]).filter(v => v > 0)
  const maxVal  = allVals.length ? Math.ceil(Math.max(...allVals) * 1.15) : 10

  const niceStep = v => { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; const s = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10; return s * p }
  const step   = niceStep(maxVal / 5)
  const yTicks = Array.from({ length: Math.ceil(maxVal / step) + 1 }, (_, i) => i * step).filter(v => v <= maxVal * 1.05)

  const xOf = i => PL + i * ITEM_W
  const yOf = v => PT + CH - (Math.min(v, maxVal) / maxVal) * CH

  const pts = arr => arr.map((r, i) => `${xOf(i)},${yOf(r)}`).join(' ')
  const stockPts = pts(rows.map(r => r.effectiveStock))
  const minPts   = pts(rows.map(r => r.minQty))
  const poPts    = pts(rows.map(r => r.poQty))

  return (
    <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:12, padding:'20px 24px', marginBottom:24 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--gray-900)' }}>Stock vs Reorder Threshold</div>
          <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:2 }}>
            {rows.length} items · {rows.filter(r=>r.needsOrder).length} below reorder level · sorted critical first
          </div>
        </div>
        <div style={{ display:'flex', gap:20, flexShrink:0 }}>
          {[['#2563eb','Stock Level','solid'],['#e11d48','Min Qty (Reorder)','dashed'],['#94a3b8','PO Target Qty','dotted']].map(([c,l,d]) => (
            <div key={l} style={{ display:'flex', alignItems:'center', gap:7, fontSize:11, color:'var(--gray-600)' }}>
              <svg width="28" height="12" style={{ flexShrink:0 }}>
                <line x1="0" y1="6" x2="28" y2="6" stroke={c} strokeWidth="2" strokeDasharray={d==='dashed'?'5 3':d==='dotted'?'2 3':'none'} />
              </svg>
              {l}
            </div>
          ))}
        </div>
      </div>
      <div style={{ overflowX:'auto' }}>
        <svg width={W} height={H} style={{ display:'block', overflow:'visible' }}>
          {/* Grid */}
          {yTicks.map(v => (
            <g key={v}>
              <line x1={PL} y1={yOf(v)} x2={PL+CW} y2={yOf(v)} stroke="#f1f5f9" strokeWidth={v===0?1:1} />
              <text x={PL-8} y={yOf(v)+4} textAnchor="end" fontSize={9} fill="#94a3b8" fontFamily="var(--mono)">{v}</text>
            </g>
          ))}
          {/* Axes */}
          <line x1={PL} y1={PT} x2={PL} y2={PT+CH} stroke="#e2e8f0" strokeWidth={1} />
          <line x1={PL} y1={PT+CH} x2={PL+CW} y2={PT+CH} stroke="#e2e8f0" strokeWidth={1} />

          {/* PO qty line (lightest, behind) */}
          <polyline points={poPts} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2 4" strokeLinecap="round" strokeLinejoin="round" />
          {/* Min qty threshold line */}
          <polyline points={minPts} fill="none" stroke="#e11d48" strokeWidth="1.5" strokeDasharray="5 3" strokeLinecap="round" strokeLinejoin="round" />
          {/* Stock line (top, solid) */}
          <polyline points={stockPts} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

          {/* Data points + labels */}
          {rows.map((r, i) => {
            const label = r.item_no || r.item_code.slice(-7)
            const critical = r.needsOrder
            return (
              <g key={r.item_code}>
                {/* Stock dot */}
                <circle cx={xOf(i)} cy={yOf(r.effectiveStock)} r={4} fill={critical ? '#dc2626' : '#2563eb'} stroke="white" strokeWidth={2} />
                {/* Min qty dot */}
                <circle cx={xOf(i)} cy={yOf(r.minQty)} r={3} fill="#e11d48" stroke="white" strokeWidth={1.5} />
                {/* PO dot */}
                <circle cx={xOf(i)} cy={yOf(r.poQty)} r={3} fill="#94a3b8" stroke="white" strokeWidth={1.5} />
                {/* Stock value label above dot */}
                <text x={xOf(i)} y={yOf(r.effectiveStock) - 8} textAnchor="middle" fontSize={9} fill={critical ? '#dc2626' : '#2563eb'} fontWeight={700} fontFamily="var(--mono)">
                  {r.effectiveStock}
                </text>
                {/* X-axis label — rotated */}
                <text
                  x={xOf(i)} y={PT + CH + 14}
                  textAnchor="end"
                  fontSize={9}
                  fill={critical ? '#dc2626' : '#64748b'}
                  fontWeight={critical ? 700 : 400}
                  transform={`rotate(-40, ${xOf(i)}, ${PT + CH + 14})`}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

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
  const [brandConfig, setBrandConfig] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [loadingBrand, setLoadingBrand] = useState(false)
  const [saving, setSaving]         = useState(false)
  const saveGuard = useRef(false)

  const [showForecastPO, setShowForecastPO]         = useState(false)
  const [forecastPOItems, setForecastPOItems]       = useState([])
  const [loadingForecastPO, setLoadingForecastPO]   = useState(false)
  const [snapshotting, setSnapshotting]             = useState(false)
  const snapshotGuard = useRef(false)
  const [userId, setUserId]                         = useState('')
  const [userRole, setUserRole]                     = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || ''
    if (!['ops','admin','management'].includes(role)) { navigate('/dashboard'); return }
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
    setBrandConfig(allConfigs[brand] || null)
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
      const pendingQty = pendingMap[i.item_code] || 0
      return { item_code: i.item_code, qty: Math.max(0, c.poQty - pendingQty), pendingQty, poQty: c.poQty }
    })
    setForecastPOItems(seeds)
    setLoadingForecastPO(false)
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
  const TH = { padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)', whiteSpace:'nowrap', textAlign:'right' }
  const TD = { padding:'10px 14px', fontSize:13, borderBottom:'1px solid var(--gray-50)', verticalAlign:'middle', textAlign:'right', fontFamily:'var(--mono)', color:'var(--gray-800)' }
  function StatusChip({ c }) {
    if (c.noConfig) return <span style={{ fontSize:11, fontWeight:600, color:'#92400e', background:'#fef3c7', padding:'3px 10px', borderRadius:20, whiteSpace:'nowrap' }}>No config</span>
    if (c.needsOrder) return <span style={{ fontSize:11, fontWeight:600, color:'white', background:'#dc2626', padding:'3px 10px', borderRadius:20, whiteSpace:'nowrap' }}>Order</span>
    return <span style={{ fontSize:11, fontWeight:600, color:'#166534', background:'#dcfce7', padding:'3px 10px', borderRadius:20, whiteSpace:'nowrap' }}>OK</span>
  }

  return (
    <Layout>
      <div style={{ padding:'28px 32px' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:24 }}>
          <div>
            <h1 style={{ fontSize:20, fontWeight:700, color:'var(--gray-900)', margin:0 }}>Procurement Forecast</h1>
            <span style={{ fontSize:12, color:'var(--gray-500)', marginTop:2, display:'block' }}>Analysing <strong>{QLabel}</strong> · Standard items only</span>
          </div>
          <button onClick={() => navigate('/procurement/forecast/config')}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, color:'var(--gray-700)', cursor:'pointer' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Configure Lead Times
          </button>
        </div>

        {/* Brand selector */}
        <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:28 }}>
          <div style={{ flex:1, maxWidth:360 }}>
            <select value={selectedBrand} onChange={e => selectBrand(e.target.value)}
              style={{ width:'100%', padding:'11px 14px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:14, color:'var(--gray-900)', background:'white', outline:'none', cursor:'pointer' }}>
              <option value="">— Select a brand to analyse —</option>
              {brands.map(b => <option key={b} value={b}>{b}{allConfigs[b] ? '' : ' (no config)'}</option>)}
            </select>
          </div>
          {selectedBrand && brandConfig && (
            <div style={{ display:'flex', gap:16, fontSize:12, color:'var(--gray-500)' }}>
              <span>Reorder: <strong style={{color:'#1d4ed8'}}>{(brandConfig.lead_time_days||0)+(brandConfig.transit_days||0)+(brandConfig.processing_days||0)}d</strong></span>
              <span>Replenishment: <strong style={{color:'#15803d'}}>{(brandConfig.lead_time_days||0)+(brandConfig.transit_days||0)+(brandConfig.processing_days||0)+(brandConfig.inventory_days||45)}d</strong></span>
            </div>
          )}
          {selectedBrand && !brandConfig && (
            <span style={{ fontSize:12, color:'#b45309', background:'#fffbeb', padding:'6px 12px', borderRadius:6, border:'1px solid #fcd34d' }}>
              No config — <button onClick={() => navigate('/procurement/forecast/config')} style={{background:'none',border:'none',color:'#b45309',fontWeight:700,cursor:'pointer',textDecoration:'underline',fontSize:12}}>Configure now →</button>
            </span>
          )}
        </div>

        {!selectedBrand ? (
          <div style={{ textAlign:'center', padding:'64px 0', color:'var(--gray-400)' }}>
            <svg width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{margin:'0 auto 16px', display:'block', opacity:0.3}}><path d="M9 17H7A5 5 0 017 7h2M15 7h2a5 5 0 010 10h-2M8 12h8"/></svg>
            <div style={{ fontSize:15, fontWeight:600, marginBottom:6 }}>Select a brand to begin</div>
            <div style={{ fontSize:13 }}>Choose from the dropdown above to load forecast data</div>
          </div>
        ) : loadingBrand ? (
          <div style={{ textAlign:'center', padding:48, color:'var(--gray-400)' }}>Loading {selectedBrand} data…</div>
        ) : brandItems.length === 0 ? (
          <div style={{ textAlign:'center', padding:48, color:'var(--gray-400)' }}>No standard items found for {selectedBrand}</div>
        ) : (
          <>
            {/* KPI row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:24 }}>
              {[
                { label:'Total Items', value: brandItems.length, color:'var(--gray-900)' },
                { label:'Need Order', value: triggeredCount, color:'#dc2626' },
                { label:'Sufficient', value: brandItems.length - triggeredCount, color:'#15803d' },
                { label:'No Config', value: brandItems.filter(i => calc(i.item_code).noConfig).length, color:'#b45309' },
              ].map(k => (
                <div key={k.label} style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:10, padding:'16px 20px' }}>
                  <div style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:6 }}>{k.label}</div>
                  <div style={{ fontSize:28, fontWeight:700, color:k.color, fontFamily:'var(--mono)' }}>{k.value}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <ForecastLineChart items={brandItems} calcFn={calc} qLabel={QLabel} />

            {/* Action bar */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
              <div style={{ fontSize:13, color:'var(--gray-600)' }}>
                {brandItems.length} standard items · {QLabel}
              </div>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={recordSnapshot} disabled={snapshotting}
                  style={{ padding:'8px 16px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, color:'var(--gray-600)', cursor:'pointer', opacity:snapshotting?0.6:1, display:'flex', alignItems:'center', gap:6 }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  {snapshotting ? 'Recording…' : 'Record Snapshot'}
                </button>
                <button onClick={saveOverrides} disabled={saving}
                  style={{ padding:'8px 16px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, color:'var(--gray-700)', cursor:'pointer', opacity:saving?0.7:1 }}>
                  {saving ? 'Saving…' : 'Save Overrides'}
                </button>
                {triggeredCount > 0 && (
                  <button onClick={openForecastPO} disabled={loadingForecastPO}
                    style={{ padding:'8px 16px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:6, opacity:loadingForecastPO?0.7:1 }}>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                    {loadingForecastPO ? 'Loading…' : `Generate PO (${triggeredCount})`}
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX:'auto', border:'1px solid var(--gray-100)', borderRadius:12 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth:820 }}>
                <thead>
                  <tr style={{ background:'var(--gray-50)' }}>
                    <th style={{ ...TH, textAlign:'left', position:'sticky', left:0, zIndex:3, background:'var(--gray-50)', minWidth:200, borderRight:'1px solid var(--gray-100)' }}>
                      <div style={{ fontSize:10, color:'var(--gray-400)', fontWeight:500, marginBottom:1 }}>ERP Code</div>
                      <div>Item Code</div>
                    </th>
                    <th colSpan={3} style={{ ...TH, textAlign:'center', color:'var(--gray-600)', borderRight:'1px solid var(--gray-100)', fontSize:10, letterSpacing:0 }}>
                      {QLabel} — Sales Qty
                      <div style={{ fontSize:9, color:'var(--gray-400)', fontWeight:400, marginTop:1 }}>System value → edit to override</div>
                    </th>
                    <th style={{ ...TH, textAlign:'center', color:'var(--gray-500)', fontSize:10, letterSpacing:0 }}>Q Avg</th>
                    <th style={{ ...TH, textAlign:'center', color:'#1d4ed8', fontSize:10, letterSpacing:0 }}>Min Qty</th>
                    <th style={{ ...TH, textAlign:'center', color:'#15803d', fontSize:10, letterSpacing:0, borderRight:'1px solid var(--gray-100)' }}>PO Qty</th>
                    <th style={{ ...TH, textAlign:'center', color:'var(--gray-500)', fontSize:10, letterSpacing:0, borderRight:'1px solid var(--gray-100)' }}>
                      Stock
                      <div style={{ fontSize:9, fontWeight:400, color:'var(--gray-400)', marginTop:1 }}>Kaveri + Godawari</div>
                    </th>
                    <th style={{ ...TH, textAlign:'center', fontSize:10, letterSpacing:0 }}>Status</th>
                  </tr>
                  <tr style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
                    <th style={{ ...TH, textAlign:'left', position:'sticky', left:0, zIndex:3, background:'var(--gray-50)', borderRight:'1px solid var(--gray-100)', paddingTop:4, paddingBottom:8, fontSize:10, color:'var(--gray-400)', fontWeight:400 }}>
                      Sticky · sorted by urgency
                    </th>
                    {QM.map(m => (
                      <th key={m} style={{ ...TH, textAlign:'center', fontSize:11, color:'var(--gray-600)', fontWeight:600, paddingTop:4, paddingBottom:8, minWidth:88 }}>
                        {MONTH_NAMES[m.slice(5)]} '{m.slice(2,4)}
                      </th>
                    ))}
                    <th style={{ paddingBottom:8 }} /><th style={{ paddingBottom:8 }} /><th style={{ paddingBottom:8, borderRight:'1px solid var(--gray-100)' }} />
                    <th style={{ paddingBottom:8, borderRight:'1px solid var(--gray-100)' }} />
                    <th style={{ paddingBottom:8 }} />
                  </tr>
                </thead>
                <tbody>
                  {brandItems.map(item => {
                    const c  = calc(item.item_code)
                    const st = stockData[item.item_code] || { kaveri:0, godawari:0, manual:null }
                    const sysStock = (st.kaveri || 0) + (st.godawari || 0)
                    const rowBg = c.needsOrder ? '#fef9f9' : 'white'
                    return (
                      <tr key={item.item_code} style={{ background:rowBg }}>
                        {/* Item — sticky */}
                        <td style={{ ...TD, textAlign:'left', position:'sticky', left:0, background:rowBg, zIndex:1, fontFamily:'inherit', padding:'10px 14px', borderRight:'1px solid var(--gray-100)' }}>
                          {item.item_no && (
                            <span style={{ display:'inline-block', background:'#ede9fe', color:'#5b21b6', fontSize:10, fontWeight:600, padding:'1px 7px', borderRadius:4, marginBottom:5, fontFamily:'var(--mono)' }}>
                              {item.item_no}
                            </span>
                          )}
                          <div style={{ fontSize:13, fontWeight:600, color:'var(--gray-900)', fontFamily:'var(--mono)' }}>{item.item_code}</div>
                        </td>

                        {/* Month cells — one per month, stacked (sys on top, input below) */}
                        {QM.map(m => {
                          const s = salesData[item.item_code]?.[m] || { sys:0, manual:null }
                          return (
                            <td key={m} style={{ ...TD, textAlign:'center', padding:'8px 10px', verticalAlign:'middle' }}>
                              <div style={{ fontSize:11, color:'var(--gray-400)', marginBottom:4, fontFamily:'var(--mono)' }}>
                                {s.sys > 0 ? s.sys : '—'}
                                {s.sys > 0 && (
                                  <button title="Copy to override" onClick={() => copySysToManual(item.item_code, m)}
                                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-300)', padding:'0 0 0 4px', fontSize:11, lineHeight:1, verticalAlign:'middle' }}>↓</button>
                                )}
                              </div>
                              <input type="number" min="0" value={s.manual !== null ? s.manual : ''} placeholder="—"
                                onChange={e => setSalesManual(item.item_code, m, e.target.value)}
                                style={{ width:64, padding:'4px 8px', border: s.manual !== null ? '1.5px solid #f59e0b' : '1.5px solid var(--gray-200)', borderRadius:6, fontFamily:'var(--mono)', fontSize:12, textAlign:'right', background: s.manual !== null ? '#fffbeb' : '#f9fafb', outline:'none', color: s.manual !== null ? '#92400e' : 'var(--gray-600)', display:'block', margin:'0 auto' }} />
                            </td>
                          )
                        })}

                        {/* Q Avg */}
                        <td style={{ ...TD, textAlign:'center', fontWeight:600, color:'var(--gray-700)' }}>{c.qAvg || '—'}</td>
                        {/* Min Qty */}
                        <td style={{ ...TD, textAlign:'center', fontWeight:700, color: c.noConfig ? 'var(--gray-300)' : '#1d4ed8' }}>{c.noConfig ? '—' : c.minQty}</td>
                        {/* PO Qty */}
                        <td style={{ ...TD, textAlign:'center', fontWeight:700, color: c.noConfig ? 'var(--gray-300)' : '#15803d', borderRight:'1px solid var(--gray-100)' }}>{c.noConfig ? '—' : c.poQty}</td>

                        {/* Stock — combined */}
                        <td style={{ ...TD, textAlign:'center', padding:'8px 10px', borderRight:'1px solid var(--gray-100)' }}>
                          <div style={{ fontSize:11, color:'var(--gray-400)', marginBottom:4 }}>
                            {st.kaveri || 0} + {st.godawari || 0}
                            {sysStock > 0 && (
                              <button title="Copy system stock" onClick={() => copySysStock(item.item_code)}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-300)', padding:'0 0 0 4px', fontSize:11, lineHeight:1, verticalAlign:'middle' }}>↓</button>
                            )}
                          </div>
                          <input type="number" min="0" value={st.manual !== null ? st.manual : ''} placeholder={String(sysStock)}
                            onChange={e => setStockManual(item.item_code, e.target.value)}
                            style={{ width:72, padding:'4px 8px', border: st.manual !== null ? '1.5px solid #f59e0b' : '1.5px solid var(--gray-200)', borderRadius:6, fontFamily:'var(--mono)', fontSize:12, textAlign:'right', background: st.manual !== null ? '#fffbeb' : '#f9fafb', outline:'none', color: st.manual !== null ? '#92400e' : !c.noConfig && c.needsOrder ? '#dc2626' : !c.noConfig ? '#15803d' : 'var(--gray-700)', fontWeight:700, display:'block', margin:'0 auto' }} />
                        </td>

                        {/* Status */}
                        <td style={{ ...TD, textAlign:'center', fontFamily:'inherit' }}><StatusChip c={c} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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
