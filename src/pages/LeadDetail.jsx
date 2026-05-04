import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmtTs } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm.css'
import '../styles/orderdetail.css'

const STAGES = [
  { key: 'prospecting',   label: 'Prospecting'        },
  { key: 'qualification', label: 'Lead Qualification'  },
  { key: 'discovery',     label: 'Discovery / Meeting' },
  { key: 'proposal',      label: 'Proposal'            },
  { key: 'negotiation',   label: 'Negotiation'         },
  { key: 'quotation',     label: 'Quotation Given'     },
  { key: 'won',           label: 'Closed Won'          },
  { key: 'lost',          label: 'Closed Lost'         },
]
const STAGE_KEYS = STAGES.map(s => s.key)

const INDUSTRIES = ['Textile','Pharma','Elevator','EV','Solar','Plastic','Packaging','Metal','Water','Refrigeration','Machine Tool','Crane','Infrastructure','FMCG','Energy','Automobile','Power Electronics','Datacenters','Road Construction','Cement','Tyre','Petroleum','Chemical']


function stageLabel(key) { return STAGES.find(s => s.key === key)?.label || key }

export default function LeadDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()

  const [lead, setLead]       = useState(null)
  const [user, setUser]       = useState({ name: '', role: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState({})
  const [profiles, setProfiles] = useState([])

  // Activity
  const [activities, setActivities]     = useState([])
  const [actType, setActType]           = useState('note')
  const [actText, setActText]           = useState('')
  const [actTitle, setActTitle]         = useState('')
  const [mentionQuery, setMentionQuery] = useState(null)
  const [postingAct, setPostingAct]     = useState(false)
  const actInputRef = useRef(null)

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name || '', role: profile?.role || '' })
    const { data: allP } = await sb.from('profiles').select('name').order('name')
    setProfiles(allP || [])
    await loadLead()
  }

  async function loadLead() {
    setLoading(true)
    const { data } = await sb.from('leads').select('*').eq('id', id).single()
    setLead(data)
    setLoading(false)
    loadActivities()
  }

  async function loadActivities() {
    const { data } = await sb.from('lead_activities').select('*').eq('lead_id', id).order('created_at', { ascending: true })
    setActivities(data || [])
  }

  const stageIdx    = STAGE_KEYS.indexOf(lead?.stage)
  const canAdvance  = stageIdx < STAGE_KEYS.length - 1
  const isOps       = ['ops','admin'].includes(user.role)
  const isSales     = user.role === 'sales'

  function enterEdit() {
    setEditData({
      lead_name:      lead.lead_name      || '',
      company_name:   lead.company_name   || '',
      contact_person: lead.contact_person || '',
      email:          lead.email          || '',
      mobile:         lead.mobile         || '',
      designation:    lead.designation    || '',
      lead_source:    lead.lead_source    || '',
      customer_type:  lead.customer_type  || '',
      industry:       lead.industry       || '',
      address:        lead.address        || '',
      owner_name:     lead.owner_name     || '',
      notes:          lead.notes          || '',
    })
    setEditMode(true)
  }

  async function saveEdit() {
    if (!editData.company_name.trim()) { toast('Company name is required'); return }
    setSaving(true)
    await sb.from('leads').update({ ...editData, updated_at: new Date().toISOString() }).eq('id', id)
    await loadLead()
    setEditMode(false)
    setSaving(false)
  }

  async function goToStage(stageKey) {
    if (lead?.stage === stageKey) return
    setSaving(true)
    const prev = lead.stage
    await sb.from('leads').update({ stage: stageKey, updated_at: new Date().toISOString() }).eq('id', id)
    await sb.from('lead_activities').insert({
      lead_id: id,
      activity_type: 'stage_change',
      stage_from: prev,
      stage_to: stageKey,
      author_name: user.name,
    })
    await loadLead()
    setSaving(false)
  }

  async function advanceStage() {
    if (!canAdvance) return
    await goToStage(STAGE_KEYS[stageIdx + 1])
  }

  async function convertToOpportunity() {
    if (lead?.is_opportunity) return
    setSaving(true)
    await sb.from('leads').update({ is_opportunity: true, updated_at: new Date().toISOString() }).eq('id', id)
    await sb.from('lead_activities').insert({
      lead_id: id,
      activity_type: 'stage_change',
      author_name: user.name,
      title: 'Converted to Opportunity',
    })
    await loadLead()
    setSaving(false)
  }

  // @mention
  function handleActInput(e) {
    const val = e.target.value
    setActText(val)
    const cursor = e.target.selectionStart
    const match = val.slice(0, cursor).match(/@(\w*)$/)
    setMentionQuery(match ? match[1] : null)
  }

  function insertMention(name) {
    const cursor = actInputRef.current?.selectionStart || actText.length
    const before = actText.slice(0, cursor).replace(/@\w*$/, '@' + name + ' ')
    setActText(before + actText.slice(cursor))
    setMentionQuery(null)
    setTimeout(() => actInputRef.current?.focus(), 0)
  }

  async function postActivity() {
    if (!actText.trim()) return
    setPostingAct(true)
    const tagged = [...actText.matchAll(/@(\S+)/g)].map(m => m[1])
    await sb.from('lead_activities').insert({
      lead_id: id,
      activity_type: actType,
      title: actTitle.trim() || null,
      description: actText.trim(),
      author_name: user.name,
      tagged_users: tagged,
    })
    setActText('')
    setActTitle('')
    setMentionQuery(null)
    await loadActivities()
    setPostingAct(false)
  }

  function renderText(text) {
    return (text || '').split(/(@\S+)/g).map((part, i) =>
      part.startsWith('@') ? <span key={i} className="od-mention-tag">{part}</span> : part
    )
  }

  const mentionSuggestions = mentionQuery !== null
    ? profiles.filter(p => p.name.toLowerCase().includes(mentionQuery.toLowerCase()) && p.name !== user.name).slice(0, 6)
    : []

  if (loading) return (
    <Layout pageTitle="Lead" pageKey="crm">
      <div className="od-page"><div className="loading-state" style={{paddingTop:80}}><div className="loading-spin"/></div></div>
    </Layout>
  )
  if (!lead) return <Layout pageTitle="Lead" pageKey="leads"><div className="od-page"><div style={{textAlign:'center',padding:'80px 20px',color:'var(--gray-400)'}}><div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Lead not found</div><div style={{fontSize:13}}>This lead may have been deleted or you don't have access.</div></div></div></Layout>

  return (
    <Layout pageTitle="Lead Detail" pageKey="crm">
    <div className="od-page">
      <div className="od-body">

        {/* Header */}
        <div className="od-header">
          <div className="od-header-main">
            <div className="od-header-left">
              <div>
                <div className="od-header-eyebrow">
                  {lead.customer_type || 'Lead'} · {lead.industry || ''}
                  {lead.is_opportunity && <span className="od-status-badge active" style={{background:'#fef3c7',color:'#92400e'}}>★ Opportunity</span>}
                </div>
                <div className="od-header-title">{editMode ? (editData.lead_name || editData.company_name) : (lead.lead_name || lead.company_name)}</div>
                <div className="od-header-num">{lead.company_name}{lead.contact_person ? ' · ' + lead.contact_person : ''}{lead.designation ? ' · ' + lead.designation : ''}</div>
              </div>
            </div>
            <div className="od-header-actions">
              {!editMode && (
                <button className="od-btn od-btn-edit" onClick={enterEdit}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              )}
              {editMode && (
                <>
                  <button className="od-btn" onClick={() => setEditMode(false)}>Discard</button>
                  <button className="od-btn od-btn-edit" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                </>
              )}
              {!lead.is_opportunity && !editMode && (
                <button className="crm-convert-btn" onClick={convertToOpportunity} disabled={saving}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                  Convert to Opportunity
                </button>
              )}
              {canAdvance && !editMode && (
                <button className="od-btn od-btn-approve" onClick={advanceStage} disabled={saving}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  {saving ? 'Moving...' : 'Mark Stage as Complete'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline bar */}
        <div className="od-pipeline-bar">
          <div className="od-pipeline-stages">
            {STAGES.map((stage, i) => {
              const isDone   = stageIdx > i
              const isActive = lead.stage === stage.key
              return (
                <div
                  key={stage.key}
                  className={'od-pipe-stage' + (isDone ? ' done' : '') + (isActive ? ' active' : '')}
                  onClick={() => goToStage(stage.key)}
                  style={{ cursor: 'pointer' }}
                >
                  {stage.label}
                </div>
              )
            })}
          </div>
        </div>

        {/* Opportunity banner */}
        {lead.is_opportunity && (
          <div className="crm-opp-banner">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            This lead has been converted to an opportunity.
          </div>
        )}

        {/* Two-column layout */}
        <div className="od-layout">

          {/* LEFT */}
          <div className="od-main">
            <div className="od-card">
              <div className="od-card-header"><div className="od-card-title">Lead Information</div></div>
              <div className="od-card-body">
                {editMode ? (
                  <div className="od-edit-form">
                    <div className="od-edit-row" style={{gridTemplateColumns:'1fr'}}>
                      <div className="od-edit-field"><label>Lead Name</label><input value={editData.lead_name} onChange={e => setEditData(p=>({...p,lead_name:e.target.value}))} /></div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field"><label>Customer / Company Name</label><input value={editData.company_name} onChange={e => setEditData(p=>({...p,company_name:e.target.value}))} /></div>
                      <div className="od-edit-field"><label>Contact Person</label><input value={editData.contact_person} onChange={e => setEditData(p=>({...p,contact_person:e.target.value}))} /></div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field"><label>Designation</label><input value={editData.designation} onChange={e => setEditData(p=>({...p,designation:e.target.value}))} /></div>
                      <div className="od-edit-field"><label>Mobile</label><input value={editData.mobile} onChange={e => setEditData(p=>({...p,mobile:e.target.value}))} /></div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field"><label>Email</label><input value={editData.email} onChange={e => setEditData(p=>({...p,email:e.target.value}))} /></div>
                      <div className="od-edit-field"><label>Lead Source</label>
                        <select value={editData.lead_source} onChange={e => setEditData(p=>({...p,lead_source:e.target.value}))}>
                          <option value="">— Select —</option>
                          {['Cold Call','LinkedIn','Principal Referral','Exhibition','Google','Customer Referral'].map(s=><option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field"><label>Customer Type</label>
                        <select value={editData.customer_type} onChange={e => setEditData(p=>({...p,customer_type:e.target.value}))}>
                          <option value="">— Select —</option>
                          {['OEM','Panel Builder','End User','Trader'].map(t=><option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="od-edit-field"><label>Industry</label>
                        <select value={editData.industry} onChange={e => setEditData(p=>({...p,industry:e.target.value}))}>
                          <option value="">— Select —</option>
                          {INDUSTRIES.map(i=><option key={i}>{i}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="od-edit-row">
                      <div className="od-edit-field"><label>Owner</label>
                        <select value={editData.owner_name} onChange={e => setEditData(p=>({...p,owner_name:e.target.value}))}>
                          {profiles.map(p=><option key={p.name}>{p.name}</option>)}
                        </select>
                      </div>
                      <div className="od-edit-field"><label>Address</label><input value={editData.address} onChange={e => setEditData(p=>({...p,address:e.target.value}))} /></div>
                    </div>
                    <div className="od-edit-row" style={{gridTemplateColumns:'1fr'}}>
                      <div className="od-edit-field"><label>Notes</label><textarea value={editData.notes} onChange={e => setEditData(p=>({...p,notes:e.target.value}))} rows={2} /></div>
                    </div>
                  </div>
                ) : (
                  <div className="od-detail-grid">
                    <div className="od-detail-field"><label>Mobile</label><div className="val" style={{fontFamily:'var(--mono)'}}>{lead.mobile || '—'}</div></div>
                    <div className="od-detail-field"><label>Email</label><div className="val">{lead.email || '—'}</div></div>
                    <div className="od-detail-field"><label>Lead Source</label><div className="val">{lead.lead_source || '—'}</div></div>
                    <div className="od-detail-field"><label>Customer Type</label><div className="val">{lead.customer_type || '—'}</div></div>
                    <div className="od-detail-field"><label>Industry</label><div className="val">{lead.industry || '—'}</div></div>
                    <div className="od-detail-field"><label>Address</label><div className="val">{lead.address || '—'}</div></div>
                    {lead.notes && <div className="od-detail-field" style={{gridColumn:'1/-1'}}><label>Notes</label><div className="val od-notes-val">{lead.notes}</div></div>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div className="od-sidebar">

            {/* Owner */}
            <div className="od-side-card">
              <div className="od-side-card-title">Account Owner</div>
              <div className="od-account-owner">
                <div className="od-owner-avatar">{(lead.owner_name || '?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</div>
                <div className="od-side-val-big" style={{margin:0}}>{lead.owner_name || '—'}</div>
              </div>
            </div>

            {/* Stage */}
            <div className="od-side-card">
              <div className="od-side-card-title">Current Stage</div>
              <span className={'crm-stage-pill ' + lead.stage}>{stageLabel(lead.stage)}</span>
              <div className="od-side-sub" style={{marginTop:8}}>Created {fmtTs(lead.created_at)}</div>
            </div>

            {/* Activity */}
            <div className="od-side-card od-activity-card">
              <div className="od-side-card-title">Activity</div>

              {/* Type toggle */}
              <div className="crm-activity-type-btns">
                {['note','call','meeting'].map(t => (
                  <button key={t} className={'crm-act-type-btn' + (actType===t?' active':'')} onClick={() => setActType(t)}>
                    {t.charAt(0).toUpperCase()+t.slice(1)}
                  </button>
                ))}
              </div>

              {/* Timeline */}
              <div className="od-activity-list">
                <div className="od-activity-item">
                  <div className="od-activity-dot submitted" />
                  <div>
                    <div className="od-activity-label">Lead Created</div>
                    <div className="od-activity-time">{fmtTs(lead.created_at)}</div>
                  </div>
                </div>
                {activities.map(a => (
                  <div key={a.id} className={'od-activity-item' + (a.activity_type === 'note' || a.activity_type === 'call' || a.activity_type === 'meeting' ? ' od-comment-item' : '')}>
                    {a.activity_type === 'stage_change' ? (
                      <>
                        <div className="od-activity-dot" style={{background:'#16a34a'}} />
                        <div>
                          {a.title ? (
                            <div className="od-activity-val">{a.title}</div>
                          ) : (
                            <div className="crm-stage-change-entry">
                              Moved from <strong>{stageLabel(a.stage_from)}</strong> → <strong>{stageLabel(a.stage_to)}</strong>
                            </div>
                          )}
                          {a.author_name && <div className="od-activity-label" style={{marginTop:2}}>{a.author_name}</div>}
                          <div className="od-activity-time">{fmtTs(a.created_at)}</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={'od-comment-avatar crm-act-dot-' + a.activity_type} style={{background: a.activity_type==='call'?'#1a4dab':a.activity_type==='meeting'?'#7c3aed':'#d97706', color:'white'}}>
                          {(a.author_name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </div>
                        <div className="od-comment-body">
                          <div className="od-comment-author">
                            {a.author_name}
                            <span style={{fontSize:10,background:'var(--gray-100)',color:'var(--gray-500)',borderRadius:4,padding:'1px 6px',fontWeight:500}}>{a.activity_type}</span>
                            {a.tagged_users?.length > 0 && <span className="od-comment-tagged">tagged {a.tagged_users.map(u=>'@'+u).join(', ')}</span>}
                          </div>
                          {a.title && <div style={{fontSize:12,fontWeight:600,color:'var(--gray-800)',marginBottom:2}}>{a.title}</div>}
                          <div className="od-comment-text">{renderText(a.description)}</div>
                          <div className="od-activity-time">{fmtTs(a.created_at)}</div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Post activity */}
              <div className="od-comment-box" style={{flexDirection:'column',gap:8}}>
                {actType !== 'note' && (
                  <input
                    value={actTitle}
                    onChange={e => setActTitle(e.target.value)}
                    placeholder={actType === 'call' ? 'Call subject...' : 'Meeting subject...'}
                    style={{border:'1px solid var(--gray-200)',borderRadius:8,padding:'8px 10px',fontFamily:'var(--font)',fontSize:13,width:'100%',outline:'none',boxSizing:'border-box'}}
                  />
                )}
                <div style={{display:'flex',gap:8,alignItems:'flex-end'}}>
                  <div className="od-comment-input-wrap" style={{flex:1}}>
                    <textarea
                      ref={actInputRef}
                      className="od-comment-input"
                      value={actText}
                      onChange={handleActInput}
                      onKeyDown={e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); postActivity() } }}
                      placeholder={actType==='call' ? 'Log a call note… use @ to tag' : actType==='meeting' ? 'Meeting summary… use @ to tag' : 'Add a note… use @ to tag someone'}
                      rows={2}
                    />
                    {mentionQuery !== null && mentionSuggestions.length > 0 && (
                      <div className="od-mention-dropdown">
                        {mentionSuggestions.map(p => (
                          <div key={p.name} className="od-mention-item" onMouseDown={e => { e.preventDefault(); insertMention(p.name) }}>
                            <div className="od-mention-avatar">{p.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}</div>
                            {p.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="od-comment-btn" onClick={postActivity} disabled={postingAct||!actText.trim()}>
                    {postingAct ? '...' : 'Post'}
                  </button>
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
