import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'

// How long the connector may stay quiet before we call it down. It polls every 2 minutes, so
// 15 covers roughly seven missed beats — past any transient blip, well short of a lost morning.
const STALE_MIN = 15

const ago = (ts) => {
  if (!ts) return 'never'
  const m = Math.floor((Date.now() - new Date(ts)) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m ago`
  return `${Math.floor(h / 24)}d ${h % 24}h ago`
}
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export default function PeopleSyncStatus() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [role, setRole] = useState('')
  const [status, setStatus] = useState(null)
  const [days, setDays] = useState([])
  const [devices, setDevices] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => { init() }, []) // eslint-disable-line
  useEffect(() => { const t = setInterval(() => load(), 60000); return () => clearInterval(t) }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(prof?.role || '')
    if (!['admin', 'management'].includes(prof?.role)) { setDenied(true); setLoading(false); return }
    await load()
    setLoading(false)
  }

  async function load() {
    try {
      const [st, up, dv] = await Promise.all([
        sb.rpc('sync_status'),
        sb.rpc('sync_uptime_daily', { p_days: 30 }),
        sb.from('sync_devices').select('*').order('name'),
      ])
      if (st.error) throw st.error
      setStatus((st.data || [])[0] || null)
      setDays(up.data || [])
      setDevices(dv.data || [])
      setErr('')
    } catch (e) { setErr(e?.message || 'Could not load sync status') }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Sync status"><div className="people-app"><Spinner /></div></Layout>
  if (denied) return <Layout pageKey="people" pageTitle="Sync status"><div className="people-app"><div className="o-empty">Sync status is for admin and management.</div></div></Layout>

  const stale = !!status?.is_stale
  const mins = Number(status?.minutes_since || 0)
  const banner = stale
    ? { bg: 'var(--st-absent, #D64545)', text: `Attendance sync is down — no contact for ${ago(status?.last_beat_at)}` }
    : { bg: 'var(--st-present, #2E9E63)', text: 'Attendance sync is operational' }

  // A device is considered reachable if the eSSL server pinged it within the last 30 minutes.
  const devLive = (d) => d.last_ping && (Date.now() - new Date(d.last_ping)) < 30 * 60000

  return (
    <Layout pageKey="people" pageTitle="Sync status">
      <div className="people-app">
        <AttendanceTabs role={role} />

        <div className="ph-head" style={{ marginBottom: 14 }}>
          <div>
            <h1 className="ph-title">Attendance sync</h1>
            <div className="ph-sub">Fingerprint devices → eTimeTrackLite → this app</div>
          </div>
        </div>

        {err && <div className="o-empty" style={{ marginBottom: 14 }}>{err}</div>}

        <div style={{ background: banner.bg, color: '#fff', borderRadius: 'var(--o-radius, 14px)', padding: '18px 22px',
                      fontSize: 18, fontWeight: 600, marginBottom: 22 }}>
          {banner.text}
        </div>

        <div className="o-card" style={{ padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Connector <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(office PC)</span></div>
            <div style={{ fontWeight: 600, color: stale ? 'var(--st-absent, #D64545)' : 'var(--st-present, #2E9E63)' }}>
              {stale ? 'Down' : 'Operational'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 40, margin: '14px 0 6px' }}>
            {days.map(d => {
              const pct = Number(d.uptime_pct || 0)
              const color = pct >= 99 ? 'var(--st-present, #2E9E63)' : pct >= 50 ? 'var(--st-half, #D07E1E)' : 'var(--st-absent, #D64545)'
              return (
                <div key={d.day} title={`${fmtDay(d.day)} — ${pct}% ${d.inferred ? '(inferred from punch activity)' : ''}`}
                     style={{ flex: 1, minWidth: 3, height: '100%', borderRadius: 2, background: color,
                              opacity: d.inferred ? 0.45 : 1 }} />
              )
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
            <span>{days.length ? fmtDay(days[0].day) : ''}</span>
            <span>Last contact: <b style={{ color: 'var(--ink)' }}>{ago(status?.last_beat_at)}</b></span>
            <span>Today</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            Faded bars are inferred from punch activity — continuous monitoring began 3 Aug 2026.
            {' '}Considered down after {STALE_MIN} minutes without contact.
          </div>
        </div>

        <div className="o-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>Devices</div>
          {devices.length === 0 ? (
            <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              No device information yet. The connector reports this on its next run.
            </div>
          ) : devices.map(d => (
            <div key={d.device_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            gap: 12, padding: '10px 0', borderTop: '1px solid var(--line-2)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name || d.device_id}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {[d.location, d.serial_no].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13,
                              color: devLive(d) ? 'var(--st-present, #2E9E63)' : 'var(--st-absent, #D64545)' }}>
                  {devLive(d) ? 'Online' : 'Offline'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Last ping {ago(d.last_ping)}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 14, lineHeight: 1.6 }}>
          {Number.isFinite(mins) && stale && (
            <>Punches are still being recorded on the office PC and will arrive once the connector runs again —
              nothing is lost unless a device itself is offline. </>
          )}
          Refreshes every minute.
        </div>
      </div>
    </Layout>
  )
}
