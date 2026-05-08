// KPI auto-fetcher and derived-computation registry.
//
// BULK fetchers: each receives a context covering the entire FY range and returns a
// per-month map { 'YYYY-MM-DD': value } so we make ONE query per data source instead of
// one query per month (12× fewer round-trips, far less DB load).
//
// Context shape:
//   {
//     profileId: uuid string of the employee being measured
//     profileName: their display name (used for account_owner matches)
//     fyStart: ISO date string — first month_start of the FY
//     fyEnd:   ISO date string — exclusive upper bound (first month_start of next FY)
//     monthRanges: [{ key: 'YYYY-MM-DD', start: Date, end: Date }] — defines bucket bounds
//     heroByMonth: { 'YYYY-MM-DD': [{brand, category}...] } — hero brand/category pairs per month
//     monthlyTarget (only for derived ones): numeric
//   }
//
// To add a new auto KPI for any team:
//   1. Add a bulk fetcher below keyed by a stable string
//   2. Insert a row in kpi_definitions with auto_key = that string
//
// Derived KPIs do not query — they compute from the merged month values.

import { sb } from './supabase'

// ── helper: bucket a date into the matching month range key ──
function bucketKey(dt, monthRanges) {
  for (let i = 0; i < monthRanges.length; i++) {
    const r = monthRanges[i]
    if (dt >= r.start && dt < r.end) return r.key
  }
  return null
}

export const AUTO_FETCHERS = {
  sales_actual_by_owner: async ({ profileName, fyStart, fyEnd, monthRanges }) => {
    if (!profileName) return {}
    const { data } = await sb.from('orders')
      .select('created_at, order_items(total_price)')
      .eq('account_owner', profileName).neq('status', 'cancelled').eq('is_test', false)
      .gte('created_at', fyStart).lt('created_at', fyEnd)
    const result = {}
    ;(data || []).forEach(o => {
      const k = bucketKey(new Date(o.created_at), monthRanges)
      if (!k) return
      const v = (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0)
      result[k] = (result[k] || 0) + v
    })
    return result
  },

  new_customers_by_owner: async ({ profileName, fyStart, fyEnd, monthRanges }) => {
    if (!profileName) return {}
    const { data } = await sb.from('customers').select('created_at')
      .ilike('account_owner', profileName).eq('approval_status', 'approved')
      .gte('created_at', fyStart).lt('created_at', fyEnd)
    const result = {}
    ;(data || []).forEach(c => {
      const k = bucketKey(new Date(c.created_at), monthRanges)
      if (k) result[k] = (result[k] || 0) + 1
    })
    return result
  },

  field_visits_total: async ({ profileId, fyStart, fyEnd, monthRanges }) => {
    const visits = await fetchVisitsForFy(profileId, fyStart, fyEnd)
    const result = {}
    visits.forEach(v => {
      const k = bucketKey(new Date(v.visit_date), monthRanges)
      if (k) result[k] = (result[k] || 0) + 1
    })
    return result
  },

  principal_visits_only: async ({ profileId, fyStart, fyEnd, monthRanges }) => {
    const visits = await fetchVisitsForFy(profileId, fyStart, fyEnd)
    const result = {}
    visits.filter(v => v.visit_type === 'JOINT_PRINCIPAL').forEach(v => {
      const k = bucketKey(new Date(v.visit_date), monthRanges)
      if (k) result[k] = (result[k] || 0) + 1
    })
    return result
  },

  hero_products_count: async ({ profileName, fyStart, fyEnd, monthRanges, heroByMonth }) => {
    if (!profileName) return {}
    // heroByMonth shape: { 'YYYY-MM-DD': [{ brand, category, subcategory, series }, ...] }
    const allPairs = Object.values(heroByMonth || {}).flat()
    if (allPairs.length === 0) return {}

    // Resolve the FY's hero filters to a set of matching item_codes via the
    // items table. The category union is used to bound the query; brand/sub/
    // series are then matched in JS so multi-field nullability is consistent.
    const categoryUnion = Array.from(new Set(allPairs.map(p => p.category).filter(Boolean)))
    let q = sb.from('items').select('item_code, brand, category, subcategory, series')
    if (categoryUnion.length > 0) q = q.in('category', categoryUnion)
    const { data: matchingItems } = await q
    if (!matchingItems || matchingItems.length === 0) return {}

    const itemMeta = new Map()
    matchingItems.forEach(it => itemMeta.set(it.item_code, { brand: it.brand, category: it.category, subcategory: it.subcategory, series: it.series }))
    const codes = [...itemMeta.keys()]
    if (codes.length === 0) return {}

    const { data } = await sb.from('order_items')
      .select('item_code, orders!inner(id, account_owner, status, is_test, created_at)')
      .in('item_code', codes)
      .eq('orders.account_owner', profileName).neq('orders.status', 'cancelled').eq('orders.is_test', false)
      .gte('orders.created_at', fyStart).lt('orders.created_at', fyEnd)

    const matches = (pair, meta) =>
      (!pair.brand       || pair.brand       === meta.brand) &&
      (!pair.category    || pair.category    === meta.category) &&
      (!pair.subcategory || pair.subcategory === meta.subcategory) &&
      (!pair.series      || pair.series      === meta.series) &&
      (pair.brand || pair.category || pair.subcategory || pair.series)

    const distinctOrdersPerMonth = {}
    ;(data || []).forEach(r => {
      const created = new Date(r.orders?.created_at)
      const k = bucketKey(created, monthRanges)
      if (!k) return
      const heroForMonth = heroByMonth?.[k] || []
      const meta = itemMeta.get(r.item_code)
      if (!meta) return
      if (!heroForMonth.some(p => matches(p, meta))) return
      if (!distinctOrdersPerMonth[k]) distinctOrdersPerMonth[k] = new Set()
      distinctOrdersPerMonth[k].add(r.orders.id)
    })
    const result = {}
    Object.entries(distinctOrdersPerMonth).forEach(([k, set]) => { result[k] = set.size })
    return result
  },
}

// Shared visits fetch (rep_id OR ssc_team_members, dedupe by id).
// Keep the result on a tiny module-level cache so two fetchers (field_visits_total +
// principal_visits_only) share the same query when called back-to-back.
const _visitsCache = new Map()  // key: profileId+fyStart+fyEnd
async function fetchVisitsForFy(profileId, fyStart, fyEnd) {
  const cacheKey = `${profileId}|${fyStart}|${fyEnd}`
  if (_visitsCache.has(cacheKey)) return _visitsCache.get(cacheKey)
  const [a, b] = await Promise.all([
    sb.from('crm_field_visits').select('id, visit_type, visit_date').eq('rep_id', profileId).gte('visit_date', fyStart).lt('visit_date', fyEnd),
    sb.from('crm_field_visits').select('id, visit_type, visit_date').contains('ssc_team_members', [profileId]).gte('visit_date', fyStart).lt('visit_date', fyEnd),
  ])
  const m = new Map()
  ;[...(a.data || []), ...(b.data || [])].forEach(v => m.set(v.id, v))
  const arr = Array.from(m.values())
  _visitsCache.set(cacheKey, arr)
  // Auto-evict after 30s so configurator changes show up reasonably fast.
  setTimeout(() => _visitsCache.delete(cacheKey), 30000)
  return arr
}

export const DERIVED_FETCHERS = {
  collection_ratio: ({ raw }) => {
    const overdue = Number(raw.overdue_amount) || 0
    const collected = Number(raw.collection_amount) || 0
    return overdue > 0 ? collected / overdue : 0
  },
  sales_achievement: ({ raw, monthlyTarget }) => {
    const actual = Number(raw.actual_sales) || 0
    return monthlyTarget > 0 ? actual / monthlyTarget : 0
  },
}

// Used by the configurator dropdown when admin adds/edits a KPI definition.
export function listAvailableFetchers() {
  return {
    auto: Object.keys(AUTO_FETCHERS),
    derived: Object.keys(DERIVED_FETCHERS),
  }
}
