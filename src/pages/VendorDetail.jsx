import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/customer360.css'
import { friendlyError } from '../lib/errorMsg'

const VENDOR_TYPES = ['Manufacturer','Distributor','Agent']
const CREDIT_TERMS = ['Against PI','Advance','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery']
const SALES_REPS   = [
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

function poStatusLabel(s) {
  return { draft:'Draft', pending_approval:'Pending Approval', approved:'Approved', placed:'Placed', acknowledged:'Acknowledged', partially_received:'Partial GRN', received:'Received', invoice_matched:'Invoice Matched', closed:'Closed', cancelled:'Cancelled' }[s] || s
}
function poStatusClass(s) {
  if (['received','closed','invoice_matched'].includes(s)) return 'active'
  if (s === 'cancelled') return 'cancelled'
  return 'pending'
}

export default function VendorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [vendor, setVendor]       = useState(null)
  const [pos, setPos]             = useState([])
  const [grns, setGrns]           = useState([])
  const [contacts, setContacts]   = useState([])
  const [userRole, setUserRole]     = useState('')
  const [username, setUsername]     = useState('')
  const [loading, setLoading]     = useState(true)
  const [editMode, setEditMode]   = useState(false)
  const [editData, setEditData]   = useState({})
  const [saving, setSaving]       = useState(false)
  const [approving, setApproving] = useState(false)
  // Inline compliance edit (admin-only)
  const [cmpEdit, setCmpEdit]     = useState(false)
  const [cmpData, setCmpData]     = useState({})
  const [cmpSaving, setCmpSaving] = useState(false)
  const gstFileRef    = useRef(null)
  const msmeFileRef   = useRef(null)
  const [activeTab, setActiveTab] = useState('summary')
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
  const [savingContact, setSavingContact] = useState(false)
  const [showPdfModal, setShowPdfModal]   = useState(false)
  const [pdfInclude, setPdfInclude]       = useState({ pos: true, grns: true })

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role,username').eq('id', session.user.id).single()
    setUserRole(profile?.role || '')
    setUsername(profile?.username || '')

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
    toast('Vendor approved', 'success')
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
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    const { data: fresh } = await sb.from('vendors').select('*').eq('id', id).single()
    setVendor(fresh || editData)
    setEditData(fresh || editData)
    setEditMode(false); setSaving(false)
    toast('Vendor updated', 'success')
  }

  // ── Inline compliance edit (admin / management / jyashri.negi) ──
  const canEditCompliance = ['admin', 'management'].includes(userRole) || username === 'jayshree.negi'

  function startCmpEdit() {
    setCmpData({
      gst:      vendor?.gst      || '',
      pan:      vendor?.pan      || '',
      msme_no:  vendor?.msme_no  || '',
    })
    setCmpEdit(true)
  }
  function cancelCmpEdit() {
    setCmpEdit(false)
    setCmpData({})
    if (gstFileRef.current)  gstFileRef.current.value = ''
    if (msmeFileRef.current) msmeFileRef.current.value = ''
  }
  async function saveCompliance() {
    setCmpSaving(true)
    try {
      const updates = {
        gst:     cmpData.gst?.trim()     || null,
        pan:     cmpData.pan?.trim()     || null,
        msme_no: cmpData.msme_no?.trim() || null,
        updated_at: new Date().toISOString(),
      }
      const gstFile  = gstFileRef.current?.files?.[0]
      const msmeFile = msmeFileRef.current?.files?.[0]
      const upload = async (file, sub) => {
        if (file.type !== 'application/pdf') throw new Error(sub.toUpperCase() + ' must be a PDF')
        if (file.size > 5 * 1024 * 1024)     throw new Error(sub.toUpperCase() + ' must be under 5MB')
        const path = sub + '/' + id + '/' + Date.now() + '.pdf'
        const { error: upErr } = await sb.storage.from('vendor-docs').upload(path, file, { upsert: true })
        if (upErr) throw upErr
        return sb.storage.from('vendor-docs').getPublicUrl(path).data.publicUrl
      }
      if (gstFile)  updates.gst_cert_url  = await upload(gstFile,  'gst')
      if (msmeFile) updates.msme_cert_url = await upload(msmeFile, 'msme')

      const { error } = await sb.from('vendors').update(updates).eq('id', id)
      if (error) throw error
      const { data: fresh } = await sb.from('vendors').select('*').eq('id', id).single()
      setVendor(fresh || vendor)
      setEditData(fresh || vendor)
      setCmpEdit(false)
      setCmpData({})
      if (gstFileRef.current)  gstFileRef.current.value = ''
      if (msmeFileRef.current) msmeFileRef.current.value = ''
      toast('Compliance updated', 'success')
    } catch (err) {
      toast(friendlyError(err, 'Could not save compliance'))
    }
    setCmpSaving(false)
  }

  async function saveContact() {
    if (!contactForm.name.trim()) { toast('Name is required'); return }
    setSavingContact(true)
    const { data, error } = await sb.from('vendor_contacts').insert({ ...contactForm, vendor_id: id }).select().single()
    if (error) { toast(friendlyError(error)); setSavingContact(false); return }
    setContacts(p => [...p, data])
    setContactForm({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
    setShowContactModal(false); setSavingContact(false)
    toast('Contact added', 'success')
  }

  async function deleteContact(cid) {
    if (!window.confirm('Remove this contact?')) return
    await sb.from('vendor_contacts').delete().eq('id', cid)
    setContacts(p => p.filter(c => c.id !== cid))
    toast('Contact removed', 'success')
  }

  async function downloadVendorPDF(include) {
    toast('Preparing report…')
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const fmtD = s => s ? new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'
    const fmtMoney = v => (v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})
    const totalPOValue = pos.reduce((s,p)=>s+(p.total_amount||0),0)
    const openPOs = pos.filter(p=>!['closed','cancelled','received'].includes(p.status))

    const posHTML = pos.map((p,i) => `<tr>
      <td class="mono">${esc(p.po_number)}</td>
      <td style="font-size:11px;color:#64748b">${esc(p.order_number||'—')}</td>
      <td><span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:#eff6ff;color:#1d4ed8">${esc(poStatusLabel(p.status))}</span></td>
      <td style="text-align:right">${fmtD(p.po_date)}</td>
      <td style="text-align:right">${fmtD(p.expected_delivery)}</td>
      <td style="text-align:right;font-weight:600">₹${fmtMoney(p.total_amount)}</td>
    </tr>`).join('')

    const grnsHTML = grns.map((g,i) => `<tr>
      <td class="mono">${esc(g.grn_number)}</td>
      <td>${esc(g.grn_type||'—')}</td>
      <td><span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;background:#f0fdf4;color:#15803d">${esc(g.status||'—')}</span></td>
      <td style="text-align:right">${fmtD(g.received_at)}</td>
      <td style="text-align:right;font-size:11px">${esc(g.invoice_number||'—')}</td>
      <td style="text-align:right;font-weight:600">${g.invoice_amount ? '₹'+fmtMoney(g.invoice_amount) : '—'}</td>
    </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Vendor Report — ${esc(vendor.vendor_name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:900px;margin:0 auto;line-height:1.5}
.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #0f172a}
.co-name{font-size:16px;font-weight:700;margin-bottom:2px}.co-sub{font-size:11px;color:#64748b;margin-bottom:6px}.co-addr{font-size:10px;color:#475569;line-height:1.6}
.doc-title{font-size:24px;font-weight:700;text-align:right;letter-spacing:-0.5px;color:#1a4dab}
.doc-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;background:#eff6ff;color:#1a4dab;margin-bottom:6px}
.vendor-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;padding:16px 20px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0}
.vendor-name{font-size:18px;font-weight:700;margin-bottom:4px}.vendor-code{font-size:11px;color:#64748b;font-family:'Geist Mono',monospace;margin-bottom:8px}
.field-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;margin-bottom:3px}
.field-val{font-size:12px;font-weight:500;margin-bottom:10px}
.stats-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:28px}
.stat{background:#fff;padding:12px 16px}.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;margin-bottom:4px}
.stat-val{font-size:16px;font-weight:700;color:#0f172a}.stat-val.blue{color:#1a4dab}
.section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#0f172a;margin-bottom:12px;margin-top:28px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}
.items-table{width:100%;border-collapse:collapse;font-size:11px}
.items-table thead tr{border-bottom:1px solid #e2e8f0;background:#f8fafc}
.items-table th{padding:7px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;text-align:left}
.items-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
.items-table tr:last-child td{border-bottom:none}
.footer{margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}
@media print{body{padding:0;max-width:100%}@page{size:A4;margin:14mm 12mm}}
</style></head><body>
<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051</div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:80px;width:auto;display:block;margin-left:auto;margin-bottom:8px"/>
    <div class="doc-badge">Vendor Report</div>
    <div class="doc-title">Vendor 360</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">Generated: ${fmtD(new Date().toISOString())}</div>
  </div>
</div>
<div class="vendor-block">
  <div>
    <div class="vendor-name">${esc(vendor.vendor_name)}</div>
    <div class="vendor-code">${esc(vendor.vendor_code||'')}</div>
    <div class="field-label">GST</div><div class="field-val mono">${esc(vendor.gst||'—')}</div>
    <div class="field-label">Type</div><div class="field-val">${esc(vendor.vendor_type||'—')}</div>
    <div class="field-label">City</div><div class="field-val">${esc(vendor.city||'—')}</div>
  </div>
  <div>
    <div class="field-label">Credit Terms</div><div class="field-val">${esc(vendor.credit_terms||'—')}</div>
    <div class="field-label">Account Owner</div><div class="field-val">${esc(vendor.account_owner||'—')}</div>
    <div class="field-label">POC</div><div class="field-val">${esc(vendor.poc_name||'—')}${vendor.poc_no?` · ${esc(vendor.poc_no)}`:''}</div>
    <div class="field-label">Address</div><div class="field-val">${esc(vendor.address||'—')}</div>
  </div>
</div>
<div class="stats-bar">
  <div class="stat"><div class="stat-label">Total POs</div><div class="stat-val">${pos.length}</div></div>
  <div class="stat"><div class="stat-label">Open POs</div><div class="stat-val blue">${openPOs.length}</div></div>
  <div class="stat"><div class="stat-label">Total PO Value</div><div class="stat-val">₹${fmtMoney(totalPOValue)}</div></div>
  <div class="stat"><div class="stat-label">GRNs</div><div class="stat-val">${grns.length}</div></div>
</div>
${include.pos ? `
<div class="section-title">Purchase Orders (${pos.length})</div>
${pos.length === 0 ? '<div style="font-size:12px;color:#94a3b8;font-style:italic">No purchase orders</div>' : `
<table class="items-table">
  <thead><tr><th>PO #</th><th>Linked Order</th><th>Status</th><th style="text-align:right">PO Date</th><th style="text-align:right">Expected Delivery</th><th style="text-align:right">Value (₹)</th></tr></thead>
  <tbody>${posHTML}</tbody>
</table>`}` : ''}
${include.grns ? `
<div class="section-title">GRNs (${grns.length})</div>
${grns.length === 0 ? '<div style="font-size:12px;color:#94a3b8;font-style:italic">No GRNs</div>' : `
<table class="items-table">
  <thead><tr><th>GRN #</th><th>Type</th><th>Status</th><th style="text-align:right">Received</th><th style="text-align:right">Invoice #</th><th style="text-align:right">Invoice Amount</th></tr></thead>
  <tbody>${grnsHTML}</tbody>
</table>`}` : ''}
<div class="footer">
  <div>SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE</div>
  <div>sales@ssccontrol.com &nbsp;|&nbsp; www.ssccontrol.com</div>
</div>
</body></html>`

    const w = window.open('', '_blank')
    if (!w) { toast('Popup blocked — allow popups and try again'); return }
    w.document.write(html)
    w.document.close()
    w.onload = () => w.print()
  }

  if (loading) return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="c360-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/></div></div>
    </Layout>
  )
  if (!vendor) return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="c360-page"><div className="c360-empty" style={{paddingTop:80}}><div className="c360-empty-icon">🏭</div>Vendor not found</div></div>
    </Layout>
  )

  const openPos      = pos.filter(p => !['received','closed','cancelled'].includes(p.status))
  const closedPos    = pos.filter(p => ['received','closed'].includes(p.status))
  const totalPOValue = pos.filter(p => p.status !== 'cancelled').reduce((s,p) => s + (p.total_amount||0), 0)
  const openPOValue  = openPos.reduce((s,p) => s + (p.total_amount||0), 0)
  const initials     = vendor.vendor_name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  const avatarBg     = ownerColor(vendor.vendor_name)
  const isActive     = vendor.account_status === 'Active' || vendor.status === 'active'

  const tabs = [
    { key:'summary',  label:'Summary' },
    { key:'contacts', label:'Contacts', count: contacts.length },
    { key:'pos',      label:'Purchase Orders', count: pos.length },
    { key:'grns',     label:'GRNs', count: grns.length },
  ]

  return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="c360-page">
        <div className="c360-body">

          {/* ── Hero ── */}
          <div className="c360-hero">
            <div className="c360-hero-top">
              <div className="c360-hero-avatar" style={{ background: avatarBg }}>{initials}</div>
              <div className="c360-hero-info">
                <div className="c360-hero-name">{vendor.vendor_name}</div>
                {vendor.vendor_code && <div style={{ fontSize:12, fontWeight:600, color:'var(--gray-400)', fontFamily:'var(--mono)', marginBottom:6 }}>{vendor.vendor_code}</div>}
                <div className="c360-hero-badges">
                  {vendor.vendor_type    && <span className="c360-badge c360-badge-blue">{vendor.vendor_type}</span>}
                  <span className={'c360-badge ' + (isActive ? 'c360-badge-green' : 'c360-badge-amber')}>{isActive ? 'Active' : vendor.account_status || 'Inactive'}</span>
                  {vendor.credit_terms   && <span className="c360-badge c360-badge-gray">{vendor.credit_terms}</span>}
                  {vendor.approval_status === 'pending' && <span className="c360-badge c360-badge-amber">⏳ Pending Approval</span>}
                </div>
              </div>
              <div className="c360-hero-actions">
                <button className="c360-btn" onClick={() => navigate('/vendors')}>← Back</button>
                <button className="c360-btn" onClick={() => setShowPdfModal(true)} style={{ gap:5, display:'flex', alignItems:'center' }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Download Report
                </button>
                {userRole === 'admin' && vendor.approval_status === 'pending' && (
                  <>
                    <button className="c360-btn c360-btn-danger" onClick={reject} disabled={approving}>Reject</button>
                    <button className="c360-btn c360-btn-approve" onClick={approve} disabled={approving}>{approving?'…':'Approve'}</button>
                  </>
                )}
                {userRole === 'admin' && vendor.approval_status !== 'pending' && (
                  !editMode
                    ? <button className="c360-btn" onClick={() => setEditMode(true)}>Edit</button>
                    : <>
                        <button className="c360-btn" onClick={() => { setEditMode(false); setEditData(vendor) }}>Cancel</button>
                        <button className="c360-btn c360-btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
                      </>
                )}
              </div>
            </div>

            {/* ── Stats ── */}
            <div className="c360-stats">
              <div className="c360-stat">
                <span className="c360-stat-label">Total POs</span>
                <span className="c360-stat-value">{pos.length}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Open POs</span>
                <span className={'c360-stat-value' + (openPos.length > 0 ? ' accent' : '')}>{openPos.length}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Open PO Value</span>
                <span className={'c360-stat-value' + (openPos.length > 0 ? ' accent' : '')} style={{ fontSize:14 }}>{fmtINR(openPOValue)}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Total PO Value</span>
                <span className="c360-stat-value green" style={{ fontSize:14 }}>{fmtINR(totalPOValue)}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">GRNs</span>
                <span className="c360-stat-value">{grns.length}</span>
              </div>
              {vendor.turnover && (
                <div className="c360-stat">
                  <span className="c360-stat-label">Turnover</span>
                  <span className="c360-stat-value" style={{ fontSize:14 }}>{vendor.turnover}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="c360-tabs">
            {tabs.map(t => (
              <button key={t.key} className={'c360-tab' + (activeTab===t.key?' active':'')} onClick={() => setActiveTab(t.key)}>
                {t.label}
                {t.count !== undefined && <span className="c360-tab-count">{t.count}</span>}
              </button>
            ))}
          </div>

          {/* ── Content ── */}
          <div className="c360-content">

            {/* ══ SUMMARY ══ */}
            {activeTab === 'summary' && (
              <div className="c360-summary-grid">

                {/* Left */}
                <div>
                  <div className="c360-card">
                    <div className="c360-card-header">
                      <div className="c360-card-title">Vendor Details</div>
                    </div>
                    <div className="c360-card-body">
                      {editMode ? (
                        <VendorEditForm editData={editData} setEditData={setEditData} />
                      ) : (
                        <>
                          <div className="c360-section-label">Vendor Info</div>
                          <div className="c360-field-grid">
                            <Field label="Vendor Name"       val={vendor.vendor_name} />
                            <Field label="Vendor Code"       val={vendor.vendor_code} mono />
                            <Field label="Account Status"    val={vendor.account_status || (vendor.status === 'active' ? 'Active' : 'Inactive')} />
                            <Field label="Vendor Type"       val={vendor.vendor_type} />
                            <Field label="Credit Terms"      val={vendor.credit_terms} />
                            <Field label="Premises"          val={vendor.premises} />
                            <Field label="Annual Turnover"   val={vendor.turnover} />
                            <Field label="Year Established"  val={vendor.year_established} />
                          </div>

                          <div className="c360-section-label">Tax & Compliance</div>
                          <div className="c360-field-grid">
                            <Field label="GST Number" val={vendor.gst} mono />
                            <Field label="PAN Number"  val={vendor.pan} mono />
                            <Field label="MSME No."    val={vendor.msme_no} />
                            <div className="c360-field">
                              <label>GST Certificate</label>
                              <div className="val">
                                {vendor.gst_cert_url
                                  ? <a href={vendor.gst_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                      View PDF
                                    </a>
                                  : <span style={{ color:'var(--gray-300)' }}>—</span>}
                              </div>
                            </div>
                            {vendor.msme_cert_url && (
                              <div className="c360-field">
                                <label>MSME Certificate</label>
                                <div className="val">
                                  <a href={vendor.msme_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                    View PDF
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>

                          {canEditCompliance && (
                            <>
                              <div className="c360-section-label" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                                <span>Compliance Documents (Admin)</span>
                                {!cmpEdit
                                  ? <button onClick={startCmpEdit} className="c360-btn" style={{padding:'4px 10px',fontSize:11}}>Edit</button>
                                  : <span style={{display:'flex',gap:6}}>
                                      <button onClick={cancelCmpEdit} disabled={cmpSaving} className="c360-btn" style={{padding:'4px 10px',fontSize:11}}>Cancel</button>
                                      <button onClick={saveCompliance} disabled={cmpSaving} className="c360-btn c360-btn-primary" style={{padding:'4px 10px',fontSize:11}}>{cmpSaving ? 'Saving…' : 'Save'}</button>
                                    </span>
                                }
                              </div>
                              <div className="c360-field-grid">
                                {/* GST Number */}
                                <div className="c360-field">
                                  <label>GST Number</label>
                                  <div className="val">
                                    {cmpEdit
                                      ? <input value={cmpData.gst || ''} onChange={e => setCmpData(d => ({...d, gst: e.target.value}))} placeholder="24ABCDE1234F1Z5" style={{width:'100%',padding:'6px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontFamily:'var(--mono)',fontSize:12}}/>
                                      : <span style={{fontFamily:'var(--mono)'}}>{vendor.gst || <span style={{color:'var(--gray-300)'}}>Not provided</span>}</span>}
                                  </div>
                                </div>
                                {/* GST Certificate */}
                                <div className="c360-field">
                                  <label>GST Certificate</label>
                                  <div className="val" style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                    {vendor.gst_cert_url
                                      ? <a href={vendor.gst_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                          View current
                                        </a>
                                      : <span style={{color:'var(--gray-300)',fontSize:12}}>Not uploaded</span>}
                                    {cmpEdit && <input ref={gstFileRef} type="file" accept="application/pdf" style={{fontSize:11}}/>}
                                  </div>
                                </div>
                                {/* MSME Number */}
                                <div className="c360-field">
                                  <label>MSME Number</label>
                                  <div className="val">
                                    {cmpEdit
                                      ? <input value={cmpData.msme_no || ''} onChange={e => setCmpData(d => ({...d, msme_no: e.target.value}))} placeholder="UDYAM-XX-00-0000000" style={{width:'100%',padding:'6px 8px',border:'1px solid var(--gray-200)',borderRadius:6,fontFamily:'var(--mono)',fontSize:12}}/>
                                      : <span style={{fontFamily:'var(--mono)'}}>{vendor.msme_no || <span style={{color:'var(--gray-300)'}}>Not provided</span>}</span>}
                                  </div>
                                </div>
                                {/* MSME Certificate */}
                                <div className="c360-field">
                                  <label>MSME Certificate</label>
                                  <div className="val" style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                    {vendor.msme_cert_url
                                      ? <a href={vendor.msme_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                          View current
                                        </a>
                                      : <span style={{color:'var(--gray-300)',fontSize:12}}>Not uploaded</span>}
                                    {cmpEdit && <input ref={msmeFileRef} type="file" accept="application/pdf" style={{fontSize:11}}/>}
                                  </div>
                                </div>
                              </div>
                            </>
                          )}

                          <div className="c360-section-label">Addresses</div>
                          <div className="c360-field-grid">
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Billing Address</label>
                              <div className="val" style={{ lineHeight:1.5 }}>{vendor.billing_address||'—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Shipping Address</label>
                              <div className="val" style={{ lineHeight:1.5 }}>{vendor.shipping_address||'—'}</div>
                            </div>
                          </div>

                          <div className="c360-section-label">Point of Contact</div>
                          <div className="c360-field-grid">
                            <Field label="POC Name" val={vendor.poc_name} />
                            <div className="c360-field">
                              <label>POC Phone</label>
                              <div className="val">{vendor.poc_phone ? <a href={'tel:'+vendor.poc_phone} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.poc_phone}</a> : '—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>POC Email</label>
                              <div className="val">{vendor.poc_email ? <a href={'mailto:'+vendor.poc_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.poc_email}</a> : '—'}</div>
                            </div>
                          </div>

                          <div className="c360-section-label">Director / Decision Maker</div>
                          <div className="c360-field-grid">
                            <Field label="Director Name" val={vendor.director_name} />
                            <div className="c360-field">
                              <label>Director Phone</label>
                              <div className="val">{vendor.director_no ? <a href={'tel:'+vendor.director_no} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.director_no}</a> : '—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Director Email</label>
                              <div className="val">{vendor.director_email ? <a href={'mailto:'+vendor.director_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{vendor.director_email}</a> : '—'}</div>
                            </div>
                          </div>

                          {/* VI Notes */}
                          {(vendor.vi_shopfloor || vendor.vi_payment || vendor.vi_expected_business) && (
                            <div className="c360-vi-card">
                              <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                Visual Inspection Notes
                              </div>
                              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                                {vendor.vi_shopfloor         && <div><div className="c360-vi-label">Shopfloor</div><div className="c360-vi-text">{vendor.vi_shopfloor}</div></div>}
                                {vendor.vi_payment           && <div><div className="c360-vi-label">Payment</div><div className="c360-vi-text">{vendor.vi_payment}</div></div>}
                                {vendor.vi_expected_business && <div><div className="c360-vi-label">Expected Business</div><div className="c360-vi-text">{vendor.vi_expected_business}</div></div>}
                              </div>
                            </div>
                          )}

                          {/* Notes */}
                          {vendor.notes && (
                            <div style={{ marginTop:14, background:'var(--gray-50)', border:'1px solid var(--gray-100)', borderRadius:10, padding:'12px 14px' }}>
                              <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:6 }}>Notes</div>
                              <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{vendor.notes}</div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right */}
                <div>
                  {/* Primary Contact */}
                  {(vendor.poc_name || contacts.length > 0) && (
                    <div className="c360-side-card">
                      <div className="c360-side-title">Primary Contact</div>
                      {(() => {
                        const pc = contacts[0]
                        const name  = pc?.name  || vendor.poc_name
                        const title = pc?.designation || ''
                        const phone = pc?.phone || vendor.poc_phone
                        const email = pc?.email || vendor.poc_email
                        if (!name) return null
                        const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
                        return (
                          <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                            <div style={{ width:44, height:44, borderRadius:12, background:ownerColor(name), color:'white', fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
                            <div>
                              <div style={{ fontSize:14, fontWeight:700, color:'var(--gray-900)' }}>{name}</div>
                              {title && <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:2 }}>{title}</div>}
                              {phone && <a href={'tel:'+phone} style={{ display:'block', fontSize:13, color:'#1a4dab', marginTop:6, fontWeight:600, textDecoration:'none' }}>{phone}</a>}
                              {email && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>{email}</div>}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* Key Info */}
                  <div className="c360-side-card">
                    <div className="c360-side-title">Key Info</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      <SideRow label="Completed POs"  val={closedPos.length} />
                      <SideRow label="Cancelled POs"  val={pos.filter(p=>p.status==='cancelled').length} />
                      <SideRow label="Total GRNs"     val={grns.length} />
                      <SideRow label="Total PO Value" val={fmtINR(totalPOValue)} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ CONTACTS ══ */}
            {activeTab === 'contacts' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Contacts ({contacts.length})</div>
                  {['ops','admin'].includes(userRole) && (
                    <button className="c360-btn c360-btn-primary" onClick={() => setShowContactModal(true)}>+ Add Contact</button>
                  )}
                </div>
                {contacts.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">👤</div>No contacts added yet.</div>
                ) : (
                  <div className="c360-contact-grid">
                    {contacts.map(c => (
                      <div key={c.id} className="c360-contact-card" style={{ position:'relative' }}>
                        <div className="c360-contact-avatar">
                          {c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="c360-contact-name">{c.name}</div>
                          {c.designation && <div className="c360-contact-title">{c.designation}</div>}
                          {c.phone    && <a href={'tel:'+c.phone}    className="c360-contact-phone">{c.phone}</a>}
                          {c.whatsapp && <a href={'https://wa.me/'+c.whatsapp.replace(/\D/g,'')} className="c360-contact-phone" target="_blank" rel="noopener noreferrer" style={{ color:'#059669' }}>WhatsApp</a>}
                          {c.email    && <a href={'mailto:'+c.email} className="c360-contact-email">{c.email}</a>}
                        </div>
                        {['ops','admin'].includes(userRole) && (
                          <button onClick={() => deleteContact(c.id)} style={{ position:'absolute', top:10, right:10, background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:16, lineHeight:1 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══ PURCHASE ORDERS ══ */}
            {activeTab === 'pos' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Purchase Orders ({pos.length})</div>
                  <span style={{ fontSize:12, color:'var(--gray-500)', fontWeight:600 }}>Total: {fmtINR(totalPOValue)}</span>
                </div>
                {pos.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">📋</div>No purchase orders found.</div>
                ) : (
                  <table className="c360-table">
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
                      {pos.map(p => (
                        <tr key={p.id} onClick={() => navigate('/procurement/po/'+p.id)} style={{ cursor:'pointer' }}>
                          <td className="mono" style={{ color:'#1a4dab', fontWeight:700 }}>{p.po_number}</td>
                          <td style={{ fontSize:12, color:'var(--gray-500)' }}>{p.order_number||'—'}</td>
                          <td>
                            <span className={'od-status-badge '+poStatusClass(p.status)} style={{ fontSize:10 }}>{poStatusLabel(p.status)}</span>
                          </td>
                          <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{fmt(p.po_date)}</td>
                          <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{p.expected_delivery?fmt(p.expected_delivery):'—'}</td>
                          <td style={{ textAlign:'right', fontWeight:600 }}>{fmtINR(p.total_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ══ GRNs ══ */}
            {activeTab === 'grns' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Goods Received Notes ({grns.length})</div>
                </div>
                {grns.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">📦</div>No GRNs recorded.</div>
                ) : (
                  <table className="c360-table">
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
                        <tr key={g.id} onClick={() => navigate('/fc/grn/'+g.id)} style={{ cursor:'pointer' }}>
                          <td className="mono" style={{ color:'#1a4dab', fontWeight:700 }}>{g.grn_number}</td>
                          <td style={{ fontSize:12 }}>{g.grn_type?.replace(/_/g,' ')||'—'}</td>
                          <td>
                            <span className={'od-status-badge '+(g.status==='confirmed'?'active':'pending')} style={{ fontSize:10 }}>{g.status}</span>
                          </td>
                          <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{fmt(g.received_at)}</td>
                          <td style={{ fontSize:12 }}>{g.invoice_number||'—'}</td>
                          <td style={{ textAlign:'right', fontWeight:600 }}>{g.invoice_amount?fmtINR(g.invoice_amount):'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Download PDF Modal */}
      {showPdfModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={() => setShowPdfModal(false)}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:360, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Download Vendor Report</div>
              <button onClick={() => setShowPdfModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:10 }}>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>Select sections to include:</div>
              {[['pos','Purchase Orders'],['grns','GRNs']].map(([key,label]) => (
                <label key={key} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'10px 14px', borderRadius:8, border:'1px solid', borderColor: pdfInclude[key] ? '#1a4dab' : '#e2e8f0', background: pdfInclude[key] ? '#eff6ff' : '#f8fafc' }}>
                  <input type="checkbox" checked={pdfInclude[key]} onChange={e => setPdfInclude(p => ({ ...p, [key]: e.target.checked }))} style={{ accentColor:'#1a4dab', width:15, height:15 }} />
                  <span style={{ fontSize:13, fontWeight:600, color: pdfInclude[key] ? '#1a4dab' : '#475569' }}>{label}</span>
                </label>
              ))}
            </div>
            <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowPdfModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={() => { setShowPdfModal(false); downloadVendorPDF(pdfInclude) }} disabled={!pdfInclude.pos && !pdfInclude.grns}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#1e3a5f', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity:(!pdfInclude.pos&&!pdfInclude.grns)?0.4:1 }}>
                Download PDF
              </button>
            </div>
          </div>
        </div>
      )}

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
              {[['name','Name *','text'],['designation','Title / Designation','text'],['phone','Phone','tel'],['whatsapp','WhatsApp','tel'],['email','Email','email']].map(([field,label,type]) => (
                <div key={field}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
                  <input type={type} value={contactForm[field]} onChange={e => setContactForm(p => ({ ...p, [field]: e.target.value }))}
                    style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowContactModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={saveContact} disabled={savingContact||!contactForm.name.trim()}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#1e3a5f', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity:contactForm.name.trim()?1:0.4 }}>
                {savingContact?'Saving…':'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}

function Field({ label, val, mono }) {
  return (
    <div className="c360-field">
      <label>{label}</label>
      <div className="val" style={mono ? { fontFamily:'var(--mono)', fontSize:12, letterSpacing:'0.3px' } : {}}>{val||'—'}</div>
    </div>
  )
}

function SideRow({ label, val, accent }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span style={{ fontSize:12, color:'var(--gray-500)' }}>{label}</span>
      <span style={{ fontSize:13, fontWeight:700, color: accent ? '#1a4dab' : 'var(--gray-900)' }}>{val}</span>
    </div>
  )
}

function VendorEditForm({ editData, setEditData }) {
  const set = (k,v) => setEditData(p => ({ ...p, [k]: v }))
  const inp = (label, key, type='text', ph='') => (
    <div className="od-edit-field"><label>{label}</label><input type={type} value={editData[key]||''} onChange={e => set(key, e.target.value)} placeholder={ph} /></div>
  )
  const sel = (label, key, opts) => (
    <div className="od-edit-field">
      <label>{label}</label>
      <select value={editData[key]||''} onChange={e => set(key, e.target.value)} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
        <option value="">— Select —</option>
        {opts.map(o => <option key={o}>{o}</option>)}
      </select>
    </div>
  )
  const ta = (label, key, ph) => (
    <div className="od-edit-field"><label>{label}</label><textarea value={editData[key]||''} onChange={e => set(key, e.target.value)} placeholder={ph} /></div>
  )
  return (
    <div className="od-edit-form">
      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:8 }}>Vendor Info</div>
      <div className="od-edit-row">{inp('Vendor Name','vendor_name')}{sel('Account Status','account_status',['Active','Dormant'])}</div>
      <div className="od-edit-row">
        {sel('Vendor Type','vendor_type',['Manufacturer','Distributor','Agent'])}
      </div>
      <div className="od-edit-row">
        {sel('Credit Terms','credit_terms',['Against PI','Advance','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery'])}
        {sel('Premises','premises',['Owned','Rented','Leased'])}
      </div>
      <div className="od-edit-row">{inp('Annual Turnover','turnover','text','e.g. 2 Cr, 50L')}{inp('Year of Establishment','year_established','number','e.g. 2005')}</div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Tax & Compliance</div>
      <div className="od-edit-row">{inp('GST Number','gst','text','24ABCDE1234F1Z5')}{inp('PAN Number','pan','text','ABCDE1234F')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('MSME No.','msme_no')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Addresses</div>
      {ta('Billing Address','billing_address','Full billing address')}
      <div style={{ marginTop:8 }}>{ta('Shipping Address','shipping_address','Full shipping address')}</div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Point of Contact</div>
      <div className="od-edit-row">{inp('POC Name','poc_name')}{inp('POC Phone','poc_phone','tel')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('POC Email','poc_email','email')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Director / Decision Maker</div>
      <div className="od-edit-row">{inp('Director Name','director_name')}{inp('Director Phone','director_no','tel')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('Director Email','director_email','email')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', margin:'16px 0 8px' }}>Visual Inspection Notes</div>
      <div style={{ marginBottom:8 }}>{ta('Shopfloor Observation','vi_shopfloor','e.g. Well-organized warehouse, active production lines…')}</div>
      <div style={{ marginBottom:8 }}>{ta('Payment Assessment','vi_payment','e.g. Payment cycle 30 days, financially stable…')}</div>
      {ta('Expected Business','vi_expected_business','e.g. Annual procurement potential ₹15–20L…')}

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Notes</div>
      {ta('Notes','notes','Any notes about this vendor...')}
    </div>
  )
}
