import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { toast } from '../lib/toast'
import { fmt, fmtTs, esc } from '../lib/fmt'
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
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }


function stageLabel(status) {
  return {
    pi_requested:       'Awaiting Proforma Invoice',
    pi_generated:       'PI Sent — Awaiting Payment',
    pi_payment_pending: 'PI Payment Pending',
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

const PI_STATUSES = ['pi_requested','pi_generated','pi_payment_pending']

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

function printDCChallan(order, activeBatch, activeDC, isSample = false, custCode = '') {
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
    background:${isSample?'#fef3c7':'#eff6ff'};color:${isSample?'#92400e':'#1d4ed8'};text-align:right}

  /* Divider */
  .divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}

  /* Meta grid */
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
  .meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
  .meta-addr{font-size:11px;color:#475569;line-height:1.6}
  .meta-gstin{font-size:11px;color:#475569;margin-top:5px}

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
  .totals-table tr.sub td{border-top:1px solid #e2e8f0;padding-top:10px}
  .totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}

  /* Words */
  .words{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}

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
      GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; ${esc(order.fulfilment_center) || 'Ahmedabad'}
    </div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/ssc-logo.svg" alt="SSC" style="height:52px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">${isSample ? 'Sample' : 'Delivery'}</div>
    <div class="doc-title">${isSample ? 'Sample Challan' : 'Delivery Challan'}</div>
  </div>
</div>

<hr class="divider"/>

<!-- Bill To + Reference -->
<div class="meta-grid">
  <div>
    <div class="meta-section-label">Bill To</div>
    <div class="meta-name">${esc(order.customer_name) || '—'}</div>
    ${custCode ? `<div style="font-size:11px;color:#475569;margin-top:2px">Customer ID: <strong style="font-family:'DM Mono',monospace">${esc(custCode)}</strong></div>` : ''}
    <div class="meta-addr">${esc(order.dispatch_address || '').replace(/\n/g,'<br/>')}</div>
    ${order.customer_gst ? `<div class="meta-gstin">GSTIN: <strong>${esc(order.customer_gst)}</strong></div>` : ''}
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>Challan No.</td><td class="mono">${esc(activeDC)}</td></tr>
      <tr><td>Challan Date</td><td>${dcDate}</td></tr>
      <tr><td>Order No.</td><td class="mono">${esc(order.order_number) || '—'}</td></tr>
      ${order.po_number ? `<tr><td>PO No. / Date</td><td>${esc(order.po_number)} / ${poDate}</td></tr>` : ''}
      ${(activeBatch?.invoice_number || order.invoice_number) ? `<tr><td>Invoice No.</td><td class="mono">${esc(activeBatch?.invoice_number || order.invoice_number)}</td></tr>` : ''}
      ${order.vehicle_number ? `<tr><td>Vehicle No.</td><td>${esc(order.vehicle_number)}</td></tr>` : ''}
      ${batchLabel ? `<tr><td>Batch</td><td>${esc(batchLabel)}</td></tr>` : ''}
    </table>
  </div>
</div>

<hr class="divider"/>

<!-- Terms -->
<div class="terms">
  <span>Delivery terms: <strong>${esc(order.dispatch_mode) || 'EXW Through Transport'}</strong></span>
  <span>Payment terms: <strong>${esc(order.credit_terms) || '—'}</strong></span>
  <span>Currency: <strong>INR</strong></span>
</div>

<!-- Items -->
<table class="items">
  <thead>
    <tr>
      <th style="width:40px">#</th>
      <th>Item Code</th>
      <th class="c" style="width:80px">Qty</th>
      <th class="c" style="width:50px">Unit</th>
      <th style="width:110px">Cust. Ref No</th>
      <th class="r" style="width:100px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, idx) => `
    <tr>
      <td style="color:#94a3b8">${idx + 1}</td>
      <td class="code">${esc(item.item_code) || '—'}</td>
      <td class="c" style="font-weight:700">${item.qty}</td>
      <td class="c" style="color:#64748b">Pc</td>
      <td style="font-size:11px;color:#475569">${esc(item.customer_ref_no) || '—'}</td>
      <td class="r">${(item.unit_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
      <td class="r" style="font-weight:600">${(item.total_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
    </tr>`).join('')}
  </tbody>
</table>

<!-- Totals -->
<div class="totals-wrap">
  <table class="totals-table">
    <tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    <tr><td class="lbl">CGST (9%)</td><td class="val">${cgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    <tr><td class="lbl">SGST (9%)</td><td class="val">${sgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
    ${order.freight ? `<tr><td class="lbl">Freight</td><td class="val">${(order.freight).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}
    <tr class="grand"><td class="lbl">Total Amount</td><td class="val">₹ ${grandTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>
  </table>
</div>

<div class="words">Amount in words: <strong>${numToWords(grandTotal)}</strong></div>

<!-- Signatures -->
<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Prepared By</div>Store / Dispatch</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Checked By</div>Accounts / Manager</div>
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

  const w = window.open('', '_blank')
  if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write(html)
  w.document.close()
}

export default function FCOrderDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const location     = useLocation()
  const dispatchId   = location.state?.dispatch_id || null

  const commentInputRef = useRef(null)
  const [order, setOrder]       = useState(null)
  const [custCode, setCustCode] = useState('')
  const [activeBatch, setActiveBatch] = useState(null)
  const [allBatches, setAllBatches]   = useState([])
  const [user, setUser]         = useState({ name: '', role: '', avatar: '' })
  const [profiles, setProfiles] = useState([])
  const [comments, setComments] = useState([])
  const [commentText, setCommentText]     = useState('')
  const [mentionQuery, setMentionQuery]     = useState(null)
  const [mentionPos, setMentionPos]         = useState({ top: 0, left: 0, width: 0 })
  const [postingComment, setPostingComment] = useState(false)
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
    const { data: pList } = await sb.from('profiles').select('id,name,username,role')
    setProfiles(pList || [])
    await loadOrder()
  }

  // Realtime: live batch status + comment updates
  useRealtimeSubscription(`fc-batch-${id}`, {
    table: 'order_dispatches', filter: `order_id=eq.${id}`,
    enabled: !!id, onEvent: () => loadOrder(),
  })
  useRealtimeSubscription(`fc-comments-${id}`, {
    table: 'order_comments', filter: `order_id=eq.${id}`,
    enabled: !!id, onEvent: () => loadOrder(),
  })

  async function loadOrder() {
    setLoading(true)
    const [{ data }, { data: allB }, { data: c }] = await Promise.all([
      sb.from('orders').select('*, order_items(*)').eq('id', id).single(),
      sb.from('order_dispatches').select('*').eq('order_id', id).order('batch_no', { ascending: true }),
      sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true }),
    ])
    setOrder(data)
    setAllBatches(allB || [])
    if (dispatchId) {
      const found = (allB || []).find(b => b.id === dispatchId)
      setActiveBatch(found || allB?.[allB.length - 1] || null)
    } else {
      setActiveBatch(allB?.[allB.length - 1] || null)
    }
    setComments(c || [])
    setLoading(false)
    // Non-blocking: look up customer_id
    if (data?.customer_name) {
      sb.from('customers').select('customer_id').ilike('customer_name', data.customer_name).maybeSingle().then(({ data: cust }) => setCustCode(cust?.customer_id || ''))
    }
  }

  async function goToCustomer() {
    if (!order?.customer_name) return
    const { data } = await sb.from('customers').select('id').ilike('customer_name', order.customer_name).maybeSingle()
    if (data?.id) navigate('/customers/' + data.id)
    else navigate('/customers?search=' + encodeURIComponent(order.customer_name))
  }

  async function logActivity(message) {
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message, tagged_users: [], is_activity: true })
    const { data: c } = await sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(c || [])
  }

  async function notifyUsers(roles, message) {
    const ownerName = order?.account_owner || order?.engineer_name || ''
    const seen = new Set()
    const targets = []
    profiles.filter(p => roles.includes(p.role) && p.role !== 'admin').forEach(p => {
      if (!seen.has(p.id)) { seen.add(p.id); targets.push(p) }
    })
    if (ownerName) {
      const ownerProfile = profiles.find(p => p.name === ownerName)
      if (ownerProfile && !seen.has(ownerProfile.id)) { seen.add(ownerProfile.id); targets.push(ownerProfile) }
    }
    if (order?.created_by) {
      const creatorProfile = profiles.find(p => p.id === order.created_by)
      if (creatorProfile && !seen.has(creatorProfile.id)) { seen.add(creatorProfile.id); targets.push(creatorProfile) }
    }
    const final = targets.filter(t => t.id !== user.id)
    if (!final.length) return
    await sb.from('notifications').insert(final.map(t => ({
      user_name: t.name, user_id: t.id, message, order_id: id,
      order_number: order?.order_number || '', from_name: user.name,
    })))
  }

  function handleCommentInput(e) {
    const val = e.target.value
    setCommentText(val)
    const cursor = e.target.selectionStart
    const match = val.slice(0, cursor).match(/@([\w.]*)$/)
    if (match) {
      const rect = e.target.getBoundingClientRect()
      setMentionPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    setMentionQuery(match ? match[1] : null)
  }

  function insertMention(name) {
    const cursor = commentInputRef.current?.selectionStart || commentText.length
    const slug = name.replace(/\s+/g, '_')
    const before = commentText.slice(0, cursor).replace(/@[\w.]*$/, '@' + slug + ' ')
    setCommentText(before + commentText.slice(cursor))
    setMentionQuery(null)
    setTimeout(() => commentInputRef.current?.focus(), 0)
  }

  async function submitComment() {
    if (!commentText.trim()) return
    setPostingComment(true)
    const text = commentText.trim()
    const tagged = [...text.matchAll(/@([\w.]+)/g)].map(m => m[1].replace(/_/g, ' '))
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message: text, tagged_users: tagged })
    if (tagged.length > 0) {
      const notifRows = tagged.map(tname => {
        const p = profiles.find(pr => pr.name === tname)
        return { user_name: tname, user_id: p?.id || null, message: `${user.name} tagged you in ${order?.order_number}`, order_id: id, order_number: order?.order_number || '', from_name: user.name }
      })
      await sb.from('notifications').insert(notifRows)
    }
    setCommentText(''); setMentionQuery(null)
    const { data: c } = await sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(c || [])
    setPostingComment(false)
  }

  function renderMessage(text) {
    return text.split(/(@[\w.]+)/g).map((part, i) =>
      part.startsWith('@')
        ? <span key={i} className="od-mention-tag">@{part.slice(1).replace(/_/g, ' ')}</span>
        : part
    )
  }

  async function doAction(toStatus, activityMsg, extraUpdate = {}) {
    setSaving(true)
    // Update only this batch's status — each batch is processed independently
    if (activeBatch) {
      const { error } = await sb.from('order_dispatches').update({
        status: toStatus, updated_at: new Date().toISOString(), ...extraUpdate
      }).eq('id', activeBatch.id)
      if (error) { toast('Error: ' + error.message); setSaving(false); return }
    }
    await logActivity(activityMsg)
    toast('Status updated', 'success')
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  async function confirmGoodsIssued() {
    setSaving(true)
    let dcNum = null
    const nextStatus = order.order_type === 'SAMPLE' ? 'invoice_generated' : 'goods_issued'
    if (activeBatch) {
      const { data } = await sb.rpc('confirm_dispatch_dc', { p_dispatch_id: activeBatch.id })
      dcNum = data
      const { error } = await sb.from('order_dispatches').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
      if (error) { toast('Error: ' + error.message); setSaving(false); return }
    }
    // Update orders.status to notify accounts — only if order isn't already past this stage
    const alreadyPast = ['dispatched_fc'].includes(order.status)
    if (!alreadyPast) {
      await sb.from('orders').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', id)
    }
    const actMsg = order.order_type === 'SAMPLE'
      ? `Goods Issued — DC confirmed: ${dcNum || order.dc_number || '—'}. Sample ready for challan.`
      : `Goods Issued — DC confirmed: ${dcNum || order.dc_number || '—'}. Handed to Accounts for billing.`
    await logActivity(actMsg)
    if (order.order_type !== 'SAMPLE') {
      await notifyUsers(['accounts', 'admin'], `${order.order_number} — Goods Issued. Ready for billing.`)
    }
    toast('Goods issued confirmed', 'success')
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  async function confirmDeliveryReady() {
    if (!dispatchMode) { toast('Select a dispatch mode.'); return }
    let updateFields = { dispatch_mode: dispatchMode, vehicle_type: null, vehicle_number: null, driver_name: null }
    let detail = ''
    if (dispatchMode === 'By Person') {
      if (!personName.trim()) { toast('Enter person name.'); return }
      updateFields.driver_name = personName.trim()
      detail = `By Person — ${personName.trim()}`
    } else if (dispatchMode === 'Vehicle') {
      if (!vehicleType)       { toast('Select vehicle type.'); return }
      if (!vehicleNum.trim()) { toast('Enter vehicle number.'); return }
      if (!driverName.trim()) { toast('Enter driver name.'); return }
      updateFields.vehicle_type   = vehicleType
      updateFields.vehicle_number = vehicleNum.trim()
      updateFields.driver_name    = driverName.trim()
      detail = `Vehicle — ${vehicleType} · ${vehicleNum.trim()} · Driver: ${driverName.trim()}`
    } else if (dispatchMode === 'Porter') {
      if (!personName.trim()) { toast('Enter porter name.'); return }
      updateFields.driver_name = personName.trim()
      detail = `Porter — ${personName.trim()}`
    } else if (dispatchMode === 'Transport') {
      if (!transporterName.trim()) { toast('Enter transporter name.'); return }
      updateFields.driver_name    = transporterName.trim()
      updateFields.vehicle_number = lrNumber.trim() || null
      detail = `Transport — ${transporterName.trim()}${transporterId.trim() ? ' · ID: ' + transporterId.trim() : ''}${lrNumber.trim() ? ' · LR: ' + lrNumber.trim() : ''}`
    } else if (dispatchMode === 'Courier') {
      if (!courierCompany.trim()) { toast('Enter courier company.'); return }
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
      const { error } = await sb.from('order_dispatches').update({
        status: nextOrderStatus, ...updateFields, updated_at: new Date().toISOString(),
      }).eq('id', activeBatch.id)
      if (error) { toast('Error: ' + error.message); setSaving(false); return }
    }
    await logActivity(`Delivery Ready — ${detail}. ${actSuffix}`)
    toast('Delivery details saved', 'success')
    setShowDeliveryForm(false)
    setSaving(false)
    await loadOrder()
  }

  async function confirmDelivered() {
    setSaving(true)
    if (activeBatch) {
      await sb.from('order_dispatches').update({ status: 'dispatched_fc', delivered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    }
    // Order is fully done only when ALL batches are dispatched_fc
    const { data: allBatchData } = await sb.from('order_dispatches').select('status').eq('order_id', id)
    const allBatchesDone = (allBatchData || []).every(b => b.status === 'dispatched_fc')
    const finalStatus = allBatchesDone ? 'dispatched_fc' : 'partial_dispatch'
    const { error } = await sb.from('orders').update({ status: finalStatus, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    await logActivity(allBatchesDone ? 'Order Delivered — all batches complete.' : 'Batch Delivered — remaining batch(es) still pending.')
    toast(allBatchesDone ? 'Order delivered' : 'Batch delivered', 'success')
    setConfirm(null)
    setSaving(false)
    await loadOrder()
  }

  const mentionSuggestions = mentionQuery !== null
    ? profiles.filter(p =>
        p.name !== user.name && (
          p.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          (p.username || '').toLowerCase().includes(mentionQuery.toLowerCase())
        )
      ).slice(0, 6)
    : []

  if (loading) return (
    <Layout pageTitle="FC — Order Detail" pageKey="fc">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div>
    </Layout>
  )
  if (!order) return <Layout pageTitle="FC Order" pageKey="fc"><div className="od-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Order not found</div><div style={{fontSize:13}}>This order may have been deleted or you don't have access.</div></div></div></Layout>

  const isCancelled  = order.status === 'cancelled'
  const isSample     = order.order_type === 'SAMPLE'
  // Use the active batch's own status/FC when available — each batch is independent
  const batchStatus  = activeBatch ? (activeBatch.status || 'delivery_created') : order.status
  const batchFC      = activeBatch?.fulfilment_center || order.fulfilment_center
  const pipelineIdx  = fcPipelineIdx(batchStatus)
  const withAccounts = !isSample && WITH_ACCOUNTS.includes(batchStatus)
  const isDelivered  = batchStatus === 'dispatched_fc'
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
                  {order.order_type === 'SO' ? 'Standard Order' : order.order_type === 'CO' ? 'Customised Order' : 'Sample Request'} · {batchFC || '—'}
                  {isSample && <span style={{marginLeft:8,fontSize:10,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:4,padding:'1px 7px',letterSpacing:'0.5px',verticalAlign:'middle'}}>SAMPLE</span>}
                  <span className={'od-status-badge ' + (isCancelled ? 'cancelled' : isDelivered ? 'delivered' : withAccounts ? 'pending' : 'delivery')}>
                    {isCancelled ? 'Cancelled' : isDelivered ? 'Delivered' : withAccounts ? 'With Accounts' : stageLabel(batchStatus)}
                  </span>
                </div>
                <div className="od-header-title"><span onClick={goToCustomer} style={{cursor:'pointer',borderBottom:'1px dotted #1a4dab',color:'inherit'}}>{order.customer_name}</span></div>
                <div className="od-header-num">
                  <button
                    onClick={() => navigate('/orders/' + id)}
                    style={{background:'none',border:'none',padding:0,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit',color:'#1a4dab',fontWeight:600,textDecoration:'underline'}}
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
            {isCancelled && (
              <div className="od-pending-banner" style={{background:'#fff1f2',border:'1px solid #fecdd3',color:'#be123c'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:20,height:20}}><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
                <div>
                  <div className="od-pending-banner-label">Order Cancelled</div>
                  <div>This order has been cancelled. No further action is required.</div>
                </div>
              </div>
            )}

            {withAccounts && (
              <div className="od-pending-banner" style={{background:'#fefce8',border:'1px solid #fde047',color:'#92400e'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <div>
                  <div className="od-pending-banner-label">With Accounts — {stageLabel(batchStatus)}</div>
                  <div>Billing team is processing this order. You will be notified when it comes back.</div>
                </div>
              </div>
            )}

            {/* Delivered banner */}
            {isDelivered && (
              <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div>
                  <div className="od-pending-banner-label">Delivered — {batchFC || ''}</div>
                  <div>This batch has been delivered.</div>
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
                  {(() => {
                    const inv = activeBatch?.invoice_number || order.invoice_number
                    if (!inv) return null
                    const isTemp = inv?.startsWith('Temp/')
                    return (
                      <div className="od-detail-field">
                        <label>Invoice</label>
                        <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:isTemp ? '#92400e' : '#166534'}}>
                          {inv}
                          {isTemp && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',marginLeft:8,fontWeight:600}}>TEMP</span>}
                        </div>
                      </div>
                    )
                  })()}
                  {(() => {
                    const eway = activeBatch?.eway_bill_number || (!activeBatch ? order.eway_bill_number : null)
                    if (!eway) return null
                    return (
                      <div className="od-detail-field">
                        <label>E-Way Bill</label>
                        <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:'#166534'}}>{eway}</div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Vehicle details — read from active batch, not order level */}
            {(() => {
              const mode   = activeBatch?.dispatch_mode || (!activeBatch ? order.dispatch_mode : null)
              const vType  = activeBatch?.vehicle_type  || (!activeBatch ? order.vehicle_type  : null)
              const vNum   = activeBatch?.vehicle_number|| (!activeBatch ? order.vehicle_number : null)
              const driver = activeBatch?.driver_name   || (!activeBatch ? order.driver_name   : null)
              if (!mode) return null
              return (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-title">Delivery Details</div></div>
                  <div className="od-card-body">
                    <div className="od-detail-grid">
                      <div className="od-detail-field"><label>Mode</label><div className="val">{mode}</div></div>
                      {vType  && <div className="od-detail-field"><label>Vehicle Type</label><div className="val">{vType}</div></div>}
                      {vNum   && <div className="od-detail-field"><label>{mode === 'Transport' ? 'LR Number' : mode === 'Courier' ? 'Tracking No.' : 'Vehicle No.'}</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{vNum}</div></div>}
                      {driver && <div className="od-detail-field"><label>{mode === 'Transport' ? 'Transporter' : mode === 'Courier' ? 'Courier Co.' : mode === 'By Person' || mode === 'Porter' ? 'Name' : 'Driver'}</label><div className="val">{driver}</div></div>}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Order info */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Order Information</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field"><label>Customer Name</label><div className="val"><span onClick={goToCustomer} style={{color:'#1a4dab',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted'}}>{order.customer_name}</span></div></div>
                  <div className="od-detail-field"><label>Customer ID</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{custCode || '—'}</div></div>
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
                        <th>Cust. Ref No</th>
                        <th style={{textAlign:'right'}}>Qty (This Batch)</th>
                        <th style={{textAlign:'right'}}>Unit Price</th>
                        <th style={{textAlign:'right'}}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(activeBatch?.dispatched_items || (order.order_items||[]).map(i => ({
                        item_code: i.item_code, qty: i.qty, unit_price: i.unit_price_after_disc, total_price: i.total_price, customer_ref_no: i.customer_ref_no
                      }))).map((item, idx) => (
                        <tr key={idx}>
                          <td className="od-items-sr">{idx + 1}</td>
                          <td><span className="od-items-code">{item.item_code}</span></td>
                          <td style={{fontSize:11,color:'var(--gray-500)'}}>{item.customer_ref_no || '—'}</td>
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
            {!withAccounts && !isCancelled && (() => {
              // Always use activeBatch.status when a batch exists — order.status is not reliably updated during batch lifecycle
              const batchStatus = activeBatch != null
                ? (activeBatch.status || 'delivery_created')
                : order.status
              if (batchStatus === 'dispatched_fc') return null
              if (PI_STATUSES.includes(batchStatus)) return (
                <div className="od-card" style={{borderLeft:'4px solid #d97706'}}>
                  <div className="od-card-header"><div className="od-card-title" style={{color:'#92400e'}}>⏳ Awaiting Proforma Invoice</div></div>
                  <div className="od-card-body">
                    <p style={{fontSize:13,color:'#92400e',margin:0}}>This order is <strong>Against PI</strong>. It cannot be picked until Accounts issues the Proforma Invoice and payment is confirmed.</p>
                    <p style={{fontSize:12,color:'var(--gray-400)',marginTop:8,margin:'8px 0 0'}}>Current status: <strong>{stageLabel(batchStatus)}</strong></p>
                  </div>
                </div>
              )
              return (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-title">Action — {stageLabel(batchStatus)}</div></div>
                <div className="od-card-body">

                  {/* Picking */}
                  {batchStatus === 'delivery_created' && !confirm && (
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
                  {batchStatus === 'picking' && !confirm && (
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
                  {batchStatus === 'packing' && !confirm && (
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
                  {!isSample && batchStatus === 'invoice_generated' && !showDeliveryForm && !confirm && (
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
                  {isSample && batchStatus === 'invoice_generated' && !showDeliveryForm && !confirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Goods issued. Generate the Sample Challan, then enter delivery details.</p>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <button style={{background:'#1a4dab',padding:'10px 16px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                          onClick={() => printDCChallan(order, activeBatch, activeDC, true, custCode)}>
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
                  {batchStatus === 'invoice_generated' && showDeliveryForm && (
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
                  {batchStatus === 'eway_generated' && !confirm && (
                    <div>
                      {(activeBatch?.eway_bill_number || order.eway_bill_number) && <p style={{fontSize:13,fontFamily:'var(--mono)',fontWeight:700,color:'#166534',marginBottom:8}}>E-Way Bill: {activeBatch?.eway_bill_number || order.eway_bill_number}</p>}
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
            )
          })()}

          </div>{/* end od-main */}

          {/* RIGHT — sidebar */}
          <div className="od-sidebar">

            {/* DC Number card */}
            <div className="od-side-card">
              <div className="od-side-card-title">Delivery Challan</div>
              <div style={{padding:'0 16px 14px'}}>
                {/* Batch switcher — only shown when multiple batches */}
                {allBatches.length > 1 && (
                  <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
                    {allBatches.map(b => (
                      <button key={b.id} onClick={() => setActiveBatch(b)}
                        style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:20,border:'1px solid',cursor:'pointer',fontFamily:'var(--font)',
                          background: activeBatch?.id === b.id ? '#1e3a5f' : 'white',
                          color: activeBatch?.id === b.id ? 'white' : '#475569',
                          borderColor: activeBatch?.id === b.id ? '#1e3a5f' : '#e2e8f0',
                        }}>
                        Batch {b.batch_no}
                      </button>
                    ))}
                  </div>
                )}
                {activeBatch && <div style={{fontSize:10,color:'var(--gray-400)',fontWeight:600,marginBottom:4}}>BATCH {activeBatch.batch_no}</div>}
                <div style={{fontFamily:'var(--mono)',fontSize:18,fontWeight:800,color: isTempDC ? '#92400e' : '#166534',letterSpacing:'-0.5px',marginBottom:4}}>
                  {activeDC || '—'}
                </div>
                {isTempDC && <div style={{fontSize:11,color:'#92400e',fontWeight:600}}>Temp — will be confirmed at Goods Issue</div>}
                {!isTempDC && activeDC && <div style={{fontSize:11,color:'#166534',fontWeight:600}}>Confirmed DC</div>}
                {!isTempDC && activeDC && (['delivery_ready','eway_generated','dispatched_fc'].includes(batchStatus) || (isSample && batchStatus === 'invoice_generated')) && (
                  <button
                    onClick={() => printDCChallan(order, activeBatch, activeDC, isSample, custCode)}
                    style={{marginTop:10,display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid #1a4dab',background:'#e8f2fc',color:'#1a4dab',fontFamily:'var(--font)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                    {isSample ? 'Download Sample Challan' : 'Download DC Challan'}
                  </button>
                )}
                {(() => {
                  const inv    = activeBatch ? activeBatch.invoice_number    : order.invoice_number
                  const invPdf = activeBatch ? activeBatch.invoice_pdf_url   : order.invoice_pdf_url
                  if (!inv) return null
                  const isTemp = inv?.startsWith('Temp/')
                  return (
                    <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--gray-100)'}}>
                      <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Invoice</div>
                      <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:isTemp ? '#92400e' : '#166534'}}>{inv}</div>
                      {invPdf && (
                        <a href={invPdf} target="_blank" rel="noreferrer"
                          style={{fontSize:11,color:'#1a4dab',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:4,textDecoration:'none'}}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          View Invoice PDF
                        </a>
                      )}
                    </div>
                  )
                })()}
                {(() => {
                  const eway    = activeBatch ? activeBatch.eway_bill_number : order.eway_bill_number
                  const ewayPdf = activeBatch ? activeBatch.eway_pdf_url     : order.eway_pdf_url
                  if (!eway) return null
                  return (
                    <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--gray-100)'}}>
                      <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>E-Way Bill</div>
                      <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:700,color:'#166534'}}>{eway}</div>
                      {ewayPdf && (
                        <a href={ewayPdf} target="_blank" rel="noreferrer"
                          style={{fontSize:11,color:'#166534',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:4,textDecoration:'none'}}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          View E-Way Bill PDF
                        </a>
                      )}
                    </div>
                  )
                })()}
                {(() => {
                  const einvPdf = activeBatch ? activeBatch.einvoice_pdf_url : order.einvoice_pdf_url
                  if (!einvPdf) return null
                  return (
                    <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--gray-100)'}}>
                      <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>E-Invoice</div>
                      <a href={einvPdf} target="_blank" rel="noreferrer"
                        style={{fontSize:11,color:'#7c3aed',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,textDecoration:'none'}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        View E-Invoice PDF
                      </a>
                    </div>
                  )
                })()}
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
                          <div className="od-activity-val" style={{fontWeight:400}}>{renderMessage(c.message)}</div>
                          <div className="od-activity-time">{fmtTs(c.created_at)}</div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Comment input */}
              <div className="od-comment-box">
                <div className="od-comment-input-wrap">
                  <textarea ref={commentInputRef} className="od-comment-input"
                    value={commentText} onChange={handleCommentInput}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                    placeholder="Add a note… use @ to tag someone" rows={2} />
                  {mentionQuery !== null && mentionSuggestions.length > 0 && (
                    <div className="od-mention-dropdown" style={{ top: mentionPos.top, left: mentionPos.left, width: mentionPos.width }}>
                      {mentionSuggestions.map(p => (
                        <div key={p.id} className="od-mention-item" onMouseDown={e => { e.preventDefault(); insertMention(p.name) }}>
                          <div className="od-mention-avatar">{p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</div>
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

          </div>{/* end od-sidebar */}
        </div>{/* end od-layout */}
      </div>
    </div>
    </Layout>
  )
}
