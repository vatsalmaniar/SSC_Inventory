import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
import '../styles/neworder.css'
import { friendlyError } from '../lib/errorMsg'

const GRN_TYPES = [
  { key: 'po_inward',           label: 'PO Inward' },
  { key: 'sample_return',       label: 'Sample Return' },
  { key: 'customer_rejection',  label: 'Customer Rejection' },
  { key: 'cancellation_return', label: 'Cancellation Return' },
]
const FC_OPTIONS = ['Kaveri', 'Godawari']

function emptyItem() {
  return { _poText: '', _poId: '', _poNumber: '', _poItems: [], item_code: '', po_item_id: '', ordered_qty: 0, pending_qty: 0, received_qty: '' }
}

export default function NewGRN() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prePoId = searchParams.get('po_id')

  const [grnType, setGrnType] = useState('po_inward')
  const [saving, setSaving]   = useState(false)
  const saveGuard = useRef(false)
  const [userName, setUserName] = useState('')
  const [userRole, setUserRole] = useState('')
  // Form fields
  const [fc, setFc]               = useState('')
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10))
  const [vendorText, setVendorText] = useState('')
  const [vendorId, setVendorId]     = useState('')
  const [vendorName, setVendorName] = useState('')
  const [invoiceNum, setInvoiceNum] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [invoiceAmt, setInvoiceAmt] = useState('')
  const [notes, setNotes]       = useState('')

  // PO Inward items — each row: pick PO → pick item from that PO
  const [items, setItems]       = useState([emptyItem()])

  // Sample Return
  const [srText, setSrText]         = useState('')
  const [selectedSR, setSelectedSR] = useState(null)
  const [srItems, setSrItems]       = useState([])

  // Rejection / Cancellation
  const [soText, setSoText]         = useState('')
  const [selectedSO, setSelectedSO] = useState(null)
  const [soItems, setSoItems]       = useState([])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['ops', 'admin', 'management', 'fc_kaveri', 'fc_godawari'].includes(profile?.role)) { navigate('/dashboard'); return }
    setUserName(profile?.name || '')
    setUserRole(profile?.role || '')

    if (prePoId) await prefillFromPO(prePoId)
  }

  async function prefillFromPO(poId) {
    const { data: po } = await sb.from('purchase_orders')
      .select('id,po_number,vendor_id,vendor_name,fulfilment_center')
      .eq('id', poId).single()
    if (!po) return
    if (po.fulfilment_center) setFc(po.fulfilment_center)
    if (po.vendor_name) { setVendorText(po.vendor_name); setVendorName(po.vendor_name); setVendorId(po.vendor_id || '') }

    // Load pending items for this PO
    const { data: poItems } = await sb.from('po_items').select('id,item_code,qty,received_qty').eq('po_id', poId).order('sr_no')
    const pending = (poItems || []).filter(pi => pi.qty > (pi.received_qty || 0)).map(pi => ({
      po_item_id: pi.id,
      item_code: pi.item_code,
      ordered_qty: pi.qty,
      received_qty_so_far: pi.received_qty || 0,
      pending_qty: pi.qty - (pi.received_qty || 0),
    }))
    // Pre-fill rows with all pending items
    setItems(pending.map(pi => ({
      _poText: po.po_number,
      _poId: po.id,
      _poNumber: po.po_number,
      _poItems: pending,
      item_code: pi.item_code,
      po_item_id: pi.po_item_id,
      ordered_qty: pi.ordered_qty,
      pending_qty: pi.pending_qty,
      received_qty: String(pi.pending_qty),
    })))
  }

  function changeType(key) {
    setGrnType(key)
    setSelectedSR(null); setSelectedSO(null)
    setSrText(''); setSoText('')
    setSrItems([]); setSoItems([])
    setItems([emptyItem()])
    setVendorText(''); setVendorId(''); setVendorName('')
  }

  // ── Vendor search ──
  async function fetchVendors(q) {
    const { data } = await sb.from('vendors').select('id,vendor_code,vendor_name')
      .eq('status', 'active')
      .or(`vendor_name.ilike.%${q}%,vendor_code.ilike.%${q}%`)
      .order('vendor_name').limit(20)
    return data || []
  }

  function selectVendor(v) {
    setVendorText(v.vendor_name)
    setVendorId(v.id)
    setVendorName(v.vendor_name)
  }

  // ── PO search for a row ──
  async function fetchPOs(q) {
    const { data } = await sb.from('purchase_orders')
      .select('id,po_number,vendor_name,status')
      .in('status', ['placed', 'acknowledged', 'delivery_confirmation'])
      .or(`po_number.ilike.%${q}%,vendor_name.ilike.%${q}%`)
      .order('created_at', { ascending: false }).limit(20)
    return data || []
  }

  async function selectPOForRow(idx, po) {
    // Load pending items for this PO
    const { data: poItems } = await sb.from('po_items').select('id,item_code,qty,received_qty').eq('po_id', po.id).order('sr_no')
    const pending = (poItems || []).filter(pi => pi.qty > (pi.received_qty || 0)).map(pi => ({
      po_item_id: pi.id,
      item_code: pi.item_code,
      ordered_qty: pi.qty,
      received_qty_so_far: pi.received_qty || 0,
      pending_qty: pi.qty - (pi.received_qty || 0),
    }))

    setItems(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        _poText: po.po_number,
        _poId: po.id,
        _poNumber: po.po_number,
        _poItems: pending,
        item_code: '',
        po_item_id: '',
        ordered_qty: 0,
        pending_qty: 0,
        received_qty: '',
      }
      return next
    })

    // Auto-fill vendor from PO if not set
    if (!vendorName && po.vendor_name) {
      setVendorText(po.vendor_name)
      setVendorName(po.vendor_name)
    }
  }

  function selectItemForRow(idx, poItem) {
    setItems(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        item_code: poItem.item_code,
        po_item_id: poItem.po_item_id,
        ordered_qty: poItem.ordered_qty,
        pending_qty: poItem.pending_qty,
        received_qty: String(poItem.pending_qty),
      }
      return next
    })
  }

  function updateRecvQty(idx, val) {
    setItems(prev => {
      const next = [...prev]
      const max = next[idx].pending_qty
      const num = parseFloat(val)
      // Clamp to pending qty
      if (!isNaN(num) && num > max) val = String(max)
      next[idx] = { ...next[idx], received_qty: val }
      return next
    })
  }

  function addRow() { setItems(prev => [...prev, emptyItem()]) }
  function removeRow(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  // ── Sample Return: search SSC/SR orders ──
  async function fetchSROrders(q) {
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,status')
      .eq('order_type', 'SAMPLE')
      .neq('status', 'sample_returned')
      .neq('status', 'cancelled')
      .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
      .order('created_at', { ascending: false }).limit(20)
    return data || []
  }

  async function loadSRItems(order) {
    setSelectedSR(order)
    setSrText(order.order_number)
    const { data } = await sb.from('order_items').select('id,item_code,qty').eq('order_id', order.id)
    setSrItems((data || []).map(i => ({ ...i, return_qty: String(i.qty) })))
  }

  // ── Rejection / Cancellation: search SO orders ──
  async function fetchSOOrders(q) {
    const { data } = await sb.from('orders')
      .select('id,order_number,customer_name,status')
      .or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`)
      .order('created_at', { ascending: false }).limit(20)
    return data || []
  }

  async function loadSOItems(order) {
    setSelectedSO(order)
    setSoText(order.order_number)
    const { data } = await sb.from('order_items').select('id,item_code,qty').eq('order_id', order.id)
    setSoItems((data || []).map(i => ({ ...i, return_qty: String(i.qty) })))
  }

  // ── Save ──
  async function handleSave() {
    if (saveGuard.current) return
    if (!fc) { toast('Please select a Fulfilment Centre'); return }
    if (!receivedDate) { toast('Please enter received date'); return }

    const isPOInward = grnType === 'po_inward'
    const isSample = grnType === 'sample_return'

    if (isPOInward) {
      if (!vendorName) { toast('Please select a vendor'); return }
      const validItems = items.filter(i => i.item_code && i._poId && parseFloat(i.received_qty) > 0)
      if (!validItems.length) { toast('Add at least one item with received qty'); return }
      for (const item of validItems) {
        if (parseFloat(item.received_qty) > item.pending_qty) {
          toast(`${item.item_code}: received qty exceeds pending (${item.pending_qty})`); return
        }
      }
    } else if (isSample) {
      if (!selectedSR) { toast('Please select a Sample order'); return }
    } else {
      if (!selectedSO) { toast('Please select an Order'); return }
    }

    saveGuard.current = true
    setSaving(true)
    try {
      const fcCode = fc === 'Kaveri' ? 'KAV' : fc === 'Godawari' ? 'GOD' : fc
      const { data: grnNumber, error: seqErr } = await sb.rpc('next_grn_number', { p_fc: fcCode })
      if (seqErr) { toast(friendlyError(seqErr, "Generating GRN number failed. Please try again.")); saveGuard.current = false; setSaving(false); return }

      const grnRow = {
        grn_number: grnNumber,
        grn_type: grnType,
        fulfilment_center: fc,
        received_by: userName,
        received_at: receivedDate,
        status: 'draft',
        notes: notes.trim() || null,
      }

      if (isPOInward) {
        grnRow.vendor_name = vendorName || null
        grnRow.vendor_id = vendorId || null
        grnRow.invoice_number = invoiceNum.trim() || null
        grnRow.invoice_date = invoiceDate || null
        grnRow.invoice_amount = invoiceAmt ? parseFloat(invoiceAmt) : null
      } else if (isSample) {
        grnRow.order_id = selectedSR.id
      } else {
        grnRow.order_id = selectedSO.id
      }

      const { data: grn, error: insertErr } = await sb.from('grn').insert(grnRow).select('id').single()
      if (insertErr) { toast(friendlyError(insertErr)); saveGuard.current = false; setSaving(false); return }

      if (isPOInward) {
        const validItems = items.filter(i => i.item_code && i._poId && parseFloat(i.received_qty) > 0)
        const itemRows = validItems.map(i => ({
          grn_id: grn.id,
          po_item_id: i.po_item_id || null,
          po_id: i._poId,
          item_code: i.item_code,
          ordered_qty: i.ordered_qty || 0,
          received_qty: parseFloat(i.received_qty) || 0,
          accepted_qty: parseFloat(i.received_qty) || 0,
        }))
        const { error: itemsErr } = await sb.from('grn_items').insert(itemRows)
        if (itemsErr) { toast(friendlyError(itemsErr, "GRN created but items failed. Please try again.")); navigate('/fc/grn/' + grn.id); return }

      } else if (isSample) {
        const itemRows = srItems.filter(i => parseFloat(i.return_qty) > 0).map(i => ({
          grn_id: grn.id, item_code: i.item_code,
          received_qty: parseFloat(i.return_qty) || 0, accepted_qty: parseFloat(i.return_qty) || 0,
        }))
        if (itemRows.length) {
          const { error: itemsErr } = await sb.from('grn_items').insert(itemRows)
          if (itemsErr) { toast(friendlyError(itemsErr, "GRN created but items failed. Please try again.")); navigate('/fc/grn/' + grn.id); return }
        }

      } else {
        const itemRows = soItems.filter(i => parseFloat(i.return_qty) > 0).map(i => ({
          grn_id: grn.id, item_code: i.item_code,
          received_qty: parseFloat(i.return_qty) || 0, accepted_qty: parseFloat(i.return_qty) || 0,
        }))
        if (itemRows.length) {
          const { error: itemsErr } = await sb.from('grn_items').insert(itemRows)
          if (itemsErr) { toast(friendlyError(itemsErr, "GRN created but items failed. Please try again.")); navigate('/fc/grn/' + grn.id); return }
        }
      }

      toast('GRN ' + grnNumber + ' created', 'success')
      navigate('/fc/grn/' + grn.id)
    } catch (err) {
      toast(friendlyError(err))
      saveGuard.current = false
      setSaving(false)
    }
  }

  const isPOInward = grnType === 'po_inward'
  const isSample = grnType === 'sample_return'
  const isRecordOnly = grnType === 'customer_rejection' || grnType === 'cancellation_return'

  return (
    <Layout pageTitle="New GRN" pageKey="fc">
    <div className="no-page">
      <div className="no-body">
        <div className="no-page-title">New Goods Receipt Note</div>
        <div className="no-page-sub">Fill in the details below to create a new GRN.</div>

        {/* ── Receipt Details ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
              <rect x="9" y="3" width="6" height="4" rx="1"/>
            </svg>
            Receipt Details
          </div>
          <div className="no-row">
            <div className="no-field">
              <label>GRN Type <span className="req">*</span></label>
              <select value={grnType} onChange={e => changeType(e.target.value)}>
                {GRN_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              {isSample && (
                <div style={{marginTop:6,padding:'8px 12px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:8,fontSize:12,color:'#7e22ce'}}>
                  Select a Sample order (SSC/SR) to mark as returned.
                </div>
              )}
              {isRecordOnly && (
                <div style={{marginTop:6,padding:'8px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,fontSize:12,color:'#92400e'}}>
                  For record keeping only. Select the order to log the {grnType === 'customer_rejection' ? 'rejection' : 'cancellation'} return.
                </div>
              )}
            </div>
            <div className="no-field">
              <label>Fulfilment Centre <span className="req">*</span></label>
              <select value={fc} onChange={e => setFc(e.target.value)}>
                <option value="">— Select —</option>
                {FC_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="no-field">
              <label>Received Date <span className="req">*</span></label>
              <input type="date" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
            </div>
          </div>

          {/* PO Inward: vendor + invoice */}
          {isPOInward && (
            <>
              <div className="no-row full" style={{ marginTop: 8 }}>
                <div className="no-field">
                  <label>Vendor <span className="req">*</span></label>
                  <Typeahead
                    value={vendorText}
                    onChange={v => { setVendorText(v); if (!v.trim()) { setVendorId(''); setVendorName('') } }}
                    onSelect={selectVendor}
                    placeholder="Search vendor by name or code..."
                    fetchFn={fetchVendors}
                    strictSelect
                    renderItem={v => (
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        {v.vendor_name}
                        <span style={{ fontSize:10, color:'var(--gray-400)', fontFamily:'var(--mono)' }}>{v.vendor_code}</span>
                      </div>
                    )}
                  />
                </div>
              </div>
              <div className="no-row" style={{ marginTop: 8 }}>
                <div className="no-field">
                  <label>Vendor Invoice #</label>
                  <input value={invoiceNum} onChange={e => setInvoiceNum(e.target.value)} placeholder="Invoice number" />
                </div>
                <div className="no-field">
                  <label>Invoice Date</label>
                  <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                </div>
                <div className="no-field">
                  <label>Invoice Amount (₹)</label>
                  <input type="number" value={invoiceAmt} onChange={e => setInvoiceAmt(e.target.value)} placeholder="0.00" min="0" step="0.01" />
                </div>
              </div>
            </>
          )}

          {/* Sample Return source */}
          {isSample && (
            <div className="no-row" style={{ marginTop: 8 }}>
              <div className="no-field" style={{ maxWidth: 400 }}>
                <label>Sample Order (SSC/SR) <span className="req">*</span></label>
                <Typeahead
                  value={srText}
                  onChange={v => { setSrText(v); if (!v.trim()) { setSelectedSR(null); setSrItems([]) } }}
                  onSelect={o => loadSRItems(o)}
                  placeholder="Search SSC/SR number or customer..."
                  fetchFn={fetchSROrders}
                  strictSelect
                  renderItem={o => (
                    <div>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{o.order_number}</span>
                      <span style={{ color: 'var(--gray-400)', marginLeft: 8, fontSize: 11 }}>{o.customer_name}</span>
                    </div>
                  )}
                />
                {selectedSR && <div style={{ fontSize: 12, color: 'var(--gray-600)', marginTop: 6 }}>Customer: <strong>{selectedSR.customer_name}</strong></div>}
              </div>
            </div>
          )}

          {/* Rejection / Cancellation source */}
          {isRecordOnly && (
            <div className="no-row" style={{ marginTop: 8 }}>
              <div className="no-field" style={{ maxWidth: 400 }}>
                <label>Order Number <span className="req">*</span></label>
                <Typeahead
                  value={soText}
                  onChange={v => { setSoText(v); if (!v.trim()) { setSelectedSO(null); setSoItems([]) } }}
                  onSelect={o => loadSOItems(o)}
                  strictSelect
                  placeholder="Search order number or customer..."
                  fetchFn={fetchSOOrders}
                  renderItem={o => (
                    <div>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--mono)' }}>{o.order_number}</span>
                      <span style={{ color: 'var(--gray-400)', marginLeft: 8, fontSize: 11 }}>{o.customer_name}</span>
                    </div>
                  )}
                />
                {selectedSO && <div style={{ fontSize: 12, color: 'var(--gray-600)', marginTop: 6 }}>Customer: <strong>{selectedSO.customer_name}</strong> · Status: {selectedSO.status}</div>}
              </div>
            </div>
          )}

        </div>

        {/* ── PO Inward Items ── */}
        {isPOInward && (
          <div className="no-card no-card-items">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>
              </svg>
              GRN Items
            </div>
            <div className="no-items-table-wrap">
              <table className="no-items-table">
                <thead>
                  <tr>
                    <th className="col-sr">#</th>
                    <th style={{ minWidth: 180 }}>PO Number <span className="req">*</span></th>
                    <th style={{ minWidth: 180 }}>Item Code <span className="req">*</span></th>
                    <th style={{ width: 80, textAlign: 'center' }}>Ordered</th>
                    <th style={{ width: 80, textAlign: 'center' }}>Pending</th>
                    <th className="col-qty">Recv Qty <span className="req">*</span></th>
                    <th className="col-del"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className={item.item_code && item._poId ? 'row-filled' : ''}>
                      <td className="col-sr">{idx + 1}</td>
                      <td>
                        <Typeahead
                          value={item._poText}
                          onChange={v => {
                            setItems(prev => { const n = [...prev]; n[idx] = { ...emptyItem(), _poText: v }; return n })
                          }}
                          onSelect={po => selectPOForRow(idx, po)}
                          strictSelect
                          placeholder="Search PO..."
                          fetchFn={fetchPOs}
                          renderItem={po => (
                            <div>
                              <span style={{ fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 12 }}>{po.po_number}</span>
                              <span style={{ color: 'var(--gray-400)', marginLeft: 8, fontSize: 11 }}>{po.vendor_name}</span>
                            </div>
                          )}
                        />
                      </td>
                      <td>
                        {item._poItems.length > 0 ? (
                          <select
                            value={item.po_item_id}
                            onChange={e => {
                              const pi = item._poItems.find(p => p.po_item_id === e.target.value)
                              if (pi) selectItemForRow(idx, pi)
                            }}
                            style={{ width: '100%', padding: '7px 8px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--mono)', background: 'white', cursor: 'pointer' }}
                          >
                            <option value="">Select item...</option>
                            {item._poItems.map(pi => (
                              <option key={pi.po_item_id} value={pi.po_item_id}>
                                {pi.item_code} (Pending: {pi.pending_qty})
                              </option>
                            ))}
                          </select>
                        ) : item._poId ? (
                          <span style={{ fontSize: 11, color: 'var(--gray-400)', padding: '0 8px' }}>All items received</span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--gray-300)', padding: '0 8px' }}>Select PO first</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 12, color: 'var(--gray-500)' }}>
                        {item.ordered_qty || '—'}
                      </td>
                      <td style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: item.pending_qty ? '#b45309' : 'var(--gray-300)' }}>
                        {item.pending_qty || '—'}
                      </td>
                      <td className="col-qty">
                        <input
                          type="number"
                          value={item.received_qty}
                          onChange={e => updateRecvQty(idx, e.target.value)}
                          placeholder="0"
                          min="0"
                          max={item.pending_qty || undefined}
                        />
                      </td>
                      <td className="col-del">
                        {items.length > 1 && (
                          <button className="del-row-btn" onClick={() => removeRow(idx)} title="Remove row">
                            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              <path d="M10 11v6M14 11v6" />
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
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Row
            </button>
          </div>
        )}

        {/* ── Sample Return Items ── */}
        {isSample && srItems.length > 0 && (
          <div className="no-card no-card-items">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
              </svg>
              Sample Items
            </div>
            <div className="no-items-table-wrap">
              <table className="no-items-table">
                <thead>
                  <tr>
                    <th className="col-sr">#</th>
                    <th className="col-code">Item Code</th>
                    <th style={{ width: 90, textAlign: 'center' }}>Qty Sent</th>
                    <th className="col-qty">Return Qty <span className="req">*</span></th>
                  </tr>
                </thead>
                <tbody>
                  {srItems.map((item, idx) => (
                    <tr key={idx} className="row-filled">
                      <td className="col-sr">{idx + 1}</td>
                      <td className="col-code"><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.item_code}</span></td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.qty}</td>
                      <td className="col-qty">
                        <input type="number" value={item.return_qty} onChange={e => {
                          const val = Math.min(parseFloat(e.target.value) || 0, item.qty)
                          const next = [...srItems]; next[idx] = { ...next[idx], return_qty: String(val) }; setSrItems(next)
                        }} placeholder="0" min="0" max={item.qty} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Rejection / Cancellation Items ── */}
        {isRecordOnly && soItems.length > 0 && (
          <div className="no-card no-card-items">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
              </svg>
              Return Items
            </div>
            <div className="no-items-table-wrap">
              <table className="no-items-table">
                <thead>
                  <tr>
                    <th className="col-sr">#</th>
                    <th className="col-code">Item Code</th>
                    <th style={{ width: 90, textAlign: 'center' }}>Order Qty</th>
                    <th className="col-qty">Return Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {soItems.map((item, idx) => (
                    <tr key={idx} className="row-filled">
                      <td className="col-sr">{idx + 1}</td>
                      <td className="col-code"><span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.item_code}</span></td>
                      <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.qty}</td>
                      <td className="col-qty">
                        <input type="number" value={item.return_qty} onChange={e => {
                          const val = Math.min(parseFloat(e.target.value) || 0, item.qty)
                          const next = [...soItems]; next[idx] = { ...next[idx], return_qty: String(val) }; setSoItems(next)
                        }} placeholder="0" min="0" max={item.qty} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Notes
          </div>
          <div className="no-row">
            <div className="no-field" style={{ flex: 1 }}>
              <label>Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes about this receipt..." rows={3} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="no-card no-totals-card">
          <div className="no-totals-row" style={{ justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="no-cancel-btn" onClick={() => navigate('/fc/grn')}>Cancel</button>
              <button className="no-submit-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Create GRN'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </Layout>
  )
}
