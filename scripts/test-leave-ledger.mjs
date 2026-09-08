// Regression tests for THE leave formula (src/lib/leaveLedger.js).
// Leave is the most consequential number in the app: it gates applications and feeds pay.
// Run: node scripts/test-leave-ledger.mjs
import { buildLedger } from '../src/lib/leaveLedger.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const bal = { credited: 25, carried_forward: 0, used: 0, encashed: 0 }
const noOff = () => null
const kinds = L => L.rows.filter(r => r.delta !== 0).map(r => r.kind)

console.log('\nmuster reconciliation')
{ // a day charged as leave but worked → credited back, original charge still visible
  const L = buildLedger({ bal: { ...bal, used: 0.5 }, isOffDay: noOff,
    requests: [{ from_date:'2026-09-07', to_date:'2026-09-07', days:0.5, is_half_day:true, half_period:'first', status:'approved' }],
    attDays: [{ work_date:'2026-09-07', status:'present', source:'hr_manual' }],
    musterEdits: [{ work_date:'2026-09-07', actor:'Vatsal Maniar' }] })
  eq('worked day credited back', L.closing, 25)
  eq('original charge NOT suppressed', kinds(L).includes('request'), true)
  eq('correction is attributed', L.rows.some(r => r.label === 'Credited by muster — Vatsal Maniar'), true)
}
{ // muster says a full leave day where only a half was charged → debited
  const L = buildLedger({ bal: { ...bal, used: 0.5 }, isOffDay: noOff,
    requests: [{ from_date:'2026-08-27', to_date:'2026-08-27', days:0.5, is_half_day:true, half_period:'second', status:'approved' }],
    attDays: [{ work_date:'2026-08-27', status:'leave', source:'hr_manual' }] })
  eq('under-charged day debited', L.closing, 24)
}
{ // absent on an approved leave day: LOP is unpaid, it must NOT also eat leave
  const L = buildLedger({ bal: { ...bal, used: 1 }, isOffDay: noOff,
    requests: [{ from_date:'2026-08-10', to_date:'2026-08-10', days:1, status:'approved' }],
    attDays: [{ work_date:'2026-08-10', status:'absent', source:'hr_manual', is_lop:true }] })
  eq('absent credits the leave (LOP is a pay matter)', L.closing, 25)
}
{ // request charged an off day (holiday added after approval) → credited
  const off = d => d === '2026-08-15' ? 'holiday' : null
  const L = buildLedger({ bal: { ...bal, used: 2 }, isOffDay: off,
    requests: [{ from_date:'2026-08-14', to_date:'2026-08-15', days:2, status:'approved' }],
    attDays: [{ work_date:'2026-08-14', status:'leave', source:'app_computed' },
              { work_date:'2026-08-15', status:'holiday', source:'app_computed' }] })
  eq('off day charged at apply is credited', L.closing, 24)
}
{ // not finalised yet → the request stands, no invented correction
  const L = buildLedger({ bal: { ...bal, used: 1 }, isOffDay: noOff,
    requests: [{ from_date:'2026-09-05', to_date:'2026-09-05', days:1, status:'approved' }], attDays: [] })
  eq('no muster row leaves the request alone', L.closing, 24)
  eq('and posts no correction', L.totals.musterAdj, 0)
}

console.log('\nsandwich')
{
  const off = d => ['2026-08-15','2026-08-16'].includes(d) ? 'weekoff' : null
  const reqs = [{ from_date:'2026-08-14', to_date:'2026-08-14', days:1, status:'approved' },
                { from_date:'2026-08-17', to_date:'2026-08-17', days:1, status:'approved' }]
  const intact = buildLedger({ bal: { ...bal, used: 2 }, requests: reqs, isOffDay: off,
    attDays: [{ work_date:'2026-08-14', status:'leave' }, { work_date:'2026-08-17', status:'leave' }] })
  eq('every off day in the block is charged', intact.totals.sandwich, 2)
  eq('intact sandwich is not reversed', intact.totals.musterAdj, 0)

  const worked = buildLedger({ bal: { ...bal, used: 2 }, requests: reqs, isOffDay: off,
    attDays: [{ work_date:'2026-08-14', status:'leave' }, { work_date:'2026-08-17', status:'present', source:'hr_manual' }] })
  eq('worked flank reverses the whole block', worked.totals.musterAdj, 3)   // 2 sandwich + 1 leave day
  eq('sandwich debit stays on the record', worked.rows.some(r => r.kind === 'sandwich' && r.delta === -1), true)
}

console.log('\nguards that must not regress')
{ // an approved half-day leave is charged by the REQUEST; the muster half row must not double it
  const L = buildLedger({ bal: { ...bal, used: 0.5 }, isOffDay: noOff,
    requests: [{ from_date:'2026-08-20', to_date:'2026-08-20', days:0.5, is_half_day:true, half_period:'second', status:'approved' }],
    attDays: [{ work_date:'2026-08-20', status:'half_day', source_code:'P:L', source:'app_computed' }] })
  eq('L:P / P:L never double-charge', L.closing, 24.5)
}
{ // HR marking leave with no request must still cost a day
  const L = buildLedger({ bal, requests: [], isOffDay: noOff,
    attDays: [{ work_date:'2026-08-20', status:'leave', source:'hr_manual' }] })
  eq('HR leave with no request is charged', L.closing, 24)
}
{ // a late-arrival half day is muster consumption, not a request
  const L = buildLedger({ bal, requests: [], isOffDay: noOff,
    attDays: [{ work_date:'2026-08-11', status:'half_day', source_code:'A:P', source:'app_computed' }] })
  eq('late-arrival half day costs 0.5', L.closing, 24.5)
}
{ // rejected / pending never debit
  const L = buildLedger({ bal, isOffDay: noOff, attDays: [],
    requests: [{ from_date:'2026-08-21', to_date:'2026-08-21', days:1, status:'rejected' },
               { from_date:'2026-08-22', to_date:'2026-08-22', days:1, status:'pending' }] })
  eq('unapproved requests never debit', L.closing, 25)
  eq('but they stay visible in the ledger', L.rows.filter(r => ['rejected','pending'].includes(r.kind)).length, 2)
}
{ // no balance row must not invent 25 days
  const L = buildLedger({ bal: null, requests: [], attDays: [], isOffDay: noOff })
  eq('no balance row = nothing credited', L.closing, 0)
  eq('and is flagged', L.noBalance, true)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
