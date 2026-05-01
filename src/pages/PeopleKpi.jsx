import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import { friendlyError } from '../lib/errorMsg'
import {
  KPI_DEFS, KPI_INPUTS, KRA_LABELS, KRA_COLORS,
  currentFyLabel, fyMonths, monthLabel, monthKey,
  scoreFor, computeDerived, maxPointsThreshold, fmtInr, fmtInrCeil, fmtPct, fmtVal,
} from '../lib/kpi'

export default function PeopleKpi() {
  const navigate = useNavigate()
  const [user, setUser]               = useState({ id: '', name: '', role: '' })
  const [teams, setTeams]             = useState([])
  const [people, setPeople]           = useState([])           // assignments + profile name
  const [assignments, setAssignments] = useState([])           // raw assignments
  const [thresholds, setThresholds]   = useState({})           // {kpi_key: {thresholds, match_type}}
  const [heroByMonth, setHeroByMonth] = useState({})           // {month_iso: [item_code, ...]}
  const [monthlyData, setMonthlyData] = useState({})           // {month_iso: {kpi_key: value}}
  const [autoData, setAutoData]       = useState({})           // {month_iso: {kpi_key: computed_value}}
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)

  const fy = currentFyLabel()
  const months = useMemo(() => fyMonths(fy), [fy])

  const [selectedTeamId, setSelectedTeamId]   = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [selectedMonth, setSelectedMonth]     = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ id: session.user.id, name: profile?.name || '', role: profile?.role || 'sales' })

    const [tRes, aRes] = await Promise.all([
      sb.from('kpi_teams').select('*').eq('is_active', true).order('name'),
      sb.from('kpi_assignments').select('*, profiles(id,name,role)').eq('fy_label', fy).eq('is_active', true),
    ])
    setTeams(tRes.data || [])
    setAssignments(aRes.data || [])

    // Default team = first team
    const firstTeam = (tRes.data || [])[0]
    if (firstTeam) setSelectedTeamId(firstTeam.id)

    // Default person: own profile if assignment exists; else first assignment for the team
    const ownAssignment = (aRes.data || []).find(a => a.profile_id === session.user.id)
    if (ownAssignment) {
      setSelectedProfileId(session.user.id)
    } else {
      const firstInTeam = (aRes.data || []).find(a => a.team_id === firstTeam?.id)
      if (firstInTeam) setSelectedProfileId(firstInTeam.profile_id)
    }
  }

  // Load thresholds when team changes
  useEffect(() => {
    if (!selectedTeamId) return
    sb.from('kpi_thresholds').select('*').eq('team_id', selectedTeamId).eq('fy_label', fy).then(({ data }) => {
      const map = {}; (data || []).forEach(t => { map[t.kpi_key] = t })
      setThresholds(map)
    })
    // Load hero products grouped by month for this FY
    const fyStartMonth = months[0].toISOString().slice(0, 10)
    const fyEndMonth   = months[11].toISOString().slice(0, 10)
    sb.from('kpi_hero_products').select('month_start, item_code').gte('month_start', fyStartMonth).lte('month_start', fyEndMonth).then(({ data }) => {
      const byMonth = {}; (data || []).forEach(r => {
        const k = r.month_start.slice(0, 10)
        if (!byMonth[k]) byMonth[k] = []
        byMonth[k].push(r.item_code)
      })
      setHeroByMonth(byMonth)
    })
  }, [selectedTeamId, fy])

  // Load monthly data + auto-pull when person or hero list changes
  useEffect(() => {
    if (!selectedProfileId) { setMonthlyData({}); setAutoData({}); setLoading(false); return }
    loadDataForPerson()
  }, [selectedProfileId, selectedTeamId, heroByMonth])

  async function loadDataForPerson() {
    setLoading(true)
    const assignment = assignments.find(a => a.profile_id === selectedProfileId && a.team_id === selectedTeamId)
    if (!assignment) { setMonthlyData({}); setAutoData({}); setLoading(false); return }

    const profile = (people.find(p => p.profile_id === selectedProfileId) || {}).profiles
                 || (assignments.find(a => a.profile_id === selectedProfileId) || {}).profiles
    const accountOwnerName = profile?.name || ''

    // Pull stored monthly data
    const { data: monthly } = await sb.from('kpi_monthly_data').select('*').eq('assignment_id', assignment.id)
    const monthMap = {}
    months.forEach(m => { monthMap[monthKey(m)] = {} })
    ;(monthly || []).forEach(r => {
      const k = r.month_start.slice(0, 10)
      if (!monthMap[k]) monthMap[k] = {}
      monthMap[k][r.kpi_key] = Number(r.value)
    })
    setMonthlyData(monthMap)

    // Auto-pull from ERP for each month
    const auto = {}
    for (const m of months) {
      const k = monthKey(m)
      const start = k
      const next  = new Date(m.getFullYear(), m.getMonth() + 1, 1).toISOString().slice(0, 10)

      const heroForMonth = heroByMonth[k] || []
      const [salesRes, custRes, repVisitsRes, teamVisitsRes, heroRes] = await Promise.all([
        // Actual sales: sum order_items.total_price where order.account_owner = profile.name, created_at in month, not cancelled
        sb.from('orders').select('id,order_items(total_price)')
          .eq('account_owner', accountOwnerName)
          .neq('status', 'cancelled')
          .eq('is_test', false)
          .gte('created_at', start).lt('created_at', next),
        // New customers: count where account_owner = name, created_at in month, approved
        sb.from('customers').select('id', { count: 'exact', head: true })
          .ilike('account_owner', accountOwnerName)
          .eq('approval_status', 'approved')
          .gte('created_at', start).lt('created_at', next),
        // Visits where person is rep_id (any visit_type)
        sb.from('crm_field_visits').select('id, visit_type')
          .eq('rep_id', selectedProfileId)
          .gte('visit_date', start).lt('visit_date', next),
        // Visits where person is in ssc_team_members (any visit_type)
        sb.from('crm_field_visits').select('id, visit_type')
          .contains('ssc_team_members', [selectedProfileId])
          .gte('visit_date', start).lt('visit_date', next),
        // Hero products: count distinct orders that include any of this month's hero products, by account_owner, in month
        heroForMonth.length === 0 ? Promise.resolve({ data: [] }) :
          sb.from('order_items').select('orders!inner(id,account_owner,status,is_test,created_at)')
            .in('item_code', heroForMonth)
            .eq('orders.account_owner', accountOwnerName)
            .neq('orders.status', 'cancelled')
            .eq('orders.is_test', false)
            .gte('orders.created_at', start).lt('orders.created_at', next),
      ])

      const actualSales = (salesRes.data || []).reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0), 0)
      // Distinct order count (one order may contain multiple hero items, count once)
      const heroOrderCount = new Set((heroRes.data || []).map(r => r.orders?.id).filter(Boolean)).size

      // Merge visits (dedup by id), then split by type
      const allVisitsMap = new Map()
      ;[...(repVisitsRes.data || []), ...(teamVisitsRes.data || [])].forEach(v => allVisitsMap.set(v.id, v))
      const allVisits = Array.from(allVisitsMap.values())
      const fieldVisits     = allVisits.length
      const principalVisits = allVisits.filter(v => v.visit_type === 'JOINT_PRINCIPAL').length

      auto[k] = {
        actual_sales:     actualSales,
        new_customers:    custRes.count || 0,
        field_visits:     fieldVisits,
        principal_visits: principalVisits,
        hero_products:    heroOrderCount,
      }
    }
    setAutoData(auto)
    setLoading(false)
  }

  const team       = teams.find(t => t.id === selectedTeamId)
  const assignment = assignments.find(a => a.profile_id === selectedProfileId && a.team_id === selectedTeamId)
  const targetEmployee = assignment?.profiles
  const monthlyTarget = Number(assignment?.monthly_target_inr) || 0
  const annualCtc     = Number(assignment?.annual_ctc_inr)     || 0

  const isAdmin = ['admin','management'].includes(user.role)

  // Build merged month data: stored manual values + auto-computed values + derived (ratio, achievement)
  const mergedByMonth = useMemo(() => {
    const out = {}
    months.forEach(m => {
      const k = monthKey(m)
      const stored = monthlyData[k] || {}
      const auto   = autoData[k]    || {}
      const merged = { ...auto, ...stored }   // manual overrides auto
      // If actual_sales not manually overridden, keep auto value
      if (stored.actual_sales == null && auto.actual_sales != null) merged.actual_sales = auto.actual_sales
      const derived = computeDerived(merged, monthlyTarget)
      out[k] = { ...merged, ...derived }
    })
    return out
  }, [monthlyData, autoData, monthlyTarget, months])

  // Score for a month
  function scoreMonth(monthIso) {
    const data = mergedByMonth[monthIso] || {}
    let total = 0
    KPI_DEFS.forEach(def => {
      const v = data[def.key]
      const t = thresholds[def.key]
      total += scoreFor(v, t)
    })
    return total
  }

  // Sums / averages
  const monthScores = months.map(m => ({ m, score: scoreMonth(monthKey(m)) }))
  const avgScore    = monthScores.reduce((s, x) => s + x.score, 0) / 12

  // Dynamic total max = sum of max points per KPI threshold
  const maxScore = useMemo(() => {
    let total = 0
    KPI_DEFS.forEach(def => {
      const t = thresholds[def.key]
      if (!t || !Array.isArray(t.thresholds)) return
      const m = Math.max(...t.thresholds.map(x => Number(x.points) || 0), 0)
      total += m
    })
    return total || 80
  }, [thresholds])

  // ── Save manual KPI value (admin/mgmt only) ──
  async function saveValue(kpiKey, value, monthIso) {
    if (!assignment) { toast('No assignment found'); return }
    if (saving) return
    setSaving(true)
    const num = value === '' ? null : Number(value)
    const { error } = await sb.from('kpi_monthly_data').upsert({
      assignment_id: assignment.id,
      month_start: monthIso,
      kpi_key: kpiKey,
      value: num ?? 0,
      source: 'manual',
      updated_by: user.name,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,month_start,kpi_key' })
    if (error) { toast(friendlyError(error)); setSaving(false); return }
    setMonthlyData(prev => ({ ...prev, [monthIso]: { ...(prev[monthIso] || {}), [kpiKey]: num ?? 0 } }))
    setSaving(false)
  }

  if (loading && !selectedProfileId) {
    return <Layout pageKey="people"><div style={{padding:60,textAlign:'center',color:'var(--gray-400)'}}>Loading...</div></Layout>
  }

  // ── Render ──
  const peopleInTeam = assignments.filter(a => a.team_id === selectedTeamId)
  const restrictedToSelf = !isAdmin
  const selectablePeople = restrictedToSelf
    ? peopleInTeam.filter(a => a.profile_id === user.id)
    : peopleInTeam

  return (
    <Layout pageTitle="KRA / KPI" pageKey="people">
      <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 14 }}>
          <div>
            <button onClick={() => navigate('/people')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', display:'inline-flex', alignItems:'center', gap:4, fontSize:13, padding: 0, marginBottom: 4 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              People
            </button>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--gray-900)' }}>KRA / KPI Tracker</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>FY 20{fy.split('-')[0]}–20{fy.split('-')[1]} · Monthly performance scorecard</div>
          </div>
          {isAdmin && (
            <button onClick={() => navigate('/people/kpi/config')} style={{ padding:'8px 14px', background:'white', border:'1.5px solid var(--gray-200)', borderRadius:7, fontSize:13, fontWeight:600, color:'var(--gray-700)', cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82M4.6 9a1.65 1.65 0 00-.33-1.82"/></svg>
              Configurator
            </button>
          )}
        </div>

        {/* ── Selectors ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 160px', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:5 }}>Department</label>
            <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} disabled={restrictedToSelf}
              style={{ width:'100%', padding:'10px 12px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:14, outline:'none', background:'white' }}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:5 }}>Person</label>
            <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)} disabled={restrictedToSelf}
              style={{ width:'100%', padding:'10px 12px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:14, outline:'none', background:'white' }}>
              {selectablePeople.length === 0 && <option value="">— No assignments —</option>}
              {selectablePeople.map(a => <option key={a.profile_id} value={a.profile_id}>{a.profiles?.name || '—'}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:5 }}>Month</label>
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              style={{ width:'100%', padding:'10px 12px', border:'1.5px solid var(--gray-200)', borderRadius:8, fontSize:14, outline:'none', background:'white' }}>
              {months.map(m => {
                const k = monthKey(m)
                return <option key={k} value={k}>{monthLabel(m)} {String(m.getFullYear()).slice(2)}</option>
              })}
            </select>
          </div>
        </div>

        {!assignment ? (
          <div style={{ padding:60, textAlign:'center', color:'var(--gray-400)', background:'white', border:'1px solid var(--gray-100)', borderRadius:12 }}>
            {selectablePeople.length === 0
              ? 'No KPI assignment found. Admin needs to set up your CTC and target in the configurator first.'
              : 'Select a person to view KPIs.'}
          </div>
        ) : (
          <>
            {/* ── Summary ── */}
            <SummaryStrip
              employee={targetEmployee}
              team={team}
              fy={fy}
              annualCtc={annualCtc}
              monthlyTarget={monthlyTarget}
              annualTarget={Number(assignment.annual_target_inr) || 0}
              currentMonthScore={scoreMonth(selectedMonth)}
              avgScore={avgScore}
              maxScore={maxScore}
            />

            {/* ── Manual inputs (admin) / view (others) ── */}
            <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:12, padding:'16px 20px', marginTop: 14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--gray-900)' }}>Inputs — {monthLabel(new Date(selectedMonth))} {selectedMonth.slice(0,4)}</div>
                  <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:2 }}>
                    {isAdmin ? 'Admin / Management can edit. Auto-pulled values shown alongside.' : 'View-only — admin updates these monthly.'}
                  </div>
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {KPI_INPUTS.map(input => {
                  // For Actual Sales — target is monthly target. For Overdue/Collection — context is collection ratio target.
                  let targetLabel = null
                  if (input.key === 'actual_sales' && monthlyTarget > 0) targetLabel = 'Target: ' + fmtInrCeil(monthlyTarget)
                  if (input.key === 'overdue_amount' || input.key === 'collection_amount') {
                    const t = maxPointsThreshold(thresholds.collection_ratio)
                    if (t != null) targetLabel = 'Aim: collect ' + Math.round(t * 100) + '% of overdue'
                  }
                  return (
                    <InputTile
                      key={input.key}
                      def={input}
                      value={mergedByMonth[selectedMonth]?.[input.key]}
                      autoValue={autoData[selectedMonth]?.[input.key]}
                      storedManual={monthlyData[selectedMonth]?.[input.key]}
                      target={targetLabel}
                      isAdmin={isAdmin}
                      saving={saving}
                      onSave={v => saveValue(input.key, v, selectedMonth)}
                    />
                  )
                })}
                {/* All editable KPIs (manual + auto+manual) */}
                {KPI_DEFS.filter(d => d.source !== 'derived').map(def => {
                  const t = maxPointsThreshold(thresholds[def.key])
                  let targetLabel = null
                  if (t != null) {
                    if (def.key === 'complaints') targetLabel = 'Target: ≤ 0 (' + t + ' for max pts)'
                    else                          targetLabel = 'Target: ' + t + '+ for 10 pts'
                  }
                  return (
                    <InputTile
                      key={def.key}
                      def={def}
                      value={mergedByMonth[selectedMonth]?.[def.key]}
                      autoValue={autoData[selectedMonth]?.[def.key]}
                      storedManual={monthlyData[selectedMonth]?.[def.key]}
                      target={targetLabel}
                      isAdmin={isAdmin}
                      saving={saving}
                      onSave={v => saveValue(def.key, v, selectedMonth)}
                    />
                  )
                })}
              </div>
            </div>

            {/* ── 8 KPI Tiles ── */}
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 10 }}>KPI Scorecard</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {KPI_DEFS.map(def => (
                  <KpiTile
                    key={def.key}
                    def={def}
                    months={months}
                    selectedMonth={selectedMonth}
                    valueByMonth={Object.fromEntries(months.map(m => [monthKey(m), mergedByMonth[monthKey(m)]?.[def.key]]))}
                    threshold={thresholds[def.key]}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

// ── Components ──

function SummaryStrip({ employee, team, fy, annualCtc, monthlyTarget, annualTarget, currentMonthScore, avgScore, maxScore }) {
  const goodThr = maxScore * 0.75, okThr = maxScore * 0.5
  return (
    <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:12, padding:'18px 22px', display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr 1fr', gap: 16, alignItems:'center' }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Employee</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--gray-900)', marginTop: 2 }}>{employee?.name || '—'}</div>
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 2 }}>{team?.name} · FY 20{fy.split('-')[0]}–20{fy.split('-')[1]}</div>
      </div>
      <SmallStat label="Annual CTC" value={fmtInr(annualCtc)} />
      <SmallStat label="Annual Target" value={fmtInrCeil(annualTarget)} />
      <SmallStat label="Monthly Target" value={fmtInrCeil(monthlyTarget)} />
      <SmallStat label="Month Score" value={`${currentMonthScore} / ${maxScore}`} color={currentMonthScore >= goodThr ? '#059669' : currentMonthScore >= okThr ? '#d97706' : '#dc2626'} />
      <SmallStat label="YTD Avg" value={`${avgScore.toFixed(1)} / ${maxScore}`} color={avgScore >= goodThr ? '#059669' : avgScore >= okThr ? '#d97706' : '#dc2626'} />
    </div>
  )
}

function SmallStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || 'var(--gray-900)', marginTop: 3, fontFamily: 'var(--mono)' }}>{value}</div>
    </div>
  )
}

function InputTile({ def, value, autoValue, storedManual, target, isAdmin, saving, onSave }) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)

  function startEdit() { setDraft(storedManual != null ? String(storedManual) : autoValue != null ? String(autoValue) : ''); setEditing(true) }
  function commit()    { onSave(draft); setEditing(false) }
  function cancel()    { setEditing(false); setDraft('') }

  const display = fmtVal(value, def.format)
  const hasOverride = storedManual != null && autoValue != null && Number(storedManual) !== Number(autoValue)

  return (
    <div style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 9, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: KRA_COLORS[def.kra], background: 'white', padding: '2px 6px', borderRadius: 4 }}>{def.kra}</span>
        {def.source === 'auto' && <span style={{ fontSize: 9, color: '#0369a1', fontWeight: 600 }}>AUTO</span>}
        {def.source === 'manual' && <span style={{ fontSize: 9, color: '#92400e', fontWeight: 600 }}>MANUAL</span>}
        {def.source === 'auto+manual' && <span style={{ fontSize: 9, color: '#7e22ce', fontWeight: 600 }}>{hasOverride ? 'OVERRIDDEN' : 'AUTO'}</span>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray-700)', marginBottom: target ? 2 : 6 }}>{def.label}</div>
      {target && <div style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 600, marginBottom: 6 }}>{target}</div>}
      {editing && isAdmin ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <input type="number" step="any" value={draft} onChange={e => setDraft(e.target.value)} autoFocus
            style={{ flex: 1, padding: '6px 8px', fontSize: 14, fontFamily: 'var(--mono)', border: '1.5px solid var(--blue-700)', borderRadius: 5, outline: 'none' }} />
          <button onClick={commit} disabled={saving} style={{ padding: '6px 10px', background: 'var(--blue-700)', color: 'white', border: 'none', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓</button>
          <button onClick={cancel} style={{ padding: '6px 10px', background: 'white', border: '1.5px solid var(--gray-200)', borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>×</button>
        </div>
      ) : (
        <div onClick={isAdmin && def.source !== 'auto' ? startEdit : undefined}
          style={{ cursor: isAdmin && def.source !== 'auto' ? 'pointer' : 'default' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gray-900)', fontFamily: 'var(--mono)' }}>{display}</div>
          {def.source === 'auto+manual' && hasOverride && (
            <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>Auto: {fmtVal(autoValue, def.format)}</div>
          )}
          {isAdmin && def.source !== 'auto' && (
            <div style={{ fontSize: 10, color: 'var(--blue-700)', marginTop: 4 }}>Click to edit</div>
          )}
        </div>
      )}
    </div>
  )
}

function KpiTile({ def, months, selectedMonth, valueByMonth, threshold }) {
  const targetVal = maxPointsThreshold(threshold)
  let targetLabel = null
  if (targetVal != null) {
    if (def.format === 'pct')      targetLabel = 'Target: ' + Math.round(targetVal * 100) + '%'
    else if (def.key === 'complaints') targetLabel = 'Target: ' + targetVal + ' or fewer'
    else                            targetLabel = 'Target: ' + targetVal + '+'
  }
  const monthKeys = months.map(m => monthKey(m))
  const values    = monthKeys.map(k => Number(valueByMonth[k]) || 0)
  const scores    = monthKeys.map((k, i) => scoreFor(values[i], threshold))
  const idx       = monthKeys.indexOf(selectedMonth)
  const curVal    = values[idx]
  const curScore  = scores[idx]
  const max       = Math.max(...values, 1)
  const W = 280, H = 80, PL = 6, PR = 6, PT = 8, PB = 8
  const innerW = W - PL - PR, innerH = H - PT - PB
  const stepX  = months.length > 1 ? innerW / (months.length - 1) : 0
  const pts    = months.map((m, i) => [PL + i * stepX, PT + innerH - (values[i] / max) * innerH])
  const path   = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0] + ',' + p[1]).join(' ')

  return (
    <div style={{ background: 'white', border: '1px solid var(--gray-100)', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'white', background: KRA_COLORS[def.kra], padding: '2px 6px', borderRadius: 4 }}>{def.kra}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase' }}>{KRA_LABELS[def.kra]}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-900)' }}>{def.label}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: curScore >= 8 ? '#059669' : curScore >= 6 ? '#d97706' : 'var(--gray-400)', fontFamily: 'var(--mono)', lineHeight: 1 }}>{curScore}</div>
          <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 2 }}>/ 10 pts</div>
        </div>
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--gray-900)', fontFamily: 'var(--mono)', marginTop: 4 }}>
        {fmtVal(curVal, def.format)}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
          {monthLabel(months[idx])} {String(months[idx].getFullYear()).slice(2)}
        </div>
        {targetLabel && <div style={{ fontSize: 10, color: '#1d4ed8', fontWeight: 600 }}>{targetLabel}</div>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', height: 60 }}>
        <path d={path} fill="none" stroke={KRA_COLORS[def.kra]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === idx ? 3.5 : 2} fill={i === idx ? KRA_COLORS[def.kra] : 'white'} stroke={KRA_COLORS[def.kra]} strokeWidth={i === idx ? 0 : 1.5} />
        ))}
      </svg>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'var(--gray-400)', marginTop:2 }}>
        <span>{monthLabel(months[0])}</span>
        <span>{monthLabel(months[5])}</span>
        <span>{monthLabel(months[11])}</span>
      </div>
    </div>
  )
}
