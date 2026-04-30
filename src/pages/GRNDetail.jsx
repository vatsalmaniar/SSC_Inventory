import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { friendlyError } from '../lib/errorMsg'

import { fmtShort, fmtDateTime, esc } from '../lib/fmt'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const GRN_TYPE_LABELS = {
  po_inward:'PO Inward', customer_rejection:'Customer Rejection',
  sample_return:'Sample Return', cancellation_return:'Cancellation Return',
}
const GRN_TYPE_COLORS = {
  po_inward: { bg:'#eff6ff', color:'#1d4ed8' }, customer_rejection: { bg:'#fef2f2', color:'#dc2626' },
  sample_return: { bg:'#faf5ff', color:'#7e22ce' }, cancellation_return: { bg:'#fffbeb', color:'#b45309' },
}
const GRN_STATUS_LABELS = { draft:'GRN Created', checking:'Checking Goods', confirmed:'GRN Confirmed', invoice_matched:'Invoice Matched', inward_posted:'Inward Posted' }

const GRN_PIPELINE = [
  { key: 'draft',    label: 'GRN Created' },
  { key: 'checking', label: 'Check Goods' },
  { key: 'confirmed',label: 'GRN Confirmed' },
]

const DISPATCH_MODES = ['By Person','Vehicle','Porter','Transport','Courier']
const VEHICLE_TYPES  = ['Rickshaw','Bolero','Eicher','Hathi','Bike','SSC Vehicle','Other']

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function OwnerChip({ name }) {
  if (!name) return <span style={{ color:'var(--gray-300)' }}>—</span>
  const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(name), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
      <span style={{ fontSize:13, fontWeight:500, color:'var(--gray-800)' }}>{name}</span>
    </div>
  )
}

function fmtINR(val) {
  if (!val) return '—'
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function fmtDC(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '.' + (dt.getMonth()+1).toString().padStart(2,'0') + '.' + dt.getFullYear()
}

export default function GRNDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [grn, setGrn]           = useState(null)
  const [grnItems, setGrnItems] = useState([])
  const [linkedPos, setLinkedPos] = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [userRole, setUserRole] = useState('')
  const [userName, setUserName] = useState('')

  // Delivery form state
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [dispatchMode, setDispatchMode]         = useState('')
  const [personName, setPersonName]             = useState('')
  const [vehicleType, setVehicleType]           = useState('')
  const [vehicleNum, setVehicleNum]             = useState('')
  const [driverName, setDriverName]             = useState('')
  const [transporterName, setTransporterName]   = useState('')
  const [transporterId, setTransporterId]       = useState('')
  const [lrNumber, setLrNumber]                 = useState('')
  const [courierCompany, setCourierCompany]     = useState('')
  const [trackingNum, setTrackingNum]           = useState('')

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    setUserRole(profile?.role || '')
    setUserName(profile?.name || '')
    await loadGRN()
  }


  async function loadGRN(silent) {
    if (!silent) setLoading(true)
    const [grnRes, itemsRes] = await Promise.all([
      sb.from('grn').select('*').eq('id', id).single(),
      sb.from('grn_items').select('*').eq('grn_id', id).order('id'),
    ])
    if (grnRes.error || !grnRes.data) { setGrn(null); setLoading(false); return }
    setGrn(grnRes.data)
    setGrnItems(itemsRes.data || [])

    // Collect unique po_ids from grn_items (+ grn-level po_id if set)
    const poIdSet = new Set()
    if (grnRes.data?.po_id) poIdSet.add(grnRes.data.po_id)
    for (const it of (itemsRes.data || [])) { if (it.po_id) poIdSet.add(it.po_id) }
    if (poIdSet.size) {
      const { data: pos } = await sb.from('purchase_orders')
        .select('id,po_number,status,total_amount,vendor_name,po_date,order_number')
        .in('id', [...poIdSet])
      setLinkedPos(pos || [])
    } else {
      setLinkedPos([])
    }
    setLoading(false)
  }

  // ── Status transitions ──
  async function handleMoveToChecking() {
    setSaving(true)
    const { error } = await sb.from('grn').update({ status: 'checking' }).eq('id', id)
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    toast('Moved to Check Goods', 'success')
    setSaving(false)
    await loadGRN()
  }

  async function handleConfirm() {
    // Build delivery details
    let deliveryFields = {}
    if (dispatchMode) {
      deliveryFields.dispatch_mode = dispatchMode
      if (dispatchMode === 'By Person' || dispatchMode === 'Porter') deliveryFields.driver_name = personName.trim()
      if (dispatchMode === 'Vehicle') { deliveryFields.vehicle_type = vehicleType; deliveryFields.vehicle_number = vehicleNum.trim(); deliveryFields.driver_name = driverName.trim() }
      if (dispatchMode === 'Transport') { deliveryFields.transporter_name = transporterName.trim(); deliveryFields.transporter_id = transporterId.trim(); deliveryFields.vehicle_number = lrNumber.trim() || null; deliveryFields.driver_name = transporterName.trim() }
      if (dispatchMode === 'Courier') { deliveryFields.driver_name = courierCompany.trim(); deliveryFields.vehicle_number = trackingNum.trim() || null }
    }

    setSaving(true)

    // Save delivery details first
    const { error: deliveryErr } = await sb.from('grn').update({
      ...deliveryFields,
    }).eq('id', id)
    if (deliveryErr) { toast('Failed to save delivery details: ' + deliveryErr.message); setSaving(false); return }

    // Use atomic RPC for GRN confirmation + PO received_qty updates (row-level locks, no race conditions)
    if (grn.grn_type === 'po_inward') {
      const { error: rpcErr } = await sb.rpc('confirm_grn', { p_grn_id: id })
      if (rpcErr) { toast(friendlyError(rpcErr, "GRN confirmation failed. Please try again.")); setSaving(false); return }

      // Auto-create purchase invoice entry for inward billing (dedup: skip if one already exists for this GRN)
      const { count: existingInv } = await sb.from('purchase_invoices').select('id', { count: 'exact', head: true }).eq('grn_id', id)
      if (!existingInv) {
        const { error: invErr } = await sb.from('purchase_invoices').insert({
          grn_id: id,
          po_id: grn.po_id || grnItems[0]?.po_id || null,
          vendor_name: grn.vendor_name || null,
          vendor_id: grn.vendor_id || null,
          status: 'three_way_check',
          is_test: false,
          created_at: new Date().toISOString(),
        })
        if (invErr) toast(friendlyError(invErr, "GRN confirmed but purchase invoice auto-create failed. Please try again."))
      }
    } else {
      // Non-PO GRNs (returns/rejections) — just confirm status
      const { error } = await sb.from('grn').update({ status: 'confirmed' }).eq('id', id)
      if (error) { toast(friendlyError(error)); setSaving(false); return }
    }

    toast('GRN confirmed', 'success')
    setSaving(false)
    await loadGRN()
  }

  // ── GRN Document ──
  function buildGrnHtml() {
    const grnDate = fmtDC(grn.received_at || grn.created_at)
    const totalRecv = grnItems.reduce((s, i) => s + (i.received_qty || 0), 0)
    const totalAcc = grnItems.reduce((s, i) => s + (i.accepted_qty || 0), 0)
    const totalRej = grnItems.reduce((s, i) => s + (i.rejected_qty || 0), 0)
    const typeLabel = GRN_TYPE_LABELS[grn.grn_type] || grn.grn_type
    const typeBadge = GRN_TYPE_COLORS[grn.grn_type] || { bg:'#eff6ff', color:'#1d4ed8' }

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>GRN — ${grn.grn_number}</title>
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
  .doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:${typeBadge.bg};color:${typeBadge.color};text-align:right}
  .divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
  .meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
  .ref-table{width:100%;border-collapse:collapse}
  .ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
  .ref-table tr td:first-child{color:#64748b;width:45%}
  .ref-table tr td:last-child{font-weight:600;color:#0f172a}
  table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
  table.items thead tr{border-bottom:2px solid #0f172a}
  table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
  table.items th.r{text-align:right} table.items th.c{text-align:center}
  table.items tbody tr{border-bottom:1px solid #f1f5f9} table.items tbody tr:last-child{border-bottom:none}
  table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
  table.items td.r{text-align:right} table.items td.c{text-align:center}
  table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
  .summary-wrap{display:flex;justify-content:flex-end;margin-top:16px}
  .summary-table{width:260px;border-collapse:collapse}
  .summary-table td{padding:5px 0;font-size:11.5px}
  .summary-table td.lbl{color:#64748b} .summary-table td.val{text-align:right;font-weight:600}
  .summary-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
  .notes-box{margin:16px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px}
  .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}
  .sig-cell{text-align:center;font-size:10px;color:#64748b}
  .sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}
  .sig-name{font-weight:600;color:#0f172a;font-size:11px}
  .footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:10px;color:#94a3b8;line-height:1.6} .footer-right{font-size:10px;color:#94a3b8;text-align:right}
  @media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style></head><body>
<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE</div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">${typeLabel}</div>
    <div class="doc-title">Goods Receipt Note</div>
  </div>
</div>
<hr class="divider"/>
<div class="meta-grid">
  <div>
    ${grn.vendor_name ? `<div class="meta-section-label">Vendor</div><div class="meta-name">${esc(grn.vendor_name)}</div>` : `<div class="meta-section-label">Type</div><div class="meta-name">${esc(typeLabel)}</div>`}
    ${grn.dispatch_mode ? `<div style="margin-top:12px"><div class="meta-section-label">Delivery</div><table class="ref-table"><tr><td>Mode</td><td>${esc(grn.dispatch_mode)}</td></tr>${grn.vehicle_number ? `<tr><td>${grn.dispatch_mode === 'Transport' ? 'LR Number' : grn.dispatch_mode === 'Courier' ? 'Tracking No.' : 'Vehicle No.'}</td><td class="mono">${esc(grn.vehicle_number)}</td></tr>` : ''}${grn.driver_name ? `<tr><td>${grn.dispatch_mode === 'Transport' ? 'Transporter' : grn.dispatch_mode === 'Courier' ? 'Courier Co.' : grn.dispatch_mode === 'By Person' || grn.dispatch_mode === 'Porter' ? 'Name' : 'Driver'}</td><td>${esc(grn.driver_name)}</td></tr>` : ''}</table></div>` : ''}
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>GRN No.</td><td class="mono">${esc(grn.grn_number)}</td></tr>
      <tr><td>Received Date</td><td>${grnDate}</td></tr>
      <tr><td>Fulfilment Centre</td><td>${esc(grn.fulfilment_center) || '—'}</td></tr>
      <tr><td>Received By</td><td>${esc(grn.received_by) || '—'}</td></tr>
      ${grn.invoice_number ? `<tr><td>Vendor Invoice</td><td class="mono">${esc(grn.invoice_number)}</td></tr>` : ''}
      ${grn.invoice_date ? `<tr><td>Invoice Date</td><td>${fmtDC(grn.invoice_date)}</td></tr>` : ''}
      ${grn.invoice_amount ? `<tr><td>Invoice Amount</td><td>₹ ${Number(grn.invoice_amount).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr>` : ''}
    </table>
  </div>
</div>
<hr class="divider"/>
<table class="items"><thead><tr>
  <th style="width:40px">#</th><th>Item Code</th>
  <th class="c" style="width:80px">Ordered</th><th class="c" style="width:80px">Received</th><th class="c" style="width:80px">Accepted</th>
  ${totalRej > 0 ? '<th class="c" style="width:80px">Rejected</th><th>Reason</th>' : ''}
</tr></thead><tbody>
${grnItems.map((item, idx) => `<tr>
  <td style="color:#94a3b8">${idx + 1}</td><td class="code">${esc(item.item_code) || '—'}</td>
  <td class="c">${item.ordered_qty || item.expected_qty || '—'}</td>
  <td class="c" style="font-weight:700">${item.received_qty || 0}</td>
  <td class="c" style="font-weight:600;color:#15803d">${item.accepted_qty || 0}</td>
  ${totalRej > 0 ? `<td class="c" style="font-weight:600;color:${(item.rejected_qty||0)>0?'#dc2626':'#94a3b8'}">${item.rejected_qty || 0}</td><td style="font-size:10.5px;color:#64748b">${esc(item.rejection_reason) || '—'}</td>` : ''}
</tr>`).join('')}
</tbody></table>
<div class="summary-wrap"><table class="summary-table">
  <tr><td class="lbl">Total Items</td><td class="val">${grnItems.length}</td></tr>
  <tr><td class="lbl">Total Received</td><td class="val">${totalRecv}</td></tr>
  <tr class="grand"><td class="lbl">Total Accepted</td><td class="val" style="color:#15803d">${totalAcc}</td></tr>
  ${totalRej > 0 ? `<tr><td class="lbl">Total Rejected</td><td class="val" style="color:#dc2626">${totalRej}</td></tr>` : ''}
</table></div>
${grn.notes ? `<div class="notes-box"><strong>Notes:</strong> ${esc(grn.notes)}</div>` : ''}
<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Received By</div>${esc(grn.received_by) || 'Stores'}</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Inspected By</div>Quality</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div>
</div>
<div class="footer">
  <div class="footer-left">SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div>
  <div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div>
</div>
</body></html>`
  }

  function viewGrnDoc() {
    const html = buildGrnHtml()
    const w = window.open('', '_blank')
    if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
    w.document.write(html)
    w.document.close()
  }

  if (loading) return (
    <Layout pageTitle="GRN" pageKey="fc">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/></div></div>
    </Layout>
  )

  if (!grn) return (
    <Layout pageTitle="GRN" pageKey="fc">
      <div className="od-page"><div className="od-body">
        <div style={{ textAlign:'center', padding:60, color:'var(--gray-400)' }}>
          <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>GRN not found</div>
          <button className="od-btn" onClick={() => navigate('/fc/grn')}>← Back to GRNs</button>
        </div>
      </div></div>
    </Layout>
  )

  const fmt = fmtShort
  const fmtTs = fmtDateTime
  const tc = GRN_TYPE_COLORS[grn.grn_type] || GRN_TYPE_COLORS.po_inward
  const sc = grn.status === 'confirmed' ? { bg:'#f0fdf4', color:'#15803d' } : grn.status === 'checking' ? { bg:'#fef3c7', color:'#b45309' } : { bg:'#f1f5f9', color:'#475569' }
  const totalAccepted = grnItems.reduce((s, i) => s + (i.accepted_qty || 0), 0)
  const totalRejected = grnItems.reduce((s, i) => s + (i.rejected_qty || 0), 0)

  // Pipeline index
  const pipelineIdx = GRN_PIPELINE.findIndex(s => s.key === grn.status)
  const isConfirmed = grn.status === 'confirmed' || grn.status === 'invoice_matched' || grn.status === 'inward_posted'

  return (
    <Layout pageTitle={grn.grn_number} pageKey="fc">
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Goods Receipt Note</div>
                <div className="od-header-title">{grn.grn_number}</div>
                <div className="od-header-num" style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background:tc.bg, color:tc.color }}>{GRN_TYPE_LABELS[grn.grn_type] || grn.grn_type}</span>
                  <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background:sc.bg, color:sc.color }}>{GRN_STATUS_LABELS[grn.status] || grn.status}</span>
                  {grn.vendor_name && <span style={{ fontSize:12, color:'var(--gray-500)' }}>· {grn.vendor_name}</span>}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={viewGrnDoc} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width:15, height:15 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  View GRN
                </button>
                <button className="od-btn" onClick={() => navigate('/fc/grn')}>← Back</button>
              </div>
            </div>
          </div>

          {/* Pipeline bar */}
          <div className={'od-pipeline-bar' + (isConfirmed ? '' : ' od-pipeline-delivery')}>
            <div className="od-pipeline-stages">
              {GRN_PIPELINE.map((stage, idx) => {
                const isDone   = isConfirmed ? true : pipelineIdx > idx
                const isActive = !isConfirmed && pipelineIdx === idx
                return (
                  <div key={stage.key} className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}>
                    {stage.label}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Two-column layout */}
          <div className="od-layout">
            <div className="od-main">

              {/* Confirmed banner */}
              {isConfirmed && (
                <div className="od-pending-banner" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',color:'#166534'}}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  <div>
                    <div className="od-pending-banner-label">GRN Confirmed</div>
                    <div>Goods have been received and verified.</div>
                  </div>
                </div>
              )}

              {/* Document References */}
              <div className="od-card">
                <div className="od-card-header"><div className="od-card-title">Receipt Information</div></div>
                <div className="od-card-body">
                  <div className="od-detail-grid">
                    <div className="od-detail-field">
                      <label>GRN Number</label>
                      <div className="val" style={{fontFamily:'var(--mono)',fontWeight:700}}>{grn.grn_number}</div>
                    </div>
                    <div className="od-detail-field">
                      <label>Type</label>
                      <div className="val"><span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4, background:tc.bg, color:tc.color }}>{GRN_TYPE_LABELS[grn.grn_type]}</span></div>
                    </div>
                    <div className="od-detail-field">
                      <label>Fulfilment Centre</label>
                      <div className="val">{grn.fulfilment_center || '—'}</div>
                    </div>
                    <div className="od-detail-field">
                      <label>Received Date</label>
                      <div className="val">{fmt(grn.received_at || grn.created_at)}</div>
                    </div>
                    {grn.vendor_name && (
                      <div className="od-detail-field">
                        <label>Vendor</label>
                        <div className="val">
                          {grn.vendor_id
                            ? <span onClick={() => navigate('/vendors/' + grn.vendor_id)} style={{ color:'#2563eb', cursor:'pointer' }}>{grn.vendor_name}</span>
                            : grn.vendor_name}
                        </div>
                      </div>
                    )}
                    {linkedPos.length > 0 && (
                      <div className="od-detail-field" style={{ gridColumn:'1 / -1' }}>
                        <label>Linked Purchase Order{linkedPos.length > 1 ? 's' : ''} ({linkedPos.length})</label>
                        <div className="val" style={{ display:'flex', flexDirection:'column', gap:6, marginTop:4 }}>
                          {linkedPos.map(p => (
                            <div key={p.id}
                              onClick={() => navigate('/procurement/po/' + p.id)}
                              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8, padding:'8px 10px', border:'1px solid var(--gray-100)', borderRadius:6, cursor:'pointer', background:'#f9fafb' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:180 }}>
                                <span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:700, color:'#1a4dab' }}>{p.po_number}</span>
                                <span style={{ fontSize:11, color:'var(--gray-500)' }}>· {p.vendor_name || '—'}</span>
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                {p.total_amount > 0 && <span style={{ fontSize:11, color:'var(--gray-700)', fontWeight:600 }}>₹{Number(p.total_amount).toLocaleString('en-IN', { maximumFractionDigits:0 })}</span>}
                                <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:10, background:'#eff6ff', color:'#1d4ed8', textTransform:'capitalize' }}>{(p.status || '').replace(/_/g, ' ')}</span>
                                <span style={{ fontSize:11, color:'#1a4dab' }}>→</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {grn.order_id && (
                      <div className="od-detail-field">
                        <label>Linked Order</label>
                        <div className="val">
                          <span onClick={() => navigate('/orders/' + grn.order_id)} style={{ color:'#2563eb', cursor:'pointer', fontFamily:'var(--mono)' }}>View Order →</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Delivery Details (read-only, shown after confirmed) */}
              {grn.dispatch_mode && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-title">Delivery Details</div></div>
                  <div className="od-card-body">
                    <div className="od-detail-grid">
                      <div className="od-detail-field"><label>Mode</label><div className="val">{grn.dispatch_mode}</div></div>
                      {grn.vehicle_type && <div className="od-detail-field"><label>Vehicle Type</label><div className="val">{grn.vehicle_type}</div></div>}
                      {grn.vehicle_number && <div className="od-detail-field"><label>{grn.dispatch_mode === 'Transport' ? 'LR Number' : grn.dispatch_mode === 'Courier' ? 'Tracking No.' : 'Vehicle No.'}</label><div className="val" style={{fontFamily:'var(--mono)',fontWeight:600}}>{grn.vehicle_number}</div></div>}
                      {grn.driver_name && <div className="od-detail-field"><label>{grn.dispatch_mode === 'Transport' ? 'Transporter' : grn.dispatch_mode === 'Courier' ? 'Courier Co.' : grn.dispatch_mode === 'By Person' || grn.dispatch_mode === 'Porter' ? 'Name' : 'Driver'}</label><div className="val">{grn.driver_name}</div></div>}
                    </div>
                  </div>
                </div>
              )}

              {/* Invoice Details */}
              {grn.grn_type === 'po_inward' && (grn.invoice_number || grn.invoice_date || grn.invoice_amount) && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-title">Vendor Invoice</div></div>
                  <div className="od-card-body">
                    <div className="od-detail-grid">
                      {grn.invoice_number && <div className="od-detail-field"><label>Invoice Number</label><div className="val" style={{fontFamily:'var(--mono)'}}>{grn.invoice_number}</div></div>}
                      {grn.invoice_date && <div className="od-detail-field"><label>Invoice Date</label><div className="val">{fmt(grn.invoice_date)}</div></div>}
                      {grn.invoice_amount && <div className="od-detail-field"><label>Invoice Amount</label><div className="val" style={{fontWeight:700}}>{fmtINR(grn.invoice_amount)}</div></div>}
                    </div>
                  </div>
                </div>
              )}

              {/* Items Table */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Items ({grnItems.length})</div>
                  <div style={{ fontSize:12, color:'var(--gray-500)' }}>
                    <span style={{ color:'#15803d', fontWeight:600 }}>{totalAccepted} accepted</span>
                    {totalRejected > 0 && <span style={{ color:'#dc2626', fontWeight:600, marginLeft:8 }}>{totalRejected} rejected</span>}
                  </div>
                </div>
                <div className="od-card-body" style={{ padding:0 }}>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft:20 }}>Item Code</th>
                        <th style={{ textAlign:'right' }}>Ordered</th>
                        <th style={{ textAlign:'right' }}>Received</th>
                        <th style={{ textAlign:'right' }}>Accepted</th>
                        {totalRejected > 0 && <th style={{ textAlign:'right' }}>Rejected</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {grnItems.map((item, idx) => (
                        <tr key={item.id || idx}>
                          <td style={{ paddingLeft:20, fontFamily:'var(--mono)', fontSize:12, fontWeight:500 }}>{item.item_code || '—'}</td>
                          <td style={{ textAlign:'right', color:'var(--gray-500)' }}>{item.ordered_qty || item.expected_qty || '—'}</td>
                          <td style={{ textAlign:'right', fontWeight:600 }}>{item.received_qty}</td>
                          <td style={{ textAlign:'right', fontWeight:600, color:'#15803d' }}>{item.accepted_qty}</td>
                          {totalRejected > 0 && <td style={{ textAlign:'right', fontWeight:600, color: (item.rejected_qty||0) > 0 ? '#dc2626' : 'var(--gray-400)' }}>{item.rejected_qty || 0}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action card */}
              {!isConfirmed && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-title">Action Required</div></div>
                  <div className="od-card-body">
                    {grn.status === 'draft' && (
                      <div>
                        <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>GRN has been created. Physically check the goods and move to next stage.</p>
                        <button className="od-btn od-btn-approve" onClick={handleMoveToChecking} disabled={saving}>
                          {saving ? 'Saving...' : 'Start Checking Goods'}
                        </button>
                      </div>
                    )}

                    {grn.status === 'checking' && !showDeliveryForm && (
                      <div>
                        <p style={{fontSize:13,color:'var(--gray-600)',marginBottom:14}}>Verify all items, then confirm the GRN with delivery details.</p>
                        <button className="od-btn od-btn-approve" onClick={() => setShowDeliveryForm(true)} disabled={saving}>
                          Confirm GRN
                        </button>
                      </div>
                    )}

                    {grn.status === 'checking' && showDeliveryForm && (
                      <div style={{display:'flex',flexDirection:'column',gap:12,maxWidth:440}}>
                        <div style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',marginBottom:4}}>How was it delivered?</div>
                        <div className="od-edit-field">
                          <label>Dispatch Mode</label>
                          <select value={dispatchMode} onChange={e => { setDispatchMode(e.target.value); setPersonName(''); setVehicleType(''); setVehicleNum(''); setDriverName(''); setTransporterName(''); setTransporterId(''); setLrNumber(''); setCourierCompany(''); setTrackingNum('') }}>
                            <option value="">— Select —</option>
                            {DISPATCH_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>

                        {dispatchMode === 'By Person' && (
                          <div className="od-edit-field">
                            <label>Delivery Person Name</label>
                            <input type="text" placeholder="Name of person who delivered" value={personName} onChange={e => setPersonName(e.target.value)} />
                          </div>
                        )}

                        {dispatchMode === 'Vehicle' && (<>
                          <div className="od-edit-field">
                            <label>Vehicle Type</label>
                            <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                              <option value="">— Select —</option>
                              {VEHICLE_TYPES.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                          </div>
                          <div className="od-edit-field">
                            <label>Vehicle Number</label>
                            <input type="text" placeholder="GJ 05 AB 1234" value={vehicleNum} onChange={e => setVehicleNum(e.target.value)} />
                          </div>
                          <div className="od-edit-field">
                            <label>Driver Name</label>
                            <input type="text" placeholder="Driver name" value={driverName} onChange={e => setDriverName(e.target.value)} />
                          </div>
                        </>)}

                        {dispatchMode === 'Porter' && (
                          <div className="od-edit-field">
                            <label>Porter Name</label>
                            <input type="text" placeholder="Porter name" value={personName} onChange={e => setPersonName(e.target.value)} />
                          </div>
                        )}

                        {dispatchMode === 'Transport' && (<>
                          <div className="od-edit-field">
                            <label>Transporter Name</label>
                            <input type="text" placeholder="Transport company name" value={transporterName} onChange={e => setTransporterName(e.target.value)} />
                          </div>
                          <div className="od-edit-field">
                            <label>Transporter ID (GSTIN)</label>
                            <input type="text" placeholder="27AAAAA0000A1Z5" value={transporterId} onChange={e => setTransporterId(e.target.value)} />
                          </div>
                          <div className="od-edit-field">
                            <label>LR / Way Bill Number</label>
                            <input type="text" placeholder="LR number" value={lrNumber} onChange={e => setLrNumber(e.target.value)} />
                          </div>
                        </>)}

                        {dispatchMode === 'Courier' && (<>
                          <div className="od-edit-field">
                            <label>Courier Company</label>
                            <input type="text" placeholder="e.g. DTDC, Blue Dart" value={courierCompany} onChange={e => setCourierCompany(e.target.value)} />
                          </div>
                          <div className="od-edit-field">
                            <label>Tracking Number / AWB</label>
                            <input type="text" placeholder="Tracking / AWB number" value={trackingNum} onChange={e => setTrackingNum(e.target.value)} />
                          </div>
                        </>)}

                        <div style={{display:'flex',gap:8,marginTop:4}}>
                          <button className="od-btn od-btn-approve" onClick={handleConfirm} disabled={saving}>
                            {saving ? 'Confirming...' : 'Confirm GRN'}
                          </button>
                          <button className="od-btn" onClick={() => setShowDeliveryForm(false)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Notes */}
              {grn.notes && (
                <div className="od-card">
                  <div className="od-card-header"><div className="od-card-title">Notes</div></div>
                  <div className="od-card-body">
                    <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6 }}>{grn.notes}</div>
                  </div>
                </div>
              )}

            </div>

            {/* ── RIGHT SIDEBAR ── */}
            <div className="od-sidebar">

              {/* GRN Document */}
              <div className="od-side-card">
                <div className="od-side-card-title">GRN Document</div>
                <div style={{ fontSize:18, fontWeight:700, fontFamily:'var(--mono)', color:'var(--gray-900)', marginBottom:4 }}>{grn.grn_number}</div>
                <div style={{ fontSize:12, color: isConfirmed ? '#15803d' : '#b45309', fontWeight:600, marginBottom:12 }}>{isConfirmed ? 'Confirmed GRN' : 'Draft GRN'}</div>
                <button onClick={viewGrnDoc} style={{
                  display:'flex', alignItems:'center', gap:8, width:'100%', padding:'10px 14px',
                  background:'white', border:'1.5px solid #1d4ed8', borderRadius:10, color:'#1d4ed8',
                  fontFamily:'var(--font)', fontSize:13, fontWeight:600, cursor:'pointer', justifyContent:'center',
                }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16 }}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                  View GRN Document
                </button>
              </div>

              {/* Timeline */}
              <div className="od-side-card od-activity-card" style={{ marginTop:12 }}>
                <div className="od-side-card-title">Timeline</div>
                <div className="od-activity-list">
                  <div className="od-tl-item">
                    <div className="od-tl-dot created"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
                    <div className="od-tl-content">
                      <div className="od-tl-header">
                        <div className="od-tl-title">GRN Created</div>
                        <div className="od-tl-time">{fmtTs(grn.created_at)}</div>
                      </div>
                      <div className="od-tl-sub">{grn.received_by || '—'}</div>
                    </div>
                  </div>
                  {(grn.status === 'checking' || isConfirmed) && (
                    <div className="od-tl-item">
                      <div className="od-tl-dot edited"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
                      <div className="od-tl-content">
                        <div className="od-tl-title">Checking Goods</div>
                        <div className="od-tl-sub">Goods being inspected</div>
                      </div>
                    </div>
                  )}
                  {isConfirmed && (
                    <div className="od-tl-item">
                      <div className="od-tl-dot success"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
                      <div className="od-tl-content">
                        <div className="od-tl-header">
                          <div className="od-tl-title">GRN Confirmed</div>
                          <div className="od-tl-time">{fmtTs(grn.received_at || grn.created_at)}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Received By */}
              <div className="od-side-card" style={{ marginTop:12 }}>
                <div className="od-side-card-title">Received By</div>
                <OwnerChip name={grn.received_by} />
              </div>

              {/* Summary stats */}
              <div className="od-side-card" style={{ marginTop:12 }}>
                <div className="od-side-card-title">Summary</div>
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                    <span style={{ color:'var(--gray-500)' }}>Total Items</span>
                    <span style={{ fontWeight:600 }}>{grnItems.length}</span>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                    <span style={{ color:'var(--gray-500)' }}>Total Accepted</span>
                    <span style={{ fontWeight:600, color:'#15803d' }}>{totalAccepted}</span>
                  </div>
                  {totalRejected > 0 && (
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                      <span style={{ color:'var(--gray-500)' }}>Total Rejected</span>
                      <span style={{ fontWeight:600, color:'#dc2626' }}>{totalRejected}</span>
                    </div>
                  )}
                  {grn.invoice_amount && (
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, borderTop:'1px solid var(--gray-100)', paddingTop:8, marginTop:4 }}>
                      <span style={{ color:'var(--gray-500)' }}>Invoice Amount</span>
                      <span style={{ fontWeight:700 }}>{fmtINR(grn.invoice_amount)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
