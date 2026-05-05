// Reusable KPI configurator — used inside the slide-in drawer (PeopleKpi.jsx)
// AND inside the full-page route (PeopleKpiConfig.jsx).
// Renders 3 main tabs: Scoring Thresholds, Hero Products, Employees & Targets.

import { useEffect, useState, useMemo } from 'react'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Typeahead from './Typeahead'
import { currentFyLabel, fmtInr, fmtInrCeil } from '../lib/kpi'
import { listAvailableFetchers } from '../lib/kpiFetchers'

const FALLBACK_KRA = '#64748B'
const MONTHS_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function KpiConfigurator({ teams, thresholdsByTeam, onSaved }) {
  const [tab, setTab] = useState('scoring')   // scoring | hero | employees | definitions | kras
  const [defsByTeam, setDefsByTeam] = useState({})
  const [krasByTeam, setKrasByTeam] = useState({})

  useEffect(() => { reloadMeta() }, [])
  async function reloadMeta() {
    const [d, k] = await Promise.all([
      sb.from('kpi_definitions').select('*').order('sort_order'),
      sb.from('kpi_kra_categories').select('*').order('sort_order'),
    ])
    const dm = {}; (d.data || []).forEach(r => { (dm[r.team_id] ||= []).push(r) })
    const km = {}; (k.data || []).forEach(r => { (km[r.team_id] ||= {})[r.code] = r })
    setDefsByTeam(dm); setKrasByTeam(km)
  }
  function refreshAll() { reloadMeta(); onSaved?.() }

  return (
    <>
      <div className="drawer-tabs">
        {[
          { key: 'scoring',     label: 'Scoring Thresholds' },
          { key: 'hero',        label: 'Hero Products' },
          { key: 'employees',   label: 'Employees & Targets' },
          { key: 'definitions', label: 'KPI Definitions' },
          { key: 'kras',        label: 'KRAs' },
        ].map(t => (
          <button key={t.key} className={`drawer-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'scoring' && <ScoringTab teams={teams} thresholdsByTeam={thresholdsByTeam} defsByTeam={defsByTeam} krasByTeam={krasByTeam} onSaved={onSaved} />}
        {tab === 'hero' && <HeroProductsTab onSaved={onSaved} />}
        {tab === 'employees' && <EmployeesTab teams={teams} onSaved={onSaved} />}
        {tab === 'definitions' && <DefinitionsTab teams={teams} defsByTeam={defsByTeam} krasByTeam={krasByTeam} onSaved={refreshAll} />}
        {tab === 'kras' && <KrasTab teams={teams} krasByTeam={krasByTeam} onSaved={refreshAll} />}
      </div>
    </>
  )
}

// ── Scoring Thresholds tab ──
function ScoringTab({ teams, thresholdsByTeam, defsByTeam = {}, krasByTeam = {}, onSaved }) {
  const [activeTeamId, setActiveTeamId] = useState(teams[0]?.id || '')
  const teamDefs = (defsByTeam[activeTeamId] || []).filter(d => d.is_scored)
  const teamKras = krasByTeam[activeTeamId] || {}
  const [activeKpi, setActiveKpi] = useState(teamDefs[0]?.kpi_key || '')
  useEffect(() => { if (!activeKpi || !teamDefs.find(d => d.kpi_key === activeKpi)) setActiveKpi(teamDefs[0]?.kpi_key || '') }, [activeTeamId, teamDefs.length])
  const threshold = thresholdsByTeam[activeTeamId]?.[activeKpi]
  const [rows, setRows] = useState(() => threshold?.thresholds || [])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setRows(threshold?.thresholds || [])
    setDirty(false)
  }, [activeTeamId, activeKpi, threshold?.id])

  const def = teamDefs.find(k => k.kpi_key === activeKpi) || {}
  const isExact = threshold?.match_type === 'exact'
  const maxPts = Math.max(...rows.map(r => Number(r.points) || 0), 0)

  function update(idx, field, val) {
    let n = Number(val); if (isNaN(n)) n = 0
    if (n < 0) n = 0
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: n } : r))
    setDirty(true)
  }
  function addRow() { setRows(prev => [...prev, isExact ? { value: 0, points: 0 } : { min: 0, points: 0 }]); setDirty(true) }
  function removeRow(idx) { setRows(prev => prev.filter((_, i) => i !== idx)); setDirty(true) }
  async function save() {
    const sorted = isExact
      ? [...rows].sort((a,b) => (a.value||0) - (b.value||0))
      : [...rows].sort((a,b) => (a.min||0) - (b.min||0))
    const { error } = await sb.from('kpi_thresholds').update({ thresholds: sorted, updated_at: new Date().toISOString() }).eq('id', threshold.id)
    if (error) { toast(friendlyError(error)); return }
    toast('Saved', 'success'); setDirty(false); onSaved?.()
  }

  if (!threshold) return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No thresholds configured for this team.</div>

  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '12px 28px', borderBottom: '1px solid #E8EBF0', background: '#FBFBFD' }}>
        {teams.map(t => (
          <button key={t.id} className={`drawer-tab ${activeTeamId === t.id ? 'on' : ''}`} onClick={() => setActiveTeamId(t.id)}>
            <span className="drawer-tab-dot" style={{ background: t.name === 'Growth' ? '#7C3AED' : '#0EA5E9' }}/>{t.name}
          </button>
        ))}
      </div>
      <div className="drawer-body">
        <div className="cfg-side">
          <div className="cfg-side-label">KPI</div>
          {teamDefs.map(k => {
            const t = thresholdsByTeam[activeTeamId]?.[k.kpi_key]
            const m = t?.thresholds ? Math.max(...t.thresholds.map(x => Number(x.points) || 0), 0) : 0
            return (
              <button key={k.kpi_key} className={`cfg-side-btn ${activeKpi === k.kpi_key ? 'on' : ''}`} onClick={() => setActiveKpi(k.kpi_key)}>
                <span className="cfg-side-tag" style={{ background: teamKras[k.kra]?.color || FALLBACK_KRA }}>{k.kra}</span>
                <span className="cfg-side-name">{k.label}</span>
                <span className="cfg-side-max">{m}</span>
              </button>
            )
          })}
        </div>
        <div className="cfg-main">
          <div className="cfg-head">
            <div>
              <div className="cfg-kpi-name">{def.label}</div>
              <div className="cfg-kpi-desc">Max {maxPts} pts</div>
            </div>
            <button className="btn-ghost small" onClick={addRow}>+ Add row</button>
          </div>
          <ScoreLadder def={def} rows={rows} maxPts={maxPts}/>
          <div className="cfg-rows">
            <div className="cfg-row cfg-row-head"><div>{isExact ? 'Count' : (def.format === 'pct' ? '% / Ratio' : 'Min')}</div><div>Points (0–20)</div><div></div></div>
            {rows.map((r, idx) => (
              <div key={idx} className="cfg-row">
                <div><input type="number" step="any" min="0" value={isExact ? (r.value ?? 0) : (r.min ?? 0)} onChange={e => update(idx, isExact ? 'value' : 'min', e.target.value)} className="cfg-input"/></div>
                <div className="cfg-slider-cell">
                  <input type="range" min="0" max="20" step="1" value={r.points || 0} onChange={e => update(idx, 'points', e.target.value)} className="cfg-slider"/>
                  <span className="cfg-slider-val">{r.points || 0}</span>
                </div>
                <button className="cfg-row-del" onClick={() => removeRow(idx)} aria-label="Delete">×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button className="btn-primary" onClick={save} disabled={!dirty}>{dirty ? 'Save changes' : 'Saved'}</button>
          </div>
        </div>
      </div>
    </>
  )
}

function ScoreLadder({ def, rows, maxPts }) {
  const W = 600, H = 110
  if (!rows.length) return <div className="cfg-ladder"><div className="cfg-ladder-cap">No rows yet</div></div>
  const xVals = rows.map(r => Number(r.min ?? r.value) || 0)
  const maxX = Math.max(...xVals, 0.001)
  const x = v => 24 + (v / maxX) * (W - 48)
  const y = pts => H - 22 - (pts / Math.max(maxPts, 1)) * (H - 44)
  const sorted = [...rows].sort((a, b) => (Number(a.min ?? a.value) || 0) - (Number(b.min ?? b.value) || 0))
  const path = sorted.map((t, i) => `${i===0?'M':'L'} ${x(Number(t.min ?? t.value)||0)} ${y(t.points||0)}`).join(' ')
  return (
    <div className="cfg-ladder">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {[0,0.25,0.5,0.75,1].map(p => (
          <line key={p} x1="24" x2={W-24} y1={y(p*maxPts)} y2={y(p*maxPts)} stroke="#EEF1F5"/>
        ))}
        <path d={path} stroke={'#0A2540'} strokeWidth="2" fill="none" strokeLinejoin="round"/>
        {sorted.map((t, i) => (
          <g key={i}>
            <circle cx={x(Number(t.min ?? t.value)||0)} cy={y(t.points||0)} r="5" fill="#fff" stroke={'#0A2540'} strokeWidth="2.5"/>
            <text x={x(Number(t.min ?? t.value)||0)} y={y(t.points||0) - 10} fontSize="10" textAnchor="middle" fontFamily="Geist Mono, monospace" fill="#475569">{t.points||0}pt</text>
          </g>
        ))}
      </svg>
      <div className="cfg-ladder-cap">Threshold ladder · {rows.length} steps</div>
    </div>
  )
}

// ── Hero Products tab ──
function HeroProductsTab({ onSaved }) {
  const fy = currentFyLabel()
  const [rows, setRows] = useState([])
  const [items, setItems] = useState([])               // full catalogue cache
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [pickBrand,       setPickBrand]       = useState('')
  const [pickCategory,    setPickCategory]    = useState('')
  const [pickSubcategory, setPickSubcategory] = useState('')
  const [pickSeries,      setPickSeries]      = useState('')
  const [loading, setLoading] = useState(true)
  const [actorName, setActorName] = useState('')

  useEffect(() => {
    async function loadAllItems() {
      // Page through items 1000 at a time so the option lists are complete.
      const out = []
      let from = 0
      while (true) {
        const { data, error } = await sb.from('items')
          .select('brand,category,subcategory,series')
          .eq('is_active', true)
          .range(from, from + 999)
        if (error || !data || data.length === 0) break
        out.push(...data)
        if (data.length < 1000) break
        from += 1000
      }
      return out
    }

    Promise.all([
      sb.from('kpi_hero_products').select('*').order('month_start', { ascending: false }),
      loadAllItems(),
      sb.auth.getSession().then(({ data }) => sb.from('profiles').select('name').eq('id', data?.session?.user?.id || '').single()),
    ]).then(([hp, its, p]) => {
      setRows(hp.data || [])
      setItems(its)
      setActorName(p.data?.name || '')
      setLoading(false)
    })
  }, [])

  // Cascading option lists — each level filters by the picks above it.
  const distinct = (key, filter) => {
    const out = new Set()
    items.forEach(it => { if (filter(it) && it[key]) out.add(it[key]) })
    return [...out].sort()
  }
  const brands       = distinct('brand',       () => true)
  const categories   = distinct('category',    it => !pickBrand || it.brand === pickBrand)
  const subcategories= distinct('subcategory', it => (!pickBrand || it.brand === pickBrand) && (!pickCategory || it.category === pickCategory))
  const seriesList   = distinct('series',      it => (!pickBrand || it.brand === pickBrand) && (!pickCategory || it.category === pickCategory) && (!pickSubcategory || it.subcategory === pickSubcategory))

  // Clear lower picks if they're no longer valid after the parent changes.
  useEffect(() => { if (pickCategory && !categories.includes(pickCategory)) setPickCategory('') }, [pickBrand]) // eslint-disable-line
  useEffect(() => { if (pickSubcategory && !subcategories.includes(pickSubcategory)) setPickSubcategory('') }, [pickBrand, pickCategory]) // eslint-disable-line
  useEffect(() => { if (pickSeries && !seriesList.includes(pickSeries)) setPickSeries('') }, [pickBrand, pickCategory, pickSubcategory]) // eslint-disable-line

  const months = (() => {
    const now = new Date()
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const out = []
    for (let i = 0; i < 12; i++) {
      const m = 3 + i, yr = startYear + Math.floor(m / 12), month = m % 12
      out.push(new Date(yr, month, 1))
    }
    return out
  })()

  const monthRows = rows.filter(it => it.month_start.slice(0, 10) === selectedMonth)

  async function add() {
    if (!pickCategory) { toast('Category is required'); return }
    if (monthRows.length >= 5) { toast('Max 5 hero entries per month — remove one first'); return }
    const dup = monthRows.some(r =>
      (r.brand || '')       === pickBrand &&
      (r.category || '')    === pickCategory &&
      (r.subcategory || '') === pickSubcategory &&
      (r.series || '')      === pickSeries
    )
    if (dup) { toast('Already added for this month'); return }
    const { error } = await sb.from('kpi_hero_products').insert({
      month_start: selectedMonth,
      brand:       pickBrand       || null,
      category:    pickCategory    || null,
      subcategory: pickSubcategory || null,
      series:      pickSeries      || null,
      added_by: actorName,
    })
    if (error) { toast(friendlyError(error)); return }
    toast('Added', 'success'); setPickBrand(''); setPickCategory(''); setPickSubcategory(''); setPickSeries(''); reload()
  }
  async function remove(id) {
    const { error } = await sb.from('kpi_hero_products').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Removed', 'success'); reload()
  }
  async function reload() {
    const { data } = await sb.from('kpi_hero_products').select('*').order('month_start', { ascending: false })
    setRows(data || []); onSaved?.()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Loading…</div>

  return (
    <div style={{ padding: '20px 28px', overflow: 'auto' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#0B1B30' }}>Hero Products by Month</div>
        <div style={{ fontSize: 12, color: '#5B6878', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>FY 20{fy.split('-')[0]}–20{fy.split('-')[1]} · pick brand + category · up to 5 per month</div>
      </div>

      <div style={{ background: '#FBFBFD', border: '1px solid #E8EBF0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 1fr 1fr 1fr 90px', gap: 10, alignItems: 'flex-start' }}>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: '9px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#FFF' }}>
            {months.map(m => {
              const k = m.toISOString().slice(0, 10)
              return <option key={k} value={k}>{MONTHS_LABELS[m.getMonth()]} {String(m.getFullYear()).slice(2)}</option>
            })}
          </select>
          <select value={pickBrand} onChange={e => setPickBrand(e.target.value)}
            style={{ padding: '9px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#FFF' }}>
            <option value="">— Any brand —</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select value={pickCategory} onChange={e => setPickCategory(e.target.value)}
            style={{ padding: '9px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#FFF' }}>
            <option value="">Category *</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={pickSubcategory} onChange={e => setPickSubcategory(e.target.value)}
            style={{ padding: '9px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#FFF' }}>
            <option value="">— Any sub-category —</option>
            {subcategories.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={pickSeries} onChange={e => setPickSeries(e.target.value)}
            style={{ padding: '9px 10px', border: '1px solid #E8EBF0', borderRadius: 8, fontSize: 13, outline: 'none', background: '#FFF' }}>
            <option value="">— Any series —</option>
            {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={add} disabled={monthRows.length >= 5 || !pickCategory}
            style={{ padding: '9px 14px', background: (monthRows.length >= 5 || !pickCategory) ? '#E8EBF0' : '#0A2540', color: (monthRows.length >= 5 || !pickCategory) ? '#94A3B8' : '#FFF', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: (monthRows.length >= 5 || !pickCategory) ? 'default' : 'pointer' }}>
            Add
          </button>
        </div>
        <div style={{ fontSize: 11, color: monthRows.length >= 5 ? '#92400e' : '#5B6878', marginTop: 8, fontWeight: monthRows.length >= 5 ? 600 : 400 }}>
          {monthRows.length} of 5 selected for {MONTHS_LABELS[new Date(selectedMonth).getMonth()]} {String(new Date(selectedMonth).getFullYear()).slice(2)}
        </div>
      </div>

      <div style={{ background: '#FFF', border: '1px solid #E8EBF0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#FBFBFD', borderBottom: '1px solid #E8EBF0' }}>
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }}>Brand</th>
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }}>Category</th>
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }}>Sub-category</th>
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }}>Series</th>
              <th style={{ padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }}>Added by</th>
              <th style={{ width: 80 }}/>
            </tr>
          </thead>
          <tbody>
            {monthRows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94A3B8', fontSize: 13 }}>No hero entries for this month yet.</td></tr>
            )}
            {monthRows.map(it => (
              <tr key={it.id} style={{ borderBottom: '1px solid #EEF1F5' }}>
                <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600 }}>{it.brand || <span style={{ color: '#94A3B8', fontWeight: 400 }}>Any</span>}</td>
                <td style={{ padding: '12px 14px', fontSize: 13 }}>{it.category || <span style={{ color: '#94A3B8' }}>Any</span>}</td>
                <td style={{ padding: '12px 14px', fontSize: 13 }}>{it.subcategory || <span style={{ color: '#94A3B8' }}>Any</span>}</td>
                <td style={{ padding: '12px 14px', fontSize: 13 }}>{it.series || <span style={{ color: '#94A3B8' }}>Any</span>}</td>
                <td style={{ padding: '12px 14px', fontSize: 12, color: '#5B6878' }}>{it.added_by || '—'}</td>
                <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                  <button onClick={() => remove(it.id)} style={{ padding: '5px 10px', background: 'white', border: '1.5px solid #fecaca', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Employees & Targets tab ──
function EmployeesTab({ teams, onSaved }) {
  const fy = currentFyLabel()
  const [profiles, setProfiles] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newProfileId, setNewProfileId] = useState('')
  const [newTeamId, setNewTeamId] = useState(teams[0]?.id || '')
  const [newCtc, setNewCtc] = useState('')
  const [newMultiplier, setNewMultiplier] = useState('40')
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({ annual_ctc_inr: 0, target_multiplier: 0 })

  useEffect(() => { reload() }, [])
  async function reload() {
    setLoading(true)
    const [p, a] = await Promise.all([
      sb.from('profiles').select('id,name,role,username').in('role',['sales','ops','admin','management','accounts','fc_kaveri','fc_godawari']).order('name'),
      sb.from('kpi_assignments').select('*, profiles(name)').eq('fy_label', fy),
    ])
    setProfiles(p.data || []); setAssignments(a.data || []); setLoading(false)
  }

  function compute(ctc, mult) { return Math.round((Number(ctc) || 0) * (Number(mult) || 0)) }

  async function createA() {
    if (!newProfileId || !newTeamId) { toast('Pick person + team'); return }
    const ctc = Number(newCtc) || 0, mult = Number(newMultiplier) || 0, ann = compute(ctc, mult)
    const { error } = await sb.from('kpi_assignments').insert({
      profile_id: newProfileId, team_id: newTeamId, fy_label: fy,
      annual_ctc_inr: ctc, target_multiplier: mult, annual_target_inr: ann, monthly_target_inr: Math.round(ann/12),
    })
    if (error) { toast(friendlyError(error)); return }
    toast('Assigned', 'success'); setShowNew(false); setNewProfileId(''); setNewCtc(''); setNewMultiplier('40'); reload(); onSaved?.()
  }
  function startEdit(a) { setEditingId(a.id); setEditDraft({ annual_ctc_inr: a.annual_ctc_inr || 0, target_multiplier: a.target_multiplier || 0 }) }
  async function saveEdit(id) {
    const ctc = Number(editDraft.annual_ctc_inr) || 0, mult = Number(editDraft.target_multiplier) || 0, ann = compute(ctc, mult)
    const { error } = await sb.from('kpi_assignments').update({
      annual_ctc_inr: ctc, target_multiplier: mult, annual_target_inr: ann, monthly_target_inr: Math.round(ann/12),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Saved', 'success'); setEditingId(null); reload(); onSaved?.()
  }
  async function removeA(id) {
    if (!confirm('Remove this assignment? Their monthly KPI data will also be removed.')) return
    const { error } = await sb.from('kpi_assignments').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Removed', 'success'); reload(); onSaved?.()
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>Loading…</div>

  const usedIds = assignments.map(a => a.profile_id)
  const available = profiles.filter(p => !usedIds.includes(p.id))

  return (
    <div style={{ padding: '20px 28px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#0B1B30' }}>Employees & Targets</div>
          <div style={{ fontSize: 12, color: '#5B6878', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>{assignments.length} assigned · FY 20{fy.split('-')[0]}–20{fy.split('-')[1]}</div>
        </div>
        {!showNew && <button className="btn-primary" onClick={() => setShowNew(true)}>+ Assign person</button>}
      </div>

      {showNew && (
        <div style={{ background: '#FBFBFD', border: '1px solid #0A2540', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#0B1B30' }}>New Assignment</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 140px 110px', gap: 10 }}>
            <select value={newProfileId} onChange={e => setNewProfileId(e.target.value)} style={inp}>
              <option value="">— Person —</option>
              {available.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
            <select value={newTeamId} onChange={e => setNewTeamId(e.target.value)} style={inp}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input type="number" placeholder="Annual CTC (₹)" value={newCtc} onChange={e => setNewCtc(e.target.value)} style={inp} />
            <input type="number" step="any" placeholder="× Multiplier" value={newMultiplier} onChange={e => setNewMultiplier(e.target.value)} style={inp} />
          </div>
          {newCtc && newMultiplier && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#5B6878' }}>
              Computed Annual Target: <strong style={{ color: '#0B1B30', fontFamily: 'Geist Mono, monospace' }}>{fmtInrCeil(compute(newCtc, newMultiplier))}</strong>
              {' · '}Monthly: {fmtInrCeil(compute(newCtc, newMultiplier) / 12)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-primary" onClick={createA}>Create</button>
            <button className="btn-ghost" onClick={() => setShowNew(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: '#FFF', border: '1px solid #E8EBF0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#FBFBFD', borderBottom: '1px solid #E8EBF0' }}>
              <th style={th}>Person</th><th style={th}>Team</th>
              <th style={{ ...th, textAlign: 'right' }}>Annual CTC</th>
              <th style={{ ...th, textAlign: 'right', width: 90 }}>×</th>
              <th style={{ ...th, textAlign: 'right' }}>Annual Target</th>
              <th style={{ ...th, textAlign: 'right' }}>Monthly</th>
              <th style={{ width: 130 }}/>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>No assignments yet.</td></tr>
            )}
            {assignments.map(a => {
              const isEditing = editingId === a.id
              const team = teams.find(t => t.id === a.team_id)
              const liveTarget = isEditing ? compute(editDraft.annual_ctc_inr, editDraft.target_multiplier) : Number(a.annual_target_inr) || 0
              return (
                <tr key={a.id} style={{ borderBottom: '1px solid #EEF1F5' }}>
                  <td style={td}>{a.profiles?.name || '—'}</td>
                  <td style={td}>{team?.name || '—'}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'Geist Mono, monospace' }}>
                    {isEditing
                      ? <input type="number" value={editDraft.annual_ctc_inr} onChange={e => setEditDraft(d => ({ ...d, annual_ctc_inr: e.target.value }))} style={{ ...inp, padding: '5px 7px', width: 130, textAlign: 'right' }}/>
                      : '₹' + Number(a.annual_ctc_inr || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'Geist Mono, monospace' }}>
                    {isEditing
                      ? <input type="number" step="any" value={editDraft.target_multiplier} onChange={e => setEditDraft(d => ({ ...d, target_multiplier: e.target.value }))} style={{ ...inp, padding: '5px 7px', width: 70, textAlign: 'right' }}/>
                      : (a.target_multiplier ? `${a.target_multiplier}×` : '—')}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'Geist Mono, monospace' }}>{fmtInrCeil(liveTarget)}</td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'Geist Mono, monospace', color: '#5B6878' }}>{fmtInrCeil(liveTarget / 12)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(a.id)} style={{ padding: '5px 10px', background: '#0A2540', color: '#FFF', border: 0, borderRadius: 5, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginRight: 6 }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #E8EBF0', borderRadius: 5, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(a)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #E8EBF0', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#1F2A3D', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                        <button onClick={() => removeA(a.id)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #fecaca', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>×</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── KPI Definitions tab (per team — admin can add/edit/remove KPIs) ──
function DefinitionsTab({ teams, defsByTeam, krasByTeam, onSaved }) {
  const [activeTeamId, setActiveTeamId] = useState(teams[0]?.id || '')
  const teamDefs = defsByTeam[activeTeamId] || []
  const teamKras = krasByTeam[activeTeamId] || {}
  const fetchers = listAvailableFetchers()
  const [showNew, setShowNew] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const blank = { kpi_key: '', label: '', kra: Object.keys(teamKras)[0] || '', format: 'int', source: 'manual', auto_key: '', derive_key: '', is_scored: true, sort_order: (teamDefs.length + 1) * 10, help: '' }
  const [draft, setDraft] = useState(blank)

  function start(d) { setEditingId(d.id); setDraft({ ...d, auto_key: d.auto_key || '', derive_key: d.derive_key || '', help: d.help || '' }) }
  function startNew() { setShowNew(true); setEditingId(null); setDraft({ ...blank, kra: Object.keys(teamKras)[0] || '', sort_order: (teamDefs.length + 1) * 10 }) }
  function cancel() { setShowNew(false); setEditingId(null); setDraft(blank) }

  async function save() {
    if (!draft.kpi_key.trim()) { toast('kpi_key required'); return }
    if (!draft.label.trim()) { toast('Label required'); return }
    if (!draft.kra) { toast('KRA required'); return }
    const payload = {
      team_id: activeTeamId,
      kpi_key: draft.kpi_key.trim(),
      label: draft.label.trim(),
      kra: draft.kra,
      format: draft.format,
      source: draft.source,
      auto_key: draft.auto_key || null,
      derive_key: draft.derive_key || null,
      is_scored: !!draft.is_scored,
      sort_order: Number(draft.sort_order) || 0,
      help: draft.help || null,
    }
    let error
    if (editingId) ({ error } = await sb.from('kpi_definitions').update(payload).eq('id', editingId))
    else ({ error } = await sb.from('kpi_definitions').insert(payload))
    if (error) { toast(friendlyError(error)); return }
    toast(editingId ? 'Updated' : 'Created', 'success')
    cancel(); onSaved?.()
  }
  async function remove(id) {
    if (!confirm('Delete this KPI definition? Existing monthly data and thresholds for this kpi_key will stop being scored.')) return
    const { error } = await sb.from('kpi_definitions').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Deleted', 'success'); onSaved?.()
  }

  return (
    <div style={{ padding: '20px 28px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#0B1B30' }}>KPI Definitions</div>
          <div style={{ fontSize: 12, color: '#5B6878', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>{teamDefs.length} defined for the selected team</div>
        </div>
        {!showNew && !editingId && <button className="btn-primary" onClick={startNew}>+ Add KPI</button>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {teams.map(t => (
          <button key={t.id} className={`drawer-tab ${activeTeamId === t.id ? 'on' : ''}`} onClick={() => setActiveTeamId(t.id)}>{t.name}</button>
        ))}
      </div>

      {(showNew || editingId) && (
        <div style={{ background: '#FBFBFD', border: '1px solid #0A2540', borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#0B1B30' }}>{editingId ? 'Edit KPI' : 'New KPI'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={lblSt}>kpi_key (slug)</label>
              <input value={draft.kpi_key} onChange={e => setDraft(d => ({ ...d, kpi_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))} style={inp} placeholder="e.g. order_tat"/>
            </div>
            <div>
              <label style={lblSt}>Label (display name)</label>
              <input value={draft.label} onChange={e => setDraft(d => ({ ...d, label: e.target.value }))} style={inp} placeholder="e.g. Order Turnaround Time"/>
            </div>
            <div>
              <label style={lblSt}>Sort order</label>
              <input type="number" value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: e.target.value }))} style={inp}/>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 110px 130px 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={lblSt}>KRA</label>
              <select value={draft.kra} onChange={e => setDraft(d => ({ ...d, kra: e.target.value }))} style={inp}>
                {Object.values(teamKras).map(k => <option key={k.code} value={k.code}>{k.code} — {k.name}</option>)}
              </select>
            </div>
            <div>
              <label style={lblSt}>Format</label>
              <select value={draft.format} onChange={e => setDraft(d => ({ ...d, format: e.target.value }))} style={inp}>
                <option value="int">Count (int)</option>
                <option value="pct">Percent</option>
                <option value="inr">INR</option>
                <option value="ratio">Ratio</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            <div>
              <label style={lblSt}>Source</label>
              <select value={draft.source} onChange={e => setDraft(d => ({ ...d, source: e.target.value, auto_key: e.target.value === 'auto' || e.target.value === 'auto+manual' ? d.auto_key : '', derive_key: e.target.value === 'derived' ? d.derive_key : '' }))} style={inp}>
                <option value="manual">Manual entry</option>
                <option value="auto">Auto from system</option>
                <option value="auto+manual">Auto + override</option>
                <option value="derived">Derived (computed)</option>
              </select>
            </div>
            <div>
              <label style={lblSt}>{draft.source === 'derived' ? 'derive_key' : 'auto_key'}</label>
              {(draft.source === 'auto' || draft.source === 'auto+manual') ? (
                <select value={draft.auto_key} onChange={e => setDraft(d => ({ ...d, auto_key: e.target.value }))} style={inp}>
                  <option value="">— Pick fetcher —</option>
                  {fetchers.auto.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              ) : draft.source === 'derived' ? (
                <select value={draft.derive_key} onChange={e => setDraft(d => ({ ...d, derive_key: e.target.value }))} style={inp}>
                  <option value="">— Pick formula —</option>
                  {fetchers.derived.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              ) : (
                <input disabled value="(not used for manual)" style={{ ...inp, background: '#F6F7F9', color: '#94A3B8' }}/>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={!!draft.is_scored} onChange={e => setDraft(d => ({ ...d, is_scored: e.target.checked }))}/>
              Scored (counts toward total / has thresholds)
            </label>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={lblSt}>Help text (optional)</label>
            <input value={draft.help || ''} onChange={e => setDraft(d => ({ ...d, help: e.target.value }))} style={inp} placeholder="Short description shown in tooltip"/>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={save}>{editingId ? 'Save changes' : 'Create'}</button>
            <button className="btn-ghost" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: '#FFF', border: '1px solid #E8EBF0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#FBFBFD', borderBottom: '1px solid #E8EBF0' }}>
              <th style={th}>#</th><th style={th}>KRA</th><th style={th}>Key</th><th style={th}>Label</th>
              <th style={th}>Format</th><th style={th}>Source</th><th style={th}>Scored</th>
              <th style={{ width: 130 }}/>
            </tr>
          </thead>
          <tbody>
            {teamDefs.length === 0 && <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>No KPIs defined yet for this team.</td></tr>}
            {teamDefs.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid #EEF1F5' }}>
                <td style={{ ...td, color: '#94A3B8', fontFamily: 'Geist Mono, monospace' }}>{d.sort_order}</td>
                <td style={td}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: 5, background: teamKras[d.kra]?.color || FALLBACK_KRA, color: '#FFF', fontSize: 11, fontWeight: 700, fontFamily: 'Geist Mono, monospace' }}>{d.kra}</span></td>
                <td style={{ ...td, fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{d.kpi_key}</td>
                <td style={{ ...td, fontWeight: 500 }}>{d.label}</td>
                <td style={{ ...td, fontSize: 11, color: '#5B6878', fontFamily: 'Geist Mono, monospace' }}>{d.format}</td>
                <td style={{ ...td, fontSize: 11, color: '#5B6878', fontFamily: 'Geist Mono, monospace' }}>{d.source}{d.auto_key ? ` · ${d.auto_key}` : ''}{d.derive_key ? ` · ${d.derive_key}` : ''}</td>
                <td style={{ ...td }}>{d.is_scored ? '✓' : '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => start(d)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #E8EBF0', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#1F2A3D', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                  <button onClick={() => remove(d.id)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #fecaca', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── KRA categories tab ──
function KrasTab({ teams, krasByTeam, onSaved }) {
  const [activeTeamId, setActiveTeamId] = useState(teams[0]?.id || '')
  const teamKras = Object.values(krasByTeam[activeTeamId] || {}).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const [showNew, setShowNew] = useState(false)
  const [draft, setDraft] = useState({ code: '', name: '', color: '#64748B', sort_order: (teamKras.length + 1) * 10 })
  const [editingId, setEditingId] = useState(null)

  async function save() {
    if (!draft.code.trim() || !draft.name.trim()) { toast('Code + name required'); return }
    const payload = { team_id: activeTeamId, code: draft.code.trim().toUpperCase().slice(0, 4), name: draft.name.trim(), color: draft.color, sort_order: Number(draft.sort_order) || 0 }
    let error
    if (editingId) ({ error } = await sb.from('kpi_kra_categories').update(payload).eq('id', editingId))
    else ({ error } = await sb.from('kpi_kra_categories').insert(payload))
    if (error) { toast(friendlyError(error)); return }
    toast(editingId ? 'Updated' : 'Created', 'success')
    setShowNew(false); setEditingId(null); setDraft({ code: '', name: '', color: '#64748B', sort_order: (teamKras.length + 2) * 10 })
    onSaved?.()
  }
  async function remove(id) {
    if (!confirm('Delete this KRA? KPIs assigned to it will keep the code but lose the colour.')) return
    const { error } = await sb.from('kpi_kra_categories').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Deleted', 'success'); onSaved?.()
  }
  function start(k) { setEditingId(k.id); setDraft({ code: k.code, name: k.name, color: k.color, sort_order: k.sort_order }) }

  return (
    <div style={{ padding: '20px 28px', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: '#0B1B30' }}>KRA Categories</div>
          <div style={{ fontSize: 12, color: '#5B6878', marginTop: 4, fontFamily: 'Geist Mono, monospace' }}>{teamKras.length} categories for the selected team</div>
        </div>
        {!showNew && !editingId && <button className="btn-primary" onClick={() => setShowNew(true)}>+ Add KRA</button>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {teams.map(t => (
          <button key={t.id} className={`drawer-tab ${activeTeamId === t.id ? 'on' : ''}`} onClick={() => setActiveTeamId(t.id)}>{t.name}</button>
        ))}
      </div>

      {(showNew || editingId) && (
        <div style={{ background: '#FBFBFD', border: '1px solid #0A2540', borderRadius: 10, padding: 14, marginBottom: 14, display: 'grid', gridTemplateColumns: '90px 1fr 110px 90px auto', gap: 10, alignItems: 'end' }}>
          <div><label style={lblSt}>Code</label><input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase() }))} style={inp} placeholder="C / O / Q"/></div>
          <div><label style={lblSt}>Name</label><input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inp} placeholder="Collection / Quality"/></div>
          <div><label style={lblSt}>Color</label><input type="color" value={draft.color} onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} style={{ ...inp, padding: 2, height: 38, cursor: 'pointer' }}/></div>
          <div><label style={lblSt}>Sort</label><input type="number" value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: e.target.value }))} style={inp}/></div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-primary" onClick={save}>{editingId ? 'Save' : 'Create'}</button>
            <button className="btn-ghost" onClick={() => { setShowNew(false); setEditingId(null) }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: '#FFF', border: '1px solid #E8EBF0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#FBFBFD', borderBottom: '1px solid #E8EBF0' }}>
              <th style={th}>Sort</th><th style={th}>Code</th><th style={th}>Name</th><th style={th}>Color</th><th style={{ width: 130 }}/>
            </tr>
          </thead>
          <tbody>
            {teamKras.length === 0 && <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: '#94A3B8' }}>No KRAs defined yet.</td></tr>}
            {teamKras.map(k => (
              <tr key={k.id} style={{ borderBottom: '1px solid #EEF1F5' }}>
                <td style={{ ...td, color: '#94A3B8', fontFamily: 'Geist Mono, monospace' }}>{k.sort_order}</td>
                <td style={td}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: 5, background: k.color, color: '#FFF', fontSize: 11, fontWeight: 700, fontFamily: 'Geist Mono, monospace' }}>{k.code}</span></td>
                <td style={{ ...td, fontWeight: 500 }}>{k.name}</td>
                <td style={td}><span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 4, background: k.color, border: '1px solid #E8EBF0' }}/> <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: '#5B6878', marginLeft: 6 }}>{k.color}</span></td>
                <td style={{ ...td, textAlign: 'right' }}>
                  <button onClick={() => start(k)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #E8EBF0', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#1F2A3D', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                  <button onClick={() => remove(k.id)} style={{ padding: '5px 10px', background: '#FFF', border: '1.5px solid #fecaca', borderRadius: 5, fontSize: 12, fontWeight: 600, color: '#dc2626', cursor: 'pointer' }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const lblSt = { display: 'block', fontSize: 10, fontWeight: 600, color: '#5B6878', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4, fontFamily: 'Geist Mono, monospace' }
const inp = { padding: '8px 10px', border: '1px solid #E8EBF0', borderRadius: 7, fontSize: 13, outline: 'none', background: '#FFF', width: '100%' }
const th = { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#5B6878', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '0.4px', fontFamily: 'Geist Mono, monospace' }
const td = { padding: '12px 14px', fontSize: 13 }
