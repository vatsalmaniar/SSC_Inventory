import { useState, useEffect, useRef } from 'react'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Typeahead from '../components/Typeahead'
import '../styles/neworder.css'

const FC_ADDRESSES = {
  Kaveri: 'SSC Control Pvt Ltd, 17(A) Ashwamegh Warehouse, Behind New Ujala Hotel, Sarkhej Bavla Highway, Sarkhej, Ahmedabad, Gujarat 382210',
  Godawari: 'SSC Control Pvt Ltd, 31 GIDC Estate, B/h Bank Of, Makarpura, Vadodara, Gujarat 390010',
}

function emptyPOItem() {
  return { item_code: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', delivery_date: '', _note: '' }
}

export default function ForecastPOModal({ open, onClose, seedItems, brand, qLabel, userName, userId, userRole, navigate }) {
  const submitGuard = useRef(false)
  const [submitting, setSubmitting] = useState(false)

  const [vendorText, setVendorText]         = useState('')
  const [vendorId, setVendorId]             = useState('')
  const [vendorName, setVendorName]         = useState('')
  const [vendorPaymentTerms, setVendorPaymentTerms] = useState('')

  const [poDate, setPoDate]                     = useState(new Date().toISOString().slice(0, 10))
  const [expectedDelivery, setExpectedDelivery] = useState('')
  const [fulfilmentCenter, setFulfilmentCenter] = useState('Kaveri')
  const [purchaseRequisition, setPurchaseRequisition] = useState('')
  const [notes, setNotes]                       = useState('')
  const [sscNotes, setSscNotes]                 = useState('')
  const [isTest, setIsTest]                     = useState(false)

  const [items, setItems] = useState([emptyPOItem()])

  useEffect(() => {
    if (!open) return
    submitGuard.current = false
    setSubmitting(false)
    setVendorText(''); setVendorId(''); setVendorName(''); setVendorPaymentTerms('')
    setPoDate(new Date().toISOString().slice(0, 10))
    setExpectedDelivery(''); setNotes('')
    setSscNotes(`Procurement Forecast — ${brand} · ${qLabel}`)
    setFulfilmentCenter('Kaveri')
    setPurchaseRequisition('')
    setIsTest(false)

    if (seedItems?.length) {
      setItems(seedItems.map(s => ({
        ...emptyPOItem(),
        item_code: s.item_code,
        qty: s.qty > 0 ? String(s.qty) : '',
        _note: s.pendingQty > 0 ? `Pending PO: ${s.pendingQty} · Suggested: ${s.poQty}` : `Suggested: ${s.poQty}`,
      })))
    } else {
      setItems([emptyPOItem()])
    }
  }, [open])

  async function fetchVendors(q) {
    const { data } = await sb.from('vendors')
      .select('id,vendor_code,vendor_name,credit_terms')
      .eq('status', 'active').eq('is_test', false)
      .or(`vendor_name.ilike.%${q}%,vendor_code.ilike.%${q}%`)
      .order('vendor_name').limit(20)
    return (data || [])
  }

  async function fetchItemCodes(q) {
    const { data } = await sb.from('items')
      .select('item_code,brand,category')
      .or(`item_code.ilike.%${q}%,brand.ilike.%${q}%`)
      .order('item_code').limit(15)
    return (data || [])
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

  const filledItems = items.filter(i => i.item_code.trim())
  const grandTotal  = filledItems.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)

  async function submitPO(submitForApproval) {
    if (submitGuard.current) return
    if (!vendorId)           { toast('Please select a vendor'); return }
    if (!fulfilmentCenter)   { toast('Please select a delivery address'); return }
    if (!filledItems.length) { toast('Add at least one line item'); return }
    for (const item of filledItems) {
      if (!item.qty || parseFloat(item.qty) <= 0)          { toast(`Qty required for: ${item.item_code}`); return }
      if (item.lp_unit_price === '' || parseFloat(item.lp_unit_price) < 0) { toast(`LP Price required for: ${item.item_code}`); return }
      if (!item.delivery_date)                             { toast(`Delivery Date required for: ${item.item_code}`); return }
    }

    submitGuard.current = true
    setSubmitting(true)

    try {
      const fyYear   = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1
      const fySuffix = `${String(fyYear).slice(2)}-${String(fyYear + 1).slice(2)}`
      const { data: lastPo } = await sb.from('purchase_orders')
        .select('po_number')
        .ilike('po_number', `Temp/PO%/${fySuffix}`)
        .order('created_at', { ascending: false })
        .limit(1)
      let nextSeq = 1
      if (lastPo?.[0]?.po_number) {
        const match = lastPo[0].po_number.match(/Temp\/PO(\d+)\//)
        if (match) nextSeq = parseInt(match[1], 10) + 1
      }
      const tempNum = `Temp/PO${String(nextSeq).padStart(4, '0')}/${fySuffix}`

      const { data: po, error: insertErr } = await sb.from('purchase_orders').insert({
        po_number:            tempNum,
        vendor_id:            vendorId,
        vendor_name:          vendorName,
        status:               submitForApproval ? 'pending_approval' : 'draft',
        po_date:              poDate,
        expected_delivery:    expectedDelivery || null,
        fulfilment_center:    fulfilmentCenter,
        delivery_address:     FC_ADDRESSES[fulfilmentCenter] || null,
        notes:                notes.trim() || null,
        ssc_notes:            sscNotes.trim() || null,
        purchase_requisition: purchaseRequisition.trim() || null,
        total_amount:         grandTotal,
        payment_terms:        vendorPaymentTerms || null,
        created_by:           userId,
        created_by_name:      userName,
        submitted_by_name:    userName,
        is_test:              isTest,
      }).select('id').single()

      if (insertErr) { toast(friendlyError(insertErr)); submitGuard.current = false; setSubmitting(false); return }

      const lineItems = filledItems.map((item, idx) => ({
        po_id:         po.id,
        sr_no:         idx + 1,
        item_code:     item.item_code.trim(),
        qty:           parseFloat(item.qty),
        lp_unit_price: parseFloat(item.lp_unit_price) || null,
        discount_pct:  parseFloat(item.discount_pct) || 0,
        unit_price:    parseFloat(item.unit_price_after_disc) || parseFloat(item.lp_unit_price) || 0,
        total_price:   parseFloat(item.total_price) || 0,
        delivery_date: item.delivery_date || null,
        received_qty:  0,
      }))

      const { error: itemsErr } = await sb.from('po_items').insert(lineItems)
      if (itemsErr) toast(friendlyError(itemsErr, 'PO created but items failed — please add them manually'))

      toast('Purchase Order created — PO number assigned on approval', 'success')
      onClose()
      navigate('/procurement/po/' + po.id)
    } catch (err) {
      toast(friendlyError(err))
      submitGuard.current = false
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:200, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div style={{ background:'var(--gray-50)', width:'100%', maxWidth:920, borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.3)', display:'flex', flexDirection:'column', minHeight:'min-content' }}>

        {/* Header */}
        <div style={{ background:'white', borderBottom:'1px solid var(--gray-100)', padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderRadius:'12px 12px 0 0', position:'sticky', top:0, zIndex:10 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700, color:'var(--gray-900)' }}>New Purchase Order</div>
            <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:2 }}>
              Generated from Forecast &nbsp;·&nbsp;
              <span style={{ fontWeight:600, color:'var(--gray-700)' }}>{brand}</span>
              &nbsp;·&nbsp;{qLabel}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'1px solid var(--gray-200)', borderRadius:7, padding:'7px 14px', cursor:'pointer', color:'var(--gray-600)', fontSize:13, fontWeight:500 }}>
            ✕ Cancel
          </button>
        </div>

        {/* Body */}
        <div className="no-body" style={{ flex:1 }}>

          {/* ── Vendor ── */}
          <div className="no-card">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Vendor Information
            </div>
            <div className="no-row full">
              <div className="no-field">
                <label>Vendor Name <span className="req">*</span></label>
                <Typeahead
                  value={vendorText}
                  onChange={v => { setVendorText(v); if (!v.trim()) { setVendorId(''); setVendorName(''); setVendorPaymentTerms('') } }}
                  onSelect={v => { setVendorText(v.vendor_name); setVendorId(v.id); setVendorName(v.vendor_name); setVendorPaymentTerms(v.credit_terms || '') }}
                  placeholder="Search vendor by name or code…"
                  fetchFn={fetchVendors}
                  strictSelect
                  renderItem={v => (
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <span style={{ fontWeight:500 }}>{v.vendor_name}</span>
                      <span style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--mono)' }}>{v.vendor_code}</span>
                    </div>
                  )}
                />
              </div>
            </div>
            <div className="no-row three">
              <div className="no-field">
                <label>Credit Terms</label>
                <input value={vendorPaymentTerms} readOnly placeholder="Auto-filled on vendor select" style={{ background:'var(--gray-50)', color:'var(--gray-600)', cursor:'default' }} />
              </div>
              <div className="no-field">
                <label>Delivery Address <span className="req">*</span></label>
                <select value={fulfilmentCenter} onChange={e => setFulfilmentCenter(e.target.value)}>
                  <option value="Kaveri">Kaveri (Ahmedabad)</option>
                  <option value="Godawari">Godawari (Vadodara)</option>
                </select>
              </div>
              <div className="no-field">
                <label>Purchase Requisition From</label>
                <input value={purchaseRequisition} onChange={e => setPurchaseRequisition(e.target.value)} placeholder="Optional — who raised the PR" />
              </div>
            </div>
          </div>

          {/* ── PO Details ── */}
          <div className="no-card">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              PO Details
            </div>
            <div className="no-row three">
              <div className="no-field">
                <label>PO Date <span className="req">*</span></label>
                <input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} />
              </div>
              <div className="no-field">
                <label>Expected Delivery</label>
                <input type="date" value={expectedDelivery} onChange={e => setExpectedDelivery(e.target.value)} />
              </div>
              <div className="no-field">
                <label>Notes for Vendor</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions…" />
              </div>
            </div>
            <div className="no-row full" style={{ marginTop:4 }}>
              <div className="no-field">
                <label>Internal Notes (SSC)</label>
                <input value={sscNotes} onChange={e => setSscNotes(e.target.value)} />
              </div>
            </div>
          </div>

          {/* ── Line Items ── */}
          <div className="no-card no-card-items">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
              Order Items
              <span style={{ fontSize:11, fontWeight:400, color:'var(--gray-400)', marginLeft:8 }}>Pre-filled from forecast · edit qty, add prices &amp; dates</span>
            </div>
            <div className="no-items-table-wrap">
              <table className="no-items-table">
                <thead>
                  <tr>
                    <th className="col-sr">#</th>
                    <th className="col-code">Item Code <span className="req">*</span></th>
                    <th className="col-qty">Order Qty <span className="req">*</span></th>
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
                      <td className="col-sr">
                        <div>{idx + 1}</div>
                        {item._note && (
                          <div style={{ fontSize:9, color:'var(--gray-400)', fontWeight:400, fontFamily:'inherit', lineHeight:1.3, marginTop:2, whiteSpace:'nowrap' }}>
                            {item._note}
                          </div>
                        )}
                      </td>
                      <td className="col-code">
                        <Typeahead
                          value={item.item_code}
                          onChange={v => updateItem(idx, 'item_code', v)}
                          onSelect={it => updateItem(idx, 'item_code', it.item_code)}
                          placeholder="Search item…"
                          fetchFn={fetchItemCodes}
                          strictSelect
                          renderItem={it => (
                            <div>
                              <div style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600 }}>{it.item_code}</div>
                              {(it.brand || it.category) && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>{[it.brand, it.category].filter(Boolean).join(' · ')}</div>}
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
                          <button className="del-row-btn" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} title="Remove row">
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="no-add-row-btn" onClick={() => setItems(prev => [...prev, emptyPOItem()])}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Row
            </button>
          </div>

          {/* ── Totals ── */}
          <div className="no-card no-totals-card">
            <div className="no-totals-row">
              <div style={{ flex:1 }} />
              <div className="no-totals-summary">
                <div className="no-total-line grand">
                  <span>Grand Total</span>
                  <span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits:2 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="no-actions">
            {userRole === 'admin' && (
              <label style={{ display:'inline-flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color: isTest ? '#b45309' : 'var(--gray-500)', fontWeight: isTest ? 600 : 400, background: isTest ? '#fef3c7' : 'transparent', border: isTest ? '1px solid #fde68a' : '1px solid transparent', borderRadius:8, padding:'6px 12px', transition:'all 0.15s' }}>
                <input type="checkbox" checked={isTest} onChange={e => setIsTest(e.target.checked)} style={{ accentColor:'#b45309', width:14, height:14 }} />
                Test Mode
              </label>
            )}
            <div style={{ flex:1 }} />
            <button className="no-cancel-btn" onClick={onClose}>Cancel</button>
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
    </div>
  )
}
