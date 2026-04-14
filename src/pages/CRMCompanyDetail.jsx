import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmtNum } from '../lib/fmt'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const INDUSTRIES = ['Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal','Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG','Energy','Automobile','Power Electronics','Datacenters','Road Construction','Cement','Tyre','Petroleum','Chemical']
const CUSTOMER_TYPES = ['OEM','Panel Builder','End User','Trader']


function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}

export default function CRMCompanyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [company, setCompany] = useState(null)
  const [contacts, setContacts] = useState([])
  const [opps, setOpps]       = useState([])
  const [reps, setReps]       = useState([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]   = useState(false)
  const [showContactForm, setShowContactForm] = useState(false)
  const [contactForm, setContactForm] = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'', is_decision_maker:false, is_influencer:false, notes:'' })
  const [savingContact, setSavingContact] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || 'sales', id: session.user.id })
    const [compRes, contactsRes, oppsRes, repsRes] = await Promise.all([
      sb.from('crm_companies').select('*, profiles(name)').eq('id', id).single(),
      sb.from('crm_contacts').select('*').eq('company_id', id).order('name'),
      sb.from('crm_opportunities').select('*, crm_principals(name)').eq('company_id', id).order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    setCompany(compRes.data)
    setEditData(compRes.data || {})
    setContacts(contactsRes.data || [])
    setOpps(oppsRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)

    // Dormant check
    if (compRes.data?.last_order_date) {
      const lastOrder = new Date(compRes.data.last_order_date)
      const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
      if (lastOrder < sixMonthsAgo && compRes.data.status !== 'Dormant') {
        await sb.from('crm_companies').update({ status: 'Dormant' }).eq('id', id)
        setCompany(p => ({ ...p, status: 'Dormant' }))
      }
    }
  }

  async function saveCompany() {
    setSaving(true)
    const { error } = await sb.from('crm_companies').update({
      company_name: editData.company_name,
      gstin: editData.gstin,
      city: editData.city,
      address: editData.address,
      customer_type: editData.customer_type,
      industry: editData.industry,
      status: editData.status,
      assigned_rep_id: editData.assigned_rep_id,
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    setCompany(p => ({ ...p, ...editData }))
    toast('Company updated', 'success')
    setEditMode(false)
    setSaving(false)
  }

  async function saveContact() {
    if (!contactForm.name.trim()) { toast('Contact name is required'); return }
    setSavingContact(true)
    const { data, error } = await sb.from('crm_contacts').insert({ ...contactForm, company_id: id }).select().single()
    if (error) { toast('Error: ' + error.message); setSavingContact(false); return }
    setContacts(prev => [...prev, data])
    toast('Contact added', 'success')
    setShowContactForm(false)
    setContactForm({ name:'', designation:'', phone:'', whatsapp:'', email:'', is_decision_maker:false, is_influencer:false, notes:'' })
    setSavingContact(false)
  }

  if (loading) return <Layout pageTitle="CRM — Company" pageKey="crm"><CRMSubNav active="companies" /><div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div></Layout>
  if (!company) return <Layout pageTitle="CRM — Company" pageKey="crm"><CRMSubNav active="companies"/><div className="crm-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Company not found</div><div style={{fontSize:13}}>This company may have been deleted or you don't have access.</div></div></div></Layout>

  const isDormant = company.status === 'Dormant'
  const hasRevival = opps.some(o => o.scenario_type === 'DORMANT_REVIVAL' && !['WON','LOST'].includes(o.stage))

  return (
    <Layout pageTitle="CRM — Company" pageKey="crm">
      <CRMSubNav active="companies" />
      <div className="crm-page">
        <div className="crm-body">

          {/* Header */}
          <div className="crm-page-header">
            <div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <div className="crm-page-title">{company.company_name}</div>
                <span style={{fontSize:11,fontWeight:700,borderRadius:4,padding:'2px 8px',
                  background: company.status==='Active' ? '#f0fdf4' : company.status==='Blacklisted' ? '#fef2f2' : '#fffbeb',
                  color: company.status==='Active' ? '#15803d' : company.status==='Blacklisted' ? '#dc2626' : '#b45309'
                }}>{company.status}</span>
              </div>
              <div className="crm-page-sub">{company.customer_type || ''}{company.industry ? ' · ' + company.industry : ''}{company.city ? ' · ' + company.city : ''}</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm/companies')}>← Back</button>
              {!editMode && <button className="crm-btn" onClick={() => setEditMode(true)}>Edit</button>}
            </div>
          </div>

          {/* Dormant banner */}
          {isDormant && !hasRevival && (
            <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:12,padding:'14px 18px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div>
                <div style={{fontWeight:700,color:'#b45309',fontSize:13}}>Dormant Customer</div>
                <div style={{fontSize:12,color:'#92400e',marginTop:2}}>No order in the last 6 months. Consider creating a revival opportunity.</div>
              </div>
              <button className="crm-btn crm-btn-sm" style={{background:'#b45309',color:'white',border:'none'}}
                onClick={() => navigate('/crm/opportunities/new?company_id=' + id + '&scenario=DORMANT_REVIVAL')}>
                Create Revival Opportunity
              </button>
            </div>
          )}

          <div className="crm-detail-layout">
            <div>
              {/* Company info */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Company Information</div>
                  {editMode && (
                    <div style={{display:'flex',gap:8}}>
                      <button className="crm-btn crm-btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveCompany} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="crm-card-body">
                  {editMode ? (
                    <div className="crm-form">
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Company Name</label><input value={editData.company_name||''} onChange={e=>setEditData(p=>({...p,company_name:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>City</label><input value={editData.city||''} onChange={e=>setEditData(p=>({...p,city:e.target.value}))}/></div>
                      </div>
                      <div className="crm-edit-row three">
                        <div className="crm-edit-field"><label>Customer Type</label>
                          <select value={editData.customer_type||''} onChange={e=>setEditData(p=>({...p,customer_type:e.target.value}))}>
                            <option value="">—</option>{CUSTOMER_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Industry</label>
                          <select value={editData.industry||''} onChange={e=>setEditData(p=>({...p,industry:e.target.value}))}>
                            <option value="">—</option>{INDUSTRIES.map(i=><option key={i} value={i}>{i}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Status</label>
                          <select value={editData.status||'Active'} onChange={e=>setEditData(p=>({...p,status:e.target.value}))}>
                            <option>Active</option><option>Dormant</option><option>Blacklisted</option>
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>GSTIN</label><input value={editData.gstin||''} onChange={e=>setEditData(p=>({...p,gstin:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Assigned Rep</label>
                          <select value={editData.assigned_rep_id||''} onChange={e=>setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-field"><label>Address</label><textarea rows={2} value={editData.address||''} onChange={e=>setEditData(p=>({...p,address:e.target.value}))}/></div>
                    </div>
                  ) : (
                    <div className="crm-detail-grid">
                      <div className="crm-detail-field"><label>GSTIN</label><div className="val" style={{fontFamily:'var(--mono)'}}>{company.gstin||'—'}</div></div>
                      <div className="crm-detail-field"><label>City</label><div className="val">{company.city||'—'}</div></div>
                      <div className="crm-detail-field"><label>Customer Type</label><div className="val">{company.customer_type||'—'}</div></div>
                      <div className="crm-detail-field"><label>Industry</label><div className="val">{company.industry||'—'}</div></div>
                      <div className="crm-detail-field"><label>Assigned Rep</label><div className="val">{company.profiles?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Last Order Date</label><div className="val">{fmtNum(company.last_order_date)}</div></div>
                      <div className="crm-detail-field" style={{gridColumn:'span 2'}}><label>Address</label><div className="val">{company.address||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Opportunities */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Opportunities ({opps.length})</div>
                  <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => navigate('/crm/opportunities/new?company_id=' + id)}>+ New</button>
                </div>
                {opps.length === 0 ? (
                  <div className="crm-empty" style={{padding:30}}><div className="crm-empty-sub">No opportunities yet.</div></div>
                ) : (
                  opps.map(o => (
                    <div key={o.id} onClick={() => navigate('/crm/opportunities/' + o.id)}
                      style={{padding:'12px 18px',borderBottom:'1px solid var(--gray-50)',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13}}>{o.product_notes || '—'}</div>
                        <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{o.crm_principals?.name || ''}{o.expected_close_date ? ' · Close: ' + fmtNum(o.expected_close_date) : ''}</div>
                      </div>
                      <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
                        {o.estimated_value_inr && <span style={{fontSize:12,fontWeight:700}}>₹{o.estimated_value_inr.toLocaleString('en-IN')}</span>}
                        <span className={'crm-stage-pill ' + o.stage}>{o.stage.replace(/_/g,' ')}</span>
                        <span className={'crm-scenario-pill crm-scenario-' + o.scenario_type}>{scenarioLabel(o.scenario_type)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Sidebar — Contacts */}
            <div>
              <div className="crm-side-card">
                <div className="crm-side-card-title">Contacts ({contacts.length})</div>
                <div className="crm-side-card-body" style={{padding:0}}>
                  {contacts.map(c => (
                    <div key={c.id} style={{padding:'10px 16px',borderBottom:'1px solid var(--gray-50)'}}>
                      <div style={{fontWeight:600,fontSize:13}}>{c.name}</div>
                      <div style={{fontSize:11,color:'var(--gray-500)',marginTop:1}}>{c.designation || ''}</div>
                      {c.phone && <div style={{fontSize:12,marginTop:4}}>📞 {c.phone}</div>}
                      {c.whatsapp && <div style={{fontSize:12}}>💬 {c.whatsapp}</div>}
                      {c.email && <div style={{fontSize:12}}>{c.email}</div>}
                      <div style={{display:'flex',gap:4,marginTop:4,flexWrap:'wrap'}}>
                        {c.is_decision_maker && <span style={{fontSize:9,fontWeight:700,background:'#e8f2fc',color:'#1a4dab',borderRadius:3,padding:'1px 5px'}}>DECISION MAKER</span>}
                        {c.is_influencer && <span style={{fontSize:9,fontWeight:700,background:'#f5f3ff',color:'#6d28d9',borderRadius:3,padding:'1px 5px'}}>INFLUENCER</span>}
                      </div>
                    </div>
                  ))}
                  {showContactForm ? (
                    <div style={{padding:'12px 16px',borderTop:'1px solid var(--gray-100)'}}>
                      <div className="crm-form">
                        <div className="crm-edit-field"><label>Name *</label><input value={contactForm.name} onChange={e=>setContactForm(p=>({...p,name:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Designation</label><input value={contactForm.designation} onChange={e=>setContactForm(p=>({...p,designation:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Phone</label><input value={contactForm.phone} onChange={e=>setContactForm(p=>({...p,phone:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>WhatsApp</label><input value={contactForm.whatsapp} onChange={e=>setContactForm(p=>({...p,whatsapp:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Email</label><input value={contactForm.email} onChange={e=>setContactForm(p=>({...p,email:e.target.value}))}/></div>
                        <div style={{display:'flex',gap:12}}>
                          <label style={{fontSize:12,display:'flex',gap:6,alignItems:'center',cursor:'pointer'}}>
                            <input type="checkbox" checked={contactForm.is_decision_maker} onChange={e=>setContactForm(p=>({...p,is_decision_maker:e.target.checked}))}/>Decision Maker
                          </label>
                          <label style={{fontSize:12,display:'flex',gap:6,alignItems:'center',cursor:'pointer'}}>
                            <input type="checkbox" checked={contactForm.is_influencer} onChange={e=>setContactForm(p=>({...p,is_influencer:e.target.checked}))}/>Influencer
                          </label>
                        </div>
                        <div style={{display:'flex',gap:6}}>
                          <button className="crm-btn crm-btn-sm" onClick={() => setShowContactForm(false)}>Cancel</button>
                          <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveContact} disabled={savingContact}>{savingContact?'Saving...':'Save'}</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{padding:'10px 16px'}}>
                      <button className="crm-btn crm-btn-sm" onClick={() => setShowContactForm(true)}>+ Add Contact</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
