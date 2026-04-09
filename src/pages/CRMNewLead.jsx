import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'
import '../styles/orderdetail.css'

const SOURCES = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']

export default function CRMNewLead() {
  const navigate  = useNavigate()
  const dropRef   = useRef(null)
  const [user, setUser]             = useState({ name:'', role:'', id:'' })
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]             = useState([])
  const [saving, setSaving]         = useState(false)

  // Company search
  const [companyQuery, setCompanyQuery]   = useState('')
  const [companySuggestions, setCompanySuggestions] = useState([])
  const [selectedCompany, setSelectedCompany]       = useState(null) // { id, company_name }
  const [showDrop, setShowDrop]           = useState(false)
  const [searchTimer, setSearchTimer]     = useState(null)

  const [form, setForm] = useState({
    contact_name: '', source: '', principal_id: '',
    product_notes: '', assigned_rep_id: '',
    estimated_value_inr: '', expected_close_date: '',
  })

  useEffect(() => { init() }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOut(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setShowDrop(false)
    }
    document.addEventListener('mousedown', onClickOut)
    return () => document.removeEventListener('mousedown', onClickOut)
  }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    setForm(p => ({ ...p, assigned_rep_id: session.user.id }))
    const [pRes, rRes] = await Promise.all([
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    setPrincipals(pRes.data || [])
    setReps(rRes.data || [])
  }

  function onCompanyType(val) {
    setCompanyQuery(val)
    setSelectedCompany(null)
    if (searchTimer) clearTimeout(searchTimer)
    if (!val.trim()) { setCompanySuggestions([]); setShowDrop(false); return }
    const t = setTimeout(async () => {
      const { data } = await sb.from('customers').select('id,customer_name,customer_type').ilike('customer_name', '%' + val.trim() + '%').limit(8)
      setCompanySuggestions(data || [])
      setShowDrop(true)
    }, 220)
    setSearchTimer(t)
  }

  function pickCompany(co) {
    setSelectedCompany(co)
    setCompanyQuery(co.customer_name)
    setShowDrop(false)
    setCompanySuggestions([])
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!companyQuery.trim()) { toast('Company name required'); return }
    setSaving(true)

    if (selectedCompany?.id) {
      // Find or create crm_companies record for this customer
      const matchName = selectedCompany.customer_name
      let companyId = null
      const { data: existingCo } = await sb.from('crm_companies').select('id').ilike('company_name', matchName).maybeSingle()
      if (existingCo?.id) {
        companyId = existingCo.id
      } else {
        const { data: newCo } = await sb.from('crm_companies').insert({
          company_name: matchName,
          customer_type: selectedCompany.customer_type || null,
          status: 'Active',
        }).select('id').single()
        companyId = newCo?.id
      }
      // Existing company → Opportunity
      const { data, error } = await sb.from('crm_opportunities').insert({
        company_id: companyId,
        principal_id: form.principal_id || null,
        product_notes: form.product_notes.trim() || null,
        assigned_rep_id: form.assigned_rep_id || user.id,
        estimated_value_inr: form.estimated_value_inr || null,
        expected_close_date: form.expected_close_date || null,
        stage: 'LEAD_CAPTURED',
      }).select().single()
      if (error) { toast('Error: ' + error.message); setSaving(false); return }
      navigate('/crm/opportunities/' + data.id)
    } else {
      // New company → Lead
      const { data, error } = await sb.from('crm_leads').insert({
        freetext_company: companyQuery.trim(),
        contact_name_freetext: form.contact_name.trim() || null,
        source: form.source || null,
        principal_id: form.principal_id || null,
        product_notes: form.product_notes.trim() || null,
        assigned_rep_id: form.assigned_rep_id || user.id,
        status: 'New',
      }).select().single()
      if (error) { toast('Error: ' + error.message); setSaving(false); return }
      navigate('/crm/leads/' + data.id)
    }
  }

  const isExisting = !!selectedCompany?.id

  return (
    <Layout pageTitle="CRM — New" pageKey="crm">
      <CRMSubNav active={isExisting ? 'opportunities' : 'leads'} />
      <div className="od-page">
        <div className="od-body" style={{ maxWidth: 760 }}>

          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-title">New {isExisting ? 'Opportunity' : 'Lead'}</div>
                <div className="od-header-num">
                  {isExisting
                    ? 'Creating opportunity for existing company'
                    : companyQuery && !selectedCompany
                      ? 'New prospect — will create a lead'
                      : 'Start by searching for the company'}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/crm')}>← Cancel</button>
              </div>
            </div>
          </div>

          <div className="od-card">
            <div className="od-card-header">
              <div className="od-card-title">Details</div>
              {isExisting && (
                <span style={{ fontSize:11, fontWeight:700, background:'#f0fdf4', color:'#15803d', borderRadius:4, padding:'2px 8px' }}>Existing Customer</span>
              )}
              {companyQuery && !isExisting && (
                <span style={{ fontSize:11, fontWeight:700, background:'#eff6ff', color:'#1a4dab', borderRadius:4, padding:'2px 8px' }}>New Prospect</span>
              )}
            </div>
            <div className="od-card-body">
              <div className="od-edit-form">

                {/* Company — full width with dropdown */}
                <div className="od-edit-field" ref={dropRef} style={{ position:'relative' }}>
                  <label>Company *</label>
                  <input
                    value={companyQuery}
                    onChange={e => onCompanyType(e.target.value)}
                    onFocus={() => companySuggestions.length && setShowDrop(true)}
                    placeholder="Type to search existing companies…"
                    autoComplete="off"
                  />
                  {showDrop && companySuggestions.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'white', border:'1px solid var(--gray-200)', borderRadius:8, boxShadow:'0 4px 16px rgba(0,0,0,0.1)', zIndex:50, overflow:'hidden', marginTop:2 }}>
                      {companySuggestions.map(co => (
                        <div key={co.id} onMouseDown={() => pickCompany(co)} style={{ padding:'10px 14px', fontSize:13, cursor:'pointer', borderBottom:'1px solid var(--gray-50)', fontFamily:'var(--font)' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background='white'}
                        >
                          {co.customer_name}
                        </div>
                      ))}
                      {companySuggestions.length === 0 && (
                        <div style={{ padding:'10px 14px', fontSize:12, color:'var(--gray-400)', fontFamily:'var(--font)' }}>No matches — will create as new prospect</div>
                      )}
                    </div>
                  )}
                </div>

                <div className="od-edit-row">
                  <div className="od-edit-field">
                    <label>Contact Name</label>
                    <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Ramesh Shah" />
                  </div>
                  <div className="od-edit-field">
                    <label>Source</label>
                    <select value={form.source} onChange={e => set('source', e.target.value)}>
                      <option value="">— Select —</option>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="od-edit-row">
                  <div className="od-edit-field">
                    <label>Principal</label>
                    <select value={form.principal_id} onChange={e => set('principal_id', e.target.value)}>
                      <option value="">— Select —</option>
                      {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="od-edit-field">
                    <label>Assign To</label>
                    <select value={form.assigned_rep_id} onChange={e => set('assigned_rep_id', e.target.value)}>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>

                {isExisting && (
                  <div className="od-edit-row">
                    <div className="od-edit-field">
                      <label>Estimated Value (₹)</label>
                      <input type="number" value={form.estimated_value_inr} onChange={e => set('estimated_value_inr', e.target.value)} placeholder="0" />
                    </div>
                    <div className="od-edit-field">
                      <label>Expected Close Date</label>
                      <input type="date" value={form.expected_close_date} onChange={e => set('expected_close_date', e.target.value)} />
                    </div>
                  </div>
                )}

                <div className="od-edit-field">
                  <label>Product / Requirement Notes</label>
                  <textarea rows={3} value={form.product_notes} onChange={e => set('product_notes', e.target.value)} placeholder="What products or solutions are they interested in?" />
                </div>

                <div style={{ display:'flex', gap:10, justifyContent:'flex-end', paddingTop:4 }}>
                  <button className="od-btn" onClick={() => navigate('/crm')}>Cancel</button>
                  <button className="od-btn od-btn-primary" onClick={save} disabled={saving || !companyQuery.trim()}>
                    {saving ? 'Creating…' : isExisting ? 'Create Opportunity' : 'Create Lead'}
                  </button>
                </div>

              </div>
            </div>
          </div>

        </div>
      </div>
    </Layout>
  )
}
