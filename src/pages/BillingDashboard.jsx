import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import '../styles/orders-redesign.css'
// .ph-bento / .ph-stat — the shared tile the rest of the app uses.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

const STATUS_LABELS = {
  pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
  goods_issued:'Credit Check', credit_check:'GI Posted', goods_issue_posted:'Invoice Pending',
  invoice_generated:'Invoice Generated', delivery_ready:'E-Way Pending',
  eway_generated:'E-Way Done', dispatched_fc:'Delivered',
}
const STATUS_COLORS = {
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#0F766E',
  eway_generated:'#22C55E', dispatched_fc:'#047857',
}

import { PI_STAGES as PI_STATUSES } from '../lib/orderStatus'
const BILLING_STATUSES = [...PI_STATUSES,'goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc','partial_dispatch','closed']
const PIPELINE_KEYS = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc']

export default function BillingDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [orders, setOrders] = useState([])
  const [purchaseInvCount, setPurchaseInvCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'accounts'
    if (!['accounts','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })
    setLoading(true)
    // Page past the 1000-row cap (1100+ billing-stage orders/FY).
    const { data, error, truncated } = await fetchAll((from, to) =>
      sb.from('orders')
        .select('id,order_number,customer_name,status,credit_override,order_type,created_at,order_dispatches(id,batch_no,invoice_number,pi_number,pi_required,credit_override)')
        .in('status', BILLING_STATUSES)
        .gte('created_at', FY_START).eq('is_test', false)
        .neq('order_type', 'SAMPLE')
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to)
    )
    if (error) console.error('BillingDashboard load error:', error)
    if (truncated) console.warn('BillingDashboard: hit fetch ceiling — consider server-side pagination.')
    setOrders(data || [])
    const { count: piCount } = await sb.from('purchase_invoices').select('id', { count:'exact', head:true }).in('status', ['three_way_check','invoice_pending']).eq('is_test', false).gte('created_at', FY_START)
    setPurchaseInvCount(piCount || 0)
    setLoading(false)
  }

  const piOrders = orders.filter(o => PI_STATUSES.includes(o.status))
  const creditCheckOrders = orders.filter(o => o.status === 'goods_issued')
  const giPostedOrders = orders.filter(o => o.status === 'credit_check')
  const invoiceOrders = orders.filter(o => o.status === 'goods_issue_posted')
  const waitingFCOrders = orders.filter(o => o.status === 'invoice_generated')
  const ewayOrders = orders.filter(o => o.status === 'delivery_ready')
  const ewayDoneOrders = orders.filter(o => o.status === 'eway_generated')
  const deliveredOrders = orders.filter(o => o.status === 'dispatched_fc')
  const overrideOrders = orders.filter(o => o.credit_override === true)
  const activeOrders = orders.filter(o => o.status !== 'dispatched_fc')

  const funnel = PIPELINE_KEYS.map(k => ({
    id: k, label: STATUS_LABELS[k], color: STATUS_COLORS[k],
    count: orders.filter(o => o.status === k).length,
  })).filter(s => s.count > 0)

  const actionNeeded = [...creditCheckOrders, ...piOrders.filter(o => o.status === 'pi_requested'), ...invoiceOrders, ...ewayOrders]

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()

  return (
    <Layout pageTitle="Billing" pageKey="billing">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">Billing & Accounts · {activeOrders.length} active · {deliveredOrders.length} delivered FYTD</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/procurement/invoices')}>Purchase Invoices</button>
            <button className="btn-primary" onClick={() => navigate('/billing/list')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8 L7 12 L13 4"/></svg>
              All Orders
            </button>
          </div>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            {/* KPI tiles — the shared <Stat/>. Same values, same targets. */}
            <div className="ph-bento o-bento-flat">
              <Stat label="Action Needed" value={actionNeeded.length} foot="credit · invoice · e-way"
                onClick={() => navigate('/billing/list')} />
              <Stat label="Delivered FYTD" value={deliveredOrders.length} foot="completed orders"
                onClick={() => navigate('/billing/list')} />
              <Stat label="PI Phase" value={piOrders.length}
                foot={<><b>{piOrders.filter(o=>o.status==='pi_requested').length}</b> to issue</>}
                onClick={() => navigate('/billing/list')} />
              <Stat label="On Hold" value={overrideOrders.length} warn={overrideOrders.length > 0}
                foot="credit — payment pending" onClick={() => navigate('/billing/list')} />
              <Stat label="Purchase Invoices" value={purchaseInvCount} warn={purchaseInvCount > 0}
                foot="awaiting match" onClick={() => navigate('/procurement/invoices')} />
            </div>

            {/* Billing Pipeline. "Stage Mix" was a second card over the SAME funnel
                data, drawn as a pie — the one chart type used nowhere else in the app.
                Merged: the bar is the count, the share follows it. */}
            <div className="card o-pipe-wide fc-grn-card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">Pipeline · By status</div>
                  <div className="card-title">Billing Pipeline</div>
                </div>
                <span className="trend-pill mono">{activeOrders.length} active</span>
              </div>
              {funnel.length === 0 ? <div className="o-empty">No orders in pipeline</div> : (() => {
                const total = funnel.reduce((a, f) => a + f.count, 0) || 1
                const max = Math.max(...funnel.map(f => f.count), 1)
                return (
                  <div className="dash-vs">
                    {funnel.map(f => (
                      <div key={f.id} className="dash-vs-row o-pipe-w-row" onClick={() => navigate('/billing/list')}>
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

            <div className="dash-row-3">
              <ListCard title="Action Needed" eyebrow="Credit · Invoice · E-Way" badge={`${actionNeeded.length} orders`} badgeColor="#B45309"
                items={actionNeeded.slice(0, 8)} emptyText="No pending billing actions"
                onClick={(o) => navigate('/billing/' + o.id)}/>
              <ListCard title="PI Orders" eyebrow="Awaiting Payment" badge={`${piOrders.length} orders`} badgeColor="#92400E"
                items={piOrders.slice(0, 8)} emptyText="No PI orders in progress"
                onClick={(o) => navigate('/billing/' + o.id)}/>
              <ListCard title="On Hold" eyebrow="Credit · Payment Pending" badge={`${overrideOrders.length} orders`} badgeColor="#B91C1C"
                items={overrideOrders.slice(0, 8)} emptyText="No orders on hold"
                onClick={(o) => navigate('/billing/' + o.id)}
                showOverride/>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">Awaiting FC / E-Way Done</div>
                  <div className="card-title">Pending Dispatch</div>
                </div>
                <span className="trend-pill mono">{waitingFCOrders.length + ewayDoneOrders.length} orders</span>
              </div>
              <div className="o-list">
                {(waitingFCOrders.length + ewayDoneOrders.length) === 0 ? (
                  <div className="o-empty">None at this stage</div>
                ) : [...waitingFCOrders, ...ewayDoneOrders].slice(0, 8).map(o => (
                  <div key={o.id} className="o-list-row" onClick={() => navigate('/billing/' + o.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="o-list-num" style={{ color: '#0F766E' }}>{o.order_number}</div>
                      <div className="o-list-cust">{o.customer_name}</div>
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

function ListCard({ title, eyebrow, badge, badgeColor, items, emptyText, onClick, showOverride }) {
  return (
    <div className="card">
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
              {showOverride && o.credit_override && <div style={{ fontSize: 10, color: '#B91C1C', fontWeight: 600, marginTop: 2 }}>On Hold</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// KpiTile / KpiChart lived here — the tiles above are the shared <Stat/>.
// .kpi-tile / .kt-* stay in orders-redesign.css; other pages still render them.

// A local pie StatusDonut lived here. Billing Pipeline carries the share now.
// .donut-wrap / .dlg-* stay in orders-redesign.css — CRM still renders them.

