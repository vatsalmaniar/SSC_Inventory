import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import KpiConfigurator from '../components/KpiConfigurator'
import { currentFyLabel } from '../lib/kpi'
import '../styles/kpi-dashboard.css'

export default function PeopleKpiConfig() {
  const navigate = useNavigate()
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [teams, setTeams] = useState([])
  const [thresholdsByTeam, setThresholdsByTeam] = useState({})
  const fy = currentFyLabel()

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['admin','management'].includes(profile?.role)) { setAccessDenied(true); setLoading(false); return }
    await loadConfig()
    setLoading(false)
  }

  async function loadConfig() {
    const [t, th] = await Promise.all([
      sb.from('kpi_teams').select('*').eq('is_active', true).order('name'),
      sb.from('kpi_thresholds').select('*').eq('fy_label', fy),
    ])
    setTeams(t.data || [])
    const tmap = {}; (th.data || []).forEach(r => { (tmap[r.team_id] ||= {})[r.kpi_key] = r })
    setThresholdsByTeam(tmap)
  }

  if (accessDenied) return (
    <Layout pageKey="people">
      <div style={{ padding: '80px 32px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Page not found</div>
        <div style={{ fontSize: 14, color: '#5B6878', marginBottom: 24 }}>This page doesn't exist or you don't have access.</div>
        <button onClick={() => navigate('/people/kpi')} style={{ padding: '10px 18px', background: '#0A2540', color: 'white', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Back to KRA / KPI
        </button>
      </div>
    </Layout>
  )
  if (loading) return <Layout pageKey="people"><div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>Loading…</div></Layout>

  return (
    <Layout pageKey="people">
      <div className="kpi-app density-comfortable accent-ssc">
        {/* Page head */}
        <div className="page-head">
          <div>
            <button onClick={() => navigate('/people/kpi')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5B6878', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, padding: 0, marginBottom: 4 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              KRA / KPI
            </button>
            <h1 className="page-title">KPI Configurator</h1>
            <div className="page-sub">Adjust scoring thresholds, hero products, and employee targets.</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">FY</span><span className="meta-val">20{fy.split('-')[0]}–20{fy.split('-')[1]}</span></div>
            <div className="meta-pill"><span className="meta-label">Admin</span><span className="meta-val">Restricted</span></div>
          </div>
        </div>

        {/* Body — full-page card hosting the shared configurator */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 600 }}>
            <KpiConfigurator
              teams={teams}
              thresholdsByTeam={thresholdsByTeam}
              onSaved={loadConfig}
            />
          </div>
        </div>
      </div>
    </Layout>
  )
}
