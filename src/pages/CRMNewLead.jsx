import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SOURCES    = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const SCENARIOS  = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}

const FS = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }

export default function CRMNewLead() {
  const navigate = useNavigate()
  const [user, setUser]           = useState({ name:'', role:'', id:'' })
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]           = useState([])
  const [saving, setSaving]       = useState(false)

  // Step 1: company name check
  const [companyInput, setCompanyInput] = useState('')
  const [checking, setChecking]   = useState(false)
  const [checkResult, setCheckResult] = useState(null) // null | { type:'existing'|'new', matches:[] }
  const [selectedMatch, setSelectedMatch] = useState(null)

  // Step 2: form
  const [form, setForm] = useState({
    source: '', principal_id: '', product_notes: '',
    scenario_type: '', assigned_rep_id: '', contact_name: '',
    estimated_value_inr: '', expected_close_date: '',
  })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    setForm(p => ({ ...p, assigned_rep_id: session.user.id }))
    const [principalsRes, repsRes] = await Promise.all([
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])
  }

  async function checkCompany() {
    if (!companyInput.trim()) return
    setChecking(true)
    setCheckResult(null); setSelectedMatch(null)
    const { data } = await sb.from('customers')
      .select('id,customer_name,customer_type,credit_terms')
      .ilike('customer_name', '%' + companyInput.trim() + '%')
      .limit(5)
    const type = data?.length > 0 ? 'existing' : 'new'
    setCheckResult({ type, matches: data || [] })
    if (type === 'new') {
      setForm(p => ({ ...p, scenario_type: 'NEW_CUST_NEW_PROD' }))
    } else {
      setSelectedMatch(data[0])
      setForm(p => ({ ...p, scenario_type: 'OLD_CUST_NEW_PROD' }))
    }
    setChecking(false)
  }

  async function save() {
    if (!companyInput.trim()) { alert('Company name required'); return }
    if (!checkResult) { alert('Please check the company first'); return }
    setSaving(true)

    if (checkResult.type === 'existing') {
      // Find or create crm_companies record, then create Opportunity
      const matchName = selectedMatch?.customer_name || companyInput.trim()
      let companyId = null
      const { data: existingCo } = await sb.from('crm_companies')
        .select('id').ilike('company_name', matchName).maybeSingle()
      if (existingCo?.id) {
        companyId = existingCo.id
      } else {
        const { data: newCo } = await sb.from('crm_companies').insert({
          company_name: matchName,
          customer_type: selectedMatch?.customer_type || null,
          status: 'Active',
        }).select('id').single()
        companyId = newCo?.id
      }

      const { data, error } = await sb.from('crm_opportunities').insert({
        company_id: companyId,
        principal_id: form.principal_id || null,
        product_notes: form.product_notes.trim() || null,
        scenario_type: form.scenario_type || 'OLD_CUST_NEW_PROD',
        assigned_rep_id: form.assigned_rep_id || user.id,
        estimated_value_inr: form.estimated_value_inr || null,
        expected_close_date: form.expected_close_date || null,
        stage: 'LEAD_CAPTURED',
      }).select().single()
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
      navigate('/crm/opportunities/' + data.id)
    } else {
      // New prospect → create Lead
      const { data, error } = await sb.from('crm_leads').insert({
        freetext_company: companyInput.trim(),
        contact_name_freetext: form.contact_name.trim() || null,
        source: form.source || null,
        principal_id: form.principal_id || null,
        product_notes: form.product_notes.trim() || null,
        scenario_type: form.scenario_type || 'NEW_CUST_NEW_PROD',
        assigned_rep_id: form.assigned_rep_id || user.id,
        status: 'New',
      }).select().single()
      if (error) { alert('Error: ' + error.message); setSaving(false); return }
      navigate('/crm/leads/' + data.id)
    }
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <Layout pageTitle="CRM — New" pageKey="crm">
      <CRMSubNav active="leads" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">New Lead / Opportunity</div>
              <div className="crm-page-sub">Enter the company name — we'll check if they're an existing SSC customer</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm')}>← Cancel</button>
            </div>
          </div>

          {/* Step 1: Company check */}
          <div className="crm-card" style={{ maxWidth: 700, marginBottom: 16 }}>
            <div className="crm-card-header"><div className="crm-card-title">Company</div></div>
            <div className="crm-card-body">
              <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }}>Company Name *</label>
                  <input
                    style={FS}
                    value={companyInput}
                    onChange={e => { setCompanyInput(e.target.value); setCheckResult(null); setSelectedMatch(null) }}
                    placeholder="e.g. Haitian Plastics Machinery India Pvt Ltd"
                    onKeyDown={e => e.key === 'Enter' && checkCompany()}
                  />
                </div>
                <button className="crm-btn crm-btn-primary" onClick={checkCompany} disabled={checking || !companyInput.trim()} style={{ whiteSpace:'nowrap', flexShrink:0 }}>
                  {checking ? 'Checking…' : 'Check'}
                </button>
              </div>

              {checkResult && (
                <div style={{ marginTop: 12 }}>
                  {checkResult.type === 'existing' ? (
                    <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, padding:'10px 14px' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#15803d', marginBottom:6 }}>
                        ✓ Existing SSC Customer — creating Opportunity
                      </div>
                      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                        {checkResult.matches.map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedMatch(m)}
                            style={{ fontSize:12, padding:'4px 10px', borderRadius:6, border: selectedMatch?.id === m.id ? '2px solid #15803d' : '1px solid #bbf7d0', background: selectedMatch?.id === m.id ? '#dcfce7' : 'white', cursor:'pointer', fontFamily:'var(--font)', fontWeight: selectedMatch?.id === m.id ? 700 : 400 }}
                          >
                            {m.customer_name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'10px 14px' }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#1a4dab' }}>
                        New Prospect — creating Lead
                      </div>
                      <div style={{ fontSize:11, color:'#3b82f6', marginTop:2 }}>
                        Not found in SSC customer list. A lead will be created.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Form (shown after check) */}
          {checkResult && (
            <div className="crm-card" style={{ maxWidth: 700 }}>
              <div className="crm-card-header">
                <div className="crm-card-title">
                  {checkResult.type === 'existing' ? 'Opportunity Details' : 'Lead Details'}
                </div>
              </div>
              <div className="crm-card-body">
                <div className="crm-form">
                  {checkResult.type === 'new' && (
                    <div className="crm-edit-row">
                      <div className="crm-edit-field">
                        <label>Contact Name</label>
                        <input style={FS} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Ramesh Shah" />
                      </div>
                      <div className="crm-edit-field">
                        <label>Source</label>
                        <select style={FS} value={form.source} onChange={e => set('source', e.target.value)}>
                          <option value="">— Select —</option>
                          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="crm-edit-row">
                    <div className="crm-edit-field">
                      <label>Principal</label>
                      <select style={FS} value={form.principal_id} onChange={e => set('principal_id', e.target.value)}>
                        <option value="">— Select —</option>
                        {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="crm-edit-field">
                      <label>Scenario</label>
                      <select style={FS} value={form.scenario_type} onChange={e => set('scenario_type', e.target.value)}>
                        <option value="">— Select —</option>
                        {SCENARIOS.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}
                      </select>
                    </div>
                  </div>
                  {checkResult.type === 'existing' && (
                    <div className="crm-edit-row">
                      <div className="crm-edit-field">
                        <label>Estimated Value (INR)</label>
                        <input style={FS} type="number" value={form.estimated_value_inr} onChange={e => set('estimated_value_inr', e.target.value)} placeholder="0" />
                      </div>
                      <div className="crm-edit-field">
                        <label>Expected Close Date</label>
                        <input style={FS} type="date" value={form.expected_close_date} onChange={e => set('expected_close_date', e.target.value)} />
                      </div>
                    </div>
                  )}
                  <div className="crm-edit-field">
                    <label>Product Notes</label>
                    <textarea style={{ ...FS, minHeight:72, resize:'vertical' }} value={form.product_notes} onChange={e => set('product_notes', e.target.value)} placeholder="What products / solutions are they interested in?" />
                  </div>
                  <div className="crm-edit-field">
                    <label>Assign To</label>
                    <select style={FS} value={form.assigned_rep_id} onChange={e => set('assigned_rep_id', e.target.value)}>
                      <option value="">— Self —</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="crm-form-actions">
                    <button className="crm-btn" onClick={() => navigate('/crm')}>Cancel</button>
                    <button className="crm-btn crm-btn-primary" onClick={save} disabled={saving}>
                      {saving ? 'Creating…' : checkResult.type === 'existing' ? 'Create Opportunity' : 'Create Lead'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
