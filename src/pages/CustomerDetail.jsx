import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { toast } from '../lib/toast'
import { fmt } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const SALES_REPS = [
  'Aarth Joshi','Akash Devda','Ankit Dave','Bhavesh Patel','Darsh Chauhan',
  'Dimple Bhatiya','Harshadba Zala','Hiral Patel','Jay Patel','Jaypal Jadeja',
  'Jital Maniar','Kaustubh Soni','Khushbu Panchal','Mayank Maniar','Mehul Maniar',
  'Sales Support BRD','Vatsal Maniar',
]

const INDUSTRIES = [
  'Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal',
  'Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG',
  'Energy','Automobile','Power Electronics','Datacenters','Road Construction',
  'Cement','Tyre','Petroleum','Chemical',
]

const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']

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
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading]   = useState(true)
  const [editMode, setEditMode]   = useState(false)
  const [editData, setEditData]   = useState({})
  const [saving, setSaving]       = useState(false)
  const [approving, setApproving] = useState(false)
  const [contacts, setContacts]   = useState([])
  const [opps, setOpps]           = useState([])
  const [oppTab, setOppTab]       = useState('open')
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
  const [savingContact, setSavingContact] = useState(false)

  useEffect(() => { init() }, [id])

  // Realtime: live customer detail updates
  useRealtimeSubscription(`customer-${id}`, {
    table: 'customers', filter: `id=eq.${id}`, event: 'UPDATE',
    enabled: !!id, onEvent: () => init(),
  })

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || '')

    const custRes = await sb.from('customers').select('*').eq('id', id).single()
    if (!custRes.data) { navigate('/customers'); return }

    const [ordersRes, contactsRes, oppsRes] = await Promise.all([
      sb.from('orders')
        .select('id,order_number,customer_name,status,order_type,order_items(total_price),created_at,po_number')
        .eq('is_test', false)
        .ilike('customer_name', custRes.data.customer_name)
        .order('created_at', { ascending: false }),
      sb.from('customer_contacts').select('*').eq('customer_id', id).order('created_at', { ascending: true }),
      sb.from('crm_opportunities')
        .select('id,opportunity_name,stage,estimated_value_inr,created_at,brands,profiles(name),crm_principals(name)')
        .eq('customer_id', id)
        .order('created_at', { ascending: false }),
    ])

    setCustomer(custRes.data)
    setEditData(custRes.data)
    setOrders(ordersRes.data || [])
    setContacts(contactsRes.data || [])
    setOpps(oppsRes.data || [])
    setLoading(false)
  }

  async function saveContact() {
    if (!contactForm.name.trim()) { toast('Name is required'); return }
    setSavingContact(true)
    const { data, error } = await sb.from('customer_contacts').insert({ ...contactForm, customer_id: id }).select().single()
    if (error) { toast('Error: ' + error.message); setSavingContact(false); return }
    setContacts(p => [...p, data])
    setContactForm({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
    setShowContactModal(false)
    setSavingContact(false)
    toast('Contact added', 'success')
  }

  async function approve() {
    setApproving(true)
    await sb.from('customers').update({ approval_status: 'approved' }).eq('id', id)
    setCustomer(p => ({ ...p, approval_status: 'approved' }))
    setApproving(false)
    toast('Customer approved', 'success')
  }

  async function reject() {
    if (!window.confirm('Reject and delete this customer submission?')) return
    setApproving(true)
    await sb.from('customers').delete().eq('id', id)
    toast('Customer rejected', 'success')
    navigate('/customers')
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
      customer_type:   editData.customer_type || null,
      location:        editData.location || null,
      poc_name:        editData.poc_name || null,
      poc_no:          editData.poc_no || null,
      poc_email:       editData.poc_email || null,
      director_name:   editData.director_name || null,
      director_no:     editData.director_no || null,
      director_email:  editData.director_email || null,
      turnover:        editData.turnover || null,
      premises:        editData.premises || null,
      year_established: editData.year_established || null,
      vi_shopfloor:    editData.vi_shopfloor || null,
      vi_payment:      editData.vi_payment || null,
      vi_expected_business: editData.vi_expected_business || null,
    }).eq('id', id)
    if (error) { toast('Error saving: ' + error.message); setSaving(false); return }
    // Re-fetch to verify the update actually persisted (RLS can silently block writes)
    const { data: fresh } = await sb.from('customers').select('*').eq('id', id).single()
    if (fresh && fresh.credit_terms !== editData.credit_terms) {
      toast('Save blocked by database policy. Ask your admin to enable UPDATE policy on the customers table in Supabase.')
      setSaving(false); return
    }
    setCustomer(fresh || { ...customer, ...editData })
    setEditData(fresh || { ...customer, ...editData })
    setEditMode(false); setSaving(false)
    toast('Customer updated', 'success')
  }

  if (loading) return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div>
    </Layout>
  )
  if (!customer) return <Layout pageTitle="Customer" pageKey="customer360"><div className="od-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Customer not found</div><div style={{fontSize:13}}>This customer may have been deleted or you don't have access.</div></div></div></Layout>

  const activeOrders    = orders.filter(o => !['cancelled','delivered','dispatched_fc'].includes(o.status))
  const completedOrders = orders.filter(o => ['delivered','dispatched_fc'].includes(o.status))
  const totalRevenue    = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.order_items || []).reduce((t, i) => t + (i.total_price || 0), 0), 0)
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
                  {customer.approval_status === 'pending' && (
                    <span className="od-status-badge pending">Pending Approval</span>
                  )}
                  {customer.account_status && customer.approval_status !== 'pending' && (
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
                {userRole === 'admin' && customer.approval_status === 'pending' && (
                  <>
                    <button className="od-btn" onClick={reject} disabled={approving} style={{ color:'#dc2626', borderColor:'#fecaca' }}>Reject</button>
                    <button className="od-btn od-btn-approve" onClick={approve} disabled={approving}>{approving ? '…' : 'Approve'}</button>
                  </>
                )}
                {userRole === 'admin' && customer.approval_status !== 'pending' && (
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

          {/* Pending approval banner */}
          {customer.approval_status === 'pending' && (
            <div style={{ display:'flex', alignItems:'center', gap:12, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'12px 16px', margin:'16px 0 0' }}>
              <svg fill="none" stroke="#b45309" strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18, flexShrink:0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#92400e' }}>Awaiting Admin Approval</div>
                <div style={{ fontSize:12, color:'#b45309' }}>This customer is not yet visible in the directory. An admin must approve before it goes live.</div>
              </div>
            </div>
          )}

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
                            {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
                            <option value="Customer Success Team">Customer Success Team</option>
                            <option value="Growth Team">Growth Team</option>
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Industry</label>
                          <select value={editData.industry || ''} onChange={e => setEditData(p => ({ ...p, industry: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Select —</option>
                            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Credit Terms</label>
                          <select value={editData.credit_terms || ''} onChange={e => setEditData(p => ({ ...p, credit_terms: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Select —</option>
                            <option>Against PI</option>
                            <option>7 Days</option>
                            <option>15 Days</option>
                            <option>30 Days</option>
                            <option>45 Days</option>
                            <option>60 Days</option>
                            <option>75 Days</option>
                            <option>90 Days</option>
                            <option>Against Delivery</option>
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Location / Branch</label>
                          <input value={editData.location || ''} onChange={e => setEditData(p => ({ ...p, location: e.target.value }))} placeholder="e.g. Ahmedabad, Baroda" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Customer Type</label>
                          <select value={editData.customer_type || ''} onChange={e => setEditData(p => ({ ...p, customer_type: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Select —</option>
                            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Premises</label>
                          <select value={editData.premises || ''} onChange={e => setEditData(p => ({ ...p, premises: e.target.value }))} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
                            <option value="">— Select —</option>
                            <option>Owned</option>
                            <option>Rented</option>
                            <option>Leased</option>
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Annual Turnover</label>
                          <input value={editData.turnover || ''} onChange={e => setEditData(p => ({ ...p, turnover: e.target.value }))} placeholder="e.g. 2 Cr, 50L" />
                        </div>
                        <div className="od-edit-field">
                          <label>Year of Establishment</label>
                          <input type="number" value={editData.year_established || ''} onChange={e => setEditData(p => ({ ...p, year_established: e.target.value }))} placeholder="e.g. 2005" />
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

                      <div style={{ fontSize: 10, fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.7px', margin: '16px 0 8px' }}>Visual Inspection Notes</div>
                      <div className="od-edit-field" style={{ marginBottom: 8 }}>
                        <label>Shopfloor Observation</label>
                        <textarea value={editData.vi_shopfloor || ''} onChange={e => setEditData(p => ({ ...p, vi_shopfloor: e.target.value }))} placeholder="e.g. Shop floor filled with machines, active production…" />
                      </div>
                      <div className="od-edit-field" style={{ marginBottom: 8 }}>
                        <label>Payment Assessment</label>
                        <textarea value={editData.vi_payment || ''} onChange={e => setEditData(p => ({ ...p, vi_payment: e.target.value }))} placeholder="e.g. Ideal payment cycle 60 days, payment appears safe…" />
                      </div>
                      <div className="od-edit-field">
                        <label>Expected Business</label>
                        <textarea value={editData.vi_expected_business || ''} onChange={e => setEditData(p => ({ ...p, vi_expected_business: e.target.value }))} placeholder="e.g. Annual potential ₹8–10L, primarily Mitsubishi PLCs…" />
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
                          <label>Customer Type</label>
                          <div className="val">{customer.customer_type || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Credit Terms</label>
                          <div className="val">{customer.credit_terms || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Location / Branch</label>
                          <div className="val">{customer.location || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Premises</label>
                          <div className="val">{customer.premises || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Annual Turnover</label>
                          <div className="val">{customer.turnover || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Year Established</label>
                          <div className="val">{customer.year_established || '—'}</div>
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
                        <div className="od-detail-field">
                          <label>GST Certificate</label>
                          <div className="val">
                            {customer.gst_cert_url
                              ? <a href={customer.gst_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  View PDF
                                </a>
                              : <span style={{ color:'var(--gray-300)' }}>—</span>}
                          </div>
                        </div>
                        {customer.msme_cert_url && (
                          <div className="od-detail-field">
                            <label>MSME Certificate</label>
                            <div className="val">
                              <a href={customer.msme_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                View PDF
                              </a>
                            </div>
                          </div>
                        )}
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
                            ? <a href={'tel:' + customer.poc_no} style={{ color: '#1a4dab', textDecoration: 'none' }}>{customer.poc_no}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>POC Email</label>
                          <div className="val">{customer.poc_email
                            ? <a href={'mailto:' + customer.poc_email} style={{ color: '#1a4dab', textDecoration: 'none' }}>{customer.poc_email}</a>
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
                            ? <a href={'tel:' + customer.director_no} style={{ color: '#1a4dab', textDecoration: 'none' }}>{customer.director_no}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn: 'span 2' }}>
                          <label>Director Email</label>
                          <div className="val">{customer.director_email
                            ? <a href={'mailto:' + customer.director_email} style={{ color: '#1a4dab', textDecoration: 'none' }}>{customer.director_email}</a>
                            : '—'}</div>
                        </div>
                      </div>

                      {/* Visual Inspection */}
                      {(customer.vi_shopfloor || customer.vi_payment || customer.vi_expected_business) && (
                        <div style={{ marginTop: 20, background:'#fffdf5', border:'1px solid #fde68a', borderRadius:10, padding:'14px 16px' }}>
                          <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            Visual Inspection Notes
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                            {customer.vi_shopfloor && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Shopfloor</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{customer.vi_shopfloor}</div>
                              </div>
                            )}
                            {customer.vi_payment && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Payment</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{customer.vi_payment}</div>
                              </div>
                            )}
                            {customer.vi_expected_business && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Expected Business</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{customer.vi_expected_business}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
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
                            <td className="right">{fmtINR((o.order_items || []).reduce((t, i) => t + (i.total_price || 0), 0))}</td>
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

              {/* ── Opportunities ── */}
              {(() => {
                const TERMINAL = ['WON','LOST','ON_HOLD']
                const STAGE_LABELS = {
                  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
                  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
                  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
                }
                const STAGE_STYLES = {
                  WON:              { background:'#f0fdf4', color:'#15803d' },
                  LOST:             { background:'#fef2f2', color:'#dc2626' },
                  ON_HOLD:          { background:'#fffbeb', color:'#b45309' },
                  QUOTATION_SENT:   { background:'#e8f2fc', color:'#1a4dab' },
                  FOLLOW_UP:        { background:'#fff7ed', color:'#c2410c' },
                  FINAL_NEGOTIATION:{ background:'#fef9c3', color:'#854d0e' },
                  BOM_RECEIVED:     { background:'#f5f3ff', color:'#7c3aed' },
                }
                const openOpps   = opps.filter(o => !TERMINAL.includes(o.stage))
                const closedOpps = opps.filter(o => TERMINAL.includes(o.stage))
                const shown      = oppTab === 'open' ? openOpps : closedOpps
                return (
                  <div className="od-card">
                    <div className="od-card-header" style={{ paddingBottom:0, borderBottom:'none', flexDirection:'column', alignItems:'flex-start', gap:0 }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', marginBottom:8 }}>
                        <div className="od-card-title">Opportunities</div>
                        <span style={{ fontSize:12, color:'var(--gray-400)', fontWeight:500 }}>{opps.length} total</span>
                      </div>
                      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--gray-100)', width:'100%' }}>
                        {[['open','Open',openOpps.length],['closed','Closed',closedOpps.length]].map(([key,label,count]) => (
                          <button key={key} onClick={() => setOppTab(key)}
                            style={{ padding:'8px 18px', fontSize:12, fontWeight:700, background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)',
                              color: oppTab===key ? '#1a4dab' : 'var(--gray-400)',
                              borderBottom: oppTab===key ? '2px solid #1a4dab' : '2px solid transparent',
                              marginBottom:-1 }}>
                            {label} <span style={{ fontSize:11, fontWeight:500, marginLeft:4, color: oppTab===key ? '#1a4dab' : 'var(--gray-400)' }}>({count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {shown.length === 0 ? (
                      <div className="od-card-body" style={{ textAlign:'center', padding:'28px 20px', color:'var(--gray-400)', fontSize:13 }}>
                        No {oppTab} opportunities.
                      </div>
                    ) : (
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th>Opportunity</th>
                            <th>Stage</th>
                            <th>Brands</th>
                            <th>Rep</th>
                            <th>Date</th>
                            <th style={{ textAlign:'right' }}>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map(o => {
                            const ss = STAGE_STYLES[o.stage] || { background:'#f1f5f9', color:'#475569' }
                            return (
                              <tr key={o.id} onClick={() => navigate('/crm/opportunities/' + o.id)} style={{ cursor:'pointer' }}>
                                <td style={{ fontWeight:600, maxWidth:200 }}>
                                  <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                    {o.opportunity_name || o.crm_principals?.name || '—'}
                                  </div>
                                </td>
                                <td>
                                  <span style={{ ...ss, fontSize:10, fontWeight:700, borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap' }}>
                                    {STAGE_LABELS[o.stage] || o.stage}
                                  </span>
                                </td>
                                <td style={{ fontSize:11, color:'var(--gray-500)', maxWidth:140 }}>
                                  {(o.brands && o.brands.length > 0) ? o.brands.slice(0,3).join(', ') : (o.crm_principals?.name || '—')}
                                </td>
                                <td style={{ fontSize:12, color:'var(--gray-500)', whiteSpace:'nowrap' }}>{o.profiles?.name || '—'}</td>
                                <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap', fontSize:12 }}>{fmt(o.created_at)}</td>
                                <td className="right">{o.estimated_value_inr ? fmtINR(o.estimated_value_inr) : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })()}

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

              {/* Contacts */}
              <div className="od-side-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="od-side-card-title" style={{ margin:0 }}>Contacts ({contacts.length})</div>
                  <button onClick={() => setShowContactModal(true)}
                    style={{ fontSize:11, fontWeight:700, color:'#1a4dab', background:'#eff6ff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'var(--font)' }}>
                    + Add
                  </button>
                </div>
                {contacts.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', textAlign:'center', padding:'12px 0' }}>
                    No contacts yet.<br/>
                    <button onClick={() => setShowContactModal(true)} style={{ marginTop:8, fontSize:12, fontWeight:600, color:'#1a4dab', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)' }}>+ Add Contact</button>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {contacts.map(c => (
                      <div key={c.id} style={{ display:'flex', gap:10, alignItems:'flex-start', paddingBottom:10, borderBottom:'1px solid var(--gray-50)' }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:'#e0e7ff', color:'#3730a3', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--gray-900)' }}>{c.name}</div>
                          {c.designation && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.designation}</div>}
                          {c.phone && <a href={'tel:' + c.phone} style={{ display:'block', fontSize:12, color:'#1a4dab', marginTop:3, textDecoration:'none', fontWeight:500 }}>{c.phone}</a>}
                          {c.email && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.email}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                      {customer.poc_email && <div style={{ fontSize: 11, color: '#1a4dab' }}>{customer.poc_email}</div>}
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
                          <div className="od-activity-val" style={{ color: '#1a4dab' }}>{o.order_number}</div>
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
      {/* Add Contact Modal */}
      {showContactModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target===e.currentTarget) setShowContactModal(false) }}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Add Contact</div>
              <button onClick={() => setShowContactModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
              {[['name','Name *','text'],['designation','Title / Designation','text'],['phone','Phone','tel'],['whatsapp','WhatsApp','tel'],['email','Email','email']].map(([field, label, type]) => (
                <div key={field}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
                  <input type={type} value={contactForm[field]} onChange={e => setContactForm(p => ({ ...p, [field]: e.target.value }))}
                    style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowContactModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={saveContact} disabled={savingContact || !contactForm.name.trim()}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#1e3a5f', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity: contactForm.name.trim() ? 1 : 0.4 }}>
                {savingContact ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}

function StatRow({ label, value, accent, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>{label}</span>
      <span style={{ fontSize: big ? 14 : 13, fontWeight: 700, color: accent ? '#1a4dab' : 'var(--gray-900)' }}>{value}</span>
    </div>
  )
}
