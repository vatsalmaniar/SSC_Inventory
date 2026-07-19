import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import ExpenseIcon from '../components/ExpenseIcon'
import { fmtMoney } from '../lib/fmt'
import * as EX from '../lib/expense'
import '../styles/kpi-dashboard.css'
import '../styles/orderdetail.css'   // .od-btn family
import '../styles/expenses.css'

// Budgets have two scopes:
//   • branch  → one amount per branch (Petrol; every located person shares it)
//   • person  → one amount for a specific person (Office; Jayshree manages it)
// A person can be toggled in/out of budget tracking entirely.

export default function PeopleExpensesConfig({ embed = false }) {
  const navigate = useNavigate()
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState({})   // `${profile_id}|${category_id}` -> per-person amount
  const [locBud, setLocBud] = useState({})     // `${location}|${category_id}`   -> branch amount
  const [showExcluded, setShowExcluded] = useState(false)
  const [showCats, setShowCats] = useState(false)
  const [addRow, setAddRow] = useState({ person: '', cat: '', amount: '' })
  const [newCat, setNewCat] = useState({ name: '', gl_code: '', monthly_cap: '', budget: 'none', vendor_options: '' })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: p } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!EX.CAN_CONFIG.includes(p?.role)) { setDenied(true); setLoading(false); return }
    await loadAll(); setLoading(false)
  }

  async function loadAll() {
    const [profs, cats, buds, lbuds] = await Promise.all([
      sb.rpc('expense_budget_people'),
      sb.from('expense_categories').select('*').order('sort_order'),
      sb.from('expense_budgets').select('profile_id,category_id,budget_amount').is('month_start', null),
      sb.from('expense_location_budgets').select('location,category_id,budget_amount').is('month_start', null),
    ])
    setPeople(profs.data || [])
    setCategories(cats.data || [])
    const bm = {}; (buds.data || []).forEach(b => { bm[`${b.profile_id}|${b.category_id}`] = b.budget_amount }); setBudgets(bm)
    const lm = {}; (lbuds.data || []).forEach(b => { lm[`${b.location}|${b.category_id}`] = b.budget_amount }); setLocBud(lm)
  }

  // Partial unique index (month_start IS NULL) rules out PostgREST upsert → select-then-write.
  async function savePersonBudget(profileId, categoryId, amount) {
    const val = amount === '' ? null : Number(amount)
    try {
      const { data: ex } = await sb.from('expense_budgets').select('id')
        .eq('profile_id', profileId).eq('category_id', categoryId).is('month_start', null).maybeSingle()
      if (val == null) { if (ex) await sb.from('expense_budgets').delete().eq('id', ex.id) }
      else if (ex) { const { error } = await sb.from('expense_budgets').update({ budget_amount: val }).eq('id', ex.id); if (error) throw error }
      else { const { error } = await sb.from('expense_budgets').insert({ profile_id: profileId, category_id: categoryId, month_start: null, budget_amount: val }); if (error) throw error }
      toast('Saved.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function saveBranchBudget(location, categoryId, amount) {
    const val = amount === '' ? null : Number(amount)
    try {
      const { data: ex } = await sb.from('expense_location_budgets').select('id')
        .eq('location', location).eq('category_id', categoryId).is('month_start', null).maybeSingle()
      if (val == null) { if (ex) await sb.from('expense_location_budgets').delete().eq('id', ex.id) }
      else if (ex) { const { error } = await sb.from('expense_location_budgets').update({ budget_amount: val }).eq('id', ex.id); if (error) throw error }
      else { const { error } = await sb.from('expense_location_budgets').insert({ location, category_id: categoryId, month_start: null, budget_amount: val }); if (error) throw error }
      toast('Branch budget saved.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function savePersonLocation(profileId, location) {
    try {
      const { error } = await sb.rpc('expense_set_person_location', { p_id: profileId, p_location: location || null })
      if (error) throw error
      toast('Location saved.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function toggleInBudget(profileId, on) {
    try {
      const { error } = await sb.rpc('expense_set_budget_flag', { p_id: profileId, p_on: on })
      if (error) throw error
      toast(on ? 'Added to budget.' : 'Removed from budget.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function saveCat(id, patch) {
    try { const { error } = await sb.from('expense_categories').update(patch).eq('id', id); if (error) throw error; loadAll() }
    catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }
  // Budget dropdown value → {is_budgeted, budget_scope}
  function budgetPatch(v) {
    return v === 'branch' ? { is_budgeted: true, budget_scope: 'branch' }
      : v === 'person' ? { is_budgeted: true, budget_scope: 'person' }
      : { is_budgeted: false }
  }
  async function addCat() {
    if (!newCat.name.trim()) { toast('Category name is required.', 'error'); return }
    try {
      const { error } = await sb.from('expense_categories').insert({
        name: newCat.name.trim(), color: EX.autoCatColor(newCat.name.trim()), gl_code: newCat.gl_code || null,
        monthly_cap: newCat.monthly_cap === '' ? null : Number(newCat.monthly_cap),
        ...budgetPatch(newCat.budget), sort_order: (categories.length + 1) * 10,
        vendor_options: (() => { const a = newCat.vendor_options.split(',').map(s => s.trim()).filter(Boolean); return a.length ? a : null })(),
      })
      if (error) throw error
      setNewCat({ name: '', gl_code: '', monthly_cap: '', budget: 'none', vendor_options: '' })
      toast('Category added.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  async function addIndividualBudget() {
    if (!addRow.person || !addRow.cat || addRow.amount === '') { toast('Pick a person, a category, and an amount.', 'error'); return }
    await savePersonBudget(addRow.person, addRow.cat, addRow.amount)
    setAddRow({ person: '', cat: '', amount: '' })
  }

  const branchCats = categories.filter(c => c.is_budgeted && c.is_active && c.budget_scope === 'branch')
  const personCats = categories.filter(c => c.is_budgeted && c.is_active && c.budget_scope === 'person')
  const included = people.filter(p => p.in_budget)
  const excluded = people.filter(p => !p.in_budget)
  const visiblePeople = showExcluded ? people : included
  const nameOf = id => people.find(p => p.id === id)?.name || '—'
  // existing individual (person-scoped) budgets, as rows
  const individualRows = Object.keys(budgets)
    .map(k => { const [pid, cid] = k.split('|'); return { pid, cid, amount: budgets[k] } })
    .filter(r => personCats.some(c => c.id === r.cid))

  if (denied) return embed ? null : (
    <Layout pageKey="people">
      <div style={{ padding: '80px 32px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#0B1B30' }}>Page not found</div>
        <div style={{ fontSize: 14, color: '#5B6878', marginBottom: 22 }}>This page doesn't exist or you don't have access.</div>
        <button className="od-btn od-btn-primary" onClick={() => navigate('/people/expenses')}>Back to Expenses</button>
      </div>
    </Layout>
  )
  if (loading) return embed ? <div className="o-loading">Loading…</div> : <Layout pageKey="people"><div className="o-loading">Loading…</div></Layout>

  const inner = (
      <div className="kpi-app density-comfortable accent-ssc" style={embed ? { padding: 0 } : undefined}>
        {!embed && <div className="page-head">
          <div>
            <button className="od-btn" style={{ marginBottom: 8 }} onClick={() => navigate('/people/expenses')}>← Back</button>
            <h1 className="page-title">Expense Configurator</h1>
            <div className="page-sub">Who is in the budget, the Petrol budget per branch, and individual budgets.</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">ACCESS</span><span className="meta-val">Admin / Management</span></div>
          </div>
        </div>}

        {/* ── 1. Branch Petrol budget ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Step 1 · Branch budget</div>
              <div className="card-title">Petrol budget per branch</div>
              <div className="card-sub">Everyone based at a branch shares this monthly Petrol cap. Only the actual bill is paid — the budget is the ceiling.</div>
            </div>
          </div>
          {branchCats.length === 0 ? (
            <div className="exp-cfg-ph">No branch category yet — set a category's Budget to “Per branch” below.</div>
          ) : (
            <div className="exp-cfg-branch">
              {EX.LOCATIONS.map(loc => (
                <div key={loc} className="exp-cfg-branch-row">
                  <div className="exp-cfg-branch-name">{loc}</div>
                  {branchCats.map(c => {
                    const k = `${loc}|${c.id}`
                    return (
                      <label key={c.id} className="exp-cfg-branch-field">
                        <span className="exp-cfg-mini">{c.name} ₹ / month</span>
                        <input className="exp-cfg-input" style={{ width: 130 }} type="number" min="0" placeholder="0"
                          defaultValue={locBud[k] ?? ''}
                          onBlur={e => { const cur = locBud[k] ?? ''; if (String(e.target.value) !== String(cur)) saveBranchBudget(loc, c.id, e.target.value) }} />
                      </label>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 2. People in budget ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Step 2 · People</div>
              <div className="card-title">Who is in the budget</div>
              <div className="card-sub">Sales &amp; Accounts staff. Turn a person off if they don't need a budget — they're then hidden here and from expense budgets.</div>
            </div>
            {excluded.length > 0 && (
              <button className="od-btn" onClick={() => setShowExcluded(v => !v)}>
                {showExcluded ? 'Hide excluded' : `Show excluded (${excluded.length})`}
              </button>
            )}
          </div>
          <div className="exp-cfg-people">
            {visiblePeople.map(p => (
              <div key={p.id} className={'exp-cfg-person' + (p.in_budget ? '' : ' off')}>
                <div className="exp-avatar" style={{ background: EX.colorFor(p.id) }}>{EX.initialsFor(p.name)}</div>
                <div className="exp-cfg-pinfo">
                  <div className="exp-cfg-pname">{p.name}</div>
                  <div className="exp-cfg-prole">{p.role}</div>
                </div>
                {p.in_budget && (
                  <label className="exp-cfg-loc">
                    <span className="exp-cfg-mini">Branch</span>
                    <select className="exp-cfg-input" style={{ width: 120 }} value={p.location || ''}
                      onChange={e => savePersonLocation(p.id, e.target.value)}>
                      <option value="">— none —</option>
                      {EX.LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </label>
                )}
                <button className={'exp-cfg-switch' + (p.in_budget ? ' on' : '')}
                  title={p.in_budget ? 'In budget — click to exclude' : 'Excluded — click to include'}
                  onClick={() => toggleInBudget(p.id, !p.in_budget)}>
                  <span className="exp-cfg-switch-knob" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── 3. Individual budgets ── */}
        {personCats.length > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <div>
                <div className="card-eyebrow">Step 3 · Individual</div>
                <div className="card-title">Individual budgets</div>
                <div className="card-sub">A monthly budget for one specific person — e.g. {personCats[0].name} for Jayshree.</div>
              </div>
            </div>
            <div className="exp-cfg-table">
              <table>
                <thead><tr><th>Person</th><th>Category</th><th>₹ / month</th><th /></tr></thead>
                <tbody>
                  {individualRows.length === 0 && (
                    <tr><td colSpan={4} className="exp-cfg-ph" style={{ padding: '10px 8px' }}>None yet — add one below.</td></tr>
                  )}
                  {individualRows.map(r => (
                    <tr key={`${r.pid}|${r.cid}`}>
                      <td><span className="exp-cfg-name"><span className="exp-avatar sm" style={{ background: EX.colorFor(r.pid) }}>{EX.initialsFor(nameOf(r.pid))}</span>{nameOf(r.pid)}</span></td>
                      <td>{categories.find(c => c.id === r.cid)?.name}</td>
                      <td>
                        <input className="exp-cfg-input" style={{ width: 120 }} type="number" min="0" defaultValue={r.amount ?? ''}
                          onBlur={e => { if (String(e.target.value) !== String(r.amount ?? '')) savePersonBudget(r.pid, r.cid, e.target.value) }} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="od-btn" onClick={() => savePersonBudget(r.pid, r.cid, '')}>Remove</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="new-row">
                    <td>
                      <select className="exp-cfg-input w-md" value={addRow.person} onChange={e => setAddRow({ ...addRow, person: e.target.value })}>
                        <option value="">Select person…</option>
                        {included.map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="exp-cfg-input w-md" value={addRow.cat} onChange={e => setAddRow({ ...addRow, cat: e.target.value })}>
                        <option value="">Category…</option>
                        {personCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td><input className="exp-cfg-input" style={{ width: 120 }} type="number" min="0" placeholder="0" value={addRow.amount} onChange={e => setAddRow({ ...addRow, amount: e.target.value })} /></td>
                    <td style={{ textAlign: 'right' }}><button className="od-btn od-btn-primary" onClick={addIndividualBudget}>Add</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 4. Categories (collapsed by default — master data) ── */}
        <div className="card">
          <div className="card-head" style={{ marginBottom: showCats ? 14 : 0, cursor: 'pointer' }} onClick={() => setShowCats(v => !v)}>
            <div>
              <div className="card-eyebrow">Advanced</div>
              <div className="card-title">Categories {showCats ? '▾' : '▸'}</div>
              <div className="card-sub">{categories.filter(c => c.is_active).length} active. Add or edit the expense types staff can pick.</div>
            </div>
          </div>
          {showCats && (
            <div className="exp-cfg-table">
              <table>
                <thead>
                  <tr><th>Name</th><th>Providers</th><th>GL code</th><th>Cap ₹</th><th>Budget</th><th>Active</th></tr>
                </thead>
                <tbody>
                  {categories.map(c => (
                    <tr key={c.id}>
                      <td><span className="exp-cfg-name"><ExpenseIcon name={c.name} color={c.color} small />{c.name}</span></td>
                      <td>
                        <input className="exp-cfg-input w-md" defaultValue={(c.vendor_options || []).join(', ')} placeholder="none"
                          title="Comma-separated. If set, the claim form makes the user pick one (e.g. Uber, Ola)."
                          onBlur={e => {
                            const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                            const cur = c.vendor_options || []
                            if (arr.join('|') !== cur.join('|')) saveCat(c.id, { vendor_options: arr.length ? arr : null })
                          }} />
                      </td>
                      <td><input className="exp-cfg-input w-sm" defaultValue={c.gl_code || ''} placeholder="—" onBlur={e => e.target.value !== (c.gl_code || '') && saveCat(c.id, { gl_code: e.target.value || null })} /></td>
                      <td><input className="exp-cfg-input w-sm" type="number" min="0" defaultValue={c.monthly_cap ?? ''} placeholder="none"
                        onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (c.monthly_cap ?? null)) saveCat(c.id, { monthly_cap: v }) }} /></td>
                      <td>
                        <select className="exp-cfg-input w-sm" value={c.is_budgeted ? c.budget_scope : 'none'} onChange={e => saveCat(c.id, budgetPatch(e.target.value))}>
                          <option value="none">No budget</option>
                          <option value="branch">Per branch</option>
                          <option value="person">Per person</option>
                        </select>
                      </td>
                      <td><input type="checkbox" checked={c.is_active} onChange={e => saveCat(c.id, { is_active: e.target.checked })} /></td>
                    </tr>
                  ))}
                  <tr className="new-row">
                    <td><input className="exp-cfg-input w-md" value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category" /></td>
                    <td><input className="exp-cfg-input w-md" value={newCat.vendor_options} onChange={e => setNewCat({ ...newCat, vendor_options: e.target.value })} placeholder="Uber, Ola…" /></td>
                    <td><input className="exp-cfg-input w-sm" value={newCat.gl_code} onChange={e => setNewCat({ ...newCat, gl_code: e.target.value })} placeholder="GL" /></td>
                    <td><input className="exp-cfg-input w-sm" type="number" min="0" value={newCat.monthly_cap} onChange={e => setNewCat({ ...newCat, monthly_cap: e.target.value })} placeholder="none" /></td>
                    <td>
                      <select className="exp-cfg-input w-sm" value={newCat.budget} onChange={e => setNewCat({ ...newCat, budget: e.target.value })}>
                        <option value="none">No budget</option>
                        <option value="branch">Per branch</option>
                        <option value="person">Per person</option>
                      </select>
                    </td>
                    <td><button className="od-btn od-btn-primary" onClick={addCat}>Add</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
  )
  return embed ? inner : <Layout pageKey="people">{inner}</Layout>
}
