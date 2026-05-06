// Shared Purchase Order HTML builder.
// Used by PurchaseOrderDetail (View PO) and PurchaseInvoiceDetail (View PO).
// Renders a print-ready HTML document from PO + line items so callers can
// `window.open` + `document.write` it — no stored PDF needed.

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDC(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2, '0') + '.' +
         (dt.getMonth() + 1).toString().padStart(2, '0') + '.' +
         dt.getFullYear()
}

function numToWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function conv(n) {
    if (n === 0) return ''
    if (n < 20) return a[n]
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '')
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + conv(n % 100) : '')
    if (n < 100000) return conv(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + conv(n % 1000) : '')
    if (n < 10000000) return conv(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + conv(n % 100000) : '')
    return conv(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + conv(n % 10000000) : '')
  }
  const r = Math.floor(n), p = Math.round((n - r) * 100)
  return 'Rupees ' + conv(r) + (p > 0 ? ' and ' + conv(p) + ' Paise' : '') + ' Only'
}

const FC_ADDRESSES = {
  Kaveri: '17(A) Ashwamegh Warehouse, Behind New Ujala Hotel,\nSarkhej Bavla Highway, Sarkhej, Ahmedabad – 382 210',
  Godawari: '31 GIDC Estate, B/h Bank Of Baroda,\nMakarpura, Vadodara – 390 010',
}

export function buildPoHtml({ po, items = [], vendorCode = '' }) {
  if (!po) return ''
  const poNumber = po.po_number || po.temp_po_number || '—'
  const deliveryAddr = po.delivery_address || FC_ADDRESSES[po.fulfilment_center] || po.fulfilment_center || '—'
  const subtotal = items.reduce((s, i) => s + (Number(i.total_price) || 0), 0)
  const grandTotal = Number(po.total_amount) || subtotal
  const poDate = fmtDC(po.po_date || po.created_at)
  const isCO = (po.po_type === 'CO')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Purchase Order — ${poNumber}</title>
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
  .doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:${isCO ? '#f0fdf4' : '#eff6ff'};color:${isCO ? '#15803d' : '#1d4ed8'};text-align:right}
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
  table.items th.r{text-align:right}
  table.items th.c{text-align:center}
  table.items tbody tr{border-bottom:1px solid #f1f5f9}
  table.items tbody tr:last-child{border-bottom:none}
  table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
  table.items td.r{text-align:right}
  table.items td.c{text-align:center}
  table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:12px}
  .totals-table{width:300px;border-collapse:collapse}
  .totals-table td{padding:5px 0;font-size:11.5px}
  .totals-table td.lbl{color:#64748b}
  .totals-table td.val{text-align:right;font-weight:500}
  .totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
  .words{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
  .notes-box{margin:12px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px}
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
    <div class="doc-type-badge">${isCO ? 'Customer Order' : 'Stock Order'}</div>
    <div class="doc-title">Purchase Order</div>
  </div>
</div>
<hr class="divider"/>
<div class="meta-grid">
  <div>
    <div class="meta-section-label">Vendor</div>
    <div class="meta-name">${esc(po.vendor_name) || '—'}</div>
    ${vendorCode ? `<div style="font-size:11px;color:#475569;margin-top:2px">Vendor Code: <strong style="font-family:'Geist Mono',monospace">${esc(vendorCode)}</strong></div>` : ''}
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>PO No.</td><td class="mono">${esc(poNumber)}</td></tr>
      <tr><td>PO Date</td><td>${poDate}</td></tr>
      ${po.order_number ? `<tr><td>Linked Order</td><td class="mono">${esc(po.order_number)}</td></tr>` : ''}
      ${po.reference && !po.order_number ? `<tr><td>Reference</td><td>${esc(po.reference)}</td></tr>` : ''}
      <tr><td>Deliver To</td><td>${po.fulfilment_center === 'Customer' ? esc(po.delivery_customer_name || 'Customer') : (esc(po.fulfilment_center) || '—')}</td></tr>
    </table>
  </div>
</div>
<hr class="divider"/>
<div class="terms">
  <span>Payment terms: <strong>${esc(po.payment_terms) || '—'}</strong></span>
  <span>Currency: <strong>INR</strong></span>
</div>
<div style="margin-bottom:20px">
  <div class="meta-section-label">Deliver To</div>
  <div class="meta-addr">${po.fulfilment_center === 'Customer' ? esc(po.delivery_customer_name || '') : 'SSC Control Pvt. Ltd.'}<br/>${deliveryAddr.replace(/\n/g, '<br/>')}</div>
</div>
<table class="items">
  <thead>
    <tr>
      <th style="width:40px">#</th>
      <th>Item Code</th>
      <th class="c" style="width:60px">Qty</th>
      <th class="r" style="width:90px">LP Price</th>
      <th class="c" style="width:60px">Disc %</th>
      <th class="r" style="width:90px">Unit Price</th>
      <th class="r" style="width:100px">Amount</th>
      <th class="c" style="width:90px">Delivery</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, idx) => `
    <tr>
      <td style="color:#94a3b8">${idx + 1}</td>
      <td class="code">${esc(item.item_code) || '—'}</td>
      <td class="c" style="font-weight:700">${item.qty}</td>
      <td class="r">${(Number(item.lp_unit_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="c">${item.discount_pct || 0}%</td>
      <td class="r">${(Number(item.unit_price_after_disc || item.unit_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="r" style="font-weight:600">${(Number(item.total_price) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="c" style="font-size:11px">${item.delivery_date ? fmtDC(item.delivery_date) : '—'}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="totals-wrap">
  <table class="totals-table">
    <tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
    <tr class="grand"><td class="lbl">Total Amount</td><td class="val">₹ ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
  </table>
</div>
<div class="words">Amount in words: <strong>${numToWords(grandTotal)}</strong></div>
${po.notes ? `<div class="notes-box"><strong>Notes for Vendor:</strong> ${esc(po.notes)}</div>` : ''}
<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">${esc(po.submitted_by_name || 'Procurement')}</div>Prepared By</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">${esc(po.approved_by || 'Management')}</div>Approved By</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div>
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
}

// Convenience: open the rendered HTML in a new tab.
export function openPoHtml({ po, items, vendorCode } = {}) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.write(buildPoHtml({ po, items, vendorCode }))
  w.document.close()
  return true
}
