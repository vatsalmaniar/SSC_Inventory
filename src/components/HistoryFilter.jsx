import { useState } from 'react'

// Shared filter bar + pager for the 360 pages' Order / PO history tables.
// Mirrors the order-list model: timeline chips + free-text search, 25/page.
// Kept presentational + a tiny state hook so Item/Customer/Vendor 360 stay in parity.

export const HISTORY_PAGE_SIZE = 25

const TIMELINES = [
  { key: 'all',    label: 'All Time' },
  { key: 'month',  label: 'This Month' },
  { key: 'year',   label: 'This Year' },
  { key: 'custom', label: 'Custom' },
]

// Same date-window semantics as OrdersList.inTimeline (order/PO date based).
export function inHistoryRange(dateStr, timeline, customFrom, customTo) {
  if (timeline === 'all') return true
  if (!dateStr) return false
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (timeline === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (timeline === 'year')  return d.getFullYear() === now.getFullYear()
  if (timeline === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0, 0, 0, 0); if (d < f) return false }
    if (customTo)   { const t = new Date(customTo);   t.setHours(0, 0, 0, 0); if (d > t) return false }
    return true
  }
  return true
}

// rows are expected pre-sorted (oldest → newest) by the caller.
// dateOf(row) → date string used for the timeline filter.
// searchOf(row) → haystack string used for the search box.
export function useHistoryFilter(rows, { dateOf, searchOf, pageSize = HISTORY_PAGE_SIZE }) {
  const [timeline, setTimelineRaw]     = useState('all')
  const [customFrom, setCustomFromRaw] = useState('')
  const [customTo, setCustomToRaw]     = useState('')
  const [search, setSearchRaw]         = useState('')
  const [page, setPage]                = useState(1)

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r =>
    inHistoryRange(dateOf(r), timeline, customFrom, customTo) &&
    (!q || (searchOf(r) || '').toLowerCase().includes(q))
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  // Any filter change snaps back to page 1 so the user never lands on an empty page.
  const bind = setter => v => { setter(v); setPage(1) }

  return {
    timeline, setTimeline: bind(setTimelineRaw),
    customFrom, setCustomFrom: bind(setCustomFromRaw),
    customTo, setCustomTo: bind(setCustomToRaw),
    search, setSearch: bind(setSearchRaw),
    page: safePage, setPage,
    filtered, paginated, totalPages, pageSize,
  }
}

export function HistoryFilterBar({ f, placeholder }) {
  return (
    <div className="c360-hfilter">
      <div className="c360-hfilter-timeline">
        {TIMELINES.map(t => (
          <button key={t.key} className={f.timeline === t.key ? 'on' : ''} onClick={() => f.setTimeline(t.key)}>{t.label}</button>
        ))}
        {f.timeline === 'custom' && (
          <span className="c360-hfilter-custom">
            <span>From</span>
            <input type="date" value={f.customFrom} onChange={e => f.setCustomFrom(e.target.value)} />
            <span>To</span>
            <input type="date" value={f.customTo} onChange={e => f.setCustomTo(e.target.value)} />
          </span>
        )}
      </div>
      <div className="c360-hfilter-search">
        <svg className="c360-hfilter-search-ico" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input value={f.search} onChange={e => f.setSearch(e.target.value)} placeholder={placeholder || 'Search…'} />
        {f.search && <button className="c360-hfilter-clear" onClick={() => f.setSearch('')} title="Clear">✕</button>}
      </div>
    </div>
  )
}

export function HistoryPager({ f }) {
  if (f.filtered.length === 0) return null
  const { page, totalPages, setPage, filtered, pageSize } = f
  return (
    <div className="c360-pager">
      <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
      <div className="c360-pager-btns">
        <button className="c360-page-btn" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹ Prev</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
          const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1
          const ell  = !show && Math.abs(p - page) === 2
          if (show) return <button key={p} className={'c360-page-btn' + (p === page ? ' on' : '')} onClick={() => setPage(p)}>{p}</button>
          if (ell)  return <span key={'e' + p} className="c360-pager-ell">…</span>
          return null
        })}
        <button className="c360-page-btn" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next ›</button>
      </div>
    </div>
  )
}
