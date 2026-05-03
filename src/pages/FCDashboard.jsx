import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const STATUS_LABELS = {
  delivery_created:'Delivery Created', picking:'Picking', packing:'Packing',
  pi_requested:'PI Requested', pi_generated:'PI Issued', pi_payment_pending:'PI Payment Pending',
  goods_issued:'Goods Issued', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
  invoice_generated:'Invoice Generated', delivery_ready:'Delivery Ready',
  eway_pending:'E-Way Pending', eway_generated:'E-Way Generated', dispatched_fc:'Delivered',
}
const STATUS_COLORS = {
  delivery_created:'#0F766E', picking:'#14B8A6', packing:'#0D9488',
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#15803D',
  eway_pending:'#84CC16', eway_generated:'#22C55E', dispatched_fc:'#047857',
}

const ACTION_STATUSES  = ['delivery_created','picking','packing']
const BILLING_STATUSES = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']
const PI_STATUSES      = ['pi_requested','pi_generated','pi_payment_pending']
const FC_ALL_STATUSES  = [...ACTION_STATUSES, ...PI_STATUSES, ...BILLING_STATUSES, 'invoice_generated','eway_generated','dispatched_fc']

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
  }

  async function loadOrders(fc) {
    setLoading(true)
    let q = sb.from('orders')
      .select('id,order_number,customer_name,status,fulfilment_center,credit_override,order_type,created_at,order_dispatches(id,batch_no,dc_number,pi_number,pi_required,status)')
      .in('status', FC_ALL_STATUSES)
      .gte('created_at', FY_START).eq('is_test', false)
      .order('updated_at', { ascending: false })
    if (fc) q = q.eq('fulfilment_center', fc)
    const { data } = await q
    setOrders(data || [])
    setLoading(false)
  }

  const actionOrders = orders.filter(o => ACTION_STATUSES.includes(o.status))
  const piOrders = orders.filter(o => PI_STATUSES.includes(o.status))
  const billingOrders = orders.filter(o => BILLING_STATUSES.includes(o.status))
  const readyOrders = orders.filter(o => o.status === 'invoice_generated')
  const ewayOrders = orders.filter(o => o.status === 'eway_generated')
  const delivered = orders.filter(o => o.status === 'dispatched_fc')
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
            <div className="kpi-row">
              <KpiTile variant="hero" tone="deep" label="Action Required" value={actionOrders.length} sub="picking · packing · dispatch" chart="bars" onClick={() => navigate('/fc/list')}/>
              <KpiTile variant="hero" tone="forest" label="Delivered FYTD" value={delivered.length} sub="completed orders" chart="bars" onClick={() => navigate('/fc/list')}/>
              <KpiTile variant="hero" tone="teal" label="With Billing" value={billingOrders.length + readyOrders.length} sub={`${readyOrders.length} delivery ready`} chart="line" onClick={() => navigate('/fc/list')}/>
              <KpiTile label="PI Phase" value={piOrders.length} sub="awaiting payment" accent={piOrders.length > 0 ? 'amber' : null} onClick={() => navigate('/fc/list')}/>
              <KpiTile label="Pending GRNs" value={pendingGrns} sub="awaiting inspection" accent={pendingGrns > 0 ? 'amber' : null} onClick={() => navigate('/fc/grn')}/>
            </div>

            <div className="o-anal" style={{ marginTop: 16 }}>
              <div className="card anal-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Pipeline · By Status</div>
                    <div className="card-title">Order Pipeline</div>
                  </div>
                  <span className="trend-pill mono">{inProgress} active</span>
                </div>
                <div className="funnel">
                  {funnel.length === 0 ? <div className="o-empty">No active orders</div> : funnel.map(s => {
                    const max = Math.max(...funnel.map(x => x.count))
                    return (
                      <div key={s.id} className="funnel-row">
                        <div className="funnel-label">
                          <span className="funnel-dot" style={{ background: s.color }}/>
                          <span className="funnel-name">{s.label}</span>
                        </div>
                        <div className="funnel-bar-wrap"><div className="funnel-bar" style={{ width: `${(s.count/max)*100}%`, background: s.color }}/></div>
                        <div className="funnel-val">{s.count}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card anal-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Distribution · By Stage</div>
                    <div className="card-title">Stage Mix</div>
                  </div>
                  <span className="trend-pill mono">{orders.length} total</span>
                </div>
                <StatusDonut groups={funnel} total={funnel.reduce((s,g) => s + g.count, 0)}/>
              </div>
            </div>

            <div className="dash-row-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
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
            </div>
          </div>
        ))}
      </div>
    </div>
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

function StatusDonut({ groups, total }) {
  if (!groups.length || !total) return <div className="donut-wrap"><div style={{ color:'var(--o-muted-2)', fontSize:12 }}>No data</div></div>
  const size = 130, r = size/2 - 8, inner = r - 18, cx = size/2, cy = size/2
  let angle = -Math.PI/2
  const arcs = groups.filter(s => s.count > 0).map(s => {
    const portion = s.count / total
    const next = angle + portion * 2 * Math.PI
    const large = portion > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle)
    const x1 = cx + r * Math.cos(next),  y1 = cy + r * Math.sin(next)
    const ix0 = cx + inner * Math.cos(angle), iy0 = cy + inner * Math.sin(angle)
    const ix1 = cx + inner * Math.cos(next),  iy1 = cy + inner * Math.sin(next)
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
    angle = next
    return { path, color: s.color, label: s.label, count: s.count, pct: Math.round(portion*100) }
  })
  return (
    <div className="donut-wrap">
      <svg width={size} height={size}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} opacity="0.92"/>)}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="600" fill="#0B1B30" fontFamily="Geist Mono, monospace" style={{ letterSpacing: '-0.02em' }}>{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="8" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">ACTIVE</text>
      </svg>
      <div className="donut-legend">
        {arcs.slice(0, 6).map((a, i) => (
          <div key={i} className="dlg-row">
            <span className="dlg-dot" style={{background: a.color}}/>
            <span className="dlg-name">{a.label}</span>
            <span className="dlg-pct mono">{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
