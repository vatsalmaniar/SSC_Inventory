import { sb } from './supabase'

// Employee ids whose linked login is an ADMIN — management must not see these
// in attendance rosters (admin > management > user). Returns [] for no admins.
export async function adminEmpIds() {
  const { data: admins } = await sb.from('profiles').select('id').eq('role', 'admin')
  const pids = (admins || []).map(a => a.id)
  if (!pids.length) return []
  const { data: emps } = await sb.from('employees').select('id').in('profile_id', pids)
  return (emps || []).map(e => e.id)
}
