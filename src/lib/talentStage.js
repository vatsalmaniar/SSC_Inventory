// ═══════════════════════════════════════════════════════════════════
// THE hiring pipeline state machine — single source of truth.
// Every Talent page imports from here; no hand-rolled stage lists anywhere.
// Mirrors the CHECK constraint on applications.stage in
// sql/talent_360_up.sql — keep the two in sync.
//
// The live pipeline is linear:
//   applied → screening → interview → reference → offer → joined
// with two exits available from any live stage:
//   rejected    — we said no
//   dropped_out — they said no (or went quiet)
//
// Keeping those two apart matters: "rejected" is a hiring-quality signal,
// "dropped_out" is an attractiveness signal, and averaging them together
// tells you nothing about which of the two problems you actually have.
// ═══════════════════════════════════════════════════════════════════

// The linear pipeline, in order. Index position IS the progression.
export const LIVE_STAGES = ['applied', 'screening', 'interview', 'reference', 'offer']

// Nothing further can happen on an application in one of these.
export const TERMINAL_STAGES = ['joined', 'rejected', 'dropped_out']

// Complete whitelist — must equal the DB CHECK constraint's list.
export const STAGES = [...LIVE_STAGES, ...TERMINAL_STAGES]

// The two ways an application ends without a hire.
export const EXIT_STAGES = ['rejected', 'dropped_out']

export const STAGE_LABEL = {
  applied:     'Applied',
  screening:   'Screening',
  interview:   'Interview',
  reference:   'Reference check',
  offer:       'Offer',
  joined:      'Joined',
  rejected:    'Rejected',
  dropped_out: 'Dropped out',
}

// Palette is the app's, from global.css tokens — see UI conventions.
// Amber = waiting on us, blue = in motion, green = won, red/grey = ended.
export const STAGE_COLOR = {
  applied:     '#475569',
  screening:   '#b45309',
  interview:   '#1a73e8',
  reference:   '#7c3aed',
  offer:       '#0d9488',
  joined:      '#15803d',
  rejected:    '#dc2626',
  dropped_out: '#94a3b8',
}

export const stageLabel = (s) => STAGE_LABEL[s] || s || '—'
export const stageColor = (s) => STAGE_COLOR[s] || '#475569'

export const isTerminal = (s) => TERMINAL_STAGES.includes(s)
export const isLive     = (s) => LIVE_STAGES.includes(s)
export const stageIndex = (s) => LIVE_STAGES.indexOf(s)

// ── Transitions ────────────────────────────────────────────────────
// Forward one step at a time, or out to an exit. No skipping: a candidate
// cannot arrive at 'offer' without the interview rows existing, because the
// offer screen reads them. Going backwards IS allowed (a second interview
// round after a reference call raises a doubt is a real thing) but only
// between live stages — never out of a terminal one.
//
// Reopening a terminal application is deliberately NOT a transition. Someone
// who dropped out and came back later is a NEW application against the
// opening, so the funnel counts them once per attempt and the drop-out is not
// quietly erased from the history.
export function allowedNext(stage) {
  if (isTerminal(stage)) return []
  const i = stageIndex(stage)
  if (i < 0) return []
  const out = []
  if (i > 0) out.push(LIVE_STAGES[i - 1])              // step back
  if (i < LIVE_STAGES.length - 1) out.push(LIVE_STAGES[i + 1])
  else out.push('joined')                              // offer → joined
  return [...out, ...EXIT_STAGES]
}

export const canMove = (from, to) => allowedNext(from).includes(to)

// 'joined' is reached by the Mark-joined flow (which creates the employee),
// never by the plain stage picker — moving the stage alone would leave an
// application claiming a hire with no employee behind it.
export const isJoinTransition = (from, to) => to === 'joined' && from === 'offer'

// ── Funnel ─────────────────────────────────────────────────────────
// Terminal stages are EXCLUDED from the funnel chart on purpose: over a year
// 'rejected' dwarfs every live stage and flattens them all to slivers. Say so
// in the card's eyebrow rather than silently dropping them.
export const FUNNEL_STAGES = LIVE_STAGES

// Reason is mandatory on an exit — an unexplained rejection is worthless
// three months later when someone asks why we passed on them.
export const needsReason = (stage) => EXIT_STAGES.includes(stage)
export const reasonField = (stage) =>
  stage === 'rejected' ? 'rejected_reason'
  : stage === 'dropped_out' ? 'dropout_reason'
  : null
