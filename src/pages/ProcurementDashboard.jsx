import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import { fetchActivePoCoveredQty, lineIsHandled, poSlaState, SLA_APPROVE_HOURS, SLA_PLACE_HOURS } from '../lib/coverage'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import TrendChart from '../components/TrendChart'
import '../styles/orders-redesign.css'
// .ph-bento / .ph-stat / .dash-vs — the shared language the rest of the app uses.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const PO_STATUS_LABELS = {
  draft:'Draft', pending_approval:'Pending Approval', approved:'Approved', placed:'Placed',
  acknowledged:'Acknowledged', partially_received:'Partial GRN', material_received:'Received',
  closed:'Closed', cancelled:'Cancelled',
}
const PO_STATUS_COLORS = {
  draft:'#94A3B8', pending_approval:'#F59E0B', approved:'#1a73e8', placed:'#0EA5E9',
  acknowledged:'#0F766E', partially_received:'#D97706', material_received:'#22C55E',
  closed:'#047857', cancelled:'#EF4444',
}
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const PIPELINE_KEYS = ['draft','pending_approval','approved','placed','acknowledged','partially_received','material_received','closed']

// KpiTile / KpiChart / a local pie StatusDonut lived at the bottom of this file. The
// bento above uses the shared <Stat/> and the pipeline is .dash-vs bars, so all three
// are gone. Their CSS stays in orders-redesign.css — other pages still render it.
export default function ProcurementDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [pos, setPos] = useState([])
  const [coOrders, setCoOrders] = useState([])
  const [pendingGrn, setPendingGrn] = useState(0)
  const [pendingInward, setPendingInward] = useState(0)
  // Value actually received per month, from procurement_received_by_month().
  // The receipt link is at LINE level (grn.po_id is NULL on 1,451 of 1,452 GRNs), so this
  // is a three-table join done once in the database rather than in the browser.
  const [receivedByMonth, setReceivedByMonth] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'ops'
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })

    const [posRes, grnCountRes, inwardCountRes] = await Promise.all([
      // PAGED. This was a plain select against PostgREST's 1000-row cap while the FY
      // holds 1,498 purchase orders — so this dashboard was built from 1,000 of them and
      // every figure on it (open POs, total value, the vendor ranking, the funnel, the
      // SLA scores) was understated by a third, silently. Same trap as the orders
      // dashboard's Total Order Value. The stable tiebreaker keeps paging deterministic.
      fetchAll((from, to) => sb.from('purchase_orders')
        .select('id,po_number,status,total_amount,vendor_name,order_id,created_at,submitted_at,approved_at,placed_at')
        .eq('is_test', false).gte('created_at', FY_START)
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(from, to)),
      sb.from('grn').select('id', { count:'exact', head:true }).in('status', ['draft','checking']).eq('is_test', false),
      sb.from('purchase_invoices').select('id', { count:'exact', head:true }).in('status', ['three_way_check','invoice_pending']).eq('is_test', false),
    ])
    if (posRes.error) console.error('Procurement PO load error:', posRes.error)
    if (posRes.truncated) console.warn('Procurement: hit fetch ceiling — figures may be short.')
    setPos(posRes.data || [])
    setPendingGrn(grnCountRes.count || 0)
    setPendingInward(inwardCountRes.count || 0)
    const { data: recv, error: recvErr } = await sb.rpc('procurement_received_by_month', { p_from: FY_START })
    if (recvErr) console.error('received-by-month:', recvErr.message)
    setReceivedByMonth(recv || [])

    const { data: coData } = await sb.from('orders')
      .select('id,order_number,customer_name,status,order_items(id,qty,total_price,cancelled_qty,dispatched_qty,stock_qty,procurement_source,line_status)')
      .eq('is_test', false).eq('order_type', 'CO')
      // Per-line coverage decides pending, not order status (see lib/coverage.js).
      .neq('status', 'pending')
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
    let coList = coData || []
    if (coList.length) {
      // Coverage by po_items.order_item_id (active POs only) — shared helper.
      const allItemIds = coList.flatMap(o => (o.order_items || []).map(oi => oi.id))
      const coveredSet = await fetchActivePoCoveredQty(allItemIds, false)  // dashboard is live-only
      coList = coList.map(o => {
        const activeItems = (o.order_items || []).filter(oi => (oi.line_status || 'active') === 'active')
        const total = activeItems.length
        const covered = activeItems.filter(oi => lineIsHandled(oi, coveredSet)).length
        return { ...o, _totalItems: total, _coveredItems: covered }
      }).filter(o => o._totalItems > 0 && o._coveredItems < o._totalItems)
    }
    setCoOrders(coList)
    setLoading(false)
  }

  const openPos = pos.filter(p => !['material_received','closed','cancelled'].includes(p.status))
  const pendingAppr = pos.filter(p => p.status === 'pending_approval')

  // ── PO turnaround SLA: approve in 24h, place in 48h ──
  // Two clocks with two different owners, so a slow approval is never counted
  // against the buyer. submitted_at only exists from 2026-08-05, so anything
  // approved before that measures from created_at and is flagged approximate.
  const slaScore = (() => {
    const HOUR = 3600000
    const within = (from, to, limit) => {
      if (!from || !to) return null
      return (new Date(to) - new Date(from)) / HOUR <= limit
    }
    const monthKey = (d) => { const x = new Date(d); return x.getFullYear() * 12 + x.getMonth() }
    const nowKey = monthKey(new Date())

    const bucket = (offset) => {
      const appr = [], plac = []
      for (const p of pos) {
        if (p.approved_at && monthKey(p.approved_at) === nowKey - offset) {
          const ok = within(p.submitted_at || p.created_at, p.approved_at, SLA_APPROVE_HOURS)
          if (ok !== null) appr.push(ok)
        }
        if (p.placed_at && p.approved_at && monthKey(p.placed_at) === nowKey - offset) {
          const ok = within(p.approved_at, p.placed_at, SLA_PLACE_HOURS)
          if (ok !== null) plac.push(ok)
        }
      }
      const pct = (a) => a.length ? Math.round(a.filter(Boolean).length / a.length * 100) : null
      return { approve: pct(appr), place: pct(plac), apprN: appr.length, placN: plac.length }
    }

    // Open breaches right now — the actionable half of the scorecard.
    const open = { approval: 0, placement: 0 }
    for (const p of pos) {
      const st = poSlaState(p)
      if (st?.breached) open[st.step === 'approval' ? 'approval' : 'placement']++
    }
    return { now: bucket(0), prev: bucket(1), open }
  })()

  const placedPos = pos.filter(p => ['placed','acknowledged'].includes(p.status))
  const partialPos = pos.filter(p => p.status === 'partially_received')
  const receivedPos = pos.filter(p => p.status === 'material_received')
  const closedPos = pos.filter(p => p.status === 'closed')
  // NOTE: the face value of open POs (sum of total_amount) is deliberately NOT shown
  // anywhere. It counts goods already received against partially-received POs, so it
  // always overstates what is actually outstanding. Use orderedTotal - receivedTotal.

  // Vendor leaderboard
  const vendorAgg = Object.values(pos.reduce((m, p) => {
    const k = p.vendor_name || '—'
    if (!m[k]) m[k] = { name: k, value: 0, count: 0 }
    m[k].value += (p.total_amount || 0)
    m[k].count++
    return m
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6)
  const vendorMax = vendorAgg[0]?.value || 1

  const funnel = PIPELINE_KEYS.map(k => ({
    id: k, label: PO_STATUS_LABELS[k], color: PO_STATUS_COLORS[k],
    count: pos.filter(p => p.status === k).length,
    // Value per stage. total_amount is the PO value used everywhere else on this page
    // (the vendor leaderboard, every list row) — same field, grouped.
    value: pos.filter(p => p.status === k).reduce((a, p) => a + (p.total_amount || 0), 0),
  })).filter(s => s.count > 0)

  // ── PCO vs PO ────────────────────────────────────────────────────────────────
  // The real type split, and it is NOT the po_type column: po_type reads 'SO' on all
  // 1,498 rows and distinguishes nothing. What separates them is order_id, which lines
  // up with the number prefix exactly — all 1,206 SSC/PCO… rows carry an order_id and
  // all 292 SSC/PO… rows do not. PCO = bought against a customer order; PO = bought for
  // stock. Stock buying is 19% of the count but 47% of the value, which nothing on this
  // page showed before.
  const isPco = p => !!p.order_id
  const pcoPos = pos.filter(isPco)
  const stockPos = pos.filter(p => !isPco(p))
  const pcoValue = pcoPos.reduce((a, p) => a + (p.total_amount || 0), 0)
  const stockValue = stockPos.reduce((a, p) => a + (p.total_amount || 0), 0)

  // Approved but not yet sent to the vendor — "pending to place".
  const toPlace = pos.filter(p => p.status === 'approved')
  const toPlacePco = toPlace.filter(isPco).length

  // Committed to vendors and not yet in: placed + acknowledged + partially received.
  // Partially-received is the bulk of it and had no tile at all before.
  const awaiting = pos.filter(p => ['placed','acknowledged','partially_received'].includes(p.status))

  const cancelledPos = pos.filter(p => p.status === 'cancelled')
  const cancelValue = cancelledPos.reduce((a, p) => a + (p.total_amount || 0), 0)
  const cancelPct = pos.length ? (cancelledPos.length / pos.length * 100) : 0

  // ── Ordered vs received, by month ────────────────────────────────────────────
  // Ordered = PO value by the month the PO was raised. Received = the RPC's figure,
  // which prices GRN lines through po_items with the nullif() guard (that column is zero
  // on every row). The two are NOT the same POs in the same month — goods ordered in
  // June arrive in July — which is the point of putting them on one axis.
  const orderedVsReceived = (() => {
    const m = new Map()
    const key = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}` }
    pos.forEach(p => {
      if (!p.created_at || p.status === 'cancelled') return
      const k = key(p.created_at)
      const e = m.get(k) || { ordered: 0, received: 0 }
      e.ordered += (p.total_amount || 0)
      m.set(k, e)
    })
    ;(receivedByMonth || []).forEach(r => {
      const k = key(r.month_start)
      const e = m.get(k) || { ordered: 0, received: 0 }
      e.received += Number(r.received_value) || 0
      m.set(k, e)
    })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ key: k, label: MONTH_SHORT[Number(k.slice(5, 7)) - 1], ...v }))
  })()
  const receivedTotal = orderedVsReceived.reduce((a, x) => a + x.received, 0)
  const orderedTotal = orderedVsReceived.reduce((a, x) => a + x.ordered, 0)

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()

  return (
    <Layout pageTitle="Procurement" pageKey="procurement">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            {/* "value" alone read as a contradiction against the anchor's ₹20.32 Cr Ordered.
                Both are right and they answer different questions, so each says which. */}
            {/* This said "₹14.11 Cr still open", the FACE VALUE of open POs — which
                includes ₹5.48 Cr of goods already delivered against those very POs
                (161 of them are partially received). It contradicted the anchor's
                ₹8.63 Cr yet-to-receive by exactly that double count. Both numbers now
                come from the same two variables, so they cannot drift apart. */}
            <div className="page-sub">Procurement · {openPos.length} open POs · {fmtCr(Math.max(0, orderedTotal - receivedTotal))} yet to receive</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/procurement/po')}>All POs</button>
            <button className="btn-primary" onClick={() => navigate('/procurement/po/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New PO
            </button>
          </div>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            {/* ── Bento ──────────────────────────────────────────────────────────
                Same composition as /orders and /people: five tiles, a tall column
                beside them, a wide anchor underneath carrying the chart. */}
            <div className="ph-bento">
              <Stat label="PCO · Against Orders" value={pcoPos.length}
                foot={<><b>{fmtCr(pcoValue)}</b> committed</>}
                onClick={() => navigate('/procurement/po')} />
              <Stat label="PO · Stock Purchase" value={stockPos.length}
                foot={<><b>{fmtCr(stockValue)}</b> committed</>}
                onClick={() => navigate('/procurement/po')} />
              <Stat label="Pending to Place" value={toPlace.length} warn={toPlace.length > 0}
                foot={<><b>{toPlacePco}</b> PCO · approved, not sent</>}
                onClick={() => navigate('/procurement/po')} />
              {/* A rupee figure here repeated the double count above, so this is the
                  PO COUNT with vendors; the honest outstanding value is on the anchor. */}
              <Stat label="Awaiting Receipt" value={awaiting.length}
                foot={<><b>{partialPos.length}</b> part received</>}
                onClick={() => navigate('/fc/grn')} />
              <Stat label="Cancelled Rate" value={`${cancelPct.toFixed(1)}%`}
                warn={cancelPct > 15}
                foot={<><b>{cancelledPos.length}</b> POs · {fmtCr(cancelValue)}</>}
                onClick={() => navigate('/procurement/po')} />

              {/* Anchor — ordered against received, the question this page exists to
                  answer. The gap between the lines is money committed but not yet in. */}
              <div className="ph-wide ph-anchor">
                <div className="ph-anchor-head">
                  <div>
                    <div className="ph-anchor-eyebrow">Ordered vs received · FY to date</div>
                    <div className="ph-anchor-v">{orderedTotal > 0 ? `${Math.round(receivedTotal / orderedTotal * 100)}%` : '—'}</div>
                    <div className="ph-anchor-sub">{fmtCr(receivedTotal)} received of {fmtCr(orderedTotal)} ordered · cancelled POs excluded</div>
                  </div>
                  <div className="ph-anchor-stats">
                    {/* Three different PO totals exist and all three are legitimate:
                        every PO raised (₹21.62 Cr), non-cancelled (₹20.32 Cr, this one),
                        and still-open (₹14.11 Cr, the header). Each label says which. */}
                    <div title="Every PO raised this FY except cancelled ones">
                      <div className="ph-as-l">Ordered</div><div className="ph-as-v">{fmtCr(orderedTotal)}</div></div>
                    <div title="Goods actually received, priced from GRN lines through po_items">
                      <div className="ph-as-l">Received</div><div className="ph-as-v">{fmtCr(receivedTotal)}</div></div>
                    {/* WAS "In transit" (placed+acknowledged+partially received PO value)
                        and "Part received". Both DOUBLE COUNTED: a partially-received PO
                        contributed its WHOLE value here while the part that had already
                        arrived was also inside Received. ₹5.40 Cr of the old ₹13.10 Cr was
                        counted twice, which is why the figures would not add up.
                        Yet to receive is the true complement: Ordered − Received. */}
                    <div title="Ordered minus received — value committed and not yet in">
                      <div className="ph-as-l">Yet to receive</div><div className="ph-as-v">{fmtCr(Math.max(0, orderedTotal - receivedTotal))}</div></div>
                    <div title="Approved but not yet sent to the vendor">
                      <div className="ph-as-l">To place</div><div className="ph-as-v">{toPlace.length}</div></div>
                    <div title="GRNs in draft or checking — goods in, not yet inspected">
                      <div className="ph-as-l">Pending GRN</div><div className="ph-as-v">{pendingGrn}</div></div>
                    {/* pendingInward is fetched in loadData; its old card was merged in here
                        rather than dropped, which would have left the query orphaned. */}
                    <div title="Purchase invoices in 3-way check or pending entry">
                      <div className="ph-as-l">Inward inv.</div><div className="ph-as-v">{pendingInward}</div></div>
                  </div>
                </div>
                {/* Ordered is grouped by the month the PO was RAISED; received by the
                    month the goods arrived. They are deliberately not the same POs —
                    June's orders land in July, and that lag is what the gap shows. */}
                <TrendChart
                  points={orderedVsReceived.map(x => ({ key: x.key, label: x.label, value: x.ordered }))}
                  compare={orderedVsReceived.map(x => ({ value: x.received }))}
                  labels={{ primary: 'Ordered', compare: 'Received' }}
                  fmt={v => fmtCr(v)} height={150} />
              </div>

              {/* Top Vendors — the tall column, same ranked-list shape as /orders. */}
              <div className="card ph-tall o-pipe">
                <div className="card-head">
                  <div><div className="card-eyebrow">FYTD · By PO value</div><div className="card-title">Top Vendors</div></div>
                  <span className="trend-pill mono">{vendorAgg.length}</span>
                </div>
                <div className="o-pipe-list">
                  {vendorAgg.length === 0 ? <div className="o-empty">No vendor activity yet</div> : vendorAgg.map((v, i) => (
                    <div key={v.name} className="o-pipe-row" onClick={() => navigate('/procurement/po')}
                      title={`${v.count} PO${v.count === 1 ? '' : 's'}`}>
                      <div className="o-pipe-top">
                        <span className="o-cust-rank mono">{i+1}</span>
                        <span className="o-pipe-name">{v.name}</span>
                        <span className="o-pipe-n mono">{fmtCr(v.value)}</span>
                      </div>
                      <div className="o-pipe-bar"><span style={{ width: `${(v.value/vendorMax)*100}%`, background: 'var(--ssc-blue)' }} /></div>
                      <div className="o-pipe-v mono">{v.count} PO{v.count === 1 ? '' : 's'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="o-mid o-mid-proc">
              <div className="proc-left">
              {/* SLA keeps its card, unchanged — poSlaState is the one place the clock
                  is judged and nothing here recomputes it. */}
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Performance · This month</div>
                    <div className="card-title">PO Turnaround SLA</div>
                  </div>
                  {(slaScore.open.approval + slaScore.open.placement) > 0 && (
                    <span className="trend-pill mono is-bad">
                      {slaScore.open.approval + slaScore.open.placement} past SLA
                    </span>
                  )}
                </div>
                <div className="proc-sla">
                  <SlaRow label={`Approved within ${SLA_APPROVE_HOURS}h`} owner="Approver"
                    pct={slaScore.now.approve} prev={slaScore.prev.approve} n={slaScore.now.apprN}
                    openBreaches={slaScore.open.approval} />
                  <SlaRow label={`Placed within ${SLA_PLACE_HOURS}h of approval`} owner="Placer"
                    pct={slaScore.now.place} prev={slaScore.prev.place} n={slaScore.now.placN}
                    openBreaches={slaScore.open.placement} last />
                </div>
              </div>

              {/* PCO vs PO — filled the gap under the SLA card rather than sitting on top
                  of the pipeline, which pushed the stage bars down. */}
              <div className="card proc-split-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">FYTD · By purchase reason</div>
                    <div className="card-title">PCO vs PO</div>
                  </div>
                  <span className="trend-pill mono">{pos.length}</span>
                </div>
                {/* Two 100% bars — one for count, one for value. The point is where they
                    DISAGREE: PCO is 81% of the POs but only 53% of the money, so a stock
                    buy is far larger individually. Two independent bars could not show
                    that; one shared 100% scale shows it at a glance.

                    The split is order_id — a PO carrying one was raised against a customer
                    order (SSC/PCO…), one without is a stock buy (SSC/PO…). po_type does
                    NOT say this; it reads 'SO' on all 1,498 rows. */}
                {pos.length > 0 && (() => {
                  const totalV = pcoValue + stockValue
                  const nPct = Math.round(pcoPos.length / pos.length * 100)
                  const vPct = totalV > 0 ? Math.round(pcoValue / totalV * 100) : 0
                  const avgPco = pcoPos.length ? pcoValue / pcoPos.length : 0
                  const avgStock = stockPos.length ? stockValue / stockPos.length : 0
                  const bar = (pct, a, b) => (
                    <div className="proc-blk">
                      <div className="proc-bar">
                        <span className="proc-bar-a" style={{ width: `${pct}%` }} />
                        <span className="proc-bar-b" style={{ width: `${100 - pct}%` }} />
                      </div>
                      <div className="proc-leg">
                        <span><i className="proc-dot is-a" />{a}</span>
                        <span>{b}<i className="proc-dot is-b" /></span>
                      </div>
                    </div>
                  )
                  return (
                    <div className="proc-split" onClick={() => navigate('/procurement/po')}>
                      <div className="proc-cap">By count · {pos.length} POs</div>
                      {bar(nPct, `PCO ${pcoPos.length} · ${nPct}%`, `${stockPos.length} · ${100 - nPct}% PO`)}
                      <div className="proc-cap">By value · {fmtCr(totalV)}</div>
                      {bar(vPct, `PCO ${fmtCr(pcoValue)}`, `${fmtCr(stockValue)} PO`)}
                      {avgPco > 0 && (
                        <div className="proc-note">
                          A stock PO averages <b>{(avgStock / avgPco).toFixed(1)}×</b> the value of an order-backed one
                        </div>
                      )}
                    </div>
                  )
                })()}

              </div>
              </div>

              <div className="proc-right">
              {/* PO Pipeline — the funnel and the "PO Mix" donut were two cards over the
                  same stages, one counting and one showing share. Merged: the bar is the
                  count, the rupee figure beside it is the value. Closed is excluded from
                  the scale — it is the terminal stage and dwarfs every live one, exactly
                  as delivered did on the orders pipeline. */}
              <div className="card o-pipe-wide">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Pipeline · By stage · excludes closed</div>
                    <div className="card-title">PO Pipeline</div>
                  </div>
                  <span className="trend-pill mono">{openPos.length} open</span>
                </div>
                {(() => {
                  const live = funnel.filter(f => f.id !== 'closed')
                  if (!live.length) return <div className="o-empty">No POs yet</div>
                  const max = Math.max(...live.map(x => x.count), 1)
                  return (
                    <div className="dash-vs">
                      {live.map(f => (
                        <div key={f.id} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/procurement/po')}>
                          <span className="dash-vs-l" title={f.label}>
                            <span className="o-pipe-dot" style={{ background: f.color }} />
                            <span className="o-pipe-w-l">{f.label}</span>
                          </span>
                          <span className="dash-vs-track">
                            <span style={{ width: `${(f.count / max) * 100}%`, background: f.color }} />
                          </span>
                          <span className="dash-vs-v">{f.count}<em className="o-pipe-w-v">{fmtCr(f.value)}</em></span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>

              <div className="card proc-list-card proc-recent">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">FYTD · Closed</div>
                  <div className="card-title">Recently Received</div>
                </div>
                <span className="trend-pill mono">{receivedPos.length} POs</span>
              </div>
              <div className="o-list">
                {receivedPos.length === 0 ? (
                  <div className="o-empty">No received POs yet</div>
                ) : receivedPos.slice(0, 8).map(o => (
                  <div key={o.id} className="o-list-row" onClick={() => navigate('/procurement/po/' + o.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="o-list-num" style={{ color: '#22C55E' }}>{o.po_number}</div>
                      <div className="o-list-cust">{o.vendor_name || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="o-list-val">{fmtCr(o.total_amount)}</div>
                      <span className="ol-status-pill" style={{ '--stage-color': PO_STATUS_COLORS.material_received, marginTop: 2 }}>
                        <span className="ol-status-dot"/>Received
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
              </div>
            </div>

            <div className="dash-row-3">
              {/* The SLA card moved up into .o-mid beside the pipeline. It was left here
                  too, so the page showed PO Turnaround SLA twice. This row is the three
                  action lists, which is what dash-row-3 is sized for. */}
              <ListCard title="Pending Approval" eyebrow="Action · Now" badge={`${pendingAppr.length} POs`} badgeColor="#B45309"
                items={pendingAppr.slice(0, 8)} emptyText="No POs pending approval"
                renderItem={(o) => ({ left: o.po_number, leftColor: '#B45309', sub: o.vendor_name || '—', right: fmtCr(o.total_amount), status: 'pending_approval' })}
                onClick={(o) => navigate('/procurement/po/' + o.id)}/>
              <ListCard title="CO Orders Need PO" eyebrow="Awaiting coverage" badge={`${coOrders.length} orders`} badgeColor="#1a73e8"
                items={coOrders.slice(0, 8)} emptyText="All CO orders fully covered"
                renderItem={(o) => ({ left: o.order_number, leftColor: '#1a73e8', sub: o.customer_name, right: `${o._coveredItems}/${o._totalItems}`, status: 'placed', label: 'covered' })}
                onClick={(o) => navigate('/procurement/po/new?order_id=' + o.id)}/>
              <ListCard title="Placed · Awaiting Delivery" eyebrow="Vendor · In transit" badge={`${placedPos.length} POs`} badgeColor="#0F766E"
                items={placedPos.slice(0, 8)} emptyText="No POs awaiting delivery"
                renderItem={(o) => ({ left: o.po_number, leftColor: '#0F766E', sub: o.vendor_name || '—', right: fmtCr(o.total_amount), status: o.status })}
                onClick={(o) => navigate('/procurement/po/' + o.id)}/>
            </div>

          </>
        )}
      </div>
    </Layout>
  )
}


// One SLA line: how we did this month, how that compares with last month, and
// how many are breaching RIGHT NOW. The open count is the actionable half —
// a percentage tells you the past, a breach count tells you what to chase.
function SlaRow({ label, owner, pct, prev, n, openBreaches, last }) {
  const good = pct != null && pct >= 90
  const delta = (pct != null && prev != null) ? pct - prev : null
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 0',
                  borderBottom: last ? 'none' : '1px solid var(--gray-100)' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color:'var(--gray-800)', fontWeight:500 }}>{label}</div>
        <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>
          {owner}{n ? ` · ${n} this month` : ' · none yet this month'}
          {openBreaches > 0 && <span style={{ color:'#B91C1C', fontWeight:600 }}> · {openBreaches} open past SLA</span>}
        </div>
      </div>
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div className="mono" style={{ fontSize:19, fontWeight:600,
             color: pct == null ? 'var(--gray-400)' : good ? '#15803d' : '#B45309' }}>
          {pct == null ? '—' : pct + '%'}
        </div>
        {delta != null && delta !== 0 && (
          <div style={{ fontSize:10.5, color: delta > 0 ? '#15803d' : '#B91C1C' }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} pts vs last month
          </div>
        )}
      </div>
    </div>
  )
}

function ListCard({ title, eyebrow, badge, badgeColor, items, emptyText, renderItem, onClick }) {
  return (
    <div className="card proc-list-card">
      <div className="card-head">
        <div>
          <div className="card-eyebrow">{eyebrow}</div>
          <div className="card-title">{title}</div>
        </div>
        <span className="trend-pill mono" style={{ color: badgeColor }}>{badge}</span>
      </div>
      <div className="o-list">
        {items.length === 0 ? (
          <div className="o-empty">{emptyText}</div>
        ) : items.map(item => {
          const r = renderItem(item)
          return (
            <div key={item.id} className="o-list-row" onClick={() => onClick(item)}>
              <div style={{ minWidth: 0 }}>
                <div className="o-list-num" style={{ color: r.leftColor }}>{r.left}</div>
                <div className="o-list-cust">{r.sub}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="o-list-val">{r.right}</div>
                <span className="ol-status-pill" style={{ '--stage-color': PO_STATUS_COLORS[r.status] || '#94A3B8', marginTop: 2 }}>
                  <span className="ol-status-dot"/>
                  {r.label || PO_STATUS_LABELS[r.status]}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

