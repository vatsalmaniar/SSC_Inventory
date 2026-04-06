import { useState, useEffect } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/orders.css'

// Billing pipeline — matches actual DB statuses that billing acts on
const BILLING_STAGES = [
  { key: 'goods_issued',       label: 'Credit Check'   },
  { key: 'credit_check',       label: 'GI Posted'      },
  { key: 'goods_issue_posted', label: 'Invoice'        },
  { key: 'invoice_generated',  label: 'Waiting for FC' },
  { key: 'delivery_ready',     label: 'E-Way Bill'     },
]

// PI pipeline stages (shown instead of normal stages while order is in PI phase)
const PI_STAGES = [
  { key: 'pi_requested',      label: 'Issue PI'        },
  { key: 'pi_generated',      label: 'Await Payment'   },
  { key: 'pi_payment_pending', label: 'Confirm Payment' },
]

// Statuses visible to billing module
const BILLING_MODULE_STATUSES = ['pi_requested','pi_generated','pi_payment_pending','goods_issued','credit_check','goods_issue_posted','invoice_generated','delivery_ready']

function billingPipelineIdx(status) {
  if (status === 'goods_issued')        return 0
  if (status === 'credit_check')        return 1
  if (status === 'goods_issue_posted')  return 2
  if (status === 'invoice_generated')   return 3
  if (status === 'delivery_ready')      return 4
  return -1
}

function piPipelineIdx(status) {
  if (status === 'pi_requested')       return 0
  if (status === 'pi_generated')       return 1
  if (status === 'pi_payment_pending') return 2
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

function dotClass(msg) {
  const m = msg?.toLowerCase() || ''
  if (m.includes('cancel'))   return 'cancelled'
  if (m.includes('edit'))     return 'edited'
  if (m.includes('submitted') || m.includes('created') || m.includes('accepted')) return 'submitted'
  return 'approved'
}

export default function BillingOrderDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const location   = useLocation()
  const dispatchId = location.state?.dispatch_id || null

  const [order, setOrder]         = useState(null)
  const [activeBatch, setActiveBatch] = useState(null)
  const [user, setUser]           = useState({ name: '', role: '', avatar: '' })
  const [comments, setComments]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  // Action states
  const [creditChoice, setCreditChoice]       = useState(null)   // null | 'override' | 'clear'
  const [showGIConfirm, setShowGIConfirm]     = useState(false)
  const [showInvConfirm, setShowInvConfirm]   = useState(false)
  const [ewayNumber, setEwayNumber]           = useState('')
  const [invoicePdfFile, setInvoicePdfFile]   = useState(null)
  const [invoicePdfError, setInvoicePdfError] = useState('')
  const [ewayPdfFile, setEwayPdfFile]         = useState(null)
  const [ewayPdfError, setEwayPdfError]       = useState('')

  // PI flow states
  const [piNumberInput, setPiNumberInput]     = useState('')
  const [piPdfFile, setPiPdfFile]             = useState(null)
  const [piPdfError, setPiPdfError]           = useState('')
  const [paymentRef, setPaymentRef]           = useState('')

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
    const role   = profile?.role || 'accounts'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    if (!['accounts','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, role, avatar })
    await loadOrder()
  }

  async function loadOrder() {
    setLoading(true)
    const { data } = await sb.from('orders').select('*, order_items(*)').eq('id', id).single()
    if (data?.order_type === 'SAMPLE') { navigate('/billing'); return }
    setCreditChoice(null)
    setInvoicePdfFile(null); setInvoicePdfError('')
    setEwayPdfFile(null);   setEwayPdfError('')
    setPiPdfFile(null); setPiPdfError('')
    setOrder(data)
    // Auto-suggest next PI number when order is in pi_requested stage
    if (data?.status === 'pi_requested') {
      const yr = new Date().getFullYear()
      const { data: piNums } = await sb.from('order_dispatches').select('pi_number').like('pi_number', `PI-${yr}-%`)
      const maxNum = (piNums || []).reduce((max, r) => {
        const n = parseInt((r.pi_number || '').split('-')[2] || '0')
        return n > max ? n : max
      }, 0)
      setPiNumberInput(`PI-${yr}-${String(maxNum + 1).padStart(4, '0')}`)
    }
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

  async function reloadComments() {
    const { data: c } = await sb.from('order_comments').select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(c || [])
  }

  function validatePdf(file) {
    if (!file) return null
    if (file.size > 100 * 1024) return 'File must be under 100 KB. Please compress the PDF and try again.'
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are allowed.'
    return null
  }

  async function uploadPdf(file, pathPrefix) {
    const ext  = file.name.split('.').pop()
    const path = `${pathPrefix}/${Date.now()}.${ext}`
    const { error } = await sb.storage.from('billing-docs').upload(path, file, { upsert: true })
    if (error) throw error
    const { data: { publicUrl } } = sb.storage.from('billing-docs').getPublicUrl(path)
    return publicUrl
  }

  async function goToCustomer() {
    if (!order?.customer_name) return
    const { data } = await sb.from('customers').select('id').ilike('customer_name', order.customer_name).maybeSingle()
    if (data?.id) navigate('/customers/' + data.id)
    else navigate('/customers?search=' + encodeURIComponent(order.customer_name))
  }

  async function logActivity(message) {
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message, tagged_users: [], is_activity: true })
    await reloadComments()
  }

  // STEP 1a: Pending Payment — flag override, stay at goods_issued
  async function handleCreditCheckYes() {
    setSaving(true)
    if (activeBatch) await sb.from('order_dispatches').update({ credit_override: true, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    await sb.from('orders').update({ credit_override: true, updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity('Credit Override flagged — payment pending. Awaiting approval. ⚠️')
    setSaving(false); await loadOrder()
  }
  // STEP 1b: No pending payment — advance to credit_check
  async function handleCreditCheckClear() {
    setSaving(true)
    if (activeBatch) await sb.from('order_dispatches').update({ status: 'credit_check', credit_override: false, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    await sb.from('orders').update({ status: 'credit_check', credit_override: false, updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity('Credit Check completed — payment clear.')
    setSaving(false); await loadOrder()
  }

  // STEP 2: credit_check → goods_issue_posted (assign Temp/INV)
  async function advanceGIPosted() {
    setSaving(true)
    let invNum = null
    if (activeBatch) {
      const { data } = await sb.rpc('assign_dispatch_invoice', { p_dispatch_id: activeBatch.id })
      invNum = data
      await sb.from('order_dispatches').update({ status: 'goods_issue_posted', updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    } else {
      const { data } = await sb.rpc('assign_temp_invoice_number', { p_order_id: id })
      invNum = data
    }
    await sb.from('orders').update({ status: 'goods_issue_posted', updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`Goods Issue Posted. Temp Invoice: ${invNum || '—'}`)
    setShowGIConfirm(false); setSaving(false); await loadOrder()
  }

  // STEP 3: goods_issue_posted → invoice_generated (confirm INV: Temp→SSC)
  async function confirmInvoiceGenerated() {
    if (!invoicePdfFile) { alert('Please attach the invoice PDF before confirming.'); return }
    setSaving(true)
    let invNum = null
    let pdfUrl = null
    try { pdfUrl = await uploadPdf(invoicePdfFile, `invoices/${id}`) } catch { alert('PDF upload failed. Please try again.'); setSaving(false); return }
    if (activeBatch) {
      const { data } = await sb.rpc('confirm_dispatch_invoice', { p_dispatch_id: activeBatch.id })
      invNum = data
      await sb.from('order_dispatches').update({ status: 'invoice_generated', invoice_pdf_url: pdfUrl, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    } else {
      const { data } = await sb.rpc('confirm_invoice_number', { p_order_id: id })
      invNum = data
    }
    await sb.from('orders').update({ status: 'invoice_generated', invoice_pdf_url: pdfUrl, updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`Invoice Generated — ${invNum}. Waiting for Fulfilment Centre to set delivery details.`)
    setShowInvConfirm(false); setSaving(false); await loadOrder()
  }

  // PI STEP 1: pi_requested → pi_generated (issue PI)
  async function handleIssuePI() {
    if (!piNumberInput.trim()) { alert('Enter a PI number.'); return }
    if (!piPdfFile) { alert('Attach the Proforma Invoice PDF before issuing.'); return }
    setSaving(true)
    let piPdfUrl = null
    try { piPdfUrl = await uploadPdf(piPdfFile, `pi/${id}`) } catch { alert('PDF upload failed. Please try again.'); setSaving(false); return }
    if (activeBatch) {
      await sb.from('order_dispatches').update({
        pi_number: piNumberInput.trim(), pi_pdf_url: piPdfUrl, updated_at: new Date().toISOString()
      }).eq('id', activeBatch.id)
    }
    await sb.from('orders').update({ status: 'pi_generated', updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`Proforma Invoice issued — ${piNumberInput.trim()}. Awaiting customer payment.`)
    setSaving(false); await loadOrder()
  }

  // PI STEP 2: pi_generated → pi_payment_pending (mark as sent / awaiting payment)
  async function handlePIAwaitPayment() {
    setSaving(true)
    await sb.from('orders').update({ status: 'pi_payment_pending', updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`PI shared with customer — payment pending.`)
    setSaving(false); await loadOrder()
  }

  // PI STEP 3: pi_payment_pending → delivery_created (back to FC for picking/packing/goods issued)
  async function handleConfirmPIPayment() {
    setSaving(true)
    if (activeBatch) {
      await sb.from('order_dispatches').update({
        ...(paymentRef.trim() ? { pi_payment_ref: paymentRef.trim() } : {}),
        updated_at: new Date().toISOString()
      }).eq('id', activeBatch.id)
    }
    await sb.from('orders').update({ status: 'delivery_created', updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`PI Payment confirmed${paymentRef.trim() ? ' — Ref: ' + paymentRef.trim() : ''}. Order returned to Fulfilment Centre for picking & dispatch.`)
    setSaving(false); await loadOrder()
  }

  // goods_issued + PI order → auto-pass credit check (payment already collected via PI)
  async function handlePICreditAutoPass() {
    setSaving(true)
    if (activeBatch) await sb.from('order_dispatches').update({ status: 'credit_check', credit_override: false, updated_at: new Date().toISOString() }).eq('id', activeBatch.id)
    await sb.from('orders').update({ status: 'credit_check', credit_override: false, updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity('PI Order — Credit check auto-passed. Payment was collected upfront via Proforma Invoice.')
    setSaving(false); await loadOrder()
  }

  // STEP 4: delivery_ready → eway_generated
  async function confirmEwayBill() {
    if (!ewayNumber.trim()) { alert('Enter E-Way Bill number.'); return }
    setSaving(true)
    let ewayPdfUrl = null
    if (ewayPdfFile) {
      try { ewayPdfUrl = await uploadPdf(ewayPdfFile, `eway/${id}`) } catch { alert('E-Way PDF upload failed. Please try again.'); setSaving(false); return }
    }
    if (activeBatch) {
      await sb.from('order_dispatches').update({
        status: 'eway_generated', eway_bill_number: ewayNumber.trim(),
        ...(ewayPdfUrl && { eway_pdf_url: ewayPdfUrl }),
        updated_at: new Date().toISOString()
      }).eq('id', activeBatch.id)
    }
    await sb.from('orders').update({
      status: 'eway_generated', eway_bill_number: ewayNumber.trim(),
      ...(ewayPdfUrl && { eway_pdf_url: ewayPdfUrl }),
      updated_at: new Date().toISOString()
    }).eq('id', id)
    await logActivity(`E-Way Bill generated — #${ewayNumber.trim()}. Handed to FC for final delivery.`)
    setSaving(false); await loadOrder()
    navigate('/billing')
  }

  if (loading) return (
    <Layout pageTitle="Billing — Order Detail" pageKey="billing">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div>
    </Layout>
  )
  if (!order) return null

  const pipelineIdx   = billingPipelineIdx(order.status)
  const piPhaseIdx    = piPipelineIdx(order.status)
  const isPIOrder     = activeBatch?.pi_required === true
  const activePINum   = activeBatch?.pi_number || null
  const activePIPdf   = activeBatch?.pi_pdf_url || null
  const isInPIPhase   = ['pi_requested','pi_generated','pi_payment_pending'].includes(order.status)
  // Prefer batch-level DC/INV (new system); fall back to order columns (legacy)
  const activeDC      = activeBatch?.dc_number || order.dc_number
  const activeINV     = activeBatch?.invoice_number || order.invoice_number
  const activeEway    = activeBatch?.eway_bill_number || order.eway_bill_number
  const isTempInv     = activeINV?.startsWith('Temp/')
  const isTempDC      = activeDC?.startsWith('Temp/')
  const isWaitingFC   = order.status === 'invoice_generated'
  const isCreditOverride  = (activeBatch?.credit_override ?? order.credit_override) === true
  const activeInvPdfUrl   = activeBatch?.invoice_pdf_url || order.invoice_pdf_url || null
  const activeEwayPdfUrl  = activeBatch?.eway_pdf_url    || order.eway_pdf_url    || null

  // Items: normalize to {item_code, qty, unit_price, total_price} regardless of source
  const billingItems = activeBatch?.dispatched_items
    ? activeBatch.dispatched_items.map((i, idx) => ({
        sr_no: idx + 1, item_code: i.item_code, qty: i.qty,
        unit_price: i.unit_price, total_price: i.total_price || (i.unit_price * i.qty),
      }))
    : (order.order_items || []).filter(i => (i.dispatched_qty || 0) > 0).map((i, idx) => ({
        sr_no: idx + 1, item_code: i.item_code, qty: i.dispatched_qty,
        unit_price: i.unit_price_after_disc,
        total_price: (i.unit_price_after_disc || 0) * (i.dispatched_qty || 0),
      }))
  const dispatchedSubtotal = billingItems.reduce((s, i) => s + (i.total_price || 0), 0)
  const dispatchedTotal    = dispatchedSubtotal + (order.freight || 0)

  return (
    <Layout pageTitle="Billing Module" pageKey="billing">
    <div className="od-page">
      <div className="od-body">

        {/* ── Header ── */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  {order.order_type === 'SO' ? 'Standard Order' : 'Customised Order'}
                  &nbsp;·&nbsp;{order.fulfilment_center || '—'}
                  <span className={'od-status-badge ' + (isWaitingFC ? 'delivery' : isCreditOverride ? 'pending' : 'active')}>
                    {isWaitingFC ? 'Waiting for FC' : isCreditOverride ? '⚠️ Credit Override' : 'Billing'}
                  </span>
                  {isCreditOverride && (
                    <span style={{marginLeft:8,background:'#fee2e2',color:'#be123c',borderRadius:6,padding:'2px 8px',fontSize:11,fontWeight:700}}>
                      CREDIT OVERRIDE
                    </span>
                  )}
                </div>
                <div className="od-header-title"><span onClick={goToCustomer} style={{cursor:'pointer',borderBottom:'1px dotted #1a4dab',color:'inherit'}}>{order.customer_name}</span></div>
                <div className="od-header-num" style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'center'}}>
                  <button
                    onClick={() => navigate('/orders/' + id)}
                    style={{background:'none',border:'none',padding:0,cursor:'pointer',fontFamily:'inherit',fontSize:'inherit',color:'#1a4dab',fontWeight:600,textDecoration:'underline'}}
                  >
                    {order.order_number}
                  </button>
                  <span>·</span>
                  <span>{fmt(order.order_date)}</span>
                  {activeDC && (
                    <span style={{fontFamily:'var(--mono)',color:isTempDC?'#92400e':'#166534',fontWeight:700}}>
                      DC: {activeDC}
                      {isTempDC && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 5px',marginLeft:6,fontWeight:600}}>TEMP</span>}
                    </span>
                  )}
                  {activeINV && (
                    <span style={{fontFamily:'var(--mono)',color:isTempInv?'#92400e':'#166534',fontWeight:700}}>
                      INV: {activeINV}
                      {isTempInv && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 5px',marginLeft:6,fontWeight:600}}>TEMP</span>}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="od-header-actions">
              <button className="od-btn" onClick={() => navigate('/billing')} style={{gap:6}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
            </div>
          </div>
        </div>

        {/* ── Pipeline bar ── */}
        {isInPIPhase ? (
          <div className="od-pipeline-bar">
            <div className="od-pipeline-stages">
              {PI_STAGES.map((stage, idx) => {
                const isDone   = piPhaseIdx > idx
                const isActive = piPhaseIdx === idx
                return (
                  <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                    {stage.label}
                  </div>
                )
              })}
              <div className="od-pipe-stage" style={{opacity:0.35}}>Credit Check</div>
              <div className="od-pipe-stage" style={{opacity:0.35}}>GI Posted</div>
              <div className="od-pipe-stage" style={{opacity:0.35}}>Invoice</div>
              <div className="od-pipe-stage" style={{opacity:0.35}}>E-Way Bill</div>
            </div>
          </div>
        ) : (
          <div className="od-pipeline-bar">
            <div className="od-pipeline-stages">
              {BILLING_STAGES.map((stage, idx) => {
                const isDone   = pipelineIdx > idx
                const isActive = pipelineIdx === idx
                return (
                  <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                    {stage.label}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Two-column layout ── */}
        <div className="od-layout">
          <div className="od-main">

            {/* Credit override warning banner */}
            {isCreditOverride && (
              <div className="od-cancelled-banner" style={{background:'#fff1f2',border:'1px solid #fecdd3',color:'#be123c'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <div>
                  <div className="od-cancelled-banner-label">⚠️ Credit Override — Payment Pending</div>
                  <div>This order was processed with a credit override. Payment is outstanding.</div>
                </div>
              </div>
            )}

            {/* Waiting for FC banner */}
            {isWaitingFC && (
              <div className="od-delivery-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                <div>
                  <div className="od-pending-banner-label">Waiting for Fulfilment Centre</div>
                  <div>Invoice generated ({activeINV}). FC team is arranging delivery details.</div>
                </div>
              </div>
            )}

            {/* Document References */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Document References</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field">
                    <label>SO / CO Number</label>
                    <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--blue-800)'}}>{order.order_number}</div>
                  </div>
                  <div className="od-detail-field">
                    <label>Delivery Challan (DC)</label>
                    <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:isTempDC?'#92400e':'#166534'}}>
                      {activeDC || '—'}
                      {isTempDC && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',marginLeft:6,fontWeight:600}}>TEMP</span>}
                    </div>
                  </div>
                  <div className="od-detail-field">
                    <label>Invoice Number</label>
                    <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:isTempInv?'#92400e':'#166534'}}>
                      {activeINV || '—'}
                      {isTempInv && <span style={{fontSize:10,background:'#fef3c7',color:'#92400e',borderRadius:4,padding:'1px 6px',marginLeft:6,fontWeight:600}}>TEMP</span>}
                    </div>
                  </div>
                  {activeEway && (
                    <div className="od-detail-field">
                      <label>E-Way Bill</label>
                      <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700,color:'#166534'}}>{activeEway}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Order Information */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Order Information</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field"><label>Customer Name</label><div className="val"><span onClick={goToCustomer} style={{color:'#1a4dab',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted'}}>{order.customer_name}</span></div></div>
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

            {/* Delivery details from FC */}
            {order.dispatch_mode && (
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-title">Delivery Details (by Fulfilment Centre)</div></div>
                <div className="od-card-body">
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>Mode</label><div className="val">{order.dispatch_mode}</div></div>
                    {order.vehicle_number && <div className="od-detail-field"><label>Vehicle Number</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{order.vehicle_number}</div></div>}
                    {order.driver_name    && <div className="od-detail-field"><label>Driver Name</label><div className="val">{order.driver_name}</div></div>}
                  </div>
                </div>
              </div>
            )}

            {/* Items — DISPATCHED QTY ONLY */}
            <div className="od-card">
              <div className="od-card-header">
                <div className="od-card-title">
                  {activeBatch ? `Batch ${activeBatch.batch_no} Items (${billingItems.length})` : `Dispatched Items (${billingItems.length})`}
                  <span style={{fontSize:11,color:'var(--gray-500)',fontWeight:400,marginLeft:8}}>billing based on dispatched qty only</span>
                </div>
              </div>
              <div className="od-card-body" style={{padding:0}}>
                <div className="od-items-table-wrap">
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Item Code</th>
                        <th style={{textAlign:'right',color:'#166534',fontWeight:700}}>Qty</th>
                        <th style={{textAlign:'right'}}>Unit Price</th>
                        <th style={{textAlign:'right'}}>Billing Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingItems.map(item => (
                        <tr key={item.sr_no}>
                          <td className="od-items-sr">{item.sr_no}</td>
                          <td><span className="od-items-code">{item.item_code}</span></td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#166534'}}>{item.qty}</td>
                          <td style={{textAlign:'right'}}>₹{item.unit_price}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>₹{(item.total_price||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</td>
                        </tr>
                      ))}
                      {billingItems.length === 0 && (
                        <tr><td colSpan={5} style={{textAlign:'center',padding:20,color:'var(--gray-400)',fontSize:13}}>No dispatched items yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="od-totals">
                  <div className="od-totals-inner">
                    <div className="od-totals-row"><span>Dispatched Subtotal</span><span>₹{dispatchedSubtotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    <div className="od-totals-row"><span>Freight</span><span>₹{(order.freight||0).toLocaleString('en-IN')}</span></div>
                    <div className="od-totals-row grand"><span>Billing Total</span><span>₹{dispatchedTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── PI Action Cards ── */}
            {isInPIPhase && ['accounts','admin'].includes(user.role) && (
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">
                    {order.status === 'pi_requested'       && 'Action — Issue Proforma Invoice'}
                    {order.status === 'pi_generated'       && 'Action — Confirm PI Sent to Customer'}
                    {order.status === 'pi_payment_pending' && 'Action — Confirm Payment Received'}
                  </div>
                </div>
                <div className="od-card-body">

                  {/* PI STEP 1: Issue PI */}
                  {order.status === 'pi_requested' && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>
                        Generate and upload the Proforma Invoice PDF for this order.
                        {order.credit_terms && <><br/><span style={{color:'var(--gray-400)'}}>Credit Terms: {order.credit_terms}</span></>}
                      </p>
                      <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:400}}>
                        <div className="od-edit-field">
                          <label>PI Number</label>
                          <input type="text" placeholder="e.g. PI-2026-0001" value={piNumberInput} onChange={e => setPiNumberInput(e.target.value)} />
                        </div>
                        <div>
                          <label style={{fontSize:12,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                            Proforma Invoice PDF <span style={{color:'#dc2626'}}>*</span>
                          </label>
                          <input type="file" accept=".pdf" onChange={e => {
                            const f = e.target.files[0] || null
                            const err = validatePdf(f)
                            setPiPdfError(err || '')
                            setPiPdfFile(err ? null : f)
                          }} style={{fontSize:12,color:'var(--gray-700)',width:'100%'}} />
                          {piPdfError && <div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠ {piPdfError}</div>}
                          {!piPdfFile && !piPdfError && <div style={{fontSize:11,color:'#dc2626',marginTop:4}}>Required — attach the PI PDF</div>}
                          {piPdfFile && <div style={{fontSize:11,color:'#166534',marginTop:4}}>✓ {piPdfFile.name}</div>}
                        </div>
                        <button
                          disabled={saving || !piPdfFile || !piNumberInput.trim()}
                          onClick={handleIssuePI}
                          style={{padding:'10px 20px',borderRadius:10,border:'none',background:(!piPdfFile||!piNumberInput.trim())?'var(--gray-200)':'#7e22ce',color:(!piPdfFile||!piNumberInput.trim())?'var(--gray-400)':'white',fontWeight:600,fontSize:13,cursor:(!piPdfFile||!piNumberInput.trim())?'default':'pointer',fontFamily:'var(--font)',alignSelf:'flex-start'}}>
                          {saving ? 'Uploading...' : 'Issue Proforma Invoice'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PI STEP 2: Confirm PI sent to customer */}
                  {order.status === 'pi_generated' && (
                    <div>
                      {activePINum && (
                        <div style={{background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,padding:'10px 14px',marginBottom:14}}>
                          <div style={{fontSize:11,color:'#7e22ce',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:3}}>Proforma Invoice</div>
                          <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:800,color:'#7e22ce'}}>{activePINum}</div>
                          {activePIPdf && (
                            <a href={activePIPdf} target="_blank" rel="noreferrer"
                              style={{fontSize:11,color:'#7e22ce',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:4,textDecoration:'none'}}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              View PI PDF
                            </a>
                          )}
                        </div>
                      )}
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Share the PI with the customer and confirm once sent. Order will move to "Payment Pending" stage.</p>
                      <button
                        disabled={saving}
                        onClick={handlePIAwaitPayment}
                        style={{padding:'10px 20px',borderRadius:10,border:'none',background:'#7e22ce',color:'white',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'var(--font)'}}>
                        {saving ? 'Saving...' : 'PI Shared — Awaiting Customer Payment'}
                      </button>
                    </div>
                  )}

                  {/* PI STEP 3: Confirm payment received */}
                  {order.status === 'pi_payment_pending' && (
                    <div>
                      {activePINum && (
                        <div style={{background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,padding:'10px 14px',marginBottom:14}}>
                          <div style={{fontSize:11,color:'#7e22ce',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:3}}>Proforma Invoice</div>
                          <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:800,color:'#7e22ce'}}>{activePINum}</div>
                          {activePIPdf && (
                            <a href={activePIPdf} target="_blank" rel="noreferrer"
                              style={{fontSize:11,color:'#7e22ce',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:4,textDecoration:'none'}}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              View PI PDF
                            </a>
                          )}
                        </div>
                      )}
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:12}}>
                        Confirm that payment has been received from the customer. Credit check will be auto-passed.
                      </p>
                      <div style={{maxWidth:380,marginBottom:14}}>
                        <div className="od-edit-field">
                          <label>Payment Reference <span style={{fontWeight:400,color:'var(--gray-400)'}}>(optional)</span></label>
                          <input type="text" placeholder="e.g. NEFT ref, cheque no., UTR…" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                        </div>
                      </div>
                      <button
                        disabled={saving}
                        onClick={handleConfirmPIPayment}
                        style={{padding:'10px 20px',borderRadius:10,border:'none',background:'#166534',color:'white',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'var(--font)',display:'inline-flex',alignItems:'center',gap:8}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        {saving ? 'Saving...' : 'Confirm Payment Received'}
                      </button>
                    </div>
                  )}

                </div>
              </div>
            )}

            {/* ── Action Card ── */}
            {!isWaitingFC && !isInPIPhase && ['accounts','admin'].includes(user.role) && (
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">
                    {order.status === 'goods_issued'       && 'Action — Credit Check'}
                    {order.status === 'credit_check'       && 'Action — Post Goods Issue'}
                    {order.status === 'goods_issue_posted' && 'Action — Generate Invoice'}
                    {order.status === 'delivery_ready'     && 'Action — E-Way Bill'}
                  </div>
                </div>
                <div className="od-card-body">

                  {/* STEP 1: Credit Check — PI Order (auto-pass) */}
                  {order.status === 'goods_issued' && isPIOrder && (
                    <div>
                      <div style={{background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:10,padding:'12px 16px',marginBottom:14}}>
                        <div style={{fontSize:12,fontWeight:700,color:'#7e22ce',marginBottom:4}}>PI Order — Payment Collected Upfront</div>
                        {activePINum && <div style={{fontFamily:'var(--mono)',fontSize:13,color:'#7e22ce',marginBottom:2}}>{activePINum}</div>}
                        <div style={{fontSize:12,color:'var(--gray-500)'}}>Payment was received before dispatch. Credit check can be auto-passed.</div>
                      </div>
                      <button
                        disabled={saving}
                        onClick={handlePICreditAutoPass}
                        style={{padding:'10px 20px',borderRadius:10,border:'none',background:'#166534',color:'white',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'var(--font)',display:'inline-flex',alignItems:'center',gap:8}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:15,height:15}}><polyline points="20 6 9 17 4 12"/></svg>
                        {saving ? 'Saving...' : 'Auto-pass Credit Check'}
                      </button>
                    </div>
                  )}

                  {/* STEP 1: Credit Check — Normal Order */}
                  {order.status === 'goods_issued' && !isPIOrder && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:6}}>
                        Does this customer have a pending payment?
                        {order.credit_terms && <><br/><span style={{color:'var(--gray-400)'}}>Credit Terms: {order.credit_terms}</span></>}
                      </p>
                      <div style={{display:'flex',gap:8,marginBottom:14}}>
                        <button
                          onClick={() => setCreditChoice('override')}
                          style={{flex:1,padding:'10px 14px',borderRadius:10,border:'2px solid',borderColor:creditChoice==='override'?'#dc2626':'var(--gray-200)',background:creditChoice==='override'?'#fef2f2':'white',color:creditChoice==='override'?'#dc2626':'var(--gray-600)',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'var(--font)'}}>
                          ⚠️ Pending Payment — Take Approval
                        </button>
                        <button
                          onClick={() => setCreditChoice('clear')}
                          style={{flex:1,padding:'10px 14px',borderRadius:10,border:'2px solid',borderColor:creditChoice==='clear'?'#16a34a':'var(--gray-200)',background:creditChoice==='clear'?'#f0fdf4':'white',color:creditChoice==='clear'?'#16a34a':'var(--gray-600)',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'var(--font)'}}>
                          ✓ No Pending Payment — Go Ahead
                        </button>
                      </div>
                      <button
                        disabled={!creditChoice || saving}
                        onClick={() => creditChoice === 'override' ? handleCreditCheckYes() : handleCreditCheckClear()}
                        style={{padding:'10px 20px',borderRadius:10,border:'none',background:!creditChoice?'var(--gray-200)':'#1a4dab',color:!creditChoice?'var(--gray-400)':'white',fontWeight:600,fontSize:13,cursor:!creditChoice?'default':'pointer',fontFamily:'var(--font)'}}>
                        {saving ? 'Saving...' : 'Credit Check'}
                      </button>
                    </div>
                  )}

                  {/* STEP 2: GI Posted */}
                  {order.status === 'credit_check' && !showGIConfirm && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Post the Goods Issue entry in the system.</p>
                      <button className="od-mark-complete-btn" style={{background:'#1a4dab',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setShowGIConfirm(true)}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Post Goods Issue
                      </button>
                    </div>
                  )}
                  {order.status === 'credit_check' && showGIConfirm && (
                    <div style={{background:'#e8f2fc',border:'1px solid #c2d9f5',borderRadius:10,padding:16}}>
                      <p style={{fontSize:13,color:'#1a4dab',fontWeight:600,marginBottom:4}}>Confirm Goods Issue Posted?</p>
                      <p style={{fontSize:12,color:'var(--gray-500)',marginBottom:14}}>A temporary invoice number will be assigned (Temp/INV…).</p>
                      <div style={{display:'flex',gap:8}}>
                        <button className="od-btn od-btn-approve" disabled={saving} onClick={advanceGIPosted}>{saving?'Saving...':'Confirm'}</button>
                        <button className="od-btn" onClick={() => setShowGIConfirm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* STEP 3: Generate Invoice */}
                  {order.status === 'goods_issue_posted' && !showInvConfirm && (
                    <div>
                      {activeINV && (
                        <div style={{background:'#fef3c7',border:'1px solid #fde68a',borderRadius:8,padding:'10px 14px',marginBottom:14}}>
                          <div style={{fontSize:11,color:'#92400e',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.8px',marginBottom:3}}>Temp Invoice Number</div>
                          <div style={{fontFamily:'var(--mono)',fontSize:16,fontWeight:800,color:'#92400e'}}>{activeINV}</div>
                          <div style={{fontSize:11,color:'#92400e',marginTop:2}}>Will become {activeINV.replace('Temp/','SSC/')} on confirmation</div>
                        </div>
                      )}
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Generate final invoice and hand to FC for delivery arrangement.</p>
                      <button className="od-mark-complete-btn" style={{background:'#166534',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8}}
                        onClick={() => setShowInvConfirm(true)}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                        Generate Invoice
                      </button>
                    </div>
                  )}
                  {order.status === 'goods_issue_posted' && showInvConfirm && (
                    <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:10,padding:16}}>
                      <p style={{fontSize:13,color:'#166534',fontWeight:600,marginBottom:4}}>Confirm Invoice Generated?</p>
                      <p style={{fontSize:12,color:'var(--gray-500)',marginBottom:14}}>
                        Invoice will be finalised as <strong>{activeINV?.replace('Temp/','SSC/')}</strong>. Order moves to FC for delivery details.
                      </p>
                      <div style={{marginBottom:14}}>
                        <label style={{fontSize:12,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                          Invoice PDF <span style={{color:'#dc2626'}}>*</span>
                        </label>
                        <input type="file" accept=".pdf" onChange={e => {
                          const f = e.target.files[0] || null
                          const err = validatePdf(f)
                          setInvoicePdfError(err || '')
                          setInvoicePdfFile(err ? null : f)
                        }} style={{fontSize:12,color:'var(--gray-700)',width:'100%'}} />
                        {invoicePdfError && (
                          <div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠ {invoicePdfError}</div>
                        )}
                        {!invoicePdfFile && !invoicePdfError && (
                          <div style={{fontSize:11,color:'#dc2626',marginTop:4}}>Required — attach the invoice PDF before confirming</div>
                        )}
                        {invoicePdfFile && (
                          <div style={{fontSize:11,color:'#166534',marginTop:4}}>✓ {invoicePdfFile.name}</div>
                        )}
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <button className="od-btn od-btn-approve" disabled={saving || !invoicePdfFile} onClick={confirmInvoiceGenerated}>{saving?'Uploading & Saving...':'Confirm'}</button>
                        <button className="od-btn" onClick={() => { setShowInvConfirm(false); setInvoicePdfFile(null) }}>Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* STEP 4: E-Way Bill */}
                  {order.status === 'delivery_ready' && (
                    <div>
                      <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:6}}>
                        FC has confirmed delivery details. Enter E-Way Bill number.
                      </p>
                      {order.dispatch_mode && (
                        <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:12,color:'#166534'}}>
                          {order.dispatch_mode}{order.vehicle_number ? ` · ${order.vehicle_number}` : ''}{order.driver_name ? ` · Driver: ${order.driver_name}` : ''}
                        </div>
                      )}
                      <div style={{display:'flex',flexDirection:'column',gap:10,maxWidth:380}}>
                        <div className="od-edit-field">
                          <label>E-Way Bill Number</label>
                          <input type="text" placeholder="Enter E-Way Bill number" value={ewayNumber} onChange={e => setEwayNumber(e.target.value)} />
                        </div>
                        <div>
                          <label style={{fontSize:12,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                            E-Way Bill PDF <span style={{fontSize:11,color:'var(--gray-400)',fontWeight:400}}>(optional)</span>
                          </label>
                          <input type="file" accept=".pdf" onChange={e => {
                            const f = e.target.files[0] || null
                            const err = validatePdf(f)
                            setEwayPdfError(err || '')
                            setEwayPdfFile(err ? null : f)
                          }} style={{fontSize:12,color:'var(--gray-700)',width:'100%'}} />
                          {ewayPdfError && (
                            <div style={{fontSize:11,color:'#dc2626',marginTop:4}}>⚠ {ewayPdfError}</div>
                          )}
                          {ewayPdfFile && (
                            <div style={{fontSize:11,color:'#166534',marginTop:4}}>✓ {ewayPdfFile.name}</div>
                          )}
                        </div>
                        <button className="od-mark-complete-btn" style={{background:'#15803d',padding:'10px 20px',borderRadius:10,border:'none',color:'white',fontFamily:'var(--font)',fontSize:13,fontWeight:600,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,alignSelf:'flex-start'}}
                          onClick={confirmEwayBill} disabled={saving}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:16,height:16}}><polyline points="20 6 9 17 4 12"/></svg>
                          {saving ? 'Uploading & Saving...' : 'Generate E-Way Bill'}
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              </div>
            )}

          </div>{/* end od-main */}

          {/* ── Sidebar ── */}
          <div className="od-sidebar">

            {/* Numbers card */}
            <div className="od-side-card">
              <div className="od-side-card-title">Key Numbers</div>
              <div style={{padding:'0 16px 16px',display:'flex',flexDirection:'column',gap:12}}>
                <div>
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>SO / CO Number</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:800,color:'var(--blue-800)'}}>{order.order_number}</div>
                </div>
                {isPIOrder && (
                  <div>
                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Proforma Invoice</div>
                    <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:800,color:activePINum?'#7e22ce':'var(--gray-400)'}}>
                      {activePINum || '—'}
                    </div>
                    {!activePINum && <div style={{fontSize:10,color:'var(--gray-400)'}}>Pending issuance</div>}
                    {activePIPdf && (
                      <a href={activePIPdf} target="_blank" rel="noreferrer"
                        style={{fontSize:11,color:'#7e22ce',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:3,textDecoration:'none'}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        View PI PDF
                      </a>
                    )}
                  </div>
                )}
                <div>
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Delivery Challan</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:800,color:isTempDC?'#92400e':'#166534'}}>
                    {activeDC || '—'}
                  </div>
                  {isTempDC && <div style={{fontSize:10,color:'#92400e',fontWeight:600}}>Temp DC</div>}
                </div>
                <div>
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Invoice Number</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:800,color:isTempInv?'#92400e':activeINV?'#166534':'var(--gray-400)'}}>
                    {activeINV || '—'}
                  </div>
                  {isTempInv && <div style={{fontSize:10,color:'#92400e',fontWeight:600}}>Temp — confirms on invoice generation</div>}
                  {!isTempInv && activeINV && <div style={{fontSize:10,color:'#166534',fontWeight:600}}>Confirmed</div>}
                  {activeInvPdfUrl && (
                    <a href={activeInvPdfUrl} target="_blank" rel="noreferrer"
                      style={{fontSize:11,color:'#1a4dab',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:3,textDecoration:'none'}}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      View Invoice PDF
                    </a>
                  )}
                </div>
                {activeEway && (
                  <div>
                    <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>E-Way Bill</div>
                    <div style={{fontFamily:'var(--mono)',fontSize:14,fontWeight:800,color:'#166534'}}>{activeEway}</div>
                    {activeEwayPdfUrl && (
                      <a href={activeEwayPdfUrl} target="_blank" rel="noreferrer"
                        style={{fontSize:11,color:'#1a4dab',fontWeight:600,display:'inline-flex',alignItems:'center',gap:4,marginTop:3,textDecoration:'none'}}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002 2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        View E-Way PDF
                      </a>
                    )}
                  </div>
                )}
                <div style={{paddingTop:12,borderTop:'1px solid var(--gray-100)'}}>
                  <div style={{fontSize:10,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)',fontWeight:600,marginBottom:3}}>Billing Total</div>
                  <div style={{fontSize:20,fontWeight:800,color:'var(--gray-900)',letterSpacing:'-0.5px'}}>
                    ₹{dispatchedTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}
                  </div>
                  <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>Based on dispatched qty</div>
                </div>
                {isCreditOverride && (
                  <div style={{background:'#fff1f2',border:'1px solid #fecdd3',borderRadius:8,padding:'8px 10px'}}>
                    <div style={{fontSize:11,color:'#be123c',fontWeight:700}}>⚠️ CREDIT OVERRIDE</div>
                    <div style={{fontSize:11,color:'#be123c',marginTop:2}}>Payment pending — approved with override</div>
                  </div>
                )}
              </div>
            </div>

            {/* Activity */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">
                {comments.length === 0 && <div style={{fontSize:12,color:'var(--gray-400)',padding:'8px 0'}}>No activity yet</div>}
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

          </div>
        </div>
      </div>
    </div>

    </Layout>
  )
}
