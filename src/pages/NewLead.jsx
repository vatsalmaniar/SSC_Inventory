import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm.css'

const INDUSTRIES = [
  'Automotive','Chemical','Construction','Education','Energy','FMCG','Food & Beverage',
  'Healthcare','Infrastructure','IT / Technology','Manufacturing','Oil & Gas','Pharmaceutical',
  'Power','Printing','Real Estate','Textile','Water Treatment','Other'
]

export default function NewLead() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', role: '' })
  const [submitting, setSubmitting] = useState(false)

  const [leadName, setLeadName]         = useState('')
  const [companyName, setCompanyName]   = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [email, setEmail]               = useState('')
  const [mobile, setMobile]             = useState('')
  const [designation, setDesignation]   = useState('')
  const [leadSource, setLeadSource]     = useState('')
  const [customerType, setCustomerType] = useState('')
  const [industry, setIndustry]         = useState('')
  const [address, setAddress]           = useState('')
  const [ownerName, setOwnerName]       = useState('')
  const [notes, setNotes]               = useState('')
  const [profiles, setProfiles]         = useState([])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name = profile?.name || session.user.email.split('@')[0]
    setUser({ name, role: profile?.role || 'sales' })
    setOwnerName(name)
    const { data: allProfiles } = await sb.from('profiles').select('name').order('name')
    setProfiles(allProfiles || [])
  }

  async function submitLead() {
    if (!leadName.trim()) { alert('Lead name is required'); return }
    if (!companyName.trim()) { alert('Customer / company name is required'); return }
    setSubmitting(true)
    const { data, error } = await sb.from('leads').insert({
      lead_name:     leadName.trim() || null,
      company_name:  companyName.trim(),
      contact_person: contactPerson.trim(),
      email:         email.trim(),
      mobile:        mobile.trim(),
      designation:   designation.trim(),
      lead_source:   leadSource,
      customer_type: customerType,
      industry:      industry,
      address:       address.trim(),
      owner_name:    ownerName,
      notes:         notes.trim(),
      stage:         'prospecting',
      created_by:    (await sb.auth.getUser()).data.user?.id,
    }).select().single()
    setSubmitting(false)
    if (error) { alert('Error: ' + error.message); return }
    navigate('/crm/' + data.id)
  }

  return (
    <Layout pageTitle="New Lead" pageKey="crm">
      <div className="no-page">
        <div className="no-body">
          <div className="no-page-title">New Lead</div>
          <div className="no-page-sub">Fill in the details to add a new lead to the CRM pipeline.</div>

          {/* Contact Information */}
          <div className="no-card">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Contact Information
            </div>
            <div className="no-row" style={{gridTemplateColumns:'1fr'}}>
              <div className="no-field">
                <label>Lead Name <span className="req">*</span></label>
                <input value={leadName} onChange={e => setLeadName(e.target.value)} placeholder="e.g. SIEMENS Drive Supply — Q2 2026" />
              </div>
            </div>
            <div className="no-row">
              <div className="no-field">
                <label>Customer / Company Name <span className="req">*</span></label>
                <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
              </div>
              <div className="no-field">
                <label>Contact Person</label>
                <input value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Full name" />
              </div>
            </div>
            <div className="no-row">
              <div className="no-field">
                <label>Designation</label>
                <input value={designation} onChange={e => setDesignation(e.target.value)} placeholder="e.g. Purchase Manager" />
              </div>
              <div className="no-field">
                <label>Mobile</label>
                <input value={mobile} onChange={e => setMobile(e.target.value)} placeholder="+91 98765 43210" />
              </div>
            </div>
            <div className="no-row">
              <div className="no-field">
                <label>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@company.com" />
              </div>
              <div className="no-field">
                <label>Address</label>
                <input value={address} onChange={e => setAddress(e.target.value)} placeholder="City / full address" />
              </div>
            </div>
          </div>

          {/* Lead Classification */}
          <div className="no-card">
            <div className="no-section-title">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Lead Classification
            </div>
            <div className="no-row three">
              <div className="no-field">
                <label>Lead Source</label>
                <select value={leadSource} onChange={e => setLeadSource(e.target.value)}>
                  <option value="">— Select —</option>
                  {['Cold Call','LinkedIn','Principal Referral','Exhibition','Google','Customer Referral'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="no-field">
                <label>Customer Type</label>
                <select value={customerType} onChange={e => setCustomerType(e.target.value)}>
                  <option value="">— Select —</option>
                  {['OEM','Panel Builder','End User','Trader'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="no-field">
                <label>Industry</label>
                <select value={industry} onChange={e => setIndustry(e.target.value)}>
                  <option value="">— Select —</option>
                  {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
            </div>
            <div className="no-row">
              <div className="no-field">
                <label>Assign Owner</label>
                <select value={ownerName} onChange={e => setOwnerName(e.target.value)}>
                  {profiles.map(p => <option key={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div className="no-field">
                <label>Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Initial notes or context..." />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="no-cancel-btn" onClick={() => navigate('/crm')}>Cancel</button>
            <button className="no-submit-btn" onClick={submitLead} disabled={submitting}>
              {submitting ? <><div className="no-spinner" />Saving...</> : <>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                Add Lead
              </>}
            </button>
          </div>
        </div>
      </div>
    </Layout>
  )
}
