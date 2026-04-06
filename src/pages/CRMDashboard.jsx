import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  TECHNO_COMMERCIAL:'Techno-Comm', FOLLOW_UP:'Follow Up', QUOTATION_SENT:'Quote Sent',
  PO_RECEIVED:'PO Received',
}
const STAGE_ORDER = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','TECHNO_COMMERCIAL','FOLLOW_UP','QUOTATION_SENT','PO_RECEIVED']
const TASK_TYPES  = ['Give Quote','Send Email','Visit','Call']

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}
function fmtINR(v) {
  if (!v) return '₹0'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function isOverdue(opp) {
  return opp.stage === 'FOLLOW_UP'
}

export default function CRMDashboard() {
  const navigate = useNavigate()
  const [user, setUser]         = useState({ name:'', role:'', id:'' })
  const [loading, setLoading]   = useState(true)
  const [opps, setOpps]         = useState([])
  const [leads, setLeads]       = useState([])
  const [tasks, setTasks]       = useState([])
  const [reps, setReps]         = useState([])
  const [markingDone, setMarkingDone] = useState(null)

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
    const isManager = ['admin','ops'].includes(role)
    const [oppsRes, leadsRes, tasksRes, repsRes] = await Promise.all([
      sb.from('crm_opportunities').select('id,stage,estimated_value_inr,expected_close_date,assigned_rep_id,product_notes,crm_companies(company_name)').not('stage','in','(WON,LOST)'),
      sb.from('crm_leads').select('id,freetext_company,status,assigned_rep_id,crm_companies(company_name)').eq('status','New'),
      sb.from('crm_tasks').select('*, profiles(name), crm_opportunities(id,crm_companies(company_name)), crm_leads(id,freetext_company,crm_companies(company_name))').eq('completed', false).order('due_date', { ascending: true }),
      isManager ? sb.from('profiles').select('id,name,role').in('role',['sales','ops','admin']) : { data: [] },
    ])
    setOpps(oppsRes.data || [])
    setLeads(leadsRes.data || [])
    setTasks(tasksRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)
  }

  async function markTaskDone(taskId) {
    setMarkingDone(taskId)
    await sb.from('crm_tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setMarkingDone(null)
  }

  const isManager = ['admin','ops'].includes(user.role)
  const myOpps    = isManager ? opps : opps.filter(o => o.assigned_rep_id === user.id)
  const myLeads   = isManager ? leads : leads.filter(l => l.assigned_rep_id === user.id)
  const myTasks   = isManager ? tasks : tasks.filter(t => t.assigned_rep_id === user.id)

  const today     = new Date().toISOString().slice(0,10)
  const dueToday  = myTasks.filter(t => t.due_date === today)
  const overdue   = myTasks.filter(t => t.due_date && t.due_date < today)
  const upcoming  = myTasks.filter(t => !t.due_date || t.due_date > today)

  const pipelineValue = myOpps.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)

  const stageCounts = STAGE_ORDER.map(s => ({
    key: s, label: STAGE_LABELS[s],
    count: myOpps.filter(o => o.stage === s).length,
  }))
  const maxCount = Math.max(...stageCounts.map(s => s.count), 1)

  function taskCompanyName(task) {
    if (task.crm_opportunities) return task.crm_opportunities.crm_companies?.company_name || '—'
    if (task.crm_leads) return task.crm_leads.crm_companies?.company_name || task.crm_leads.freetext_company || '—'
    return '—'
  }
  function taskLink(task) {
    if (task.opportunity_id) return '/crm/opportunities/' + task.opportunity_id
    if (task.lead_id) return '/crm/leads/' + task.lead_id
    return '/crm'
  }

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <CRMSubNav active="dashboard" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Dashboard</div>
              <div className="crm-page-sub">{isManager ? 'Manager view — all reps' : user.name || ''}</div>
            </div>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin" />Loading...</div>
          ) : (
            <>
              {/* Tiles */}
              <div className="crm-summary-row">
                <div className="crm-summary-tile" style={{ cursor:'pointer' }} onClick={() => navigate('/crm/leads')}>
                  <div className="crm-summary-val">{myLeads.length}</div>
                  <div className="crm-summary-label">Open Leads</div>
                </div>
                <div className="crm-summary-tile" style={{ cursor:'pointer' }} onClick={() => navigate('/crm/opportunities')}>
                  <div className="crm-summary-val">{myOpps.length}</div>
                  <div className="crm-summary-label">Open Opportunities</div>
                  <div className="crm-summary-sub">{fmtINR(pipelineValue)} pipeline</div>
                </div>
                <div className="crm-summary-tile" style={{ borderColor: dueToday.length ? '#fde68a' : undefined, background: dueToday.length ? '#fffbeb' : undefined }}>
                  <div className="crm-summary-val" style={{ color: dueToday.length ? '#b45309' : undefined }}>{dueToday.length}</div>
                  <div className="crm-summary-label" style={{ color: dueToday.length ? '#b45309' : undefined }}>Tasks Due Today</div>
                </div>
                <div className="crm-summary-tile" style={{ borderColor: overdue.length ? '#fecaca' : undefined, background: overdue.length ? '#fef2f2' : undefined }}>
                  <div className="crm-summary-val" style={{ color: overdue.length ? '#dc2626' : undefined }}>{overdue.length}</div>
                  <div className="crm-summary-label" style={{ color: overdue.length ? '#dc2626' : undefined }}>Overdue Tasks</div>
                </div>
              </div>

              {/* Pipeline bar */}
              <div className="crm-card" style={{ marginBottom: 16 }}>
                <div className="crm-card-header"><div className="crm-card-title">Pipeline by Stage</div></div>
                <div className="crm-card-body">
                  <div style={{ display:'flex', gap:8, alignItems:'flex-end', height:80 }}>
                    {stageCounts.map(s => (
                      <div key={s.key} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor:'pointer' }} onClick={() => navigate('/crm/opportunities')}>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-700)' }}>{s.count}</div>
                        <div style={{ width:'100%', background:'#1a4dab', borderRadius:'4px 4px 0 0', height: Math.max(4, (s.count / maxCount) * 52) + 'px', opacity: s.count ? 1 : 0.15 }} />
                        <div style={{ fontSize:9, color:'var(--gray-400)', textAlign:'center', lineHeight:1.2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Pending Tasks */}
              {myTasks.length > 0 && (
                <div className="crm-card" style={{ marginBottom: 16 }}>
                  <div className="crm-card-header"><div className="crm-card-title">Pending Tasks ({myTasks.length})</div></div>
                  <div style={{ padding:0 }}>
                    {/* Overdue */}
                    {overdue.map(t => (
                      <div key={t.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, background:'#fff5f5' }}>
                        <div style={{ display:'flex', gap:10, alignItems:'center', flex:1, minWidth:0 }}>
                          <span style={{ fontSize:10, fontWeight:700, background:'#fecaca', color:'#dc2626', borderRadius:4, padding:'2px 7px', flexShrink:0 }}>OVERDUE</span>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontWeight:600, fontSize:13, color:'var(--gray-900)' }}>{t.task_type}</div>
                            <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{taskCompanyName(t)}{t.notes ? ' · ' + t.notes : ''} · Due {fmt(t.due_date)}</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                          <button className="crm-btn crm-btn-sm" onClick={() => navigate(taskLink(t))}>View</button>
                          <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}>Done</button>
                        </div>
                      </div>
                    ))}
                    {/* Due today */}
                    {dueToday.map(t => (
                      <div key={t.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, background:'#fffbeb' }}>
                        <div style={{ display:'flex', gap:10, alignItems:'center', flex:1, minWidth:0 }}>
                          <span style={{ fontSize:10, fontWeight:700, background:'#fde68a', color:'#b45309', borderRadius:4, padding:'2px 7px', flexShrink:0 }}>TODAY</span>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontWeight:600, fontSize:13, color:'var(--gray-900)' }}>{t.task_type}</div>
                            <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{taskCompanyName(t)}{t.notes ? ' · ' + t.notes : ''}</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                          <button className="crm-btn crm-btn-sm" onClick={() => navigate(taskLink(t))}>View</button>
                          <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}>Done</button>
                        </div>
                      </div>
                    ))}
                    {/* Upcoming */}
                    {upcoming.slice(0,5).map(t => (
                      <div key={t.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                        <div style={{ display:'flex', gap:10, alignItems:'center', flex:1, minWidth:0 }}>
                          <span style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', flexShrink:0 }}>{t.task_type}</span>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontWeight:500, fontSize:13, color:'var(--gray-800)' }}>{taskCompanyName(t)}{t.notes ? ' · ' + t.notes : ''}</div>
                            <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>Due {t.due_date ? fmt(t.due_date) : 'No date'}{t.profiles?.name ? ' · ' + t.profiles.name : ''}</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                          <button className="crm-btn crm-btn-sm" onClick={() => navigate(taskLink(t))}>View</button>
                          <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}>Done</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {myTasks.length === 0 && (
                <div className="crm-card">
                  <div className="crm-card-body">
                    <div className="crm-empty"><div className="crm-empty-sub">No pending tasks. You're all caught up!</div></div>
                  </div>
                </div>
              )}

              {/* Manager: team table */}
              {isManager && reps.length > 0 && (
                <div className="crm-card">
                  <div className="crm-card-header"><div className="crm-card-title">Team Overview</div></div>
                  <div className="crm-card-body" style={{ padding:0 }}>
                    <div className="crm-table-wrap">
                      <table className="crm-table">
                        <thead>
                          <tr>
                            <th>Rep</th>
                            <th>Pipeline Value</th>
                            <th>Open Opps</th>
                            <th>Open Leads</th>
                            <th>Pending Tasks</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reps.map(rep => {
                            const repOpps  = opps.filter(o => o.assigned_rep_id === rep.id)
                            const repVal   = repOpps.reduce((s,o) => s+(o.estimated_value_inr||0), 0)
                            const repLeads = leads.filter(l => l.assigned_rep_id === rep.id)
                            const repTasks = tasks.filter(t => t.assigned_rep_id === rep.id)
                            return (
                              <tr key={rep.id}>
                                <td>
                                  <div className="crm-rep-chip">
                                    <div className="crm-rep-avatar">{rep.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
                                    {rep.name}
                                  </div>
                                </td>
                                <td style={{ fontWeight:600 }}>{fmtINR(repVal)}</td>
                                <td>{repOpps.length}</td>
                                <td>{repLeads.length}</td>
                                <td>{repTasks.length > 0 ? <span style={{ fontWeight:600, color: repTasks.some(t=>t.due_date<today)?'#dc2626':'#b45309' }}>{repTasks.length}</span> : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
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
