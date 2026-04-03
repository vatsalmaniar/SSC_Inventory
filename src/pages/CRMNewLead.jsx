import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SOURCES = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}

export default function CRMNewLead() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [companies, setCompanies] = useState([])
  const [saving, setSaving]   = useState(false)

  const [form, setForm] = useState({
    company_id: '',
    freetext_company: '',
    contact_name_freetext: '',
    source: '',
    principal_id: '',
    product_notes: '',
    scenario_type: '',
    assigned_rep_id: '',
  })

  useEffect(() => { init() }, [])

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
  }

  async function save() {
    if (!form.freetext_company.trim() && !form.company_id) { alert('Company name is required'); return }
    setSaving(true)
    const { data, error } = await sb.from('crm_leads').insert({
      company_id: form.company_id || null,
      freetext_company: form.freetext_company.trim() || null,
      contact_name_freetext: form.contact_name_freetext.trim() || null,
      source: form.source || null,
      principal_id: form.principal_id || null,
      product_notes: form.product_notes.trim() || null,
      scenario_type: form.scenario_type || null,
      assigned_rep_id: form.assigned_rep_id || user.id,
      status: 'New',
    }).select().single()
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    navigate('/crm/leads/' + data.id)
  }

  return (
    <Layout pageTitle="CRM — New Lead" pageKey="crm">
      <CRMSubNav active="leads" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">New Lead</div>
              <div className="crm-page-sub">Capture a new sales lead</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm/leads')}>← Back</button>
            </div>
          </div>

          <div className="crm-card" style={{maxWidth:700}}>
            <div className="crm-card-body">
              <div className="crm-form">
                <div className="crm-edit-row">
                  <div className="crm-edit-field">
                    <label>Company (select existing)</label>
                    <select value={form.company_id} onChange={e => setForm(p=>({...p,company_id:e.target.value,freetext_company:e.target.value?'':p.freetext_company}))}>
                      <option value="">— New / Freetext —</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </div>
                  <div className="crm-edit-field">
                    <label>Company Name (freetext) {!form.company_id && <span style={{color:'#dc2626'}}>*</span>}</label>
                    <input value={form.freetext_company} onChange={e => setForm(p=>({...p,freetext_company:e.target.value}))} placeholder="e.g. ABC Industries Pvt. Ltd." disabled={!!form.company_id}/>
                  </div>
                </div>
                <div className="crm-edit-field">
                  <label>Contact Name</label>
                  <input value={form.contact_name_freetext} onChange={e => setForm(p=>({...p,contact_name_freetext:e.target.value}))} placeholder="e.g. Ramesh Shah"/>
                </div>
                <div className="crm-edit-row three">
                  <div className="crm-edit-field">
                    <label>Source</label>
                    <select value={form.source} onChange={e => setForm(p=>({...p,source:e.target.value}))}>
                      <option value="">— Select —</option>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="crm-edit-field">
                    <label>Scenario</label>
                    <select value={form.scenario_type} onChange={e => setForm(p=>({...p,scenario_type:e.target.value}))}>
                      <option value="">— Select —</option>
                      {SCENARIOS.map(s => <option key={s} value={s}>{scenarioLabel(s)}</option>)}
                    </select>
                  </div>
                  <div className="crm-edit-field">
                    <label>Principal</label>
                    <select value={form.principal_id} onChange={e => setForm(p=>({...p,principal_id:e.target.value}))}>
                      <option value="">— Select —</option>
                      {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="crm-edit-field">
                  <label>Product Notes</label>
                  <textarea rows={3} value={form.product_notes} onChange={e => setForm(p=>({...p,product_notes:e.target.value}))} className="crm-activity-textarea" placeholder="What products / solutions are they interested in?"/>
                </div>
                <div className="crm-edit-field">
                  <label>Assign To</label>
                  <select value={form.assigned_rep_id} onChange={e => setForm(p=>({...p,assigned_rep_id:e.target.value}))}>
                    <option value="">— Self —</option>
                    {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div className="crm-form-actions">
                  <button className="crm-btn" onClick={() => navigate('/crm/leads')}>Cancel</button>
                  <button className="crm-btn crm-btn-primary" onClick={save} disabled={saving}>{saving?'Saving...':'Create Lead'}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
