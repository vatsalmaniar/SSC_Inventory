import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SOURCES    = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const STATUSES   = ['New','Contacted','Converted','Not a Fit']
const SCENARIOS  = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const TASK_TYPES = ['Give Quote','Send Email','Visit','Call']
const VISIT_TYPES = ['Alone','With SSC','With Principal']

function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function fmtTs(d) {
  if (!d) return ''
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}
function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.getDate().toString().padStart(2,'0') + '-' + (dt.getMonth()+1).toString().padStart(2,'0') + '-' + dt.getFullYear()
}
function fmtINR(v) {
  if (!v && v !== 0) return '—'
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function actDot(type, notes) {
  if (notes?.startsWith('Sample:')) return 'sample'
  return { Call:'call', Visit:'visit', Email:'email', Note:'note', 'Stage Change':'stage', Quotation:'quotation' }[type] || 'note'
}
function actLabel(a) {
  if (a.notes?.startsWith('Sample:')) return 'Sample Submission'
  return { Call:'Call', Visit:'Visit', Email:'Send Email', Note:'Note', Quotation:'Submit Quote', 'Stage Change':'Stage Change' }[a.activity_type] || a.activity_type
}

const FS = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }

function emptyQuoteItem() {
  return { _id: Date.now() + Math.random(), item_code:'', description:'', qty:'1', unit_price:'', discount_pct:'0', total_price:'' }
}

export default function CRMLeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [lead, setLead]       = useState(null)
  const [activities, setActivities] = useState([])
  const [tasks, setTasks]     = useState([])
  const [quoteItems, setQuoteItems] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]   = useState(false)

  // Activity
  const [actType, setActType]         = useState('Call')
  const [actDiscussion, setActDiscussion] = useState('')
  const [actVisitType, setActVisitType]   = useState('Alone')
  const [actNotes, setActNotes]       = useState('')
  const [postingAct, setPostingAct]   = useState(false)

  // Task
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskType, setTaskType]     = useState('Call')
  const [taskDueDate, setTaskDueDate] = useState('')
  const [taskNotes, setTaskNotes]   = useState('')
  const [addingTask, setAddingTask] = useState(false)
  const [markingDone, setMarkingDone] = useState(null)

  // Quote
  const [quoteRows, setQuoteRows] = useState([emptyQuoteItem()])
  const [savingQuote, setSavingQuote] = useState(false)
  const [quoteLoaded, setQuoteLoaded] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    const [leadRes, actsRes, tasksRes, quoteRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_leads').select('*, crm_companies(company_name), crm_principals(name), crm_contacts(name,phone), profiles(name)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('crm_tasks').select('*, profiles(name)').eq('lead_id', id).order('due_date', { ascending: true }),
      sb.from('crm_quote_items').select('*').eq('lead_id', id).order('created_at', { ascending: true }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
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
    setLoading(false)
  }

  async function saveLead() {
    setSaving(true)
    const { error } = await sb.from('crm_leads').update({
      freetext_company: editData.freetext_company,
      contact_name_freetext: editData.contact_name_freetext,
      source: editData.source,
      principal_id: editData.principal_id,
      product_notes: editData.product_notes,
      scenario_type: editData.scenario_type,
      assigned_rep_id: editData.assigned_rep_id,
      status: editData.status,
    }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setLead(p => ({ ...p, ...editData }))
    setEditMode(false); setSaving(false)
  }

  async function postActivity() {
    let notes = '', activityType = 'Note'
    if (actType === 'Call') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      notes = actDiscussion.trim()
      activityType = 'Call'
    } else if (actType === 'Visit') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      notes = '[' + actVisitType + '] ' + actDiscussion.trim()
      activityType = 'Visit'
    } else if (actType === 'Email') {
      if (!actNotes.trim()) { alert('Notes required'); return }
      notes = actNotes.trim()
      activityType = 'Email'
    } else if (actType === 'Sample') {
      if (!actNotes.trim()) { alert('Describe the samples submitted'); return }
      notes = 'Sample: ' + actNotes.trim()
      activityType = 'Note'
    }
    setPostingAct(true)
    await sb.from('crm_activities').insert({ lead_id: id, rep_id: user.id, activity_type: activityType, notes })
    setActDiscussion(''); setActNotes(''); setActVisitType('Alone')
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
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
    setAddingTask(false)
  }

  async function markTaskDone(taskId) {
    setMarkingDone(taskId)
    await sb.from('crm_tasks').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
    setMarkingDone(null)
  }

  function updateQuoteRow(idx, field, val) {
    setQuoteRows(prev => {
      const rows = prev.map((r,i) => {
        if (i !== idx) return r
        const updated = { ...r, [field]: val }
        if (field === 'qty' || field === 'unit_price' || field === 'discount_pct') {
          const qty   = parseFloat(field === 'qty' ? val : updated.qty) || 0
          const price = parseFloat(field === 'unit_price' ? val : updated.unit_price) || 0
          const disc  = parseFloat(field === 'discount_pct' ? val : updated.discount_pct) || 0
          updated.total_price = (qty * price * (1 - disc / 100)).toFixed(2)
        }
        return updated
      })
      return rows
    })
  }

  async function saveQuote() {
    const valid = quoteRows.filter(r => r.item_code || r.description)
    if (!valid.length) { alert('Add at least one item'); return }
    setSavingQuote(true)
    // Delete existing and re-insert
    await sb.from('crm_quote_items').delete().eq('lead_id', id)
    const { error } = await sb.from('crm_quote_items').insert(valid.map(r => ({
      lead_id: id, item_code: r.item_code || null, description: r.description || null,
      qty: parseFloat(r.qty) || 1, unit_price: parseFloat(r.unit_price) || 0,
      discount_pct: parseFloat(r.discount_pct) || 0, total_price: parseFloat(r.total_price) || 0,
    })))
    if (error) { alert('Error saving quote: ' + error.message); setSavingQuote(false); return }
    const { data: q } = await sb.from('crm_quote_items').select('*').eq('lead_id', id).order('created_at', { ascending: true })
    setQuoteItems(q || [])
    setQuoteLoaded(true)
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
    if (error) { alert('Error: ' + error.message); return }
    await sb.from('crm_leads').update({ status: 'Converted' }).eq('id', id)
    navigate('/crm/opportunities/' + opp.id)
  }

  const quoteTotal = quoteRows.reduce((s,r) => s + (parseFloat(r.total_price) || 0), 0)
  const pendingTasks = tasks.filter(t => !t.completed)
  const today = new Date().toISOString().slice(0,10)

  if (loading) return <Layout pageTitle="Lead" pageKey="crm"><CRMSubNav active="leads"/><div className="crm-loading"><div className="loading-spin"/>Loading...</div></Layout>
  if (!lead) return null

  return (
    <Layout pageTitle="CRM — Lead" pageKey="crm">
      <CRMSubNav active="leads" />
      <div className="crm-page">
        <div className="crm-body">
          {/* Header */}
          <div className="crm-page-header">
            <div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <div className="crm-page-title">{lead.crm_companies?.company_name || lead.freetext_company || '—'}</div>
                <span style={{ fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 8px',
                  background: lead.status==='New'?'#e8f2fc':lead.status==='Contacted'?'#fff7ed':lead.status==='Converted'?'#f0fdf4':'#fef2f2',
                  color: lead.status==='New'?'#1a4dab':lead.status==='Contacted'?'#c2410c':lead.status==='Converted'?'#15803d':'#dc2626',
                }}>{lead.status}</span>
                {lead.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + lead.scenario_type}>{scenarioLabel(lead.scenario_type)}</span>}
              </div>
              <div className="crm-page-sub">{lead.contact_name_freetext || ''}{lead.crm_principals?.name ? ' · ' + lead.crm_principals.name : ''}</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm/leads')}>← Back</button>
              {lead.status !== 'Converted' && <button className="crm-btn crm-btn-green" onClick={convertToOpportunity}>Convert to Opportunity</button>}
              {!editMode && <button className="crm-btn" onClick={() => setEditMode(true)}>Edit</button>}
            </div>
          </div>

          <div className="crm-detail-layout">
            <div>
              {/* Lead info */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Lead Information</div>
                  {editMode && (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="crm-btn crm-btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveLead} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="crm-card-body">
                  {editMode ? (
                    <div className="crm-form">
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Company</label><input style={FS} value={editData.freetext_company||''} onChange={e=>setEditData(p=>({...p,freetext_company:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Contact Name</label><input style={FS} value={editData.contact_name_freetext||''} onChange={e=>setEditData(p=>({...p,contact_name_freetext:e.target.value}))}/></div>
                      </div>
                      <div className="crm-edit-row three">
                        <div className="crm-edit-field"><label>Source</label>
                          <select style={FS} value={editData.source||''} onChange={e=>setEditData(p=>({...p,source:e.target.value}))}>
                            <option value="">—</option>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Scenario</label>
                          <select style={FS} value={editData.scenario_type||''} onChange={e=>setEditData(p=>({...p,scenario_type:e.target.value}))}>
                            <option value="">—</option>{SCENARIOS.map(s=><option key={s} value={s}>{scenarioLabel(s)}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Status</label>
                          <select style={FS} value={editData.status||'New'} onChange={e=>setEditData(p=>({...p,status:e.target.value}))}>
                            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Principal</label>
                          <select style={FS} value={editData.principal_id||''} onChange={e=>setEditData(p=>({...p,principal_id:e.target.value}))}>
                            <option value="">—</option>{principals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Assigned Rep</label>
                          <select style={FS} value={editData.assigned_rep_id||''} onChange={e=>setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-field"><label>Product Notes</label><textarea style={{ ...FS, minHeight:72, resize:'vertical' }} rows={3} value={editData.product_notes||''} onChange={e=>setEditData(p=>({...p,product_notes:e.target.value}))}/></div>
                    </div>
                  ) : (
                    <div className="crm-detail-grid">
                      <div className="crm-detail-field"><label>Source</label><div className="val">{lead.source||'—'}</div></div>
                      <div className="crm-detail-field"><label>Principal</label><div className="val">{lead.crm_principals?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Contact</label><div className="val">{lead.contact_name_freetext||lead.crm_contacts?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Assigned Rep</label><div className="val">{lead.profiles?.name||'—'}</div></div>
                      <div className="crm-detail-field" style={{ gridColumn:'span 2' }}><label>Product Notes</label><div className="val">{lead.product_notes||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quote Items */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Quote Items</div>
                  {quoteLoaded && <span style={{ fontSize:11, color:'var(--gray-400)' }}>Saved {quoteItems.length} items</span>}
                </div>
                <div className="crm-card-body">
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr style={{ background:'var(--gray-50)' }}>
                          <th style={{ padding:'6px 8px', textAlign:'left', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase' }}>Item Code</th>
                          <th style={{ padding:'6px 8px', textAlign:'left', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase' }}>Description</th>
                          <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase', width:60 }}>Qty</th>
                          <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase', width:90 }}>Unit Price</th>
                          <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase', width:60 }}>Disc%</th>
                          <th style={{ padding:'6px 8px', textAlign:'right', fontWeight:600, color:'var(--gray-500)', fontSize:10, textTransform:'uppercase', width:90 }}>Total</th>
                          <th style={{ width:30 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {quoteRows.map((row, idx) => (
                          <tr key={row._id}>
                            <td style={{ padding:'4px 4px' }}><input style={{ ...FS, padding:'5px 8px', fontSize:12 }} value={row.item_code} onChange={e=>updateQuoteRow(idx,'item_code',e.target.value)} placeholder="Code" /></td>
                            <td style={{ padding:'4px 4px' }}><input style={{ ...FS, padding:'5px 8px', fontSize:12 }} value={row.description} onChange={e=>updateQuoteRow(idx,'description',e.target.value)} placeholder="Description" /></td>
                            <td style={{ padding:'4px 4px' }}><input style={{ ...FS, padding:'5px 8px', fontSize:12, textAlign:'right' }} type="number" value={row.qty} onChange={e=>updateQuoteRow(idx,'qty',e.target.value)} /></td>
                            <td style={{ padding:'4px 4px' }}><input style={{ ...FS, padding:'5px 8px', fontSize:12, textAlign:'right' }} type="number" value={row.unit_price} onChange={e=>updateQuoteRow(idx,'unit_price',e.target.value)} placeholder="0" /></td>
                            <td style={{ padding:'4px 4px' }}><input style={{ ...FS, padding:'5px 8px', fontSize:12, textAlign:'right' }} type="number" value={row.discount_pct} onChange={e=>updateQuoteRow(idx,'discount_pct',e.target.value)} /></td>
                            <td style={{ padding:'4px 8px', textAlign:'right', fontWeight:600, color:'var(--gray-900)', fontFamily:'var(--mono)', whiteSpace:'nowrap' }}>{fmtINR(row.total_price)}</td>
                            <td style={{ padding:'4px 4px' }}>
                              {quoteRows.length > 1 && <button onClick={() => setQuoteRows(prev => prev.filter((_,i)=>i!==idx))} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-400)', fontSize:16, padding:'0 4px' }}>×</button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10, paddingTop:10, borderTop:'1px solid var(--gray-100)' }}>
                    <button className="crm-btn crm-btn-sm" onClick={() => setQuoteRows(prev => [...prev, emptyQuoteItem()])}>+ Add Row</button>
                    <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                      <span style={{ fontWeight:700, fontSize:14, color:'var(--gray-900)' }}>Total: {fmtINR(quoteTotal)}</span>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveQuote} disabled={savingQuote}>{savingQuote?'Saving...':'Save Quote'}</button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tasks */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Tasks ({pendingTasks.length} pending)</div>
                  {!showTaskForm && <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => setShowTaskForm(true)}>+ Add Task</button>}
                </div>
                {showTaskForm && (
                  <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--gray-100)', background:'#f8fafc' }}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:8 }}>
                      <div>
                        <label style={{ fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }}>Task Type</label>
                        <select style={FS} value={taskType} onChange={e => setTaskType(e.target.value)}>
                          {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }}>Due Date</label>
                        <input style={FS} type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)} />
                      </div>
                      <div>
                        <label style={{ fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }}>Notes (optional)</label>
                        <input style={FS} value={taskNotes} onChange={e => setTaskNotes(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={addTask} disabled={addingTask}>{addingTask?'Adding...':'Add Task'}</button>
                      <button className="crm-btn crm-btn-sm" onClick={() => setShowTaskForm(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                <div>
                  {pendingTasks.length === 0 && !showTaskForm && (
                    <div style={{ padding:'16px 18px', fontSize:12, color:'var(--gray-400)' }}>No pending tasks.</div>
                  )}
                  {pendingTasks.map(t => {
                    const isOv = t.due_date && t.due_date < today
                    const isTdy = t.due_date === today
                    return (
                      <div key={t.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, background: isOv?'#fff5f5':isTdy?'#fffbeb':'white' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13 }}>{t.task_type}</div>
                          <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>
                            {t.notes ? t.notes + ' · ' : ''}
                            {t.due_date ? <span style={{ color: isOv?'#dc2626':isTdy?'#b45309':'var(--gray-400)', fontWeight: isOv||isTdy?600:400 }}>{isOv?'Overdue · ':isTdy?'Today · ':''}{t.due_date}</span> : 'No due date'}
                          </div>
                        </div>
                        <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => markTaskDone(t.id)} disabled={markingDone === t.id}>
                          {markingDone === t.id ? '...' : '✓ Done'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Activity Log */}
              <div className="crm-card">
                <div className="crm-card-header"><div className="crm-card-title">Activity Log</div></div>
                <div className="crm-activity-input-wrap">
                  {/* Activity type selector */}
                  <div className="crm-activity-type-row">
                    {[['Call','📞 Call'],['Visit','🏭 Visit'],['Email','✉ Email'],['Sample','📦 Sample']].map(([k,l]) => (
                      <button key={k} className={'crm-activity-type-btn' + (actType===k?' active':'')} onClick={() => setActType(k)}>{l}</button>
                    ))}
                  </div>

                  {/* Call */}
                  {actType === 'Call' && (
                    <textarea className="crm-activity-textarea" placeholder="What was discussed on the call?" value={actDiscussion} onChange={e => setActDiscussion(e.target.value)} />
                  )}

                  {/* Visit */}
                  {actType === 'Visit' && (
                    <>
                      <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                        {VISIT_TYPES.map(vt => (
                          <button key={vt} className={'crm-activity-type-btn' + (actVisitType===vt?' active':'')} onClick={() => setActVisitType(vt)} style={{ fontSize:11 }}>{vt}</button>
                        ))}
                      </div>
                      <textarea className="crm-activity-textarea" placeholder="What was discussed during the visit?" value={actDiscussion} onChange={e => setActDiscussion(e.target.value)} />
                    </>
                  )}

                  {/* Email */}
                  {actType === 'Email' && (
                    <textarea className="crm-activity-textarea" placeholder="What was the email about?" value={actNotes} onChange={e => setActNotes(e.target.value)} />
                  )}

                  {/* Sample */}
                  {actType === 'Sample' && (
                    <textarea className="crm-activity-textarea" placeholder="Describe what samples were submitted (product, qty, purpose)…" value={actNotes} onChange={e => setActNotes(e.target.value)} />
                  )}

                  <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={postActivity} disabled={postingAct}>
                    {postingAct ? 'Posting...' : 'Log Activity'}
                  </button>
                </div>
                <div className="crm-activity-list">
                  {activities.map(a => (
                    <div key={a.id} className="crm-activity-item">
                      <div className={'crm-activity-dot ' + actDot(a.activity_type, a.notes)} />
                      <div>
                        <div className="crm-activity-val"><strong>{actLabel(a)}</strong>{a.notes ? ': ' + a.notes : ''}</div>
                        <div className="crm-activity-time">{a.profiles?.name} · {fmtTs(a.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && <div className="crm-empty" style={{ padding:20 }}><div className="crm-empty-sub">No activities yet.</div></div>}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <div className="crm-side-card">
                <div className="crm-side-card-title">Quick Info</div>
                <div className="crm-side-card-body">
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Company</div>
                      <div style={{ fontSize:13, fontWeight:600, marginTop:2 }}>{lead.crm_companies?.company_name || lead.freetext_company || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Contact</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{lead.contact_name_freetext || lead.crm_contacts?.name || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Principal</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{lead.crm_principals?.name || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Rep</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{lead.profiles?.name || '—'}</div>
                    </div>
                    {quoteTotal > 0 && (
                      <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Quote Value</div>
                        <div style={{ fontSize:16, fontWeight:800, marginTop:2, color:'var(--gray-900)' }}>{fmtINR(quoteTotal)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
