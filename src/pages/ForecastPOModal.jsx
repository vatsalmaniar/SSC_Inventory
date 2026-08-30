import { useState, useEffect, useRef } from 'react'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { resolvePurchasePrice, resolvePurchasePrices, priceLineFields, unitPriceFor } from '../lib/itemPricing'
import { searchItems, itemSuggestionBreak } from '../lib/itemSearch'
import { itemTypeColor } from '../lib/itemStatus'
import { flagsForPo, reasonIsSufficient, wordCount, describeFlags, REASON_MIN_WORDS } from '../lib/vendorBrands'
import { friendlyError } from '../lib/errorMsg'
import Typeahead from '../components/Typeahead'
import PriceSourceNote from '../components/PriceSourceNote'
import '../styles/neworder.css'

const FC_ADDRESSES = {
  Kaveri: 'SSC Control Pvt Ltd, 17(A) Ashwamegh Warehouse, Behind New Ujala Hotel, Sarkhej Bavla Highway, Sarkhej, Ahmedabad, Gujarat 382210',
  Godawari: 'SSC Control Pvt Ltd, 31 GIDC Estate, B/h Bank Of, Makarpura, Vadodara, Gujarat 390010',
}

// Stable per-line identity for the ASYNC pricing paths — see the same note in
// NewPurchaseOrder.jsx. Array position is not safe to key an in-flight request
// on; rows shift when one is removed.
let RID = 0
const nextRid = () => ++RID

function emptyPOItem() {
  return { _rid: nextRid(), item_code: '', description: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', delivery_date: '', _pendingQty: 0, _priceLabel: '', _priceShort: '', _priceSource: '', _priceState: '', _moq: null, _autoPriced: false, _fixedUnit: null, _uom: null, _priceRecordId: null, _listPriceAtEntry: null, _priceResolvedAt: null }
}

export default function ForecastPOModal({ open, onClose, seedItems, brand, qLabel, userName, userId, userRole, navigate }) {
  const submitGuard = useRef(false)
  const qtyPriceTimer = useRef({})
  const priceTicket   = useRef({})   // line -> newest pricing request; older replies are dropped
  const openSeq       = useRef(0)
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
  // Same rule as New PO and the approval trigger — lib/vendorBrands.js asks the
  // database, so a forecast buy cannot quietly skip what a normal PO is asked.
  const [brandFlags, setBrandFlags]   = useState([])
  const [npReason, setNpReason]       = useState('')

  const [items, setItems] = useState([emptyPOItem()])
  const itemsRef = useRef(items)
  itemsRef.current = items
  // The vendor is usually chosen AFTER the lines are seeded, so pricing reads it
  // through a ref and every auto-priced line is re-resolved when it changes —
  // a vendor-specific rate is only correct once we know the vendor.
  const vendorIdRef = useRef('')
  vendorIdRef.current = vendorId

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
      const seeded = seedItems.map(s => ({
        ...emptyPOItem(),
        item_code: s.item_code,
        qty: s.qty > 0 ? String(s.qty) : '',
        _pendingQty: s.pendingQty || 0,
      }))
      setItems(seeded)
      // One round of reads for the whole forecast, not three per line.
      // openSeq guards a modal closed and reopened while this was in flight.
      const seq = ++openSeq.current
      resolvePurchasePrices(seeded.map(l => ({ itemCode: l.item_code, qty: Number(l.qty) || 1, customerId: null, vendorId: vendorIdRef.current, asOfDate: poDate })))
        .then(res => {
          if (seq !== openSeq.current) return
          setItems(cur => cur.map(l => {
            const i = seeded.findIndex(s => s._rid === l._rid)
            return i < 0 ? l : { ...l, ...priceLineFields(l, res[i]) }
          }))
        })
        .catch(() => {})   // pricing must never block raising a PO
    } else {
      setItems([emptyPOItem()])
    }
  }, [open])

  useEffect(() => {
    const codes = items.map(i => i.item_code).filter(Boolean)
    if (!vendorId || !codes.length) { setBrandFlags([]); return }
    let live = true
    const t = setTimeout(async () => {
      const f = await flagsForPo(sb, { itemCodes: codes, vendorId })
      if (live) setBrandFlags(f)
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [vendorId, items.map(i => i.item_code).join('|')])

  async function fetchVendors(q) {
    const { data } = await sb.from('vendors')
      .select('id,vendor_code,vendor_name,credit_terms')
      .eq('status', 'active').eq('is_test', false)
      .or(`vendor_name.ilike.%${q}%,vendor_code.ilike.%${q}%`)
      .order('vendor_name').limit(20)
    return (data || [])
  }

  // Ranked search — see lib/itemSearch.js. The old alphabetical ilike could hide
  // an exact match behind longer codes that merely contained the typed text.
  async function fetchItemCodes(q) {
    return searchItems(q, { limit: 20 })
  }

  function updateItem(idx, field, value) {
    const manualPrice = field === 'lp_unit_price' || field === 'discount_pct'
    setItems(prev => {
      const next = [...prev]
      // An override is recorded, not blocked — see NewPurchaseOrder.updateItem.
      const wasResolved = manualPrice && next[idx]._autoPriced
      next[idx] = { ...next[idx], [field]: value, ...(manualPrice ? { _autoPriced: false, _priceLabel: '', _priceShort: wasResolved ? 'Overridden by buyer' : '', _priceState: '', _fixedUnit: null, _overridden: wasResolved || next[idx]._overridden } : {}) }
      const item = next[idx]
      const qty  = parseFloat(item.qty)            || 0
      // Exact negotiated amount when the line is on a special — see itemPricing.js.
      const unit = unitPriceFor(item, { manualPriceEdit: manualPrice })
      next[idx].unit_price_after_disc = unit ? unit.toFixed(2) : ''
      next[idx].total_price = (unit && qty) ? (unit * qty).toFixed(2) : ''
      return next
    })
    if (field === 'qty') {
      const rid = items[idx]?._rid
      if (!rid) return
      clearTimeout(qtyPriceTimer.current[rid])
      qtyPriceTimer.current[rid] = setTimeout(() => {
        const l = itemsRef.current.find(x => x._rid === rid)
        if (l && l._autoPriced && l.item_code) applyPricing(rid, l.item_code, value)
      }, 400)
    }
  }

  // A forecast PO is a stock buy — no customer — so it resolves
  // blanket special → standard partner discount. See lib/itemPricing.js.
  async function applyPricing(rid, itemCode, qty) {
    if (!itemCode || !rid) return
    // Only the newest request for this line may write — see the note in
    // NewPurchaseOrder.applyPricing. Quantity scales make out-of-order replies
    // a wrong-price bug, not just a flicker.
    const ticket = (priceTicket.current[rid] = (priceTicket.current[rid] || 0) + 1)
    let res
    try { res = await resolvePurchasePrice({ itemCode, qty: Number(qty) || 1, customerId: null, vendorId: vendorIdRef.current, asOfDate: poDate }) }
    catch { return }
    if (priceTicket.current[rid] !== ticket) return
    setItems(prev => {
      const i = prev.findIndex(l => l._rid === rid)
      if (i < 0 || prev[i].item_code !== itemCode) return prev
      const next = [...prev]
      next[i] = { ...prev[i], ...priceLineFields(prev[i], res) }
      return next
    })
  }

  // A rate negotiated with one vendor must not be paid to another, so choosing
  // (or changing) the vendor re-resolves every line the system priced. Lines the
  // buyer priced by hand are left alone.
  function repriceForVendor(vId) {
    vendorIdRef.current = vId
    itemsRef.current.forEach(l => {
      if (l._autoPriced && l.item_code) applyPricing(l._rid, l.item_code, l.qty || 1)
    })
  }

  const filledItems = items.filter(i => i.item_code.trim())
  const grandTotal  = filledItems.reduce((s, i) => s + (parseFloat(i.total_price) || 0), 0)

  async function submitPO(submitForApproval) {
    if (submitGuard.current) return
    if (!vendorId)           { toast('Please select a vendor'); return }
    if (!fulfilmentCenter)   { toast('Please select a delivery address'); return }
    if (!filledItems.length) { toast('Add at least one line item'); return }
    if (brandFlags.length && !reasonIsSufficient(npReason)) {
      toast(`${describeFlags(brandFlags)} — a reason of at least ${REASON_MIN_WORDS} words is required; you have written ${wordCount(npReason)}.`, 'error')
      return
    }
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
        submitted_at:         submitForApproval ? new Date().toISOString() : null,
        po_date:              poDate,
        expected_delivery:    expectedDelivery || null,
        fulfilment_center:    fulfilmentCenter,
        delivery_address:     FC_ADDRESSES[fulfilmentCenter] || null,
        notes:                notes.trim() || null,
        ssc_notes:            sscNotes.trim() || null,
        // Stamp the analysis quarter on the PO Reference so it's visible on the
        // PO detail/print which quarter's forecast this order was based on.
        reference:            qLabel ? `Forecast · ${qLabel}` : null,
        purchase_requisition: purchaseRequisition.trim() || null,
        total_amount:         grandTotal,
        payment_terms:        vendorPaymentTerms || null,
        created_by:           userId,
        created_by_name:      userName,
        submitted_by_name:    userName,
        non_preferred_reason: brandFlags.length ? npReason.trim() : null,
        is_test:              isTest,
      }).select('id').single()

      if (insertErr) { toast(friendlyError(insertErr)); submitGuard.current = false; setSubmitting(false); return }

      const lineItems = filledItems.map((item, idx) => ({
        po_id:         po.id,
        sr_no:         idx + 1,
        item_code:     item.item_code.trim(),
        description:   item.description?.trim() || null,
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
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:200, overflowY:'auto', padding:'24px 16px' }}>
      <div style={{ background:'var(--gray-50)', width:'100%', maxWidth:920, margin:'0 auto', borderRadius:12, boxShadow:'0 24px 80px rgba(0,0,0,0.3)' }}>

        {/* Header */}
        <div style={{ background:'white', borderBottom:'1px solid var(--gray-100)', padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', borderRadius:'12px 12px 0 0' }}>
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
        <div className="no-body">

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
                  onSelect={v => { setVendorText(v.vendor_name); setVendorId(v.id); setVendorName(v.vendor_name); setVendorPaymentTerms(v.credit_terms || ''); repriceForVendor(v.id) }}
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
                    <th style={{ padding:'9px 10px', fontSize:11, fontWeight:600, color:'#92400e', background:'#fffbeb', whiteSpace:'nowrap', textAlign:'right', borderBottom:'1px solid var(--gray-100)' }}>Pending PO</th>
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
                    <tr key={item._rid} className={item.item_code ? 'row-filled' : ''}>
                      <td className="col-sr">{idx + 1}</td>
                      <td className="col-code">
                        <Typeahead
                          value={item.item_code}
                          onChange={v => updateItem(idx, 'item_code', v)}
                          onSelect={it => { updateItem(idx, 'item_code', it.item_code); applyPricing(item._rid, it.item_code, 1) }}
                          placeholder="Search item…"
                          fetchFn={fetchItemCodes}
                          separator={itemSuggestionBreak}
                          strictSelect
                          renderItem={it => (
                            <div>
                              <div style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600 }}>{it.item_code}{it.type && <span className="item-type-pill" style={{ '--stage-color': itemTypeColor(it.type) }}>{it.type}</span>}</div>
                              {(it.brand || it.category) && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>{[it.brand, it.category].filter(Boolean).join(' · ')}</div>}
                            </div>
                          )}
                        />
                      </td>
                      <td style={{ padding:'8px 10px', textAlign:'right', background: item._pendingQty > 0 ? '#fffbeb' : 'transparent', verticalAlign:'middle' }}>
                        {item._pendingQty > 0
                          ? <span style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:700, color:'#b45309' }}>{item._pendingQty}</span>
                          : <span style={{ color:'var(--gray-300)', fontSize:12 }}>—</span>
                        }
                      </td>
                      <td className="col-qty">
                        <input type="number" value={item.qty} onChange={e => updateItem(idx, 'qty', e.target.value)} placeholder="0" min="0" />
                      </td>
                      <td className="col-lp">
                        <input type="number" value={item.lp_unit_price} onChange={e => updateItem(idx, 'lp_unit_price', e.target.value)} placeholder="0.00" min="0" step="0.01" />
                        <PriceSourceNote line={item} />
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
              {brandFlags.length > 0 && (
                /* Same band as New PO. A forecast is still a purchase order and
                   the approval trigger will refuse it without a reason, so ask
                   here rather than let it fail later. */
                <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'12px 14px',margin:'0 0 12px'}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#b45309',marginBottom:8}}>
                    Why are we not buying {brandFlags.map(b => b.brand).join(', ')} directly?
                  </div>
                  <div style={{fontSize:11,color:'#92400e',marginBottom:8}}>{describeFlags(brandFlags)}</div>
                  <textarea value={npReason} onChange={e => setNpReason(e.target.value)} rows={2}
                    placeholder="e.g. principal had no stock, urgent requirement, customer specified this supplier..."
                    style={{width:'100%',border:'1px solid #fcd34d',borderRadius:8,padding:'8px 10px',fontSize:12,fontFamily:'var(--font)',color:'var(--gray-900)',resize:'none',outline:'none',boxSizing:'border-box',background:'white',lineHeight:1.5}} />
                  <div style={{fontSize:10,marginTop:4,fontWeight:500,color: reasonIsSufficient(npReason) ? '#16a34a' : '#b45309'}}>
                    {wordCount(npReason)}/{REASON_MIN_WORDS} words minimum
                  </div>
                </div>
              )}

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
