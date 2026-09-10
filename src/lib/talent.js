// Shared Talent 360 data helpers.
//
// Anything more than one page asks of the database lives here, so the pipeline
// counts on the dashboard and the pipeline counts on the board cannot disagree
// — the one-formula-per-metric rule.

import { sb } from './supabase'
import { fetchAll } from './fetchAll'
import { LIVE_STAGES, TERMINAL_STAGES, needsReason } from './talentStage'

export const TALENT_ROLES = ['admin', 'management']
export const canSeeTalent = role => TALENT_ROLES.includes(role)

// Local date, not toISOString() — that is UTC and rolls a day early in IST.
export const todayYmd = () => new Date().toLocaleDateString('en-CA')

// ── Offer expiry ───────────────────────────────────────────────────────────
// Derived on READ, never written by a job. Nothing sweeps the offers table:
// the Supabase plan is burstable and a scheduled job has taken this database
// down before. The status is stamped 'lapsed' only when a human next acts on
// the offer, so these two helpers are what the UI must ask.
export const isLapsed = o =>
  o?.status === 'sent' && !!o?.valid_till && o.valid_till < todayYmd()

export const effectiveOfferStatus = o => (isLapsed(o) ? 'lapsed' : o?.status)

export const canAcceptOffer = o => o?.status === 'sent' && !isLapsed(o)

// Days until an offer lapses — negative once it has. null when open-ended.
export function daysToLapse(o) {
  if (!o?.valid_till) return null
  const [y, m, d] = o.valid_till.split('-').map(Number)
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return Math.round((new Date(y, m - 1, d) - t) / 86400000)
}

// ── Writes are RPC-ONLY ────────────────────────────────────────────────────
// The browser has SELECT on the Talent tables and nothing else — insert,
// update and delete are revoked (sql/talent_360_up.sql section 13). Every
// mutation goes through a SECURITY DEFINER function that re-checks the
// caller's role server-side, so a page bug or a hand-rolled PostgREST call
// from a signed-in browser cannot rewrite an offered CTC or flip an
// application to 'joined'. Same rule the item master runs under.
//
// These wrappers exist so a page never has to remember an RPC's parameter
// names. Do NOT add a direct .insert()/.update() alongside them — it will
// fail at the database, which is the point.

// Timeline entries are written by the RPCs themselves (one transaction with
// the thing they describe), so pages no longer log separately.
export async function addComment(applicationId, message) {
  const { error } = await sb.rpc('add_talent_comment', {
    p_application_id: applicationId, p_message: message,
  })
  if (error) throw error
}

/**
 * Moves an application to a new stage and records why.
 * Transition validation belongs to the caller (talentStage.js canMove); the
 * server enforces the two rules that actually matter — 'joined' is refused
 * here, and closing a candidate out requires a reason.
 */
export async function moveStage({ application, to, reason }) {
  if (to === 'joined') throw new Error('Use the Mark joined flow — joining must create the employee record.')
  if (needsReason(to) && !String(reason || '').trim()) {
    throw new Error('A reason is required when closing a candidate out.')
  }
  const { error } = await sb.rpc('move_application_stage', {
    p_id: application.id, p_stage: to, p_reason: reason || null,
  })
  if (error) throw error
}

// ── Loaders ────────────────────────────────────────────────────────────────
// fetchAll everywhere a list can grow past PostgREST's 1000-row cap — a plain
// .select() truncates silently and the page just under-reports.

// Every one of these orders by a timestamp AND by id — paging with .range()
// across a non-unique sort can skip or duplicate a row at a page boundary, so
// the unique tiebreaker is what makes the boundaries deterministic.

export const loadRequisitions = (testMode = false) =>
  fetchAll((from, to) => sb.from('job_requisitions').select('*')
    .eq('is_test', testMode)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to))

export const loadOpenings = (testMode = false) =>
  fetchAll((from, to) => sb.from('job_openings').select('*')
    .eq('is_test', testMode)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to))

// The pipeline board and the dashboard both need application + candidate +
// opening together. One query, one shape.
export const loadPipeline = (testMode = false) =>
  fetchAll((from, to) => sb.from('applications')
    .select('*, candidate:candidates(*), opening:job_openings(id,title,department,branch)')
    .eq('is_test', testMode)
    .order('stage_changed_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to))

export const loadOffers = (testMode = false) =>
  fetchAll((from, to) => sb.from('offers')
    .select('*, application:applications(id, stage, candidate:candidates(id,full_name,email,phone))')
    .eq('is_test', testMode)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to))

// ── Org options ────────────────────────────────────────────────────────────
// Departments and branches offered on the opening form come from the people we
// actually employ, not a hardcoded list — so a new department appears the day
// someone is hired into it, and nothing drifts out of step with People 360.
//
// Deliberately NOT spell-corrected on the way through: the department strings
// are the ones stored on employee records, and "fixing" one here would make
// this form write a value that matches nobody. If a name is wrong it should be
// corrected on the employees themselves.
export async function loadOrgOptions() {
  const { data, error } = await fetchAll((from, to) => sb.from('employees')
    .select('department,branch')
    .eq('is_test', false)
    .order('id', { ascending: true })
    .range(from, to))
  if (error) return { departments: [], branches: [] }
  const uniq = k => [...new Set((data || []).map(r => r[k]).filter(Boolean))].sort()
  return { departments: uniq('department'), branches: uniq('branch') }
}

// ── Funnel ─────────────────────────────────────────────────────────────────
// Counts per LIVE stage. Terminal stages are excluded on purpose: over a year
// 'rejected' dwarfs every live stage and flattens the chart to slivers. The
// card's eyebrow has to say so rather than silently dropping them.
export function funnelCounts(apps) {
  const by = Object.fromEntries(LIVE_STAGES.map(s => [s, 0]))
  for (const a of apps || []) if (by[a.stage] !== undefined) by[a.stage]++
  return LIVE_STAGES.map(s => ({ stage: s, count: by[s] }))
}

export const activeApplications = apps => (apps || []).filter(a => !TERMINAL_STAGES.includes(a.stage))

// Median, not mean: one candidate who took nine months to close would drag a
// mean time-to-hire somewhere no real hire has ever been.
export function medianDays(values) {
  const v = (values || []).filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2)
}

export function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}
