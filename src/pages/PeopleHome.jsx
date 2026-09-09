import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { computeDay, isWeekOff, loadWeekOffOverrides, effShift, declarationFor, applyDeclaration, DEFAULT_CFG, istYmd } from '../lib/attendance'
import { fetchAll } from '../lib/fetchAll'
import { visibleEmployees } from '../lib/peopleScope'
import { toast } from '../lib/toast'
import { fmtMoneyShort } from '../lib/fmt'
import { currentFyLabel, fyRange, scoreFor, computeDerived, fmtVal } from '../lib/kpi'
import Layout from '../components/Layout'
import StatusDonut from '../components/StatusDonut'
import Stat from '../components/StatTile'
import LeavePolicyDrawer from '../components/LeavePolicyDrawer'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const DEPT_COLORS = ['#1a73e8','#0E7C6B','#7C3AED','#C2255C','#C25A00','#0369a1','#475569','#0f766e','#B45309','#4f7942']
const initials = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'
const fmtJoin = d => d ? new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'
const ymd = istYmd   // IST work date — never the viewer's timezone

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
// Split by parts, not new Date('yyyy-mm-dd') — that parses as UTC and renders the previous
// day for any viewer west of IST.
const fmtDay = s => { const [y,m,d] = String(s).split('-').map(Number); return y ? `${d} ${MON[m-1]}` : '—' }
const fmtRange = (a,b) => a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`
const dayLabel = (n, iso) => n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fmtDay(iso)
const hhmm = m => m == null ? '—' : `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`

export default function PeopleHome() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState({ name: '', role: '' })
  const [data, setData] = useState({ emps: [], present: 0, onLeave: 0, pendLeave: 0, pendReg: 0, pendExp: 0, devices: 0 })
  const [celebs, setCelebs] = useState([])   // next 30 days: birthdays + work anniversaries
  const [upHol, setUpHol] = useState([])     // next holidays (date + name)
  const [wf, setWf] = useState(null)         // workforce roll-up — admin/management only
  const [kpi, setKpi] = useState(null)       // { people[], defs[], thByTeam, dataByAssign }
  const [kpiWho, setKpiWho] = useState('')   // selected assignment id (admin/management picker)
  const [exp, setExp] = useState(null)       // { rows, month, uid } — this month only
  const [expWho, setExpWho] = useState('all')// 'all' | profile_id
  const [pickable, setPickable] = useState(null)
  const [policy, setPolicy] = useState(false)   // Leave & LOP drawer

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const roleStr = profile?.role || 'sales'
    setUser({ name: profile?.name || '', role: roleStr })

    const now = new Date()
    const today = now.toLocaleDateString('en-CA')
    const d0 = new Date(now); d0.setHours(0,0,0,0)
    const startISO = d0.toISOString()
    // expenses.month_start is a real 1st-of-month date column (verified), so the tile is
    // month-scoped rather than an all-time running total.
    const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1))
    const fyStart = fyRange(currentFyLabel()).start   // Apr 1 — the monthly trend's window
    const safe = p => p.then(r => r.data || []).catch(() => [])
    await loadWeekOffOverrides(sb)   // swapped week-offs (22/29 Aug) before isWeekOff runs
    const [emps, punches, leaves, pl, pr, exp, dev, hol, cel] = await Promise.all([
      safe(sb.from('employees').select('id,full_name,department,designation,join_date,profile_id').eq('is_active', true)),
      safe(sb.from('attendance_punches').select('employee_id').gte('punch_at', startISO)),
      safe(sb.from('leave_requests').select('employee_id').eq('status','approved').lte('from_date', today).gte('to_date', today)),
      safe(sb.from('leave_requests').select('id').in('status', ['pending','mgr_approved'])),
      safe(sb.from('regularizations').select('id').in('status', ['pending','mgr_approved'])),
      fetchAll((f,t) => sb.from('expenses').select('id,status,amount,approved_amount,profile_id,month_start')
        .gte('month_start', fyStart).eq('is_test', false).order('month_start').order('id').range(f,t))
        .then(r => r.data || []).catch(() => []),
      // assigned_to is the RETURN date; null = still issued to someone.
      safe(sb.from('asset_assignments').select('id').is('assigned_to', null)),
      // Upcoming holidays: the table is readable by any signed-in user (hol_read).
      safe(sb.from('holidays').select('id,holiday_date,name').eq('is_active', true).gte('holiday_date', today).order('holiday_date').limit(5)),
      // celebrations_upcoming() is SECURITY DEFINER because date_of_birth lives in
      // employee_private, which RLS keeps to admin/management. It returns the name and the
      // DAY only — never the birth year and never an age. See sql/celebrations_upcoming.sql.
      safe(sb.rpc('celebrations_upcoming', { p_days: 30 })),
    ])
    const thisMonthExp = exp.filter(e => e.month_start === monthStart)
    const pendingExp = thisMonthExp.filter(e => e.status && !['paid','rejected','cancelled','reimbursed'].includes(e.status))
    setData({
      emps,
      present: new Set(punches.map(p => p.employee_id)).size,
      onLeave: new Set(leaves.map(l => l.employee_id)).size,
      pendLeave: pl.length, pendReg: pr.length,
      // Count only — the rupee value and the person filter live in expView, which also
      // knows when a figure is hidden by RLS rather than genuinely zero.
      pendExp: pendingExp.length,
      devices: dev.length,
    })
    setUpHol(hol); setCelebs(cel)
    setExp({ rows: exp, month: monthStart, fyStart, uid: session.user.id })
    setLoading(false)

    // Who this viewer may pick in the tile dropdowns. att_visible_employees() IS the
    // standing rule (admin: everyone; management: everyone except admin logins; others:
    // self only) — sql/people_access_rules.sql. Never re-implement that test in a page.
    const pickedPeople = await loadPickable(roleStr, session.user.id).catch(e => { console.error('pickable:', e?.message || e); return [] })

    // Workforce analytics are admin/management only. Everyone else is RLS-scoped to their
    // own attendance rows, so the same panel would be a one-person "company average" —
    // worse than showing nothing at all.
    if (['admin','management'].includes(roleStr)) {
      loadWorkforce(now).catch(e => console.error('workforce:', e?.message || e))
    }
    loadKpi(roleStr, session.user.id, profile?.name || 'You', pickedPeople).catch(e => console.error('kpi:', e?.message || e))
  }

  // People this viewer may select, plus each one's login role. profiles is world-readable
  // (auth_read: true), and the role is needed to tell "zero claims" apart from "not allowed
  // to see this person's claims" — see expView.
  async function loadPickable(roleStr, uid) {
    const [visRes, empRes, profRes] = await Promise.all([
      visibleEmployees('attendance'),
      sb.from('employees').select('id,profile_id,full_name').eq('is_active', true),
      sb.from('profiles').select('id,role,name'),
    ])
    const allowed = new Set((visRes.data || []).map(v => v.id))
    const roleByProfile = {}; (profRes.data || []).forEach(p => { roleByProfile[p.id] = p.role })
    const people = (empRes.data || [])
      .filter(e => e.profile_id && allowed.has(e.id))
      .map(e => ({ profileId: e.profile_id, name: e.full_name, role: roleByProfile[e.profile_id] || '', isMe: e.profile_id === uid }))
      .sort((a, b) => (b.isMe - a.isMe) || a.name.localeCompare(b.name))
    setPickable({ people, role: roleStr })
    return people
  }

  // ── Sales KPI points ──────────────────────────────────────────────────────────
  // Everyone sees their OWN card. Admin and management additionally get a picker for
  // any individual — is_kpi_admin() is exactly those two roles, so RLS already allows it.
  //
  // SALARY: kpi_assignments carries annual_ctc_inr (the CTC that drives the target
  // multiplier). It is NEVER selected here — the columns are listed explicitly and a
  // `select('*')` on this table must not be reintroduced. Self-service reads go through
  // the kpi_self view, which omits the column outright.
  async function loadKpi(roleStr, uid, myName, pickedPeople) {
    const fy = currentFyLabel()
    const mgmt = ['admin','management'].includes(roleStr)
    const COLS = 'id,profile_id,team_id,monthly_target_inr'   // no annual_ctc_inr, ever

    const [asgRes, defRes, thRes] = await Promise.all([
      mgmt
        ? sb.from('kpi_assignments').select(`${COLS}, profiles(name)`).eq('fy_label', fy).eq('is_active', true)
        : sb.from('kpi_self').select(COLS).eq('fy_label', fy).eq('is_active', true),
      sb.from('kpi_definitions').select('kpi_key,team_id,label,kra,format,source,derive_key,is_scored,sort_order').eq('is_active', true),
      sb.from('kpi_thresholds').select('*').eq('fy_label', fy),
    ])
    const asg = asgRes.data || []
    if (!asg.length) { setKpi(null); return }

    const { data: rows } = await fetchAll((f,t) => sb.from('kpi_monthly_data')
      .select('assignment_id,month_start,kpi_key,value')
      .in('assignment_id', asg.map(a => a.id))
      .order('month_start').order('id').range(f,t))

    const thByTeam = {}
    ;(thRes.data || []).forEach(t => { (thByTeam[t.team_id] ||= {})[t.kpi_key] = t })
    const byAssign = {}
    ;(rows || []).forEach(r => {
      const m = r.month_start.slice(0,10)
      ;((byAssign[r.assignment_id] ||= {})[m] ||= {})[r.kpi_key] = Number(r.value) || 0
    })

    // ⚠️ UI-LEVEL GUARD, and deliberately marked as such.
    // kpi_monthly_data's RLS is `is_kpi_admin() OR kpi_is_mine()`, and is_kpi_admin() is
    // admin OR management — so the database would hand a management user an ADMIN's KPI.
    // The "management sees everyone except admin" rule is NOT enforced server-side for KPI
    // the way it is for attendance (att_can_see) or expenses (exp_read). Filtering the list
    // through att_visible_employees() here closes the hole in the UI only; hardening the
    // policy is a DB change. Today no admin holds an active assignment (9 sales + 1
    // management), so nothing is currently exposed — but do not remove this filter.
    const allowedProfiles = new Set((pickedPeople || []).map(p => p.profileId))
    const people = asg
      .filter(a => a.profile_id === uid || allowedProfiles.has(a.profile_id))   // fails CLOSED
      .map(a => ({
        id: a.id, teamId: a.team_id, target: Number(a.monthly_target_inr) || 0,
        name: a.profiles?.name || (a.profile_id === uid ? myName : '—'),
        isMe: a.profile_id === uid,
      })).sort((x,y) => (y.isMe - x.isMe) || x.name.localeCompare(y.name))
    if (!people.length) { setKpi(null); return }

    setKpi({ people, defs: defRes.data || [], thByTeam, byAssign, mgmt })
    setKpiWho(prev => prev || (people.find(p => p.isMe) || people[0]).id)
  }

  // ── Workforce roll-up ─────────────────────────────────────────────────────────
  // Month-to-date, computed from PUNCHES via computeDay — deliberately NOT read from
  // attendance_days. That table is only materialised in batch (August holds 984
  // app_computed rows; the current month has almost none until it is finalised), so
  // reading it would report a barely-started month as 0% absenteeism. computeDay is the
  // same one formula the muster uses, so these figures agree with what HR sees there.
  async function loadWorkforce(now) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const startS = ymd(start)
    // Stop at the last COMPLETED day. At 09:30 nobody has punched yet, and counting today
    // would report the whole company absent.
    const end = new Date(now); end.setDate(end.getDate() - 1)
    if (end < start) { setWf(null); return }
    const endS = ymd(end)

    const { data: emps } = await visibleEmployees('attendance')   // fails CLOSED, never "everyone"
    const list = (emps || []).filter(e => e.lifecycle_status !== 'exited')
    const ids = list.map(e => e.id)
    if (!ids.length) { setWf(null); return }

    const endExcl = new Date(end); endExcl.setDate(endExcl.getDate() + 1)
    // A full month of punches at this headcount runs past PostgREST's 1000-row cap, and a
    // dropped punch scores as absent — truncation would read as absenteeism.
    const [cfgRes, holRes, pu, lv, decl, sw] = await Promise.all([
      sb.from('attendance_config').select('*').maybeSingle(),
      sb.from('holidays').select('holiday_date').eq('is_active', true),
      fetchAll((f,t) => sb.from('attendance_punches').select('employee_id,punch_at,direction')
        .in('employee_id', ids).gte('punch_at', start.toISOString()).lt('punch_at', endExcl.toISOString())
        .order('punch_at').order('id').range(f,t)),
      fetchAll((f,t) => sb.from('leave_requests').select('employee_id,from_date,to_date,is_half_day,half_period')
        .eq('status','approved').in('employee_id', ids).lte('from_date', endS).gte('to_date', startS)
        .order('from_date').order('id').range(f,t)),
      sb.from('attendance_declarations').select('*').lte('from_date', endS).gte('to_date', startS),
      sb.rpc('att_saturday_workers'),
    ])
    if (pu.error || lv.error) { toast('Workforce figures may be incomplete — could not load the full month.', 'error'); return }

    const config = cfgRes?.data || DEFAULT_CFG
    const holSet = new Set((holRes?.data || []).map(h => h.holiday_date))
    const pm = {}; (pu.data||[]).forEach(p => { (pm[`${p.employee_id}|${ymd(p.punch_at)}`] ||= []).push(p) })
    const lm = {}; (lv.data||[]).forEach(r => { let d=new Date(r.from_date), e=new Date(r.to_date); while(d<=e){ lm[`${r.employee_id}|${ymd(d)}`]=r; d.setDate(d.getDate()+1) } })
    const decls = decl?.data || []
    const satSet = new Set((sw?.data||[]).map(r => r.employee_id))

    const dates = []
    for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)) dates.push(ymd(d))

    let sched=0, present=0, half=0, absent=0, leaveD=0, arrivals=0, onTime=0
    let lop=0, missingPunch=0
    const inMins=[], lateBy=[]
    const dayAgg = new Map()   // work date -> { sched, credit } for the daily trend strip
    const perEmp = new Map()
    list.forEach(e => perEmp.set(e.id, { id:e.id, name:e.full_name, exempt: !!e.attendance_exempt, sched:0, absent:0, late:0, present:0 }))

    for (const e of list) {
      const cfgE = effShift(e, config)
      const satW = satSet.has(e.id)
      const p = perEmp.get(e.id)
      for (const dt of dates) {
        const lvRow = lm[`${e.id}|${dt}`]
        const raw = computeDay({ date: dt, punches: pm[`${e.id}|${dt}`] || [], config: cfgE,
          isHoliday: holSet.has(dt), onLeave: !!lvRow, leaveHalf: !!lvRow?.is_half_day,
          leavePeriod: lvRow?.half_period || 'first', isFC: (e.branch||'').startsWith('FC'),
          exempt: e.attendance_exempt, probation: e.lifecycle_status === 'probation', satWorker: satW })
        // A declared day (rainfall, WFH, calamity) is not an absence — same rule as the muster.
        const c = applyDeclaration(raw, declarationFor(decls, e.branch, dt))
        if (c.status === 'holiday' || c.status === 'weekoff') continue
        sched++; p.sched++
        const agg = dayAgg.get(dt) || { sched: 0, credit: 0 }
        agg.sched++
        if (c.status === 'present') { present++; p.present++; agg.credit += 1 }
        else if (c.status === 'half_day') { half++; agg.credit += 0.5 }
        else if (c.status === 'leave') leaveD++
        else if (c.status === 'absent') { absent++; p.absent++ }
        dayAgg.set(dt, agg)
        // LOP = the day is unpaid (uninformed absence, or leave taken on probation).
        // computeDay owns that decision; this only counts what it returned.
        if (c.is_lop) lop++
        // In-punch with no out-punch. The day still pays, but the hours are unverifiable —
        // it is the number that says how much the muster is guessing.
        if (c.missing_punch) missingPunch++
        if (c.first_in) {
          arrivals++
          inMins.push(c.first_in.getHours()*60 + c.first_in.getMinutes())
          if (c.late_min > 0) { lateBy.push(c.late_min); p.late++ } else onTime++
        }
      }
    }
    const avg = a => a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null
    const pct = (n,d) => d ? Math.round(n/d*1000)/10 : null
    const people = [...perEmp.values()].filter(x => x.sched > 0)
    // Attendance-exempt staff (the four directors) are scored Present by computeDay whether
    // or not they touch a device, so they would top a "never late, never absent" list by
    // definition — recognition nobody earned. Filter on the exemption rather than the role:
    // an admin who does punch earns their place, and a non-admin who is exempted is still
    // excluded. Their days still count in the company attendance figures above.
    const earned = people.filter(x => !x.exempt)
    setWf({
      from: startS, to: endS, headcount: list.length, sched,
      attendancePct: pct(present + half*0.5, sched),
      absenteeismPct: pct(absent, sched),
      punctualityPct: pct(onTime, arrivals),
      avgInMin: avg(inMins), avgLateMin: avg(lateBy),
      absent, half, leaveD, arrivals, lop, missingPunch,
      perfect: earned.filter(x => x.absent === 0 && x.late === 0 && x.present === x.sched).length,
      eligible: earned.length,
      topAbsent: people.filter(x => x.absent > 0).sort((a,b) => b.absent - a.absent).slice(0,6),
      topLate: people.filter(x => x.late > 0).sort((a,b) => b.late - a.late).slice(0,6),
      // Named recognition, not just a percentage: everyone who turned up and was never late.
      onTimePeople: earned.filter(x => x.late === 0 && x.absent === 0 && x.present > 0)
        .sort((a,b) => b.present - a.present || a.name.localeCompare(b.name)),
      days: [...dayAgg.entries()].sort((a,b) => a[0] < b[0] ? -1 : 1)
        .map(([date, a]) => ({ date, pct: a.sched ? Math.round(a.credit / a.sched * 100) : 0 })),
    })
  }

  const isMgmt = ['admin','management'].includes(user.role)

  // This month's expenses for the selected person.
  //
  // A silent ₹0 would be a lie: exp_read lets admin see everything, but management and
  // accounts see only their OWN plus SALES-owned claims — not other management or admin
  // claims. So when the viewer genuinely cannot read a person's claims we say "Restricted"
  // instead of rendering a zero they would read as "spent nothing".
  const expView = useMemo(() => {
    if (!exp) return null
    const OPEN = r => r.status && !['paid','rejected','cancelled','reimbursed'].includes(r.status)
    // rows now span the whole FY (the chart needs the series), so the tile re-filters to
    // the current month.
    const rows = exp.rows.filter(r => r.month_start === exp.month && OPEN(r))
    const monthName = (() => { const [y,m] = exp.month.split('-').map(Number); return `${MON[m-1]} ${y}` })()
    if (expWho === 'all') {
      return { monthName, restricted: false, n: rows.length,
        value: rows.reduce((s,r) => s + (Number(r.amount)||0), 0) }
    }
    const person = pickable?.people.find(p => p.profileId === expWho)
    const readable = user.role === 'admin' || expWho === exp.uid || person?.role === 'sales'
    if (!readable) return { monthName, restricted: true, person }
    const mine = rows.filter(r => r.profile_id === expWho)
    return { monthName, restricted: false, person, n: mine.length,
      value: mine.reduce((s,r) => s + (Number(r.amount)||0), 0) }
  }, [exp, expWho, pickable, user.role])

  // Monthly expense trend for the selected person, April → current month.
  // ALL claims count here, not just open ones: the question a trend answers is "what is
  // this costing per month", and an approved-and-paid claim still cost the money.
  const expSeries = useMemo(() => {
    if (!exp || expView?.restricted) return null
    const rows = expWho === 'all' ? exp.rows : exp.rows.filter(r => r.profile_id === expWho)
    const byMonth = new Map()
    rows.forEach(r => {
      const m = r.month_start
      const a = byMonth.get(m) || { amount: 0, n: 0 }
      a.amount += Number(r.amount) || 0
      a.n += 1
      byMonth.set(m, a)
    })
    // Walk every month from FY start to now so a zero month is a visible gap, not a
    // silently missing column.
    const out = []
    const [fy, fm] = exp.fyStart.split('-').map(Number)
    const cur = new Date(fy, fm - 1, 1)
    const end = new Date(Number(exp.month.slice(0,4)), Number(exp.month.slice(5,7)) - 1, 1)
    while (cur <= end) {
      const key = ymd(cur)
      const a = byMonth.get(key) || { amount: 0, n: 0 }
      out.push({ month: key, label: MON[cur.getMonth()], amount: a.amount, n: a.n, partial: key === exp.month })
      cur.setMonth(cur.getMonth() + 1)
    }
    return out
  }, [exp, expWho, expView])

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()
  const weekoff = isWeekOff(new Date())

  const { headcount, deptAgg, joiners, absent, presentPct, tenureYrs, tenureN } = useMemo(() => {
    const emps = data.emps
    const headcount = emps.length
    const dmap = {}
    emps.forEach(e => { const d = e.department || 'Unassigned'; dmap[d] = (dmap[d]||0)+1 })
    const deptAgg = Object.entries(dmap).map(([name, count], i) => ({ name, count, color: DEPT_COLORS[i % DEPT_COLORS.length] })).sort((a,b)=>b.count-a.count)
    // Last 2 months only — an all-time "newest 6" listed people who joined years ago.
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 2)
    const cutoffS = ymd(cutoff)
    const joiners = [...emps].filter(e => e.join_date && e.join_date >= cutoffS)
      .sort((a,b) => (b.join_date > a.join_date ? 1 : -1)).slice(0,6)
    const absent = weekoff ? 0 : Math.max(0, headcount - data.present - data.onLeave)
    const presentPct = headcount ? Math.round((data.present / headcount) * 100) : 0
    // Average tenure over the people who HAVE a join_date. 3 of the active staff do not,
    // so the footer states the coverage rather than quietly averaging over a smaller set.
    const withJoin = emps.filter(e => e.join_date)
    const tenureYrs = withJoin.length
      ? Math.round(withJoin.reduce((s,e) => s + (Date.now() - new Date(e.join_date)) / 31557600000, 0) / withJoin.length * 10) / 10
      : null
    return { headcount, deptAgg, joiners, absent, presentPct, tenureYrs, tenureN: withJoin.length }
  }, [data, weekoff])

  // One dated list: birthdays, work anniversaries and company holidays interleaved,
  // so "what is coming up" is answered in a single read instead of two cards.
  const agenda = useMemo(() => {
    const todayS = ymd(new Date())
    const dayDiff = iso => {
      const [y,m,d] = String(iso).split('-').map(Number)
      const [ty,tm,td] = todayS.split('-').map(Number)
      return Math.round((Date.UTC(y,m-1,d) - Date.UTC(ty,tm-1,td)) / 86400000)
    }
    const rows = celebs.map(c => ({
      key: `c-${c.employee_id}-${c.kind}-${c.on_date}`,
      icon: c.kind === 'birthday' ? '🎂' : '🎉',
      name: c.full_name,
      sub: c.kind === 'birthday' ? 'Birthday' : `${c.years} year${c.years > 1 ? 's' : ''} at SSC`,
      date: c.on_date, days: c.days_away,
      onClick: () => navigate('/people/team/' + c.employee_id),
    }))
    upHol.forEach(h => rows.push({
      key: `h-${h.id}`, icon: '📅', name: h.name, sub: `Holiday · ${dowName(h.holiday_date)}`,
      date: h.holiday_date, days: dayDiff(h.holiday_date), onClick: null,
    }))
    return rows.filter(r => r.days >= 0).sort((a,b) => a.days - b.days || a.name.localeCompare(b.name))
  }, [celebs, upHol, navigate])

  // Points for the selected person, from the LATEST month that actually has data.
  // KPI is loaded once a month after close, so pinning this to "this month" would show an
  // empty card for most of every month. The card names the month it is showing.
  const kpiView = useMemo(() => {
    if (!kpi || !kpiWho) return null
    const person = kpi.people.find(p => p.id === kpiWho)
    if (!person) return null
    const months = Object.keys(kpi.byAssign[person.id] || {}).sort()
    if (!months.length) return { person, empty: true }
    const monthIso = months[months.length - 1]
    const raw = kpi.byAssign[person.id][monthIso] || {}
    const derived = computeDerived(raw, person.target)
    const all = { ...raw, ...derived }
    const defs = kpi.defs
      .filter(d => d.team_id === person.teamId && d.is_scored)
      .sort((a,b) => (a.sort_order||0) - (b.sort_order||0))
    let total = 0, max = 0
    const rows = defs.map(d => {
      const t = kpi.thByTeam[person.teamId]?.[d.kpi_key]
      const pts = scoreFor(all[d.kpi_key], t) || 0
      const m = t?.thresholds ? Math.max(...t.thresholds.map(x => Number(x.points) || 0), 0) : 10
      total += pts; max += m
      return { key: d.kpi_key, label: d.label, value: all[d.kpi_key], format: d.format, pts, max: m }
    })
    // month_start is written with toISOString(), which shifts an IST 1st back to the
    // previous month's last day — so 2026-07-31 IS August. Read it back the same way.
    const md = new Date(monthIso); md.setDate(md.getDate() + 1)
    return { person, monthIso, monthName: `${MON[md.getMonth()]} ${md.getFullYear()}`, rows, total, max, empty: rows.length === 0 }
  }, [kpi, kpiWho])

  const deptMax = Math.max(1, ...deptAgg.map(d=>d.count))
  const pendingApprovals = data.pendLeave + data.pendReg

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
            <button className="btn-ghost" onClick={() => navigate('/people/attendance')}>Attendance</button>
            {/* Both of these were on the old People page and my rebuild dropped them, so
                the handbook and the leave rules were unreachable from here. Same buttons
                as the My Attendance header. */}
            <button className="ph-link" onClick={()=>setPolicy(true)} title="How leave & LOP work">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
              Leave &amp; LOP
            </button>
            <button className="ph-link" onClick={()=>navigate('/people/handbook')} title="Employee Handbook">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 4h9a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4z" strokeLinejoin="round"/><path d="M4 4v11"/></svg>
              Handbook
            </button>
            <button className="btn-primary" onClick={() => navigate('/people/attendance/leave?apply=1')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              Leave
            </button>
          </div>
        </div>

        {loading ? <div className="o-loading">Loading…</div> : (
          <>
            {/* Bento: four compact stats, one wide anchor, one tall agenda beside them.
                A flat row of five identical tiles read as an undifferentiated wall. */}
            <div className="ph-bento">
              <Stat label="Headcount" value={headcount}
                foot={tenureYrs != null ? <><b>{tenureYrs}</b> yrs avg tenure{tenureN < headcount ? ` · ${tenureN}/${headcount}` : ''}</> : <><b>{deptAgg.length}</b> departments</>}
                onClick={()=>navigate('/people/team')}/>
              <Stat label="Present Today" value={data.present} foot={weekoff ? 'Week-off' : <><b>{presentPct}%</b> of team</>} onClick={()=>navigate('/people/attendance/muster')}/>
              <Stat label="On Leave Today" value={data.onLeave} foot={weekoff ? '—' : <><b>{absent}</b> absent</>} onClick={()=>navigate('/people/attendance/leave')}/>
              <Stat label="Pending Approvals" value={pendingApprovals} warn={pendingApprovals > 0}
                foot={<><b>{data.pendLeave}</b> leave · <b>{data.pendReg}</b> regularize</>} onClick={()=>navigate('/people/attendance/leave')}/>
              {/* Expenses — this month only, with an in-tile person picker for
                  admin/management. The picker list comes from att_visible_employees(). */}
              <div className="ph-stat">
                <div className="ph-stat-l ph-stat-lrow">
                  <span>{isMgmt ? 'Expenses' : 'My Expenses'}</span>
                  {isMgmt && pickable && pickable.people.length > 1 && (
                    <select className="ph-mini" value={expWho} onClick={e => e.stopPropagation()}
                      onChange={e => setExpWho(e.target.value)} title="Whose claims to show">
                      <option value="all">Everyone</option>
                      {pickable.people.map(p => (
                        <option key={p.profileId} value={p.profileId}>{p.isMe ? `${p.name} (you)` : p.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="ph-stat-v" onClick={()=>navigate('/people/expenses')} style={{cursor:'pointer'}}>
                  {expView?.restricted ? '—' : fmtMoneyShort(expView?.value || 0)}
                </div>
                <div className="ph-stat-f">
                  {expView?.restricted
                    ? <span title="exp_read allows admin everything; management and accounts see only their own and sales-owned claims.">Not visible to you</span>
                    : <><b>{expView?.n || 0}</b> open · {expView?.monthName || ''}</>}
                </div>
              </div>

              {/* Anchor. Admin/management get the month's attendance; everyone else gets
                  today's floor, so the slot is never an empty box. */}
              <div className="ph-wide ph-anchor">
                {wf ? (
                  <>
                    <div className="ph-anchor-head">
                      <div>
                        <div className="ph-anchor-eyebrow">Attendance · {fmtRange(wf.from, wf.to)}</div>
                        <div className="ph-anchor-v">{wf.attendancePct != null ? `${wf.attendancePct}%` : '—'}</div>
                        <div className="ph-anchor-sub">{wf.sched} scheduled days · {wf.headcount} people</div>
                      </div>
                      <div className="ph-anchor-stats">
                        <div><div className="ph-as-l">Absenteeism</div><div className="ph-as-v">{wf.absenteeismPct != null ? `${wf.absenteeismPct}%` : '—'}</div></div>
                        <div><div className="ph-as-l">On time</div><div className="ph-as-v">{wf.punctualityPct != null ? `${wf.punctualityPct}%` : '—'}</div></div>
                        <div><div className="ph-as-l">Avg clock-in</div><div className="ph-as-v">{hhmm(wf.avgInMin)}</div></div>
                        <div title="Unpaid days — uninformed absence, or leave taken on probation">
                          <div className="ph-as-l">LOP days</div><div className="ph-as-v">{wf.lop}</div></div>
                        <div title="In-punch with no out-punch. The day still pays, but the hours are unverifiable.">
                          <div className="ph-as-l">Missing punch</div><div className="ph-as-v">{wf.missingPunch}</div></div>
                      </div>
                    </div>
                    <AttendanceChart days={wf.days} />
                  </>
                ) : (
                  <>
                    <div className="ph-anchor-head">
                      <div>
                        <div className="ph-anchor-eyebrow">On the floor · today</div>
                        <div className="ph-anchor-v">{weekoff ? '—' : `${presentPct}%`}</div>
                        <div className="ph-anchor-sub">{weekoff ? 'Week-off' : `${data.present} of ${headcount} people in`}</div>
                      </div>
                      <div className="ph-anchor-stats">
                        <div><div className="ph-as-l">In office</div><div className="ph-as-v">{data.present}</div></div>
                        <div><div className="ph-as-l">On leave</div><div className="ph-as-v">{data.onLeave}</div></div>
                        <div><div className="ph-as-l">Not in</div><div className="ph-as-v">{weekoff ? '—' : absent}</div></div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Agenda — celebrations and holidays merged into one dated list. */}
              <div className="card ph-tall ph-agenda">
                <div className="card-head">
                  <div><div className="card-eyebrow">Next 30 days</div><div className="card-title">Coming Up</div></div>
                  <span className="trend-pill mono">{agenda.length}</span>
                </div>
                <div className="ph-agenda-list">
                  {agenda.length === 0 ? <div className="o-empty">Nothing coming up</div> : agenda.map(a => (
                    <div key={a.key} className="ph-ag-row" onClick={a.onClick} style={a.onClick ? {cursor:'pointer'} : null}>
                      <div className="ph-ag-ic">{a.icon}</div>
                      <div className="ph-ag-b">
                        <div className="ph-ag-n">{a.name}</div>
                        <div className="ph-ag-s">{a.sub}</div>
                      </div>
                      <div className={`ph-ag-r${a.days <= 1 ? ' is-soon' : ''}`}>{dayLabel(a.days, a.date)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sales KPI points. Own card for everyone; admin and management get a picker
                for any individual. No salary field is read — see loadKpi(). */}
            {kpiView && (
              <div className="card" style={{marginTop:16}}>
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">KPI points · {kpiView.monthName || currentFyLabel()}</div>
                    <div className="card-title">{kpi.mgmt ? 'Scorecard' : 'My Scorecard'}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    {kpi.mgmt && kpi.people.length > 1 && (
                      <select className="ph-picker" value={kpiWho} onChange={e => setKpiWho(e.target.value)}>
                        {kpi.people.map(p => <option key={p.id} value={p.id}>{p.isMe ? `${p.name} (you)` : p.name}</option>)}
                      </select>
                    )}
                    {!kpiView.empty && <span className="trend-pill mono">{kpiView.total} / {kpiView.max}</span>}
                  </div>
                </div>
                {/* Deliberately NOT another horizontal bar list — Pending Actions, Most
                    Absent and Most Late were all reading as the same card. A score dial
                    plus per-KPI point pills instead. */}
                {kpiView.empty
                  ? <div className="o-empty">No KPI recorded yet for {kpiView.person.name}</div>
                  : <div className="ph-score">
                      <div className="ph-score-dial" style={{ '--pct': kpiView.max ? kpiView.total / kpiView.max : 0 }}>
                        <div className="ph-score-inner">
                          <div className="ph-score-n">{kpiView.total}</div>
                          <div className="ph-score-of">of {kpiView.max}</div>
                        </div>
                      </div>
                      <div className="ph-score-grid">
                        {kpiView.rows.map(r => {
                          const tone = r.pts >= r.max ? 'good' : r.pts > 0 ? 'warn' : 'bad'
                          return (
                            <div key={r.key} className={`ph-kpi-pill is-${tone}`} title={`Value: ${fmtVal(r.value, r.format)}`}>
                              <div className="ph-kpi-l">{r.label}</div>
                              <div className="ph-kpi-p">{r.pts}<small>/{r.max}</small></div>
                            </div>
                          )
                        })}
                      </div>
                    </div>}
              </div>
            )}

            {/* Recognition sits above the problem cards, deliberately. */}
            {wf && (
              <div className="card" style={{marginTop:16}}>
                <div className="card-head">
                  <div><div className="card-eyebrow">{fmtRange(wf.from, wf.to)} · never late, never absent</div><div className="card-title">Always On Time</div></div>
                  <span className="trend-pill mono">{wf.onTimePeople.length} of {wf.eligible}</span>
                </div>
                {wf.onTimePeople.length === 0
                  ? <div className="o-empty">Nobody with a clean month yet</div>
                  : <div className="ph-chips">
                      {wf.onTimePeople.map(x => (
                        <span key={x.id} className="ph-chip" onClick={()=>navigate('/people/team/'+x.id)}
                          title={`${x.present} day${x.present === 1 ? '' : 's'} present`}>
                          <span className="ph-chip-dot" />{x.name}
                        </span>
                      ))}
                    </div>}
              </div>
            )}

            <div className="o-mid">
              {/* Left column stacks: the department panel is capped at 540px, which left a
                  tall gap beside the analytics column. Recent Joiners fills it. */}
              <div className="ph-left">
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
                {/* .rp-foot is a shared 2-column grid (Orders uses it too), so the third
                    cell is widened here only rather than changing it for both pages. */}
                <div className="rp-foot" style={{gridTemplateColumns:'repeat(3, 1fr)'}}>
                  <div className="rp-foot-cell"><div className="rp-foot-label">DEPARTMENTS</div><div className="rp-foot-val">{deptAgg.length}</div></div>
                  <div className="rp-foot-cell"><div className="rp-foot-label">HEADCOUNT</div><div className="rp-foot-val">{headcount}</div></div>
                  {/* asset_assignments.assigned_to is a DATE — the day the device came
                      back — NOT a person. So `assigned_to IS NULL` means the device is
                      STILL ISSUED. I previously read it as "nobody has it" and relabelled
                      this tile "unassigned", which inverted a correct figure. */}
                  <div className="rp-foot-cell" style={{cursor:'pointer'}} onClick={()=>navigate('/people/assets')}><div className="rp-foot-label">DEVICES IN USE</div><div className="rp-foot-val">{data.devices}</div></div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <div><div className="card-eyebrow">Joined in the last 2 months</div><div className="card-title">Recent Joiners</div></div>
                  <span className="trend-pill mono">{joiners.length}</span>
                </div>
                <div>
                  {joiners.length === 0 ? <div className="o-empty">Nobody joined in the last 2 months</div> : joiners.map(e => (
                    <div key={e.id} onClick={() => navigate('/people/team/'+e.id)} className="ph-join-row">
                      <div className="ph-join-av" style={{ background: DEPT_COLORS[(e.full_name||'').length % DEPT_COLORS.length] }}>{initials(e.full_name)}</div>
                      <div style={{ minWidth:0, flex:1 }}>
                        <div className="ph-join-n">{e.full_name}</div>
                        <div className="ph-join-s">{e.designation || '—'}{e.department ? ' · '+e.department : ''}</div>
                      </div>
                      <div className="ph-join-d">{fmtJoin(e.join_date)}</div>
                    </div>
                  ))}
                </div>
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

                {/* Expense trend sits where Pending Actions used to: that card repeated the
                    leave/regularize counts already in the Pending Approvals tile, and it was
                    the last of the look-alike horizontal bar lists. Columns, not bars. */}
                <div className="card anal-card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">FY {currentFyLabel()} · claimed per month</div>
                      <div className="card-title">Expense Trend</div>
                    </div>
                    {expSeries && <span className="trend-pill mono">{fmtMoneyShort(expSeries.reduce((s,m)=>s+m.amount,0))} FYTD</span>}
                  </div>
                  {isMgmt && pickable && pickable.people.length > 1 && (
                    <select className="ph-picker" style={{marginBottom:8,alignSelf:'flex-start'}}
                      value={expWho} onChange={e => setExpWho(e.target.value)}>
                      <option value="all">Everyone</option>
                      {pickable.people.map(p => (
                        <option key={p.profileId} value={p.profileId}>{p.isMe ? `${p.name} (you)` : p.name}</option>
                      ))}
                    </select>
                  )}
                  {!expSeries
                    ? <div className="o-empty">{expView?.restricted ? 'These claims are not visible to you' : 'No expenses yet'}</div>
                    : <ExpenseColumns series={expSeries} />}
                </div>

                {/* Absence and lateness are different units on different scales — one shared
                    bar chart made "3 days" and "5 times" look comparable. Separate cards. */}
                {wf && (
                  <div className="card anal-card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">{fmtRange(wf.from, wf.to)}</div><div className="card-title">Most Absent</div></div>
                      <span className="trend-pill mono">{wf.absent} day{wf.absent === 1 ? '' : 's'}</span>
                    </div>
                    {/* Ranked rows, not another bar chart — Pending Actions already owns
                        that treatment and every card was starting to look identical. */}
                    <div className="ph-rank">
                      {wf.topAbsent.length === 0
                        ? <div className="o-empty">Nobody was absent</div>
                        : wf.topAbsent.map((x, i) => (
                            <div key={x.id} className="ph-rank-row" onClick={()=>navigate('/people/team/'+x.id)}>
                              <span className="ph-rank-n">{i+1}</span>
                              <span className="ph-rank-name">{x.name}</span>
                              <span className="ph-rank-v is-bad">{x.absent}<small>d</small></span>
                            </div>
                          ))}
                    </div>
                  </div>
                )}

                {wf && (
                  <div className="card anal-card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">{fmtRange(wf.from, wf.to)}</div><div className="card-title">Most Late</div></div>
                      <span className="trend-pill mono">{wf.punctualityPct != null ? `${wf.punctualityPct}% on time` : '—'}</span>
                    </div>
                    <div className="ph-rank">
                      {wf.topLate.length === 0
                        ? <div className="o-empty">Nobody arrived late</div>
                        : wf.topLate.map((x, i) => (
                            <div key={x.id} className="ph-rank-row" onClick={()=>navigate('/people/team/'+x.id)}>
                              <span className="ph-rank-n">{i+1}</span>
                              <span className="ph-rank-name">{x.name}</span>
                              <span className="ph-rank-v is-warn">{x.late}<small>×</small></span>
                            </div>
                          ))}
                    </div>
                  </div>
                )}

              </div>
            </div>
          </>
        )}
      </div>
      <LeavePolicyDrawer open={policy} onClose={()=>setPolicy(false)} />
    </Layout>
  )
}

const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const dowName = s => { const [y,m,d] = String(s).split('-').map(Number); return y ? DOW[new Date(y, m-1, d).getDay()] : '' }

// Monthly expense columns. The current month is still accruing, so it is drawn hatched
// and labelled MTD — a short final bar must not read as spending having collapsed.
function ExpenseColumns({ series }) {
  const max = Math.max(1, ...series.map(m => m.amount))
  return (
    <div className="ph-cols">
      {series.map(m => (
        <div key={m.month} className="ph-col" title={`${m.label}: ${fmtMoneyShort(m.amount)} · ${m.n} claim${m.n === 1 ? '' : 's'}${m.partial ? ' (month to date)' : ''}`}>
          <div className="ph-col-v">{m.amount ? fmtMoneyShort(m.amount) : ''}</div>
          <div className="ph-col-track">
            <div className={`ph-col-fill${m.partial ? ' is-partial' : ''}`}
              style={{ height: `${Math.max(m.amount ? 2 : 0, (m.amount / max) * 100)}%` }} />
          </div>
          <div className="ph-col-l">{m.label}{m.partial ? ' · MTD' : ''}</div>
        </div>
      ))}
    </div>
  )
}

// Daily attendance as an area + line chart, market-chart style.
//
// Drawn at the container's REAL pixel width, measured with a ResizeObserver. The first
// version used a fixed 300-unit viewBox stretched with preserveAspectRatio="none": on a
// ~900px card that scaled x by 3 and y by 1, which squashed the curve horizontally and
// turned the head dot into a flat ellipse. vector-effect fixes stroke weight, not geometry.
// Measuring means one unit is one pixel, so circles are round and the curve is true.
function AttendanceChart({ days }) {
  const wrapRef = useRef(null)
  const [w, setW] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    setW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  const H = 92, PAD_X = 4, PAD_T = 10, PAD_B = 16
  const n = days?.length || 0

  // Hooks must run before any early return (react-hooks/rules-of-hooks), so the geometry
  // is computed unconditionally and the empty cases are handled in the render below.
  const geo = useMemo(() => {
    if (n < 2 || w < 40) return null
    const vals = days.map(d => d.pct)
    // Zoom the y-axis to the data. Attendance sits near 100%, so a fixed 0–100 axis
    // renders every month as the same flat line pinned to the top.
    const lo = Math.max(0, Math.min(...vals) - 6)
    const hi = Math.min(100, Math.max(...vals) + 4)
    const span = Math.max(1, hi - lo)
    const x = i => PAD_X + (i / (n - 1)) * (w - PAD_X * 2)
    const y = v => PAD_T + (1 - (v - lo) / span) * (H - PAD_T - PAD_B)
    const pts = days.map((d, i) => [x(i), y(d.pct)])
    // Smooth with a symmetric cubic so it reads like a market chart, not a jagged polyline.
    let line = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]
      const cx = (x0 + x1) / 2
      line += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`
    }
    const base = H - PAD_B
    return { pts, line, area: `${line} L ${pts[n-1][0].toFixed(1)} ${base} L ${pts[0][0].toFixed(1)} ${base} Z`, base, lo, hi }
  }, [days, n, w])

  if (!n) return <div className="ph-chart-empty">No completed days yet this month</div>
  if (n === 1) return <div className="ph-chart-empty">{days[0].pct}% on {fmtDay(days[0].date)}</div>

  return (
    <div className="ph-chart" ref={wrapRef}>
      {geo && (
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="ph-chart-svg">
          <defs>
            <linearGradient id="ph-att-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.20" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          <line x1="0" y1={geo.base} x2={w} y2={geo.base} className="ph-chart-base" />
          <path d={geo.area} fill="url(#ph-att-fill)" />
          <path d={geo.line} fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
          {geo.pts.map(([px, py], i) => (
            <circle key={days[i].date} cx={px} cy={py} r={i === n - 1 ? 4 : 2.5}
              className={i === n - 1 ? 'ph-chart-head' : 'ph-chart-pt'}>
              <title>{`${fmtDay(days[i].date)} · ${days[i].pct}% present`}</title>
            </circle>
          ))}
        </svg>
      )}
      <div className="ph-chart-axis">
        <span>{fmtDay(days[0].date)}</span>
        <span>{geo ? `${geo.lo}–${geo.hi}%` : ''}</span>
        <span>{fmtDay(days[n-1].date)}</span>
      </div>
    </div>
  )
}
