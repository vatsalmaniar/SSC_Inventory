// Attendance policy engine — computes a day's status from raw punches + config,
// so the dashboard/muster work on-demand (no nightly job needed on Micro).

export const DEFAULT_CFG = { office_start:'10:00', grace_until:'10:15', half_day_cutoff:'14:30', office_end:'18:30', birthday_leave_at:'17:00' }

// Accidental double-scans (biometric or web) create spurious In/Out pairs — e.g. a second
// scan at entry looks like an immediate check-out. Collapse any punch that lands within this
// window of the previously-kept one → we keep the FIRST of a rapid burst and drop the repeat.
export const PUNCH_DEBOUNCE_MS = 120000   // 2 minutes
export function dedupeTimes(times) {       // expects ascending Date[]; returns debounced Date[]
  const out = []
  for (const t of times) if (!out.length || (t - out[out.length - 1]) >= PUNCH_DEBOUNCE_MS) out.push(t)
  return out
}
// Current in/out state from a day's raw punches (debounced): odd count = checked-in, even = out.
// Used by the web check-in button so a biometric scan (or an accidental double) reflects correctly.
export function currentlyIn(punches = []) {
  const times = dedupeTimes(punches.map(p => new Date(p.punch_at)).filter(t => !isNaN(+t)).sort((a, b) => a - b))
  return times.length % 2 === 1
}

// Effective shift for an employee: their own shift_start/shift_end if set,
// else the general shift from attendance_config. Grace / half-day cutoff stay from config.
export const effShift = (emp, cfg = DEFAULT_CFG) => ({ ...cfg, office_start: emp?.shift_start || cfg.office_start, office_end: emp?.shift_end || cfg.office_end })

// ── Special-day declarations (rainfall / WFH / calamity bulk status) ──
const DECL_TO_STATUS = { present: 'present', wfh: 'present', holiday: 'holiday', half_day: 'half_day' }
export const DECL_LABEL = { present: 'Present', wfh: 'WFH', holiday: 'Holiday', half_day: 'Half day' }

// Find the declaration (if any) that covers this branch + date. A branch-specific
// declaration wins over an all-locations (branch = null) one.
export function declarationFor(declarations, branch, dateStr) {
  if (!declarations || !declarations.length) return null
  let all = null
  for (const d of declarations) {
    if (dateStr >= d.from_date && dateStr <= d.to_date) {
      if (d.branch === branch) return d
      if (d.branch == null && !all) all = d
    }
  }
  return all
}

// Apply a declaration to a computed day. It only RESCUES would-be-absent days —
// real punches (present/half), approved leave, holidays and week-offs all win.
// WFH is recorded as Present with a code so payroll counts it as paid.
export function applyDeclaration(computed, decl) {
  if (!decl || !computed || computed.status !== 'absent') return computed
  return { ...computed, status: DECL_TO_STATUS[decl.status] || 'present', declared: decl, code: decl.status === 'wfh' ? 'WFH' : computed.code }
}

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

// punches: [{punch_at, direction?}] for this date. Returns computed day.
// Policy engine: In/Out are DERIVED from punch order (1st swipe = In, last = Out) —
// the device's in/out flag is unreliable, so it is ignored.
//   exempt    → non-punching admins: never absent from no-punch (always Present)
//   probation → probation/notice: leave & absence are unpaid (is_lop)
export function computeDay({ date, punches = [], config = DEFAULT_CFG, isHoliday = false, onLeave = false, isFC = false, exempt = false, probation = false }) {
  const d = new Date(date)
  if (isHoliday) return { status: 'holiday' }
  if (isWeekOff(d)) return { status: 'weekoff' }
  if (onLeave) return { status: 'leave', is_lop: probation }   // probation leave = unpaid

  // Derive In/Out purely from time order — ignore any device direction flag.
  // Debounce first, so an accidental double-scan can't become a spurious In/Out.
  const times = dedupeTimes(punches.map(p => new Date(p.punch_at)).filter(t => !isNaN(+t)).sort((a,b)=>a-b))
  if (!times.length) {
    if (exempt) return { status: 'present', code: 'EX' }        // admin non-puncher — stays Present
    return { status: 'absent', is_lop: true }                   // uninformed absence → LOP
  }
  const firstIn = times[0]
  const lastOut = times.length > 1 ? times[times.length-1] : null
  const inMin  = firstIn.getHours()*60 + firstIn.getMinutes()
  const startMin = toMin(config.office_start), graceMin = toMin(config.grace_until)
  const cutoffMin = toMin(config.half_day_cutoff), endMin = toMin(config.office_end)
  const outCutoff = config.early_grace ? toMin(config.early_grace) : endMin   // must stay till this for the PM half

  let status = 'present', late = 0, early = 0, code = null
  if (inMin > cutoffMin) return { status: 'absent', first_in: firstIn, is_lop: true }   // arrived too late → absent (LOP)
  if (inMin > graceMin) { status = 'half_day'; late = inMin - startMin; code = 'A:P' }   // late in → lost AM half

  const outMin = lastOut ? lastOut.getHours()*60 + lastOut.getMinutes() : null
  if (outMin != null && outMin < outCutoff) { early = outCutoff - outMin; if (status === 'present') { status = 'half_day'; code = 'P:A' } }   // left early → lost PM half

  const worked = lastOut ? Math.round((lastOut - firstIn) / 60000) : null
  const ot = (isFC && outMin != null && outMin > endMin) ? (outMin - endMin) : 0
  const leaveDeducted = status === 'half_day' ? 0.5 : 0
  return { status, code, first_in: firstIn, last_out: lastOut, worked_min: worked, late_min: late, early_min: early, ot_min: ot, leave_deducted: leaveDeducted, missing_punch: times.length === 1 }
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
