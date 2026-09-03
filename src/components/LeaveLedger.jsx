// Leave ledger card — the transaction view behind the balance number.
// Purely presentational: the maths lives in src/lib/leaveLedger.js (buildLedger) and the
// page passes the computed result in, so the tile, this card and the team table can never
// disagree. fetchLedgerInputs() is the one query-shape for a single employee's inputs.
import { buildLedger, fyStart, fyEnd } from '../lib/leaveLedger.js'

// One employee's raw inputs for buildLedger. RLS scopes this to what the viewer may see
// (att_can_see), so a normal employee can only ever fetch their own.
export async function fetchLedgerInputs(sb, employeeId, fyLabel) {
  const [bal, reqs, att] = await Promise.all([
    sb.from('leave_balances').select('*').eq('employee_id', employeeId).eq('fy_label', fyLabel).maybeSingle(),
    sb.from('leave_requests').select('from_date,to_date,days,is_half_day,half_period,reason,status')
      .eq('employee_id', employeeId).in('status', ['approved', 'pending', 'mgr_approved', 'rejected'])
      .gte('from_date', fyStart()).lte('from_date', fyEnd()).order('from_date'),
    sb.from('attendance_days').select('work_date,status,source,source_code,first_in,is_lop')
      .eq('employee_id', employeeId).gte('work_date', fyStart()).lte('work_date', fyEnd())
      .in('status', ['half_day', 'leave', 'absent']).order('work_date'),
  ])
  const error = bal.error || reqs.error || att.error
  return { bal: bal.data || null, requests: reqs.data || [], attDays: att.data || [], error }
}

export function computeLedger({ bal, requests, attDays }, isOffDay) {
  return buildLedger({ bal, requests, attDays, isOffDay })
}

const fmtD = d => d ? new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—'
const mono = { fontFamily: "'Geist Mono',monospace" }
const KIND_DOT = { seed: '#8C99A8', request: '#7C5CE0', half: '#F5951E', hr_leave: '#7C5CE0', sandwich: '#D07E1E', encash: '#2E86DE', lop: '#F05252', pending: '#C25A00', rejected: '#BB0000' }
const NOFLOW_BADGE = {
  pending: { t: 'not approved yet', c: '#C25A00', b: 'rgba(226,101,0,0.12)' },
  rejected: { t: 'rejected', c: '#BB0000', b: 'rgba(187,0,0,0.08)' },
}

// bare=true renders just the transaction list (no card chrome) so it can sit inside an
// existing card — e.g. the Team leave card on the Leave page.
export default function LedgerCard({ ledger, fyLabel, title = 'Leave ledger', compact = false, bare = false }) {
  if (!ledger) return null
  const { opening, closing, rows, totals } = ledger
  const Wrap = ({ children }) => bare
    ? <div style={{ marginTop: 4 }}>{children}</div>
    : <div className="att-card" style={{ marginBottom: 14 }}>
        <div className="att-card-h" style={{ flexWrap: 'wrap', gap: 8 }}>
          <span className="att-card-t">{title} · FY {fyLabel}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            opening <b style={{ color: 'var(--ink)', ...mono }}>{opening}</b>
            {' · '}closing <b style={{ color: closing < 0 ? 'var(--st-absent)' : 'var(--ink)', ...mono }}>{closing}</b>
          </span>
        </div>
        {children}
      </div>
  return (
    <Wrap>
      {ledger.noBalance && (
        <div style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--bg)', borderRadius: 8, padding: '8px 12px', margin: '10px 0' }}>
          No leave balance has been set for this FY (usual for probation / new joiners) — movements below still record, but ask HR about the credit.
        </div>
      )}
      {totals.reconcileGap !== 0 && (
        <div style={{ fontSize: 12, color: '#B45309', background: '#FCF1E4', borderRadius: 8, padding: '8px 12px', margin: '10px 0' }}>
          Records don't fully tie out (difference {totals.reconcileGap} day) — tell the admin before trusting this ledger.
        </div>
      )}
      {(() => {
        // Leave transactions and LOP live in separate ledgers: leave moves the balance,
        // LOP (unpaid absences) cuts salary and must never blur into the leave numbers.
        const flowRows = rows.filter(r => !r.lop)
        const lopRows = rows.filter(r => r.lop)
        return (
          <div>
            {flowRows.length === 0 ? (
              <div className="e-empty" style={{ padding: '20px 0' }}>No leave movements this year yet.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 58px 58px', gap: 10, padding: '7px 0 5px', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--line-2)' }}>
                  <span>Date</span><span>Transaction</span><span style={{ textAlign: 'right' }}>Change</span><span style={{ textAlign: 'right' }}>Balance</span>
                </div>
                {flowRows.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 58px 58px', gap: 10, alignItems: 'baseline', padding: compact ? '7px 0' : '9px 0', borderBottom: '1px solid var(--line-2)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', ...mono }}>{fmtD(r.date)}</span>
                    <span style={{ minWidth: 0, fontSize: 13 }}>
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: KIND_DOT[r.kind] || '#C7CFD8', marginRight: 7, verticalAlign: 'baseline' }} />
                      {r.label}
                      {r.sub && <span style={{ color: 'var(--muted-2)', fontSize: 11.5 }}> · {r.sub}</span>}
                      {r.reason && <span style={{ color: 'var(--muted-2)', fontSize: 11.5 }}> · {r.reason}</span>}
                      {r.noflow && NOFLOW_BADGE[r.kind] && <span style={{ fontSize: 10, fontWeight: 600, color: NOFLOW_BADGE[r.kind].c, background: NOFLOW_BADGE[r.kind].b, borderRadius: 5, padding: '1px 6px', marginLeft: 7 }}>{NOFLOW_BADGE[r.kind].t}</span>}
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: r.noflow ? 'var(--muted-2)' : r.delta < 0 ? 'var(--st-absent)' : 'var(--muted-2)', ...mono }}>
                      {r.noflow ? (r.kind === 'pending' && r.days ? `(−${r.days})` : '—') : r.delta < 0 ? r.delta : `+${r.delta}`}
                    </span>
                    <span style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--ink)', ...mono }}>{r.noflow ? '' : r.balance}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, paddingTop: 10, fontSize: 11.5, color: 'var(--muted)' }}>
                  <span><b style={{ color: 'var(--ink)' }}>{totals.used}</b> used (requests {totals.requestDays}{totals.seedUsed > 0 ? ` + before-app ${totals.seedUsed}` : ''})</span>
                  {totals.halfDays > 0 && <span><b style={{ color: 'var(--ink)' }}>{totals.halfDays}</b> from half-days</span>}
                  {totals.hrLeave > 0 && <span><b style={{ color: 'var(--ink)' }}>{totals.hrLeave}</b> HR-marked</span>}
                  {totals.sandwich > 0 && <span><b style={{ color: 'var(--ink)' }}>{totals.sandwich}</b> sandwiched</span>}
                  {totals.encashed > 0 && <span><b style={{ color: 'var(--ink)' }}>{totals.encashed}</b> encashed</span>}
                </div>
              </>
            )}
            {lopRows.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 5px', borderBottom: '1px solid var(--line-2)' }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--st-absent)' }}>LOP ledger — unpaid absences · {lopRows.length} day{lopRows.length > 1 ? 's' : ''}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>cuts salary, not leave balance</span>
                </div>
                {lopRows.map((r, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'baseline', padding: compact ? '6px 0' : '8px 0', borderBottom: '1px solid var(--line-2)' }}>
                    <span style={{ fontSize: 12, color: 'var(--muted)', ...mono }}>{fmtD(r.date)}</span>
                    <span style={{ minWidth: 0, fontSize: 13 }}>
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: KIND_DOT.lop, marginRight: 7, verticalAlign: 'baseline' }} />
                      {r.label}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--st-absent)', background: '#FCEBEB', borderRadius: 5, padding: '1px 6px' }}>unpaid</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}
    </Wrap>
  )
}
