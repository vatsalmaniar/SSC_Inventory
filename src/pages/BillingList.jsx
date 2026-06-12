import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const BILLING_BATCH_STATUSES = ['delivery_created','pi_requested','pi_generated','pi_payment_pending','goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc']

const STATUS_LABELS = {
  delivery_created:'Credit Check',
  pi_requested:'Issue PI', pi_generated:'PI Sent', pi_payment_pending:'PI Payment Pending',
  goods_issued:'Credit Check', credit_check:'GI Posted', goods_issue_posted:'Invoice Pending',
  invoice_generated:'Waiting for FC', delivery_ready:'E-Way Pending',
  eway_generated:'E-Way Done', dispatched_fc:'Delivered', cancelled:'Cancelled',
}
const STATUS_COLORS = {
  delivery_created:'#D97706',
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#0F766E',
  eway_generated:'#22C55E', dispatched_fc:'#047857', cancelled:'#EF4444',
}
function statusColor(s) { return STATUS_COLORS[s] || '#94A3B8' }
function effStatus(b) { return b.status || 'goods_issued' }
// A delivery_created batch awaiting Accounts credit clearance (new early-credit-check flow).
function needsCredit(b) { return b.status === 'delivery_created' && b.credit_checked === false }
// Pill label: a cleared delivery_created batch is just awaiting FC pick, not credit.
function rowStageLabel(b, stageKey) {
  if (stageKey === 'delivery_created') return b.credit_checked ? 'Awaiting Pick' : 'Credit Check'
  return STATUS_LABELS[stageKey] || stageKey
}

const PAGE_SIZE = 50

export default function BillingList() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('action')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showTest, setShowTest] = useState(false)

  useEffect(() => { init() }, [])
  useEffect(() => { setPage(1) }, [filter, search])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'accounts'
    if (!['accounts','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })
    await loadBatches()
  }

  async function loadBatches(testMode = false) {
    setLoading(true)
    // Page past PostgREST's 1000-row cap — 1300+ billing batches/FY would
    // otherwise silently drop the oldest few hundred from every chip/total.
    const { data, error, truncated } = await fetchAll((from, to) =>
      sb.from('order_dispatches')
        .select('id, order_id, batch_no, dc_number, invoice_number, status, fulfilment_center, dispatched_items, credit_override, credit_checked, credit_checked_at, created_at, orders!inner(id, order_number, customer_name, order_type, order_date, status, is_test, credit_terms, freight, engineer_name, account_owner, order_items(id, item_code, qty, dispatched_qty, total_price, unit_price_after_disc, cancelled_qty, line_status))')
        .in('status', BILLING_BATCH_STATUSES)
        .eq('orders.is_test', testMode)
        .neq('orders.order_type', 'SAMPLE')
        .gte('created_at', FY_START)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    )
    if (error) console.error('BillingList load error:', error)
    if (truncated) console.warn('BillingList: batch list hit the fetch ceiling — consider server-side pagination.')
    setBatches(data || [])
    setLoading(false)
  }

  const piStatuses = ['pi_requested','pi_generated','pi_payment_pending']
  const actionStatuses = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','goods_issue_posted','delivery_ready']
  const waitingStatuses = ['credit_check','invoice_generated','eway_generated']

  function matchFilter(b) {
    const s = effStatus(b)
    // A delivery_created batch belongs in billing ONLY while it needs credit attention.
    // Once cleared (awaiting pick) it's the FC's job — keep it out of every billing view.
    if (s === 'delivery_created' && !(needsCredit(b) || b.credit_override === true)) return false
    if (filter === 'everything') return true
    if (filter === 'creditcheck') return needsCredit(b)
    if (filter === 'action')   return actionStatuses.includes(s) || needsCredit(b)
    if (filter === 'pi')       return piStatuses.includes(s)
    if (filter === 'waiting')  return waitingStatuses.includes(s)
    if (filter === 'all')      return s !== 'dispatched_fc'
    if (filter === 'override') return b.credit_override === true
    return s === filter
  }

  const counts = {
    everything: batches.length,
    creditcheck: batches.filter(needsCredit).length,
    action:     batches.filter(b => actionStatuses.includes(effStatus(b)) || needsCredit(b)).length,
    pi:         batches.filter(b => piStatuses.includes(effStatus(b))).length,
    waiting:    batches.filter(b => waitingStatuses.includes(effStatus(b))).length,
    all:        batches.filter(b => effStatus(b) !== 'dispatched_fc').length,
    override:   batches.filter(b => b.credit_override === true).length,
  }
  BILLING_BATCH_STATUSES.forEach(s => { counts[s] = batches.filter(b => effStatus(b) === s).length })

  const q = search.trim().toLowerCase()
  const filtered = batches.filter(matchFilter).filter(b =>
    !q || b.orders?.customer_name?.toLowerCase().includes(q) ||
    b.orders?.order_number?.toLowerCase().includes(q) ||
    (b.invoice_number || '').toLowerCase().includes(q) ||
    (b.dc_number || '').toLowerCase().includes(q)
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  function batchValue(b) {
    return (b.dispatched_items || []).length
      ? b.dispatched_items.reduce((sum, i) => sum + (i.total_price || 0), 0)
      : (b.orders?.order_items || []).reduce((sum, i) => sum + ((i.total_price || 0) - ((i.cancelled_qty||0) * (i.unit_price_after_disc || i.unit_price || 0))), 0)
  }
  function batchItemsCount(b) {
    return (b.dispatched_items || b.orders?.order_items || []).length
  }

  const totalValue = filtered.reduce((s, b) => s + batchValue(b), 0)
  const overrides  = filtered.filter(b => b.credit_override).length

  // Single-row filters — keeps semantic groupings + the few stages
  // billing team actually triages by, mirroring OrdersList shape.
  // Every UI stage gets its own chip so people can see each bucket at a glance.
  // Labels match what's shown in the row's stage pill (intentional inversion
  // for credit_check vs goods_issued — see STATUS_LABELS at top of file).
  const FILTERS = [
    { key: 'everything',         label: 'All' },
    { key: 'creditcheck',        label: 'Credit Check',       tone: 'warn' },
    { key: 'override',           label: 'On Hold',            tone: 'warn' },
    { key: 'pi_requested',       label: 'Issue PI',           tone: 'warn' },
    { key: 'pi_generated',       label: 'PI Sent' },
    { key: 'pi_payment_pending', label: 'PI Payment Pending' },
    { key: 'goods_issued',       label: 'Credit Check (old)' },
    { key: 'credit_check',       label: 'GI Posted' },
    { key: 'goods_issue_posted', label: 'Invoice Pending' },
    { key: 'invoice_generated',  label: 'Waiting for FC' },
    { key: 'delivery_ready',     label: 'E-Way Pending' },
    { key: 'eway_generated',     label: 'E-Way Done' },
    { key: 'dispatched_fc',      label: 'Delivered' },
  ]

  const activeLabel = FILTERS.find(f => f.key === filter)?.label || 'Billing'
  const fileName = `SSC_Billing_${activeLabel.replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    if (!filtered.length) { alert('No batches to export. Adjust filters and try again.'); return }
    const rows = filtered.map(b => ({
      'Invoice / DC':  b.invoice_number || b.dc_number || '',
      'Order #':       b.orders?.order_number || '',
      'Customer':      b.orders?.customer_name || '',
      'Batch #':       b.batch_no || '',
      'Date':          fmt(b.created_at),
      'Centre':        b.fulfilment_center || '',
      'Items':         batchItemsCount(b),
      'Value (₹)':     Math.round(batchValue(b)),
      'Stage':         STATUS_LABELS[effStatus(b)] || effStatus(b),
      'Credit Override': b.credit_override ? 'YES' : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Billing')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  async function downloadDetailed() {
    if (!filtered.length) { alert('No batches to export. Adjust filters and try again.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    const uniqueNames = [...new Set(filtered.map(b => b.orders?.customer_name).filter(Boolean))]
    const custIdMap = {}
    if (uniqueNames.length) {
      const { data } = await sb.from('customers').select('customer_id,customer_name').in('customer_name', uniqueNames)
      ;(data || []).forEach(c => { custIdMap[c.customer_name] = c.customer_id || '' })
    }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('Billing Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'Sr No',         key: 'sr_no',          width: 6 },
        { header: 'Batch Date',    key: 'batch_date',     width: 12 },
        { header: 'Invoice / DC',  key: 'invoice',        width: 20 },
        { header: 'Order No',      key: 'order_number',   width: 22 },
        { header: 'Batch #',       key: 'batch_no',       width: 8 },
        { header: 'Cust ID',       key: 'cust_id',        width: 10 },
        { header: 'Customer Name', key: 'customer_name',  width: 32 },
        { header: 'Owner',         key: 'owner',          width: 18 },
        { header: 'Centre',        key: 'centre',         width: 12 },
        { header: 'Item',          key: 'item_code',      width: 26 },
        { header: 'Qty',           key: 'qty',            width: 8 },
        { header: 'Value',         key: 'total_value',    width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Stage',         key: 'stage',          width: 18 },
        { header: 'Override',      key: 'override',       width: 10 },
      ]
      ws.columns = cols

      const stageStyle = (s) => {
        switch (s) {
          case 'pi_requested': case 'pi_generated': case 'pi_payment_pending': return { bg: 'FFFEF3C7', fg: 'FF92400E' }
          case 'goods_issued': return { bg: 'FFFFEDD5', fg: 'FFC2410C' }
          case 'credit_check': case 'goods_issue_posted': return { bg: 'FFDCFCE7', fg: 'FF166534' }
          case 'invoice_generated': case 'delivery_ready': return { bg: 'FFD1FAE5', fg: 'FF065F46' }
          case 'eway_generated': return { bg: 'FFBBF7D0', fg: 'FF14532D' }
          case 'dispatched_fc': return { bg: 'FFBBF7D0', fg: 'FF14532D' }
          default: return { bg: 'FFF1F5F9', fg: 'FF334155' }
        }
      }

      let rowCounter = 0
      filtered.forEach(b => {
        const items = b.dispatched_items?.length ? b.dispatched_items : (b.orders?.order_items || [])
        const stage = effStatus(b)
        const sStyle = stageStyle(stage)
        const base = {
          batch_date: fmt(b.created_at),
          invoice: b.invoice_number || b.dc_number || '',
          order_number: b.orders?.order_number || '',
          batch_no: b.batch_no || '',
          cust_id: custIdMap[b.orders?.customer_name] || '',
          customer_name: b.orders?.customer_name || '',
          owner: b.orders?.engineer_name || b.orders?.account_owner || '',
          centre: b.fulfilment_center || '',
          stage: STATUS_LABELS[stage] || stage,
          override: b.credit_override ? 'YES' : '',
        }
        const pushRow = (data) => {
          const row = ws.addRow(data)
          const sCell = row.getCell('stage')
          sCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sStyle.bg } }
          sCell.font = { bold: true, color: { argb: sStyle.fg } }
          sCell.alignment = { horizontal: 'center', vertical: 'middle' }
          if (data.override === 'YES') {
            const oc = row.getCell('override')
            oc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
            oc.font = { bold: true, color: { argb: 'FFB91C1C' } }
            oc.alignment = { horizontal: 'center' }
          }
        }
        if (!items.length) {
          rowCounter += 1
          pushRow({ ...base, sr_no: rowCounter, item_code:'', qty:'', total_value:'' })
        } else {
          items.forEach(it => {
            rowCounter += 1
            const cancelVal = (it.cancelled_qty || 0) * (it.unit_price_after_disc || it.unit_price || 0)
            const netValue  = (it.total_price || 0) - cancelVal
            pushRow({
              ...base, sr_no: rowCounter,
              item_code: it.item_code || '',
              qty: it.qty ?? it.dispatched_qty ?? '',
              total_value: netValue,
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
    <Layout pageTitle="Billing" pageKey="billing">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Billing — All Invoices</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> batches</span>
              {totalValue > 0 && (<><span className="o-sep">·</span><span><b>₹{(totalValue/1e5).toFixed(2)}L</b> value</span></>)}
              {overrides > 0 && (<><span className="o-sep">·</span><span style={{ color: '#B91C1C' }}><b style={{ color: '#B91C1C' }}>{overrides}</b> overrides</span></>)}
              <span className="o-sep">·</span><span>{FY_LABEL}</span>
            </div>
          </div>
          <div className="page-meta">
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadBatches(e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
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
            <button className="btn-ghost" onClick={() => navigate('/billing')}>Dashboard</button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep"   label="Action Required" value={counts.action} sub="credit · invoice · e-way" chart="bars" onClick={() => setFilter('action')}/>
          <KpiTile variant="hero" tone="forest" label="Delivered"        value={counts.dispatched_fc} sub={FY_LABEL} chart="bars" onClick={() => setFilter('dispatched_fc')}/>
          <KpiTile variant="hero" tone="teal"   label="Total Active"     value={counts.all} sub="in pipeline" chart="line" onClick={() => setFilter('all')}/>
          <KpiTile label="PI Stage"  value={counts.pi}       sub="awaiting payment" accent={counts.pi > 0 ? 'amber' : null} onClick={() => setFilter('pi')}/>
          <KpiTile label="Overrides" value={counts.override} sub="payment pending"  accent={counts.override > 0 ? 'amber' : null} onClick={() => setFilter('override')}/>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search invoice, DC, order, customer…" value={search} onChange={e => setSearch(e.target.value)}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => {
            const count = counts[key]
            return (
              <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => setFilter(key)}>
                {label}
                {count > 0 && <span className="o-chip-n">{count}</span>}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="o-loading">Loading batches…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '170px minmax(0, 1.4fr) 110px 100px minmax(0, 1fr) auto 140px' }}>
              <div>Invoice / DC</div>
              <div>Customer</div>
              <div>Centre</div>
              <div>Date</div>
              <div>Order #</div>
              <div className="ol-numgroup">
                <div className="num num-label" style={{ textAlign:'right' }}>Items</div>
                <div className="num num-label" style={{ textAlign:'right' }}>Value</div>
              </div>
              <div className="num">Stage</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No invoices here</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Nothing to action right now.</div>
              </div>
            ) : (
              <>
                <div className="ol-table">
                  {paginated.map(b => {
                    const s = effStatus(b)
                    const isCancelled = b.orders?.status === 'cancelled'
                    const isDelivered = s === 'dispatched_fc'
                    const hasInv = b.invoice_number && !b.invoice_number.startsWith('Temp/')
                    const batchVal = batchValue(b)
                    const itemsCount = batchItemsCount(b)
                    const stageKey = isCancelled ? 'cancelled' : s
                    return (
                      <div key={b.id} className="ol-row ol-data" style={{ gridTemplateColumns: '170px minmax(0, 1.4fr) 110px 100px minmax(0, 1fr) auto 140px' }} onClick={() => navigate('/billing/' + b.order_id, { state: { dispatch_id: b.id } })}>
                        <div className="ol-cell">
                          {hasInv ? (
                            <div className="ol-num" style={{ color: isDelivered ? '#047857' : 'var(--ssc-blue)' }}>{b.invoice_number}</div>
                          ) : (
                            <div className="ol-num" style={{ color: '#92400E' }}>
                              {b.dc_number || '—'}
                              <span className="ol-sample-tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}>No Invoice</span>
                            </div>
                          )}
                          {b.batch_no > 1 && <span className="ol-sample-tag">Batch {b.batch_no}</span>}
                        </div>
                        <div className="ol-cell ol-cust" title={b.orders?.customer_name}>{b.orders?.customer_name}</div>
                        <div className="ol-cell ol-date">{b.fulfilment_center || '—'}</div>
                        <div className="ol-cell ol-date">{fmt(b.created_at)}</div>
                        <div className="ol-cell ol-date" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5, color: 'var(--o-muted)' }}>{b.orders?.order_number}</div>
                        <div className="ol-numgroup">
                          <div className="ol-items">{itemsCount}</div>
                          <div className="ol-val">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                        </div>
                        <div className="ol-cell ol-status-cell" style={{ flexDirection:'column', alignItems:'flex-end', gap: 2 }}>
                          <span className="ol-status-pill" style={{ '--stage-color': statusColor(stageKey) }}>
                            <span className="ol-status-dot"/>
                            {rowStageLabel(b, stageKey)}
                          </span>
                          {!isCancelled && b.credit_override && <span style={{ fontSize: 10, color: '#B91C1C', fontWeight: 600 }}>On Hold</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Pagination — matches OrdersList ol-foot */}
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
