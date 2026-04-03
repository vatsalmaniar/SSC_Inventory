import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/orders.css'

// FC pipeline stages
const FC_STAGES = [
  { key: 'delivery_created', label: 'Picking'        },
  { key: 'picking',          label: 'Packing'        },
  { key: 'packing',          label: 'Goods Issue'    },
  { key: 'invoice_generated',label: 'Delivery Ready' },
  { key: 'eway_generated',   label: 'Delivered'      },
]

const WITH_ACCOUNTS = ['goods_issued','credit_check','goods_issue_posted','delivery_ready']
const VEHICLE_TYPES = ['Rickshaw','Bolero','Eicher','Hathi','Bike','SSC Vehicle','Other']
const DISPATCH_MODES = ['By Person','Vehicle','Porter','Transport','Courier']

// Map status → pipeline index
// goods_issued/credit_check/goods_issue_posted → 3 (GI done, awaiting accounts)
// delivery_ready → 4 (Delivery Ready done, awaiting e-way)
function fcPipelineIdx(status) {
  if (status === 'delivery_created')                                         return 0
  if (status === 'picking')                                                  return 1
  if (status === 'packing')                                                  return 2
  if (['goods_issued','credit_check','goods_issue_posted'].includes(status)) return 3
  if (status === 'invoice_generated')                                        return 3
  if (['delivery_ready','eway_generated'].includes(status))                  return 4
  if (status === 'dispatched_fc')                                            return 5
  return -1
}

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear()
}
function fmtTs(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}

function stageLabel(status) {
  return {
    delivery_created:   'Picking',
    picking:            'Packing',
    packing:            'Goods Issue',
    goods_issued:       'With Accounts — Billing',
    credit_check:       'With Accounts — Credit Check',
    goods_issue_posted: 'With Accounts — GI Posted',
    invoice_generated:  'Delivery Ready',
    delivery_ready:     'With Accounts — E-Way Bill',
    eway_generated:     'Ready to Deliver',
    dispatched_fc:      'Delivered',
  }[status] || status
}

function dotClass(msg) {
  const m = msg?.toLowerCase() || ''
  if (m.includes('cancel'))   return 'cancelled'
  if (m.includes('approved') || m.includes('confirm') || m.includes('issued') || m.includes('delivered') || m.includes('picked') || m.includes('packed') || m.includes('dispatch')) return 'approved'
  if (m.includes('submitted') || m.includes('created') || m.includes('accepted')) return 'submitted'
  if (m.includes('edit'))     return 'edited'
  return 'approved'
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

function printDCChallan(order, activeBatch, activeDC, isSample = false) {
  const items = activeBatch?.dispatched_items
    ? activeBatch.dispatched_items
    : (order.order_items || []).map(i => ({ item_code: i.item_code, qty: i.qty, unit_price: i.unit_price_after_disc || i.unit_price, total_price: i.total_price }))

  const subtotal  = items.reduce((s, i) => s + (i.total_price || 0), 0)
  const cgst      = Math.round(subtotal * 0.09 * 100) / 100
  const sgst      = Math.round(subtotal * 0.09 * 100) / 100
  const grandTotal = subtotal + cgst + sgst + (order.freight || 0)

  const dcDate = fmtDC(activeBatch?.created_at || new Date())
  const poDate = fmtDC(order.order_date)
  const batchLabel = activeBatch ? `Batch ${activeBatch.batch_no}` : ''

  const itemRows = items.map((item, idx) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5">${String((idx+1)*10).padStart(5,'0')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;font-weight:600">${item.item_code || '—'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:center;font-weight:700">${item.qty}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:center">Piece</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5">${item.item_code || '—'}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:right">${(item.unit_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e5e5;text-align:right;font-weight:700">${(item.total_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${isSample ? 'Sample Challan' : 'Delivery Challan'} — ${activeDC}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#fff;padding:28px 32px;max-width:820px;margin:0 auto}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px}
  .company-name{font-size:14px;font-weight:700;color:#000}
  .company-sub{font-size:10px;color:#444;margin-top:2px}
  .gstin-bar{font-size:10px;color:#333;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #000}
  .two-col{display:flex;gap:0;border:1px solid #999;margin-bottom:12px}
  .cust-block{flex:1;padding:12px;border-right:1px solid #999}
  .challan-block{flex:1;padding:0}
  .challan-title{font-size:22px;font-weight:900;border-bottom:1px solid #999;padding:10px 12px;margin-bottom:0}
  .challan-rows table{width:100%;border-collapse:collapse}
  .challan-rows td{padding:4px 10px;font-size:10.5px;border-bottom:1px solid #eee;vertical-align:top}
  .challan-rows td:first-child{color:#555;width:44%}
  .challan-rows td:last-child{font-weight:700}
  .cust-name{font-size:12px;font-weight:700;margin-bottom:4px}
  .cust-addr{font-size:10.5px;line-height:1.5;color:#222;margin-bottom:6px}
  .cust-meta{font-size:10px;color:#444;margin-top:4px}
  .section{margin-bottom:10px}
  .delivery-date{font-size:13px;margin-bottom:8px}
  .delivery-date strong{font-size:14px}
  .deliver-to{font-size:10.5px;margin-bottom:10px;line-height:1.5}
  .terms-row{display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:4px}
  table.items{width:100%;border-collapse:collapse;margin-top:10px}
  table.items th{background:#f0f0f0;padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;border:1px solid #ccc;text-align:left}
  table.items th.r{text-align:right}
  table.items th.c{text-align:center}
  table.items td{vertical-align:top}
  .gst-block{display:flex;justify-content:flex-end;margin-top:6px}
  .gst-table{width:340px;border-collapse:collapse}
  .gst-table td{padding:4px 10px;font-size:10.5px;border-bottom:1px solid #eee}
  .gst-table td.r{text-align:right;font-weight:600}
  .gst-total td{font-weight:800;font-size:12px;border-top:2px solid #000;padding-top:6px}
  .words{font-size:10.5px;margin:8px 0 14px;padding:8px 10px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px}
  .sig-row{display:flex;margin-top:18px;border-top:1px solid #ccc;padding-top:12px}
  .sig-cell{flex:1;text-align:center;font-size:10px;color:#333}
  .sig-line{border-top:1px solid #333;margin:24px 16px 6px}
  .footer{margin-top:16px;padding-top:10px;border-top:1px solid #ccc;font-size:9.5px;color:#444;line-height:1.6}
  .print-note{font-style:italic;font-size:9.5px;color:#777;margin:12px 0}
  @media print{
    body{padding:0;max-width:100%}
    @page{size:A4;margin:18mm 16mm}
  }
</style>
</head>
<body>

<div class="header-top">
  <div>
    <div class="company-name">SSC Control Pvt. Ltd.</div>
    <div class="company-sub">Industrial Automation &amp; Electrification</div>
    <div style="font-size:9.5px;color:#555;margin-top:6px">
      SSC Control Pvt. Ltd. Regd. Office: E/12, Siddhivinayak Towers, B/H DCP Office, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
      Phone: +91 79 4890 0177 &nbsp;|&nbsp; Email: sales@ssccontrol.com &nbsp;|&nbsp; Website: www.ssccontrol.com
    </div>
  </div>
  <div>
    <img src="${window.location.origin}/ssc-logo.svg" alt="SSC Control" style="height:64px;width:auto;display:block"/>
  </div>
</div>

<div class="gstin-bar">GSTIN: 24ABGCS0605M1ZE &nbsp;&nbsp;&nbsp; <strong>SSC Control Pvt. Ltd. – ${order.fulfilment_center || 'Ahmedabad'}</strong></div>

<div class="two-col">
  <div class="cust-block">
    <div class="cust-name">${order.customer_name || '—'}</div>
    <div class="cust-addr">${(order.dispatch_address || '').replace(/\n/g,'<br/>')}</div>
    ${order.customer_gst ? `<div class="cust-meta">GSTIN: <strong>${order.customer_gst}</strong></div>` : ''}
    <div class="cust-meta" style="margin-top:8px">Registered</div>
  </div>
  <div class="challan-block">
    <div class="challan-title">${isSample ? 'Sample Challan' : 'Delivery Challan'}</div>
    <div class="challan-rows">
      <table>
        <tr><td>Challan no./date</td><td>${activeDC} / ${dcDate}</td></tr>
        <tr><td>SO / Order no.</td><td>${order.order_number || '—'}</td></tr>
        <tr><td>Ref. PO no./date</td><td>${order.po_number || '—'} / ${poDate}</td></tr>
        ${(activeBatch?.invoice_number || order.invoice_number) ? `<tr><td>Invoice no.</td><td>${activeBatch?.invoice_number || order.invoice_number}</td></tr>` : ''}
        ${order.vehicle_number ? `<tr><td>Vehicle no.</td><td>${order.vehicle_number}</td></tr>` : ''}
        ${order.engineer_name ? `<tr><td>Contact person</td><td>${order.engineer_name}</td></tr>` : ''}
        <tr><td>Mail</td><td>sales@ssccontrol.com</td></tr>
        ${order.po_number ? `<tr><td>Your PO ref. with us</td><td>${order.reference_number || order.po_number}</td></tr>` : ''}
        ${batchLabel ? `<tr><td>Batch</td><td>${batchLabel}</td></tr>` : ''}
      </table>
    </div>
  </div>
</div>

<div class="delivery-date">
  Delivery date: &nbsp; <strong>Day ${dcDate} dispatched</strong>
</div>

<div class="deliver-to">
  <strong>Please deliver to:</strong><br/>
  ${order.customer_name || ''}<br/>
  ${(order.dispatch_address || '—').replace(/\n/g,'<br/>')}
</div>

<div class="section" style="font-size:10.5px;color:#333;margin-bottom:10px">
  Order confirmation: Delivery made as per PO ${order.po_number || '—'} dated ${poDate}. In case of any discrepancy in quantity or quality, please inform us within 48 hours of receipt.
</div>

<div class="terms-row">
  <span>Terms of delivery: &nbsp;<strong>${order.dispatch_mode || 'EXW THROUGH TRANSPORT'}</strong></span>
</div>
<div class="terms-row">
  <span>Terms of payment: &nbsp;<strong>${order.credit_terms || '—'}</strong></span>
  <span>Currency &nbsp;<strong>INR</strong></span>
</div>

<div style="font-weight:700;font-size:11px;margin:12px 0 4px">Delivery as per order acknowledgment for all items:</div>

<table class="items">
  <thead>
    <tr>
      <th style="width:52px">Item</th>
      <th>Material / Item Code</th>
      <th class="c" style="width:80px">Delivered Qty</th>
      <th class="c" style="width:52px">Unit</th>
      <th style="width:110px">MFR Part No.</th>
      <th class="r" style="width:90px">Price / Unit</th>
      <th class="r" style="width:90px">Net Value</th>
    </tr>
  </thead>
  <tbody>${itemRows}</tbody>
</table>

<div class="gst-block">
  <table class="gst-table">
    <tr><td>IN: Central GST</td><td class="r">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td class="r">9.00 %</td><td class="r">${cgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    <tr><td>IN: State GST</td><td class="r">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td class="r">9.00 %</td><td class="r">${sgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    ${order.freight ? `<tr><td>Freight</td><td></td><td></td><td class="r">${(order.freight).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}
    <tr class="gst-total"><td colspan="3"><strong>Total Amount:</strong></td><td class="r"><strong>${grandTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td></tr>
  </table>
</div>

<div class="words">Amount in Words: <strong>${numToWords(grandTotal)}</strong></div>

<div style="font-size:10.5px;margin-bottom:14px">Yours Faithfully,<br/><strong>For SSC CONTROL PRIVATE LIMITED,</strong></div>

<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div>Prepared By<br/><span style="color:#666">Store / Dispatch</span></div>
  <div class="sig-cell"><div class="sig-line"></div>Checked By<br/><span style="color:#666">Accounts / Manager</span></div>
  <div class="sig-cell"><div class="sig-line"></div>Authorised<br/><span style="color:#666;font-weight:700">Signatory</span></div>
</div>

<div class="print-note">This document is a computer print-out and valid without signature.</div>

<div class="footer">
  | Our GSTIN: 24ABGCS0605M1ZE | &nbsp;
  | CIN: U29299GJ2000PTC037XXX | &nbsp;
  | Our Bankers — HDFC Bank Ltd., Branch: Makarba, Ahmedabad | &nbsp;
  | Bank Account No.: 50200031826271 | &nbsp;
  | Bank IFSC Code: HDFC0001364 |<br/>
  SSC Control Pvt. Ltd. Regd. Office: E/12, Siddhivinayak Towers, B/H DCP Office, Off. SG Highway, Makarba, Ahmedabad – 380 051 &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE
</div>

</body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write(html)
  w.document.close()
}

export default function FCOrderDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()
  const dispatchId   = location.state?.dispatch_id || null

  const [order, setOrder]       = useState(null)
  const [activeBatch, setActiveBatch] = useState(null)
  const [user, setUser]         = useState({ name: '', role: '', avatar: '' })
  const [comments, setComments] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [confirm, setConfirm]   = useState(null)

  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [dispatchMode, setDispatchMode] = useState('')   // By Person / Vehicle / Porter / Transport / Courier
  const [personName, setPersonName]     = useState('')
  const [vehicleType, setVehicleType]   = useState('')
  const [vehicleNum, setVehicleNum]     = useState('')
  const [driverName, setDriverName]     = useState('')
  const [transporterName, setTransporterName] = useState('')
  const [transporterId, setTransporterId]     = useState('')
  const [lrNumber, setLrNumber]               = useState('')
  const [courierCompany, setCourierCompany]   = useState('')
  const [trackingNum, setTrackingNum]         = useState('')

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'fc_kaveri'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    if (!['fc_kaveri','fc_godawari','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, role, avatar })
    await loadOrder()
  }

  async function loadOrder() {
    setLoading(true)
    const { data } = await sb.from('orders').select('*, order_items(*)').eq('id', id).single()
    setOrder(data)
    // If a specific dispatch_id was passed (from DC-centric navigation), load that batch
    // Otherwise load the most recent batch
    if (dispatchId) {
      const { data: batch } = await sb.from('order_dispatches').select('*').eq('id', dispatchId).single()
      setActiveBatch(batch || null)
    } else {
      const { data: batches } = await sb.from('order_dispatches').select('*')
        .eq('order_id', id).order('batch_no', { ascending: false }).limit(1)
      setActiveBatch(batches?.[0] || null)
    }
    setLoading(false)
    const { data: c } = await sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(c || [])
  }

  async function logActivity(message) {
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message, tagged_users: [], is_activity: true })
    const { data: c } = await sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(c || [])
  }

  async function doAction(toStatus, activityMsg, extraUpdate = {}) {
    setSaving(true)
    const { error } = await sb.from('orders').update({
      status: toStatus, updated_at: new Date().toISOString(), ...extraUpdate
    }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    await logActivity(activityMsg)
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  async function confirmGoodsIssued() {
    setSaving(true)
    let dcNum = null
    const nextStatus = order.order_type === 'SAMPLE' ? 'invoice_generated' : 'goods_issued'
    if (activeBatch) {
      // Upgrade Temp/DC → SSC/DC on the batch
      const { data } = await sb.rpc('confirm_dispatch_dc', { p_dispatch_id: activeBatch.id })
      dcNum = data
      await sb.from('order_dispatches').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    }
    const { error } = await sb.from('orders').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    const actMsg = order.order_type === 'SAMPLE'
      ? `Goods Issued — DC confirmed: ${dcNum || order.dc_number || '—'}. Sample ready for challan.`
      : `Goods Issued — DC confirmed: ${dcNum || order.dc_number || '—'}. Handed to Accounts for billing.`
    await logActivity(actMsg)
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  async function confirmDeliveryReady() {
    if (!dispatchMode) { alert('Select a dispatch mode.'); return }
    let updateFields = { dispatch_mode: dispatchMode, vehicle_type: null, vehicle_number: null, driver_name: null }
    let detail = ''
    if (dispatchMode === 'By Person') {
      if (!personName.trim()) { alert('Enter person name.'); return }
      updateFields.driver_name = personName.trim()
      detail = `By Person — ${personName.trim()}`
    } else if (dispatchMode === 'Vehicle') {
      if (!vehicleType)       { alert('Select vehicle type.'); return }
      if (!vehicleNum.trim()) { alert('Enter vehicle number.'); return }
      if (!driverName.trim()) { alert('Enter driver name.'); return }
      updateFields.vehicle_type   = vehicleType
      updateFields.vehicle_number = vehicleNum.trim()
      updateFields.driver_name    = driverName.trim()
      detail = `Vehicle — ${vehicleType} · ${vehicleNum.trim()} · Driver: ${driverName.trim()}`
    } else if (dispatchMode === 'Porter') {
      if (!personName.trim()) { alert('Enter porter name.'); return }
      updateFields.driver_name = personName.trim()
      detail = `Porter — ${personName.trim()}`
    } else if (dispatchMode === 'Transport') {
      if (!transporterName.trim()) { alert('Enter transporter name.'); return }
      updateFields.driver_name    = transporterName.trim()
      updateFields.vehicle_number = lrNumber.trim() || null
      detail = `Transport — ${transporterName.trim()}${transporterId.trim() ? ' · ID: ' + transporterId.trim() : ''}${lrNumber.trim() ? ' · LR: ' + lrNumber.trim() : ''}`
    } else if (dispatchMode === 'Courier') {
      if (!courierCompany.trim()) { alert('Enter courier company.'); return }
      updateFields.driver_name    = courierCompany.trim()
      updateFields.vehicle_number = trackingNum.trim() || null
      detail = `Courier — ${courierCompany.trim()}${trackingNum.trim() ? ' · Tracking: ' + trackingNum.trim() : ''}`
    }
    setSaving(true)
    let nextOrderStatus = 'delivery_ready'
    let actSuffix = 'Handed to Accounts for E-Way Bill.'
    if (order.order_type === 'SAMPLE') {
      const batchTotal = activeBatch?.dispatched_items
        ? activeBatch.dispatched_items.reduce((s, i) => s + (i.total_price || 0), 0)
        : (order.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
      if (batchTotal <= 50000) {
        nextOrderStatus = 'eway_generated'
        actSuffix = 'E-Way Bill not required (value ≤ ₹50,000). Ready to deliver.'
      } else {
        actSuffix = 'E-Way Bill required (value > ₹50,000). Handed to Accounts.'
      }
    }
    if (activeBatch) {
      await sb.from('order_dispatches').update({
        status: nextOrderStatus, ...updateFields, updated_at: new Date().toISOString(),
      }).eq('id', activeBatch.id)
    }
    const { error } = await sb.from('orders').update({
      status: nextOrderStatus, ...updateFields, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    await logActivity(`Delivery Ready — ${detail}. ${actSuffix}`)
    setShowDeliveryForm(false)
    setSaving(false)
    await loadOrder()
  }

  async function confirmDelivered() {
    setSaving(true)
    if (activeBatch) {
      await sb.from('order_dispatches').update({ status: 'dispatched_fc', updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    }
    // Check if all order items are fully dispatched
    const { data: items } = await sb.from('order_items').select('qty, dispatched_qty').eq('order_id', id)
    const allDone = (items || []).every(i => (i.dispatched_qty || 0) >= i.qty)
    const finalStatus = allDone ? 'dispatched_fc' : 'dispatch'  // back to dispatch so ops can create next batch
    const { error } = await sb.from('orders').update({ status: finalStatus, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    await logActivity(allDone ? 'Order Delivered — all batches complete.' : 'Batch Delivered — remaining items pending next batch by Ops.')
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  if (loading) return (
    <Layout pageTitle="FC — Order Detail" pageKey="fc">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div>
    </Layout>
  )
  if (!order) return null

  const isSample     = order.order_type === 'SAMPLE'
  const pipelineIdx  = fcPipelineIdx(order.status)
  const withAccounts = !isSample && WITH_ACCOUNTS.includes(order.status)
  const isDelivered  = order.status === 'dispatched_fc'
  const subtotal     = (order.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
  const grandTotal   = subtotal + (order.freight || 0)
  const activeDC     = activeBatch?.dc_number || order.dc_number  // prefer batch, fall back to legacy
  const isTempDC     = activeDC?.startsWith('Temp/')

  return (
    <Layout pageTitle="FC Module" pageKey="fc">
    <div className="od-page">
      <div className="od-body">

        {/* Header */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  {order.order_type === 'SO' ? 'Standard Order' : order.order_type === 'CO' ? 'Customised Order' : 'Sample Request'} · {order.fulfilment_center || '—'}
                  {isSample && <span style={{marginLeft:8,fontSize:10,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:4,padding:'1px 7px',letterSpacing:'0.5px',verticalAlign:'middle'}}>SAMPLE</span>}
                  <span className={'od-status-badge ' + (isDelivered ? 'delivered' : withAccounts ? 'pending' : 'delivery')}>
                    {isDelivered ? 'Delivered' : withAccounts ? 'With Accounts' : stageLabel(order.status)}
                  </span>
                </div>
                <div className="od-header-title">{order.customer_name}</div>
                <div className="od-header-num">
                  <button
                    onClick={() => navigate('/orders/' + id)}
                    style={{background:'none',border:'none',padding:0,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit',color:'#2563eb',fontWeight:600,textDecoration:'underline'}}
                  >
                    {order.order_number}
                  </button>
                  {' · '}{fmt(order.order_date)}
                  {activeDC && (
                    <span style={{marginLeft:12, fontFamily:'var(--mono)', fontSize:13, color: isTempDC ? '#92400e' : '#166534', fontWeight:700}}>
                      DC: {activeDC}{activeBatch && <span style={{fontSize:10,marginLeft:6,color:'var(--gray-400)'}}>Batch {activeBatch.batch_no}</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="od-header-actions">
              <button className="od-btn" onClick={() => navigate('/fc')} style={{gap:6}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
            </div>
          </div>
        </div>

        {/* Pipeline bar */}
        <div className={'od-pipeline-bar' + (withAccounts ? ' od-pipeline-partial' : isDelivered ? '' : ' od-pipeline-delivery')}>
          <div className="od-pipeline-stages">
            {FC_STAGES.map((stage, idx) => {
              const isDone   = pipelineIdx > idx
              const isActive = pipelineIdx === idx && !withAccounts
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

          {/* LEFT — main */}
          <div className="od-main">

            {/* With Accounts banner */}
            {withAccounts && (
              <div className="od-pending-banner" style={{background:'#fefce8',border:'1px solid #fde047',color:'#92400e'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <div>
                  <div className="od-pending-banner-label">With Accounts — {stageLabel(order.status)}</div>
                  <div>Billing team is processing this order. You will be notified when it comes back.</div>
                </div>
              </div>
            )}

            {/* Delivered banner */}
            {isDelivered && (
              <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div>
                  <div className="od-pending-banner-label">Delivered — {order.fulfilment_center || ''}</div>
                  <div>Order fully delivered and complete.</div>
                </div>
              </div>
            )}

            {/* DC / Invoice reference card */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Document References</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field">
                    <label>Related Order (SO/CO)</label>
                    <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--blue-800)'}}>{order.order_number}</div>
                  </div>
                  <div className="od-detail-field">
                    <label>Delivery Challan (DC)</label>
                    <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color: isTempDC ? '#92400e' : '#166534'}}>
                      {activeDC || '—'}
                      {isTempDC && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',marginLeft:8,fontWeight:600}}>TEMP</span>}
                    </div>
                  </div>
                  {order.invoice_number && (
                    <div className="od-detail-field">
                      <label>Invoice</label>
                      <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:order.invoice_number?.startsWith('Temp/') ? '#92400e' : '#166534'}}>
                        {order.invoice_number}
                        {order.invoice_number?.startsWith('Temp/') && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',marginLeft:8,fontWeight:600}}>TEMP</span>}
                      </div>
                    </div>
                  )}
                  {order.eway_bill_number && (
                    <div className="od-detail-field">
                      <label>E-Way Bill</label>
                      <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:'#166534'}}>{order.eway_bill_number}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Vehicle details if set */}
            {order.dispatch_mode && (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-title">Delivery Details</div></div>
                <div className="od-card-body">
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>Mode</label><div className="val">{order.dispatch_mode}</div></div>
                    {order.vehicle_type   && <div className="od-detail-field"><label>Vehicle Type</label><div className="val">{order.vehicle_type}</div></div>}
                    {order.vehicle_number && <div className="od-detail-field"><label>{order.dispatch_mode === 'Transport' ? 'LR Number' : order.dispatch_mode === 'Courier' ? 'Tracking No.' : 'Vehicle No.'}</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{order.vehicle_number}</div></div>}
                    {order.driver_name    && <div className="od-detail-field"><label>{order.dispatch_mode === 'Transport' ? 'Transporter' : order.dispatch_mode === 'Courier' ? 'Courier Co.' : order.dispatch_mode === 'By Person' || order.dispatch_mode === 'Porter' ? 'Name' : 'Driver'}</label><div className="val">{order.driver_name}</div></div>}
                  </div>
                </div>
              </div>
            )}

            {/* Order info */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Order Information</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field"><label>Customer Name</label><div className="val">{order.customer_name}</div></div>
                  <div className="od-detail-field"><label>GST Number</label><div className="val" style={{fontFamily:'var(--mono)'}}>{order.customer_gst || '—'}</div></div>
                  <div className="od-detail-field"><label>PO / Reference No.</label><div className="val">{order.po_number || '—'}</div></div>
                  <div className="od-detail-field"><label>Order Date</label><div className="val">{fmt(order.order_date)}</div></div>
                  <div className="od-detail-field"><label>Fulfilment Centre</label><div className="val">{order.fulfilment_center || '—'}</div></div>
                  <div className="od-detail-field"><label>Credit Terms</label><div className="val">{order.credit_terms || '—'}</div></div>
                  <div className="od-detail-field"><label>Received Via</label><div className="val">{order.received_via || '—'}</div></div>
                  <div className="od-detail-field"><label>Account Owner</label><div className="val"><OwnerChip name={order.account_owner || order.engineer_name} /></div></div>
                </div>
                <div className="od-detail-field" style={{marginTop:12}}>
                  <label>Delivery / Dispatch Address</label>
                  <div className="val">{order.dispatch_address || '—'}</div>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="od-card">
              <div className="od-card-header">
                <div className="od-card-title">
                  {activeBatch?.dispatched_items ? `Batch ${activeBatch.batch_no} Items (${activeBatch.dispatched_items.length})` : `Products (${(order.order_items||[]).length})`}
                  {activeBatch?.dispatched_items && <span style={{fontSize:11,color:'var(--gray-500)',fontWeight:400,marginLeft:8}}>this batch only</span>}
                </div>
              </div>
              <div className="od-card-body" style={{padding:0}}>
                <div className="od-items-table-wrap">
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Code</th>
                        <th style={{textAlign:'right'}}>Qty (This Batch)</th>
                        <th style={{textAlign:'right'}}>Unit Price</th>
                        <th style={{textAlign:'right'}}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeBatch?.dispatched_items || (order.order_items||[]).map(i => ({
                        item_code: i.item_code, qty: i.qty, unit_price: i.unit_price_after_disc, total_price: i.total_price
                      }))).map((item, idx) => (
                        <tr key={idx}>
                          <td className="od-items-sr">{idx + 1}</td>
                          <td><span className="od-items-code">{item.item_code}</span></td>
                          <td style={{textAlign:'right',fontWeight:600}}>{item.qty}</td>
                          <td style={{textAlign:'right'}}>₹{item.unit_price}</td>
                          <td style={{textAlign:'right',fontWeight:600}}>₹{(item.total_price || 0).toLocaleString('en-IN',{maximumFractionDigits:2})}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="od-totals">
                  <div className="od-totals-inner">
                    <div className="od-totals-row"><span>Batch Subtotal</span><span>₹{(activeBatch?.dispatched_items ? activeBatch.dispatched_items.reduce((s,i)=>s+(i.total_price||0),0) : subtotal).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    <div className="od-totals-row"><span>Freight</span><span>₹{(order.freight||0).toLocaleString('en-IN')}</span></div>
                    <div className="od-totals-row grand"><span>Total</span><span>₹{((activeBatch?.dispatched_items ? activeBatch.dispatched_items.reduce((s,i)=>s+(i.total_price||0),0) : subtotal) + (order.freight||0)).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action card */}
            {!withAccounts && !isDelivered && (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-title">Action — {stageLabel(order.status)}</div></div>
                <div className="od-card-body">

                  {/* Picking */}
                  {order.status === 'delivery_created' && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Pick all items for this order from storage.</p>
                      <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setConfirm({ key: 'picking', label: 'Confirm items have been picked?' })}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Mark as Picked
                      </button>
                    </div>
                  )}

                  {/* Packing */}
                  {order.status === 'picking' && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Pack all picked items ready for dispatch.</p>
                      <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setConfirm({ key: 'packing', label: 'Confirm items have been packed?' })}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Mark as Packed
                      </button>
                    </div>
                  )}

                  {/* Goods Issue */}
                  {order.status === 'packing' && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:6}}>Issue goods from warehouse. This will confirm the DC number.</p>
                      {activeDC && <p style={{fontSize:13,fontFamily:'var(--mono)',fontWeight:700,color:'#92400e',marginBottom:14}}>DC will be confirmed as: {activeDC?.replace('Temp/','SSC/')}</p>}
                      <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setConfirm({ key: 'goods_issued', label: 'Confirm goods issued from warehouse? DC number will be finalised.' })}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Issue Goods
                      </button>
                    </div>
                  )}

                  {/* Delivery Ready (regular SO/CO) */}
                  {!isSample && order.status === 'invoice_generated' && !showDeliveryForm && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Invoice has been generated. Enter vehicle / delivery details.</p>
                      <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setShowDeliveryForm(true)}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                        Set Delivery Ready
                      </button>
                    </div>
                  )}

                  {/* Sample — Challan + Delivery Ready */}
                  {isSample && order.status === 'invoice_generated' && !showDeliveryForm && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Goods issued. Generate the Sample Challan, then enter delivery details.</p>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button style={{background:'#1d4ed8',padding:'10px 16px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                          onClick={() => printDCChallan(order, activeBatch, activeDC, true)}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                          Generate Sample Challan
                        </button>
                        <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 16px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                          onClick={() => setShowDeliveryForm(true)}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                          Set Delivery Ready
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delivery Ready form (both SO/CO and SAMPLE) */}
                  {order.status === 'invoice_generated' && showDeliveryForm && (
                    <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:440}}>
                      <div className="od-edit-field">
                        <label>Dispatch Mode</label>
                        <select value={dispatchMode} onChange={e => { setDispatchMode(e.target.value); setPersonName(''); setVehicleType(''); setVehicleNum(''); setDriverName(''); setTransporterName(''); setTransporterId(''); setLrNumber(''); setCourierCompany(''); setTrackingNum('') }}>
                          <option value="">— Select —</option>
                          {DISPATCH_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>

                      {dispatchMode === 'By Person' && (
                        <div className="od-edit-field">
                          <label>Person Name</label>
                          <input type="text" placeholder="Name of person carrying" value={personName} onChange={e => setPersonName(e.target.value)} />
                        </div>
                      )}

                      {dispatchMode === 'Vehicle' && (<>
                        <div className="od-edit-field">
                          <label>Vehicle Type</label>
                          <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                            <option value="">— Select —</option>
                            {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field">
                          <label>Vehicle Number</label>
                          <input type="text" placeholder="GJ 05 AB 1234" value={vehicleNum} onChange={e => setVehicleNum(e.target.value)} />
                        </div>
                        <div className="od-edit-field">
                          <label>Driver Name</label>
                          <input type="text" placeholder="Driver name" value={driverName} onChange={e => setDriverName(e.target.value)} />
                        </div>
                      </>)}

                      {dispatchMode === 'Porter' && (
                        <div className="od-edit-field">
                          <label>Porter Name</label>
                          <input type="text" placeholder="Porter name" value={personName} onChange={e => setPersonName(e.target.value)} />
                        </div>
                      )}

                      {dispatchMode === 'Transport' && (<>
                        <div className="od-edit-field">
                          <label>Transporter Name</label>
                          <input type="text" placeholder="Transport company name" value={transporterName} onChange={e => setTransporterName(e.target.value)} />
                        </div>
                        <div className="od-edit-field">
                          <label>Transporter ID (GSTIN)</label>
                          <input type="text" placeholder="27AAAAA0000A1Z5" value={transporterId} onChange={e => setTransporterId(e.target.value)} />
                        </div>
                        <div className="od-edit-field">
                          <label>LR / Way Bill Number</label>
                          <input type="text" placeholder="LR number" value={lrNumber} onChange={e => setLrNumber(e.target.value)} />
                        </div>
                      </>)}

                      {dispatchMode === 'Courier' && (<>
                        <div className="od-edit-field">
                          <label>Courier Company</label>
                          <input type="text" placeholder="e.g. DTDC, Blue Dart" value={courierCompany} onChange={e => setCourierCompany(e.target.value)} />
                        </div>
                        <div className="od-edit-field">
                          <label>Tracking Number</label>
                          <input type="text" placeholder="Tracking / AWB number" value={trackingNum} onChange={e => setTrackingNum(e.target.value)} />
                        </div>
                      </>)}

                      <div style={{display:'flex',gap:8,marginTop:4}}>
                        <button className="od-btn od-btn-approve" onClick={confirmDeliveryReady} disabled={saving || !dispatchMode}>{saving ? 'Saving...' : 'Confirm Delivery Ready'}</button>
                        <button className="od-btn" onClick={() => setShowDeliveryForm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Confirm Delivered */}
                  {order.status === 'eway_generated' && !confirm && (
                    <div>
                      {order.eway_bill_number && <p style={{fontSize:13,fontFamily:'var(--mono)',fontWeight:700,color:'#166534',marginBottom:8}}>E-Way Bill: {order.eway_bill_number}</p>}
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Confirm order delivered to customer.</p>
                      <button className="od-mark-complete-btn" style={{background:'#14532d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setConfirm({ key: 'delivered', label: 'Confirm order has been delivered to the customer?' })}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Confirm Delivered
                      </button>
                    </div>
                  )}

                  {/* Confirm panel */}
                  {confirm && (
                    <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:10,padding:16}}>
                      <p style={{fontSize:13,color:'#166534',fontWeight:600,marginBottom:14}}>{confirm.label}</p>
                      <div style={{display:'flex',gap:8}}>
                        <button className="od-btn od-btn-approve" disabled={saving}
                          onClick={() => {
                            if (confirm.key === 'picking')      doAction('picking',      'Items picked — moved to Packing.')
                            if (confirm.key === 'packing')      doAction('packing',      'Items packed — moved to Goods Issue.')
                            if (confirm.key === 'goods_issued') confirmGoodsIssued()
                            if (confirm.key === 'delivered')    confirmDelivered()
                          }}>
                          {saving ? 'Saving...' : 'Confirm'}
                        </button>
                        <button className="od-btn" onClick={() => setConfirm(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>{/* end od-main */}

          {/* RIGHT — sidebar */}
          <div className="od-sidebar">

            {/* DC Number card */}
            <div className="od-side-card">
              <div className="od-side-card-title">Delivery Challan</div>
              <div style={{padding:'0 16px 14px'}}>
                {activeBatch && <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:600,marginBottom:4}}>BATCH {activeBatch.batch_no}</div>}
                <div style={{fontFamily:'var(--mono)',fontSize:18,fontWeight:800,color: isTempDC ? '#92400e' : '#166534',letterSpacing:'-0.5px',marginBottom:4}}>
                  {activeDC || '—'}
                </div>
                {isTempDC && <div style={{fontSize:11,color:'#92400e',fontWeight:600}}>Temp — will be confirmed at Goods Issue</div>}
                {!isTempDC && activeDC && <div style={{fontSize:11,color:'#166534',fontWeight:600}}>Confirmed DC</div>}
                {!isTempDC && activeDC && (['delivery_ready','eway_generated','dispatched_fc'].includes(order.status) || (isSample && order.status === 'invoice_generated')) && (
                  <button
                    onClick={() => printDCChallan(order, activeBatch, activeDC, isSample)}
                    style={{marginTop:10,display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #2563eb',background:'#eff6ff',color:'#1d4ed8',fontFamily:'var(--font)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    {isSample ? 'Download Sample Challan' : 'Download DC Challan'}
                  </button>
                )}
                {(activeBatch?.invoice_number || order.invoice_number) && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--gray-100)'}}>
                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Invoice</div>
                    <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:(activeBatch?.invoice_number || order.invoice_number)?.startsWith('Temp/') ? '#92400e' : '#166534'}}>
                      {activeBatch?.invoice_number || order.invoice_number}
                    </div>
                    {(activeBatch?.invoice_pdf_url || order.invoice_pdf_url) && (
                      <a href={activeBatch?.invoice_pdf_url || order.invoice_pdf_url} target="_blank" rel="noreferrer"
                        style={{fontSize:11,color:'#1e40af',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:4,textDecoration:'none'}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        View Invoice PDF
                      </a>
                    )}
                  </div>
                )}
                {(activeBatch?.eway_bill_number || order.eway_bill_number) && (
                  <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--gray-100)'}}>
                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>E-Way Bill</div>
                    <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:'#166534'}}>{activeBatch?.eway_bill_number || order.eway_bill_number}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Activity */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">
                {comments.map(c => (
                  <div key={c.id} className={'od-activity-item' + (c.is_activity ? '' : ' od-comment-item')}>
                    <div className={'od-activity-dot ' + dotClass(c.message)} />
                    <div style={{minWidth:0}}>
                      {c.is_activity ? (
                        <>
                          <div className="od-activity-val">{c.message}</div>
                          <div className="od-activity-time">{c.author_name} · {fmtTs(c.created_at)}</div>
                        </>
                      ) : (
                        <>
                          <div className="od-activity-label">{c.author_name}</div>
                          <div className="od-activity-val" style={{fontWeight:400}}>{c.message}</div>
                          <div className="od-activity-time">{fmtTs(c.created_at)}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end od-sidebar */}
        </div>{/* end od-layout */}
      </div>
    </div>
    </Layout>
  )
}
