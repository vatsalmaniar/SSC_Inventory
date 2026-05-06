import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { friendlyError } from '../lib/errorMsg'

import { fmtShort, fmtDateTime } from '../lib/fmt'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const STATUS_LABELS = {
  three_way_check: '3-Way Check',
  invoice_pending: 'Generate Invoice',
  inward_complete: 'Inward Complete',
}

const PIPELINE = [
  { key: 'three_way_check', label: '3-Way Check' },
  { key: 'invoice_pending',  label: 'Generate Invoice' },
  { key: 'inward_complete',  label: 'Inward Complete' },
]

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
  if (!val) return '—'
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// Open the PO as a print-ready HTML document in a new tab. Same approach as
// the Delivery Challan in OrderDetail / FCOrderDetail — generated on demand
// from the live database, not a stored PDF.
async function openPoHtmlForId(poId) {
  if (!poId) return
  const w = window.open('', '_blank')
  if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write('<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#5b6878">Loading PO…</body></html>')

  // Pull PO + items + vendor code in parallel.
  const poP    = sb.from('purchase_orders').select('id,po_number,temp_po_number,po_type,vendor_name,vendor_id,po_date,created_at,total_amount,fulfilment_center,delivery_address,delivery_customer_name,order_number,reference,payment_terms,notes,submitted_by_name,approved_by').eq('id', poId).single()
  const itemsP = sb.from('purchase_order_items').select('item_code,qty,lp_unit_price,discount_pct,unit_price,unit_price_after_disc,total_price,delivery_date').eq('po_id', poId).order('id')
  const [{ data: po }, { data: items }] = await Promise.all([poP, itemsP])
  if (!po) { w.document.open(); w.document.write('<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#9b1c1c">PO not found.</body></html>'); w.document.close(); return }
  let vendorCode = ''
  if (po.vendor_id) {
    const { data: v } = await sb.from('vendors').select('vendor_code').eq('id', po.vendor_id).single()
    vendorCode = v?.vendor_code || ''
  }

  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fmtDate = (d) => {
    if (!d) return '—'
    const dt = new Date(d)
    return dt.getDate().toString().padStart(2, '0') + '.' + (dt.getMonth() + 1).toString().padStart(2, '0') + '.' + dt.getFullYear()
  }
  function numToWords(n) {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
    function conv(n) {
      if (n === 0) return ''
      if (n < 20) return a[n]
      if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '')
      if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + conv(n % 100) : '')
      if (n < 100000) return conv(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + conv(n % 1000) : '')
      if (n < 10000000) return conv(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + conv(n % 100000) : '')
      return conv(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + conv(n % 10000000) : '')
    }
    const r = Math.floor(n), p = Math.round((n - r) * 100)
    return 'Rupees ' + conv(r) + (p > 0 ? ' and ' + conv(p) + ' Paise' : '') + ' Only'
  }

  const FC_ADDRESSES = {
    Kaveri:   '17(A) Ashwamegh Warehouse, Behind New Ujala Hotel,\nSarkhej Bavla Highway, Sarkhej, Ahmedabad – 382 210',
    Godawari: '31 GIDC Estate, B/h Bank Of Baroda,\nMakarpura, Vadodara – 390 010',
  }
  const list = items || []
  const poNumber   = po.po_number || po.temp_po_number || '—'
  const deliveryAddr = po.delivery_address || FC_ADDRESSES[po.fulfilment_center] || po.fulfilment_center || '—'
  const subtotal   = list.reduce((s, i) => s + (Number(i.total_price) || 0), 0)
  const grandTotal = Number(po.total_amount) || subtotal
  const poDate     = fmtDate(po.po_date || po.created_at)
  const isCO       = (po.po_type === 'CO')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Purchase Order — ${poNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5}
.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
.co-name{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:2px}
.co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
.co-addr{font-size:10.5px;color:#475569;line-height:1.6}
.doc-title{font-size:28px;font-weight:700;color:#0f172a;text-align:right;letter-spacing:-0.5px}
.doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:${isCO ? '#f0fdf4' : '#eff6ff'};color:${isCO ? '#15803d' : '#1d4ed8'};text-align:right}
.divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
.meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
.meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
.meta-addr{font-size:11px;color:#475569;line-height:1.6}
.ref-table{width:100%;border-collapse:collapse}
.ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
.ref-table tr td:first-child{color:#64748b;width:45%}
.ref-table tr td:last-child{font-weight:600;color:#0f172a}
.terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}
.terms span strong{color:#0f172a;font-weight:600}
table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
table.items thead tr{border-bottom:2px solid #0f172a}
table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
table.items th.r{text-align:right}
table.items th.c{text-align:center}
table.items tbody tr{border-bottom:1px solid #f1f5f9}
table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
table.items td.r{text-align:right}
table.items td.c{text-align:center}
table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:12px}
.totals-table{width:300px;border-collapse:collapse}
.totals-table td{padding:5px 0;font-size:11.5px}
.totals-table td.lbl{color:#64748b}
.totals-table td.val{text-align:right;font-weight:500}
.totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
.words{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
.notes-box{margin:12px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px}
.sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}
.sig-cell{text-align:center;font-size:10px;color:#64748b}
.sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}
.sig-name{font-weight:600;color:#0f172a;font-size:11px}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
.footer-left{font-size:10px;color:#94a3b8;line-height:1.6}
.footer-right{font-size:10px;color:#94a3b8;text-align:right}
@media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style></head>
<body>
<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE</div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">${isCO ? 'Customer Order' : 'Stock Order'}</div>
    <div class="doc-title">Purchase Order</div>
  </div>
</div>
<hr class="divider"/>
<div class="meta-grid">
  <div>
    <div class="meta-section-label">Vendor</div>
    <div class="meta-name">${esc(po.vendor_name) || '—'}</div>
    ${vendorCode ? `<div style="font-size:11px;color:#475569;margin-top:2px">Vendor Code: <strong style="font-family:'Geist Mono',monospace">${esc(vendorCode)}</strong></div>` : ''}
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
<div class="terms">
  <span>Payment terms: <strong>${esc(po.payment_terms) || '—'}</strong></span>
  <span>Currency: <strong>INR</strong></span>
</div>
<div style="margin-bottom:20px">
  <div class="meta-section-label">Deliver To</div>
  <div class="meta-addr">${po.fulfilment_center === 'Customer' ? esc(po.delivery_customer_name || '') : 'SSC Control Pvt. Ltd.'}<br/>${deliveryAddr.replace(/\n/g, '<br/>')}</div>
</div>
<table class="items">
  <thead><tr><th style="width:40px">#</th><th>Item Code</th><th class="c" style="width:60px">Qty</th><th class="r" style="width:90px">LP Price</th><th class="c" style="width:60px">Disc %</th><th class="r" style="width:90px">Unit Price</th><th class="r" style="width:100px">Amount</th><th class="c" style="width:90px">Delivery</th></tr></thead>
  <tbody>
${list.map((it, idx) => `
    <tr>
      <td style="color:#94a3b8">${idx + 1}</td>
      <td class="code">${esc(it.item_code) || '—'}</td>
      <td class="c" style="font-weight:700">${it.qty}</td>
      <td class="r">${(Number(it.lp_unit_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="c">${it.discount_pct || 0}%</td>
      <td class="r">${(Number(it.unit_price_after_disc || it.unit_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="r" style="font-weight:600">${(Number(it.total_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="c" style="font-size:11px">${it.delivery_date ? fmtDate(it.delivery_date) : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="totals-wrap">
  <table class="totals-table">
    <tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
    <tr class="grand"><td class="lbl">Total Amount</td><td class="val">₹ ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
  </table>
</div>
<div class="words">Amount in words: <strong>${numToWords(grandTotal)}</strong></div>
${po.notes ? `<div class="notes-box"><strong>Notes for Vendor:</strong> ${esc(po.notes)}</div>` : ''}
<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">${esc(po.submitted_by_name || 'Procurement')}</div>Prepared By</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">${esc(po.approved_by || 'Management')}</div>Approved By</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div>
</div>
<div class="footer">
  <div class="footer-left">SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div>
  <div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div>
</div>
</body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
}

export default function PurchaseInvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inv, setInv]           = useState(null)
  const [grn, setGrn]           = useState(null)
  const [po, setPo]             = useState(null)
  const [grnItems, setGrnItems] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')

  // 3-way check
  const [threeWayNotes, setThreeWayNotes] = useState('')

  // Generate invoice
  const [vendorInvoiceNum, setVendorInvoiceNum] = useState('')
  const [vendorInvoiceDate, setVendorInvoiceDate] = useState('')
  const [invoiceAmount, setInvoiceAmount]         = useState('')
  const [gstAmount, setGstAmount]                 = useState('')
  const [vendorInvoiceFile, setVendorInvoiceFile] = useState(null)
  const [sscInvoiceFile, setSscInvoiceFile]       = useState(null)

  useEffect(() => { init() }, [id])


  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['accounts','ops','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    setUserRole(profile?.role || '')
    setUserName(profile?.name || '')
    await loadInvoice()
  }

  async function loadInvoice(silent) {
    if (!silent) setLoading(true)
    const { data, error } = await sb.from('purchase_invoices').select('*').eq('id', id).single()
    if (error || !data) { setInv(null); setLoading(false); return }
    setInv(data)

    // Load linked GRN
    if (data.grn_id) {
      const [grnRes, itemsRes] = await Promise.all([
        sb.from('grn').select('*').eq('id', data.grn_id).single(),
        sb.from('grn_items').select('*').eq('grn_id', data.grn_id).order('id'),
      ])
      setGrn(grnRes.data || null)
      setGrnItems(itemsRes.data || [])
    }

    // Load linked PO (from purchase_invoice.po_id or from grn_items fallback)
    let poId = data.po_id
    if (!poId && data.grn_id) {
      const { data: gi } = await sb.from('grn_items').select('po_id').eq('grn_id', data.grn_id).not('po_id', 'is', null).limit(1)
      if (gi?.[0]?.po_id) poId = gi[0].po_id
    }
    if (poId) {
      const { data: poData } = await sb.from('purchase_orders').select('id,po_number,vendor_name,status,created_at,total_amount,po_pdf_url').eq('id', poId).single()
      setPo(poData || null)
    }

    // Pre-fill form fields from saved data
    if (data.three_way_notes) setThreeWayNotes(data.three_way_notes)
    if (data.invoice_number) setVendorInvoiceNum(data.invoice_number)
    if (data.invoice_date) setVendorInvoiceDate(data.invoice_date)
    if (data.invoice_amount) setInvoiceAmount(String(data.invoice_amount))
    if (data.gst_amount) setGstAmount(String(data.gst_amount))

    setLoading(false)
  }

  // ── Stage 1: Complete 3-Way Check ──
  async function handleThreeWayCheck() {
    if (!threeWayNotes.trim()) { toast('Please add 3-way check notes'); return }
    setSaving(true)
    const { error } = await sb.from('purchase_invoices').update({
      status: 'invoice_pending',
      three_way_notes: threeWayNotes.trim(),
      three_way_checked_at: new Date().toISOString(),
      three_way_checked_by: userName,
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    toast('3-Way Check complete', 'success')
    setSaving(false)
    await loadInvoice()
  }

  // ── Stage 2: Generate Purchase Invoice ──
  async function handleGenerateInvoice() {
    if (!vendorInvoiceNum.trim()) { toast('Enter vendor invoice number'); return }
    if (!vendorInvoiceDate) { toast('Enter vendor invoice date'); return }
    if (!invoiceAmount) { toast('Enter invoice amount'); return }

    setSaving(true)

    // Upload vendor invoice PDF
    let vendorPdfUrl = inv.vendor_invoice_url || null
    if (vendorInvoiceFile) {
      if (vendorInvoiceFile.type !== 'application/pdf') { toast('Vendor invoice must be PDF'); setSaving(false); return }
      if (vendorInvoiceFile.size > 5 * 1024 * 1024) { toast('File must be under 5MB'); setSaving(false); return }
      const path = `purchase-invoices/${id}/vendor-${Date.now()}.pdf`
      const { error: upErr } = await sb.storage.from('customer-docs').upload(path, vendorInvoiceFile, { upsert: true })
      if (upErr) { toast(friendlyError(upErr, "Vendor upload failed. Please try again.")); setSaving(false); return }
      vendorPdfUrl = sb.storage.from('customer-docs').getPublicUrl(path).data.publicUrl
    }

    // Upload SSC purchase invoice PDF
    let sscPdfUrl = inv.ssc_invoice_url || null
    if (sscInvoiceFile) {
      if (sscInvoiceFile.type !== 'application/pdf') { toast('SSC invoice must be PDF'); setSaving(false); return }
      if (sscInvoiceFile.size > 5 * 1024 * 1024) { toast('File must be under 5MB'); setSaving(false); return }
      const path = `purchase-invoices/${id}/ssc-${Date.now()}.pdf`
      const { error: upErr } = await sb.storage.from('customer-docs').upload(path, sscInvoiceFile, { upsert: true })
      if (upErr) { toast(friendlyError(upErr, "SSC upload failed. Please try again.")); setSaving(false); return }
      sscPdfUrl = sb.storage.from('customer-docs').getPublicUrl(path).data.publicUrl
    }

    const totalAmt = (Number(invoiceAmount) || 0) + (Number(gstAmount) || 0)

    const { error } = await sb.from('purchase_invoices').update({
      status: 'inward_complete',
      invoice_number: vendorInvoiceNum.trim(),
      invoice_date: vendorInvoiceDate,
      invoice_amount: Number(invoiceAmount) || 0,
      gst_amount: Number(gstAmount) || 0,
      total_amount: totalAmt,
      vendor_invoice_url: vendorPdfUrl,
      ssc_invoice_url: sscPdfUrl,
      inward_completed_at: new Date().toISOString(),
      inward_completed_by: userName,
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }

    // Auto-close PO if all linked purchase invoices are now inward_complete
    const poId = inv.po_id
    if (poId) {
      const { count: pendingCount } = await sb.from('purchase_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('po_id', poId)
        .neq('status', 'inward_complete')
        .neq('id', id)
      if (pendingCount === 0) {
        await sb.from('purchase_orders').update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', poId)
      }
    }

    toast('Inward complete!', 'success')
    setSaving(false)
    await loadInvoice()
  }

  // ── Loading / Not Found ──
  if (loading) return (
    <Layout pageTitle="Purchase Invoice" pageKey="billing">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/></div></div>
    </Layout>
  )

  if (!inv) return (
    <Layout pageTitle="Purchase Invoice" pageKey="billing">
      <div className="od-page"><div className="od-body">
        <div style={{ textAlign:'center', padding:60, color:'var(--gray-400)' }}>
          <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>Invoice not found</div>
          <button className="od-btn" onClick={() => navigate('/procurement/invoices')}>← Back to Invoices</button>
        </div>
      </div></div>
    </Layout>
  )

  const pipelineIdx = PIPELINE.findIndex(s => s.key === inv.status)
  const isComplete = inv.status === 'inward_complete'

  return (
    <Layout pageTitle={inv.invoice_number || 'Purchase Invoice'} pageKey="billing">
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Inward Billing</div>
                <div className="od-header-title">{inv.invoice_number || 'Pending Invoice'}</div>
                <div className="od-header-num" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  {inv.vendor_name && <span style={{ fontSize:12, color:'var(--gray-500)' }}>{inv.vendor_name}</span>}
                  <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background: isComplete ? '#f0fdf4' : pipelineIdx === 0 ? '#fef9c3' : '#eff6ff', color: isComplete ? '#15803d' : pipelineIdx === 0 ? '#854d0e' : '#1d4ed8' }}>
                    {STATUS_LABELS[inv.status] || inv.status}
                  </span>
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/procurement/invoices')}>← Back</button>
              </div>
            </div>
          </div>

          {/* Pipeline bar */}
          <div className={'od-pipeline-bar' + (isComplete ? '' : ' od-pipeline-delivery')}>
            <div className="od-pipeline-stages">
              {PIPELINE.map((stage, idx) => {
                const isDone   = isComplete ? true : pipelineIdx > idx
                const isActive = !isComplete && pipelineIdx === idx
                return (
                  <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                    {stage.label}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Two-column layout */}
          <div className="od-layout">
            <div className="od-main">

              {/* Inward Complete banner */}
              {isComplete && (
                <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  <div>
                    <div className="od-pending-banner-label">Inward Complete</div>
                    <div>Purchase invoice has been verified and recorded.</div>
                  </div>
                </div>
              )}

              {/* 3-Way Check Card */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:16,height:16,marginRight:6,verticalAlign:'middle'}}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    3-Way Check
                  </div>
                  {inv.three_way_checked_at && (
                    <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,background:'#f0fdf4',color:'#15803d'}}>Verified</span>
                  )}
                </div>
                <div className="od-card-body">
                  <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:16}}>
                    Verify that the <strong>Purchase Order</strong>, <strong>GRN</strong>, and <strong>Vendor Invoice</strong> all match before proceeding.
                  </p>

                  {/* PO Reference */}
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:16}}>
                    <div style={{padding:12,borderRadius:8,border:'1px solid var(--gray-100)',background:'#f8fafc'}}>
                      <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Purchase Order</div>
                      {po ? (
                        <div>
                          {['admin','ops','management'].includes(userRole) ? (
                            <div onClick={() => navigate('/procurement/po/' + po.id)} style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#2563eb',cursor:'pointer'}}>{po.po_number}</div>
                          ) : (
                            <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'var(--gray-800)'}}>{po.po_number}</div>
                          )}
                          <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{fmtINR(po.total_amount)}</div>
                          <a onClick={() => openPoHtmlForId(po.id)} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#2563eb',cursor:'pointer',marginTop:4,textDecoration:'none'}}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:11,height:11}}><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v7H3V3h7"/></svg>
                            View PO
                          </a>
                        </div>
                      ) : (
                        <div style={{fontSize:12,color:'var(--gray-400)'}}>No PO linked</div>
                      )}
                    </div>
                    <div style={{padding:12,borderRadius:8,border:'1px solid var(--gray-100)',background:'#f8fafc'}}>
                      <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>GRN</div>
                      {grn ? (
                        <div>
                          <div onClick={() => navigate('/fc/grn/' + grn.id)} style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#2563eb',cursor:'pointer'}}>{grn.grn_number}</div>
                          <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{grnItems.length} items received</div>
                        </div>
                      ) : (
                        <div style={{fontSize:12,color:'var(--gray-400)'}}>No GRN linked</div>
                      )}
                    </div>
                    <div style={{padding:12,borderRadius:8,border:'1px solid var(--gray-100)',background:'#f8fafc'}}>
                      <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Vendor Invoice</div>
                      {inv.invoice_number && inv.status !== 'three_way_check' ? (
                        <div>
                          <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'var(--gray-800)'}}>{inv.invoice_number}</div>
                          <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{fmtINR(inv.total_amount)}</div>
                        </div>
                      ) : (
                        <div style={{fontSize:12,color:'#b45309',fontWeight:500}}>Pending</div>
                      )}
                    </div>
                  </div>

                  {/* Check notes */}
                  {inv.status === 'three_way_check' ? (
                    <div>
                      <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Verification Notes</label>
                      <textarea
                        value={threeWayNotes}
                        onChange={e => setThreeWayNotes(e.target.value)}
                        placeholder="e.g. PO qty matches GRN received qty. Vendor invoice amount matches PO total. All items verified."
                        style={{width:'100%',minHeight:80,padding:10,borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'var(--font)',resize:'vertical',boxSizing:'border-box'}}
                      />
                      <button className="od-btn od-btn-approve" onClick={handleThreeWayCheck} disabled={saving} style={{marginTop:12}}>
                        {saving ? 'Saving...' : 'Complete 3-Way Check'}
                      </button>
                    </div>
                  ) : inv.three_way_notes && (
                    <div style={{padding:10,borderRadius:8,background:'#f0fdf4',border:'1px solid #bbf7d0'}}>
                      <div style={{fontSize:10,fontWeight:600,color:'#166534',textTransform:'uppercase',marginBottom:4}}>Verification Notes</div>
                      <div style={{fontSize:13,color:'#166534',whiteSpace:'pre-wrap'}}>{inv.three_way_notes}</div>
                      {inv.three_way_checked_by && (
                        <div style={{fontSize:11,color:'#15803d',marginTop:6}}>— {inv.three_way_checked_by}, {fmtShort(inv.three_way_checked_at)}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Generate Purchase Invoice Card */}
              {(inv.status === 'invoice_pending' || inv.status === 'inward_complete') && (
                <div className="od-card" style={{marginTop:16}}>
                  <div className="od-card-header">
                    <div className="od-card-title">
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:16,height:16,marginRight:6,verticalAlign:'middle'}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      Generate Purchase Invoice
                    </div>
                    {inv.status === 'inward_complete' && (
                      <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,background:'#f0fdf4',color:'#15803d'}}>Complete</span>
                    )}
                  </div>
                  <div className="od-card-body">
                    {inv.status === 'invoice_pending' ? (
                      <div>
                        <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:16}}>
                          Enter the vendor invoice details and upload the invoice document.
                        </p>
                        <div className="od-detail-grid">
                          <div className="od-detail-field">
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>Vendor Invoice No. *</label>
                            <input type="text" value={vendorInvoiceNum} onChange={e => setVendorInvoiceNum(e.target.value)}
                              placeholder="e.g. INV-2026-001"
                              style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'var(--font)',boxSizing:'border-box'}} />
                          </div>
                          <div className="od-detail-field">
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>Invoice Date *</label>
                            <input type="date" value={vendorInvoiceDate} onChange={e => setVendorInvoiceDate(e.target.value)}
                              style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'var(--font)',boxSizing:'border-box'}} />
                          </div>
                          <div className="od-detail-field">
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>Invoice Amount (excl. GST) *</label>
                            <input type="number" value={invoiceAmount} onChange={e => setInvoiceAmount(e.target.value)}
                              placeholder="0.00"
                              style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'var(--font)',boxSizing:'border-box'}} />
                          </div>
                          <div className="od-detail-field">
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>GST Amount</label>
                            <input type="number" value={gstAmount} onChange={e => setGstAmount(e.target.value)}
                              placeholder="0.00"
                              style={{width:'100%',padding:'8px 10px',borderRadius:8,border:'1px solid var(--gray-200)',fontSize:13,fontFamily:'var(--font)',boxSizing:'border-box'}} />
                          </div>
                        </div>
                        {(invoiceAmount || gstAmount) && (
                          <div style={{marginTop:8,padding:10,borderRadius:8,background:'#f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                            <span style={{fontSize:12,color:'var(--gray-500)'}}>Total Amount</span>
                            <span style={{fontSize:16,fontWeight:800,fontFamily:'var(--mono)',color:'var(--gray-900)'}}>
                              {fmtINR((Number(invoiceAmount) || 0) + (Number(gstAmount) || 0))}
                            </span>
                          </div>
                        )}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
                          <div>
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Upload Vendor Invoice (PDF)</label>
                            <input type="file" accept=".pdf" onChange={e => setVendorInvoiceFile(e.target.files?.[0] || null)}
                              style={{fontSize:12}} />
                          </div>
                          <div>
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Upload SSC Purchase Invoice (PDF)</label>
                            <input type="file" accept=".pdf" onChange={e => setSscInvoiceFile(e.target.files?.[0] || null)}
                              style={{fontSize:12}} />
                          </div>
                        </div>
                        <button className="od-btn od-btn-approve" onClick={handleGenerateInvoice} disabled={saving} style={{marginTop:16}}>
                          {saving ? 'Saving...' : 'Complete Inward'}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="od-detail-grid">
                          <div className="od-detail-field">
                            <div className="od-detail-label">Vendor Invoice No.</div>
                            <div className="od-detail-value" style={{fontFamily:'var(--mono)',fontWeight:700}}>{inv.invoice_number || '—'}</div>
                          </div>
                          <div className="od-detail-field">
                            <div className="od-detail-label">Invoice Date</div>
                            <div className="od-detail-value">{inv.invoice_date ? fmtShort(inv.invoice_date) : '—'}</div>
                          </div>
                          <div className="od-detail-field">
                            <div className="od-detail-label">Invoice Amount</div>
                            <div className="od-detail-value" style={{fontWeight:600}}>{fmtINR(inv.invoice_amount)}</div>
                          </div>
                          <div className="od-detail-field">
                            <div className="od-detail-label">GST Amount</div>
                            <div className="od-detail-value">{fmtINR(inv.gst_amount)}</div>
                          </div>
                          <div className="od-detail-field">
                            <div className="od-detail-label">Total Amount</div>
                            <div className="od-detail-value" style={{fontWeight:800,fontSize:16}}>{fmtINR(inv.total_amount)}</div>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:12}}>
                          {inv.vendor_invoice_url && (
                            <a href={inv.vendor_invoice_url} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'#1a4dab',fontWeight:600}}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              Vendor Invoice PDF
                            </a>
                          )}
                          {inv.ssc_invoice_url && (
                            <a href={inv.ssc_invoice_url} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'#7c3aed',fontWeight:600}}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              SSC Purchase Invoice PDF
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* GRN Items Table */}
              {grnItems.length > 0 && (
                <div className="od-card" style={{marginTop:16}}>
                  <div className="od-card-header"><div className="od-card-title">GRN Items ({grnItems.length})</div></div>
                  <div className="od-card-body" style={{padding:0}}>
                    <div style={{overflowX:'auto'}}>
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th>Item Code</th>
                            <th style={{textAlign:'right'}}>Ordered</th>
                            <th style={{textAlign:'right'}}>Received</th>
                            <th style={{textAlign:'right'}}>Accepted</th>
                            <th style={{textAlign:'right'}}>Rejected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grnItems.map(item => (
                            <tr key={item.id}>
                              <td style={{fontWeight:500,fontFamily:'var(--mono)',fontSize:12}}>{item.item_code || '—'}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)'}}>{item.ordered_qty || item.expected_qty || '—'}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)',fontWeight:700}}>{item.received_qty || 0}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)',color:'#15803d'}}>{item.accepted_qty || 0}</td>
                              <td style={{textAlign:'right',fontFamily:'var(--mono)',color: item.rejected_qty ? '#dc2626' : 'var(--gray-400)'}}>{item.rejected_qty || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div>
              {/* Summary Card */}
              <div className="od-side-card">
                <div className="od-side-card-title">Summary</div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {inv.vendor_name && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Vendor</div>
                      <div style={{color:'var(--gray-700)',marginTop:2,fontWeight:500}}>
                        {inv.vendor_id
                          ? <span onClick={() => navigate('/vendors/' + inv.vendor_id)} style={{color:'#2563eb',cursor:'pointer'}}>{inv.vendor_name}</span>
                          : inv.vendor_name}
                      </div>
                    </div>
                  )}
                  {po && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Purchase Order</div>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:2}}>
                        <span style={{color:'var(--gray-700)',fontFamily:'var(--mono)',fontWeight:600}}>{po.po_number}</span>
                        <a onClick={() => openPoHtmlForId(po.id)} style={{fontSize:11,color:'#2563eb',cursor:'pointer',textDecoration:'none',fontFamily:'var(--font)',fontWeight:500}}>View PO ↗</a>
                      </div>
                    </div>
                  )}
                  {grn && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>GRN</div>
                      <div onClick={() => navigate('/fc/grn/' + grn.id)} style={{color:'#2563eb',cursor:'pointer',fontFamily:'var(--mono)',fontWeight:600,marginTop:2}}>{grn.grn_number}</div>
                    </div>
                  )}
                  {inv.total_amount > 0 && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Total Amount</div>
                      <div style={{fontSize:18,fontWeight:800,fontFamily:'var(--mono)',color:'var(--gray-900)',marginTop:2}}>{fmtINR(inv.total_amount)}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline */}
              <div className="od-side-card" style={{marginTop:12}}>
                <div className="od-side-card-title">Timeline</div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  <div style={{fontSize:12}}>
                    <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Created</div>
                    <div style={{color:'var(--gray-700)',marginTop:2}}>{fmtDateTime(inv.created_at)}</div>
                  </div>
                  {inv.three_way_checked_at && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>3-Way Check</div>
                      <div style={{color:'var(--gray-700)',marginTop:2}}>{fmtDateTime(inv.three_way_checked_at)}</div>
                      {inv.three_way_checked_by && <div style={{marginTop:2}}><OwnerChip name={inv.three_way_checked_by} /></div>}
                    </div>
                  )}
                  {inv.inward_completed_at && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Inward Complete</div>
                      <div style={{color:'var(--gray-700)',marginTop:2}}>{fmtDateTime(inv.inward_completed_at)}</div>
                      {inv.inward_completed_by && <div style={{marginTop:2}}><OwnerChip name={inv.inward_completed_by} /></div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
