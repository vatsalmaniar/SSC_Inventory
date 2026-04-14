import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { toast } from '../lib/toast'
import { fmtTs } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm.css'
import '../styles/orderdetail.css'

const SOURCES    = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const STATUSES   = ['New','Contacted','Converted','Not a Fit']
const SCENARIOS  = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const TASK_TYPES = ['Give Quote','Send Email','Visit','Call']
const VISIT_TYPES = ['Alone','With SSC','With Principal']

function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function fmtINR(v) {
  if (!v && v !== 0) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const ACT_COLORS = { Call:'#2563eb', Visit:'#0284c7', Email:'#7c3aed', Note:'#94a3b8', 'Stage Change':'#d97706', Quotation:'#16a34a' }
function actDotStyle(type, notes) {
  if (notes?.startsWith('Sample:')) return { background:'#c2410c' }
  return { background: ACT_COLORS[type] || '#94a3b8' }
}
function actLabel(a) {
  if (a.notes?.startsWith('Sample:')) return 'Sample Submission'
  return { Call:'Call', Visit:'Visit', Email:'Email', Note:'Note', Quotation:'Submit Quote', 'Stage Change':'Stage Change' }[a.activity_type] || a.activity_type
}

const STATUS_STYLE = {
  New:         { background:'#e8f2fc', color:'#1a4dab' },
  Contacted:   { background:'#fff7ed', color:'#c2410c' },
  Converted:   { background:'#f0fdf4', color:'#15803d' },
  'Not a Fit': { background:'#fef2f2', color:'#dc2626' },
}

function emptyQuoteItem() {
  return { _id: Date.now() + Math.random(), item_code:'', description:'', qty:'1', unit_price:'', discount_pct:'0', total_price:'' }
}
function unitAfterDisc(row) {
  return (parseFloat(row.unit_price)||0) * (1 - (parseFloat(row.discount_pct)||0) / 100)
}

const INP = { border:'1px solid var(--gray-200)', borderRadius:6, padding:'4px 8px', fontSize:12, fontFamily:'var(--font)', width:'100%', outline:'none', boxSizing:'border-box' }

export default function CRMLeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]             = useState({ name:'', role:'', id:'' })
  const [lead, setLead]             = useState(null)
  const [activities, setActivities] = useState([])
  const [tasks, setTasks]           = useState([])
  const [quoteItems, setQuoteItems] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]             = useState([])
  const [loading, setLoading]       = useState(true)
  const [editMode, setEditMode]     = useState(false)
  const [editData, setEditData]     = useState({})
  const [saving, setSaving]         = useState(false)

  const [actType, setActType]             = useState('Call')
  const [actDiscussion, setActDiscussion] = useState('')
  const [actVisitType, setActVisitType]   = useState('Alone')
  const [actNotes, setActNotes]           = useState('')
  const [postingAct, setPostingAct]       = useState(false)

  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskType, setTaskType]         = useState('Call')
  const [taskDueDate, setTaskDueDate]   = useState('')
  const [taskNotes, setTaskNotes]       = useState('')
  const [addingTask, setAddingTask]     = useState(false)
  const [markingDone, setMarkingDone]   = useState(null)

  const [quoteRows, setQuoteRows]     = useState([emptyQuoteItem()])
  const [savingQuote, setSavingQuote] = useState(false)
  const [quoteLoaded, setQuoteLoaded] = useState(false)

  const [leadContacts, setLeadContacts]         = useState([])
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm]           = useState({ name:'', designation:'', phone:'', email:'' })
  const [savingContact, setSavingContact]       = useState(false)

  useEffect(() => { init() }, [id])

  // Realtime: live lead detail + activity updates
  useRealtimeSubscription(`crm-lead-${id}`, {
    table: 'crm_leads', filter: `id=eq.${id}`, event: 'UPDATE',
    enabled: !!id, onEvent: () => init(),
  })
  useRealtimeSubscription(`crm-lead-activities-${id}`, {
    table: 'crm_activities', filter: `lead_id=eq.${id}`,
    enabled: !!id, onEvent: () => init(),
  })

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }
    const [leadRes, actsRes, tasksRes, quoteRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_leads').select('*, crm_companies(company_name), crm_principals(name), crm_contacts(name,phone), profiles(name)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('crm_tasks').select('*, profiles(name)').eq('lead_id', id).order('due_date', { ascending: true }),
      sb.from('crm_quote_items').select('*').eq('lead_id', id).order('created_at', { ascending: true }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    setLead(leadRes.data)
    setEditData(leadRes.data || {})
    setActivities(actsRes.data || [])
    setTasks(tasksRes.data || [])
    if (quoteRes.data?.length) {
      setQuoteRows(quoteRes.data.map(q => ({ ...q, _id: q.id })))
      setQuoteItems(quoteRes.data)
      setQuoteLoaded(true)
    }
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])
    if (leadRes.data?.company_id) {
      const { data: ctcts } = await sb.from('crm_contacts').select('*').eq('company_id', leadRes.data.company_id).order('created_at')
      setLeadContacts(ctcts || [])
    }
    setLoading(false)
  }

  async function saveLeadContact() {
    if (!contactForm.name.trim()) { toast('Name is required'); return }
    setSavingContact(true)
    const companyId = lead.company_id
    if (!companyId) {
      // Create crm_companies record from freetext
      const { data: newCo } = await sb.from('crm_companies').insert({
        company_name: lead.freetext_company || 'Unknown',
        status: 'Active',
      }).select('id').single()
      if (newCo?.id) {
        await sb.from('crm_leads').update({ company_id: newCo.id }).eq('id', id)
        setLead(p => ({ ...p, company_id: newCo.id }))
        const { data, error } = await sb.from('crm_contacts').insert({ ...contactForm, company_id: newCo.id }).select().single()
        if (error) { toast('Error: ' + error.message); setSavingContact(false); return }
        setLeadContacts(p => [...p, data])
      }
    } else {
      const { data, error } = await sb.from('crm_contacts').insert({ ...contactForm, company_id: companyId }).select().single()
      if (error) { toast('Error: ' + error.message); setSavingContact(false); return }
      setLeadContacts(p => [...p, data])
    }
    toast('Contact added', 'success')
    setContactForm({ name:'', designation:'', phone:'', email:'' })
    setShowContactModal(false)
    setSavingContact(false)
  }

  async function saveLead() {
    setSaving(true)
    const { error } = await sb.from('crm_leads').update({
      freetext_company: editData.freetext_company,
      contact_name_freetext: editData.contact_name_freetext,
      contact_phone: editData.contact_phone,
      contact_email: editData.contact_email,
      contact_designation: editData.contact_designation,
      source: editData.source,
      principal_id: editData.principal_id,
      product_notes: editData.product_notes,
      scenario_type: editData.scenario_type,
      assigned_rep_id: editData.assigned_rep_id,
      status: editData.status,
    }).eq('id', id)
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    setLead(p => ({ ...p, ...editData }))
    toast('Lead updated', 'success')
    setEditMode(false); setSaving(false)
  }

  async function goToCustomer() {
    const name = lead.crm_companies?.company_name || lead.freetext_company
    if (!name) return
    const { data } = await sb.from('customers').select('id').ilike('customer_name', name).maybeSingle()
    if (data?.id) navigate('/customers/' + data.id)
    else navigate('/customers?search=' + encodeURIComponent(name))
  }

  async function postActivity() {
    let notes = '', activityType = 'Note'
    if (actType === 'Call') {
      if (!actDiscussion.trim()) { toast('Discussion notes required'); return }
      notes = actDiscussion.trim(); activityType = 'Call'
    } else if (actType === 'Visit') {
      if (!actDiscussion.trim()) { toast('Discussion notes required'); return }
      notes = '[' + actVisitType + '] ' + actDiscussion.trim(); activityType = 'Visit'
    } else if (actType === 'Email') {
      if (!actNotes.trim()) { toast('Notes required'); return }
      notes = actNotes.trim(); activityType = 'Email'
    } else if (actType === 'Sample') {
      if (!actNotes.trim()) { toast('Describe the samples submitted'); return }
      notes = 'Sample: ' + actNotes.trim(); activityType = 'Note'
    }
    setPostingAct(true)
    await sb.from('crm_activities').insert({ lead_id: id, rep_id: user.id, activity_type: activityType, notes })
    setActDiscussion(''); setActNotes(''); setActVisitType('Alone')
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    toast('Activity logged', 'success')
    setPostingAct(false)
  }

  async function addTask() {
    setAddingTask(true)
    await sb.from('crm_tasks').insert({
      lead_id: id, task_type: taskType, due_date: taskDueDate || null,
      notes: taskNotes.trim() || null, assigned_rep_id: user.id, completed: false,
    })
    setTaskType('Call'); setTaskDueDate(''); setTaskNotes(''); setShowTaskForm(false)
    const { data: t } = await sb.from('crm_tasks').select('*, profiles(name)').eq('lead_id', id).order('due_date', { ascending: true })
    setTasks(t || [])
    toast('Task created', 'success')
    setAddingTask(false)
  }

  async function markTaskDone(taskId) {
    setMarkingDone(taskId)
    await sb.from('crm_tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    toast('Task completed', 'success')
    setMarkingDone(null)
  }

  function updateQuoteRow(idx, field, val) {
    setQuoteRows(prev => prev.map((r,i) => {
      if (i !== idx) return r
      const updated = { ...r, [field]: val }
      if (['qty','unit_price','discount_pct'].includes(field)) {
        const qty   = parseFloat(field === 'qty' ? val : updated.qty) || 0
        const price = parseFloat(field === 'unit_price' ? val : updated.unit_price) || 0
        const disc  = parseFloat(field === 'discount_pct' ? val : updated.discount_pct) || 0
        updated.total_price = (qty * price * (1 - disc / 100)).toFixed(2)
      }
      return updated
    }))
  }

  async function saveQuote() {
    const valid = quoteRows.filter(r => r.item_code || r.description)
    if (!valid.length) { toast('Add at least one item'); return }
    setSavingQuote(true)
    await sb.from('crm_quote_items').delete().eq('lead_id', id)
    const { error } = await sb.from('crm_quote_items').insert(valid.map(r => ({
      lead_id: id, item_code: r.item_code || null, description: r.description || null,
      qty: parseFloat(r.qty) || 1, unit_price: parseFloat(r.unit_price) || 0,
      discount_pct: parseFloat(r.discount_pct) || 0, total_price: parseFloat(r.total_price) || 0,
    })))
    if (error) { toast('Error saving quote: ' + error.message); setSavingQuote(false); return }
    const { data: q } = await sb.from('crm_quote_items').select('*').eq('lead_id', id).order('created_at', { ascending: true })
    setQuoteItems(q || [])
    setQuoteLoaded(true)
    toast('Quote saved', 'success')
    setSavingQuote(false)
  }

  async function convertToOpportunity() {
    const { data: opp, error } = await sb.from('crm_opportunities').insert({
      company_id: lead.company_id,
      contact_id: lead.contact_id,
      principal_id: lead.principal_id,
      product_notes: lead.product_notes,
      scenario_type: lead.scenario_type,
      assigned_rep_id: lead.assigned_rep_id || user.id,
      stage: 'LEAD_CAPTURED',
    }).select().single()
    if (error) { toast('Error: ' + error.message); return }
    await sb.from('crm_leads').update({ status: 'Converted' }).eq('id', id)
    toast('Lead converted to opportunity', 'success')
    navigate('/crm/opportunities/' + opp.id)
  }

  const quoteTotal   = quoteRows.reduce((s,r) => s + (parseFloat(r.total_price) || 0), 0)
  const pendingTasks = tasks.filter(t => !t.completed)
  const today        = new Date().toISOString().slice(0,10)
  const actText      = (actType === 'Call' || actType === 'Visit') ? actDiscussion : actNotes

  if (loading) return <Layout pageTitle="Lead" pageKey="crm"><div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/>Loading...</div></div></Layout>
  if (!lead) return <Layout pageTitle="Lead" pageKey="crm"><div className="crm-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Lead not found</div><div style={{fontSize:13}}>This lead may have been deleted or you don't have access.</div></div></div></Layout>

  return (
    <Layout pageTitle="CRM — Lead" pageKey="crm">
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">
                  Lead
                  <span className="od-status-badge" style={STATUS_STYLE[lead.status] || {}}>{lead.status}</span>
                  {lead.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + lead.scenario_type}>{scenarioLabel(lead.scenario_type)}</span>}
                </div>
                <div className="od-header-title">
                  <span onClick={goToCustomer} style={{ color:'#2563eb', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted' }}>
                    {lead.crm_companies?.company_name || lead.freetext_company || '—'}
                  </span>
                </div>
                <div className="od-header-num">
                  {lead.contact_name_freetext || lead.crm_contacts?.name || ''}
                  {lead.crm_principals?.name ? ' · ' + lead.crm_principals.name : ''}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/crm/leads')}>← Back</button>
                {lead.status !== 'Converted' && (
                  <button className="od-btn od-btn-approve" onClick={convertToOpportunity}>Convert to Opportunity</button>
                )}
                {!editMode && <button className="od-btn od-btn-edit" onClick={() => setEditMode(true)}>Edit</button>}
              </div>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="od-layout">
            <div className="od-main">

              {/* Lead Info */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Lead Information</div>
                  {editMode && (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="od-btn" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setEditMode(false)}>Cancel</button>
                      <button className="od-btn od-btn-primary" style={{ padding:'5px 10px', fontSize:12 }} onClick={saveLead} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="od-card-body">
                  {editMode ? (
                    <div className="od-edit-form">
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Company</label><input value={editData.freetext_company||''} onChange={e=>setEditData(p=>({...p,freetext_company:e.target.value}))}/></div>
                        <div className="od-edit-field"><label>Contact Name</label><input value={editData.contact_name_freetext||''} onChange={e=>setEditData(p=>({...p,contact_name_freetext:e.target.value}))}/></div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Designation</label><input value={editData.contact_designation||''} onChange={e=>setEditData(p=>({...p,contact_designation:e.target.value}))} placeholder="e.g. Purchase Manager"/></div>
                        <div className="od-edit-field"><label>Phone</label><input value={editData.contact_phone||''} onChange={e=>setEditData(p=>({...p,contact_phone:e.target.value}))} placeholder="e.g. 9876543210"/></div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Email</label><input type="email" value={editData.contact_email||''} onChange={e=>setEditData(p=>({...p,contact_email:e.target.value}))} placeholder="e.g. name@company.com"/></div>
                        <div className="od-edit-field"><label>Source</label>
                          <select value={editData.source||''} onChange={e=>setEditData(p=>({...p,source:e.target.value}))}>
                            <option value="">—</option>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field"><label>Scenario</label>
                          <select value={editData.scenario_type||''} onChange={e=>setEditData(p=>({...p,scenario_type:e.target.value}))}>
                            <option value="">—</option>{SCENARIOS.map(s=><option key={s} value={s}>{scenarioLabel(s)}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Status</label>
                          <select value={editData.status||'New'} onChange={e=>setEditData(p=>({...p,status:e.target.value}))}>
                            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field"><label>Principal</label>
                          <select value={editData.principal_id||''} onChange={e=>setEditData(p=>({...p,principal_id:e.target.value}))}>
                            <option value="">—</option>{principals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="od-edit-field"><label>Assigned Rep</label>
                        <select value={editData.assigned_rep_id||''} onChange={e=>setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                          <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </div>
                      <div className="od-edit-field"><label>Product Notes</label>
                        <textarea rows={3} value={editData.product_notes||''} onChange={e=>setEditData(p=>({...p,product_notes:e.target.value}))}/>
                      </div>
                    </div>
                  ) : (
                    <div className="od-detail-grid">
                      <div className="od-detail-field"><label>Company</label><div className="val" style={{ fontWeight:600 }}>
                        <span onClick={goToCustomer} style={{ color:'#2563eb', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted' }}>
                          {lead.crm_companies?.company_name || lead.freetext_company || '—'}
                        </span>
                      </div></div>
                      <div className="od-detail-field"><label>Source</label><div className="val">{lead.source||'—'}</div></div>
                      <div className="od-detail-field"><label>Contact</label><div className="val">{lead.contact_name_freetext||lead.crm_contacts?.name||'—'}{lead.contact_designation ? ' · ' + lead.contact_designation : ''}</div></div>
                      <div className="od-detail-field"><label>Phone</label><div className="val">{lead.contact_phone ? <a href={'tel:'+lead.contact_phone} style={{color:'#2563eb'}}>{lead.contact_phone}</a> : '—'}</div></div>
                      <div className="od-detail-field"><label>Email</label><div className="val">{lead.contact_email ? <a href={'mailto:'+lead.contact_email} style={{color:'#2563eb'}}>{lead.contact_email}</a> : '—'}</div></div>
                      <div className="od-detail-field"><label>Principal</label><div className="val">{lead.crm_principals?.name||'—'}</div></div>
                      <div className="od-detail-field"><label>Assigned Rep</label><div className="val">{lead.profiles?.name||'—'}</div></div>
                      <div className="od-detail-field" style={{ gridColumn:'span 2' }}><label>Product Notes</label><div className="val">{lead.product_notes||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quote Items */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Quote Items</div>
                  {quoteLoaded && <span style={{ fontSize:11, color:'var(--gray-400)' }}>Saved {quoteItems.length} items · {fmtINR(quoteItems.reduce((s,q)=>s+(q.total_price||0),0))}</span>}
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ paddingLeft:16, width:32 }}>#</th>
                        <th>Item Code</th>
                        <th>Description</th>
                        <th style={{ textAlign:'right', width:52 }}>Qty</th>
                        <th style={{ textAlign:'right', width:90 }}>LP Price</th>
                        <th style={{ textAlign:'right', width:54 }}>Disc%</th>
                        <th style={{ textAlign:'right', width:90 }}>Unit Price</th>
                        <th style={{ textAlign:'right', width:90 }}>Total</th>
                        <th style={{ width:28 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteRows.map((row, idx) => (
                        <tr key={row._id}>
                          <td style={{ paddingLeft:16, color:'var(--gray-400)', fontSize:11 }}>{idx+1}</td>
                          <td style={{ padding:'4px 8px' }}><input style={{ ...INP, fontFamily:'var(--mono)', color:'var(--blue-600)' }} value={row.item_code} onChange={e=>updateQuoteRow(idx,'item_code',e.target.value)} placeholder="Code"/></td>
                          <td style={{ padding:'4px 8px' }}><input style={INP} value={row.description} onChange={e=>updateQuoteRow(idx,'description',e.target.value)} placeholder="Description"/></td>
                          <td style={{ padding:'4px 8px' }}><input style={{ ...INP, textAlign:'right' }} type="number" value={row.qty} onChange={e=>updateQuoteRow(idx,'qty',e.target.value)}/></td>
                          <td style={{ padding:'4px 8px' }}><input style={{ ...INP, textAlign:'right' }} type="number" value={row.unit_price} onChange={e=>updateQuoteRow(idx,'unit_price',e.target.value)} placeholder="0"/></td>
                          <td style={{ padding:'4px 8px' }}><input style={{ ...INP, textAlign:'right' }} type="number" value={row.discount_pct} onChange={e=>updateQuoteRow(idx,'discount_pct',e.target.value)}/></td>
                          <td style={{ textAlign:'right', paddingRight:12, fontSize:12, color:'var(--gray-700)' }}>
                            {unitAfterDisc(row) > 0 ? '₹' + unitAfterDisc(row).toLocaleString('en-IN',{maximumFractionDigits:2}) : '—'}
                          </td>
                          <td className="right" style={{ fontFamily:'var(--mono)' }}>{fmtINR(row.total_price)}</td>
                          <td style={{ padding:'4px 6px' }}>
                            {quoteRows.length > 1 && <button onClick={() => setQuoteRows(prev=>prev.filter((_,i)=>i!==idx))} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:16,padding:'0 2px' }}>×</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding:'10px 20px', borderTop:'1px solid var(--gray-100)' }}>
                  <button className="od-btn" style={{ padding:'6px 10px', fontSize:12 }} onClick={() => setQuoteRows(prev=>[...prev, emptyQuoteItem()])}>+ Add Row</button>
                </div>
                <div className="od-totals">
                  <div className="od-totals-inner">
                    <div className="od-totals-row"><span>Subtotal</span><span>₹{quoteTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    <div className="od-totals-row grand"><span>Grand Total</span><span>₹{quoteTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
                <div style={{ padding:'10px 20px', borderTop:'1px solid var(--gray-100)', display:'flex', justifyContent:'flex-end' }}>
                  <button className="od-btn od-btn-primary" style={{ padding:'6px 10px', fontSize:12 }} onClick={saveQuote} disabled={savingQuote}>{savingQuote?'Saving...':'Save Quote'}</button>
                </div>
              </div>

              {/* Tasks */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Tasks ({pendingTasks.length} pending)</div>
                  {!showTaskForm && <button className="od-btn od-btn-edit" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setShowTaskForm(true)}>+ Add Task</button>}
                </div>
                {showTaskForm && (
                  <div style={{ padding:'12px 20px', borderBottom:'1px solid var(--gray-100)', background:'#f8fafc' }}>
                    <div className="od-edit-row" style={{ gridTemplateColumns:'1fr 1fr 1fr', marginBottom:8 }}>
                      <div className="od-edit-field"><label>Task Type</label>
                        <select value={taskType} onChange={e=>setTaskType(e.target.value)}>
                          {TASK_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="od-edit-field"><label>Due Date</label>
                        <input type="date" value={taskDueDate} onChange={e=>setTaskDueDate(e.target.value)}/>
                      </div>
                      <div className="od-edit-field"><label>Notes (optional)</label>
                        <input value={taskNotes} onChange={e=>setTaskNotes(e.target.value)} placeholder="Optional"/>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="od-btn od-btn-primary" style={{ padding:'6px 10px', fontSize:12 }} onClick={addTask} disabled={addingTask}>{addingTask?'Adding...':'Add Task'}</button>
                      <button className="od-btn" style={{ padding:'6px 10px', fontSize:12 }} onClick={() => setShowTaskForm(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                <div>
                  {pendingTasks.length === 0 && !showTaskForm && (
                    <div style={{ padding:'16px 20px', fontSize:12, color:'var(--gray-400)' }}>No pending tasks.</div>
                  )}
                  {pendingTasks.map(t => {
                    const isOv  = t.due_date && t.due_date < today
                    const isTdy = t.due_date === today
                    return (
                      <div key={t.id} style={{ padding:'10px 20px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, background:isOv?'#fff5f5':isTdy?'#fffbeb':'white' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13 }}>{t.task_type}</div>
                          <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>
                            {t.notes ? t.notes + ' · ' : ''}
                            {t.due_date
                              ? <span style={{ color:isOv?'#dc2626':isTdy?'#b45309':'var(--gray-400)', fontWeight:isOv||isTdy?600:400 }}>{isOv?'Overdue · ':isTdy?'Today · ':''}{t.due_date}</span>
                              : 'No due date'}
                          </div>
                        </div>
                        <button className="od-btn od-btn-approve" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}>
                          {markingDone === t.id ? '...' : '✓ Done'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Right Sidebar */}
            <div className="od-sidebar">
              {/* Quick Info */}
              <div className="od-side-card">
                <div className="od-side-card-title">Quick Info</div>
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <div className="od-detail-field"><label>Company</label><div className="val" style={{ fontWeight:600 }}>
                    <span onClick={goToCustomer} style={{ color:'#2563eb', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted' }}>
                      {lead.crm_companies?.company_name || lead.freetext_company || '—'}
                    </span>
                  </div></div>
                  <div className="od-detail-field"><label>Contact</label><div className="val">{lead.contact_name_freetext || lead.crm_contacts?.name || '—'}{lead.contact_designation ? ' · ' + lead.contact_designation : ''}</div></div>
                  {lead.contact_phone && <div className="od-detail-field"><label>Phone</label><div className="val"><a href={'tel:'+lead.contact_phone} style={{color:'#2563eb'}}>{lead.contact_phone}</a></div></div>}
                  <div className="od-detail-field"><label>Principal</label><div className="val">{lead.crm_principals?.name || '—'}</div></div>
                  <div className="od-detail-field"><label>Rep</label><div className="val">{lead.profiles?.name || '—'}</div></div>
                  {quoteTotal > 0 && (
                    <div className="od-detail-field"><label>Quote Value</label><div className="val od-side-val-big" style={{ color:'#1a4dab' }}>{fmtINR(quoteTotal)}</div></div>
                  )}
                </div>
              </div>

              {/* Contacts */}
              <div className="od-side-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="od-side-card-title" style={{ margin:0 }}>Contacts ({leadContacts.length})</div>
                  <button onClick={() => setShowContactModal(true)}
                    style={{ fontSize:11, fontWeight:700, color:'#1a4dab', background:'#eff6ff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'var(--font)' }}>
                    + Add
                  </button>
                </div>
                {leadContacts.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', textAlign:'center', padding:'10px 0' }}>
                    No contacts yet.<br/>
                    <button onClick={() => setShowContactModal(true)} style={{ marginTop:6, fontSize:12, fontWeight:600, color:'#1a4dab', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)' }}>+ Add Contact</button>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {leadContacts.map(c => (
                      <div key={c.id} style={{ display:'flex', gap:10, alignItems:'flex-start', paddingBottom:10, borderBottom:'1px solid var(--gray-50)' }}>
                        <div style={{ width:32, height:32, borderRadius:8, background:'#e0e7ff', color:'#3730a3', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          {c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'var(--gray-900)' }}>{c.name}</div>
                          {c.designation && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.designation}</div>}
                          {c.phone && <a href={'tel:' + c.phone} style={{ display:'block', fontSize:12, color:'#1a4dab', marginTop:3, textDecoration:'none', fontWeight:500 }}>{c.phone}</a>}
                          {c.email && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.email}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity Log */}
              <div className="od-side-card od-activity-card">
                <div className="od-side-card-title">Activity Log</div>
                <div className="od-activity-list">
                  {activities.map(a => (
                    <div key={a.id} className="od-activity-item">
                      <div className="od-activity-dot" style={actDotStyle(a.activity_type, a.notes)} />
                      <div>
                        <div className="od-activity-val"><strong>{actLabel(a)}</strong>{a.notes ? ': ' + a.notes : ''}</div>
                        <div className="od-activity-time">{a.profiles?.name} · {fmtTs(a.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && <div style={{ fontSize:12, color:'var(--gray-400)' }}>No activities yet.</div>}
                </div>
                <div className="od-comment-box" style={{ flexDirection:'column', gap:8, alignItems:'stretch' }}>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    {['Call','Visit','Email','Sample'].map(k => (
                      <button key={k} onClick={() => setActType(k)} style={{ fontSize:11, fontWeight:600, padding:'4px 9px', borderRadius:6, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                        background: actType===k ? '#0e2d6a' : 'white',
                        color: actType===k ? 'white' : 'var(--gray-600)',
                        borderColor: actType===k ? '#0e2d6a' : 'var(--gray-200)',
                      }}>{k}</button>
                    ))}
                  </div>
                  {actType === 'Visit' && (
                    <div style={{ display:'flex', gap:5 }}>
                      {VISIT_TYPES.map(vt => (
                        <button key={vt} onClick={() => setActVisitType(vt)} style={{ fontSize:11, fontWeight:600, padding:'3px 7px', borderRadius:6, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                          background: actVisitType===vt ? '#e8f2fc' : 'white',
                          color: actVisitType===vt ? '#1a4dab' : 'var(--gray-500)',
                          borderColor: actVisitType===vt ? '#c2d9f5' : 'var(--gray-200)',
                        }}>{vt}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                    <div className="od-comment-input-wrap">
                      <textarea className="od-comment-input" rows={2}
                        placeholder={actType==='Call'?'What was discussed on the call?':actType==='Visit'?'What was discussed?':actType==='Email'?'What was the email about?':'Describe samples submitted…'}
                        value={actText}
                        onChange={e => (actType==='Call'||actType==='Visit') ? setActDiscussion(e.target.value) : setActNotes(e.target.value)}
                      />
                    </div>
                    <button className="od-comment-btn" onClick={postActivity} disabled={postingAct}>{postingAct?'...':'Log'}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Add Contact Modal */}
      {showContactModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={() => setShowContactModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background:'white', borderRadius:16, width:'100%', maxWidth:440, boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding:'18px 24px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid var(--gray-100)' }}>
              <div style={{ fontSize:16, fontWeight:700 }}>Add Contact</div>
              <button onClick={() => setShowContactModal(false)} style={{ width:32, height:32, borderRadius:'50%', background:'var(--gray-100)', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--gray-600)', fontSize:18 }}>×</button>
            </div>
            <div style={{ padding:'20px 24px' }}>
              <div className="od-edit-form">
                <div className="od-edit-field"><label>Name *</label>
                  <input value={contactForm.name} onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))} placeholder="Contact name" />
                </div>
                <div className="od-edit-field"><label>Designation</label>
                  <input value={contactForm.designation} onChange={e => setContactForm(p => ({ ...p, designation: e.target.value }))} placeholder="e.g. Purchase Manager" />
                </div>
                <div className="od-edit-row">
                  <div className="od-edit-field"><label>Phone</label>
                    <input value={contactForm.phone} onChange={e => setContactForm(p => ({ ...p, phone: e.target.value }))} placeholder="e.g. 9876543210" />
                  </div>
                  <div className="od-edit-field"><label>Email</label>
                    <input type="email" value={contactForm.email} onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))} placeholder="e.g. name@company.com" />
                  </div>
                </div>
              </div>
            </div>
            <div style={{ padding:'14px 24px', borderTop:'1px solid var(--gray-100)', display:'flex', justifyContent:'flex-end', gap:10, background:'var(--gray-50)', borderRadius:'0 0 16px 16px' }}>
              <button className="od-btn" onClick={() => setShowContactModal(false)}>Cancel</button>
              <button className="od-btn od-btn-primary" onClick={saveLeadContact} disabled={savingContact}>{savingContact ? 'Saving...' : 'Add Contact'}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
