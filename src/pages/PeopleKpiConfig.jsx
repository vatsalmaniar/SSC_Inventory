import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
import { friendlyError } from '../lib/errorMsg'
import { KPI_DEFS, KRA_LABELS, KRA_COLORS, currentFyLabel, fmtInrCeil } from '../lib/kpi'

export default function PeopleKpiConfig() {
  const navigate = useNavigate()
  const guard = useRef(false)
  const [user, setUser]               = useState({ name: '', role: '' })
  const [tab, setTab]                 = useState('assignments')

  // Data
  const [teams, setTeams]             = useState([])
  const [profiles, setProfiles]       = useState([])
  const [assignments, setAssignments] = useState([])
  const [thresholds, setThresholds]   = useState([])
  const [heroItems, setHeroItems]     = useState([])
  const [loading, setLoading]         = useState(true)

  const fy = currentFyLabel()
  const [selectedTeamId, setSelectedTeamId] = useState('')

  useEffect(() => { init() }, [])

  const [accessDenied, setAccessDenied] = useState(false)

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!['admin','management'].includes(profile?.role)) { setAccessDenied(true); setLoading(false); return }
    setUser({ name: profile?.name || '', role: profile?.role })
    await loadAll()
  }

  async function loadAll() {
    setLoading(true)
    const [tRes, pRes, aRes, hRes] = await Promise.all([
      sb.from('kpi_teams').select('*').order('name'),
      sb.from('profiles').select('id,name,role,username').in('role',['sales','ops','admin','management','accounts','fc_kaveri','fc_godawari']).order('name'),
      sb.from('kpi_assignments').select('*, profiles(name)').eq('fy_label', fy),
      sb.from('kpi_hero_products').select('*').order('month_start', { ascending: false }),
    ])
    setTeams(tRes.data || [])
    setProfiles(pRes.data || [])
    setAssignments(aRes.data || [])
    setHeroItems(hRes.data || [])
    if (!selectedTeamId && tRes.data?.length) setSelectedTeamId(tRes.data[0].id)
    setLoading(false)
  }

  // Load thresholds when team changes
  useEffect(() => {
    if (!selectedTeamId) return
    sb.from('kpi_thresholds').select('*').eq('team_id', selectedTeamId).eq('fy_label', fy).then(({ data }) => {
      setThresholds(data || [])
    })
  }, [selectedTeamId, fy])

  if (accessDenied) return (
    <Layout pageKey="people">
      <div style={{ padding:'80px 32px', maxWidth: 600, margin:'0 auto', textAlign:'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 8 }}>Page not found</div>
        <div style={{ fontSize: 14, color: 'var(--gray-500)', marginBottom: 24 }}>This page doesn't exist or you don't have access.</div>
        <button onClick={() => navigate('/people/kpi')} style={{ padding:'10px 18px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>
          Back to KRA / KPI
        </button>
      </div>
    </Layout>
  )
  if (loading) return <Layout pageKey="people"><div style={{padding:60,textAlign:'center'}}>Loading...</div></Layout>

  return (
    <Layout pageTitle="KPI Configurator" pageKey="people">
      <div style={{ padding:'24px 32px', maxWidth: 1180, margin:'0 auto' }}>
        <div style={{ marginBottom: 18 }}>
          <button onClick={() => navigate('/people/kpi')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', display:'inline-flex', alignItems:'center', gap:4, fontSize:13, padding: 0, marginBottom: 4 }}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            KRA / KPI
          </button>
          <div style={{ fontSize:22, fontWeight:700, color:'var(--gray-900)' }}>KPI Configurator</div>
          <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:2 }}>FY 20{fy.split('-')[0]}–20{fy.split('-')[1]} · Admin / management only</div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap: 4, borderBottom:'1px solid var(--gray-200)', marginBottom: 18 }}>
          {[
            { key:'assignments', label:'Employees & Targets' },
            { key:'thresholds',  label:'Scoring Thresholds' },
            { key:'hero',        label:'Hero Products' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding:'10px 16px', background:'none', border:'none', borderBottom: tab === t.key ? '2px solid var(--blue-700)' : '2px solid transparent', color: tab === t.key ? 'var(--blue-700)' : 'var(--gray-500)', fontSize:13, fontWeight:600, cursor:'pointer', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'assignments' && (
          <AssignmentsPanel
            fy={fy} teams={teams} profiles={profiles} assignments={assignments}
            onChange={loadAll} actorName={user.name}
          />
        )}
        {tab === 'thresholds' && (
          <ThresholdsPanel
            teams={teams} fy={fy}
            selectedTeamId={selectedTeamId} setSelectedTeamId={setSelectedTeamId}
            thresholds={thresholds} onChange={() => sb.from('kpi_thresholds').select('*').eq('team_id', selectedTeamId).eq('fy_label', fy).then(({ data }) => setThresholds(data || []))}
          />
        )}
        {tab === 'hero' && (
          <HeroProductsPanel items={heroItems} actorName={user.name} onChange={loadAll} />
        )}
      </div>
    </Layout>
  )
}

// ── Assignments panel ──
function AssignmentsPanel({ fy, teams, profiles, assignments, onChange, actorName }) {
  const [showNew, setShowNew] = useState(false)
  const [newProfileId, setNewProfileId] = useState('')
  const [newTeamId, setNewTeamId]       = useState(teams[0]?.id || '')
  const [newCtc, setNewCtc]             = useState('')
  const [newMultiplier, setNewMultiplier] = useState('40')
  const [editingId, setEditingId]       = useState(null)
  const [editDraft, setEditDraft]       = useState({ annual_ctc_inr: '', target_multiplier: '' })

  function computeTarget(ctc, mult) {
    return Math.round((Number(ctc) || 0) * (Number(mult) || 0))
  }

  async function createAssignment() {
    if (!newProfileId || !newTeamId) { toast('Pick person + team'); return }
    const ctc = Number(newCtc) || 0
    const mult = Number(newMultiplier) || 0
    const ann = computeTarget(ctc, mult)
    const { error } = await sb.from('kpi_assignments').insert({
      profile_id: newProfileId,
      team_id: newTeamId,
      fy_label: fy,
      annual_ctc_inr: ctc,
      target_multiplier: mult,
      annual_target_inr: ann,
      monthly_target_inr: Math.round(ann / 12),
    })
    if (error) { toast(friendlyError(error)); return }
    toast('Assigned', 'success')
    setShowNew(false); setNewProfileId(''); setNewCtc(''); setNewMultiplier('40')
    onChange()
  }

  function startEdit(a) {
    setEditingId(a.id)
    setEditDraft({ annual_ctc_inr: a.annual_ctc_inr || 0, target_multiplier: a.target_multiplier || 0 })
  }

  async function saveEdit(id) {
    const ctc = Number(editDraft.annual_ctc_inr) || 0
    const mult = Number(editDraft.target_multiplier) || 0
    const ann = computeTarget(ctc, mult)
    const { error } = await sb.from('kpi_assignments').update({
      annual_ctc_inr:    ctc,
      target_multiplier: mult,
      annual_target_inr: ann,
      monthly_target_inr: Math.round(ann / 12),
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Saved', 'success'); setEditingId(null); onChange()
  }

  async function removeAssignment(id) {
    if (!confirm('Remove this assignment? Monthly KPI data for this person will also be removed.')) return
    const { error } = await sb.from('kpi_assignments').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Removed', 'success'); onChange()
  }

  const usedProfileIds = assignments.map(a => a.profile_id)
  const availableProfiles = profiles.filter(p => !usedProfileIds.includes(p.id))

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontSize:13, color:'var(--gray-500)' }}>{assignments.length} assigned for FY {fy}</div>
        {!showNew && (
          <button onClick={() => setShowNew(true)} style={{ padding:'8px 14px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>+ Assign Person</button>
        )}
      </div>

      {showNew && (
        <div style={{ background:'white', border:'1px solid var(--blue-700)', borderRadius:10, padding:16, marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>New Assignment</div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 140px 110px', gap:10 }}>
            <select value={newProfileId} onChange={e => setNewProfileId(e.target.value)} style={inputStyle}>
              <option value="">— Person —</option>
              {availableProfiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
            </select>
            <select value={newTeamId} onChange={e => setNewTeamId(e.target.value)} style={inputStyle}>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input type="number" placeholder="Annual CTC (₹)" value={newCtc} onChange={e => setNewCtc(e.target.value)} style={inputStyle} />
            <input type="number" step="any" placeholder="× Multiplier" value={newMultiplier} onChange={e => setNewMultiplier(e.target.value)} style={inputStyle} title="Annual Target = CTC × this multiplier (e.g. 40)" />
          </div>
          {newCtc && newMultiplier && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-500)' }}>
              Computed Annual Target: <strong style={{ color:'var(--gray-900)', fontFamily:'var(--mono)' }}>{fmtInrCeil(computeTarget(newCtc, newMultiplier))}</strong>
              {' · '}Monthly: {fmtInrCeil(computeTarget(newCtc, newMultiplier) / 12)}
            </div>
          )}
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button onClick={createAssignment} style={{ padding:'8px 14px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor:'pointer' }}>Create</button>
            <button onClick={() => setShowNew(false)} style={{ padding:'8px 14px', background:'white', border:'1.5px solid var(--gray-200)', borderRadius:7, fontSize:13, fontWeight:600, color:'var(--gray-600)', cursor:'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:10, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
              <th style={th}>Person</th>
              <th style={th}>Team</th>
              <th style={{ ...th, textAlign:'right' }}>Annual CTC</th>
              <th style={{ ...th, textAlign:'right', width: 110 }}>×</th>
              <th style={{ ...th, textAlign:'right' }}>Annual Target</th>
              <th style={{ ...th, textAlign:'right' }}>Monthly Target</th>
              <th style={{ ...th, width: 130 }}></th>
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 && (
              <tr><td colSpan={7} style={{ padding:40, textAlign:'center', color:'var(--gray-400)' }}>No assignments yet. Click "Assign Person" to start.</td></tr>
            )}
            {assignments.map(a => {
              const isEditing = editingId === a.id
              const team = teams.find(t => t.id === a.team_id)
              const liveTarget = isEditing ? computeTarget(editDraft.annual_ctc_inr, editDraft.target_multiplier) : Number(a.annual_target_inr) || 0
              return (
                <tr key={a.id} style={{ borderBottom:'1px solid var(--gray-50)' }}>
                  <td style={td}>{a.profiles?.name || '—'}</td>
                  <td style={td}>{team?.name || '—'}</td>
                  <td style={{ ...td, textAlign:'right', fontFamily:'var(--mono)' }}>
                    {isEditing
                      ? <input type="number" value={editDraft.annual_ctc_inr} onChange={e => setEditDraft(d => ({ ...d, annual_ctc_inr: e.target.value }))} style={{ ...inputStyle, width: 130, padding:'5px 7px', textAlign:'right' }} />
                      : '₹' + Number(a.annual_ctc_inr || 0).toLocaleString('en-IN')}
                  </td>
                  <td style={{ ...td, textAlign:'right', fontFamily:'var(--mono)' }}>
                    {isEditing
                      ? <input type="number" step="any" value={editDraft.target_multiplier} onChange={e => setEditDraft(d => ({ ...d, target_multiplier: e.target.value }))} style={{ ...inputStyle, width: 80, padding:'5px 7px', textAlign:'right' }} />
                      : (a.target_multiplier ? `${a.target_multiplier}×` : '—')}
                  </td>
                  <td style={{ ...td, textAlign:'right', fontFamily:'var(--mono)', color: isEditing ? 'var(--gray-500)' : 'var(--gray-900)' }}>
                    {fmtInrCeil(liveTarget)}
                  </td>
                  <td style={{ ...td, textAlign:'right', fontFamily:'var(--mono)', color:'var(--gray-500)' }}>
                    {fmtInrCeil(liveTarget / 12)}
                  </td>
                  <td style={{ ...td, textAlign:'right' }}>
                    {isEditing ? (
                      <>
                        <button onClick={() => saveEdit(a.id)} style={{ padding:'5px 10px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer', marginRight: 6 }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ padding:'5px 10px', background:'white', border:'1.5px solid var(--gray-200)', borderRadius:5, fontSize:12, cursor:'pointer' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(a)} style={{ padding:'5px 10px', background:'white', border:'1.5px solid var(--gray-200)', borderRadius:5, fontSize:12, fontWeight:600, color:'var(--gray-700)', cursor:'pointer', marginRight: 6 }}>Edit</button>
                        <button onClick={() => removeAssignment(a.id)} style={{ padding:'5px 10px', background:'white', border:'1.5px solid #fecaca', borderRadius:5, fontSize:12, fontWeight:600, color:'#dc2626', cursor:'pointer' }}>×</button>
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

// ── Thresholds panel ──
function ThresholdsPanel({ teams, fy, selectedTeamId, setSelectedTeamId, thresholds, onChange }) {
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.4px', display:'block', marginBottom:5 }}>Team</label>
        <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)} style={{ ...inputStyle, maxWidth: 260 }}>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
        {KPI_DEFS.map(def => {
          const t = thresholds.find(th => th.kpi_key === def.key)
          if (!t) return null
          return <ThresholdEditor key={def.key} def={def} threshold={t} onSave={onChange} />
        })}
      </div>
    </div>
  )
}

function ThresholdEditor({ def, threshold, onSave }) {
  const [rows, setRows] = useState(() => threshold.thresholds || [])
  const [dirty, setDirty] = useState(false)

  function update(idx, field, val) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: Number(val) || 0 } : r))
    setDirty(true)
  }
  function addRow() {
    setRows(prev => [...prev, threshold.match_type === 'exact' ? { value: 0, points: 0 } : { min: 0, points: 0 }])
    setDirty(true)
  }
  function removeRow(idx) { setRows(prev => prev.filter((_, i) => i !== idx)); setDirty(true) }

  async function save() {
    const sorted = threshold.match_type === 'exact'
      ? [...rows].sort((a, b) => (a.value || 0) - (b.value || 0))
      : [...rows].sort((a, b) => (a.min || 0) - (b.min || 0))
    const { error } = await sb.from('kpi_thresholds').update({
      thresholds: sorted, updated_at: new Date().toISOString(),
    }).eq('id', threshold.id)
    if (error) { toast(friendlyError(error)); return }
    toast(def.label + ' saved', 'success')
    setDirty(false); onSave()
  }

  return (
    <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:10, padding:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
        <span style={{ fontSize:10, fontWeight:700, color:'white', background:KRA_COLORS[def.kra], padding:'2px 6px', borderRadius:4 }}>{def.kra}</span>
        <div style={{ fontSize:13, fontWeight:700, color:'var(--gray-900)', flex: 1 }}>{def.label}</div>
        {(() => {
          const max = Math.max(...rows.map(r => Number(r.points) || 0), 0)
          return <span style={{ fontSize:11, fontWeight:700, color:'var(--blue-700)', background:'#eff6ff', padding:'3px 8px', borderRadius:5 }}>Max {max} pts</span>
        })()}
      </div>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr><th style={{ ...th, padding:'5px 8px' }}>{threshold.match_type === 'exact' ? 'Count' : 'Min'}</th><th style={{ ...th, padding:'5px 8px' }}>Points</th><th style={{ width:30 }} /></tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              <td style={{ padding:'4px 8px' }}>
                <input type="number" step="any"
                  value={threshold.match_type === 'exact' ? r.value : r.min}
                  onChange={e => update(idx, threshold.match_type === 'exact' ? 'value' : 'min', e.target.value)}
                  style={{ width:'100%', padding:'5px 7px', fontSize:12, border:'1px solid var(--gray-200)', borderRadius:4, fontFamily:'var(--mono)' }} />
              </td>
              <td style={{ padding:'4px 8px' }}>
                <input type="number" value={r.points} onChange={e => update(idx, 'points', e.target.value)}
                  style={{ width:'100%', padding:'5px 7px', fontSize:12, border:'1px solid var(--gray-200)', borderRadius:4, fontFamily:'var(--mono)' }} />
              </td>
              <td><button onClick={() => removeRow(idx)} style={{ background:'none', border:'none', color:'var(--gray-400)', cursor:'pointer', fontSize:14 }}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
        <button onClick={addRow} style={{ background:'none', border:'none', color:'var(--blue-700)', cursor:'pointer', fontSize:12, fontWeight:600 }}>+ Add row</button>
        {dirty && <button onClick={save} style={{ padding:'6px 12px', background:'var(--blue-700)', color:'white', border:'none', borderRadius:5, fontSize:12, fontWeight:600, cursor:'pointer' }}>Save</button>}
      </div>
    </div>
  )
}

// ── Hero Products panel (month-scoped) ──
function HeroProductsPanel({ items, actorName, onChange }) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [search, setSearch]   = useState('')
  const [selected, setSelected] = useState(null)

  // FY months for selector
  const months = (() => {
    const now = new Date()
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const out = []
    for (let i = 0; i < 12; i++) {
      const m = 3 + i, yr = fyStartYear + Math.floor(m / 12), month = m % 12
      out.push(new Date(yr, month, 1))
    }
    return out
  })()
  const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

  const monthItems = items.filter(it => it.month_start.slice(0, 10) === selectedMonth)

  async function fetchItems(q) {
    if (!q || q.length < 2) return []
    const { data } = await sb.from('items').select('item_code,item_no,brand').or(`item_code.ilike.%${q}%,item_no.ilike.%${q}%`).eq('is_active', true).limit(20)
    return data || []
  }
  async function add() {
    if (!selected) { toast('Pick an item from the dropdown'); return }
    if (monthItems.length >= 5) { toast('Max 5 hero products per month — remove one first'); return }
    const { error } = await sb.from('kpi_hero_products').insert({ month_start: selectedMonth, item_code: selected.item_code, added_by: actorName })
    if (error) { toast(friendlyError(error)); return }
    toast('Added', 'success'); setSearch(''); setSelected(null); onChange()
  }
  async function remove(id) {
    const { error } = await sb.from('kpi_hero_products').delete().eq('id', id)
    if (error) { toast(friendlyError(error)); return }
    toast('Removed', 'success'); onChange()
  }

  return (
    <div>
      <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:10, padding:14, marginBottom:14 }}>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>Hero products for the month</div>
        <div style={{ fontSize:11, color:'var(--gray-500)', marginBottom:10 }}>Pick up to 5 products each month. Salespeople earn points based on how many of their orders include any hero product.</div>

        <div style={{ display:'grid', gridTemplateColumns:'200px 1fr 100px', gap:10, alignItems:'flex-start' }}>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} style={inputStyle}>
            {months.map(m => {
              const k = m.toISOString().slice(0, 10)
              return <option key={k} value={k}>{monthLabels[m.getMonth()]} {String(m.getFullYear()).slice(2)}</option>
            })}
          </select>
          <Typeahead
            value={search}
            onChange={v => { setSearch(v); if (!v.trim()) setSelected(null) }}
            onSelect={item => { setSelected(item); setSearch(item.item_code) }}
            placeholder="Search item code..."
            fetchFn={fetchItems}
            strictSelect
            renderItem={item => (
              <div>
                <span style={{ fontWeight:600, fontFamily:'var(--mono)', fontSize:12 }}>{item.item_code}</span>
                {item.item_no && <span style={{ color:'var(--gray-400)', marginLeft:8, fontSize:11 }}>{item.item_no}</span>}
                {item.brand && <span style={{ color:'var(--gray-400)', marginLeft:6, fontSize:11 }}>· {item.brand}</span>}
              </div>
            )}
          />
          <button onClick={add} disabled={monthItems.length >= 5}
            style={{ padding:'10px 14px', background: monthItems.length >= 5 ? 'var(--gray-200)' : 'var(--blue-700)', color: monthItems.length >= 5 ? 'var(--gray-400)' : 'white', border:'none', borderRadius:7, fontSize:13, fontWeight:600, cursor: monthItems.length >= 5 ? 'default' : 'pointer' }}>
            Add
          </button>
        </div>
        <div style={{ fontSize:11, color: monthItems.length >= 5 ? '#92400e' : 'var(--gray-500)', marginTop:8, fontWeight: monthItems.length >= 5 ? 600 : 400 }}>
          {monthItems.length} of 5 selected for this month
        </div>
      </div>

      <div style={{ background:'white', border:'1px solid var(--gray-100)', borderRadius:10, overflow:'hidden' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ background:'var(--gray-50)', borderBottom:'1px solid var(--gray-100)' }}>
              <th style={th}>Item Code</th>
              <th style={th}>Added By</th>
              <th style={{ ...th, width: 80 }} />
            </tr>
          </thead>
          <tbody>
            {monthItems.length === 0 && (
              <tr><td colSpan={3} style={{ padding:40, textAlign:'center', color:'var(--gray-400)' }}>No hero products for this month yet.</td></tr>
            )}
            {monthItems.map(it => (
              <tr key={it.id} style={{ borderBottom:'1px solid var(--gray-50)' }}>
                <td style={{ ...td, fontFamily:'var(--mono)', fontWeight:600 }}>{it.item_code}</td>
                <td style={{ ...td, fontSize:12, color:'var(--gray-500)' }}>{it.added_by || '—'}</td>
                <td style={{ ...td, textAlign:'right' }}>
                  <button onClick={() => remove(it.id)} style={{ padding:'5px 10px', background:'white', border:'1.5px solid #fecaca', borderRadius:5, fontSize:12, fontWeight:600, color:'#dc2626', cursor:'pointer' }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const inputStyle = { padding:'8px 10px', border:'1.5px solid var(--gray-200)', borderRadius:7, fontSize:13, outline:'none', background:'white', width:'100%' }
const th = { padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'left', textTransform:'uppercase', letterSpacing:'0.3px' }
const td = { padding:'12px 14px', fontSize:13 }
