import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
import { toast } from '../lib/toast'
import { fmtNum } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm.css'
import '../styles/orders.css'

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }

const VISIT_TYPES = ['SOLO','JOINT_PRINCIPAL','JOINT_SSC_TEAM']
const VISIT_TYPE_LABELS = { SOLO:'Solo', JOINT_PRINCIPAL:'Joint w/ Principal', JOINT_SSC_TEAM:'Joint SSC Team' }

const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}


function emptyForm() {
  return {
    visit_date: new Date().toISOString().slice(0,10),
    visit_type: 'SOLO',
    with_ssc: false,
    with_principal: false,
    selected_customer_id: '',
    company_freetext: '',
    opportunity_id: '',
    purpose: '',
    outcome: '',
    next_action: '',
    next_action_date: '',
    principal_id: '',
    principal_rep_name: '',
    ssc_team_members: [],
  }
}

export default function CRMFieldVisits() {
  const navigate = useNavigate()
  const [user, setUser]             = useState({ name:'', role:'', id:'' })
  const [visits, setVisits]         = useState([])
  const [reps, setReps]             = useState([])
  const [principals, setPrincipals] = useState([])
  const [loading, setLoading]       = useState(true)
  const [showModal, setShowModal]   = useState(false)
  const [viewVisit, setViewVisit]   = useState(null)
  const [saving, setSaving]         = useState(false)
  const [search, setSearch]         = useState('')
  const [filterRep, setFilterRep]   = useState('')
  const [form, setForm]             = useState(emptyForm())
  const [companyOpps, setCompanyOpps] = useState([])
  const [loadingOpps, setLoadingOpps] = useState(false)
  const [customers, setCustomers]   = useState([])
  const [acctSearch, setAcctSearch] = useState('')
  const [showAcctDrop, setShowAcctDrop] = useState(false)

  useEffect(() => { init() }, [])

  // Realtime: live field visits updates
  useRealtimeSubscription('crm-visits-list', {
    table: 'crm_field_visits', enabled: !loading,
    onEvent: () => init(),
  })

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }

    const [visitsRes, repsRes, principalsRes] = await Promise.all([
      sb.from('crm_field_visits')
        .select('*, profiles(name), crm_principals(name), crm_opportunities(id,opportunity_name,product_notes,stage)')
        .order('visit_date', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
      sb.from('crm_principals').select('*').order('name'),
    ])
    setVisits(visitsRes.data || [])
    setReps(repsRes.data || [])
    setPrincipals(principalsRes.data || [])
    setLoading(false)
  }

  // Load customers only when modal opens — same pattern as NewLeadModal
  async function loadCustomers() {
    if (customers.length > 0) return // already loaded
    let all = []
    let from = 0
    while (true) {
      const { data } = await sb.from('customers').select('id,customer_name,account_owner,customer_type').order('customer_name').range(from, from + 999)
      if (!data || data.length === 0) break
      all = [...all, ...data]
      if (data.length < 1000) break
      from += 1000
    }
    setCustomers(all)
  }

  async function onSelectCustomer(c) {
    setForm(p => ({ ...p, selected_customer_id: c.id, company_freetext: c.customer_name, opportunity_id: '' }))
    setAcctSearch(c.customer_name)
    setShowAcctDrop(false)
    setLoadingOpps(true)
    const { data } = await sb.from('crm_opportunities')
      .select('id,opportunity_name,product_notes,stage,estimated_value_inr')
      .eq('customer_id', c.id)
      .not('stage', 'in', '(WON,LOST)')
      .order('created_at', { ascending: false })
    setCompanyOpps(data || [])
    setLoadingOpps(false)
  }

  async function saveVisit() {
    const companyName = form.company_freetext.trim() || acctSearch.trim()
    if (!companyName) { toast('Account / Company is required'); return }
    setForm(p => ({ ...p, company_freetext: companyName }))
    if (!form.visit_date) { toast('Visit date is required'); return }
    if (form.visit_type === 'JOINT_PRINCIPAL' && !form.principal_id) { toast('Principal is required'); return }
    setSaving(true)

    const visitType = form.with_ssc && form.with_principal ? 'JOINT_SSC_TEAM'
      : form.with_ssc ? 'JOINT_SSC_TEAM'
      : form.with_principal ? 'JOINT_PRINCIPAL'
      : 'SOLO'
    const payload = {
      rep_id: user.id,
      visit_date: form.visit_date,
      visit_type: visitType,
      company_freetext: form.company_freetext.trim(),
      company_id: null,
      opportunity_id: form.opportunity_id || null,
      purpose: form.purpose.trim() || null,
      outcome: form.outcome.trim() || null,
      next_action: form.next_action.trim() || null,
      next_action_date: form.next_action_date || null,
      principal_id: form.with_principal ? (form.principal_id || null) : null,
      principal_rep_name: form.with_principal ? (form.principal_rep_name.trim() || null) : null,
      ssc_team_members: form.with_ssc ? form.ssc_team_members : [],
    }

    const { error } = await sb.from('crm_field_visits').insert(payload)
    if (error) { toast('Error saving visit: ' + error.message); setSaving(false); return }

    // If linked to opportunity → post Visit activity on it
    if (form.opportunity_id) {
      const notes = [
        'Field visit · ' + VISIT_TYPE_LABELS[form.visit_type],
        form.purpose ? 'Purpose: ' + form.purpose : null,
        form.outcome ? 'Outcome: ' + form.outcome : null,
      ].filter(Boolean).join('\n')
      await sb.from('crm_activities').insert({
        opportunity_id: form.opportunity_id,
        rep_id: user.id,
        activity_type: 'Visit',
        notes,
      })
    }

    const { data: fresh } = await sb.from('crm_field_visits')
      .select('*, profiles(name), crm_principals(name), crm_opportunities(id,opportunity_name,product_notes,stage)')
      .order('visit_date', { ascending: false })
    setVisits(fresh || [])
    setForm(emptyForm())
    setCompanyOpps([])
    toast('Field visit logged', 'success')
    setShowModal(false)
    setSaving(false)
  }

  function openModal() {
    setForm(emptyForm())
    setCompanyOpps([])
    setAcctSearch('')
    setShowAcctDrop(false)
    setShowModal(true)
    loadCustomers()
  }

  const isManager = user.role === 'admin'
  const q = search.trim().toLowerCase()
  const filtered = visits
    .filter(v => isManager || v.rep_id === user.id || (v.ssc_team_members || []).includes(user.id))
    .filter(v => !q || (v.company_freetext||'').toLowerCase().includes(q) || (v.purpose||'').toLowerCase().includes(q))
    .filter(v => !filterRep || v.rep_id === filterRep || (v.ssc_team_members || []).includes(filterRep))

  const toggleTeamMember = (repId) => {
    setForm(p => ({
      ...p,
      ssc_team_members: p.ssc_team_members.includes(repId)
        ? p.ssc_team_members.filter(id => id !== repId)
        : [...p.ssc_team_members, repId]
    }))
  }

  const INP = { width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'9px 12px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box', background:'white' }
  const LBL = { fontSize:11, fontWeight:600, color:'#64748b', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px', display:'block' }

  return (
    <Layout pageTitle="CRM — Field Visits" pageKey="crm">
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Field Visits</div>
              <div className="crm-page-sub">{filtered.length} visits</div>
            </div>
            <div className="crm-header-actions">
              <button className="new-order-btn" onClick={openModal}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Log Visit
              </button>
            </div>
          </div>

          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search company, purpose..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            {isManager && (
              <select className="crm-filter-select" value={filterRep} onChange={e => setFilterRep(e.target.value)}>
                <option value="">All Reps</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/>Loading...</div>
          ) : (
            <div className="crm-card">
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Opportunity</th>
                      <th>Type</th>
                      <th>Purpose</th>
                      <th>Outcome</th>
                      <th>Next Action</th>
                      <th>Rep</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 && (
                      <tr><td colSpan={8} style={{textAlign:'center',padding:'32px',color:'var(--gray-400)',fontSize:13}}>No visits found</td></tr>
                    )}
                    {filtered.map(v => {
                      const oppName = v.crm_opportunities?.opportunity_name || v.crm_opportunities?.product_notes
                      return (
                        <tr key={v.id} style={{cursor:'pointer'}}
                          onClick={() => v.opportunity_id ? navigate('/crm/opportunities/' + v.opportunity_id) : setViewVisit(v)}>
                          <td style={{whiteSpace:'nowrap',fontWeight:600}}>{fmtNum(v.visit_date)}</td>
                          <td><div className="crm-table-name">{v.company_freetext || '—'}</div></td>
                          <td>
                            {oppName
                              ? <div style={{fontSize:12,color:'#1a4dab',fontWeight:600,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{oppName}</div>
                              : <span style={{fontSize:11,color:'var(--gray-400)'}}>—</span>}
                          </td>
                          <td style={{whiteSpace:'nowrap'}}>
                            <span style={{fontSize:10,fontWeight:700,borderRadius:4,padding:'2px 7px',whiteSpace:'nowrap',
                              background: v.visit_type==='SOLO'?'#f1f5f9':v.visit_type==='JOINT_PRINCIPAL'?'#e8f2fc':'#f5f3ff',
                              color: v.visit_type==='SOLO'?'#475569':v.visit_type==='JOINT_PRINCIPAL'?'#1a4dab':'#6d28d9'
                            }}>{VISIT_TYPE_LABELS[v.visit_type]}</span>
                            {v.visit_type==='JOINT_PRINCIPAL' && v.crm_principals?.name && <div className="crm-table-sub">{v.crm_principals.name}{v.principal_rep_name?' · '+v.principal_rep_name:''}</div>}
                          </td>
                          <td style={{maxWidth:180}}>{v.purpose || '—'}</td>
                          <td style={{maxWidth:180}}>{v.outcome || '—'}</td>
                          <td>{v.next_action ? <div><div style={{fontSize:12}}>{v.next_action}</div>{v.next_action_date && <div style={{fontSize:11,color:'var(--gray-400)'}}>{fmtNum(v.next_action_date)}</div>}</div> : '—'}</td>
                          <td style={{whiteSpace:'nowrap'}}><OwnerChip name={v.profiles?.name} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="crm-card-list">
                {filtered.map(v => {
                  const oppName = v.crm_opportunities?.opportunity_name || v.crm_opportunities?.product_notes
                  return (
                    <div key={v.id} className="crm-list-card"
                      style={{cursor:'pointer'}}
                      onClick={() => v.opportunity_id ? navigate('/crm/opportunities/' + v.opportunity_id) : setViewVisit(v)}>
                      <div className="crm-list-card-top">
                        <div>
                          <div className="crm-list-card-name">{v.company_freetext || '—'}</div>
                          <div className="crm-list-card-sub">{VISIT_TYPE_LABELS[v.visit_type]}{v.crm_principals?.name?' · '+v.crm_principals.name:''}</div>
                          {oppName && <div style={{fontSize:11,color:'#1a4dab',marginTop:2}}>{oppName}</div>}
                        </div>
                        <span style={{fontSize:11,color:'var(--gray-500)',whiteSpace:'nowrap'}}>{fmtNum(v.visit_date)}</span>
                      </div>
                      {v.purpose && <div style={{fontSize:12,color:'var(--gray-600)',margin:'4px 0'}}>{v.purpose}</div>}
                      {v.outcome && <div style={{fontSize:12,color:'var(--gray-600)'}}>{v.outcome}</div>}
                      {v.next_action && <div style={{fontSize:12,color:'#1A3A8F',marginTop:4}}>Next: {v.next_action}{v.next_action_date?' · '+fmtNum(v.next_action_date):''}</div>}
                      <div style={{marginTop:6}}><OwnerChip name={v.profiles?.name} /></div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Visit Detail Popup ── */}
      {viewVisit && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target === e.currentTarget) setViewVisit(null) }}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'white', zIndex:1 }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>{viewVisit.company_freetext || '—'}</div>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:4, flexWrap:'wrap' }}>
                  <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#475569' }}>
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:13,height:13}}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    {fmtNum(viewVisit.visit_date)}
                  </span>
                  {viewVisit.created_at && (
                    <span style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#475569' }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{width:13,height:13}}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
                      {(() => { const d=new Date(viewVisit.created_at); return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}` })()}
                    </span>
                  )}
                  <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:4,
                    background: viewVisit.visit_type==='SOLO'?'#f1f5f9':viewVisit.visit_type==='JOINT_PRINCIPAL'?'#e8f2fc':'#f5f3ff',
                    color: viewVisit.visit_type==='SOLO'?'#475569':viewVisit.visit_type==='JOINT_PRINCIPAL'?'#1a4dab':'#6d28d9'
                  }}>{VISIT_TYPE_LABELS[viewVisit.visit_type]}</span>
                </div>
              </div>
              <button onClick={() => setViewVisit(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8', lineHeight:1, padding:4 }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14 }}>
              {(viewVisit.visit_type === 'JOINT_PRINCIPAL' || viewVisit.visit_type === 'JOINT_SSC_TEAM') && (() => {
                const withPrincipal = viewVisit.visit_type === 'JOINT_PRINCIPAL'
                const teamNames = (viewVisit.ssc_team_members || []).map(id => reps.find(r => r.id === id)?.name).filter(Boolean)
                return (
                  <div><div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', color:'#94a3b8', marginBottom:6 }}>Visited With</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
                    {withPrincipal && viewVisit.crm_principals?.name && (
                      <OwnerChip name={viewVisit.crm_principals.name + (viewVisit.principal_rep_name ? ' · ' + viewVisit.principal_rep_name : '')} />
                    )}
                    {teamNames.map(name => (
                      <OwnerChip key={name} name={name} />
                    ))}
                  </div></div>
                )
              })()}
              {viewVisit.purpose && (
                <div><div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', color:'#94a3b8', marginBottom:3 }}>Purpose</div>
                <div style={{ fontSize:13 }}>{viewVisit.purpose}</div></div>
              )}
              {viewVisit.outcome && (
                <div><div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', color:'#94a3b8', marginBottom:3 }}>Outcome</div>
                <div style={{ fontSize:13 }}>{viewVisit.outcome}</div></div>
              )}
              {viewVisit.next_action && (
                <div><div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', color:'#94a3b8', marginBottom:3 }}>Next Action</div>
                <div style={{ fontSize:13 }}>{viewVisit.next_action}</div>
                {viewVisit.next_action_date && <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{fmtNum(viewVisit.next_action_date)}</div>}</div>
              )}
              <div style={{ display:'flex', gap:24, paddingTop:4, borderTop:'1px solid #f1f5f9' }}>
                <div><div style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', color:'#94a3b8', marginBottom:6 }}>Rep</div>
                <OwnerChip name={viewVisit.profiles?.name} /></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Log Visit Modal ── */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:540, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between', position:'sticky', top:0, background:'white', zIndex:1 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:'#f0fdf4', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <svg fill="none" stroke="#059669" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{width:18,height:18}}>
                    <path d="M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Log Field Visit</div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>Record a customer visit</div>
                </div>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8', lineHeight:1, padding:4 }}>✕</button>
            </div>

            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:14 }}>

              {/* Account — local filter dropdown (same pattern as New Lead form) */}
              <div>
                <label style={LBL}>Account / Company <span style={{color:'#dc2626'}}>*</span></label>
                <div style={{position:'relative'}}>
                  <input
                    value={acctSearch}
                    onChange={e => {
                      setAcctSearch(e.target.value)
                      setShowAcctDrop(true)
                      if (!e.target.value) { setForm(p => ({...p,selected_customer_id:'',company_freetext:'',opportunity_id:''})); setCompanyOpps([]) }
                    }}
                    onFocus={() => setShowAcctDrop(true)}
                    onBlur={() => setTimeout(() => setShowAcctDrop(false), 150)}
                    placeholder="Type to search accounts…"
                    style={{ ...INP, background: form.selected_customer_id ? '#f0fdf4' : 'white', borderColor: form.selected_customer_id ? '#059669' : '#e2e8f0' }}
                  />
                  {form.selected_customer_id && (
                    <button type="button" onClick={() => { setForm(p => ({...p,selected_customer_id:'',company_freetext:'',opportunity_id:''})); setAcctSearch(''); setCompanyOpps([]) }}
                      style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:14,lineHeight:1,padding:2}}>✕</button>
                  )}
                  {showAcctDrop && acctSearch.trim() && !form.selected_customer_id && (() => {
                    const matches = customers.filter(c => c.customer_name.toLowerCase().includes(acctSearch.trim().toLowerCase())).slice(0,10)
                    return matches.length > 0 ? (
                      <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:200,marginTop:2,overflow:'hidden'}}>
                        {matches.map(c => (
                          <div key={c.id} onMouseDown={() => onSelectCustomer(c)}
                            style={{padding:'10px 14px',fontSize:13,cursor:'pointer',borderBottom:'1px solid #f8fafc'}}
                            onMouseEnter={e => e.currentTarget.style.background='#f0f9ff'}
                            onMouseLeave={e => e.currentTarget.style.background='white'}>
                            <div style={{fontWeight:600}}>{c.customer_name}</div>
                            {c.customer_type && <div style={{fontSize:11,color:'#94a3b8'}}>{c.customer_type}</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:200,marginTop:2,padding:'10px 14px',fontSize:12,color:'#94a3b8'}}>No results</div>
                    )
                  })()}
                </div>
              </div>

              {/* Opportunity link — after customer selected */}
              {form.selected_customer_id && (
                <div>
                  <label style={LBL}>Linked Opportunity <span style={{fontSize:10,fontWeight:400,textTransform:'none',letterSpacing:0,color:'#94a3b8'}}>— optional</span></label>
                  {loadingOpps ? (
                    <div style={{fontSize:12,color:'#94a3b8',padding:'8px 0'}}>Loading…</div>
                  ) : companyOpps.length === 0 ? (
                    <div style={{fontSize:12,color:'#94a3b8',padding:'4px 0'}}>No open opportunities for this account — visit will be logged without one.</div>
                  ) : (
                    <select value={form.opportunity_id} onChange={e => setForm(p => ({...p, opportunity_id: e.target.value}))} style={INP}>
                      <option value="">— No specific opportunity —</option>
                      {companyOpps.map(o => (
                        <option key={o.id} value={o.id}>
                          {o.opportunity_name || o.product_notes || 'Untitled'} · {STAGE_LABELS[o.stage] || o.stage}
                          {o.estimated_value_inr ? ' · ₹' + Number(o.estimated_value_inr).toLocaleString('en-IN',{maximumFractionDigits:0}) : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Date */}
              <div>
                <label style={LBL}>Visit Date <span style={{color:'#dc2626'}}>*</span></label>
                <input type="date" value={form.visit_date} onChange={e => setForm(p=>({...p,visit_date:e.target.value}))} style={INP} />
              </div>

              {/* Visit Type checkboxes */}
              <div>
                <label style={LBL}>Visit Type</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:2 }}>
                  {[
                    { key:'with_ssc', label:'With SSC' },
                    { key:'with_principal', label:'With Principal' },
                  ].map(opt => (
                    <button key={opt.key} type="button"
                      onClick={() => setForm(p => ({
                        ...p, [opt.key]: !p[opt.key],
                        ...(opt.key === 'with_ssc' && p.with_ssc ? { ssc_team_members:[] } : {}),
                        ...(opt.key === 'with_principal' && p.with_principal ? { principal_id:'', principal_rep_name:'' } : {}),
                      }))}
                      style={{ fontSize:12, fontWeight:600, padding:'5px 14px', borderRadius:6, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                        background: form[opt.key] ? '#e8f2fc' : 'white',
                        color: form[opt.key] ? '#1a4dab' : '#475569',
                        borderColor: form[opt.key] ? '#c2d9f5' : '#e2e8f0',
                      }}>
                      {form[opt.key] ? '✓ ' : ''}{opt.label}
                    </button>
                  ))}
                  {!form.with_ssc && !form.with_principal && (
                    <span style={{ fontSize:12, color:'#94a3b8', alignSelf:'center', marginLeft:4 }}>Alone</span>
                  )}
                </div>
              </div>

              {form.with_principal && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  <div>
                    <label style={LBL}>Principal <span style={{color:'#dc2626'}}>*</span></label>
                    <select value={form.principal_id} onChange={e => setForm(p=>({...p,principal_id:e.target.value}))} style={INP}>
                      <option value="">— Select —</option>
                      {principals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={LBL}>Principal Rep Name</label>
                    <input value={form.principal_rep_name} onChange={e => setForm(p=>({...p,principal_rep_name:e.target.value}))} placeholder="Rep's name" style={INP} />
                  </div>
                </div>
              )}

              {form.with_ssc && (
                <div>
                  <label style={LBL}>SSC Team Members</label>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:2}}>
                    {reps.filter(r => r.id !== user.id).map(r => {
                      const sel = form.ssc_team_members.includes(r.id)
                      return (
                        <button key={r.id} type="button" onClick={() => toggleTeamMember(r.id)}
                          style={{ fontSize:12, fontWeight:600, padding:'5px 12px', borderRadius:20, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                            background: sel ? '#1e3a5f' : 'white', color: sel ? 'white' : '#475569', borderColor: sel ? '#1e3a5f' : '#e2e8f0' }}>
                          {r.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div>
                <label style={LBL}>Purpose / Agenda</label>
                <textarea rows={2} value={form.purpose} onChange={e => setForm(p=>({...p,purpose:e.target.value}))}
                  placeholder="What was the visit about?" style={{ ...INP, resize:'vertical', lineHeight:1.6 }} />
              </div>
              <div>
                <label style={LBL}>Outcome</label>
                <textarea rows={2} value={form.outcome} onChange={e => setForm(p=>({...p,outcome:e.target.value}))}
                  placeholder="What was discussed / decided?" style={{ ...INP, resize:'vertical', lineHeight:1.6 }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={LBL}>Next Action</label>
                  <input value={form.next_action} onChange={e => setForm(p=>({...p,next_action:e.target.value}))} placeholder="Follow-up" style={INP} />
                </div>
                <div>
                  <label style={LBL}>Next Action Date</label>
                  <input type="date" value={form.next_action_date} onChange={e => setForm(p=>({...p,next_action_date:e.target.value}))} style={INP} />
                </div>
              </div>

            </div>

            <div style={{ padding:'0 20px 20px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowModal(false)}
                style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                Cancel
              </button>
              <button onClick={saveVisit} disabled={saving || (!form.company_freetext.trim() && !acctSearch.trim())}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#059669', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity: (!form.company_freetext.trim() && !acctSearch.trim()) ? 0.4 : 1 }}>
                {saving ? 'Saving…' : 'Save Visit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
