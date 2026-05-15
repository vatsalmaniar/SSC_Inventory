// Shared GRN print-ready HTML template.
// Used by GRNDetail (view/print) and PurchaseInvoiceDetail (View GRN ↗ link
// on the three-way-match card so accounts can verify without leaving the PI).

const GRN_TYPE_LABELS = {
  po_inward:'PO Inward', customer_rejection:'Customer Rejection',
  sample_return:'Sample Return', cancellation_return:'Cancellation Return',
}
const GRN_TYPE_COLORS = {
  po_inward: { bg:'#eff6ff', color:'#1d4ed8' }, customer_rejection: { bg:'#fef2f2', color:'#dc2626' },
  sample_return: { bg:'#faf5ff', color:'#7e22ce' }, cancellation_return: { bg:'#fffbeb', color:'#b45309' },
}

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function fmtDC(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '.' + (dt.getMonth()+1).toString().padStart(2,'0') + '.' + dt.getFullYear()
}

export function buildGrnHtml(grn, grnItems) {
  const items = grnItems || []
  const grnDate = fmtDC(grn.received_at || grn.created_at)
  const totalRecv = items.reduce((s, i) => s + (i.received_qty || 0), 0)
  const totalAcc  = items.reduce((s, i) => s + (i.accepted_qty || 0), 0)
  const totalRej  = items.reduce((s, i) => s + (i.rejected_qty || 0), 0)
  const typeLabel = GRN_TYPE_LABELS[grn.grn_type] || grn.grn_type
  const typeBadge = GRN_TYPE_COLORS[grn.grn_type] || { bg:'#eff6ff', color:'#1d4ed8' }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>GRN — ${esc(grn.grn_number)}</title>
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
    <img src="${typeof window !== 'undefined' ? window.location.origin : ''}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">${esc(typeLabel)}</div>
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
${items.map((item, idx) => `<tr>
  <td style="color:#94a3b8">${idx + 1}</td><td class="code">${esc(item.item_code) || '—'}</td>
  <td class="c">${item.ordered_qty || item.expected_qty || '—'}</td>
  <td class="c" style="font-weight:700">${item.received_qty || 0}</td>
  <td class="c" style="font-weight:600;color:#15803d">${item.accepted_qty || 0}</td>
  ${totalRej > 0 ? `<td class="c" style="font-weight:600;color:${(item.rejected_qty||0)>0?'#dc2626':'#94a3b8'}">${item.rejected_qty || 0}</td><td style="font-size:10.5px;color:#64748b">${esc(item.rejection_reason) || '—'}</td>` : ''}
</tr>`).join('')}
</tbody></table>
<div class="summary-wrap"><table class="summary-table">
  <tr><td class="lbl">Total Items</td><td class="val">${items.length}</td></tr>
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
