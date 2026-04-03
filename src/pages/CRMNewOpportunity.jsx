import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}

export default function CRMNewOpportunity() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillCompany = searchParams.get('company_id') || ''

  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [companies, setCompanies] = useState([])
  const [contacts, setContacts]   = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [saving, setSaving]   = useState(false)

  const [form, setForm] = useState({
    company_id: prefillCompany,
    contact_id: '',
    principal_id: '',
    scenario_type: '',
    product_notes: '',
    estimated_value_inr: '',
    expected_close_date: '',
    assigned_rep_id: '',
  })

  useEffect(() => { init() }, [])
  useEffect(() => { if (form.company_id) loadContacts(form.company_id) }, [form.company_id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    setForm(p => ({ ...p, assigned_rep_id: session.user.id }))

    const [companiesRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_companies').select('id,company_name').order('company_name'),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])
    setCompanies(companiesRes.data || [])
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])

    if (prefillCompany) loadContacts(prefillCompany)
  }

  async function loadContacts(companyId) {
    if (!companyId) { setContacts([]); return }
    const { data } = await sb.from('crm_contacts').select('id,name,phone').eq('company_id', companyId).order('name')
    setContacts(data || [])
  }

  async function save() {
    if (!form.company_id) { alert('Company is required'); return }
    setSaving(true)
    const { data, error } = await sb.from('crm_opportunities').insert({
      company_id: form.company_id,
      contact_id: form.contact_id || null,
      principal_id: form.principal_id || null,
      scenario_type: form.scenario_type || null,
      product_notes: form.product_notes.trim() || null,
      estimated_value_inr: form.estimated_value_inr || null,
      expected_close_date: form.expected_close_date || null,
      assigned_rep_id: form.assigned_rep_id || user.id,
      stage: 'LEAD_CAPTURED',
    }).select().single()
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    navigate('/crm/opportunities/' + data.id)
  }

  return (
    <Layout pageTitle="CRM — New Opportunity" pageKey="crm">
      <CRMSubNav active="opportunities" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">New Opportunity</div>
              <div className="crm-page-sub">Create a new sales opportunity</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm/opportunities')}>← Back</button>
            </div>
          </div>

          <div className="crm-card" style={{maxWidth:700}}>
            <div className="crm-card-body">
              <div className="crm-form">
                <div className="crm-edit-row">
                  <div className="crm-edit-field">
                    <label>Company *</label>
                    <select value={form.company_id} onChange={e => setForm(p=>({...p,company_id:e.target.value,contact_id:''}))}>
                      <option value="">— Select Company —</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </div>
                  <div className="crm-edit-field">
                    <label>Contact</label>
                    <select value={form.contact_id} onChange={e => setForm(p=>({...p,contact_id:e.target.value}))} disabled={!form.company_id}>
                      <option value="">— Select Contact —</option>
                      {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone?' · '+c.phone:''}</option>)}
                    </select>
                  </div>
                </div>
                <div className="crm-edit-row">
                  <div className="crm-edit-field">
                    <label>Principal</label>
                    <select value={form.principal_id} onChange={e => setForm(p=>({...p,principal_id:e.target.value}))}>
                      <option value="">— Select —</option>
                      {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="crm-edit-field">
                    <label>Scenario</label>
                    <select value={form.scenario_type} onChange={e => setForm(p=>({...p,scenario_type:e.target.value}))}>
                      <option value="">— Select —</option>
                      {SCENARIOS.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="crm-edit-field">
                  <label>Product Notes</label>
                  <textarea rows={3} value={form.product_notes} onChange={e => setForm(p=>({...p,product_notes:e.target.value}))} className="crm-activity-textarea" placeholder="Describe what products / solutions the opportunity is about"/>
                </div>
                <div className="crm-edit-row three">
                  <div className="crm-edit-field">
                    <label>Est. Value (INR)</label>
                    <input type="number" value={form.estimated_value_inr} onChange={e => setForm(p=>({...p,estimated_value_inr:e.target.value}))} placeholder="0"/>
                  </div>
                  <div className="crm-edit-field">
                    <label>Expected Close Date</label>
                    <input type="date" value={form.expected_close_date} onChange={e => setForm(p=>({...p,expected_close_date:e.target.value}))}/>
                  </div>
                  <div className="crm-edit-field">
                    <label>Assign To</label>
                    <select value={form.assigned_rep_id} onChange={e => setForm(p=>({...p,assigned_rep_id:e.target.value}))}>
                      <option value="">— Self —</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="crm-form-actions">
                  <button className="crm-btn" onClick={() => navigate('/crm/opportunities')}>Cancel</button>
                  <button className="crm-btn crm-btn-primary" onClick={save} disabled={saving}>{saving?'Saving...':'Create Opportunity'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
