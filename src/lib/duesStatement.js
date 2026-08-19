// Statement of Dues — shared maths + print-ready HTML.
//
// One module so the Customer 360 tab, the printed statement and (later) the
// WhatsApp send all quote the SAME numbers. Built on the Delivery Challan
// template in OrderDetail.jsx so the statement reads as the same company's
// paperwork as a challan or a quotation.
//
// Doctrine: the uploaded Tally sheet is the source of truth. Nothing here
// derives, adjusts or nets a figure against app data — it only adds up rows
// that came out of the sheet, using days_past_due frozen at import time.

import { esc } from './fmt'

export const SSC = {
  name:  'SSC Control Pvt. Ltd.',
  legal: 'SSC CONTROL PRIVATE LIMITED',
  gstin: '24ABGCS0605M1ZE',
  cin:   'U51909GJ2021PTC122539',
  email: 'accounts.amd@ssccontrol.com',
  bank: {
    name:   'Kotak Mahindra Bank',
    acNo:   '3546422480',
    branch: 'BPC Road, Vadodara',
    ifsc:   'KKBK0002751',
  },
}

// Ageing is measured in days past the DUE date (not Tally's bill-date buckets):
// a 90-day-terms bill is "not yet due", not "120 days old".
const BUCKETS = [
  { label: 'Not yet due',  lo: -Infinity, hi: 0 },
  { label: '1 – 30 days',  lo: 1,   hi: 30 },
  { label: '31 – 60 days', lo: 31,  hi: 60 },
  { label: '61 – 90 days', lo: 61,  hi: 90 },
  { label: 'Over 90 days', lo: 91,  hi: Infinity },
]

// bills: rows from customer_dues_bills (days_past_due already frozen at import)
export function summariseDues(bills) {
  const rows = bills || []
  const n = v => Number(v) || 0
  const outstanding = rows.reduce((s, b) => s + n(b.pending_inr), 0)
  const pdc         = rows.reduce((s, b) => s + n(b.pdc_inr), 0)
  const balance     = outstanding - pdc
  // Amount due on a bill is what remains after any cheque already in hand.
  const overdue = rows.filter(b => b.is_overdue)
                      .reduce((s, b) => s + n(b.pending_inr) - n(b.pdc_inr), 0)
  const oldest = rows.reduce((m, b) => Math.max(m, n(b.days_past_due)), 0)
  const ageing = BUCKETS.map(bk => {
    const inBucket = rows.filter(b => n(b.days_past_due) >= bk.lo && n(b.days_past_due) <= bk.hi)
    return {
      label:  bk.label,
      count:  inBucket.length,
      amount: inBucket.reduce((s, b) => s + n(b.pending_inr) - n(b.pdc_inr), 0),
    }
  })
  return {
    billCount: rows.length,
    outstanding, pdc, balance, overdue,
    notDue: balance - overdue,
    oldest,
    hasPdc: pdc > 0,
    overdueCount: rows.filter(b => b.is_overdue).length,
    ageing,
  }
}

// ── local formatters (document uses 2 decimals like the DC) ──
const money = v => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dDMY  = d => {
  if (!d) return '—'
  const t = new Date(d)
  if (isNaN(t)) return '—'
  return String(t.getDate()).padStart(2, '0') + '.' + String(t.getMonth() + 1).padStart(2, '0') + '.' + t.getFullYear()
}

const A = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
const B = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
function conv(n) {
  if (n === 0) return ''
  if (n < 20) return A[n]
  if (n < 100) return B[Math.floor(n/10)] + (n%10 ? ' ' + A[n%10] : '')
  if (n < 1000) return A[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + conv(n%100) : '')
  if (n < 100000) return conv(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + conv(n%1000) : '')
  if (n < 10000000) return conv(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + conv(n%100000) : '')
  return conv(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + conv(n%10000000) : '')
}
function words(v) {
  const n = Number(v) || 0
  const r = Math.floor(n), p = Math.round((n - r) * 100)
  return 'Rupees ' + (conv(r) || 'Zero') + (p > 0 ? ' and ' + conv(p) + ' Paise' : '') + ' Only'
}

// customer: row from `customers` (may be null for an unmatched party)
// bills:    rows from customer_dues_bills, this customer, current run
// asOn:     the run's as_on date — the statement is frozen to it
export function buildDuesStatementHtml({ customer, partyName, bills, asOn }) {
  const s = summariseDues(bills)
  const sorted = [...(bills || [])].sort((a, b) =>
    String(a.due_date || a.bill_date || '').localeCompare(String(b.due_date || b.bill_date || '')))
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const name = customer?.customer_name || partyName || '—'
  const addr = (customer?.billing_address || '').replace(/\s*,\s*,/g, ',').trim()
  const owner = customer?.account_owner || ''

  const pdcHead = s.hasPdc ? '<th class="r" style="width:100px">Post-Dated</th>' : ''
  const rows = sorted.map((b, i) => {
    const bal = (Number(b.pending_inr) || 0) - (Number(b.pdc_inr) || 0)
    const days = b.is_overdue
      ? `<span class="od">${b.days_past_due}</span>`
      : '<span class="ok">Within terms</span>'
    return `<tr><td style="color:#94a3b8">${i + 1}</td>`
      + `<td class="c">${dDMY(b.bill_date)}</td>`
      + `<td class="code">${esc(String(b.bill_ref || '').toUpperCase())}</td>`
      + `<td class="c">${dDMY(b.due_date)}</td>`
      + `<td class="c">${days}</td>`
      + (s.hasPdc ? `<td class="r" style="color:#64748b">${b.pdc_inr ? money(b.pdc_inr) : '—'}</td>` : '')
      + `<td class="r" style="font-weight:600">${money(bal)}</td></tr>`
  }).join('')

  const ageRows = s.ageing.map(a =>
    `<tr><td>${a.label}</td><td class="c">${a.count}</td><td class="r">${a.amount ? money(a.amount) : '—'}</td></tr>`).join('')

  let totRows = `<tr><td class="lbl">Total Outstanding</td><td class="val">${money(s.outstanding)}</td></tr>`
  if (s.hasPdc) totRows += `<tr><td class="lbl">Less: Post-Dated Cheques Received</td><td class="val">(-) ${money(s.pdc)}</td></tr>`
  totRows += `<tr><td class="lbl">Not Yet Due</td><td class="val">${money(s.notDue)}</td></tr>`
    + `<tr><td class="lbl" style="color:#b91c1c">Overdue</td><td class="val" style="color:#b91c1c">${money(s.overdue)}</td></tr>`
    + `<tr class="grand"><td class="lbl">Balance Due</td><td class="val">₹ ${money(s.balance)}</td></tr>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Statement of Dues — ${esc(name)}</title>
<link href="${origin}/fonts/fonts.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}.co-name{font-size:17px;font-weight:700;margin-bottom:2px}.co-sub{font-size:11px;color:#64748b;margin-bottom:8px}.co-addr{font-size:10.5px;color:#475569;line-height:1.6}
.doc-title{font-size:28px;font-weight:700;text-align:right;letter-spacing:-0.5px}.doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:#eff6ff;color:#1d4ed8}
.divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}.meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}.meta-name{font-size:13px;font-weight:700;margin-bottom:3px}.meta-addr{font-size:11px;color:#475569;line-height:1.6}
.ref-table{width:100%;border-collapse:collapse}.ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}.ref-table tr td:first-child{color:#64748b;width:52%}.ref-table tr td:last-child{font-weight:600;text-align:right}
.terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}.terms span strong{color:#0f172a;font-weight:600}
table.items{width:100%;border-collapse:collapse;margin-bottom:4px}table.items thead{display:table-header-group}table.items thead tr{border-bottom:2px solid #0f172a}table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}table.items th.r{text-align:right}table.items th.c{text-align:center}table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;white-space:nowrap}table.items tr{page-break-inside:avoid}table.items td.r{text-align:right}table.items td.c{text-align:center}table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
tbody tr:nth-child(even) td{background:#fcfcfd}
.od{color:#b91c1c;font-weight:600}.ok{color:#64748b;font-size:10.5px}
.summary-row{display:flex;justify-content:space-between;align-items:flex-start;gap:40px;margin-top:20px}
.ageing-table{border-collapse:collapse;min-width:290px}.ageing-table th{padding:6px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#64748b;text-align:left;border-bottom:1px solid #e2e8f0}.ageing-table th.r{text-align:right}.ageing-table th.c{text-align:center}.ageing-table td{padding:5px 10px;font-size:11px;border-bottom:1px solid #f1f5f9}.ageing-table td.r{text-align:right;font-family:'Geist Mono',monospace}.ageing-table td.c{text-align:center}
.totals-table{width:320px;border-collapse:collapse}.totals-table td{padding:5px 0;font-size:11.5px}.totals-table td.lbl{color:#64748b}.totals-table td.val{text-align:right;font-weight:500;font-family:'Geist Mono',monospace}.totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
.words{font-size:11px;color:#475569;margin:16px 0 20px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
.paybox{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:6px}
.paybox .meta-section-label{margin-bottom:4px}
.note{font-size:10.5px;color:#475569;line-height:1.7;padding:12px 14px;background:#f8fafc;border-left:3px solid #1a73e8;border-radius:0 6px 6px 0;page-break-inside:avoid}.note b{color:#0f172a;font-weight:600}
.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}.sig-cell{text-align:center;font-size:10px;color:#64748b}.sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}.sig-name{font-weight:600;color:#0f172a;font-size:11px}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}.footer-left{font-size:10px;color:#94a3b8;line-height:1.6}.footer-right{font-size:10px;color:#94a3b8;text-align:right}
@media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style></head><body>
<div class="header"><div><div class="co-name">${SSC.name}</div><div class="co-sub">Engineering Industry. Powering Progress.</div><div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div><div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: ${SSC.gstin}</div></div><div style="text-align:right"><img src="${origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/><div class="doc-type-badge">Accounts</div><div class="doc-title">Statement of Dues</div></div></div>
<hr class="divider"/>
<div class="meta-grid"><div><div class="meta-section-label">Statement For</div><div class="meta-name">${esc(name)}</div>${customer?.customer_id ? `<div style="font-size:11px;color:#475569;margin-top:2px">Customer ID: <strong class="mono">${esc(customer.customer_id)}</strong></div>` : ''}${addr ? `<div class="meta-addr">${esc(addr)}</div>` : ''}${customer?.gst ? `<div style="font-size:11px;color:#475569;margin-top:5px">GSTIN: <strong>${esc(customer.gst)}</strong></div>` : ''}</div>
<div><div class="meta-section-label">Reference</div><table class="ref-table"><tr><td>Statement Date</td><td>${dDMY(asOn)}</td></tr><tr><td>Open Bills</td><td>${s.billCount}</td></tr><tr><td>Oldest Overdue</td><td>${s.oldest > 0 ? s.oldest + ' days' : '—'}</td></tr>${customer?.poc_name ? `<tr><td>Kind Attn.</td><td>${esc(customer.poc_name)}</td></tr>` : ''}${owner ? `<tr><td>Your SSC Contact</td><td>${esc(owner)}</td></tr>` : ''}</table></div></div>
<hr class="divider"/>
<div class="terms"><span>Payment terms: <strong>${esc(customer?.credit_terms || '—')}</strong></span><span>Statement as on: <strong>${dDMY(asOn)}</strong></span><span>Currency: <strong>INR</strong></span></div>
<table class="items"><thead><tr><th style="width:40px">#</th><th class="c" style="width:90px">Bill Date</th><th style="width:120px">Bill No.</th><th class="c" style="width:90px">Due Date</th><th class="c" style="width:110px">Days Overdue</th>${pdcHead}<th class="r" style="width:120px">Amount Due</th></tr></thead><tbody>
${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px">No open bills.</td></tr>'}</tbody></table>
<div class="summary-row">
  <table class="ageing-table"><thead><tr><th>Ageing (Days Past Due)</th><th class="c" style="width:60px">Bills</th><th class="r" style="width:110px">Amount</th></tr></thead><tbody>${ageRows}</tbody></table>
  <table class="totals-table">${totRows}</table>
</div>
<div class="words">Balance due in words: <strong>${words(s.balance)}</strong></div>
<div class="paybox">
  <div><div class="meta-section-label">Payment Details</div><table class="ref-table"><tr><td>Bank</td><td>${SSC.bank.name}</td></tr><tr><td>A/c No.</td><td class="mono">${SSC.bank.acNo}</td></tr><tr><td>Branch &amp; IFSC</td><td>${SSC.bank.branch} &middot; <span class="mono">${SSC.bank.ifsc}</span></td></tr></table></div>
  <div><div class="meta-section-label">For Queries</div><table class="ref-table"><tr><td>Accounts</td><td>${SSC.email}</td></tr>${owner ? `<tr><td>Your SSC Contact</td><td>${esc(owner)}</td></tr>` : ''}</table></div>
</div>
<div class="note"><b>Please note:</b> This statement reflects our books as on ${dDMY(asOn)}. Payments made or cheques in transit after this date may not be reflected — <b>kindly ignore this statement if payment has already been released.</b><br/>Any discrepancy in the above bills may kindly be intimated to us within <b>7 days</b>, after which the balances will be treated as confirmed.<br/>Kindly quote the bill number(s) while making payment.</div>
<div class="sig-row"><div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Prepared By</div>Accounts</div><div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For ${SSC.legal}</div></div>
<div class="footer"><div class="footer-left">${SSC.name} &nbsp;|&nbsp; GSTIN: ${SSC.gstin} &nbsp;|&nbsp; CIN: ${SSC.cin}<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div><div class="footer-right">${SSC.email}<br/>www.ssccontrol.com<br/>Subject to Vadodara Jurisdiction</div></div>
</body></html>`
}
