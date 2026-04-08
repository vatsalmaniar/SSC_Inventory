import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'
import '../styles/orders.css'

const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  TECHNO_COMMERCIAL:'Techno-Comm', FOLLOW_UP:'Follow Up', QUOTATION_SENT:'Quote Sent',
  PO_RECEIVED:'PO Received',
}
const STAGE_ORDER = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','TECHNO_COMMERCIAL','FOLLOW_UP','QUOTATION_SENT','PO_RECEIVED']

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()]
}
function fmtINR(v) {
  if (!v) return '₹0'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function buildMonthlyOpps(opps) {
  const now = new Date()
  const months = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()],
      year: d.getFullYear(), month: d.getMonth(), count: 0, value: 0,
    })
  }
  opps.forEach(o => {
    const d = new Date(o.created_at)
    const slot = months.find(m => m.year === d.getFullYear() && m.month === d.getMonth())
    if (slot) { slot.count++; slot.value += (o.estimated_value_inr || 0) }
  })
  return months
}

function BubbleChart({ data }) {
  const MAX_DOTS = 8
  const R        = 5
  const GAP      = 4
  const SLOT     = R * 2 + GAP
  const COL_GAP  = 32
  const CHART_H  = MAX_DOTS * SLOT
  const LABEL_H  = 16
  const SVG_H    = CHART_H + LABEL_H
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const COL_W    = R * 2
  const W        = data.length * (COL_W + COL_GAP) - COL_GAP
  return (
    <svg viewBox={`0 0 ${W} ${SVG_H}`} width="100%" style={{ display:'block' }}>
      {data.map((d, i) => {
        const filled = Math.round((d.count / maxCount) * MAX_DOTS)
        const cx     = i * (COL_W + COL_GAP) + R
        const isCur  = i === data.length - 1
        const topFilledY = filled > 0 ? (MAX_DOTS - filled) * SLOT + R : CHART_H
        return (
          <g key={i}>
            {isCur && d.count > 0 && (
              <g>
                <rect x={cx - 18} y={topFilledY - SLOT - 16} width={36} height={18} rx={9} fill="white"
                  style={{ filter:'drop-shadow(0 2px 6px rgba(0,0,0,0.14))' }} />
                <text x={cx} y={topFilledY - SLOT - 4} textAnchor="middle" fontSize="7" fontWeight="600" fill="#1a4dab"
                  fontFamily="Geist, sans-serif">{d.count}</text>
              </g>
            )}
            {Array.from({ length: MAX_DOTS }).map((_, j) => {
              const cy      = j * SLOT + R
              const slotIdx = MAX_DOTS - 1 - j
              const active  = slotIdx < filled
              return <circle key={j} cx={cx} cy={cy} r={R}
                fill={active ? (isCur ? '#1a4dab' : '#c2d9f5') : '#e2e8f0'} />
            })}
            <text x={cx} y={SVG_H - 2} textAnchor="middle" fontSize="7"
              fill={isCur ? '#1a4dab' : '#94a3b8'} fontWeight={isCur ? '600' : '400'}
              fontFamily="Geist, sans-serif">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
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
    const isManager = role === 'admin'
    const [oppsRes, leadsRes, tasksRes, repsRes] = await Promise.all([
      sb.from('crm_opportunities').select('id,stage,estimated_value_inr,expected_close_date,assigned_rep_id,product_notes,created_at,crm_companies(company_name)').not('stage','in','(WON,LOST)'),
      sb.from('crm_leads').select('id,freetext_company,status,assigned_rep_id,crm_companies(company_name)').eq('status','New'),
      sb.from('crm_tasks').select('*, profiles(name), crm_opportunities(id,crm_companies(company_name)), crm_leads(id,freetext_company,crm_companies(company_name))').eq('completed', false).order('due_date', { ascending: true }),
      isManager ? sb.from('profiles').select('id,name,role').in('role',['sales','admin']) : { data: [] },
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

  const isManager  = user.role === 'admin'
  const myOpps     = isManager ? opps : opps.filter(o => o.assigned_rep_id === user.id)
  const myLeads    = isManager ? leads : leads.filter(l => l.assigned_rep_id === user.id)
  const myTasks    = isManager ? tasks : tasks.filter(t => t.assigned_rep_id === user.id)

  const today      = new Date().toISOString().slice(0,10)
  const dueToday   = myTasks.filter(t => t.due_date === today)
  const overdue    = myTasks.filter(t => t.due_date && t.due_date < today)
  const upcoming   = myTasks.filter(t => !t.due_date || t.due_date > today)

  const pipelineValue = myOpps.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)

  const stageCounts = STAGE_ORDER.map(s => ({
    key: s, label: STAGE_LABELS[s],
    count: myOpps.filter(o => o.stage === s).length,
    color: '#1a4dab',
  }))
  const stageMax = Math.max(...stageCounts.map(s => s.count), 1)

  const topCompanies = Object.values(
    myOpps.reduce((m, o) => {
      const name = o.crm_companies?.company_name || '—'
      if (!m[name]) m[name] = { name, value: 0, count: 0 }
      m[name].value += (o.estimated_value_inr || 0)
      m[name].count++
      return m
    }, {})
  ).sort((a,b) => b.value - a.value).slice(0, 6)

  const monthlyData = buildMonthlyOpps(myOpps)
  const prevMonth   = monthlyData[monthlyData.length - 2]?.count || 0
  const thisMonth   = monthlyData[monthlyData.length - 1]?.count || 0
  const momPct      = prevMonth ? Math.round(((thisMonth - prevMonth) / prevMonth) * 100) : null

  const now      = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <CRMSubNav active="dashboard" />
      <div className="dash-page">
        <div className="dash-body">

          {/* Header */}
          <div className="dash-header-row">
            <div>
              <div className="dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="dash-date">{now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</div>
            </div>
            <div style={{ display:'flex', gap:10 }}>
              <button className="new-order-btn" onClick={() => navigate('/crm/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
              </button>
              <button className="od-dash-viewall-btn" onClick={() => navigate('/crm/opportunities')}>
                All Opportunities
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/>Loading...</div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Pipeline Value */}
              <div className="dash-tile" style={{ background:'#0e2d6a' }} onClick={() => navigate('/crm/opportunities')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Pipeline Value</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{fmtCr(pipelineValue)}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">{myOpps.length} open opps</span>
                  {momPct !== null && <span className="dash-tile-badge">{momPct >= 0 ? '+' : ''}{momPct}%</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {monthlyData.slice(-6).map((m, i) => {
                      const maxV = Math.max(...monthlyData.slice(-6).map(x => x.value), 1)
                      const h = Math.max(4, Math.round((m.value / maxV) * 32))
                      return <rect key={i} x={i*50+8} y={36-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.20)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Open Opportunities */}
              <div className="dash-tile" style={{ background:'#059669' }} onClick={() => navigate('/crm/opportunities')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Open Opportunities</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{myOpps.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">active pipeline</span>
                  <span className="dash-tile-badge">{myOpps.filter(o=>o.stage==='PO_RECEIVED').length} PO received</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="60"  cy="18" r="48" fill="rgba(255,255,255,0.07)"/>
                    <circle cx="240" cy="18" r="60" fill="rgba(255,255,255,0.07)"/>
                    <circle cx="150" cy="36" r="36" fill="rgba(255,255,255,0.07)"/>
                  </svg>
                </div>
              </div>

              {/* Open Leads */}
              <div className="dash-tile" style={{ background:'#0891b2' }} onClick={() => navigate('/crm/leads')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Open Leads</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{myLeads.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">awaiting conversion</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [12,20,15,26,18,24,13,28][i]
                      return <rect key={i} x={i*38+4} y={36-h} width={28} height={h} rx={4} fill="rgba(255,255,255,0.18)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tasks Due Today */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/crm')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Due Today</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: dueToday.length ? '#b45309' : undefined }}>{dueToday.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">tasks due today</span>
                  {dueToday.length > 0 && <span className="dash-tile-badge" style={{ background:'#fef3c7', color:'#92400e' }}>Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(180,83,9,0.05)"/>
                    <circle cx="150" cy="18" r="36" fill="rgba(180,83,9,0.05)"/>
                    <circle cx="150" cy="18" r="18" fill="rgba(180,83,9,0.07)"/>
                  </svg>
                </div>
              </div>

              {/* Overdue Tasks */}
              <div className="dash-tile dash-tile-light">
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Overdue Tasks</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: overdue.length ? '#dc2626' : undefined }}>{overdue.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">need attention</span>
                  {overdue.length > 0 && <span className="dash-tile-badge" style={{ background:'#fee2e2', color:'#991b1b' }}>Overdue</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(220,38,38,0.04)"/>
                    <circle cx="150" cy="18" r="36" fill="rgba(220,38,38,0.04)"/>
                    <circle cx="150" cy="18" r="18" fill="rgba(220,38,38,0.06)"/>
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Bubble chart */}
              <div className="dash-card dash-card-chart">
                <div className="dash-card-head">
                  <div>
                    <div className="dash-card-title">Opportunity Summary</div>
                    <div className="dash-card-sub">Last 12 months · by count</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:28, fontWeight:800, color:'#0e2d6a', letterSpacing:'-1px', lineHeight:1 }}>{myOpps.length}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>open opps</div>
                  </div>
                </div>
                <div style={{ padding:'12px 16px 16px' }}>
                  <BubbleChart data={monthlyData} />
                </div>
              </div>

              {/* CRM Pipeline stages */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Pipeline by Stage</div>
                  <span className="dash-badge">{myOpps.length} total</span>
                </div>
                <div style={{ padding:'4px 0 0' }}>
                  {stageCounts.map((s, i) => {
                    const pct  = Math.round((s.count / stageMax) * 100)
                    const minW = s.count > 0 ? Math.max(pct, 6) : 0
                    return (
                      <div key={s.key} style={{ padding:'10px 18px', borderBottom: i < stageCounts.length - 1 ? '1px solid #f8fafc' : 'none', cursor:'pointer' }}
                        onClick={() => navigate('/crm/opportunities')}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                          <span style={{ fontSize:12, color: s.count > 0 ? '#334155' : '#94a3b8', fontWeight: s.count > 0 ? 600 : 400 }}>{s.label}</span>
                          <span style={{ fontSize:14, fontWeight:800, color: s.count > 0 ? '#0f172a' : '#cbd5e1', minWidth:24, textAlign:'right' }}>{s.count}</span>
                        </div>
                        <div style={{ height:6, background:'#f1f5f9', borderRadius:6 }}>
                          {s.count > 0 && <div style={{ height:'100%', width: minW + '%', background: s.color, borderRadius:6, transition:'width 0.6s ease', minWidth:8 }} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>

            {/* Bottom row */}
            <div className="dash-bottom">

              {/* Pending Tasks */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Pending Tasks</div>
                  <span className="dash-badge" style={{ background: overdue.length ? '#fee2e2' : '#f1f5f9', color: overdue.length ? '#dc2626' : '#94a3b8' }}>
                    {myTasks.length} open
                  </span>
                </div>
                {myTasks.length === 0
                  ? <div className="dash-empty">No pending tasks. All caught up!</div>
                  : [...overdue, ...dueToday, ...upcoming].slice(0, 7).map(t => {
                      const isOv  = t.due_date && t.due_date < today
                      const isTdy = t.due_date === today
                      return (
                        <div key={t.id} className="dash-list-row" style={{ background: isOv ? '#fff5f5' : isTdy ? '#fffbeb' : 'white', cursor:'default' }}>
                          <div style={{ minWidth:0, flex:1 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:'#0f172a', display:'flex', gap:6, alignItems:'center' }}>
                              {isOv && <span style={{ fontSize:9, fontWeight:700, background:'#fecaca', color:'#dc2626', borderRadius:3, padding:'1px 5px' }}>OVERDUE</span>}
                              {isTdy && <span style={{ fontSize:9, fontWeight:700, background:'#fde68a', color:'#b45309', borderRadius:3, padding:'1px 5px' }}>TODAY</span>}
                              {t.task_type}
                            </div>
                            <div className="dash-row-cust">{taskCompanyName(t)}{t.notes ? ' · ' + t.notes : ''}</div>
                          </div>
                          <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center' }}>
                            <button className="dash-icon-btn" onClick={() => navigate(taskLink(t))}>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                            </button>
                            <button onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}
                              style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:6, border:'1px solid #bbf7d0', background:'#f0fdf4', color:'#15803d', cursor:'pointer', fontFamily:'var(--font)' }}>
                              {markingDone === t.id ? '...' : '✓'}
                            </button>
                          </div>
                        </div>
                      )
                    })
                }
              </div>

              {/* Top Companies */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Top Companies</div>
                  <span className="dash-badge">by pipeline value</span>
                </div>
                {topCompanies.length === 0
                  ? <div className="dash-empty">No pipeline data yet</div>
                  : topCompanies.map((c, i) => {
                      const maxVal = topCompanies[0].value || 1
                      const pct    = Math.round((c.value / maxVal) * 100)
                      return (
                        <div key={c.name} style={{ padding:'9px 18px', borderBottom: i < topCompanies.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                            <div style={{ minWidth:0 }}>
                              <div style={{ fontSize:12, fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:140 }}>{c.name}</div>
                              <div style={{ fontSize:11, color:'#94a3b8' }}>{c.count} opp{c.count !== 1 ? 's' : ''}</div>
                            </div>
                            <div style={{ fontSize:13, fontWeight:700, color:'#0f172a', flexShrink:0, marginLeft:8 }}>{fmtCr(c.value)}</div>
                          </div>
                          <div style={{ height:4, background:'#f1f5f9', borderRadius:4 }}>
                            <div style={{ height:'100%', width: pct + '%', background:'#1a4dab', borderRadius:4, transition:'width 0.6s ease' }} />
                          </div>
                        </div>
                      )
                    })
                }
              </div>

              {/* Team Overview (manager) or upcoming tasks (sales) */}
              {isManager && reps.length > 0 ? (
                <div className="dash-card">
                  <div className="dash-card-head">
                    <div className="dash-card-title">Team Overview</div>
                    <span className="dash-badge">{reps.length} reps</span>
                  </div>
                  {reps.map((rep, i) => {
                    const repOpps  = opps.filter(o => o.assigned_rep_id === rep.id)
                    const repVal   = repOpps.reduce((s,o) => s + (o.estimated_value_inr||0), 0)
                    const repLeads = leads.filter(l => l.assigned_rep_id === rep.id)
                    const repTasks = tasks.filter(t => t.assigned_rep_id === rep.id)
                    const repOv    = repTasks.filter(t => t.due_date && t.due_date < today).length
                    return (
                      <div key={rep.id} style={{ padding:'9px 18px', borderBottom: i < reps.length - 1 ? '1px solid #f8fafc' : 'none', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ display:'flex', gap:8, alignItems:'center', minWidth:0 }}>
                          <div style={{ width:28, height:28, borderRadius:'50%', background:'#e8f2fc', color:'#1a4dab', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                            {rep.name.split(' ').map(w=>w[0]).join('').slice(0,2)}
                          </div>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:110 }}>{rep.name}</div>
                            <div style={{ fontSize:11, color:'#94a3b8' }}>{repOpps.length} opps · {repLeads.length} leads</div>
                          </div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:'#0f172a' }}>{fmtCr(repVal)}</div>
                          {repOv > 0 && <div style={{ fontSize:10, color:'#dc2626', fontWeight:600 }}>{repOv} overdue</div>}
                          {repOv === 0 && repTasks.length > 0 && <div style={{ fontSize:10, color:'#94a3b8' }}>{repTasks.length} tasks</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="dash-card">
                  <div className="dash-card-head">
                    <div className="dash-card-title">Upcoming Tasks</div>
                    <span className="dash-badge">{upcoming.length} upcoming</span>
                  </div>
                  {upcoming.length === 0
                    ? <div className="dash-empty">No upcoming tasks</div>
                    : upcoming.slice(0, 6).map(t => (
                        <div key={t.id} className="dash-list-row" onClick={() => navigate(taskLink(t))}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:600, color:'#0f172a' }}>{t.task_type}</div>
                            <div className="dash-row-cust">{taskCompanyName(t)}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0, fontSize:11, color:'#94a3b8' }}>
                            {t.due_date ? fmt(t.due_date) : 'No date'}
                          </div>
                        </div>
                      ))
                  }
                </div>
              )}

            </div>

          </>)}
        </div>
      </div>
    </Layout>
  )
}
