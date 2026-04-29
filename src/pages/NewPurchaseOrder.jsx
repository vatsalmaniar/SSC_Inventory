import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { FY_START } from '../lib/fmt'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import '../styles/neworder.css'
import { friendlyError } from '../lib/errorMsg'

const FC_ADDRESSES = {
  Kaveri: 'SSC Control Pvt Ltd, 17(A) Ashwamegh Warehouse, Behind New Ujala Hotel, Sarkhej Bavla Highway, Sarkhej, Ahmedabad, Gujarat 382210',
  Godawari: 'SSC Control Pvt Ltd, 31 GIDC Estate, B/h Bank Of, Makarpura, Vadodara, Gujarat 390010',
}

function emptyItem() {
  return { item_code: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', delivery_date: '', order_item_id: null }
}

export default function NewPurchaseOrder() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orderId = searchParams.get('order_id')

  const [user, setUser]         = useState({ name: '', avatar: '', role: '', id: '' })
  const [submitting, setSubmitting] = useState(false)

  // Vendor
  const [vendorText, setVendorText] = useState('')
  const [vendorId, setVendorId]     = useState('')
  const [vendorName, setVendorName] = useState('')
  const [vendorPaymentTerms, setVendorPaymentTerms] = useState('')

  // PO header
  const [poType, setPoType]                 = useState('SO')
  const [poDate, setPoDate]                 = useState(new Date().toISOString().slice(0, 10))
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [sscCoNo, setSscCoNo]               = useState('')
  const [notes, setNotes]                   = useState('')
  const [purchaseRequisition, setPurchaseRequisition] = useState('')
  const [fulfilmentCenter, setFulfilmentCenter] = useState('')
  const [deliveryCustText, setDeliveryCustText] = useState('')
  const [deliveryCustName, setDeliveryCustName] = useState('')
  const [deliveryAddress, setDeliveryAddress]   = useState('')

  // Test mode
  const [isTest, setIsTest] = useState(false)

  // CO order prefill
  const [coOrder, setCOOrder] = useState(null)
  const [coText, setCOText] = useState('')
  const [sscNotes, setSscNotes] = useState('')

  // Document uploads (multiple)
  const [poFiles, setPoFiles] = useState([])

  // Items
  const [items, setItems] = useState([emptyItem(), emptyItem(), emptyItem()])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    if (!['ops','admin','management'].includes(role)) { navigate('/dashboard'); return }
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role, id: session.user.id })

    // If creating from a CO order via URL param, pre-fill
    if (orderId) {
      setPoType('CO')
      await loadCOOrder(orderId)
    }
  }

  async function fetchPendingCOs(q) {
    // Search CO orders by order_number or customer_name
    const { data: coOrders } = await sb.from('orders')
      .select('id,order_number,customer_name,order_items(id)')
      .eq('order_type', 'CO')
      .eq('is_test', false)
      .in('status', ['inv_check', 'inventory_check', 'dispatch', 'pending', 'confirmed'])
      .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
      .order('created_at', { ascending: false })
      .limit(20)
    if (!coOrders?.length) return []

    // Check item-level coverage — show COs that still have uncovered items
    const coIds = coOrders.map(o => o.id)
    const { data: linkedPos } = await sb.from('purchase_orders').select('id,order_id').in('order_id', coIds)
    if (!linkedPos?.length) return coOrders

    const poIds = linkedPos.map(p => p.id)
    const { data: poItems } = await sb.from('po_items').select('order_item_id').in('po_id', poIds).not('order_item_id', 'is', null)
    const coveredSet = new Set((poItems || []).map(pi => pi.order_item_id))

    return coOrders.filter(o => {
      const totalItems = (o.order_items || []).length
      if (!totalItems) return true
      const coveredCount = (o.order_items || []).filter(oi => coveredSet.has(oi.id)).length
      return coveredCount < totalItems // show if any items still uncovered
    })
  }

  async function loadCOOrder(coId) {
    const { data: order } = await sb.from('orders')
      .select('id,order_number,customer_name,order_items(id,item_code,qty,lp_unit_price,discount_pct,unit_price_after_disc,total_price,dispatch_date)')
      .eq('id', coId).single()
    if (!order) return

    // Find which CO items already have POs (item-level coverage)
    const { data: existingPos } = await sb.from('purchase_orders').select('id').eq('order_id', coId)
    let coveredSet = new Set()
    if (existingPos?.length) {
      const poIds = existingPos.map(p => p.id)
      const { data: poItems } = await sb.from('po_items').select('order_item_id').in('po_id', poIds).not('order_item_id', 'is', null)
      coveredSet = new Set((poItems || []).map(pi => pi.order_item_id))
    }

    const allItems = order.order_items || []
    const uncovered = allItems.filter(oi => !coveredSet.has(oi.id))
    const coveredCount = allItems.length - uncovered.length

    setCOOrder({ ...order, _coveredCount: coveredCount, _totalItems: allItems.length })
    setCOText(order.order_number + ' — ' + order.customer_name)
    setSscCoNo(order.order_number)
    setSscNotes(`Customer: ${order.customer_name}`)

    if (!uncovered.length) {
      // All items already covered — show empty state
      setItems([emptyItem()])
      return
    }

    const prefilled = uncovered.map(oi => ({
      order_item_id: oi.id,
      item_code: oi.item_code || '',
      qty: String(oi.qty || ''),
      lp_unit_price: String(oi.lp_unit_price || ''),
      discount_pct: String(oi.discount_pct || '0'),
      unit_price_after_disc: String(oi.unit_price_after_disc || ''),
      total_price: String(oi.total_price || ''),
      delivery_date: oi.dispatch_date || '',
    }))
    setItems(prefilled)
  }

  function selectCO(co) {
    loadCOOrder(co.id)
  }

  function handlePoTypeChange(type) {
    setPoType(type)
    if (type !== 'CO') {
      setCOOrder(null)
      setCOText('')
      setSscCoNo('')
      setSscNotes('')
      setItems([emptyItem(), emptyItem(), emptyItem()])
    }
  }

  async function fetchVendors(q) {
    const { data } = await sb.from('vendors').select('id,vendor_code,vendor_name,credit_terms')
      .eq('status','active').eq('is_test', false)
      .or(`vendor_name.ilike.%${q}%,vendor_code.ilike.%${q}%`).order('vendor_name').limit(20)
    return data || []
  }

  function selectVendor(v) {
    setVendorText(v.vendor_name)
    setVendorId(v.id)
    setVendorName(v.vendor_name)
    setVendorPaymentTerms(v.credit_terms || '')
  }

  function handlePoFiles(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const valid = []
    for (const f of files) {
      if (f.size > 200 * 1024) { toast(`${f.name} is too large (max 200 KB)`); continue }
      valid.push(f)
    }
    if (valid.length) setPoFiles(prev => [...prev, ...valid])
    e.target.value = ''
  }

  function removePoFile(idx) {
    setPoFiles(prev => prev.filter((_, i) => i !== idx))
  }

  async function fetchCustomers(q) {
    const { data } = await sb.from('customers').select('id,customer_id,customer_name,shipping_address,gst')
      .ilike('customer_name', '%' + q + '%').order('customer_name').limit(20)
    return data || []
  }

  function selectDeliveryCustomer(c) {
    setDeliveryCustText(c.customer_name)
    setDeliveryCustName(c.customer_name)
    setDeliveryAddress(c.shipping_address || '')
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items')
      .select('item_code,brand,category')
      .or(`item_code.ilike.%${q}%,brand.ilike.%${q}%`)
      .order('item_code')
      .limit(15)
    return data || []
  }

  function selectItemCode(idx, item) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], item_code: item.item_code }
      return next
    })
  }

  function updateItem(idx, field, value) {
    setItems(prev => {
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

  function addRow()       { setItems(prev => [...prev, emptyItem()]) }
  function removeRow(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  const filledItems = items.filter(i => i.item_code.trim())
  const grandTotal  = filledItems.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)
  const isCO = poType === 'CO'

  async function submitPO(submitForApproval) {
    if (!vendorId)          { toast('Please select a vendor'); return }
    if (isCO && !coOrder)   { toast('Please select a Custom Order (SSC CO No.)'); return }
    if (!fulfilmentCenter)  { toast('Please select a delivery address'); return }
    if (fulfilmentCenter === 'Customer' && !deliveryCustName) { toast('Please select a customer for delivery address'); return }
    if (!filledItems.length){ toast('Add at least one line item'); return }
    for (const item of filledItems) {
      if (!item.qty || parseFloat(item.qty) <= 0) { toast(`Qty is required for item: ${item.item_code}`); return }
      if (item.lp_unit_price === '' || item.lp_unit_price === undefined || parseFloat(item.lp_unit_price) < 0) { toast(`LP Price is required for item: ${item.item_code}`); return }
      if (!item.delivery_date) { toast(`Delivery Date is required for item: ${item.item_code}`); return }
    }

    setSubmitting(true)

    // Upload documents if provided
    let poDocUrl = null
    if (poFiles.length) {
      const urls = []
      for (const f of poFiles) {
        const ext  = f.name.split('.').pop()
        const path = `purchase-orders/${Date.now()}-${Math.random().toString(36).slice(2,6)}.${ext}`
        const { error: upErr } = await sb.storage.from('po-documents').upload(path, f)
        if (!upErr) {
          const { data: { publicUrl } } = sb.storage.from('po-documents').getPublicUrl(path)
          urls.push(publicUrl)
        }
      }
      poDocUrl = urls.length === 1 ? urls[0] : urls.length > 1 ? JSON.stringify(urls) : null
    }

    try {
      // Temp number — real PO number assigned on approval
      const prefix = isCO ? 'PCO' : 'PO'
      const fyYear = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1
      const fySuffix = `${String(fyYear).slice(2)}-${String(fyYear + 1).slice(2)}`
      const { data: lastPo } = await sb.from('purchase_orders')
        .select('po_number')
        .ilike('po_number', `Temp/${prefix}%/${fySuffix}`)
        .order('created_at', { ascending: false })
        .limit(1)
      let nextSeq = 1
      if (lastPo?.[0]?.po_number) {
        const match = lastPo[0].po_number.match(new RegExp(`Temp/${prefix}(\\d+)/`))
        if (match) nextSeq = parseInt(match[1], 10) + 1
      }
      const tempNum = `Temp/${prefix}${String(nextSeq).padStart(4, '0')}/${fySuffix}`

      const { data: po, error: insertErr } = await sb.from('purchase_orders').insert({
        po_number:         tempNum,
        vendor_id:         vendorId,
        vendor_name:       vendorName,
        order_id:          coOrder?.id || orderId || null,
        order_number:      coOrder?.order_number || null,
        status:            submitForApproval ? 'pending_approval' : 'draft',
        po_date:           poDate,
        expected_delivery: expectedDelivery || null,
        fulfilment_center: fulfilmentCenter === 'Customer' ? 'Customer' : fulfilmentCenter || null,
        delivery_address:  fulfilmentCenter === 'Customer' ? deliveryAddress.trim() || null : FC_ADDRESSES[fulfilmentCenter] || null,
        delivery_customer_name: fulfilmentCenter === 'Customer' ? deliveryCustName || null : null,
        notes:             notes.trim() || null,
        reference:         sscCoNo.trim() || coOrder?.order_number || null,
        ssc_notes:         sscNotes.trim() || null,
        purchase_requisition: purchaseRequisition.trim() || null,
        po_document_url:   poDocUrl,
        total_amount:      grandTotal,
        payment_terms:     vendorPaymentTerms || null,
        created_by:        user.id,
        created_by_name:   user.name,
        submitted_by_name: user.name,
        is_test:           isTest,
      }).select('id').single()

      if (insertErr) { toast(friendlyError(insertErr)); setSubmitting(false); return }

      const lineItems = filledItems.map((item, idx) => ({
        po_id:            po.id,
        sr_no:            idx + 1,
        item_code:        item.item_code.trim(),
        qty:              parseFloat(item.qty),
        lp_unit_price:    parseFloat(item.lp_unit_price) || null,
        discount_pct:     parseFloat(item.discount_pct) || 0,
        unit_price:       parseFloat(item.unit_price_after_disc) || parseFloat(item.lp_unit_price) || 0,
        total_price:      parseFloat(item.total_price),
        delivery_date:    item.delivery_date || null,
        order_item_id:    item.order_item_id || null,
      }))

      const { error: itemsErr } = await sb.from('po_items').insert(lineItems)
      if (itemsErr) toast(friendlyError(itemsErr, "PO created but items failed. Please try again."))

      toast('Purchase Order created — PO number will be assigned on approval', 'success')
      navigate('/procurement/po/' + po.id)
    } catch (err) {
      toast(friendlyError(err))
      setSubmitting(false)
    }
  }

  return (
    <Layout pageTitle="New Purchase Order" pageKey="procurement">
    <div className="no-page">

      <div className="no-body">
        <div className="no-page-title">New Purchase Order</div>
        <div className="no-page-sub">{isCO && coOrder ? `Creating PO against ${coOrder.order_number} — ${coOrder.customer_name}` : 'Fill in the details below to create a new purchase order.'}</div>

        {/* ── CO Order Info Banner ── */}
        {isCO && coOrder && (
          <div style={{ display:'flex', alignItems:'center', gap:10, background: coOrder._coveredCount > 0 ? '#fffbeb' : '#eff6ff', border: coOrder._coveredCount > 0 ? '1px solid #fde68a' : '1px solid #bfdbfe', borderRadius:10, padding:'12px 16px', marginBottom:4 }}>
            <svg fill="none" stroke={coOrder._coveredCount > 0 ? '#b45309' : '#1d4ed8'} strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18, flexShrink:0 }}><path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color: coOrder._coveredCount > 0 ? '#92400e' : '#1e40af' }}>Against Custom Order {coOrder.order_number}</div>
              <div style={{ fontSize:12, color: coOrder._coveredCount > 0 ? '#b45309' : '#3b82f6' }}>
                {coOrder._coveredCount > 0
                  ? `${coOrder._coveredCount}/${coOrder._totalItems} items already have POs — showing ${coOrder._totalItems - coOrder._coveredCount} remaining`
                  : `Customer: ${coOrder.customer_name} — Items auto-filled from order`}
              </div>
            </div>
          </div>
        )}

        {/* ── Vendor Information ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Vendor Information
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>Vendor Name <span className="req">*</span></label>
              <Typeahead
                value={vendorText}
                onChange={v => { setVendorText(v); if (!v.trim()) { setVendorId(''); setVendorName(''); setVendorPaymentTerms('') } }}
                onSelect={selectVendor}
                placeholder="Search vendor by name or code..."
                fetchFn={fetchVendors}
                strictSelect
                renderItem={v => (
                  <>
                    <div className="typeahead-item-main" style={{ display:'flex', alignItems:'center', gap:6 }}>
                      {v.vendor_name}
                      <span style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--mono)' }}>{v.vendor_code}</span>
                    </div>
                  </>
                )}
              />
            </div>
          </div>

          <div className="no-row three">
            <div className="no-field">
              <label>Credit Terms</label>
              <input
                value={vendorPaymentTerms}
                readOnly
                placeholder="Auto-filled on vendor select"
                style={{ background: 'var(--gray-50)', color: vendorPaymentTerms ? 'var(--gray-800)' : 'var(--gray-400)', cursor: 'default' }}
              />
            </div>
            <div className="no-field">
              <label>Delivery Address <span className="req">*</span></label>
              <select value={fulfilmentCenter} onChange={e => {
                setFulfilmentCenter(e.target.value)
                if (e.target.value !== 'Customer') { setDeliveryCustText(''); setDeliveryCustName(''); setDeliveryAddress('') }
              }}>
                <option value="">— Select —</option>
                <option value="Kaveri">Kaveri (Ahmedabad)</option>
                <option value="Godawari">Godawari (Vadodara)</option>
                <option value="Customer">Customer Address</option>
              </select>
            </div>
            <div className="no-field">
              <label>Purchase Requisition From</label>
              <input value={purchaseRequisition} onChange={e => setPurchaseRequisition(e.target.value)} placeholder="Optional — who raised the PR" />
            </div>
          </div>

          {fulfilmentCenter === 'Customer' && (
            <div className="no-row full" style={{ marginTop: 4 }}>
              <div className="no-field">
                <label>Customer Name <span className="req">*</span></label>
                <Typeahead
                  value={deliveryCustText}
                  onChange={v => { setDeliveryCustText(v); if (!v.trim()) { setDeliveryCustName(''); setDeliveryAddress('') } }}
                  onSelect={selectDeliveryCustomer}
                  placeholder="Search customer name..."
                  fetchFn={fetchCustomers}
                  strictSelect
                  renderItem={c => (
                    <div className="typeahead-item-main" style={{ display:'flex', alignItems:'center', gap:6 }}>
                      {c.customer_name}
                      {c.customer_id && <span style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--mono)' }}>{c.customer_id}</span>}
                      {c.gst && <span style={{ fontSize:10, color:'var(--gray-400)' }}>{c.gst}</span>}
                    </div>
                  )}
                />
              </div>
            </div>
          )}

          {fulfilmentCenter && (
            <div className="no-row full" style={{ marginTop: 4 }}>
              <div className="no-field">
                <label>Delivery Address</label>
                {fulfilmentCenter === 'Customer'
                  ? <textarea value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} rows={2} placeholder="Shipping address will auto-fill on customer select — you can edit it" />
                  : <textarea value={FC_ADDRESSES[fulfilmentCenter] || ''} readOnly rows={2} style={{ background:'var(--gray-50)', color:'var(--gray-700)', cursor:'default' }} />
                }
              </div>
            </div>
          )}
        </div>

        {/* ── PO Details ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            PO Details
          </div>

          <div className="no-row three">
            <div className="no-field">
              <label>PO Date <span className="req">*</span></label>
              <input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} />
            </div>
            <div className="no-field">
              <label>PO Type <span className="req">*</span></label>
              <select value={poType} onChange={e => handlePoTypeChange(e.target.value)}>
                <option value="SO">Stock Order (SO)</option>
                <option value="CO">Against Customer Order (CO)</option>
              </select>
            </div>
            <div className="no-field">
              <label>Expected Delivery</label>
              <input type="date" value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)} />
            </div>
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>{isCO ? 'SSC CO No.' : 'PO / Reference Number'} {isCO && <span className="req">*</span>}</label>
              {isCO ? (
                <Typeahead
                  value={coText}
                  onChange={v => { setCOText(v); if (!v.trim()) { setCOOrder(null); setSscCoNo(''); setSscNotes(''); setItems([emptyItem(), emptyItem(), emptyItem()]) } }}
                  onSelect={selectCO}
                  placeholder="Type CO number or customer name..."
                  fetchFn={fetchPendingCOs}
                  strictSelect
                  renderItem={co => (
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600 }}>{co.order_number}</div>
                      <div style={{ fontSize:11, color:'var(--gray-500)' }}>{co.customer_name}</div>
                    </div>
                  )}
                />
              ) : (
                <input value={sscCoNo} onChange={e => setSscCoNo(e.target.value)} placeholder="e.g. Reference, Indent No." />
              )}
            </div>
            <div className="no-field">
              <label>Notes (for Vendor)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions for vendor..." />
            </div>
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>Notes for SSC (Internal)</label>
              <input
                value={sscNotes}
                onChange={e => setSscNotes(e.target.value)}
                placeholder={isCO ? 'Auto-filled with customer name' : 'Internal notes for team reference'}
                style={isCO && coOrder ? { background: 'var(--gray-50)' } : {}}
              />
            </div>
          </div>

          {/* Document Upload — multiple files */}
          <div className="no-row full" style={{ marginTop: 4 }}>
            <div className="no-field">
              <label>Supporting Documents (optional)</label>
              <label className="no-file-label">
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" onChange={handlePoFiles} style={{ display: 'none' }} />
                <div className={'no-file-box' + (poFiles.length ? ' has-file' : '')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>{poFiles.length ? `${poFiles.length} file${poFiles.length > 1 ? 's' : ''} selected — click to add more` : 'Click to upload (PDF, image, Excel — e.g. special price sheet)'}</span>
                </div>
              </label>
              {poFiles.length > 0 && (
                <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:6 }}>
                  {poFiles.map((f, i) => (
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8, background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8, padding:'6px 10px', fontSize:12 }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14,flexShrink:0,color:'var(--gray-400)'}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span style={{ flex:1, color:'var(--gray-700)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                      <span style={{ color:'var(--gray-400)', fontSize:11, flexShrink:0 }}>{(f.size / 1024).toFixed(0)} KB</span>
                      <button type="button" onClick={() => removePoFile(i)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', fontSize:16, lineHeight:1, padding:0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 5 }}>Max 200 KB per file. Upload price approvals, quotations, etc.</div>
            </div>
          </div>
        </div>

        {/* ── Line Items ── */}
        <div className="no-card no-card-items">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
              <path d="M9 12h6M9 16h4"/>
            </svg>
            Order Items
          </div>

          <div className="no-items-table-wrap">
            <table className="no-items-table">
              <thead>
                <tr>
                  <th className="col-sr">#</th>
                  <th className="col-code">Item Code <span className="req">*</span></th>
                  <th className="col-qty">Qty <span className="req">*</span></th>
                  <th className="col-lp">LP Price (₹) <span className="req">*</span></th>
                  <th className="col-disc">Disc %</th>
                  <th className="col-unit">Unit Price (₹)</th>
                  <th className="col-total">Total (₹)</th>
                  <th className="col-date">Delivery Date <span className="req">*</span></th>
                  <th className="col-del"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className={item.item_code ? 'row-filled' : ''}>
                    <td className="col-sr">{idx + 1}</td>
                    <td className="col-code">
                      <Typeahead
                        value={item.item_code}
                        onChange={v => updateItem(idx, 'item_code', v)}
                        onSelect={it => selectItemCode(idx, it)}
                        placeholder="Search item code or brand…"
                        fetchFn={fetchItems}
                        strictSelect
                        renderItem={it => (
                          <div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600 }}>{it.item_code}</div>
                            {(it.brand || it.category) && <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 1 }}>{[it.brand, it.category].filter(Boolean).join(' · ')}</div>}
                          </div>
                        )}
                      />
                    </td>
                    <td className="col-qty">
                      <input type="number" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} placeholder="0" min="0" />
                    </td>
                    <td className="col-lp">
                      <input type="number" value={item.lp_unit_price} onChange={e => updateItem(idx, 'lp_unit_price', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                    </td>
                    <td className="col-disc">
                      <input type="number" value={item.discount_pct} onChange={e => updateItem(idx, 'discount_pct', e.target.value)} placeholder="0" min="0" max="100" />
                    </td>
                    <td className="col-unit">
                      <input readOnly value={item.unit_price_after_disc} placeholder="—" className="calc-field" />
                    </td>
                    <td className="col-total">
                      <input readOnly value={item.total_price} placeholder="—" className="calc-field total-field" />
                    </td>
                    <td className="col-date">
                      <input type="date" value={item.delivery_date} onChange={e => updateItem(idx, 'delivery_date', e.target.value)} />
                    </td>
                    <td className="col-del">
                      {items.length > 1 && (
                        <button className="del-row-btn" onClick={() => removeRow(idx)} title="Remove row">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="no-add-row-btn" onClick={addRow}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Row
          </button>
        </div>

        {/* ── Totals ── */}
        <div className="no-card no-totals-card">
          <div className="no-totals-row">
            <div style={{ flex: 1 }} />
            <div className="no-totals-summary">
              <div className="no-total-line grand">
                <span>Grand Total</span>
                <span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="no-actions">
          {user.role === 'admin' && (
            <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:isTest ? '#b45309' : 'var(--gray-500)',fontWeight:isTest ? 600 : 400,background:isTest ? '#fef3c7' : 'transparent',border:isTest ? '1px solid #fde68a' : '1px solid transparent',borderRadius:8,padding:'6px 12px',transition:'all 0.15s'}}>
              <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} style={{accentColor:'#b45309',width:14,height:14}} />
              Test Mode
            </label>
          )}
          <div style={{ flex: 1 }} />
          <button className="no-cancel-btn" onClick={() => navigate('/procurement/po')}>Cancel</button>
          <button className="no-cancel-btn" onClick={() => submitPO(false)} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save as Draft'}
          </button>
          <button className="no-submit-btn" onClick={() => submitPO(true)} disabled={submitting}>
            {submitting ? (
              <><div className="no-spinner" />Submitting...</>
            ) : (
              <><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Submit for Approval</>
            )}
          </button>
        </div>
      </div>
    </div>
    </Layout>
  )
}
