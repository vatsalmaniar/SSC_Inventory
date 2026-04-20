import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm.css'
import '../styles/orders.css'

const LEADER_COLORS = ['#1a4dab','#14653a','#c2410c','#0e2d6a','#7a4b00','#9b1c1c']

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function colorFor(id) {
  if (!id) return '#9ba3af'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff
  const hues = [210, 160, 25, 260, 340]
  return `hsl(${hues[Math.abs(h) % hues.length]}, 55%, 45%)`
}

function periodKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export default function CRMDashboard() {
  const navigate = useNavigate()
  const [user, setUser]         = useState({ name:'', role:'', id:'' })
  const [loading, setLoading]   = useState(true)
  const [opps, setOpps]         = useState([])
  const [wonOpps, setWonOpps]   = useState([])
  const [tasks, setTasks]       = useState([])
  const [reps, setReps]         = useState([])
  const [target, setTarget]     = useState(0)
  const [targetDraft, setTargetDraft] = useState('')
  const [editingTarget, setEditingTarget] = useState(false)
  const [markingDone, setMarkingDone] = useState(null)
  const [scope, setScope]       = useState('mine') // 'mine' | 'team' | 'all'

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUser({ name: profile?.name || '', role, id: session.user.id })
    await loadData(session.user.id)
  }

  async function loadData(uid) {
    setLoading(true)
    const [oppsRes, wonRes, tasksRes, repsRes, targetRes] = await Promise.all([
      sb.from('crm_opportunities')
        .select('id,stage,estimated_value_inr,quotation_ref,quotation_value_inr,expected_close_date,assigned_rep_id,created_at,updated_at,crm_companies(company_name)')
        .not('stage','in','(WON,LOST)'),
      sb.from('crm_opportunities')
        .select('id,stage,estimated_value_inr,assigned_rep_id,updated_at,created_at,crm_companies(company_name)')
        .eq('stage','WON'),
      sb.from('crm_tasks')
        .select('*, crm_opportunities(id,crm_companies(company_name)), crm_leads(id,freetext_company,crm_companies(company_name))')
        .eq('completed', false).order('due_date', { ascending: true }),
      sb.from('profiles').select('id,name,role').in('role',['sales','admin']),
      sb.from('crm_sales_targets').select('target_inr').eq('user_id', uid).eq('period', periodKey()).maybeSingle(),
    ])
    setOpps(oppsRes.data || [])
    setWonOpps(wonRes.data || [])
    setTasks(tasksRes.data || [])
    setReps(repsRes.data || [])
    setTarget(targetRes?.data?.target_inr || 0)
    setLoading(false)
  }

  async function saveTarget() {
    const n = parseFloat(targetDraft.replace(/,/g, '')) || 0
    const period = periodKey()
    const { error } = await sb.from('crm_sales_targets').upsert({
      user_id: user.id, period, target_inr: n, updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,period' })
    if (!error) {
      setTarget(n)
      setEditingTarget(false)
    }
  }

  async function markTaskDone(e, taskId) {
    e.stopPropagation()
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

  const isManager = user.role === 'admin'

  // Scope filtering
  const scoped = useMemo(() => {
    if (!user.id) return { opps: [], won: [], tasks: [] }
    if (scope === 'all') return { opps, won: wonOpps, tasks }
    if (scope === 'team') {
      return {
        opps: opps.filter(o => o.assigned_rep_id !== user.id),
        won: wonOpps.filter(o => o.assigned_rep_id !== user.id),
        tasks: tasks.filter(t => t.assigned_rep_id !== user.id),
      }
    }
    return {
      opps: opps.filter(o => o.assigned_rep_id === user.id),
      won: wonOpps.filter(o => o.assigned_rep_id === user.id),
      tasks: tasks.filter(t => t.assigned_rep_id === user.id),
    }
  }, [scope, opps, wonOpps, tasks, user.id])

  const today      = new Date().toISOString().slice(0,10)
  const overdue    = scoped.tasks.filter(t => t.due_date && t.due_date < today)
  const dueToday   = scoped.tasks.filter(t => t.due_date === today)

  // Hero / Sales Target
  const pipelineValue = scoped.opps.reduce((s,o) => s + (o.estimated_value_inr || 0), 0)

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
  const wonThisMonth = wonOpps
    .filter(o => o.assigned_rep_id === user.id && new Date(o.updated_at || o.created_at) >= monthStart)
    .reduce((s,o) => s + (o.estimated_value_inr || 0), 0)
  const targetPct = target > 0 ? Math.min(100, Math.round((wonThisMonth / target) * 100)) : 0
  const targetTone = targetPct >= 100 ? 'green' : targetPct >= 50 ? '' : targetPct >= 20 ? 'amber' : 'red'

  // Total Opps — stacked pill bars by stage group, 7 cols for 7 days of the week (new opps created)
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay()); weekStart.setHours(0,0,0,0)
  const weekCols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i)
    const iso = d.toISOString().slice(0,10)
    const dayOpps = scoped.opps.filter(o => (o.created_at || '').slice(0,10) === iso)
    const early = dayOpps.filter(o => ['LEAD_CAPTURED','CONTACTED','QUALIFIED'].includes(o.stage)).length
    const mid   = dayOpps.filter(o => ['TECHNO_COMMERCIAL','FOLLOW_UP'].includes(o.stage)).length
    const late  = dayOpps.filter(o => ['QUOTATION_SENT','PO_RECEIVED'].includes(o.stage)).length
    const total = early + mid + late
    return { d, iso, early, mid, late, total, label: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()], isToday: iso === today }
  })
  const weekMax = Math.max(...weekCols.map(w => w.total), 1)

  // Task week view — 7 days of the current week
  const weekTasks = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i)
    const iso = d.toISOString().slice(0,10)
    return {
      d, iso,
      count: scoped.tasks.filter(t => t.due_date === iso).length,
      isToday: iso === today,
    }
  })

  // Month calendar for My Tasks
  const mStart = new Date(); mStart.setDate(1); mStart.setHours(0,0,0,0)
  const mEnd   = new Date(mStart.getFullYear(), mStart.getMonth() + 1, 0)
  const leadPad = mStart.getDay()
  const monthDays = []
  for (let i = 0; i < leadPad; i++) monthDays.push(null)
  for (let d = 1; d <= mEnd.getDate(); d++) {
    const day = new Date(mStart.getFullYear(), mStart.getMonth(), d)
    const iso = day.toISOString().slice(0,10)
    const dayTasks = scoped.tasks.filter(t => t.due_date === iso)
    const isPast = iso < today
    const isFuture = iso > today
    const isTdy = iso === today
    let kind = 'empty'
    if (dayTasks.length > 0 && isPast) kind = 'overdue'
    else if (isTdy && dayTasks.length > 0) kind = 'today'
    else if (isTdy) kind = 'today'
    else if (dayTasks.length > 0 && isFuture) kind = 'has'
    monthDays.push({ d, kind, count: dayTasks.length, iso, isTdy })
  }
  const totalDays = mEnd.getDate()
  const pastDays  = Math.min(totalDays, new Date().getDate())

  // Leaderboard
  const leaderRows = reps.map(r => ({
    id: r.id, name: r.name,
    won: wonOpps.filter(o => o.assigned_rep_id === r.id).reduce((s,o) => s + (o.estimated_value_inr || 0), 0),
    count: wonOpps.filter(o => o.assigned_rep_id === r.id).length,
  })).sort((a,b) => b.won - a.won).slice(0, 5)
  const leaderMax = Math.max(...leaderRows.map(r => r.won), 1)

  // Total Quotations (horizontal bars per top stage)
  const quotOpps = scoped.opps.filter(o => o.quotation_ref || o.stage === 'QUOTATION_SENT' || o.stage === 'PO_RECEIVED')
  const quotValue = quotOpps.reduce((s,o) => s + (o.quotation_value_inr || o.estimated_value_inr || 0), 0)
  const quotStages = [
    { label: 'Quote Sent',  stage: 'QUOTATION_SENT', color: 'var(--blue-800)' },
    { label: 'PO Received', stage: 'PO_RECEIVED',    color: 'var(--green-text)' },
    { label: 'Follow-up',   stage: 'FOLLOW_UP',      color: 'var(--amber-text)' },
  ].map(s => ({
    ...s,
    count: scoped.opps.filter(o => o.stage === s.stage).length,
    value: scoped.opps.filter(o => o.stage === s.stage).reduce((a,o) => a + (o.estimated_value_inr || 0), 0),
  }))
  const quotMax = Math.max(...quotStages.map(s => s.value), 1)

  // Suggestions
  const staleFollowUp = scoped.opps.filter(o => o.stage === 'FOLLOW_UP' && o.updated_at && (Date.now() - new Date(o.updated_at)) > 7 * 86400 * 1000).length
  const staleQuote    = scoped.opps.filter(o => o.stage === 'QUOTATION_SENT' && o.updated_at && (Date.now() - new Date(o.updated_at)) > 14 * 86400 * 1000).length
  const expiredClose  = scoped.opps.filter(o => o.expected_close_date && o.expected_close_date < today).length
  const poReceived    = scoped.opps.filter(o => o.stage === 'PO_RECEIVED').length

  const suggestions = []
  if (overdue.length > 0) suggestions.push({ icon:'clock', tone:'red', title: `${overdue.length} overdue task${overdue.length>1?'s':''}`, sub:'Review and reschedule', to: '/crm' })
  if (staleFollowUp > 0) suggestions.push({ icon:'phone', tone:'amber', title: `${staleFollowUp} stale follow-up${staleFollowUp>1?'s':''}`, sub:'No activity in 7+ days', to: '/crm/opportunities' })
  if (staleQuote > 0) suggestions.push({ icon:'doc', tone:'blue', title: `${staleQuote} quote${staleQuote>1?'s':''} aging`, sub:'Sent 14+ days ago — chase', to: '/crm/opportunities' })
  if (expiredClose > 0) suggestions.push({ icon:'calendar', tone:'amber', title: `${expiredClose} past close date`, sub:'Update or move to WON/LOST', to: '/crm/opportunities' })
  if (poReceived > 0) suggestions.push({ icon:'check', tone:'green', title: `${poReceived} PO received`, sub:'Convert to sales orders', to: '/crm/opportunities' })
  const topSugg = suggestions.slice(0, 2)

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const sortedTasks = [...overdue, ...dueToday, ...scoped.tasks.filter(t => !t.due_date || t.due_date > today)]

  return (
    <Layout pageTitle="CRM" pageKey="crm">
      <div className="crm-page">
        <div className="cdash-wrap">

          {/* Top bar */}
          <div className="cdash-topbar">
            <div>
              <div className="cdash-hello">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="cdash-date">{now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {isManager && (
                <div className="cdash-scope">
                  <select value={scope} onChange={e => setScope(e.target.value)}>
                    <option value="mine">My View</option>
                    <option value="team">My Team</option>
                    <option value="all">All</option>
                  </select>
                </div>
              )}
              <button className="cdash-cta cdash-cta-ghost" onClick={() => navigate('/crm/opportunities')}>All Pipeline</button>
              <button className="cdash-cta" onClick={() => navigate('/crm/leads/new')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Lead
              </button>
            </div>
          </div>

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/></div>
          ) : (

            <div className="cdash-grid">

              {/* HERO — brand square */}
              <div className="cdash-tile cdash-hero cdash-area-hero">
                <div className="cdash-hero-chip">SSC CRM</div>
                <div className="cdash-hero-icon">
                  <svg fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width:14, height:14 }}>
                    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2h-4v-7h-6v7H5a2 2 0 01-2-2V9z"/>
                  </svg>
                </div>
                <div className="cdash-hero-body" style={{ marginTop:'auto' }}>
                  <div className="cdash-hero-label">Open pipeline</div>
                  <div className="cdash-hero-value">{fmtCr(pipelineValue)}</div>
                  <div className="cdash-hero-sub">
                    Close more, win more.<br/>{scoped.opps.length} active opportunit{scoped.opps.length === 1 ? 'y' : 'ies'}.
                  </div>
                </div>
              </div>

              {/* TOTAL OPPORTUNITIES — wide with pill bars */}
              <div className="cdash-tile cdash-area-opps is-clickable" onClick={() => navigate('/crm/opportunities')}>
                <div className="cdash-tile-head">
                  <div>
                    <div className="cdash-tile-label">Total Opportunities</div>
                  </div>
                  <span className="cdash-pill">
                    This week
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
                  </span>
                </div>
                <div className="cdash-inline-stat">
                  <span className="cdash-inline-stat-num">{scoped.opps.length}</span>
                  <span className="cdash-inline-stat-lbl">open · {fmtCr(pipelineValue)} value</span>
                </div>
                <div className="cdash-pbar-row">
                  {weekCols.map((w, i) => (
                    <div key={i} className="cdash-pbar-col">
                      <div className="cdash-pbar-stack">
                        {w.total === 0 ? (
                          <div className="cdash-pbar placeholder" style={{ flex:1, minHeight:20 }} />
                        ) : (
                          <>
                            {w.late > 0 && <div className="cdash-pbar" style={{ background:'var(--blue-800)', flex: w.late }} />}
                            {w.mid > 0 && <div className="cdash-pbar" style={{ background:'var(--amber-text)', flex: w.mid }} />}
                            {w.early > 0 && <div className="cdash-pbar" style={{ background:'var(--green-text)', flex: w.early }} />}
                            {w.total < weekMax && <div className="cdash-pbar placeholder" style={{ flex: weekMax - w.total }} />}
                          </>
                        )}
                      </div>
                      <div className="cdash-pbar-lbl" style={{ color: w.isToday ? 'var(--blue-800)' : 'var(--gray-500)', fontWeight: w.isToday ? 700 : 500 }}>{w.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* LEADERBOARD — tall (1x2) */}
              <div className="cdash-tile cdash-area-leader">
                <div className="cdash-tile-head">
                  <div>
                    <div className="cdash-tile-label">Leaderboard</div>
                  </div>
                  <span className="cdash-pill">
                    All time
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
                  </span>
                </div>
                <div className="cdash-inline-stat">
                  <span className="cdash-inline-stat-num">{fmtCr(wonOpps.reduce((s,o)=>s+(o.estimated_value_inr||0),0))}</span>
                </div>
                <div className="cdash-inline-stat-lbl" style={{ marginTop:3 }}>closed won total</div>
                <div className="cdash-leader-list">
                  {leaderRows.length === 0 ? (
                    <div className="cdash-empty">No closed deals yet</div>
                  ) : leaderRows.map((r, i) => (
                    <div key={r.id} className="cdash-leader-row">
                      <span className="cdash-leader-rank">{i+1}</span>
                      <div className="cdash-leader-avatar" style={{ background: colorFor(r.id) }}>{initials(r.name)}</div>
                      <div className="cdash-leader-body">
                        <div className="cdash-leader-name">
                          {r.name.split(' ')[0]}{r.id === user.id && <span style={{ fontSize:9, color:'var(--blue-800)', marginLeft:4, fontWeight:700 }}>YOU</span>}
                        </div>
                        <div className="cdash-leader-bar-wrap">
                          <div className="cdash-leader-bar" style={{
                            width: ((r.won / leaderMax) * 100) + '%',
                            background: LEADER_COLORS[i % LEADER_COLORS.length],
                          }} />
                        </div>
                      </div>
                      <div>
                        <div className="cdash-leader-val">{fmtCr(r.won)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* MY TASKS — compact square (week view) */}
              <div className="cdash-tile cdash-area-tasks is-clickable" onClick={() => navigate('/crm')}>
                <div className="cdash-tile-head">
                  <div className="cdash-tile-label">My Tasks</div>
                  <span className="cdash-pill">This week</span>
                </div>
                <div className="cdash-inline-stat">
                  <span className="cdash-inline-stat-num">{scoped.tasks.length}</span>
                  <span className="cdash-inline-stat-lbl">open {overdue.length > 0 ? `· ${overdue.length} overdue` : ''}</span>
                </div>
                <div className="cdash-cal" style={{ marginTop:'auto' }}>
                  <div className="cdash-cal-labels">
                    {['S','M','T','W','T','F','S'].map((d,i) => <span key={i}>{d}</span>)}
                  </div>
                  <div className="cdash-cal-grid">
                    {weekTasks.map((w, i) => {
                      const isPast = w.iso < today
                      const kind = w.isToday ? 'today' : w.count === 0 ? 'empty' : isPast ? 'overdue' : 'has'
                      return (
                        <div key={i} className={'cdash-cal-dot ' + kind}>
                          {w.count > 0 ? w.count : w.d.getDate()}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* SALES TARGET — square with input + progress */}
              <div className="cdash-tile cdash-area-target">
                <div className="cdash-tile-head">
                  <div className="cdash-tile-label">Sales Target</div>
                  <span className="cdash-pill">
                    This month
                  </span>
                </div>
                <div className="cdash-target-input-wrap">
                  <span className="rup">₹</span>
                  {editingTarget ? (
                    <input
                      autoFocus
                      type="text"
                      value={targetDraft}
                      onChange={e => setTargetDraft(e.target.value.replace(/[^0-9]/g, ''))}
                      onBlur={saveTarget}
                      onKeyDown={e => { if (e.key === 'Enter') saveTarget(); if (e.key === 'Escape') setEditingTarget(false) }}
                      placeholder="0"
                    />
                  ) : (
                    <input
                      type="text"
                      value={target > 0 ? target.toLocaleString('en-IN') : ''}
                      placeholder="Set target"
                      onFocus={() => { setTargetDraft(String(target || '')); setEditingTarget(true) }}
                      readOnly
                    />
                  )}
                  <button className="cdash-target-plus" onClick={() => { setTargetDraft(String(target || '')); setEditingTarget(true) }} title="Edit target">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                  </button>
                </div>
                <div className="cdash-hprog">
                  <div className="cdash-hprog-bar">
                    <div className={'cdash-hprog-fill ' + targetTone} style={{ width: targetPct + '%' }} />
                  </div>
                  <div className="cdash-hprog-meta">
                    <span>{fmtCr(wonThisMonth)} closed</span>
                    <span style={{ fontWeight:700, color:'var(--gray-700)' }}>{targetPct}%</span>
                  </div>
                </div>
              </div>

              {/* TOTAL QUOTATIONS — 1×1 compact */}
              <div className="cdash-tile cdash-area-quot is-clickable" onClick={() => navigate('/crm/opportunities')}>
                <div className="cdash-tile-head">
                  <div className="cdash-tile-label">Quotations</div>
                  <span className="cdash-pill">Active</span>
                </div>
                <div className="cdash-inline-stat">
                  <span className="cdash-inline-stat-num">{quotOpps.length}</span>
                  <span className="cdash-inline-stat-lbl">{fmtCr(quotValue)}</span>
                </div>
                <div className="cdash-hrow" style={{ marginTop:'auto' }}>
                  {quotStages.map(s => (
                    <div key={s.stage} className="cdash-hrow-item" style={{ padding:'3px 0' }}>
                      <span className="cdash-hrow-lbl" style={{ width:72, fontSize:10 }}>{s.label}</span>
                      <div className="cdash-hrow-bar-wrap" style={{ height:6 }}>
                        <div className="cdash-hrow-bar" style={{ width: ((s.value / quotMax) * 100) + '%', background: s.color }} />
                      </div>
                      <span className="cdash-hrow-val" style={{ fontSize:10, minWidth:40 }}>{s.count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* SUGGESTIONS — 1×1 compact */}
              <div className="cdash-tile cdash-area-suggest">
                <div className="cdash-tile-head">
                  <div className="cdash-tile-label">Suggestions</div>
                </div>
                <div className="cdash-sugg-list">
                  {topSugg.length === 0 ? (
                    <div className="cdash-empty">Nothing to flag — great work!</div>
                  ) : topSugg.map((s, i) => (
                    <div key={i} className="cdash-sugg-item" onClick={() => navigate(s.to)}>
                      <div className={'cdash-sugg-icon ' + s.tone}>
                        {s.icon === 'clock' && <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>}
                        {s.icon === 'phone' && <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.3 1.8.6 2.6a2 2 0 01-.5 2.1L8 9.7a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.8.3 1.7.5 2.6.6a2 2 0 011.7 2z"/></svg>}
                        {s.icon === 'doc' && <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>}
                        {s.icon === 'calendar' && <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>}
                        {s.icon === 'check' && <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>}
                      </div>
                      <div className="cdash-sugg-body">
                        <div className="cdash-sugg-title">{s.title}</div>
                        <div className="cdash-sugg-sub">{s.sub}</div>
                      </div>
                      <svg className="cdash-sugg-arrow" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
