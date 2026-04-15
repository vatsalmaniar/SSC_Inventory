import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

const STATUSES = ['all', 'partial', 'pending', 'inv_check', 'inventory_check', 'dispatch', 'delivery_created', 'picking', 'packing', 'inflow', 'dispatched_fc', 'cancelled']

function isPartiallyDispatched(o) {
  const items = o.order_items || []
  return items.some(i => (i.dispatched_qty || 0) > 0) && items.some(i => i.qty > (i.dispatched_qty || 0))
}

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }


const FC_ACTIVE_STATUSES = ['delivery_created','picking','packing','pi_requested','pi_generated','pi_payment_pending','goods_issued','pending_billing','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_pending','eway_generated']

function statusLabel(s) {
  return {
    pending:              'Pending Review',
    inv_check:            'Inv. Check',
    inventory_check:      'Inventory Check',
    dispatch:             'Ready to Ship',
    partial_dispatch:     'Partially Shipped',
    gen_invoice:          'Delivery Created',
    delivery_created:     'Delivery Created',
    picking:              'Picking',
    packing:              'Packing',
    pi_requested:         'PI Requested',
    pi_generated:         'PI Issued',
    pi_payment_pending:   'PI Payment Pending',
    goods_issued:         'Goods Issued',
    pending_billing:      'Pending Billing',
    credit_check:         'Credit Check',
    goods_issue_posted:   'GI Posted',
    invoice_generated:    'Invoice Generated',
    delivery_ready:       'Delivery Ready',
    eway_pending:         'E-Way Pending',
    eway_generated:       'E-Way Generated',
    dispatched_fc:        'Delivered',
    cancelled:            'Cancelled',
    inflow:               'In FC/Sales Flow',
    all:                  'All',
  }[s] || s
}

export default function OpsOrders() {
  const navigate = useNavigate()
  const [user, setUser]           = useState({ name: '', avatar: '', role: '' })
  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('pending')
  const [detail, setDetail]       = useState(null)
  const [newStatus, setNewStatus] = useState('')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const [{ data: profile }] = await Promise.all([
      sb.from('profiles').select('name,role').eq('id', session.user.id).single(),
      loadOrders(),
    ])
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'ops'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    if (!['ops', 'admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, avatar, role })
  }

  async function loadOrders(silent) {
    if (!silent) setLoading(true)
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,account_owner,engineer_name,order_date,status,freight,order_items(id,qty,dispatched_qty,total_price)')
      .gte('created_at', FY_START).eq('is_test', false)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  function openDetail(order) {
    navigate('/orders/' + order.id)
  }

  async function saveStatus() {
    if (!detail) return
    setSaving(true)
    const { error } = await sb.from('orders')
      .update({ status: newStatus, notes: notes.trim(), updated_at: new Date().toISOString() })
      .eq('id', detail.id)
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    setSaving(false)
    setDetail(null)
    await loadOrders()
  }

  const filtered = filter === 'all' ? orders
    : filter === 'partial' ? orders.filter(isPartiallyDispatched)
    : filter === 'inflow'  ? orders.filter(o => FC_ACTIVE_STATUSES.includes(o.status))
    : orders.filter(o => o.status === filter)

  const counts = STATUSES.reduce((acc, s) => {
    acc[s] = s === 'all'    ? orders.length
           : s === 'partial' ? orders.filter(isPartiallyDispatched).length
           : s === 'inflow'  ? orders.filter(o => FC_ACTIVE_STATUSES.includes(o.status)).length
           : orders.filter(o => o.status === s).length
    return acc
  }, {})

  return (
    <Layout pageTitle="Manage Orders" pageKey="orders">
      <div className="orders-content" style={{ marginTop: 0, paddingTop: 20 }}>
        {/* Filter chips */}
        <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map(s => (
            <button key={s} className={'filter-chip' + (filter === s ? ' active' : '') + (s === 'partial' ? ' filter-chip-warn' : '')} onClick={() => setFilter(s)}>
              {s === 'partial' ? 'Partially Shipped' : statusLabel(s)} {counts[s] > 0 ? `(${counts[s]})` : ''}
            </button>
          ))}
          </div>
        </div>

        {loading ? (
          <div className="loading-state"><div className="loading-spin" />Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="orders-empty">
            <div className="orders-empty-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
              </svg>
            </div>
            <div className="orders-empty-title">No {filter === 'all' ? '' : filter} orders</div>
            <div className="orders-empty-sub">Nothing here right now.</div>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="orders-table-wrap">
              <table className="orders-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Customer</th>
                    <th>Account Owner</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(o => {
                    const total = (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
                    return (
                      <tr key={o.id} onClick={() => openDetail(o)}>
                        <td className="order-num-cell">{o.order_number}</td>
                        <td className="customer-cell">{o.customer_name}</td>
                        <td><OwnerChip name={o.account_owner || o.engineer_name} /></td>
                        <td>{fmt(o.order_date)}</td>
                        <td>
                          {(o.order_items || []).length}
                          {isPartiallyDispatched(o) && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                              {(o.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)} pending
                            </span>
                          )}
                        </td>
                        <td className="amount-cell">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                        <td className="status-cell">
                          {isPartiallyDispatched(o)
                            ? <span className="pill pill-partial">Partially Shipped</span>
                            : <span className={'pill pill-' + o.status}>{statusLabel(o.status)}</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            {filtered.map((o, i) => {
              const total = (o.order_items || []).reduce((s, r) => s + (r.total_price || 0), 0) + (o.freight || 0)
              return (
                <div key={o.id} className="order-card" style={{ animationDelay: i * 0.04 + 's' }} onClick={() => openDetail(o)}>
                  <div className="order-card-top">
                    <div>
                      <div className="order-num">{o.order_number}</div>
                      <div className="order-customer">{o.customer_name}</div>
                      <div className="ops-engineer">{o.engineer_name || '—'} · {fmt(o.order_date)}</div>
                    </div>
                    <span className={'pill pill-' + o.status}>{statusLabel(o.status)}</span>
                  </div>
                  <div className="order-card-bottom">
                    <span className="order-items-count">{(o.order_items || []).length} item{(o.order_items || []).length !== 1 ? 's' : ''}</span>
                    <span className="order-total">₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Order detail + status update modal */}

      {detail && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setDetail(null) }}>
          <div className="modal-sheet">
            <div className="modal-handle" />
            <div className="detail-header-band">
              <div className="detail-order-num">{detail.order_number} · {detail.order_type}</div>
              <div className="detail-customer-name">{detail.customer_name}</div>
              <div className="detail-meta">
                <span className="detail-meta-item">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <OwnerChip name={detail.account_owner || detail.engineer_name} />
                </span>
                <span className="detail-meta-item">{fmt(detail.order_date)}</span>
                <span className={'pill pill-' + detail.status} style={{marginLeft:4}}>{statusLabel(detail.status)}</span>
              </div>
            </div>

            <div className="detail-tabs">
              <div className="detail-tab active">Details</div>
              <div className="detail-tab" style={{color:'var(--gray-400)'}}>Items ({(detail.order_items||[]).length})</div>
            </div>

            <div className="modal-header" style={{paddingTop:8,paddingBottom:8}}>
              <div/>
              <button className="modal-close" onClick={() => setDetail(null)}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="detail-body">
              <div className="detail-section">
                <div className="detail-section-title">Order Info</div>
                <div className="detail-grid">
                  <div className="detail-field"><label>Account Owner</label><div className="val"><OwnerChip name={detail.account_owner || detail.engineer_name} /></div></div>
                  <div className="detail-field"><label>PO Number</label><div className="val">{detail.po_number || '—'}</div></div>
                  <div className="detail-field"><label>Order Date</label><div className="val">{fmt(detail.order_date)}</div></div>
                  <div className="detail-field"><label>Received Via</label><div className="val">{detail.received_via || '—'}</div></div>
                  <div className="detail-field"><label>GST</label><div className="val">{detail.customer_gst || '—'}</div></div>
                  <div className="detail-field"><label>Type</label><div className="val">{detail.order_type || '—'}</div></div>
                </div>
                {detail.dispatch_address && (
                  <div className="detail-field" style={{marginTop:8}}><label>Dispatch Address</label><div className="val">{detail.dispatch_address}</div></div>
                )}
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Items ({(detail.order_items||[]).length})</div>
                <div className="items-table-wrap">
                  <table className="items-table">
                    <thead><tr><th>#</th><th>Item Code</th><th>Qty</th><th>Unit Price</th><th>Total</th><th>Dispatch</th></tr></thead>
                    <tbody>
                      {(detail.order_items||[]).map(item => (
                        <tr key={item.id}>
                          <td style={{paddingLeft:10,color:'var(--gray-400)',fontSize:11}}>{item.sr_no}</td>
                          <td style={{fontFamily:'var(--mono)',fontWeight:500}}>{item.item_code}</td>
                          <td>{item.qty}</td>
                          <td>₹{item.unit_price_after_disc}</td>
                          <td style={{fontWeight:600}}>₹{item.total_price}</td>
                          <td>{item.dispatch_date ? fmt(item.dispatch_date) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="order-totals" style={{marginTop:8}}>
                  <div className="totals-row"><span>Subtotal</span><span>₹{(detail.order_items||[]).reduce((s,i)=>s+(i.total_price||0),0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  <div className="totals-row"><span>Freight</span><span>₹{(detail.freight||0).toLocaleString('en-IN')}</span></div>
                  <div className="totals-row grand"><span>Grand Total</span><span>₹{((detail.order_items||[]).reduce((s,i)=>s+(i.total_price||0),0)+(detail.freight||0)).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                </div>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Update Status</div>
                <select className="status-select" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="processing">Processing</option>
                  <option value="dispatched">Dispatched</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <textarea className="notes-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add notes for the sales team (optional)..." />
                <button className="save-status-btn" onClick={saveStatus} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Status'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
