import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = 'https://kvjihrlbntxcdadogmhn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_kgrGHkw1jDvlLIOF3cPKiw_2ucunE3P'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

// ── 7-day forced re-login ──
// Stamp written ONLY by Login.jsx after a fresh credential sign-in.
// Do NOT stamp on onAuthStateChange('SIGNED_IN') — that event also fires when
// Supabase restores a cached session (tab re-open, app boot), which would reset
// the clock without the user actually re-authenticating.
// Was 24h; widened to 7 days (2026-08-05) — the daily full re-login (password + MFA)
// was locking out field staff constantly. MFA + 90-day rotation still enforced.
export const LOGIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') {
    localStorage.removeItem('ssc_login_at')
  }
})

export function stampLoginNow() {
  localStorage.setItem('ssc_login_at', Date.now().toString())
}

export function checkSessionAge() {
  const loginAt = parseInt(localStorage.getItem('ssc_login_at') || '0', 10)
  if (loginAt && Date.now() - loginAt > LOGIN_MAX_AGE_MS) {
    localStorage.removeItem('ssc_login_at')
    sb.auth.signOut()
    return false
  }
  return true
}
