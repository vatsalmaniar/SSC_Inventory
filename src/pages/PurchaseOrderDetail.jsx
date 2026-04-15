import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { fmtShort, fmtDateTime, esc } from '../lib/fmt'
import { toast } from '../lib/toast'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/neworder.css'

const PO_STATUS_LABELS = {
  draft:'PO Created', pending_approval:'Pending Approval', approved:'PO Approved',
  placed:'Order Placed', acknowledged:'Acknowledgement',
  delivery_confirmation:'Delivery Confirmation', material_received:'Material Received',
  closed:'Closed', cancelled:'Cancelled',
}
const PO_PIPE_LABELS = {
  draft:'Created', pending_approval:'Approval', approved:'Approved',
  placed:'Placed', acknowledged:'Acknowledged',
  delivery_confirmation:'Delivery', material_received:'Received', closed:'Closed',
}
const PIPELINE = ['draft','pending_approval','approved','placed','acknowledged','delivery_confirmation','material_received','closed']
const FC_OPTIONS = ['Kaveri','Godawari']

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function OwnerChip({ name }) {
  if (!name) return <span style={{ color:'var(--gray-300)' }}>—</span>
  const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(name), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
      <span style={{ fontSize:13, fontWeight:500, color:'var(--gray-800)' }}>{name}</span>
    </div>
  )
}

function fmtINR(val) {
  if (!val && val !== 0) return '—'
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function emptyItem() {
  return { _new: true, item_code: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', delivery_date: '', order_item_id: null }
}

export default function PurchaseOrderDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [po, setPo]               = useState(null)
  const [vendorCode, setVendorCode] = useState('')
  const [items, setItems]         = useState([])
  const [grns, setGrns] = useState([])
  const [grnItemsByPOItem, setGrnItemsByPOItem] = useState({})
  const [purchaseInvoices, setPurchaseInvoices] = useState([])
  const [deliveryDates, setDeliveryDates] = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [userRole, setUserRole]   = useState('')
  const [userName, setUserName]   = useState('')

  // Edit mode
  const [editMode, setEditMode]   = useState(false)
  const [editForm, setEditForm]   = useState({})
  const [editItems, setEditItems] = useState([])

  // Modals
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [newDeliveryDate, setNewDeliveryDate]     = useState('')
  const [deliveryReason, setDeliveryReason]       = useState('')
  const [showCancelModal, setShowCancelModal]     = useState(false)
  const [cancelReason, setCancelReason]           = useState('')
  const [showEditConfirm, setShowEditConfirm]     = useState(false)

  // Acknowledgement modal
  const [showAckModal, setShowAckModal]           = useState(false)
  const [ackFile, setAckFile]                     = useState(null)
  const [ackFileName, setAckFileName]             = useState('')

  // Delivery confirmation — per-item dates
  const [deliveryItemDates, setDeliveryItemDates] = useState([])

  // Comments
  const [comments, setComments]       = useState([])
  const [commentText, setCommentText] = useState('')
  const [postingComment, setPostingComment] = useState(false)
  const [allUsers, setAllUsers]       = useState([])
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionSuggestions, setMentionSuggestions] = useState([])
  const [mentionPos, setMentionPos]   = useState({ top:0, left:0, width:200 })
  const commentInputRef = useRef(null)

  useEffect(() => { init() }, [id])

  // Realtime: live PO detail updates
  useRealtimeSubscription(`po-${id}`, {
    table: 'purchase_orders', filter: `id=eq.${id}`, event: 'UPDATE',
    enabled: !!id, onEvent: () => loadPO(true),
  })

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['ops','admin'].includes(profile?.role)) { navigate('/dashboard'); return }
    setUserRole(profile?.role || '')
    setUserName(profile?.name || '')
    const { data: users } = await sb.from('profiles').select('id,name,username')
    setAllUsers(users || [])
    await loadPO()
  }

  async function loadPO(silent) {
    if (!silent) setLoading(true)
    const poRes = await sb.from('purchase_orders').select('*').eq('id', id).single()
    if (poRes.error || !poRes.data) { setPo(null); setLoading(false); return }
    setPo(poRes.data)
    // Non-blocking vendor code lookup
    if (poRes.data?.vendor_id) {
      sb.from('vendors').select('vendor_code').eq('id', poRes.data.vendor_id).maybeSingle().then(({ data: v }) => setVendorCode(v?.vendor_code || ''))
    }
    const [itemsRes, datesRes, commentsRes] = await Promise.all([
      sb.from('po_items').select('*').eq('po_id', id).order('sr_no'),
      sb.from('po_delivery_dates').select('*').eq('po_id', id).order('created_at', { ascending: false }).then(r => r).catch(() => ({ data: [] })),
      sb.from('po_comments').select('*').eq('po_id', id).order('created_at').then(r => r).catch(() => ({ data: [] })),
    ])
    setItems(itemsRes.data || [])
    setDeliveryDates(datesRes.data || [])
    setComments(commentsRes.data || [])

    // Fetch GRNs linked to this PO via grn_items
    try {
      const { data: grnItems } = await sb.from('grn_items').select('*,grn:grn_id(id,grn_number,grn_type,status,received_by,received_at)').eq('po_id', id)
      if (grnItems && grnItems.length) {
        // Unique GRNs
        const grnMap = {}
        const byPoItem = {}
        for (const gi of grnItems) {
          if (gi.grn) {
            grnMap[gi.grn.id] = gi.grn
            // Group by po_item_id for delivery history
            const key = gi.po_item_id || gi.item_code
            if (!byPoItem[key]) byPoItem[key] = []
            byPoItem[key].push({ ...gi, grn_number: gi.grn.grn_number, received_at: gi.grn.received_at, received_by: gi.grn.received_by })
          }
        }
        setGrns(Object.values(grnMap))
        setGrnItemsByPOItem(byPoItem)
      } else {
        setGrns([])
        setGrnItemsByPOItem({})
      }
    } catch { setGrns([]); setGrnItemsByPOItem({}) }

    // Fetch purchase invoices linked to this PO
    try {
      const { data: piData } = await sb.from('purchase_invoices').select('*').eq('po_id', id).order('created_at')
      setPurchaseInvoices(piData || [])
    } catch { setPurchaseInvoices([]) }

    setLoading(false)
  }

  // ── Status transitions ──
  async function updateStatus(newStatus, extra = {}) {
    setSaving(true)
    const updates = { status: newStatus, updated_at: new Date().toISOString(), ...extra }
    const { error } = await sb.from('purchase_orders').update(updates).eq('id', id)
    if (error) { toast('Failed: ' + error.message); setSaving(false); return }
    await logActivity(`Status changed to ${PO_STATUS_LABELS[newStatus] || newStatus}`)
    toast('Status updated to ' + (PO_STATUS_LABELS[newStatus] || newStatus), 'success')
    setSaving(false)
    await loadPO()
  }

  async function logActivity(message) {
    try { await sb.from('po_comments').insert({ po_id: id, author_name: userName, message, is_activity: true }) } catch(e) { console.error('logActivity:', e) }
  }

  // ── Stage 2: PO Approved — generate PO number + PDF ──
  async function handleApprove() {
    setSaving(true)
    // Generate PO number at approval
    const isCO = po.po_number?.startsWith('Temp/PCO') || po.order_id
    const { data: poNum, error: rpcErr } = await sb.rpc('next_po_number', { p_is_co: !!isCO })
    if (rpcErr) { toast('Error generating PO number: ' + rpcErr.message); setSaving(false); return }

    // Generate PO PDF
    let poPdfUrl = null
    try { poPdfUrl = await generatePoPdf(poNum) } catch (err) { console.error('PDF generation failed:', err) }

    await updateStatus('approved', {
      po_number: poNum,
      approved_by: userName,
      approved_at: new Date().toISOString(),
      ...(poPdfUrl && { po_pdf_url: poPdfUrl }),
    })
    setSaving(false)
  }

  function numToWords(n) {
    const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
    const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
    function conv(n) {
      if (n === 0) return ''
      if (n < 20) return a[n]
      if (n < 100) return b[Math.floor(n/10)] + (n%10 ? ' ' + a[n%10] : '')
      if (n < 1000) return a[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + conv(n%100) : '')
      if (n < 100000) return conv(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + conv(n%1000) : '')
      if (n < 10000000) return conv(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + conv(n%100000) : '')
      return conv(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + conv(n%10000000) : '')
    }
    const r = Math.floor(n), p = Math.round((n - r) * 100)
    return 'Rupees ' + conv(r) + (p > 0 ? ' and ' + conv(p) + ' Paise' : '') + ' Only'
  }

  function fmtDC(d) {
    if (!d) return '—'
    const dt = new Date(d)
    return dt.getDate().toString().padStart(2,'0') + '.' + (dt.getMonth()+1).toString().padStart(2,'0') + '.' + dt.getFullYear()
  }

  function buildPoHtml(poNumber) {
    const FC_ADDRESSES = {
      Kaveri: '17(A) Ashwamegh Warehouse, Behind New Ujala Hotel,\nSarkhej Bavla Highway, Sarkhej, Ahmedabad – 382 210',
      Godawari: '31 GIDC Estate, B/h Bank Of Baroda,\nMakarpura, Vadodara – 390 010',
    }
    const deliveryAddr = po.delivery_address || FC_ADDRESSES[po.fulfilment_center] || po.fulfilment_center || '—'
    const subtotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0)
    const grandTotal = Number(po.total_amount) || subtotal
    const poDate = fmtDC(po.po_date || po.created_at)
    const isCO = (po.po_type === 'CO')

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Purchase Order — ${poNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'DM Sans',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5}
  .mono{font-family:'DM Mono',monospace}

  /* Header */
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .co-name{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:2px}
  .co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
  .co-addr{font-size:10.5px;color:#475569;line-height:1.6}
  .doc-title{font-size:28px;font-weight:700;color:#0f172a;text-align:right;letter-spacing:-0.5px}
  .doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;
    background:${isCO?'#f0fdf4':'#eff6ff'};color:${isCO?'#15803d':'#1d4ed8'};text-align:right}

  /* Divider */
  .divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}

  /* Meta grid */
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
  .meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
  .meta-addr{font-size:11px;color:#475569;line-height:1.6}

  .ref-table{width:100%;border-collapse:collapse}
  .ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
  .ref-table tr td:first-child{color:#64748b;width:45%}
  .ref-table tr td:last-child{font-weight:600;color:#0f172a}

  /* Terms row */
  .terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}
  .terms span strong{color:#0f172a;font-weight:600}

  /* Items table */
  table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
  table.items thead tr{border-bottom:2px solid #0f172a}
  table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
  table.items th.r{text-align:right}
  table.items th.c{text-align:center}
  table.items tbody tr{border-bottom:1px solid #f1f5f9}
  table.items tbody tr:last-child{border-bottom:none}
  table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
  table.items td.r{text-align:right}
  table.items td.c{text-align:center}
  table.items td.code{font-family:'DM Mono',monospace;font-size:11px;font-weight:500}

  /* Totals */
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:12px}
  .totals-table{width:300px;border-collapse:collapse}
  .totals-table td{padding:5px 0;font-size:11.5px}
  .totals-table td.lbl{color:#64748b}
  .totals-table td.val{text-align:right;font-weight:500}
  .totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}

  /* Words */
  .words{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}

  /* Notes */
  .notes-box{margin:12px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px}

  /* Signatures */
  .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}
  .sig-cell{text-align:center;font-size:10px;color:#64748b}
  .sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}
  .sig-name{font-weight:600;color:#0f172a;font-size:11px}

  /* Footer */
  .footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:10px;color:#94a3b8;line-height:1.6}
  .footer-right{font-size:10px;color:#94a3b8;text-align:right}

  @media print{
    body{padding:0;max-width:100%}
    @page{size:A4;margin:16mm 14mm}
  }
</style>
</head>
<body>

<!-- Header -->
<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Industrial Automation &amp; Electrification</div>
    <div class="co-addr">
      E/12, Siddhivinayak Towers, B/H DCP Office<br/>
      Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
      GSTIN: 24ABGCS0605M1ZE
    </div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/ssc-logo.svg" alt="SSC" style="height:52px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">${isCO ? 'Customer Order' : 'Stock Order'}</div>
    <div class="doc-title">Purchase Order</div>
  </div>
</div>

<hr class="divider"/>

<!-- Vendor + Reference -->
<div class="meta-grid">
  <div>
    <div class="meta-section-label">Vendor</div>
    <div class="meta-name">${esc(po.vendor_name) || '—'}</div>
    ${vendorCode ? `<div style="font-size:11px;color:#475569;margin-top:2px">Vendor Code: <strong style="font-family:'DM Mono',monospace">${esc(vendorCode)}</strong></div>` : ''}
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>PO No.</td><td class="mono">${esc(poNumber)}</td></tr>
      <tr><td>PO Date</td><td>${poDate}</td></tr>
      ${po.order_number ? `<tr><td>Linked Order</td><td class="mono">${esc(po.order_number)}</td></tr>` : ''}
      ${po.reference && !po.order_number ? `<tr><td>Reference</td><td>${esc(po.reference)}</td></tr>` : ''}
      <tr><td>Deliver To</td><td>${po.fulfilment_center === 'Customer' ? esc(po.delivery_customer_name || 'Customer') : (esc(po.fulfilment_center) || '—')}</td></tr>
    </table>
  </div>
</div>

<hr class="divider"/>

<!-- Terms -->
<div class="terms">
  <span>Payment terms: <strong>${esc(po.payment_terms) || '—'}</strong></span>
  <span>Currency: <strong>INR</strong></span>
</div>

<!-- Deliver To -->
<div style="margin-bottom:20px">
  <div class="meta-section-label">Deliver To</div>
  <div class="meta-addr">${po.fulfilment_center === 'Customer' ? esc(po.delivery_customer_name || '') : 'SSC Control Pvt. Ltd.'}<br/>${deliveryAddr.replace(/\n/g,'<br/>')}</div>
</div>

<!-- Items -->
<table class="items">
  <thead>
    <tr>
      <th style="width:40px">#</th>
      <th>Item Code</th>
      <th class="c" style="width:60px">Qty</th>
      <th class="r" style="width:90px">LP Price</th>
      <th class="c" style="width:60px">Disc %</th>
      <th class="r" style="width:90px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
      <th class="c" style="width:90px">Delivery</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, idx) => `
    <tr>
      <td style="color:#94a3b8">${idx + 1}</td>
      <td class="code">${esc(item.item_code) || '—'}</td>
      <td class="c" style="font-weight:700">${item.qty}</td>
      <td class="r">${(Number(item.lp_unit_price)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="c">${item.discount_pct || 0}%</td>
      <td class="r">${(Number(item.unit_price_after_disc||item.unit_price)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="r" style="font-weight:600">${(Number(item.total_price)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="c" style="font-size:11px">${item.delivery_date ? fmtDC(item.delivery_date) : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>

<!-- Totals -->
<div class="totals-wrap">
  <table class="totals-table">
    <tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    <tr class="grand"><td class="lbl">Total Amount</td><td class="val">₹ ${grandTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
  </table>
</div>

<div class="words">Amount in words: <strong>${numToWords(grandTotal)}</strong></div>

${po.notes ? `<div class="notes-box"><strong>Notes for Vendor:</strong> ${esc(po.notes)}</div>` : ''}

<!-- Signatures -->
<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Prepared By</div>Procurement</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Approved By</div>Management</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div>
</div>

<!-- Footer -->
<div class="footer">
  <div class="footer-left">
    SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>
    Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
    Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010
  </div>
  <div class="footer-right">
    sales@ssccontrol.com<br/>
    www.ssccontrol.com
  </div>
</div>

</body></html>`
  }

  async function generatePoPdf(poNumber) {
    const html = buildPoHtml(poNumber)
    const blob = new Blob([html], { type: 'text/html' })
    const path = `po-pdfs/${id}/${Date.now()}.html`
    const { error } = await sb.storage.from('po-documents').upload(path, blob, { contentType: 'text/html', upsert: true })
    if (error) throw error
    const { data: { publicUrl } } = sb.storage.from('po-documents').getPublicUrl(path)
    return publicUrl
  }

  function viewPoPdf() {
    const poNumber = po.po_number || po.temp_po_number || '—'
    const html = buildPoHtml(poNumber)
    const w = window.open('', '_blank')
    if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
    w.document.write(html)
    w.document.close()
  }

  // ── Stage 3: Order Placed ──
  async function handlePlace() {
    await updateStatus('placed', { placed_at: new Date().toISOString() })
  }

  // ── Stage 4: Acknowledgement — optional vendor document ──
  async function handleAcknowledge() { setShowAckModal(true) }

  async function confirmAcknowledge() {
    setSaving(true)
    let ackDocUrl = null
    if (ackFile) {
      const ext = ackFile.name.split('.').pop()
      const path = `po-ack/${id}/${Date.now()}.${ext}`
      const { error } = await sb.storage.from('po-documents').upload(path, ackFile, { upsert: true })
      if (!error) {
        const { data: { publicUrl } } = sb.storage.from('po-documents').getPublicUrl(path)
        ackDocUrl = publicUrl
      }
    }
    await updateStatus('acknowledged', {
      acknowledged_at: new Date().toISOString(),
      ...(ackDocUrl && { ack_document_url: ackDocUrl }),
    })
    setShowAckModal(false); setAckFile(null); setAckFileName('')
    setSaving(false)
  }

  // ── Stage 5: Delivery Confirmation — per-item date updates ──
  async function handleDeliveryConfirmation() {
    // Pre-populate per-item delivery dates from current items
    setDeliveryItemDates(items.map(i => ({
      id: i.id,
      item_code: i.item_code,
      qty: i.qty,
      original_date: i.delivery_date || '',
      new_date: i.delivery_date || '',
    })))
    setDeliveryReason('')
    setShowDeliveryModal(true)
  }

  async function saveDeliveryDates() {
    if (!deliveryReason.trim()) { toast('Please enter a note about the delivery update'); return }
    setSaving(true)

    // Save per-item delivery dates
    for (const item of deliveryItemDates) {
      if (item.new_date && item.new_date !== item.original_date) {
        await sb.from('po_delivery_dates').insert({
          po_id: id,
          po_item_id: item.id,
          item_code: item.item_code,
          expected_date: item.new_date,
          previous_date: item.original_date || null,
          reason: deliveryReason.trim(),
          changed_by: userName,
        })
        // Update item delivery_date
        await sb.from('po_items').update({ delivery_date: item.new_date }).eq('id', item.id)
      }
    }

    // Update PO expected_delivery to the latest date
    const latestDate = deliveryItemDates.reduce((max, i) => {
      const d = i.new_date || i.original_date
      return d && d > max ? d : max
    }, '')
    if (latestDate) {
      await sb.from('purchase_orders').update({ expected_delivery: latestDate, updated_at: new Date().toISOString() }).eq('id', id)
    }

    // If not already in delivery_confirmation, move to it
    if (po.status === 'acknowledged') {
      await updateStatus('delivery_confirmation')
    } else {
      await logActivity(`Delivery dates updated. ${deliveryReason.trim()}`)
    }

    toast('Delivery dates updated', 'success')
    setSaving(false); setShowDeliveryModal(false); setDeliveryReason('')
    await loadPO()
  }

  async function confirmDelivery() {
    await updateStatus('delivery_confirmation')
  }

  // ── Stage 6: Material Received ──
  async function handleMaterialReceived() {
    await updateStatus('material_received', { received_at: new Date().toISOString() })
  }

  async function handleCancel() {
    if (!cancelReason.trim()) { toast('Please enter a cancellation reason'); return }
    setSaving(true)
    await updateStatus('cancelled', { cancelled_reason: cancelReason.trim() })
    setShowCancelModal(false); setCancelReason('')
  }

  // ── Comments ──
  function handleCommentInput(e) {
    const v = e.target.value
    setCommentText(v)
    const cursor = e.target.selectionStart
    const before = v.slice(0, cursor)
    const atMatch = before.match(/@(\w*)$/)
    if (atMatch) {
      const q = atMatch[1].toLowerCase()
      setMentionQuery(q)
      setMentionSuggestions(allUsers.filter(u => u.name.toLowerCase().includes(q) || (u.username && u.username.toLowerCase().includes(q))).slice(0, 5))
      setMentionPos({ top: 'auto', left: 0, width: 220 })
    } else {
      setMentionQuery(null); setMentionSuggestions([])
    }
  }

  function insertMention(name) {
    const cursor = commentInputRef.current?.selectionStart || commentText.length
    const before = commentText.slice(0, cursor)
    const after  = commentText.slice(cursor)
    const newBefore = before.replace(/@(\w*)$/, `@${name} `)
    setCommentText(newBefore + after)
    setMentionQuery(null); setMentionSuggestions([])
    setTimeout(() => { if (commentInputRef.current) { commentInputRef.current.focus(); commentInputRef.current.selectionStart = commentInputRef.current.selectionEnd = newBefore.length } }, 0)
  }

  function renderMessage(msg) {
    if (!msg) return msg
    return msg.split(/(@[\w\s]+?)(?=\s@|\s[^@]|$)/g).map((part, i) =>
      part.startsWith('@') ? <span key={i} style={{ color:'#1d4ed8', fontWeight:600 }}>{part}</span> : part
    )
  }

  async function submitComment() {
    if (!commentText.trim()) return
    setPostingComment(true)
    const taggedUsers = [...commentText.matchAll(/@([\w\s]+?)(?=\s@|\s[^@]|$)/g)].map(m => m[1].trim())
    await sb.from('po_comments').insert({ po_id: id, author_name: userName, message: commentText.trim(), tagged_users: taggedUsers.length ? taggedUsers : null, is_activity: false })
    setCommentText('')
    setPostingComment(false)
    await loadPO()
  }

  // ── Edit mode ──
  function startEdit() {
    setEditForm({
      vendor_name: po.vendor_name || '',
      expected_delivery: po.expected_delivery || '',
      fulfilment_center: po.fulfilment_center || '',
      delivery_address: po.delivery_address || '',
      delivery_customer_name: po.delivery_customer_name || '',
      notes: po.notes || '',
      ssc_notes: po.ssc_notes || '',
      payment_terms: po.payment_terms || '',
      purchase_requisition: po.purchase_requisition || '',
    })
    setEditItems(items.map(i => ({
      ...i,
      lp_unit_price: String(i.lp_unit_price || ''),
      discount_pct: String(i.discount_pct || '0'),
      unit_price_after_disc: String(i.unit_price_after_disc || i.unit_price || ''),
      total_price: String(i.total_price || ''),
      delivery_date: i.delivery_date || '',
    })))
    setEditMode(true)
    setShowEditConfirm(false)
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items').select('item_code').ilike('item_code', '%' + q + '%').limit(10)
    return data || []
  }

  function updateEditItem(idx, field, value) {
    setEditItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      const item = next[idx]
      const lp   = parseFloat(item.lp_unit_price) || 0
      const disc = parseFloat(item.discount_pct)  || 0
      const qty  = parseFloat(item.qty)            || 0
      const unit = lp * (1 - disc / 100)
      next[idx].unit_price_after_disc = unit ? unit.toFixed(2) : ''
      next[idx].total_price = (unit && qty) ? (unit * qty).toFixed(2) : ''
      return next
    })
  }

  async function saveEdit() {
    const filled = editItems.filter(i => i.item_code?.trim())
    if (!filled.length) { toast('Add at least one line item'); return }
    setSaving(true)
    const total = filled.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)

    const { error: poErr } = await sb.from('purchase_orders').update({
      expected_delivery: editForm.expected_delivery || null,
      fulfilment_center: editForm.fulfilment_center || null,
      delivery_address: editForm.delivery_address?.trim() || null,
      delivery_customer_name: editForm.fulfilment_center === 'Customer' ? editForm.delivery_customer_name || null : null,
      notes: editForm.notes.trim() || null,
      ssc_notes: editForm.ssc_notes?.trim() || null,
      payment_terms: editForm.payment_terms?.trim() || null,
      purchase_requisition: editForm.purchase_requisition?.trim() || null,
      total_amount: total,
      updated_at: new Date().toISOString(),
    }).eq('id', id)

    if (poErr) { toast('Save failed: ' + poErr.message); setSaving(false); return }

    const { error: delErr } = await sb.from('po_items').delete().eq('po_id', id)
    if (delErr) { toast('Failed to update items: ' + delErr.message); setSaving(false); return }
    if (filled.length) {
      const rows = filled.map((item, idx) => ({
        po_id: id, sr_no: idx + 1,
        item_code: item.item_code.trim(),
        qty: parseFloat(item.qty) || 0,
        lp_unit_price: parseFloat(item.lp_unit_price) || 0,
        discount_pct: parseFloat(item.discount_pct) || 0,
        unit_price: parseFloat(item.unit_price_after_disc) || 0,
        total_price: parseFloat(item.total_price) || 0,
        delivery_date: item.delivery_date || null,
        order_item_id: item.order_item_id || null,
      }))
      const { error: insErr } = await sb.from('po_items').insert(rows)
      if (insErr) { toast('PO updated but items failed: ' + insErr.message); setSaving(false); await loadPO(); return }
    }

    await logActivity('Purchase Order edited')
    toast('Purchase Order updated', 'success')
    setEditMode(false); setSaving(false)
    await loadPO()
  }

  // ── Computed ──
  const fmt = fmtShort
  const fmtTs = fmtDateTime

  if (loading) return (
    <Layout pageTitle="Purchase Order" pageKey="procurement">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div>
    </Layout>
  )

  if (!po) return (
    <Layout pageTitle="Purchase Order" pageKey="procurement">
      <div className="od-page"><div className="od-body">
        <div style={{ textAlign:'center', padding:60, color:'var(--gray-400)' }}>
          <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Purchase Order not found</div>
          <button className="od-btn" onClick={() => navigate('/procurement/po')}>← Back to POs</button>
        </div>
      </div></div>
    </Layout>
  )

  const pipeIdx = PIPELINE.indexOf(po.status)
  const isCancelled = po.status === 'cancelled'
  const isDone = po.status === 'material_received'
  const canEdit = ['draft','pending_approval'].includes(po.status) && !editMode
  const isPending = po.status === 'pending_approval'
  const grandTotal = items.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)

  // Pipeline — determine primary action button
  const statusActions = {
    draft: { label: 'Submit for Approval', next: 'pending_approval' },
    pending_approval: userRole === 'admin' ? { label: 'Approve PO', fn: handleApprove } : null,
    approved: { label: 'Mark as Placed', fn: handlePlace },
    placed: { label: 'Record Acknowledgement', fn: handleAcknowledge },
    acknowledged: { label: 'Delivery Confirmation', fn: handleDeliveryConfirmation },
    delivery_confirmation: null, // Material Received is driven by GRN
  }
  const currentAction = !isCancelled && !isDone && !editMode ? statusActions[po.status] : null

  const editSubtotal = editItems.filter(i => i.item_code?.trim()).reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)

  return (
    <Layout pageTitle={po.po_number} pageKey="procurement">
    <div className="od-page">
      <div className="od-body">

        {/* ── Header ── */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  Purchase Order
                  <span className={'od-status-badge ' + (isPending ? 'pending' : isCancelled ? 'cancelled' : isDone ? 'delivered' : 'active')}>
                    {PO_STATUS_LABELS[po.status] || po.status}
                  </span>
                </div>
                <div className="od-header-title">
                  {po.vendor_name && (
                    <span onClick={() => po.vendor_id && navigate('/vendors/' + po.vendor_id)} style={{ cursor: po.vendor_id ? 'pointer' : 'default', borderBottom: po.vendor_id ? '1px dotted #1a4dab' : 'none', color:'inherit' }}>
                      {po.vendor_name}
                    </span>
                  )}
                </div>
                <div className="od-header-num">
                  {po.po_number} · {fmt(po.po_date || po.created_at)}
                  {po.order_number && <span style={{ marginLeft:8, color:'var(--gray-400)' }}>· Linked: <span style={{ fontFamily:'var(--mono)', color:'#1a4dab' }}>{po.order_number}</span></span>}
                </div>
              </div>
            </div>
            <div className="od-header-actions">
              <button className="od-btn" onClick={() => navigate('/procurement/po')} style={{ gap:6 }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
              {canEdit && (
                <button className="od-btn od-btn-edit" onClick={() => setShowEditConfirm(true)}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit PO
                </button>
              )}
              {editMode && (
                <>
                  <button className="od-btn" onClick={() => setEditMode(false)} disabled={saving}>Discard</button>
                  <button className="od-btn od-btn-edit" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
                </>
              )}
              {!editMode && !isCancelled && !isDone && userRole === 'admin' && (
                <button className="od-btn od-btn-danger" onClick={() => setShowCancelModal(true)}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Cancel PO
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Pipeline Bar ── */}
        <div className={'od-pipeline-bar' + (isCancelled ? ' od-pipeline-cancelled' : '')}>
          <div className="od-pipeline-stages">
            {PIPELINE.map((s, i) => {
              const isDone   = !isCancelled && pipeIdx > i
              const isActive = !isCancelled && po.status === s
              return (
                <div key={s} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                  {PO_PIPE_LABELS[s]}
                </div>
              )
            })}
          </div>
          {po.status === 'delivery_confirmation' && !editMode && (
            <button className="od-mark-complete-btn" style={{ background:'#475569' }} onClick={handleDeliveryConfirmation}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              Update Dates
            </button>
          )}
          {currentAction && (
            <button className="od-mark-complete-btn" onClick={currentAction.fn || (() => updateStatus(currentAction.next))} disabled={saving}>
              <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              {saving ? 'Updating...' : currentAction.label}
            </button>
          )}
        </div>

        {/* ── Banners ── */}
        {isPending && (
          <div className="od-pending-banner">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            <div>
              <div className="od-pending-banner-label">Awaiting Approval</div>
              <div>Submitted as {po.po_number}. Once approved, it can be placed with the vendor.</div>
            </div>
          </div>
        )}

        {['placed','acknowledged','delivery_confirmation'].includes(po.status) && (
          <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'flex-start', gap:12, fontSize:13, color:'#1d4ed8', marginBottom:0 }}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:20, height:20, flexShrink:0, marginTop:1 }}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12l2 2 4-4"/></svg>
            <div>
              <div style={{ fontWeight:700, marginBottom:2 }}>Waiting for GRN</div>
              <div style={{ color:'#3b82f6', fontSize:12 }}>Material received will be confirmed through Goods Receipt Note (GRN). Create a GRN against this PO to mark it as received.</div>
            </div>
            <button onClick={() => navigate('/fc/grn/new?po_id=' + id)} style={{ marginLeft:'auto', background:'#1d4ed8', color:'white', border:'none', borderRadius:8, padding:'8px 16px', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap', fontFamily:'var(--font)' }}>
              + Create GRN
            </button>
          </div>
        )}

        {isCancelled && (
          <div className="od-cancelled-banner">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            <div><div className="od-cancelled-banner-label">PO Cancelled</div><div>{po.cancelled_reason || 'No reason provided.'}</div></div>
          </div>
        )}

        {/* ── Two-column layout ── */}
        <div className="od-layout">

          {/* ── LEFT ── */}
          <div className="od-main">

            {/* PO Information */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">PO Information</div></div>
              <div className="od-card-body">
                {editMode ? (
                  <div className="od-edit-form">
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Expected Delivery</label>
                        <input type="date" value={editForm.expected_delivery} onChange={e => setEditForm(p => ({ ...p, expected_delivery: e.target.value }))} />
                      </div>
                      <div className="od-edit-field">
                        <label>Delivery To</label>
                        <select value={editForm.fulfilment_center} onChange={e => {
                          setEditForm(p => ({ ...p, fulfilment_center: e.target.value, ...(e.target.value !== 'Customer' ? { delivery_customer_name: '', delivery_address: '' } : {}) }))
                        }}>
                          <option value="">— Select —</option>
                          {FC_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                          <option value="Customer">Customer Address</option>
                        </select>
                      </div>
                    </div>
                    {editForm.fulfilment_center === 'Customer' && (
                      <div className="od-edit-row">
                        <div className="od-edit-field">
                          <label>Customer Name</label>
                          <input value={editForm.delivery_customer_name} onChange={e => setEditForm(p => ({ ...p, delivery_customer_name: e.target.value }))} placeholder="Customer name for delivery" />
                        </div>
                        <div className="od-edit-field">
                          <label>Delivery Address</label>
                          <textarea value={editForm.delivery_address} onChange={e => setEditForm(p => ({ ...p, delivery_address: e.target.value }))} rows={2} placeholder="Shipping address" />
                        </div>
                      </div>
                    )}
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Payment Terms</label>
                        <input value={editForm.payment_terms} onChange={e => setEditForm(p => ({ ...p, payment_terms: e.target.value }))} />
                      </div>
                      <div className="od-edit-field">
                        <label>Purchase Requisition From</label>
                        <input value={editForm.purchase_requisition} onChange={e => setEditForm(p => ({ ...p, purchase_requisition: e.target.value }))} />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field" style={{ gridColumn:'1 / -1' }}>
                        <label>Notes (for Vendor)</label>
                        <input value={editForm.notes} onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))} placeholder="Vendor instructions..." />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field" style={{ gridColumn:'1 / -1' }}>
                        <label>Notes for SSC (Internal)</label>
                        <input value={editForm.ssc_notes} onChange={e => setEditForm(p => ({ ...p, ssc_notes: e.target.value }))} placeholder="Internal team notes..." />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>PO Number</label><div className="val" style={{ fontFamily:'var(--mono)', fontWeight:700 }}>{po.po_number}</div></div>
                    <div className="od-detail-field">
                      <label>Vendor</label>
                      <div className="val">
                        {po.vendor_id ? (
                          <span onClick={() => navigate('/vendors/' + po.vendor_id)} style={{ color:'#1a4dab', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted' }}>{po.vendor_name}</span>
                        ) : (po.vendor_name || '—')}
                      </div>
                    </div>
                    <div className="od-detail-field"><label>Vendor Code</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{vendorCode || '—'}</div></div>
                    <div className="od-detail-field"><label>Submitted By</label><div className="val"><OwnerChip name={po.submitted_by_name} /></div></div>
                    <div className="od-detail-field"><label>Payment Terms</label><div className="val">{po.payment_terms || '—'}</div></div>
                    {po.order_number && (
                      <div className="od-detail-field">
                        <label>Linked Order</label>
                        <div className="val">
                          <span style={{ fontFamily:'var(--mono)', color:'#1a4dab', cursor: po.order_id ? 'pointer' : 'default', textDecoration: po.order_id ? 'underline' : 'none' }} onClick={() => po.order_id && navigate('/orders/' + po.order_id)}>
                            {po.order_number}
                          </span>
                        </div>
                      </div>
                    )}
                    {po.reference && !po.order_number && (
                      <div className="od-detail-field"><label>PO / Reference</label><div className="val">{po.reference}</div></div>
                    )}
                    <div className="od-detail-field"><label>PO Date</label><div className="val">{fmt(po.po_date || po.created_at)}</div></div>
                    <div className="od-detail-field"><label>Expected Delivery</label><div className="val">{po.expected_delivery ? fmt(po.expected_delivery) : '—'}</div></div>
                    <div className="od-detail-field"><label>Delivery To</label><div className="val">{po.fulfilment_center === 'Customer' ? (po.delivery_customer_name || 'Customer') : (po.fulfilment_center || '—')}</div></div>
                    {po.delivery_address && <div className="od-detail-field" style={{ gridColumn:'1 / -1' }}><label>Delivery Address</label><div className="val" style={{ lineHeight:1.5 }}>{po.delivery_address}</div></div>}
                    {po.purchase_requisition && <div className="od-detail-field"><label>Purchase Requisition From</label><div className="val">{po.purchase_requisition}</div></div>}
                    <div className="od-detail-field"><label>Total Amount</label><div className="val" style={{ fontWeight:700, fontSize:15 }}>{fmtINR(po.total_amount)}</div></div>
                    {po.notes && <div className="od-detail-field" style={{ gridColumn:'1 / -1' }}><label>Notes (for Vendor)</label><div className="val od-notes-val">{po.notes}</div></div>}
                    {po.ssc_notes && <div className="od-detail-field" style={{ gridColumn:'1 / -1' }}><label>Notes for SSC (Internal)</label><div className="val od-notes-val" style={{ color:'#92400e' }}>{po.ssc_notes}</div></div>}
                    {po.po_pdf_url && (
                      <div className="od-detail-field">
                        <label>PO Document</label>
                        <div className="val">
                          <span onClick={viewPoPdf}
                            style={{ fontSize:12, color:'#1a4dab', fontWeight:600, display:'inline-flex', alignItems:'center', gap:4, cursor:'pointer' }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View PO
                          </span>
                        </div>
                      </div>
                    )}
                    {po.po_document_url && (
                      <div className="od-detail-field">
                        <label>Supporting Document</label>
                        <div className="val">
                          <a href={po.po_document_url} target="_blank" rel="noreferrer"
                            style={{ fontSize:12, color:'#1a4dab', fontWeight:600, display:'inline-flex', alignItems:'center', gap:4, textDecoration:'none' }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View Document
                          </a>
                        </div>
                      </div>
                    )}
                    {po.ack_document_url && (
                      <div className="od-detail-field">
                        <label>Vendor Acknowledgement</label>
                        <div className="val">
                          <a href={po.ack_document_url} target="_blank" rel="noreferrer"
                            style={{ fontSize:12, color:'#0d9488', fontWeight:600, display:'inline-flex', alignItems:'center', gap:4, textDecoration:'none' }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View Acknowledgement
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                  </>
                )}
              </div>
            </div>

            {/* Line Items */}
            <div className="od-card">
              <div className="od-card-header">
                <div className="od-card-title">
                  Line Items ({editMode ? editItems.filter(i => i.item_code?.trim()).length : items.length})
                </div>
              </div>
              {editMode ? (
                <div className="od-edit-items-wrap">
                  <div className="no-items-table-wrap" style={{ margin:'0', borderRadius:0, border:'none', borderBottom:'1px solid var(--gray-100)' }}>
                    <table className="no-items-table">
                      <thead>
                        <tr>
                          <th className="col-sr">#</th><th className="col-code">Item Code</th><th className="col-qty">Qty</th>
                          <th className="col-lp">LP Price</th><th className="col-disc">Disc %</th>
                          <th className="col-unit">Unit Price</th><th className="col-total">Total</th>
                          <th className="col-date">Delivery Date</th><th className="col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {editItems.map((item, idx) => (
                          <tr key={idx} className={item.item_code ? 'row-filled' : ''}>
                            <td className="col-sr">{idx + 1}</td>
                            <td className="col-code">
                              <Typeahead value={item.item_code || ''} onChange={v => updateEditItem(idx, 'item_code', v)}
                                onSelect={it => updateEditItem(idx, 'item_code', it.item_code)} placeholder="Search..."
                                fetchFn={fetchItems} renderItem={it => <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>} />
                            </td>
                            <td className="col-qty"><input type="number" value={item.qty} onChange={e => updateEditItem(idx, 'qty', e.target.value)} placeholder="0" /></td>
                            <td className="col-lp"><input type="number" value={item.lp_unit_price} onChange={e => updateEditItem(idx, 'lp_unit_price', e.target.value)} placeholder="0.00" step="0.01" /></td>
                            <td className="col-disc"><input type="number" value={item.discount_pct} onChange={e => updateEditItem(idx, 'discount_pct', e.target.value)} placeholder="0" /></td>
                            <td className="col-unit"><input readOnly value={item.unit_price_after_disc} placeholder="—" className="calc-field" /></td>
                            <td className="col-total"><input readOnly value={item.total_price} placeholder="—" className="calc-field total-field" /></td>
                            <td className="col-date"><input type="date" value={item.delivery_date} onChange={e => updateEditItem(idx, 'delivery_date', e.target.value)} /></td>
                            <td className="col-del">{editItems.length > 1 && (
                              <button className="del-row-btn" onClick={() => setEditItems(p => p.filter((_,i) => i !== idx))}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                              </button>
                            )}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--gray-100)' }}>
                    <button className="no-add-row-btn" onClick={() => setEditItems(p => [...p, emptyItem()])} style={{ marginTop:0 }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add Row
                    </button>
                  </div>
                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{editSubtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft:20 }}>#</th>
                        <th>Item Code</th>
                        <th>Qty</th>
                        <th>LP Price</th>
                        <th>Disc %</th>
                        <th>Unit Price</th>
                        <th style={{ textAlign:'right' }}>Received</th>
                        <th>Delivery Date</th>
                        <th className="right" style={{ paddingRight:20 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, idx) => {
                        const pct = item.qty > 0 ? Math.min(100, ((item.received_qty || 0) / item.qty) * 100) : 0
                        return (
                          <tr key={item.id || idx}>
                            <td style={{ paddingLeft:20, color:'var(--gray-400)', fontSize:11 }}>{item.sr_no || idx + 1}</td>
                            <td className="mono">{item.item_code || '—'}</td>
                            <td>{item.qty}</td>
                            <td>{item.lp_unit_price ? '₹' + item.lp_unit_price : '—'}</td>
                            <td>{item.discount_pct ? item.discount_pct + '%' : '—'}</td>
                            <td>{fmtINR(item.unit_price_after_disc || item.unit_price)}</td>
                            <td style={{ textAlign:'right' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end' }}>
                                <span style={{ fontWeight:600, color: pct >= 100 ? '#15803d' : pct > 0 ? '#b45309' : 'var(--gray-500)' }}>{item.received_qty || 0}</span>
                                <div style={{ width:40, height:4, borderRadius:2, background:'var(--gray-100)', overflow:'hidden' }}>
                                  <div style={{ width: pct + '%', height:'100%', borderRadius:2, background: pct >= 100 ? '#16a34a' : '#f59e0b' }} />
                                </div>
                              </div>
                            </td>
                            <td>{item.delivery_date ? fmt(item.delivery_date) : '—'}</td>
                            <td className="right" style={{ paddingRight:20 }}>{fmtINR(item.total_price)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Delivery History */}
            {grns.length > 0 && (
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width:18, height:18 }}>
                      <path d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-4"/><polyline points="12 15 12 21"/><polyline points="8 21 16 21"/>
                    </svg>
                    Delivery History
                  </div>
                </div>

                {/* GRN-wise summary */}
                <div style={{ padding:'0 20px 16px' }}>
                  {grns.map(g => {
                    const gItems = Object.values(grnItemsByPOItem).flat().filter(gi => gi.grn?.id === g.id || gi.grn_number === g.grn_number)
                    return (
                      <div key={g.id} style={{ marginBottom:16, border:'1px solid var(--gray-100)', borderRadius:10, overflow:'hidden' }}>
                        {/* GRN header */}
                        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'var(--gray-50)', flexWrap:'wrap' }}>
                          <span onClick={() => navigate('/fc/grn/' + g.id)} style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:13, color:'#1d4ed8', cursor:'pointer' }}>{g.grn_number}</span>
                          <span className={'pill pill-' + (g.status === 'confirmed' ? 'received' : 'draft')} style={{ fontSize:10 }}>
                            {g.status === 'confirmed' ? 'Confirmed' : g.status}
                          </span>
                          <span style={{ fontSize:12, color:'var(--gray-500)', marginLeft:'auto' }}>
                            {g.received_at ? fmt(g.received_at) : '—'}
                          </span>
                          {g.received_by && <OwnerChip name={g.received_by} />}
                          <span onClick={(e) => { e.stopPropagation(); navigate('/fc/grn/' + g.id) }}
                            style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:11, fontWeight:600, color:'#1d4ed8', cursor:'pointer', padding:'4px 10px', background:'#eff6ff', borderRadius:6, border:'1px solid #bfdbfe' }}>
                            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View GRN
                          </span>
                        </div>
                        {/* Items received in this GRN */}
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                          <thead>
                            <tr style={{ borderBottom:'1px solid var(--gray-100)' }}>
                              <th style={{ padding:'8px 16px', textAlign:'left', fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Item Code</th>
                              <th style={{ padding:'8px 12px', textAlign:'center', fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Ordered</th>
                              <th style={{ padding:'8px 12px', textAlign:'center', fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Received</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gItems.map((gi, i) => (
                              <tr key={i} style={{ borderBottom: i < gItems.length - 1 ? '1px solid var(--gray-50)' : 'none' }}>
                                <td style={{ padding:'8px 16px', fontFamily:'var(--mono)', fontWeight:500, color:'var(--gray-800)' }}>{gi.item_code}</td>
                                <td style={{ padding:'8px 12px', textAlign:'center', color:'var(--gray-500)' }}>{gi.ordered_qty || '—'}</td>
                                <td style={{ padding:'8px 12px', textAlign:'center', fontWeight:700, color:'#15803d' }}>{gi.received_qty}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div className="od-sidebar">

            {/* Activity & Notes */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">
                <div className="od-activity-item">
                  <div className="od-activity-dot submitted" />
                  <div>
                    <div className="od-activity-label">Submitted by</div>
                    <div className="od-activity-val">{po.submitted_by_name || '—'}</div>
                    <div className="od-activity-time">{fmtTs(po.created_at)}</div>
                  </div>
                </div>
                {po.approved_by && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot approved" />
                    <div>
                      <div className="od-activity-label">Approved by</div>
                      <div className="od-activity-val">{po.approved_by}</div>
                      {po.approved_at && <div className="od-activity-time">{fmtTs(po.approved_at)}</div>}
                    </div>
                  </div>
                )}
                {po.placed_at && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot" style={{ background:'#1d4ed8' }} />
                    <div>
                      <div className="od-activity-label">Placed with Vendor</div>
                      <div className="od-activity-time">{fmtTs(po.placed_at)}</div>
                    </div>
                  </div>
                )}
                {po.acknowledged_at && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot" style={{ background:'#0d9488' }} />
                    <div>
                      <div className="od-activity-label">Acknowledged</div>
                      <div className="od-activity-time">{fmtTs(po.acknowledged_at)}</div>
                    </div>
                  </div>
                )}
                {po.received_at && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot" style={{ background:'#15803d' }} />
                    <div>
                      <div className="od-activity-label">Material Received</div>
                      <div className="od-activity-time">{fmtTs(po.received_at)}</div>
                    </div>
                  </div>
                )}
                {isCancelled && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot cancelled" />
                    <div>
                      <div className="od-activity-label">Cancelled</div>
                      <div className="od-activity-time">{po.cancelled_reason}</div>
                    </div>
                  </div>
                )}
                {grns.map(g => (
                  <div key={'grn-'+g.id} className="od-activity-item">
                    <div className="od-activity-dot" style={{ background:'#7c3aed' }} />
                    <div>
                      <div className="od-activity-label">GRN — {g.status === 'confirmed' ? 'Confirmed' : g.status === 'checking' ? 'Checking' : 'Created'}</div>
                      <div onClick={() => navigate('/fc/grn/' + g.id)} style={{ fontSize:12, fontFamily:'var(--mono)', fontWeight:600, color:'#7c3aed', cursor:'pointer' }}>{g.grn_number}</div>
                      {g.received_at && <div className="od-activity-time">{fmtTs(g.received_at)}</div>}
                    </div>
                  </div>
                ))}
                {purchaseInvoices.map(pi => {
                  const piLabel = pi.status === 'inward_complete' ? 'Inward Complete' : pi.status === 'invoice_pending' ? 'Invoice Pending' : '3-Way Check'
                  const piColor = pi.status === 'inward_complete' ? '#15803d' : pi.status === 'invoice_pending' ? '#1d4ed8' : '#b45309'
                  return (
                    <div key={'pi-'+pi.id} className="od-activity-item">
                      <div className="od-activity-dot" style={{ background: piColor }} />
                      <div>
                        <div className="od-activity-label">Billing — {piLabel}</div>
                        <div onClick={() => navigate('/procurement/invoices/' + pi.id)} style={{ fontSize:12, fontFamily:'var(--mono)', fontWeight:600, color: piColor, cursor:'pointer' }}>
                          {pi.invoice_number || 'Pending Invoice'}
                        </div>
                        {pi.inward_completed_at && <div className="od-activity-time">{fmtTs(pi.inward_completed_at)}</div>}
                        {!pi.inward_completed_at && pi.three_way_checked_at && <div className="od-activity-time">{fmtTs(pi.three_way_checked_at)}</div>}
                        {!pi.inward_completed_at && !pi.three_way_checked_at && <div className="od-activity-time">{fmtTs(pi.created_at)}</div>}
                      </div>
                    </div>
                  )
                })}
                {comments.map(c => {
                  const isSystem = c.is_activity === true
                  return isSystem ? (
                    <div key={c.id} className="od-activity-item">
                      <div className="od-activity-dot" style={{ background:'#16a34a', flexShrink:0 }} />
                      <div>
                        <div className="od-activity-val" style={{ fontSize:12, fontWeight:600 }}>{c.message}</div>
                        <div className="od-activity-time">{c.author_name} · {fmtTs(c.created_at)}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="od-activity-item od-comment-item">
                      <div className="od-comment-avatar">{c.author_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>
                      <div className="od-comment-body">
                        <div className="od-comment-author">
                          {c.author_name}
                          {c.tagged_users?.length > 0 && <span className="od-comment-tagged">tagged {c.tagged_users.map(u => '@' + u).join(', ')}</span>}
                        </div>
                        <div className="od-comment-text">{renderMessage(c.message)}</div>
                        <div className="od-activity-time">{fmtTs(c.created_at)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="od-comment-box">
                <div className="od-comment-input-wrap">
                  <textarea ref={commentInputRef} className="od-comment-input" value={commentText}
                    onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                    placeholder="Add a note… use @ to tag someone" rows={2} />
                  {mentionQuery !== null && mentionSuggestions.length > 0 && (
                    <div className="od-mention-dropdown" style={{ top:mentionPos.top, left:mentionPos.left, width:mentionPos.width }}>
                      {mentionSuggestions.map(p => (
                        <div key={p.id} className="od-mention-item" onMouseDown={e => { e.preventDefault(); insertMention(p.name) }}>
                          <div className="od-mention-avatar">{p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>
                          <div>
                            <div className="od-mention-name">{p.name}</div>
                            {p.username && <div className="od-mention-uname">@{p.username}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="od-comment-btn" onClick={submitComment} disabled={postingComment || !commentText.trim()}>
                  {postingComment ? '...' : 'Post'}
                </button>
              </div>
            </div>

            {/* Delivery Date History */}
            {deliveryDates.length > 0 && (
              <div className="od-side-card">
                <div className="od-side-card-title">Delivery Date History</div>
                <div style={{ padding:'0 16px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                  {deliveryDates.map((d, i) => (
                    <div key={d.id} style={{ padding:'8px 10px', borderRadius:8, background: i === 0 ? '#eff6ff' : 'var(--gray-50)', border:'1px solid ' + (i === 0 ? '#bfdbfe' : 'var(--gray-100)') }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ fontSize:13, fontWeight:600, color: i === 0 ? '#1d4ed8' : 'var(--gray-700)' }}>{fmt(d.expected_date)}</div>
                        {d.item_code && <span style={{ fontSize:10, fontFamily:'var(--mono)', color:'var(--gray-500)', background:'var(--gray-100)', padding:'1px 6px', borderRadius:4 }}>{d.item_code}</span>}
                      </div>
                      {d.previous_date && <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:2 }}>was: {fmt(d.previous_date)}</div>}
                      {d.reason && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>{d.reason}</div>}
                      <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:2 }}>{d.changed_by} · {fmt(d.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>

    {/* ── Edit Confirm Modal ── */}
    {showEditConfirm && (
      <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowEditConfirm(false) }}>
        <div className="od-cancel-modal" style={{ maxWidth:420 }}>
          <div className="od-cancel-title">Edit Purchase Order?</div>
          <div className="od-cancel-sub">Are you sure you want to edit this PO? Changes will update the order details.</div>
          <div className="od-cancel-actions" style={{ marginTop:20 }}>
            <button className="od-btn" onClick={() => setShowEditConfirm(false)}>Cancel</button>
            <button className="od-btn od-btn-edit" onClick={startEdit}>Edit PO</button>
          </div>
        </div>
      </div>
    )}

    {/* ── Acknowledgement Modal ── */}
    {showAckModal && (
      <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowAckModal(false) }}>
        <div className="od-cancel-modal">
          <div className="od-cancel-title">Record Vendor Acknowledgement</div>
          <div className="od-cancel-sub">Vendor has confirmed receipt of the PO. Attach their confirmation document if available.</div>
          <div style={{ marginTop:16 }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', display:'block', marginBottom:4 }}>Vendor Document (optional)</label>
            <label style={{ display:'block', cursor:'pointer' }}>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.eml,.msg" onChange={e => {
                const f = e.target.files?.[0]
                if (!f) return
                if (f.size > 500 * 1024) { toast('File must be under 500 KB'); e.target.value = ''; return }
                setAckFile(f); setAckFileName(f.name)
              }} style={{ display:'none' }} />
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', border:'1px dashed var(--gray-300)', borderRadius:8, background: ackFileName ? '#f0fdf4' : 'var(--gray-50)', transition:'all 0.15s' }}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width:18, height:18, flexShrink:0, color: ackFileName ? '#16a34a' : 'var(--gray-400)' }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span style={{ fontSize:12, color: ackFileName ? '#166534' : 'var(--gray-500)' }}>{ackFileName || 'Click to upload (PDF, image, email — max 500KB)'}</span>
                {ackFileName && <button type="button" onClick={e => { e.preventDefault(); setAckFile(null); setAckFileName('') }} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', fontSize:16 }}>×</button>}
              </div>
            </label>
          </div>
          <div className="od-cancel-actions" style={{ marginTop:20 }}>
            <button className="od-btn" onClick={() => { setShowAckModal(false); setAckFile(null); setAckFileName('') }}>Cancel</button>
            <button className="od-btn od-btn-approve" onClick={confirmAcknowledge} disabled={saving}>
              {saving ? 'Saving…' : 'Confirm Acknowledgement'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Delivery Confirmation Modal — per-item dates ── */}
    {showDeliveryModal && (
      <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDeliveryModal(false) }}>
        <div className="od-cancel-modal" style={{ maxWidth:650 }}>
          <div className="od-cancel-title">Update Delivery Dates</div>
          <div className="od-cancel-sub">Update expected delivery dates per item. All changes will be logged.</div>
          <div style={{ marginTop:16, maxHeight:400, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  <th style={{ padding:'8px', textAlign:'left', fontSize:11, color:'var(--gray-500)', fontWeight:600 }}>Item Code</th>
                  <th style={{ padding:'8px', textAlign:'center', fontSize:11, color:'var(--gray-500)', fontWeight:600 }}>Qty</th>
                  <th style={{ padding:'8px', textAlign:'center', fontSize:11, color:'var(--gray-500)', fontWeight:600 }}>Current Date</th>
                  <th style={{ padding:'8px', textAlign:'center', fontSize:11, color:'var(--gray-500)', fontWeight:600 }}>New Date</th>
                </tr>
              </thead>
              <tbody>
                {deliveryItemDates.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                    <td style={{ padding:'8px', fontFamily:'var(--mono)', fontSize:11 }}>{item.item_code}</td>
                    <td style={{ padding:'8px', textAlign:'center' }}>{item.qty}</td>
                    <td style={{ padding:'8px', textAlign:'center', color:'var(--gray-500)', fontSize:11 }}>{item.original_date ? fmtShort(item.original_date) : '—'}</td>
                    <td style={{ padding:'8px', textAlign:'center' }}>
                      <input type="date" value={item.new_date || ''} onChange={e => {
                        setDeliveryItemDates(prev => { const n = [...prev]; n[idx] = { ...n[idx], new_date: e.target.value }; return n })
                      }} style={{ padding:'4px 6px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12, fontFamily:'var(--font)' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop:12 }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', display:'block', marginBottom:4 }}>Note / Reason</label>
            <textarea value={deliveryReason} onChange={e => setDeliveryReason(e.target.value)} placeholder="e.g. Vendor confirmed revised delivery schedule via email"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', minHeight:60, resize:'vertical' }} />
          </div>
          <div className="od-cancel-actions" style={{ marginTop:20 }}>
            <button className="od-btn" onClick={() => setShowDeliveryModal(false)}>Cancel</button>
            <button className="od-btn od-btn-approve" onClick={saveDeliveryDates} disabled={saving}>
              {saving ? 'Saving…' : 'Save Delivery Dates'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Cancel Modal ── */}
    {showCancelModal && (
      <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCancelModal(false) }}>
        <div className="od-cancel-modal">
          <div className="od-cancel-title" style={{ color:'#dc2626' }}>Cancel Purchase Order</div>
          <div className="od-cancel-sub">This action cannot be undone. Please provide a reason.</div>
          <div style={{ marginTop:16 }}>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', display:'block', marginBottom:4 }}>Cancellation Reason</label>
            <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Why is this PO being cancelled?"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', minHeight:80, resize:'vertical' }} />
          </div>
          <div className="od-cancel-actions" style={{ marginTop:20 }}>
            <button className="od-btn" onClick={() => setShowCancelModal(false)}>Back</button>
            <button className="od-btn" onClick={handleCancel} disabled={saving} style={{ background:'#dc2626', color:'white', borderColor:'#dc2626' }}>
              {saving ? 'Cancelling…' : 'Cancel PO'}
            </button>
          </div>
        </div>
      </div>
    )}

    </Layout>
  )
}
