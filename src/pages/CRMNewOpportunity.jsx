import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'

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

const OVL  = { position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center',padding:16 }
const INP  = { border:'1px solid #e2e8f0',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font)',width:'100%',outline:'none',boxSizing:'border-box' }
const SEL  = { border:'1px solid #e2e8f0',borderRadius:8,padding:'9px 12px',fontSize:13,fontFamily:'var(--font)',width:'100%',outline:'none',boxSizing:'border-box',background:'white' }
const LBL  = { fontSize:12,fontWeight:600,color:'#374151',display:'block',marginBottom:5 }
const ROW  = { display:'grid',gridTemplateColumns:'1fr 1fr',gap:14 }

export default function NewLeadModal({ onClose, onCreated, prefillCompanyId, currentUser }) {
  const [companies, setCompanies]   = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]             = useState([])
  const [saving, setSaving]         = useState(false)
  const [isExisting, setIsExisting] = useState(false) // true when existing customer selected
  const [selectedBrands, setSelectedBrands] = useState([])
  const [accountSearch, setAccountSearch]   = useState('')
  const [showAccountDrop, setShowAccountDrop] = useState(false)

  const [form, setForm] = useState({
    opportunity_name: '',
    company_id: prefillCompanyId || '',
    account_type: '',
    assigned_rep_id: '',
    assigned_rep_name: '',
    stage: 'LEAD_CAPTURED',
    probability: 10,
    close_date: '',
    opportunity_type: '',
    lead_source: '',
    lead_source_detail: '',
    description: '',
    gstin: '',
  })

  useEffect(() => { load() }, [])

  async function load() {
    let allCustomers = []
    let from = 0
    while (true) {
      const { data } = await sb.from('customers').select('id,customer_id,customer_name,account_owner,customer_type,gst').order('customer_name').range(from, from + 999)
      if (!data || data.length === 0) break
      allCustomers = [...allCustomers, ...data]
      if (data.length < 1000) break
      from += 1000
    }
    const [principalsRes, repsRes] = await Promise.all([
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','admin']).order('name'),
    ])
    setCompanies(allCustomers)
    setPrincipals(principalsRes.data || [])
    setReps(repsRes.data || [])
    if (prefillCompanyId) selectCustomer(prefillCompanyId, allCustomers, repsRes.data || [])
  }

  function selectCustomer(customerId, customerList, repList) {
    const custs = customerList || companies
    const repsAll = repList || reps
    if (!customerId) {
      setForm(p => ({ ...p, company_id: '', account_type: '', assigned_rep_id: '', assigned_rep_name: '', gstin: '' }))
      setIsExisting(false)
      return
    }
    const cust = custs.find(c => c.id === customerId)
    if (!cust) return
    const matchedRep = repsAll.find(r => r.name === cust.account_owner)
    setForm(p => ({
      ...p,
      company_id: customerId,
      account_type: cust.customer_type || '',
      assigned_rep_id: matchedRep?.id || '',
      assigned_rep_name: cust.account_owner || '',
      gstin: cust.gst || p.gstin,
      // Switch to first opportunity stage when existing customer selected
      stage: 'BOM_RECEIVED',
      probability: STAGE_PROBABILITY['BOM_RECEIVED'],
    }))
    setIsExisting(true)
  }

  function setStage(s) {
    setForm(p => ({ ...p, stage: s, probability: STAGE_PROBABILITY[s] ?? p.probability }))
  }

  function toggleBrand(id) {
    setSelectedBrands(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!form.opportunity_name.trim()) { toast(isExisting ? 'Opportunity Name is required' : 'Lead Name is required'); return }
    if (!form.company_id && !accountSearch.trim()) { toast('Account Name is required'); return }
    if (!form.gstin.trim()) { toast('GST number is required'); return }
    setSaving(true)
    const brandNames = principals.filter(p => selectedBrands.includes(p.id)).map(p => p.name)
    const { data, error } = await sb.from('crm_opportunities').insert({
      opportunity_name:   form.opportunity_name.trim(),
      customer_id:        form.company_id || null,
      freetext_company:   !form.company_id ? accountSearch.trim() : null,
      account_type:       form.account_type || null,
      assigned_rep_id:    form.assigned_rep_id || currentUser?.id || null,
      stage:              form.stage,
      probability:        form.probability ? parseInt(form.probability) : null,
      close_date:         form.close_date || null,
      expected_close_date: form.close_date || null,
      opportunity_type:   form.opportunity_type || null,
      lead_source:        form.lead_source || null,
      lead_source_detail: form.lead_source_detail.trim() || null,
      description:        form.description.trim() || null,
      gstin:              form.gstin.trim() || null,
      brands:             brandNames,
      principal_id:       selectedBrands[0] || null,
      product_notes:      form.opportunity_name.trim(),
    }).select().single()
    if (error) { toast('Error: ' + error.message); setSaving(false); return }
    // Log creation activity with the actual creator's ID (not the assigned rep)
    await sb.from('crm_activities').insert({
      opportunity_id: data.id,
      rep_id: currentUser?.id || null,
      activity_type: 'Created',
      notes: 'Opportunity created',
    })
    toast('Opportunity created', 'success')
    onCreated(data.id)
  }

  const needsDetail = form.lead_source === 'Partner Referral' || form.lead_source === 'Customer Referral'
  const detailLabel = form.lead_source === 'Partner Referral' ? 'Partner Name' : 'Customer Name'
  const accountMatches = showAccountDrop
    ? companies.filter(c => !accountSearch.trim() || (c.customer_name || '').toLowerCase().includes(accountSearch.trim().toLowerCase())).slice(0, 10)
    : []

  const cardWidth = 680

  return (
    <div style={OVL} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:cardWidth, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column', transition:'max-width 0.2s' }}>

        {/* Header */}
        <div style={{padding:'20px 24px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <div style={{fontSize:18,fontWeight:700,color:'#0f172a'}}>{isExisting ? 'New Opportunity' : 'New Lead'}</div>
              {isExisting && (
                <span style={{fontSize:10,fontWeight:700,background:'#eff6ff',color:'#1d4ed8',borderRadius:4,padding:'2px 7px'}}>EXISTING CUSTOMER</span>
              )}
            </div>
            <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>
              {isExisting ? 'Full opportunity form — existing customer selected' : 'Capture a new lead — full details can be added once qualified'}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#94a3b8',lineHeight:1,padding:4}}>✕</button>
        </div>

        {/* Body */}
        <div style={{padding:24,display:'flex',flexDirection:'column',gap:16,overflowY:'auto'}}>

          {/* Name */}
          <div>
            <label style={LBL}>{isExisting ? 'Opportunity Name' : 'Lead Name'} <span style={{color:'#dc2626'}}>*</span></label>
            <input style={INP} value={form.opportunity_name} onChange={e => setForm(p=>({...p,opportunity_name:e.target.value}))}
              placeholder={isExisting ? 'e.g. Mitsubishi PLC – SSC Automation Pvt. Ltd.' : 'e.g. Mitsubishi PLC – SSC Automation Pvt. Ltd.'} />
          </div>

          {/* Account + Type */}
          <div style={ROW}>
            <div style={{position:'relative'}}>
              <label style={LBL}>Account Name <span style={{color:'#dc2626'}}>*</span></label>
              <input style={{...INP, background: form.company_id ? '#f8fafc' : 'white'}}
                value={accountSearch}
                onChange={e => {
                  setAccountSearch(e.target.value)
                  setShowAccountDrop(true)
                  if (!e.target.value) selectCustomer('')
                }}
                onFocus={() => setShowAccountDrop(true)}
                onBlur={() => setTimeout(() => setShowAccountDrop(false), 150)}
                placeholder="Type to search accounts…"
              />
              {form.company_id && (
                <button onClick={() => { selectCustomer(''); setAccountSearch('') }}
                  style={{position:'absolute',right:8,top:30,background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:14}}>✕</button>
              )}
              {showAccountDrop && !form.company_id && accountMatches.length > 0 && (
                <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:200,marginTop:2,overflow:'hidden'}}>
                  {accountMatches.map(c => (
                    <div key={c.id}
                      onMouseDown={() => { selectCustomer(c.id); setAccountSearch(c.customer_name); setShowAccountDrop(false) }}
                      style={{padding:'10px 14px',fontSize:13,cursor:'pointer',borderBottom:'1px solid #f8fafc'}}
                      onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
                      onMouseLeave={e => e.currentTarget.style.background='white'}>
                      <div style={{fontWeight:600}}>{c.customer_name}{c.customer_id && <span style={{fontSize:10,fontWeight:600,color:'#6b7280',fontFamily:'var(--mono)',marginLeft:6}}>{c.customer_id}</span>}</div>
                      {c.gst && <div style={{fontSize:11,color:'#94a3b8'}}>{c.gst}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={LBL}>Account Type</label>
              <select style={SEL} value={form.account_type} onChange={e => setForm(p=>({...p,account_type:e.target.value}))}>
                <option value="">— Select —</option>
                {['OEM','Panel Builder','End User','Trader'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Account Owner */}
          <div>
            <label style={LBL}>Account Owner <span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>(auto-filled from account)</span></label>
            <div style={{padding:'9px 12px',border:'1px solid #f1f5f9',borderRadius:8,background:'#f8fafc',fontSize:13,color:form.assigned_rep_name?'#0f172a':'#94a3b8'}}>
              {form.assigned_rep_name || 'Select an account first'}
            </div>
          </div>

          {/* GST Number — mandatory */}
          <div>
            <label style={LBL}>
              GST Number <span style={{color:'#dc2626'}}>*</span>
              {form.company_id && form.gstin && (
                <span style={{marginLeft:6,fontSize:10,fontWeight:600,background:'#f0fdf4',color:'#15803d',borderRadius:4,padding:'1px 6px'}}>from Customer 360</span>
              )}
            </label>
            <input style={{...INP, background: form.company_id && form.gstin ? '#f8fafc' : 'white', fontFamily:'var(--mono)', letterSpacing:'0.5px'}}
              value={form.gstin} onChange={e => setForm(p=>({...p,gstin:e.target.value}))}
              placeholder="e.g. 24AABCS1429B1ZB" />
          </div>

          {/* Lead Source (always visible) */}
          <div style={ROW}>
            <div>
              <label style={LBL}>Lead Source</label>
              <select style={SEL} value={form.lead_source} onChange={e => setForm(p=>({...p,lead_source:e.target.value,lead_source_detail:''}))}>
                <option value="">— Select —</option>
                {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {needsDetail && (
              <div>
                <label style={LBL}>{detailLabel}</label>
                <input style={INP} value={form.lead_source_detail} onChange={e => setForm(p=>({...p,lead_source_detail:e.target.value}))}
                  placeholder={`Enter ${detailLabel.toLowerCase()}…`} />
              </div>
            )}
          </div>

          {/* ── OPPORTUNITY FIELDS — always visible ── */}
          <>
            {/* Divider */}
            <div style={{display:'flex',alignItems:'center',gap:10,margin:'4px 0'}}>
              <div style={{flex:1,height:1,background:'#f1f5f9'}}/>
              <span style={{fontSize:11,fontWeight:700,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.5px'}}>Opportunity Details</span>
              <div style={{flex:1,height:1,background:'#f1f5f9'}}/>
            </div>

            {/* Stage + Probability */}
            <div style={ROW}>
              <div>
                <label style={LBL}>Stage</label>
                <select style={SEL} value={form.stage} onChange={e => setStage(e.target.value)}>
                  {ALL_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label style={LBL}>Probability (%)</label>
                <input style={INP} type="number" min="0" max="100" value={form.probability}
                  onChange={e => setForm(p=>({...p,probability:e.target.value}))} placeholder="0–100" />
              </div>
            </div>

            {/* Close Date + Opp Type */}
            <div style={ROW}>
              <div>
                <label style={LBL}>Close Date</label>
                <input style={INP} type="date" value={form.close_date} onChange={e => setForm(p=>({...p,close_date:e.target.value}))} />
              </div>
              <div>
                <label style={LBL}>Opportunity Type</label>
                <select style={SEL} value={form.opportunity_type} onChange={e => setForm(p=>({...p,opportunity_type:e.target.value}))}>
                  <option value="">— Select —</option>
                  <option value="NEW_BUSINESS">New Business</option>
                  <option value="EXISTING_BUSINESS">Existing Business</option>
                </select>
              </div>
            </div>

            {/* Brands */}
            <div>
              <label style={LBL}>Brands</label>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {principals.map(p => {
                  const sel = selectedBrands.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => toggleBrand(p.id)} type="button"
                      style={{padding:'5px 12px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px solid',
                        background: sel ? '#1e3a5f' : 'white', color: sel ? 'white' : '#475569',
                        borderColor: sel ? '#1e3a5f' : '#e2e8f0',
                      }}>
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Description */}
            <div>
              <label style={LBL}>Description</label>
              <textarea style={{...INP,resize:'vertical',minHeight:72}} rows={3} value={form.description}
                onChange={e => setForm(p=>({...p,description:e.target.value}))}
                placeholder="Any additional context, requirements, or notes…" />
            </div>
          </>

        </div>

        {/* Footer */}
        <div style={{padding:'16px 24px',borderTop:'1px solid #f1f5f9',display:'flex',gap:10,justifyContent:'flex-end',flexShrink:0}}>
          <button onClick={onClose}
            style={{padding:'10px 20px',border:'1px solid #e2e8f0',borderRadius:8,background:'white',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving || !form.opportunity_name.trim() || (!form.company_id && !accountSearch.trim())}
            style={{padding:'10px 20px',border:'none',borderRadius:8,background: isExisting ? '#1a4dab' : '#1e3a5f',color:'white',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)',
              opacity:(!form.opportunity_name.trim()||(!form.company_id&&!accountSearch.trim()))?0.4:1}}>
            {saving ? 'Creating…' : isExisting ? 'Create Opportunity' : 'Create Lead'}
          </button>
        </div>

      </div>
    </div>
  )
}
