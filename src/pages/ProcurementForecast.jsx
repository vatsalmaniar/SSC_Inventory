import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'

const MONTH_NAMES = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' }
const DELIVERED_STATUSES = ['dispatched_fc', 'goods_issued', 'invoice_generated', 'closed']

function getPrevQuarter() {
  const now = new Date()
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  let months, label
  if (m >= 4 && m <= 6) {
    months = [`${y}-01`, `${y}-02`, `${y}-03`]
    label = `Q4 FY${String(y-1).slice(-2)}-${String(y).slice(-2)}`
  } else if (m >= 7 && m <= 9) {
    months = [`${y}-04`, `${y}-05`, `${y}-06`]
    label = `Q1 FY${String(y).slice(-2)}-${String(y+1).slice(-2)}`
  } else if (m >= 10 && m <= 12) {
    months = [`${y}-07`, `${y}-08`, `${y}-09`]
    label = `Q2 FY${String(y).slice(-2)}-${String(y+1).slice(-2)}`
  } else {
    months = [`${y-1}-10`, `${y-1}-11`, `${y-1}-12`]
    label = `Q3 FY${String(y-1).slice(-2)}-${String(y).slice(-2)}`
  }
  return { months, label }
}

function lastDayOf(yyyyMM) {
  const [y, m] = yyyyMM.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export default function ProcurementForecast() {
  const navigate = useNavigate()
  const { months: QM, label: QLabel } = getPrevQuarter()

  const [userRole, setUserRole]   = useState('')
  const [userName, setUserName]   = useState('')
  const [brands, setBrands]       = useState([])
  const [allConfigs, setAllConfigs] = useState({})
  const [selectedBrand, setSelectedBrand] = useState('')
  const [brandItems, setBrandItems] = useState([])
  const [salesData, setSalesData] = useState({})   // { item_code: { [month]: { sys, manual } } }
  const [stockData, setStockData] = useState({})   // { item_code: { kaveri, godawari, manual } }
  const [brandConfig, setBrandConfig] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [loadingBrand, setLoadingBrand] = useState(false)
  const [saving, setSaving]       = useState(false)
  const saveGuard = useRef(false)

  // Brand summary for graph
  const [brandSummary, setBrandSummary] = useState([]) // [{brand, total, needs_order, no_config}]

  // Draft PO modal
  const [showPOModal, setPOModal] = useState(false)
  const [poVendorText, setPOVendorText] = useState('')
  const [poVendorId, setPOVendorId]     = useState('')
  const [poVendorName, setPOVendorName] = useState('')
  const [generating, setGenerating]     = useState(false)
  const genGuard = useRef(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || ''
    if (!['ops', 'admin', 'management'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role); setUserName(profile?.name || '')

    const [brandsRes, configRes] = await Promise.all([
      sb.from('items').select('brand').not('brand', 'is', null).neq('type', 'CI').order('brand'),
      sb.from('procurement_forecast_config').select('*'),
    ])

    const uniqueBrands = [...new Set((brandsRes.data || []).map(r => r.brand).filter(Boolean))].sort()
    const configMap = {}
    ;(configRes.data || []).forEach(r => { configMap[r.brand] = r })
    setBrands(uniqueBrands)
    setAllConfigs(configMap)
    setLoading(false)

    // Build brand summary (item counts only — no stock loaded yet)
    const summaryRes = await sb.from('items').select('brand').not('brand', 'is', null).neq('type', 'CI')
    const brandCount = {}
    ;(summaryRes.data || []).forEach(r => { brandCount[r.brand] = (brandCount[r.brand] || 0) + 1 })
    setBrandSummary(uniqueBrands.map(b => ({ brand: b, total: brandCount[b] || 0, no_config: !configMap[b] })))
  }

  async function selectBrand(brand) {
    setSelectedBrand(brand)
    setBrandConfig(allConfigs[brand] || null)
    setLoadingBrand(true)
    setSalesData({})
    setStockData({})
    setBrandItems([])

    // Load standard items for this brand
    const { data: itemsData } = await sb.from('items')
      .select('id,item_code,item_no,brand,category')
      .eq('brand', brand)
      .neq('type', 'CI')
      .order('item_code')

    const items = itemsData || []
    if (!items.length) { setBrandItems([]); setLoadingBrand(false); return }
    setBrandItems(items)

    const itemCodes = items.map(i => i.item_code)

    // Load system sales from delivered orders (all 3 months)
    const startDate = QM[0] + '-01'
    const endDate   = QM[2] + '-' + lastDayOf(QM[2])
    const { data: sysOrders } = await sb.from('order_items')
      .select('item_code, dispatched_qty, orders!inner(order_date, status, is_test)')
      .in('item_code', itemCodes)
      .in('orders.status', DELIVERED_STATUSES)
      .eq('orders.is_test', false)
      .gte('orders.order_date', startDate)
      .lte('orders.order_date', endDate)

    // Load manual sales overrides
    const { data: manualSales } = await sb.from('procurement_forecast_sales')
      .select('item_code, month, manual_qty')
      .in('item_code', itemCodes)
      .in('month', QM)

    // Load inventory (system stock)
    const { data: invData } = await sb.from('inventory')
      .select('product_code, quantity, location')
      .in('product_code', itemCodes)

    // Load manual stock overrides
    const { data: manualStock } = await sb.from('procurement_forecast_stock')
      .select('item_code, manual_qty')
      .in('item_code', itemCodes)

    // Build salesData map
    const sMap = {}
    items.forEach(i => {
      sMap[i.item_code] = {}
      QM.forEach(m => { sMap[i.item_code][m] = { sys: 0, manual: null } })
    })

    // Aggregate system sales by item+month
    ;(sysOrders || []).forEach(row => {
      const od = row.orders?.order_date
      if (!od) return
      const month = od.slice(0, 7) // YYYY-MM
      if (!QM.includes(month)) return
      if (sMap[row.item_code]?.[month] !== undefined) {
        sMap[row.item_code][month].sys += (row.dispatched_qty || 0)
      }
    })

    // Apply manual sales
    ;(manualSales || []).forEach(row => {
      if (sMap[row.item_code]?.[row.month] !== undefined) {
        sMap[row.item_code][row.month].manual = row.manual_qty
      }
    })

    // Build stockData map
    const stMap = {}
    items.forEach(i => { stMap[i.item_code] = { kaveri: 0, godawari: 0, manual: null } })
    ;(invData || []).forEach(row => {
      if (!stMap[row.product_code]) return
      if (row.location === 'Kaveri') stMap[row.product_code].kaveri += (row.quantity || 0)
      else if (row.location === 'Godawari') stMap[row.product_code].godawari += (row.quantity || 0)
    })
    ;(manualStock || []).forEach(row => {
      if (stMap[row.item_code]) stMap[row.item_code].manual = row.manual_qty
    })

    setSalesData(sMap)
    setStockData(stMap)
    setLoadingBrand(false)
  }

  function setSalesManual(item_code, month, val) {
    setSalesData(prev => ({
      ...prev,
      [item_code]: { ...prev[item_code], [month]: { ...prev[item_code]?.[month], manual: val === '' ? null : parseInt(val) || 0 } }
    }))
  }

  function copySysToManual(item_code, month) {
    const sys = salesData[item_code]?.[month]?.sys || 0
    setSalesManual(item_code, month, sys)
  }

  function setStockManual(item_code, val) {
    setStockData(prev => ({
      ...prev,
      [item_code]: { ...prev[item_code], manual: val === '' ? null : parseInt(val) || 0 }
    }))
  }

  function copySysStock(item_code) {
    const d = stockData[item_code] || {}
    setStockManual(item_code, (d.kaveri || 0) + (d.godawari || 0))
  }

  // Derived calculations per item
  function calc(item_code) {
    const cfg = brandConfig || { lead_time_days: 0, transit_days: 0, processing_days: 0, inventory_days: 45 }
    const reorderDays = (cfg.lead_time_days || 0) + (cfg.transit_days || 0) + (cfg.processing_days || 0)
    const replenishDays = reorderDays + (cfg.inventory_days || 45)

    const sales = salesData[item_code] || {}
    const monthQtys = QM.map(m => {
      const s = sales[m] || { sys: 0, manual: null }
      return s.manual !== null ? s.manual : s.sys
    })
    const qAvg = monthQtys.reduce((a, b) => a + b, 0) / 3
    const dailyRate = qAvg / 30
    const minQty = Math.ceil(dailyRate * reorderDays)
    const poQty  = Math.ceil(dailyRate * replenishDays)

    const st = stockData[item_code] || { kaveri: 0, godawari: 0, manual: null }
    const effectiveStock = st.manual !== null ? st.manual : (st.kaveri || 0) + (st.godawari || 0)
    const needsOrder = reorderDays > 0 && effectiveStock < minQty

    return { reorderDays, replenishDays, qAvg: Math.round(qAvg), dailyRate, minQty, poQty, effectiveStock, needsOrder }
  }

  async function saveOverrides() {
    if (saveGuard.current) return
    saveGuard.current = true
    setSaving(true)

    const userName_ = userName
    const salesRows = []
    const stockRows = []

    brandItems.forEach(item => {
      const s = salesData[item.item_code] || {}
      QM.forEach(m => {
        if (s[m]?.manual !== null && s[m]?.manual !== undefined) {
          salesRows.push({ item_code: item.item_code, month: m, manual_qty: s[m].manual, created_by: userName_, updated_at: new Date().toISOString() })
        }
      })
      const st = stockData[item.item_code] || {}
      if (st.manual !== null && st.manual !== undefined) {
        stockRows.push({ item_code: item.item_code, manual_qty: st.manual, updated_by: userName_, updated_at: new Date().toISOString() })
      }
    })

    const errors = []
    if (salesRows.length) {
      const { error } = await sb.from('procurement_forecast_sales').upsert(salesRows, { onConflict: 'item_code,month' })
      if (error) errors.push(error.message)
    }
    if (stockRows.length) {
      const { error } = await sb.from('procurement_forecast_stock').upsert(stockRows, { onConflict: 'item_code' })
      if (error) errors.push(error.message)
    }

    if (errors.length) { toast('Save failed: ' + errors[0]); saveGuard.current = false; setSaving(false); return }
    toast('Overrides saved', 'success')
    saveGuard.current = false
    setSaving(false)
  }

  async function generateDraftPO() {
    if (!poVendorId) { toast('Please select a vendor'); return }
    if (genGuard.current) return
    genGuard.current = true
    setGenerating(true)

    const triggeredItems = brandItems.filter(item => calc(item.item_code).needsOrder)
    if (!triggeredItems.length) { toast('No items need ordering'); genGuard.current = false; setGenerating(false); return }

    // Get PO number
    const { data: { session } } = await sb.auth.getSession()
    const fcCode = 'AMD' // default, can be changed in PO detail
    const { data: poNumber, error: seqErr } = await sb.rpc('next_po_number', { p_fc: fcCode })
    if (seqErr) { toast('Failed to generate PO number'); genGuard.current = false; setGenerating(false); return }

    const { data: po, error: poErr } = await sb.from('purchase_orders').insert({
      po_number: poNumber,
      vendor_id: poVendorId,
      vendor_name: poVendorName,
      status: 'draft',
      po_date: new Date().toISOString().slice(0, 10),
      fulfilment_center: 'Kaveri',
      is_test: false,
      notes: `Auto-generated from Procurement Forecast — ${QLabel}`,
      created_by: session?.user?.id,
      created_by_name: userName,
    }).select('id').single()

    if (poErr) { toast('Failed to create PO: ' + poErr.message); genGuard.current = false; setGenerating(false); return }

    const lineItems = triggeredItems.map((item, idx) => {
      const c = calc(item.item_code)
      return {
        po_id: po.id,
        sr_no: idx + 1,
        item_code: item.item_code,
        description: null,
        qty: c.poQty,
        unit_price: 0,
        total_price: 0,
        received_qty: 0,
      }
    })

    const { error: itemsErr } = await sb.from('po_items').insert(lineItems)
    if (itemsErr) { toast('PO created but items failed: ' + itemsErr.message); genGuard.current = false; setGenerating(false); navigate('/procurement/po/' + po.id); return }

    toast('Draft PO created', 'success')
    genGuard.current = false
    setGenerating(false)
    setPOModal(false)
    navigate('/procurement/po/' + po.id)
  }

  // Items that need ordering
  const triggeredCount = brandItems.filter(i => calc(i.item_code).needsOrder).length

  const TH = { padding: '9px 10px', fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)', whiteSpace: 'nowrap', textAlign: 'right' }
  const TD = { padding: '9px 10px', fontSize: 12, borderBottom: '1px solid var(--gray-50)', verticalAlign: 'middle', textAlign: 'right', fontFamily: 'var(--mono)' }

  return (
    <Layout>
      <div style={{ padding: '28px 32px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--gray-900)', margin: 0 }}>Procurement Forecast</h1>
            <span style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2, display: 'block' }}>
              Analysing <strong>{QLabel}</strong> · Standard items only
            </span>
          </div>
          <button onClick={() => navigate('/procurement/forecast/config')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: '1.5px solid var(--gray-200)', borderRadius: 7, background: 'white', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', cursor: 'pointer' }}>
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Configure Lead Times
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 64, color: 'var(--gray-400)' }}>Loading…</div>
        ) : (
          <>
            {/* Brand Summary Graph */}
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Brand Overview</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {brandSummary.map(b => {
                  const isSelected = selectedBrand === b.brand
                  const cfg = allConfigs[b.brand]
                  // compute needs_order count only if this brand is loaded
                  const needsCount = selectedBrand === b.brand ? triggeredCount : null
                  return (
                    <button key={b.brand} onClick={() => selectBrand(b.brand)}
                      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 18px', minWidth: 140, border: isSelected ? '2px solid var(--blue-600)' : '1.5px solid var(--gray-200)', borderRadius: 10, background: isSelected ? '#eff6ff' : 'white', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? 'var(--blue-700)' : 'var(--gray-900)' }}>{b.brand}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{b.total} standard items</div>
                      {!cfg && <div style={{ fontSize: 10, color: '#b45309', fontWeight: 600, background: '#fffbeb', padding: '2px 6px', borderRadius: 4 }}>No config</div>}
                      {needsCount !== null && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {needsCount > 0
                            ? <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '2px 7px', borderRadius: 10 }}>{needsCount} need order</span>
                            : <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', background: '#f0fdf4', padding: '2px 7px', borderRadius: 10 }}>All sufficient</span>
                          }
                        </div>
                      )}
                      {/* Mini visual bar */}
                      {cfg && (
                        <div style={{ width: '100%', height: 4, background: 'var(--gray-100)', borderRadius: 2 }}>
                          <div style={{ height: 4, borderRadius: 2, background: needsCount > 0 ? '#fca5a5' : '#86efac', width: needsCount !== null ? `${Math.min(100, (needsCount / (b.total || 1)) * 100)}%` : '0%', transition: 'width 0.4s' }} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Brand Detail Table */}
            {selectedBrand && (
              <div>
                {/* Config summary banner */}
                {brandConfig ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#15803d', display: 'flex', gap: 24 }}>
                    <span><strong>Lead Time:</strong> {brandConfig.lead_time_days}d</span>
                    <span><strong>Transit:</strong> {brandConfig.transit_days}d</span>
                    <span><strong>Processing:</strong> {brandConfig.processing_days}d</span>
                    <span><strong>Reorder Level:</strong> {(brandConfig.lead_time_days||0)+(brandConfig.transit_days||0)+(brandConfig.processing_days||0)}d</span>
                    <span><strong>Inventory Days:</strong> {brandConfig.inventory_days}d</span>
                    <span><strong>Replenishment Level:</strong> {(brandConfig.lead_time_days||0)+(brandConfig.transit_days||0)+(brandConfig.processing_days||0)+(brandConfig.inventory_days||45)}d</span>
                  </div>
                ) : (
                  <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#92400e' }}>
                    No lead time config for <strong>{selectedBrand}</strong>. Reorder level = 0 days — all items will show 0 min qty.
                    <button onClick={() => navigate('/procurement/forecast/config')} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#b45309', fontWeight: 600, cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>Configure now →</button>
                  </div>
                )}

                {loadingBrand ? (
                  <div style={{ textAlign: 'center', padding: 48, color: 'var(--gray-400)' }}>Loading {selectedBrand} data…</div>
                ) : brandItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 48, color: 'var(--gray-400)' }}>No standard items found for {selectedBrand}</div>
                ) : (
                  <>
                    {/* Action bar */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>
                        <strong style={{ color: 'var(--gray-900)' }}>{brandItems.length}</strong> items &nbsp;·&nbsp;
                        <strong style={{ color: '#dc2626' }}>{triggeredCount}</strong> need order &nbsp;·&nbsp;
                        <strong style={{ color: '#15803d' }}>{brandItems.length - triggeredCount}</strong> sufficient
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={saveOverrides} disabled={saving}
                          style={{ padding: '8px 16px', border: '1.5px solid var(--gray-200)', borderRadius: 7, background: 'white', fontSize: 13, fontWeight: 600, color: 'var(--gray-700)', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                          {saving ? 'Saving…' : 'Save Overrides'}
                        </button>
                        {triggeredCount > 0 && (
                          <button onClick={() => setPOModal(true)}
                            style={{ padding: '8px 16px', background: 'var(--blue-700)', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                            Generate Draft PO ({triggeredCount} items)
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Main table */}
                    <div style={{ overflowX: 'auto', border: '1px solid var(--gray-100)', borderRadius: 10 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1200 }}>
                        <thead>
                          <tr>
                            <th style={{ ...TH, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--gray-50)', zIndex: 2, minWidth: 130 }}>Item Code</th>
                            {QM.map(m => (
                              <th key={m} colSpan={2} style={{ ...TH, textAlign: 'center', borderLeft: '1px solid var(--gray-100)' }}>
                                {MONTH_NAMES[m.slice(5)]} {m.slice(0, 4)}
                              </th>
                            ))}
                            <th style={{ ...TH, background: '#f8fafc' }}>Q Avg</th>
                            <th style={{ ...TH, background: '#eff6ff', color: '#1d4ed8' }}>Min Qty</th>
                            <th style={{ ...TH, background: '#f0fdf4', color: '#15803d' }}>PO Qty</th>
                            <th style={{ ...TH }}>Kaveri</th>
                            <th style={{ ...TH }}>Godawari</th>
                            <th style={{ ...TH, borderLeft: '1px solid var(--gray-100)' }}>Stock Override</th>
                            <th style={{ ...TH, background: '#f8fafc' }}>Eff. Stock</th>
                            <th style={{ ...TH }}>Status</th>
                          </tr>
                          <tr>
                            <th style={{ ...TH, fontSize: 10, position: 'sticky', left: 0, background: 'var(--gray-50)', zIndex: 2 }}></th>
                            {QM.map(m => (
                              <>
                                <th key={m+'-s'} style={{ ...TH, fontSize: 10, borderLeft: '1px solid var(--gray-100)', color: 'var(--gray-400)' }}>System</th>
                                <th key={m+'-m'} style={{ ...TH, fontSize: 10, color: '#b45309' }}>Override</th>
                              </>
                            ))}
                            <th style={{ ...TH, fontSize: 10 }}></th>
                            <th style={{ ...TH, fontSize: 10, background: '#eff6ff' }}></th>
                            <th style={{ ...TH, fontSize: 10, background: '#f0fdf4' }}></th>
                            <th style={{ ...TH, fontSize: 10 }}></th>
                            <th style={{ ...TH, fontSize: 10 }}></th>
                            <th style={{ ...TH, fontSize: 10, borderLeft: '1px solid var(--gray-100)' }}>System → Manual</th>
                            <th style={{ ...TH, fontSize: 10 }}></th>
                            <th style={{ ...TH, fontSize: 10 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {brandItems.map(item => {
                            const c = calc(item.item_code)
                            const st = stockData[item.item_code] || { kaveri: 0, godawari: 0, manual: null }
                            const rowBg = c.needsOrder ? '#fff5f5' : 'white'
                            return (
                              <tr key={item.item_code} style={{ background: rowBg }}>
                                <td style={{ ...TD, textAlign: 'left', position: 'sticky', left: 0, background: rowBg, zIndex: 1, fontWeight: 600, color: 'var(--gray-900)', fontFamily: 'var(--font)' }}>
                                  {item.item_code}
                                </td>
                                {QM.map(m => {
                                  const s = salesData[item.item_code]?.[m] || { sys: 0, manual: null }
                                  return (
                                    <>
                                      {/* System value */}
                                      <td key={m+'-s'} style={{ ...TD, borderLeft: '1px solid var(--gray-50)', color: 'var(--gray-400)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                          {s.sys}
                                          <button title="Copy to override" onClick={() => copySysToManual(item.item_code, m)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', padding: 0, display: 'flex', lineHeight: 1 }}>
                                            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                                          </button>
                                        </div>
                                      </td>
                                      {/* Manual input */}
                                      <td key={m+'-m'} style={{ ...TD, padding: '6px 8px' }}>
                                        <input
                                          type="number" min="0"
                                          value={s.manual !== null ? s.manual : ''}
                                          placeholder={String(s.sys)}
                                          onChange={e => setSalesManual(item.item_code, m, e.target.value)}
                                          style={{ width: 56, padding: '4px 6px', border: s.manual !== null ? '1.5px solid #f59e0b' : '1.5px solid var(--gray-200)', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right', background: s.manual !== null ? '#fffbeb' : 'white', outline: 'none' }}
                                        />
                                      </td>
                                    </>
                                  )
                                })}
                                <td style={{ ...TD, background: '#f8fafc', fontWeight: 700 }}>{c.qAvg}</td>
                                <td style={{ ...TD, background: '#eff6ff', fontWeight: 700, color: '#1d4ed8' }}>{c.minQty}</td>
                                <td style={{ ...TD, background: '#f0fdf4', fontWeight: 700, color: '#15803d' }}>{c.poQty}</td>
                                <td style={{ ...TD }}>{st.kaveri}</td>
                                <td style={{ ...TD }}>{st.godawari}</td>
                                {/* Stock override */}
                                <td style={{ ...TD, borderLeft: '1px solid var(--gray-50)', padding: '6px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                    <button title="Copy system stock" onClick={() => copySysStock(item.item_code)}
                                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-300)', padding: 0, display: 'flex', lineHeight: 1 }}>
                                      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
                                    </button>
                                    <input
                                      type="number" min="0"
                                      value={st.manual !== null ? st.manual : ''}
                                      placeholder={String((st.kaveri||0)+(st.godawari||0))}
                                      onChange={e => setStockManual(item.item_code, e.target.value)}
                                      style={{ width: 64, padding: '4px 6px', border: st.manual !== null ? '1.5px solid #f59e0b' : '1.5px solid var(--gray-200)', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 12, textAlign: 'right', background: st.manual !== null ? '#fffbeb' : 'white', outline: 'none' }}
                                    />
                                  </div>
                                </td>
                                <td style={{ ...TD, background: '#f8fafc', fontWeight: 700 }}>{c.effectiveStock}</td>
                                <td style={{ ...TD }}>
                                  {c.needsOrder
                                    ? <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color:'#dc2626', background:'#fef2f2', padding:'3px 8px', borderRadius:10 }}>🔴 Order</span>
                                    : <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:700, color:'#15803d', background:'#f0fdf4', padding:'3px 8px', borderRadius:10 }}>🟢 OK</span>
                                  }
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Draft PO Modal */}
      {showPOModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:50, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div style={{ background:'white', borderRadius:12, padding:28, width:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--gray-900)', marginBottom:6 }}>Generate Draft PO</div>
            <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:20 }}>
              {triggeredCount} items from <strong>{selectedBrand}</strong> need ordering. Select a vendor to create the draft PO.
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ fontSize:12, fontWeight:600, color:'var(--gray-700)', display:'block', marginBottom:6 }}>Vendor</label>
              <Typeahead
                value={poVendorText}
                onChange={setPOVendorText}
                onSelect={v => { setPOVendorId(v.id); setPOVendorName(v.vendor_name); setPOVendorText(v.vendor_name) }}
                onClear={() => { setPOVendorId(''); setPOVendorName(''); setPOVendorText('') }}
                placeholder="Search vendor…"
                fetchOptions={async q => {
                  const { data } = await sb.from('vendors').select('id,vendor_name,vendor_code').or(`vendor_name.ilike.%${q}%,vendor_code.ilike.%${q}%`).eq('status','active').limit(8)
                  return (data || []).map(v => ({ ...v, label: v.vendor_name }))
                }}
                strictSelect
              />
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button onClick={() => { setPOModal(false); setPOVendorText(''); setPOVendorId(''); setPOVendorName('') }}
                style={{ padding:'8px 18px', border:'1.5px solid var(--gray-200)', borderRadius:7, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', color:'var(--gray-700)' }}>
                Cancel
              </button>
              <button onClick={generateDraftPO} disabled={!poVendorId || generating}
                style={{ padding:'8px 18px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer', opacity:(!poVendorId||generating)?0.65:1 }}>
                {generating ? 'Creating…' : 'Create Draft PO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
