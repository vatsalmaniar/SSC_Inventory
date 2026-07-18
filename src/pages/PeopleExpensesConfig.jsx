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
import '../styles/orderdetail.css'   // .od-btn family — app-wide button system
import '../styles/expenses.css'

// Mileage is the only budgeted track: location budget + optional per-person
// override, and only for SALES. Admin/Management submit claims with no budget.
// General categories (Food, Telephone…) have no budget — the approved bill is paid.

export default function PeopleExpensesConfig() {
  const navigate = useNavigate()
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState([])
  const [categories, setCategories] = useState([])
  const [budgets, setBudgets] = useState({})   // `${profile_id}|${category_id}` -> per-person override
  const [locBud, setLocBud] = useState({})     // `${location}|${category_id}`   -> location budget
  const [newCat, setNewCat] = useState({ name: '', gl_code: '', monthly_cap: '', is_budgeted: false, vendor_options: '' })

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
      sb.rpc('expense_budget_people'),   // active sales/management/admin only (excludes suspended)
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
  async function saveBudget(profileId, categoryId, amount) {
    const val = amount === '' ? null : Number(amount)
    try {
      const { data: ex } = await sb.from('expense_budgets').select('id')
        .eq('profile_id', profileId).eq('category_id', categoryId).is('month_start', null).maybeSingle()
      if (val == null) { if (ex) await sb.from('expense_budgets').delete().eq('id', ex.id) }
      else if (ex) { const { error } = await sb.from('expense_budgets').update({ budget_amount: val }).eq('id', ex.id); if (error) throw error }
      else { const { error } = await sb.from('expense_budgets').insert({ profile_id: profileId, category_id: categoryId, month_start: null, budget_amount: val }); if (error) throw error }
      toast(val == null ? 'Override cleared — using location budget.' : 'Override saved.', 'success')
      loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function saveLocBudget(location, categoryId, amount) {
    const val = amount === '' ? null : Number(amount)
    try {
      const { data: ex } = await sb.from('expense_location_budgets').select('id')
        .eq('location', location).eq('category_id', categoryId).is('month_start', null).maybeSingle()
      if (val == null) { if (ex) await sb.from('expense_location_budgets').delete().eq('id', ex.id) }
      else if (ex) { const { error } = await sb.from('expense_location_budgets').update({ budget_amount: val }).eq('id', ex.id); if (error) throw error }
      else { const { error } = await sb.from('expense_location_budgets').insert({ location, category_id: categoryId, month_start: null, budget_amount: val }); if (error) throw error }
      toast('Mileage budget saved.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function savePersonLocation(profileId, location) {
    try {
      const { error } = await sb.rpc('expense_set_person_location', { p_id: profileId, p_location: location || null })
      if (error) throw error
      toast('Location saved.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error'); loadAll() }
  }

  async function saveCat(id, patch) {
    try { const { error } = await sb.from('expense_categories').update(patch).eq('id', id); if (error) throw error; loadAll() }
    catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }
  async function addCat() {
    if (!newCat.name.trim()) { toast('Category name is required.', 'error'); return }
    try {
      const { error } = await sb.from('expense_categories').insert({
        name: newCat.name.trim(), color: EX.autoCatColor(newCat.name.trim()), gl_code: newCat.gl_code || null,
        monthly_cap: newCat.monthly_cap === '' ? null : Number(newCat.monthly_cap),
        is_budgeted: newCat.is_budgeted, sort_order: (categories.length + 1) * 10,
        vendor_options: (() => { const a = newCat.vendor_options.split(',').map(s => s.trim()).filter(Boolean); return a.length ? a : null })(),
      })
      if (error) throw error
      setNewCat({ name: '', gl_code: '', monthly_cap: '', is_budgeted: false, vendor_options: '' })
      toast('Category added.', 'success'); loadAll()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  const budgetedCats = categories.filter(c => c.is_budgeted && c.is_active)

  if (denied) return (
    <Layout pageKey="people">
      <div style={{ padding: '80px 32px', maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#0B1B30' }}>Page not found</div>
        <div style={{ fontSize: 14, color: '#5B6878', marginBottom: 22 }}>This page doesn't exist or you don't have access.</div>
        <button className="od-btn od-btn-primary" onClick={() => navigate('/people/expenses')}>Back to Expenses</button>
      </div>
    </Layout>
  )
  if (loading) return <Layout pageKey="people"><div className="o-loading">Loading…</div></Layout>

  return (
    <Layout pageKey="people">
      <div className="kpi-app density-comfortable accent-ssc">
        <div className="page-head">
          <div>
            <button className="od-btn" style={{ marginBottom: 8 }} onClick={() => navigate('/people/expenses')}>← Back</button>
            <h1 className="page-title">Expense Configurator</h1>
            <div className="page-sub">Petrol budget by branch (AMD/BRD), per-person budgets (e.g. Jayshree — Office), and categories.</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill"><span className="meta-label">ACCESS</span><span className="meta-val">Admin / Management</span></div>
          </div>
        </div>

        {/* ── Mileage budget by location ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Team budget</div>
              <div className="card-title">Petrol budget by branch (AMD / BRD)</div>
              <div className="card-sub">Every person at that branch gets this monthly Petrol cap. Only the actual bill amount is paid — the budget is the ceiling.</div>
            </div>
          </div>
          {budgetedCats.length === 0 ? (
            <div className="exp-cfg-ph">No budgeted category yet — tick “Budgeted” on a category below (e.g. Petrol, Office Maintenance).</div>
          ) : (
            <div className="exp-cfg-table">
              <table>
                <thead>
                  <tr>
                    <th>Location</th>
                    {budgetedCats.map(c => <th key={c.id}>{c.name} ₹ / month</th>)}
                  </tr>
                </thead>
                <tbody>
                  {EX.LOCATIONS.map(loc => (
                    <tr key={loc}>
                      <td style={{ fontWeight: 500 }}>{EX.locLabel(loc)}</td>
                      {budgetedCats.map(c => {
                        const k = `${loc}|${c.id}`
                        return (
                          <td key={c.id}>
                            <input className="exp-cfg-input w-sm" type="number" min="0" placeholder="0"
                              defaultValue={locBud[k] ?? ''}
                              onBlur={e => { const cur = locBud[k] ?? ''; if (String(e.target.value) !== String(cur)) saveLocBudget(loc, c.id, e.target.value) }} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── People: location + optional override ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Sales team</div>
              <div className="card-title">Per-person budget (branch + individual)</div>
              <div className="card-sub">Budgets apply to Sales and Accounts only — Admin and Management submit claims without a budget. Blank falls back to the location budget (if the category has one).</div>
            </div>
          </div>
          <div className="exp-cfg-people">
            {people.map(p => (
              <div key={p.id} className="exp-cfg-person">
                <div className="exp-avatar" style={{ background: EX.colorFor(p.id) }}>{EX.initialsFor(p.name)}</div>
                <div className="exp-cfg-pinfo">
                  <div className="exp-cfg-pname">{p.name}</div>
                  <div className="exp-cfg-prole">{p.role}</div>
                </div>
                <div>
                  <div className="exp-cfg-mini">Location</div>
                  <select className="exp-cfg-input" style={{ width: 110 }} value={p.location || ''}
                    onChange={e => savePersonLocation(p.id, e.target.value)}>
                    <option value="">—</option>
                    {EX.LOCATIONS.map(l => <option key={l} value={l}>{EX.locLabel(l)}</option>)}
                  </select>
                </div>
                {/* one input per budgeted category (Petrol, Office Maintenance, …) */}
                {budgetedCats.map(c => {
                  const k = `${p.id}|${c.id}`
                  const inherited = p.location ? locBud[`${p.location}|${c.id}`] : null
                  return (
                    <div key={c.id}>
                      <div className="exp-cfg-mini">{c.name} ₹</div>
                      <input className="exp-cfg-input" style={{ width: 92 }} type="number" min="0"
                        placeholder={inherited != null ? String(inherited) : '—'}
                        defaultValue={budgets[k] ?? ''}
                        onBlur={e => { const cur = budgets[k] ?? ''; if (String(e.target.value) !== String(cur)) saveBudget(p.id, c.id, e.target.value) }} />
                      <div className="exp-cfg-inherit">
                        {budgets[k] != null ? 'set for person'
                          : inherited != null ? `${fmtMoney(inherited)} (location)`
                          : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Categories ── */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Master data</div>
              <div className="card-title">Categories</div>
              <div className="card-sub">Tick “Mileage” to put a category on the location-budget track. GL code and cap are optional.</div>
            </div>
          </div>
          <div className="exp-cfg-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th><th>Providers</th><th>GL code</th><th>Cap ₹</th><th>Budgeted</th><th>Active</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(c => (
                  <tr key={c.id}>
                    <td>
                      <span className="exp-cfg-name">
                        <ExpenseIcon name={c.name} color={c.color} small />
                        {c.name}
                      </span>
                    </td>
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
                    <td><input type="checkbox" checked={c.is_budgeted} onChange={e => saveCat(c.id, { is_budgeted: e.target.checked })} /></td>
                    <td><input type="checkbox" checked={c.is_active} onChange={e => saveCat(c.id, { is_active: e.target.checked })} /></td>
                  </tr>
                ))}
                <tr className="new-row">
                  <td><input className="exp-cfg-input w-md" value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="New category" /></td>
                  <td><input className="exp-cfg-input w-md" value={newCat.vendor_options} onChange={e => setNewCat({ ...newCat, vendor_options: e.target.value })} placeholder="Uber, Ola…" /></td>
                  <td><input className="exp-cfg-input w-sm" value={newCat.gl_code} onChange={e => setNewCat({ ...newCat, gl_code: e.target.value })} placeholder="GL" /></td>
                  <td><input className="exp-cfg-input w-sm" type="number" min="0" value={newCat.monthly_cap} onChange={e => setNewCat({ ...newCat, monthly_cap: e.target.value })} placeholder="none" /></td>
                  <td><input type="checkbox" checked={newCat.is_budgeted} onChange={e => setNewCat({ ...newCat, is_budgeted: e.target.checked })} /></td>
                  <td><button className="od-btn od-btn-primary" onClick={addCat}>Add</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
