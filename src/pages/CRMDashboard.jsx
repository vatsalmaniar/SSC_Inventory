import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}

function isOverdue(opp, activities) {
  if (opp.stage !== 'FOLLOW_UP') return false
  const oppActs = activities.filter(a => a.opportunity_id === opp.id)
  if (!oppActs.length) return true
  const last = new Date(Math.max(...oppActs.map(a => new Date(a.created_at))))
  return (Date.now() - last) > 7 * 24 * 60 * 60 * 1000
}

export default function CRMDashboard() {
  const navigate = useNavigate()
  const [user, setUser]           = useState({ name: '', role: '', id: '' })
  const [loading, setLoading]     = useState(true)
  const [opps, setOpps]           = useState([])
  const [leads, setLeads]         = useState([])
  const [visits, setVisits]       = useState([])
  const [activities, setActivities] = useState([])
  const [reps, setReps]           = useState([])
  const [targets, setTargets]     = useState([])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUser({ name: profile?.name || '', role, id: session.user.id })
    await loadData(session.user.id, role)
  }

  async function loadData(uid, role) {
    setLoading(true)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const period = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')

    const isManager = ['admin','ops'].includes(role)

    const [oppsRes, leadsRes, visitsRes, actsRes, repsRes, targetsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*').not('stage','in','(WON,LOST)'),
      sb.from('crm_leads').select('*').eq('status','New'),
      sb.from('crm_field_visits').select('*').gte('visit_date', monthStart.slice(0,10)),
      sb.from('crm_activities').select('*').order('created_at', { ascending: false }),
      isManager ? sb.from('profiles').select('id,name,role').in('role',['sales','ops','admin']) : { data: [] },
      sb.from('crm_targets').select('*').eq('period', period),
    ])

    setOpps(oppsRes.data || [])
    setLeads(leadsRes.data || [])
    setVisits(visitsRes.data || [])
    setActivities(actsRes.data || [])
    setReps(repsRes.data || [])
    setTargets(targetsRes.data || [])
    setLoading(false)
  }

  const isManager = ['admin','ops'].includes(user.role)
  const myOpps    = isManager ? opps : opps.filter(o => o.assigned_rep_id === user.id)
  const myLeads   = isManager ? leads : leads.filter(l => l.assigned_rep_id === user.id)
  const myVisits  = isManager ? visits : visits.filter(v => v.rep_id === user.id)
  const overdueOpps = myOpps.filter(o => isOverdue(o, activities))
  const closingThisMonth = myOpps.filter(o => {
    if (!o.expected_close_date) return false
    const d = new Date(o.expected_close_date)
    const now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  })
  const pipelineValue = myOpps.reduce((s, o) => s + (o.estimated_value_inr || 0), 0)

  const now = new Date()
  const period = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
  const myVisitsTarget = targets.find(t => t.rep_id === user.id && t.target_type === 'VISITS')

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <CRMSubNav active="dashboard" />
      <div className="crm-page">
        <div className="crm-body">

          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Dashboard</div>
              <div className="crm-page-sub">{isManager ? 'Manager view — all reps' : 'My pipeline — ' + (user.name || '')}</div>
            </div>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin" />Loading...</div>
          ) : (
            <>
              {/* Summary tiles */}
              <div className="crm-summary-row">
                <div className="crm-summary-tile">
                  <div className="crm-summary-val">₹{(pipelineValue/100000).toFixed(1)}L</div>
                  <div className="crm-summary-label">Pipeline Value</div>
                  <div className="crm-summary-sub">{myOpps.length} open opportunities</div>
                </div>
                <div className="crm-summary-tile">
                  <div className="crm-summary-val">{myVisits.length}</div>
                  <div className="crm-summary-label">Visits This Month</div>
                  {myVisitsTarget && <div className="crm-summary-sub">Target: {myVisitsTarget.target_value}</div>}
                </div>
                <div className="crm-summary-tile">
                  <div className="crm-summary-val">{myLeads.length}</div>
                  <div className="crm-summary-label">Open Leads</div>
                </div>
                <div className="crm-summary-tile">
                  <div className="crm-summary-val">{closingThisMonth.length}</div>
                  <div className="crm-summary-label">Closing This Month</div>
                </div>
                {overdueOpps.length > 0 && (
                  <div className="crm-summary-tile" style={{borderColor:'#fecaca',background:'#fef2f2'}}>
                    <div className="crm-summary-val" style={{color:'#dc2626'}}>{overdueOpps.length}</div>
                    <div className="crm-summary-label" style={{color:'#dc2626'}}>Overdue Follow-ups</div>
                  </div>
                )}
              </div>

              {/* Manager view: reps side by side */}
              {isManager && reps.length > 0 && (
                <div className="crm-card">
                  <div className="crm-card-header"><div className="crm-card-title">Team Performance — {period}</div></div>
                  <div className="crm-card-body" style={{padding:0}}>
                    <div className="crm-table-wrap">
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>Rep</th>
                            <th>Pipeline Value</th>
                            <th>Open Opps</th>
                            <th>Visits</th>
                            <th>Open Leads</th>
                            <th>Overdue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reps.map(rep => {
                            const repOpps   = opps.filter(o => o.assigned_rep_id === rep.id)
                            const repVal    = repOpps.reduce((s,o) => s+(o.estimated_value_inr||0), 0)
                            const repVisits = visits.filter(v => v.rep_id === rep.id)
                            const repLeads  = leads.filter(l => l.assigned_rep_id === rep.id)
                            const repOver   = repOpps.filter(o => isOverdue(o, activities))
                            const vTarget   = targets.find(t => t.rep_id === rep.id && t.target_type === 'VISITS')
                            return (
                              <tr key={rep.id} style={{cursor:'default'}}>
                                <td>
                                  <div className="crm-rep-chip">
                                    <div className="crm-rep-avatar">{rep.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
                                    {rep.name}
                                  </div>
                                </td>
                                <td style={{fontWeight:600}}>₹{(repVal/100000).toFixed(1)}L</td>
                                <td>{repOpps.length}</td>
                                <td>
                                  {repVisits.length}{vTarget ? ' / ' + vTarget.target_value : ''}
                                  {vTarget && (
                                    <div className="crm-progress-bar" style={{width:100}}>
                                      <div className={'crm-progress-fill' + (repVisits.length >= vTarget.target_value ? ' over' : '')}
                                        style={{width: Math.min(100, (repVisits.length / vTarget.target_value) * 100) + '%'}} />
                                    </div>
                                  )}
                                </td>
                                <td>{repLeads.length}</td>
                                <td>{repOver.length > 0 ? <span className="crm-overdue-badge">{repOver.length} overdue</span> : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* Overdue follow-ups */}
              {overdueOpps.length > 0 && (
                <div className="crm-card">
                  <div className="crm-card-header">
                    <div className="crm-card-title" style={{color:'#dc2626'}}>Overdue Follow-ups ({overdueOpps.length})</div>
                  </div>
                  <div className="crm-card-body" style={{padding:0}}>
                    {overdueOpps.map(o => (
                      <div key={o.id}
                        onClick={() => navigate('/crm/opportunities/' + o.id)}
                        style={{padding:'12px 18px',borderBottom:'1px solid var(--gray-50)',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}
                      >
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{o.product_notes || '—'}</div>
                          <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>Expected close: {fmt(o.expected_close_date)}</div>
                        </div>
                        <span className="crm-overdue-badge">No activity 7+ days</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Closing this month */}
              {closingThisMonth.length > 0 && (
                <div className="crm-card">
                  <div className="crm-card-header"><div className="crm-card-title">Closing This Month ({closingThisMonth.length})</div></div>
                  <div className="crm-card-body" style={{padding:0}}>
                    {closingThisMonth.map(o => (
                      <div key={o.id}
                        onClick={() => navigate('/crm/opportunities/' + o.id)}
                        style={{padding:'12px 18px',borderBottom:'1px solid var(--gray-50)',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}
                      >
                        <div>
                          <div style={{fontWeight:600,fontSize:13}}>{o.product_notes || '—'}</div>
                          <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>Close: {fmt(o.expected_close_date)}</div>
                        </div>
                        <div style={{fontWeight:700,fontSize:13}}>₹{(o.estimated_value_inr||0).toLocaleString('en-IN')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Layout>
  )
}
