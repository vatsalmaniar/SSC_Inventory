// Compact bento stat tile — shared by the People home and My Attendance so the two
// pages cannot drift apart. Styling lives in src/styles/people-home.css (.ph-stat*),
// scoped under .orders-app.
// `delta` is an optional { pct, up } — a number tile says more when it says which way
// it moved. `goodDown` flips the colour for metrics where falling is good (overdue).
export default function StatTile({ label, value, unit, foot, warn, onClick, delta, goodDown }) {
  const good = delta ? (goodDown ? !delta.up : delta.up) : null
  return (
    <div className={`ph-stat${warn ? ' is-warn' : ''}${onClick ? '' : ' is-static'}`} onClick={onClick}>
      <div className="ph-stat-l">{label}</div>
      <div className="ph-stat-v">
        {value}{unit && <small> {unit}</small>}
        {delta && (
          <span className={`ph-delta ${good ? 'up' : 'down'}`} title={delta.title || ''}>
            <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d={delta.up ? 'M3 8 L6 4 L9 8' : 'M3 4 L6 8 L9 4'} strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {Math.abs(delta.pct)}%
          </span>
        )}
      </div>
      <div className="ph-stat-f">{foot}</div>
    </div>
  )
}
