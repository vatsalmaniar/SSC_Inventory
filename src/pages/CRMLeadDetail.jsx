import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import '../styles/crm.css'

const SOURCES = ['Call','Visit','WhatsApp','Referral','Exhibition','Other']
const STATUSES = ['New','Contacted','Converted','Not a Fit']
const SCENARIOS = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const ACT_TYPES = ['Call','Visit','WhatsApp','Email','Meeting','Note']

function fmtTs(d) {
  if (!d) return ''
  const dt = new Date(d)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return dt.getDate() + ' ' + mo[dt.getMonth()] + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
}
function scenarioLabel(s) {
  return { NEW_CUST_NEW_PROD:'New Cust · New Prod', OLD_CUST_NEW_PROD:'Old Cust · New Prod', NEW_CUST_OLD_PROD:'New Cust · Old Prod', DORMANT_REVIVAL:'Dormant Revival' }[s] || s
}
function dotClass(t) {
  return { Call:'call', Visit:'visit', WhatsApp:'whatsapp', Email:'email', Meeting:'meeting', Note:'note', 'Stage Change':'stage' }[t] || 'note'
}

export default function CRMLeadDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name:'', role:'', id:'' })
  const [lead, setLead]       = useState(null)
  const [activities, setActivities] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]       = useState([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [saving, setSaving]   = useState(false)
  const [actType, setActType] = useState('Call')
  const [actNotes, setActNotes] = useState('')
  const [actOutcome, setActOutcome] = useState('')
  const [actNextAction, setActNextAction] = useState('')
  const [actNextDate, setActNextDate] = useState('')
  const [postingAct, setPostingAct] = useState(false)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    const [leadRes, actsRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_leads').select('*, crm_companies(company_name), crm_principals(name), crm_contacts(name,phone), profiles(name)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','ops','admin']),
    ])
    setLead(leadRes.data)
    setEditData(leadRes.data || {})
    setActivities(actsRes.data || [])
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
    if (!actNotes.trim()) { alert('Notes are required'); return }
    setPostingAct(true)
    await sb.from('crm_activities').insert({
      lead_id: id, rep_id: user.id,
      activity_type: actType, notes: actNotes.trim(),
      outcome: actOutcome.trim() || null,
      next_action: actNextAction.trim() || null,
      next_action_date: actNextDate || null,
    })
    setActNotes(''); setActOutcome(''); setActNextAction(''); setActNextDate('')
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('lead_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPostingAct(false)
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
    await sb.from('crm_activities').insert({
      lead_id: id, rep_id: user.id,
      activity_type: 'Note', notes: 'Lead converted to Opportunity #' + opp.id.slice(0,8),
    })
    navigate('/crm/opportunities/' + opp.id)
  }

  if (loading) return <Layout pageTitle="CRM — Lead" pageKey="crm"><CRMSubNav active="leads"/><div className="crm-loading"><div className="loading-spin"/>Loading...</div></Layout>
  if (!lead) return null

  return (
    <Layout pageTitle="CRM — Lead" pageKey="crm">
      <CRMSubNav active="leads" />
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <div className="crm-page-title">{lead.crm_companies?.company_name || lead.freetext_company || '—'}</div>
                <span style={{fontSize:11,fontWeight:700,borderRadius:4,padding:'2px 8px',
                  background: lead.status==='New'?'#eff6ff': lead.status==='Contacted'?'#fff7ed': lead.status==='Converted'?'#f0fdf4':'#fef2f2',
                  color: lead.status==='New'?'#1d4ed8': lead.status==='Contacted'?'#c2410c': lead.status==='Converted'?'#15803d':'#dc2626'
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
                    <div style={{display:'flex',gap:8}}>
                      <button className="crm-btn crm-btn-sm" onClick={() => setEditMode(false)}>Cancel</button>
                      <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={saveLead} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="crm-card-body">
                  {editMode ? (
                    <div className="crm-form">
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Company (freetext)</label><input value={editData.freetext_company||''} onChange={e=>setEditData(p=>({...p,freetext_company:e.target.value}))}/></div>
                        <div className="crm-edit-field"><label>Contact Name</label><input value={editData.contact_name_freetext||''} onChange={e=>setEditData(p=>({...p,contact_name_freetext:e.target.value}))}/></div>
                      </div>
                      <div className="crm-edit-row three">
                        <div className="crm-edit-field"><label>Source</label>
                          <select value={editData.source||''} onChange={e=>setEditData(p=>({...p,source:e.target.value}))}>
                            <option value="">—</option>{SOURCES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Scenario</label>
                          <select value={editData.scenario_type||''} onChange={e=>setEditData(p=>({...p,scenario_type:e.target.value}))}>
                            <option value="">—</option>{SCENARIOS.map(s=><option key={s} value={s}>{scenarioLabel(s)}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Status</label>
                          <select value={editData.status||'New'} onChange={e=>setEditData(p=>({...p,status:e.target.value}))}>
                            {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-row">
                        <div className="crm-edit-field"><label>Principal</label>
                          <select value={editData.principal_id||''} onChange={e=>setEditData(p=>({...p,principal_id:e.target.value}))}>
                            <option value="">—</option>{principals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="crm-edit-field"><label>Assigned Rep</label>
                          <select value={editData.assigned_rep_id||''} onChange={e=>setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="crm-edit-field"><label>Product Notes</label><textarea rows={3} value={editData.product_notes||''} onChange={e=>setEditData(p=>({...p,product_notes:e.target.value}))}/></div>
                    </div>
                  ) : (
                    <div className="crm-detail-grid">
                      <div className="crm-detail-field"><label>Source</label><div className="val">{lead.source||'—'}</div></div>
                      <div className="crm-detail-field"><label>Principal</label><div className="val">{lead.crm_principals?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Contact</label><div className="val">{lead.contact_name_freetext||lead.crm_contacts?.name||'—'}</div></div>
                      <div className="crm-detail-field"><label>Assigned Rep</label><div className="val">{lead.profiles?.name||'—'}</div></div>
                      <div className="crm-detail-field" style={{gridColumn:'span 2'}}><label>Product Notes</label><div className="val">{lead.product_notes||'—'}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Activity timeline */}
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
                      <div style={{fontSize:13,fontWeight:600,marginTop:2}}>{lead.crm_companies?.company_name || lead.freetext_company || '—'}</div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Contact</div>
                      <div style={{fontSize:13,marginTop:2}}>{lead.contact_name_freetext || lead.crm_contacts?.name || '—'}</div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Principal</div>
                      <div style={{fontSize:13,marginTop:2}}>{lead.crm_principals?.name || '—'}</div>
                    </div>
                    <div><div style={{fontSize:10,fontWeight:600,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'0.6px'}}>Rep</div>
                      <div style={{fontSize:13,marginTop:2}}>{lead.profiles?.name || '—'}</div>
                    </div>
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
