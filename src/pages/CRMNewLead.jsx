import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
import '../styles/neworder.css'

const ALL_STAGES = [
  'LEAD_CAPTURED','CONTACTED','QUALIFIED','BOM_RECEIVED',
  'QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION','WON','LOST','ON_HOLD',
]
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const STAGE_PROBABILITY = {
  LEAD_CAPTURED:10, CONTACTED:20, QUALIFIED:30, BOM_RECEIVED:40,
  QUOTATION_SENT:60, FOLLOW_UP:70, FINAL_NEGOTIATION:85, WON:100, LOST:0, ON_HOLD:20,
}
const LEAD_SOURCES = ['Cold Call','Partner Referral','Customer Referral','Exhibition','Website','SSC Team']

export default function CRMNewLead() {
  const navigate = useNavigate()
  const [user, setUser]             = useState({ name:'', role:'', id:'' })
  const [principals, setPrincipals] = useState([])
  const [saving, setSaving]         = useState(false)
  const [isExisting, setIsExisting] = useState(false)
  const [selectedBrands, setSelectedBrands] = useState([])

  // Account search
  const [accountInput, setAccountInput] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState(null)

  const [form, setForm] = useState({
    opportunity_name: '',
    account_type: '',
    assigned_rep_name: '',
    assigned_rep_id: '',
    gstin: '',
    lead_source: '',
    lead_source_detail: '',
    stage: 'LEAD_CAPTURED',
    probability: 10,
    close_date: '',
    opportunity_type: '',
    description: '',
    contact_name: '',
    contact_designation: '',
    contact_phone: '',
    contact_email: '',
  })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    setForm(p => ({ ...p, assigned_rep_id: session.user.id, assigned_rep_name: profile?.name || '' }))
    const { data: pData } = await sb.from('crm_principals').select('*').order('name')
    setPrincipals(pData || [])
  }

  async function fetchCustomers(q) {
    const { data } = await sb.from('customers').select('id,customer_id,customer_name,account_owner,customer_type,gst')
      .ilike('customer_name', '%' + q + '%').limit(10)
    return data || []
  }

  function selectCustomer(c) {
    setAccountInput(c.customer_name)
    setSelectedCustomer(c)
    setIsExisting(true)
    setForm(p => ({
      ...p,
      account_type: c.customer_type || '',
      assigned_rep_name: c.account_owner || p.assigned_rep_name,
      gstin: c.gst || p.gstin,
      stage: 'BOM_RECEIVED',
      probability: STAGE_PROBABILITY['BOM_RECEIVED'],
    }))
  }

  function clearCustomer() {
    setAccountInput('')
    setSelectedCustomer(null)
    setIsExisting(false)
    setForm(p => ({
      ...p,
      account_type: '',
      assigned_rep_name: user.name,
      gstin: '',
      stage: 'LEAD_CAPTURED',
      probability: STAGE_PROBABILITY['LEAD_CAPTURED'],
    }))
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  function setStage(s) {
    setForm(p => ({ ...p, stage: s, probability: STAGE_PROBABILITY[s] ?? p.probability }))
  }

  function toggleBrand(id) {
    setSelectedBrands(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!form.opportunity_name.trim()) { toast(isExisting ? 'Opportunity Name is required' : 'Lead Name is required'); return }
    if (!accountInput.trim()) { toast('Account Name is required'); return }
    if (!form.gstin.trim()) { toast('GST number is required'); return }
    setSaving(true)

    const brandNames = principals.filter(p => selectedBrands.includes(p.id)).map(p => p.name)
    const { data, error } = await sb.from('crm_opportunities').insert({
      opportunity_name:    form.opportunity_name.trim(),
      customer_id:         selectedCustomer?.id || null,
      freetext_company:    !selectedCustomer ? accountInput.trim() : null,
      account_type:        form.account_type || null,
      assigned_rep_id:     form.assigned_rep_id || user.id,
      stage:               form.stage,
      probability:         form.probability ? parseInt(form.probability) : null,
      close_date:          form.close_date || null,
      expected_close_date: form.close_date || null,
      opportunity_type:    form.opportunity_type || null,
      lead_source:         form.lead_source || null,
      lead_source_detail:  form.lead_source_detail.trim() || null,
      description:         form.description.trim() || null,
      gstin:               form.gstin.trim() || null,
      brands:              brandNames,
      principal_id:        selectedBrands[0] || null,
      product_notes:       form.opportunity_name.trim(),
    }).select().single()

    if (error) { toast('Error: ' + error.message); setSaving(false); return }

    await sb.from('crm_activities').insert({
      opportunity_id: data.id,
      rep_id: user.id,
      activity_type: 'Created',
      notes: 'Opportunity created',
    })

    navigate('/crm/opportunities/' + data.id)
  }

  const needsDetail = form.lead_source === 'Partner Referral' || form.lead_source === 'Customer Referral'
  const detailLabel = form.lead_source === 'Partner Referral' ? 'Partner Name' : 'Customer Name'

  return (
    <Layout pageTitle="CRM — New Lead" pageKey="crm">
    <div className="no-page">
      <div className="no-body">
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div className="no-page-title" style={{ margin:0 }}>{isExisting ? 'New Opportunity' : 'New Lead'}</div>
          <button className="od-btn" onClick={() => navigate('/crm/opportunities')}>← Back</button>
        </div>
        <div className="no-page-sub">
          {isExisting
            ? 'Full opportunity form — existing customer selected'
            : 'Capture a new lead — full details can be added once qualified'}
        </div>

        {/* ── Account Information ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Account Information
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>{isExisting ? 'Opportunity Name' : 'Lead Name'} <span className="req">*</span></label>
              <input value={form.opportunity_name} onChange={e => set('opportunity_name', e.target.value)}
                placeholder="e.g. Mitsubishi PLC – SSC Automation Pvt. Ltd." />
            </div>
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>Account Name <span className="req">*</span></label>
              <Typeahead
                value={accountInput}
                onChange={v => { setAccountInput(v); if (!v) clearCustomer() }}
                onSelect={selectCustomer}
                placeholder="Search customer name..."
                fetchFn={fetchCustomers}
                renderItem={c => (
                  <>
                    <div className="typeahead-item-main" style={{display:'flex',alignItems:'center',gap:6}}>{c.customer_name}{c.customer_id && <span style={{fontSize:10,fontWeight:600,color:'#6b7280',fontFamily:'var(--mono)'}}>{c.customer_id}</span>}</div>
                    {c.gst && <div className="typeahead-item-sub">GST: {c.gst}</div>}
                  </>
                )}
              />
              {isExisting && (
                <span style={{ fontSize:10, fontWeight:700, background:'#eff6ff', color:'#1d4ed8', borderRadius:4, padding:'2px 7px', marginTop:4, display:'inline-block' }}>EXISTING CUSTOMER</span>
              )}
            </div>
            <div className="no-field">
              <label>Account Type</label>
              <select value={form.account_type} onChange={e => set('account_type', e.target.value)}>
                <option value="">— Select —</option>
                <option value="OEM">OEM</option>
                <option value="Panel Builder">Panel Builder</option>
                <option value="End User">End User</option>
                <option value="Trader">Trader</option>
              </select>
            </div>
          </div>

          <div className="no-row three">
            <div className="no-field">
              <label>GST Number <span className="req">*</span></label>
              <input value={form.gstin} onChange={e => set('gstin', e.target.value)}
                placeholder="e.g. 24AABCS1429B1ZB"
                style={{ fontFamily:'var(--mono)', letterSpacing:'0.5px', background: isExisting && form.gstin ? 'var(--gray-50)' : undefined }} />
              {isExisting && form.gstin && (
                <span style={{ fontSize:10, fontWeight:600, background:'#f0fdf4', color:'#15803d', borderRadius:4, padding:'1px 6px', marginTop:3, display:'inline-block' }}>from Customer 360</span>
              )}
            </div>
            <div className="no-field">
              <label>Account Owner</label>
              <input
                value={form.assigned_rep_name}
                readOnly
                placeholder="Auto-filled on account select"
                style={{ background:'var(--gray-50)', color: form.assigned_rep_name ? 'var(--gray-800)' : 'var(--gray-400)', cursor:'default' }}
              />
            </div>
            <div className="no-field">
              <label>Lead Source</label>
              <select value={form.lead_source} onChange={e => setForm(p => ({ ...p, lead_source: e.target.value, lead_source_detail:'' }))}>
                <option value="">— Select —</option>
                {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {needsDetail && (
            <div className="no-row full">
              <div className="no-field">
                <label>{detailLabel}</label>
                <input value={form.lead_source_detail} onChange={e => set('lead_source_detail', e.target.value)}
                  placeholder={`Enter ${detailLabel.toLowerCase()}…`} />
              </div>
            </div>
          )}
        </div>

        {/* ── Opportunity Details ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Opportunity Details
          </div>

          <div className="no-row three">
            <div className="no-field">
              <label>Stage</label>
              <select value={form.stage} onChange={e => setStage(e.target.value)}>
                {ALL_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="no-field">
              <label>Probability (%)</label>
              <input type="number" min="0" max="100" value={form.probability}
                onChange={e => set('probability', e.target.value)} placeholder="0–100" />
            </div>
            <div className="no-field">
              <label>Close Date</label>
              <input type="date" value={form.close_date} onChange={e => set('close_date', e.target.value)} />
            </div>
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>Opportunity Type</label>
              <select value={form.opportunity_type} onChange={e => set('opportunity_type', e.target.value)}>
                <option value="">— Select —</option>
                <option value="NEW_BUSINESS">New Business</option>
                <option value="EXISTING_BUSINESS">Existing Business</option>
              </select>
            </div>
          </div>

          {/* Brands — toggle buttons */}
          <div className="no-row full">
            <div className="no-field">
              <label>Brands</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:2 }}>
                {principals.map(p => {
                  const sel = selectedBrands.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => toggleBrand(p.id)} type="button"
                      style={{ padding:'5px 12px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer', border:'1px solid',
                        background: sel ? '#1e3a5f' : 'white', color: sel ? 'white' : '#475569',
                        borderColor: sel ? '#1e3a5f' : '#e2e8f0', fontFamily:'var(--font)',
                      }}>
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="no-row full">
            <div className="no-field">
              <label>Description</label>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                placeholder="Any additional context, requirements, or notes…" />
            </div>
          </div>
        </div>

        {/* ── Contact Information ── */}
        <div className="no-card">
          <div className="no-section-title">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>
            </svg>
            Contact Information
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>Contact Name</label>
              <input value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="e.g. Ramesh Shah" />
            </div>
            <div className="no-field">
              <label>Designation</label>
              <input value={form.contact_designation} onChange={e => set('contact_designation', e.target.value)} placeholder="e.g. Purchase Manager" />
            </div>
          </div>

          <div className="no-row">
            <div className="no-field">
              <label>Phone</label>
              <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="e.g. 9876543210" />
            </div>
            <div className="no-field">
              <label>Email</label>
              <input type="email" value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="e.g. ramesh@company.com" />
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="no-actions">
          <div style={{ flex:1 }} />
          <button className="no-cancel-btn" onClick={() => navigate('/crm')}>Cancel</button>
          <button className="no-submit-btn" onClick={save} disabled={saving || !form.opportunity_name.trim() || !accountInput.trim()}>
            {saving ? (
              <><div className="no-spinner" />Creating...</>
            ) : (
              <><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>{isExisting ? 'Create Opportunity' : 'Create Lead'}</>
            )}
          </button>
        </div>
      </div>
    </div>
    </Layout>
  )
}
