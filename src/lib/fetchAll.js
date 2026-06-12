// Canonical "fetch every row" helper.
//
// PostgREST caps a single select at 1000 rows (db.max-rows). Loading a whole
// table/filter in one query therefore SILENTLY drops everything past row 1000
// — the bug that hid 406 orders and made the Cancelled chip read 11 instead
// of 25. Any list page that needs the full set must page through with .range()
// instead of relying on one capped query.
//
// Usage — pass a function that builds the query for a given row window:
//
//   const { data, error, truncated } = await fetchAll((from, to) =>
//     sb.from('orders')
//       .select('id,status,order_items(*)')
//       .eq('is_test', false)
//       .gte('created_at', FY_START)
//       .order('created_at', { ascending: false })
//       .order('id', { ascending: false })        // stable tiebreaker (see note)
//       .range(from, to)
//   )
//
// Returns { data, error, truncated }:
//   - data:      all rows concatenated across pages (whatever loaded before an error)
//   - error:     first error encountered, or null
//   - truncated: true only if the hard safety ceiling was hit (never silent)
//
// NOTE on ordering: always include a unique tiebreaker (e.g. `.order('id')`)
// in addition to your sort column. Paging by .range() across a non-unique sort
// (two rows sharing the same created_at at a page boundary) can otherwise skip
// or duplicate a row. The tiebreaker makes the page boundaries deterministic.

const PAGE = 1000
const MAX_PAGES = 100 // hard ceiling: 100k rows. Surfaced via `truncated`, never silent.

export async function fetchAll(buildQuery) {
  let all = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) return { data: all, error, truncated: false }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    if (page === MAX_PAGES - 1) {
      // Ceiling reached — report it loudly instead of silently dropping rows.
      console.warn(`fetchAll: reached ${MAX_PAGES}-page ceiling (${all.length} rows). Data may be incomplete — move this list to server-side pagination.`)
      return { data: all, error: null, truncated: true }
    }
  }
  return { data: all, error: null, truncated: false }
}
