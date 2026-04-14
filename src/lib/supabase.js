import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kvjihrlbntxcdadogmhn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_kgrGHkw1jDvlLIOF3cPKiw_2ucunE3P'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ── 24-hour forced re-login ──
// Stamp login time on sign-in, check on every page load
const LOGIN_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') {
    localStorage.setItem('ssc_login_at', Date.now().toString())
  }
  if (event === 'SIGNED_OUT') {
    localStorage.removeItem('ssc_login_at')
  }
})

export function checkSessionAge() {
  const loginAt = parseInt(localStorage.getItem('ssc_login_at') || '0', 10)
  if (loginAt && Date.now() - loginAt > LOGIN_MAX_AGE_MS) {
    localStorage.removeItem('ssc_login_at')
    sb.auth.signOut()
    return false
  }
  return true
}
