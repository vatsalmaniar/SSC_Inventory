import { useState, useEffect, useMemo } from 'react'
import { codeIncludes } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import Layout from '../components/Layout'
import Loading from '../components/Loading'
import { fetchAll } from '../lib/fetchAll'
import '../styles/orders-redesign.css'

// ─────────────────────────────────────────────────────────────────────────────
// OPEN DELIVERIES — the delivery monitor. SAP's VL06O.
//
// A delivery batch that is created but never goods-issued is invisible today.
// Nothing complains, so batch 1 can sit at credit_check from April while batch 2
// is raised in May and delivered in July. That is exactly how SSC/SO0503 ended
// up showing "no pending items" while 89 units had never left the building, and
// how SSC/SO0285 has been open since 29 April.
//
// This is deliberately a WORKLIST, not a block. SAP does not force batch 1 to
// ship before batch 2 — partial deliveries are independent by design, and
// blocking would stop the legitimate case where batch 2 is urgent and batch 1 is
// on credit hold. The control is visibility.
//
// "Open" = posted_qty_applied_at IS NULL, i.e. goods issue has not been posted.
// That is the same boundary mark_batch_posted() enforces, so this list can never
// disagree with the quantities on the order page.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKETS = [
  { key: 'all',   label: 'All' },
  { key: 'over30', label: 'Over 30 days', tone: 'danger' },
  { key: 'd15_30', label: '15–30 days',   tone: 'warn' },
  { key: 'd8_14',  label: '8–14 days' },
  { key: 'under7', label: 'Under 7 days' },
]

const STATUS_LABEL = {
  credit_check: 'Awaiting credit check', delivery_created: 'Delivery created',
  picking: 'Picking', packing: 'Packing', goods_issued: 'Goods issued (not posted)',
  pending_billing: 'Pending billing', pi_requested: 'PI requested',
  pi_generated: 'PI generated', pi_payment_pending: 'Awaiting PI payment',
  delivery_ready: 'Delivery ready', eway_generated: 'E-way generated',
  invoice_generated: 'Invoice generated', goods_issue_posted: 'GI posted',
}

function ageDays(d) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000) }
function bucketOf(days) {
  if (days > 30) return 'over30'
  if (days > 14) return 'd15_30'
  if (days > 7)  return 'd8_14'
  return 'under7'
}

export default function OpenDeliveries() {
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [bucket, setBucket]   = useState('all')
  const [search, setSearch]   = useState('')
  const [page, setPage]       = useState(1)
  const PAGE_SIZE = 50

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // Open = never goods-issue-posted. Cancelled batches are not open work.
    const { data: batches, error } = await fetchAll((from, to) => sb.from('order_dispatches')
      .select('id,order_id,batch_no,status,dc_number,invoice_number,credit_checked,credit_override,dispatched_items,created_at')
      .is('posted_qty_applied_at', null)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: true })
      .range(from, to))
    if (error) { console.error('open deliveries:', error); setLoading(false); return }

    const orderIds = [...new Set((batches || []).map(b => b.order_id).filter(Boolean))]
    const orders = {}
    for (let i = 0; i < orderIds.length; i += 150) {
      const { data } = await sb.from('orders')
        .select('id,order_number,customer_name,status,fulfilment_center,is_test')
        .in('id', orderIds.slice(i, i + 150))
      for (const o of (data || [])) orders[o.id] = o
    }

    const out = []
    for (const b of (batches || [])) {
      const o = orders[b.order_id]
      if (!o || o.is_test) continue
      // A cancelled order's leftover batches are cleanup, not open deliveries.
      if (o.status === 'cancelled') continue
      const items = Array.isArray(b.dispatched_items) ? b.dispatched_items : []
      const units = items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
      const value = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit_price) || 0), 0)
      const days  = ageDays(b.created_at)
      out.push({ ...b, order: o, units, value, days, bucket: bucketOf(days) })
    }
    setRows(out)
    setLoading(false)
  }

  const counts = useMemo(() => {
    const c = { all: rows.length, over30: 0, d15_30: 0, d8_14: 0, under7: 0 }
    for (const r of rows) c[r.bucket]++
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (bucket !== 'all' && r.bucket !== bucket) return false
      if (!q) return true
      return codeIncludes(r.order.order_number, q)
          || (r.order.customer_name || '').toLowerCase().includes(q)
          || codeIncludes(r.dc_number, q)
    })
  }, [rows, bucket, search])

  const totalValue = visible.reduce((s, r) => s + r.value, 0)
  const oldest = rows.length ? rows[0] : null
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  if (loading) return <Layout pageTitle="Open Deliveries" pageKey="fc"><div className="orders-app"><Loading /></div></Layout>

  return (
    <Layout pageTitle="Open Deliveries" pageKey="fc">
      <div className="orders-app" style={{ padding: '20px 24px 40px' }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">Open Deliveries</h1>
            <div className="page-sub">
              Delivery batches created but not yet goods-issued. Nothing here has left the building.
            </div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">OPEN</span><span style={{ fontWeight: 600 }}>{rows.length}</span></div>
            <div className="meta-pill" style={{ background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' }}>
              <span className="meta-label" style={{ color:'#92400e' }}>VALUE</span>
              <span style={{ fontWeight: 600 }}>₹{Math.round(totalValue).toLocaleString('en-IN')}</span>
            </div>
            {counts.over30 > 0 && (
              <div className="meta-pill" style={{ background:'#fef2f2', borderColor:'#fecaca', color:'#b91c1c' }}>
                <span className="meta-label" style={{ color:'#b91c1c' }}>OVER 30 DAYS</span>
                <span style={{ fontWeight: 600 }}>{counts.over30}</span>
              </div>
            )}
          </div>
        </div>

        {oldest && oldest.days > 30 && (
          <div className="card" style={{ padding:'12px 16px', marginBottom:14, background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b', fontSize:13, lineHeight:1.6 }}>
            <strong>Oldest open delivery is {oldest.days} days old</strong> — {oldest.order.order_number}, batch {oldest.batch_no},
            created {fmt(oldest.created_at)} and still at “{STATUS_LABEL[oldest.status] || oldest.status}”.
            <div style={{ marginTop:4, fontSize:12 }}>
              These units are already committed on the order, so they will not appear as needing a new batch.
              Until this delivery is goods-issued or cancelled, the customer is waiting and nothing else will flag it.
            </div>
          </div>
        )}

        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
          <input type="text" placeholder="Search order, customer or DC…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            style={{ flex:'1 1 240px', maxWidth:320, padding:'8px 12px', fontSize:16, border:'1px solid var(--o-line)',
                     borderRadius:9, outline:'none', background:'var(--o-surface)', fontFamily:'inherit' }} />
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {BUCKETS.map(b => (
              <button key={b.key} onClick={() => { setBucket(b.key); setPage(1) }}
                style={{ padding:'6px 12px', fontSize:12, fontWeight:600, borderRadius:8, cursor:'pointer',
                         border:'1px solid ' + (bucket === b.key ? 'var(--ssc-deep)' : 'var(--o-line)'),
                         background: bucket === b.key ? 'var(--ssc-deep)' : 'var(--o-surface)',
                         color: bucket === b.key ? '#fff' : (b.tone === 'danger' ? '#b91c1c' : b.tone === 'warn' ? '#92400e' : 'var(--o-ink)') }}>
                {b.label} {counts[b.key] ? `(${counts[b.key]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="ol-wrap"><div className="ol-empty">
            <div className="ol-empty-title">No open deliveries</div>
            Everything created has been goods-issued.
          </div></div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head od-open">
              <div>Order</div>
              <div>Customer</div>
              <div className="od-hide-sm">Batch</div>
              <div className="od-hide-sm">Stage</div>
              <div className="num">Units</div>
              <div className="num od-hide-sm">Value</div>
              <div className="num">Age</div>
            </div>
            {paginated.map(r => {
              const red = r.days > 30, amber = r.days > 14
              return (
                <div key={r.id} className="ol-row ol-data od-open" onClick={() => navigate('/orders/' + r.order_id)}>
                  <div className="ol-cell"><div className="ol-num">{r.order.order_number}</div></div>
                  <div className="ol-cell ol-cust" title={r.order.customer_name}>{r.order.customer_name}</div>
                  <div className="ol-cell od-hide-sm">
                    <div className="ol-date">#{r.batch_no}</div>
                    {r.dc_number && <div className="ol-date-sub">{r.dc_number}</div>}
                  </div>
                  <div className="ol-cell od-hide-sm">
                    <div className="ol-date">{STATUS_LABEL[r.status] || r.status}</div>
                    {r.credit_checked === false && <div className="ol-date-sub" style={{ color:'#b91c1c', fontWeight:600 }}>credit not cleared</div>}
                  </div>
                  <div className="ol-cell ol-num" style={{ textAlign:'right', color:'var(--o-ink)' }}>{r.units}</div>
                  <div className="ol-cell ol-num od-hide-sm" style={{ textAlign:'right', color:'var(--o-ink)' }}>₹{Math.round(r.value).toLocaleString('en-IN')}</div>
                  <div className="ol-cell" style={{ textAlign:'right' }}>
                    <span style={{ fontFamily:"'Geist Mono', monospace", fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:5,
                                   background: red ? '#fef2f2' : amber ? '#fffbeb' : 'var(--o-bg-2)',
                                   color:      red ? '#b91c1c' : amber ? '#92400e' : 'var(--o-muted)' }}>
                      {r.days}d
                    </span>
                  </div>
                </div>
              )
            })}

            <div className="ol-foot">
              <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}</span>
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
          </div>
        )}
      </div>
    </Layout>
  )
}
