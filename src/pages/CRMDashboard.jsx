import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm-redesign.css'

const STAGE_LABELS = {
  LEAD_CAPTURED: 'Lead Captured',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  BOM_RECEIVED: 'BOM Received',
  QUOTATION_SENT: 'Quote Sent',
  FOLLOW_UP: 'Follow Up',
  FINAL_NEGOTIATION: 'Final Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  ON_HOLD: 'On Hold',
}

const STAGE_COLORS = {
  LEAD_CAPTURED:    '#6366f1',
  CONTACTED:        '#0ea5e9',
  QUALIFIED:        '#8b5cf6',
  BOM_RECEIVED:     '#a855f7',
  QUOTATION_SENT:   '#1a4dab',
  FOLLOW_UP:        '#f59e0b',
  FINAL_NEGOTIATION:'#d97706',
  WON:              '#22c55e',
  LOST:             '#ef4444',
  ON_HOLD:          '#94a3b8',
}

const FUNNEL_STAGES = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','BOM_RECEIVED','QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION']

function fmtINR(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function repColor(id) {
  if (!id) return '#94A3B8'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff
  const palette = ['#1E54B7','#0F766E','#B45309','#0E7490','#15803d','#5B21B6','#0369A1','#B91C1C']
  return palette[Math.abs(h) % palette.length]
}

export default function CRMDashboard() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [loading, setLoading] = useState(true)
  const [opens, setOpens]     = useState([])
  const [closed, setClosed]   = useState([])      // WON + LOST
  const [tasks, setTasks]     = useState([])
  const [reps, setReps]       = useState([])
  const [activities, setActivities] = useState([])
  const [scope, setScope]     = useState('mine')
  const [trendMode, setTrendMode] = useState('count') // count | value

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })

    const since = new Date(); since.setMonth(since.getMonth() - 12); since.setDate(1)
    const sinceISO = since.toISOString().slice(0,10)

    const [openRes, closedRes, tasksRes, repsRes, actRes] = await Promise.all([
      sb.from('crm_opportunities')
        .select('id,opportunity_name,stage,estimated_value_inr,quotation_value_inr,quotation_ref,expected_close_date,assigned_rep_id,created_at,updated_at,crm_companies(company_name)')
        .not('stage','in','(WON,LOST)'),
      sb.from('crm_opportunities')
        .select('id,stage,estimated_value_inr,assigned_rep_id,updated_at,created_at')
        .in('stage', ['WON','LOST'])
        .gte('updated_at', sinceISO),
      sb.from('crm_tasks')
        .select('id,title,due_date,completed,opportunity_id,lead_id,assigned_rep_id, crm_opportunities(crm_companies(company_name)), crm_leads(freetext_company,crm_companies(company_name))')
        .eq('completed', false).order('due_date', { ascending: true }),
      sb.from('profiles').select('id,name,role').in('role',['sales','admin']),
      sb.from('crm_activities').select('id,created_at,rep_id').gte('created_at', sinceISO).order('created_at', { ascending: false }),
    ])
    setOpens(openRes.data || [])
    setClosed(closedRes.data || [])
    setTasks(tasksRes.data || [])
    setReps(repsRes.data || [])
    setActivities(actRes.data || [])
    setLoading(false)
  }

  async function markTaskDone(e, taskId) {
    e.stopPropagation()
    await sb.from('crm_tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  const isManager = ['admin','management'].includes(user.role)

  const scoped = useMemo(() => {
    if (!user.id) return { opens: [], closed: [], tasks: [], activities: [] }
    const filt = (arr, k) => {
      if (scope === 'all') return arr
      if (scope === 'team') return arr.filter(o => o[k] !== user.id)
      return arr.filter(o => o[k] === user.id)
    }
    return {
      opens: filt(opens, 'assigned_rep_id'),
      closed: filt(closed, 'assigned_rep_id'),
      tasks: filt(tasks, 'assigned_rep_id'),
      activities: filt(activities, 'rep_id'),
    }
  }, [scope, opens, closed, tasks, activities, user.id])

  const today = new Date().toISOString().slice(0,10)
  const overdueTasks = scoped.tasks.filter(t => t.due_date && t.due_date < today)
  const dueToday = scoped.tasks.filter(t => t.due_date === today)

  const won = scoped.closed.filter(o => o.stage === 'WON')
  const lost = scoped.closed.filter(o => o.stage === 'LOST')
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
  const wonMTD = won.filter(o => new Date(o.updated_at || o.created_at) >= monthStart)
  const wonMTDValue = wonMTD.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)
  const winRate = won.length + lost.length > 0 ? Math.round(won.length / (won.length + lost.length) * 100) : 0
  const pipelineValue = scoped.opens.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)

  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7); sevenDaysAgo.setHours(0,0,0,0)
  const newLeads7d = scoped.opens.filter(o => o.stage === 'LEAD_CAPTURED' && new Date(o.created_at) >= sevenDaysAgo)
  const newLeads7dValue = newLeads7d.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)
  const quotePending = scoped.opens.filter(o => ['QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION'].includes(o.stage))

  // Funnel — counts/values by stage
  const funnel = FUNNEL_STAGES.map(s => ({
    id: s,
    label: STAGE_LABELS[s],
    color: STAGE_COLORS[s],
    count: scoped.opens.filter(o => o.stage === s).length,
    value: scoped.opens.filter(o => o.stage === s).reduce((a,o) => a + (o.estimated_value_inr || 0), 0),
  })).filter(s => s.count > 0)

  // Monthly trend — last 12 months
  const monthsArr = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(1)
    monthsArr.push({ key: d.toISOString().slice(0,7), label: d.toLocaleDateString('en-US', { month:'short' }) })
  }
  const trendData = monthsArr.map(m => {
    const created = [...scoped.opens, ...scoped.closed].filter(o => (o.created_at || '').slice(0,7) === m.key)
    const w = scoped.closed.filter(o => o.stage === 'WON' && (o.updated_at || '').slice(0,7) === m.key)
    const l = scoped.closed.filter(o => o.stage === 'LOST' && (o.updated_at || '').slice(0,7) === m.key)
    return {
      month: m.label,
      created: trendMode === 'count' ? created.length : created.reduce((s,o) => s+(o.estimated_value_inr||0), 0),
      won:     trendMode === 'count' ? w.length       : w.reduce((s,o) => s+(o.estimated_value_inr||0), 0),
      lost:    trendMode === 'count' ? l.length       : l.reduce((s,o) => s+(o.estimated_value_inr||0), 0),
    }
  })

  // Leaderboard
  const leader = reps.map(r => {
    const wins = scoped.closed.filter(o => o.stage === 'WON' && o.assigned_rep_id === r.id)
    return { id: r.id, name: r.name, won: wins.reduce((s,o)=>s+(o.estimated_value_inr||0),0), count: wins.length, color: repColor(r.id) }
  }).sort((a,b) => b.won - a.won).slice(0,6)
  const leaderMax = Math.max(...leader.map(r => r.won), 1)
  const wonTotal = scoped.closed.filter(o => o.stage === 'WON').reduce((s,o) => s + (o.estimated_value_inr || 0), 0)

  // Activity — last 7 days
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const weekActivity = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
    const iso = d.toISOString().slice(0,10)
    const cnt = scoped.activities.filter(a => (a.created_at || '').slice(0,10) === iso).length
    weekActivity.push({ day: days[d.getDay()], value: cnt, today: iso === today })
  }
  const maxAct = Math.max(...weekActivity.map(a => a.value), 1)
  const totalAct = weekActivity.reduce((a,b) => a+b.value, 0)

  // Tasks ranked by priority (overdue → due today → upcoming)
  const tasksRanked = [...overdueTasks, ...dueToday, ...scoped.tasks.filter(t => !t.due_date || t.due_date > today)].slice(0, 6)

  function taskCompany(t) {
    if (t.crm_opportunities) return t.crm_opportunities.crm_companies?.company_name || '—'
    if (t.crm_leads) return t.crm_leads.crm_companies?.company_name || t.crm_leads.freetext_company || '—'
    return '—'
  }
  function taskLink(t) {
    if (t.opportunity_id) return '/crm/opportunities/' + t.opportunity_id
    if (t.lead_id) return '/crm/leads/' + t.lead_id
    return '/crm'
  }
  function taskPriority(t) {
    if (!t.due_date) return 'low'
    if (t.due_date < today) return 'high'
    if (t.due_date === today) return 'med'
    return 'low'
  }
  function taskDue(t) {
    if (!t.due_date) return '—'
    const d = new Date(t.due_date)
    const diff = Math.round((d - new Date(today)) / 86400000)
    if (diff < 0) return `${-diff}d overdue`
    if (diff === 0) return 'Today'
    if (diff === 1) return 'Tomorrow'
    return `${diff}d`
  }

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">{new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} · {scoped.opens.length} open opportunities · {fmtINR(pipelineValue)} pipeline</div>
          </div>
          <div className="page-meta">
            {isManager && (
              <select className="filt-select" value={scope} onChange={e => setScope(e.target.value)} style={{ minWidth: 100 }}>
                <option value="mine">My View</option>
                <option value="team">My Team</option>
                <option value="all">All</option>
              </select>
            )}
            <button className="btn-ghost" onClick={() => navigate('/crm/opportunities')}>All Pipeline</button>
            <button className="btn-primary" onClick={() => navigate('/crm/leads/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Lead
            </button>
          </div>
        </div>

        {loading ? (
          <div className="crm-loading">Loading dashboard…</div>
        ) : (
          <>
            {/* KPI row */}
            <div className="kpi-row">
              <KpiTile variant="hero" tone="deep" label="Open Pipeline" value={fmtINR(pipelineValue)} sub={`${scoped.opens.length} active deals`} chart="line"/>
              <KpiTile variant="hero" tone="forest" label="Closed Won · MTD" value={fmtINR(wonMTDValue)} sub={`${wonMTD.length} deals · ${winRate}% win rate`} chart="bars"/>
              <KpiTile variant="hero" tone="teal" label="New Leads · 7d" value={newLeads7d.length} sub={fmtINR(newLeads7dValue) + ' potential'} chart="bars"/>
              <KpiTile label="Overdue Tasks" value={overdueTasks.length} sub={`${dueToday.length} due today`} accent={overdueTasks.length > 0 ? 'bad' : null} badge={overdueTasks.length > 0 ? 'Action needed' : null}/>
              <KpiTile label="Quotes Pending" value={quotePending.length} sub={fmtINR(quotePending.reduce((s,o)=>s+(o.estimated_value_inr||0),0)) + ' awaiting'}/>
            </div>

            {/* Analytics row */}
            <div className="dash-analytics">
              <div className="card analytics-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Performance · This Period</div>
                    <div className="card-title">Win Rate</div>
                  </div>
                  <span className="trend-pill mono">{won.length + lost.length} closed</span>
                </div>
                <WinRateGauge won={won.length} lost={lost.length}/>
                <div className="gauge-foot">
                  <div className="gf-stat">
                    <div className="gf-label mono">AVG WON DEAL</div>
                    <div className="gf-val">{fmtINR(won.length ? wonTotal / won.length : 0)}</div>
                  </div>
                  <div className="gf-stat">
                    <div className="gf-label mono">PIPELINE</div>
                    <div className="gf-val">{fmtINR(pipelineValue)}</div>
                  </div>
                </div>
              </div>

              <div className="card analytics-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Pipeline · Open Stages</div>
                    <div className="card-title">Funnel</div>
                  </div>
                  <span className="trend-pill mono">{scoped.opens.length} open</span>
                </div>
                <ConversionFunnel stages={funnel}/>
              </div>

              <div className="card analytics-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Distribution · By Value</div>
                    <div className="card-title">Pipeline Mix</div>
                  </div>
                  <span className="trend-pill mono">{fmtINR(pipelineValue)}</span>
                </div>
                <StageDonut stages={funnel} total={pipelineValue}/>
              </div>
            </div>

            {/* Monthly trend full width */}
            <div className="card trend-card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">Last 12 months · Monthly</div>
                  <div className="card-title">Pipeline Movement</div>
                </div>
                <div className="trend-controls">
                  <button className={`seg-btn ${trendMode === 'count' ? 'active' : ''}`} onClick={() => setTrendMode('count')}>Count</button>
                  <button className={`seg-btn ${trendMode === 'value' ? 'active' : ''}`} onClick={() => setTrendMode('value')}>Value</button>
                </div>
              </div>
              <MonthlyTrend data={trendData} mode={trendMode}/>
            </div>

            {/* Leaderboard full width */}
            <div className="dash-row-2 single">
              <div className="card lb-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Last 12 months · Closed Won</div>
                    <div className="card-title">Leaderboard</div>
                  </div>
                </div>
                <div className="lb-list">
                  <div className="lb-total">
                    <div className="lb-total-label mono">CLOSED WON TOTAL</div>
                    <div className="lb-total-val">{fmtINR(wonTotal)}</div>
                  </div>
                  {leader.length === 0 ? (
                    <div className="crm-empty">No closed deals yet</div>
                  ) : leader.map((r, i) => (
                    <div key={r.id} className="lb-row">
                      <div className="lb-rank mono">{i+1}</div>
                      <div className="lb-avatar" style={{ background: r.color }}>{initials(r.name)}</div>
                      <div className="lb-info">
                        <div className="lb-name">{r.name?.split(' ')[0]}{r.id === user.id && <span style={{ fontSize: 9, color: 'var(--ssc-blue)', marginLeft: 4, fontWeight: 700 }}>YOU</span>}</div>
                        <div className="lb-bar-wrap">
                          <div className="lb-bar" style={{ width: `${(r.won/leaderMax)*100}%`, background: r.color }}/>
                        </div>
                      </div>
                      <div className="lb-val mono">{fmtINR(r.won)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tasks + Activity + Quotes */}
            <div className="dash-row-3">
              <div className="card tasks-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">My Focus · Today</div>
                    <div className="card-title">Tasks & Follow-ups</div>
                  </div>
                  <span className="task-count mono">{scoped.tasks.length} open</span>
                </div>
                <div className="tasks-list">
                  {tasksRanked.length === 0 ? (
                    <div className="crm-empty">No open tasks</div>
                  ) : tasksRanked.map(t => {
                    const prio = taskPriority(t)
                    return (
                      <div key={t.id} className={`task-row prio-${prio}`} onClick={() => navigate(taskLink(t))}>
                        <div className="task-chk" onClick={e => markTaskDone(e, t.id)} title="Mark done"/>
                        <div className="task-body">
                          <div className="task-title">{t.title}</div>
                          <div className="task-meta mono">{taskCompany(t)}</div>
                        </div>
                        <div className={`task-due due-${prio}`}>{taskDue(t)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card activity-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Last 7 Days · Activity</div>
                    <div className="card-title">Daily Pipeline Movement</div>
                  </div>
                </div>
                <div className="act-chart">
                  {weekActivity.map((a, i) => (
                    <div key={i} className={`act-col ${a.today ? 'today' : ''}`}>
                      <div className="act-val mono">{a.value}</div>
                      <div className="act-bar-wrap">
                        <div className="act-bar" style={{ height: `${(a.value/maxAct)*100}%` }}/>
                      </div>
                      <div className="act-day mono">{a.day}</div>
                    </div>
                  ))}
                </div>
                <div className="act-foot">
                  <div><span className="mono">{totalAct}</span> activit{totalAct === 1 ? 'y' : 'ies'} this week</div>
                </div>
              </div>

              <div className="card quotes-card">
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Active · Quotation Pipeline</div>
                    <div className="card-title">Quotes</div>
                  </div>
                  <span className="task-count mono">{quotePending.length}</span>
                </div>
                <div className="quotes-list">
                  {['QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION','BOM_RECEIVED'].map(s => {
                    const list = scoped.opens.filter(o => o.stage === s)
                    const value = list.reduce((a,o) => a + (o.estimated_value_inr || 0), 0)
                    const max = Math.max(quotePending.length, 1)
                    return (
                      <div key={s} className="qs-row">
                        <div className="qs-left">
                          <span className="qs-dot" style={{ background: STAGE_COLORS[s] }}/>
                          <span className="qs-label">{STAGE_LABELS[s]}</span>
                        </div>
                        <div className="qs-mid">
                          <div className="qs-bar" style={{ background: STAGE_COLORS[s], width: `${Math.min(100, (list.length / max) * 100)}%` }}/>
                        </div>
                        <div className="qs-right">
                          <span className="qs-count mono">{list.length}</span>
                          <span className="qs-val mono">{fmtINR(value)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, badge }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {isHero && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">
        {sub && <div className="kt-sub mono">{sub}</div>}
        {badge && <span className="kt-badge mono">{badge}</span>}
      </div>
    </div>
  )
}

function KpiChart({ kind }) {
  if (kind === 'bars') {
    return (
      <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
        {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
          <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
        ))}
      </svg>
    )
  }
  if (kind === 'line') {
    return (
      <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
        <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
      </svg>
    )
  }
  return null
}

function WinRateGauge({ won, lost }) {
  const pct = Math.round((won / Math.max(1, won + lost)) * 100)
  const size = 140, r = size/2 - 12, c = 2 * Math.PI * r, dash = (pct/100) * c
  return (
    <div className="gauge-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0A2540"/>
            <stop offset="100%" stopColor="#1E54B7"/>
          </linearGradient>
        </defs>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E5E7EB" strokeWidth="8"/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#gaugeGrad)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${dash} ${c}`} transform={`rotate(-90 ${size/2} ${size/2})`}/>
        <text x={size/2} y={size/2 - 2} textAnchor="middle" fontSize="32" fontWeight="600" fill="#0B1B30" style={{letterSpacing: '-0.02em'}}>{pct}<tspan fontSize="16" fill="#6B7280">%</tspan></text>
        <text x={size/2} y={size/2 + 18} textAnchor="middle" fontSize="9" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">WIN RATE</text>
      </svg>
      <div className="gauge-stats">
        <div className="gs-row">
          <span className="gs-dot" style={{background: '#10B981'}}/>
          <span className="gs-label">Won</span>
          <span className="gs-val mono">{won}</span>
        </div>
        <div className="gs-row">
          <span className="gs-dot" style={{background: '#EF4444'}}/>
          <span className="gs-label">Lost</span>
          <span className="gs-val mono">{lost}</span>
        </div>
        <div className="gs-row gs-total">
          <span className="gs-label">Closed</span>
          <span className="gs-val mono">{won + lost}</span>
        </div>
      </div>
    </div>
  )
}

function ConversionFunnel({ stages }) {
  if (!stages.length) return <div className="cfunnel-wrap"><div style={{ color:'var(--c-muted-2)', fontSize:12 }}>No open deals</div></div>
  const W = 320, H = 240, padTop = 8, padBottom = 8
  const innerH = H - padTop - padBottom
  const rowH = innerH / stages.length
  const maxCount = stages[0]?.count || 1
  return (
    <div className="cfunnel-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', maxWidth: 320, height: 'auto', maxHeight: 260}}>
        {stages.map((s, i) => {
          const widthTop = (s.count/maxCount) * (W - 40)
          const next = stages[i+1]
          const widthBot = next ? (next.count/maxCount) * (W - 40) : widthTop * 0.6
          const y0 = padTop + i * rowH
          const y1 = y0 + rowH - 2
          const x0L = (W - widthTop) / 2
          const x0R = W - x0L
          const x1L = (W - widthBot) / 2
          const x1R = W - x1L
          const conv = next && s.count > 0 ? Math.round((next.count/s.count)*100) : null
          return (
            <g key={s.id}>
              <path d={`M ${x0L} ${y0} L ${x0R} ${y0} L ${x1R} ${y1} L ${x1L} ${y1} Z`} fill={s.color}/>
              <text x={W/2} y={y0 + rowH/2 + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff" style={{pointerEvents: 'none'}}>{s.label} · {s.count}</text>
              {conv !== null && (
                <text x={W - 8} y={y1 + 1} textAnchor="end" fontSize="9.5" fill="#6B7280" fontFamily="Geist Mono, monospace" letterSpacing="0.04em">{conv}% →</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MonthlyTrend({ data, mode }) {
  const W = 720, H = 200, P = { l: 36, r: 16, t: 10, b: 26 }
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b
  const max = Math.max(1, ...data.flatMap(d => [d.created, d.won, d.lost])) * 1.15
  const x = (i) => P.l + (i / Math.max(1, data.length - 1)) * innerW
  const y = (v) => P.t + innerH - (v/max) * innerH
  const line = (key) => data.map((d, i) => `${i===0?'M':'L'} ${x(i)} ${y(d[key])}`).join(' ')
  const area = (key) => `${line(key)} L ${x(data.length-1)} ${P.t + innerH} L ${x(0)} ${P.t + innerH} Z`
  const series = [
    { key: 'created', color: '#1E54B7', label: 'Created' },
    { key: 'won',     color: '#10B981', label: 'Won' },
    { key: 'lost',    color: '#94A3B8', label: 'Lost' },
  ]
  function fmtTick(v) {
    if (mode === 'count') return Math.round(v)
    if (v >= 1e7) return '₹' + (v/1e7).toFixed(1) + 'Cr'
    if (v >= 1e5) return '₹' + (v/1e5).toFixed(1) + 'L'
    return Math.round(v)
  }
  return (
    <div className="trend-wrap">
      <div className="trend-legend">
        {series.map(s => (
          <span key={s.key} className="tl-item">
            <span className="tl-dot" style={{background: s.color}}/>
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width: '100%', height: 'auto', maxHeight: 220}}>
        <defs>
          {series.map(s => (
            <linearGradient key={s.key} id={`tg-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18"/>
              <stop offset="100%" stopColor={s.color} stopOpacity="0"/>
            </linearGradient>
          ))}
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={P.l} x2={W-P.r} y1={P.t + innerH*t} y2={P.t + innerH*t} stroke="#E5E7EB" strokeDasharray={t === 1 ? '0' : '2 4'}/>
        ))}
        {[0, 0.5, 1].map(t => (
          <text key={t} x={P.l - 6} y={P.t + innerH*(1-t) + 3} textAnchor="end" fontSize="9.5" fill="#9CA3AF" fontFamily="Geist Mono, monospace">{fmtTick(max*t)}</text>
        ))}
        {series.map(s => <path key={`a-${s.key}`} d={area(s.key)} fill={`url(#tg-${s.key})`}/>)}
        {series.map(s => <path key={`l-${s.key}`} d={line(s.key)} stroke={s.color} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}
        {series.map(s => data.map((d, i) => (
          <circle key={`d-${s.key}-${i}`} cx={x(i)} cy={y(d[s.key])} r="2.5" fill="#fff" stroke={s.color} strokeWidth="1.6"/>
        )))}
        {data.map((d, i) => (
          <text key={`xl-${i}`} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill="#9CA3AF" fontFamily="Geist Mono, monospace">{d.month}</text>
        ))}
      </svg>
    </div>
  )
}

function StageDonut({ stages, total }) {
  if (!stages.length || !total) return <div className="donut-wrap"><div style={{ color:'var(--c-muted-2)', fontSize:12 }}>No pipeline value</div></div>
  const size = 130, r = size/2 - 8, inner = r - 18, cx = size/2, cy = size/2
  let angle = -Math.PI/2
  const arcs = stages.filter(s => s.value > 0).map(s => {
    const portion = s.value / total
    const next = angle + portion * 2 * Math.PI
    const large = portion > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle)
    const x1 = cx + r * Math.cos(next),  y1 = cy + r * Math.sin(next)
    const ix0 = cx + inner * Math.cos(angle), iy0 = cy + inner * Math.sin(angle)
    const ix1 = cx + inner * Math.cos(next),  iy1 = cy + inner * Math.sin(next)
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
    angle = next
    return { path, color: s.color, label: s.label, value: s.value, count: s.count, pct: Math.round(portion*100) }
  })
  return (
    <div className="donut-wrap">
      <svg width={size} height={size}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} opacity="0.92"/>)}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="600" fill="#0B1B30" style={{letterSpacing: '-0.02em'}}>{fmtINR(total)}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">PIPELINE</text>
      </svg>
      <div className="donut-legend">
        {arcs.slice(0, 5).map((a, i) => (
          <div key={i} className="dlg-row">
            <span className="dlg-dot" style={{background: a.color}}/>
            <span className="dlg-name">{a.label}</span>
            <span className="dlg-pct mono">{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
