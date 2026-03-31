import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

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

const PIPELINE_STAGES = [
  { key: 'pending',       label: 'Pending Review'   },
  { key: 'inv_check',     label: 'Inventory Check'  },
  { key: 'dispatch',      label: 'Shipped'          },
  { key: 'gen_invoice',   label: 'Generate Invoice' },
  { key: 'dispatched_fc', label: 'Dispatched'       },
]
const PIPELINE_KEYS = PIPELINE_STAGES.map(s => s.key)

function emptyItem() {
  return { _new: true, item_code: '', qty: '', lp_unit_price: '', discount_pct: '0', unit_price_after_disc: '', total_price: '', dispatch_date: '', customer_ref_no: '' }
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

  const [editMode, setEditMode]   = useState(false)
  const [editData, setEditData]   = useState({})
  const [editItems, setEditItems] = useState([])

  const [comments, setComments]             = useState([])
  const [profiles, setProfiles]             = useState([])
  const [commentText, setCommentText]       = useState('')
  const [mentionQuery, setMentionQuery]     = useState(null)
  const [postingComment, setPostingComment] = useState(false)
  const commentInputRef = useRef(null)

  // Dispatch modals
  const [showDispatchModal, setShowDispatchModal] = useState(false)
  const [showPartialModal, setShowPartialModal]   = useState(false)
  const [partialItems, setPartialItems]           = useState([])
  const [showFCModal, setShowFCModal]             = useState(false)
  const [fcMode, setFcMode]               = useState('porter')
  const [fcVehicleType, setFcVehicleType] = useState('')
  const [fcVehicleNum, setFcVehicleNum]   = useState('')
  const [fcDriverName, setFcDriverName]   = useState('')

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
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
    await loadOrder()
    loadProfiles()
  }

  async function loadOrder() {
    setLoading(true)
    const { data } = await sb.from('orders').select('*, order_items(*)').eq('id', id).single()
    setOrder(data)
    setLoading(false)
    loadComments()
  }

  async function loadComments() {
    const { data } = await sb.from('order_comments')
      .select('*').eq('order_id', id).order('created_at', { ascending: true })
    setComments(data || [])
  }

  async function loadProfiles() {
    const { data } = await sb.from('profiles').select('id,name,username').order('name')
    setProfiles(data || [])
  }

  // Derived state
  const effectiveStatus  = order?.status === 'partial_dispatch' ? 'dispatch' : order?.status
  const isOps            = ['ops', 'admin'].includes(user.role)
  const isPending        = order?.status === 'pending'
  const isCancelled      = order?.status === 'cancelled'
  const pipelineIdx      = PIPELINE_KEYS.indexOf(effectiveStatus)
  const canAdvance       = isOps && !isCancelled && pipelineIdx >= 0 && pipelineIdx < PIPELINE_KEYS.length - 1
  const hasAnyDispatched = (order?.order_items || []).some(i => (i.dispatched_qty || 0) > 0)
  const hasAnyPending    = (order?.order_items || []).some(i => i.qty > (i.dispatched_qty || 0))
  const showDispatchCols = hasAnyDispatched

  const actionBtnLabel = isPending ? 'Accept Order'
    : order?.status === 'inv_check'   ? 'Confirm Inventory'
    : order?.status === 'dispatch'    ? 'Ship Order'
    : order?.status === 'gen_invoice' ? (hasAnyPending ? 'Ship Next Batch' : 'Dispatched')
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
    const { data } = await sb.from('customers').select('customer_name,gst,billing_address,credit_terms')
      .ilike('customer_name', '%' + q + '%').limit(10)
    return data || []
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items').select('item_code').ilike('item_code', '%' + q + '%').limit(10)
    return data || []
  }

  async function saveEdits() {
    setSaving(true)
    const validItems = editItems.filter(i => i.item_code.trim() && i.qty)
    if (!editData.customer_name.trim() || !validItems.length) {
      alert('Customer name and at least one item are required.')
      setSaving(false); return
    }
    await sb.from('orders').update({
      customer_name: editData.customer_name.trim(), customer_gst: editData.customer_gst.trim(),
      dispatch_address: editData.dispatch_address.trim(), po_number: editData.po_number.trim(),
      order_date: editData.order_date, order_type: editData.order_type, received_via: editData.received_via,
      freight: parseFloat(editData.freight) || 0, credit_terms: editData.credit_terms, notes: editData.notes,
      edited_by: user.name, updated_at: new Date().toISOString(),
    }).eq('id', id)
    const { error: delErr } = await sb.from('order_items').delete().eq('order_id', id)
    if (delErr) { alert('Failed to clear items: ' + delErr.message); setSaving(false); return }
    const { error: insErr } = await sb.from('order_items').insert(validItems.map((item, i) => ({
      order_id: id, sr_no: i + 1, item_code: item.item_code.trim(),
      qty: parseFloat(item.qty), lp_unit_price: parseFloat(item.lp_unit_price) || 0,
      discount_pct: parseFloat(item.discount_pct) || 0,
      unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
      total_price: parseFloat(item.total_price) || 0, dispatch_date: item.dispatch_date || null,
      customer_ref_no: item.customer_ref_no?.trim() || null,
    })))
    if (insErr) { alert('Failed to save items: ' + insErr.message); setSaving(false); return }
    await logActivity('Order edited — details updated')
    await loadOrder()
    setEditMode(false); setSaving(false)
  }

  async function saveAndApprove() {
    setSaving(true)
    const validItems = editItems.filter(i => i.item_code.trim() && i.qty)
    if (!editData.customer_name.trim() || !validItems.length) {
      alert('Customer name and at least one item are required.')
      setSaving(false); return
    }
    await sb.from('orders').update({
      customer_name: editData.customer_name.trim(), customer_gst: editData.customer_gst.trim(),
      dispatch_address: editData.dispatch_address.trim(), po_number: editData.po_number.trim(),
      order_date: editData.order_date, order_type: editData.order_type, received_via: editData.received_via,
      freight: parseFloat(editData.freight) || 0, credit_terms: editData.credit_terms, notes: editData.notes,
      edited_by: user.name, updated_at: new Date().toISOString(),
    }).eq('id', id)
    await sb.from('order_items').delete().eq('order_id', id)
    await sb.from('order_items').insert(validItems.map((item, i) => ({
      order_id: id, sr_no: i + 1, item_code: item.item_code.trim(),
      qty: parseFloat(item.qty), lp_unit_price: parseFloat(item.lp_unit_price) || 0,
      discount_pct: parseFloat(item.discount_pct) || 0,
      unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
      total_price: parseFloat(item.total_price) || 0, dispatch_date: item.dispatch_date || null,
      customer_ref_no: item.customer_ref_no?.trim() || null,
    })))
    const { data: updatedOrder } = await sb.from('orders').select('order_type').eq('id', id).single()
    const { error } = await sb.rpc('approve_order', {
      order_id: id, approver_name: user.name,
      order_type: updatedOrder?.order_type || editData.order_type,
    })
    if (error) { alert('Approval error: ' + error.message); setSaving(false); return }
    await sb.from('orders').update({ status: 'inv_check', updated_at: new Date().toISOString() }).eq('id', id)
    await loadOrder()
    setEditMode(false); setSaving(false)
  }

  // ── Log activity as a comment ──
  async function logActivity(message) {
    const { error } = await sb.from('order_comments').insert({
      order_id: id, author_name: user.name, message, tagged_users: [], is_activity: true
    })
    if (error) console.warn('logActivity failed:', error.message)
  }

  // ── Stage advancement ──
  async function advanceToNext() {
    if (!canAdvance) return
    setSaving(true)
    if (isPending) {
      const { error } = await sb.rpc('approve_order', { order_id: id, approver_name: user.name, order_type: order.order_type })
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
      await sb.from('orders').update({ status: 'inv_check', updated_at: new Date().toISOString() }).eq('id', id)
      await logActivity('Order accepted — moved to Inventory Check')
      await loadOrder(); setSaving(false)
    } else if (order.status === 'inv_check') {
      await sb.from('orders').update({ status: 'dispatch', updated_at: new Date().toISOString() }).eq('id', id)
      await logActivity('Inventory check confirmed — moved to Shipping')
      await loadOrder(); setSaving(false)
    } else if (order.status === 'dispatch' || order.status === 'partial_dispatch') {
      setSaving(false)
      setShowDispatchModal(true)
    } else if (order.status === 'gen_invoice') {
      setSaving(false)
      const pendingItemsExist = (order.order_items || []).some(i => i.qty > (i.dispatched_qty || 0))
      if (pendingItemsExist) {
        // Still items to dispatch — open dispatch modal for next batch
        setShowDispatchModal(true)
      } else {
        // All items dispatched — proceed to FC dispatch
        setFcMode('porter'); setFcVehicleType(''); setFcVehicleNum(''); setFcDriverName('')
        setShowFCModal(true)
      }
    }
  }

  // ── Full dispatch ──
  async function fullyDispatch() {
    setSaving(true); setShowDispatchModal(false)
    for (const item of (order.order_items || [])) {
      const { error } = await sb.from('order_items').update({ dispatched_qty: item.qty }).eq('id', item.id)
      if (error) { alert('Failed to update item ' + item.item_code + ': ' + error.message); setSaving(false); return }
    }
    const { error } = await sb.from('orders').update({ status: 'gen_invoice', updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('Failed to update order status: ' + error.message); setSaving(false); return }
    await logActivity('Full Ship — all items shipped, moved to Generate Invoice')
    await loadOrder(); setSaving(false)
  }

  // ── Partial dispatch ──
  function openPartialDispatch() {
    setShowDispatchModal(false)
    setPartialItems((order.order_items || []).map(item => {
      const remaining = item.qty - (item.dispatched_qty || 0)
      return {
        id:             item.id,
        item_code:      item.item_code,
        qty:            item.qty,
        dispatched_qty: item.dispatched_qty || 0,
        dispatchQty:    '0',           // default 0 — user must enter qty
        checked:        remaining > 0, // pre-check only items with pending qty; fully done = unchecked
        remaining,
      }
    }))
    setShowPartialModal(true)
  }

  async function submitPartialDispatch() {
    const selected = partialItems.filter(i => i.checked && parseFloat(i.dispatchQty) > 0)
    if (!selected.length) { alert('Select at least one item with a dispatch quantity.'); return }
    // Validate: dispatch qty must not exceed remaining qty per item
    for (const item of selected) {
      const remaining = item.qty - (item.dispatched_qty || 0)
      if (parseFloat(item.dispatchQty) > remaining) {
        alert(`${item.item_code}: dispatch qty (${item.dispatchQty}) exceeds remaining qty (${remaining}).`)
        return
      }
    }
    setSaving(true); setShowPartialModal(false)
    // Only update the selected items — unselected items are untouched
    for (const item of selected) {
      const newDispatched = (item.dispatched_qty || 0) + parseFloat(item.dispatchQty)
      const { error } = await sb.from('order_items').update({ dispatched_qty: newDispatched }).eq('id', item.id)
      if (error) { alert('Failed to update item ' + item.item_code + ': ' + error.message); setSaving(false); return }
    }
    // Move to gen_invoice so this batch can be invoiced
    const { error: orderErr } = await sb.from('orders').update({ status: 'gen_invoice', updated_at: new Date().toISOString() }).eq('id', id)
    if (orderErr) { alert('Failed to update order status: ' + orderErr.message); setSaving(false); return }
    const summary = selected.map(i => `${i.item_code}: ${i.dispatchQty} units`).join(', ')
    await logActivity(`Partial Dispatch — ${summary}`)
    await loadOrder(); setSaving(false)
  }

  // ── FC dispatch ──
  async function submitFCDispatch() {
    if (!fcDriverName.trim()) { alert('Driver / Person Name is required.'); return }
    if (fcMode === 'vehicle' && !fcVehicleType) { alert('Please select a vehicle type.'); return }
    setSaving(true); setShowFCModal(false)
    // Check if any pending items remain — fetch fresh from DB
    const { data: freshItems } = await sb.from('order_items').select('qty, dispatched_qty').eq('order_id', id)
    const stillPending = (freshItems || []).some(i => i.qty > (i.dispatched_qty || 0))
    const nextStatus   = stillPending ? 'dispatch' : 'dispatched_fc'
    const { error: fcErr } = await sb.from('orders').update({
      status:         nextStatus,
      dispatch_mode:  fcMode,
      vehicle_type:   fcMode === 'vehicle' ? fcVehicleType : null,
      vehicle_number: fcMode === 'vehicle' ? fcVehicleNum.trim() : null,
      driver_name:    fcDriverName.trim(),
      updated_at:     new Date().toISOString(),
    }).eq('id', id)
    if (fcErr) { alert('Failed to record FC dispatch: ' + fcErr.message); setSaving(false); return }
    const details = fcMode === 'vehicle'
      ? `${fcVehicleType}${fcVehicleNum ? ' · ' + fcVehicleNum : ''} — ${fcDriverName}`
      : fcMode === 'porter' ? `Porter — ${fcDriverName}` : `Self Pickup — ${fcDriverName}`
    await logActivity(`Dispatched — ${details}${stillPending ? ' (pending items remain — returned to Shipping)' : ' (all items dispatched)'}`)
    await loadOrder(); setSaving(false)
  }

  // ── Comment / @mention ──
  function handleCommentInput(e) {
    const val = e.target.value
    setCommentText(val)
    const cursor = e.target.selectionStart
    const match = val.slice(0, cursor).match(/@([\w.]*)$/)
    setMentionQuery(match ? match[1] : null)
  }

  function insertMention(name) {
    const cursor = commentInputRef.current?.selectionStart || commentText.length
    const before = commentText.slice(0, cursor).replace(/@[\w.]*$/, '@' + name + ' ')
    setCommentText(before + commentText.slice(cursor))
    setMentionQuery(null)
    setTimeout(() => commentInputRef.current?.focus(), 0)
  }

  async function submitComment() {
    if (!commentText.trim()) return
    setPostingComment(true)
    const text = commentText.trim()
    // Extract tagged names (e.g. @Ankit Dave or @ankit.dave)
    const tagged = [...text.matchAll(/@([A-Za-z][A-Za-z\s.]+?)(?=\s|$)/g)].map(m => m[1].trim())
    await sb.from('order_comments').insert({ order_id: id, author_name: user.name, message: text, tagged_users: tagged })
    // Insert notifications for each tagged person
    if (tagged.length > 0) {
      const notifRows = tagged.map(tname => ({
        user_name: tname,
        message: `${user.name} tagged you in ${order.order_number}`,
        order_id: id,
        order_number: order.order_number,
        from_name: user.name,
      }))
      await sb.from('notifications').insert(notifRows)
    }
    setCommentText(''); setMentionQuery(null)
    await loadComments(); setPostingComment(false)
  }

  function renderMessage(text) {
    return text.split(/(@\S+)/g).map((part, i) =>
      part.startsWith('@') ? <span key={i} className="od-mention-tag">{part}</span> : part
    )
  }

  async function cancelOrder() {
    if (!cancelReason.trim()) { alert('Please enter a reason.'); return }
    setSaving(true)
    await sb.from('orders').update({ status: 'cancelled', cancelled_reason: cancelReason.trim(), updated_at: new Date().toISOString() }).eq('id', id)
    await logActivity(`Order cancelled — Reason: ${cancelReason.trim()}`)
    setShowCancel(false); setCancelReason('')
    await loadOrder(); setSaving(false)
  }

  if (loading) return (
    <Layout pageTitle="Order Detail" pageKey="orders">
      <div className="od-page"><div className="loading-state" style={{ paddingTop: 80 }}><div className="loading-spin" />Loading...</div></div>
    </Layout>
  )
  if (!order) return null

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
                  {order.order_type === 'SO' ? 'Standard Order' : 'Customised Order'}
                  <span className={'od-status-badge ' + (isPending ? 'pending' : isCancelled ? 'cancelled' : 'active')}>
                    {isPending ? 'Pending Approval' : isCancelled ? 'Cancelled' : (hasAnyDispatched && hasAnyPending) ? 'Partially Dispatched' : 'Active'}
                  </span>
                </div>
                <div className="od-header-title">{editMode ? editData.customer_name || order.customer_name : order.customer_name}</div>
                <div className="od-header-num">{order.order_number} · {fmt(order.order_date)}</div>
              </div>
            </div>
            <div className="od-header-actions">
              {isOps && !isCancelled && (
                <>
                  {(isPending || order.status === 'inv_check') && !editMode && (
                    <button className="od-btn od-btn-edit" onClick={enterEditMode}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      Edit Order
                    </button>
                  )}
                  {isPending && editMode && (
                    <>
                      <button className="od-btn" onClick={() => setEditMode(false)} disabled={saving}>Discard</button>
                      <button className="od-btn od-btn-edit" onClick={saveEdits} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
                      <button className="od-btn od-btn-approve" onClick={saveAndApprove} disabled={saving}>
                        <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                        {saving ? 'Approving...' : 'Save & Approve'}
                      </button>
                    </>
                  )}
                  {!editMode && (
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
        <div className={'od-pipeline-bar' + (isCancelled ? ' od-pipeline-cancelled' : '') + (hasAnyDispatched && hasAnyPending ? ' od-pipeline-partial' : '')}>
          <div className="od-pipeline-stages">
            {PIPELINE_STAGES.map((stage, i) => {
              const isDone    = !isCancelled && pipelineIdx > i
              const isActive  = !isCancelled && effectiveStatus === stage.key
              return (
                <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                  {stage.label}
                  {isActive && hasAnyDispatched && hasAnyPending && (
                    <span style={{fontSize:9,background:'rgba(255,255,255,0.2)',borderRadius:4,padding:'1px 5px',marginLeft:4,fontWeight:700}}>PARTIAL</span>
                  )}
                </div>
              )
            })}
          </div>
          {isOps && !isCancelled && canAdvance && !editMode && (
            <button className="od-mark-complete-btn" onClick={advanceToNext} disabled={saving}>
              <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              {saving ? 'Updating...' : actionBtnLabel}
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

            {order.status === 'dispatched_fc' && order.dispatch_mode && (
              <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div>
                  <div className="od-pending-banner-label">Dispatched</div>
                  <div>
                    Mode: {order.dispatch_mode.charAt(0).toUpperCase() + order.dispatch_mode.slice(1)}
                    {order.dispatch_mode === 'vehicle' && order.vehicle_type && ` · ${order.vehicle_type}`}
                    {order.dispatch_mode === 'vehicle' && order.vehicle_number && ` · ${order.vehicle_number}`}
                    {order.driver_name && ` · ${order.driver_name}`}
                  </div>
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
                        <Typeahead
                          value={editData.customer_name}
                          onChange={v => setEditData(p => ({ ...p, customer_name: v }))}
                          onSelect={c => setEditData(p => ({ ...p, customer_name: c.customer_name, customer_gst: c.gst || p.customer_gst, dispatch_address: c.billing_address || p.dispatch_address, credit_terms: c.credit_terms || p.credit_terms }))}
                          placeholder="Search customer..."
                          fetchFn={fetchCustomers}
                          renderItem={c => <><div className="typeahead-item-main">{c.customer_name}</div>{c.gst && <div className="typeahead-item-sub">GST: {c.gst}</div>}</>}
                        />
                      </div>
                      <div className="od-edit-field">
                        <label>GST Number</label>
                        <input value={editData.customer_gst} onChange={e => setEditData(p => ({ ...p, customer_gst: e.target.value }))} />
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field">
                        <label>Order Type</label>
                        <select value={editData.order_type} onChange={e => setEditData(p => ({ ...p, order_type: e.target.value }))}>
                          <option value="SO">Standard Order (SO)</option>
                          <option value="CO">Customised Order (CO)</option>
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
                        <label>PO / Reference Number</label>
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
                        <select value={editData.credit_terms} onChange={e => setEditData(p => ({ ...p, credit_terms: e.target.value }))}>
                          <option value="">— Select —</option>
                          <option value="COD">COD</option><option value="15 days">15 Days</option><option value="30 days">30 Days</option>
                          <option value="45 days">45 Days</option><option value="60 days">60 Days</option><option value="90 days">90 Days</option><option value="Advance">Advance</option>
                        </select>
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
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>PO / Reference</label><div className="val">{order.po_number || '—'}</div></div>
                    <div className="od-detail-field"><label>Order Type</label><div className="val">{order.order_type === 'SO' ? 'Standard Order' : 'Customised Order'}</div></div>
                    <div className="od-detail-field"><label>Order Date</label><div className="val">{fmt(order.order_date)}</div></div>
                    <div className="od-detail-field"><label>Received Via</label><div className="val">{order.received_via || '—'}</div></div>
                    <div className="od-detail-field"><label>Freight</label><div className="val">₹{(order.freight || 0).toLocaleString('en-IN')}</div></div>
                    <div className="od-detail-field"><label>GST Number</label><div className="val">{order.customer_gst || '—'}</div></div>
                    {order.notes && <div className="od-detail-field" style={{ gridColumn: '1/-1' }}><label>Notes</label><div className="val od-notes-val">{order.notes}</div></div>}
                  </div>
                )}
              </div>
            </div>

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
                          <th className="col-date">Dispatch</th><th className="col-ref">Cust. Ref No</th><th className="col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {editItems.map((item, idx) => (
                          <tr key={idx} className={item.item_code ? 'row-filled' : ''}>
                            <td className="col-sr">{idx + 1}</td>
                            <td className="col-code">
                              <Typeahead value={item.item_code} onChange={v => updateEditItem(idx, 'item_code', v)}
                                onSelect={it => updateEditItem(idx, 'item_code', it.item_code)} placeholder="Search..."
                                fetchFn={fetchItems} renderItem={it => <div className="typeahead-item-main" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{it.item_code}</div>} />
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
                  {hasAnyPending && (
                    <div className="od-dispatch-tile od-dispatch-tile-pending">
                      <div className="od-dispatch-tile-header">
                        <span className="od-dispatch-tile-label">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                          Pending Items
                        </span>
                        <span className="od-dispatch-tile-count">
                          {(order.order_items || []).reduce((s, i) => s + Math.max(0, i.qty - (i.dispatched_qty || 0)), 0)} units pending
                        </span>
                      </div>
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 16 }}>#</th>
                            <th>Item Code</th>
                            <th style={{ textAlign: 'center' }}>Total Qty</th>
                            <th style={{ textAlign: 'center' }}>Dispatched</th>
                            <th style={{ textAlign: 'center', color: '#92400e' }}>Pending</th>
                            <th>Unit Price</th>
                            <th className="right" style={{ paddingRight: 16 }}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.order_items || []).filter(item => item.qty > (item.dispatched_qty || 0)).map(item => {
                            const dispQty    = item.dispatched_qty || 0
                            const pendingQty = item.qty - dispQty
                            return (
                              <tr key={item.id}>
                                <td style={{ paddingLeft: 16, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                                <td className="mono">{item.item_code}</td>
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
                  {hasAnyDispatched && (
                    <div className="od-dispatch-tile od-dispatch-tile-dispatched">
                      <div className="od-dispatch-tile-header">
                        <span className="od-dispatch-tile-label">
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><polyline points="20 6 9 17 4 12"/></svg>
                          Dispatched Record
                        </span>
                        <span className="od-dispatch-tile-count" style={{ background: '#d1fae5', color: '#065f46' }}>
                          {(order.order_items || []).reduce((s, i) => s + (i.dispatched_qty || 0), 0)} units dispatched
                        </span>
                      </div>
                      <table className="od-items-table">
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 16 }}>#</th>
                            <th>Item Code</th>
                            <th style={{ textAlign: 'center' }}>Total Qty</th>
                            <th style={{ textAlign: 'center', color: '#166534' }}>Dispatched</th>
                            <th style={{ textAlign: 'center' }}>Pending</th>
                            <th>Unit Price</th>
                            <th className="right" style={{ paddingRight: 16 }}>Dispatched Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.order_items || []).filter(item => (item.dispatched_qty || 0) > 0).map(item => {
                            const dispQty    = item.dispatched_qty || 0
                            const pendingQty = item.qty - dispQty
                            return (
                              <tr key={item.id} style={{ background: pendingQty === 0 ? '#f0fdf4' : undefined }}>
                                <td style={{ paddingLeft: 16, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                                <td className="mono">{item.item_code}</td>
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

                  <div className="od-totals">
                    <div className="od-totals-inner">
                      <div className="od-totals-row"><span>Order Subtotal</span><span>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row"><span>Freight</span><span>₹{(order.freight||0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                      <div className="od-totals-row grand"><span>Grand Total</span><span>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </>
              ) : (
                // ── STANDARD VIEW (no dispatch yet) ──
                <>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft: 20 }}>#</th>
                        <th>Item Code</th>
                        <th>Qty</th>
                        <th>LP Price</th><th>Disc %</th><th>Unit Price</th>
                        <th>Dispatch Date</th>
                        <th>Cust. Ref No</th>
                        <th className="right" style={{ paddingRight: 20 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(order.order_items || []).map(item => (
                        <tr key={item.id}>
                          <td style={{ paddingLeft: 20, color: 'var(--gray-400)', fontSize: 11 }}>{item.sr_no}</td>
                          <td className="mono">{item.item_code}</td>
                          <td>{item.qty}</td>
                          <td>{item.lp_unit_price ? '₹' + item.lp_unit_price : '—'}</td>
                          <td>{item.discount_pct ? item.discount_pct + '%' : '—'}</td>
                          <td>₹{item.unit_price_after_disc}</td>
                          <td>{item.dispatch_date ? fmt(item.dispatch_date) : '—'}</td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{item.customer_ref_no || '—'}</td>
                          <td className="right" style={{ paddingRight: 20 }}>₹{(item.total_price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

            {/* Activity + Comments */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">
                <div className="od-activity-item">
                  <div className="od-activity-dot submitted" />
                  <div>
                    <div className="od-activity-label">Submitted by</div>
                    <div className="od-activity-val">{order.submitted_by_name || order.engineer_name || '—'}</div>
                    <div className="od-activity-time">{fmtTs(order.created_at)}</div>
                  </div>
                </div>
                {order.edited_by && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot edited" />
                    <div>
                      <div className="od-activity-label">Edited by</div>
                      <div className="od-activity-val">{order.edited_by}</div>
                      <div className="od-activity-time">{fmtTs(order.updated_at)}</div>
                    </div>
                  </div>
                )}
                {order.approved_by && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot approved" />
                    <div>
                      <div className="od-activity-label">Approved by</div>
                      <div className="od-activity-val">{order.approved_by}</div>
                    </div>
                  </div>
                )}
                {isCancelled && (
                  <div className="od-activity-item">
                    <div className="od-activity-dot cancelled" />
                    <div>
                      <div className="od-activity-label">Cancelled</div>
                      <div className="od-activity-time">{order.cancelled_reason}</div>
                    </div>
                  </div>
                )}
                {comments.map(c => {
                  const isSystem = c.is_activity === true
                  const dotColor = c.message.includes('cancelled') || c.message.includes('Cancelled') ? '#ef4444'
                    : c.message.includes('Dispatch') || c.message.includes('dispatch') ? '#2563eb'
                    : c.message.includes('Invoice') ? '#7c3aed'
                    : '#16a34a'
                  return isSystem ? (
                    <div key={c.id} className="od-activity-item">
                      <div className="od-activity-dot" style={{ background: dotColor }} />
                      <div>
                        <div className="od-activity-val" style={{ fontSize: 12, fontWeight: 600 }}>{c.message}</div>
                        <div className="od-activity-time">{c.author_name} · {fmtTs(c.created_at)}</div>
                      </div>
                    </div>
                  ) : (
                    <div key={c.id} className="od-activity-item od-comment-item">
                      <div className="od-comment-avatar">{c.author_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>
                      <div className="od-comment-body">
                        <div className="od-comment-author">
                          {c.author_name}
                          {c.tagged_users?.length > 0 && (
                            <span className="od-comment-tagged">
                              tagged {c.tagged_users.map(u => '@' + u).join(', ')}
                            </span>
                          )}
                        </div>
                        <div className="od-comment-text">{renderMessage(c.message)}</div>
                        <div className="od-activity-time">{fmtTs(c.created_at)}</div>
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
                    <div className="od-mention-dropdown">
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

            <div className="od-side-card">
              <div className="od-side-card-title">Customer</div>
              <div className="od-side-val-big">{order.customer_name}</div>
              {order.customer_gst && <div className="od-side-sub">GST: {order.customer_gst}</div>}
            </div>

            <div className="od-side-card">
              <div className="od-side-card-title">Account Owner</div>
              <div className="od-account-owner">
                <div className="od-owner-avatar">{(order.engineer_name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>
                <div className="od-side-val-big" style={{ margin: 0 }}>{order.engineer_name || '—'}</div>
              </div>
            </div>

            <div className="od-side-card">
              <div className="od-side-card-title">Credit Terms</div>
              {order.credit_terms ? <div className="od-credit-badge">{order.credit_terms}</div> : <div className="od-side-sub" style={{ fontStyle: 'italic' }}>Not specified</div>}
            </div>

            {order.dispatch_address && (
              <div className="od-side-card">
                <div className="od-side-card-title">Dispatch Address</div>
                <div className="od-side-sub" style={{ lineHeight: 1.6 }}>{order.dispatch_address}</div>
              </div>
            )}

            <div className="od-side-card">
              <div className="od-side-card-title">Reference Number</div>
              <div className="od-ref-num" style={{ color: isPending ? 'var(--gray-500)' : 'var(--blue-700)' }}>{order.order_number}</div>
              {isPending && <div className="od-side-sub">SSC number assigned after approval</div>}
            </div>

          </div>
        </div>
      </div>

      {/* ── Cancel Modal ── */}
      {showCancel && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCancel(false) }}>
          <div className="od-cancel-modal">
            <div className="od-cancel-title">Cancel Order</div>
            <div className="od-cancel-sub">Reason is required and will be shown to the sales team.</div>
            <textarea className="od-cancel-textarea" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="e.g. Customer requested cancellation..." autoFocus />
            <div className="od-cancel-actions">
              <button className="od-btn" onClick={() => { setShowCancel(false); setCancelReason('') }}>Dismiss</button>
              <button className="od-btn od-btn-danger" onClick={cancelOrder} disabled={saving} style={{ background: '#fff1f2', borderColor: '#fecdd3' }}>
                {saving ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Dispatch Choice Modal ── */}
      {showDispatchModal && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowDispatchModal(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 460 }}>
            <div className="od-cancel-title">Ship Order</div>
            <div className="od-cancel-sub">How would you like to ship this order?</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="od-dispatch-choice-btn" onClick={fullyDispatch}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:28,height:28,color:'#166534',marginBottom:8}}>
                  <path d="M5 13l4 4L19 7"/>
                </svg>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>Fully Ship</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Ship entire order quantity and move forward</div>
              </button>
              <button className="od-dispatch-choice-btn" onClick={openPartialDispatch}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:28,height:28,color:'#92400e',marginBottom:8}}>
                  <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--gray-900)' }}>Partial Dispatch</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4 }}>Select items and quantities to dispatch now</div>
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
            <div className="od-cancel-title">Partial Dispatch</div>
            <div className="od-cancel-sub">Select items and enter the quantity to dispatch now. Remaining qty will stay pending.</div>
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
              <button className="od-btn od-btn-approve" onClick={submitPartialDispatch} disabled={saving}>
                {saving ? 'Dispatching...' : 'Confirm Partial Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── FC Dispatch Modal ── */}
      {showFCModal && (
        <div className="od-cancel-overlay" onClick={e => { if (e.target === e.currentTarget) setShowFCModal(false) }}>
          <div className="od-cancel-modal" style={{ maxWidth: 460 }}>
            <div className="od-cancel-title">Dispatched</div>
            <div className="od-cancel-sub">Enter dispatch details to complete the order.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>Dispatch Mode</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['porter','vehicle','self'].map(m => (
                    <button key={m} onClick={() => setFcMode(m)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid ' + (fcMode === m ? '#0d2461' : 'var(--gray-200)'), background: fcMode === m ? '#0d2461' : 'white', color: fcMode === m ? 'white' : 'var(--gray-700)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                      {m === 'self' ? 'Self Pickup' : m.charAt(0).toUpperCase() + m.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {fcMode === 'vehicle' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>Vehicle Type</label>
                    <select value={fcVehicleType} onChange={e => setFcVehicleType(e.target.value)}
                      style={{ width: '100%', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '9px 12px', fontFamily: 'var(--font)', fontSize: 13, outline: 'none', background: 'white' }}>
                      <option value="">— Select Vehicle Type —</option>
                      {['Rickshaw','Bolero','Eicher','Hathi','Bike'].map(v => <option key={v}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>Vehicle Number</label>
                    <input value={fcVehicleNum} onChange={e => setFcVehicleNum(e.target.value)} placeholder="e.g. GJ01AB1234"
                      style={{ width: '100%', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '9px 12px', fontFamily: 'var(--font)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </>
              )}
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.6px', color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>
                  Driver / Person Name <span style={{ color: '#e11d48' }}>*</span>
                </label>
                <input value={fcDriverName} onChange={e => setFcDriverName(e.target.value)} placeholder="Full name of driver or contact person"
                  style={{ width: '100%', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '9px 12px', fontFamily: 'var(--font)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div className="od-cancel-actions">
              <button className="od-btn" onClick={() => setShowFCModal(false)}>Cancel</button>
              <button className="od-btn od-btn-approve" onClick={submitFCDispatch} disabled={saving}>
                {saving ? 'Dispatching...' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </Layout>
  )
}
