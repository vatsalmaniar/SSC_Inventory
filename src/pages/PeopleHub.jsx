import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { isWeekOff } from '../lib/attendance'
import Layout from '../components/Layout'
import StatusDonut from '../components/StatusDonut'
import '../styles/orders-redesign.css'

const DEPT_COLORS = ['#1a73e8','#0E7C6B','#7C3AED','#C2255C','#C25A00','#0369a1','#475569','#0f766e','#B45309','#4f7942']
const initials = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'
const fmtJoin = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'

export default function PeopleHub() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState({ name: '', role: '' })
  const [data, setData] = useState({ emps: [], present: 0, onLeave: 0, pendLeave: 0, pendReg: 0, pendExp: 0, devices: 0 })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales' })

    const now = new Date()
    const today = now.toLocaleDateString('en-CA')
    const d0 = new Date(now); d0.setHours(0,0,0,0)
    const startISO = d0.toISOString()
    const safe = p => p.then(r => r.data || []).catch(() => [])
    const [emps, punches, leaves, pl, pr, exp, dev] = await Promise.all([
      safe(sb.from('employees').select('id,full_name,department,designation,join_date').eq('is_active', true)),
      safe(sb.from('attendance_punches').select('employee_id').gte('punch_at', startISO)),
      safe(sb.from('leave_requests').select('employee_id').eq('status','approved').lte('from_date', today).gte('to_date', today)),
      safe(sb.from('leave_requests').select('id').in('status', ['pending','mgr_approved'])),
      safe(sb.from('regularizations').select('id').in('status', ['pending','mgr_approved'])),
      safe(sb.from('expenses').select('id,status')),
      safe(sb.from('asset_assignments').select('id').is('assigned_to', null)),
    ])
    setData({
      emps,
      present: new Set(punches.map(p => p.employee_id)).size,
      onLeave: new Set(leaves.map(l => l.employee_id)).size,
      pendLeave: pl.length, pendReg: pr.length,
      pendExp: exp.filter(e => e.status && !['paid','rejected','cancelled','reimbursed'].includes(e.status)).length,
      devices: dev.length,
    })
    setLoading(false)
  }

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()
  const weekoff = isWeekOff(new Date())

  const { headcount, deptAgg, joiners, absent, presentPct } = useMemo(() => {
    const emps = data.emps
    const headcount = emps.length
    const dmap = {}
    emps.forEach(e => { const d = e.department || 'Unassigned'; dmap[d] = (dmap[d]||0)+1 })
    const deptAgg = Object.entries(dmap).map(([name, count], i) => ({ name, count, color: DEPT_COLORS[i % DEPT_COLORS.length] })).sort((a,b)=>b.count-a.count)
    const joiners = [...emps].filter(e=>e.join_date).sort((a,b)=> (b.join_date>a.join_date?1:-1)).slice(0,6)
    const absent = weekoff ? 0 : Math.max(0, headcount - data.present - data.onLeave)
    const presentPct = headcount ? Math.round((data.present / headcount) * 100) : 0
    return { headcount, deptAgg, joiners, absent, presentPct }
  }, [data, weekoff])

  const deptMax = Math.max(1, ...deptAgg.map(d=>d.count))
  const pendingApprovals = data.pendLeave + data.pendReg
  const funnel = [
    { label: 'Leave requests', count: data.pendLeave, color: '#7C3AED' },
    { label: 'Regularizations', count: data.pendReg, color: '#1a73e8' },
    { label: 'Expense claims', count: data.pendExp, color: '#C25A00' },
  ]
  const funnelMax = Math.max(1, ...funnel.map(f=>f.count))

  return (
    <Layout pageTitle="People" pageKey="people">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">{new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })} · {headcount} people · {data.present} in today{weekoff ? ' · Week-off' : ''}</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/people/team')}>Team</button>
            <button className="btn-ghost" onClick={() => navigate('/people/attendance')}>Attendance</button>
          </div>
        </div>

        {loading ? <div className="o-loading">Loading…</div> : (
          <>
            <div className="kpi-row">
              <KpiTile variant="hero" tone="deep" label="Headcount" value={headcount} sub={`${deptAgg.length} departments`} chart="bars" onClick={()=>navigate('/people/team')}/>
              <KpiTile variant="hero" tone="forest" label="Present Today" value={data.present} sub={weekoff ? 'Week-off' : `${presentPct}% of team`} chart="bars" onClick={()=>navigate('/people/attendance/muster')}/>
              <KpiTile variant="hero" tone="teal" label="On Leave Today" value={data.onLeave} sub={weekoff ? '—' : `${absent} absent`} chart="line" onClick={()=>navigate('/people/attendance/leave')}/>
            </div>

            <div className="kpi-row">
              <KpiTile label="Pending Approvals" value={pendingApprovals} sub={`${data.pendLeave} leave · ${data.pendReg} regularize`} onClick={()=>navigate('/people/attendance/leave')}/>
              <KpiTile label="Expense Claims" value={data.pendExp} sub="awaiting action" onClick={()=>navigate('/people/expenses')}/>
              <KpiTile label="Devices Assigned" value={data.devices} sub="in use" onClick={()=>navigate('/people/assets')}/>
              <KpiTile label="Directory" value={headcount} sub="view team" onClick={()=>navigate('/people/team')}/>
            </div>

            <div className="o-mid">
              <div className="rep-panel">
                <div className="rp-head">
                  <div className="rp-title">By Department</div>
                  <div className="rp-sub">{headcount} active people</div>
                </div>
                <div className="rp-list">
                  {deptAgg.length === 0 ? <div className="o-empty">No people yet</div> : deptAgg.map((d, i) => (
                    <div key={d.name} className="rp-row" onClick={() => navigate('/people/team')}>
                      <div className="rp-rank">{i+1}</div>
                      <div className="rp-avatar" style={{ background: d.color }}>{initials(d.name)}</div>
                      <div className="rp-info">
                        <div className="rp-name">{d.name}</div>
                        <div className="rp-bar"><div className="rp-fill" style={{ width: `${(d.count/deptMax)*100}%`, background: d.color }}/></div>
                      </div>
                      <div className="rp-val">{d.count}</div>
                    </div>
                  ))}
                </div>
                <div className="rp-foot">
                  <div className="rp-foot-cell"><div className="rp-foot-label">DEPARTMENTS</div><div className="rp-foot-val">{deptAgg.length}</div></div>
                  <div className="rp-foot-cell"><div className="rp-foot-label">HEADCOUNT</div><div className="rp-foot-val">{headcount}</div></div>
                </div>
              </div>

              <div className="o-anal">
                <div className="card anal-card">
                  <div className="card-head">
                    <div><div className="card-eyebrow">Attendance · Today</div><div className="card-title">Who's In</div></div>
                    <span className="trend-pill mono">{weekoff ? 'Week-off' : `${presentPct}%`}</span>
                  </div>
                  <StatusDonut
                    pct={headcount ? Math.round((data.present/headcount)*100) : 0}
                    centerLabel={weekoff ? 'WEEK-OFF' : 'PRESENT'}
                    rows={[
                      { label:'Present',  value:data.present, color:'#2E9E63' },
                      { label:'On leave', value:data.onLeave, color:'#7C5CE0' },
                    ]}
                    summary={{ label:'Absent', value: weekoff ? '—' : absent }}
                  />
                </div>

                <div className="card anal-card">
                  <div className="card-head">
                    <div><div className="card-eyebrow">Waiting on you</div><div className="card-title">Pending Actions</div></div>
                    <span className="trend-pill mono">{pendingApprovals + data.pendExp} open</span>
                  </div>
                  <div className="funnel">
                    {funnel.map(f => (
                      <div key={f.label} className="funnel-row">
                        <div className="funnel-label"><span className="funnel-dot" style={{ background: f.color }}/><span className="funnel-name">{f.label}</span></div>
                        <div className="funnel-bar-wrap"><div className="funnel-bar" style={{ width: `${(f.count/funnelMax)*100}%`, background: f.color }}/></div>
                        <div className="funnel-val">{f.count}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card anal-card full">
                  <div className="card-head">
                    <div><div className="card-eyebrow">Newest first</div><div className="card-title">Recent Joiners</div></div>
                    <span className="trend-pill mono">{joiners.length}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    {joiners.length === 0 ? <div className="o-empty">No joiners on record</div> : joiners.map(e => (
                      <div key={e.id} onClick={() => navigate('/people/team/'+e.id)}
                        style={{ display:'flex', alignItems:'center', gap:11, padding:'10px 0', borderTop:'1px solid #eef1f4', cursor:'pointer' }}>
                        <div style={{ width:32, height:32, borderRadius:8, flexShrink:0, background: DEPT_COLORS[(e.full_name||'').length % DEPT_COLORS.length], color:'#fff', display:'grid', placeItems:'center', fontSize:12, fontWeight:600 }}>{initials(e.full_name)}</div>
                        <div style={{ minWidth:0, flex:1 }}>
                          <div style={{ fontSize:13, fontWeight:600, color:'#0B1B30', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.full_name}</div>
                          <div style={{ fontSize:11, color:'#6B7280', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.designation || '—'}{e.department ? ' · '+e.department : ''}</div>
                        </div>
                        <div style={{ fontSize:11.5, color:'#6B7280', fontFamily:'Geist Mono, monospace', flexShrink:0 }}>{fmtJoin(e.join_date)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, badge, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>
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
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>)}
    </svg>
  )
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}

