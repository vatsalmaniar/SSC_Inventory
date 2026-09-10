import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { MO, FY_START } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import { ordersTotalValue, ordersDispatchedValue, orderNetValue, lineNetValue } from '../lib/orderValue'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import TrendChart from '../components/TrendChart'
import '../styles/orders-redesign.css'
// people-home.css owns .ph-bento / .ph-stat — the shared tile the People pages and the
// main dashboard use. Orders now draws from the same well instead of its own KpiTile.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

const STATUS_LABELS = {
  pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partly Shipped',
  inv_check:'Order Approved', inventory_check:'Inventory Check',
  delivery_created:'At FC', picking:'Picking', packing:'Packing',
  goods_issued:'Goods Issued', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
  invoice_generated:'Invoiced', delivery_ready:'Delivery Ready',
  eway_generated:'E-Way Done', dispatched_fc:'Delivered', cancelled:'Cancelled',
}

function statusGroup(s) {
  if (['pending'].includes(s)) return 'pending'
  if (['inv_check','inventory_check','dispatch'].includes(s)) return 'approved'
  if (s === 'partial_dispatch') return 'partial'  // own bucket — visibly pending work, not "approved"
  if (['delivery_created','picking','packing'].includes(s)) return 'fc'
  if (['goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','pi_requested','pi_generated','pi_payment_pending','pending_billing','eway_pending'].includes(s)) return 'billing'
  if (s === 'dispatched_fc' || s === 'closed') return 'delivered'  // closed = delivered part + cancelled remainder
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

const REP_PALETTE = ['#1a73e8','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function repColor(id) {
  if (!id) return '#94A3B8'
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff
  return REP_PALETTE[Math.abs(h) % REP_PALETTE.length]
}

function buildMonthlyData(orders) {
  const now = new Date()
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const months = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(fyStartYear, 3 + i, 1)
    months.push({
      label: MO[d.getMonth()],
      year: d.getFullYear(), month: d.getMonth(),
      ordered: 0, delivered: 0, orderedValue: 0, deliveredValue: 0,
    })
  }
  const curIdx = months.findIndex(m => m.year === now.getFullYear() && m.month === now.getMonth())
  orders.forEach(o => {
    const d = new Date(o.created_at)
    const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
    if (!slot) return
    slot.ordered++
    // ordersTotalValue semantics for ONE order: cancelled -> 0, SAMPLE -> 0,
    // partial cancels netted out. Summing total_price raw here counted
    // cancelled business as revenue.
    slot.orderedValue += (o.order_type === 'SAMPLE' ? 0 : orderNetValue(o))
    // Delivered = fully resolved with goods issued ('closed' = delivered part +
    // cancelled remainder). partial_dispatch is honestly NOT delivered.
    if (o.status === 'dispatched_fc' || o.status === 'closed') {
      slot.delivered++
      slot.deliveredValue += (o.order_type === 'SAMPLE' ? 0 : orderNetValue(o))
    }
  })
  months.forEach((m, i) => { m.isCurrent = i === curIdx; m.isFuture = curIdx >= 0 && i > curIdx })
  return months
}

export default function Orders() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState({ name: '', role: '', id: '' })
  const [orders, setOrders] = useState([])
  const [reps, setReps] = useState([])
  // Order ids that already have a sample_return GRN against them — the ONLY record
  // that a sample has physically come back. See sql/sample_return_tracking.sql.
  const [sampleReturned, setSampleReturned] = useState(() => new Set())
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (location.state?.success) {
      setSuccessMsg('Order ' + location.state.success + ' submitted successfully!')
      setTimeout(() => setSuccessMsg(''), 5000)
      window.history.replaceState({}, '')
    }
  }, [location.state])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    await loadData(profile?.role || 'sales', session.user.id)
  }

  async function loadData(role, uid) {
    setLoading(true)
    // Page past PostgREST's 1000-row cap — otherwise this dashboard's
    // Total Order Value under-reported (showed ~6.8 Cr of the true 9.2 Cr).
    const [ordersData, repsRes, retRes] = await Promise.all([
      fetchAll((from, to) => {
        let q = sb.from('orders')
          // sample_returnable added for the Sample Orders "to return" figure. One extra
          // column on the same query — no new request, no filter change.
          .select('id,order_number,customer_name,status,order_type,sample_returnable,created_at,created_by,order_items(qty,dispatched_qty,posted_qty,total_price,unit_price_after_disc,dispatch_date,cancelled_qty,line_status),order_dispatches(id,created_at,dispatched_items,status,delivered_at)')
          .gte('created_at', FY_START).eq('is_test', role === 'demo')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
        if (role === 'sales') q = q.eq('created_by', uid)
        return q.range(from, to)
      }),
      sb.from('profiles').select('id,name,role').in('role',['sales','admin','management']),
      // Paged: 18 rows today, but the cap is a silent truncation, not an error.
      fetchAll((from, to) => sb.from('grn').select('order_id')
        .eq('grn_type', 'sample_return').eq('is_test', false).order('id').range(from, to)),
    ])
    if (ordersData.error) console.error('Orders load error:', ordersData.error)
    if (ordersData.truncated) console.warn('Orders: hit fetch ceiling — consider server-side pagination.')
    if (retRes.error) console.error('sample returns load error:', retRes.error)
    setOrders(ordersData.data || [])
    setReps(repsRes.data || [])
    setSampleReturned(new Set((retRes.data || []).map(g => g.order_id).filter(Boolean)))
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  // Canonical "Total Order Value" — net goods, cancelled orders excluded, no
  // freight (shared with /orders/list so the two headline numbers agree).
  const totalValue = ordersTotalValue(orders)
  // Was: sum of dispatched_fc batch JSON — a later milestone than the boundary
  // the DB enforces, so it disagreed with the order page. Now the shared helper.
  const dispatchedValue = ordersDispatchedValue(orders)
  const pendingApproval = orders.filter(o => o.status === 'pending').length
  const activeOrders = orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length
  const todayDispatched = orders.filter(o => (o.order_dispatches || []).some(b => b.created_at?.slice(0,10) === today))
  // ⚠️ These two sum order_dispatches.dispatched_items — the batch JSON, which
  // is one of the three competing "dispatched value" formulas orderValue.js was
  // written to end (they differed by ~43 lakh). It also OVERSTATES: a full
  // dispatch writes every line at FULL ordered qty even when a line was partly
  // cancelled (see sql/dispatch_atomic_phase2.sql, "KNOWN PRE-EXISTING QUIRK").
  //
  // NOT changed with the rest of the /orders value fix (2026-09-01) because
  // orderDispatchedValue() is not a drop-in: it is order-level lifetime posted
  // value, whereas these are "what shipped TODAY, by batch date". Making them
  // canonical needs a definition first — flagged, not silently altered.
  const todayDispatchValue = todayDispatched.reduce((s, o) => {
    if (o.order_type === 'SAMPLE') return s
    const td = (o.order_dispatches || []).filter(b => b.created_at?.slice(0,10) === today)
    return s + td.reduce((bs, b) => bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)
  const todayDelivered = orders.filter(o => (o.order_dispatches || []).some(b => b.delivered_at?.slice(0,10) === today))
  const todayDeliveredValue = todayDelivered.reduce((s, o) => {
    if (o.order_type === 'SAMPLE') return s
    const td = (o.order_dispatches || []).filter(b => b.delivered_at?.slice(0,10) === today)
    return s + td.reduce((bs, b) => bs + (b.dispatched_items || []).reduce((is, i) => is + (i.total_price || 0), 0), 0)
  }, 0)
  const sampleOrders = orders.filter(o => o.order_type === 'SAMPLE')
  // Samples still out with a customer and expected back.
  //
  // ⚠️ READ THIS BEFORE TRUSTING THE NUMBER. sample_returnable records that a sample
  // is SUPPOSED to come back. Nothing in the database records that one HAS come back —
  // there is no returned flag, no return date and no table, in orders or anywhere else.
  // So this counts every returnable sample that reached the customer, whether or not it
  // is already sitting back on the shelf. It is an upper bound, and the tile says
  // "expected back" rather than "pending" for exactly that reason. Making it truthful
  // needs a place to record the return first.
  // Samples still physically out with a customer.
  //
  // ⚠️ THIS PREVIOUSLY OVERSTATED. It asked only "was this returnable, and did it reach
  // the customer" and never "did it come back", so a sample stayed counted forever. It
  // read 32 while 16 of those were already back on the shelf with a numbered return GRN
  // against them (SSC/SR0040 → SSC/GRN0477/GOD, SSC/SR0023 → SSC/GRN0642/KAV, and 14
  // more). The real figure is 20.
  //
  // The close signal is a sample_return GRN. There is NO "returned" flag on orders —
  // searching for one and not finding it is exactly how the wrong version got written.
  // "Out" is decided by an actual DELIVERY, not by order status. Testing
  // status in ('dispatched_fc','closed') misses samples sitting on
  // 'partial_dispatch' where part of the shipment was delivered and IS with the
  // customer — three of them today, including SSC/SR0004 (delivered 10 Apr, the
  // oldest outstanding sample in the company). Status is also what made this and
  // /fc disagree, 17 against 20. Same test on both pages now, and it is the same
  // basis the 30-day return clock uses in sql/sample_return_tracking.sql.
  const samplesToReturn = sampleOrders.filter(o =>
    o.sample_returnable !== false
    && (o.order_dispatches || []).some(d => d.delivered_at)
    && !sampleReturned.has(o.id))

  // Status pipeline counts + values
  const statusGroups = ['pending','approved','partial','fc','billing','delivered','cancelled'].map(g => {
    const list = orders.filter(o => statusGroup(o.status) === g)
    return {
      id: g,
      label: { pending:'Pending Approval', approved:'Approved · Ops', partial:'Partially Dispatched', fc:'At Fulfilment Centre', billing:'Billing / Accounts', delivered:'Delivered', cancelled:'Cancelled' }[g],
      count: list.length,
      // Canonical value, so the donut totals to the headline above it. The
      // 'cancelled' group therefore shows its COUNT with a value of 0 — a
      // cancelled order is not revenue. That is the point of the fix.
      value: ordersTotalValue(list),
      color: { pending:'#F59E0B', approved:'#1a73e8', partial:'#C2410C', fc:'#0F766E', billing:'#D97706', delivered:'#10B981', cancelled:'#EF4444' }[g],
    }
  }).filter(s => s.count > 0)
  const totalActiveCount = statusGroups.filter(s => s.id !== 'delivered' && s.id !== 'cancelled').reduce((a,b) => a+b.count, 0)

  // Sales reps leaderboard (orders placed by created_by)
  const repAgg = reps.map(r => {
    const own = orders.filter(o => o.created_by === r.id)
    return {
      id: r.id, name: r.name,
      count: own.length,
      // Was gross: a rep kept full credit for an order that was later cancelled.
      value: ordersTotalValue(own),
      color: repColor(r.id),
    }
  }).filter(r => r.count > 0).sort((a,b) => b.value - a.value)
  const repMax = Math.max(...repAgg.map(r => r.value), 1)

  // Top customers
  const customerAgg = Object.values(orders.reduce((m, o) => {
    const val = o.order_type === 'SAMPLE' ? 0 : orderNetValue(o)
    if (!m[o.customer_name]) m[o.customer_name] = { name: o.customer_name, value: 0, count: 0, last: o.created_at, delivered: 0 }
    m[o.customer_name].value += val
    m[o.customer_name].count++
    if (o.status === 'dispatched_fc') m[o.customer_name].delivered++
    if (o.created_at > m[o.customer_name].last) m[o.customer_name].last = o.created_at
    return m
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6)
  const custMax = customerAgg[0]?.value || 1

  const monthlyData = buildMonthlyData(orders)
  const fyOrdered = monthlyData.reduce((s,m) => s + m.ordered, 0)
  const fyDelivered = monthlyData.reduce((s,m) => s + m.delivered, 0)
  const fillRate = fyOrdered > 0 ? Math.round((fyDelivered / fyOrdered) * 100) : 0
  const fyCancelled = orders.filter(o => o.status === 'cancelled').length

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <Layout pageTitle="Orders" pageKey="orders">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">{new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} · {orders.length} orders FYTD · {fmtCr(totalValue)} value</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/orders/list')}>All Orders</button>
            {user.role !== 'ops' && user.role !== 'demo' && (
              <button className="btn-primary" onClick={() => navigate('/orders/new')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Order
              </button>
            )}
          </div>
        </div>

        {successMsg && (
          <div style={{ background:'#dcfce7', color:'#166534', padding:'10px 16px', borderRadius:9, fontSize:13, fontWeight:500, marginBottom:12 }}>✓ {successMsg}</div>
        )}

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            {/* ── Bento KPI row ─────────────────────────────────────────────────
                Same five figures the hero tiles carried, plus Fill Rate and Active
                Orders which were previously only subtext, promoted to tiles of their
                own. Every value and every navigation target is unchanged — this is
                the shared <Stat/> from components/StatTile.jsx, the tile the People
                pages and the main dashboard already use, so Orders stops being the
                one module with its own tile. */}
            {/* ── Bento ──────────────────────────────────────────────────────────
                The same composition /people uses: five tiles across the top, a tall
                card holding the full column beside them, and a wide anchor underneath.
                The previous pass put seven equal tiles in a flex row and then stacked
                three more card rows below — which is why it read as stacked boxes
                rather than a dashboard. Fill Rate and Active Orders are no longer
                tiles; they belong to the anchor, which is what an anchor is for. */}
            <div className="ph-bento">
              <Stat label="Total Order Value" value={fmtCr(totalValue)}
                foot={<><b>{orders.length}</b> orders FYTD</>}
                onClick={() => navigate('/orders/list')} />
              <Stat label="Dispatched · Lifetime" value={fmtCr(dispatchedValue)}
                foot={<><b>{fillRate}%</b> fill rate</>}
                onClick={() => navigate('/orders/list', { state: { filter: 'dispatched' } })} />
              <Stat label="Delivered Today" value={fmtCr(todayDeliveredValue)}
                foot={<><b>{todayDelivered.length}</b> order{todayDelivered.length === 1 ? '' : 's'}</>}
                onClick={() => navigate('/orders/list', { state: { filter: 'dispatched', timeline: 'today', dateMode: 'delivered_at' } })} />
              <Stat label="Dispatch Today" value={fmtCr(todayDispatchValue)}
                foot={<><b>{todayDispatched.length}</b> order{todayDispatched.length === 1 ? '' : 's'}</>}
                onClick={() => navigate('/dispatch/today')} />
              <Stat label="Pending Approval" value={pendingApproval} warn={pendingApproval > 0}
                foot={pendingApproval > 0 ? 'orders need review' : 'nothing waiting'}
                onClick={() => navigate('/ops')} />

              {/* Anchor — fill rate, the one number this page is really about, with the
                  counts that produce it. Absorbs the old Dispatch Efficiency card. */}
              <div className="ph-wide ph-anchor">
                <div className="ph-anchor-head">
                  <div>
                    <div className="ph-anchor-eyebrow">Dispatch efficiency · This FY</div>
                    <div className="ph-anchor-v">{fillRate}%</div>
                    <div className="ph-anchor-sub">{fyDelivered} of {fyOrdered} placed orders delivered</div>
                  </div>
                  <div className="ph-anchor-stats">
                    <div><div className="ph-as-l">Placed</div><div className="ph-as-v">{fyOrdered}</div></div>
                    <div><div className="ph-as-l">Delivered</div><div className="ph-as-v">{fyDelivered}</div></div>
                    {/* "Pending" used to sit here as placed − delivered − cancelled. That is
                        the SAME number as Active (3229 − 2585 − 78 = 566 = totalActiveCount),
                        so the card showed one figure under two labels. Active is the one the
                        pipeline below is counting, so it is the one that stays. */}
                    <div title="Placed, minus delivered, minus cancelled — cancelled orders will never deliver">
                      <div className="ph-as-l">Active</div><div className="ph-as-v">{totalActiveCount}</div></div>
                    <div><div className="ph-as-l">Cancelled</div><div className="ph-as-v">{fyCancelled}</div></div>
                  </div>
                </div>

                {/* The anchor is built to carry a chart under its headline — that is what
                    fills it on /people. Without one it was a card with a dead lower half.
                    Placed vs Delivered lives here now instead of in a card of its own. */}
                {(() => {
                  // Future months excluded, exactly as the old chart did — an empty March
                  // would otherwise drag the line to zero.
                  const active = monthlyData.filter(d => !d.isFuture)
                  return (
                    <TrendChart
                      points={active.map(d => ({ key: d.label + d.year, label: d.label, value: d.ordered,
                        note: d.isCurrent ? 'month in progress' : null }))}
                      compare={active.map(d => ({ value: d.delivered }))}
                      labels={{ primary: 'Placed', compare: 'Delivered' }}
                      fmt={v => `${v} order${v === 1 ? '' : 's'}`}
                      height={150} />
                  )
                })()}
              </div>

              {/* Pipeline — Order Pipeline and Order Mix were two cards over the SAME
                  seven statuses, one counting orders and one totalling their value.
                  Merged into one column: the bar is the count, the rupee figure beside
                  it is the value. Nothing is dropped, one card fewer to read. */}
              {/* Top Customers in the tall column. The six-column table it used to be
                  cannot live in a 300px slot, so it reads as a ranked list here: name,
                  value, and a bar against the biggest customer. Orders and Delivered
                  per customer move to the tooltip rather than being dropped. */}
              <div className="card ph-tall o-pipe">
                <div className="card-head">
                  <div><div className="card-eyebrow">FYTD · By order value</div><div className="card-title">Top Customers</div></div>
                  <span className="trend-pill mono">{customerAgg.length}</span>
                </div>
                <div className="o-pipe-list">
                  {customerAgg.length === 0 ? <div className="o-empty">No data yet</div> : customerAgg.map((c, i) => (
                    <div key={c.name} className="o-pipe-row" onClick={() => navigate('/orders/list')}
                      title={`${c.count} order${c.count === 1 ? '' : 's'} · ${c.delivered} delivered`}>
                      <div className="o-pipe-top">
                        <span className="o-cust-rank mono">{i+1}</span>
                        <span className="o-pipe-name">{c.name}</span>
                        <span className="o-pipe-n mono">{fmtCr(c.value)}</span>
                      </div>
                      <div className="o-pipe-bar"><span style={{ width: `${(c.value/custMax)*100}%`, background: 'var(--ssc-blue)' }} /></div>
                      <div className="o-pipe-v mono">{c.count} order{c.count === 1 ? '' : 's'} · {c.delivered} delivered</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Reps keep their panel; Order Pipeline takes the wide half beside it.
                o-mid-orders is what scopes the height rules below to THIS page: .o-mid and
                .rep-panel are also rendered by /people, and a stylesheet stays in the
                document after an SPA navigation, so an unqualified rule would follow the
                user there. */}
            <div className="o-mid o-mid-orders">
              <div className="rep-panel">
                <div className="rp-head">
                  <div className="rp-title">Sales Reps</div>
                  <div className="rp-sub">FYTD · By order value</div>
                </div>
                <div className="rp-list">
                  {repAgg.length === 0 ? (
                    <div className="o-empty">No rep activity yet</div>
                  ) : repAgg.map((r, i) => (
                    <div key={r.id} className="rp-row" onClick={() => navigate('/orders/list')}>
                      <div className="rp-rank">{i+1}</div>
                      <div className="rp-avatar" style={{ background: r.color }}>{initials(r.name)}</div>
                      <div className="rp-info">
                        <div className="rp-name">{r.name}{r.id === user.id && <span className="rp-you">YOU</span>}</div>
                        <div className="rp-bar"><div className="rp-fill" style={{ width: `${(r.value/repMax)*100}%`, background: r.color }}/></div>
                      </div>
                      <div className="rp-val">{fmtCr(r.value)}</div>
                    </div>
                  ))}
                </div>
                <div className="rp-foot">
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">ACTIVE REPS</div>
                    <div className="rp-foot-val">{repAgg.length}</div>
                  </div>
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">TOTAL VALUE</div>
                    <div className="rp-foot-val">{fmtCr(repAgg.reduce((s,r)=>s+r.value,0))}</div>
                  </div>
                </div>
              </div>

              {/* Order Pipeline takes the wide half, where the rows have room to show
                  the count and the value side by side rather than stacked.

                  DELIVERED IS EXCLUDED FROM THIS CHART, deliberately. It is the terminal
                  status and holds more orders than every live stage put together, so on a
                  shared scale it flattened all of them into slivers. This card is about
                  work still moving; the delivered total is on the anchor above and is the
                  second line on Placed vs Delivered. Cancelled stays — it is small, and
                  hiding it would understate what was lost. */}
              <div className="card o-pipe-wide">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Pipeline · By status · excludes delivered</div>
                    <div className="card-title">Order Pipeline</div>
                  </div>
                  <span className="trend-pill mono">{totalActiveCount} active</span>
                </div>
                {(() => {
                  const live = statusGroups.filter(s => s.id !== 'delivered')
                  if (!live.length) return <div className="o-empty">No orders yet</div>
                  const max = Math.max(...live.map(x => x.count), 1)
                  return (
                    <div className="dash-vs">
                      {live.map(s => (
                        <div key={s.id} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/orders/list')}>
                          {/* The label needs its own element to truncate in: a bare text
                              node inside a flex container cannot take text-overflow. */}
                          <span className="dash-vs-l" title={s.label}>
                            <span className="o-pipe-dot" style={{ background: s.color }} />
                            <span className="o-pipe-w-l">{s.label}</span>
                          </span>
                          <span className="dash-vs-track">
                            <span style={{ width: `${(s.count / max) * 100}%`, background: s.color }} />
                          </span>
                          <span className="dash-vs-v">{s.count}<em className="o-pipe-w-v">{fmtCr(s.value)}</em></span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>

            <div className="o-bottom">
              <div className="card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Today · Active</div>
                    <div className="card-title">Today's Dispatch</div>
                  </div>
                  <button className="btn-ghost o-head-btn" onClick={() => navigate('/dispatch/today')}>View plan</button>
                </div>
                <div className="o-list">
                  {todayDispatched.length === 0 ? (
                    <div className="o-empty">No dispatches scheduled today</div>
                  ) : todayDispatched.slice(0, 6).map(o => {
                    // Per LINE here, so lineNetValue — nets each line's cancelled qty.
                    const val = (o.order_items || []).filter(i => i.dispatch_date === today).reduce((s, i) => s + lineNetValue(i), 0)
                    return (
                      <div key={o.id} className="o-list-row" onClick={() => navigate('/orders/' + o.id)}>
                        <div style={{ minWidth: 0 }}>
                          <div className="o-list-num">{o.order_number}</div>
                          <div className="o-list-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="o-list-val">{fmtCr(val)}</div>
                          <span className={`o-list-status o-status-${statusGroup(o.status)}`}>{STATUS_LABELS[o.status]}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card o-sample-card" onClick={() => navigate('/orders/list', { state: { filter: 'sample' } })}>
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">FYTD · Sample issues</div>
                    <div className="card-title">Sample Orders</div>
                  </div>
                  <span className="trend-pill mono">{sampleOrders.length} total</span>
                </div>
                {/* Was a block of inline font-size/weight/colour declarations, which
                    the UI conventions forbid — these now read from the tokens. */}
                <div className="o-mini-stats">
                  <div className="o-mini">
                    <div className="o-mini-v">{sampleOrders.length}</div>
                    <div className="o-mini-l">SAMPLES</div>
                  </div>
                  <div className="o-mini">
                    {/* Must match the per-row values below it, which are orderNetValue. */}
                    <div className="o-mini-v">{fmtCr(sampleOrders.reduce((s, o) => s + orderNetValue(o), 0))}</div>
                    <div className="o-mini-l">VALUE</div>
                  </div>
                  <div className="o-mini" title="Returnable samples delivered to a customer with no sample_return GRN against them — physically still out. Policy: back within 30 days, 60-day hard cap.">
                    <div className={`o-mini-v${samplesToReturn.length > 0 ? ' is-warn' : ''}`}>{samplesToReturn.length}</div>
                    <div className="o-mini-l">STILL OUT</div>
                  </div>
                </div>
                <div className="o-list">
                  {sampleOrders.length === 0 ? (
                    <div className="o-empty">No sample orders yet</div>
                  ) : sampleOrders.slice(0, 5).map(o => {
                    // Must match the SAMPLES total above it, which is orderNetValue.
                    const val = orderNetValue(o)
                    return (
                      <div key={o.id} className="o-list-row" onClick={e => { e.stopPropagation(); navigate('/orders/' + o.id) }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="o-list-num is-sample">{o.order_number}</div>
                          <div className="o-list-cust">{o.customer_name}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="o-list-val">{fmtCr(val)}</div>
                          <span className={`o-list-status o-status-${statusGroup(o.status)}`}>{STATUS_LABELS[o.status]}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

// KpiTile / KpiChart lived here and are gone: the bento row above uses the shared
// <Stat/> instead. The class names they rendered (.kpi-tile, .kpi-hero, .kt-*) stay
// defined in orders-redesign.css because twelve other pages each keep their own
// local copy of this component and still render them.

// DispatchGauge and a local pie StatusDonut lived here.
// The gauge is now the shared components/StatusDonut (one ring definition in the
// app), and the pie is gone — the dashboard has no pie anywhere, which is what made
// this page still read as a different design. Order Mix is .dash-vs bars now.
// .donut-wrap / .dlg-* / .gauge-wrap / .gs-* stay in orders-redesign.css: other
// pages still render them.

// OrderVsDispatchChart lived here — a bespoke 150-line smooth chart with its own
// axis, hover and legend. Placed vs Delivered is now the shared TrendChart with a
// second series, so the app has one line-chart implementation instead of three.
// .stock-chart / .sc-* stay in orders-redesign.css: ProcurementForecast still uses them.
