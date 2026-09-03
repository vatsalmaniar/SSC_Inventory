// Numbered pagination for People/attendance lists — the exact Orders-list footer
// (OrdersList.jsx ol-foot/ol-pages) replicated with people-scoped classes, because
// people pages must not use .orders-app CSS. One component, no per-page copies.
export default function PeoplePager({ page, setPage, total, pageSize = 50 }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safe = Math.min(page, totalPages)
  if (total <= 0) return null
  return (
    <div className="p-foot">
      <span>Showing {(safe - 1) * pageSize + 1}–{Math.min(safe * pageSize, total)} of {total}</span>
      <div className="p-pages">
        <button className="p-page-btn" onClick={() => setPage(Math.max(1, safe - 1))} disabled={safe === 1}>‹ Prev</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
          const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safe) <= 1
          const ellipsis = !show && Math.abs(p - safe) === 2
          if (show) return <button key={p} className={`p-page-btn ${p === safe ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
          if (ellipsis) return <span key={'e' + p} style={{ padding: '5px 4px', color: 'var(--muted-2)' }}>…</span>
          return null
        })}
        <button className="p-page-btn" onClick={() => setPage(Math.min(totalPages, safe + 1))} disabled={safe === totalPages}>Next ›</button>
      </div>
    </div>
  )
}
