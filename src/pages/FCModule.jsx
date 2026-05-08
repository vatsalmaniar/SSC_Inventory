import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const WITH_ACCOUNTS = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']

const STATUS_LABELS = {
  pi_requested:'Awaiting PI', pi_generated:'PI Sent', pi_payment_pending:'PI Payment Pending',
  delivery_created:'Picking', picking:'Packing', packing:'Goods Issue',
  goods_issued:'With Accounts', credit_check:'Credit Check', goods_issue_posted:'GI Posted',
  invoice_generated:'Delivery Ready', delivery_ready:'E-Way Pending',
  eway_generated:'Ready to Deliver', dispatched_fc:'Delivered',
  cancelled:'Cancelled', waiting:'With Accounts',
}
const STATUS_COLORS = {
  pi_requested:'#B45309', pi_generated:'#92400E', pi_payment_pending:'#78350F',
  delivery_created:'#0F766E', picking:'#14B8A6', packing:'#0D9488',
  goods_issued:'#D97706', credit_check:'#65A30D', goods_issue_posted:'#16A34A',
  invoice_generated:'#059669', delivery_ready:'#15803D',
  eway_pending:'#84CC16', eway_generated:'#22C55E', dispatched_fc:'#047857',
  cancelled:'#EF4444', waiting:'#D97706',
}
function statusColor(s) { return STATUS_COLORS[s] || '#94A3B8' }
function effStatus(b) { return b.status || 'delivery_created' }

export default function FCModule() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', center:'' })
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('action')
  const [search, setSearch] = useState('')
  const [showTest, setShowTest] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'fc_kaveri'
    const center = role === 'fc_godawari' ? 'Godawari' : role === 'fc_kaveri' ? 'Kaveri' : null
    if (!['fc_kaveri','fc_godawari','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role, center })
    await loadBatches(center)
  }

  async function loadBatches(center, testMode = false) {
    setLoading(true)
    let q = sb.from('order_dispatches')
      .select('id, order_id, batch_no, dc_number, invoice_number, status, fulfilment_center, dispatched_items, created_at, orders!inner(id, order_number, customer_name, order_type, order_date, status, is_test, freight, order_items(id, qty, dispatched_qty))')
      .eq('orders.is_test', testMode)
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
      .limit(500)
    if (center) q = q.eq('fulfilment_center', center)
    q = q.not('status', 'in', '(pi_requested,pi_generated,pi_payment_pending)')
    const { data } = await q
    setBatches(data || [])
    setLoading(false)
  }

  const actionStatuses = ['delivery_created','picking','packing','invoice_generated','eway_generated']
  const waitStatuses = WITH_ACCOUNTS

  function matchFilter(b) {
    const s = effStatus(b)
    if (filter === 'all') return actionStatuses.includes(s) || waitStatuses.includes(s)
    if (filter === 'action') return actionStatuses.includes(s)
    if (filter === 'waiting') return waitStatuses.includes(s)
    if (filter === 'dispatched_fc') return s === 'dispatched_fc'
    return s === filter
  }

  const counts = {
    action: batches.filter(b => actionStatuses.includes(effStatus(b))).length,
    waiting: batches.filter(b => waitStatuses.includes(effStatus(b))).length,
    dispatched_fc: batches.filter(b => effStatus(b) === 'dispatched_fc').length,
  }
  const q = search.trim().toLowerCase()
  const filtered = batches.filter(matchFilter).filter(b =>
    !q || b.orders?.customer_name?.toLowerCase().includes(q) ||
    b.orders?.order_number?.toLowerCase().includes(q) ||
    b.dc_number?.toLowerCase().includes(q)
  )
  const totalActive = counts.action + counts.waiting
  const totalValue = filtered.reduce((s, b) => {
    const v = (b.dispatched_items || []).length
      ? (b.dispatched_items).reduce((sum, i) => sum + (i.total_price || 0), 0)
      : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
    return s + v
  }, 0)

  const FILTERS = [
    { key: 'action',        label: 'Action Required' },
    { key: 'waiting',       label: 'With Accounts', tone: 'warn' },
    { key: 'all',           label: 'All Active' },
    { key: 'dispatched_fc', label: 'Delivered' },
  ]
  const centerLabel = user.center ? ` — ${user.center}` : ''

  return (
    <Layout pageTitle="Fulfilment Center" pageKey="fc">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Fulfilment Centre{centerLabel}</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> batches</span>
              {totalValue > 0 && (<><span className="o-sep">·</span><span><b>₹{(totalValue/1e5).toFixed(2)}L</b> value</span></>)}
              <span className="o-sep">·</span><span>{FY_LABEL}</span>
            </div>
          </div>
          <div className="page-meta">
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadBatches(user.center, e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <button className="btn-ghost" onClick={() => navigate('/fc/grn')}>GRNs</button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="Action Required" value={counts.action} sub="needs FC action" chart="bars" onClick={() => setFilter('action')}/>
          <KpiTile variant="hero" tone="forest" label="Total Active" value={totalActive} sub="in pipeline" chart="line" onClick={() => setFilter('all')}/>
          <KpiTile variant="hero" tone="teal" label="Delivered" value={counts.dispatched_fc} sub={`dispatched ${FY_LABEL}`} chart="bars" onClick={() => setFilter('dispatched_fc')}/>
          <KpiTile label="With Accounts" value={counts.waiting} sub="with billing team" accent={counts.waiting > 0 ? 'amber' : null} onClick={() => setFilter('waiting')}/>
          <KpiTile label="This Filter" value={filtered.length} sub="matching batches"/>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search DC, order, customer…" value={search} onChange={e => setSearch(e.target.value)}/>
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
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 110px 100px minmax(0, 1fr) auto 130px' }}>
              <div>DC #</div>
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
                <div className="ol-empty-title">No batches here</div>
                <div style={{ fontSize:13, color:'var(--o-muted)' }}>Nothing to action right now.</div>
              </div>
            ) : (
              <div className="ol-table">
                {filtered.map(b => {
                  const s = effStatus(b)
                  const isCancelled = b.orders?.status === 'cancelled'
                  const isDelivered = s === 'dispatched_fc'
                  const isWaiting = WITH_ACCOUNTS.includes(s)
                  const isTempDC = b.dc_number?.startsWith('Temp/')
                  const batchVal = (b.dispatched_items || []).length
                    ? (b.dispatched_items).reduce((sum, i) => sum + (i.total_price || 0), 0)
                    : (b.orders?.order_items || []).reduce((sum, i) => sum + (i.total_price || 0), 0)
                  const itemsCount = (b.dispatched_items || b.orders?.order_items || []).length
                  const stageKey = isCancelled ? 'cancelled' : isWaiting ? 'waiting' : s
                  return (
                    <div key={b.id} className="ol-row ol-data" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 110px 100px minmax(0, 1fr) auto 130px' }} onClick={() => navigate('/fc/' + b.order_id, { state: { dispatch_id: b.id } })}>
                      <div className="ol-cell">
                        <div className="ol-num" style={{ color: isTempDC ? '#92400e' : isDelivered ? '#047857' : 'var(--ssc-blue)' }}>{b.dc_number || '—'}</div>
                        {b.batch_no > 1 && <span className="ol-sample-tag">Batch {b.batch_no}</span>}
                      </div>
                      <div className="ol-cell ol-cust" title={b.orders?.customer_name}>{b.orders?.customer_name}</div>
                      <div className="ol-cell ol-date">{b.orders?.fulfilment_center || '—'}</div>
                      <div className="ol-cell ol-date">{fmt(b.created_at)}</div>
                      <div className="ol-cell ol-date" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5, color: 'var(--o-muted)' }}>{b.orders?.order_number}</div>
                      <div className="ol-numgroup">
                        <div className="ol-items">{itemsCount}</div>
                        <div className="ol-val">₹{batchVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                      </div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': statusColor(stageKey) }}>
                          <span className="ol-status-dot"/>
                          {STATUS_LABELS[stageKey] || stageKey}
                        </span>
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
