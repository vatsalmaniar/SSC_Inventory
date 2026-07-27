// Shared ring gauge — matches the Orders "Dispatch Efficiency" chart:
// gradient arc + big % centre + side legend (dotted rows) + dashed summary row.
// Used by the People dashboard "Who's In" and the Attendance month card.
export default function StatusDonut({ pct = 0, centerLabel = '', rows = [], summary }) {
  const size = 150, r = size/2 - 12, c = 2 * Math.PI * r, dash = (Math.max(0, Math.min(100, pct))/100) * c
  const gauge = (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink:0 }}>
      <defs>
        <linearGradient id="sdGaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a73e8"/><stop offset="100%" stopColor="#10B981"/>
        </linearGradient>
      </defs>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="8"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#sdGaugeGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2 - 2} textAnchor="middle" fontSize="32" fontWeight="600" fill="#0B1B30" style={{ letterSpacing:'-0.02em' }}>{Math.round(pct)}<tspan fontSize="16" fill="#6B7280">%</tspan></text>
      <text x={size/2} y={size/2 + 18} textAnchor="middle" fontSize="9" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">{centerLabel}</text>
    </svg>
  )
  if (!rows.length && !summary) return gauge   // ring-only (e.g. the hero shift %)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:24, flexWrap:'wrap' }}>
      {gauge}
      <div style={{ flex:1, minWidth:170 }}>
        {rows.map(row => (
          <div key={row.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 0' }}>
            <span style={{ width:9, height:9, borderRadius:'50%', background:row.color, flexShrink:0 }}/>
            <span style={{ fontSize:13.5, color:'#374151', flex:1 }}>{row.label}</span>
            <span style={{ fontSize:14, fontWeight:600, color:'#0B1B30', fontFamily:'Geist Mono, monospace' }}>{row.value}</span>
          </div>
        ))}
        {summary && <>
          <div style={{ borderTop:'1px dashed #d1d5db', margin:'6px 0' }}/>
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'4px 0' }}>
            <span style={{ fontSize:13.5, color:'#6B7280', flex:1 }}>{summary.label}</span>
            <span style={{ fontSize:14, fontWeight:600, color:'#0B1B30', fontFamily:'Geist Mono, monospace' }}>{summary.value}</span>
          </div>
        </>}
      </div>
    </div>
  )
}
