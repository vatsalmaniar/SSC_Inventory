import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import AttendanceTabs from '../components/AttendanceTabs'
import { siteFromDevice } from '../lib/deviceLabel'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import '../styles/attendance-ui.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

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
        sb.from('sync_devices').select('*').order('last_ping', { ascending: false, nullsFirst: false }),
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

  // Three states, not two. eSSL lists virtual readers ("Manual Entry (Attendance)") and
  // long-decommissioned sites alongside the live ones; showing those as red "Offline" implies
  // something is broken and buries the reader that actually went down this morning.
  const devState = (d) => {
    if (!d.last_ping) return 'unused'
    const age = Date.now() - new Date(d.last_ping)
    if (age < 30 * 60000) return 'online'                 // pinged within the poll window
    if (age > 30 * 24 * 3600 * 1000) return 'unused'      // silent for a month = not in service
    return 'offline'                                       // was recently alive, now is not
  }
  const DEV_LABEL = { online: 'Online', offline: 'Offline' }
  // eSSL's device table also lists virtual readers ("Manual Entry(Attendance)",
  // "Manual Entry(Canteen)", "Mobile") and sites long out of service. They are not
  // readers anyone can walk up to, so listing them says nothing about whether
  // attendance is working — it just buries the three that matter. Hidden entirely.
  const liveDevices = devices.filter(d => devState(d) !== 'unused')

  return (
    <Layout pageKey="people" pageTitle="Sync status">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={()=>navigate('/people')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="page-title">Attendance Sync</h1>
            <div className="page-sub">Fingerprint devices → eTimeTrackLite → this app</div>
          </div>
          <div className="page-meta">
            <div className={'meta-pill' + (stale ? '' : ' live')}>
              {!stale && <span className="meta-dot" />}{stale ? 'Down' : 'Live'}
            </div>
          </div>
        </div>

        <AttendanceTabs role={role} />

        {err && <div className="o-empty" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="sync-banner" style={{ background: banner.bg }}>{banner.text}</div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div><div className="card-eyebrow">Office PC</div><div className="card-title">Connector</div></div>
            <span className="ol-status-pill" style={{ '--stage-color': stale ? '#EF4444' : '#10B981' }}>
              <span className="ol-status-dot" />{stale ? 'Down' : 'Operational'}
            </span>
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

        <div className="card">
          <div className="card-head">
            <div><div className="card-eyebrow">Biometric readers</div><div className="card-title">Devices</div></div>
            <span className="trend-pill mono">{liveDevices.length}</span>
          </div>
          {liveDevices.length === 0 ? (
            <div style={{ fontSize: 13.5, color: 'var(--muted)' }}>
              No device information yet. The connector reports this on its next run.
            </div>
          ) : liveDevices.map(d => (
            <div key={d.device_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            gap: 12, padding: '10px 0', borderTop: '1px solid var(--line-2)' }}>
              <div style={{ minWidth: 0 }}>
                {/* Show the site people use (Kaveri / HO / Godawari), keeping the
                    device's own reported name underneath so the row is still
                    traceable to the physical unit. */}
                {/* Truncate rather than overflow: a long device string
                    ("Manual Entry(Attendance)" · location · serial) ran underneath the
                    status on the right, which is fixed-width. */}
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{siteFromDevice(d)}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={[d.name, d.location, d.serial_no].filter(Boolean).join(' · ')}>
                  {[d.name && d.name !== siteFromDevice(d) ? `“${d.name}”` : null, d.location, d.serial_no]
                    .filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {(() => { const s = devState(d)
                  const col = s === 'online' ? 'var(--st-present, #2E9E63)'
                            : s === 'offline' ? 'var(--st-absent, #D64545)' : 'var(--muted)'
                  return <div style={{ fontWeight: 600, fontSize: 13, color: col }}>{DEV_LABEL[s]}</div> })()}
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
