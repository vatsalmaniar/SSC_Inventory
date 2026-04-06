import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const STAGE_ORDER  = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','TECHNO_COMMERCIAL','FOLLOW_UP','QUOTATION_SENT','PO_RECEIVED']
const TERMINAL     = ['WON','LOST','ON_HOLD']
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  TECHNO_COMMERCIAL:'Techno-Comm', FOLLOW_UP:'Follow Up', QUOTATION_SENT:'Quote Sent',
  PO_RECEIVED:'PO Received', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const SCENARIOS   = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const TASK_TYPES  = ['Give Quote','Send Email','Visit','Call']
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
  return { Call:'call', Visit:'visit', Email:'email', Note:'note', 'Stage Change':'stage', Quotation:'quotation', Won:'won', Lost:'lost' }[type] || 'note'
}
function actLabel(a) {
  if (a.notes?.startsWith('Sample:')) return 'Sample Submission'
  return { Call:'Call', Visit:'Visit', Email:'Send Email', Note:'Note', Quotation:'Submit Quote', 'Stage Change':'Stage Change', Won:'Won', Lost:'Lost' }[a.activity_type] || a.activity_type
}

const FS = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }

function emptyQuoteItem() {
  return { _id: Date.now() + Math.random(), item_code:'', description:'', qty:'1', unit_price:'', discount_pct:'0', total_price:'' }
}

export default function CRMOpportunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [opp, setOpp]         = useState(null)
  const [activities, setActivities] = useState([])
  const [tasks, setTasks]     = useState([])
  const [quoteItems, setQuoteItems] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]   = useState(false)

  // Stage
  const [showStageMenu, setShowStageMenu] = useState(false)
  const [pendingStage, setPendingStage]   = useState(null)
  const [stageReason, setStageReason]     = useState('')
  const [stageRevisit, setStageRevisit]   = useState('')
  const [changingStage, setChangingStage] = useState(false)

  // Activity
  const [actType, setActType]           = useState('Call')
  const [actDiscussion, setActDiscussion] = useState('')
  const [actVisitType, setActVisitType]   = useState('Alone')
  const [actNotes, setActNotes]         = useState('')
  const [postingAct, setPostingAct]     = useState(false)

  // Task
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [taskType, setTaskType]         = useState('Call')
  const [taskDueDate, setTaskDueDate]   = useState('')
  const [taskNotes, setTaskNotes]       = useState('')
  const [addingTask, setAddingTask]     = useState(false)
  const [markingDone, setMarkingDone]   = useState(null)

  // Quote
  const [quoteRows, setQuoteRows]   = useState([emptyQuoteItem()])
  const [savingQuote, setSavingQuote] = useState(false)
  const [quoteLoaded, setQuoteLoaded] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    const [oppRes, actsRes, tasksRes, quoteRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*, crm_companies(id,company_name), crm_principals(name), crm_contacts(name,phone), profiles(name)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
      sb.from('crm_tasks').select('*, profiles(name)').eq('opportunity_id', id).order('due_date', { ascending: true }),
      sb.from('crm_quote_items').select('*').eq('opportunity_id', id).order('created_at', { ascending: true }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])
    const oppData = oppRes.data
    setOpp(oppData)
    setEditData(oppData || {})
    setActivities(actsRes.data || [])
    setTasks(tasksRes.data || [])
    if (quoteRes.data?.length) {
      setQuoteRows(quoteRes.data.map(q => ({ ...q, _id: q.id })))
      setQuoteItems(quoteRes.data)
      setQuoteLoaded(true)
    }
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])
    if (oppData?.company_id) {
      const { data: ctcts } = await sb.from('crm_contacts').select('id,name,phone').eq('company_id', oppData.company_id).order('name')
      setContacts(ctcts || [])
    }
    setLoading(false)
  }

  async function saveOpp() {
    setSaving(true)
    const { error } = await sb.from('crm_opportunities').update({
      product_notes: editData.product_notes,
      principal_id: editData.principal_id,
      scenario_type: editData.scenario_type,
      assigned_rep_id: editData.assigned_rep_id,
      contact_id: editData.contact_id,
      estimated_value_inr: editData.estimated_value_inr || null,
      expected_close_date: editData.expected_close_date || null,
      quotation_ref: editData.quotation_ref || null,
      quotation_value_inr: editData.quotation_value_inr || null,
      so_number: editData.so_number || null,
    }).eq('id', id)
    if (error) { alert('Error: ' + error.message); setSaving(false); return }
    setOpp(p => ({ ...p, ...editData }))
    setEditMode(false); setSaving(false)
  }

  async function changeStage(newStage) {
    if (newStage === 'ON_HOLD' && !stageRevisit) { alert('Revisit date required for On Hold'); return }
    setChangingStage(true)
    const updateData = { stage: newStage, updated_at: new Date().toISOString() }
    if (newStage === 'ON_HOLD') updateData.revisit_date = stageRevisit
    if (['WON','LOST','ON_HOLD'].includes(newStage) && stageReason) updateData.won_lost_on_hold_reason = stageReason
    const { error } = await sb.from('crm_opportunities').update(updateData).eq('id', id)
    if (error) { alert('Error: ' + error.message); setChangingStage(false); return }
    if (newStage === 'WON' && opp?.company_id) {
      await sb.from('crm_companies').update({ status: 'Active' }).eq('id', opp.company_id)
    }
    const prevLabel = STAGE_LABELS[opp.stage] || opp.stage
    const newLabel  = STAGE_LABELS[newStage] || newStage
    await sb.from('crm_activities').insert({
      opportunity_id: id, rep_id: user.id,
      activity_type: 'Stage Change',
      notes: `Stage: ${prevLabel} → ${newLabel}` + (stageReason ? ` · ${stageReason}` : ''),
    })
    setOpp(p => ({ ...p, stage: newStage, ...updateData }))
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPendingStage(null); setShowStageMenu(false); setStageReason(''); setStageRevisit('')
    setChangingStage(false)
  }

  async function postActivity() {
    let notes = '', activityType = 'Note'
    if (actType === 'Call') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      notes = actDiscussion.trim(); activityType = 'Call'
    } else if (actType === 'Visit') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      notes = '[' + actVisitType + '] ' + actDiscussion.trim(); activityType = 'Visit'
    } else if (actType === 'Email') {
      if (!actNotes.trim()) { alert('Notes required'); return }
      notes = actNotes.trim(); activityType = 'Email'
    } else if (actType === 'Sample') {
      if (!actNotes.trim()) { alert('Describe the samples submitted'); return }
      notes = 'Sample: ' + actNotes.trim(); activityType = 'Note'
    }
    setPostingAct(true)
    await sb.from('crm_activities').insert({ opportunity_id: id, rep_id: user.id, activity_type: activityType, notes })
    setActDiscussion(''); setActNotes(''); setActVisitType('Alone')
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPostingAct(false)
  }

  async function addTask() {
    setAddingTask(true)
    await sb.from('crm_tasks').insert({
      opportunity_id: id, task_type: taskType, due_date: taskDueDate || null,
      notes: taskNotes.trim() || null, assigned_rep_id: user.id, completed: false,
    })
    setTaskType('Call'); setTaskDueDate(''); setTaskNotes(''); setShowTaskForm(false)
    const { data: t } = await sb.from('crm_tasks').select('*, profiles(name)').eq('opportunity_id', id).order('due_date', { ascending: true })
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
      return prev.map((r,i) => {
        if (i !== idx) return r
        const updated = { ...r, [field]: val }
        if (['qty','unit_price','discount_pct'].includes(field)) {
          const qty   = parseFloat(field === 'qty' ? val : updated.qty) || 0
          const price = parseFloat(field === 'unit_price' ? val : updated.unit_price) || 0
          const disc  = parseFloat(field === 'discount_pct' ? val : updated.discount_pct) || 0
          updated.total_price = (qty * price * (1 - disc / 100)).toFixed(2)
        }
        return updated
      })
    })
  }

  async function saveQuote() {
    const valid = quoteRows.filter(r => r.item_code || r.description)
    if (!valid.length) { alert('Add at least one item'); return }
    setSavingQuote(true)
    await sb.from('crm_quote_items').delete().eq('opportunity_id', id)
    const { error } = await sb.from('crm_quote_items').insert(valid.map(r => ({
      opportunity_id: id, item_code: r.item_code || null, description: r.description || null,
      qty: parseFloat(r.qty) || 1, unit_price: parseFloat(r.unit_price) || 0,
      discount_pct: parseFloat(r.discount_pct) || 0, total_price: parseFloat(r.total_price) || 0,
    })))
    if (error) { alert('Error saving quote: ' + error.message); setSavingQuote(false); return }
    // Log as Quotation activity
    const total = valid.reduce((s,r) => s + (parseFloat(r.total_price)||0), 0)
    await sb.from('crm_activities').insert({
      opportunity_id: id, rep_id: user.id,
      activity_type: 'Quotation',
      notes: `Quote updated: ${valid.length} item${valid.length>1?'s':''} · Total ${fmtINR(total)}`,
    })
    const [quoteRes, actsRes] = await Promise.all([
      sb.from('crm_quote_items').select('*').eq('opportunity_id', id).order('created_at', { ascending: true }),
      sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
    ])
    setQuoteItems(quoteRes.data || [])
    setActivities(actsRes.data || [])
    setQuoteLoaded(true)
    setSavingQuote(false)
  }

  const isTerminal  = opp && TERMINAL.includes(opp.stage)
  const currentIdx  = opp ? STAGE_ORDER.indexOf(opp.stage) : -1
  const nextForward = STAGE_ORDER.slice(currentIdx + 1)
  const pendingTasks = tasks.filter(t => !t.completed)
  const quoteTotal   = quoteRows.reduce((s,r) => s + (parseFloat(r.total_price) || 0), 0)
  const today        = new Date().toISOString().slice(0,10)

  if (loading) return <Layout pageTitle="Opportunity" pageKey="crm"><CRMSubNav active="opportunities"/><div className="crm-loading"><div className="loading-spin"/>Loading...</div></Layout>
  if (!opp) return null

  return (
    <Layout pageTitle="CRM — Opportunity" pageKey="crm">
      <CRMSubNav active="opportunities" />
      <div className="crm-page">
        <div className="crm-body">
          {/* Header */}
          <div className="crm-page-header">
            <div>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <div className="crm-page-title">{opp.crm_companies?.company_name || '—'}</div>
                <StagePill stage={opp.stage} />
                {opp.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + opp.scenario_type}>{scenarioLabel(opp.scenario_type)}</span>}
              </div>
              <div className="crm-page-sub">{opp.crm_principals?.name || ''}{opp.product_notes ? ' · ' + opp.product_notes.slice(0,60) : ''}</div>
            </div>
            <div className="crm-header-actions">
              <button className="crm-btn" onClick={() => navigate('/crm/opportunities')}>← Back</button>
              {!editMode && !isTerminal && <button className="crm-btn" onClick={() => setEditMode(true)}>Edit</button>}
            </div>
          </div>

          {/* Stage bar */}
          <div className="crm-pipeline-bar">
            {STAGE_ORDER.map((s, idx) => {
              let cls = ''
              if (isTerminal) { cls = idx <= currentIdx ? 'done' : '' }
              else { if (idx < currentIdx) cls = 'done'; else if (idx === currentIdx) cls = 'active' }
              return <div key={s} className={'crm-pipe-stage ' + cls}>{STAGE_LABELS[s]}</div>
            })}
            {isTerminal && <div className={'crm-pipe-stage ' + (opp.stage==='WON'?'won':opp.stage==='LOST'?'lost':'hold')}>{STAGE_LABELS[opp.stage]}</div>}
          </div>

          {/* Stage advance */}
          {!isTerminal && !editMode && (
            <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
              {nextForward.map(s => (
                <button key={s} className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => { setPendingStage(s); setShowStageMenu(true) }}>
                  → {STAGE_LABELS[s]}
                </button>
              ))}
              <button className="crm-btn crm-btn-sm" style={{ color:'#15803d', borderColor:'#bbf7d0' }} onClick={() => { setPendingStage('WON'); setShowStageMenu(true) }}>✓ Won</button>
              <button className="crm-btn crm-btn-sm crm-btn-danger" onClick={() => { setPendingStage('LOST'); setShowStageMenu(true) }}>✕ Lost</button>
              <button className="crm-btn crm-btn-sm" style={{ color:'#b45309', borderColor:'#fde68a' }} onClick={() => { setPendingStage('ON_HOLD'); setShowStageMenu(true) }}>⏸ On Hold</button>
            </div>
          )}

          {/* Stage confirm */}
          {showStageMenu && pendingStage && (
            <div className="crm-card" style={{ borderColor: pendingStage==='WON'?'#bbf7d0':pendingStage==='LOST'?'#fecaca':'#fde68a', marginBottom:16 }}>
              <div className="crm-card-header">
                <div className="crm-card-title">{pendingStage==='WON'?'Mark Won':pendingStage==='LOST'?'Mark Lost':pendingStage==='ON_HOLD'?'Put On Hold':'Move to ' + STAGE_LABELS[pendingStage]}</div>
                <button className="crm-btn crm-btn-sm" onClick={() => { setShowStageMenu(false); setPendingStage(null) }}>Cancel</button>
              </div>
              <div className="crm-card-body">
                <div className="crm-form">
                  {['WON','LOST','ON_HOLD'].includes(pendingStage) && (
                    <div className="crm-edit-field">
                      <label>Reason (optional)</label>
                      <input style={FS} value={stageReason} onChange={e => setStageReason(e.target.value)} placeholder={pendingStage==='WON'?'e.g. PO received':pendingStage==='LOST'?'e.g. Lost to competition':'e.g. Budget pending'} />
                    </div>
                  )}
                  {pendingStage === 'ON_HOLD' && (
                    <div className="crm-edit-field">
                      <label>Revisit Date *</label>
                      <input style={FS} type="date" value={stageRevisit} onChange={e => setStageRevisit(e.target.value)} />
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="crm-btn crm-btn-primary" onClick={() => changeStage(pendingStage)} disabled={changingStage}>{changingStage?'Saving...':'Confirm'}</button>
                    <button className="crm-btn" onClick={() => { setShowStageMenu(false); setPendingStage(null) }}>Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="crm-detail-layout">
            <div>
              {/* Opp details */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Opportunity Details</div>
                  {editMode && (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="crm-btn crm-btn-sm" onClick={() => { setEditMode(false); setEditData(opp) }}>Cancel</button>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveOpp} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="crm-card-body">
                  {editMode ? (
                    <div className="crm-form">
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Principal</label>
                          <select style={FS} value={editData.principal_id||''} onChange={e => setEditData(p=>({...p,principal_id:e.target.value}))}>
                            <option value="">—</option>{principals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Scenario</label>
                          <select style={FS} value={editData.scenario_type||''} onChange={e => setEditData(p=>({...p,scenario_type:e.target.value}))}>
                            <option value="">—</option>{SCENARIOS.map(s=><option key={s} value={s}>{scenarioLabel(s)}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-field"><label>Product Notes</label>
                        <textarea style={{ ...FS, minHeight:72, resize:'vertical' }} rows={3} value={editData.product_notes||''} onChange={e => setEditData(p=>({...p,product_notes:e.target.value}))}/>
                      </div>
                      <div className="crm-edit-row three">
                        <div className="crm-edit-field"><label>Est. Value (INR)</label>
                          <input style={FS} type="number" value={editData.estimated_value_inr||''} onChange={e => setEditData(p=>({...p,estimated_value_inr:e.target.value}))} placeholder="0"/>
                        </div>
                        <div className="crm-edit-field"><label>Expected Close</label>
                          <input style={FS} type="date" value={editData.expected_close_date||''} onChange={e => setEditData(p=>({...p,expected_close_date:e.target.value}))}/>
                        </div>
                        <div className="crm-edit-field"><label>Assigned Rep</label>
                          <select style={FS} value={editData.assigned_rep_id||''} onChange={e => setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Contact</label>
                          <select style={FS} value={editData.contact_id||''} onChange={e => setEditData(p=>({...p,contact_id:e.target.value}))}>
                            <option value="">—</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?' · '+c.phone:''}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>SO Number</label>
                          <input style={FS} value={editData.so_number||''} onChange={e => setEditData(p=>({...p,so_number:e.target.value}))} placeholder="ERP reference"/>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="crm-detail-grid">
                      <div className="crm-detail-field"><label>Principal</label><div className="val">{opp.crm_principals?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Contact</label><div className="val">{opp.crm_contacts?.name||'—'}{opp.crm_contacts?.phone?' · '+opp.crm_contacts.phone:''}</div></div>
                      <div className="crm-detail-field"><label>Assigned Rep</label><div className="val">{opp.profiles?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Est. Value</label><div className="val" style={{ fontWeight:700 }}>{fmtINR(opp.estimated_value_inr)}</div></div>
                      <div className="crm-detail-field"><label>Expected Close</label><div className="val">{fmt(opp.expected_close_date)}</div></div>
                      {opp.so_number && <div className="crm-detail-field"><label>SO Number</label><div className="val">{opp.so_number}</div></div>}
                      {opp.won_lost_on_hold_reason && <div className="crm-detail-field" style={{ gridColumn:'span 2' }}><label>Reason</label><div className="val">{opp.won_lost_on_hold_reason}</div></div>}
                      {opp.revisit_date && <div className="crm-detail-field"><label>Revisit Date</label><div className="val" style={{ color:'#b45309', fontWeight:600 }}>{fmt(opp.revisit_date)}</div></div>}
                      <div className="crm-detail-field" style={{ gridColumn:'span 2' }}><label>Product Notes</label><div className="val">{opp.product_notes||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quote Items */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Quote / Products</div>
                  {quoteLoaded && <span style={{ fontSize:11, color:'var(--gray-400)' }}>{quoteItems.length} items · {fmtINR(quoteItems.reduce((s,q)=>s+(q.total_price||0),0))}</span>}
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
                        <label style={{ fontSize:10, fontWeight:600, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px', marginBottom:4, display:'block' }}>Notes</label>
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
                    const isOv  = t.due_date && t.due_date < today
                    const isTdy = t.due_date === today
                    return (
                      <div key={t.id} style={{ padding:'10px 18px', borderBottom:'1px solid var(--gray-50)', display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, background:isOv?'#fff5f5':isTdy?'#fffbeb':'white' }}>
                        <div>
                          <div style={{ fontWeight:600, fontSize:13 }}>{t.task_type}</div>
                          <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>
                            {t.notes ? t.notes + ' · ' : ''}
                            {t.due_date ? <span style={{ color:isOv?'#dc2626':isTdy?'#b45309':'var(--gray-400)', fontWeight:isOv||isTdy?600:400 }}>{isOv?'Overdue · ':isTdy?'Today · ':''}{t.due_date}</span> : 'No due date'}
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
                  <div className="crm-activity-type-row">
                    {[['Call','📞 Call'],['Visit','🏭 Visit'],['Email','✉ Email'],['Sample','📦 Sample']].map(([k,l]) => (
                      <button key={k} className={'crm-activity-type-btn' + (actType===k?' active':'')} onClick={() => setActType(k)}>{l}</button>
                    ))}
                  </div>
                  {actType === 'Call' && (
                    <textarea className="crm-activity-textarea" placeholder="What was discussed on the call?" value={actDiscussion} onChange={e => setActDiscussion(e.target.value)} />
                  )}
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
                  {actType === 'Email' && (
                    <textarea className="crm-activity-textarea" placeholder="What was the email about?" value={actNotes} onChange={e => setActNotes(e.target.value)} />
                  )}
                  {actType === 'Sample' && (
                    <textarea className="crm-activity-textarea" placeholder="Describe what samples were submitted (product, qty, purpose)…" value={actNotes} onChange={e => setActNotes(e.target.value)} />
                  )}
                  <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={postActivity} disabled={postingAct}>{postingAct?'Posting...':'Log Activity'}</button>
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
                      <div style={{ fontSize:13, fontWeight:600, marginTop:2 }}>{opp.crm_companies?.company_name || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Contact</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{opp.crm_contacts?.name || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Principal</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{opp.crm_principals?.name || '—'}</div>
                    </div>
                    <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Rep</div>
                      <div style={{ fontSize:13, marginTop:2 }}>{opp.profiles?.name || '—'}</div>
                    </div>
                    {opp.estimated_value_inr && (
                      <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Est. Value</div>
                        <div style={{ fontSize:16, fontWeight:800, marginTop:2 }}>{fmtINR(opp.estimated_value_inr)}</div>
                      </div>
                    )}
                    {quoteTotal > 0 && (
                      <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Quote Total</div>
                        <div style={{ fontSize:16, fontWeight:800, marginTop:2, color:'#1a4dab' }}>{fmtINR(quoteTotal)}</div>
                      </div>
                    )}
                    {opp.expected_close_date && (
                      <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Expected Close</div>
                        <div style={{ fontSize:13, marginTop:2 }}>{fmt(opp.expected_close_date)}</div>
                      </div>
                    )}
                    {opp.revisit_date && (
                      <div><div style={{ fontSize:10, fontWeight:600, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'0.6px' }}>Revisit Date</div>
                        <div style={{ fontSize:13, marginTop:2, color:'#b45309', fontWeight:600 }}>{fmt(opp.revisit_date)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="crm-side-card">
                <div className="crm-side-card-title">Stage</div>
                <div className="crm-side-card-body">
                  <StagePill stage={opp.stage} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

function StagePill({ stage }) {
  const styles = {
    WON:  { background:'#f0fdf4', color:'#15803d' },
    LOST: { background:'#fef2f2', color:'#dc2626' },
    ON_HOLD: { background:'#fffbeb', color:'#b45309' },
    FOLLOW_UP: { background:'#fff7ed', color:'#c2410c' },
    QUOTATION_SENT: { background:'#e8f2fc', color:'#1a4dab' },
    PO_RECEIVED: { background:'#f0fdf4', color:'#15803d' },
  }
  const s = styles[stage] || { background:'#f1f5f9', color:'#475569' }
  return <span style={{ ...s, fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 8px', whiteSpace:'nowrap' }}>{STAGE_LABELS[stage] || stage}</span>
}
