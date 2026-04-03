import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const STAGE_ORDER = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','TECHNO_COMMERCIAL','FOLLOW_UP','QUOTATION_SENT','PO_RECEIVED']
const TERMINAL    = ['WON','LOST','ON_HOLD']
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  TECHNO_COMMERCIAL:'Techno-Comm', FOLLOW_UP:'Follow Up', QUOTATION_SENT:'Quote Sent',
  PO_RECEIVED:'PO Received', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const ACT_TYPES = ['Call','Visit','WhatsApp','Email','Meeting','Note']

function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function fmtTs(d) {
  if (!d) return ''
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}
function fmtINR(v) {
  if (!v) return ''
  return '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
}
function dotClass(t) {
  return { Call:'call', Visit:'visit', WhatsApp:'whatsapp', Email:'email', Meeting:'meeting', Note:'note', 'Stage Change':'stage', Quotation:'quotation', Won:'won', Lost:'lost' }[t] || 'note'
}
function srSeq() {
  return String(Math.floor(Math.random() * 9000) + 1000)
}

export default function CRMOpportunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [opp, setOpp]         = useState(null)
  const [activities, setActivities] = useState([])
  const [sampleReqs, setSampleReqs] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [companies, setCompanies] = useState([])
  const [contacts, setContacts] = useState([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]   = useState(false)

  // Stage change
  const [showStageMenu, setShowStageMenu] = useState(false)
  const [stageReason, setStageReason] = useState('')
  const [stageRevisit, setStageRevisit] = useState('')
  const [pendingStage, setPendingStage] = useState(null)
  const [changingStage, setChangingStage] = useState(false)

  // Activity
  const [actType, setActType] = useState('Call')
  const [actNotes, setActNotes] = useState('')
  const [actOutcome, setActOutcome] = useState('')
  const [actNextAction, setActNextAction] = useState('')
  const [actNextDate, setActNextDate] = useState('')
  const [postingAct, setPostingAct] = useState(false)

  // SR
  const [showSRForm, setShowSRForm] = useState(false)
  const [srItems, setSrItems] = useState([{ product_name:'', qty:1, notes:'' }])
  const [srNotes, setSrNotes] = useState('')
  const [postingSR, setPostingSR] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })

    const [oppRes, actsRes, srsRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*, crm_companies(id,company_name), crm_principals(name), crm_contacts(name,phone), profiles(name)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
      sb.from('crm_sample_requests').select('*, crm_companies(company_name), crm_principals(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])

    const oppData = oppRes.data
    setOpp(oppData)
    setEditData(oppData || {})
    setActivities(actsRes.data || [])
    setSampleReqs(srsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])

    // Load contacts for the company
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
    if (newStage === 'ON_HOLD' && !stageRevisit) { alert('Revisit date is required for On Hold'); return }
    setChangingStage(true)

    const updateData = { stage: newStage, updated_at: new Date().toISOString() }
    if (newStage === 'ON_HOLD') updateData.revisit_date = stageRevisit
    if ((newStage === 'WON' || newStage === 'LOST' || newStage === 'ON_HOLD') && stageReason) updateData.won_lost_on_hold_reason = stageReason

    const { error } = await sb.from('crm_opportunities').update(updateData).eq('id', id)
    if (error) { alert('Error: ' + error.message); setChangingStage(false); return }

    // If WON, update company status
    if (newStage === 'WON' && opp?.company_id) {
      await sb.from('crm_companies').update({ status: 'Active' }).eq('id', opp.company_id)
    }

    // Log stage change activity
    const prevLabel = STAGE_LABELS[opp.stage] || opp.stage
    const newLabel  = STAGE_LABELS[newStage] || newStage
    const noteText  = `Stage changed: ${prevLabel} → ${newLabel}` + (stageReason ? ` · ${stageReason}` : '')
    await sb.from('crm_activities').insert({
      opportunity_id: id, rep_id: user.id,
      activity_type: 'Stage Change', notes: noteText,
    })

    // Also log Quotation activity if moving to QUOTATION_SENT
    if (newStage === 'QUOTATION_SENT' && opp.quotation_ref) {
      await sb.from('crm_activities').insert({
        opportunity_id: id, rep_id: user.id,
        activity_type: 'Quotation', notes: `Quotation sent: ${opp.quotation_ref}${opp.quotation_value_inr ? ' · ' + fmtINR(opp.quotation_value_inr) : ''}`,
      })
    }

    setOpp(p => ({ ...p, stage: newStage, ...updateData }))
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPendingStage(null); setShowStageMenu(false); setStageReason(''); setStageRevisit('')
    setChangingStage(false)
  }

  async function postActivity() {
    if (!actNotes.trim()) { alert('Notes are required'); return }
    setPostingAct(true)
    await sb.from('crm_activities').insert({
      opportunity_id: id, rep_id: user.id,
      activity_type: actType, notes: actNotes.trim(),
      outcome: actOutcome.trim() || null,
      next_action: actNextAction.trim() || null,
      next_action_date: actNextDate || null,
    })
    setActNotes(''); setActOutcome(''); setActNextAction(''); setActNextDate('')
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPostingAct(false)
  }

  async function postSR() {
    const validItems = srItems.filter(i => i.product_name.trim())
    if (validItems.length === 0) { alert('Add at least one product'); return }
    setPostingSR(true)
    const year = new Date().getFullYear()
    let seqNum = srSeq()
    try {
      const { data: seqRow } = await sb.rpc('nextval_crm_sr')
      if (seqRow) seqNum = String(seqRow).padStart(4,'0')
    } catch (_) {}
    const srNumber = 'SR-' + year + '-' + seqNum

    const { error } = await sb.from('crm_sample_requests').insert({
      sr_number: srNumber,
      opportunity_id: id,
      company_id: opp.company_id,
      contact_id: opp.contact_id,
      principal_id: opp.principal_id,
      items: validItems,
      notes: srNotes.trim() || null,
      requested_date: new Date().toISOString().slice(0,10),
    })
    if (error) { alert('Error: ' + error.message); setPostingSR(false); return }

    await sb.from('crm_activities').insert({
      opportunity_id: id, rep_id: user.id,
      activity_type: 'Note', notes: `Sample Request raised: ${srNumber} (${validItems.length} item${validItems.length > 1 ? 's' : ''})`,
    })

    setSrItems([{ product_name:'', qty:1, notes:'' }]); setSrNotes(''); setShowSRForm(false)
    const [srsRes2, actsRes2] = await Promise.all([
      sb.from('crm_sample_requests').select('*, crm_companies(company_name), crm_principals(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
      sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
    ])
    setSampleReqs(srsRes2.data || [])
    setActivities(actsRes2.data || [])
    setPostingSR(false)
  }

  async function updateSRStatus(srId, status) {
    const updateData = { status }
    if (status === 'Dispatched') updateData.dispatched_date = new Date().toISOString().slice(0,10)
    if (status === 'Delivered') updateData.delivered_date = new Date().toISOString().slice(0,10)
    await sb.from('crm_sample_requests').update(updateData).eq('id', srId)
    setSampleReqs(prev => prev.map(s => s.id === srId ? { ...s, ...updateData } : s))
  }

  const isTerminal = opp && TERMINAL.includes(opp.stage)
  const currentIdx = opp ? STAGE_ORDER.indexOf(opp.stage) : -1
  const nextForwardStages = STAGE_ORDER.slice(currentIdx + 1)
  const isOverdueOpp = opp?.stage === 'FOLLOW_UP' && (() => {
    if (!activities.length) return true
    return (Date.now() - new Date(activities[0].created_at).getTime()) > 7 * 24 * 60 * 60 * 1000
  })()

  if (loading) return <Layout pageTitle="CRM — Opportunity" pageKey="crm"><CRMSubNav active="opportunities"/><div className="crm-loading"><div className="loading-spin"/>Loading...</div></Layout>
  if (!opp) return null

  return (
    <Layout pageTitle="CRM — Opportunity" pageKey="crm">
      <CRMSubNav active="opportunities" />
      <div className="crm-page">
        <div className="crm-body">
          {/* Header */}
          <div className="crm-page-header">
            <div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <div className="crm-page-title">{opp.crm_companies?.company_name || '—'}</div>
                <StagePill stage={opp.stage} />
                {opp.scenario_type && <span className={'crm-scenario-pill crm-scenario-' + opp.scenario_type}>{scenarioLabel(opp.scenario_type)}</span>}
                {isOverdueOpp && <span className="crm-overdue-badge"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:10,height:10}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Overdue</span>}
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
              if (isTerminal) {
                cls = idx <= currentIdx ? 'done' : ''
                if (opp.stage === 'WON' && idx === STAGE_ORDER.length - 1) cls = 'won'
              } else {
                if (idx < currentIdx) cls = 'done'
                else if (idx === currentIdx) cls = 'active'
              }
              return <div key={s} className={'crm-pipe-stage ' + cls}>{STAGE_LABELS[s]}</div>
            })}
            {isTerminal && (
              <div className={'crm-pipe-stage ' + (opp.stage==='WON'?'won':opp.stage==='LOST'?'lost':'hold')}>
                {STAGE_LABELS[opp.stage]}
              </div>
            )}
          </div>

          {/* Stage advance area */}
          {!isTerminal && !editMode && (
            <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
              {nextForwardStages.map(s => (
                <button key={s} className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => { setPendingStage(s); setShowStageMenu(true) }}>
                  → {STAGE_LABELS[s]}
                </button>
              ))}
              <button className="crm-btn crm-btn-sm" style={{color:'#15803d',borderColor:'#bbf7d0'}} onClick={() => { setPendingStage('WON'); setShowStageMenu(true) }}>✓ Mark Won</button>
              <button className="crm-btn crm-btn-sm crm-btn-danger" onClick={() => { setPendingStage('LOST'); setShowStageMenu(true) }}>✕ Mark Lost</button>
              <button className="crm-btn crm-btn-sm" style={{color:'#b45309',borderColor:'#fde68a'}} onClick={() => { setPendingStage('ON_HOLD'); setShowStageMenu(true) }}>⏸ On Hold</button>
            </div>
          )}

          {/* Stage change modal */}
          {showStageMenu && pendingStage && (
            <div className="crm-card" style={{borderColor: pendingStage==='WON'?'#bbf7d0':pendingStage==='LOST'?'#fecaca':'#fde68a', marginBottom:16}}>
              <div className="crm-card-header">
                <div className="crm-card-title">
                  {pendingStage==='WON'?'Mark as Won':pendingStage==='LOST'?'Mark as Lost':pendingStage==='ON_HOLD'?'Put On Hold':('Move to ' + STAGE_LABELS[pendingStage])}
                </div>
                <button className="crm-btn crm-btn-sm" onClick={() => { setShowStageMenu(false); setPendingStage(null); setStageReason(''); setStageRevisit('') }}>Cancel</button>
              </div>
              <div className="crm-card-body">
                <div className="crm-form">
                  {(pendingStage === 'WON' || pendingStage === 'LOST' || pendingStage === 'ON_HOLD') && (
                    <div className="crm-edit-field">
                      <label>Reason {pendingStage === 'ON_HOLD' ? '(optional)' : '(optional)'}</label>
                      <input value={stageReason} onChange={e => setStageReason(e.target.value)} placeholder={pendingStage==='WON'?'e.g. PO received, price matched':pendingStage==='LOST'?'e.g. Budget constraint, competition':'e.g. Budget pending next quarter'} />
                    </div>
                  )}
                  {pendingStage === 'ON_HOLD' && (
                    <div className="crm-edit-field">
                      <label>Revisit Date *</label>
                      <input type="date" value={stageRevisit} onChange={e => setStageRevisit(e.target.value)} />
                    </div>
                  )}
                  <div style={{display:'flex',gap:8}}>
                    <button className="crm-btn crm-btn-primary" onClick={() => changeStage(pendingStage)} disabled={changingStage}>{changingStage?'Saving...':'Confirm'}</button>
                    <button className="crm-btn" onClick={() => { setShowStageMenu(false); setPendingStage(null) }}>Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="crm-detail-layout">
            <div>
              {/* Opportunity info */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Opportunity Details</div>
                  {editMode && (
                    <div style={{display:'flex',gap:8}}>
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
                          <select value={editData.principal_id||''} onChange={e => setEditData(p=>({...p,principal_id:e.target.value}))}>
                            <option value="">—</option>{principals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Scenario</label>
                          <select value={editData.scenario_type||''} onChange={e => setEditData(p=>({...p,scenario_type:e.target.value}))}>
                            <option value="">—</option>{SCENARIOS.map(s=><option key={s} value={s}>{scenarioLabel(s)}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-field"><label>Product Notes</label>
                        <textarea rows={3} value={editData.product_notes||''} onChange={e => setEditData(p=>({...p,product_notes:e.target.value}))}/>
                      </div>
                      <div className="crm-edit-row three">
                        <div className="crm-edit-field"><label>Est. Value (INR)</label>
                          <input type="number" value={editData.estimated_value_inr||''} onChange={e => setEditData(p=>({...p,estimated_value_inr:e.target.value}))} placeholder="0"/>
                        </div>
                        <div className="crm-edit-field"><label>Expected Close</label>
                          <input type="date" value={editData.expected_close_date||''} onChange={e => setEditData(p=>({...p,expected_close_date:e.target.value}))}/>
                        </div>
                        <div className="crm-edit-field"><label>Assigned Rep</label>
                          <select value={editData.assigned_rep_id||''} onChange={e => setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Contact</label>
                          <select value={editData.contact_id||''} onChange={e => setEditData(p=>({...p,contact_id:e.target.value}))}>
                            <option value="">—</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>SO Number (ERP Ref)</label>
                          <input value={editData.so_number||''} onChange={e => setEditData(p=>({...p,so_number:e.target.value}))} placeholder="SO-26-27/001"/>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Quotation Ref</label>
                          <input value={editData.quotation_ref||''} onChange={e => setEditData(p=>({...p,quotation_ref:e.target.value}))} placeholder="QT-2026-001"/>
                        </div>
                        <div className="crm-edit-field"><label>Quotation Value (INR)</label>
                          <input type="number" value={editData.quotation_value_inr||''} onChange={e => setEditData(p=>({...p,quotation_value_inr:e.target.value}))} placeholder="0"/>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="crm-detail-grid">
                      <div className="crm-detail-field"><label>Principal</label><div className="val">{opp.crm_principals?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Contact</label><div className="val">{opp.crm_contacts?.name||'—'}{opp.crm_contacts?.phone?' · '+opp.crm_contacts.phone:''}</div></div>
                      <div className="crm-detail-field"><label>Assigned Rep</label><div className="val">{opp.profiles?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Est. Value</label><div className="val" style={{fontWeight:700}}>{fmtINR(opp.estimated_value_inr)||'—'}</div></div>
                      <div className="crm-detail-field"><label>Expected Close</label><div className="val">{opp.expected_close_date||'—'}</div></div>
                      <div className="crm-detail-field"><label>Quotation Ref</label><div className="val">{opp.quotation_ref||'—'}{opp.quotation_value_inr?' · '+fmtINR(opp.quotation_value_inr):''}</div></div>
                      {opp.so_number && <div className="crm-detail-field"><label>SO Number</label><div className="val">{opp.so_number}</div></div>}
                      {opp.won_lost_on_hold_reason && <div className="crm-detail-field" style={{gridColumn:'span 2'}}><label>Reason</label><div className="val">{opp.won_lost_on_hold_reason}</div></div>}
                      {opp.revisit_date && <div className="crm-detail-field"><label>Revisit Date</label><div className="val">{opp.revisit_date}</div></div>}
                      <div className="crm-detail-field" style={{gridColumn:'span 2'}}><label>Product Notes</label><div className="val">{opp.product_notes||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Sample Requests */}
              <div className="crm-card">
                <div className="crm-card-header">
                  <div className="crm-card-title">Sample Requests</div>
                  {!showSRForm && <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => setShowSRForm(true)}>+ Raise SR</button>}
                </div>
                {showSRForm && (
                  <div style={{padding:'12px 16px',borderBottom:'1px solid var(--gray-100)'}}>
                    <div className="crm-form">
                      <div style={{display:'flex',flexDirection:'column',gap:8}}>
                        {srItems.map((item, idx) => (
                          <div key={idx} style={{display:'grid',gridTemplateColumns:'2fr 1fr 2fr auto',gap:8,alignItems:'end'}}>
                            <div className="crm-edit-field"><label style={{fontSize:10}}>Product</label><input value={item.product_name} onChange={e => setSrItems(prev => prev.map((x,i)=>i===idx?{...x,product_name:e.target.value}:x))} placeholder="Product name"/></div>
                            <div className="crm-edit-field"><label style={{fontSize:10}}>Qty</label><input type="number" min="1" value={item.qty} onChange={e => setSrItems(prev => prev.map((x,i)=>i===idx?{...x,qty:e.target.value}:x))}/></div>
                            <div className="crm-edit-field"><label style={{fontSize:10}}>Notes</label><input value={item.notes} onChange={e => setSrItems(prev => prev.map((x,i)=>i===idx?{...x,notes:e.target.value}:x))} placeholder="Optional"/></div>
                            <button className="crm-btn crm-btn-sm crm-btn-danger" onClick={() => setSrItems(prev => prev.filter((_,i)=>i!==idx))} style={{marginBottom:0}}>×</button>
                          </div>
                        ))}
                      </div>
                      <button className="crm-btn crm-btn-sm" onClick={() => setSrItems(p => [...p, { product_name:'', qty:1, notes:'' }])}>+ Add Item</button>
                      <div className="crm-edit-field"><label>SR Notes</label><textarea rows={2} value={srNotes} onChange={e => setSrNotes(e.target.value)} className="crm-activity-textarea" style={{minHeight:40}}/></div>
                      <div style={{display:'flex',gap:8}}>
                        <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={postSR} disabled={postingSR}>{postingSR?'Raising...':'Submit SR'}</button>
                        <button className="crm-btn crm-btn-sm" onClick={() => { setShowSRForm(false); setSrItems([{product_name:'',qty:1,notes:''}]); setSrNotes('') }}>Cancel</button>
                      </div>
                    </div>
                  </div>
                )}
                <div>
                  {sampleReqs.map(sr => (
                    <div key={sr.id} style={{padding:'12px 16px',borderBottom:'1px solid var(--gray-50)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
                      <div>
                        <div style={{fontWeight:700,fontSize:13,color:'var(--gray-900)'}}>{sr.sr_number}</div>
                        <div style={{fontSize:12,color:'var(--gray-500)',marginTop:2}}>
                          {sr.items?.length || 0} items · {sr.requested_date}
                          {sr.notes ? ' · ' + sr.notes : ''}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
                        <SRStatusPill status={sr.status} />
                        {sr.status === 'Pending' && <button className="crm-btn crm-btn-sm" onClick={() => updateSRStatus(sr.id, 'Dispatched')}>Mark Dispatched</button>}
                        {sr.status === 'Dispatched' && <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => updateSRStatus(sr.id, 'Delivered')}>Mark Delivered</button>}
                      </div>
                    </div>
                  ))}
                  {sampleReqs.length === 0 && !showSRForm && (
                    <div className="crm-empty" style={{padding:20}}><div className="crm-empty-sub">No sample requests yet.</div></div>
                  )}
                </div>
              </div>

              {/* Activity log */}
              <div className="crm-card">
                <div className="crm-card-header"><div className="crm-card-title">Activity Log</div></div>
                <div className="crm-activity-input-wrap">
                  <div className="crm-activity-type-row">
                    {ACT_TYPES.map(t => (
                      <button key={t} className={'crm-activity-type-btn' + (actType===t?' active':'')} onClick={() => setActType(t)}>{t}</button>
                    ))}
                  </div>
                  <textarea className="crm-activity-textarea" placeholder="Notes..." value={actNotes} onChange={e => setActNotes(e.target.value)} />
                  <div className="crm-edit-row" style={{marginBottom:8}}>
                    <div className="crm-edit-field"><label>Outcome</label><input value={actOutcome} onChange={e=>setActOutcome(e.target.value)} placeholder="Optional" /></div>
                    <div className="crm-edit-field"><label>Next Action</label><input value={actNextAction} onChange={e=>setActNextAction(e.target.value)} placeholder="Optional" /></div>
                    <div className="crm-edit-field"><label>Next Action Date</label><input type="date" value={actNextDate} onChange={e=>setActNextDate(e.target.value)} /></div>
                  </div>
                  <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={postActivity} disabled={postingAct}>{postingAct?'Posting...':'Log Activity'}</button>
                </div>
                <div className="crm-activity-list">
                  {activities.map(a => (
                    <div key={a.id} className="crm-activity-item">
                      <div className={'crm-activity-dot ' + dotClass(a.activity_type)} />
                      <div>
                        <div className="crm-activity-val"><strong>{a.activity_type}</strong>{a.notes ? ': ' + a.notes : ''}</div>
                        {a.outcome && <div style={{fontSize:12,color:'var(--gray-600)',marginTop:2}}>Outcome: {a.outcome}</div>}
                        {a.next_action && <div style={{fontSize:12,color:'#1A3A8F',marginTop:2}}>Next: {a.next_action}{a.next_action_date ? ' · ' + a.next_action_date : ''}</div>}
                        <div className="crm-activity-time">{a.profiles?.name} · {fmtTs(a.created_at)}</div>
                      </div>
                    </div>
                  ))}
                  {activities.length === 0 && <div className="crm-empty" style={{padding:20}}><div className="crm-empty-sub">No activities yet.</div></div>}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div>
              <div className="crm-side-card">
                <div className="crm-side-card-title">Quick Info</div>
                <div className="crm-side-card-body">
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Company</div>
                      <div style={{fontSize:13,fontWeight:600,marginTop:2,cursor:'pointer',color:'#1A3A8F'}} onClick={() => opp.company_id && navigate('/crm/companies/' + opp.company_id)}>
                        {opp.crm_companies?.company_name || '—'}
                      </div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Contact</div>
                      <div style={{fontSize:13,marginTop:2}}>{opp.crm_contacts?.name || '—'}</div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Principal</div>
                      <div style={{fontSize:13,marginTop:2}}>{opp.crm_principals?.name || '—'}</div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Rep</div>
                      <div style={{fontSize:13,marginTop:2}}>{opp.profiles?.name || '—'}</div>
                    </div>
                    {opp.estimated_value_inr && (
                      <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Est. Value</div>
                        <div style={{fontSize:16,fontWeight:800,marginTop:2,color:'var(--gray-900)'}}>{fmtINR(opp.estimated_value_inr)}</div>
                      </div>
                    )}
                    {opp.expected_close_date && (
                      <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Expected Close</div>
                        <div style={{fontSize:13,marginTop:2}}>{opp.expected_close_date}</div>
                      </div>
                    )}
                    {opp.revisit_date && (
                      <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Revisit Date</div>
                        <div style={{fontSize:13,marginTop:2,color:'#b45309',fontWeight:600}}>{opp.revisit_date}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="crm-side-card">
                <div className="crm-side-card-title">Stage</div>
                <div className="crm-side-card-body">
                  <StagePill stage={opp.stage} />
                  {isOverdueOpp && <div style={{marginTop:8}}><span className="crm-overdue-badge">Follow-up overdue · no activity in 7+ days</span></div>}
                  {opp.quotation_revision > 1 && <div style={{marginTop:8,fontSize:12,color:'#b45309'}}>Quotation revision #{opp.quotation_revision}</div>}
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
    QUOTATION_SENT: { background:'#eff6ff', color:'#1d4ed8' },
    PO_RECEIVED: { background:'#f0fdf4', color:'#15803d' },
  }
  const s = styles[stage] || { background:'#f1f5f9', color:'#475569' }
  return <span style={{...s, fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 8px', whiteSpace:'nowrap'}}>{STAGE_LABELS[stage] || stage}</span>
}

function SRStatusPill({ status }) {
  const s = status === 'Pending' ? { background:'#fffbeb',color:'#b45309' } : status === 'Dispatched' ? { background:'#eff6ff',color:'#1d4ed8' } : { background:'#f0fdf4',color:'#15803d' }
  return <span style={{...s, fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 7px'}}>{status}</span>
}
