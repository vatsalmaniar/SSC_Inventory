import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/customer360.css'

const ORDER_STATUS = {
  pending:              { label: 'Pending Approval',    bg: '#fef3c7', color: '#92400e' },
  inv_check:            { label: 'Order Approved',      bg: '#dbeafe', color: '#1e40af' },
  inventory_check:      { label: 'Inventory Check',     bg: '#e0e7ff', color: '#3730a3' },
  dispatch:             { label: 'Ready to Ship',       bg: '#bfdbfe', color: '#1e40af' },
  partial_dispatch:     { label: 'Partially Shipped',   bg: '#ede9fe', color: '#5b21b6' },
  gen_invoice:          { label: 'Delivery Created',    bg: '#e0e7ff', color: '#3730a3' },
  delivery_created:     { label: 'Delivery Created',    bg: '#e0e7ff', color: '#3730a3' },
  picking:              { label: 'Picking',             bg: '#fef9c3', color: '#854d0e' },
  packing:              { label: 'Packing',             bg: '#fef9c3', color: '#854d0e' },
  pi_requested:         { label: 'PI Requested',        bg: '#fef9c3', color: '#854d0e' },
  pi_generated:         { label: 'PI Issued',           bg: '#fef9c3', color: '#854d0e' },
  pi_payment_pending:   { label: 'PI Payment Pending',  bg: '#fef9c3', color: '#854d0e' },
  goods_issued:         { label: 'Goods Issued',        bg: '#d1fae5', color: '#065f46' },
  pending_billing:      { label: 'Pending Billing',     bg: '#fef9c3', color: '#854d0e' },
  credit_check:         { label: 'Credit Check',        bg: '#fef3c7', color: '#92400e' },
  goods_issue_posted:   { label: 'GI Posted',           bg: '#d1fae5', color: '#065f46' },
  invoice_generated:    { label: 'Invoice Generated',   bg: '#dcfce7', color: '#166534' },
  delivery_ready:       { label: 'Delivery Ready',      bg: '#dcfce7', color: '#166534' },
  eway_pending:         { label: 'E-Way Pending',        bg: '#fef9c3', color: '#854d0e' },
  eway_generated:       { label: 'E-Way Generated',     bg: '#d1fae5', color: '#065f46' },
  dispatched_fc:        { label: 'Delivered',           bg: '#dcfce7', color: '#166534' },
  closed:               { label: 'Closed',              bg: '#f3f4f6', color: '#374151' },
  cancelled:            { label: 'Cancelled',           bg: '#fee2e2', color: '#991b1b' },
}

const PO_STATUS = {
  draft:                { label: 'Draft',                bg: '#f3f4f6', color: '#6b7280' },
  pending_approval:     { label: 'Pending Approval',     bg: '#fef3c7', color: '#92400e' },
  approved:             { label: 'Approved',             bg: '#dbeafe', color: '#1e40af' },
  placed:               { label: 'Placed',               bg: '#e0e7ff', color: '#3730a3' },
  acknowledged:         { label: 'Acknowledged',         bg: '#ede9fe', color: '#5b21b6' },
  delivery_confirmation:{ label: 'Delivery Confirmed',   bg: '#d1fae5', color: '#065f46' },
  material_received:    { label: 'Material Received',    bg: '#dcfce7', color: '#166534' },
  cancelled:            { label: 'Cancelled',            bg: '#fee2e2', color: '#991b1b' },
}

function StatusBadge({ status, map }) {
  const s = map[status] || { label: status || '—', bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function TypeBadge({ type }) {
  if (!type) return <span style={{ color: 'var(--gray-300)' }}>—</span>
  const ci = type === 'CI'
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: ci ? '#fff7ed' : '#eff6ff', color: ci ? '#c2410c' : '#1d4ed8' }}>
      {ci ? 'CI – Customised' : 'SI – Standard'}
    </span>
  )
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function inr(v) {
  if (v == null || v === '') return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export default function ItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [item, setItem]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('summary')
  const [orders, setOrders]     = useState([])
  const [pos, setPos]           = useState([])
  const [kpi, setKpi]           = useState({ totalOrders: 0, pendingOrders: 0, deliveredOrders: 0, totalPos: 0, pendingPos: 0, receivedPos: 0 })

  useEffect(() => { init() }, [id])

  async function init() {
    setLoading(true)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return } session = data.session }

    const { data: itemData } = await sb.from('items').select('*').eq('id', id).single()
    if (!itemData) { navigate('/items'); return }
    setItem(itemData)

    const [ordItemsRes, poItemsRes] = await Promise.all([
      sb.from('order_items')
        .select('id,qty,dispatched_qty,unit_price_after_disc,total_price,orders!inner(id,order_number,customer_name,order_date,status,is_test)')
        .eq('item_code', itemData.item_code)
        .eq('orders.is_test', false)
        .order('id', { ascending: false }),
      sb.from('po_items')
        .select('id,qty,received_qty,unit_price,total_price,purchase_orders!inner(id,po_number,vendor_name,po_date,status)')
        .eq('item_code', itemData.item_code)
        .order('id', { ascending: false }),
    ])

    const ordRows = ordItemsRes.data || []
    const poRows  = poItemsRes.data || []

    setOrders(ordRows)
    setPos(poRows)

    const deliveredStatuses = ['dispatched_fc', 'goods_issued', 'invoice_generated']
    const pendingOrdStatuses = ['pending', 'dispatch', 'partial_dispatch', 'delivery_created', 'picking', 'packing']

    const uniqueOrderIds = new Set(ordRows.map(r => r.orders?.id).filter(Boolean))
    const uniquePoIds    = new Set(poRows.map(r => r.purchase_orders?.id).filter(Boolean))

    const pendingOrders   = new Set(ordRows.filter(r => pendingOrdStatuses.includes(r.orders?.status)).map(r => r.orders?.id)).size
    const deliveredOrders = new Set(ordRows.filter(r => deliveredStatuses.includes(r.orders?.status)).map(r => r.orders?.id)).size
    const pendingPos      = new Set(poRows.filter(r => ['pending', 'placed', 'partial'].includes(r.purchase_orders?.status)).map(r => r.purchase_orders?.id)).size
    const receivedPos     = new Set(poRows.filter(r => r.purchase_orders?.status === 'received').map(r => r.purchase_orders?.id)).size

    setKpi({
      totalOrders:   uniqueOrderIds.size,
      pendingOrders,
      deliveredOrders,
      totalPos:      uniquePoIds.size,
      pendingPos,
      receivedPos,
    })

    setLoading(false)
  }

  if (loading) return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <div className="loading-state"><div className="loading-spin" /></div>
    </Layout>
  )

  if (!item) return null

  const TABS = [
    { key: 'summary',  label: 'Summary' },
    { key: 'orders',   label: `Order History (${kpi.totalOrders})` },
    { key: 'pos',      label: `PO History (${kpi.totalPos})` },
  ]

  return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <div className="c360-page">
        <div className="c360-body">

          {/* Back */}
          <button onClick={() => navigate('/items')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '6px 12px', border: '1px solid var(--gray-200)', borderRadius: 8, background: 'white', fontSize: 13, color: 'var(--gray-600)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
            Item 360
          </button>

          {/* Hero */}
          <div className="c360-hero" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div className="c360-hero-avatar" style={{ background: '#1a4dab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 26, height: 26 }}>
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 5 }}>{item.item_no}</span>
                  <TypeBadge type={item.type} />
                  {item.brand && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>{item.brand}</span>}
                  {item.category && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>{item.category}</span>}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-0.3px', wordBreak: 'break-all' }}>{item.item_code}</div>
                {(item.subcategory || item.series) && (
                  <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 3 }}>
                    {[item.subcategory, item.series].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </div>

            {/* KPI tiles */}
            <div className="c360-stats" style={{ marginTop: 16 }}>
              {[
                { label: 'Total Orders',     val: kpi.totalOrders,     color: '#1a4dab' },
                { label: 'Pending Orders',   val: kpi.pendingOrders,   color: '#92400e' },
                { label: 'Delivered Orders', val: kpi.deliveredOrders, color: '#166534' },
                { label: 'Total POs',        val: kpi.totalPos,        color: '#5b21b6' },
                { label: 'Pending POs',      val: kpi.pendingPos,      color: '#92400e' },
                { label: 'Received POs',     val: kpi.receivedPos,     color: '#166534' },
              ].map(k => (
                <div key={k.label} className="c360-stat">
                  <span className="c360-stat-label">{k.label}</span>
                  <span className="c360-stat-value" style={{ color: k.color }}>{k.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="c360-tabs" style={{ marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.key} className={'c360-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Summary Tab ── */}
          {tab === 'summary' && (
            <div className="c360-summary-grid">
              <div className="c360-card" style={{ padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>Item Details</div>
                <div className="c360-field-grid">
                  {[
                    { label: 'Item No',     val: <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{item.item_no || '—'}</span> },
                    { label: 'Item Code',   val: <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, wordBreak: 'break-all' }}>{item.item_code}</span> },
                    { label: 'Brand',       val: item.brand || '—' },
                    { label: 'Category',    val: item.category || '—' },
                    { label: 'Subcategory', val: item.subcategory || '—' },
                    { label: 'Series',      val: item.series || '—' },
                    { label: 'Type',        val: <TypeBadge type={item.type} /> },
                    { label: 'Added On',    val: fmt(item.created_at) },
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{f.label}</div>
                      <div style={{ fontSize: 13, color: 'var(--gray-800)' }}>{f.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="c360-card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Notes</div>
                  <div style={{ fontSize: 13, color: item.notes ? 'var(--gray-700)' : 'var(--gray-300)', lineHeight: 1.6, minHeight: 60 }}>
                    {item.notes || 'No notes added.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Order History Tab ── */}
          {tab === 'orders' && (
            <div className="c360-card">
              {orders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--gray-400)', fontSize: 13 }}>No orders found for this item.</div>
              ) : (
                <table className="od-items-table">
                  <thead>
                    <tr>
                      <th>Order #</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Qty Ordered</th>
                      <th style={{ textAlign: 'right' }}>Qty Dispatched</th>
                      <th style={{ textAlign: 'right' }}>Unit Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(r => (
                      <tr key={r.id} onClick={() => navigate('/orders/' + r.orders?.id)} style={{ cursor: 'pointer' }}>
                        <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#1a4dab' }}>{r.orders?.order_number || '—'}</span></td>
                        <td style={{ fontSize: 13 }}>{r.orders?.customer_name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.orders?.order_date)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.qty ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.dispatched_qty ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{inr(r.unit_price_after_disc)}</td>
                        <td><StatusBadge status={r.orders?.status} map={ORDER_STATUS} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                      <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({orders.length} rows)</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{orders.reduce((s, r) => s + (r.qty || 0), 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{orders.reduce((s, r) => s + (r.dispatched_qty || 0), 0)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* ── PO History Tab ── */}
          {tab === 'pos' && (
            <div className="c360-card">
              {pos.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--gray-400)', fontSize: 13 }}>No purchase orders found for this item.</div>
              ) : (
                <table className="od-items-table">
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Vendor</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Qty Received</th>
                      <th style={{ textAlign: 'right' }}>Unit Price</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pos.map(r => (
                      <tr key={r.id} onClick={() => navigate('/procurement/po/' + r.purchase_orders?.id)} style={{ cursor: 'pointer' }}>
                        <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#5b21b6' }}>{r.purchase_orders?.po_number || '—'}</span></td>
                        <td style={{ fontSize: 13 }}>{r.purchase_orders?.vendor_name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.purchase_orders?.po_date)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.qty ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.received_qty ?? '—'}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{inr(r.unit_price)}</td>
                        <td><StatusBadge status={r.purchase_orders?.status} map={PO_STATUS} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                      <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({pos.length} rows)</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{pos.reduce((s, r) => s + (r.qty || 0), 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{pos.reduce((s, r) => s + (r.received_qty || 0), 0)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

        </div>
      </div>
    </Layout>
  )
}
