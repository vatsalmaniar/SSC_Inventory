import { sb } from './supabase'

// Who may this user pick from, in the People module?
//
// The answer comes from the DATABASE — `att_visible_employees(p_scope)` in
// sql/people_access_rules.sql — never from a filter written here. This replaces
// src/lib/attScope.js, where each page fetched the whole employees table and
// re-applied "management must not see admin" in JavaScript: six copies of one rule,
// free to drift from the RLS that actually protects the rows.
//
// SCOPES — the split is deliberate:
//   'requests'   Leave, Regularize — a manager MAY pick a direct report, because they
//                can act on the request (RLS: lr_read / reg_read allow is_my_report).
//   'attendance' Muster, Swipes, My Attendance — a manager may NOT, because they cannot
//                see attendance rows. Offering the name would show an empty page.
//
// Returns [{ id, full_name, employee_code, designation, department, branch, photo_url }]
// — `id` rather than `employee_id`, so callers keep using e.id as before.
export async function visibleEmployees(scope = 'attendance') {
  const { data, error } = await sb.rpc('att_visible_employees', { p_scope: scope })
  if (error) {
    // Fail CLOSED. An empty picker is a visible, harmless bug; falling back to
    // "fetch everyone" would silently reinstate the leak this replaced.
    console.error('visibleEmployees:', error.message)
    return { data: [], error }
  }
  return {
    data: (data || []).map(r => ({ ...r, id: r.employee_id })),
    error: null,
  }
}
