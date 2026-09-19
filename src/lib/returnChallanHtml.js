// Return-to-vendor challan — the paper that travels with rejected goods.
//
// WHY IT EXISTS. Before this, refusing an over-delivery was a dead end: the GRN
// recorded "10 going back" and there was nothing to hand the driver. The goods
// left on the vendor's own paperwork or not at all, and because stock comes from
// the warehouse XLS, anything still sitting in the godown quietly reappeared as
// sellable stock.
//
// It is a DELIVERY document, not a financial one. It says what is leaving and
// why. The money is the debit note, raised in Tally against the bill — the two
// are deliberately separate, and the challan says so, because a storekeeper
// handing over cartons should not be quoting amounts to a driver.
//
// Prints through writeDoc() from lib/printDoc.js, same as every other document.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDC(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return String(dt.getDate()).padStart(2, '0') + '.' +
         String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear()
}

export function buildReturnChallanHtml(grn, grnItems, opts = {}) {
  // Only the lines actually going back. A challan listing what you KEPT would be
  // worse than none — the driver checks the cartons against this.
  const rows = (grnItems || []).filter(i => Number(i.rejected_qty) > 0)
  const totalQty = rows.reduce((s, i) => s + (Number(i.rejected_qty) || 0), 0)
  const fc = grn.fulfilment_center || ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Return Challan — ${esc(grn.grn_number)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Geist', -apple-system, sans-serif; color:#0B1B30; margin:0; font-size:12.5px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start;
          border-bottom:2px solid #0B1B30; padding-bottom:10px; margin-bottom:14px; }
  .co   { font-size:17px; font-weight:600; letter-spacing:-0.01em; }
  .co-sub { font-size:11px; color:#5B6878; margin-top:2px; }
  .title { text-align:right; }
  .title h1 { margin:0; font-size:16px; font-weight:600; letter-spacing:0.02em; }
  .title .num { font-family:'Geist Mono',monospace; font-size:12px; color:#5B6878; margin-top:3px; }
  .why { background:#fffbeb; border:1px solid #fde68a; border-radius:6px;
         padding:9px 12px; font-size:12px; color:#7a4b00; margin-bottom:14px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:14px; }
  .box { border:1px solid #E8EBF0; border-radius:6px; padding:10px 12px; }
  .lbl  { font-family:'Geist Mono',monospace; font-size:9px; text-transform:uppercase;
          letter-spacing:0.08em; color:#5B6878; margin-bottom:3px; }
  .val  { font-size:12.5px; font-weight:500; }
  table { width:100%; border-collapse:collapse; margin-bottom:14px; }
  th { text-align:left; font-family:'Geist Mono',monospace; font-size:9px; text-transform:uppercase;
       letter-spacing:0.08em; color:#5B6878; border-bottom:1px solid #E8EBF0; padding:7px 8px; }
  td { padding:8px; border-bottom:1px solid #F0F2F5; font-size:12.5px; }
  .r { text-align:right; }
  .mono { font-family:'Geist Mono',monospace; }
  tfoot td { font-weight:600; border-top:1px solid #0B1B30; border-bottom:none; }
  .sign { display:grid; grid-template-columns:repeat(3,1fr); gap:24px; margin-top:34px; }
  .sign div { border-top:1px solid #0B1B30; padding-top:6px; font-size:10.5px; color:#5B6878; }
  .note { margin-top:18px; font-size:10.5px; color:#5B6878; line-height:1.5; }
</style></head><body>

  <div class="head">
    <div>
      <div class="co">SSC CONTROL PVT. LTD.</div>
      <div class="co-sub">${esc(fc)} Fulfilment Centre</div>
    </div>
    <div class="title">
      <h1>RETURN CHALLAN</h1>
      <div class="num">Against ${esc(grn.grn_number)}</div>
      <div class="num">${fmtDC(opts.date || new Date())}</div>
    </div>
  </div>

  <div class="why">
    These goods are being returned. They were received but <strong>not accepted</strong>,
    and have not been taken into stock.
  </div>

  <div class="grid">
    <div class="box">
      <div class="lbl">Return to</div>
      <div class="val">${esc(grn.vendor_name || '—')}</div>
    </div>
    <div class="box">
      <div class="lbl">Their invoice</div>
      <div class="val mono">${esc(grn.invoice_number || '—')}</div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th style="width:34px">#</th>
      <th>Item</th>
      <th class="r" style="width:90px">Received</th>
      <th class="r" style="width:90px">Accepted</th>
      <th class="r" style="width:90px">Returning</th>
      <th style="width:150px">Reason</th>
    </tr></thead>
    <tbody>
      ${rows.map((i, n) => `<tr>
        <td style="color:#9BA3AF">${n + 1}</td>
        <td class="mono">${esc(i.item_code)}</td>
        <td class="r" style="color:#5B6878">${i.received_qty ?? '—'}</td>
        <td class="r" style="color:#5B6878">${i.accepted_qty ?? '—'}</td>
        <td class="r" style="font-weight:600">${i.rejected_qty}</td>
        <td style="font-size:11.5px">${esc(i.rejection_reason || '—')}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr>
      <td colspan="4" class="r">Total going back</td>
      <td class="r">${totalQty}</td><td></td>
    </tr></tfoot>
  </table>

  <div class="sign">
    <div>Handed over by (SSC)</div>
    <div>Collected by / Driver</div>
    <div>Vehicle / Docket no.</div>
  </div>

  <div class="note">
    This challan covers the movement of goods only. Any amount recoverable against
    these items is settled separately by debit note.
  </div>

</body></html>`
}
