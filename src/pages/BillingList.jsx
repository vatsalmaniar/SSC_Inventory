import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const BILLING_BATCH_STATUSES = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_generated','dispatched_fc']

const STATUS_LABELS = {
  pi_requested:'Issue PI', pi_generated:'PI Sent', pi_payment_pending:'PI Payment Pending',
  goods_issued:'Credit Check', credit_check:'GI Posted', goods_issue_posted:'Invoice Pending',
  invoice_generated:'Waiting for FC', delivery_ready:'E-Way Pending',
  eway_generated:'E-Way Done', dispatched_fc:'Delivered', cancelled:'Cancelled',
}
const STATUS_COLORS = {
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#0F766E',
  eway_generated:'#22C55E', dispatched_fc:'#047857', cancelled:'#EF4444',
}
function statusColor(s) { return STATUS_COLORS[s] || '#94A3B8' }
function effStatus(b) { return b.status || 'goods_issued' }

export default function BillingList() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('action')
  const [search, setSearch] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'accounts'
    if (!['accounts','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })
    await loadBatches()
  }

  async function loadBatches() {
    setLoading(true)
    const { data } = await sb.from('order_dispatches')
      .select('id, order_id, batch_no, dc_number, invoice_number, status, fulfilment_center, dispatched_items, credit_override, created_at, orders!inner(id, order_number, customer_name, order_type, order_date, status, is_test, credit_terms, freight, order_items(id, qty, dispatched_qty))')
      .in('status', BILLING_BATCH_STATUSES)
      .eq('orders.is_test', false)
      .neq('orders.order_type', 'SAMPLE')
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
    setBatches(data || [])
    setLoading(false)
  }

  const piStatuses = ['pi_requested','pi_generated','pi_payment_pending']
  const actionStatuses = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','goods_issue_posted','delivery_ready']
  const waitingStatuses = ['credit_check','invoice_generated','eway_generated']

  function matchFilter(b) {
    const s = effStatus(b)
    if (filter === 'action') return actionStatuses.includes(s)
    if (filter === 'pi') return piStatuses.includes(s)
    if (filter === 'waiting') return waitingStatuses.includes(s)
    if (filter === 'all') return s !== 'dispatched_fc'
    if (filter === 'dispatched_fc') return s === 'dispatched_fc'
    return s === filter
  }

  const counts = {
    action: batches.filter(b => actionStatuses.includes(effStatus(b))).length,
    pi: batches.filter(b => piStatuses.includes(effStatus(b))).length,
    waiting: batches.filter(b => waitingStatuses.includes(effStatus(b))).length,
    dispatched_fc: batches.filter(b => effStatus(b) === 'dispatched_fc').length,
  }
  const q = search.trim().toLowerCase()
  const filtered = batches.filter(matchFilter).filter(b =>
    !q || b.orders?.customer_name?.toLowerCase().includes(q) ||
    b.orders?.order_number?.toLowerCase().includes(q) ||
    (b.invoice_number || '').toLowerCase().includes(q) ||
    (b.dc_number || '').toLowerCase().includes(q)
  )
  const totalValue = filtered.reduce((s, b) => {
    const v = (b.dispatched_items || []).length
      ? b.dispatched_items.reduce((sum, i) => sum + (i.total_price || 0), 0)
      : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
    return s + v
  }, 0)
  const overrides = filtered.filter(b => b.credit_override).length

  const FILTERS = [
    { key: 'action',        label: 'Action Required' },
    { key: 'pi',            label: 'PI Stage', tone: 'warn' },
    { key: 'waiting',       label: 'Waiting' },
    { key: 'all',           label: 'All Active' },
    { key: 'dispatched_fc', label: 'Delivered' },
  ]

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
            <button className="btn-ghost" onClick={() => navigate('/billing')}>Dashboard</button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="Action Required" value={counts.action} sub="credit · invoice · e-way" chart="bars" onClick={() => setFilter('action')}/>
          <KpiTile variant="hero" tone="forest" label="Delivered" value={counts.dispatched_fc} sub={FY_LABEL} chart="bars" onClick={() => setFilter('dispatched_fc')}/>
          <KpiTile variant="hero" tone="teal" label="Total Active" value={counts.action + counts.waiting} sub="in pipeline" chart="line" onClick={() => setFilter('all')}/>
          <KpiTile label="PI Stage" value={counts.pi} sub="awaiting payment" accent={counts.pi > 0 ? 'amber' : null} onClick={() => setFilter('pi')}/>
          <KpiTile label="Waiting" value={counts.waiting} sub="GI · invoice · e-way" onClick={() => setFilter('waiting')}/>
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
            const count = key === 'all' ? counts.action + counts.waiting : counts[key]
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
              <div className="ol-table">
                {filtered.map(b => {
                  const s = effStatus(b)
                  const isCancelled = b.orders?.status === 'cancelled'
                  const isDelivered = s === 'dispatched_fc'
                  const hasInv = b.invoice_number && !b.invoice_number.startsWith('Temp/')
                  const batchVal = (b.dispatched_items || []).length
                    ? b.dispatched_items.reduce((sum, i) => sum + (i.total_price || 0), 0)
                    : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
                  const itemsCount = (b.dispatched_items || b.orders?.order_items || []).length
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
                          {STATUS_LABELS[stageKey] || stageKey}
                        </span>
                        {!isCancelled && b.credit_override && <span style={{ fontSize: 10, color: '#B91C1C', fontWeight: 600 }}>⚠ Override</span>}
                      </div>
                    </div>
                  )
                })}
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
