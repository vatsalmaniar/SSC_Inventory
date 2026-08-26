// Safe lookup by item/product codes — THE one way to filter a query by a list
// of part codes. Never use .in('item_code', [...]) directly.
//
// WHY: PostgREST's .in() parses its list from the URL; a code containing
// quotes, commas or parens (Hicool '4" Filter Kit … (130X130)', Schmersal
// 'AZ 15/16 B2 CPL' is fine, but '22A … 24" LW' is not) breaks the parse and
// the WHOLE request errors. Because most call sites destructured { data }
// without checking error, entire result sets silently became empty — the
// Forecast "Pending PO shows zero" incident (2026-08-26) and a silently
// skipped dispatch FIFO check both came from this. See
// feedback_postgrest_in_quoting.
//
// Strategy: codes that are .in()-safe go in chunked .in() queries (fast);
// risky codes get one .eq() query each (always safe). Errors are returned,
// never swallowed — callers must look at { error }.
//
// Usage:
//   const { data, error } = await selectByCodes(
//     () => sb.from('items').select('item_code,brand'),   // fresh builder per call
//     'item_code',
//     codes,
//   )

const IN_UNSAFE = /["'(),]/

export const isInUnsafe = (code) => IN_UNSAFE.test(String(code))

export async function selectByCodes(makeQuery, column, codes, { chunk = 150 } = {}) {
  const unique = [...new Set((codes || []).filter(Boolean))]
  if (!unique.length) return { data: [], error: null }
  const safe = unique.filter(c => !isInUnsafe(c))
  const risky = unique.filter(isInUnsafe)
  const jobs = []
  for (let i = 0; i < safe.length; i += chunk) jobs.push(makeQuery().in(column, safe.slice(i, i + chunk)))
  for (const c of risky) jobs.push(makeQuery().eq(column, c))
  const results = await Promise.all(jobs)
  return {
    data: results.flatMap(r => r.data || []),
    error: results.find(r => r.error)?.error || null,
  }
}
