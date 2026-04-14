export const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Financial year start — auto-computed, never needs manual update
// FY runs Apr 1 → Mar 31. If today is Jan-Mar, FY started last year's April.
const _now = new Date()
const _fyYear = _now.getMonth() >= 3 ? _now.getFullYear() : _now.getFullYear() - 1
export const FY_START = `${_fyYear}-04-01`
export const FY_LABEL = `FY ${String(_fyYear).slice(2)}-${String(_fyYear + 1).slice(2)}`

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

// HTML-escape for safe injection into document.write / innerHTML templates
export function esc(str) {
  if (!str && str !== 0) return ''
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
