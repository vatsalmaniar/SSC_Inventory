import { useState, useEffect, useMemo } from 'react'
import { codeIncludes } from '../lib/itemSearch'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import PeopleAvatar from '../components/PeopleAvatar'
import { xlsStatusStyle, xlsFinish, xlsDownload } from '../lib/xlsExport'
import '../styles/orders-redesign.css'

const REP_PALETTE = ['#1a73e8','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?' }

const PO_STATUS_LABELS = {
  draft:'PO Created', pending_approval:'Pending Approval', approved:'PO Approved', placed:'Order Placed',
  acknowledged:'Acknowledgement', delivery_confirmation:'Delivery Confirmation',
  partially_received:'Partial GRN', material_received:'Material Received',
  closed:'Closed', cancelled:'Cancelled',
}
// Colours are shared vocabulary with the Orders module — a status that means the
// same thing must not be two colours, and a colour must not mean two things.
// Fixed 2026-09-01 after benchmarking against OrdersList:
//   closed was #047857 — which is Orders' DISPATCHED_FC (Delivered). A closed PO
//     rendered in the exact green that trains the team to read "Delivered".
//     Now #475569, the same slate Orders uses for closed.
//   partially_received was #D97706 (Orders' goods_issued) AND identical to
//     delivery_confirmation, so two different PO states were indistinguishable.
//     Now #C2410C, the deep orange Orders uses for partial_dispatch.
//   material_received was #22C55E (Orders' eway_generated, a mid-pipeline state)
//     while the terminal emerald had been given to closed. Now #047857.
const PO_STATUS_COLORS = {
  draft:'#94A3B8', pending_approval:'#F59E0B', approved:'#1a73e8', placed:'#0EA5E9',
  acknowledged:'#0F766E', delivery_confirmation:'#D97706',
  partially_received:'#C2410C', material_received:'#047857', closed:'#475569', cancelled:'#EF4444',
}
function poValue(po) { return po.total_amount || 0 }
function isCPO(po) { return !!(po.order_number && po.order_number.includes('/CO')) }

const FILTERS = [
  { key:'all', label:'All' },
  { key:'po', label:'PO' },
  { key:'cpo', label:'PCO' },
  { key:'open', label:'Open' },
  { key:'approval', label:'Pending Approval', tone:'warn' },
  { key:'placed', label:'Order Placed' },
  { key:'delivery', label:'Delivery Confirmation' },
  { key:'received', label:'Material Received' },
  { key:'amended', label:'Amended · vendor not told', tone:'warn' },
  { key:'closed', label:'Closed' },
  { key:'cancelled', label:'Cancelled', tone:'danger' },
]
const TIMELINES = TIMELINE_OPTIONS

function matchFilter(po, f, amendedUnsent) {
  if (f === 'all') return true
  // An amended PO whose latest revision was never sent: the vendor is
  // working to superseded figures and nothing else in the app says so.
  if (f === 'amended') return amendedUnsent?.has(po.id) || false
  if (f === 'po') return !isCPO(po)
  if (f === 'cpo') return isCPO(po)
  if (f === 'open') return !['material_received','closed','cancelled'].includes(po.status)
  if (f === 'approval') return po.status === 'pending_approval'
  if (f === 'placed') return ['approved','placed','acknowledged'].includes(po.status)
  if (f === 'delivery') return po.status === 'delivery_confirmation'
  if (f === 'received') return po.status === 'material_received'
  if (f === 'closed') return po.status === 'closed'
  if (f === 'cancelled') return po.status === 'cancelled'
  return false
}

function inTimeline(po, t, customFrom, customTo, dateMode) {
  if (dateMode === 'expected') {
    if (!po.expected_delivery) return t === 'all'
    return dateInTimeline(po.expected_delivery, t, customFrom, customTo)
  }
  if (dateMode === 'cancelled') {
    // Old cancellations without a stamp fall back to PO date so they never disappear
    return dateInTimeline(po.cancelled_at || po.po_date || po.created_at, t, customFrom, customTo)
  }
  return dateInTimeline(po.po_date || po.created_at, t, customFrom, customTo)
}

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

export default function PurchaseOrderList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState({ name:'', role:'' })
  const [pos, setPos] = useState([])
  const [amendedUnsent, setAmendedUnsent] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(location.state?.filter || 'all')
  const [timeline, setTimeline] = useState(location.state?.timeline || 'all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [dateMode, setDateMode] = useState(location.state?.filter === 'cancelled' ? 'cancelled' : 'po')

  function selectFilter(key) {
    setFilter(key)
    setPage(1)
    // Cancelled chip → timeline filters on cancellation date; leaving reverts to PO date
    if (key === 'cancelled') setDateMode('cancelled')
    else if (dateMode === 'cancelled') setDateMode('po')
  }
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showTest, setShowTest] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })
    // Demo users get the test dataset, as OrdersList.jsx:201 does. This passed
    // `false` unconditionally, so a demo account saw real purchase orders.
    await loadPos(role === 'demo')
  }

  async function loadPos(testMode = false) {
    setLoading(true)
    // Page past PostgREST's 1000-row cap (same fetchAll pattern as OrdersList)
    const { data, error } = await fetchAll((from, to) => sb.from('purchase_orders')
      .select('id,po_number,status,total_amount,vendor_name,vendor_id,order_number,fulfilment_center,submitted_by_name,created_at,po_date,expected_delivery,received_at,cancelled_at,po_items(id,sr_no,item_code,qty,received_qty,unit_price,unit_price_after_disc,lp_unit_price,total_price,delivery_date)')
      .gte('created_at', FY_START).eq('is_test', testMode)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to))
    if (error) console.error('PO list load error:', error)
    setPos(data || [])
    // POs whose CURRENT revision is an amendment that never reached the vendor.
    // Only the latest revision matters — an old Rev 1 that was superseded by a
    // sent Rev 2 is not outstanding.
    // fetchAll, not a bare select: po_revisions passed PostgREST's 1000-row cap
    // (1,332 rows on 2026-09-01), so a plain query silently dropped the oldest
    // 300+ and the "Amended · vendor not told" chip under-counted. Same trap
    // that hid 406 orders from this module's sibling — see lib/fetchAll.js.
    fetchAll((from, to) => sb.from('po_revisions').select('po_id, rev_no, sent_to_vendor_at')
      .order('rev_no', { ascending: false }).order('po_id', { ascending: false }).range(from, to))
      .then(({ data: revs, error: rErr, truncated }) => {
        if (rErr) { console.error('revision load:', rErr); return }
        if (truncated) console.warn('PO list: po_revisions hit the fetch ceiling — amended counts may be incomplete.')
        const latest = new Map()
        for (const r of (revs || [])) if (!latest.has(r.po_id)) latest.set(r.po_id, r)
        const out = new Set()
        for (const [poId, r] of latest) if (r.rev_no > 0 && !r.sent_to_vendor_at) out.add(poId)
        setAmendedUnsent(out)
      })
    setLoading(false)
  }

  // Memoised for the same reason OrdersList.jsx:257 is: `counts` alone runs
  // every filter across every PO, and without this it re-ran on every keystroke
  // in the search box. Same formulas, they just stop recomputing when nothing
  // they depend on has changed.
  const timelineOrders = useMemo(
    () => pos.filter(po => inTimeline(po, timeline, customFrom, customTo, dateMode)),
    [pos, timeline, customFrom, customTo, dateMode])

  const counts = useMemo(
    () => FILTERS.reduce((acc, { key }) => { acc[key] = timelineOrders.filter(po => matchFilter(po, key, amendedUnsent)).length; return acc }, {}),
    [timelineOrders, amendedUnsent])

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => timelineOrders
    .filter(po => matchFilter(po, filter, amendedUnsent))
    .filter(po => !q || codeIncludes(po.po_number, q) || po.vendor_name?.toLowerCase().includes(q) || codeIncludes(po.order_number, q) || po.submitted_by_name?.toLowerCase().includes(q)),
    [timelineOrders, filter, amendedUnsent, q])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = useMemo(() => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filtered, safePage])
  const sumTotal = useMemo(() => filtered.filter(po => po.status !== 'cancelled').reduce((s, po) => s + poValue(po), 0), [filtered])
  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'POs'
  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || ''}–${customTo || ''}` : 'Custom')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fileName = `SSC_PurchaseOrders_${activeFilterLabel}_${timelineLabel}_${new Date().toISOString().slice(0,10)}`

  async function downloadSummary() {
    // Was raw SheetJS (json_to_sheet + writeFile): no header, no status colours,
    // no number formats, and it happily exported a blank sheet. The Summary
    // button looked identical to the Orders one but produced an unrelated file.
    // Now the same ExcelJS + shared-chrome path as OrdersList.jsx:300.
    if (!filtered.length) { alert('No POs to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('POs Summary', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'PO #', key: 'po_number', width: 22 },
        { header: 'Vendor', key: 'vendor', width: 32 },
        { header: 'Linked Order', key: 'linked_order', width: 22 },
        { header: 'PO Date', key: 'po_date', width: 12 },
        { header: 'Expected Delivery', key: 'expected', width: 15 },
        { header: 'Submitted By', key: 'submitted_by', width: 18 },
        { header: 'Items', key: 'items', width: 7 },
        { header: 'Value (₹)', key: 'value', width: 15, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Centre', key: 'centre', width: 12 },
        { header: 'Status', key: 'status', width: 18 },
      ]
      ws.columns = cols
      filtered.forEach(po => {
        const sStyle = xlsStatusStyle(po.status)
        const row = ws.addRow({
          po_number: po.po_number, vendor: po.vendor_name || '',
          linked_order: po.order_number || '', po_date: po.po_date ? fmt(po.po_date) : '',
          expected: po.expected_delivery ? fmt(po.expected_delivery) : '',
          submitted_by: po.submitted_by_name || '', items: (po.po_items || []).length,
          value: poValue(po), centre: po.fulfilment_center || '',
          status: PO_STATUS_LABELS[po.status] || po.status,
        })
        const sCell = row.getCell('status')
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
        sCell.font = { bold: true, color: { argb: sStyle.fg } }
        sCell.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      xlsFinish(ws, cols.length)
      await xlsDownload(wb, fileName + '_Summary.xlsx')
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  async function downloadDetailed() {
    if (!filtered.length) { alert('No POs to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('POs Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'Sr No', key: 'sr_no', width: 6 },
        { header: 'PO Date', key: 'po_date', width: 12 },
        { header: 'PO #', key: 'po_number', width: 22 },
        { header: 'Vendor', key: 'vendor', width: 28 },
        { header: 'Linked CO', key: 'linked_co', width: 18 },
        { header: 'Submitted By', key: 'submitted_by', width: 18 },
        { header: 'Item', key: 'item_code', width: 26 },
        { header: 'Total Qty', key: 'total_qty', width: 10 },
        { header: 'Pending Qty', key: 'pending_qty', width: 11 },
        { header: 'Total Value', key: 'total_value', width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Pending Value', key: 'pending_value', width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Delivery Date', key: 'delivery_date', width: 13 },
        { header: 'Received Date', key: 'received_date', width: 13 },
        { header: 'Status', key: 'status', width: 18 },
      ]
      ws.columns = cols
      let rowCounter = 0
      filtered.forEach(po => {
        const items = po.po_items || []
        const sStyle = xlsStatusStyle(po.status)
        const baseRow = {
          po_date: po.po_date ? fmt(po.po_date) : '',
          po_number: po.po_number,
          vendor: po.vendor_name || '',
          linked_co: po.order_number || '',
          submitted_by: po.submitted_by_name || '',
          received_date: po.received_at ? fmt(po.received_at) : '',
          status: PO_STATUS_LABELS[po.status] || po.status,
        }
        const pushRow = (data) => {
          const row = ws.addRow(data)
          const sCell = row.getCell('status')
          sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
          sCell.font = { bold: true, color: { argb: sStyle.fg } }
          sCell.alignment = { horizontal: 'center', vertical: 'middle' }
          if ((data.pending_qty || 0) > 0) {
            const pq = row.getCell('pending_qty')
            pq.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
            pq.font = { bold: true, color: { argb: 'FF92400E' } }
            const pv = row.getCell('pending_value')
            pv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
            pv.font = { bold: true, color: { argb: 'FF92400E' } }
          }
        }
        if (items.length === 0) {
          rowCounter += 1
          pushRow({ ...baseRow, sr_no: rowCounter, item_code:'', total_qty:'', pending_qty:'', total_value:'', pending_value:'', delivery_date:'' })
        } else {
          items.forEach(item => {
            const recv = item.received_qty || 0
            const pendingQty = Math.max(0, (item.qty || 0) - recv)
            const unit = item.unit_price_after_disc || item.unit_price || item.lp_unit_price || 0
            const pendingValueLocal = pendingQty * unit
            rowCounter += 1
            pushRow({
              ...baseRow,
              sr_no: rowCounter, item_code: item.item_code,
              total_qty: item.qty,
              pending_qty: pendingQty,
              total_value: item.total_price || 0,
              pending_value: pendingValueLocal,
              delivery_date: item.delivery_date ? fmt(item.delivery_date) : '',
            })
          })
        }
      })
      xlsFinish(ws, cols.length)
      await xlsDownload(wb, fileName + '_Detailed.xlsx')
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  return (
    <Layout pageTitle="Purchase Orders" pageKey="procurement">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Purchase Orders</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> {activeFilterLabel.toLowerCase()}</span>
              <span className="o-sep">·</span>
              <span><b>{fmtCr(sumTotal)}</b> total value</span>
            </div>
          </div>
          <div className="page-meta">
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadPos(e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSummary} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Summary
              </button>
              <button className="o-dl-btn" onClick={downloadDetailed} title="Detailed Excel — line items per PO">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Detailed
              </button>
            </div>
            <button className="btn-primary" onClick={() => navigate('/procurement/po/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New PO
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label={activeFilterLabel} value={filtered.length} sub="matching POs" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Total Value" value={fmtCr(sumTotal)} sub="across filtered" chart="bars"/>
          <KpiTile variant="hero" tone="teal" label="Open POs" value={counts.open || 0} sub="in progress" chart="bars" onClick={() => selectFilter('open')}/>
          <KpiTile label="Pending Approval" value={counts.approval || 0} sub="awaiting approval" accent={(counts.approval || 0) > 0 ? 'amber' : null} onClick={() => selectFilter('approval')}/>
          <KpiTile label="Delivery Pending" value={counts.delivery || 0} sub="awaiting delivery" onClick={() => selectFilter('delivery')}/>
        </div>

        <div className="o-timeline">
          {TIMELINES.map(({ key, label }) => (
            <button key={key} className={timeline === key ? 'on' : ''} onClick={() => { setTimeline(key); setPage(1) }}>{label}</button>
          ))}
          {timeline === 'custom' && (
            <div className="o-timeline-custom">
              <span>From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}/>
              <span>To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)}/>
              {(customFrom || customTo) && <button className="o-search-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }} style={{ marginLeft: 6, fontSize: 11, color: 'var(--o-bad)' }}>Clear</button>}
            </div>
          )}
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search PO number, vendor, order…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="o-datemode">
            <button className={dateMode === 'po' ? 'on' : ''} onClick={() => { setDateMode('po'); setPage(1) }}>PO Date</button>
            <button className={dateMode === 'expected' ? 'on' : ''} onClick={() => { setDateMode('expected'); setPage(1) }}>Expected Delivery</button>
            {filter === 'cancelled' && (
              <button className={dateMode === 'cancelled' ? 'on' : ''} onClick={() => { setDateMode('cancelled'); setPage(1) }}>Cancelled On</button>
            )}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => selectFilter(key)}>
              {label}
              {counts[key] > 0 && <span className="o-chip-n">{counts[key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="o-loading">Loading POs…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 110px minmax(0, 1fr) auto 140px' }}>
              <div>PO #</div>
              <div>Vendor</div>
              <div>{filter === 'cancelled' ? 'Cancelled On' : 'PO Date'}</div>
              <div>Submitted By</div>
              <div className="ol-numgroup">
                <div className="num num-label" style={{ textAlign:'right' }}>Items</div>
                <div className="num num-label" style={{ textAlign:'right' }}>Value</div>
              </div>
              <div className="num">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No purchase orders found</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(po => {
                  const color = PO_STATUS_COLORS[po.status] || '#94A3B8'
                  return (
                    <div key={po.id} className="ol-row ol-data" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 110px minmax(0, 1fr) auto 140px' }} onClick={() => navigate('/procurement/po/' + po.id)}>
                      <div className="ol-cell">
                        <div className="ol-num">{po.po_number}</div>
                        {po.order_number && <div className="ol-date-sub">{po.order_number}</div>}
                      </div>
                      <div className="ol-cell ol-cust" title={po.vendor_name}>{po.vendor_name || '—'}</div>
                      <div className="ol-cell">
                        {filter === 'cancelled' ? (
                          <>
                            <div className="ol-date" style={{ color: '#B91C1C' }}>{fmt(po.cancelled_at || po.po_date)}</div>
                            <div className="ol-date-sub">PO: {fmt(po.po_date)}</div>
                          </>
                        ) : (
                          <>
                            <div className="ol-date">{fmt(po.po_date)}</div>
                            {po.expected_delivery && <div className="ol-date-sub">Exp: {fmt(po.expected_delivery)}</div>}
                          </>
                        )}
                      </div>
                      <div className="ol-cell">
                        {po.submitted_by_name ? (
                          <div className="ol-owner" title={po.submitted_by_name}>
                            <PeopleAvatar name={po.submitted_by_name} className="ol-owner-avatar" />
                            <span className="ol-owner-name">{po.submitted_by_name}</span>
                          </div>
                        ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                      </div>
                      <div className="ol-numgroup">
                        <div className="ol-items">{(po.po_items || []).length}</div>
                        <div className="ol-val">₹{poValue(po).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                      </div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': color }}>
                          <span className="ol-status-dot"/>
                          {PO_STATUS_LABELS[po.status] || po.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                {totalPages > 1 && (
                  <div className="ol-pages">
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                      const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                      const ellipsis = !show && Math.abs(p - safePage) === 2
                      if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                      if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 4px', color:'var(--o-muted-2)' }}>…</span>
                      return null
                    })}
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {onClick && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">{sub && <div className="kt-sub mono">{sub}</div>}</div>
    </div>
  )
}
function KpiChart({ kind }) {
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
        <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
      ))}
    </svg>
  )
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}
