// Leave ledger — THE single formula for leave consumption. The balance tile, the
// per-person transaction ledger, and the team table must all read this file; a second
// implementation anywhere is how balances stop tying out.
//
// Pure functions only (no fetching, no React) so the whole policy is unit-testable in
// node and portable to SQL later without translation drift.
//
// ── The formula ──────────────────────────────────────────────────────────────
//   opening  = credited + carried_forward                       (leave_balances)
//   closing  = opening − used − encashed − extras
//
//   `used` is what leave_decide has charged: the cutover seed (old HRMS) plus every
//   approved request's working-day count. The ledger splits it back into those two so
//   each request shows as its own transaction.
//
//   `extras` is muster/policy consumption the request flow never sees:
//     · half-days   −0.5  attendance_days status='half_day' since LEAVE_DEDUCT_FROM,
//                         EXCLUDING codes L:P / P:L (approved half-day leave — already
//                         inside `used`; counting them here double-charges)
//     · HR leave    −1.0  hr_manual 'leave' day with no approved request covering the
//                         date (informal leave HR recorded directly; without this it
//                         would be free)
//     · sandwich    −1.0  per off day (week-off or holiday) whose flanking working
//                         days are both on leave (handbook "sandwich rule"): full leave
//                         on either flank qualifies; a half-day leave qualifies only if
//                         it faces the off block (second-half before it / first-half
//                         after it). EVERY off day in the contiguous block is debited —
//                         literal handbook reading ("the off in between is not a free
//                         day"), so leave around the 5-day Diwali block debits all 5.
//                         Detected from approved requests only, blocks starting on/after
//                         LEAVE_DEDUCT_FROM (older leave lives in the old-HRMS baseline).
//   LOP days appear in the ledger as ₹-side information (unpaid) but never touch the
//   leave balance — that is the whole point of LOP.

import { fyRange } from './kpi.js'   // explicit extension so node can unit-test this file

// Going-forward auto-deduction starts here; earlier consumption is inside the seeded
// baseline (leave_balances.used), so charging it again would double-count.
export const LEAVE_DEDUCT_FROM = '2026-08-01'
// Computed lazily, not at module scope: an import-time fyRange() call is evaluated
// during chunk initialisation, where bundler ordering (not source order) decides
// whether kpi.js is ready yet — a blank-page class of bug. Functions dodge that.
let _fy
const FY = () => (_fy ||= fyRange())
export const deductFrom = () => LEAVE_DEDUCT_FROM > FY().start ? LEAVE_DEDUCT_FROM : FY().start
export const fyStart = () => FY().start
export const fyEnd = () => FY().end

// Approved half-day LEAVE codes (leave one half, present the other) — charged via the
// request, never via the muster row.
export const isHalfLeaveCode = c => c === 'L:P' || c === 'P:L'

// ── date helpers (string 'YYYY-MM-DD' domain; UTC math so the viewer's TZ is irrelevant) ──
export const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// ── sandwich detection ───────────────────────────────────────────────────────
// requests: approved leave_requests [{from_date,to_date,is_half_day,half_period}]
// isOffDay: (ymd) => 'weekoff' | 'holiday' | null   (week-off overrides + holiday table
//           already baked in by the caller)
// Returns [{ date, offKind, blockStart, blockEnd, before, after }] one entry per debited day.
export function sandwichDays(requests, isOffDay, { from = deductFrom(), to = fyEnd() } = {}) {
  // Leave cover per working day: 'full' | 'first' | 'second' (half period on leave).
  // Only APPROVED leave counts (no status field = approved, for callers passing pre-filtered
  // lists and for the drafts the apply-form preview appends).
  const cover = new Map()
  for (const r of (requests || []).filter(x => !x.status || x.status === 'approved')) {
    for (let d = r.from_date; d <= r.to_date; d = addDays(d, 1)) {
      if (isOffDay(d)) continue
      cover.set(d, r.is_half_day ? (r.half_period === 'second' ? 'second' : 'first') : 'full')
      if (d > to) break
    }
  }
  const qualifiesBefore = c => c === 'full' || c === 'second' // leave faces the off block from the left
  const qualifiesAfter  = c => c === 'full' || c === 'first'  // leave faces the off block from the right

  const out = []
  let d = from
  while (d <= to) {
    const kind = isOffDay(d)
    if (!kind) { d = addDays(d, 1); continue }
    // maximal contiguous off block [d .. e]
    let e = d
    while (isOffDay(addDays(e, 1))) e = addDays(e, 1)
    const before = addDays(d, -1)   // working by construction (block is maximal)
    const after  = addDays(e, 1)
    if (qualifiesBefore(cover.get(before)) && qualifiesAfter(cover.get(after))) {
      for (let x = d; x <= e; x = addDays(x, 1)) {
        out.push({ date: x, offKind: isOffDay(x), blockStart: d, blockEnd: e, before, after })
      }
    }
    d = addDays(e, 1)
  }
  return out
}

// ── the ledger ───────────────────────────────────────────────────────────────
// bal:      leave_balances row (or null → defaults 25 credited, nothing used)
// requests: approved leave_requests for the FY (any order)
// attDays:  attendance_days rows work_date ∈ [DEDUCT_FROM, FY_END], any status —
//           needs {work_date,status,source,source_code,first_in,is_lop}
// isOffDay: as above
export function buildLedger({ bal, requests = [], attDays = [], isOffDay }) {
  // No balance row = nothing credited (new joiners / probation until HR seeds one).
  // Defaulting to 25 here would invent leave that HR never granted.
  const credited = bal ? Number(bal.credited) : 0
  const carried  = bal ? Number(bal.carried_forward) : 0
  const used     = bal ? Number(bal.used) : 0
  const encashed = bal ? Number(bal.encashed) : 0
  const opening  = credited + carried

  // Only APPROVED requests charge the balance or trigger the sandwich rule (a row with no
  // status field is treated as approved — the bulk fetches used to send approved only).
  // Pending / rejected requests still appear in the ledger, clearly badged, delta 0.
  const allReqs = [...requests].sort((a, b) => a.from_date < b.from_date ? -1 : 1)
  const reqs = allReqs.filter(r => !r.status || r.status === 'approved')
  const unapproved = allReqs.filter(r => ['pending', 'mgr_approved', 'rejected'].includes(r.status))
  const reqDaysSum = reqs.reduce((s, r) => s + Number(r.days || 0), 0)
  // The cutover seed is whatever `used` holds beyond the app's own approved requests.
  const seedUsed = Math.round(Math.max(0, used - reqDaysSum) * 10) / 10
  // If requests sum past `used`, something charged less than approved — surface, don't hide.
  const reconcileGap = Math.round((seedUsed + reqDaysSum - used) * 10) / 10

  const rows = []
  const coveredByReq = d => reqs.some(r => r.from_date <= d && d <= r.to_date)

  // ── Pre-cutover breakup ──
  // The old HRMS musters (April–July) were imported into attendance_days with
  // source='muster'. Those dated rows DECOMPOSE the seeded `used` for display — they never
  // charge anything themselves (the charge is already inside `used`). GL:P / P:GL half
  // codes were half-day leaves (0.5). Whatever the dated rows can't account for (leave
  // after the muster export's cutoff, rounding) shows as one honest residual line, so the
  // ledger total always equals the balance exactly.
  let preSum = 0
  for (const a of attDays) {
    if (a.work_date >= deductFrom() || a.source !== 'muster') continue
    if (a.status === 'leave' && !coveredByReq(a.work_date)) {
      preSum += 1
      rows.push({ date: a.work_date, kind: 'seed', label: 'Leave (old HRMS)', delta: -1 })
    } else if (a.status === 'half_day' && /GL/.test(a.source_code || '')) {
      preSum += 0.5
      rows.push({ date: a.work_date, kind: 'seed', label: 'Half-day leave (old HRMS)', delta: -0.5 })
    }
  }
  const residual = Math.round((seedUsed - preSum) * 10) / 10
  if (residual > 0) rows.push({ date: fyStart(), kind: 'seed', label: 'Other pre-cutover usage (old HRMS — dates not recorded)', delta: -residual })
  else if (residual < 0) rows.push({ date: fyStart(), kind: 'seed', label: 'Pre-cutover adjustment (old HRMS overlap)', delta: -residual })
  for (const r of reqs) {
    rows.push({
      date: r.from_date, kind: 'request',
      label: r.is_half_day ? `Approved half-day leave (${r.half_period === 'second' ? 'second' : 'first'} half)` : 'Approved leave',
      sub: (r.from_date === r.to_date ? null : `to ${r.to_date}`) || undefined,
      reason: r.reason || undefined,
      delta: -Number(r.days || 0),
    })
  }

  for (const r of unapproved) {
    const rejected = r.status === 'rejected'
    rows.push({
      date: r.from_date, kind: rejected ? 'rejected' : 'pending',
      label: rejected ? 'Leave request — rejected (not debited)'
        : r.status === 'mgr_approved' ? 'Leave request — awaiting HR approval' : 'Leave request — awaiting manager approval',
      sub: (r.from_date === r.to_date ? undefined : `to ${r.to_date}`),
      reason: r.reason || undefined,
      days: Number(r.days || 0), delta: 0, noflow: true,
    })
  }

  const HALF_CAUSE = { 'A:P': 'Late arrival', 'P:A': 'Left early' }
  const sd = sandwichDays(reqs, isOffDay)
  const sandwichSet = new Set(sd.map(s => s.date))

  let halfSum = 0, hrLeaveSum = 0, hrLeaveChargedDates = new Set()
  for (const a of attDays) {
    if (a.work_date < deductFrom() || a.work_date > fyEnd()) continue
    // A half-day row never charges when an approved request covers the same date: the
    // request already charged the balance (0.5 or 1.0) at approval. Without this, an HR
    // half-day mark (code null) on a day with an approved half-day leave charges twice.
    if (a.status === 'half_day' && !isHalfLeaveCode(a.source_code) && !coveredByReq(a.work_date)) {
      halfSum += 0.5
      rows.push({
        date: a.work_date, kind: 'half',
        label: a.source === 'hr_manual' ? 'Half day (marked by HR)' : (HALF_CAUSE[a.source_code] || 'Half day'),
        sub: a.source_code === 'A:P' && a.first_in ? `in ${new Date(a.first_in).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}` : undefined,
        delta: -0.5,
      })
    } else if (a.status === 'leave' && a.source === 'hr_manual' && !coveredByReq(a.work_date)) {
      hrLeaveSum += 1; hrLeaveChargedDates.add(a.work_date)
      rows.push({ date: a.work_date, kind: 'hr_leave', label: 'Leave marked by HR (no request)', delta: -1 })
    }
    if (a.is_lop) {
      rows.push({ date: a.work_date, kind: 'lop', label: a.status === 'leave' ? 'Unpaid leave (LOP)' : 'Absent — loss of pay', delta: 0, lop: true })
    }
  }

  let sandwichSum = 0
  for (const s of sd) {
    if (hrLeaveChargedDates.has(s.date)) continue   // HR already charged this exact off day
    sandwichSum += 1
    rows.push({
      date: s.date, kind: 'sandwich',
      label: `Sandwiched ${s.offKind === 'holiday' ? 'holiday' : 'week-off'}`,
      sub: `leave on ${s.before} and ${s.after}`,
      delta: -1,
    })
  }

  if (encashed > 0) rows.push({ date: fyEnd(), kind: 'encash', label: 'Encashed', delta: -encashed })

  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  let run = opening
  for (const r of rows) { run = Math.round((run + r.delta) * 10) / 10; r.balance = run }

  const extras = Math.round((halfSum + hrLeaveSum + sandwichSum) * 10) / 10
  const closing = Math.round((opening - used - encashed - extras) * 10) / 10
  return {
    opening, closing, rows, noBalance: !bal,
    totals: { credited, carried, used, seedUsed, requestDays: reqDaysSum, encashed, halfDays: halfSum, hrLeave: hrLeaveSum, sandwich: sandwichSum, extras, reconcileGap },
  }
}

// Convenience for pages that only need the number on the tile — same formula, no rows.
export function leaveConsumedExtras({ requests = [], attDays = [], isOffDay }) {
  return buildLedger({ bal: { credited: 0, carried_forward: 0, used: 0, encashed: 0 }, requests, attDays, isOffDay }).totals.extras
}
