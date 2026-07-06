import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL, TIMELINE_OPTIONS, dateInTimeline } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const PAGE_SIZE = 50

const STATUS_LABELS = { three_way_check:'3-Way Check', invoice_pending:'Invoice Pending', inward_complete:'Inward Complete' }
const STATUS_COLORS = { three_way_check:'#F59E0B', invoice_pending:'#1a73e8', inward_complete:'#22C55E' }

function fmtINR(val) {
  if (!val) return '₹0'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}
function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const FILTERS = [
  { key:'all',              label:'All' },
  { key:'three_way_check',  label:'3-Way Check',     tone:'warn' },
  { key:'invoice_pending',  label:'Invoice Pending' },
  { key:'inward_complete',  label:'Inward Complete' },
  { key:'credit_notes',     label:'Credit / Dr Notes', tone:'warn' },
]

const CN_TYPE_LABELS = { customer_rejection: 'Customer Rejection', cancellation_return: 'Cancellation Return' }

export default function PurchaseInvoiceList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [invoices, setInvoices] = useState([])
  const [cnGrns, setCnGrns] = useState([])   // rejection/cancellation GRNs → Tally credit/Dr-note worklist
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('three_way_check')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [timeline, setTimeline] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => { init() }, [])
  useEffect(() => { setPage(1) }, [filter, search])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['accounts','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadInvoices()
  }

  async function loadInvoices() {
    setLoading(true)
    // Page past PostgREST's 1000-row cap
    const { data, error } = await fetchAll((from, to) => sb.from('purchase_invoices')
      .select('id, invoice_number, vendor_name, invoice_date, invoice_amount, gst_amount, total_amount, status, po_id, grn_id, created_at')
      .eq('is_test', false).gte('created_at', FY_START)
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, to))
    if (error) console.error('Purchase invoices load error:', error)
    setInvoices(data || [])

    // Credit/Dr-note worklist: confirmed return/rejection GRNs. Accounting is in
    // Tally — the note is prepared there and uploaded on the GRN; this list makes
    // pending ones visible to accounts without visiting each GRN.
    const { data: cn, error: cnErr } = await sb.from('grn')
      .select('id, grn_number, grn_type, status, received_at, created_at, order_id, credit_note_number, credit_note_url, credit_note_uploaded_by, credit_note_uploaded_at')
      .in('grn_type', ['customer_rejection', 'cancellation_return'])
      .in('status', ['confirmed', 'invoice_matched', 'inward_posted'])
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(500)
    if (cnErr) console.error('Credit-note GRNs load error:', cnErr)
    const cnRows = cn || []
    // Order/customer context (separate query — no FK embedding assumption)
    const orderIds = [...new Set(cnRows.map(g => g.order_id).filter(Boolean))]
    const orderMap = {}
    for (let i = 0; i < orderIds.length; i += 150) {
      const { data: ords } = await sb.from('orders').select('id, order_number, customer_name').in('id', orderIds.slice(i, i + 150))
      for (const o of (ords || [])) orderMap[o.id] = o
    }
    setCnGrns(cnRows.map(g => ({ ...g, _order: orderMap[g.order_id] || null })))
    setLoading(false)
  }

  function matchFilter(inv) {
    const s = inv.status || 'three_way_check'
    if (filter === 'three_way_check') return s === 'three_way_check'
    if (filter === 'invoice_pending') return s === 'invoice_pending'
    if (filter === 'inward_complete') return s === 'inward_complete'
    if (filter === 'all') return true
    return s === filter
  }

  // Timeline filters on the vendor's invoice date (business date; falls back to created)
  const timelineInvoices = invoices.filter(i => dateInTimeline(i.invoice_date || i.created_at, timeline, customFrom, customTo))
  const counts = {
    three_way_check: timelineInvoices.filter(i => (i.status || 'three_way_check') === 'three_way_check').length,
    invoice_pending: timelineInvoices.filter(i => i.status === 'invoice_pending').length,
    inward_complete: timelineInvoices.filter(i => i.status === 'inward_complete').length,
    all: timelineInvoices.length,
    credit_notes: cnGrns.filter(g => !g.credit_note_url).length, // pending notes only
  }
  const q = search.trim().toLowerCase()
  const filtered = timelineInvoices.filter(matchFilter).filter(inv =>
    !q || (inv.invoice_number || '').toLowerCase().includes(q) || (inv.vendor_name || '').toLowerCase().includes(q)
  )
  const isCnTab = filter === 'credit_notes'
  const cnFiltered = cnGrns
    .filter(g => dateInTimeline(g.received_at || g.created_at, timeline, customFrom, customTo))
    .filter(g => !q
      || (g.grn_number || '').toLowerCase().includes(q)
      || (g._order?.order_number || '').toLowerCase().includes(q)
      || (g._order?.customer_name || '').toLowerCase().includes(q)
      || (g.credit_note_number || '').toLowerCase().includes(q))
  const totalAmount = filtered.reduce((s, i) => s + (i.total_amount || 0), 0)

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const activeLabel = FILTERS.find(f => f.key === filter)?.label || 'Inward Billing'
  const fileName = `SSC_InwardBilling_${activeLabel.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    if (!filtered.length) { alert('No invoices to export. Adjust filters and try again.'); return }
    const rows = filtered.map(inv => ({
      'Invoice #':       inv.invoice_number || '',
      'Vendor':          inv.vendor_name || '',
      'Invoice Date':    inv.invoice_date ? fmt(inv.invoice_date) : '',
      'Created':         fmt(inv.created_at),
      'Amount (₹)':      Math.round(inv.invoice_amount || 0),
      'GST (₹)':         Math.round(inv.gst_amount || 0),
      'Total (₹)':       Math.round(inv.total_amount || 0),
      'Stage':           STATUS_LABELS[inv.status || 'three_way_check'] || (inv.status || ''),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Inward Billing')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  async function downloadDetailed() {
    if (!filtered.length) { alert('No invoices to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    try {
      // Fetch PO + GRN numbers for the filtered set so the export includes them
      const poIds = [...new Set(filtered.map(i => i.po_id).filter(Boolean))]
      const grnIds = [...new Set(filtered.map(i => i.grn_id).filter(Boolean))]
      const poMap = {}; const grnMap = {}
      if (poIds.length) {
        const { data: pos } = await sb.from('purchase_orders').select('id,po_number').in('id', poIds)
        ;(pos || []).forEach(p => { poMap[p.id] = p.po_number })
      }
      if (grnIds.length) {
        const { data: grns } = await sb.from('grn').select('id,grn_number').in('id', grnIds)
        ;(grns || []).forEach(g => { grnMap[g.id] = g.grn_number })
      }

      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('Inward Billing Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'Sr No',        key: 'sr_no',        width: 6 },
        { header: 'Created',      key: 'created',      width: 12 },
        { header: 'Invoice #',    key: 'invoice',      width: 20 },
        { header: 'Invoice Date', key: 'invoice_date', width: 12 },
        { header: 'Vendor',       key: 'vendor',       width: 32 },
        { header: 'PO #',         key: 'po',           width: 18 },
        { header: 'GRN #',        key: 'grn',          width: 22 },
        { header: 'Amount',       key: 'amount',       width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'GST',          key: 'gst',          width: 12, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Total',        key: 'total',        width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Stage',        key: 'stage',        width: 18 },
      ]
      ws.columns = cols
      const stageStyle = (s) => {
        if (s === 'inward_complete') return { bg: 'FFDCFCE7', fg: 'FF166534' }
        if (s === 'invoice_pending') return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
        return { bg: 'FFFEF3C7', fg: 'FF92400E' }
      }
      filtered.forEach((inv, idx) => {
        const stage = inv.status || 'three_way_check'
        const sStyle = stageStyle(stage)
        const row = ws.addRow({
          sr_no: idx + 1,
          created: fmt(inv.created_at),
          invoice: inv.invoice_number || '',
          invoice_date: inv.invoice_date ? fmt(inv.invoice_date) : '',
          vendor: inv.vendor_name || '',
          po: poMap[inv.po_id] || '',
          grn: grnMap[inv.grn_id] || '',
          amount: inv.invoice_amount || 0,
          gst: inv.gst_amount || 0,
          total: inv.total_amount || 0,
          stage: STATUS_LABELS[stage] || stage,
        })
        const sCell = row.getCell('stage')
        sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
        sCell.font = { bold: true, color: { argb: sStyle.fg } }
        sCell.alignment = { horizontal: 'center', vertical: 'middle' }
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
        row.eachCell({ includeEmpty: true }, cell => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } } })
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
    <Layout pageTitle="Inward Billing" pageKey="billing">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Inward Billing — Purchase Invoices</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> invoices</span>
              {totalAmount > 0 && (<><span className="o-sep">·</span><span><b>{fmtCr(totalAmount)}</b> total</span></>)}
              <span className="o-sep">·</span><span>{FY_LABEL}</span>
            </div>
          </div>
          <div className="page-meta">
            <div className="o-dl-group" style={isCnTab ? { display: 'none' } : undefined}>
              <button className="o-dl-btn" onClick={downloadSummary} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Summary
              </button>
              <button className="o-dl-btn" onClick={downloadDetailed} title="Detailed Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Detailed
              </button>
            </div>
            <button className="btn-ghost" onClick={() => navigate('/billing')}>Dashboard</button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="3-Way Check" value={counts.three_way_check} sub="verify PO·GRN·invoice" chart="bars" onClick={() => setFilter('three_way_check')}/>
          <KpiTile variant="hero" tone="forest" label="Inward Complete" value={counts.inward_complete} sub="fully processed" chart="bars" onClick={() => setFilter('inward_complete')}/>
          <KpiTile variant="hero" tone="teal" label="Invoice Pending" value={counts.invoice_pending} sub="awaiting entry" chart="line" onClick={() => setFilter('invoice_pending')}/>
          <KpiTile label="Total Value" value={fmtCr(totalAmount)} sub="filtered amount"/>
          <KpiTile label="Total Invoices" value={counts.all} sub={FY_LABEL} onClick={() => setFilter('all')}/>
        </div>

        {/* Timeline — filters on vendor invoice date */}
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
            <input placeholder="Search invoice number, vendor…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => {
            const c = counts[key] || 0
            return (
              <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => setFilter(key)}>
                {label}
                {c > 0 && <span className="o-chip-n">{c}</span>}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="o-loading">Loading invoices…</div>
        ) : isCnTab ? (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '190px 150px minmax(0, 1.3fr) 130px 110px 180px' }}>
              <div>GRN #</div>
              <div>Type</div>
              <div>Customer</div>
              <div>Order #</div>
              <div>Received</div>
              <div>Credit / Dr Note</div>
            </div>
            {cnFiltered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No return / rejection GRNs</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Credit &amp; Dr notes for returns and rejections will appear here after GRN confirmation.</div>
              </div>
            ) : (
              <div className="ol-table">
                {cnFiltered.map(g => (
                  <div key={g.id} className="ol-row ol-data" style={{ gridTemplateColumns: '190px 150px minmax(0, 1.3fr) 130px 110px 180px' }} onClick={() => navigate('/fc/grn/' + g.id)}>
                    <div className="ol-cell"><div className="ol-num" style={{ color: 'var(--ssc-blue)' }}>{g.grn_number}</div></div>
                    <div className="ol-cell">
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: g.grn_type === 'customer_rejection' ? '#fef2f2' : '#fff7ed', color: g.grn_type === 'customer_rejection' ? '#b91c1c' : '#c2410c' }}>
                        {CN_TYPE_LABELS[g.grn_type] || g.grn_type}
                      </span>
                    </div>
                    <div className="ol-cell ol-cust" title={g._order?.customer_name}>{g._order?.customer_name || '—'}</div>
                    <div className="ol-cell"><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{g._order?.order_number || '—'}</span></div>
                    <div className="ol-cell ol-date">{fmt(g.received_at || g.created_at)}</div>
                    <div className="ol-cell">
                      {g.credit_note_url ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, color: '#166534' }}>
                          <span style={{ background: '#dcfce7', padding: '2px 8px', borderRadius: 10 }}>✓ {g.credit_note_number || 'Uploaded'}</span>
                          <a href={g.credit_note_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: '#1a4dab' }}>View</a>
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#b45309', background: '#fef3c7', border: '1px solid #fde68a', padding: '2px 10px', borderRadius: 10 }}>PENDING — make in Tally &amp; upload</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 110px 110px 110px 110px 140px' }}>
              <div>Invoice #</div>
              <div>Vendor</div>
              <div>Invoice Date</div>
              <div className="num">Amount</div>
              <div className="num">GST</div>
              <div className="num">Total</div>
              <div className="num">Stage</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No invoices here</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Nothing to show right now.</div>
              </div>
            ) : (
              <>
              <div className="ol-table">
                {paginated.map(inv => {
                  const stage = inv.status || 'three_way_check'
                  return (
                    <div key={inv.id} className="ol-row ol-data" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 110px 110px 110px 110px 140px' }} onClick={() => navigate('/procurement/invoices/' + inv.id)}>
                      <div className="ol-cell">
                        {inv.invoice_number ? (
                          <div className="ol-num" style={{ color: stage === 'inward_complete' ? '#047857' : 'var(--ssc-blue)' }}>{inv.invoice_number}</div>
                        ) : (
                          <div className="ol-num" style={{ color: '#92400E' }}>
                            Pending
                            <span className="ol-sample-tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}>No Inv</span>
                          </div>
                        )}
                        <div className="ol-date-sub">{fmt(inv.created_at)}</div>
                      </div>
                      <div className="ol-cell ol-cust" title={inv.vendor_name}>{inv.vendor_name || '—'}</div>
                      <div className="ol-cell ol-date">{inv.invoice_date ? fmt(inv.invoice_date) : '—'}</div>
                      <div className="ol-cell ol-val">{inv.invoice_amount ? fmtINR(inv.invoice_amount) : '—'}</div>
                      <div className="ol-cell ol-pending">{inv.gst_amount ? fmtINR(inv.gst_amount) : '—'}</div>
                      <div className="ol-cell ol-val">{inv.total_amount ? fmtINR(inv.total_amount) : '—'}</div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': STATUS_COLORS[stage] || '#94A3B8' }}>
                          <span className="ol-status-dot"/>
                          {STATUS_LABELS[stage] || stage}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {filtered.length > 0 && (
                <div className="ol-foot">
                  <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
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
                </div>
              )}
              </>
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
