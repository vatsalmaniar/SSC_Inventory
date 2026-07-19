import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'
import PeopleKpiConfig from './PeopleKpiConfig'
import PeopleExpensesConfig from './PeopleExpensesConfig'
import '../styles/kpi-dashboard.css'

export default function PeopleConfig() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(params.get('tab') === 'expenses' ? 'expenses' : 'kpi')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: p } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['admin','management'].includes(p?.role)) { setDenied(true); setLoading(false); return }
    setLoading(false)
  }

  function pick(t) { setTab(t); setParams(t === 'expenses' ? { tab: 'expenses' } : {}) }

  if (denied) return (
    <Layout pageKey="people" pageTitle="Configuration">
      <div style={{ padding:'80px 32px', maxWidth:560, margin:'0 auto', textAlign:'center' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:8, color:'#0B1B30' }}>Page not found</div>
        <div style={{ fontSize:14, color:'#5B6878', marginBottom:22 }}>This page doesn't exist or you don't have access.</div>
        <button className="btn-primary" onClick={()=>navigate('/people')}>Back to People</button>
      </div>
    </Layout>
  )
  if (loading) return <Layout pageKey="people" pageTitle="Configuration"><div className="people-app"><Spinner /></div></Layout>

  const TABS = [
    { k:'kpi', l:'KRA / KPI', d:'Scoring thresholds, hero products & targets' },
    { k:'expenses', l:'Expenses', d:'Budgets, mileage limits & categories' },
  ]

  return (
    <Layout pageKey="people" pageTitle="Configuration">
      <div className="kpi-app density-comfortable accent-ssc">
        <div className="page-head">
          <div>
            <button onClick={()=>navigate('/people')} style={{ background:'none', border:'none', cursor:'pointer', color:'#5B6878', display:'inline-flex', alignItems:'center', gap:4, fontSize:13, padding:0, marginBottom:4 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="page-title">Configuration</h1>
            <div className="page-sub">{TABS.find(t=>t.k===tab)?.d}</div>
          </div>
          <div className="page-meta"><div className="meta-pill"><span className="meta-label">ACCESS</span><span className="meta-val">Admin / Management</span></div></div>
        </div>

        <div style={{ display:'inline-flex', gap:4, padding:4, background:'#fff', border:'1px solid var(--gray-200,#E4E7EC)', borderRadius:10, marginBottom:16 }}>
          {TABS.map(t => (
            <button key={t.k} onClick={()=>pick(t.k)} style={{
              border:0, background: tab===t.k ? '#1a73e8' : 'transparent', color: tab===t.k ? '#fff' : '#5B6878',
              fontWeight:600, fontSize:13, padding:'8px 18px', borderRadius:7, cursor:'pointer', fontFamily:'inherit',
            }}>{t.l}</button>
          ))}
        </div>

        <div>
          {tab === 'kpi' ? <PeopleKpiConfig embed /> : <PeopleExpensesConfig embed />}
        </div>
      </div>
    </Layout>
  )
}
