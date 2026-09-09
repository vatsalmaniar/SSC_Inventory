import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import { friendlyError } from '../lib/errorMsg'
import {
  currentFyLabel, fyMonths, monthLabel, monthKey,
  scoreFor, maxPointsThreshold, fmtInr, fmtInrCeil, fmtPct,
} from '../lib/kpi'
import { AUTO_FETCHERS, DERIVED_FETCHERS } from '../lib/kpiFetchers'
import KpiConfigurator from '../components/KpiConfigurator'
import '../styles/kpi-dashboard.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'
import Stat from '../components/StatTile'

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
  const [allMonthlyData, setAllMonthlyData] = useState({})       // {assignment_id: {month_iso: {kpi_key: value}}} — manual overrides only
  const [kpiSnapshots, setKpiSnapshots]     = useState({})       // {assignment_id: {month_iso: {kpi_key: value}}} — cached auto-pull
  const [snapshotMeta, setSnapshotMeta]     = useState({})       // {assignment_id: {synced_at, synced_by}}
  const [syncing, setSyncing]               = useState(false)
  const [syncProgress, setSyncProgress]     = useState({ done: 0, total: 0 })
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
    const role = profile?.role || 'sales'
    setUser({ id: session.user.id, name: profile?.name || '', role })
    // KPI is for sales (own) + admin/management. Non-KPI roles (ops/fc/accounts) → dashboard, not an empty page.
    if (!['sales','admin','management'].includes(role)) { navigate('/people'); return }
    const isAdminRole = ['admin','management'].includes(profile?.role)

    const [tRes, aRes, thRes, hpRes, dRes, kRes] = await Promise.all([
      // kpi_teams_safe never exposes target_multiplier (secret business logic)
      sb.from('kpi_teams_safe').select('*').eq('is_active', true).order('name'),
      // employees read kpi_self (target amounts only, NO multiplier / CTC); admins read the full table
      (isAdminRole
        // Columns listed EXPLICITLY, never select('*'): kpi_assignments carries
        // annual_ctc_inr — the CTC behind the secret target multiplier, i.e. salary. The
        // page was pulling it into the browser for every admin/management user and
        // assigning it to a `ctc` field that nothing ever rendered. Do not reintroduce
        // '*' here; add the specific column you need instead.
        ? sb.from('kpi_assignments')
            .select('id,profile_id,team_id,fy_label,annual_target_inr,monthly_target_inr,is_active, profiles(id,name,role)')
            .eq('fy_label', fy).eq('is_active', true)
        : sb.from('kpi_self').select('*').eq('fy_label', fy).eq('is_active', true)),
      sb.from('kpi_thresholds').select('*').eq('fy_label', fy),
      sb.from('kpi_hero_products').select('month_start, brand, category, subcategory, series'),
      sb.from('kpi_definitions').select('*').eq('is_active', true).order('sort_order'),
      sb.from('kpi_kra_categories').select('*').order('sort_order'),
    ])
    setTeams(tRes.data || [])
    // employee's kpi_self rows have no embedded profile — attach their own
    if (!isAdminRole) aRes.data = (aRes.data || []).map(a => ({ ...a, profiles: { id: profile.id, name: profile.name, role: profile.role } }))
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

    // Load both snapshots (cached auto values) AND manual overrides for the WHOLE team
    // up-front in two parallel queries. Without the manual overrides loaded for everyone,
    // the team-list scores only become "exact" after you click each member (because
    // loadManualDataForSelected used to be lazy). Both are bounded — ~12 months × ~9 KPIs
    // × 11 employees ≈ 1200 rows total, fine in one round-trip.
    const assignmentIds = (aRes.data || []).map(a => a.id)
    if (assignmentIds.length) {
      const [snapRes, manualRes] = await Promise.all([
        sb.from('kpi_snapshots').select('*').in('assignment_id', assignmentIds),
        sb.from('kpi_monthly_data').select('*').in('assignment_id', assignmentIds),
      ])
      const sm = {}, meta = {}
      ;(snapRes.data || []).forEach(r => {
        const mIso = r.month_start.slice(0, 10)
        if (!sm[r.assignment_id]) sm[r.assignment_id] = {}
        if (!sm[r.assignment_id][mIso]) sm[r.assignment_id][mIso] = {}
        sm[r.assignment_id][mIso][r.kpi_key] = Number(r.value)
        const cur = meta[r.assignment_id]
        if (!cur || r.synced_at > cur.synced_at) meta[r.assignment_id] = { synced_at: r.synced_at, synced_by: r.synced_by }
      })
      setKpiSnapshots(sm)
      setSnapshotMeta(meta)

      const md = {}
      ;(aRes.data || []).forEach(a => {
        md[a.id] = {}
        months.forEach(m => { md[a.id][monthKey(m)] = {} })
      })
      ;(manualRes.data || []).forEach(r => {
        const mIso = r.month_start.slice(0, 10)
        if (!md[r.assignment_id]) md[r.assignment_id] = {}
        if (!md[r.assignment_id][mIso]) md[r.assignment_id][mIso] = {}
        md[r.assignment_id][mIso][r.kpi_key] = Number(r.value)
      })
      setAllMonthlyData(md)
    }

    setLoading(false)
  }

  // Manual overrides for the whole team are loaded in init(). This effect is a safety
  // net — if a brand-new assignment was added after init or state went stale somehow,
  // re-fetch for the currently selected user. Mostly a no-op.
  useEffect(() => {
    if (selectedIds.length === 0) return
    for (const profileId of selectedIds) {
      const a = assignments.find(x => x.profile_id === profileId)
      if (!a || allMonthlyData[a.id]) continue
      // Missing — fetch and merge
      sb.from('kpi_monthly_data').select('*').eq('assignment_id', a.id).then(({ data: monthly }) => {
        const mmap = {}
        months.forEach(m => { mmap[monthKey(m)] = {} })
        ;(monthly || []).forEach(r => {
          const k = r.month_start.slice(0, 10)
          if (!mmap[k]) mmap[k] = {}
          mmap[k][r.kpi_key] = Number(r.value)
        })
        setAllMonthlyData(prev => ({ ...prev, [a.id]: mmap }))
      })
    }
  }, [selectedIds])

  // === Snapshot sync — admin/management only ===
  // Runs bulkAutoPullForFy for every visible assignment and upserts results into
  // kpi_snapshots so subsequent page loads skip the live queries entirely.
  async function syncSnapshots() {
    if (syncing) return
    if (!['admin','management'].includes(user.role)) { toast('Admin / management only', 'error'); return }
    const toSync = employeeList.length ? employeeList.map(e => assignments.find(a => a.id === e.assignmentId)).filter(Boolean) : []
    if (!toSync.length) { toast('Nothing to sync'); return }
    setSyncing(true)
    setSyncProgress({ done: 0, total: toSync.length })
    const newSnap = { ...kpiSnapshots }
    const newMeta = { ...snapshotMeta }
    let i = 0
    for (const a of toSync) {
      try {
        const accountOwnerName = a.profiles?.name || ''
        const defs = defsByTeam[a.team_id] || []
        const auto = await bulkAutoPullForFy(defs, a.profile_id, accountOwnerName, months, heroByMonth)
        const rows = []
        const stamp = new Date().toISOString()
        for (const mIso of Object.keys(auto)) {
          for (const [kpi_key, value] of Object.entries(auto[mIso] || {})) {
            rows.push({ assignment_id: a.id, month_start: mIso, kpi_key, value: Number(value) || 0, synced_at: stamp, synced_by: user.id })
          }
        }
        if (rows.length) {
          const { error } = await sb.from('kpi_snapshots').upsert(rows, { onConflict: 'assignment_id,month_start,kpi_key' })
          if (error) { console.error('snapshot upsert error', a.profiles?.name, error); }
        }
        // Update local state immediately so partial progress is visible
        if (!newSnap[a.id]) newSnap[a.id] = {}
        for (const mIso of Object.keys(auto)) {
          newSnap[a.id][mIso] = { ...(newSnap[a.id][mIso] || {}), ...(auto[mIso] || {}) }
        }
        newMeta[a.id] = { synced_at: stamp, synced_by: user.id }
      } catch (e) {
        console.error('sync failed for', a.profiles?.name, e)
      }
      i++
      setSyncProgress({ done: i, total: toSync.length })
    }
    setKpiSnapshots(newSnap)
    setSnapshotMeta(newMeta)
    setSyncing(false)
    setSyncProgress({ done: 0, total: 0 })
    toast(`Synced ${toSync.length} employee${toSync.length>1?'s':''} · ${months.length} months each`, 'success')
  }

  function computeMonthForAssignment(a, mIdx) {
    const monthIso = monthKey(months[mIdx])
    const stored = allMonthlyData[a.id]?.[monthIso] || {}
    const auto = kpiSnapshots[a.id]?.[monthIso] || {}
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
      // Always compute from snapshots — they're loaded for the full team up-front in init().
      // computeMonthForAssignment safely returns 0 when snapshot is missing for that month.
      const m = computeMonthForAssignment(a, monthIdx)
      return {
        id: a.profile_id, assignmentId: a.id, name: a.profiles?.name || '—', role: a.profiles?.role || '',
        team: a.team_id, target: Number(a.annual_target_inr) || 0,
        initials: initialsFor(a.profiles?.name), color: colorFor(a.profile_id),
        score: m.total, max: m.max,
      }
    }).sort((a, b) => b.score - a.score)
  }, [assignments, filter, query, isAdmin, user.id, monthIdx, allMonthlyData, kpiSnapshots, defsByTeam, thresholdsByTeam])

  // Team roll-up for the summary tiles. Derived from employeeList, so the tiles can
  // never disagree with the board below them.
  const board = useMemo(() => {
    const scored = employeeList.filter(e => e.max > 0)
    const pct = e => Math.round((e.score / e.max) * 100)
    const avg = scored.length ? Math.round(scored.reduce((a, e) => a + pct(e), 0) / scored.length) : null
    const top = scored.length ? scored.reduce((a, e) => (pct(e) > pct(a) ? e : a)) : null
    return {
      n: employeeList.length,
      scored: scored.length,
      avg,
      top: top ? { name: top.name, pct: pct(top) } : null,
      onTarget: scored.filter(e => pct(e) >= 80).length,
      attention: scored.filter(e => pct(e) < 50).length,
    }
  }, [employeeList])

  const selectedEmps = selectedIds.map(id => employeeList.find(e => e.id === id) || assignments.find(a => a.profile_id === id) && (() => {
    const a = assignments.find(x => x.profile_id === id)
    if (!a) return null
    return { id: a.profile_id, assignmentId: a.id, name: a.profiles?.name || '—', role: a.profiles?.role || '', team: a.team_id, target: Number(a.annual_target_inr)||0, initials: initialsFor(a.profiles?.name), color: colorFor(a.profile_id), score: 0, max: 0 }
  })()).filter(Boolean)

  function handleSelect(id, multi) {
    if (multi && isAdmin) setSelectedIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
    else setSelectedIds([id])
  }

  // Page head below (title, FY/period pills) doesn't depend on the fetch — user/teams/
  // assignments all default to empty-safe values — so only page-body is gated by `loading`,
  // matching the Orders/GRN pattern instead of blanking the whole page.
  return (
    <Layout pageKey="people">
      <div className="orders-app">

        {/* Page head */}
        <div className="page-head">
          <div>
            <h1 className="page-title">Performance</h1>
            <div className="page-sub">Monthly performance for the Growth & Customer Success teams.</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">FY</span><span className="meta-val">20{fy.split('-')[0]}–20{fy.split('-')[1]}</span></div>
            {/* Month picker in the header, like My Attendance. Replaces the 12-button
                scrubber that used to sit inside each dashboard — the selection is a
                page-level control, so it belongs with the page-level filters. Future
                months of the FY stay listed but disabled. */}
            {isAdmin && teams.length > 1 && (
              <select className="ph-picker" value={filter} onChange={e => setFilter(e.target.value)} title="Team">
                <option value="all">All teams</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {isAdmin && employeeList.length > 0 && (
              <select className="ph-picker" title="Person"
                value={selectedIds[0] || ''}
                onChange={e => handleSelect(e.target.value, false)}>
                {employeeList.map(e => (
                  <option key={e.id} value={e.id}>{e.name}{e.max > 0 ? ` — ${Math.round((e.score / e.max) * 100)}%` : ''}</option>
                ))}
              </select>
            )}
            <select className="ph-picker" value={monthIdx} onChange={e => setMonthIdx(Number(e.target.value))}
              title="Performance month">
              {months.map((m, i) => (
                <option key={i} value={i} disabled={m > new Date()}>
                  {MONTHS_LABELS[i]} {m.getFullYear()}{m > new Date() ? ' — upcoming' : ''}
                </option>
              ))}
            </select>
            {(() => {
              const stamps = Object.values(snapshotMeta).map(m => m?.synced_at).filter(Boolean)
              if (!stamps.length) return <div className="meta-pill" style={{ background:'rgba(180,83,9,0.10)', borderColor:'rgba(180,83,9,0.35)', color:'#92400e' }}><span className="meta-label">Snapshot</span><span className="meta-val">Not synced yet</span></div>
              const latest = stamps.sort().reverse()[0]
              const ageMs = Date.now() - new Date(latest).getTime()
              const ageHr = Math.round(ageMs / 3600000)
              const ageStr = ageHr < 1 ? 'just now' : ageHr < 24 ? `${ageHr}h ago` : `${Math.round(ageHr/24)}d ago`
              return <div className="meta-pill"><span className="meta-label">Last sync</span><span className="meta-val">{ageStr}</span></div>
            })()}
            {isAdmin && selectedEmps[0] && (() => {
              // Same placement as every other People page: a ghost button in the header
              // rather than one buried in the person hero.
              const a = assignments.find(x => x.profile_id === selectedEmps[0].id)
              if (!a) return null
              return (
                <button className="btn-ghost" onClick={() => { setCfgTeamId(a.team_id); setCfgOpen(true) }}
                  title="Configure scoring for this team">
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5 V3.5 M8 12.5 V14.5 M14.5 8 H12.5 M3.5 8 H1.5 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6 M12.6 12.6 L11.2 11.2 M4.8 4.8 L3.4 3.4"/></svg>
                  Configure
                </button>
              )
            })()}
            {['admin','management'].includes(user.role) && (
              <button onClick={syncSnapshots} disabled={syncing}
                title="Re-fetch sales / customers / visits from live data and write to kpi_snapshots"
                style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', border:'1px solid #1a73e8', borderRadius:8, background: syncing ? '#dbeafe' : '#1a73e8', color: syncing ? '#1e40af' : 'white', fontSize:12, fontWeight:700, cursor: syncing ? 'wait' : 'pointer', fontFamily:'var(--font)' }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><path d="M21 12a9 9 0 11-3.5-7.1M21 4v5h-5"/></svg>
                {syncing ? `Syncing ${syncProgress.done}/${syncProgress.total}…` : 'Sync'}
              </button>
            )}
          </div>
        </div>

        {/* Team summary — derived from the same employeeList the board below renders. */}
        {!loading && board.n > 0 && (
          <div className="ph-bento lv-bento">
            <Stat label="People" value={board.n}
              foot={board.scored < board.n ? <><b>{board.n - board.scored}</b> not scored yet</> : 'all scored'} />
            <Stat label="Average score" value={board.avg != null ? `${board.avg}%` : '—'}
              foot={`${MONTHS_LABELS[monthIdx]} ${months[monthIdx].getFullYear()}`} />
            <Stat label="Top performer" value={board.top ? `${board.top.pct}%` : '—'}
              foot={board.top ? board.top.name : 'nothing scored'} />
            <Stat label="On target" value={board.onTarget} foot="80% or above" />
            <Stat label="Needs attention" value={board.attention} warn={board.attention > 0}
              foot={board.attention > 0 ? 'below 50%' : 'nobody below 50%'} />
          </div>
        )}

        {/* The scorecard keeps its own .kpi-app shell — a purpose-built board with its
            own classes. Only the chrome above moved to the shared language. */}
        <div className={`kpi-app density-${tweaks.density} accent-${tweaks.accent}`}>

        {/* Body: the dashboard at full width. The 320px team panel that used to sit
            beside it squeezed the metric grid to ~3 columns, so 12 metrics became four
            rows of scrolling; person and team are dropdowns in the header now. */}
        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <div className="page-body">
            <Dashboard
              selectedEmps={selectedEmps} assignments={assignments} teams={teams}
              months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx}
              computeMonth={computeMonthForAssignment} ytdAvg={ytdAvg}
              thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam}
              allMonthlyData={allMonthlyData}
              isAdmin={isAdmin} saving={saving} onSave={saveValue}
              hasOwnAssignment={!!assignments.find(a => a.profile_id === user.id)}
              userName={user.name}
            />
          </div>
        )}

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
      </div>
    </Layout>
  )
}

// ── Team Panel ──
function ScoreSpark({ value, max }) {
  const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0))
  const color = pct >= 0.7 ? '#10B981' : pct >= 0.5 ? '#F59E0B' : pct >= 0.3 ? '#F97316' : '#EF4444'
  return <div className="spark-bar"><div className="spark-fill" style={{ width: `${pct*100}%`, background: color }}/></div>
}

// ── Dashboard (single + compare) ──
function Dashboard({ selectedEmps, assignments, teams, months, monthIdx, setMonthIdx, computeMonth, ytdAvg, thresholdsByTeam, defsByTeam, krasByTeam, allMonthlyData, isAdmin, saving, onSave, hasOwnAssignment, userName }) {
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
    return <SingleEmployee emp={selectedEmps[0]} assignments={assignments} teams={teams} months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx} computeMonth={computeMonth} ytdAvg={ytdAvg} thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam} isAdmin={isAdmin} saving={saving} onSave={onSave} />
  }
  return <CompareView selectedEmps={selectedEmps} assignments={assignments} months={months} monthIdx={monthIdx} setMonthIdx={setMonthIdx} computeMonth={computeMonth} thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam} />
}

// ── Month scrubber ──
// ── Single employee dashboard ──
function SingleEmployee({ emp, assignments, teams, months, monthIdx, setMonthIdx, computeMonth, ytdAvg, thresholdsByTeam, defsByTeam, krasByTeam, isAdmin, saving, onSave }) {
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
      </div>


      {/* Performance and the trend share the top row; the matrix runs full width
          beneath at 4 across; score breakdown closes the page in landscape. */}
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
                <div className="card-eyebrow">FY 20{currentFyLabel().split('-')[0]}–20{currentFyLabel().split('-')[1]}</div>
                <div className="card-title">Monthly trend</div>
              </div>
              <div className="legend">
                <div className="legend-item"><span className="legend-dot" style={{ background: emp.color }}/>{emp.name}</div>
              </div>
            </div>
            <TrendChart series={[{ emp, points: months.map((_, i) => computeMonth(a, i).total) }]} months={months} monthIdx={monthIdx} max={m.max}/>
          </div>
      </div>

      <KpiGrid emp={emp} a={a} m={m} monthIdx={monthIdx} months={months} defs={teamDefs} kras={teamKras} isAdmin={isAdmin} saving={saving} onSave={onSave}/>

      {/* Monthly sales — the ₹ figure behind the Sales Achievement metric, on the same
          chart treatment as the score trend. Axis is compacted to L/Cr; plotting raw
          rupees would print 39297706 down the side. */}
      {(() => {
        const sales = months.map((_, i) => Number(computeMonth(a, i).all?.actual_sales) || 0)
        const target = Number(m.monthlyTarget) || 0
        const peak = Math.max(...sales, target, 1)
        const compact = v => v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : Math.round(v)
        return (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div>
                <div className="card-eyebrow">FY 20{currentFyLabel().split('-')[0]}–20{currentFyLabel().split('-')[1]} · monthly target {fmtInrCeil(target)}</div>
                <div className="card-title">Monthly sales</div>
              </div>
              <div className="legend">
                <div className="legend-item"><span className="legend-dot" style={{ background: emp.color }}/>{emp.name}</div>
              </div>
            </div>
            <TrendChart series={[{ emp, points: sales, tip: v => fmtInrCeil(v) }]}
              months={months} monthIdx={monthIdx} max={peak} fmtTick={compact}/>
          </div>
        )
      })()}

      <div className="card kpi-breakdown">
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
  )
}

// ── Compare view ──
function CompareView({ selectedEmps, assignments, months, monthIdx, setMonthIdx, computeMonth, thresholdsByTeam, defsByTeam, krasByTeam }) {
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

function TrendChart({ series, months, monthIdx, max = 80, fmtTick = v => v }) {
  // Same market-chart treatment as the People dashboard: smooth curves and a soft area
  // fill instead of the old straight polyline, with the grid and labels reading from the
  // design tokens rather than hardcoded greys. Still multi-series, so the compare view
  // keeps working.
  const W = 720, H = 220, P = { l: 40, r: 16, t: 16, b: 28 }
  const innerW = W - P.l - P.r, innerH = H - P.t - P.b
  const x = i => P.l + (i / Math.max(1, months.length - 1)) * innerW
  const y = v => P.t + innerH - (v / (max || 1)) * innerH
  const ticks = [0, max*0.25, max*0.5, max*0.75, max].map(v => Math.round(v))
  // Symmetric cubic through the points — the same curve the shared TrendChart draws.
  const smooth = pts => {
    if (pts.length < 2) return ''
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
      const cx = (x0 + x1) / 2
      d += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
    }
    return d
  }
  const single = series.length === 1
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {series.map(s => (
          <linearGradient key={s.emp.id} id={`kpi-fill-${s.emp.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.emp.color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={s.emp.color} stopOpacity="0.01" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map(v => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--o-line-2, #EEF1F5)" strokeWidth="1"/>
          <text x={P.l - 8} y={y(v) + 3} fontSize="10" fill="var(--o-muted-2, #94A3B8)" textAnchor="end" fontFamily="var(--mono)">{fmtTick(v)}</text>
        </g>
      ))}
      {months.map((_, i) => (
        <text key={i} x={x(i)} y={H - 10} fontSize="10"
          fill={i === monthIdx ? 'var(--ssc-blue, #1a73e8)' : 'var(--o-muted-2, #94A3B8)'}
          fontWeight={i === monthIdx ? 600 : 400} textAnchor="middle" fontFamily="var(--mono)">{MONTHS_LABELS[i]}</text>
      ))}
      <line x1={x(monthIdx)} x2={x(monthIdx)} y1={P.t} y2={H - P.b}
        stroke="var(--ssc-blue, #1a73e8)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.45"/>
      {series.map(s => {
        const pts = s.points.map((v, i) => [x(i), y(v)])
        const line = smooth(pts)
        const base = H - P.b
        return (
          <g key={s.emp.id}>
            {single && line && <path d={`${line} L ${pts[pts.length-1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`} fill={`url(#kpi-fill-${s.emp.id})`} />}
            <path d={line} stroke={s.emp.color} strokeWidth="2.2" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
            {pts.map(([px, py], i) => (
              <circle key={i} cx={px} cy={py} r={i === monthIdx ? 4 : 2.5} fill="#fff" stroke={s.emp.color} strokeWidth={i === monthIdx ? 2.5 : 1.5}>
                <title>{`${MONTHS_LABELS[i]} · ${s.tip ? s.tip(s.points[i]) : `${s.points[i]}/${max} pts`}`}</title>
              </circle>
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
      <path d={valuePath} fill="rgba(10,37,64,0.15)" stroke="#1a73e8" strokeWidth="2" strokeLinejoin="round"/>
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
  // Enter saves, Escape abandons — the box was mouse-only before, so every value
  // needed a trip to a tiny tick button.
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel() }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-eyebrow">Inputs · {MONTHS_LABELS[monthIdx]} {months[monthIdx].getFullYear()}</div>
          <div className="card-title">KPI metrics</div>
        </div>
        <div className="card-sub">{isAdmin ? 'Use “Edit value” on a metric to override. AUTO metrics are computed.' : 'View-only.'}</div>
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
          if (def.format === 'pct') displayValue = isFinite(value) ? fmtPct(Number(value || 0)) : '—'
          else if (def.format === 'inr') displayValue = fmtInr(value)
          else displayValue = String(Number(value || 0))
          let support = null
          if (def.kpi_key === 'collection_ratio') support = <>{fmtInr(m.all?.collection_amount || 0)} collected of {fmtInr(m.all?.overdue_amount || 0)} overdue</>
          if (def.kpi_key === 'sales_achievement') support = <>{fmtInr(m.all?.actual_sales || 0)} of {fmtInr(m.monthlyTarget)}</>

          return (
            <div key={def.kpi_key} className={`kpi-card kpi-${tone}${isEditing ? ' is-editing' : ''}`}>
              <div className="kpi-card-top">
                <div className="kpi-tag" style={{ background: kra?.color || FALLBACK_KRA_COLOR }}>{def.kra}</div>
                <div className="kpi-name">{def.label}</div>
                <div className={`kpi-source ${def.source === 'derived' ? 'derived' : (def.source === 'manual' ? 'manual' : 'auto')}`}>
                  {def.source === 'derived' ? 'AUTO' : def.source === 'manual' ? 'MANUAL' : 'AUTO'}
                </div>
              </div>
              <div className="kpi-target">{def.is_scored ? `Target: ${targetText} for ${s.max} pts` : 'Input value (feeds derived KPI)'}</div>
              {isEditing ? (
                <div className="kpi-edit-row">
                  <div className="kpi-edit-field">
                    {def.format === 'inr' && <span className="kpi-edit-unit">₹</span>}
                    <input type="number" step="any" min="0" inputMode="decimal" autoFocus
                      value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
                      aria-label={`${def.label} value`} />
                  </div>
                  <button className="kpi-btn primary" onClick={commit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                  <button className="kpi-btn" onClick={cancel}>Cancel</button>
                  {/* The previous value stays on screen while typing — it used to vanish,
                      so there was nothing to check the new number against. */}
                  <div className="kpi-edit-was">was {displayValue} · {s.pts}/{s.max} pts · Enter to save</div>
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

