import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { sb } from '../lib/supabase'

// Shown on the attendance screens whenever the fingerprint connector has gone quiet.
// The 31 Jul 2026 stop went unnoticed for three days because nothing anywhere said so —
// the muster simply showed people as absent, which is indistinguishable from a real absence.
// Admin/management only: nobody else can act on it, and sync_status is RLS-scoped anyway.
export default function SyncAlert({ role }) {
  const [st, setSt] = useState(null)
  const isMgmt = ['admin', 'management'].includes(role)

  useEffect(() => {
    if (!isMgmt) return
    let alive = true
    const check = async () => {
      const { data } = await sb.rpc('sync_status')
      if (alive) setSt((data || [])[0] || null)
    }
    check()
    const t = setInterval(check, 120000)
    return () => { alive = false; clearInterval(t) }
  }, [isMgmt])

  if (!isMgmt || !st?.is_stale) return null

  const mins = Math.round(Number(st.minutes_since || 0))
  const since = mins < 60 ? `${mins} minutes`
    : mins < 1440 ? `${Math.floor(mins / 60)} hours`
    : `${Math.floor(mins / 1440)} days`

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      background: 'var(--st-absent-bg, #FCEBEB)', border: '1px solid var(--st-absent, #D64545)',
      color: 'var(--st-absent, #D64545)', borderRadius: 10, padding: '10px 14px', marginBottom: 14,
      fontSize: 13.5, fontWeight: 600,
    }}>
      <span>
        Fingerprint sync has been down for {since} — attendance shown here may be incomplete,
        and days without punches will read as absent.
      </span>
      <Link to="/people/attendance/status" style={{ color: 'inherit', textDecoration: 'underline', flexShrink: 0 }}>
        View sync status
      </Link>
    </div>
  )
}
