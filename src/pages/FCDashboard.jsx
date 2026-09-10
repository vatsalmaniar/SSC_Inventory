import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import '../styles/orders-redesign.css'
// .ph-bento / .ph-stat / .dash-vs — the shared language the rest of the app uses.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

const STATUS_LABELS = {
  delivery_created:'Delivery Created', picking:'Picking', packing:'Packing',
  pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
  goods_issued:'Goods Issued', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
  invoice_generated:'Invoice Generated', delivery_ready:'Delivery Ready',
  eway_pending:'E-Way Pending', eway_generated:'E-Way Generated', dispatched_fc:'Delivered',
  // These two were missing, so the stuck-by-stage bars printed the raw column value
  // ("partial_dispatch", "closed") instead of a label.
  partial_dispatch:'Partly Shipped', closed:'Closed', cancelled:'Cancelled',
}
const STATUS_COLORS = {
  delivery_created:'#0F766E', picking:'#14B8A6', packing:'#0D9488',
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#15803D',
  eway_pending:'#84CC16', eway_generated:'#22C55E', dispatched_fc:'#047857',
  partial_dispatch:'#0EA5E9', closed:'#64748B', cancelled:'#EF4444',
}

const ACTION_STATUSES  = ['delivery_created','picking','packing']
const BILLING_STATUSES = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']
import { PI_STAGES as PI_STATUSES, TERMINAL_STATUSES } from '../lib/orderStatus'
const FC_ALL_STATUSES  = [...ACTION_STATUSES, ...PI_STATUSES, ...BILLING_STATUSES, 'invoice_generated','eway_generated','dispatched_fc','partial_dispatch','closed']

const PIPELINE_ORDER = [
  ['delivery_created','Delivery Created'],
  ['picking','Picking'],
  ['packing','Packing'],
  ['pi_requested','PI Phase'],
  ['goods_issued','With Billing'],
  ['invoice_generated','Delivery Ready'],
  ['eway_generated','E-Way / Dispatch'],
  ['dispatched_fc','Delivered'],
]

export default function FCDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', fc:'' })
  const [orders, setOrders] = useState([])
  const [pendingGrns, setPendingGrns] = useState(0)
  const [grnMix, setGrnMix] = useState([])       // grn_type -> count, this FY
  const [samples, setSamples] = useState(null)   // sample-return cycle, from sample_return GRNs
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'fc_kaveri'
    const fc = role === 'fc_kaveri' ? 'Kaveri' : role === 'fc_godawari' ? 'Godawari' : null
    if (!['fc_kaveri','fc_godawari','ops','admin','management','accounts','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role, fc })
    await loadOrders(fc)
    let grnQ = sb.from('grn').select('id', { count:'exact', head:true }).in('status', ['draft','checking']).eq('is_test', false)
    if (fc) grnQ = grnQ.eq('fulfilment_center', fc)
    const { count: grnCount } = await grnQ
    setPendingGrns(grnCount || 0)
    await loadGrnMix(fc)
    await loadSampleReturns(fc)
  }

  // GRN mix by type. po_inward is routine inward; sample_return, customer_rejection
  // and cancellation_return are the exception flows this page exists to surface.
  async function loadGrnMix(fc) {
    let q = sb.from('grn').select('grn_type,status').eq('is_test', false).gte('created_at', FY_START)
    if (fc) q = q.eq('fulfilment_center', fc)
    const { data, error } = await fetchAll((from, to) => q.order('id').range(from, to))
    if (error) { console.error('grn mix:', error.message); return }
    const m = {}
    ;(data || []).forEach(g => { const k = g.grn_type || 'unknown'; m[k] = (m[k] || 0) + 1 })
    setGrnMix(Object.entries(m).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n))
  }

  // Sample-return cycle. THE CLOSE SIGNAL IS A sample_return GRN — there is no
  // "returned" flag on orders, which is why a naive count of returnable samples
  // overstates what is actually still out. Policy (sql/sample_return_tracking.sql):
  // back within 30 days of delivery, 60-day hard cap.
  async function loadSampleReturns(fc) {
    let oq = sb.from('orders')
      .select('id,order_number,customer_name,order_dispatches(delivered_at)')
      .eq('order_type', 'SAMPLE').eq('is_test', false).eq('sample_returnable', true)
    if (fc) oq = oq.eq('fulfilment_center', fc)
    const [ordRes, grnRes] = await Promise.all([
      fetchAll((from, to) => oq.order('id').range(from, to)),
      fetchAll((from, to) => sb.from('grn').select('order_id')
        .eq('grn_type', 'sample_return').eq('is_test', false).order('id').range(from, to)),
    ])
    if (ordRes.error || grnRes.error) { console.error('sample returns:', (ordRes.error || grnRes.error).message); return }
    const returned = new Set((grnRes.data || []).map(g => g.order_id).filter(Boolean))
    const today = new Date()
    const out = []
    ;(ordRes.data || []).forEach(o => {
      const dates = (o.order_dispatches || []).map(d => d.delivered_at).filter(Boolean).sort()
      if (!dates.length) return                       // never delivered: not out yet
      if (returned.has(o.id)) return                  // closed by a sample_return GRN
      const days = Math.floor((today - new Date(dates[dates.length - 1])) / 86400000)
      out.push({ id: o.id, order_number: o.order_number, customer_name: o.customer_name, days })
    })
    out.sort((a, b) => b.days - a.days)
    setSamples({
      out,
      overdue: out.filter(x => x.days > 30).length,
      hardCap: out.filter(x => x.days > 60).length,
      returned: returned.size,
    })
  }

  async function loadOrders(fc) {
    setLoading(true)
    // Page past the 1000-row cap (1100+ FC-stage orders/FY).
    const { data, error, truncated } = await fetchAll((from, to) => {
      let q = sb.from('orders')
        .select('id,order_number,customer_name,status,fulfilment_center,credit_override,order_type,created_at,updated_at,order_dispatches(id,batch_no,dc_number,pi_number,pi_required,status,delivered_at)')
        .in('status', FC_ALL_STATUSES)
        .gte('created_at', FY_START).eq('is_test', false)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
      if (fc) q = q.eq('fulfilment_center', fc)
      return q.range(from, to)
    })
    if (error) console.error('FCDashboard load error:', error)
    if (truncated) console.warn('FCDashboard: hit fetch ceiling — consider server-side pagination.')
    setOrders(data || [])
    setLoading(false)
  }

  const actionOrders = orders.filter(o => ACTION_STATUSES.includes(o.status))
  const piOrders = orders.filter(o => PI_STATUSES.includes(o.status))
  const billingOrders = orders.filter(o => BILLING_STATUSES.includes(o.status))
  const readyOrders = orders.filter(o => o.status === 'invoice_generated')
  const ewayOrders = orders.filter(o => o.status === 'eway_generated')
  const delivered = orders.filter(o => o.status === 'dispatched_fc')
  // ── Stuck orders ─────────────────────────────────────────────────────────────
  // The thing this page is really for. An order sitting in an FC stage is work in
  // progress; one sitting there for a week is a problem nobody has noticed. Age is
  // measured from updated_at — the last time ANYTHING moved on the order — so a
  // stage that is being actively worked never counts as stuck.
  const STUCK_DAYS = 7
  const stuck = (() => {
    const now = Date.now()
    const rows = orders
      .filter(o => !TERMINAL_STATUSES.includes(o.status))
      .map(o => ({ ...o, _days: Math.floor((now - new Date(o.updated_at || o.created_at)) / 86400000) }))
      .filter(o => o._days >= STUCK_DAYS)
      .sort((a, b) => b._days - a._days)
    const byStage = {}
    rows.forEach(o => { byStage[o.status] = (byStage[o.status] || 0) + 1 })
    return { rows, byStage, oldest: rows[0]?._days || 0 }
  })()

  const inProgress = actionOrders.length + piOrders.length + billingOrders.length + readyOrders.length + ewayOrders.length

  // Status funnel buckets (use mapped grouping for cleaner display)
  const funnel = PIPELINE_ORDER.map(([key, label]) => {
    let list
    if (key === 'pi_requested') list = piOrders
    else if (key === 'goods_issued') list = billingOrders
    else if (key === 'invoice_generated') list = readyOrders
    else if (key === 'eway_generated') list = ewayOrders
    else list = orders.filter(o => o.status === key)
    return { id: key, label, color: STATUS_COLORS[key], count: list.length }
  }).filter(s => s.count > 0)

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()

  return (
    <Layout pageTitle="Fulfilment Centre" pageKey="fc">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">{user.fc ? `Fulfilment Centre — ${user.fc}` : 'All Fulfilment Centres'} · {orders.length} orders FYTD</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/fc/grn')}>GRNs</button>
            <button className="btn-primary" onClick={() => navigate('/fc/list')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8 L7 12 L13 4"/></svg>
              All Orders
            </button>
          </div>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            {/* ── Bento ──────────────────────────────────────────────────────────
                Same composition as /procurement and /orders: five tiles, a tall
                column beside them, a wide anchor underneath. */}
            <div className="ph-bento">
              <Stat label="Stuck Orders" value={stuck.rows.length} warn={stuck.rows.length > 0}
                foot={stuck.rows.length > 0
                  ? <>no movement in <b>{STUCK_DAYS}</b>+ days · oldest <b>{stuck.oldest}</b>d</>
                  : 'everything is moving'}
                onClick={() => navigate('/fc/list')} />
              <Stat label="Action Required" value={actionOrders.length}
                foot="picking · packing · dispatch" onClick={() => navigate('/fc/list')} />
              <Stat label="With Billing" value={billingOrders.length + readyOrders.length}
                foot={<><b>{readyOrders.length}</b> delivery ready</>} onClick={() => navigate('/fc/list')} />
              <Stat label="PI Phase" value={piOrders.length} warn={piOrders.length > 0}
                foot="awaiting payment" onClick={() => navigate('/fc/list')} />
              <Stat label="Pending GRNs" value={pendingGrns} warn={pendingGrns > 0}
                foot="awaiting inspection" onClick={() => navigate('/fc/grn')} />

              {/* Anchor — stuck orders by stage. A count says there is a problem;
                  the stage split says WHERE it is. */}
              <div className="ph-wide ph-anchor">
                <div className="ph-anchor-head">
                  <div>
                    <div className="ph-anchor-eyebrow">Stuck · no movement in {STUCK_DAYS}+ days</div>
                    <div className="ph-anchor-v">{stuck.rows.length}</div>
                    <div className="ph-anchor-sub">
                      of {orders.filter(o => !TERMINAL_STATUSES.includes(o.status)).length} in progress
                      {stuck.oldest > 0 ? ` · oldest ${stuck.oldest} days` : ''}
                    </div>
                  </div>
                  <div className="ph-anchor-stats">
                    <div><div className="ph-as-l">Delivered FYTD</div><div className="ph-as-v">{delivered.length}</div></div>
                    <div><div className="ph-as-l">In progress</div><div className="ph-as-v">{inProgress}</div></div>
                    <div title="Samples delivered and returnable with no sample_return GRN against them">
                      <div className="ph-as-l">Samples out</div><div className="ph-as-v">{samples ? samples.out.length : '—'}</div></div>
                    <div title="Past the 30-day return policy — sql/sample_return_tracking.sql">
                      <div className="ph-as-l">Past 30d</div><div className="ph-as-v">{samples ? samples.overdue : '—'}</div></div>
                    <div title="Past the 60-day hard cap — no further extension allowed">
                      <div className="ph-as-l">Past 60d cap</div><div className="ph-as-v">{samples ? samples.hardCap : '—'}</div></div>
                  </div>
                </div>
                {stuck.rows.length > 0 && (() => {
                  const rows = Object.entries(stuck.byStage).sort((a, b) => b[1] - a[1])
                  const max = Math.max(...rows.map(r => r[1]), 1)
                  return (
                    <div className="dash-vs">
                      {rows.map(([st, n]) => (
                        <div key={st} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/fc/list')}>
                          <span className="dash-vs-l" title={STATUS_LABELS[st] || st}>
                            <span className="o-pipe-dot" style={{ background: STATUS_COLORS[st] || '#94A3B8' }} />
                            <span className="o-pipe-w-l">{STATUS_LABELS[st] || st}</span>
                          </span>
                          <span className="dash-vs-track">
                            <span style={{ width: `${(n / max) * 100}%`, background: STATUS_COLORS[st] || '#94A3B8' }} />
                          </span>
                          <span className="dash-vs-v">{n}</span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>

              {/* Sample returns — the tall column. Each row is a sample physically out
                  with a customer, oldest first. Amber past 30 days, red past 60. */}
              <div className="card ph-tall o-pipe">
                <div className="card-head">
                  <div><div className="card-eyebrow">Out with customers</div><div className="card-title">Sample Returns</div></div>
                  <span className="trend-pill mono">{samples ? samples.out.length : '—'}</span>
                </div>
                <div className="o-pipe-list">
                  {!samples ? <div className="o-empty">Loading…</div>
                    : samples.out.length === 0 ? <div className="o-empty">Nothing outstanding</div>
                    : samples.out.map(x => (
                      <div key={x.id} className="o-pipe-row" onClick={() => navigate('/orders/' + x.id)}>
                        <div className="o-pipe-top">
                          <span className="o-pipe-dot" style={{ background: x.days > 60 ? '#EF4444' : x.days > 30 ? '#F59E0B' : '#10B981' }} />
                          <span className="o-pipe-name">{x.order_number}</span>
                          <span className="o-pipe-n mono">{x.days}d</span>
                        </div>
                        <div className="o-pipe-v mono">{x.customer_name}</div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="o-mid o-mid-proc">
              <div className="proc-left">
              {/* Inward & Returns moved in here: it was a full-width card floating
                  between the bento and the analytics row. */}
              {grnMix.length > 0 && (
                <div className="card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">FYTD · By GRN type</div>
                      <div className="card-title">Inward &amp; Returns</div>
                    </div>
                    <span className="trend-pill mono">{grnMix.reduce((a, g) => a + g.n, 0)}</span>
                  </div>
                  {(() => {
                    const LBL = { po_inward:'PO Inward', sample_return:'Sample Return',
                                  customer_rejection:'Customer Rejection', cancellation_return:'Cancellation Return' }
                    const CLR = { po_inward:'#1a73e8', sample_return:'#0F766E',
                                  customer_rejection:'#EF4444', cancellation_return:'#F59E0B' }
                    const max = Math.max(...grnMix.map(g => g.n), 1)
                    return (
                      <div className="dash-vs">
                        {grnMix.map(g => (
                          <div key={g.type} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/fc/grn')}>
                            <span className="dash-vs-l" title={LBL[g.type] || g.type}>
                              <span className="o-pipe-dot" style={{ background: CLR[g.type] || '#94A3B8' }} />
                              <span className="o-pipe-w-l">{LBL[g.type] || g.type}</span>
                            </span>
                            <span className="dash-vs-track">
                              <span style={{ width: `${(g.n / max) * 100}%`, background: CLR[g.type] || '#94A3B8' }} />
                            </span>
                            <span className="dash-vs-v">{g.n}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}
              </div>

              {/* Order Pipeline. "Stage Mix" was a second card over the SAME funnel data,
                  drawn as a pie — the one chart type that appears nowhere else in the app,
                  and the reason this page still looked foreign. Merged: the bar is the
                  count, the share follows it. */}
              <div className="card o-pipe-wide">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Pipeline · By status</div>
                    <div className="card-title">Order Pipeline</div>
                  </div>
                  <span className="trend-pill mono">{inProgress} active</span>
                </div>
                {funnel.length === 0 ? <div className="o-empty">No active orders</div> : (() => {
                  const total = funnel.reduce((a, f) => a + f.count, 0) || 1
                  const max = Math.max(...funnel.map(f => f.count), 1)
                  return (
                    <div className="dash-vs">
                      {funnel.map(f => (
                        <div key={f.id} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/fc/list')}>
                          <span className="dash-vs-l" title={f.label}>
                            <span className="o-pipe-dot" style={{ background: f.color }} />
                            <span className="o-pipe-w-l">{f.label}</span>
                          </span>
                          <span className="dash-vs-track">
                            <span style={{ width: `${(f.count / max) * 100}%`, background: f.color }} />
                          </span>
                          <span className="dash-vs-v">{f.count}<em className="o-pipe-w-v">{Math.round(f.count / total * 100)}%</em></span>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>
            </div>

            <div className="dash-row-3">
              <ListCard
                title="Action Required" eyebrow="FC operations · Now"
                badge={`${actionOrders.length} orders`} badgeColor="#0F766E"
                items={actionOrders.slice(0, 8)}
                emptyText="No pending FC action"
                onClick={(o) => navigate('/fc/' + o.id)}
              />
              <ListCard
                title="PI Phase" eyebrow="With Accounts"
                badge={`${piOrders.length} orders`} badgeColor="#B45309"
                items={piOrders.slice(0, 8)}
                emptyText="No PI orders pending"
                onClick={(o) => navigate('/fc/' + o.id)}
              />
              <ListCard
                title="Ready for Delivery" eyebrow="Invoiced · E-Way"
                badge={`${readyOrders.length + ewayOrders.length} orders`} badgeColor="#15803D"
                items={[...readyOrders, ...ewayOrders].slice(0, 8)}
                emptyText="No orders ready for delivery"
                onClick={(o) => navigate('/fc/' + o.id)}
              />
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">Completed · This FY</div>
                  <div className="card-title">Recently Delivered</div>
                </div>
                <span className="trend-pill mono">{delivered.length} delivered</span>
              </div>
              <div className="o-list">
                {delivered.length === 0 ? (
                  <div className="o-empty">No deliveries yet</div>
                ) : delivered.slice(0, 8).map(o => (
                  <div key={o.id} className="o-list-row" onClick={() => navigate('/fc/' + o.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="o-list-num" style={{ color: '#047857' }}>{o.order_number}</div>
                      <div className="o-list-cust">{o.customer_name}{o.fulfilment_center ? ` · ${o.fulfilment_center}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <StatusPill status={o.status}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || '#94A3B8'
  return (
    <span className="ol-status-pill" style={{ '--stage-color': color }}>
      <span className="ol-status-dot"/>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

function ListCard({ title, eyebrow, badge, badgeColor, items, emptyText, onClick }) {
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
        ) : items.map(o => (
          <div key={o.id} className="o-list-row" onClick={() => onClick(o)}>
            <div style={{ minWidth: 0 }}>
              <div className="o-list-num">{o.order_number}</div>
              <div className="o-list-cust">{o.customer_name}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <StatusPill status={o.status}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// KpiTile / KpiChart lived here — the bento above uses the shared <Stat/>.
// .kpi-tile / .kt-* stay in orders-redesign.css; other pages still render them.

// A local pie StatusDonut lived here. Order Pipeline carries the share now, and
// the app has no pie anywhere else. .donut-wrap / .dlg-* stay in
// orders-redesign.css — Billing, CRM and Procurement still render them.

