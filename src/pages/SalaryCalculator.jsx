import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
// The inputs, the maths and the breakup layout all live in the shared panel —
// the Talent 360 offer screen renders the same component, so what you price an
// offer at here is what the letter and the payroll record say.
import SalaryStructurePanel, { computePanel } from '../components/SalaryStructurePanel'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import SalaryHelpDrawer from '../components/SalaryHelpDrawer'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'

export default function SalaryCalculator() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [sal, setSal] = useState({ ctc:'1854000', ratio:'50 / 20 / 10 / 20', regime:'new', pf:false, pt:'200', acc:'128' })
  const [help, setHelp] = useState(null)

  useEffect(() => { (async () => {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setAllowed(['admin','management'].includes(prof?.role))
    setLoading(false)
  })() }, [])

  const r = computePanel(sal)

  if (loading) return <Layout pageKey="talent" pageTitle="Salary Calculator"><div className="people-app"><Spinner /></div></Layout>
  if (!allowed) return <Layout pageKey="talent" pageTitle="Salary Calculator"><div className="people-app"><div className="e-empty">Salary tools are visible to Admin &amp; Management only.</div></div></Layout>

  return (
    <Layout pageKey="talent" pageTitle="Salary Calculator">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/talent')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Talent 360
            </button>
            <h1 className="ph-title">Salary Calculator</h1>
            <div className="ph-sub">Enter CTC → full breakup + net payable, on our structure. This is the same breakup an offer prints in Annexure A.</div>
          </div>
        </div>

        <TalentTabs />

        <SalaryStructurePanel value={sal} onChange={setSal} onHelp={setHelp} />
      </div>

      <SalaryHelpDrawer topic={help} data={{ calc: r.tax, regime: sal.regime, basic: r.basic, bonus: r.bonus }} onClose={()=>setHelp(null)} />
    </Layout>
  )
}
