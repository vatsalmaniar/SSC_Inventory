// Attendance policy engine — computes a day's status from raw punches + config,
// so the dashboard/muster work on-demand (no nightly job needed on Micro).
//
// Everything here is pinned to IST. The office is in India and the ingest side already
// pins IST (essl-sync, the connector, reg_decide), but this layer used the browser's
// timezone — so the same month opened from a laptop set to UTC re-bucketed punches into
// different days and produced different LOP totals. Attendance decides pay; it must not
// depend on where the viewer happens to be.

export const IST_TZ = 'Asia/Kolkata'

// YYYY-MM-DD of the IST work date for an instant, whatever the viewer's timezone.
export const istYmd = d => new Date(d).toLocaleDateString('en-CA', { timeZone: IST_TZ })

// The instant an IST calendar day begins — for punch_at range filters.
export const istDayStart = ymdStr => new Date(`${ymdStr}T00:00:00+05:30`)

// Minutes since IST midnight for an instant. Replaces getHours()/getMinutes(), which read
// the browser's clock.
export function istMinutes(d) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: IST_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(d))
  return (+parts.find(p => p.type === 'hour').value) * 60 + (+parts.find(p => p.type === 'minute').value)
}

// early_grace_min is how many minutes before your shift ENDS you may leave and still keep
// the afternoon half — 15 by default, matching the policy shown to staff (LeavePolicyDrawer:
// "Out by 6:30 PM (grace 6:15)"). It is minutes rather than a clock time on purpose: staff on
// a custom shift (e.g. 10:00–16:30) get the same 15-minute allowance against THEIR end time.
// A fixed 18:15 would have demanded they stay two hours past their shift.
export const DEFAULT_CFG = { office_start:'10:00', grace_until:'10:15', half_day_cutoff:'14:30', office_end:'18:30', early_grace_min:15, birthday_leave_at:'17:00' }

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
  // A declared day is paid by definition — the absence it rescues carried is_lop:true, and
  // spreading it through meant Finalise stamped declared holidays/WFH as Loss of Pay
  // (Aug 2026: 65 paid days about to be written unpaid). Same for leave_deducted: a
  // company-declared half day must not charge the employee's leave balance.
  return { ...computed, status: DECL_TO_STATUS[decl.status] || 'present', declared: decl, code: decl.status === 'wfh' ? 'WFH' : computed.code, is_lop: false, leave_deducted: 0 }
}

export function toMin(t) { const [h, m] = (t || '0:0').slice(0,5).split(':').map(Number); return h * 60 + m }
export function minToHrs(min) { if (min == null) return '—'; const h = Math.floor(min/60), m = min%60; return `${h}h ${String(m).padStart(2,'0')}m` }
export function fmtTime(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit', hour12:true }) }

// ── Week-off overrides (swaps) ──
// The company sometimes shifts a weekly off (22 Aug 2026 was worked, 29 Aug given off
// instead). attendance_weekoff_overrides records those dates; pages load them once per
// init via loadWeekOffOverrides(sb) and every isWeekOff() call then honours the swap.
// If a page never loads them, isWeekOff falls back to the standard rule — degraded to
// the old behaviour, never something new and wrong.
let _woOverrides = new Map()   // 'YYYY-MM-DD' -> boolean
export async function loadWeekOffOverrides(sbClient) {
  const { data, error } = await sbClient.from('attendance_weekoff_overrides').select('work_date,is_weekoff')
  if (error) return _woOverrides   // keep whatever we had; standard rule still applies
  _woOverrides = new Map((data || []).map(r => [r.work_date, r.is_weekoff]))
  return _woOverrides
}
export const weekOffOverrides = () => _woOverrides

// Sundays off; 2nd & 4th Saturday off. Other Saturdays = working — unless an override
// row swaps the specific date.
export function isWeekOff(date) {
  // Resolved as a plain calendar date. 'YYYY-MM-DD' parses as UTC midnight but getDay() reads
  // the browser's clock, so west of UTC every date landed on the previous weekday and Monday
  // attendance was scored against Sunday.
  const s = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : istYmd(date)
  const ovr = _woOverrides.get(s)
  if (ovr != null) return ovr
  const [y, m, dd] = s.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd)), dow = d.getUTCDay()
  if (dow === 0) return true
  if (dow === 6) { const nth = Math.ceil(dd / 7); return nth === 2 || nth === 4 }
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
export function computeDay({ date, punches = [], config = DEFAULT_CFG, isHoliday = false, onLeave = false, leaveHalf = false, leavePeriod = 'first', isFC = false, exempt = false, probation = false }) {
  if (isHoliday) return { status: 'holiday' }
  if (isWeekOff(date)) return { status: 'weekoff' }
  if (onLeave) {
    // Half-day leave: the request stores is_half_day/half_period and charges the balance 0.5,
    // but this used to collapse to a full 'leave' day — so the company paid 1.0 for a 0.5
    // deduction and the half actually worked became invisible.
    if (leaveHalf) return { status: 'half_day', code: leavePeriod === 'second' ? 'P:L' : 'L:P', leave_deducted: 0.5, is_lop: probation, half_leave: true }
    return { status: 'leave', leave_deducted: 1, is_lop: probation }   // probation leave = unpaid
  }

  // Derive In/Out purely from time order — ignore any device direction flag.
  // Debounce first, so an accidental double-scan can't become a spurious In/Out.
  const times = dedupeTimes(punches.map(p => new Date(p.punch_at)).filter(t => !isNaN(+t)).sort((a,b)=>a-b))
  const firstIn = times[0] || null
  const lastOut = times.length > 1 ? times[times.length-1] : null

  // Exempt (non-punching admins) are Present regardless of what the device recorded. This
  // used to apply only to the zero-punch branch, so one stray scan by an exempt admin made
  // them late/half-day/absent — the opposite of what the exemption is for.
  if (exempt) return { status: 'present', code: 'EX', first_in: firstIn, last_out: lastOut, exempt: true }

  if (!times.length) return { status: 'absent', is_lop: true }   // uninformed absence → LOP

  const inMin  = istMinutes(firstIn)
  const startMin = toMin(config.office_start), graceMin = toMin(config.grace_until)
  const cutoffMin = toMin(config.half_day_cutoff), endMin = toMin(config.office_end)
  // Grace is measured back from THIS employee's shift end, so custom shifts keep the same
  // allowance rather than being held to the general office hours.
  const graceMins = Number.isFinite(+config.early_grace_min) ? +config.early_grace_min : 15
  const outCutoff = endMin - graceMins

  // A lone punch proves presence but not a full day. The old code treated the two cases
  // wildly differently: in-with-no-out skipped the early-out check and paid a FULL day, while
  // out-with-no-in was read as a late arrival and marked Absent + LOP — a full day's pay lost
  // even though the person had demonstrably been in the building.
  // Only the harmful case is corrected here: a lone punch never means Absent. It stays
  // Present and is flagged so HR can regularize. Whether a missing out-punch SHOULD cost half
  // a day is a policy decision, not a bug fix — on July data that would have moved 81
  // employee-days to half_day, i.e. ~40 days of pay, mostly from device misses.
  if (times.length === 1) {
    return { status: 'present', first_in: firstIn, last_out: null, worked_min: null,
             late_min: inMin > graceMin ? inMin - startMin : 0, early_min: 0, ot_min: 0,
             leave_deducted: 0, missing_punch: true }
  }

  let status = 'present', late = 0, early = 0, code = null
  if (inMin > cutoffMin) return { status: 'absent', first_in: firstIn, last_out: lastOut, is_lop: true }   // arrived too late → absent (LOP)
  if (inMin > graceMin) { status = 'half_day'; late = inMin - startMin; code = 'A:P' }   // late in → lost AM half

  const outMin = istMinutes(lastOut)
  if (outMin < outCutoff) { early = outCutoff - outMin; if (status === 'present') { status = 'half_day'; code = 'P:A' } }   // left early → lost PM half

  const worked = Math.round((lastOut - firstIn) / 60000)
  const ot = (isFC && outMin > endMin) ? (outMin - endMin) : 0
  const leaveDeducted = status === 'half_day' ? 0.5 : 0
  return { status, code, first_in: firstIn, last_out: lastOut, worked_min: worked, late_min: late, early_min: early, ot_min: ot, leave_deducted: leaveDeducted, missing_punch: false }
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
