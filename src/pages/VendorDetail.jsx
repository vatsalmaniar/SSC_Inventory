import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'

import { fmt } from '../lib/fmt'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const VENDOR_TYPES  = ['Manufacturer','Distributor','Agent']
const CREDIT_TERMS  = ['Against PI','Advance','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery']
const SALES_REPS = [
  'Aarth Joshi','Akash Devda','Ankit Dave','Bhavesh Patel','Darsh Chauhan',
  'Dimple Bhatiya','Harshadba Zala','Hiral Patel','Jay Patel','Jaypal Jadeja',
  'Jital Maniar','Kaustubh Soni','Khushbu Panchal','Mayank Maniar','Mehul Maniar',
  'Jyotsna Pal','Vatsal Maniar',
]

function fmtINR(v) {
  if (!v && v !== 0) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }

const PO_STATUS_COLORS = {
  draft: { bg:'#f1f5f9', color:'#475569' }, pending_approval: { bg:'#fef9c3', color:'#854d0e' },
  approved: { bg:'#e8f2fc', color:'#1a4dab' }, placed: { bg:'#eff6ff', color:'#1d4ed8' },
  acknowledged: { bg:'#dbeafe', color:'#1e40af' }, partially_received: { bg:'#fffbeb', color:'#b45309' },
  received: { bg:'#f0fdf4', color:'#15803d' }, invoice_matched: { bg:'#ecfdf5', color:'#065f46' },
  closed: { bg:'#f0fdf4', color:'#14532d' }, cancelled: { bg:'#fef2f2', color:'#dc2626' },
}
function poStatusLabel(s) {
  return { draft:'Draft', pending_approval:'Pending Approval', approved:'Approved', placed:'Placed', acknowledged:'Acknowledged', partially_received:'Partial GRN', received:'Received', invoice_matched:'Invoice Matched', closed:'Closed', cancelled:'Cancelled' }[s] || s
}

export default function VendorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [vendor, setVendor]     = useState(null)
  const [pos, setPos]           = useState([])
  const [grns, setGrns]         = useState([])
  const [contacts, setContacts] = useState([])
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading]   = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]     = useState(false)
  const [approving, setApproving] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
  const [savingContact, setSavingContact] = useState(false)

  useEffect(() => { init() }, [id])


  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || '')

    const vendorRes = await sb.from('vendors').select('*').eq('id', id).single()
    if (!vendorRes.data) { setLoading(false); return }

    const [posRes, grnsRes, contactsRes] = await Promise.all([
      sb.from('purchase_orders').select('id,po_number,status,total_amount,expected_delivery,po_date,order_number').eq('vendor_id', id).order('created_at', { ascending: false }),
      sb.from('grn').select('id,grn_number,grn_type,status,received_at,invoice_number,invoice_amount').eq('vendor_id', id).order('created_at', { ascending: false }),
      sb.from('vendor_contacts').select('*').eq('vendor_id', id).order('name'),
    ])

    setVendor(vendorRes.data)
    setEditData(vendorRes.data)
    setPos(posRes.data || [])
    setGrns(grnsRes.data || [])
    setContacts(contactsRes.data || [])
    setLoading(false)
  }

  async function approve() {
    setApproving(true)
    await sb.from('vendors').update({ approval_status: 'approved' }).eq('id', id)
    setVendor(p => ({ ...p, approval_status: 'approved' }))
    setApproving(false)
  }

  async function reject() {
    if (!window.confirm('Reject and delete this vendor submission?')) return
    setApproving(true)
    await sb.from('vendors').delete().eq('id', id)
    navigate('/vendors')
  }

  async function save() {
    setSaving(true)
    const { error } = await sb.from('vendors').update({
      vendor_name:      editData.vendor_name,
      vendor_type:      editData.vendor_type || null,
      gst:              editData.gst || null,
      pan:              editData.pan || null,
      msme_no:          editData.msme_no || null,
      billing_address:  editData.billing_address || null,
      shipping_address: editData.shipping_address || null,
      poc_name:         editData.poc_name || null,
      poc_phone:        editData.poc_phone || null,
      poc_email:        editData.poc_email || null,
      director_name:    editData.director_name || null,
      director_no:      editData.director_no || null,
      director_email:   editData.director_email || null,
      credit_terms:     editData.credit_terms || null,
      account_status:   editData.account_status || null,
      account_owner:    editData.account_owner || null,
      status:           editData.status || 'active',
      turnover:         editData.turnover || null,
      premises:         editData.premises || null,
      year_established: editData.year_established || null,
      vi_shopfloor:     editData.vi_shopfloor || null,
      vi_payment:       editData.vi_payment || null,
      vi_expected_business: editData.vi_expected_business || null,
      notes:            editData.notes || null,
      updated_at:       new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    const { data: fresh } = await sb.from('vendors').select('*').eq('id', id).single()
    setVendor(fresh || editData)
    setEditData(fresh || editData)
    setEditMode(false); setSaving(false)
    toast('Vendor updated', 'success')
  }

  async function saveContact() {
    if (!contactForm.name.trim()) { toast('Name is required'); return }
    setSavingContact(true)
    const { data, error } = await sb.from('vendor_contacts').insert({ ...contactForm, vendor_id: id }).select().single()
    if (error) { toast('Error: ' + error.message); setSavingContact(false); return }
    setContacts(p => [...p, data])
    setContactForm({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
    setShowContactModal(false)
    setSavingContact(false)
    toast('Contact added', 'success')
  }

  async function deleteContact(cid) {
    if (!window.confirm('Remove this contact?')) return
    await sb.from('vendor_contacts').delete().eq('id', cid)
    setContacts(p => p.filter(c => c.id !== cid))
    toast('Contact removed', 'success')
  }

  if (loading) return <Layout pageTitle="Vendor 360" pageKey="vendor360"><div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div></Layout>
  if (!vendor) return <Layout pageTitle="Vendor 360" pageKey="vendor360"><div className="od-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Vendor not found</div><div style={{fontSize:13}}>This vendor may have been deleted.</div></div></div></Layout>

  const totalPOValue = pos.filter(p => p.status !== 'cancelled').reduce((s,p) => s + (p.total_amount || 0), 0)
  const openPos      = pos.filter(p => !['received','closed','cancelled'].includes(p.status))
  const closedPos    = pos.filter(p => ['received','closed'].includes(p.status))

  function ed(key, val) { setEditData(p => ({ ...p, [key]: val })) }

  const selectStyle = { padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }

  return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="od-page">
        <div className="od-body">

          {/* ── Header ── */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">
                  <span>{vendor.vendor_code}</span>
                  {vendor.approval_status === 'pending' && (
                    <span className="od-status-badge pending">Pending Approval</span>
                  )}
                  {vendor.account_status && vendor.approval_status !== 'pending' && (
                    <span className={'od-status-badge ' + (vendor.account_status === 'Active' || vendor.status === 'active' ? 'active' : 'cancelled')}>{vendor.account_status || (vendor.status === 'active' ? 'Active' : 'Inactive')}</span>
                  )}
                  {!vendor.account_status && vendor.approval_status !== 'pending' && (
                    <span className={'od-status-badge ' + (vendor.status === 'active' ? 'active' : 'cancelled')}>{vendor.status === 'active' ? 'Active' : 'Inactive'}</span>
                  )}
                  {vendor.vendor_type && <span className="od-status-badge active">{vendor.vendor_type}</span>}
                  {vendor.credit_terms && <span className="od-status-badge active">{vendor.credit_terms}</span>}
                </div>
                <div className="od-header-title">{vendor.vendor_name}</div>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center', marginTop:2 }}>
                  {vendor.gst && <div className="od-header-num" style={{ margin:0 }}>GST: {vendor.gst}</div>}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/vendors')}>← Back</button>
                {userRole === 'admin' && vendor.approval_status === 'pending' && (
                  <>
                    <button className="od-btn" onClick={reject} disabled={approving} style={{ color:'#dc2626', borderColor:'#fecaca' }}>Reject</button>
                    <button className="od-btn od-btn-approve" onClick={approve} disabled={approving}>{approving ? '…' : 'Approve'}</button>
                  </>
                )}
                {userRole === 'admin' && vendor.approval_status !== 'pending' && (
                  !editMode
                    ? <button className="od-btn od-btn-outline" onClick={() => setEditMode(true)}>Edit</button>
                    : <>
                        <button className="od-btn od-btn-outline" onClick={() => { setEditMode(false); setEditData(vendor) }}>Cancel</button>
                        <button className="od-btn od-btn-approve" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      </>
                )}
              </div>
            </div>
          </div>

          {/* Pending approval banner */}
          {vendor.approval_status === 'pending' && (
            <div style={{ display:'flex', alignItems:'center', gap:12, background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'12px 16px', margin:'16px 0 0' }}>
              <svg fill="none" stroke="#b45309" strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18, flexShrink:0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#92400e' }}>Awaiting Admin Approval</div>
                <div style={{ fontSize:12, color:'#b45309' }}>This vendor is not yet visible in the directory. An admin must approve before it goes live.</div>
              </div>
            </div>
          )}

          {/* ── Layout ── */}
          <div className="od-layout">

            {/* ── Main column ── */}
            <div className="od-main">

              {/* Vendor Details */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Vendor Details</div>
                </div>
                <div className="od-card-body">
                  {editMode ? (
                    <div className="od-edit-form">
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:8 }}>Vendor Info</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Vendor Name</label>
                          <input value={editData.vendor_name||''} onChange={e => ed('vendor_name', e.target.value)} />
                        </div>
                        <div className="od-edit-field">
                          <label>Account Status</label>
                          <select value={editData.account_status||''} onChange={e => ed('account_status', e.target.value)} style={selectStyle}>
                            <option value="">— Select —</option>
                            <option>Active</option>
                            <option>Dormant</option>
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Account Owner</label>
                          <select value={editData.account_owner||''} onChange={e => ed('account_owner', e.target.value)} style={selectStyle}>
                            <option value="">— Unassigned —</option>
                            {SALES_REPS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Vendor Type</label>
                          <select value={editData.vendor_type||''} onChange={e => ed('vendor_type', e.target.value)} style={selectStyle}>
                            <option value="">— Select —</option>
                            {VENDOR_TYPES.map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Credit Terms</label>
                          <select value={editData.credit_terms||''} onChange={e => ed('credit_terms', e.target.value)} style={selectStyle}>
                            <option value="">— Select —</option>
                            {CREDIT_TERMS.map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Premises</label>
                          <select value={editData.premises||''} onChange={e => ed('premises', e.target.value)} style={selectStyle}>
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
                          <input value={editData.turnover||''} onChange={e => ed('turnover', e.target.value)} placeholder="e.g. 2 Cr, 50L" />
                        </div>
                        <div className="od-edit-field">
                          <label>Year of Establishment</label>
                          <input type="number" value={editData.year_established||''} onChange={e => ed('year_established', e.target.value)} placeholder="e.g. 2005" />
                        </div>
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Tax & Compliance</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>GST Number</label>
                          <input value={editData.gst||''} onChange={e => ed('gst', e.target.value)} placeholder="e.g. 24ABCDE1234F1Z5" />
                        </div>
                        <div className="od-edit-field">
                          <label>PAN Number</label>
                          <input value={editData.pan||''} onChange={e => ed('pan', e.target.value)} placeholder="e.g. ABCDE1234F" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>MSME No.</label>
                          <input value={editData.msme_no||''} onChange={e => ed('msme_no', e.target.value)} placeholder="MSME registration number" />
                        </div>
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Addresses</div>
                      <div className="od-edit-field">
                        <label>Billing Address</label>
                        <textarea value={editData.billing_address||''} onChange={e => ed('billing_address', e.target.value)} placeholder="Full billing address" />
                      </div>
                      <div className="od-edit-field" style={{ marginTop:8 }}>
                        <label>Shipping Address</label>
                        <textarea value={editData.shipping_address||''} onChange={e => ed('shipping_address', e.target.value)} placeholder="Full shipping address" />
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Point of Contact</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>POC Name</label>
                          <input value={editData.poc_name||''} onChange={e => ed('poc_name', e.target.value)} placeholder="Contact person name" />
                        </div>
                        <div className="od-edit-field">
                          <label>POC Phone</label>
                          <input value={editData.poc_phone||''} onChange={e => ed('poc_phone', e.target.value)} placeholder="Mobile / office number" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>POC Email</label>
                          <input value={editData.poc_email||''} onChange={e => ed('poc_email', e.target.value)} placeholder="vendor@company.com" />
                        </div>
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Director / Decision Maker</div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Director Name</label>
                          <input value={editData.director_name||''} onChange={e => ed('director_name', e.target.value)} placeholder="Director / owner name" />
                        </div>
                        <div className="od-edit-field">
                          <label>Director Phone</label>
                          <input value={editData.director_no||''} onChange={e => ed('director_no', e.target.value)} placeholder="Director contact number" />
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Director Email</label>
                          <input value={editData.director_email||''} onChange={e => ed('director_email', e.target.value)} placeholder="director@company.com" />
                        </div>
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', margin:'16px 0 8px' }}>Visual Inspection Notes</div>
                      <div className="od-edit-field" style={{ marginBottom:8 }}>
                        <label>Shopfloor Observation</label>
                        <textarea value={editData.vi_shopfloor||''} onChange={e => ed('vi_shopfloor', e.target.value)} placeholder="e.g. Well-organized warehouse, active production lines…" />
                      </div>
                      <div className="od-edit-field" style={{ marginBottom:8 }}>
                        <label>Payment Assessment</label>
                        <textarea value={editData.vi_payment||''} onChange={e => ed('vi_payment', e.target.value)} placeholder="e.g. Payment cycle 30 days, financially stable…" />
                      </div>
                      <div className="od-edit-field">
                        <label>Expected Business</label>
                        <textarea value={editData.vi_expected_business||''} onChange={e => ed('vi_expected_business', e.target.value)} placeholder="e.g. Annual procurement potential ₹15–20L…" />
                      </div>

                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Notes</div>
                      <div className="od-edit-field">
                        <label>Notes</label>
                        <textarea value={editData.notes||''} onChange={e => ed('notes', e.target.value)} placeholder="Any notes about this vendor..." />
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Vendor Info */}
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10 }}>Vendor Info</div>
                      <div className="od-detail-grid" style={{ marginBottom:16 }}>
                        <div className="od-detail-field">
                          <label>Vendor Name</label>
                          <div className="val">{vendor.vendor_name}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Account Status</label>
                          <div className="val">
                            {(vendor.account_status || vendor.status)
                              ? <span className={'od-status-badge ' + ((vendor.account_status === 'Active' || vendor.status === 'active') ? 'active' : 'cancelled')} style={{ fontSize:10 }}>
                                  {vendor.account_status || (vendor.status === 'active' ? 'Active' : 'Inactive')}
                                </span>
                              : '—'}
                          </div>
                        </div>
                        <div className="od-detail-field">
                          <label>Account Owner</label>
                          <div className="val">
                            {vendor.account_owner
                              ? <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:2 }}>
                                  <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(vendor.account_owner), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    {vendor.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                                  </div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{vendor.account_owner}</span>
                                </div>
                              : '—'}
                          </div>
                        </div>
                        <div className="od-detail-field">
                          <label>Vendor Type</label>
                          <div className="val">{vendor.vendor_type || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Credit Terms</label>
                          <div className="val">{vendor.credit_terms || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Premises</label>
                          <div className="val">{vendor.premises || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Annual Turnover</label>
                          <div className="val">{vendor.turnover || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Year Established</label>
                          <div className="val">{vendor.year_established || '—'}</div>
                        </div>
                      </div>

                      {/* Tax & Compliance */}
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10 }}>Tax & Compliance</div>
                      <div className="od-detail-grid" style={{ marginBottom:16 }}>
                        <div className="od-detail-field">
                          <label>GST Number</label>
                          <div className="val" style={{ fontFamily:'var(--mono)', letterSpacing:'0.3px' }}>{vendor.gst || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>PAN Number</label>
                          <div className="val" style={{ fontFamily:'var(--mono)', letterSpacing:'0.3px' }}>{vendor.pan || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>MSME No.</label>
                          <div className="val">{vendor.msme_no || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>GST Certificate</label>
                          <div className="val">
                            {vendor.gst_cert_url
                              ? <a href={vendor.gst_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  View PDF
                                </a>
                              : <span style={{ color:'var(--gray-300)' }}>—</span>}
                          </div>
                        </div>
                        {vendor.msme_cert_url && (
                          <div className="od-detail-field">
                            <label>MSME Certificate</label>
                            <div className="val">
                              <a href={vendor.msme_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                View PDF
                              </a>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Addresses */}
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10 }}>Addresses</div>
                      <div className="od-detail-grid" style={{ marginBottom:16 }}>
                        <div className="od-detail-field" style={{ gridColumn:'span 2' }}>
                          <label>Billing Address</label>
                          <div className="val" style={{ lineHeight:1.5 }}>{vendor.billing_address || '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn:'span 2' }}>
                          <label>Shipping Address</label>
                          <div className="val" style={{ lineHeight:1.5 }}>{vendor.shipping_address || '—'}</div>
                        </div>
                      </div>

                      {/* Point of Contact */}
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10 }}>Point of Contact</div>
                      <div className="od-detail-grid" style={{ marginBottom:16 }}>
                        <div className="od-detail-field">
                          <label>POC Name</label>
                          <div className="val">{vendor.poc_name || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>POC Phone</label>
                          <div className="val">{vendor.poc_phone
                            ? <a href={'tel:' + vendor.poc_phone} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.poc_phone}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn:'span 2' }}>
                          <label>POC Email</label>
                          <div className="val">{vendor.poc_email
                            ? <a href={'mailto:' + vendor.poc_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.poc_email}</a>
                            : '—'}</div>
                        </div>
                      </div>

                      {/* Director */}
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10 }}>Director / Decision Maker</div>
                      <div className="od-detail-grid" style={{ marginBottom:16 }}>
                        <div className="od-detail-field">
                          <label>Director Name</label>
                          <div className="val">{vendor.director_name || '—'}</div>
                        </div>
                        <div className="od-detail-field">
                          <label>Director Phone</label>
                          <div className="val">{vendor.director_no
                            ? <a href={'tel:' + vendor.director_no} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.director_no}</a>
                            : '—'}</div>
                        </div>
                        <div className="od-detail-field" style={{ gridColumn:'span 2' }}>
                          <label>Director Email</label>
                          <div className="val">{vendor.director_email
                            ? <a href={'mailto:' + vendor.director_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.director_email}</a>
                            : '—'}</div>
                        </div>
                      </div>

                      {/* Visual Inspection */}
                      {(vendor.vi_shopfloor || vendor.vi_payment || vendor.vi_expected_business) && (
                        <div style={{ marginTop:20, background:'#fffdf5', border:'1px solid #fde68a', borderRadius:10, padding:'14px 16px' }}>
                          <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            Visual Inspection Notes
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                            {vendor.vi_shopfloor && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Shopfloor</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{vendor.vi_shopfloor}</div>
                              </div>
                            )}
                            {vendor.vi_payment && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Payment</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{vendor.vi_payment}</div>
                              </div>
                            )}
                            {vendor.vi_expected_business && (
                              <div>
                                <div style={{ fontSize:10, fontWeight:600, color:'#b45309', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:3 }}>Expected Business</div>
                                <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{vendor.vi_expected_business}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      {vendor.notes && (
                        <>
                          <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:10, marginTop:16 }}>Notes</div>
                          <div className="od-detail-grid">
                            <div className="od-detail-field" style={{ gridColumn:'span 2' }}>
                              <div className="val" style={{ lineHeight:1.6 }}>{vendor.notes}</div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Purchase Order History */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Purchase Orders</div>
                  <span style={{ fontSize:12, color:'var(--gray-400)', fontWeight:500 }}>{pos.length} POs</span>
                </div>
                {pos.length === 0 ? (
                  <div className="od-card-body" style={{ textAlign:'center', padding:'32px 20px', color:'var(--gray-400)' }}>
                    No purchase orders found for this vendor.
                  </div>
                ) : (
                  <>
                    <table className="od-items-table">
                      <thead>
                        <tr>
                          <th>PO Number</th>
                          <th>Linked Order</th>
                          <th>Status</th>
                          <th>PO Date</th>
                          <th>Expected Delivery</th>
                          <th style={{ textAlign:'right' }}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pos.map(p => {
                          const sc = PO_STATUS_COLORS[p.status] || PO_STATUS_COLORS.draft
                          return (
                            <tr key={p.id} onClick={() => navigate('/procurement/po/' + p.id)} style={{ cursor:'pointer' }}>
                              <td className="mono" style={{ color:'#1a4dab' }}>{p.po_number}</td>
                              <td style={{ fontSize:12, color:'var(--gray-500)' }}>{p.order_number || '—'}</td>
                              <td>
                                <span className={'od-status-badge ' + (p.status === 'received' || p.status === 'closed' ? 'active' : p.status === 'cancelled' ? 'cancelled' : 'pending')} style={{ fontSize:10 }}>
                                  {poStatusLabel(p.status)}
                                </span>
                              </td>
                              <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{fmt(p.po_date)}</td>
                              <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{p.expected_delivery ? fmt(p.expected_delivery) : '—'}</td>
                              <td className="right">{fmtINR(p.total_amount)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="od-totals">
                      <div className="od-totals-inner">
                        <div className="od-totals-row">
                          <span>Total POs</span>
                          <span>{pos.length}</span>
                        </div>
                        <div className="od-totals-row">
                          <span>Cancelled</span>
                          <span>{pos.filter(p => p.status === 'cancelled').length}</span>
                        </div>
                        <div className="od-totals-row grand">
                          <span>Total PO Value</span>
                          <span>{fmtINR(totalPOValue)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* GRN History */}
              {grns.length > 0 && (
                <div className="od-card">
                  <div className="od-card-header">
                    <div className="od-card-title">Goods Received Notes</div>
                    <span style={{ fontSize:12, color:'var(--gray-400)', fontWeight:500 }}>{grns.length} GRNs</span>
                  </div>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th>GRN Number</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Received</th>
                        <th>Invoice #</th>
                        <th style={{ textAlign:'right' }}>Invoice Amt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grns.map(g => (
                        <tr key={g.id} onClick={() => navigate('/fc/grn/' + g.id)} style={{ cursor:'pointer' }}>
                          <td className="mono" style={{ color:'#1a4dab' }}>{g.grn_number}</td>
                          <td style={{ fontSize:12 }}>{g.grn_type?.replace(/_/g,' ') || '—'}</td>
                          <td>
                            <span className={'od-status-badge ' + (g.status === 'confirmed' ? 'active' : 'pending')} style={{ fontSize:10 }}>
                              {g.status}
                            </span>
                          </td>
                          <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{fmt(g.received_at)}</td>
                          <td style={{ fontSize:12 }}>{g.invoice_number || '—'}</td>
                          <td className="right">{g.invoice_amount ? fmtINR(g.invoice_amount) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>

            {/* ── Sidebar ── */}
            <div className="od-sidebar">

              {/* Account Owner */}
              <div className="od-side-card">
                <div className="od-side-card-title">Account Owner</div>
                {vendor.account_owner
                  ? <div className="od-account-owner">
                      <div className="od-owner-avatar" style={{ background: ownerColor(vendor.account_owner) }}>
                        {vendor.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                      </div>
                      <div>
                        <div className="od-side-val-big">{vendor.account_owner}</div>
                        <div className="od-side-sub">Account Rep</div>
                      </div>
                    </div>
                  : <div style={{ fontSize:13, color:'var(--gray-400)' }}>Unassigned</div>
                }
              </div>

              {/* Contacts */}
              <div className="od-side-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="od-side-card-title" style={{ margin:0 }}>Contacts ({contacts.length})</div>
                  {['ops','admin'].includes(userRole) && (
                    <button onClick={() => setShowContactModal(true)}
                      style={{ fontSize:11, fontWeight:700, color:'#1a4dab', background:'#eff6ff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'var(--font)' }}>
                      + Add
                    </button>
                  )}
                </div>
                {contacts.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', textAlign:'center', padding:'12px 0' }}>
                    No contacts yet.<br/>
                    {['ops','admin'].includes(userRole) && (
                      <button onClick={() => setShowContactModal(true)} style={{ marginTop:8, fontSize:12, fontWeight:600, color:'#1a4dab', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)' }}>+ Add Contact</button>
                    )}
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {contacts.map(c => (
                      <div key={c.id} style={{ display:'flex', gap:10, alignItems:'flex-start', paddingBottom:10, borderBottom:'1px solid var(--gray-50)' }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:'#e0e7ff', color:'#3730a3', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--gray-900)' }}>{c.name}</div>
                          {c.designation && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.designation}</div>}
                          {c.phone && <a href={'tel:' + c.phone} style={{ display:'block', fontSize:12, color:'#1a4dab', marginTop:3, textDecoration:'none', fontWeight:500 }}>{c.phone}</a>}
                          {c.email && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.email}</div>}
                        </div>
                        {['ops','admin'].includes(userRole) && (
                          <button onClick={() => deleteContact(c.id)} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:14, padding:2 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div className="od-side-card">
                <div className="od-side-card-title">Summary</div>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <StatRow label="Total POs" value={pos.length} />
                  <StatRow label="Open POs" value={openPos.length} accent={openPos.length > 0} />
                  <StatRow label="Completed" value={closedPos.length} />
                  <StatRow label="GRNs" value={grns.length} />
                  <StatRow label="Total PO Value" value={fmtINR(totalPOValue)} big />
                </div>
              </div>

              {/* Key Info */}
              <div className="od-side-card">
                <div className="od-side-card-title">Key Info</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div>
                    <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Status</div>
                    <span className={'od-status-badge ' + ((vendor.account_status === 'Active' || vendor.status === 'active') ? 'active' : 'cancelled')} style={{ fontSize:10 }}>
                      {vendor.account_status || (vendor.status === 'active' ? 'Active' : 'Inactive')}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Credit Terms</div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--gray-900)' }}>{vendor.credit_terms || '—'}</div>
                  </div>
                  {vendor.vendor_type && (
                    <div>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Type</div>
                      <div style={{ fontSize:12, color:'var(--gray-700)' }}>{vendor.vendor_type}</div>
                    </div>
                  )}
                  {vendor.account_owner && (
                    <div>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:6 }}>Account Owner</div>
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ width:26, height:26, borderRadius:'50%', background:ownerColor(vendor.account_owner), color:'white', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {vendor.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <span style={{ fontSize:12, fontWeight:500, color:'var(--gray-800)' }}>{vendor.account_owner}</span>
                      </div>
                    </div>
                  )}
                  {vendor.poc_name && (
                    <div>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Primary Contact</div>
                      <div style={{ fontSize:12, color:'var(--gray-700)', fontWeight:600 }}>{vendor.poc_name}</div>
                      {vendor.poc_phone && <div style={{ fontSize:11, color:'var(--gray-500)' }}>{vendor.poc_phone}</div>}
                      {vendor.poc_email && <div style={{ fontSize:11, color:'#1a4dab' }}>{vendor.poc_email}</div>}
                    </div>
                  )}
                  {vendor.billing_address && (
                    <div>
                      <div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:2 }}>Billing Address</div>
                      <div style={{ fontSize:12, color:'var(--gray-600)', lineHeight:1.5 }}>{vendor.billing_address}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent POs */}
              {pos.length > 0 && (
                <div className="od-side-card od-activity-card">
                  <div className="od-side-card-title" style={{ padding:'0 0 10px' }}>Recent POs</div>
                  <div className="od-activity-list" style={{ maxHeight:280 }}>
                    {pos.slice(0, 8).map(p => {
                      const dt = ['cancelled'].includes(p.status) ? 'cancel' : ['received','closed'].includes(p.status) ? 'success' : 'dispatch'
                      return (
                        <div key={p.id} className="od-tl-item" style={{ cursor:'pointer' }} onClick={() => navigate('/procurement/po/' + p.id)}>
                          <div className={'od-tl-dot ' + dt}>
                            {dt === 'cancel' ? <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            : dt === 'success' ? <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                            : <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>}
                          </div>
                          <div className="od-tl-content">
                            <div className="od-tl-header">
                              <div className="od-tl-title" style={{ color:'#1a4dab', fontWeight:600 }}>{p.po_number}</div>
                              <div className="od-tl-time">{fmt(p.po_date || p.created_at)}</div>
                            </div>
                            <div className="od-tl-sub">{poStatusLabel(p.status)} · {fmtINR(p.total_amount)}</div>
                          </div>
                        </div>
                      )
                    })}
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
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:12, color:'var(--gray-500)' }}>{label}</span>
      <span style={{ fontSize: big ? 14 : 13, fontWeight:700, color: accent ? '#1a4dab' : 'var(--gray-900)' }}>{value}</span>
    </div>
  )
}
