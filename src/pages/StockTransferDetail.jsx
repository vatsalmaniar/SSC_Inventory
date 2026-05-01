import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmt, fmtTs, esc } from '../lib/fmt'
import Layout from '../components/Layout'
import { friendlyError } from '../lib/errorMsg'
import '../styles/orderdetail.css'

const PIPELINE = [
  { key: 'draft',      label: 'Created' },
  { key: 'approved',   label: 'Approved' },
  { key: 'picking',    label: 'Picking' },
  { key: 'packing',    label: 'Packing' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'received',   label: 'Received' },
]
const PIPELINE_KEYS = PIPELINE.map(s => s.key)

const STATUS_LABELS = {
  draft: 'Draft', approved: 'Approved', picking: 'Picking',
  packing: 'Packing', dispatched: 'In Transit', received: 'Received', cancelled: 'Cancelled',
}

function fmtDC(d) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function printStockTransferDC(transfer, items) {
  const dcDate = fmtDC(transfer.dispatched_at || transfer.created_at)
  const challanNo = transfer.transfer_number
  const itemRows = items.map((item, idx) => `
    <tr>
      <td style="color:#94a3b8">${idx + 1}</td>
      <td class="code">${esc(item.item_code) || '—'}</td>
      <td class="c" style="font-weight:700">${item.qty}</td>
      <td class="c" style="color:#64748b">Pc</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Stock Transfer Challan — ${esc(challanNo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5}
  .mono{font-family:'Geist Mono',monospace}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .co-name{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:2px}
  .co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
  .co-addr{font-size:10.5px;color:#475569;line-height:1.6}
  .doc-title{font-size:28px;font-weight:700;color:#0f172a;text-align:right;letter-spacing:-0.5px}
  .doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:#f0f9ff;color:#0369a1;text-align:right}
  .divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
  .meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
  .meta-addr{font-size:11px;color:#475569;line-height:1.6}
  .ref-table{width:100%;border-collapse:collapse}
  .ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
  .ref-table tr td:first-child{color:#64748b;width:45%}
  .ref-table tr td:last-child{font-weight:600;color:#0f172a}
  .terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}
  .terms span strong{color:#0f172a;font-weight:600}
  table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
  table.items thead tr{border-bottom:2px solid #0f172a}
  table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
  table.items th.c{text-align:center}
  table.items tbody tr{border-bottom:1px solid #f1f5f9}
  table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
  table.items td.c{text-align:center}
  table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
  .note-box{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
  .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}
  .sig-cell{text-align:center;font-size:10px;color:#64748b}
  .sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}
  .sig-name{font-weight:600;color:#0f172a;font-size:11px}
  .footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:10px;color:#94a3b8;line-height:1.6}
  .footer-right{font-size:10px;color:#94a3b8;text-align:right}
  @media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">
      E/12, Siddhivinayak Towers, B/H DCP Office<br/>
      Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
      GSTIN: 24ABGCS0605M1ZE
    </div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">Internal · Non-Sale</div>
    <div class="doc-title">Stock Transfer</div>
  </div>
</div>

<hr class="divider"/>

<div class="meta-grid">
  <div>
    <div class="meta-section-label">From (Source FC)</div>
    <div class="meta-name">${esc(transfer.source_fc)} Warehouse</div>
    <div class="meta-addr">SSC Control Pvt. Ltd. — ${esc(transfer.source_fc)}</div>
  </div>
  <div>
    <div class="meta-section-label">To (Destination FC)</div>
    <div class="meta-name">${esc(transfer.destination_fc)} Warehouse</div>
    <div class="meta-addr">SSC Control Pvt. Ltd. — ${esc(transfer.destination_fc)}</div>
  </div>
</div>

<hr class="divider"/>

<div class="meta-grid">
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>Challan No.</td><td class="mono">${esc(challanNo)}</td></tr>
      <tr><td>Challan Date</td><td>${dcDate}</td></tr>
      <tr><td>Created Date</td><td>${fmtDC(transfer.created_at)}</td></tr>
      ${transfer.created_by_name ? `<tr><td>Created By</td><td>${esc(transfer.created_by_name)}</td></tr>` : ''}
      ${transfer.dispatched_by ? `<tr><td>Dispatched By</td><td>${esc(transfer.dispatched_by)}</td></tr>` : ''}
    </table>
  </div>
  <div>
    <div class="meta-section-label">Vehicle / Transport</div>
    <table class="ref-table">
      ${transfer.vehicle_no ? `<tr><td>Vehicle No.</td><td>${esc(transfer.vehicle_no)}</td></tr>` : ''}
      ${transfer.transporter ? `<tr><td>Transporter</td><td>${esc(transfer.transporter)}</td></tr>` : ''}
      ${!transfer.vehicle_no && !transfer.transporter ? `<tr><td colspan="2" style="color:#94a3b8;font-style:italic">Not specified</td></tr>` : ''}
    </table>
  </div>
</div>

<div class="terms">
  <span>Document Type: <strong>Internal Stock Transfer (Non-Commercial)</strong></span>
  <span>Movement: <strong>${esc(transfer.source_fc)} → ${esc(transfer.destination_fc)}</strong></span>
</div>

<table class="items">
  <thead>
    <tr>
      <th style="width:40px">#</th>
      <th>Item Code</th>
      <th class="c" style="width:80px">Qty</th>
      <th class="c" style="width:60px">Unit</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
  <tfoot>
    <tr style="border-top:2px solid #0f172a">
      <td colspan="2" style="padding:9px 10px;font-size:11px;font-weight:700;color:#0f172a">Total Items</td>
      <td class="c" style="padding:9px 10px;font-weight:700">${items.reduce((s, i) => s + (i.qty || 0), 0)}</td>
      <td></td>
    </tr>
  </tfoot>
</table>

<div class="note-box">
  <strong>Note:</strong> This is an internal stock movement between SSC Control fulfilment centres.
  No sale, no GST applicable. Movement is for inventory rebalancing only.
  ${transfer.notes ? `<br/><br/><strong>Remarks:</strong> ${esc(transfer.notes)}` : ''}
</div>

<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Dispatched By</div>${esc(transfer.source_fc)} Store</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Driver / Vehicle</div>Acknowledgement</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Received By</div>${esc(transfer.destination_fc)} Store</div>
</div>

<div class="footer">
  <div class="footer-left">
    SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>
    Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
    Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010
  </div>
  <div class="footer-right">
    sales@ssccontrol.com<br/>
    www.ssccontrol.com
  </div>
</div>

</body></html>`

  const w = window.open('', '_blank')
  if (!w) { return false }
  w.document.write(html)
  w.document.close()
  return true
}

const ACTION_LABELS = {
  created: 'Transfer created', approved: 'Approved', picked: 'Picking started',
  packed: 'Packed', dispatched: 'Dispatched', received: 'Receipt confirmed',
  cancelled: 'Cancelled',
}

export default function StockTransferDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const guard = useRef(false)

  const [userRole, setUserRole]   = useState('')
  const [userName, setUserName]   = useState('')
  const [userId,   setUserId]     = useState('')
  const [transfer, setTransfer]   = useState(null)
  const [items, setItems]         = useState([])
  const [activity, setActivity]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  // editable received_qty per item id when receiving
  const [recvQtys, setRecvQtys]   = useState({})
  const [discrepancies, setDiscrepancies] = useState({})

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role); setUserName(profile?.name || ''); setUserId(session.user.id)
    await loadAll()
  }

  async function loadAll() {
    setLoading(true)
    const [tRes, iRes, aRes] = await Promise.all([
      sb.from('stock_transfers').select('*').eq('id', id).single(),
      sb.from('stock_transfer_items').select('*').eq('transfer_id', id).order('sr_no'),
      sb.from('stock_transfer_activity').select('*').eq('transfer_id', id).order('created_at', { ascending: false }),
    ])
    setTransfer(tRes.data)
    setItems(iRes.data || [])
    setActivity(aRes.data || [])
    const rq = {}; (iRes.data || []).forEach(it => { rq[it.id] = it.received_qty > 0 ? it.received_qty : it.qty })
    setRecvQtys(rq)
    const dq = {}; (iRes.data || []).forEach(it => { dq[it.id] = it.discrepancy_reason || '' })
    setDiscrepancies(dq)
    setLoading(false)
  }

  async function goToItem(item_code) {
    const { data } = await sb.from('items').select('id').eq('item_code', item_code).single()
    if (data?.id) navigate(`/items/${data.id}`)
  }

  async function logActivity(action, note) {
    await sb.from('stock_transfer_activity').insert({
      transfer_id: id, action, actor_name: userName, actor_id: userId, note: note || null,
    })
  }

  async function advance(targetStatus, label) {
    if (guard.current) return
    guard.current = true; setSaving(true)
    const update = { status: targetStatus, updated_at: new Date().toISOString() }
    if (targetStatus === 'approved')   { update.approved_by   = userName; update.approved_at   = new Date().toISOString() }
    if (targetStatus === 'picking')    { update.picked_by     = userName; update.picked_at     = new Date().toISOString() }
    if (targetStatus === 'packing')    { update.packed_by     = userName; update.packed_at     = new Date().toISOString() }
    if (targetStatus === 'dispatched') { update.dispatched_by = userName; update.dispatched_at = new Date().toISOString() }

    const { error } = await sb.from('stock_transfers').update(update).eq('id', id)
    if (error) { toast(friendlyError(error)); guard.current = false; setSaving(false); return }
    await logActivity(targetStatus === 'picking' ? 'picked' : targetStatus === 'packing' ? 'packed' : targetStatus, null)
    toast(label + ' ✓', 'success')
    guard.current = false; setSaving(false)
    await loadAll()
  }

  async function receiveTransfer() {
    if (guard.current) return
    for (const it of items) {
      const recv = parseInt(recvQtys[it.id]) || 0
      if (recv > it.qty) { toast(`Received qty for ${it.item_code} cannot exceed ${it.qty}`); return }
      if (recv !== it.qty && !discrepancies[it.id]?.trim()) {
        toast(`Discrepancy reason required for ${it.item_code}`); return
      }
    }
    guard.current = true; setSaving(true)
    for (const it of items) {
      await sb.from('stock_transfer_items').update({
        received_qty: parseInt(recvQtys[it.id]) || 0,
        discrepancy_reason: discrepancies[it.id]?.trim() || null,
      }).eq('id', it.id)
    }
    const { error } = await sb.from('stock_transfers').update({
      status: 'received',
      received_by: userName,
      received_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); guard.current = false; setSaving(false); return }
    await logActivity('received', null)
    toast('Receipt confirmed', 'success')
    guard.current = false; setSaving(false)
    await loadAll()
  }

  async function cancelTransfer() {
    if (!cancelReason.trim()) { toast('Reason required'); return }
    if (guard.current) return
    guard.current = true; setSaving(true)
    const { error } = await sb.from('stock_transfers').update({
      status: 'cancelled',
      cancelled_by: userName,
      cancelled_at: new Date().toISOString(),
      cancelled_reason: cancelReason.trim(),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); guard.current = false; setSaving(false); return }
    await logActivity('cancelled', cancelReason.trim())
    toast('Transfer cancelled', 'success')
    setShowCancel(false); setCancelReason('')
    guard.current = false; setSaving(false)
    await loadAll()
  }

  if (loading) return <Layout pageKey="fc"><div className="od-page"><div className="od-body" style={{ padding: 60, textAlign: 'center', color: 'var(--gray-400)' }}>Loading...</div></div></Layout>
  if (!transfer) return <Layout pageKey="fc"><div className="od-page"><div className="od-body" style={{ padding: 60, textAlign: 'center', color: 'var(--gray-400)' }}>Transfer not found</div></div></Layout>

  const isCancelled = transfer.status === 'cancelled'
  const pipelineIdx = isCancelled ? -1 : PIPELINE_KEYS.indexOf(transfer.status)
  const isOpsRole = ['ops','admin','management'].includes(userRole)
  const isSourceFcUser = (userRole === 'fc_kaveri' && transfer.source_fc === 'Kaveri')
                     || (userRole === 'fc_godawari' && transfer.source_fc === 'Godawari')
  const isDestFcUser = (userRole === 'fc_kaveri' && transfer.destination_fc === 'Kaveri')
                   || (userRole === 'fc_godawari' && transfer.destination_fc === 'Godawari')

  const canApprove   = transfer.status === 'draft'      && isOpsRole
  const canPick      = transfer.status === 'approved'   && (isOpsRole || isSourceFcUser)
  const canPack      = transfer.status === 'picking'    && (isOpsRole || isSourceFcUser)
  const canDispatch  = transfer.status === 'packing'    && (isOpsRole || isSourceFcUser)
  const canReceive   = transfer.status === 'dispatched' && (isOpsRole || isDestFcUser)
  const canCancel    = userRole === 'admin' && !['dispatched','received','cancelled'].includes(transfer.status)

  const statusBadgeClass =
    isCancelled ? 'cancelled' :
    transfer.status === 'received' ? 'delivered' :
    transfer.status === 'dispatched' ? 'delivery' :
    transfer.status === 'draft' ? 'pending' : 'active'

  return (
    <Layout pageTitle={transfer.transfer_number} pageKey="fc">
    <div className="od-page">
      <div className="od-body">

        {/* ── Header ── */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  Stock Transfer
                  <span className={'od-status-badge ' + statusBadgeClass}>
                    {STATUS_LABELS[transfer.status] || transfer.status}
                  </span>
                </div>
                <div className="od-header-title">
                  {transfer.source_fc} → {transfer.destination_fc}
                </div>
                <div className="od-header-num">
                  {transfer.transfer_number} · {fmt(transfer.created_at)}
                </div>
              </div>
            </div>
            <div className="od-header-actions">
              <button className="od-btn" onClick={() => navigate('/fc/transfers')} style={{gap:6}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
                Back
              </button>
              {canCancel && (
                <button className="od-btn od-btn-danger" onClick={() => setShowCancel(true)}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Cancel
                </button>
              )}
              {canApprove && (
                <button className="od-btn od-btn-approve" onClick={() => advance('approved', 'Approved')} disabled={saving}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  {saving ? 'Approving...' : 'Approve'}
                </button>
              )}
              {canPick && (
                <button className="od-btn od-btn-edit" onClick={() => advance('picking', 'Picking started')} disabled={saving}>
                  {saving ? 'Updating...' : 'Start Picking'}
                </button>
              )}
              {canPack && (
                <button className="od-btn od-btn-edit" onClick={() => advance('packing', 'Packed')} disabled={saving}>
                  {saving ? 'Updating...' : 'Mark Packed'}
                </button>
              )}
              {canDispatch && (
                <button className="od-btn od-btn-approve" onClick={() => advance('dispatched', 'Dispatched')} disabled={saving}>
                  {saving ? 'Dispatching...' : 'Dispatch →'}
                </button>
              )}
              {canReceive && (
                <button className="od-btn od-btn-approve" onClick={receiveTransfer} disabled={saving}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  {saving ? 'Confirming...' : 'Confirm Receipt'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Pipeline Bar ── */}
        <div className={'od-pipeline-bar' + (isCancelled ? ' od-pipeline-cancelled' : '')}>
          <div className="od-pipeline-stages">
            {PIPELINE.map((stage, i) => {
              const isDone   = !isCancelled && pipelineIdx > i
              const isActive = !isCancelled && pipelineIdx === i
              return (
                <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                  {stage.label}
                </div>
              )
            })}
          </div>
        </div>

        <div className="od-layout">
          <div className="od-main">

            {/* Cancelled banner */}
            {isCancelled && (
              <div className="od-cancelled-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
                <div><div className="od-cancelled-banner-label">Transfer Cancelled</div><div>{transfer.cancelled_reason || 'No reason provided.'}</div></div>
              </div>
            )}

            {/* In Transit banner */}
            {transfer.status === 'dispatched' && (
              <div className="od-delivery-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
                <div>
                  <div className="od-pending-banner-label">In Transit — {transfer.source_fc} → {transfer.destination_fc}</div>
                  <div>Dispatched on {fmt(transfer.dispatched_at)} by {transfer.dispatched_by || '—'}. Awaiting receipt at destination.</div>
                </div>
              </div>
            )}

            {/* Received banner */}
            {transfer.status === 'received' && (
              <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                <div>
                  <div className="od-pending-banner-label">Received · {transfer.destination_fc}</div>
                  <div>Transfer fully received and complete.</div>
                </div>
              </div>
            )}

            {/* Transfer Information */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Transfer Information</div></div>
              <div className="od-card-body">
                <div className="od-detail-grid">
                  <div className="od-detail-field"><label>Source FC</label><div className="val" style={{fontWeight:600}}>{transfer.source_fc}</div></div>
                  <div className="od-detail-field"><label>Destination FC</label><div className="val" style={{fontWeight:600}}>{transfer.destination_fc}</div></div>
                  <div className="od-detail-field"><label>Created By</label><div className="val">{transfer.created_by_name || '—'}</div></div>
                  <div className="od-detail-field"><label>Created Date</label><div className="val">{fmt(transfer.created_at)}</div></div>
                  <div className="od-detail-field"><label>Approved By</label><div className="val">{transfer.approved_by || '—'}</div></div>
                  <div className="od-detail-field"><label>Approved Date</label><div className="val">{transfer.approved_at ? fmt(transfer.approved_at) : '—'}</div></div>
                  <div className="od-detail-field"><label>Picked By</label><div className="val">{transfer.picked_by || '—'}</div></div>
                  <div className="od-detail-field"><label>Packed By</label><div className="val">{transfer.packed_by || '—'}</div></div>
                  <div className="od-detail-field"><label>Dispatched By</label><div className="val">{transfer.dispatched_by || '—'}</div></div>
                  <div className="od-detail-field"><label>Dispatched Date</label><div className="val">{transfer.dispatched_at ? fmt(transfer.dispatched_at) : '—'}</div></div>
                  <div className="od-detail-field"><label>Received By</label><div className="val">{transfer.received_by || '—'}</div></div>
                  <div className="od-detail-field"><label>Received Date</label><div className="val">{transfer.received_at ? fmt(transfer.received_at) : '—'}</div></div>
                  <div className="od-detail-field"><label>Vehicle No</label><div className="val">{transfer.vehicle_no || '—'}</div></div>
                  <div className="od-detail-field"><label>Transporter</label><div className="val">{transfer.transporter || '—'}</div></div>
                  {transfer.notes && <div className="od-detail-field" style={{ gridColumn: '1/-1' }}><label>Notes</label><div className="val od-notes-val">{transfer.notes}</div></div>}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Items ({items.length})</div></div>
              <div className="od-items-table-wrap">
                <table className="od-items-table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 16 }}>#</th>
                      <th>Item Code</th>
                      <th style={{ textAlign: 'center' }}>Dispatched Qty</th>
                      <th style={{ textAlign: 'center' }}>Received Qty</th>
                      <th style={{ paddingRight: 16 }}>Discrepancy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={it.id}>
                        <td style={{ paddingLeft: 16, color: 'var(--gray-400)', fontSize: 11 }}>{idx + 1}</td>
                        <td className="mono">
                          <span onClick={() => goToItem(it.item_code)} style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>{it.item_code}</span>
                        </td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{it.qty}</td>
                        <td style={{ textAlign: 'center' }}>
                          {canReceive ? (
                            <input type="number" min="0" max={it.qty} value={recvQtys[it.id] ?? ''}
                              onChange={e => setRecvQtys(prev => ({ ...prev, [it.id]: e.target.value }))}
                              style={{ width:80, padding:'6px 8px', textAlign:'center', border:'1.5px solid var(--gray-200)', borderRadius:5, fontFamily:'var(--mono)', fontSize:13, outline:'none' }} />
                          ) : (
                            <span style={{ fontWeight: it.received_qty === it.qty ? 600 : 700, color: it.received_qty === it.qty ? '#166534' : it.received_qty > 0 ? '#c2410c' : 'var(--gray-400)' }}>
                              {transfer.status === 'received' ? (it.received_qty ?? 0) : '—'}
                            </span>
                          )}
                        </td>
                        <td style={{ paddingRight: 16, fontSize: 12 }}>
                          {canReceive ? (
                            <input value={discrepancies[it.id] || ''} onChange={e => setDiscrepancies(prev => ({ ...prev, [it.id]: e.target.value }))}
                              placeholder="Reason if short..."
                              style={{ width:'100%', padding:'6px 8px', border:'1.5px solid var(--gray-200)', borderRadius:5, fontSize:12, outline:'none' }} />
                          ) : (
                            <span style={{ color:'var(--gray-500)' }}>{it.discrepancy_reason || '—'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
          {/* ── Sidebar ── */}
          <div className="od-sidebar">

            {/* Challan card */}
            {['dispatched','received'].includes(transfer.status) && (
              <div className="od-side-card">
                <div className="od-side-card-title">Stock Transfer Challan</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-900)', fontFamily: 'var(--mono)', marginBottom: 4 }}>{transfer.transfer_number}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 12 }}>
                  {transfer.source_fc} → {transfer.destination_fc}
                  {transfer.dispatched_at && <> · {fmt(transfer.dispatched_at)}</>}
                </div>
                <button onClick={() => { if (!printStockTransferDC(transfer, items)) toast('Popup blocked — allow popups for this site') }}
                  style={{ width:'100%', padding:'9px 14px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                  Print DC
                </button>
              </div>
            )}

            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity & Notes</div>
              <div className="od-activity-list">
                {activity.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', padding:'14px 4px' }}>No activity yet.</div>
                ) : (
                  activity.slice().reverse().map(a => {
                    const dotType =
                      a.action === 'cancelled' ? 'cancel'
                      : a.action === 'dispatched' ? 'dispatch'
                      : a.action === 'received' ? 'success'
                      : a.action === 'approved' ? 'approved'
                      : a.action === 'created' ? 'created'
                      : 'system'
                    const dotIcon = {
                      cancel:   <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
                      dispatch: <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>,
                      success:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
                      approved: <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
                      created:  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
                      system:   <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
                    }[dotType]
                    return (
                      <div key={a.id} className={'od-tl-item' + (a.action === 'cancelled' ? ' od-tl-cancel' : '')}>
                        <div className={'od-tl-dot ' + dotType}>{dotIcon}</div>
                        <div className="od-tl-content">
                          <div className="od-tl-header">
                            <div className="od-tl-title">{ACTION_LABELS[a.action] || a.action}</div>
                            <div className="od-tl-time">{fmtTs(a.created_at)}</div>
                          </div>
                          <div className="od-tl-sub">{a.actor_name || '—'}</div>
                          {a.note && <div className="od-tl-sub" style={{ marginTop: 2 }}>{a.note}</div>}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cancel modal */}
        {showCancel && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', padding: 20 }}>
            <div style={{ background:'white', borderRadius:12, padding: 24, width: '100%', maxWidth: 480 }}>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--gray-900)', marginBottom: 14 }}>Cancel Transfer</div>
              <div style={{ fontSize: 13, color:'var(--gray-600)', marginBottom: 12 }}>This cannot be undone. Provide a reason:</div>
              <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3}
                style={{ width:'100%', padding:'10px 12px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:14, outline:'none', resize:'vertical', fontFamily:'inherit' }} />
              <div style={{ display:'flex', gap: 10, justifyContent:'flex-end', marginTop: 14 }}>
                <button onClick={() => { setShowCancel(false); setCancelReason('') }} style={{ padding:'8px 14px', background:'white', border:'1.5px solid var(--gray-200)', borderRadius:7, fontSize:13, fontWeight:600, color:'var(--gray-600)', cursor:'pointer' }}>Back</button>
                <button onClick={cancelTransfer} disabled={saving} style={{ padding:'8px 14px', background:'#dc2626', border:'none', borderRadius:7, fontSize:13, fontWeight:600, color:'white', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </Layout>
  )
}

