export const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Financial year start — update this once per year (April 1)
export const FY_START = '2026-03-31'

// 5 Mar 2026
export function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()] + ' ' + dt.getFullYear()
}

// 05-03-2026
export function fmtNum(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}

// 5 Mar (no year)
export function fmtShort(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()]
}

// 5 Mar, 14:30
export function fmtTs(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate() + ' ' + MO[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}

// 5 Mar 2026 14:30
export function fmtDateTime(d) {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  const h = dt.getHours(), m = dt.getMinutes()
  return dt.getDate()+' '+MO[dt.getMonth()]+' '+dt.getFullYear()+' '+(h<10?'0':'')+h+':'+(m<10?'0':'')+m
}
