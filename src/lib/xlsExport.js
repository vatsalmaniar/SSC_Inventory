// Shared ExcelJS export chrome — ONE definition for every styled sheet
// (Orders Summary/Detailed, Waiting for Clearance, Out of Stock).

// Status-cell colors keyed by order status
export function xlsStatusStyle(s) {
  switch (s) {
    case 'pending': case 'pending_approval': return { bg: 'FFFEF9C3', fg: 'FF854D0E' }
    case 'partial_dispatch': return { bg: 'FFFFF7ED', fg: 'FFC2410C' }
    case 'inv_check': case 'inventory_check': case 'dispatch': return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
    case 'delivery_created': return { bg: 'FFDCFCE7', fg: 'FF166534' }
    case 'picking': case 'packing': return { bg: 'FFE0E7FF', fg: 'FF3730A3' }
    case 'goods_issued': case 'credit_check': case 'goods_issue_posted':
    case 'invoice_generated': case 'pending_billing': return { bg: 'FFFEF3C7', fg: 'FF92400E' }
    case 'delivery_ready': case 'eway_pending': case 'eway_generated': return { bg: 'FFD1FAE5', fg: 'FF065F46' }
    case 'dispatched_fc': return { bg: 'FFBBF7D0', fg: 'FF14532D' }
    case 'cancelled': return { bg: 'FFFEE2E2', fg: 'FFB91C1C' }
    default: return { bg: 'FFF1F5F9', fg: 'FF334155' }
  }
}

// Dark header row, zebra striping, hairline row borders, autofilter
export function xlsFinish(ws, nCols) {
  const header = ws.getRow(1)
  header.height = 24
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2540' } }
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF143055' } } }
  })
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
    })
    if (r % 2 === 0) {
      row.eachCell({ includeEmpty: true }, cell => {
        const isTinted = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor?.argb !== 'FFFFFFFF'
        if (!isTinted) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
      })
    }
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: nCols } }
}

// Serialize the workbook and trigger a browser download
export async function xlsDownload(wb, name) {
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
