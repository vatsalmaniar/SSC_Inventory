import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
// The SAME scanner the expense module uses — corners detected, perspective
// flattened, xerox / greyscale / original colour, and the untouched original kept
// when the scan looks risky. A vendor invoice photographed at the gate on a phone
// is exactly the case it was built for; there is no reason for a second one.
import DocScanner from '../components/DocScanner'
import '../styles/neworder.css'
import '../styles/three-way-match.css'
// DocScanner's own chrome (.ds-*) lives in expenses.css, which is where it was
// first built. Imported rather than extracted: every selector in that file is
// class-scoped so nothing leaks, and carving up a stylesheet with three
// consumers is how /change-password shipped broken. Worth extracting to its own
// file later, as a deliberate change with all three pages walked.
import '../styles/expenses.css'
import { friendlyError } from '../lib/errorMsg'

const GRN_TYPES = [
  { key: 'po_inward',           label: 'PO Inward' },
  { key: 'sample_return',       label: 'Sample Return' },
  { key: 'customer_rejection',  label: 'Customer Rejection' },
  { key: 'cancellation_return', label: 'Cancellation Return' },
]
const FC_OPTIONS = ['Kaveri', 'Godawari']

// Why a GRN line carries a rejected quantity AND a reason from the moment it is
// created: the person opening the carton is the only one who can see that 10 of
// the 110 are damaged, or that 10 more arrived than were ordered. Until now
// rejected_qty could only be entered later, by an admin, in an edit screen — so
// the storekeeper had nowhere to write down what they were looking at, and any
// physical excess simply vanished from the record.
const REJECT_REASONS = [
  { key: 'more_than_ordered', label: 'More than ordered' },
  { key: 'damaged',           label: 'Damaged' },
  { key: 'wrong_item',        label: 'Wrong item' },
  { key: 'quality_issue',     label: 'Quality issue' },
  { key: 'other',             label: 'Other' },
]

function emptyItem() {
  return {
    _poText: '', _poId: '', _poNumber: '', _poItems: [],
    item_code: '', po_item_id: '', ordered_qty: 0, pending_qty: 0,
    received_qty: '',
    // Split of what arrived. accepted is DERIVED (received - rejected) so the
    // two can never disagree.
    rejected_qty: '', rejection_reason: '',
    // Whether this PO line permits keeping an overage at all. Set from the PO.
    _tolPct: 0, _unlimited: false,
  }
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
  // grn.invoice_amount is no longer typed here. It was the GROSS whole-invoice
  // figure and often covered several GRNs, so it could never be a match basis —
  // and entering the amount twice, by two people, meant the two never agreed.
  // The COLUMN and all its history stay; FC simply stops writing it. Accounts
  // enters the taxable amount at the match, beside the PO rate.
  // The scanned result: { blob, url, ... } from DocScanner, or a raw PDF the user
  // picked instead (a PDF is already a document — nothing to flatten).
  const [invoiceDoc, setInvoiceDoc]   = useState(null)
  const [scanQueue, setScanQueue]     = useState([])
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
  const [srcDelivered, setSrcDelivered] = useState(null) // null=unchecked, true/false — is the picked return order delivered?

  // A return is only valid on a delivered order — check at selection time so the
  // user sees it immediately (backstopped by the hard gate in handleSave).
  async function checkDelivered(orderId) {
    const { data } = await sb.from('order_dispatches').select('id')
      .eq('order_id', orderId).eq('status', 'dispatched_fc').not('delivered_at', 'is', null).limit(1).maybeSingle()
    return !!data
  }
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
      .select('id,po_number,vendor_id,vendor_name,fulfilment_center,is_test')
      .eq('id', poId).single()
    if (!po) return
    if (po.fulfilment_center) setFc(po.fulfilment_center)
    // The vendor comes from the PO by ID, but the NAME is read fresh from the
    // vendor master — not copied from the PO. A PO raised in May under a name
    // the company has since changed must not stamp that old name onto a receipt
    // made today: the delivery challan and tax invoice arriving with the goods
    // carry the CURRENT name, and the GRN has to match them for invoice
    // matching to work. Each document snapshots the name as at ITS OWN date.
    if (po.vendor_id) {
      const { data: v } = await sb.from('vendors').select('vendor_name').eq('id', po.vendor_id).maybeSingle()
      const name = v?.vendor_name || po.vendor_name || ''
      setVendorText(name); setVendorName(name); setVendorId(po.vendor_id)
    } else if (po.vendor_name) {
      setVendorText(po.vendor_name); setVendorName(po.vendor_name)
    }

    // Load pending items for this PO
    const { data: poItems } = await sb.from('po_items')
      .select('id,item_code,qty,received_qty,sr_no,over_delivery_tol_pct,over_delivery_unlimited')
      .eq('po_id', poId).order('sr_no')
    const pending = (poItems || []).filter(pi => pi.qty > (pi.received_qty || 0)).map(pi => ({
      po_item_id: pi.id,
      item_code: pi.item_code,
      sr_no: pi.sr_no,
      ordered_qty: pi.qty,
      received_qty_so_far: pi.received_qty || 0,
      pending_qty: Math.max(0, pi.qty - (pi.received_qty || 0)),
      tol_pct: Number(pi.over_delivery_tol_pct) || 0,
      unlimited: !!pi.over_delivery_unlimited,
    }))
    // Pre-fill rows with all pending items
    setItems(pending.map(pi => ({
      _poText: po.po_number,
      _poId: po.id,
      _poNumber: po.po_number,
      _poItems: pending,
      _poIsTest: !!po.is_test,
      _poVendorId: po.vendor_id || '',
      _poVendorName: po.vendor_name || '',
      _tolPct: pi.tol_pct,
      _unlimited: pi.unlimited,
      item_code: pi.item_code,
      po_item_id: pi.po_item_id,
      ordered_qty: pi.ordered_qty,
      pending_qty: pi.pending_qty,
      received_qty: String(pi.pending_qty),
    })))
  }

  function changeType(key) {
    setGrnType(key)
    setSelectedSR(null); setSelectedSO(null); setSrcDelivered(null)
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
  // Scoped to the selected vendor. Without this the list offered every open PO in
  // the company, so a receipt could be pegged to another vendor's PO while the
  // header named a different one — the same mis-pegging family as the clubbed-PO
  // bug, and confusing even when the receiver gets it right. No existing GRN has
  // ever done it (0 of 3,714 lines checked), so this closes a hole rather than
  // fixing damage.
  async function fetchPOs(q) {
    let sel = sb.from('purchase_orders')
      .select('id,po_number,vendor_name,vendor_id,status,is_test')
      .in('status', ['placed', 'acknowledged', 'delivery_confirmation', 'partially_received'])
    if (vendorId)        sel = sel.eq('vendor_id', vendorId)
    else if (vendorName) sel = sel.eq('vendor_name', vendorName)
    const { data } = await sel
      .or(`po_number.ilike.%${q}%,vendor_name.ilike.%${q}%`)
      .order('created_at', { ascending: false }).limit(20)
    return data || []
  }

  async function selectPOForRow(idx, po) {
    // Load pending items for this PO
    // over_delivery_* decide whether keeping an overage is even offered on this
    // line. Both default to refuse, which is what the system has always done.
    const { data: poItems } = await sb.from('po_items')
      .select('id,item_code,qty,received_qty,sr_no,order_item_id,over_delivery_tol_pct,over_delivery_unlimited')
      .eq('po_id', po.id).order('sr_no')

    // Which customer each PO line belongs to. On a clubbed PO the same item can
    // appear for two customers — without this the receiver picks blind and the
    // material gets pegged to whoever happens to be first in the list.
    const oiIds = [...new Set((poItems || []).map(pi => pi.order_item_id).filter(Boolean))]
    const custByOi = {}
    if (oiIds.length) {
      const { data: oiRows } = await sb.from('order_items').select('id,order_id').in('id', oiIds)
      const orderIds = [...new Set((oiRows || []).map(r => r.order_id).filter(Boolean))]
      const custByOrder = {}
      if (orderIds.length) {
        const { data: ords } = await sb.from('orders').select('id,order_number,customer_name').in('id', orderIds)
        for (const o of (ords || [])) custByOrder[o.id] = o
      }
      for (const r of (oiRows || [])) if (custByOrder[r.order_id]) custByOi[r.id] = custByOrder[r.order_id]
    }

    const pending = (poItems || []).filter(pi => pi.qty > (pi.received_qty || 0)).map(pi => ({
      po_item_id: pi.id,
      item_code: pi.item_code,
      sr_no: pi.sr_no,
      ordered_qty: pi.qty,
      received_qty_so_far: pi.received_qty || 0,
      pending_qty: Math.max(0, pi.qty - (pi.received_qty || 0)),
      tol_pct: Number(pi.over_delivery_tol_pct) || 0,
      unlimited: !!pi.over_delivery_unlimited,
      customer_name: custByOi[pi.order_item_id]?.customer_name || '',
      co_number: custByOi[pi.order_item_id]?.order_number || '',
    }))
    const multiCust = new Set(pending.map(p => p.customer_name).filter(Boolean)).size > 1

    setItems(prev => {
      const next = [...prev]
      next[idx] = {
        ...next[idx],
        _poText: po.po_number,
        _poId: po.id,
        _poNumber: po.po_number,
        _poVendorId: po.vendor_id || '',
        _poVendorName: po.vendor_name || '',
        _poIsTest: !!po.is_test,
        _poItems: pending,
        _multiCust: multiCust,
        item_code: '',
        po_item_id: '',
        ordered_qty: 0,
        pending_qty: 0,
        received_qty: '',
      }
      return next
    })

    // Auto-fill vendor from PO if not set. vendor_id is carried too — it was
    // being left null on the PO-first path, so those GRNs stored a vendor NAME
    // and no id, and anything joining on vendor_id could not see them.
    if (!vendorName && po.vendor_name) {
      setVendorText(po.vendor_name)
      setVendorName(po.vendor_name)
      if (po.vendor_id) setVendorId(po.vendor_id)
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
        rejected_qty: '',
        rejection_reason: '',
        _tolPct: poItem.tol_pct,
        _unlimited: poItem.unlimited,
      }
      return next
    })
  }

  // How much of a line may be KEPT against the PO. Beyond this the overage has to
  // go back, and the difference is recorded as rejected rather than disappearing.
  function keepableQty(it) {
    if (it._unlimited) return Infinity
    return (Number(it.pending_qty) || 0) * (1 + (Number(it._tolPct) || 0) / 100)
  }
  function excessOf(it) {
    const rec = parseFloat(it.received_qty)
    if (isNaN(rec)) return 0
    return Math.max(0, rec - keepableQty(it))
  }
  function acceptedOf(it) {
    const rec = parseFloat(it.received_qty) || 0
    const rej = parseFloat(it.rejected_qty) || 0
    return Math.max(0, rec - rej)
  }

  // No longer clamps. Typing 110 against a PO of 100 used to be silently
  // rewritten to 100, which meant the extra 10 sat in the godown and nowhere in
  // the system. Now it is recorded, and the screen asks one plain question about
  // what to do with it.
  function updateRecvQty(idx, val) {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, received_qty: val }
      // Default the overage straight into "send it back" with the obvious
      // reason. One tap changes it; doing nothing does the safe thing.
      const ex = excessOf(next)
      if (ex > 0 && (!next.rejected_qty || Number(next.rejected_qty) !== ex)) {
        next.rejected_qty = String(ex)
        if (!next.rejection_reason) next.rejection_reason = 'more_than_ordered'
      }
      if (ex === 0 && next.rejection_reason === 'more_than_ordered') {
        next.rejected_qty = ''
        next.rejection_reason = ''
      }
      return next
    }))
  }

  function updateLineField(idx, field, val) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  // Keeping material nobody ordered commits money to stock, so it is a purchase
  // decision — ops/management/admin only, with a reason, recorded on the PO line
  // and posted to the PO's timeline. The RPC enforces the role regardless of who
  // can see this button. FC staff never see it and send the extra back.
  async function allowOverage(idx) {
    const it = items[idx]
    if (!it?.po_item_id) return
    const why = window.prompt(
      `Keep all ${it.received_qty} of ${it.item_code} instead of returning the extra?\n\n` +
      `Say why — it is recorded on the PO.`)
    if (why === null) return
    if (why.trim().length < 5) { toast('Give a short reason.', 'error'); return }

    setSaving(true)
    const { error } = await sb.rpc('po_allow_overage', {
      p_po_item_id: it.po_item_id, p_reason: why.trim(),
    })
    setSaving(false)
    if (error) { toast(friendlyError(error), 'error'); return }

    // Unlock the line locally and drop the auto-return, so the row immediately
    // reads "keeping all N" without a reload.
    setItems(prev => prev.map((r, i) => i === idx
      ? { ...r, _unlimited: true, rejected_qty: '', rejection_reason: '' } : r))
    toast(`Keeping all ${it.received_qty}. Recorded on the PO.`, 'success')
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
    setSrcDelivered(null); checkDelivered(order.id).then(setSrcDelivered)
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
    setSrcDelivered(null); checkDelivered(order.id).then(setSrcDelivered)
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

    // ── Material Return Policy gates (returns & rejections only) ──
    if (!isPOInward) {
      // Only admin / ops / management may record returns & rejections (not FC)
      if (!['admin', 'ops', 'management'].includes(userRole)) {
        toast('Returns & rejections can only be entered by admin, ops or management', 'error'); return
      }
      // Writing the issue is mandatory
      if (!notes.trim()) {
        toast('Please describe the issue / reason — mandatory for returns & rejections', 'error'); return
      }
      // ── Delivery gate ── A return/rejection is only valid for goods that were
      // actually DELIVERED — you cannot receive back what never went out. This
      // is a physical fact, not a policy window, so it's a HARD block (no
      // override) and covers all three types: cancellation, rejection, sample.
      // (Closes the loophole where an undelivered order had delivered_at=null and
      // slipped past the 7-day check, and rejections/samples had no check at all.)
      const srcOrder = isSample ? selectedSR : selectedSO
      if (srcOrder) {
        const { data: deliv } = await sb.from('order_dispatches')
          .select('id').eq('order_id', srcOrder.id).eq('status', 'dispatched_fc')
          .not('delivered_at', 'is', null).limit(1).maybeSingle()
        if (!deliv) {
          toast('Cannot accept this return — the order has not been delivered yet. Only delivered goods can be returned.', 'error'); return
        }
      }
      // CI zero-acceptance applies to CANCELLATION RETURNS only (customer
      // returning purchased goods). Rejections accept CI (product failure),
      // and SAMPLE returns accept CI too — a loaned CI sample must come back;
      // the 30-day sample tracking depends on it.
      if (grnType === 'cancellation_return') {
        const retItems = soItems.filter(i => parseFloat(i.return_qty) > 0)
        const codes = [...new Set(retItems.map(i => i.item_code).filter(Boolean))]
        // Parallel .eq() — item codes with quotes/parens break .in() list parsing
        const results = await Promise.all(codes.map(c => sb.from('items').select('item_code,type').eq('item_code', c).maybeSingle()))
        const ciCodes = results.filter(r => r.data?.type === 'CI').map(r => r.data.item_code)
        if (ciCodes.length) {
          toast(`Zero acceptance on customised (CI) items — return not allowed for: ${ciCodes.join(', ')}. Use Customer Rejection only for product failure.`, 'error'); return
        }
      }
      // SI returns accepted up to 7 days from delivery. Admin/management can
      // override (reason captured via the mandatory issue note); others blocked.
      if (grnType === 'cancellation_return' && selectedSO) {
        const { data: lastDeliv } = await sb.from('order_dispatches')
          .select('delivered_at').eq('order_id', selectedSO.id).eq('status', 'dispatched_fc')
          .not('delivered_at', 'is', null).order('delivered_at', { ascending: false }).limit(1).maybeSingle()
        const days = lastDeliv?.delivered_at ? Math.floor((Date.now() - new Date(lastDeliv.delivered_at).getTime()) / 86400000) : null
        if (days !== null && days > 7) {
          if (!['admin', 'management'].includes(userRole)) {
            toast(`Return window closed — delivered ${days} days ago (policy: up to 7 days). Needs admin/management.`, 'error'); return
          }
          if (!window.confirm(`Policy: returns are accepted up to 7 days from delivery.\n\nThis order was delivered ${days} days ago. Proceed as management override?`)) return
        }
      }
    }

    if (isPOInward) {
      if (!vendorName) { toast('Please select a vendor'); return }
      const validItems = items.filter(i => i.item_code && i._poId && parseFloat(i.received_qty) > 0)
      if (!validItems.length) { toast('Add at least one item with received qty'); return }
      // The rule is no longer "you may not type more than was ordered" — that
// only hid physical excess. It is: whatever arrived is recorded, and anything
// above what this PO line may keep must be accounted for as going back.
// confirm_grn adds only the ACCEPTED quantity to the PO, so the PO can never be
// over-received by this path. (The database enforces the same thing; these
// messages exist so the storekeeper is told in plain words, not by an error.)
      for (const item of validItems) {
        const rec = parseFloat(item.received_qty) || 0
        const rej = parseFloat(item.rejected_qty) || 0
        if (rej > rec) {
          toast(`${item.item_code}: you cannot send back more than arrived (${rec}).`, 'error'); return
        }
        if (rej > 0 && !item.rejection_reason) {
          toast(`${item.item_code}: say why ${rej} is going back.`, 'error'); return
        }
        const keepable = keepableQty(item)
        if (acceptedOf(item) > keepable) {
          const extra = acceptedOf(item) - keepable
          toast(`${item.item_code}: ${rec} arrived but only ${item.pending_qty} was ordered. ` +
                `Send the extra ${extra} back, or ask purchase to allow an overage on this PO line.`, 'error')
          return
        }
        if (acceptedOf(item) <= 0) {
          toast(`${item.item_code}: nothing is being accepted — send-back-only receipts are not a GRN.`, 'error'); return
        }
      }
      // Guard: every PO on this GRN must belong to the vendor on the header.
      // One GRN is one delivery from one vendor; pegging a line to another
      // vendor's PO credits their receipt against the wrong order and hands the
      // bill the wrong price basis. It has already happened three times —
      // GRN0271 booked a Mitsubishi delivery to AXELON and completed the bill at
      // ₹90,504.
      //
      // ⚠️ COMPARED BY vendor_id, NOT BY NAME. purchase_orders.vendor_name is a
      // denormalised snapshot and goes stale on a rename: 144 POs still read
      // "HCE DYNAMICS PRIVATE LIMITED" for what is now
      // "HICOOL ELECTRONIC INDUSTRIES PRIVATE LIMITED" — the same vendor record,
      // V00001. A name check would have blocked 12 perfectly good GRNs. Measured
      // before writing this: by id, 0 of 722 comparable lines mismatch.
      for (const item of validItems) {
        if (vendorId && item._poVendorId && item._poVendorId !== vendorId) {
          toast(`${item._poNumber} belongs to ${item._poVendorName}, not ${vendorName}. ` +
                `One GRN covers one vendor — raise a separate GRN for that delivery.`, 'error')
          return
        }
      }
      // Where an id is missing on either side we cannot be certain, so ask rather
      // than block — a stale name is far more likely than a mis-peg.
      const nameOdd = validItems.filter(i =>
        (!vendorId || !i._poVendorId) && i._poVendorName && vendorName &&
        i._poVendorName.trim().toUpperCase() !== vendorName.trim().toUpperCase())
      if (nameOdd.length && !window.confirm(
        `${nameOdd[0]._poNumber} is recorded against "${nameOdd[0]._poVendorName}" but this GRN ` +
        `says "${vendorName}". That is normal if the vendor was renamed. Carry on?`)) return

      // Guard: no two rows may point at the same PO line (would over-receive one
      // line and orphan its sibling — the dup-link bug that stalls confirm_grn).
      const seenPoItems = new Set()
      for (const item of validItems) {
        if (item.po_item_id && seenPoItems.has(item.po_item_id)) {
          toast(`${item.item_code} is added on two rows against the same PO line. Pick a different PO line (each line can be received once).`, 'error'); return
        }
        if (item.po_item_id) seenPoItems.add(item.po_item_id)
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
        // Inherited from the PO. A receipt against a demo PO is demo data, and
        // flagging it here is what keeps training runs out of real lists,
        // real received-value totals and the SLA breach list.
        is_test: items.some(i => i._poIsTest),
      }

      if (isPOInward) {
        grnRow.vendor_name = vendorName || null
        grnRow.vendor_id = vendorId || null
        grnRow.invoice_number = invoiceNum.trim() || null
        grnRow.invoice_date = invoiceDate || null
        // invoice_amount deliberately NOT written — see the note on invoiceFile.
      } else if (isSample) {
        grnRow.order_id = selectedSR.id
      } else {
        grnRow.order_id = selectedSO.id
      }

      const { data: grn, error: insertErr } = await sb.from('grn').insert(grnRow).select('id').single()
      if (insertErr) { toast(friendlyError(insertErr)); saveGuard.current = false; setSaving(false); return }

      // The vendor invoice, attached at the gate. A failure here must NOT lose the
      // GRN — the goods are physically in; the document can be added on the detail
      // page. So it warns and carries on rather than aborting.
      if (isPOInward && invoiceDoc?.blob) {
        // vendor-docs, NOT po-documents: that bucket caps at 200 KB and even a
        // flattened, compressed invoice scan does not fit.
        const ext  = invoiceDoc.isPdf ? 'pdf' : 'jpg'
        const path = `grn-vendor-invoices/${grn.id}/invoice-${Date.now()}.${ext}`
        const type = invoiceDoc.isPdf ? 'application/pdf' : 'image/jpeg'
        const { error: upErr } = await sb.storage.from('vendor-docs')
          .upload(path, invoiceDoc.blob, { upsert: true, contentType: type })
        if (upErr) {
          toast(friendlyError(upErr, 'GRN saved, but the invoice did not upload. Add it from the GRN page.'), 'error')
        } else {
          const url = sb.storage.from('vendor-docs').getPublicUrl(path).data.publicUrl
          await sb.from('grn').update({ vendor_invoice_url: url }).eq('id', grn.id)
        }
      }

      if (isPOInward) {
        const validItems = items.filter(i => i.item_code && i._poId && parseFloat(i.received_qty) > 0)
        const itemRows = validItems.map(i => ({
          grn_id: grn.id,
          po_item_id: i.po_item_id || null,
          po_id: i._poId,
          item_code: i.item_code,
          ordered_qty: i.ordered_qty || 0,
          received_qty: parseFloat(i.received_qty) || 0,
          // accepted is DERIVED so it can never disagree with the split, and it
          // is the ONLY figure confirm_grn adds to the PO — you do not owe money
          // for goods you sent back, and the PO is not satisfied by them either.
          accepted_qty: acceptedOf(i),
          rejected_qty: parseFloat(i.rejected_qty) || 0,
          rejection_reason: (parseFloat(i.rejected_qty) || 0) > 0
            ? (REJECT_REASONS.find(r => r.key === i.rejection_reason)?.label || i.rejection_reason)
            : null,
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
      {/* The scanner takes over the screen while it is open, exactly as it does in
          the expense module — the form stays mounted behind it so nothing typed
          is lost. onDone(null) means the user skipped, which attaches the
          untouched photo; DocScanner handles that decision itself. */}
      {scanQueue.length > 0 && (
        <DocScanner
          key={scanQueue.length}
          file={scanQueue[0]}
          onCancel={() => setScanQueue([])}
          onDone={res => {
            if (res?.blob) setInvoiceDoc({ ...res, isPdf: false })
            setScanQueue([])
          }}
        />
      )}
      <div className="no-body" style={{ display: scanQueue.length > 0 ? 'none' : undefined }}>
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
                {/* Returns & rejections are admin/ops/management only — FC sees PO Inward */}
                {(['fc_kaveri', 'fc_godawari'].includes(userRole) ? GRN_TYPES.filter(t => t.key === 'po_inward') : GRN_TYPES)
                  .map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
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
                  <label>Photograph the invoice</label>
                  {/* The invoice arrives with the truck, so the person at the gate
                      is holding it first. Measured: only 29 of 1,551 bills ever had
                      it attached, because chasing paper in a Godawari drawer was
                      accounts' job. capture="environment" opens the rear camera
                      straight away on a phone; on a desktop it is a normal picker. */}
                  {invoiceDoc ? (
                    <div className="grnq-doc">
                      {invoiceDoc.isPdf
                        ? <span className="grnq-doc-name">{invoiceDoc.name}</span>
                        : <img src={invoiceDoc.url} alt="Vendor invoice" />}
                      <button type="button" className="grnq-btn"
                              onClick={() => setInvoiceDoc(null)}>Retake</button>
                    </div>
                  ) : (
                    <>
                      <label className="twm-upload">
                      <input type="file" accept="image/*,application/pdf" capture="environment"
                             onChange={e => {
                               const f = e.target.files?.[0]; if (!f) return
                               if (f.type === 'application/pdf') {
                                 // Already a document — straight through, no scan.
                                 setInvoiceDoc({ blob: f, url: URL.createObjectURL(f), isPdf: true, name: f.name })
                               } else {
                                 setScanQueue([f])   // hand it to the scanner
                               }
                               e.target.value = ''   // so re-picking the same file fires again
                             }} />
                        📷 Take a photo, or choose a file
                      </label>
                      <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 4 }}>
                        Accounts reads the rates off this — no need to type any amounts.
                      </div>
                    </>
                  )}
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
                  onChange={v => { setSrText(v); if (!v.trim()) { setSelectedSR(null); setSrItems([]); setSrcDelivered(null) } }}
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
                {selectedSR && srcDelivered === false && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '7px 10px', marginTop: 6 }}>
                    ⚠ {selectedSR.order_number} has not been delivered — a return cannot be recorded against it.
                  </div>
                )}
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
                  onChange={v => { setSoText(v); if (!v.trim()) { setSelectedSO(null); setSoItems([]); setSrcDelivered(null) } }}
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
                {selectedSO && srcDelivered === false && (
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '7px 10px', marginTop: 6 }}>
                    ⚠ {selectedSO.order_number} has not been delivered — a return cannot be recorded against it.
                  </div>
                )}
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
            {items.some(i => i._multiCust) && (
              <div style={{ margin: '0 0 10px', padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <svg fill="none" stroke="#b45309" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 18, height: 18, flexShrink: 0, marginTop: 1 }}>
                  <path d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"/>
                </svg>
                <div style={{ fontSize: 12, color: '#92400e' }}>
                  <b>Clubbed PO — lines belong to different customers.</b> Each line shows its customer. If the vendor short-shipped, receive against the correct customer's line — the quantity you enter is pegged to that customer's order and drives their delivery.
                </div>
              </div>
            )}
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
                    <Fragment key={idx}>
                    <tr className={item.item_code && item._poId ? 'row-filled' : ''}>
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
                          (() => {
                            // PO lines already chosen by OTHER rows of the same PO — disable them
                            // so two rows can't point at the same PO line (the dup-link bug).
                            const usedElsewhere = new Set(
                              items.filter((r, i) => i !== idx && r._poId === item._poId && r.po_item_id)
                                   .map(r => r.po_item_id)
                            )
                            return (
                          <select
                            value={item.po_item_id}
                            onChange={e => {
                              const pi = item._poItems.find(p => p.po_item_id === e.target.value)
                              if (pi) selectItemForRow(idx, pi)
                            }}
                            style={{ width: '100%', padding: '7px 8px', border: '1px solid var(--gray-200)', borderRadius: 6, fontSize: 12, fontFamily: 'var(--mono)', background: 'white', cursor: 'pointer' }}
                          >
                            <option value="">Select item...</option>
                            {item._poItems.map(pi => {
                              const taken = usedElsewhere.has(pi.po_item_id) && pi.po_item_id !== item.po_item_id
                              return (
                              <option key={pi.po_item_id} value={pi.po_item_id} disabled={taken}>
                                {pi.item_code}{pi.sr_no ? ` · Line ${pi.sr_no}` : ''}{pi.customer_name ? ` — ${pi.customer_name}${pi.co_number ? ` (${pi.co_number})` : ''}` : ''} (Pending: {pi.pending_qty}){taken ? ' — already added' : ''}
                              </option>
                            )})}
                          </select>
                            )
                          })()
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
                        {/* No max: type what actually turned up. Clamping this to
                            the ordered quantity is what made physical excess
                            invisible. */}
                        <input
                          type="number"
                          value={item.received_qty}
                          onChange={e => updateRecvQty(idx, e.target.value)}
                          placeholder="0"
                          min="0"
                        />
                        {/* Damage is the uncommon case, so it stays out of the way
                            until someone needs it — but it has to be reachable by
                            the person holding the carton, who until now could not
                            record it at all (it was admin-only, on a later screen). */}
                        {item.item_code && parseFloat(item.received_qty) > 0
                          && !item._problem && !(parseFloat(item.rejected_qty) > 0) && (
                          <button type="button" className="grnq-link"
                                  onClick={() => updateLineField(idx, '_problem', true)}>
                            Something is damaged
                          </button>
                        )}
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

                    {/* ── One plain question, and only when the count is off ──
                        No prices, no percentages, no rupees: the person at the
                        gate counts boxes. Deciding whether to KEEP an overage is
                        a commercial call made on the PO, so "Keep all" only
                        appears when that PO line already permits it. */}
                    {/* ── What the storekeeper sees when the count is off ──────
                        Written for someone counting boxes at a gate, not for an
                        accountant. ONE plain sentence. No checkbox, no dropdown,
                        no paragraph — the safe outcome is chosen automatically
                        and simply stated, because sending unordered stock back is
                        what happens unless someone with authority says otherwise.
                        Keeping it is a purchase decision, so that button exists
                        only for ops/management/admin and FC never sees it. */}
                    {item.item_code && (() => {
                      const rec  = parseFloat(item.received_qty)
                      if (isNaN(rec) || rec <= 0) return null
                      const pend = Number(item.pending_qty) || 0
                      const rej  = parseFloat(item.rejected_qty) || 0
                      const over = rec - pend
                      const mayKeep = item._unlimited || Number(item._tolPct) > 0
                      const short = over < 0
                      const problem = item._problem
                      if (over === 0 && rej === 0 && !problem) return null

                      return (
                        <tr>
                          <td colSpan={7} className="grnq-cell">
                            <div className={'grnq' + (over > 0 && !mayKeep ? ' over' : short ? ' short' : '')}>
                              <div className="grnq-say">
                                {/* "still due", never "ordered": pend is what is
                                    OUTSTANDING on the line, not the order quantity.
                                    On a PO of 100 with 90 already received it is
                                    10 — and "10 was ordered" is simply false. */}
                                {over > 0 && !mayKeep && (
                                  <><strong>{rec} arrived, {pend} {pend === 1 ? 'was' : 'were'} still due.</strong><br />
                                    {over} {over === 1 ? 'goes' : 'go'} back to the vendor. You are keeping {acceptedOf(item)}.</>
                                )}
                                {over > 0 && mayKeep && (
                                  <><strong>{rec} arrived, {pend} {pend === 1 ? 'was' : 'were'} still due.</strong><br />
                                    Keeping all {rec}.</>
                                )}
                                {short && <><strong>{rec} arrived of the {pend} still due.</strong><br />
                                  {Math.abs(over)} yet to come.</>}
                                {over === 0 && (problem || rej > 0) && <strong>Report a problem</strong>}
                              </div>

                              <div className="grnq-acts">
                                {/* Ops can keep it, there and then. FC cannot, and
                                    is not shown a button that would be refused. */}
                                {over > 0 && !mayKeep && ['admin','management','ops'].includes(userRole) && (
                                  <button type="button" className="grnq-btn" disabled={saving}
                                          onClick={() => allowOverage(idx)}>
                                    Keep all {rec} instead
                                  </button>
                                )}
                                {(problem || (over === 0 && rej > 0)) && (
                                  <>
                                    <input className="grnq-qty" type="number" min="0" max={rec}
                                           value={item.rejected_qty} placeholder="how many"
                                           onChange={e => updateLineField(idx, 'rejected_qty', e.target.value)}
                                           aria-label="How many are damaged or wrong" />
                                    <select className="grnq-why" value={item.rejection_reason}
                                            onChange={e => updateLineField(idx, 'rejection_reason', e.target.value)}>
                                      <option value="">What is wrong?</option>
                                      {REJECT_REASONS.filter(r => r.key !== 'more_than_ordered')
                                        .map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                                    </select>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })()}
                    </Fragment>
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
              <label>{grnType === 'po_inward' ? 'Notes' : <>Issue / Reason <span className="req">*</span></>}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={grnType === 'po_inward' ? 'Any notes about this receipt...' : 'Describe the issue — why is the material being returned / rejected? (mandatory)'}
                rows={3} style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="no-card no-totals-card">
          <div className="no-totals-row" style={{ justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="no-cancel-btn" onClick={() => navigate('/fc/grn')}>Cancel</button>
              {/* Say what the button does. "Create GRN" does not tell a
                  storekeeper that nothing has been counted against the PO yet. */}
              <div className="grnq-hint">
                This records what arrived. Nothing is counted against the PO until
                you check the goods and confirm the GRN on the next screen.
              </div>
              <button className="no-submit-btn" onClick={handleSave} disabled={saving || (grnType !== 'po_inward' && srcDelivered === false)}>
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
