import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { toast } from '../lib/toast'
import { fmt, fmtTs, esc } from '../lib/fmt'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/neworder.css'
import { friendlyError } from '../lib/errorMsg'


const ORDER_MODULE_STAGES = [
  { key: 'pending',          label: 'Order Created'   },
  { key: 'inv_check',        label: 'Order Approved'  },
  { key: 'inventory_check',  label: 'Inventory Check' },
  { key: 'dispatch',         label: 'Ready to Ship'   },
  { key: 'delivery_created', label: 'Delivery Created'},
]
const ORDER_PIPELINE_KEYS = ORDER_MODULE_STAGES.map(s => s.key)

// Statuses that mean "handed to FC/Sales" — order is in progress beyond ops
const FC_ACTIVE_STATUSES = ['delivery_created','picking','packing','goods_issued','pending_billing','credit_check','goods_issue_posted','invoice_generated','delivery_ready','eway_pending','eway_generated','dispatched_fc']

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return '—'; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:8}}><div style={{width:26,height:26,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:13,fontWeight:500}}>{name}</span></div> }

function emptyItem() {
  return { _new: true, item_code: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', dispatch_date: '', customer_ref_no: '', description: '' }
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

function printDCChallan(order, batch, dcNumber, isSample = false, custCode = '') {
  const items = batch?.dispatched_items
    ? batch.dispatched_items.map(di => {
        const master = (order.order_items || []).find(oi => oi.id === di.order_item_id)
        return { ...di, description: master?.description || '', customer_ref_no: di.customer_ref_no || master?.customer_ref_no || '' }
      })
    : (order.order_items || []).map(i => ({ item_code: i.item_code, qty: i.qty, unit_price: i.unit_price_after_disc || i.unit_price, total_price: i.total_price, description: i.description || '', customer_ref_no: i.customer_ref_no || '' }))
  const subtotal = items.reduce((s, i) => s + (i.total_price || 0), 0)
  const cgst = Math.round(subtotal * 0.09 * 100) / 100
  const sgst = Math.round(subtotal * 0.09 * 100) / 100
  const grandTotal = subtotal + cgst + sgst + (order.freight || 0)
  const dcDate = fmtDC(batch?.created_at || new Date())
  const poDate = fmtDC(order.order_date)
  const batchLabel = batch ? `Batch ${batch.batch_no}` : ''

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${isSample ? 'Sample Challan' : 'Delivery Challan'} — ${dcNumber}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5}.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}.co-name{font-size:17px;font-weight:700;margin-bottom:2px}.co-sub{font-size:11px;color:#64748b;margin-bottom:8px}.co-addr{font-size:10.5px;color:#475569;line-height:1.6}
.doc-title{font-size:28px;font-weight:700;text-align:right;letter-spacing:-0.5px}.doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:${isSample?'#fef3c7':'#eff6ff'};color:${isSample?'#92400e':'#1d4ed8'}}
.divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}.meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}.meta-name{font-size:13px;font-weight:700;margin-bottom:3px}.meta-addr{font-size:11px;color:#475569;line-height:1.6}
.ref-table{width:100%;border-collapse:collapse}.ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}.ref-table tr td:first-child{color:#64748b;width:45%}.ref-table tr td:last-child{font-weight:600}
.terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}.terms span strong{color:#0f172a;font-weight:600}
table.items{width:100%;border-collapse:collapse;margin-bottom:4px}table.items thead tr{border-bottom:2px solid #0f172a}table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}table.items th.r{text-align:right}table.items th.c{text-align:center}table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top}table.items td.r{text-align:right}table.items td.c{text-align:center}table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:12px}.totals-table{width:300px;border-collapse:collapse}.totals-table td{padding:5px 0;font-size:11.5px}.totals-table td.lbl{color:#64748b}.totals-table td.val{text-align:right;font-weight:500}.totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
.words{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
.sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}.sig-cell{text-align:center;font-size:10px;color:#64748b}.sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}.sig-name{font-weight:600;color:#0f172a;font-size:11px}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}.footer-left{font-size:10px;color:#94a3b8;line-height:1.6}.footer-right{font-size:10px;color:#94a3b8;text-align:right}
@media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style></head><body>
<div class="header"><div><div class="co-name">SSC Control Pvt. Ltd.</div><div class="co-sub">Engineering Industry. Powering Progress.</div><div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div><div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; ${esc(order.fulfilment_center) || 'Ahmedabad'}</div></div><div style="text-align:right"><img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/><div class="doc-type-badge">${isSample ? 'Sample' : 'Delivery'}</div><div class="doc-title">${isSample ? 'Sample Challan' : 'Delivery Challan'}</div></div></div>
<hr class="divider"/>
<div class="meta-grid"><div><div class="meta-section-label">Bill To</div><div class="meta-name">${esc(order.customer_name) || '—'}</div>${custCode ? `<div style="font-size:11px;color:#475569;margin-top:2px">Customer ID: <strong style="font-family:'Geist Mono',monospace">${esc(custCode)}</strong></div>` : ''}<div class="meta-addr">${esc(order.dispatch_address || '').replace(/\\n/g,'<br/>')}</div>${order.customer_gst ? `<div style="font-size:11px;color:#475569;margin-top:5px">GSTIN: <strong>${esc(order.customer_gst)}</strong></div>` : ''}</div><div><div class="meta-section-label">Reference</div><table class="ref-table"><tr><td>Challan No.</td><td class="mono">${esc(dcNumber)}</td></tr><tr><td>Challan Date</td><td>${dcDate}</td></tr><tr><td>Order No.</td><td class="mono">${esc(order.order_number) || '—'}</td></tr>${order.po_number ? `<tr><td>PO No. / Date</td><td>${esc(order.po_number)} / ${poDate}</td></tr>` : ''}${(batch?.invoice_number || order.invoice_number) ? `<tr><td>Invoice No.</td><td class="mono">${esc(batch?.invoice_number || order.invoice_number)}</td></tr>` : ''}${batchLabel ? `<tr><td>Batch</td><td>${esc(batchLabel)}</td></tr>` : ''}</table></div></div>
<hr class="divider"/>
<div class="terms"><span>Delivery terms: <strong>${esc(order.dispatch_mode) || 'EXW Through Transport'}</strong></span><span>Payment terms: <strong>${esc(order.credit_terms) || '—'}</strong></span><span>Currency: <strong>INR</strong></span></div>
<table class="items"><thead><tr><th style="width:40px">#</th><th>Item Code</th><th class="c" style="width:80px">Qty</th><th class="c" style="width:50px">Unit</th><th style="width:110px">Cust. Ref No</th><th class="r" style="width:100px">Unit Price</th><th class="r" style="width:100px">Amount</th></tr></thead><tbody>
${items.map((item, idx) => `<tr><td style="color:#94a3b8">${idx+1}</td><td class="code">${esc(item.item_code) || '—'}${item.description ? `<div style="font-size:10px;color:#64748b;font-family:'Geist',sans-serif;font-weight:400;margin-top:2px">${esc(item.description)}</div>` : ''}</td><td class="c" style="font-weight:700">${item.qty}</td><td class="c" style="color:#64748b">Pc</td><td style="font-size:11px;color:#475569">${esc(item.customer_ref_no) || '—'}</td><td class="r">${(item.unit_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td class="r" style="font-weight:600">${(item.total_price||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>`).join('')}
</tbody></table>
<div class="totals-wrap"><table class="totals-table"><tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr><tr><td class="lbl">CGST (9%)</td><td class="val">${cgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr><tr><td class="lbl">SGST (9%)</td><td class="val">${sgst.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>${order.freight ? `<tr><td class="lbl">Freight</td><td class="val">${(order.freight).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}<tr class="grand"><td class="lbl">Total Amount</td><td class="val">₹ ${grandTotal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr></table></div>
<div class="words">Amount in words: <strong>${numToWords(grandTotal)}</strong></div>
<div class="sig-row"><div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Prepared By</div>Store / Dispatch</div><div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Checked By</div>Accounts / Manager</div><div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div></div>
<div class="footer"><div class="footer-left">SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div><div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div></div>
</body></html>`

  const w = window.open('', '_blank')
  if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
  w.document.write(html)
  w.document.close()
  w.onload = () => w.print()
}

export default function OrderDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [order, setOrder]           = useState(null)
  const [user, setUser]             = useState({ name: '', avatar: '', role: '' })
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelInitiatorType, setCancelInitiatorType] = useState('staff')
  const [cancelInitiatorName, setCancelInitiatorName] = useState('')
  const [cancelInitiatorFreeText, setCancelInitiatorFreeText] = useState('')

  const [editMode, setEditMode]   = useState(false)
  const [editData, setEditData]   = useState({})
  const [editItems, setEditItems] = useState([])

  const [comments, setComments]             = useState([])
  const [profiles, setProfiles]             = useState([])
  const [commentText, setCommentText]       = useState('')
  const [mentionQuery, setMentionQuery]     = useState(null)
  const [mentionPos, setMentionPos]         = useState({ top: 0, left: 0, width: 0 })
  const [postingComment, setPostingComment] = useState(false)
  const commentInputRef = useRef(null)

  // Dispatch modals
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [showPartialModal, setShowPartialModal]   = useState(false)
  const [partialItems, setPartialItems]           = useState([])
  const [fcCenter, setFcCenter]                   = useState('Kaveri')
  const [dispatchType, setDispatchType]           = useState('full') // 'full' | 'partial'
  const [pendingPartialSelected, setPendingPartialSelected] = useState([])
  const [isNextBatch, setIsNextBatch]             = useState(false)
  const [batches, setBatches]                     = useState([])
  const [linkedPOs, setLinkedPOs]                 = useState([])
  const [custCode, setCustCode]                   = useState('')

  // Stock status (inventory check)
  const [stockStatuses, setStockStatuses] = useState({}) // { itemId: 'in_stock' | 'out_of_stock' }

  // Edit confirmation
  const [showEditConfirm, setShowEditConfirm]     = useState(false)
  const [showSaveReason, setShowSaveReason]       = useState(false)
  const [editReason, setEditReason]               = useState('')
  const [pendingSaveApprove, setPendingSaveApprove] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const [{ data: profile }, { data: profileList }] = await Promise.all([
      sb.from('profiles').select('name,role').eq('id', session.user.id).single(),
      sb.from('profiles').select('id,name,username,role').order('name'),
      loadOrder(),
    ])
    setProfiles(profileList || [])
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
  }

  // Realtime: live order status + comment updates
  useRealtimeSubscription(`order-${id}`, {
    table: 'orders', filter: `id=eq.${id}`, event: 'UPDATE',
    enabled: !!id, onEvent: () => loadOrder(true),
  })
  useRealtimeSubscription(`order-comments-${id}`, {
    table: 'order_comments', filter: `order_id=eq.${id}`,
    enabled: !!id, onEvent: () => loadOrder(true),
  })

  async function loadOrder(silent) {
    if (!silent) setLoading(true)
    const [{ data }, { data: batches }, { data: comments }] = await Promise.all([
      sb.from('orders').select('*, order_items(*)').eq('id', id).single(),
      sb.from('order_dispatches').select('*').eq('order_id', id).order('batch_no', { ascending: true }),
      sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true }),
    ])
    setOrder(data)
    setBatches(batches || [])
    setComments(comments || [])
    // Initialize stock statuses from order_items
    const ss = {}
    for (const item of (data?.order_items || [])) {
      if (item.stock_status) ss[item.id] = item.stock_status
    }
    setStockStatuses(ss)
    setLoading(false)
    // Non-blocking: look up customer_id + linked PO in parallel
    const bg = []
    if (data?.customer_name) {
      bg.push(sb.from('customers').select('customer_id').ilike('customer_name', data.customer_name).maybeSingle().then(({ data: cust }) => setCustCode(cust?.customer_id || '')))
    }
    if (data?.order_type === 'CO') {
      bg.push(sb.from('purchase_orders').select('id,po_number,status,vendor_name,total_amount,expected_delivery,created_at').eq('order_id', id).order('created_at', { ascending: false }).then(({ data: pos }) => setLinkedPOs(pos || [])))
    } else {
      setLinkedPOs([])
    }
    Promise.all(bg)
  }

  async function loadComments() {
    const { data } = await sb.from('order_comments')
      .select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function goToCustomer() {
    if (!order?.customer_name) return
    const { data } = await sb.from('customers').select('id').ilike('customer_name', order.customer_name).maybeSingle()
    if (data?.id) navigate('/customers/' + data.id)
    else navigate('/customers?search=' + encodeURIComponent(order.customer_name))
  }

  // Derived state
  const effectiveStatus  = order?.status === 'partial_dispatch' ? 'delivery_created'
    : order?.status === 'gen_invoice' ? 'delivery_created'  // legacy orders
    : order?.status
  const isOps            = ['ops', 'admin', 'management'].includes(user.role)
  const isPending        = order?.status === 'pending'
  const isEditable       = ['pending', 'inv_check', 'inventory_check'].includes(order?.status)
  const isCancelled      = order?.status === 'cancelled'
  const isInFCFlow       = FC_ACTIVE_STATUSES.includes(order?.status)
  const pipelineIdx      = ORDER_PIPELINE_KEYS.indexOf(effectiveStatus)
  const canAdvance       = isOps && !isCancelled && !isInFCFlow && pipelineIdx >= 0 && pipelineIdx < ORDER_PIPELINE_KEYS.length - 1
  const hasAnyDispatched = (order?.order_items || []).some(i => (i.dispatched_qty || 0) > 0)
  const hasAnyPending    = (order?.order_items || []).some(i => i.qty > (i.dispatched_qty || 0))
  const showDispatchCols = hasAnyDispatched
  // Next Batch button: ops can dispatch remaining items when order is in FC flow but items still pending
  const canNextBatch     = isOps && !isCancelled && isInFCFlow && hasAnyPending

  const actionBtnLabel = isPending ? 'Accept Order'
    : order?.status === 'inv_check'       ? 'Confirm Approval'
    : order?.status === 'inventory_check' ? 'Confirm Inventory'
    : order?.status === 'dispatch'        ? 'Delivery Created'
    : 'Mark Complete'

  // ── Edit mode ──
  function enterEditMode() {
    setEditData({
      customer_name:    order.customer_name    || '',
      customer_gst:     order.customer_gst     || '',
      dispatch_address: order.dispatch_address || '',
      po_number:        order.po_number        || '',
      order_date:       order.order_date       || '',
      order_type:       order.order_type       || 'SO',
      received_via:     order.received_via     || '',
      freight:          String(order.freight   || '0'),
      credit_terms:     order.credit_terms     || '',
      notes:            order.notes            || '',
    })
    setEditItems((order.order_items || []).map(item => ({
      id:                   item.id,
      item_code:            item.item_code            || '',
      qty:                  String(item.qty           || ''),
      lp_unit_price:        String(item.lp_unit_price || ''),
      discount_pct:         String(item.discount_pct  || '0'),
      unit_price_after_disc: String(item.unit_price_after_disc || ''),
      total_price:          String(item.total_price   || ''),
      dispatch_date:        item.dispatch_date         || '',
      customer_ref_no:      item.customer_ref_no       || '',
      description:          item.description           || '',
      sr_no:                item.sr_no,
    })))
    setEditMode(true)
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

  async function fetchCustomers(q) {
    const { data } = await sb.from('customers').select('customer_id,customer_name,gst,billing_address,credit_terms')
      .ilike('customer_name', '%' + q + '%').limit(10)
    return data || []
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items').select('item_code').ilike('item_code', '%' + q + '%').limit(10)
    return data || []
  }

  async function goToItem(item_code) {
    const { data } = await sb.from('items').select('id').eq('item_code', item_code).single()
    if (data?.id) navigate(`/items/${data.id}`)
  }

  async function saveEdits(reason = '') {
    setSaving(true)
    const validItems = editItems.filter(i => i.item_code.trim() && i.qty)
    if (!editData.customer_name.trim() || !validItems.length) {
      toast('Customer name and at least one item are required.')
      setSaving(false); return
    }
    const { error: hdrErr } = await sb.from('orders').update({
      customer_name: editData.customer_name.trim(), customer_gst: editData.customer_gst.trim(),
      dispatch_address: editData.dispatch_address.trim(), po_number: editData.po_number.trim(),
      order_date: editData.order_date, order_type: editData.order_type, received_via: editData.received_via,
      freight: parseFloat(editData.freight) || 0, credit_terms: editData.credit_terms, notes: editData.notes,
      edited_by: user.name, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (hdrErr) { toast('Failed to update order: ' + hdrErr.message); setSaving(false); return }
    const { error: itemsErr } = await sb.rpc('replace_order_items', {
      p_order_id: id,
      p_items: validItems.map((item, i) => ({
        sr_no: i + 1, item_code: item.item_code.trim(),
        qty: parseFloat(item.qty), lp_unit_price: parseFloat(item.lp_unit_price) || 0,
        discount_pct: parseFloat(item.discount_pct) || 0,
        unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
        total_price: parseFloat(item.total_price) || 0,
        dispatch_date: item.dispatch_date || '',
        customer_ref_no: item.customer_ref_no?.trim() || '',
        description: item.description?.trim() || '',
      }))
    })
    if (itemsErr) { toast('Failed to save items: ' + itemsErr.message); setSaving(false); return }
    const msg = reason.trim() ? `Order edited — ${reason.trim()}` : 'Order edited — details updated'
    await logActivity(msg)
    await notifyUsers([], `${order.order_number} — Order edited by ${user.name}.${reason.trim() ? ` Reason: ${reason.trim()}` : ''}`, 'order_edited')
    toast('Order updated', 'success')
    await loadOrder()
    setEditMode(false); setSaving(false)
  }

  async function saveAndApprove(reason = '') {
    setSaving(true)
    const validItems = editItems.filter(i => i.item_code.trim() && i.qty)
    if (!editData.customer_name.trim() || !validItems.length) {
      toast('Customer name and at least one item are required.')
      setSaving(false); return
    }
    const { error: hdrErr } = await sb.from('orders').update({
      customer_name: editData.customer_name.trim(), customer_gst: editData.customer_gst.trim(),
      dispatch_address: editData.dispatch_address.trim(), po_number: editData.po_number.trim(),
      order_date: editData.order_date, order_type: editData.order_type, received_via: editData.received_via,
      freight: parseFloat(editData.freight) || 0, credit_terms: editData.credit_terms, notes: editData.notes,
      edited_by: user.name, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (hdrErr) { toast('Failed to update order: ' + hdrErr.message); setSaving(false); return }
    const { error: itemsErr } = await sb.rpc('replace_order_items', {
      p_order_id: id,
      p_items: validItems.map((item, i) => ({
        sr_no: i + 1, item_code: item.item_code.trim(),
        qty: parseFloat(item.qty), lp_unit_price: parseFloat(item.lp_unit_price) || 0,
        discount_pct: parseFloat(item.discount_pct) || 0,
        unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
        total_price: parseFloat(item.total_price) || 0,
        dispatch_date: item.dispatch_date || '',
        customer_ref_no: item.customer_ref_no?.trim() || '',
        description: item.description?.trim() || '',
      }))
    })
    if (itemsErr) { toast('Failed to save items: ' + itemsErr.message); setSaving(false); return }
    const { data: updatedOrder } = await sb.from('orders').select('order_type').eq('id', id).single()
    const { error } = await sb.rpc('approve_order', {
      order_id: id, approver_name: user.name,
      order_type: updatedOrder?.order_type || editData.order_type,
    })
    if (error) { toast('Approval error: ' + error.message); setSaving(false); return }
    await sb.from('orders').update({ status: 'inv_check', updated_at: new Date().toISOString() }).eq('id', id)
    toast('Order saved and approved', 'success')
    await loadOrder()
    setEditMode(false); setSaving(false)
  }

  // ── Log activity as a comment ──
  async function logActivity(message) {
    const { error } = await sb.from('order_comments').insert({
      order_id: id, author_name: user.name, message, tagged_users: [], is_activity: true
    })
    // silently ignore activity log failures
  }

  async function notifyUsers(roles, message, emailType = null) {
    const ownerName = order?.account_owner || order?.engineer_name || ''
    const seen = new Set()
    const targets = []
    // Caller passes the exact operational roles (e.g. a specific FC). Sales and admin are never
    // role-broadcast — they only get notified as account owner, creator, or via @tag below.
    const broadcastRoles = (roles || []).filter(r => r !== 'sales' && r !== 'admin' && r !== 'management')
    if (broadcastRoles.length) {
      profiles.filter(p => broadcastRoles.includes(p.role)).forEach(p => {
        if (!seen.has(p.id)) { seen.add(p.id); targets.push(p) }
      })
    }
    // Always include account owner
    if (ownerName) {
      const ownerProfile = profiles.find(p => p.name === ownerName)
      if (ownerProfile && !seen.has(ownerProfile.id)) { seen.add(ownerProfile.id); targets.push(ownerProfile) }
    }
    // Always include order creator
    if (order?.created_by) {
      const creatorProfile = profiles.find(p => p.id === order.created_by)
      if (creatorProfile && !seen.has(creatorProfile.id)) { seen.add(creatorProfile.id); targets.push(creatorProfile) }
    }
    // Don't notify the person performing the action
    const final = targets.filter(t => t.id !== user.id)
    if (!final.length) return
    await sb.from('notifications').insert(final.map(t => ({
      user_name: t.name, user_id: t.id, message, order_id: id,
      order_number: order?.order_number || '', from_name: user.name,
      email_type: emailType,
    })))
  }

  // ── Stock status update (inventory check stage) ──
  async function updateStockStatus(itemId, status) {
    const prev = stockStatuses[itemId]
    setStockStatuses(s => ({ ...s, [itemId]: status }))
    const { error } = await sb.from('order_items').update({ stock_status: status }).eq('id', itemId)
    if (error) { toast('Failed to update stock status'); setStockStatuses(s => ({ ...s, [itemId]: prev })); return }
    // Log out-of-stock only once per item
    if (status === 'out_of_stock') {
      const { data: existing } = await sb.from('stock_outage_log').select('id').eq('order_item_id', itemId).maybeSingle()
      if (!existing) {
        const item = (order.order_items || []).find(i => i.id === itemId)
        await sb.from('stock_outage_log').insert({
          order_id: id,
          order_item_id: itemId,
          item_code: item?.item_code || '',
          order_number: order?.order_number || '',
          reported_by: user.id,
          reported_by_name: user.name,
        })
      }
    }
  }

  // ── Stage advancement ──
  async function advanceToNext() {
    if (!canAdvance) return
    setSaving(true)
    if (isPending) {
      const { error } = await sb.rpc('approve_order', { order_id: id, approver_name: user.name, order_type: order.order_type })
      if (error) { toast(friendlyError(error)); setSaving(false); return }
      await sb.from('orders').update({ status: 'inv_check', updated_at: new Date().toISOString() }).eq('id', id)
      await logActivity('Order accepted — moved to Order Approved')
      toast('Order approved', 'success')
      await loadOrder(); setSaving(false)
    } else if (order.status === 'inv_check') {
      await sb.from('orders').update({ status: 'inventory_check', updated_at: new Date().toISOString() }).eq('id', id)
      await logActivity('Approval confirmed — moved to Inventory Check')
      toast('Moved to Inventory Check', 'success')
      await loadOrder(); setSaving(false)
    } else if (order.status === 'inventory_check') {
      const allInStock = (order.order_items || []).every(i => stockStatuses[i.id] === 'in_stock')
      if (!allInStock) { toast('All items must be marked "In Stock" before proceeding'); setSaving(false); return }
      await sb.from('orders').update({ status: 'dispatch', updated_at: new Date().toISOString() }).eq('id', id)
      await logActivity('Inventory confirmed — Ready to Ship')
      toast('Ready to Ship', 'success')
      await loadOrder(); setSaving(false)
    } else if (order.status === 'dispatch') {
      setSaving(false)
      setShowDispatchModal(true)
    }
  }

  // ── Full dispatch — set delivery_created (or pi_requested for Against PI / Advance orders) ──
  async function fullyDispatch() {
    setShowDispatchModal(false)
    setDispatchType('full')
    setSaving(true)
    const isPIOrder = order.credit_terms === 'Against PI' || order.credit_terms === 'Advance'
    const rpcCalls = (order.order_items || [])
      .filter(item => item.qty - (item.dispatched_qty || 0) > 0)
      .map(item => sb.rpc('increment_dispatched_qty', { p_item_id: item.id, p_add_qty: item.qty - (item.dispatched_qty || 0) }))
    const rpcResults = await Promise.all(rpcCalls)
    const failed = rpcResults.find(r => r.error)
    if (failed) { toast('Failed to update items: ' + failed.error.message + '. Please refresh and try again.'); setSaving(false); return }
    const { error } = await sb.from('orders').update({
      status: isPIOrder ? 'pi_requested' : 'delivery_created', fulfilment_center: fcCenter, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    const itemsJson = (order.order_items || []).map(i => ({
      order_item_id: i.id, item_code: i.item_code, qty: i.qty,
      unit_price: i.unit_price_after_disc, total_price: i.total_price,
      customer_ref_no: i.customer_ref_no || null,
    }))
    const { data: batchData } = await sb.rpc('create_order_dispatch', {
      p_order_id: id, p_fulfilment_center: fcCenter, p_items: itemsJson,
    })
    if (isPIOrder && batchData?.id) {
      await sb.from('order_dispatches').update({ pi_required: true, status: 'pi_requested' }).eq('id', batchData.id)
    }
    const dcNum = batchData?.dc_number || '—'
    await logActivity(isPIOrder
      ? `Full Dispatch — ${order.credit_terms}. PI required before delivery. DC: ${dcNum}`
      : `Full Dispatch — all items sent via ${fcCenter}. Delivery Created. DC: ${dcNum}`)
    if (!isPIOrder) {
      const fcRole = fcCenter === 'Godawari' ? 'fc_godawari' : 'fc_kaveri'
      await notifyUsers([fcRole], `${order.order_number} — Dispatched to ${fcCenter}. Ready for picking.`, 'order_dispatched')
    }
    toast('Dispatch created', 'success')
    await loadOrder(); setSaving(false)
  }

  // ── Partial dispatch — collect items ──
  function openPartialDispatch() {
    setDispatchType('partial')
    setIsNextBatch(false)
    setShowDispatchModal(false)
    setPartialItems((order.order_items || []).map(item => {
      const remaining = item.qty - (item.dispatched_qty || 0)
      return { id: item.id, item_code: item.item_code, qty: item.qty, dispatched_qty: item.dispatched_qty || 0, dispatchQty: '0', checked: remaining > 0, remaining }
    }))
    setShowPartialModal(true)
  }

  // ── Partial: validate and save ──
  async function confirmPartialItems() {
    const selected = partialItems.filter(i => i.checked && parseFloat(i.dispatchQty) > 0)
    if (!selected.length) { toast('Select at least one item with a dispatch quantity.'); return }
    for (const item of selected) {
      const remaining = item.qty - (item.dispatched_qty || 0)
      if (parseFloat(item.dispatchQty) > remaining) {
        toast(`${item.item_code}: dispatch qty (${item.dispatchQty}) exceeds remaining qty (${remaining}).`)
        return
      }
    }
    setShowPartialModal(false)
    setSaving(true)
    const isPIOrder = order.credit_terms === 'Against PI' || order.credit_terms === 'Advance'
    const partialRpcCalls = selected.map(item => sb.rpc('increment_dispatched_qty', { p_item_id: item.id, p_add_qty: parseFloat(item.dispatchQty) }))
    const partialRpcResults = await Promise.all(partialRpcCalls)
    const partialFailed = partialRpcResults.find(r => r.error)
    if (partialFailed) { toast('Failed to update items: ' + partialFailed.error.message + '. Please refresh and try again.'); setSaving(false); return }
    const summary = selected.map(i => `${i.item_code}: ${i.dispatchQty} units`).join(', ')
    const { error } = await sb.from('orders').update({
      status: isPIOrder ? 'pi_requested' : 'delivery_created', fulfilment_center: fcCenter, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    const itemsJson = selected.map(i => {
      const full = (order.order_items || []).find(o => o.id === i.id) || {}
      return { order_item_id: i.id, item_code: i.item_code, qty: parseFloat(i.dispatchQty), unit_price: full.unit_price_after_disc, total_price: (full.unit_price_after_disc || 0) * parseFloat(i.dispatchQty), customer_ref_no: full.customer_ref_no || null }
    })
    const { data: batchData } = await sb.rpc('create_order_dispatch', {
      p_order_id: id, p_fulfilment_center: fcCenter, p_items: itemsJson,
    })
    if (isPIOrder && batchData?.id) {
      await sb.from('order_dispatches').update({ pi_required: true, status: 'pi_requested' }).eq('id', batchData.id)
    }
    const dcNum = batchData?.dc_number || '—'
    await logActivity(isPIOrder
      ? `Partial Dispatch via ${fcCenter} — ${summary}. ${order.credit_terms} — PI required before delivery. DC: ${dcNum}`
      : `Partial Dispatch via ${fcCenter} — ${summary}. Delivery Created. DC: ${dcNum}`)
    if (!isPIOrder) {
      const fcRole = fcCenter === 'Godawari' ? 'fc_godawari' : 'fc_kaveri'
      await notifyUsers([fcRole], `${order.order_number} — Partial dispatch to ${fcCenter}. Ready for picking.`, 'order_dispatched')
    }
    toast('Partial dispatch created', 'success')
    await loadOrder(); setSaving(false)
  }

  // ── Next Batch (ops can dispatch remaining items while order is in FC flow) ──
  function openNextBatch() {
    setDispatchType('partial')
    setIsNextBatch(true)
    setFcCenter(order.fulfilment_center || 'Kaveri')  // pre-fill with current, allow change
    setPartialItems((order.order_items || []).map(item => {
      const remaining = item.qty - (item.dispatched_qty || 0)
      return { id: item.id, item_code: item.item_code, qty: item.qty, dispatched_qty: item.dispatched_qty || 0, dispatchQty: remaining > 0 ? String(remaining) : '0', checked: remaining > 0, remaining }
    }))
    setShowPartialModal(true)
  }

  // ── Comment / @mention ──
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
    // Extract tagged names — stored as @First_Last (underscores), convert back to spaces
    const tagged = [...text.matchAll(/@([\w.]+)/g)].map(m => m[1].replace(/_/g, ' '))
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message: text, tagged_users: tagged })
    if (tagged.length > 0) {
      const notifRows = tagged.map(tname => {
        const p = profiles.find(pr => pr.name === tname)
        return { user_name: tname, user_id: p?.id || null, message: `${user.name} tagged you in ${order.order_number}`, order_id: id, order_number: order.order_number, from_name: user.name, email_type: 'mention' }
      })
      await sb.from('notifications').insert(notifRows)
    }
    setCommentText(''); setMentionQuery(null)
    await loadComments(); setPostingComment(false)
  }

  function renderMessage(text) {
    return text.split(/(@[\w.]+)/g).map((part, i) =>
      part.startsWith('@')
        ? <span key={i} className="od-mention-tag">@{part.slice(1).replace(/_/g, ' ')}</span>
        : part
    )
  }

  async function cancelOrder() {
    const initiator = cancelInitiatorType === 'staff' ? cancelInitiatorName : (cancelInitiatorFreeText.trim() || 'Customer')
    if (!initiator) { toast('Please select who initiated the cancellation.'); return }
    if (!cancelReason.trim()) { toast('Please enter a reason.'); return }
    setSaving(true)
    const logMsg = `Order cancelled — Initiated by: ${initiator} | Reason: ${cancelReason.trim()}`
    await sb.from('orders').update({ status: 'cancelled', cancelled_reason: cancelReason.trim(), updated_at: new Date().toISOString() }).eq('id', id)
    await sb.from('order_comments').insert({
      order_id: id, author_name: user.name, message: logMsg, tagged_users: [], is_activity: true, is_cancellation: true
    })
    await notifyUsers([], `${order.order_number} — Order cancelled. Reason: ${cancelReason.trim()}`, 'order_cancelled')
    await notifyOpsForLinkedPOs()
    toast('Order cancelled', 'success')
    setShowCancel(false); setCancelReason(''); setCancelInitiatorType('staff'); setCancelInitiatorName(''); setCancelInitiatorFreeText('')
    await loadOrder(); setSaving(false)
  }

  // ── Notify ops/admin about linked POs when a CO is cancelled ──
  async function notifyOpsForLinkedPOs() {
    try {
      const { data: linkedPos } = await sb.from('purchase_orders').select('id,po_number,status').eq('order_id', id)
      if (!linkedPos?.length) return

      const PRE_APPROVAL  = ['draft','pending_approval']
      const POST_APPROVAL = ['approved','placed','acknowledged','delivery_confirmation','partially_received']
      const targets = profiles.filter(p => ['ops','admin','management'].includes(p.role) && p.id !== user.id)
      if (!targets.length) return

      const rows = []
      for (const po of linkedPos) {
        let msg = null
        if (PRE_APPROVAL.includes(po.status)) {
          msg = `${order.order_number} cancelled — cancel draft PO ${po.po_number} (${po.status})`
        } else if (POST_APPROVAL.includes(po.status)) {
          msg = `${order.order_number} cancelled — relink PO ${po.po_number} (${po.status}) to a new CO`
        }
        if (!msg) continue
        for (const t of targets) {
          rows.push({
            user_name: t.name, user_id: t.id, message: msg,
            order_id: po.id,                  // repurposed: stores PO UUID for click-through
            order_number: po.po_number,
            from_name: user.name,
            email_type: 'po_linked_co_cancelled',
          })
        }
      }
      if (rows.length) await sb.from('notifications').insert(rows)
    } catch (e) { console.error('notifyOpsForLinkedPOs:', e) }
  }

  if (loading) return (
    <Layout pageTitle="Order Detail" pageKey="orders">
      <div className="od-page"><div className="loading-state" style={{ paddingTop: 80 }}><div className="loading-spin" /></div></div>
    </Layout>
  )
  if (!order) return <Layout pageTitle="Order Detail" pageKey="orders"><div className="od-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Order not found</div><div style={{fontSize:13}}>This order may have been deleted or you don't have access.</div></div></div></Layout>

  const subtotal       = (order.order_items || []).reduce((s, i) => s + (i.total_price || 0), 0)
  const grandTotal     = subtotal + (order.freight || 0)
  const editSubtotal   = editItems.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)
  const editGrandTotal = editSubtotal + (parseFloat(editData.freight) || 0)
  const mentionSuggestions = mentionQuery !== null
    ? profiles.filter(p =>
        p.name !== user.name && (
          p.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          (p.username || '').toLowerCase().includes(mentionQuery.toLowerCase())
        )
      ).slice(0, 6)
    : []


  return (
    <Layout pageTitle="Order Detail" pageKey="orders">
    <div className="od-page">
      <div className="od-body">

        {/* ── Header ── */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  {order.order_type === 'SO' ? 'Standard Order' : order.order_type === 'CO' ? 'Customised Order' : 'Sample Request'}
                  {order.order_type === 'SAMPLE' && <span style={{marginLeft:8,fontSize:10,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:4,padding:'1px 7px',letterSpacing:'0.5px',verticalAlign:'middle'}}>SAMPLE</span>}
                  <span className={'od-status-badge ' + (isPending ? 'pending' : isCancelled ? 'cancelled' : isInFCFlow && order?.status === 'dispatched_fc' ? 'delivered' : isInFCFlow ? 'delivery' : 'active')}>
                    {isPending ? 'Pending Approval' : isCancelled ? 'Cancelled' : order?.status === 'dispatched_fc' ? 'Delivered' : isInFCFlow ? 'Delivery In Progress' : (hasAnyDispatched && hasAnyPending) ? 'Partially Dispatched' : 'Active'}
                  </span>
                </div>
                <div className="od-header-title">{editMode ? editData.customer_name || order.customer_name : <span onClick={goToCustomer} style={{cursor:'pointer',borderBottom:'1px dotted #1a4dab',color:'inherit'}}>{order.customer_name}</span>}</div>
                <div className="od-header-num">{order.order_number} · {fmt(order.order_date)}</div>
              </div>
            </div>
            <div className="od-header-actions">
              <button className="od-btn" onClick={() => navigate('/orders/list')} style={{gap:6}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
              {isOps && !isCancelled && (
                <>
                  {isEditable && !editMode && user.role !== 'management' && (
                    <button className="od-btn od-btn-edit" onClick={() => setShowEditConfirm(true)}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Edit Order
                    </button>
                  )}
                  {isEditable && editMode && (
                    <>
                      <button className="od-btn" onClick={() => setEditMode(false)} disabled={saving}>Discard</button>
                      <button className="od-btn od-btn-edit" onClick={() => { setEditReason(''); setPendingSaveApprove(false); setShowSaveReason(true) }} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
                      {isPending && (order.order_type !== 'SAMPLE' || ['admin','management'].includes(user.role)) && (
                        <button className="od-btn od-btn-approve" onClick={() => { setEditReason(''); setPendingSaveApprove(true); setShowSaveReason(true) }} disabled={saving}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                          {saving ? 'Approving...' : 'Save & Approve'}
                        </button>
                      )}
                    </>
                  )}
                  {!editMode && user.role === 'admin' && (
                    <button className="od-btn od-btn-danger" onClick={() => setShowCancel(true)}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      Cancel Order
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Pipeline Bar ── */}
        <div className={'od-pipeline-bar' + (isCancelled ? ' od-pipeline-cancelled' : '') + (isInFCFlow ? ' od-pipeline-delivery' : '')}>
          <div className="od-pipeline-stages">
            {ORDER_MODULE_STAGES.map((stage, i) => {
              const isDone   = !isCancelled && (isInFCFlow || pipelineIdx > i)
              const isActive = !isCancelled && !isInFCFlow && effectiveStatus === stage.key
              const isFinal  = !isCancelled && isInFCFlow && stage.key === 'delivery_created'
              return (
                <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive || isFinal ? ' active' : '')}>
                  {stage.label}
                  {isFinal && hasAnyPending && (
                    <span style={{fontSize:9,background:'rgba(255,255,255,0.2)',borderRadius:4,padding:'1px 5px',marginLeft:4,fontWeight:700}}>PARTIAL</span>
                  )}
                </div>
              )
            })}
          </div>
          {isOps && !isCancelled && canAdvance && !editMode && !(order.order_type === 'SAMPLE' && isPending && !['admin','management'].includes(user.role)) && (
            <button className="od-mark-complete-btn" onClick={advanceToNext} disabled={saving || (order.status === 'inventory_check' && !(order.order_items || []).every(i => stockStatuses[i.id] === 'in_stock'))} style={order.status === 'inventory_check' && !(order.order_items || []).every(i => stockStatuses[i.id] === 'in_stock') ? { opacity: 0.5, cursor: 'not-allowed' } : {}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              {saving ? 'Updating...' : actionBtnLabel}
            </button>
          )}
          {order.order_type === 'SAMPLE' && isPending && !['admin','management'].includes(user.role) && (
            <div style={{fontSize:12,color:'#92400e',background:'#fef3c7',border:'1px solid #fde68a',borderRadius:8,padding:'6px 14px',fontWeight:600}}>
              Awaiting admin approval
            </div>
          )}
          {canNextBatch && !editMode && (
            <button className="od-mark-complete-btn" onClick={openNextBatch} disabled={saving}
              style={{ background: '#92400e', marginLeft: 8 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
              {saving ? 'Updating...' : 'Next Batch'}
            </button>
          )}
        </div>

        {/* ── Two-column layout ── */}
        <div className="od-layout">

          {/* ── LEFT ── */}
          <div className="od-main">

            {isPending && !isOps && (
              <div className="od-pending-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                <div>
                  <div className="od-pending-banner-label">Awaiting Ops Approval</div>
                  <div>Submitted as {order.order_number}. Once approved, it will receive an SSC order number.</div>
                </div>
              </div>
            )}

            {isCancelled && (
              <div className="od-cancelled-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <div><div className="od-cancelled-banner-label">Order Cancelled</div><div>{order.cancelled_reason || 'No reason provided.'}</div></div>
              </div>
            )}

            {order.credit_override && order.status !== 'dispatched_fc' && !isCancelled && (
              <div className="od-pending-banner" style={{background:'#fef2f2',border:'1px solid #fca5a5',color:'#991b1b'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <div>
                  <div className="od-pending-banner-label">⚠️ Credit Override — Take Approval Required</div>
                  <div>Payment was pending when credit check was done. Approval needed.</div>
                </div>
              </div>
            )}

            {['pi_requested','pi_generated','pi_payment_pending'].includes(order.status) && (
              <div className="od-pending-banner" style={{background:'#faf5ff',border:'1px solid #e9d5ff',color:'#7e22ce'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <div>
                  <div className="od-pending-banner-label">With Accounts — Proforma Invoice</div>
                  <div>
                    {order.status === 'pi_requested' && 'Awaiting Proforma Invoice to be issued by accounts.'}
                    {order.status === 'pi_generated' && 'PI issued — awaiting customer payment.'}
                    {order.status === 'pi_payment_pending' && 'Payment pending confirmation by accounts.'}
                  </div>
                </div>
              </div>
            )}

            {isInFCFlow && order.status !== 'dispatched_fc' && (
              <div className="od-delivery-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                <div>
                  <div className="od-pending-banner-label">Delivery In Progress{order.fulfilment_center ? ` — ${order.fulfilment_center}` : ''}</div>
                  <div>
                    {hasAnyPending ? `${(order.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)} units pending next batch. ` : ''}
                    Currently: {{'delivery_created':'Delivery Created','goods_issued':'Goods Issued','pending_billing':'Pending Billing','credit_check':'Credit Check','goods_issue_posted':'Goods Issue Posted','invoice_generated':'Invoice Generated','delivery_ready':'Delivery Ready','eway_pending':'Ready for E-Way Bill','eway_generated':'E-Way Bill Generated'}[order.status] || order.status}
                  </div>
                </div>
              </div>
            )}

            {order.status === 'dispatched_fc' && (
              <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div>
                  <div className="od-pending-banner-label">Delivered{order.fulfilment_center ? ` · ${order.fulfilment_center}` : ''}</div>
                  <div>Order fully delivered and complete.</div>
                </div>
              </div>
            )}

            {/* Order Info */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Order Information</div></div>
              <div className="od-card-body">
                {editMode ? (
                  <div className="od-edit-form">
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Customer Name</label>
                        <input value={editData.customer_name} readOnly style={{background:'var(--gray-50)',color:'var(--gray-500)',cursor:'not-allowed'}} />
                      </div>
                      <div className="od-edit-field">
                        <label>GST Number</label>
                        <input value={editData.customer_gst} readOnly style={{background:'var(--gray-50)',color:'var(--gray-500)',cursor:'not-allowed'}} />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Order Type</label>
                        <select value={editData.order_type} onChange={e => setEditData(p => ({ ...p, order_type: e.target.value }))}>
                          <option value="SO">Standard Order (SO)</option>
                          <option value="CO">Customised Order (CO)</option>
                          <option value="SAMPLE">Sample Request (SR)</option>
                        </select>
                      </div>
                      <div className="od-edit-field">
                        <label>Received Via</label>
                        <select value={editData.received_via} onChange={e => setEditData(p => ({ ...p, received_via: e.target.value }))}>
                          <option>Mobile</option><option>WhatsApp</option><option>Email</option><option>Visit</option><option>Phone</option>
                        </select>
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>PO / Reference Number {editData.order_type === 'SAMPLE' && <span style={{color:'var(--gray-400)',fontWeight:400,fontSize:11}}>(optional)</span>}</label>
                        <input value={editData.po_number} onChange={e => setEditData(p => ({ ...p, po_number: e.target.value }))} />
                      </div>
                      <div className="od-edit-field">
                        <label>Order Date</label>
                        <input type="date" value={editData.order_date} onChange={e => setEditData(p => ({ ...p, order_date: e.target.value }))} />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Credit Terms</label>
                        <input value={editData.credit_terms || '—'} readOnly style={{background:'var(--gray-50)',color:'var(--gray-500)',cursor:'not-allowed'}} />
                      </div>
                      <div className="od-edit-field">
                        <label>Freight (₹)</label>
                        <input type="number" value={editData.freight} onChange={e => setEditData(p => ({ ...p, freight: e.target.value }))} min="0" />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Dispatch Address</label>
                        <textarea value={editData.dispatch_address} onChange={e => setEditData(p => ({ ...p, dispatch_address: e.target.value }))} rows={2} />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field" style={{ gridColumn: '1 / -1' }}>
                        <label>Notes</label>
                        <input value={editData.notes} onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))} placeholder="Notes for ops / sales team..." />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>Customer Name</label><div className="val"><span onClick={goToCustomer} style={{color:'#1a4dab',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted'}}>{order.customer_name}</span></div></div>
                    <div className="od-detail-field"><label>Customer ID</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{custCode || '—'}</div></div>
                    <div className="od-detail-field"><label>GST Number</label><div className="val" style={{fontFamily:'var(--mono)'}}>{order.customer_gst || '—'}</div></div>
                    <div className="od-detail-field"><label>Account Owner</label><div className="val"><OwnerChip name={order.account_owner || order.engineer_name} /></div></div>
                    <div className="od-detail-field"><label>Credit Terms</label><div className="val">{order.credit_terms || '—'}</div></div>
                    <div className="od-detail-field">
                      <label>PO / Reference {order.order_type === 'SAMPLE' && <span style={{color:'var(--gray-400)',fontWeight:400,fontSize:11}}>(optional)</span>}</label>
                      <div className="val">
                        {order.po_number || '—'}
                        {order.po_document_url && (
                          <a href={order.po_document_url} target="_blank" rel="noreferrer"
                            style={{marginLeft:10,fontSize:11,color:'#1a4dab',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,textDecoration:'none'}}>
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            View PO
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="od-detail-field"><label>Order Type</label><div className="val">{order.order_type === 'SO' ? 'Standard Order' : order.order_type === 'CO' ? 'Customised Order' : 'Sample Request'}</div></div>
                    <div className="od-detail-field"><label>Order Date</label><div className="val">{fmt(order.order_date)}</div></div>
                    <div className="od-detail-field"><label>Received Via</label><div className="val">{order.received_via || '—'}</div></div>
                    <div className="od-detail-field"><label>Fulfilment Centre</label><div className="val">{order.fulfilment_center || '—'}</div></div>
                    <div className="od-detail-field"><label>Freight</label><div className="val">₹{(order.freight || 0).toLocaleString('en-IN')}</div></div>
                    {order.notes && <div className="od-detail-field" style={{ gridColumn: '1/-1' }}><label>Notes</label><div className="val od-notes-val">{order.notes}</div></div>}
                    {order.low_value_reason && (
                      <div className="od-detail-field" style={{ gridColumn: '1/-1' }}>
                        <label style={{color:'#dc2626'}}>Low Value Reason <span style={{fontSize:10,fontWeight:400,color:'var(--gray-400)'}}>(order &lt; ₹8,000)</span></label>
                        <div className="val" style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:'8px 12px',fontSize:13,color:'#991b1b',lineHeight:1.5}}>{order.low_value_reason}</div>
                      </div>
                    )}
                  </div>
                  {order.dispatch_address && (
                    <div className="od-detail-field" style={{marginTop:12}}>
                      <label>Delivery / Dispatch Address</label>
                      <div className="val">{order.dispatch_address}</div>
                    </div>
                  )}
                  </>
                )}
              </div>
            </div>

            {/* Linked PO for CO orders */}
            {order.order_type === 'CO' && (
              <div className="od-card" style={{marginTop:16}}>
                <div className="od-card-header">
                  <div className="od-card-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:16,height:16,marginRight:6,verticalAlign:'middle'}}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                    Purchase Orders {linkedPOs.length > 0 && <span style={{fontSize:11,fontWeight:600,color:'var(--gray-400)',marginLeft:6}}>({linkedPOs.length})</span>}
                  </div>
                  {isOps && linkedPOs.length > 0 && (
                    <button className="od-btn" style={{fontSize:12,padding:'4px 10px'}} onClick={() => navigate('/procurement/po/new?order_id=' + id)}>+ Add PO</button>
                  )}
                </div>
                <div className="od-card-body">
                  {linkedPOs.length > 0 ? (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {linkedPOs.map(po => {
                        const label = po.status === 'draft' ? 'Draft' : po.status === 'pending_approval' ? 'Pending Approval' : po.status === 'approved' ? 'Approved' : po.status === 'placed' ? 'Placed' : po.status === 'acknowledged' ? 'Acknowledged' : po.status === 'delivery_confirmation' ? 'Delivery Confirmed' : po.status === 'partially_received' ? 'Partial GRN' : po.status === 'material_received' ? 'Material Received' : po.status === 'received' ? 'Received' : po.status === 'closed' ? 'Closed' : po.status === 'cancelled' ? 'Cancelled' : po.status
                        const pillCls = ['material_received','received','closed'].includes(po.status) ? 'dispatched_fc' : po.status === 'cancelled' ? 'cancelled' : 'goods_issued'
                        return (
                          <div key={po.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12,padding:'10px 12px',border:'1px solid var(--gray-100)',borderRadius:8,background:'white'}}>
                            <div style={{flex:1,minWidth:180}}>
                              <div style={{fontFamily:'var(--mono)',fontWeight:700,fontSize:13,color:'#1a4dab',cursor:'pointer'}} onClick={() => navigate('/procurement/po/' + po.id)}>
                                {po.po_number}
                              </div>
                              <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>
                                {po.vendor_name || '—'}
                                {po.total_amount ? <span style={{marginLeft:8,color:'var(--gray-400)'}}>· ₹{Number(po.total_amount).toLocaleString('en-IN',{maximumFractionDigits:0})}</span> : ''}
                              </div>
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <span className={'pill pill-' + pillCls} style={{fontSize:11}}>{label}</span>
                              <button className="od-btn" style={{fontSize:11,padding:'4px 10px'}} onClick={() => navigate('/procurement/po/' + po.id)}>View</button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
                      <div style={{fontSize:13,color:'#b45309'}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14,verticalAlign:'middle',marginRight:4}}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        No Purchase Order created yet
                      </div>
                      {isOps && <button className="od-btn" style={{fontSize:12,padding:'4px 10px'}} onClick={() => navigate('/procurement/po/new?order_id=' + id)}>Create PO</button>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Products */}
            <div className="od-card">
              <div className="od-card-header">
                <div className="od-card-title">
                  Products ({editMode ? editItems.filter(i=>i.item_code).length : (order.order_items||[]).length})
                  {!editMode && hasAnyPending && hasAnyDispatched && (
                    <span style={{marginLeft:10,fontSize:11,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'2px 8px',fontWeight:600}}>
                      Partially Dispatched
                    </span>
                  )}
                </div>
              </div>
              {editMode ? (
                <div className="od-edit-items-wrap">
                  <div className="no-items-table-wrap" style={{ margin: '0', borderRadius: 0, border: 'none', borderBottom: '1px solid var(--gray-100)' }}>
                    <table className="no-items-table">
                      <thead>
                        <tr>
                          <th className="col-sr">#</th><th className="col-code">Item Code</th><th className="col-qty">Qty</th>
                          <th className="col-lp">LP Price</th><th className="col-disc">Disc %</th>
                          <th className="col-unit">Unit Price</th><th className="col-total">Total</th>
                          <th className="col-date">Delivery Date</th><th className="col-ref">Cust. Ref No</th><th className="col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {editItems.map((item, idx) => (
                          <>
                          <tr key={idx} className={item.item_code ? 'row-filled' : ''} style={{ borderBottom: item.item_code ? 'none' : undefined }}>
                            <td className="col-sr">{idx + 1}</td>
                            <td className="col-code">
                              <Typeahead value={item.item_code} onChange={v => updateEditItem(idx, 'item_code', v)}
                                onSelect={it => updateEditItem(idx, 'item_code', it.item_code)} placeholder="Search..."
                                fetchFn={fetchItems} strictSelect renderItem={it => <div className="typeahead-item-main" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{it.item_code}</div>} />
                            </td>
                            <td className="col-qty"><input type="number" value={item.qty} onChange={e => updateEditItem(idx, 'qty', e.target.value)} placeholder="0" /></td>
                            <td className="col-lp"><input type="number" value={item.lp_unit_price} onChange={e => updateEditItem(idx, 'lp_unit_price', e.target.value)} placeholder="0.00" step="0.01" /></td>
                            <td className="col-disc"><input type="number" value={item.discount_pct} onChange={e => updateEditItem(idx, 'discount_pct', e.target.value)} placeholder="0" /></td>
                            <td className="col-unit"><input readOnly value={item.unit_price_after_disc} placeholder="—" className="calc-field" /></td>
                            <td className="col-total"><input readOnly value={item.total_price} placeholder="—" className="calc-field total-field" /></td>
                            <td className="col-date"><input type="date" value={item.dispatch_date} onChange={e => updateEditItem(idx, 'dispatch_date', e.target.value)} /></td>
                            <td className="col-ref"><input value={item.customer_ref_no || ''} onChange={e => updateEditItem(idx, 'customer_ref_no', e.target.value)} placeholder="Optional" /></td>
                            <td className="col-del">{editItems.length > 1 && (
                              <button className="del-row-btn" onClick={() => setEditItems(p => p.filter((_,i) => i !== idx))}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                              </button>
                            )}</td>
                          </tr>
                          {item.item_code && (
                            <tr key={`desc-${idx}`} style={{ borderTop: 'none' }}>
                              <td></td>
                              <td colSpan={9} style={{ paddingTop: 2, paddingBottom: 8 }}>
                                <input
                                  value={item.description || ''}
                                  onChange={e => updateEditItem(idx, 'description', e.target.value)}
                                  placeholder="Description (optional)"
                                  style={{ width: '100%', fontSize: 11, color: 'var(--gray-500)', fontStyle: item.description ? 'normal' : 'italic' }}
                                />
                              </td>
                            </tr>
                          )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--gray-100)' }}>
                    <button className="no-add-row-btn" onClick={() => setEditItems(p => [...p, emptyItem()])} style={{ marginTop: 0 }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Add Row
                    </button>
                  </div>
                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row"><span>Subtotal</span><span>₹{editSubtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row"><span>Freight</span><span>₹{(parseFloat(editData.freight)||0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{editGrandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </div>
              ) : showDispatchCols ? (
                // ── DUAL TILE VIEW: separate pending and dispatched ──
                <>
                  {/* Tile 1: Pending items */}
                  {(hasAnyPending || !batches.some(b => b.status === 'dispatched_fc')) && (
                    <div className="od-dispatch-tile od-dispatch-tile-pending">
                      <div className="od-dispatch-tile-header">
                        <span className="od-dispatch-tile-label">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                          {hasAnyPending ? 'Pending Items' : 'In Transit'}
                        </span>
                        <span className="od-dispatch-tile-count">
                          {hasAnyPending
                            ? `${(order.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)} units pending`
                            : `${(order.order_items || []).reduce((s, i) => s + (i.dispatched_qty || 0), 0)} units in transit`
                          }
                        </span>
                      </div>
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 16 }}>#</th>
                            <th>Item Code</th>
                            <th>Delivery Date</th>
                            <th>Dispatched On</th>
                            <th style={{ textAlign: 'center' }}>Total Qty</th>
                            <th style={{ textAlign: 'center' }}>Dispatched</th>
                            <th style={{ textAlign: 'center', color: '#92400e' }}>Pending</th>
                            <th>Unit Price</th>
                            <th className="right" style={{ paddingRight: 16 }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.order_items || []).filter(item => {
                            const deliveredQty = batches.filter(b => b.status === 'dispatched_fc').reduce((s, b) => { const di = (b.dispatched_items || []).find(i => i.order_item_id === item.id); return s + (di?.qty || 0) }, 0)
                            return item.qty > deliveredQty
                          }).map(item => {
                            const dispQty    = item.dispatched_qty || 0
                            const pendingQty = item.qty - dispQty
                            const itemBatch  = batches.find(b => b.status === 'dispatched_fc' && (b.dispatched_items || []).some(di => di.order_item_id === item.id))
                            return (
                              <tr key={item.id}>
                                <td style={{ paddingLeft: 16, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                                <td className="mono"><span onClick={() => goToItem(item.item_code)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{item.item_code}</span>{item.description && <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'var(--font)', fontWeight: 400, marginTop: 2 }}>{item.description}</div>}</td>
                                <td style={{ fontSize: 12 }}>{item.dispatch_date ? fmt(item.dispatch_date) : '—'}</td>
                                <td style={{ fontSize: 12, color: itemBatch?.delivered_at ? '#166534' : 'var(--gray-400)', fontWeight: itemBatch?.delivered_at ? 600 : 400 }}>{itemBatch?.delivered_at ? fmt(itemBatch.delivered_at) : '—'}</td>
                                <td style={{ textAlign: 'center' }}>{item.qty}</td>
                                <td style={{ textAlign: 'center', color: dispQty > 0 ? '#166534' : 'var(--gray-400)', fontWeight: 600 }}>{dispQty || '—'}</td>
                                <td style={{ textAlign: 'center', fontWeight: 700, color: '#c2410c' }}>{pendingQty}</td>
                                <td>₹{item.unit_price_after_disc}</td>
                                <td className="right" style={{ paddingRight: 16 }}>₹{((item.unit_price_after_disc || 0) * pendingQty).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Tile 2: Dispatched record */}
                  {batches.some(b => b.status === 'dispatched_fc') && (
                    <div className="od-dispatch-tile od-dispatch-tile-dispatched">
                      <div className="od-dispatch-tile-header">
                        <span className="od-dispatch-tile-label">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><polyline points="20 6 9 17 4 12"/></svg>
                          Shipped
                        </span>
                        <span className="od-dispatch-tile-count" style={{ background: '#d1fae5', color: '#065f46' }}>
                          {batches.filter(b => b.status === 'dispatched_fc').reduce((s, b) => s + (b.dispatched_items || []).reduce((bs, i) => bs + (i.qty || 0), 0), 0)} units shipped
                        </span>
                      </div>
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 16 }}>#</th>
                            <th>Item Code</th>
                            <th>Delivery Date</th>
                            <th>Dispatched On</th>
                            <th style={{ textAlign: 'center' }}>Total Qty</th>
                            <th style={{ textAlign: 'center', color: '#166534' }}>Dispatched</th>
                            <th style={{ textAlign: 'center' }}>Pending</th>
                            <th>Unit Price</th>
                            <th className="right" style={{ paddingRight: 16 }}>Dispatched Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.order_items || []).filter(item => batches.some(b => b.status === 'dispatched_fc' && (b.dispatched_items || []).some(di => di.order_item_id === item.id))).map(item => {
                            const dispQty    = batches.filter(b => b.status === 'dispatched_fc').reduce((s, b) => { const di = (b.dispatched_items || []).find(i => i.order_item_id === item.id); return s + (di?.qty || 0) }, 0)
                            const pendingQty = item.qty - dispQty
                            const itemBatch  = batches.find(b => b.status === 'dispatched_fc' && (b.dispatched_items || []).some(di => di.order_item_id === item.id))
                            return (
                              <tr key={item.id} style={{ background: pendingQty === 0 ? '#f0fdf4' : undefined }}>
                                <td style={{ paddingLeft: 16, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                                <td className="mono"><span onClick={() => goToItem(item.item_code)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{item.item_code}</span>{item.description && <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'var(--font)', fontWeight: 400, marginTop: 2 }}>{item.description}</div>}</td>
                                <td style={{ fontSize: 12 }}>{item.dispatch_date ? fmt(item.dispatch_date) : '—'}</td>
                                <td style={{ fontSize: 12, color: itemBatch?.delivered_at ? '#166534' : 'var(--gray-400)', fontWeight: itemBatch?.delivered_at ? 600 : 400 }}>{itemBatch?.delivered_at ? fmt(itemBatch.delivered_at) : '—'}</td>
                                <td style={{ textAlign: 'center' }}>{item.qty}</td>
                                <td style={{ textAlign: 'center', fontWeight: 700, color: '#166534' }}>{dispQty}</td>
                                <td style={{ textAlign: 'center', color: pendingQty > 0 ? '#c2410c' : '#166534', fontWeight: 600 }}>
                                  {pendingQty === 0 ? <span style={{ fontSize: 11 }}>✓ Done</span> : pendingQty}
                                </td>
                                <td>₹{item.unit_price_after_disc}</td>
                                <td className="right" style={{ paddingRight: 16 }}>₹{((item.unit_price_after_disc || 0) * dispQty).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Dispatch batch history */}
                  {(() => {
                    const dispatchLogs = comments.filter(c => c.is_activity && (c.message.includes('Dispatch') || c.message.includes('dispatch')))
                    if (!dispatchLogs.length) return null
                    return (
                      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-100)' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10 }}>Dispatch History</div>
                        {dispatchLogs.map((c, i) => (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                            <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#d1fae5', color: '#065f46', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                            <div>
                              <div style={{ fontSize: 12, color: 'var(--gray-900)', fontWeight: 500, lineHeight: 1.4 }}>{c.message}</div>
                              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2 }}>{fmtTs(c.created_at)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}

                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row"><span>Order Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row"><span>Dispatched Value</span><span style={{ color: '#166534', fontWeight: 700 }}>₹{(order.order_items || []).reduce((s, i) => s + (i.unit_price_after_disc || 0) * (i.dispatched_qty || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row"><span>Freight</span><span>₹{(order.freight||0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </>
              ) : (
                // ── STANDARD VIEW (no dispatch yet) ──
                <>
                  <div style={{ overflowX: 'auto' }}>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 20 }}>#</th>
                        <th>Item Code</th>
                        <th>Qty</th>
                        {order.status !== 'inventory_check' && <><th>LP Price</th><th>Disc %</th></>}
                        <th>Unit Price</th>
                        <th>Delivery Date</th>
                        {order.status !== 'inventory_check' && <th>Dispatched On</th>}
                        <th>Cust. Ref No</th>
                        {order.status === 'inventory_check' && <th style={{ textAlign: 'center' }}>Stock</th>}
                        {order.status !== 'inventory_check' && (order.order_items || []).some(i => i.stock_status) && <th style={{ textAlign: 'center' }}>Stock</th>}
                        <th className="right" style={{ paddingRight: 20 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.order_items || []).map(item => {
                        const itemBatch = batches.find(b => (b.dispatched_items || []).some(di => di.order_item_id === item.id))
                        return (
                        <tr key={item.id}>
                          <td style={{ paddingLeft: 20, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                          <td className="mono"><span onClick={() => goToItem(item.item_code)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{item.item_code}</span>{item.description && <div style={{ fontSize: 11, color: 'var(--gray-400)', fontFamily: 'var(--font)', fontWeight: 400, marginTop: 2 }}>{item.description}</div>}</td>
                          <td>{item.qty}</td>
                          {order.status !== 'inventory_check' && <><td>{item.lp_unit_price ? '₹' + item.lp_unit_price : '—'}</td>
                          <td>{item.discount_pct ? item.discount_pct + '%' : '—'}</td></>}
                          <td>₹{item.unit_price_after_disc}</td>
                          <td>{item.dispatch_date ? fmt(item.dispatch_date) : '—'}</td>
                          {order.status !== 'inventory_check' && <td style={{color: itemBatch?.delivered_at ? '#166534' : 'var(--gray-400)', fontWeight: itemBatch?.delivered_at ? 600 : 400, fontSize:12}}>{itemBatch?.delivered_at ? fmt(itemBatch.delivered_at) : '—'}</td>}
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.customer_ref_no || '—'}</td>
                          {order.status === 'inventory_check' && (
                            <td style={{ textAlign: 'center' }}>
                              <select
                                value={stockStatuses[item.id] || ''}
                                onChange={e => updateStockStatus(item.id, e.target.value)}
                                style={{
                                  padding: '3px 6px', fontSize: 11, borderRadius: 6,
                                  border: '1px solid var(--gray-200)', cursor: 'pointer',
                                  background: stockStatuses[item.id] === 'in_stock' ? '#dcfce7' : stockStatuses[item.id] === 'out_of_stock' ? '#fee2e2' : '#fff',
                                  color: stockStatuses[item.id] === 'in_stock' ? '#166534' : stockStatuses[item.id] === 'out_of_stock' ? '#991b1b' : '#374151',
                                  fontWeight: 600,
                                }}
                              >
                                <option value="">Select</option>
                                <option value="in_stock">In Stock</option>
                                <option value="out_of_stock">Out of Stock</option>
                              </select>
                            </td>
                          )}
                          {order.status !== 'inventory_check' && (order.order_items || []).some(i => i.stock_status) && (
                            <td style={{ textAlign: 'center' }}>
                              {item.stock_status === 'in_stock' && <span style={{ fontSize: 11, fontWeight: 600, color: '#166534', background: '#dcfce7', padding: '2px 8px', borderRadius: 20 }}>In Stock</span>}
                              {item.stock_status === 'out_of_stock' && <span style={{ fontSize: 11, fontWeight: 600, color: '#991b1b', background: '#fee2e2', padding: '2px 8px', borderRadius: 20 }}>Out of Stock</span>}
                              {!item.stock_status && <span style={{ color: 'var(--gray-300)', fontSize: 11 }}>—</span>}
                            </td>
                          )}
                          <td className="right" style={{ paddingRight: 20 }}>₹{(item.total_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row"><span>Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row"><span>Freight</span><span>₹{(order.freight||0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </>
              )}
            </div>

          </div>

          {/* ── RIGHT ── */}
          <div className="od-sidebar">

            {/* Dispatch Batches */}
            {batches.length > 0 && (
              <div className="od-side-card" style={{padding:0,overflow:'hidden'}}>
                <div className="od-side-card-title" style={{padding:'14px 16px 0'}}>Dispatch Batches</div>
                <div className="od-batch-list">
                  {batches.map((b, idx) => {
                    const bDone = b.status === 'dispatched_fc'
                    const bDC   = b.dc_number || '—'
                    const bINV  = b.invoice_number || null
                    const batchLabel = b.pi_required && !b.status
                      ? (b.pi_number ? 'PI Issued' : 'PI Pending')
                      : ({ delivery_created:'Picking', picking:'Packing', packing:'Goods Issue', goods_issued:'With Billing', credit_check:'With Billing', goods_issue_posted:'With Billing', invoice_generated:'Delivery Ready', delivery_ready:'E-Way Pending', eway_generated:'E-Way Done', dispatched_fc:'Delivered' }[b.status] || b.status)
                    const hasDC = bDC !== '—' && !bDC.startsWith('Temp/')
                    const primaryRef = hasDC ? bDC : bINV || (bDC !== '—' ? bDC : null)
                    const pdfs = [
                      hasDC && { label: 'DC', icon: 'print', color: '#166534', action: () => printDCChallan(order, b, bDC, order.order_type === 'SAMPLE', custCode), isBtn: true },
                      b.pi_pdf_url && { label: 'PI', icon: 'doc', color: '#7e22ce', href: b.pi_pdf_url },
                      b.invoice_pdf_url && { label: 'Invoice', icon: 'doc', color: '#1a4dab', href: b.invoice_pdf_url },
                      b.eway_pdf_url && { label: 'E-Way', icon: 'doc', color: '#0e7490', href: b.eway_pdf_url },
                      b.einvoice_pdf_url && { label: 'E-Inv', icon: 'doc', color: '#b45309', href: b.einvoice_pdf_url },
                    ].filter(Boolean)
                    const bItemIds = (b.dispatched_items || []).map(i => i.order_item_id).filter(Boolean)
                    const planDates = bItemIds.length > 0
                      ? [...new Set((order.order_items || []).filter(i => bItemIds.includes(i.id) && i.dispatch_date).map(i => i.dispatch_date))].sort()
                      : [...new Set((order.order_items || []).filter(i => i.dispatch_date).map(i => i.dispatch_date))].sort()

                    return (
                      <div key={b.id} className={'od-batch-card' + (bDone ? ' od-batch-done' : '')}>
                        {/* Header: label + status */}
                        <div className="od-batch-top">
                          <span className="od-batch-label">Batch {b.batch_no}{b.fulfilment_center ? ` · ${b.fulfilment_center}` : ''}</span>
                          <span className={'od-batch-pill' + (bDone ? ' done' : '')}>{batchLabel}</span>
                        </div>

                        {/* Big primary number */}
                        {primaryRef && (
                          <div className="od-batch-primary"
                            style={{cursor: hasDC ? 'pointer' : bINV ? 'pointer' : 'default'}}
                            onClick={() => {
                              if (hasDC) navigate('/fc/' + order.id, { state: { dispatch_id: b.id } })
                              else if (bINV) navigate('/billing/' + order.id, { state: { dispatch_id: b.id } })
                            }}>
                            {primaryRef}
                          </div>
                        )}

                        {/* Secondary refs inline */}
                        {(bINV && hasDC || b.pi_number || b.eway_bill_number) && (
                          <div className="od-batch-secondary">
                            {bINV && hasDC && <span onClick={() => navigate('/billing/' + order.id, { state: { dispatch_id: b.id } })} style={{cursor:'pointer'}}>{bINV}</span>}
                            {b.pi_number && <span>PI: {b.pi_number}</span>}
                            {b.eway_bill_number && <span>E-Way: {b.eway_bill_number}</span>}
                          </div>
                        )}

                        {/* Dates */}
                        {(planDates.length > 0 || b.delivered_at) && (
                          <div className="od-batch-dates">
                            {planDates.length > 0 && (
                              <span>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                                {planDates.map(d => fmt(d)).join(' – ')}
                              </span>
                            )}
                            {b.delivered_at && (
                              <span className="od-batch-delivered">
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></svg>
                                {fmt(b.delivered_at)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Action buttons row */}
                        {pdfs.length > 0 && (
                          <div className="od-batch-btns">
                            {pdfs.map((p, i) => p.isBtn ? (
                              <button key={i} className="od-batch-btn primary" onClick={p.action}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="13" height="13"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                                {p.label}
                              </button>
                            ) : (
                              <a key={i} className="od-batch-btn" href={p.href} target="_blank" rel="noreferrer">
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" width="13" height="13"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                {p.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Activity + Comments — Vertical Timeline */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">

                {/* Order created */}
                <div className="od-tl-item">
                  <div className="od-tl-dot created">
                    <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                  </div>
                  <div className="od-tl-content">
                    <div className="od-tl-header">
                      <div className="od-tl-title">Order created</div>
                      <div className="od-tl-time">{fmtTs(order.created_at)}</div>
                    </div>
                    <div className="od-tl-sub">{order.submitted_by_name || order.engineer_name || '—'}</div>
                  </div>
                </div>

                {/* Edited */}
                {order.edited_by && (
                  <div className="od-tl-item">
                    <div className="od-tl-dot edited">
                      <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </div>
                    <div className="od-tl-content">
                      <div className="od-tl-header">
                        <div className="od-tl-title">Order edited</div>
                        <div className="od-tl-time">{fmtTs(order.updated_at)}</div>
                      </div>
                      <div className="od-tl-sub">{order.edited_by}</div>
                    </div>
                  </div>
                )}

                {/* Approved */}
                {order.approved_by && (
                  <div className="od-tl-item">
                    <div className="od-tl-dot approved">
                      <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div className="od-tl-content">
                      <div className="od-tl-header">
                        <div className="od-tl-title">Approved</div>
                      </div>
                      <div className="od-tl-sub">{order.approved_by}</div>
                    </div>
                  </div>
                )}

                {/* Cancelled */}
                {isCancelled && (
                  <div className="od-tl-item od-tl-cancel">
                    <div className="od-tl-dot cancel">
                      <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </div>
                    <div className="od-tl-content">
                      <div className="od-tl-title">Order cancelled</div>
                      <div className="od-tl-sub">{order.cancelled_reason}</div>
                    </div>
                  </div>
                )}

                {/* Comments + system logs */}
                {comments.map(c => {
                  const isSystem = c.is_activity === true
                  const isCancelLog = c.is_cancellation === true || (c.message.includes('cancelled') || c.message.includes('Cancelled'))
                  const dotType = isCancelLog ? 'cancel'
                    : c.message.includes('Dispatch') || c.message.includes('dispatch') ? 'dispatch'
                    : c.message.includes('Invoice') || c.message.includes('invoice') ? 'invoice'
                    : c.message.includes('Delivered') || c.message.includes('delivered') ? 'success'
                    : isSystem ? 'system' : 'comment'

                  const dotIcon = {
                    cancel:   <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
                    dispatch: <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
                    invoice:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
                    success:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
                    system:   <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
                    comment:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
                  }[dotType]

                  return isSystem ? (
                    <div key={c.id} className={'od-tl-item' + (isCancelLog ? ' od-tl-cancel' : '')}>
                      <div className={'od-tl-dot ' + dotType}>{dotIcon}</div>
                      <div className="od-tl-content">
                        <div className="od-tl-header">
                          <div className="od-tl-title">{c.message}</div>
                          <div className="od-tl-time">{fmtTs(c.created_at)}</div>
                        </div>
                        <div className="od-tl-sub">{c.author_name}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="od-tl-item od-tl-comment">
                      <div className="od-tl-dot comment">{dotIcon}</div>
                      <div className="od-tl-content">
                        <div className="od-tl-header">
                          <div className="od-tl-comment-author">
                            {c.author_name}
                            {c.tagged_users?.length > 0 && (
                              <span className="od-tl-comment-tagged">
                                tagged {c.tagged_users.map(u => '@' + u).join(', ')}
                              </span>
                            )}
                          </div>
                          <div className="od-tl-time">{fmtTs(c.created_at)}</div>
                        </div>
                        <div className="od-tl-comment-text">{renderMessage(c.message)}</div>
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
                    <div className="od-mention-dropdown" style={{ top: mentionPos.top, left: mentionPos.left, width: mentionPos.width }}>
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

          </div>
        </div>
      </div>

      {/* ── Cancel Modal ── */}
      {/* ── Edit Confirmation Modal ── */}
      {showEditConfirm && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowEditConfirm(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 420 }}>
            <div className="od-cancel-title">Edit Order?</div>
            <div className="od-cancel-sub">Are you sure you want to edit this order? Changes will update the order details.</div>
            <div className="od-cancel-actions" style={{ marginTop: 20 }}>
              <button className="od-btn" onClick={() => setShowEditConfirm(false)}>No, Go Back</button>
              <button className="od-btn od-btn-edit" onClick={() => { setShowEditConfirm(false); enterEditMode() }}>Yes, Edit Order</button>
            </div>
          </div>
        </div>
      )}

      {showSaveReason && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowSaveReason(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 440 }}>
            <div className="od-cancel-title">Reason for Edit</div>
            <div className="od-cancel-sub">Why is this order being edited? This will be logged in the activity feed.</div>
            <textarea className="od-cancel-textarea" value={editReason} onChange={e => setEditReason(e.target.value)}
              placeholder="e.g. Customer changed quantity, wrong product code entered…" autoFocus />
            <div className="od-cancel-actions">
              <button className="od-btn" onClick={() => setShowSaveReason(false)}>Cancel</button>
              <button className="od-btn od-btn-edit" disabled={!editReason.trim()}
                onClick={() => {
                  setShowSaveReason(false)
                  if (pendingSaveApprove) saveAndApprove(editReason)
                  else saveEdits(editReason)
                }}>
                {pendingSaveApprove ? 'Save & Approve' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCancel && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCancel(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 480 }}>
            <div className="od-cancel-title" style={{ color: '#dc2626' }}>Cancel Order</div>
            <div className="od-cancel-sub">This will move the order to Cancelled. All delivery information will be preserved. Only admins can perform this action.</div>

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', marginBottom: 8 }}>Who initiated the cancellation?</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {['staff', 'customer'].map(type => (
                  <button key={type} onClick={() => { setCancelInitiatorType(type); setCancelInitiatorName(''); setCancelInitiatorFreeText('') }}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid ' + (cancelInitiatorType === type ? '#dc2626' : 'var(--gray-200)'), background: cancelInitiatorType === type ? '#fff1f2' : 'white', color: cancelInitiatorType === type ? '#dc2626' : 'var(--gray-700)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {type === 'staff' ? 'Staff Member' : 'Customer'}
                  </button>
                ))}
              </div>
              {cancelInitiatorType === 'staff' ? (
                <select value={cancelInitiatorName} onChange={e => setCancelInitiatorName(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gray-200)', fontFamily: 'var(--font)', fontSize: 13, background: 'white' }}>
                  <option value="">Select staff member…</option>
                  {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              ) : (
                <input value={cancelInitiatorFreeText} onChange={e => setCancelInitiatorFreeText(e.target.value)}
                  placeholder="Customer name (optional)"
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--gray-200)', fontFamily: 'var(--font)', fontSize: 13, boxSizing: 'border-box' }} />
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', marginBottom: 8 }}>Reason / Issue <span style={{ color: '#dc2626' }}>*</span></div>
              <textarea className="od-cancel-textarea" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="e.g. Wrong item delivered, customer refused delivery…" autoFocus style={{ borderColor: '#fecaca' }} />
            </div>

            <div className="od-cancel-actions">
              <button className="od-btn" onClick={() => { setShowCancel(false); setCancelReason(''); setCancelInitiatorType('staff'); setCancelInitiatorName(''); setCancelInitiatorFreeText('') }}>Dismiss</button>
              <button className="od-btn od-btn-danger" onClick={cancelOrder} disabled={saving}>
                {saving ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dispatch Modal: FC Center + Full/Partial ── */}
      {showDispatchModal && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDispatchModal(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 460 }}>
            <div className="od-cancel-title">Create Delivery</div>
            <div className="od-cancel-sub">Select fulfilment center and dispatch type</div>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', marginBottom: 8 }}>Fulfilment Center</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Kaveri', 'Godawari'].map(c => (
                  <button key={c} onClick={() => setFcCenter(c)}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid ' + (fcCenter === c ? '#0e2d6a' : 'var(--gray-200)'), background: fcCenter === c ? '#0e2d6a' : 'white', color: fcCenter === c ? 'white' : 'var(--gray-700)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="od-dispatch-choice-btn" onClick={fullyDispatch} disabled={saving}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:28,height:28,color:'#166534',marginBottom:8}}>
                  <path d="M5 13l4 4L19 7"/>
                </svg>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>Full Delivery</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Send entire order to FC for delivery</div>
              </button>
              <button className="od-dispatch-choice-btn" onClick={openPartialDispatch} disabled={saving}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:28,height:28,color:'#92400e',marginBottom:8}}>
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>Partial Delivery</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Select items and quantities to send now</div>
              </button>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button className="od-btn" onClick={() => setShowDispatchModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Partial Dispatch Modal ── */}
      {showPartialModal && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowPartialModal(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 620, width: '100%' }}>
            <div className="od-cancel-title">{isNextBatch ? 'Next Batch Dispatch' : 'Partial Dispatch'}</div>
            <div className="od-cancel-sub">Select items and enter the quantity to dispatch now. Remaining qty will stay pending.</div>

            {/* FC Centre selector — always shown for next batch, required */}
            {isNextBatch && (
              <div style={{marginTop:16,padding:'14px 16px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:10}}>
                <div style={{fontSize:12,fontWeight:700,color:'#166534',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:8}}>Fulfilment Centre for this Batch</div>
                <div style={{display:'flex',gap:10}}>
                  {['Kaveri','Godawari'].map(c => (
                    <button key={c} onClick={() => setFcCenter(c)}
                      style={{flex:1,padding:'10px 0',borderRadius:8,border:'2px solid',fontFamily:'var(--font)',fontSize:13,fontWeight:700,cursor:'pointer',
                        borderColor: fcCenter === c ? '#16a34a' : 'var(--gray-200)',
                        background:  fcCenter === c ? '#dcfce7' : 'white',
                        color:       fcCenter === c ? '#166534' : 'var(--gray-600)'}}>
                      {c}
                    </button>
                  ))}
                </div>
                {order.fulfilment_center && fcCenter !== order.fulfilment_center && (
                  <div style={{fontSize:11,color:'#92400e',marginTop:8,fontWeight:600}}>
                    ⚠ Changing from {order.fulfilment_center} to {fcCenter} for this batch
                  </div>
                )}
              </div>
            )}

            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--gray-200)' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Select</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Item Code</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Total Qty</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Dispatched</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Dispatch Now</th>
                  </tr>
                </thead>
                <tbody>
                  {partialItems.map((item, i) => {
                    const remaining = item.qty - (item.dispatched_qty || 0)
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--gray-100)', background: item.checked ? 'var(--blue-50)' : 'white' }}>
                        <td style={{ padding: '10px' }}>
                          <input type="checkbox" checked={item.checked}
                            onChange={e => setPartialItems(prev => prev.map((p,j) => j===i ? {...p, checked: e.target.checked} : p))}
                            style={{ width: 16, height: 16, cursor: 'pointer' }} disabled={remaining <= 0} />
                        </td>
                        <td style={{ padding: '10px', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--blue-800)' }}>{item.item_code}</td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>{item.qty}</td>
                        <td style={{ padding: '10px', textAlign: 'center', color: item.dispatched_qty > 0 ? '#16a34a' : 'var(--gray-400)' }}>{item.dispatched_qty || 0}</td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          {remaining <= 0 ? (
                            <span style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>Done</span>
                          ) : (
                            <input type="number" min="0" max={remaining} value={item.dispatchQty}
                              onChange={e => setPartialItems(prev => prev.map((p,j) => j===i ? {...p, dispatchQty: e.target.value} : p))}
                              disabled={!item.checked}
                              style={{ width: 70, border: '1px solid var(--gray-200)', borderRadius: 6, padding: '5px 8px', textAlign: 'center', fontFamily: 'var(--font)', fontSize: 13, outline: 'none', background: item.checked ? 'white' : 'var(--gray-50)' }} />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="od-cancel-actions" style={{ marginTop: 20 }}>
              <button className="od-btn" onClick={() => setShowPartialModal(false)}>Cancel</button>
              <button className="od-btn od-btn-approve" onClick={confirmPartialItems} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm Delivery →'}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
    </Layout>
  )
}
