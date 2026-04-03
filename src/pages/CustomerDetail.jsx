import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear()
}
function fmtINR(v) {
  if (!v && v !== 0) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function statusBadgeClass(s) {
  if (['pending','inv_check'].includes(s)) return 'pending'
  if (s === 'cancelled') return 'cancelled'
  if (['dispatched_fc','delivered'].includes(s)) return 'delivered'
  return 'active'
}

function statusLabel(s) {
  const map = {
    pending: 'Pending', inv_check: 'Approved', inventory_check: 'Inv. Check',
    dispatch: 'Ready to Ship', delivery_created: 'At FC', picking: 'Picking',
    packing: 'Packing', goods_issued: 'Goods Issued', pending_billing: 'Pending Billing',
    credit_check: 'Credit Check', invoice_generated: 'Invoiced', delivery_ready: 'Delivery Ready',
    eway_pending: 'E-Way Pending', eway_generated: 'E-Way Done', dispatched_fc: 'Dispatched',
    delivered: 'Delivered', cancelled: 'Cancelled',
  }
  return map[s] || s?.replace(/_/g, ' ')
}

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [customer, setCustomer] = useState(null)
  const [orders, setOrders]     = useState([])
  const [reps, setReps]         = useState([])
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading]   = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]     = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || '')

    const [custRes, ordersRes, repsRes] = await Promise.all([
      sb.from('customers').select('*').eq('id', id).single(),
      sb.from('orders').select('id,order_number,customer_name,status,order_type,grand_total,created_at,is_test,po_number').eq('is_test', false).order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role', ['sales','ops','admin']).order('name'),
    ])
    setReps(repsRes.data || [])

    if (!custRes.data) { navigate('/customers'); return }
    setCustomer(custRes.data)
    setEditData(custRes.data)
    // Match by customer_name since orders don't FK to customers table
    setOrders((ordersRes.data || []).filter(o => o.customer_name?.toLowerCase() === custRes.data.customer_name?.toLowerCase()))
    setLoading(false)
  }

  async function save() {
    setSaving(true)
    const { error } = await sb.from('customers').update({
      customer_name:   editData.customer_name,
      gst:             editData.gst || null,
      pan_card_no:     editData.pan_card_no || null,
      msme_no:         editData.msme_no || null,
      billing_address: editData.billing_address || null,
      shipping_address:editData.shipping_address || null,
      credit_terms:    editData.credit_terms || null,
      account_status:  editData.account_status || null,
      account_owner:   editData.account_owner || null,
      industry:        editData.industry || null,
      location:        editData.location || null,
      poc_name:        editData.poc_name || null,
      poc_no:          editData.poc_no || null,
      poc_email:       editData.poc_email || null,
      director_name:   editData.director_name || null,
      director_no:     editData.director_no || null,
      director_email:  editData.director_email || null,
    }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setCustomer(p => ({ ...p, ...editData }))
    setEditMode(false); setSaving(false)
  }

  if (loading) return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="od-page"><div className="od-body" style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:300,gap:10,color:'var(--gray-400)'}}>
        <div className="loading-spin"/>Loading...
      </div></div>
    </Layout>
  )
  if (!customer) return null

  const activeOrders    = orders.filter(o => !['cancelled','delivered','dispatched_fc'].includes(o.status))
  const completedOrders = orders.filter(o => ['delivered','dispatched_fc'].includes(o.status))
  const totalRevenue    = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.grand_total || 0), 0)
  const initials        = customer.customer_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="od-page">
        <div className="od-body">

          {/* ── Header ── */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">
                  <span>Customer Account</span>
                  {customer.account_status && (
                    <span className={'od-status-badge ' + (customer.account_status === 'Active' ? 'active' : customer.account_status === 'Blacklisted' ? 'cancelled' : 'pending')}>{customer.account_status}</span>
                  )}
                  {customer.credit_terms && (
                    <span className="od-status-badge active">{customer.credit_terms}</span>
                  )}
                </div>
                <div className="od-header-title">{customer.customer_name}</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                  {customer.gst && <div className="od-header-num" style={{ margin: 0 }}>GST: {customer.gst}</div>}
                  {customer.industry && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{customer.industry}</div>}
                  {customer.location && <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{customer.location}</div>}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/customers')}>← Back</button>
                {userRole === 'admin' && (
                  !editMode
                    ? <button className="od-btn od-btn-outline" onClick={() => setEditMode(true)}>Edit</button>
                    : <>
                        <button className="od-btn od-btn-outline" onClick={() => { setEditMode(false); setEditData(customer) }}>Cancel</button>
                        <button className="od-btn od-btn-approve" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      </>
                )}
              </div>
            </div>
          </div>

          {/* ── Layout ── */}
          <div className="od-layout">

            {/* ── Main column ── */}
            <div className="od-main">

              {/* Account Details */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Account Details</div>
                </div>
                <div className="od-card-body">
                  {editMode ? (
                    <div className="od-edit-form">
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 8 }}>Account Info</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Customer Name</label>
                          <input value={editData.customer_name || ''} onChange={e => setEditData(p => ({ ...p, customer_name: e.target.value }))} />
                        </div>
                        <div className="od-edit-field">
                          <label>Account Status</label>
                          <select value={editData.account_status || ''} onChange={e => setEditData(p => ({ ...p, account_status: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Select —</option>
                            <option>Active</option>
                            <option>Dormant</option>
                            <option>Blacklisted</option>
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Account Owner</label>
                          <select value={editData.account_owner || ''} onChange={e => setEditData(p => ({ ...p, account_owner: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Unassigned —</option>
                            {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                            <option value="Customer Success Team">Customer Success Team</option>
                            <option value="Growth Team">Growth Team</option>
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Industry</label>
                          <input value={editData.industry || ''} onChange={e => setEditData(p => ({ ...p, industry: e.target.value }))} placeholder="e.g. Automotive, Pharma" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Credit Terms</label>
                          <input value={editData.credit_terms || ''} onChange={e => setEditData(p => ({ ...p, credit_terms: e.target.value }))} placeholder="e.g. Net 30, Advance" />
                        </div>
                        <div className="od-edit-field">
                          <label>Location / Branch</label>
                          <input value={editData.location || ''} onChange={e => setEditData(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Ahmedabad, Baroda" />
                        </div>
                      </div>

                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '12px 0 8px' }}>Tax & Compliance</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>GST Number</label>
                          <input value={editData.gst || ''} onChange={e => setEditData(p => ({ ...p, gst: e.target.value }))} placeholder="e.g. 24ABCDE1234F1Z5" />
                        </div>
                        <div className="od-edit-field">
                          <label>PAN Card No.</label>
                          <input value={editData.pan_card_no || ''} onChange={e => setEditData(p => ({ ...p, pan_card_no: e.target.value }))} placeholder="e.g. ABCDE1234F" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>MSME No.</label>
                          <input value={editData.msme_no || ''} onChange={e => setEditData(p => ({ ...p, msme_no: e.target.value }))} placeholder="MSME registration number" />
                        </div>
                      </div>

                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '12px 0 8px' }}>Addresses</div>
                      <div className="od-edit-field">
                        <label>Billing Address</label>
                        <textarea value={editData.billing_address || ''} onChange={e => setEditData(p => ({ ...p, billing_address: e.target.value }))} placeholder="Full billing address" />
                      </div>
                      <div className="od-edit-field" style={{ marginTop: 8 }}>
                        <label>Shipping Address</label>
                        <textarea value={editData.shipping_address || ''} onChange={e => setEditData(p => ({ ...p, shipping_address: e.target.value }))} placeholder="Full shipping address (if different from billing)" />
                      </div>

                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '12px 0 8px' }}>Point of Contact</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>POC Name</label>
                          <input value={editData.poc_name || ''} onChange={e => setEditData(p => ({ ...p, poc_name: e.target.value }))} placeholder="Contact person name" />
                        </div>
                        <div className="od-edit-field">
                          <label>POC Phone</label>
                          <input value={editData.poc_no || ''} onChange={e => setEditData(p => ({ ...p, poc_no: e.target.value }))} placeholder="Mobile / office number" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>POC Email</label>
                          <input value={editData.poc_email || ''} onChange={e => setEditData(p => ({ ...p, poc_email: e.target.value }))} placeholder="contact@company.com" />
                        </div>
                      </div>

                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '12px 0 8px' }}>Director / Decision Maker</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Director Name</label>
                          <input value={editData.director_name || ''} onChange={e => setEditData(p => ({ ...p, director_name: e.target.value }))} placeholder="Director / owner name" />
                        </div>
                        <div className="od-edit-field">
                          <label>Director Phone</label>
                          <input value={editData.director_no || ''} onChange={e => setEditData(p => ({ ...p, director_no: e.target.value }))} placeholder="Director contact number" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Director Email</label>
                          <input value={editData.director_email || ''} onChange={e => setEditData(p => ({ ...p, director_email: e.target.value }))} placeholder="director@company.com" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Account Info section */}
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Account Info</div>
                      <div className="od-detail-grid" style={{ marginBottom: 16 }}>
                        <div className="od-detail-field">
                          <label>Customer Name</label>
                          <div className="val">{customer.customer_name}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Account Status</label>
                          <div className="val">
                            {customer.account_status
                              ? <span className={'od-status-badge ' + (customer.account_status === 'Active' ? 'active' : customer.account_status === 'Blacklisted' ? 'cancelled' : 'pending')} style={{ fontSize: 10 }}>{customer.account_status}</span>
                              : '—'}
                          </div>
                        </div>
                        <div className="od-detail-field">
                          <label>Account Owner</label>
                          <div className="val">
                            {customer.account_owner
                              ? <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
                                  <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(customer.account_owner), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    {customer.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                                  </div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{customer.account_owner}</span>
                                </div>
                              : '—'}
                          </div>
                        </div>
                        <div className="od-detail-field">
                          <label>Industry</label>
                          <div className="val">{customer.industry || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Credit Terms</label>
                          <div className="val">{customer.credit_terms || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Location / Branch</label>
                          <div className="val">{customer.location || '—'}</div>
                        </div>
                      </div>

                      {/* Tax & Compliance */}
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Tax & Compliance</div>
                      <div className="od-detail-grid" style={{ marginBottom: 16 }}>
                        <div className="od-detail-field">
                          <label>GST Number</label>
                          <div className="val" style={{ fontFamily: 'var(--mono)', letterSpacing: '0.3px' }}>{customer.gst || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>PAN Card No.</label>
                          <div className="val" style={{ fontFamily: 'var(--mono)', letterSpacing: '0.3px' }}>{customer.pan_card_no || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>MSME No.</label>
                          <div className="val">{customer.msme_no || '—'}</div>
                        </div>
                      </div>

                      {/* Addresses */}
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Addresses</div>
                      <div className="od-detail-grid" style={{ marginBottom: 16 }}>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>Billing Address</label>
                          <div className="val" style={{ lineHeight: 1.5 }}>{customer.billing_address || '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>Shipping Address</label>
                          <div className="val" style={{ lineHeight: 1.5 }}>{customer.shipping_address || '—'}</div>
                        </div>
                      </div>

                      {/* Point of Contact */}
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Point of Contact</div>
                      <div className="od-detail-grid" style={{ marginBottom: 16 }}>
                        <div className="od-detail-field">
                          <label>POC Name</label>
                          <div className="val">{customer.poc_name || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>POC Phone</label>
                          <div className="val">{customer.poc_no
                            ? <a href={'tel:' + customer.poc_no} style={{ color: '#2563eb', textDecoration: 'none' }}>{customer.poc_no}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>POC Email</label>
                          <div className="val">{customer.poc_email
                            ? <a href={'mailto:' + customer.poc_email} style={{ color: '#2563eb', textDecoration: 'none' }}>{customer.poc_email}</a>
                            : '—'}</div>
                        </div>
                      </div>

                      {/* Director */}
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: 10 }}>Director / Decision Maker</div>
                      <div className="od-detail-grid">
                        <div className="od-detail-field">
                          <label>Director Name</label>
                          <div className="val">{customer.director_name || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Director Phone</label>
                          <div className="val">{customer.director_no
                            ? <a href={'tel:' + customer.director_no} style={{ color: '#2563eb', textDecoration: 'none' }}>{customer.director_no}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>Director Email</label>
                          <div className="val">{customer.director_email
                            ? <a href={'mailto:' + customer.director_email} style={{ color: '#2563eb', textDecoration: 'none' }}>{customer.director_email}</a>
                            : '—'}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Order History */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Order History</div>
                  <span style={{ fontSize: 12, color: 'var(--gray-400)', fontWeight: 500 }}>{orders.length} orders</span>
                </div>
                {orders.length === 0 ? (
                  <div className="od-card-body" style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--gray-400)' }}>
                    No orders found for this customer.
                  </div>
                ) : (
                  <>
                    <table className="od-items-table">
                      <thead>
                        <tr>
                          <th>Order #</th>
                          <th>Type</th>
                          <th>PO Ref</th>
                          <th>Status</th>
                          <th>Date</th>
                          <th style={{ textAlign: 'right' }}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map(o => (
                          <tr key={o.id} onClick={() => navigate('/orders/' + o.id)} style={{ cursor: 'pointer' }}>
                            <td className="mono">{o.order_number}</td>
                            <td>{o.order_type === 'SO' ? 'Standard' : o.order_type === 'CO' ? 'Custom' : 'Sample'}</td>
                            <td style={{ color: 'var(--gray-500)', fontSize: 12 }}>{o.po_number || '—'}</td>
                            <td>
                              <span className={'od-status-badge ' + statusBadgeClass(o.status)} style={{ fontSize: 10 }}>
                                {statusLabel(o.status)}
                              </span>
                            </td>
                            <td style={{ color: 'var(--gray-500)', whiteSpace: 'nowrap' }}>{fmt(o.created_at)}</td>
                            <td className="right">{fmtINR(o.grand_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="od-totals">
                      <div className="od-totals-inner">
                        <div className="od-totals-row">
                          <span>Total Orders</span>
                          <span>{orders.length}</span>
                        </div>
                        <div className="od-totals-row">
                          <span>Cancelled</span>
                          <span>{orders.filter(o => o.status === 'cancelled').length}</span>
                        </div>
                        <div className="od-totals-row grand">
                          <span>Lifetime Revenue</span>
                          <span>{fmtINR(totalRevenue)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── Sidebar ── */}
            <div className="od-sidebar">

              {/* Account owner chip */}
              <div className="od-side-card">
                <div className="od-side-card-title">Account Owner</div>
                {customer.account_owner
                  ? <div className="od-account-owner">
                      <div className="od-owner-avatar" style={{ background: ownerColor(customer.account_owner) }}>
                        {customer.account_owner.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div>
                        <div className="od-side-val-big">{customer.account_owner}</div>
                        <div className="od-side-sub">Account Rep</div>
                      </div>
                    </div>
                  : <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>Unassigned</div>
                }
              </div>

              {/* Stats */}
              <div className="od-side-card">
                <div className="od-side-card-title">Summary</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <StatRow label="Total Orders" value={orders.length} />
                  <StatRow label="Active Orders" value={activeOrders.length} accent={activeOrders.length > 0} />
                  <StatRow label="Completed" value={completedOrders.length} />
                  <StatRow label="Lifetime Revenue" value={fmtINR(totalRevenue)} big />
                </div>
              </div>

              {/* Credit & Key Info */}
              <div className="od-side-card">
                <div className="od-side-card-title">Key Info</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customer.account_status && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Status</div>
                      <span className={'od-status-badge ' + (customer.account_status === 'Active' ? 'active' : customer.account_status === 'Blacklisted' ? 'cancelled' : 'pending')} style={{ fontSize: 10 }}>{customer.account_status}</span>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Credit Terms</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-900)' }}>{customer.credit_terms || '—'}</div>
                  </div>
                  {customer.industry && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Industry</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-700)' }}>{customer.industry}</div>
                    </div>
                  )}
                  {customer.account_owner && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>Account Owner</div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:26, height:26, borderRadius:'50%', background:ownerColor(customer.account_owner), color:'white', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {customer.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <span style={{ fontSize:12, fontWeight:500, color:'var(--gray-800)' }}>{customer.account_owner}</span>
                      </div>
                    </div>
                  )}
                  {customer.poc_name && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Point of Contact</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-700)', fontWeight: 600 }}>{customer.poc_name}</div>
                      {customer.poc_no && <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{customer.poc_no}</div>}
                      {customer.poc_email && <div style={{ fontSize: 11, color: '#2563eb' }}>{customer.poc_email}</div>}
                    </div>
                  )}
                  {customer.billing_address && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 2 }}>Billing Address</div>
                      <div style={{ fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.5 }}>{customer.billing_address}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent orders */}
              {orders.length > 0 && (
                <div className="od-side-card od-activity-card">
                  <div className="od-side-card-title" style={{ padding: '0 0 10px' }}>Recent Orders</div>
                  <div className="od-activity-list" style={{ maxHeight: 280 }}>
                    {orders.slice(0, 8).map(o => (
                      <div key={o.id} className="od-activity-item" style={{ cursor: 'pointer' }} onClick={() => navigate('/orders/' + o.id)}>
                        <div className={'od-activity-dot ' + (['cancelled'].includes(o.status) ? 'cancelled' : ['delivered','dispatched_fc'].includes(o.status) ? 'approved' : 'submitted')} />
                        <div>
                          <div className="od-activity-label">{o.order_type === 'SO' ? 'Standard' : o.order_type === 'CO' ? 'Custom' : 'Sample'}</div>
                          <div className="od-activity-val" style={{ color: '#1a3a8b' }}>{o.order_number}</div>
                          <div className="od-activity-time">{statusLabel(o.status)} · {fmt(o.created_at)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function StatRow({ label, value, accent, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{label}</span>
      <span style={{ fontSize: big ? 14 : 13, fontWeight: 700, color: accent ? '#1a3a8b' : 'var(--gray-900)' }}>{value}</span>
    </div>
  )
}
