// Attendance policy engine — computes a day's status from raw punches + config,
// so the dashboard/muster work on-demand (no nightly job needed on Micro).

export const DEFAULT_CFG = { office_start:'10:00', grace_until:'10:15', half_day_cutoff:'14:30', office_end:'18:30', birthday_leave_at:'17:00' }

// Effective shift for an employee: their own shift_start/shift_end if set,
// else the general shift from attendance_config. Grace / half-day cutoff stay from config.
export const effShift = (emp, cfg = DEFAULT_CFG) => ({ ...cfg, office_start: emp?.shift_start || cfg.office_start, office_end: emp?.shift_end || cfg.office_end })

export function toMin(t) { const [h, m] = (t || '0:0').slice(0,5).split(':').map(Number); return h * 60 + m }
export function minToHrs(min) { if (min == null) return '—'; const h = Math.floor(min/60), m = min%60; return `${h}h ${String(m).padStart(2,'0')}m` }
export function fmtTime(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit', hour12:true }) }

// Sundays off; 2nd & 4th Saturday off. Other Saturdays = working.
export function isWeekOff(date) {
  const d = new Date(date), dow = d.getDay()
  if (dow === 0) return true
  if (dow === 6) { const nth = Math.ceil(d.getDate() / 7); return nth === 2 || nth === 4 }
  return false
}

// Haversine distance in metres
export function distanceM(a, b) {
  if (a?.lat == null || b?.lat == null) return null
  const R = 6371000, toRad = x => x * Math.PI / 180
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

// punches: [{punch_at, direction}] for this date. Returns computed day.
export function computeDay({ date, punches = [], config = DEFAULT_CFG, isHoliday = false, onLeave = false, isFC = false }) {
  const d = new Date(date)
  if (isHoliday) return { status: 'holiday' }
  if (isWeekOff(d)) return { status: 'weekoff' }
  if (onLeave) return { status: 'leave' }

  const ins  = punches.filter(p => p.direction === 'in').map(p => new Date(p.punch_at)).sort((a,b)=>a-b)
  const outs = punches.filter(p => p.direction === 'out').map(p => new Date(p.punch_at)).sort((a,b)=>a-b)
  if (!ins.length) return { status: 'absent' }

  const firstIn = ins[0], lastOut = outs.length ? outs[outs.length-1] : null
  const inMin  = firstIn.getHours()*60 + firstIn.getMinutes()
  const startMin = toMin(config.office_start), graceMin = toMin(config.grace_until)
  const cutoffMin = toMin(config.half_day_cutoff), endMin = toMin(config.office_end)

  let status = 'present', late = 0, early = 0, code = null
  if (inMin > cutoffMin) return { status: 'absent', first_in: firstIn }   // arrival after 2:30 -> absent
  if (inMin > graceMin) { status = 'half_day'; late = inMin - startMin; code = 'A:P' }   // late in -> missed 1st half (absent AM, present PM)

  let outMin = lastOut ? lastOut.getHours()*60 + lastOut.getMinutes() : null
  if (outMin != null && outMin < endMin) { early = endMin - outMin; if (status === 'present') { status = 'half_day'; code = 'P:A' } }   // left early -> present AM, absent PM

  const worked = lastOut ? Math.round((lastOut - firstIn) / 60000) : null
  const ot = (isFC && outMin != null && outMin > endMin) ? (outMin - endMin) : 0
  const leaveDeducted = status === 'half_day' ? 0.5 : (status === 'absent' ? 1 : 0)
  return { status, code, first_in: firstIn, last_out: lastOut, worked_min: worked, late_min: late, early_min: early, ot_min: ot, leave_deducted: leaveDeducted }
}

// Soothing, light palette (eye-friendly) — used across attendance (badges, strips, dots)
export const STATUS_META = {
  present:  { label:'Present',  color:'#2E9E63', bg:'#E9F6EF', dot:'#34C77B' },
  half_day: { label:'Half Day', color:'#D07E1E', bg:'#FCF1E4', dot:'#F5951E' },
  absent:   { label:'Absent',   color:'#D64545', bg:'#FCEBEB', dot:'#F05252' },
  leave:    { label:'Leave',    color:'#7C5CE0', bg:'#F0EBFC', dot:'#9670F0' },
  holiday:  { label:'Holiday',  color:'#2E86DE', bg:'#E8F2FC', dot:'#4A9EF0' },
  weekoff:  { label:'Week-off', color:'#8C99A8', bg:'#F1F3F5', dot:'#C7CFD8' },
  lop:      { label:'LOP',      color:'#D64545', bg:'#FCEBEB', dot:'#F05252' },
}
