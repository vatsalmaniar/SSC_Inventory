import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import { friendlyError } from '../lib/errorMsg'
import {
  currentFyLabel, fyMonths, monthLabel, monthKey,
  scoreFor, maxPointsThreshold, fmtInr, fmtInrCeil,
} from '../lib/kpi'
import { AUTO_FETCHERS, DERIVED_FETCHERS } from '../lib/kpiFetchers'
import KpiConfigurator from '../components/KpiConfigurator'
import '../styles/kpi-dashboard.css'

// Default KRA palette — used as a fallback only. Real KRAs come from kpi_kra_categories per team.
const FALLBACK_KRA_COLOR = '#64748B'

// === Color palette for employee avatars (deterministic per profile id) ===
const AVATAR_COLORS = ['#1E40AF','#0F766E','#9333EA','#DC2626','#EA580C','#0369A1','#0891B2','#BE185D','#059669','#7C2D12','#4338CA','#A21CAF']
function colorFor(seed) {
  let h = 0; for (let i = 0; i < (seed||'').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
function initialsFor(name) {
  return (name||'').split(' ').map(w => w[0]).filter(Boolean).join('').toUpperCase().slice(0, 2)
}

// === Bulk auto-pull for an employee for the entire FY ===
// Returns { 'YYYY-MM-DD': { kpi_key: value, ... }, ... } covering all 12 months in a single
// pass. Each unique auto_key runs at most one DB query for the whole FY. Drastically
// reduces DB load vs per-month fetching.
async function bulkAutoPullForFy(definitions, profileId, profileName, months, heroByMonth) {
  if (!months || months.length === 0) return {}
  const monthRanges = months.map((m, i) => ({
    key: monthKey(m),
    start: m,
    end: months[i + 1] || new Date(m.getFullYear(), m.getMonth() + 1, 1),
  }))
  const fyStart = monthKey(months[0])
  const fyEnd = monthRanges[monthRanges.length - 1].end.toISOString().slice(0, 10)
  const ctx = { profileId, profileName, fyStart, fyEnd, monthRanges, heroByMonth: heroByMonth || {} }

  const autoDefs = (definitions || []).filter(d => (d.source === 'auto' || d.source === 'auto+manual') && d.auto_key)
  // Deduplicate so we don't run the same fetcher twice (e.g. if multiple defs share an auto_key)
  const uniqueKeys = Array.from(new Set(autoDefs.map(d => d.auto_key)))
  const perKeyResults = {}
  await Promise.all(uniqueKeys.map(async k => {
    const fn = AUTO_FETCHERS[k]
    perKeyResults[k] = fn ? await fn(ctx).catch(() => ({})) : {}
  }))

  // Build the per-month result by mapping kpi_key → its auto_key result
  const result = {}
  months.forEach(m => { result[monthKey(m)] = {} })
  autoDefs.forEach(d => {
    const byMonth = perKeyResults[d.auto_key] || {}
    months.forEach(m => {
      const k = monthKey(m)
      result[k][d.kpi_key] = byMonth[k] || 0
    })
  })
  return result
}

// === Tweaks (persisted in localStorage) ===
function useTweaks() {
  const [t, setT] = useState(() => {
    try { return JSON.parse(localStorage.getItem('kpi_tweaks') || '{}') } catch { return {} }
  })
  const merged = { density: 'comfortable', accent: 'ssc', showRanks: true, ...t }
  function set(k, v) {
    const nx = { ...merged, [k]: v }
    setT(nx); localStorage.setItem('kpi_tweaks', JSON.stringify(nx))
  }
  return [merged, set]
}

const MONTHS_LABELS = ['Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar']

// === Main page ===
export default function PeopleKpi() {
  const navigate = useNavigate()

  const [user, setUser]               = useState({ id: '', name: '', role: '' })
  const [teams, setTeams]             = useState([])
  const [assignments, setAssignments] = useState([])
  const [thresholdsByTeam, setThresholdsByTeam] = useState({})  // {team_id: {kpi_key: threshold_row}}
  const [defsByTeam, setDefsByTeam]   = useState({})            // {team_id: [definition rows sorted]}
  const [krasByTeam, setKrasByTeam]   = useState({})            // {team_id: {code: {code,name,color}}}
  const [heroByMonth, setHeroByMonth] = useState({})
  const [allMonthlyData, setAllMonthlyData] = useState({})       // {assignment_id: {month_iso: {kpi_key: value}}}
  const [autoData, setAutoData]       = useState({})              // {assignment_id: {month_iso: {kpi_key: value}}}
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)

  const fy = currentFyLabel()
  const months = useMemo(() => fyMonths(fy), [fy])

  const [selectedIds, setSelectedIds]   = useState([])    // employee profile_ids
  const [filter, setFilter]             = useState('all')  // all | team_id
  const [query, setQuery]               = useState('')
  const [monthIdx, setMonthIdx]         = useState(() => {
    const now = new Date()
    const m = months.findIndex(x => x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth())
    return m >= 0 ? m : 0
  })
  const [cfgOpen, setCfgOpen]           = useState(false)
  const [cfgTeamId, setCfgTeamId]       = useState(null)
  const [tweaksOpen, setTweaksOpen]     = useState(false)
  const [tweaks, setTweak]              = useTweaks()

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ id: session.user.id, name: profile?.name || '', role: profile?.role || 'sales' })

    const [tRes, aRes, thRes, hpRes, dRes, kRes] = await Promise.all([
      sb.from('kpi_teams').select('*').eq('is_active', true).order('name'),
      sb.from('kpi_assignments').select('*, profiles(id,name,role)').eq('fy_label', fy).eq('is_active', true),
      sb.from('kpi_thresholds').select('*').eq('fy_label', fy),
      sb.from('kpi_hero_products').select('month_start, brand, category, subcategory, series'),
      sb.from('kpi_definitions').select('*').eq('is_active', true).order('sort_order'),
      sb.from('kpi_kra_categories').select('*').order('sort_order'),
    ])
    setTeams(tRes.data || [])
    setAssignments(aRes.data || [])

    const tmap = {}; (thRes.data || []).forEach(t => { (tmap[t.team_id] ||= {})[t.kpi_key] = t })
    setThresholdsByTeam(tmap)

    const hmap = {}; (hpRes.data || []).forEach(r => { (hmap[r.month_start.slice(0, 10)] ||= []).push({ brand: r.brand || null, category: r.category || null, subcategory: r.subcategory || null, series: r.series || null }) })
    setHeroByMonth(hmap)

    const dmap = {}; (dRes.data || []).forEach(d => { (dmap[d.team_id] ||= []).push(d) })
    setDefsByTeam(dmap)

    const kmap = {}; (kRes.data || []).forEach(k => { (kmap[k.team_id] ||= {})[k.code] = k })
    setKrasByTeam(kmap)

    // Default selection: own profile if assignment exists; else first visible
    const ownAssignment = (aRes.data || []).find(a => a.profile_id === session.user.id)
    if (ownAssignment) setSelectedIds([session.user.id])
    else if (aRes.data?.length) setSelectedIds([aRes.data[0].profile_id])

    // Default filter: own team if user has an assignment
    if (ownAssignment) setFilter(ownAssignment.team_id)
    setLoading(false)
  }

  // Load monthly data + auto-pull for currently selected employees
  useEffect(() => {
    if (selectedIds.length === 0) return
    loadDataForSelected()
  }, [selectedIds, heroByMonth])

  async function loadDataForSelected() {
    const newMonthly = { ...allMonthlyData }
    const newAuto = { ...autoData }
    for (const profileId of selectedIds) {
      const a = assignments.find(x => x.profile_id === profileId)
      if (!a) continue
      if (newMonthly[a.id] && newAuto[a.id]) continue  // already loaded
      const { data: monthly } = await sb.from('kpi_monthly_data').select('*').eq('assignment_id', a.id)
      const mmap = {}
      months.forEach(m => { mmap[monthKey(m)] = {} })
      ;(monthly || []).forEach(r => {
        const k = r.month_start.slice(0, 10)
        if (!mmap[k]) mmap[k] = {}
        mmap[k][r.kpi_key] = Number(r.value)
      })
      newMonthly[a.id] = mmap

      const accountOwnerName = a.profiles?.name || ''
      const defs = defsByTeam[a.team_id] || []
      newAuto[a.id] = await bulkAutoPullForFy(defs, profileId, accountOwnerName, months, heroByMonth)
    }
    setAllMonthlyData(newMonthly)
    setAutoData(newAuto)
  }

  function computeMonthForAssignment(a, mIdx) {
    const monthIso = monthKey(months[mIdx])
    const stored = allMonthlyData[a.id]?.[monthIso] || {}
    const auto = autoData[a.id]?.[monthIso] || {}
    const merged = { ...auto, ...stored }
    const monthlyTarget = Number(a.monthly_target_inr) || 0
    const defs = defsByTeam[a.team_id] || []
    // Compute derived values via DERIVED_FETCHERS registry
    const derived = {}
    defs.filter(d => d.source === 'derived' && d.derive_key).forEach(d => {
      const fn = DERIVED_FETCHERS[d.derive_key]
      if (fn) derived[d.kpi_key] = fn({ raw: merged, monthlyTarget })
    })
    const all = { ...merged, ...derived }
    const scores = {}
    let total = 0, max = 0
    defs.forEach(def => {
      if (!def.is_scored) return
      const t = thresholdsByTeam[a.team_id]?.[def.kpi_key]
      const pts = scoreFor(all[def.kpi_key], t)
      const m = t?.thresholds ? Math.max(...t.thresholds.map(x => Number(x.points)||0), 0) : 10
      scores[def.kpi_key] = { value: all[def.kpi_key] ?? 0, pts, max: m, raw: { ...merged }, threshold: t, def }
      total += pts; max += m
    })
    return { all, scores, total, max, monthlyTarget, monthIso }
  }

  function ytdAvg(a, throughIdx) {
    let sum = 0
    for (let i = 0; i <= throughIdx; i++) sum += computeMonthForAssignment(a, i).total
    return sum / (throughIdx + 1)
  }

  // === Save manual KPI value ===
  async function saveValue(assignmentId, kpiKey, value, monthIso) {
    if (saving) return
    setSaving(true)
    const num = value === '' || value == null ? 0 : Number(value)
    const { error } = await sb.from('kpi_monthly_data').upsert({
      assignment_id: assignmentId, month_start: monthIso, kpi_key: kpiKey,
      value: num, source: 'manual', updated_by: user.name, updated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,month_start,kpi_key' })
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    setAllMonthlyData(prev => ({
      ...prev,
      [assignmentId]: { ...(prev[assignmentId]||{}), [monthIso]: { ...(prev[assignmentId]?.[monthIso]||{}), [kpiKey]: num } }
    }))
    setSaving(false)
  }

  // === Filtered + ranked employee list ===
  const isAdmin = ['admin','management'].includes(user.role)
  const employeeList = useMemo(() => {
    let list = assignments
    if (!isAdmin) list = list.filter(a => a.profile_id === user.id)
    if (filter !== 'all') list = list.filter(a => a.team_id === filter)
    if (query.trim()) list = list.filter(a => (a.profiles?.name||'').toLowerCase().includes(query.toLowerCase()))
    return list.map(a => {
      const m = (allMonthlyData[a.id] && autoData[a.id]) ? computeMonthForAssignment(a, monthIdx) : { total: 0, max: 0 }
      return {
        id: a.profile_id, assignmentId: a.id, name: a.profiles?.name || '—', role: a.profiles?.role || '',
        team: a.team_id, ctc: Number(a.annual_ctc_inr) || 0, target: Number(a.annual_target_inr) || 0,
        initials: initialsFor(a.profiles?.name), color: colorFor(a.profile_id),
        score: m.total, max: m.max,
      }
    }).sort((a, b) => b.score - a.score)
  }, [assignments, filter, query, isAdmin, user.id, monthIdx, allMonthlyData, autoData])

  const selectedEmps = selectedIds.map(id => employeeList.find(e => e.id === id) || assignments.find(a => a.profile_id === id) && (() => {
    const a = assignments.find(x => x.profile_id === id)
    if (!a) return null
    return { id: a.profile_id, assignmentId: a.id, name: a.profiles?.name || '—', role: a.profiles?.role || '', team: a.team_id, ctc: Number(a.annual_ctc_inr)||0, target: Number(a.annual_target_inr)||0, initials: initialsFor(a.profiles?.name), color: colorFor(a.profile_id), score: 0, max: 0 }
  })()).filter(Boolean)

  function handleSelect(id, multi) {
    if (multi && isAdmin) setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
    else setSelectedIds([id])
  }

  if (loading) return <Layout pageKey="people"><div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>Loading…</div></Layout>

  return (
    <Layout pageKey="people">
      <div className={`kpi-app density-${tweaks.density} accent-${tweaks.accent}`}>

        {/* Page head */}
        <div className="page-head">
          <div>
            <h1 className="page-title">KRA · KPI Performance</h1>
            <div className="page-sub">Monthly performance for the Growth & Customer Success teams.</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">FY</span><span className="meta-val">20{fy.split('-')[0]}–20{fy.split('-')[1]}</span></div>
            <div className="meta-pill"><span className="meta-label">Period</span><span className="meta-val">{MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</span></div>
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
          </div>
        </div>

        {/* Body: team panel + dashboard */}
        <div className="page-body">
          <TeamPanel
            list={employeeList} teams={teams} filter={filter} setFilter={setFilter}
            query={query} setQuery={setQuery} selectedIds={selectedIds} onSelect={handleSelect}
            monthIdx={monthIdx} showRanks={tweaks.showRanks}
          />
          <Dashboard
            selectedEmps={selectedEmps} assignments={assignments} teams={teams}
            months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx}
            computeMonth={computeMonthForAssignment} ytdAvg={ytdAvg}
            thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam}
            allMonthlyData={allMonthlyData} autoData={autoData}
            isAdmin={isAdmin} saving={saving} onSave={saveValue}
            hasOwnAssignment={!!assignments.find(a => a.profile_id === user.id)}
            userName={user.name}
            onConfigOpen={(teamId) => { setCfgTeamId(teamId); setCfgOpen(true) }}
          />
        </div>

        {/* Tweaks FAB + Panel */}
        <button className="kpi-tweaks-fab" onClick={() => setTweaksOpen(o => !o)} aria-label="Tweaks">
          <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5 V3.5 M8 12.5 V14.5 M14.5 8 H12.5 M3.5 8 H1.5 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6 M12.6 12.6 L11.2 11.2 M4.8 4.8 L3.4 3.4"/></svg>
        </button>
        {tweaksOpen && (
          <div className="kpi-tweaks-panel">
            <div className="twk-title">Tweaks</div>
            <div className="twk-sect">
              <div className="twk-sect-label">Density</div>
              <div className="twk-seg">
                {['comfortable','compact'].map(d => (
                  <button key={d} className={tweaks.density === d ? 'on' : ''} onClick={() => setTweak('density', d)}>{d[0].toUpperCase()+d.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="twk-sect">
              <div className="twk-sect-label">Accent</div>
              <div className="twk-seg">
                {['ssc','teal','indigo'].map(a => (
                  <button key={a} className={tweaks.accent === a ? 'on' : ''} onClick={() => setTweak('accent', a)}>{a === 'ssc' ? 'SSC blue' : a[0].toUpperCase()+a.slice(1)}</button>
                ))}
              </div>
            </div>
            <div className="twk-sect">
              <div className="twk-toggle-row">
                <span>Show ranks</span>
                <button className={'twk-toggle' + (tweaks.showRanks ? ' on' : '')} onClick={() => setTweak('showRanks', !tweaks.showRanks)}><i/></button>
              </div>
            </div>
          </div>
        )}

        {/* Configurator drawer (uses shared KpiConfigurator component) */}
        {cfgOpen && (
          <div className="kpi-drawer-scrim" onClick={() => setCfgOpen(false)}>
            <div className="kpi-drawer" onClick={e => e.stopPropagation()}>
              <div className="drawer-head">
                <div>
                  <div className="drawer-eyebrow">Admin · FY 20{fy.split('-')[0]}–20{fy.split('-')[1]}</div>
                  <div className="drawer-title">KPI Configurator</div>
                  <div className="drawer-sub">Adjust scoring, hero products, and employee targets.</div>
                </div>
                <button className="drawer-close" onClick={() => setCfgOpen(false)} aria-label="Close">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4 L12 12 M12 4 L4 12"/></svg>
                </button>
              </div>
              <KpiConfigurator
                teams={teams}
                thresholdsByTeam={thresholdsByTeam}
                onSaved={async () => {
                  const { data: thRes } = await sb.from('kpi_thresholds').select('*').eq('fy_label', fy)
                  const tmap = {}; (thRes || []).forEach(t => { (tmap[t.team_id] ||= {})[t.kpi_key] = t })
                  setThresholdsByTeam(tmap)
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

// ── Team Panel ──
function TeamPanel({ list, teams, filter, setFilter, query, setQuery, selectedIds, onSelect, showRanks }) {
  const total = list.length
  const teamCounts = {}; list.forEach(e => { teamCounts[e.team] = (teamCounts[e.team] || 0) + 1 })
  return (
    <div className="team-panel">
      <div className="tp-head">
        <div>
          <div className="tp-title">Team</div>
          <div className="tp-sub">{total} member{total === 1 ? '' : 's'}</div>
        </div>
      </div>
      <div className="tp-filters">
        <button className={`tp-chip ${filter==='all'?'on':''}`} onClick={() => setFilter('all')}>All <span className="tp-chip-n">{total}</span></button>
        {teams.map(t => (
          <button key={t.id} className={`tp-chip ${filter===t.id?'on':''}`} onClick={() => setFilter(t.id)}>
            <span className="tp-chip-dot" style={{ background: t.name === 'Growth' ? '#7C3AED' : '#0EA5E9' }}/>
            {t.name === 'Customer Success' ? 'CS' : t.name}
          </button>
        ))}
      </div>
      <div style={{ padding: '0 16px 10px' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search…"
          style={{ width: '100%', padding: '7px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 12, outline: 'none', fontFamily: 'inherit' }} />
      </div>
      <div className="tp-list">
        {list.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 12 }}>No matching members.</div>}
        {list.map((emp, idx) => (
          <button key={emp.id} className={`tp-row ${selectedIds.includes(emp.id) ? 'selected' : ''}`}
            onClick={(e) => onSelect(emp.id, e.metaKey || e.ctrlKey || e.shiftKey)}>
            {showRanks && <div className="tp-rank">{idx + 1}</div>}
            {!showRanks && <div className="tp-rank"/>}
            <div className="tp-avatar" style={{ background: emp.color }}>{emp.initials}</div>
            <div className="tp-info">
              <div className="tp-name">{emp.name}</div>
              <div className="tp-role">{emp.role || '—'}</div>
            </div>
            <div className="tp-score">
              <div className="tp-score-num"><span className="tp-score-val">{emp.score}</span><span className="tp-score-max">/{emp.max || 80}</span></div>
              <ScoreSpark value={emp.score} max={emp.max || 80}/>
            </div>
          </button>
        ))}
      </div>
      {list.length > 0 && (
        <div className="tp-foot">
          <div className="tp-foot-cell">
            <div className="tp-foot-label">Avg score</div>
            <div className="tp-foot-val">{(list.reduce((s, e) => s + e.score, 0) / list.length).toFixed(1)}</div>
          </div>
          <div className="tp-foot-cell">
            <div className="tp-foot-label">Top performer</div>
            <div className="tp-foot-val">{list[0]?.name.split(' ')[0] || '—'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function ScoreSpark({ value, max }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  const color = pct >= 0.7 ? '#10B981' : pct >= 0.5 ? '#F59E0B' : pct >= 0.3 ? '#F97316' : '#EF4444'
  return <div className="spark-bar"><div className="spark-fill" style={{ width: `${pct*100}%`, background: color }}/></div>
}

// ── Dashboard (single + compare) ──
function Dashboard({ selectedEmps, assignments, teams, months, monthIdx, setMonthIdx, computeMonth, ytdAvg, thresholdsByTeam, defsByTeam, krasByTeam, allMonthlyData, autoData, isAdmin, saving, onSave, hasOwnAssignment, userName, onConfigOpen }) {
  if (selectedEmps.length === 0) {
    // Sales / non-admin user with no assignment of their own
    if (!isAdmin && !hasOwnAssignment) {
      return (
        <div className="dash-empty">
          <div className="dash-empty-card">
            <svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="#94A3B8" strokeWidth="1.5"><path d="M32 8 L52 18 V32 C52 44 42 54 32 56 C22 54 12 44 12 32 V18 Z"/><path d="M24 32 L30 38 L42 26"/></svg>
            <div className="dash-empty-title">{userName ? userName.split(' ')[0] + ', y' : 'Y'}our KPI hasn't been set up yet</div>
            <div className="dash-empty-sub">An admin needs to add you to a team and set your CTC + target before your scorecard can show.<br/><br/>Ask an admin or HR to open the KPI Configurator → Employees & Targets → Assign Person.</div>
          </div>
        </div>
      )
    }
    return (
      <div className="dash-empty">
        <div className="dash-empty-card">
          <svg viewBox="0 0 64 64" width="48" height="48" fill="none" stroke="#94A3B8" strokeWidth="1.5"><circle cx="22" cy="22" r="8"/><circle cx="42" cy="24" r="6"/><path d="M8 50 C8 42 14 38 22 38 C28 38 32 41 33 45 M30 50 C30 44 36 40 42 40 C50 40 56 44 56 50"/></svg>
          <div className="dash-empty-title">Select team members</div>
          <div className="dash-empty-sub">Choose people from the left to view their KRA · KPI performance.{isAdmin ? ' Hold ⌘ to compare multiple.' : ''}</div>
        </div>
      </div>
    )
  }
  if (selectedEmps.length === 1) {
    return <SingleEmployee emp={selectedEmps[0]} assignments={assignments} teams={teams} months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx} computeMonth={computeMonth} ytdAvg={ytdAvg} thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam} isAdmin={isAdmin} saving={saving} onSave={onSave} onConfigOpen={onConfigOpen} />
  }
  return <CompareView selectedEmps={selectedEmps} assignments={assignments} months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx} computeMonth={computeMonth} thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam} onConfigOpen={onConfigOpen} />
}

// ── Month scrubber ──
function MonthScrubber({ months, monthIdx, onChange }) {
  const today = new Date()
  return (
    <div className="scrubber">
      {months.map((m, i) => (
        <button key={i} className={`scrub-btn ${i === monthIdx ? 'on' : ''} ${m > today ? 'future' : ''}`} onClick={() => onChange(i)}>
          <div className="scrub-month">{MONTHS_LABELS[i]}</div>
          <div className="scrub-year">{String(m.getFullYear()).slice(2)}</div>
        </button>
      ))}
    </div>
  )
}

// ── Single employee dashboard ──
function SingleEmployee({ emp, assignments, teams, months, monthIdx, setMonthIdx, computeMonth, ytdAvg, thresholdsByTeam, defsByTeam, krasByTeam, isAdmin, saving, onSave, onConfigOpen }) {
  const a = assignments.find(x => x.profile_id === emp.id)
  if (!a) return null
  const team = teams.find(t => t.id === a.team_id)
  const teamDefs = defsByTeam?.[a.team_id] || []
  const teamKras = krasByTeam?.[a.team_id] || {}
  const teamAccent = team?.name === 'Growth' ? '#7C3AED' : team?.name === 'Customer Success' ? '#0EA5E9' : '#0EA5E9'
  const m = computeMonth(a, monthIdx)
  const ytd = ytdAvg(a, monthIdx)
  const last = monthIdx > 0 ? computeMonth(a, monthIdx - 1).total : null
  const delta = last != null ? m.total - last : null

  return (
    <div className="dash">
      <div className="hero">
        <div className="hero-left">
          <div className="hero-avatar" style={{ background: emp.color }}>{emp.initials}</div>
          <div>
            <div className="hero-name">{emp.name}</div>
            <div className="hero-meta">
              <span>{emp.role || '—'}</span>
              <span className="hero-pill" style={{ background: teamAccent + '15', color: teamAccent }}>{team?.name}</span>
              <span>FY 20{currentFyLabel().split('-')[0]}–20{currentFyLabel().split('-')[1]}</span>
            </div>
          </div>
        </div>
        <div className="hero-right">
          {isAdmin && (
            <button className="btn-ghost" onClick={() => onConfigOpen(a.team_id)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5 V3.5 M8 12.5 V14.5 M14.5 8 H12.5 M3.5 8 H1.5 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6 M12.6 12.6 L11.2 11.2 M4.8 4.8 L3.4 3.4"/></svg>
              Configure scoring
            </button>
          )}
        </div>
      </div>

      <MonthScrubber months={months} monthIdx={monthIdx} onChange={setMonthIdx} />

      <div className="row top-row">
        <div className="card hero-score">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Month score · {MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</div>
              <div className="card-title">Performance</div>
            </div>
            {delta != null && (
              <div className={`delta ${delta >= 0 ? 'up' : 'down'}`}>
                <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d={delta >= 0 ? "M3 8 L6 4 L9 8" : "M3 4 L6 8 L9 4"}/></svg>
                {Math.abs(delta)} vs {MONTHS_LABELS[monthIdx - 1]}
              </div>
            )}
          </div>
          <div className="hero-score-body">
            <RadialGauge value={m.total} max={m.max} size={188}/>
            <div className="hero-score-side">
              <div className="mini-stat"><div className="mini-stat-label">YTD avg</div><div className="mini-stat-val">{ytd.toFixed(1)}<span className="mini-stat-max">/{m.max}</span></div></div>
              <div className="mini-stat"><div className="mini-stat-label">Annual target</div><div className="mini-stat-val">{fmtInrCeil(emp.target)}</div></div>
              <div className="mini-stat"><div className="mini-stat-label">Monthly target</div><div className="mini-stat-val">{fmtInrCeil(m.monthlyTarget)}</div></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">By KRA category</div>
              <div className="card-title">Score breakdown</div>
            </div>
          </div>
          <div className="kra-split">
            <RadarChart scores={m.scores} defs={teamDefs} kras={teamKras} size={220}/>
            <KraBars scores={m.scores} defs={teamDefs} kras={teamKras}/>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">FY 20{currentFyLabel().split('-')[0]}–20{currentFyLabel().split('-')[1]}</div>
            <div className="card-title">Monthly trend</div>
          </div>
          <div className="legend">
            <div className="legend-item"><span className="legend-dot" style={{ background: emp.color }}/>{emp.name}</div>
          </div>
        </div>
        <TrendChart series={[{ emp, points: months.map((_, i) => computeMonth(a, i).total) }]} months={months} monthIdx={monthIdx} max={m.max}/>
      </div>

      <KpiGrid emp={emp} a={a} m={m} monthIdx={monthIdx} months={months} defs={teamDefs} kras={teamKras} isAdmin={isAdmin} saving={saving} onSave={onSave}/>
    </div>
  )
}

// ── Compare view ──
function CompareView({ selectedEmps, assignments, months, monthIdx, setMonthIdx, computeMonth, thresholdsByTeam, defsByTeam, krasByTeam, onConfigOpen }) {
  const data = selectedEmps.map(emp => {
    const a = assignments.find(x => x.profile_id === emp.id)
    return { emp, a, m: a ? computeMonth(a, monthIdx) : null }
  }).filter(x => x.a)
  // Use first selected emp's team for column structure
  const firstTeamId = data[0]?.a?.team_id
  const cmpDefs = (defsByTeam?.[firstTeamId] || []).filter(d => d.is_scored)
  const cmpKras = krasByTeam?.[firstTeamId] || {}
  return (
    <div className="dash">
      <div className="hero">
        <div className="hero-left">
          <div className="hero-stack">
            {selectedEmps.slice(0, 5).map((e, i) => (
              <div key={e.id} className="hero-avatar small" style={{ background: e.color, marginLeft: i === 0 ? 0 : -10, zIndex: 10 - i }}>{e.initials}</div>
            ))}
            {selectedEmps.length > 5 && <div className="hero-avatar small more">+{selectedEmps.length - 5}</div>}
          </div>
          <div>
            <div className="hero-name">Comparing {selectedEmps.length} members</div>
            <div className="hero-meta"><span>{MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</span></div>
          </div>
        </div>
      </div>

      <MonthScrubber months={months} monthIdx={monthIdx} onChange={setMonthIdx}/>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">FY 20{currentFyLabel().split('-')[0]}–20{currentFyLabel().split('-')[1]}</div>
            <div className="card-title">Monthly trend · {selectedEmps.length} people</div>
          </div>
          <div className="legend">
            {selectedEmps.map(e => (
              <div key={e.id} className="legend-item"><span className="legend-dot" style={{ background: e.color }}/>{e.name.split(' ')[0]}</div>
            ))}
          </div>
        </div>
        <TrendChart
          series={data.map(({ emp, a }) => ({ emp, points: months.map((_, i) => computeMonth(a, i).total) }))}
          months={months} monthIdx={monthIdx} max={Math.max(...data.map(d => d.m?.max || 80), 80)}
        />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">{MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</div>
            <div className="card-title">Side-by-side scores</div>
          </div>
        </div>
        <div className="cmp-table">
          <div className="cmp-row cmp-head">
            <div className="cmp-cell name">Employee</div>
            {cmpDefs.map(k => <div key={k.kpi_key} className="cmp-cell"><span className="cmp-kra-tag" style={{ background: cmpKras[k.kra]?.color || FALLBACK_KRA_COLOR }}>{k.kra}</span>{k.label.split(' ')[0]}</div>)}
            <div className="cmp-cell total">Total</div>
          </div>
          {data.map(({ emp, m }) => (
            <div key={emp.id} className="cmp-row">
              <div className="cmp-cell name">
                <div className="cmp-avatar" style={{ background: emp.color }}>{emp.initials}</div>
                <div>
                  <div className="cmp-name">{emp.name}</div>
                  <div className="cmp-role">{emp.role || '—'}</div>
                </div>
              </div>
              {cmpDefs.map(k => {
                const s = m?.scores[k.kpi_key]
                const pct = s && s.max ? s.pts / s.max : 0
                return (
                  <div key={k.kpi_key} className="cmp-cell score">
                    <div className="cmp-score-num">{s?.pts ?? 0}</div>
                    <div className="cmp-score-bar"><div className="cmp-score-fill" style={{ width: `${pct*100}%`, background: cmpKras[k.kra]?.color || FALLBACK_KRA_COLOR }}/></div>
                  </div>
                )
              })}
              <div className="cmp-cell total"><b>{m?.total || 0}</b><span>/{m?.max || 80}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Charts ──
function RadialGauge({ value, max = 80, size = 168 }) {
  const r = size/2 - 14
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, max > 0 ? value/max : 0))
  const offset = c * (1 - pct)
  const grade = pct >= 0.75 ? 'Excellent' : pct >= 0.6 ? 'Strong' : pct >= 0.45 ? 'On track' : pct >= 0.3 ? 'Needs work' : 'At risk'
  const gColor = pct >= 0.75 ? '#10B981' : pct >= 0.6 ? '#3DD9D6' : pct >= 0.45 ? '#F59E0B' : pct >= 0.3 ? '#F97316' : '#EF4444'
  return (
    <div className="gauge" style={{ width: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} stroke="#E8EBF0" strokeWidth="10" fill="none"/>
        <circle cx={size/2} cy={size/2} r={r} stroke={gColor} strokeWidth="10" fill="none" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .6s ease' }}/>
      </svg>
      <div className="gauge-center">
        <div className="gauge-num">{Number(value).toFixed(value % 1 === 0 ? 0 : 1)}</div>
        <div className="gauge-max">/ {max}</div>
        <div className="gauge-grade" style={{ color: gColor }}>{grade}</div>
      </div>
    </div>
  )
}

function TrendChart({ series, months, monthIdx, max = 80 }) {
  const W = 720, H = 220, P = { l: 40, r: 16, t: 16, b: 28 }
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b
  const x = i => P.l + (i / (months.length - 1)) * innerW
  const y = v => P.t + innerH - (v / max) * innerH
  const ticks = [0, max*0.25, max*0.5, max*0.75, max].map(v => Math.round(v))
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      {ticks.map(v => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#EEF1F5" strokeWidth="1"/>
          <text x={P.l - 8} y={y(v) + 3} fontSize="10" fill="#94A3B8" textAnchor="end" fontFamily="Geist Mono, monospace">{v}</text>
        </g>
      ))}
      {months.map((_, i) => (
        <text key={i} x={x(i)} y={H - 10} fontSize="10" fill={i === monthIdx ? '#0A2540' : '#94A3B8'} fontWeight={i === monthIdx ? 600 : 400} textAnchor="middle" fontFamily="Geist Mono, monospace">{MONTHS_LABELS[i]}</text>
      ))}
      <line x1={x(monthIdx)} x2={x(monthIdx)} y1={P.t} y2={H - P.b} stroke="#3DD9D6" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7"/>
      {series.map((s, sIdx) => {
        const path = s.points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
        return (
          <g key={s.emp.id}>
            <path d={path} stroke={s.emp.color} strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === monthIdx ? 4 : 2.5} fill="#fff" stroke={s.emp.color} strokeWidth={i === monthIdx ? 2.5 : 1.5}/>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function RadarChart({ scores, defs = [], kras = {}, size = 240 }) {
  const kraScores = {}
  defs.forEach(def => {
    if (!def.is_scored) return
    const s = scores[def.kpi_key]; if (!s) return
    if (!kraScores[def.kra]) kraScores[def.kra] = { total: 0, max: 0 }
    kraScores[def.kra].total += s.pts; kraScores[def.kra].max += s.max
  })
  const axes = Object.entries(kraScores).map(([code, v]) => ({ code, color: kras[code]?.color || FALLBACK_KRA_COLOR, pct: v.max > 0 ? v.total/v.max : 0 }))
  if (!axes.length) return <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}/>
  const cx = size/2, cy = size/2, R = size/2 - 28
  const angle = i => -Math.PI/2 + (i / axes.length) * 2 * Math.PI
  const point = (i, pct) => [cx + Math.cos(angle(i)) * R * pct, cy + Math.sin(angle(i)) * R * pct]
  const valuePath = axes.map((a, i) => { const [x,y] = point(i, a.pct); return `${i===0?'M':'L'} ${x} ${y}` }).join(' ') + ' Z'
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="radar">
      {[0.25,0.5,0.75,1].map(r => (
        <polygon key={r} points={axes.map((_, i) => point(i, r).join(',')).join(' ')} fill="none" stroke="#E8EBF0" strokeWidth="1"/>
      ))}
      {axes.map((a, i) => {
        const [x,y] = point(i, 1)
        const [lx,ly] = point(i, 1.16)
        return (
          <g key={a.code}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#E8EBF0"/>
            <text x={lx} y={ly+4} fontSize="11" fontWeight="600" fill={a.color} textAnchor="middle" fontFamily="Geist, sans-serif">{a.code}</text>
          </g>
        )
      })}
      <path d={valuePath} fill="rgba(10,37,64,0.15)" stroke="#0A2540" strokeWidth="2" strokeLinejoin="round"/>
      {axes.map((a, i) => {
        const [x,y] = point(i, a.pct)
        return <circle key={a.code} cx={x} cy={y} r="4" fill="#fff" stroke={a.color} strokeWidth="2.5"/>
      })}
    </svg>
  )
}

function KraBars({ scores, defs = [], kras = {} }) {
  const groups = Object.values(kras).map(k => {
    const items = defs.filter(d => d.is_scored && d.kra === k.code)
    const total = items.reduce((s, d) => s + (scores[d.kpi_key]?.pts || 0), 0)
    const max = items.reduce((s, d) => s + (scores[d.kpi_key]?.max || 0), 0)
    return { code: k.code, name: k.name, color: k.color, total, max }
  }).filter(g => g.max > 0)
  return (
    <div className="kra-bars">
      {groups.map(g => (
        <div key={g.code} className="kra-bar-row">
          <div className="kra-bar-head">
            <div className="kra-bar-code" style={{ background: g.color }}>{g.code}</div>
            <div className="kra-bar-name">{g.name}</div>
            <div className="kra-bar-val"><b>{g.total}</b><span>/{g.max}</span></div>
          </div>
          <div className="kra-bar-track"><div className="kra-bar-fill" style={{ width: `${(g.total/g.max)*100}%`, background: g.color }}/></div>
        </div>
      ))}
    </div>
  )
}

// ── KPI grid (with inline edit on click) ──
function KpiGrid({ emp, a, m, monthIdx, months, defs = [], kras = {}, isAdmin, saving, onSave }) {
  const [editing, setEditing] = useState(null)  // kpi_key
  const [draft, setDraft] = useState('')
  const monthIso = monthKey(months[monthIdx])

  function startEdit(key, currentValue) {
    if (!isAdmin) return
    setEditing(key)
    setDraft(currentValue == null ? '' : String(currentValue))
  }
  function commit() { onSave(a.id, editing, draft, monthIso); setEditing(null); setDraft('') }
  function cancel() { setEditing(null); setDraft('') }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-eyebrow">Inputs · {MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</div>
          <div className="card-title">KPI metrics</div>
        </div>
        <div className="card-sub">{isAdmin ? 'Admin / Management can edit. Click any tile to override.' : 'View-only.'}</div>
      </div>
      <div className="kpi-grid">
        {defs.map(def => {
          const s = m.scores[def.kpi_key] || { pts: 0, max: 0, value: m.all?.[def.kpi_key], raw: m.all || {}, threshold: null, def }
          const pct = s.max > 0 ? s.pts / s.max : 0
          const tone = pct >= 0.8 ? 'good' : pct >= 0.5 ? 'mid' : pct > 0 ? 'low' : 'zero'
          const kra = kras[def.kra]
          const value = m.all?.[def.kpi_key] ?? s.value
          const isEditing = editing === def.kpi_key
          const t = s.threshold
          const targetVal = maxPointsThreshold(t)
          const targetText = targetVal != null
            ? (def.format === 'pct' ? `${Math.round(targetVal*100)}%` : (def.kpi_key === 'complaints' ? `≤ ${targetVal}` : `${targetVal}+`))
            : '—'
          let displayValue = ''
          if (def.format === 'pct') displayValue = isFinite(value) ? `${Math.round(Number(value || 0)*100)}%` : '—'
          else if (def.format === 'inr') displayValue = fmtInr(value)
          else displayValue = String(Number(value || 0))
          let support = null
          if (def.kpi_key === 'collection_ratio') support = <>{fmtInr(m.all?.collection_amount || 0)} collected of {fmtInr(m.all?.overdue_amount || 0)} overdue</>
          if (def.kpi_key === 'sales_achievement') support = <>{fmtInr(m.all?.actual_sales || 0)} of {fmtInr(m.monthlyTarget)}</>

          return (
            <div key={def.kpi_key} className={`kpi-card kpi-${tone}`} onClick={() => def.source !== 'derived' && startEdit(def.kpi_key, value)}>
              <div className="kpi-card-top">
                <div className="kpi-tag" style={{ background: kra?.color || FALLBACK_KRA_COLOR }}>{def.kra}</div>
                <div className="kpi-name">{def.label}</div>
                <div className={`kpi-source ${def.source === 'derived' ? 'derived' : (def.source === 'manual' ? 'manual' : 'auto')}`}>
                  {def.source === 'derived' ? 'AUTO' : def.source === 'manual' ? 'MANUAL' : 'AUTO'}
                </div>
              </div>
              <div className="kpi-target">{def.is_scored ? `Target: ${targetText} for ${s.max} pts` : 'Input value (feeds derived KPI)'}</div>
              {isEditing ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" step="any" autoFocus value={draft} onChange={e => setDraft(e.target.value)} onClick={e => e.stopPropagation()}
                    style={{ flex: 1, padding: '6px 8px', fontSize: 14, border: '1.5px solid #0A2540', borderRadius: 5, fontFamily: 'Geist Mono, monospace', outline: 'none' }} />
                  <button onClick={(e) => { e.stopPropagation(); commit() }} disabled={saving} style={{ padding: '6px 10px', background: '#0A2540', color: 'white', border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓</button>
                  <button onClick={(e) => { e.stopPropagation(); cancel() }} style={{ padding: '6px 10px', background: 'white', border: '1.5px solid #E8EBF0', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>×</button>
                </div>
              ) : (
                <div className="kpi-value-row">
                  <div className="kpi-value">{displayValue}</div>
                  <div className="kpi-points"><div className="kpi-points-num">{s.pts}<span>/{s.max}</span></div></div>
                </div>
              )}
              {support && <div className="kpi-support">{support}</div>}
              {def.is_scored && <div className="kpi-track"><div className="kpi-fill" style={{ width: `${pct*100}%`, background: kra?.color || FALLBACK_KRA_COLOR }}/></div>}
              {isAdmin && def.source !== 'derived' && !isEditing && (
                <button className="kpi-edit" onClick={(e) => { e.stopPropagation(); startEdit(def.kpi_key, value) }}>Edit value →</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

