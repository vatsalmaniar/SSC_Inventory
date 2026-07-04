import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const REP_PALETTE = ['#1a73e8','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?' }

const GRN_TYPE_LABELS = { po_inward:'PO Inward', customer_rejection:'Customer Rejection', sample_return:'Sample Return', cancellation_return:'Cancellation Return' }
const GRN_STATUS_LABELS = { draft:'GRN Created', checking:'Checking', confirmed:'Confirmed', invoice_matched:'Invoice Matched', inward_posted:'Inward Posted' }
const GRN_STATUS_COLORS = { draft:'#94A3B8', checking:'#F59E0B', confirmed:'#1a73e8', invoice_matched:'#0F766E', inward_posted:'#22C55E' }

const FILTERS = [
  { key:'all',             label:'All' },
  { key:'draft',           label:'GRN Created' },
  { key:'checking',        label:'Checking',          tone:'warn' },
  { key:'confirmed',       label:'Confirmed' },
  { key:'invoice_matched', label:'Invoice Matched' },
  { key:'inward_posted',   label:'Inward Posted' },
]
const TYPE_FILTERS = [
  { key:'all', label:'All Types' },
  { key:'po_inward', label:'PO Inward' },
  { key:'customer_rejection', label:'Cust Rej' },
  { key:'sample_return', label:'Sample Ret' },
  { key:'cancellation_return', label:'Cancel Ret' },
]

const PAGE_SIZE = 50

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

export default function GRNList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [grns, setGrns] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [timeline, setTimeline] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadGrns()
  }

  async function loadGrns() {
    setLoading(true)
    // Page past PostgREST's 1000-row cap
    const { data, error } = await fetchAll((from, to) =>
      sb.from('grn').select('*').eq('is_test', false).gte('created_at', FY_START)
        .order('received_at', { ascending: false }).order('id', { ascending: false })
        .range(from, to))
    if (error) console.error('GRN list load error:', error)
    setGrns(data || [])
    setLoading(false)
  }

  function matchFilter(g, f) { return f === 'all' ? true : g.status === f }
  function matchType(g, t) { return t === 'all' ? true : g.grn_type === t }

  // Timeline filters on the received date (business date of a GRN)
  const timelineGrns = grns.filter(g => dateInTimeline(g.received_at || g.created_at, timeline, customFrom, customTo))
  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = timelineGrns.filter(g => matchFilter(g, key) && matchType(g, typeFilter)).length; return acc }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineGrns.filter(g => matchFilter(g, filter)).filter(g => matchType(g, typeFilter))
    .filter(g => !q || g.grn_number?.toLowerCase().includes(q) || g.vendor_name?.toLowerCase().includes(q) || g.invoice_number?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const totalValue = filtered.reduce((s, g) => s + (g.total_amount || 0), 0)
  const pendingCount = timelineGrns.filter(g => (g.status === 'draft' || g.status === 'checking') && matchType(g, typeFilter)).length
  const confirmedCount = timelineGrns.filter(g => g.status === 'confirmed' && matchType(g, typeFilter)).length

  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'GRNs'
  const typeLabel = TYPE_FILTERS.find(t => t.key === typeFilter)?.label || ''
  const fileName = `SSC_GRNs_${activeFilterLabel}_${typeLabel}_${new Date().toISOString().slice(0,10)}`.replace(/\s+/g, '_')

  function downloadSummary() {
    if (!filtered.length) { alert('No GRNs to export. Adjust filters and try again.'); return }
    const rows = filtered.map(g => ({
      'GRN #':         g.grn_number || '',
      'Type':          GRN_TYPE_LABELS[g.grn_type] || g.grn_type || '',
      'Vendor / Source': g.vendor_name || '',
      'PO Number':     g.po_number || '',
      'Centre':        g.fulfilment_center || '',
      'Received By':   g.received_by || '',
      'Received On':   g.received_at ? fmt(g.received_at) : '',
      'Invoice #':     g.invoice_number || '',
      'Invoice Date':  g.invoice_date ? fmt(g.invoice_date) : '',
      'Invoice Value (₹)': g.invoice_amount || g.total_amount || 0,
      'Status':        GRN_STATUS_LABELS[g.status] || g.status || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'GRNs')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  async function downloadDetailed() {
    if (!filtered.length) { alert('No GRNs to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }

    // Fetch all grn_items for filtered GRNs in one query
    const grnIds = filtered.map(g => g.id)
    const { data: allItems } = await sb.from('grn_items').select('*').in('grn_id', grnIds).order('id', { ascending: true })
    const itemsByGrn = {}
    ;(allItems || []).forEach(it => { (itemsByGrn[it.grn_id] = itemsByGrn[it.grn_id] || []).push(it) })

    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('GRNs Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'Sr No',          key: 'sr_no',           width: 6 },
        { header: 'GRN Date',       key: 'grn_date',        width: 12 },
        { header: 'GRN #',          key: 'grn_number',      width: 22 },
        { header: 'Type',           key: 'grn_type',        width: 16 },
        { header: 'Vendor / Source',key: 'vendor_name',     width: 30 },
        { header: 'PO Number',      key: 'po_number',       width: 22 },
        { header: 'Centre',         key: 'centre',          width: 12 },
        { header: 'Invoice #',      key: 'invoice_number',  width: 16 },
        { header: 'Invoice Date',   key: 'invoice_date',    width: 12 },
        { header: 'Item Code',      key: 'item_code',       width: 22 },
        { header: 'Description',    key: 'description',     width: 30 },
        { header: 'Expected Qty',   key: 'expected_qty',    width: 12 },
        { header: 'Received Qty',   key: 'received_qty',    width: 12 },
        { header: 'Accepted Qty',   key: 'accepted_qty',    width: 12 },
        { header: 'Rejected Qty',   key: 'rejected_qty',    width: 12 },
        { header: 'Rejection Reason', key: 'rejection_reason', width: 24 },
        { header: 'Received By',    key: 'received_by',     width: 18 },
        { header: 'Status',         key: 'status',          width: 18 },
      ]
      ws.columns = cols

      const statusStyle = (s) => {
        switch (s) {
          case 'draft':           return { bg: 'FFF1F5F9', fg: 'FF334155' }
          case 'checking':        return { bg: 'FFFEF3C7', fg: 'FF92400E' }
          case 'confirmed':       return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
          case 'invoice_matched': return { bg: 'FFD1FAE5', fg: 'FF065F46' }
          case 'inward_posted':   return { bg: 'FFBBF7D0', fg: 'FF14532D' }
          default:                return { bg: 'FFF1F5F9', fg: 'FF334155' }
        }
      }

      let rowCounter = 0
      filtered.forEach(g => {
        const items = itemsByGrn[g.id] || []
        const sStyle = statusStyle(g.status)
        const baseRow = {
          grn_date:       g.received_at ? fmt(g.received_at) : (g.created_at ? fmt(g.created_at) : ''),
          grn_number:     g.grn_number || '',
          grn_type:       GRN_TYPE_LABELS[g.grn_type] || g.grn_type || '',
          vendor_name:    g.vendor_name || '',
          po_number:      g.po_number || '',
          centre:         g.fulfilment_center || '',
          invoice_number: g.invoice_number || '',
          invoice_date:   g.invoice_date ? fmt(g.invoice_date) : '',
          received_by:    g.received_by || '',
          status:         GRN_STATUS_LABELS[g.status] || g.status || '',
        }
        const pushRow = (data) => {
          const row = ws.addRow(data)
          const sCell = row.getCell('status')
          sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
          sCell.font = { bold: true, color: { argb: sStyle.fg } }
          sCell.alignment = { horizontal: 'center', vertical: 'middle' }
          // Highlight rejected qty if > 0
          if ((data.rejected_qty || 0) > 0) {
            const rj = row.getCell('rejected_qty')
            rj.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
            rj.font = { bold: true, color: { argb: 'FFB91C1C' } }
          }
          // Highlight short receipt (received < expected)
          if (typeof data.expected_qty === 'number' && typeof data.received_qty === 'number' && data.received_qty < data.expected_qty) {
            const rv = row.getCell('received_qty')
            rv.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
            rv.font = { bold: true, color: { argb: 'FF92400E' } }
          }
        }
        if (items.length === 0) {
          rowCounter += 1
          pushRow({ ...baseRow, sr_no: rowCounter, item_code:'', description:'', expected_qty:'', received_qty:'', accepted_qty:'', rejected_qty:'', rejection_reason:'' })
        } else {
          items.forEach(it => {
            rowCounter += 1
            pushRow({
              ...baseRow,
              sr_no: rowCounter,
              item_code:        it.item_code || '',
              description:      it.description || '',
              expected_qty:     it.expected_qty ?? '',
              received_qty:     it.received_qty ?? '',
              accepted_qty:     it.accepted_qty ?? '',
              rejected_qty:     it.rejected_qty ?? '',
              rejection_reason: it.rejection_reason || '',
            })
          })
        }
      })

      const header = ws.getRow(1)
      header.height = 24
      header.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2540' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF143055' } } }
      })
      const lastRow = ws.rowCount
      for (let r = 2; r <= lastRow; r++) {
        const row = ws.getRow(r)
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
        })
        if (r % 2 === 0) {
          row.eachCell({ includeEmpty: true }, cell => {
            const isTinted = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor?.argb !== 'FFFFFFFF'
            if (!isTinted) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
          })
        }
      }
      ws.autoFilter = { from: { row:1, column:1 }, to: { row:1, column: cols.length } }
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = fileName + '_Detailed.xlsx'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  return (
    <Layout pageTitle="Goods Receipt Notes" pageKey="fc">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Goods Receipt Notes</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> GRNs</span>
              {totalValue > 0 && (<><span className="o-sep">·</span><span><b>{fmtCr(totalValue)}</b> value</span></>)}
            </div>
          </div>
          <div className="page-meta">
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSummary} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Summary
              </button>
              <button className="o-dl-btn" onClick={downloadDetailed} title="Detailed Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Detailed
              </button>
            </div>
            <button className="btn-primary" onClick={() => navigate('/fc/grn/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New GRN
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label={FILTERS.find(f => f.key === filter)?.label || 'GRNs'} value={filtered.length} sub="matching GRNs" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Total Value" value={fmtCr(totalValue)} sub="across filtered" chart="bars"/>
          <KpiTile variant="hero" tone="teal" label="Confirmed" value={confirmedCount} sub="confirmed GRNs" chart="bars" onClick={() => { setFilter('confirmed'); setPage(1) }}/>
          <KpiTile label="Pending" value={pendingCount} sub="created + checking" accent={pendingCount > 0 ? 'amber' : null} onClick={() => { setFilter('checking'); setPage(1) }}/>
          <KpiTile label="Posted" value={counts.inward_posted || 0} sub="inward posted" onClick={() => { setFilter('inward_posted'); setPage(1) }}/>
        </div>

        {/* Timeline — filters on received date */}
        <div className="o-timeline">
          {TIMELINE_OPTIONS.map(({ key, label }) => (
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
            <input placeholder="Search GRN #, vendor, invoice…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="o-datemode">
            {TYPE_FILTERS.map(({ key, label }) => (
              <button key={key} className={typeFilter === key ? 'on' : ''} onClick={() => { setTypeFilter(key); setPage(1) }}>{label}</button>
            ))}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => { setFilter(key); setPage(1) }}>
              {label}
              {counts[key] > 0 && <span className="o-chip-n">{counts[key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="o-loading">Loading GRNs…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 100px minmax(0, 1fr) 130px 100px 130px' }}>
              <div>GRN #</div>
              <div>Vendor / Source</div>
              <div>Type</div>
              <div>Centre</div>
              <div>Received By</div>
              <div>Invoice #</div>
              <div>Date</div>
              <div className="num">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No GRNs found</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(g => (
                  <div key={g.id} className="ol-row ol-data" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 100px minmax(0, 1fr) 130px 100px 130px' }} onClick={() => navigate('/fc/grn/' + g.id)}>
                    <div className="ol-cell">
                      <div className="ol-num">{g.grn_number}</div>
                      {g.grn_type !== 'po_inward' && <span className="ol-sample-tag">{GRN_TYPE_LABELS[g.grn_type]}</span>}
                    </div>
                    <div className="ol-cell ol-cust" title={g.vendor_name}>{g.vendor_name || '—'}</div>
                    <div className="ol-cell ol-date">{GRN_TYPE_LABELS[g.grn_type] || g.grn_type}</div>
                    <div className="ol-cell ol-date">{g.fulfilment_center || '—'}</div>
                    <div className="ol-cell">
                      {g.received_by ? (
                        <div className="ol-owner" title={g.received_by}>
                          <div className="ol-owner-avatar" style={{background: ownerColor(g.received_by)}}>{initials(g.received_by)}</div>
                          <span className="ol-owner-name">{g.received_by}</span>
                        </div>
                      ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                    </div>
                    <div className="ol-cell ol-date" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5, color: 'var(--o-muted)' }}>{g.invoice_number || '—'}</div>
                    <div className="ol-cell ol-date">{fmt(g.received_at || g.created_at)}</div>
                    <div className="ol-cell ol-status-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': GRN_STATUS_COLORS[g.status] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>
                        {GRN_STATUS_LABELS[g.status] || g.status}
                      </span>
                    </div>
                  </div>
                ))}
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
