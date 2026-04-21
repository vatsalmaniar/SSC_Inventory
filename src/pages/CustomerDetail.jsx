import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmt } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/customer360.css'

const SALES_REPS = [
  'Aarth Joshi','Akash Devda','Ankit Dave','Bhavesh Patel','Darsh Chauhan',
  'Dimple Bhatiya','Harshadba Zala','Hiral Patel','Jay Patel','Jaypal Jadeja',
  'Jital Maniar','Kaustubh Soni','Khushbu Panchal','Mayank Maniar','Mehul Maniar',
  'Jyotsna Pal','Vatsal Maniar',
]

const INDUSTRIES = [
  'Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal',
  'Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG',
  'Energy','Automobile','Power Electronics','Datacenters','Road Construction',
  'Cement','Tyre','Petroleum','Chemical',
]

const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']
const NEW_CUSTOMER_FLOOR = '2026-04-06'

const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
  TECHNO_COMMERCIAL:'Techno-Commercial', PO_RECEIVED:'PO Received',
}

const STAGE_STYLES = {
  WON:               { background:'#f0fdf4', color:'#15803d' },
  LOST:              { background:'#fef2f2', color:'#dc2626' },
  ON_HOLD:           { background:'#fffbeb', color:'#b45309' },
  QUOTATION_SENT:    { background:'#e8f2fc', color:'#1a4dab' },
  FOLLOW_UP:         { background:'#fff7ed', color:'#c2410c' },
  FINAL_NEGOTIATION: { background:'#fef9c3', color:'#854d0e' },
  BOM_RECEIVED:      { background:'#f5f3ff', color:'#7c3aed' },
  PO_RECEIVED:       { background:'#f0fdf4', color:'#059669' },
  TECHNO_COMMERCIAL: { background:'#f0f9ff', color:'#0369a1' },
}

const VISIT_TYPE_LABELS = { SOLO:'Solo', JOINT_PRINCIPAL:'Joint w/ Principal', JOINT_SSC_TEAM:'Joint SSC Team' }

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function fmtINR(v) {
  if (!v && v !== 0) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function statusBadgeClass(s) {
  if (['pending','inv_check'].includes(s)) return 'pending'
  if (s === 'cancelled') return 'cancelled'
  if (['dispatched_fc','delivered'].includes(s)) return 'delivered'
  return 'active'
}

function statusLabel(s) {
  const map = {
    pending: 'Pending', inv_check: 'Order Approved', inventory_check: 'Inventory Check',
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
  const [customer, setCustomer]       = useState(null)
  const [orders, setOrders]           = useState([])
  const [userRole, setUserRole]       = useState('')
  const [userName, setUserName]       = useState('')
  const [loading, setLoading]         = useState(true)
  const [editMode, setEditMode]       = useState(false)
  const [editData, setEditData]       = useState({})
  const [saving, setSaving]           = useState(false)
  const [approving, setApproving]     = useState(false)
  const [contacts, setContacts]       = useState([])
  const [opps, setOpps]               = useState([])
  const [visits, setVisits]           = useState([])
  const [activeTab, setActiveTab]     = useState('summary')
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm] = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
  const [savingContact, setSavingContact] = useState(false)
  const [showCreditCheck, setShowCreditCheck] = useState(false)
  const [ccForm, setCcForm]           = useState({ gst:'', mca:'', thirdparty:'' })
  const [savingCC, setSavingCC]       = useState(false)
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [pdfInclude, setPdfInclude]   = useState({ orders: true, opportunities: true })

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role,name').eq('id', session.user.id).single()
    setUserRole(profile?.role || '')
    setUserName(profile?.name || '')

    const custRes = await sb.from('customers').select('*').eq('id', id).single()
    if (!custRes.data) { navigate('/customers'); return }

    const [ordersRes, contactsRes, oppsRes, visitsRes] = await Promise.all([
      sb.from('orders')
        .select('id,order_number,customer_name,status,order_type,order_items(total_price),created_at,po_number')
        .eq('is_test', false)
        .ilike('customer_name', custRes.data.customer_name)
        .order('created_at', { ascending: false }),
      sb.from('customer_contacts').select('*').eq('customer_id', id).order('created_at', { ascending: true }),
      sb.from('crm_opportunities')
        .select('id,opportunity_name,stage,estimated_value_inr,quotation_ref,quotation_value_inr,quotation_revision,created_at,brands,profiles(name),crm_principals(name)')
        .eq('customer_id', id)
        .order('created_at', { ascending: false }),
      sb.from('crm_field_visits')
        .select('id,visit_date,visit_type,purpose,outcome,next_action,next_action_date,created_at,profiles(name),crm_opportunities(opportunity_name)')
        .eq('company_id', id)
        .order('visit_date', { ascending: false }),
    ])

    setCustomer(custRes.data)
    setEditData(custRes.data)
    setOrders(ordersRes.data || [])
    setContacts(contactsRes.data || [])
    setOpps(oppsRes.data || [])
    setVisits(visitsRes.data || [])
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
    if (customer?.account_owner && customer.account_owner !== userName) {
      const { data: ownerProfile } = await sb.from('profiles').select('id,name').eq('name', customer.account_owner).maybeSingle()
      if (ownerProfile?.id) {
        await sb.from('notifications').insert({
          user_id: ownerProfile.id, user_name: ownerProfile.name,
          message: `Customer "${customer.customer_name}" approved by ${userName || 'Admin'}.`,
          order_id: null, order_number: '', from_name: userName || 'Admin',
          email_type: 'new_customer_approved',
        })
      }
    }
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
      customer_name:    editData.customer_name,
      gst:              editData.gst || null,
      pan_card_no:      editData.pan_card_no || null,
      msme_no:          editData.msme_no || null,
      billing_address:  editData.billing_address || null,
      shipping_address: editData.shipping_address || null,
      credit_terms:     editData.credit_terms || null,
      account_status:   editData.account_status || null,
      account_owner:    editData.account_owner || null,
      industry:         editData.industry || null,
      customer_type:    editData.customer_type || null,
      location:         editData.location || null,
      poc_name:         editData.poc_name || null,
      poc_no:           editData.poc_no || null,
      poc_email:        editData.poc_email || null,
      director_name:    editData.director_name || null,
      director_no:      editData.director_no || null,
      director_email:   editData.director_email || null,
      turnover:         editData.turnover || null,
      premises:         editData.premises || null,
      year_established: editData.year_established || null,
      vi_shopfloor:     editData.vi_shopfloor || null,
      vi_payment:       editData.vi_payment || null,
      vi_expected_business: editData.vi_expected_business || null,
    }).eq('id', id)
    if (error) { toast('Error saving: ' + error.message); setSaving(false); return }
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

  async function saveCreditCheck() {
    if (!ccForm.gst.trim() && !ccForm.mca.trim() && !ccForm.thirdparty.trim()) {
      toast('Please fill at least one finding'); return
    }
    setSavingCC(true)
    const { error } = await sb.from('customers').update({
      credit_check_gst:      ccForm.gst || null,
      credit_check_mca:      ccForm.mca || null,
      credit_check_3rdparty: ccForm.thirdparty || null,
      credit_check_by:       userName,
      credit_check_at:       new Date().toISOString(),
      credit_check_status:   'completed',
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message); setSavingCC(false); return }
    setCustomer(p => ({ ...p, credit_check_gst: ccForm.gst||null, credit_check_mca: ccForm.mca||null, credit_check_3rdparty: ccForm.thirdparty||null, credit_check_by: userName, credit_check_at: new Date().toISOString(), credit_check_status:'completed' }))
    setShowCreditCheck(false); setSavingCC(false)
    toast('Credit check saved', 'success')
  }

  async function downloadCustomerPDF(include) {
    toast('Preparing report…')
    const orderIds = orders.map(o => o.id)
    let itemsByOrder = {}
    if (include.orders && orderIds.length > 0) {
      const { data: items } = await sb.from('order_items')
        .select('order_id,item_code,qty,unit_price_after_disc,total_price,customer_ref_no')
        .in('order_id', orderIds)
      ;(items || []).forEach(i => {
        if (!itemsByOrder[i.order_id]) itemsByOrder[i.order_id] = []
        itemsByOrder[i.order_id].push(i)
      })
    }

    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const fmtD = s => s ? new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'
    const fmtMoney = v => (v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})

    const ordersHTML = orders.map((o, idx) => {
      const items = itemsByOrder[o.id] || []
      const orderTotal = items.reduce((s,i) => s + (i.total_price||0), 0)
      const statusStyle = ['delivered','dispatched_fc'].includes(o.status)
        ? 'background:#f0fdf4;color:#15803d'
        : o.status === 'cancelled' ? 'background:#fef2f2;color:#dc2626'
        : 'background:#eff6ff;color:#1d4ed8'
      return `
        <div class="order-block">
          <div class="order-header">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="order-num">${esc(o.order_number)}</span>
              <span class="status-chip" style="${statusStyle}">${esc(statusLabel(o.status))}</span>
              ${o.order_type === 'SAMPLE' ? '<span class="status-chip" style="background:#fffbeb;color:#b45309">Sample</span>' : ''}
            </div>
            <div style="display:flex;align-items:center;gap:20px;font-size:11px;color:#64748b">
              ${o.po_number ? `<span>PO: <strong style="color:#0f172a">${esc(o.po_number)}</strong></span>` : ''}
              <span>Date: <strong style="color:#0f172a">${fmtD(o.created_at)}</strong></span>
              <span style="font-size:12px;font-weight:700;color:#0f172a">₹${fmtMoney(orderTotal)}</span>
            </div>
          </div>
          ${items.length > 0 ? `
          <table class="items-table">
            <thead><tr>
              <th style="width:32px">#</th>
              <th>Item Code</th>
              <th style="width:50px;text-align:right">Qty</th>
              <th style="width:120px;text-align:right">Unit Price (₹)</th>
              <th style="width:120px;text-align:right">Total (₹)</th>
            </tr></thead>
            <tbody>
              ${items.map((it,i) => `<tr>
                <td style="color:#94a3b8">${i+1}</td>
                <td class="mono">${esc(it.item_code)||'—'}</td>
                <td style="text-align:right;font-weight:600">${it.qty||0}</td>
                <td style="text-align:right">${fmtMoney(it.unit_price_after_disc)}</td>
                <td style="text-align:right;font-weight:600">₹${fmtMoney(it.total_price)}</td>
              </tr>`).join('')}
            </tbody>
          </table>` : '<div style="padding:8px 0;font-size:11px;color:#94a3b8;font-style:italic">No items recorded</div>'}
        </div>`
    }).join('')

    const oppsHTML = opps.length === 0 ? '<div style="font-size:12px;color:#94a3b8;font-style:italic">No opportunities</div>' : `
      <table class="items-table">
        <thead><tr>
          <th>Opportunity</th>
          <th style="width:110px">Stage</th>
          <th style="width:110px">Principal</th>
          <th style="width:110px;text-align:right">Est. Value (₹)</th>
          <th style="width:110px;text-align:right">Quote Value (₹)</th>
          <th style="width:80px">Rep</th>
        </tr></thead>
        <tbody>
          ${opps.map(o => `<tr>
            <td style="font-weight:600">${esc(o.opportunity_name)}${o.quotation_ref ? `<div class="mono" style="font-size:10px;color:#64748b;font-weight:400">${esc(o.quotation_ref)}</div>` : ''}</td>
            <td>${esc(STAGE_LABELS[o.stage]||o.stage)}</td>
            <td style="font-size:11px">${esc(o.crm_principals?.name||o.brands||'—')}</td>
            <td style="text-align:right">${o.estimated_value_inr ? '₹'+fmtMoney(o.estimated_value_inr) : '—'}</td>
            <td style="text-align:right">${o.quotation_value_inr ? '₹'+fmtMoney(o.quotation_value_inr) : '—'}</td>
            <td style="font-size:11px">${esc(o.profiles?.name||'—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`

    const totalPending = activeOrders.reduce((s,o) => s + (o.order_items||[]).reduce((t,i) => t+(i.total_price||0),0), 0)

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Customer Report — ${esc(customer.customer_name)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:900px;margin:0 auto;line-height:1.5}
.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #0f172a}
.co-name{font-size:16px;font-weight:700;margin-bottom:2px}.co-sub{font-size:11px;color:#64748b;margin-bottom:6px}.co-addr{font-size:10px;color:#475569;line-height:1.6}
.doc-title{font-size:24px;font-weight:700;text-align:right;letter-spacing:-0.5px;color:#1a4dab}
.doc-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;background:#eff6ff;color:#1a4dab;margin-bottom:6px}
.cust-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;padding:16px 20px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0}
.cust-name{font-size:18px;font-weight:700;margin-bottom:4px}.cust-id{font-size:11px;color:#64748b;font-family:'Geist Mono',monospace;margin-bottom:8px}
.field-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;margin-bottom:3px}
.field-val{font-size:12px;font-weight:500;margin-bottom:10px}
.stats-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:28px}
.stat{background:#fff;padding:12px 16px}.stat-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#94a3b8;margin-bottom:4px}
.stat-val{font-size:16px;font-weight:700;color:#0f172a}.stat-val.green{color:#15803d}.stat-val.blue{color:#1a4dab}
.section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#0f172a;margin-bottom:12px;margin-top:28px;padding-bottom:6px;border-bottom:2px solid #e2e8f0}
.order-block{margin-bottom:16px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.order-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0}
.order-num{font-family:'Geist Mono',monospace;font-size:12px;font-weight:700}
.status-chip{font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px}
.items-table{width:100%;border-collapse:collapse;font-size:11px}
.items-table thead tr{border-bottom:1px solid #e2e8f0;background:#f8fafc}
.items-table th{padding:7px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:#64748b;text-align:left}
.items-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
.items-table tr:last-child td{border-bottom:none}
.footer{margin-top:32px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10px;color:#94a3b8}
@media print{body{padding:0;max-width:100%}@page{size:A4;margin:14mm 12mm}}
</style></head><body>
<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Industrial Automation &amp; Electrification</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE</div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/ssc-logo.svg" alt="SSC" style="height:48px;width:auto;display:block;margin-left:auto;margin-bottom:8px"/>
    <div class="doc-badge">Customer Report</div>
    <div class="doc-title">Customer 360</div>
    <div style="font-size:11px;color:#64748b;margin-top:4px">Generated: ${fmtD(new Date().toISOString())}</div>
  </div>
</div>

<div class="cust-block">
  <div>
    <div class="cust-name">${esc(customer.customer_name)}</div>
    <div class="cust-id">${esc(customer.customer_id||'')}</div>
    <div class="field-label">GST</div><div class="field-val mono">${esc(customer.gst||'—')}</div>
    <div class="field-label">Industry</div><div class="field-val">${esc(customer.industry||'—')}</div>
    <div class="field-label">Type</div><div class="field-val">${esc(customer.customer_type||'—')}</div>
  </div>
  <div>
    <div class="field-label">Account Owner</div><div class="field-val">${esc(customer.account_owner||'—')}</div>
    <div class="field-label">Credit Terms</div><div class="field-val">${esc(customer.credit_terms||'—')}</div>
    <div class="field-label">POC</div><div class="field-val">${esc(customer.poc_name||'—')}${customer.poc_no ? ` · ${esc(customer.poc_no)}` : ''}</div>
    <div class="field-label">Billing Address</div><div class="field-val">${esc(customer.billing_address||'—')}</div>
  </div>
</div>

<div class="stats-bar">
  <div class="stat"><div class="stat-label">Total Orders</div><div class="stat-val">${orders.length}</div></div>
  <div class="stat"><div class="stat-label">Active Orders</div><div class="stat-val blue">${activeOrders.length}</div></div>
  <div class="stat"><div class="stat-label">Pending Value</div><div class="stat-val blue">₹${fmtMoney(totalPending)}</div></div>
  <div class="stat"><div class="stat-label">Lifetime Revenue</div><div class="stat-val green">₹${fmtMoney(totalRevenue)}</div></div>
</div>

${include.orders ? `
<div class="section-title">Orders (${orders.length})</div>
${orders.length === 0 ? '<div style="font-size:12px;color:#94a3b8;font-style:italic">No orders</div>' : ordersHTML}
` : ''}
${include.opportunities ? `
<div class="section-title">Opportunities (${opps.length})</div>
${oppsHTML}
` : ''}

<div class="footer">
  <div>SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539</div>
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
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="c360-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/></div></div>
    </Layout>
  )
  if (!customer) return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="c360-page"><div className="c360-empty" style={{paddingTop:80}}><div className="c360-empty-icon">🏢</div>Customer not found</div></div>
    </Layout>
  )

  const activeOrders    = orders.filter(o => !['cancelled','delivered','dispatched_fc'].includes(o.status))
  const completedOrders = orders.filter(o => ['delivered','dispatched_fc'].includes(o.status))
  const totalRevenue    = orders.filter(o => ['delivered','dispatched_fc'].includes(o.status)).reduce((s,o) => s + (o.order_items||[]).reduce((t,i) => t+(i.total_price||0),0), 0)
  const openOpps        = opps.filter(o => !['WON','LOST'].includes(o.stage))
  const quotationOpps   = opps.filter(o => o.quotation_ref)
  const initials        = customer.customer_name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  const avatarBg        = ownerColor(customer.customer_name)

  const tabs = [
    { key:'summary',       label:'Summary' },
    { key:'contacts',      label:'Contacts',      count: contacts.length },
    { key:'opportunities', label:'Opportunities', count: opps.length },
    { key:'orders',        label:'Orders',        count: orders.length },
    { key:'visits',        label:'Visits',        count: visits.length },
    { key:'quotations',    label:'Quotations',    count: quotationOpps.length },
  ]

  return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="c360-page">
        <div className="c360-body">

          {/* ── Hero ── */}
          <div className="c360-hero">
            <div className="c360-hero-top">
              <div className="c360-hero-avatar" style={{ background: avatarBg }}>{initials}</div>
              <div className="c360-hero-info">
                <div className="c360-hero-name">{customer.customer_name}</div>
                {customer.customer_id && <div style={{ fontSize:12, fontWeight:600, color:'var(--gray-400)', fontFamily:'var(--mono)', marginBottom:6 }}>{customer.customer_id}</div>}
                <div className="c360-hero-badges">
                  {customer.customer_type && <span className="c360-badge c360-badge-blue">{customer.customer_type}</span>}
                  {customer.industry      && <span className="c360-badge c360-badge-gray">{customer.industry}</span>}
                  {customer.account_status && (
                    <span className={'c360-badge ' + (customer.account_status==='Active'?'c360-badge-green':customer.account_status==='Blacklisted'?'c360-badge-red':'c360-badge-amber')}>
                      {customer.account_status}
                    </span>
                  )}
                  {customer.credit_terms  && <span className="c360-badge c360-badge-gray">{customer.credit_terms}</span>}
                  {customer.approval_status === 'pending' && <span className="c360-badge c360-badge-amber">⏳ Pending Approval</span>}
                  {userRole === 'admin' && customer.credit_check_status === 'pending' && customer.created_at >= NEW_CUSTOMER_FLOOR && (
                    <span className="c360-badge c360-badge-amber">Credit Check Pending</span>
                  )}
                  {customer.credit_check_status === 'completed' && customer.created_at >= NEW_CUSTOMER_FLOOR && (
                    <span className="c360-badge c360-badge-green">✓ Credit Checked</span>
                  )}
                </div>
              </div>
              <div className="c360-hero-actions">
                <button className="c360-btn" onClick={() => navigate('/customers')}>← Back</button>
                <button className="c360-btn" onClick={() => setShowPdfModal(true)} style={{ gap:5, display:'flex', alignItems:'center' }}>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                  Download Report
                </button>
                {userRole === 'admin' && customer.approval_status === 'pending' && (
                  <>
                    <button className="c360-btn c360-btn-danger" onClick={reject} disabled={approving}>Reject</button>
                    <button className="c360-btn c360-btn-approve" onClick={approve} disabled={approving}>{approving?'…':'Approve'}</button>
                  </>
                )}
                {userRole === 'admin' && customer.approval_status !== 'pending' && customer.credit_check_status === 'pending' && customer.created_at >= NEW_CUSTOMER_FLOOR && (
                  <button className="c360-btn c360-btn-amber" onClick={() => { setCcForm({ gst: customer.credit_check_gst||'', mca: customer.credit_check_mca||'', thirdparty: customer.credit_check_3rdparty||'' }); setShowCreditCheck(true) }}>
                    Credit Check
                  </button>
                )}
                {userRole === 'admin' && customer.approval_status !== 'pending' && (
                  !editMode
                    ? <button className="c360-btn" onClick={() => setEditMode(true)}>Edit</button>
                    : <>
                        <button className="c360-btn" onClick={() => { setEditMode(false); setEditData(customer) }}>Cancel</button>
                        <button className="c360-btn c360-btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
                      </>
                )}
              </div>
            </div>

            {/* ── Stat chips ── */}
            <div className="c360-stats">
              <div className="c360-stat">
                <span className="c360-stat-label">Total Orders</span>
                <span className="c360-stat-value">{orders.length}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Active</span>
                <span className={'c360-stat-value' + (activeOrders.length > 0 ? ' accent' : '')}>{activeOrders.length}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Pending Value</span>
                <span className={'c360-stat-value' + (activeOrders.length > 0 ? ' accent' : '')} style={{ fontSize:14 }}>
                  {fmtINR(activeOrders.reduce((s,o) => s + (o.order_items||[]).reduce((t,i) => t+(i.total_price||0),0), 0))}
                </span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Lifetime Revenue</span>
                <span className="c360-stat-value green">{fmtINR(totalRevenue)}</span>
              </div>
              <div className="c360-stat">
                <span className="c360-stat-label">Open Opps</span>
                <span className={'c360-stat-value' + (openOpps.length > 0 ? ' accent' : '')}>{openOpps.length}</span>
              </div>
              {customer.turnover && (
                <div className="c360-stat">
                  <span className="c360-stat-label">Turnover</span>
                  <span className="c360-stat-value" style={{ fontSize: 14 }}>{customer.turnover}</span>
                </div>
              )}
              {customer.location && (
                <div className="c360-stat">
                  <span className="c360-stat-label">Location</span>
                  <span className="c360-stat-value" style={{ fontSize: 13 }}>{customer.location}</span>
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

          {/* ── Tab Content ── */}
          <div className="c360-content">

            {/* ══ SUMMARY ══ */}
            {activeTab === 'summary' && (
              <div className="c360-summary-grid">

                {/* Left: account details */}
                <div>
                  <div className="c360-card">
                    <div className="c360-card-header">
                      <div className="c360-card-title">Account Details</div>
                    </div>
                    <div className="c360-card-body">
                      {editMode ? (
                        <EditForm editData={editData} setEditData={setEditData} />
                      ) : (
                        <>
                          <div className="c360-section-label">Account Info</div>
                          <div className="c360-field-grid">
                            <Field label="Customer Name"    val={customer.customer_name} />
                            <Field label="Customer ID"      val={customer.customer_id} mono />
                            <Field label="Account Status"   val={customer.account_status} />
                            <Field label="Customer Type"    val={customer.customer_type} />
                            <Field label="Industry"         val={customer.industry} />
                            <Field label="Credit Terms"     val={customer.credit_terms} />
                            <Field label="Location / Branch" val={customer.location} />
                            <Field label="Premises"         val={customer.premises} />
                            <Field label="Annual Turnover"  val={customer.turnover} />
                            <Field label="Year Established" val={customer.year_established} />
                          </div>

                          <div className="c360-section-label">Tax & Compliance</div>
                          <div className="c360-field-grid">
                            <Field label="GST Number"  val={customer.gst} mono />
                            <Field label="PAN Card No." val={customer.pan_card_no} mono />
                            <Field label="MSME No."    val={customer.msme_no} />
                            <div className="c360-field">
                              <label>GST Certificate</label>
                              <div className="val">
                                {customer.gst_cert_url
                                  ? <a href={customer.gst_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                      View PDF
                                    </a>
                                  : <span style={{ color:'var(--gray-300)' }}>—</span>}
                              </div>
                            </div>
                            {customer.msme_cert_url && (
                              <div className="c360-field">
                                <label>MSME Certificate</label>
                                <div className="val">
                                  <a href={customer.msme_cert_url} target="_blank" rel="noopener noreferrer" style={{ color:'#1a4dab', fontSize:12, display:'inline-flex', alignItems:'center', gap:4 }}>
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                    View PDF
                                  </a>
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="c360-section-label">Addresses</div>
                          <div className="c360-field-grid">
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Billing Address</label>
                              <div className="val" style={{ lineHeight:1.5 }}>{customer.billing_address || '—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Shipping Address</label>
                              <div className="val" style={{ lineHeight:1.5 }}>{customer.shipping_address || '—'}</div>
                            </div>
                          </div>

                          <div className="c360-section-label">Point of Contact</div>
                          <div className="c360-field-grid">
                            <Field label="POC Name"  val={customer.poc_name} />
                            <div className="c360-field">
                              <label>POC Phone</label>
                              <div className="val">{customer.poc_no ? <a href={'tel:'+customer.poc_no} style={{ color:'#1a4dab', textDecoration:'none' }}>{customer.poc_no}</a> : '—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>POC Email</label>
                              <div className="val">{customer.poc_email ? <a href={'mailto:'+customer.poc_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{customer.poc_email}</a> : '—'}</div>
                            </div>
                          </div>

                          <div className="c360-section-label">Director / Decision Maker</div>
                          <div className="c360-field-grid">
                            <Field label="Director Name" val={customer.director_name} />
                            <div className="c360-field">
                              <label>Director Phone</label>
                              <div className="val">{customer.director_no ? <a href={'tel:'+customer.director_no} style={{ color:'#1a4dab', textDecoration:'none' }}>{customer.director_no}</a> : '—'}</div>
                            </div>
                            <div className="c360-field" style={{ gridColumn:'span 2' }}>
                              <label>Director Email</label>
                              <div className="val">{customer.director_email ? <a href={'mailto:'+customer.director_email} style={{ color:'#1a4dab', textDecoration:'none' }}>{customer.director_email}</a> : '—'}</div>
                            </div>
                          </div>

                          {/* Visual Inspection */}
                          {(customer.vi_shopfloor || customer.vi_payment || customer.vi_expected_business) && (
                            <div className="c360-vi-card">
                              <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:12, height:12 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                Visual Inspection Notes
                              </div>
                              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                                {customer.vi_shopfloor && <div><div className="c360-vi-label">Shopfloor</div><div className="c360-vi-text">{customer.vi_shopfloor}</div></div>}
                                {customer.vi_payment   && <div><div className="c360-vi-label">Payment</div><div className="c360-vi-text">{customer.vi_payment}</div></div>}
                                {customer.vi_expected_business && <div><div className="c360-vi-label">Expected Business</div><div className="c360-vi-text">{customer.vi_expected_business}</div></div>}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: owner + contacts + credit check */}
                <div>

                  {/* Account Owner */}
                  <div className="c360-side-card">
                    <div className="c360-side-title">Account Owner</div>
                    {customer.account_owner
                      ? <div className="c360-owner-chip">
                          <div className="c360-owner-avatar" style={{ background: ownerColor(customer.account_owner) }}>
                            {customer.account_owner.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                          </div>
                          <div>
                            <div className="c360-owner-name">{customer.account_owner}</div>
                            <div className="c360-owner-sub">Account Rep</div>
                          </div>
                        </div>
                      : <div style={{ fontSize:13, color:'var(--gray-400)' }}>Unassigned</div>
                    }
                  </div>

                  {/* Primary Contact quick card */}
                  {(customer.poc_name || contacts.length > 0) && (
                    <div className="c360-side-card">
                      <div className="c360-side-title">Primary Contact</div>
                      {(() => {
                        const pc = contacts.find(c => c.is_decision_maker) || contacts[0]
                        const name = pc?.name || customer.poc_name
                        const title = pc?.designation || ''
                        const phone = pc?.phone || customer.poc_no
                        const email = pc?.email || customer.poc_email
                        if (!name) return null
                        const color = ownerColor(name)
                        const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
                        return (
                          <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                            <div style={{ width:44, height:44, borderRadius:12, background:color, color:'white', fontSize:14, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
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
                      <SideRow label="Completed Orders" val={completedOrders.length} />
                      <SideRow label="Cancelled Orders" val={orders.filter(o=>o.status==='cancelled').length} />
                      <SideRow label="Open Opportunities" val={openOpps.length} accent={openOpps.length>0} />
                      <SideRow label="Total Quotations" val={quotationOpps.length} />
                      <SideRow label="Field Visits" val={visits.length} />
                    </div>
                  </div>

                  {/* Credit Check (admin only) */}
                  {userRole === 'admin' && customer.created_at >= NEW_CUSTOMER_FLOOR && (
                    <div className="c360-side-card" style={{ border: customer.credit_check_status==='completed' ? '1px solid #bbf7d0' : '1px solid #fde68a', background: customer.credit_check_status==='completed' ? '#f0fdf4' : '#fffdf5' }}>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                        <div className="c360-side-title" style={{ margin:0, color: customer.credit_check_status==='completed' ? '#15803d' : '#92400e' }}>Credit Check</div>
                        {customer.credit_check_status === 'completed'
                          ? <span style={{ fontSize:10, fontWeight:700, background:'#dcfce7', color:'#15803d', borderRadius:4, padding:'2px 7px' }}>Done</span>
                          : <span style={{ fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e', borderRadius:4, padding:'2px 7px' }}>Pending</span>
                        }
                      </div>
                      {customer.credit_check_status === 'completed' ? (
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {customer.credit_check_gst && <div><div style={{ fontSize:10, fontWeight:600, color:'#166534', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:2 }}>GST</div><div style={{ fontSize:12, color:'var(--gray-700)', lineHeight:1.5 }}>{customer.credit_check_gst}</div></div>}
                          {customer.credit_check_mca && <div><div style={{ fontSize:10, fontWeight:600, color:'#166534', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:2 }}>MCA</div><div style={{ fontSize:12, color:'var(--gray-700)', lineHeight:1.5 }}>{customer.credit_check_mca}</div></div>}
                          {customer.credit_check_3rdparty && <div><div style={{ fontSize:10, fontWeight:600, color:'#166534', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:2 }}>3rd Party</div><div style={{ fontSize:12, color:'var(--gray-700)', lineHeight:1.5 }}>{customer.credit_check_3rdparty}</div></div>}
                          {customer.credit_check_by && (
                            <div style={{ borderTop:'1px solid #bbf7d0', paddingTop:8, marginTop:2, display:'flex', alignItems:'center', gap:6 }}>
                              <div style={{ width:22, height:22, borderRadius:'50%', background:ownerColor(customer.credit_check_by), color:'white', fontSize:9, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                {customer.credit_check_by.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                              </div>
                              <div>
                                <div style={{ fontSize:11, fontWeight:600, color:'var(--gray-700)' }}>{customer.credit_check_by}</div>
                                <div style={{ fontSize:10, color:'var(--gray-400)' }}>{customer.credit_check_at ? new Date(customer.credit_check_at).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize:12, color:'#92400e', textAlign:'center', padding:'8px 0' }}>Not yet performed.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ══ CONTACTS ══ */}
            {activeTab === 'contacts' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Contacts ({contacts.length})</div>
                  <button className="c360-btn c360-btn-primary" onClick={() => setShowContactModal(true)}>+ Add Contact</button>
                </div>
                {contacts.length === 0 ? (
                  <div className="c360-empty">
                    <div className="c360-empty-icon">👤</div>
                    No contacts added yet.
                  </div>
                ) : (
                  <div className="c360-contact-grid">
                    {contacts.map(c => (
                      <div key={c.id} className="c360-contact-card">
                        <div className="c360-contact-avatar">
                          {c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div className="c360-contact-name">{c.name}</div>
                          {c.designation && <div className="c360-contact-title">{c.designation}</div>}
                          {c.phone    && <a href={'tel:'+c.phone}       className="c360-contact-phone">{c.phone}</a>}
                          {c.whatsapp && <a href={'https://wa.me/'+c.whatsapp.replace(/\D/g,'')} className="c360-contact-phone" target="_blank" rel="noopener noreferrer" style={{ color:'#059669' }}>WhatsApp</a>}
                          {c.email    && <a href={'mailto:'+c.email}    className="c360-contact-email">{c.email}</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══ OPPORTUNITIES ══ */}
            {activeTab === 'opportunities' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Opportunities ({opps.length})</div>
                  <button className="c360-btn c360-btn-primary" onClick={() => navigate('/crm/opportunities/new?customer_id='+id)}>+ New Opp</button>
                </div>
                {opps.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">🎯</div>No opportunities yet.</div>
                ) : (
                  <table className="c360-table">
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
                      {opps.map(o => {
                        const ss = STAGE_STYLES[o.stage] || { background:'#f1f5f9', color:'#475569' }
                        return (
                          <tr key={o.id} onClick={() => navigate('/crm/opportunities/'+o.id)} style={{ cursor:'pointer' }}>
                            <td style={{ fontWeight:600, maxWidth:200 }}>
                              <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{o.opportunity_name || o.crm_principals?.name || '—'}</div>
                            </td>
                            <td><span className="c360-quot-stage" style={ss}>{STAGE_LABELS[o.stage]||o.stage}</span></td>
                            <td style={{ fontSize:11, color:'var(--gray-500)' }}>{(o.brands&&o.brands.length>0)?o.brands.slice(0,3).join(', '):(o.crm_principals?.name||'—')}</td>
                            <td style={{ fontSize:12, color:'var(--gray-500)' }}>{o.profiles?.name||'—'}</td>
                            <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap', fontSize:12 }}>{fmt(o.created_at)}</td>
                            <td style={{ textAlign:'right', fontWeight:600 }}>{o.estimated_value_inr?fmtINR(o.estimated_value_inr):'—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ══ ORDERS ══ */}
            {activeTab === 'orders' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Order History ({orders.length})</div>
                  <span style={{ fontSize:12, color:'var(--gray-500)', fontWeight:600 }}>Lifetime: {fmtINR(totalRevenue)}</span>
                </div>
                {orders.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">📦</div>No orders found.</div>
                ) : (
                  <table className="c360-table">
                    <thead>
                      <tr>
                        <th>Order #</th>
                        <th>Type</th>
                        <th>PO Ref</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th style={{ textAlign:'right' }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id} onClick={() => navigate('/orders/'+o.id)} style={{ cursor:'pointer' }}>
                          <td className="mono">{o.order_number}</td>
                          <td>{o.order_type==='SO'?'Standard':o.order_type==='CO'?'Custom':'Sample'}</td>
                          <td style={{ color:'var(--gray-500)', fontSize:12 }}>{o.po_number||'—'}</td>
                          <td>
                            <span className={'od-status-badge '+statusBadgeClass(o.status)} style={{ fontSize:10 }}>{statusLabel(o.status)}</span>
                          </td>
                          <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap' }}>{fmt(o.created_at)}</td>
                          <td style={{ textAlign:'right', fontWeight:600 }}>{fmtINR((o.order_items||[]).reduce((t,i)=>t+(i.total_price||0),0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ══ VISITS ══ */}
            {activeTab === 'visits' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Field Visits ({visits.length})</div>
                  <button className="c360-btn c360-btn-primary" onClick={() => navigate('/crm/visits')}>View All Visits</button>
                </div>
                {visits.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">🗺️</div>No field visits recorded.</div>
                ) : (
                  <table className="c360-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Opportunity</th>
                        <th>Purpose</th>
                        <th>Outcome</th>
                        <th>Next Action</th>
                        <th>Rep</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visits.map(v => (
                        <tr key={v.id}>
                          <td style={{ whiteSpace:'nowrap', fontWeight:600 }}>{v.visit_date ? new Date(v.visit_date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                          <td><span className="c360-visit-type">{VISIT_TYPE_LABELS[v.visit_type]||v.visit_type}</span></td>
                          <td style={{ fontSize:12, color:'var(--gray-600)', maxWidth:140 }}>
                            <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.crm_opportunities?.opportunity_name||'—'}</div>
                          </td>
                          <td style={{ fontSize:12, color:'var(--gray-700)', maxWidth:180 }}>
                            <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.purpose||'—'}</div>
                          </td>
                          <td style={{ fontSize:12, color:'var(--gray-700)', maxWidth:180 }}>
                            <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.outcome||'—'}</div>
                          </td>
                          <td style={{ fontSize:12, color:'var(--gray-600)', maxWidth:160 }}>
                            {v.next_action ? (
                              <div>
                                <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.next_action}</div>
                                {v.next_action_date && <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:1 }}>{new Date(v.next_action_date).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>}
                              </div>
                            ) : '—'}
                          </td>
                          <td style={{ fontSize:12, color:'var(--gray-500)', whiteSpace:'nowrap' }}>{v.profiles?.name||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ══ QUOTATIONS ══ */}
            {activeTab === 'quotations' && (
              <div className="c360-card">
                <div className="c360-card-header">
                  <div className="c360-card-title">Quotations ({quotationOpps.length})</div>
                </div>
                {quotationOpps.length === 0 ? (
                  <div className="c360-empty"><div className="c360-empty-icon">📄</div>No quotations sent yet.</div>
                ) : (
                  <table className="c360-table">
                    <thead>
                      <tr>
                        <th>Quotation Ref</th>
                        <th>Opportunity</th>
                        <th>Stage</th>
                        <th>Revision</th>
                        <th>Rep</th>
                        <th>Date</th>
                        <th style={{ textAlign:'right' }}>Quote Value</th>
                        <th style={{ textAlign:'right' }}>Est. Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotationOpps.map(o => {
                        const ss = STAGE_STYLES[o.stage] || { background:'#f1f5f9', color:'#475569' }
                        return (
                          <tr key={o.id} onClick={() => navigate('/crm/opportunities/'+o.id)} style={{ cursor:'pointer' }}>
                            <td className="mono" style={{ fontWeight:700, color:'#1a4dab' }}>{o.quotation_ref}</td>
                            <td style={{ fontWeight:600, maxWidth:180 }}>
                              <div style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{o.opportunity_name||'—'}</div>
                            </td>
                            <td><span className="c360-quot-stage" style={ss}>{STAGE_LABELS[o.stage]||o.stage}</span></td>
                            <td style={{ textAlign:'center', fontWeight:600, color:'var(--gray-600)' }}>
                              {o.quotation_revision > 1
                                ? <span style={{ background:'#fef3c7', color:'#92400e', fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:4 }}>Rev {o.quotation_revision}</span>
                                : <span style={{ color:'var(--gray-400)', fontSize:12 }}>v1</span>}
                            </td>
                            <td style={{ fontSize:12, color:'var(--gray-500)' }}>{o.profiles?.name||'—'}</td>
                            <td style={{ color:'var(--gray-500)', whiteSpace:'nowrap', fontSize:12 }}>{fmt(o.created_at)}</td>
                            <td style={{ textAlign:'right', fontWeight:700 }}>{o.quotation_value_inr?fmtINR(o.quotation_value_inr):'—'}</td>
                            <td style={{ textAlign:'right', color:'var(--gray-500)' }}>{o.estimated_value_inr?fmtINR(o.estimated_value_inr):'—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Add Contact Modal ── */}
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

      {/* ── Credit Check Modal ── */}
      {showPdfModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={() => setShowPdfModal(false)}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:360, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Download Report</div>
              <button onClick={() => setShowPdfModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px' }}>
              <div style={{ fontSize:12, color:'#64748b', marginBottom:14 }}>Select what to include in the PDF:</div>
              <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, fontWeight:500, cursor:'pointer', marginBottom:12 }}>
                <input type="checkbox" checked={pdfInclude.orders} onChange={e => setPdfInclude(p => ({ ...p, orders: e.target.checked }))} style={{ width:16, height:16 }} />
                Orders <span style={{ fontSize:11, color:'#94a3b8', fontWeight:400 }}>({orders.length} orders with all items)</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, fontWeight:500, cursor:'pointer', marginBottom:20 }}>
                <input type="checkbox" checked={pdfInclude.opportunities} onChange={e => setPdfInclude(p => ({ ...p, opportunities: e.target.checked }))} style={{ width:16, height:16 }} />
                Opportunities <span style={{ fontSize:11, color:'#94a3b8', fontWeight:400 }}>({opps.length} opportunities)</span>
              </label>
              <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                <button className="c360-btn" onClick={() => setShowPdfModal(false)}>Cancel</button>
                <button className="c360-btn c360-btn-primary"
                  disabled={!pdfInclude.orders && !pdfInclude.opportunities}
                  onClick={() => { setShowPdfModal(false); downloadCustomerPDF(pdfInclude) }}>
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreditCheck && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target===e.currentTarget) setShowCreditCheck(false) }}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:520, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #fde68a', background:'#fffdf5', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#92400e' }}>Credit Check</div>
                <div style={{ fontSize:12, color:'#b45309', marginTop:2 }}>{customer.customer_name}</div>
              </div>
              <button onClick={() => setShowCreditCheck(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14 }}>
              {[['gst','1. GST Check','Findings from GST verification...'],['mca','2. Balance Sheet & PnL (MCA)','Findings from MCA records...'],['thirdparty','3. 3rd Party Compliance Check','Findings from third-party compliance...']].map(([field,label,ph]) => (
                <div key={field}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
                  <textarea value={ccForm[field]} onChange={e => setCcForm(p => ({ ...p, [field]: e.target.value }))} placeholder={ph} rows={3}
                    style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box', resize:'vertical' }} />
                </div>
              ))}
            </div>
            <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowCreditCheck(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={saveCreditCheck} disabled={savingCC}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#1e3a5f', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                {savingCC?'Saving…':'Save Findings'}
              </button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}

/* ── Small helpers ── */
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

function EditForm({ editData, setEditData }) {
  const set = (k, v) => setEditData(p => ({ ...p, [k]: v }))
  const inp = (label, key, type='text', ph='') => (
    <div className="od-edit-field">
      <label>{label}</label>
      <input type={type} value={editData[key]||''} onChange={e => set(key, e.target.value)} placeholder={ph} />
    </div>
  )
  const sel = (label, key, opts) => (
    <div className="od-edit-field">
      <label>{label}</label>
      <select value={editData[key]||''} onChange={e => set(key, e.target.value)} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
        <option value="">— Select —</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
  const ta = (label, key, ph) => (
    <div className="od-edit-field">
      <label>{label}</label>
      <textarea value={editData[key]||''} onChange={e => set(key, e.target.value)} placeholder={ph} />
    </div>
  )
  return (
    <div className="od-edit-form">
      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', marginBottom:8 }}>Account Info</div>
      <div className="od-edit-row">{inp('Customer Name','customer_name')}{sel('Account Status','account_status',['Active','Dormant','Blacklisted'])}</div>
      <div className="od-edit-row">
        <div className="od-edit-field">
          <label>Account Owner</label>
          <select value={editData.account_owner||''} onChange={e => set('account_owner', e.target.value)} style={{ padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontFamily:'var(--font)', background:'white' }}>
            <option value="">— Unassigned —</option>
            {['Aarth Joshi','Akash Devda','Ankit Dave','Bhavesh Patel','Darsh Chauhan','Dimple Bhatiya','Harshadba Zala','Hiral Patel','Jay Patel','Jaypal Jadeja','Jital Maniar','Kaustubh Soni','Khushbu Panchal','Mayank Maniar','Mehul Maniar','Jyotsna Pal','Vatsal Maniar'].map(r => <option key={r} value={r}>{r}</option>)}
            <option value="Customer Success Team">Customer Success Team</option>
            <option value="Growth Team">Growth Team</option>
          </select>
        </div>
        {sel('Industry','industry',['Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal','Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG','Energy','Automobile','Power Electronics','Datacenters','Road Construction','Cement','Tyre','Petroleum','Chemical'])}
      </div>
      <div className="od-edit-row">
        {sel('Credit Terms','credit_terms',['Against PI','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days','Against Delivery'])}
        {inp('Location / Branch','location','text','e.g. Ahmedabad, Baroda')}
      </div>
      <div className="od-edit-row">
        {sel('Customer Type','customer_type',['OEM','Panel Builder','End User','Trader'])}
        {sel('Premises','premises',['Owned','Rented','Leased'])}
      </div>
      <div className="od-edit-row">{inp('Annual Turnover','turnover','text','e.g. 2 Cr, 50L')}{inp('Year of Establishment','year_established','number','e.g. 2005')}</div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Tax & Compliance</div>
      <div className="od-edit-row">{inp('GST Number','gst','text','24ABCDE1234F1Z5')}{inp('PAN Card No.','pan_card_no','text','ABCDE1234F')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('MSME No.','msme_no','text','MSME registration number')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Addresses</div>
      {ta('Billing Address','billing_address','Full billing address')}
      <div style={{ marginTop:8 }}>{ta('Shipping Address','shipping_address','Full shipping address')}</div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Point of Contact</div>
      <div className="od-edit-row">{inp('POC Name','poc_name')}{inp('POC Phone','poc_no','tel')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('POC Email','poc_email','email')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.7px', margin:'12px 0 8px' }}>Director / Decision Maker</div>
      <div className="od-edit-row">{inp('Director Name','director_name')}{inp('Director Phone','director_no','tel')}</div>
      <div className="od-edit-row"><div style={{ flex:1 }}>{inp('Director Email','director_email','email')}</div><div style={{ flex:1 }}></div></div>

      <div style={{ fontSize:10, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'0.7px', margin:'16px 0 8px' }}>Visual Inspection Notes</div>
      <div style={{ marginBottom:8 }}>{ta('Shopfloor Observation','vi_shopfloor','e.g. Shop floor filled with machines, active production…')}</div>
      <div style={{ marginBottom:8 }}>{ta('Payment Assessment','vi_payment','e.g. Ideal payment cycle 60 days, payment appears safe…')}</div>
      {ta('Expected Business','vi_expected_business','e.g. Annual potential ₹8–10L, primarily Mitsubishi PLCs…')}
    </div>
  )
}
