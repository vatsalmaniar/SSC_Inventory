const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// Paired with the useMonthYearFilter hook — renders the "Month / Year" chip + year/month selects.
export default function MonthYearFilter({ active, onActivate, year, setYear, month, setMonth, loading }) {
  return (
    <>
      <button className={active ? 'on' : ''} onClick={onActivate}>Month / Year</button>
      {active && (
        <div className="o-timeline-custom">
          <span>Year</span>
          <select value={year} onChange={e => setYear(e.target.value)}>
            {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <span>Month</span>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            <option value="">All months</option>
            {MONTHS.map((m, i) => (
              <option key={i} value={i}>{m}</option>
            ))}
          </select>
          {loading && <span style={{ fontSize: 11, color: 'var(--o-muted)' }}>Loading {year}…</span>}
        </div>
      )}
    </>
  )
}
