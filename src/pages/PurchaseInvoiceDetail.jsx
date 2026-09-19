import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { writeDoc } from '../lib/printDoc'
import { friendlyError } from '../lib/errorMsg'

import { fmtShort, fmtDateTime, fmtTs, fmtMoneyFull } from '../lib/fmt'
import { toast } from '../lib/toast'
import { buildGrnHtml } from '../lib/grnHtml'
import { billVerdict, gstPlausible, MATCH_LABELS } from '../lib/threeWayMatch'
import Layout from '../components/Layout'
import Loading from '../components/Loading'
import '../styles/orderdetail.css'
import '../styles/three-way-match.css'

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


function fmtINR(val) {
  if (!val) return '—'
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// Open the GRN as a print-ready HTML document in a new tab — gives accounts a
// quick way to verify received qty + invoice ref while doing the 3-way match.
async function openGrnHtmlForId(grnId) {
  if (!grnId) return
  const w = window.open('', '_blank')
  if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write('<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#5b6878">Loading GRN…</body></html>')
  const [grnRes, itemsRes] = await Promise.all([
    sb.from('grn').select('*').eq('id', grnId).single(),
    sb.from('grn_items').select('*').eq('grn_id', grnId).order('id'),
  ])
  const grn = grnRes.data
  if (!grn) {
    const msg = grnRes.error ? `Could not load GRN: ${grnRes.error.message}` : 'GRN not found.'
    writeDoc(w, `<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#9b1c1c">${msg}</body></html>`); return
  }
  const html = buildGrnHtml(grn, itemsRes.data || [])
  writeDoc(w, html)
}

// Open the PO as a print-ready HTML document in a new tab. Same approach as
// the Delivery Challan in OrderDetail / FCOrderDetail — generated on demand
// from the live database, not a stored PDF.
async function openPoHtmlForId(poId) {
  if (!poId) return
  const w = window.open('', '_blank')
  if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write('<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#5b6878">Loading PO…</body></html>')

  // Pull PO + items + vendor code in parallel. Use '*' so we don't break if
  // the column list ever drifts (same approach as PurchaseOrderDetail).
  const poP    = sb.from('purchase_orders').select('*').eq('id', poId).single()
  const itemsP = sb.from('po_items').select('*').eq('po_id', poId).order('sr_no')
  const [poRes, itemsRes] = await Promise.all([poP, itemsP])
  const po    = poRes.data
  const items = itemsRes.data || []
  if (!po) {
    const msg = poRes.error ? `Could not load PO: ${poRes.error.message}` : 'PO not found.'
    writeDoc(w, `<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;color:#9b1c1c">${msg}</body></html>`); return
  }
  let vendorCode = ''
  if (po.vendor_id) {
    const { data: v } = await sb.from('vendors').select('vendor_code').eq('id', po.vendor_id).maybeSingle()
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
<link href="${window.location.origin}/fonts/fonts.css" rel="stylesheet"/>
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
  writeDoc(w, html)
}

export default function PurchaseInvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inv, setInv]           = useState(null)
  const [grn, setGrn]           = useState(null)
  const [po, setPo]             = useState(null)         // primary PO (first one) — kept for backwards compat
  const [pos, setPos]           = useState([])           // all distinct POs linked to the GRN
  const [grnItems, setGrnItems] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')
  const [userId,   setUserId]   = useState('')

  // 3-way check
  const [threeWayNotes, setThreeWayNotes] = useState('')

  // ── The match. matchLines carries FOUR numbers per line: matched_qty and
  // po_unit_price are inherited read-only (quantity is decided at the GRN, price
  // at Inward Billing), billed_qty and inv_unit_price are what accounts keys in
  // from the vendor's invoice. The verdict shown here mirrors
  // public.pi_record_match(), but the DATABASE computes the one that is stored —
  // a rule enforced only here would be bypassable straight through PostgREST.
  const [tol, setTol]               = useState(null)
  const [matchLines, setMatchLines] = useState([])
  // The lines as STORED, for a bill that has already been matched — so the page
  // can answer "whose price did we accept?" without anyone opening the database.
  const [savedLines, setSavedLines] = useState([])
  const [taxable, setTaxable]       = useState('')
  const [freight, setFreight]       = useState('')
  // A duplicate vendor invoice number is REFUSED by default, but one invoice
  // legitimately covering several receipts is routine here — 19 numbers span 40
  // GRNs today — so it has to be recordable. Just never silently: it needs the
  // sibling named and a reason, and it sets a payment block.
  const [dupSibling, setDupSibling] = useState(null)   // the bill it clashes with
  const [dupReason, setDupReason]   = useState('')
  const [relCode, setRelCode]       = useState('')
  const [relReason, setRelReason]   = useState('')
  // The bill-level answer is DERIVED from the line answers by the RPC (it comes
  // back 'mixed' when they disagree), so only the free-text note lives here.
  const [priceNote, setPriceNote] = useState('')
  // Comments with @mentions. Orders and POs have had these for a long time; the
  // bill had a read-only timeline, so on a document carrying a price dispute and
  // a debit note you could see what happened but not ask anyone about it.
  const [comments, setComments]           = useState([])
  const [commentText, setCommentText]     = useState('')
  const [posting, setPosting]             = useState(false)
  const [allUsers, setAllUsers]           = useState([])
  const [mentionQuery, setMentionQuery]   = useState(null)
  const [mentionSug, setMentionSug]       = useState([])
  const [mentionPos, setMentionPos]       = useState({ top: 0, left: 0, width: 240 })
  const commentRef = useRef(null)
  // Debit note — what the vendor owes back, and the Tally document proving it.
  const [dnNumber, setDnNumber] = useState('')
  const [dnFile, setDnFile]     = useState(null)
  // GST is either CGST+SGST (vendor in our state) or IGST (anyone else). Derived
  // from the first two digits of the vendor's GSTIN — every active vendor has
  // one — so a normal bill needs no choice made about it.
  const [cgst, setCgst]           = useState('')
  const [sgst, setSgst]           = useState('')
  const [igst, setIgst]           = useState('')
  const [vendorState, setVendorState] = useState('')
  const [gstModeOverride, setGstModeOverride] = useState('')

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
    setUserId(session.user.id)
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

    // Collect every PO id that's linked through this invoice / GRN.
    // Sources (in priority order, deduplicated):
    //   1. purchase_invoice.po_id
    //   2. grn.po_id (row-level link)
    //   3. grn_items.po_id (per-item links — multi-PO GRNs)
    const poIdSet = new Set()
    if (data.po_id) poIdSet.add(data.po_id)
    if (data.grn_id) {
      const { data: grnRow } = await sb.from('grn').select('po_id').eq('id', data.grn_id).maybeSingle()
      if (grnRow?.po_id) poIdSet.add(grnRow.po_id)
      const { data: giRows } = await sb.from('grn_items').select('po_id').eq('grn_id', data.grn_id).not('po_id', 'is', null)
      for (const row of (giRows || [])) if (row.po_id) poIdSet.add(row.po_id)
    }
    const poIds = [...poIdSet]
    if (poIds.length) {
      const { data: poData } = await sb.from('purchase_orders')
        .select('id,po_number,vendor_name,status,created_at,total_amount,po_pdf_url')
        .in('id', poIds)
        .order('created_at', { ascending: true })
      setPos(poData || [])
      setPo((poData && poData[0]) || null)  // keep `po` pointing at the first one for any legacy reads
    } else {
      setPos([])
      setPo(null)
    }

    // Pre-fill form fields from saved data
    if (data.three_way_notes) setThreeWayNotes(data.three_way_notes)
    if (data.invoice_number) setVendorInvoiceNum(data.invoice_number)
    if (data.invoice_date) setVendorInvoiceDate(data.invoice_date)
    if (data.invoice_amount) setInvoiceAmount(String(data.invoice_amount))
    if (data.gst_amount) setGstAmount(String(data.gst_amount))
    if (data.taxable_amount != null) setTaxable(String(data.taxable_amount))
    if (data.cgst_amount) setCgst(String(data.cgst_amount))
    if (data.sgst_amount) setSgst(String(data.sgst_amount))
    if (data.igst_amount) setIgst(String(data.igst_amount))
    if (data.vendor_id) {
      const { data: v } = await sb.from('vendors').select('gst').eq('id', data.vendor_id).maybeSingle()
      setVendorState((v?.gst || '').slice(0, 2))
    }
    if (data.freight_amount) setFreight(String(data.freight_amount))
    if (data.debit_note_number) setDnNumber(data.debit_note_number)

    await loadMatch(data)
    await loadComments(data.grn_id)
    setLoading(false)
  }

  async function loadComments(grnId) {
    const [{ data: cs }, { data: us }, { data: gcs }] = await Promise.all([
      sb.from('purchase_invoice_comments').select('*').eq('invoice_id', id).order('created_at'),
      sb.from('profiles').select('id,name,username')
        .in('role', ['admin','management','ops','accounts','fc_kaveri','fc_godawari'])
        .order('name'),
      // The GRN's own thread. A bill is the second half of one story that starts
      // at the gate — an argument about what arrived belongs in front of whoever
      // is deciding what to pay for it. Read-only here: the reply goes on
      // whichever document it belongs to.
      grnId
        ? sb.from('grn_comments').select('*').eq('grn_id', grnId).order('created_at')
        : Promise.resolve({ data: [] }),
    ])
    setComments([
      ...(gcs || []).map(c => ({ ...c, _from: 'GRN' })),
      ...(cs || []),
    ])
    setAllUsers(us || [])
  }

  function handleCommentInput(e) {
    const v = e.target.value
    setCommentText(v)
    const before = v.slice(0, e.target.selectionStart)
    const at = before.match(/@([\w.]*)$/)
    if (at) {
      const q = at[1].toLowerCase()
      const rect = e.target.getBoundingClientRect()
      setMentionQuery(q)
      setMentionSug(allUsers.filter(u =>
        u.name.toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q)).slice(0, 5))
      setMentionPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    } else { setMentionQuery(null); setMentionSug([]) }
  }

  function insertMention(name) {
    const cursor = commentRef.current?.selectionStart || commentText.length
    const slug = name.replace(/\s+/g, '_')
    const before = commentText.slice(0, cursor).replace(/@[\w.]*$/, '@' + slug + ' ')
    setCommentText(before + commentText.slice(cursor))
    setMentionQuery(null); setMentionSug([])
    setTimeout(() => commentRef.current?.focus(), 0)
  }

  // @First_Last is stored with underscores; shown with spaces.
  function renderMessage(msg) {
    if (!msg) return msg
    return msg.split(/(@[\w.]+)/g).map((part, i) =>
      part.startsWith('@')
        ? <span key={i} style={{ color:'var(--blue-800)', fontWeight:'var(--fw-semibold)' }}>{part.replace(/_/g, ' ')}</span>
        : part)
  }

  async function submitComment() {
    if (!commentText.trim() || posting) return
    setPosting(true)
    const text = commentText.trim()
    const tagged = [...text.matchAll(/@([\w.]+)/g)].map(m => m[1].replace(/_/g, ' '))
    const { error } = await sb.from('purchase_invoice_comments').insert({
      invoice_id: id, author_name: userName, message: text,
      tagged_users: tagged.length ? tagged : null, is_activity: false,
    })
    setPosting(false)
    if (error) { toast(friendlyError(error), 'error'); return }
    setCommentText('')
    await loadComments(inv?.grn_id)
  }

  // The match basis comes from the GRN lines and their OWN PO line — never from
  // purchase_invoices.po_id, which is "the first GRN line's PO" and is arbitrary
  // on a multi-PO GRN (grn.po_id is null on 1,451 of 1,452 GRNs). Walking the
  // line peg prices each line against the PO it actually came from.
  async function loadMatch(data) {
    const { data: t } = await sb.from('three_way_tolerance').select('*').eq('id', 1).maybeSingle()
    setTol(t || null)
    if (!data?.grn_id) { setMatchLines([]); return }

    const [{ data: basis, error: bErr }, { data: saved }] = await Promise.all([
      sb.rpc('pi_match_basis', { p_grn_id: data.grn_id }),
      sb.from('purchase_invoice_items').select('*').eq('invoice_id', data.id).order('created_at'),
    ])
    // A role without purchase-pricing access is refused by the RPC by design;
    // that is not an error worth a toast, the card simply does not offer a match.
    if (bErr) { setMatchLines([]); return }

    setSavedLines(saved || [])
    const byGrnItem = new Map((saved || []).map(r => [r.grn_item_id, r]))
    setMatchLines((basis || []).map(b => {
      const s = byGrnItem.get(b.grn_item_id)
      return {
        grn_item_id: b.grn_item_id,
        item_code:   b.item_code,
        description: b.description,
        matchedQty:  Number(b.accepted_qty) || 0,          // read-only, from the GRN
        orderedQty:  Number(b.ordered_qty)  || 0,
        rejectedQty: Number(b.rejected_qty) || 0,
        poPrice:     b.po_unit_price == null ? null : Number(b.po_unit_price),  // read-only, from the PO
        // Editable. Quantity defaults to what was accepted — the common case is
        // that the vendor bills exactly what you took in.
        billedQty:   s?.billed_qty     != null ? String(s.billed_qty)     : String(Number(b.accepted_qty) || 0),
        invPrice:    s?.inv_unit_price != null ? String(s.inv_unit_price) : '',
        // Whose price stands on THIS line. Asked per line because one invoice
        // can carry both: our pricing error on some items, their overcharge on
        // others.
        decision:    s?.price_decision || '',
      }
    }))
  }

  function updateLine(idx, field, value) {
    setMatchLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  // Pre-fill every blank rate with the PO rate. The common case is that the
  // vendor billed exactly what was agreed, so accounts should only have to touch
  // the lines that differ — that is what keeps this from being data entry.
  function fillFromPo() {
    setMatchLines(prev => prev.map(l =>
      l.invPrice === '' && l.poPrice != null ? { ...l, invPrice: String(l.poPrice) } : l))
  }

  // ── Stage 1: the actual three-way match ──
  //
  // This used to be a non-empty check on a notes box and nothing else. On
  // SSC/GRN0683 someone typed "Mismatch in Price" into it and the bill advanced,
  // because a non-empty string was the entire control. The verdict is now
  // computed and stored by the database; this only asks for the rates.
  async function handleRecordMatch() {
    if (!vendorInvoiceNum.trim()) { toast('Enter the vendor invoice number'); return }
    if (!vendorInvoiceDate)       { toast('Enter the vendor invoice date'); return }
    if (taxable === '')           { toast('Enter the taxable amount from the invoice (before GST)'); return }
    if (undecided.length) {
      toast(`Say which price is right for ${undecided.map(u => u.item_code).join(', ')}.`, 'error')
      return
    }
    if (matchLines.some(l => l.decision) && priceNote.trim().length < 10) {
      toast('Say in a sentence how you know which price is right — it goes on the record.', 'error')
      return
    }
    const missing = matchLines.filter(l => l.invPrice === '' && l.poPrice != null)
    if (missing.length) {
      toast(`Enter the rate the vendor charged for ${missing[0].item_code}` +
            (missing.length > 1 ? ` and ${missing.length - 1} more` : ''))
      return
    }

    setSaving(true)
    const { data, error } = await sb.rpc('pi_record_match', {
      p_invoice_id:     id,
      p_invoice_number: vendorInvoiceNum.trim(),
      p_invoice_date:   vendorInvoiceDate,
      p_taxable:        Number(taxable) || 0,
      // The split is authoritative now; this total is derived from it so the two
      // can never disagree. gstAmount is only still read on the legacy stage-2
      // path, for the bills that never went through the match.
      p_gst:            (Number(cgst) || 0) + (Number(sgst) || 0) + (Number(igst) || 0),
      p_freight:        Number(freight) || 0,
      p_lines: matchLines.map(l => ({
        grn_item_id:    l.grn_item_id,
        billed_qty:     l.billedQty === '' ? null : Number(l.billedQty),
        inv_unit_price: l.invPrice  === '' ? null : Number(l.invPrice),
        price_decision: l.decision || null,
      })),
      p_notes: threeWayNotes.trim() || null,
      // Only sent once the clash has been consciously acknowledged below.
      p_duplicate_ack_invoice_id: dupSibling?.id || null,
      p_duplicate_ack_reason:     dupSibling ? dupReason.trim() : null,
      p_price_decision_note: priceNote.trim() || null,
      p_cgst: Number(cgst) || 0,
      p_sgst: Number(sgst) || 0,
      p_igst: Number(igst) || 0,
    })
    if (error) {
      // 23505 = the duplicate-invoice-number refusal. Find the sibling and offer
      // the consolidated-invoice path rather than leaving accounts stuck with an
      // error they cannot act on.
      if (error.code === '23505' && !dupSibling) {
        const { data: sib } = await sb.from('purchase_invoices')
          .select('id,invoice_number,invoice_date,invoice_amount,total_amount,grn_id,status')
          .eq('vendor_id', inv.vendor_id).neq('id', id).neq('status', 'cancelled')
          .ilike('invoice_number', vendorInvoiceNum.trim()).limit(1).maybeSingle()
        if (sib) { setDupSibling(sib); setSaving(false); return }
      }
      toast(friendlyError(error), 'error'); setSaving(false); return
    }
    setDupSibling(null); setDupReason('')

    // The database's verdict, not ours — ours was only ever a preview.
    if (data?.needs_override) {
      toast(data.advanced
        ? 'Recorded — variance flagged for review'
        : 'Variance is outside tolerance. It needs releasing by admin or management.', 'error')
    } else {
      toast('Matched against the PO', 'success')
    }
    setSaving(false)
    await loadInvoice()
  }

  // ── The debit note: money going back to the vendor ──
  // Mirrors the customer-side credit note exactly, including its philosophy —
  // ACCOUNTING LIVES IN TALLY. The note is made there; this raises the claim,
  // holds the document, and keeps the bill payment-blocked until it is attached.
  // Without this the bill reads "debit note pending" forever and the block never
  // clears, which is where the flow stopped before.
  // NOTE: there is no manual "raise" action. pi_record_match() raises the debit
  // note itself the moment a line is marked "Ours" or billed above what the
  // store accepted — the claim follows from the decision, so asking for it as a
  // second step would only be a way to forget it.
  async function handleAttachDebitNote() {
    if (!dnNumber.trim()) { toast('Enter the debit note number from Tally'); return }
    setSaving(true)
    let url = inv.debit_note_url || null
    if (dnFile) {
      const okType = dnFile.type === 'application/pdf' || dnFile.type.startsWith('image/')
      if (!okType) { toast('The note must be a PDF or a photo', 'error'); setSaving(false); return }
      const ext  = dnFile.type === 'application/pdf' ? 'pdf' : 'jpg'
      const path = `debit-notes/${id}/dn-${Date.now()}.${ext}`
      // vendor-docs, not po-documents: that bucket caps at 200 KB.
      const { error: upErr } = await sb.storage.from('vendor-docs')
        .upload(path, dnFile, { upsert: true, contentType: dnFile.type })
      if (upErr) { toast(friendlyError(upErr, 'Upload failed.'), 'error'); setSaving(false); return }
      url = sb.storage.from('vendor-docs').getPublicUrl(path).data.publicUrl
    }
    const { error } = await sb.rpc('pi_attach_debit_note', {
      p_invoice_id: id, p_number: dnNumber.trim(), p_url: url,
    })
    setSaving(false)
    if (error) { toast(friendlyError(error), 'error'); return }
    toast('Debit note recorded. Send it to the vendor.', 'success')
    setDnNumber(''); setDnFile(null)
    await loadInvoice()
  }

  // ── Release a flagged bill ──
  // A SECOND person, with a reason. Whoever matched the bill cannot release it —
  // SAP splits MIRO from MRBR for exactly this reason, and the RPC enforces it
  // regardless of what this screen allows.
  async function handleRelease() {
    if (!relCode)                 { toast('Pick a reason'); return }
    if (relReason.trim().length < 10) { toast('Say in a sentence why — it goes on the record'); return }
    setSaving(true)
    const { error } = await sb.rpc('pi_override_match', {
      p_invoice_id: id, p_reason_code: relCode, p_reason: relReason.trim(),
    })
    if (error) { toast(friendlyError(error), 'error'); setSaving(false); return }
    toast('Released. The bill is marked payment-blocked.', 'success')
    setRelCode(''); setRelReason('')
    setSaving(false)
    await loadInvoice()
  }

  // ── Stage 2: Generate Purchase Invoice ──
  async function handleGenerateInvoice() {
    // These were captured and verified at the match for any bill that went
    // through it. Only the legacy cohort — the 15 bills that were already at
    // invoice_pending before the match existed — still keys them in here.
    if (!inv.match_status) {
      if (!vendorInvoiceNum.trim()) { toast('Enter vendor invoice number'); return }
      if (!vendorInvoiceDate) { toast('Enter vendor invoice date'); return }
      if (!invoiceAmount) { toast('Enter invoice amount'); return }
    }

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

    // A bill that went through the match already has its amounts set BY THE RPC,
    // against which the verdict was computed. Rewriting them from this form would
    // silently detach the stored variance from the figures it was derived from —
    // and since this form's invoice_amount is not what the match captured
    // (the match stores taxable_amount), it would write 0. So for a matched bill
    // this stage only attaches the documents and completes.
    const amountFields = inv.match_status ? {} : {
      invoice_number: vendorInvoiceNum.trim(),
      invoice_date: vendorInvoiceDate,
      invoice_amount: Number(invoiceAmount) || 0,
      gst_amount: Number(gstAmount) || 0,
      total_amount: totalAmt,
    }

    const { error } = await sb.from('purchase_invoices').update({
      status: 'inward_complete',
      ...amountFields,
      vendor_invoice_url: vendorPdfUrl,
      ssc_invoice_url: sscPdfUrl,
      inward_completed_at: new Date().toISOString(),
      inward_completed_by: userName,
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }

    // Auto-close PO only if BOTH conditions hold:
    //  (1) every linked purchase invoice is inward_complete, AND
    //  (2) every po_items line is fully received (received_qty >= qty).
    // Without (2), a single partial GRN + inward-complete invoice would close the
    // entire PO even though most items are still pending — that bug closed PO0023
    // with 11,223 of 12,425 units still outstanding.
    const poId = inv.po_id
    if (poId) {
      const { count: pendingPiCount } = await sb.from('purchase_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('po_id', poId)
        .neq('status', 'inward_complete')
        .neq('id', id)
      if (pendingPiCount === 0) {
        const { data: poItemsRows } = await sb.from('po_items').select('qty, received_qty').eq('po_id', poId)
        const fullyReceived = (poItemsRows || []).length > 0
          && (poItemsRows || []).every(it => (Number(it.received_qty) || 0) >= (Number(it.qty) || 0))
        if (fullyReceived) {
          await sb.from('purchase_orders').update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', poId)
        }
      }
    }

    toast('Inward complete!', 'success')
    setSaving(false)
    await loadInvoice()
  }

  // ── Loading / Not Found ──
  if (loading) return (
    <Layout pageTitle="Purchase Invoice" pageKey="billing">
      <div className="od-page"><Loading /></div>
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

  // Live PREVIEW of the verdict, so the person keying the rates sees the answer
  // before submitting. The stored verdict is the database's — this is never sent.
  const preview = tol && matchLines.length
    ? billVerdict(matchLines.map(l => ({
        matchedQty: l.matchedQty,
        billedQty:  l.billedQty === '' ? null : Number(l.billedQty),
        poPrice:    l.poPrice,
        invPrice:   l.invPrice === '' ? null : Number(l.invPrice),
        // Carried through because everything downstream reads it off the preview
        // line: whether the item is still undecided, how much to recover, and
        // whether the save button unlocks. Dropping it here left the button
        // stuck on "Decide 1 item first" however the dropdown was set.
        item_code:  l.item_code,
        decision:   l.decision,
      })), tol)
    : null
  const anyRateEntered = matchLines.some(l => l.invPrice !== '')
  // Does any line's rate disagree? Only then is there a decision column to show.
  const anyDiff = !!preview?.lines?.some(x =>
    x.v?.status === 'over_tolerance' && Math.abs(x.v?.rateVariance || 0) > 0.01)
  // Every disagreeing line needs its own answer before this can be saved.
  const undecided = (preview?.lines || []).filter(x =>
    x.v?.status === 'over_tolerance' && Math.abs(x.v?.rateVariance || 0) > 0.01 && !x.decision)
  // What the vendor owes back: only the lines where our PO stands, plus anything
  // billed above what the store actually accepted.
  const toRecover = (preview?.lines || []).reduce((s, x) =>
    s + (x.decision === 'po_correct' ? Math.max(x.v?.rateVariance || 0, 0) : 0)
      + Math.max(x.v?.qtyVariance || 0, 0), 0)
  const nPoRight  = (preview?.lines || []).filter(x => x.decision === 'po_correct').length
  const nInvRight = (preview?.lines || []).filter(x => x.decision === 'invoice_correct').length
  const homeState = tol?.home_state_code || '24'
  const isLocal   = gstModeOverride ? gstModeOverride === 'local'
                                    : (vendorState ? vendorState === homeState : true)
  const gstTotal  = isLocal ? (Number(cgst) || 0) + (Number(sgst) || 0) : (Number(igst) || 0)
  const gstCheck  = gstPlausible(Number(taxable) || 0, gstTotal, tol?.gst_rates)
  // CGST and SGST are always equal halves. If they are not, it is a typo.
  const gstHalvesOdd = isLocal && (Number(cgst) || 0) > 0 && (Number(sgst) || 0) > 0
                       && Math.abs((Number(cgst) || 0) - (Number(sgst) || 0)) > 0.01
  const canMatch = inv.status === 'three_way_check' && matchLines.length > 0 && tol
  const isFlagged = ['over_tolerance','no_basis','partial_basis'].includes(inv.match_status)
  // Only admin/management, and NEVER the person who matched it. The RPC enforces
  // both regardless of what this screen renders — this just avoids offering a
  // button that would be refused.
  const iMatchedThis  = !!inv.match_computed_by_id && inv.match_computed_by_id === userId
  const releaseRoleOk = (tol?.override_roles || ['admin','management']).includes(userRole)
  const canRelease    = isFlagged && !inv.override_at && releaseRoleOk && !iMatchedThis

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
                      <div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>
                        {pos.length > 1 ? `Purchase Orders (${pos.length})` : 'Purchase Order'}
                      </div>
                      {pos.length > 0 ? (
                        <div style={{display:'flex',flexDirection:'column',gap:10}}>
                          {pos.map((p, idx) => (
                            <div key={p.id} style={{paddingTop:idx>0?8:0,borderTop:idx>0?'1px dashed var(--gray-200)':'none'}}>
                              {['admin','ops','management'].includes(userRole) ? (
                                <div onClick={() => navigate('/procurement/po/' + p.id)} style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#2563eb',cursor:'pointer'}}>{p.po_number}</div>
                              ) : (
                                <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'var(--gray-800)'}}>{p.po_number}</div>
                              )}
                              <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{fmtINR(p.total_amount)}</div>
                              <a onClick={() => openPoHtmlForId(p.id)} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#2563eb',cursor:'pointer',marginTop:4,textDecoration:'none'}}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:11,height:11}}><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v7H3V3h7"/></svg>
                                View PO
                              </a>
                            </div>
                          ))}
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
                          <a onClick={() => openGrnHtmlForId(grn.id)} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:11,color:'#2563eb',cursor:'pointer',marginTop:4,textDecoration:'none'}}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:11,height:11}}><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M21 14v7H3V3h7"/></svg>
                            View GRN
                          </a>
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

                  {/* ── The match ───────────────────────────────────────── */}
                  {canMatch ? (
                    <div className="twm-split">
                      <div>
                        {/* The invoice, first and full width — you read it before
                            you can key anything off it. */}
                        {(() => {
                          const docUrl = inv.vendor_invoice_url || grn?.vendor_invoice_url
                          const isPdf  = docUrl && /\.pdf($|\?)/i.test(docUrl)
                          return (
                            <div className="twm-doc">
                              {docUrl && !isPdf && (
                                <a href={docUrl} target="_blank" rel="noopener noreferrer">
                                  <img src={docUrl} alt="Vendor invoice" />
                                </a>
                              )}
                              <div className="twm-doc-main">
                                <div className="twm-total-label">Vendor invoice</div>
                                {docUrl ? (
                                  <a href={docUrl} target="_blank" rel="noopener noreferrer"
                                     style={{fontSize:'var(--fs-sm)',color:'var(--blue-800)',fontWeight:'var(--fw-semibold)'}}>
                                    {isPdf ? 'Open the PDF ↗' : 'Open full size ↗'}
                                  </a>
                                ) : (
                                  <div className="twm-doc-empty">
                                    Not attached — it is photographed at the GRN, where the goods
                                    and the bill arrive together.
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })()}

                        {/* What the vendor's invoice says. Captured HERE, at the
                            stage that actually compares it — not at stage 2,
                            after the check has already passed. */}
                        <div className="twm-fields">
                          <div className="twm-field">
                            <label>Invoice number *</label>
                            <input value={vendorInvoiceNum} onChange={e => setVendorInvoiceNum(e.target.value)}
                                   placeholder="as printed on the bill" />
                          </div>
                          <div className="twm-field">
                            <label>Invoice date *</label>
                            <input type="date" value={vendorInvoiceDate}
                                   onChange={e => setVendorInvoiceDate(e.target.value)} />
                          </div>
                          <div className="twm-field">
                            <label>Taxable value *</label>
                            <input type="number" step="0.01" min="0" value={taxable}
                                   onChange={e => setTaxable(e.target.value)} placeholder="0.00" />
                          </div>
                          {isLocal ? (
                            <>
                              <div className="twm-field">
                                <label>CGST</label>
                                <input type="number" step="0.01" min="0" value={cgst}
                                       onChange={e => { setCgst(e.target.value); setIgst('') }}
                                       placeholder="0.00" />
                              </div>
                              <div className="twm-field">
                                <label>SGST</label>
                                <input type="number" step="0.01" min="0" value={sgst}
                                       onChange={e => { setSgst(e.target.value); setIgst('') }}
                                       placeholder="0.00" />
                              </div>
                            </>
                          ) : (
                            <div className="twm-field">
                              <label>IGST</label>
                              <input type="number" step="0.01" min="0" value={igst}
                                     onChange={e => { setIgst(e.target.value); setCgst(''); setSgst('') }}
                                     placeholder="0.00" />
                            </div>
                          )}
                          <div className="twm-field">
                            <label>of which freight/packing</label>
                            <input type="number" step="0.01" min="0" value={freight}
                                   onChange={e => setFreight(e.target.value)} placeholder="0.00" />
                          </div>
                        </div>

                        {/* GST is recorded and sanity-checked, never matched: a PO
                            carries no tax columns, so there is no expected GST to
                            compare against. Informational only. */}
                        {/* Freight the supplier charges is part of the taxable
                            value — GST applies to it — so it goes INSIDE the
                            taxable figure and is named separately only so the
                            match can compare goods against goods. */}
                        <div className="twm-hint" style={{marginTop:0,marginBottom:12}}>
                          <strong>Taxable value</strong> is the figure GST is charged on, exactly as the
                          bill shows it — including any freight or packing they have charged. Put that
                          freight in the second box as well, so the item rates can be checked on their own.
                        </div>

                        {/* Which pair of boxes is shown is derived from the
                            vendor's GSTIN, but a vendor can bill from a different
                            registration, so it stays changeable. */}
                        <div className="twm-hint" style={{marginTop:0,marginBottom:12}}>
                          {vendorState
                            ? <>{inv.vendor_name} is registered in state {vendorState}
                                {isLocal ? ' — same as ours, so the bill carries CGST + SGST.'
                                         : ' — outside ours, so the bill carries IGST.'}{' '}</>
                            : <>No GSTIN on this vendor, so the split cannot be worked out. </>}
                          <button type="button" className="grnq-link" style={{display:'inline'}}
                                  onClick={() => setGstModeOverride(isLocal ? 'inter' : 'local')}>
                            {isLocal ? 'It is actually IGST' : 'It is actually CGST + SGST'}
                          </button>
                        </div>

                        {gstHalvesOdd && (
                          <div className="twm-verdict warn" style={{marginTop:0,marginBottom:12}}>
                            <div>CGST and SGST are always equal, but these differ by{' '}
                              {fmtMoneyFull(Math.abs((Number(cgst)||0) - (Number(sgst)||0)))}. Worth re-reading the bill.</div>
                          </div>
                        )}

                        {!gstCheck.ok && gstCheck.impliedPct != null && (
                          <div className="twm-verdict warn" style={{marginTop:0,marginBottom:12}}>
                            <div>That works out to {gstCheck.impliedPct.toFixed(1)}% GST, and the nearest
                              real slab is {gstCheck.nearest}%. Worth a second look — it is recorded either
                              way, and never matched against the PO.</div>
                          </div>
                        )}

                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6,gap:10,flexWrap:'wrap'}}>
                          <div style={{fontSize:'var(--fs-sm)',fontWeight:'var(--fw-semibold)',color:'var(--gray-700)'}}>
                            What did they charge?
                          </div>
                          <button className="od-btn" onClick={fillFromPo} disabled={saving}>
                            They charged the agreed rate
                          </button>
                        </div>

                        <div className="twm-scroll">
                          <div className="twm-grid">
                            <div className="twm-row twm-head">
                              <div>Item</div>
                              <div className="r">Qty on bill</div>
                              <div className="r">Agreed rate</div>
                              <div className="r">They charged</div>
                              <div className="r">Difference</div>
                              {anyDiff && <div>Which is right?</div>}
                            </div>
                            {matchLines.map((l, idx) => {
                              const v = preview?.lines?.[idx]?.v
                              const tone = v?.status === 'over_tolerance' ? 'warn'
                                         : v?.status === 'no_basis' ? 'none' : 'ok'
                              return (
                                <div className="twm-row" key={l.grn_item_id}>
                                  <div className="twm-cell twm-code">
                                    {l.item_code}
                                    {l.rejectedQty > 0 && (
                                      <span className="twm-pill warn" style={{marginLeft:6}}>
                                        {l.rejectedQty} rejected
                                      </span>
                                    )}
                                  </div>
                                  {/* Quantity billed. Prefilled with what the store
                                      actually took in; if the vendor billed more,
                                      the shortfall shows underneath rather than
                                      silently sitting in a second column. */}
                                  <div className="twm-cell" data-label="Qty on bill">
                                    <input className="twm-input" type="number" step="any" min="0"
                                           value={l.billedQty}
                                           onChange={e => updateLine(idx, 'billedQty', e.target.value)} />
                                    {Number(l.billedQty) !== l.matchedQty && (
                                      <div className="twm-sub">we took in {l.matchedQty}</div>
                                    )}
                                  </div>
                                  {/* The agreed rate, from the PO. Never editable
                                      here — the PO is the commitment record. */}
                                  <div className="twm-cell twm-num twm-fixed" data-label="Agreed rate">
                                    {l.poPrice == null ? '—' : fmtMoneyFull(l.poPrice)}
                                  </div>
                                  <div className="twm-cell" data-label="They charged">
                                    <input
                                      className={'twm-input' + (v?.status === 'over_tolerance' ? ' twm-flag' : '')}
                                      type="number" step="any" min="0" value={l.invPrice}
                                      placeholder={l.poPrice == null ? 'no agreed rate' : String(l.poPrice)}
                                      onChange={e => updateLine(idx, 'invPrice', e.target.value)} />
                                  </div>
                                  <div className={'twm-cell twm-var ' + tone} data-label="Difference">
                                    {v?.rateVariance == null ? '—'
                                      : Math.abs(v.rateVariance) < 0.005 ? 'same'
                                      : `${v.rateVariance > 0 ? '+' : ''}${fmtMoneyFull(v.rateVariance)}`}
                                  </div>
                                  {anyDiff && (
                                    <div className="twm-cell" data-label="Which is right?">
                                      {/* Two buttons, not a dropdown. The select
                                          truncated to "Our PO — recover the dif"
                                          in the column width available, which is
                                          worse than no label at all. */}
                                      {v?.status === 'over_tolerance' && Math.abs(v.rateVariance || 0) > 0.01 ? (
                                        <div className={'twm-seg' + (l.decision ? '' : ' undecided')}>
                                          <button type="button"
                                                  className={l.decision === 'invoice_correct' ? 'on' : ''}
                                                  onClick={() => updateLine(idx, 'decision', 'invoice_correct')}
                                                  title="Their bill is right — our PO was raised at the wrong price. Nothing to recover.">
                                            Theirs
                                          </button>
                                          <button type="button"
                                                  className={l.decision === 'po_correct' ? 'on' : ''}
                                                  onClick={() => updateLine(idx, 'decision', 'po_correct')}
                                                  title="Our PO is right — they overcharged. Recover the difference.">
                                            Ours
                                          </button>
                                        </div>
                                      ) : <span className="twm-fixed">—</span>}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>

                        {/* Rate variance and quantity variance are shown apart on
                            purpose — the fixes differ. A rate variance means our PO
                            or price book is wrong; a quantity variance means the
                            vendor owes us money back. */}
                        {preview && anyRateEntered && (
                          <>
                            <div className="twm-totals">
                              <div className="twm-total">
                                <div className="twm-total-label">Agreed on the PO</div>
                                <div className="twm-total-value">{fmtMoneyFull(preview.expected)}</div>
                              </div>
                              <div className="twm-total">
                                <div className="twm-total-label">They are asking for</div>
                                <div className="twm-total-value">{fmtMoneyFull(preview.billed)}</div>
                              </div>
                              {Math.abs(preview.rateVariance) > 0.01 && (
                                <div className="twm-total flag">
                                  <div className="twm-total-label">
                                    {preview.rateVariance > 0 ? 'Charged extra' : 'Charged less'}
                                  </div>
                                  <div className="twm-total-value">{fmtMoneyFull(Math.abs(preview.rateVariance))}</div>
                                </div>
                              )}
                              {Math.abs(preview.qtyVariance) > 0.01 && (
                                <div className="twm-total flag">
                                  <div className="twm-total-label">Billed for goods we did not take</div>
                                  <div className="twm-total-value">{fmtMoneyFull(Math.abs(preview.qtyVariance))}</div>
                                </div>
                              )}
                            </div>

                            {!preview.needsOverride && (
                              <div className="twm-verdict ok">
                                <div>
                                  <div className="twm-verdict-title">This bill agrees with the PO</div>
                                  Nothing to explain — save it and it moves on.
                                </div>
                              </div>
                            )}

                            {/* The decision is per LINE, because one invoice can
                                carry both kinds at once: our pricing error on some
                                items and their overcharge on others. A single
                                answer for the whole bill would be untrue either
                                way, and would raise or waive the wrong money. */}
                            {anyDiff && (
                              <div className="twm-verdict warn">
                                <div style={{width:'100%'}}>
                                  <div className="twm-verdict-title">
                                    {undecided.length
                                      ? `${undecided.length} item${undecided.length > 1 ? 's' : ''} priced differently to the PO`
                                      : 'Priced differently to the PO'}
                                  </div>
                                  {undecided.length ? (
                                    <>In the last column pick one for each:<br />
                                      <strong>Theirs</strong> — their bill is right, our PO was raised at the wrong
                                      price. Nothing to recover, but the price book needs fixing.<br />
                                      <strong>Ours</strong> — our PO is right, they have overcharged. We claim the
                                      difference back with a debit note.</>
                                  ) : (
                                    <>
                                      {nInvRight > 0 && <div>{nInvRight} item{nInvRight > 1 ? 's' : ''}: their price
                                        accepted — our PO was raised wrong, so nothing is owed. Worth fixing in the
                                        price book.</div>}
                                      {nPoRight > 0 && <div>{nPoRight} item{nPoRight > 1 ? 's' : ''}: our PO stands —
                                        they overcharged.</div>}
                                      {toRecover > 0.01 && (
                                        <div style={{marginTop:6}}>
                                          <strong>Recover {fmtMoneyFull(toRecover)}</strong> from {inv.vendor_name}
                                          {' '}with a debit note. This is raised for you when you save.
                                        </div>
                                      )}
                                      <div className="twm-field" style={{marginTop:10,marginBottom:0}}>
                                        <label>How do you know? *</label>
                                        <input value={priceNote} onChange={e => setPriceNote(e.target.value)}
                                               placeholder="e.g. their price list confirms 40% off; our PO used 26%" />
                                        <div className="twm-hint" style={{marginTop:4}}>
                                          Required. It goes on the record, and where we are claiming money
                                          back it is what the vendor will be shown.
                                        </div>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Do the lines add up to the invoice header? Two
                                independently entered numbers — the per-item rates,
                                and the taxable total off the bill — and nothing
                                was comparing them. A few paise is the vendor's
                                round-off; anything larger is a line not captured,
                                a discount at the bottom of the bill, or a charge
                                with no home. */}
                            {taxable !== '' && (() => {
                              const header = (Number(taxable) || 0) - (Number(freight) || 0)
                              const gap    = header - preview.billed
                              if (Math.abs(gap) <= 1) return null
                              return (
                                <div className="twm-verdict warn">
                                  <div>
                                    <div className="twm-verdict-title">
                                      The items and the invoice total do not agree
                                    </div>
                                    The rates above come to <strong>{fmtMoneyFull(preview.billed)}</strong>, but
                                    the goods value on the bill is <strong>{fmtMoneyFull(header)}</strong> —
                                    a difference of {fmtMoneyFull(Math.abs(gap))}.
                                    {gap > 0
                                      ? ' Something on the bill is not in the list above: another item, or a charge. If it is freight or packing, put it in the freight box.'
                                      : ' The bill is lower than the items — check for a discount at the bottom of the invoice.'}
                                  </div>
                                </div>
                              )
                            })()}

                            {preview.noBasisLines > 0 && (
                              <div className="twm-verdict warn">
                                <div>{preview.noBasisLines} item(s) have no price on the PO, so there is
                                  nothing to compare them against.</div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Optional on a clean match, and that is deliberate: a
                            machine-verified match should not demand prose. It was
                            the mandatory free-text box that made this theatre. */}
                        <div className="twm-field" style={{marginTop:12}}>
                          <label>Notes {preview?.needsOverride ? '' : '(optional)'}</label>
                          <textarea value={threeWayNotes} onChange={e => setThreeWayNotes(e.target.value)}
                                    placeholder="Anything worth recording about this bill." />
                        </div>

                        {/* The duplicate-number clash, made actionable. */}
                        {dupSibling && (
                          <div className="twm-verdict warn">
                            <div style={{width:'100%'}}>
                              <div className="twm-verdict-title">
                                Invoice {vendorInvoiceNum.trim()} is already booked on another bill
                              </div>
                              <div>
                                Dated {fmtShort(dupSibling.invoice_date)}, {fmtMoneyFull(dupSibling.total_amount || dupSibling.invoice_amount)}.
                                {' '}If this one invoice genuinely covers both receipts, say so and it will be
                                recorded as a consolidated invoice with a payment block. If it is a re-entry,
                                cancel this bill instead.
                              </div>
                              <div className="twm-field" style={{marginTop:10}}>
                                <label>Why does one invoice cover both? *</label>
                                <textarea value={dupReason} onChange={e => setDupReason(e.target.value)}
                                          placeholder="e.g. Hummel billed GRN0401 and GRN0409 on one invoice." />
                              </div>
                              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                                <button className="od-btn" onClick={() => navigate('/procurement/invoices/' + dupSibling.id)}>
                                  Open the other bill
                                </button>
                                <button className="od-btn" onClick={() => { setDupSibling(null); setDupReason('') }}>
                                  Cancel
                                </button>
                                <button className="od-btn od-btn-approve" onClick={handleRecordMatch}
                                        disabled={saving || dupReason.trim().length < 10}>
                                  Record as consolidated
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* The label says what happens, because it is not the same
                            thing every time: a bill that agrees moves straight on,
                            one that does not stops for approval. A button called
                            "Match against PO" told the user neither. */}
                        {!dupSibling && (() => {
                          const clean = preview && !preview.needsOverride && anyRateEntered
                          return (
                            <>
                              <button className="od-btn od-btn-approve" onClick={handleRecordMatch}
                                      disabled={saving || undecided.length > 0}>
                                {saving ? 'Saving…'
                                  : !anyRateEntered ? 'Save this bill'
                                  : undecided.length ? `Decide ${undecided.length} item${undecided.length > 1 ? 's' : ''} first`
                                  : clean ? 'Save — bill agrees with the PO'
                                          : 'Save and send for approval'}
                              </button>
                              <div className="twm-hint">
                                {!anyRateEntered
                                  ? 'Enter what they charged for each item first.'
                                  : clean
                                    ? 'Saves the rates and moves this bill on to attach the documents and hand it to Tally. Nothing else needed.'
                                    : undecided.length
                                    ? 'Use the last column to say whose price stands on each item that differs.'
                                    : <>Saves the rates and your answers, {toRecover > 0.01
                                        ? <>raises a debit note for <strong>{fmtMoneyFull(toRecover)}</strong>, </>
                                        : null}and marks the bill
                                        <strong> do not pay in full</strong> until someone approves it.
                                        You cannot approve your own — it goes to admin or management.</>}
                              </div>
                            </>
                          )
                        })()}
                      </div>

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

              {/* ── The stored verdict, and releasing a flagged bill ──────── */}
              {inv.match_status && (
                <div className="od-card" style={{marginTop:16}}>
                  <div className="od-card-header">
                    <div className="od-card-title">Match result</div>
                    <span className={'twm-pill ' + (MATCH_LABELS[inv.match_status]?.tone === 'ok' ? 'ok' : 'warn')}>
                      {MATCH_LABELS[inv.match_status]?.label || inv.match_status}
                    </span>
                  </div>
                  <div className="od-card-body">
                    <div className="twm-totals">
                      <div className="twm-total">
                        <div className="twm-total-label">Expected (PO)</div>
                        <div className="twm-total-value">{fmtMoneyFull(inv.match_expected_taxable)}</div>
                      </div>
                      <div className="twm-total">
                        <div className="twm-total-label">Billed</div>
                        <div className="twm-total-value">{fmtMoneyFull(inv.match_billed_taxable)}</div>
                      </div>
                      <div className={'twm-total' + (Math.abs(Number(inv.match_variance_amount) || 0) > 0.01 ? ' flag' : '')}>
                        <div className="twm-total-label">Variance</div>
                        <div className="twm-total-value">{fmtMoneyFull(inv.match_variance_amount)}</div>
                      </div>
                      <div className={'twm-total' + (Math.abs(Number(inv.match_qty_variance_amt) || 0) > 0.01 ? ' flag' : '')}>
                        <div className="twm-total-label">Of which quantity</div>
                        <div className="twm-total-value">{fmtMoneyFull(inv.match_qty_variance_amt)}</div>
                      </div>
                    </div>

                    {/* Which price stands, line by line. The totals alone never
                        said whose price we accepted — and that is the decision
                        the whole screen exists to capture. */}
                    {savedLines.some(l => l.price_decision) && (
                      <div className="twm-scroll" style={{marginTop:12}}>
                        <div className="twm-grid">
                          <div className="twm-row twm-head twm-row-d">
                            <div>Item</div><div className="r">Our PO</div>
                            <div className="r">They charged</div><div>Whose price stands</div>
                          </div>
                          {savedLines.filter(l => l.price_decision).map(l => (
                            <div className="twm-row twm-row-d" key={l.id}>
                              <div className="twm-cell twm-code">{l.item_code}</div>
                              <div className="twm-cell twm-num twm-fixed" data-label="Our PO">{fmtMoneyFull(l.po_unit_price)}</div>
                              <div className="twm-cell twm-num twm-fixed" data-label="They charged">{fmtMoneyFull(l.inv_unit_price)}</div>
                              <div className="twm-cell" data-label="Whose price stands">
                                {l.price_decision === 'po_correct'
                                  ? <span className="twm-pill warn">Ours — they overcharged, recovering it</span>
                                  : <span className="twm-pill ok">Theirs — our PO was wrong, nothing recovered</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{fontSize:'var(--fs-label)',color:'var(--gray-500)',marginTop:10}}>
                      Matched by {inv.match_computed_by || '—'}, {fmtDateTime(inv.match_computed_at)}
                      {inv.match_worst_line_pct > 0 && ` · worst line ${Number(inv.match_worst_line_pct).toFixed(1)}%`}
                      {inv.match_no_basis_lines > 0 && ` · ${inv.match_no_basis_lines} line(s) with no PO price`}
                      {' · tolerance applied '}{inv.match_tol_pct}% / {fmtMoneyFull(inv.match_tol_abs)}
                    </div>

                    {/* Payment block: the document proceeds and still goes to
                        Tally — the PAYMENT is what carries the flag. Nothing is
                        stuck. This is SAP's payment block, not a document block. */}
                    {inv.payment_block && (
                      <div className="twm-verdict warn">
                        <div>
                          <div className="twm-verdict-title">Payment blocked</div>
                          {inv.override_at ? (
                            <>Released by {inv.override_by}, {fmtDateTime(inv.override_at)} —
                              {' '}{(inv.override_reason_code || '').replace(/_/g, ' ')}.
                              <div style={{marginTop:4}}>“{inv.override_reason}”</div></>
                          ) : (
                            <>This bill is flagged. It can go to Tally, but do not pay it in full
                              until the variance is settled.</>
                          )}
                          {inv.debit_note_required && !inv.debit_note_uploaded_at && (
                            <div style={{marginTop:6,fontWeight:'var(--fw-semibold)'}}>
                              Debit note pending — {fmtMoneyFull(inv.debit_note_amount)} to recover from the vendor.
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              )}


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
                          {inv.match_status
                            ? 'The figures below were captured and checked against the PO at the match. Attach the documents to complete.'
                            : 'Enter the vendor invoice details and upload the invoice document.'}
                        </p>
                        {/* A matched bill shows its verified figures, not empty
                            inputs — re-keying them here would detach the stored
                            variance from the numbers it was computed against. */}
                        {inv.match_status ? (
                          <div className="twm-totals" style={{marginTop:0,marginBottom:16}}>
                            <div className="twm-total">
                              <div className="twm-total-label">Invoice no.</div>
                              <div className="twm-total-value">{inv.invoice_number || '—'}</div>
                            </div>
                            <div className="twm-total">
                              <div className="twm-total-label">Taxable</div>
                              <div className="twm-total-value">{fmtMoneyFull(inv.taxable_amount)}</div>
                            </div>
                            <div className="twm-total">
                              <div className="twm-total-label">GST</div>
                              <div className="twm-total-value">{fmtMoneyFull(inv.gst_amount)}</div>
                            </div>
                            <div className="twm-total">
                              <div className="twm-total-label">Total</div>
                              <div className="twm-total-value">{fmtMoneyFull(inv.total_amount)}</div>
                            </div>
                          </div>
                        ) : (
                        <>
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
                        </>
                        )}
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
                          <div>
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Upload Vendor Invoice (PDF)</label>
                            <label className={'twm-upload' + (vendorInvoiceFile ? ' has' : '')}>
                              <input type="file" accept=".pdf,image/*"
                                     onChange={e => setVendorInvoiceFile(e.target.files?.[0] || null)} />
                              {vendorInvoiceFile ? `✓ ${vendorInvoiceFile.name}` : 'Choose PDF or photo'}
                            </label>
                          </div>
                          <div>
                            <label style={{fontSize:12,fontWeight:600,color:'var(--gray-600)',marginBottom:6,display:'block'}}>Upload SSC Purchase Invoice (PDF)</label>
                            <label className={'twm-upload' + (sscInvoiceFile ? ' has' : '')}>
                              <input type="file" accept=".pdf,image/*"
                                     onChange={e => setSscInvoiceFile(e.target.files?.[0] || null)} />
                              {sscInvoiceFile ? `✓ ${sscInvoiceFile.name}` : 'Choose PDF or photo'}
                            </label>
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
                            <a href={inv.vendor_invoice_url} target="_blank" rel="noopener noreferrer" style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:13,color:'#1a73e8',fontWeight:600}}>
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
              {/* ── One tile for everything this bill still needs ───────────
                  Approval and the debit note were two amber tiles stacked in the
                  sidebar, each asking for a reason, and it read as two unrelated
                  jobs. They are one exception with two consequences: someone
                  accepts it, and someone claims the money back. Numbered, in
                  order, in one place. Neither blocks Complete Inward. */}
              {(isFlagged || inv.debit_note_required) && !(inv.override_at && inv.debit_note_uploaded_at) && (
                <div className="od-side-card" style={{ borderColor:'#fde68a', background:'#fffbeb', marginBottom:12 }}>
                  <div className="od-side-card-title">Still to do on this bill</div>
                  <div className="od-side-sub" style={{ marginBottom:4 }}>
                    Inward can be completed without these — they only settle the money.
                  </div>

                  {/* What is actually wrong, by ground. */}
                  {inv.debit_note_required && (
                    <>
                      <div className="dn-grounds">
                        {Number(inv.debit_note_rate_amount) > 0.01 && (
                          <div className="dn-ground">
                            <span className="dn-tag price">PRICE</span>
                            <span className="dn-amt">{fmtMoneyFull(inv.debit_note_rate_amount)}</span>
                            <span className="dn-why">charged over the agreed rate</span>
                          </div>
                        )}
                        {Number(inv.debit_note_qty_amount) > 0.01 && (
                          <div className="dn-ground">
                            <span className="dn-tag qty">QUANTITY</span>
                            <span className="dn-amt">{fmtMoneyFull(inv.debit_note_qty_amount)}</span>
                            <span className="dn-why">billed more than we accepted</span>
                          </div>
                        )}
                      </div>
                      {inv.price_decision_note && (
                        <div className="dn-note">“{inv.price_decision_note}”</div>
                      )}
                    </>
                  )}

                  {/* 1 — someone other than the matcher accepts it. */}
                  {isFlagged && !inv.override_at && (
                    <div className="dn-step">
                      <div className="dn-step-h">1 · Approve the difference</div>
                      {canRelease ? (
                        <>
                          <div className="twm-field">
                            <label>Reason *</label>
                            <select value={relCode} onChange={e => setRelCode(e.target.value)}>
                              <option value="">Pick one…</option>
                              {(tol?.override_reason_codes || []).map(c => (
                                <option key={c} value={c}>
                                  {c.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase())}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="twm-field">
                            <label>In a sentence *</label>
                            <textarea value={relReason} onChange={e => setRelReason(e.target.value)}
                                      placeholder="Why this is acceptable." />
                          </div>
                          <button className="od-btn od-btn-approve" style={{ width:'100%' }}
                                  onClick={handleRelease} disabled={saving}>
                            {saving ? 'Approving…' : 'Approve'}
                          </button>
                          {inv.debit_note_required && (
                            <div className="od-side-sub" style={{ marginTop:8 }}>
                              Then the {fmtMoneyFull(inv.debit_note_amount)} debit note.
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="od-side-sub">
                          {iMatchedThis
                            ? 'You matched this bill, so someone else has to approve it.'
                            : `Only ${(tol?.override_roles || []).join(' or ')} can approve this.`}
                        </div>
                      )}
                    </div>
                  )}
                  {inv.override_at && (
                    <div className="dn-step">
                      <div className="dn-step-h done">1 · Approved</div>
                      <div className="od-side-sub">
                        {inv.override_by}, {fmtShort(inv.override_at)} — {(inv.override_reason_code || '').replace(/_/g,' ')}
                      </div>
                    </div>
                  )}

                  {/* 2 — the money comes back. Made in Tally, recorded here.
                      Hidden until the difference is approved: they are sequential,
                      and two live buttons in one tile is the thing that made this
                      confusing in the first place. There is always exactly one
                      action to take. */}
                  {inv.debit_note_required && (!isFlagged || inv.override_at) && (
                    <div className="dn-step">
                      <div className={'dn-step-h' + (inv.debit_note_uploaded_at ? ' done' : '')}>
                        2 · Debit note {inv.debit_note_uploaded_at ? 'raised' : fmtMoneyFull(inv.debit_note_amount)}
                      </div>
                      {inv.debit_note_uploaded_at ? (
                        <div className="od-side-sub">
                          <div style={{ fontFamily:'var(--mono)', fontWeight:600 }}>{inv.debit_note_number}</div>
                          {inv.debit_note_url && (
                            <a href={inv.debit_note_url} target="_blank" rel="noreferrer"
                               style={{ color:'var(--blue-800)', fontWeight:600 }}>View the note ↗</a>
                          )}
                          <div>{inv.debit_note_uploaded_by} · {fmtShort(inv.debit_note_uploaded_at)}</div>
                        </div>
                      ) : ['accounts','admin','ops','management'].includes(userRole) ? (
                        <>
                          <div className="twm-field">
                            <label>Number from Tally *</label>
                            <input value={dnNumber} onChange={e => setDnNumber(e.target.value)} placeholder="DN-…" />
                          </div>
                          <label className={'twm-upload' + (dnFile ? ' has' : '')}
                                 style={{ width:'100%', justifyContent:'center', marginBottom:8 }}>
                            <input type="file" accept="image/*,application/pdf"
                                   onChange={e => setDnFile(e.target.files?.[0] || null)} />
                            {dnFile ? `✓ ${dnFile.name}` : 'Attach the note'}
                          </label>
                          <button className="od-btn od-btn-approve" style={{ width:'100%' }}
                                  onClick={handleAttachDebitNote} disabled={saving}>
                            {saving ? 'Saving…' : 'Record it'}
                          </button>
                        </>
                      ) : (
                        <div className="od-side-sub">Accounts raises this in Tally.</div>
                      )}
                    </div>
                  )}
                </div>
              )}


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
                  {pos.length > 0 && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>{pos.length > 1 ? `Purchase Orders (${pos.length})` : 'Purchase Order'}</div>
                      <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:2}}>
                        {pos.map(p => (
                          <div key={p.id} style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                            <span style={{color:'var(--gray-700)',fontFamily:'var(--mono)',fontWeight:600}}>{p.po_number}</span>
                            <a onClick={() => openPoHtmlForId(p.id)} style={{fontSize:11,color:'#2563eb',cursor:'pointer',textDecoration:'none',fontFamily:'var(--font)',fontWeight:500}}>View PO ↗</a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {grn && (
                    <div style={{fontSize:12}}>
                      <div style={{color:'var(--gray-400)',fontSize:10,fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>GRN</div>
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:2}}>
                        <span onClick={() => navigate('/fc/grn/' + grn.id)} style={{color:'#2563eb',cursor:'pointer',fontFamily:'var(--mono)',fontWeight:600}}>{grn.grn_number}</span>
                        <a onClick={() => openGrnHtmlForId(grn.id)} style={{fontSize:11,color:'#2563eb',cursor:'pointer',textDecoration:'none',fontFamily:'var(--font)',fontWeight:500}}>View GRN ↗</a>
                      </div>
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

              {/* Activity — vertical timeline, chronological */}
              <div className="od-side-card od-activity-card" style={{marginTop:12}}>
                <div className="od-side-card-title">Activity</div>
                <div className="od-activity-list">
                  {(() => {
                    const events = []
                    if (grn?.created_at)              events.push({ at: grn.created_at,             type: 'system',   title: 'GRN created — ' + (grn.grn_number || ''),                                by: grn.created_by_name })
                    if (grn?.received_at)             events.push({ at: grn.received_at,            type: 'success',  title: 'Goods received — quality OK',                                              by: grn.received_by_name })
                    if (inv?.created_at)              events.push({ at: inv.created_at,             type: 'invoice',  title: 'Purchase Invoice created',                                                 by: null })
                    if (inv?.three_way_checked_at)    events.push({ at: inv.three_way_checked_at,   type: 'system',   title: '3-Way Check completed',                                                    by: inv.three_way_checked_by, sub: inv.three_way_notes })
                    if (inv?.invoice_number && inv?.invoice_date) events.push({ at: inv.invoice_date,           type: 'invoice',  title: 'Vendor invoice recorded — ' + inv.invoice_number,                          by: null })
                    if (inv?.inward_completed_at)     events.push({ at: inv.inward_completed_at,    type: 'success',  title: 'Inward complete',                                                          by: inv.inward_completed_by })
                    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

                    const dotIcon = (type) => ({
                      system:   <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
                      success:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
                      invoice:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                    }[type])

                    // What someone SAID belongs in the same thread as what
                    // happened, ordered together — that is how Orders and POs
                    // read. Keeping them in two separate cards meant a note
                    // explaining a price decision sat nowhere near the decision.
                    const merged = [
                      ...events.map(e => ({ ts: new Date(e.at).getTime(), kind: 'event', e })),
                      ...comments.map(c => ({ ts: new Date(c.created_at).getTime(), kind: 'comment', c })),
                    ].sort((a, b) => a.ts - b.ts)

                    if (merged.length === 0) return <div style={{fontSize:12,color:'var(--gray-400)',padding:'8px 0'}}>Nothing yet.</div>

                    return merged.map((m, i) => m.kind === 'event' ? (
                      <div key={'e' + i} className="od-tl-item">
                        <div className={'od-tl-dot ' + m.e.type}>{dotIcon(m.e.type)}</div>
                        <div className="od-tl-content">
                          <div className="od-tl-header">
                            <div className="od-tl-title">{m.e.title}</div>
                            <div className="od-tl-time">{fmtTs(m.e.at)}</div>
                          </div>
                          {/* Plain text, not an OwnerChip: Orders and POs both
                              render the timeline actor this way, and an avatar
                              circle here made the same event look different on
                              this page to every other. */}
                          {m.e.by && <div className="od-tl-sub">{m.e.by}</div>}
                          {m.e.sub && <div className="od-tl-sub" style={{marginTop:4,fontStyle:'italic'}}>"{m.e.sub}"</div>}
                        </div>
                      </div>
                    ) : (
                      <div key={'c' + m.c.id} className="od-tl-item od-tl-comment">
                        <div className="od-tl-dot comment">
                          <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/>
                          </svg>
                        </div>
                        <div className="od-tl-content">
                          <div className="od-tl-header">
                            <div className="od-tl-comment-author">
                              {m.c.author_name}
                              {m.c._from && (
                                <span className="od-tl-comment-tagged">on the {m.c._from}</span>
                              )}
                              {m.c.tagged_users?.length > 0 && (
                                <span className="od-tl-comment-tagged">
                                  tagged {m.c.tagged_users.map(u => '@' + u).join(', ')}
                                </span>
                              )}
                            </div>
                            <div className="od-tl-time">{fmtTs(m.c.created_at)}</div>
                          </div>
                          <div className="od-tl-comment-text">{renderMessage(m.c.message)}</div>
                        </div>
                      </div>
                    ))
                  })()}
                </div>

                {/* The box sits at the foot of the thread, same as Orders. */}
                <div className="od-comment-box">
                  <div className="od-comment-input-wrap">
                    <textarea ref={commentRef} className="od-comment-input" value={commentText}
                              onChange={handleCommentInput}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                              placeholder="Add a note… use @ to tag someone" rows={2} />
                    {mentionQuery !== null && mentionSug.length > 0 && (
                      <div className="od-mention-dropdown"
                           style={{ top: mentionPos.top, left: mentionPos.left, width: mentionPos.width }}>
                        {mentionSug.map(p => (
                          <div key={p.id} className="od-mention-item"
                               onMouseDown={e => { e.preventDefault(); insertMention(p.name) }}>
                            <div className="od-mention-avatar">
                              {p.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div>
                              <div className="od-mention-name">{p.name}</div>
                              {p.username && <div className="od-mention-uname">@{p.username}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="od-comment-btn" onClick={submitComment}
                          disabled={posting || !commentText.trim()}>
                    {posting ? '...' : 'Post'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
