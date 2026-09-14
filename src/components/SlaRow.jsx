// One SLA line: how we did this month, how that compares with last month, and — where the
// module can compute it — how many are breaching RIGHT NOW. The open count is the actionable
// half: a percentage tells you the past, a breach count tells you what to chase.
//
// Lived inside ProcurementDashboard.jsx until the Orders dashboard grew a fulfilment SLA of
// its own. Two copies of a scorecard row drift — one gets a colour threshold or a delta
// arrow the other never receives — so it moved here rather than being pasted.
//
// `owner` and `openBreaches` are optional: procurement names the person accountable for each
// step and counts live breaches; the orders fulfilment clock has neither (an order carries no
// approved_at, so no step has a separate owner), and passes just label / pct / prev / n.
export default function SlaRow({ label, owner, pct, prev, n, openBreaches, last }) {
  const good = pct != null && pct >= 90
  const delta = (pct != null && prev != null) ? pct - prev : null
  const count = n ? `${n} this month` : 'none yet this month'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 0',
                  borderBottom: last ? 'none' : '1px solid var(--gray-100)' }}>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, color:'var(--gray-800)', fontWeight:500 }}>{label}</div>
        <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>
          {owner ? `${owner} · ${count}` : count}
          {openBreaches > 0 && <span style={{ color:'#B91C1C', fontWeight:600 }}> · {openBreaches} open past SLA</span>}
        </div>
      </div>
      <div style={{ textAlign:'right', flexShrink:0 }}>
        <div className="mono" style={{ fontSize:19, fontWeight:600,
             color: pct == null ? 'var(--gray-400)' : good ? '#15803d' : '#B45309' }}>
          {pct == null ? '—' : pct + '%'}
        </div>
        {delta != null && delta !== 0 && (
          <div style={{ fontSize:10.5, color: delta > 0 ? '#15803d' : '#B91C1C' }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} pts vs last month
          </div>
        )}
      </div>
    </div>
  )
}
