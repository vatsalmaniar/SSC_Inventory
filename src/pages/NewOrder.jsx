import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import '../styles/neworder.css'
import { friendlyError } from '../lib/errorMsg'

function emptyItem() {
  return { item_code: '', item_type: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', dispatch_date: '', customer_ref_no: '', description: '' }
}

export default function NewOrder() {
  const navigate = useNavigate()
  const [user, setUser]           = useState({ name: '', avatar: '', role: '' })
  const [submitting, setSubmitting] = useState(false)
  const submitGuard = useRef(false)

  const [lowValueReason, setLowValueReason] = useState('')

  // Customer
  const [customerInput, setCustomerInput]     = useState('')
  const [customerGst, setCustomerGst]         = useState('')
  const [dispatchAddr, setDispatchAddr]       = useState('')
  const [creditTerms, setCreditTerms]         = useState('')
  const [accountOwner, setAccountOwner]       = useState('')
  const [customerPending, setCustomerPending] = useState(false)
  const [customerBlacklisted, setCustomerBlacklisted] = useState(false)
  const [customerId, setCustomerId]           = useState(null)

  // Order header
  const [poNumber, setPoNumber]       = useState('')
  const [orderDate, setOrderDate]     = useState(new Date().toISOString().slice(0, 10))
  const [orderType, setOrderType]     = useState('SO')
  const [showCOConfirm, setShowCOConfirm] = useState(false)
  const [receivedVia, setReceivedVia] = useState('Mobile')
  const [freight, setFreight]         = useState('0')
  const [notes, setNotes]             = useState('')

  // Test mode (admin only)
  const [isTest, setIsTest]           = useState(false)

  // PO Document
  const [poFile, setPoFile]           = useState(null)
  const [poFileName, setPoFileName]   = useState('')

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
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
  }

  async function fetchCustomers(q) {
    const { data } = await sb.from('customers').select('id,customer_id,customer_name,gst,billing_address,credit_terms,account_owner,approval_status,account_status')
      .ilike('customer_name', '%' + q + '%').limit(10)
    return data || []
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items')
      .select('item_code,brand,category,type')
      .or(`item_code.ilike.%${q}%,brand.ilike.%${q}%`)
      .order('item_code')
      .limit(15)
    return data || []
  }

  function selectCustomer(c) {
    setCustomerInput(c.customer_name)
    setCustomerGst(c.gst || '')
    setDispatchAddr(c.billing_address || '')
    if (c.credit_terms) setCreditTerms(c.credit_terms)
    setAccountOwner(c.account_owner || '')
    setCustomerId(c.id)
    setCustomerPending(c.approval_status === 'pending')
    setCustomerBlacklisted(c.account_status === 'Blacklisted')
  }

  function handlePoFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 200 * 1024) {
      toast('File is too large. Maximum file size allowed: 200 KB')
      e.target.value = ''
      return
    }
    setPoFile(f)
    setPoFileName(f.name)
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

  function selectItemCode(idx, item) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], item_code: item.item_code, item_type: item.type || '' }
      return next
    })
  }

  function addRow()       { setItems(prev => [...prev, emptyItem()]) }
  function removeRow(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  const subtotal   = items.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)
  const grandTotal = subtotal + (parseFloat(freight) || 0)

  async function submitOrder(bypassTypeCheck = false) {
    if (submitGuard.current) return
    const validItems = items.filter(i => i.item_code.trim())

    let effectiveOrderType = orderType

    if (!bypassTypeCheck) {
      const hasCI = validItems.some(i => i.item_type === 'CI')
      const allSI = validItems.length > 0 && validItems.every(i => i.item_type === 'SI')

      // SO with CI items → auto-switch to CO silently and continue submitting
      if (effectiveOrderType === 'SO' && hasCI) {
        effectiveOrderType = 'CO'
        setOrderType('CO')
        toast('Order type changed to CO — this order contains CI (Customised) items.')
      }

      // CO with all-SI items → ask for confirmation before proceeding
      if (effectiveOrderType === 'CO' && allSI && !showCOConfirm) {
        setShowCOConfirm(true)
        return
      }
    }

    setShowCOConfirm(false)
    if (!customerInput.trim())  { toast('Customer name is required'); return }
    if (!customerId)            { toast('Please select a customer from the list — free-text names are not allowed.'); return }
    if (customerPending)        { toast('This customer is pending approval. Orders cannot be placed until the customer is approved in Customer 360.'); return }
    if (customerBlacklisted)    { toast('This customer is blacklisted. Orders cannot be placed for blacklisted customers.'); return }
    if (!dispatchAddr.trim())   { toast('Dispatch address is required'); return }
    if (effectiveOrderType !== 'SAMPLE' && !poNumber.trim()) { toast('PO / Reference Number is required'); return }
    if (!validItems.length)     { toast('Add at least one item'); return }
    for (const item of validItems) {
      if (!item.qty)             { toast(`Qty is required for item: ${item.item_code}`); return }
      if (!item.lp_unit_price)   { toast(`LP Price is required for item: ${item.item_code}`); return }
      if (!item.dispatch_date)   { toast(`Dispatch Date is required for item: ${item.item_code}`); return }
    }

    // Low-value order check
    if (grandTotal < 8000) {
      const words = lowValueReason.trim().split(/\s+/).filter(Boolean)
      if (words.length < 7) {
        toast('Order value is below ₹8,000. Please provide a reason (minimum 7 words).', 'error')
        return
      }
    }

    submitGuard.current = true
    setSubmitting(true)
    const { data: { session } } = await sb.auth.getSession()

    // Upload PO document first if provided
    let poDocUrl = null
    if (poFile) {
      const ext  = poFile.name.split('.').pop()
      const path = `orders/${Date.now()}.${ext}`
      const { error: upErr } = await sb.storage.from('po-documents').upload(path, poFile)
      if (!upErr) {
        const { data: { publicUrl } } = sb.storage.from('po-documents').getPublicUrl(path)
        poDocUrl = publicUrl
      }
    }

    const { data: order, error } = await sb.from('orders').insert({
      customer_name:     customerInput.trim(),
      customer_gst:      customerGst.trim(),
      dispatch_address:  dispatchAddr.trim(),
      po_number:         poNumber.trim(),
      order_date:        orderDate,
      order_type:        effectiveOrderType,
      engineer_name:     user.name,
      received_via:      receivedVia,
      freight:           parseFloat(freight) || 0,
      credit_terms:      creditTerms.trim(),
      account_owner:     accountOwner.trim(),
      notes:             notes.trim(),
      po_document_url:   poDocUrl,
      submitted_by_name: user.name,
      created_by:        session.user.id,
      is_test:           isTest,
      low_value_reason:  grandTotal < 8000 ? lowValueReason.trim() : null,
    }).select().single()

    if (error) { toast(friendlyError(error)); submitGuard.current = false; setSubmitting(false); return }

    const { error: itemsError } = await sb.from('order_items').insert(
      validItems.map((item, i) => ({
        order_id:              order.id,
        sr_no:                 i + 1,
        item_code:             item.item_code.trim(),
        qty:                   parseFloat(item.qty),
        lp_unit_price:         parseFloat(item.lp_unit_price) || 0,
        discount_pct:          parseFloat(item.discount_pct) || 0,
        unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
        total_price:           parseFloat(item.total_price) || 0,
        dispatch_date:         item.dispatch_date || null,
        customer_ref_no:       item.customer_ref_no?.trim() || null,
        description:           item.description?.trim() || null,
      }))
    )
    if (itemsError) { toast('Order created but items failed to save: ' + itemsError.message); submitGuard.current = false; setSubmitting(false); return }

    toast('Order created — ' + order.order_number, 'success')
    submitGuard.current = false
    setSubmitting(false)
    navigate('/orders', { state: { success: order.order_number } })
  }

  return (
    <Layout pageTitle="New Order" pageKey="orders">
    <div className="no-page">

      <div className="no-body">
        <div className="no-page-title">New Order</div>
        <div className="no-page-sub">Fill in the details below to punch a new sales order.</div>

        {/* ── Customer Information ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Customer Information
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>Customer Name <span className="req">*</span></label>
              <Typeahead
                value={customerInput}
                onChange={v => { setCustomerInput(v); if (!v) { setCustomerPending(false); setCustomerId(null) } }}
                onSelect={selectCustomer}
                placeholder="Search customer name..."
                fetchFn={fetchCustomers}
                strictSelect
                renderItem={c => (
                  <>
                    <div className="typeahead-item-main" style={{ display:'flex', alignItems:'center', gap:6 }}>
                      {c.customer_name}
                      {c.customer_id && <span style={{ fontSize:10, fontWeight:600, color:'#6b7280', fontFamily:'var(--mono)' }}>{c.customer_id}</span>}
                      {c.approval_status === 'pending' && <span style={{ fontSize:10, fontWeight:700, background:'#fef3c7', color:'#b45309', borderRadius:4, padding:'1px 5px' }}>PENDING APPROVAL</span>}
                      {c.account_status === 'Blacklisted' && <span style={{ fontSize:10, fontWeight:700, background:'#fef2f2', color:'#dc2626', borderRadius:4, padding:'1px 5px' }}>BLACKLISTED</span>}
                    </div>
                    {c.gst && <div className="typeahead-item-sub">GST: {c.gst}</div>}
                  </>
                )}
              />
            </div>
          </div>

          {customerPending && (
            <div style={{ display:'flex', alignItems:'center', gap:10, background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, padding:'10px 14px', marginTop:4 }}>
              <svg fill="none" stroke="#b45309" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16, flexShrink:0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <div style={{ fontSize:13, color:'#92400e' }}>
                <strong>Customer pending approval.</strong> Orders cannot be placed until this customer is approved in <span style={{ textDecoration:'underline', cursor:'pointer' }} onClick={() => window.open('/customers/' + customerId, '_blank')}>Customer 360</span>.
              </div>
            </div>
          )}

          {customerBlacklisted && (
            <div style={{ display:'flex', alignItems:'center', gap:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'10px 14px', marginTop:4 }}>
              <svg fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16, flexShrink:0 }}><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <div style={{ fontSize:13, color:'#991b1b' }}>
                <strong>Customer is blacklisted.</strong> Orders cannot be placed for blacklisted customers. Contact admin for details.
              </div>
            </div>
          )}

          <div className="no-row three">
            <div className="no-field">
              <label>GST Number</label>
              <input value={customerGst} onChange={e => setCustomerGst(e.target.value)} placeholder="Auto-filled on customer select" />
            </div>
            <div className="no-field">
              <label>Credit Terms</label>
              <input
                value={creditTerms}
                readOnly
                placeholder="Auto-filled on customer select"
                style={{ background: 'var(--gray-50)', color: creditTerms ? 'var(--gray-800)' : 'var(--gray-400)', cursor: 'default' }}
              />
            </div>
            <div className="no-field">
              <label>Account Owner</label>
              <input
                value={accountOwner}
                readOnly
                placeholder="Auto-filled on customer select"
                style={{ background: 'var(--gray-50)', color: accountOwner ? 'var(--gray-800)' : 'var(--gray-400)', cursor: 'default' }}
              />
            </div>
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>Dispatch Address <span className="req">*</span></label>
              <textarea value={dispatchAddr} onChange={e => setDispatchAddr(e.target.value)} placeholder="Auto-filled · edit if different from billing..." rows={2} />
            </div>
          </div>
        </div>

        {/* ── Order Details ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Order Details
          </div>

          <div className="no-row three">
            <div className="no-field">
              <label>Order Date <span className="req">*</span></label>
              <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
            </div>
            <div className="no-field">
              <label>Order Type <span className="req">*</span></label>
              <select value={orderType} onChange={e => setOrderType(e.target.value)}>
                <option value="SO">Standard Order (SO)</option>
                <option value="CO">Customised Order (CO)</option>
                <option value="SAMPLE">Sample Request (SR)</option>
              </select>
              {orderType === 'SAMPLE' && (
                <div style={{marginTop:6,padding:'8px 12px',background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:8,fontSize:12,color:'#166534'}}>
                  No PO required. Accounts billing will be skipped. A Sample Challan will be generated after goods issue.
                </div>
              )}
            </div>
            <div className="no-field">
              <label>Received Via <span className="req">*</span></label>
              <select value={receivedVia} onChange={e => setReceivedVia(e.target.value)}>
                <option>Mobile</option>
                <option>WhatsApp</option>
                <option>Email</option>
                <option>Visit</option>
                <option>Phone</option>
              </select>
            </div>
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>PO / Reference Number {orderType === 'SAMPLE' ? <span style={{color:'var(--gray-400)',fontWeight:400}}>(optional)</span> : <span className="req">*</span>}</label>
              <input value={poNumber} onChange={e => setPoNumber(e.target.value)} placeholder="e.g. PO-1234, Whatsapp Order" />
            </div>
            <div className="no-field">
              <label>Notes (for Ops team)</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions..." />
            </div>
          </div>

          {/* PO Document Upload */}
          <div className="no-row full" style={{ marginTop: 4 }}>
            <div className="no-field">
              <label>Customer PO Document (optional)</label>
              <label className="no-file-label">
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx" onChange={handlePoFile} style={{ display: 'none' }} />
                <div className={'no-file-box' + (poFileName ? ' has-file' : '')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 20, height: 20 }}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>{poFileName || 'Click to upload PO (PDF, image, Excel)'}</span>
                  {poFileName && (
                    <button
                      type="button"
                      onClick={e => { e.preventDefault(); setPoFile(null); setPoFileName('') }}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-400)', fontSize: 16 }}
                    >×</button>
                  )}
                </div>
              </label>
              <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 5 }}>Maximum file size allowed: 200 KB</div>
            </div>
          </div>
        </div>

        {/* ── Order Items ── */}
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
                  <th className="col-ref">Cust. Ref No</th>
                  <th className="col-del"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <>
                  <tr key={idx} className={item.item_code ? 'row-filled' : ''} style={{ borderBottom: item.item_code ? 'none' : undefined }}>
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
                      <input type="date" value={item.dispatch_date} onChange={e => updateItem(idx, 'dispatch_date', e.target.value)} />
                    </td>
                    <td className="col-ref">
                      <input value={item.customer_ref_no} onChange={e => updateItem(idx, 'customer_ref_no', e.target.value)} placeholder="Optional" />
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
                  {item.item_code && (
                    <tr key={`desc-${idx}`} style={{ borderTop: 'none' }}>
                      <td></td>
                      <td colSpan={9} style={{ paddingTop: 2, paddingBottom: 8 }}>
                        <input
                          value={item.description}
                          onChange={e => updateItem(idx, 'description', e.target.value)}
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

          <button className="no-add-row-btn" onClick={addRow}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Row
          </button>
        </div>

        {/* ── Totals + Freight ── */}
        <div className="no-card no-totals-card">
          <div className="no-totals-row">
            <div className="no-field" style={{ flex: 1 }}>
              <label>Freight Charges (₹) <span className="req">*</span></label>
              <input type="number" value={freight} onChange={e => setFreight(e.target.value)} min="0" placeholder="0" />
            </div>
            <div className="no-totals-summary">
              <div className="no-total-line">
                <span>Subtotal</span>
                <span>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="no-total-line">
                <span>Freight</span>
                <span>₹{(parseFloat(freight) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="no-total-line grand">
                <span>Grand Total</span>
                <span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Low value warning ── */}
        {grandTotal > 0 && grandTotal < 8000 && (
          <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'14px 16px',margin:'0 0 12px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <svg fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24" style={{width:16,height:16,flexShrink:0}}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span style={{fontSize:12,fontWeight:700,color:'#dc2626'}}>Order value is below ₹8,000 — reason required</span>
            </div>
            <textarea
              value={lowValueReason}
              onChange={e => setLowValueReason(e.target.value)}
              placeholder="Why is this order below ₹8,000? Please explain in detail (minimum 7 words)..."
              rows={2}
              style={{width:'100%',border:'1px solid #fca5a5',borderRadius:8,padding:'8px 10px',fontSize:12,fontFamily:'var(--font)',color:'var(--gray-900)',resize:'none',outline:'none',boxSizing:'border-box',background:'white',lineHeight:1.5}}
            />
            <div style={{fontSize:10,color: lowValueReason.trim().split(/\s+/).filter(Boolean).length >= 7 ? '#16a34a' : '#dc2626',marginTop:4,fontWeight:500}}>
              {lowValueReason.trim().split(/\s+/).filter(Boolean).length}/7 words minimum
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="no-actions">
          {user.role === 'admin' && (
            <label style={{display:'inline-flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:isTest ? '#b45309' : 'var(--gray-500)',fontWeight:isTest ? 600 : 400,background:isTest ? '#fef3c7' : 'transparent',border:isTest ? '1px solid #fde68a' : '1px solid transparent',borderRadius:8,padding:'6px 12px',transition:'all 0.15s'}}>
              <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} style={{accentColor:'#b45309',width:14,height:14}} />
              Test Mode
            </label>
          )}
          <div style={{ flex: 1 }} />
          <button className="no-cancel-btn" onClick={() => navigate('/orders')}>Cancel</button>
          <button className="no-submit-btn" onClick={() => submitOrder(false)} disabled={submitting}>
            {submitting ? (
              <><div className="no-spinner" />Submitting...</>
            ) : (
              <><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Submit Order</>
            )}
          </button>
        </div>
      </div>
    </div>

    {/* CO confirmation modal — all items are SI but booking as CO */}
    {showCOConfirm && (
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ background:'white', borderRadius:16, padding:32, maxWidth:420, width:'90%', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
          <div style={{ width:44, height:44, borderRadius:12, background:'#fff7ed', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:16 }}>
            <svg fill="none" stroke="#c2410c" strokeWidth="2" viewBox="0 0 24 24" style={{ width:22, height:22 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div style={{ fontSize:16, fontWeight:700, color:'var(--gray-900)', marginBottom:8 }}>All items are SI — booking as CO?</div>
          <div style={{ fontSize:13, color:'var(--gray-500)', lineHeight:1.6, marginBottom:24 }}>
            All items in this order are <strong>SI (Standard)</strong>, but you're booking it as a <strong>Customised Order (CO)</strong>. Do you want to proceed?
          </div>
          <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
            <button onClick={() => setShowCOConfirm(false)} style={{ padding:'9px 18px', borderRadius:8, border:'1px solid var(--gray-200)', background:'white', fontSize:13, cursor:'pointer', fontFamily:'var(--font)', color:'var(--gray-600)' }}>Cancel</button>
            <button onClick={() => submitOrder(true)} style={{ padding:'9px 18px', borderRadius:8, border:'none', background:'#c2410c', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Yes, Book as CO</button>
          </div>
        </div>
      </div>
    )}
    </Layout>
  )
}
