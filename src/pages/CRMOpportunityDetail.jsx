import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import CRMSubNav from '../components/CRMSubNav'
import NewCustomerModal from './NewCustomerModal'
import Typeahead from '../components/Typeahead'
import '../styles/crm.css'
import '../styles/orderdetail.css'
import '../styles/neworder.css'

const STAGE_ORDER  = ['LEAD_CAPTURED','CONTACTED','QUALIFIED','BOM_RECEIVED','QUOTATION_SENT','FOLLOW_UP','FINAL_NEGOTIATION']
const TERMINAL     = ['WON','LOST','ON_HOLD']
const STAGE_LABELS = {
  LEAD_CAPTURED:'Lead Captured', CONTACTED:'Contacted', QUALIFIED:'Qualified',
  BOM_RECEIVED:'BOM Received', QUOTATION_SENT:'Quote Sent', FOLLOW_UP:'Follow Up',
  FINAL_NEGOTIATION:'Final Negotiation', WON:'Won', LOST:'Lost', ON_HOLD:'On Hold',
}
const SCENARIOS   = ['NEW_CUST_NEW_PROD','OLD_CUST_NEW_PROD','NEW_CUST_OLD_PROD','DORMANT_REVIVAL']
const TASK_TYPES  = [
  { key:'Call',       label:'Call',       clr:'#2563eb', icon:'Call' },
  { key:'Visit',      label:'Visit',      clr:'#059669', icon:'Visit' },
  { key:'Send Email', label:'Send Email', clr:'#7c3aed', icon:'SendEmail' },
  { key:'Give Quote', label:'Give Quote', clr:'#d97706', icon:'Quote' },
  { key:'Follow Up',  label:'Follow Up',  clr:'#c2410c', icon:'FollowUp' },
]

function CrmIcon({ name, size = 18, color = 'currentColor' }) {
  const s = { width:size, height:size, flexShrink:0, display:'block' }
  const p = { fill:'none', stroke:color, strokeWidth:'1.6', strokeLinecap:'round', strokeLinejoin:'round', viewBox:'0 0 24 24', style:s }
  if (name === 'Call')      return <svg {...p}><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.32.57 3.58.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.29 21 3 13.71 3 4.5c0-.55.45-1 1-1H7.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.24 1.01L6.6 10.8z"/></svg>
  if (name === 'Visit')     return <svg {...p}><path d="M12 21s-7-6.5-7-11a7 7 0 0114 0c0 4.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
  if (name === 'Email')     return <svg {...p}><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>
  if (name === 'Note')      return <svg {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 9.5-9.5z"/></svg>
  if (name === 'Quote')     return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
  if (name === 'FollowUp')  return <svg {...p}><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
  if (name === 'SendEmail') return <svg {...p}><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
  // fallback
  return <svg {...p}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
}
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
function renderNoteText(text) {
  if (!text) return null
  return text.split(/(@[\w.]+)/g).map((part, i) =>
    part.startsWith('@')
      ? <span key={i} style={{ background:'#e0e7ff', color:'#3730a3', borderRadius:4, padding:'1px 5px', fontSize:11, fontWeight:700 }}>@{part.slice(1).replace(/_/g,' ')}</span>
      : part
  )
}

const ACT_COLORS = { Call:'#2563eb', Visit:'#0284c7', Email:'#7c3aed', Note:'#94a3b8', 'Stage Change':'#d97706', Quotation:'#16a34a', Won:'#15803d', Lost:'#dc2626' }
function actDotStyle(type, notes) {
  if (notes?.startsWith('Sample:')) return { background:'#c2410c' }
  return { background: ACT_COLORS[type] || '#94a3b8' }
}
function actLabel(a) {
  if (a.notes?.startsWith('Sample:')) return 'Sample Submission'
  return { Call:'Call', Visit:'Visit', Email:'Email', Note:'Note', Quotation:'Submit Quote', 'Stage Change':'Stage Change', Won:'Won', Lost:'Lost' }[a.activity_type] || a.activity_type
}

function StagePill({ stage }) {
  const styles = {
    WON:            { background:'#f0fdf4', color:'#15803d' },
    LOST:           { background:'#fef2f2', color:'#dc2626' },
    ON_HOLD:        { background:'#fffbeb', color:'#b45309' },
    BOM_RECEIVED:       { background:'#f5f3ff', color:'#7c3aed' },
    QUOTATION_SENT:     { background:'#e8f2fc', color:'#1a4dab' },
    FOLLOW_UP:          { background:'#fff7ed', color:'#c2410c' },
    FINAL_NEGOTIATION:  { background:'#fef9c3', color:'#854d0e' },
  }
  const s = styles[stage] || { background:'#f1f5f9', color:'#475569' }
  return <span style={{ ...s, fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 8px', whiteSpace:'nowrap' }}>{STAGE_LABELS[stage] || stage}</span>
}

function emptyQuoteItem() {
  return { _id: Date.now() + Math.random(), item_code:'', description:'', qty:'1', unit_price:'', discount_pct:'0', total_price:'' }
}
function unitAfterDisc(row) {
  return (parseFloat(row.unit_price)||0) * (1 - (parseFloat(row.discount_pct)||0) / 100)
}

const INP = { border:'1px solid var(--gray-200)', borderRadius:6, padding:'4px 8px', fontSize:12, fontFamily:'var(--font)', width:'100%', outline:'none', boxSizing:'border-box' }
const FS  = { padding:'8px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', background:'white', outline:'none', width:'100%', boxSizing:'border-box' }

export default function CRMOpportunityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [user, setUser]             = useState({ name:'', role:'', id:'' })
  const [opp, setOpp]               = useState(null)
  const [activities, setActivities] = useState([])
  const [tasks, setTasks]           = useState([])
  const [quoteItems, setQuoteItems] = useState([])
  const [principals, setPrincipals] = useState([])
  const [reps, setReps]             = useState([])
  const [contacts, setContacts]     = useState([])
  const [companies, setCompanies]   = useState([])
  const [loading, setLoading]       = useState(true)
  const [editMode, setEditMode]     = useState(false)
  const [editData, setEditData]     = useState({})
  const [editBrands, setEditBrands] = useState([])
  const [editAcctSearch, setEditAcctSearch]   = useState('')
  const [showEditAcctDrop, setShowEditAcctDrop] = useState(false)
  const [saving, setSaving]         = useState(false)

  const [showStageMenu, setShowStageMenu]   = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeStage, setCloseStage]         = useState('')
  const [pendingStage, setPendingStage]     = useState(null)
  const [stageReason, setStageReason]       = useState('')
  const [stageRevisit, setStageRevisit]     = useState('')
  const [changingStage, setChangingStage]   = useState(false)

  const [actType, setActType]             = useState('Call')
  const [actDiscussion, setActDiscussion] = useState('')
  const [actVisitType, setActVisitType]   = useState('Alone')
  const [actSSCMembers, setActSSCMembers] = useState([])
  const [actPartnerName, setActPartnerName] = useState('')
  const [actMetContact, setActMetContact] = useState('')
  const [actNotes, setActNotes]           = useState('')
  const [noteMentionQuery, setNoteMentionQuery] = useState(null)
  const noteInputRef = useRef(null)
  const [postingAct, setPostingAct]       = useState(false)
  const [showActModal, setShowActModal]   = useState(false)
  const [actDate, setActDate]             = useState('')
  const [actTime, setActTime]             = useState('')
  const [actTab, setActTab]               = useState('activity')
  const [expandedActs, setExpandedActs]   = useState(new Set())

  const [custContacts, setCustContacts]   = useState([])
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactForm, setContactForm]     = useState({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
  const [savingContact, setSavingContact] = useState(false)

  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertOrderType, setConvertOrderType] = useState('SO')
  const [showSampleModal, setShowSampleModal]   = useState(false)
  const [sampleCustomer, setSampleCustomer]     = useState(null)
  const [sampleItems, setSampleItems]           = useState([])
  const [sampleOrderDate, setSampleOrderDate]   = useState('')
  const [sampleReceivedVia, setSampleReceivedVia]   = useState('Visit')
  const [sampleNotes, setSampleNotes]               = useState('')
  const [samplePoNumber, setSamplePoNumber]         = useState('')
  const [sampleDispatchAddr, setSampleDispatchAddr] = useState('')
  const [sampleGst, setSampleGst]                   = useState('')
  const [sampleFreight, setSampleFreight]           = useState('0')
  const [submittingSample, setSubmittingSample]     = useState(false)

  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showTaskModal, setShowTaskModal]   = useState(false)
  const [taskAssignee, setTaskAssignee]     = useState('')
  const [taskType, setTaskType]             = useState('Call')
  const [taskDueDate, setTaskDueDate]   = useState('')
  const [taskNotes, setTaskNotes]       = useState('')
  const [addingTask, setAddingTask]     = useState(false)
  const [markingDone, setMarkingDone]   = useState(null)

  const [quoteRows, setQuoteRows]     = useState([emptyQuoteItem()])
  const [savingQuote, setSavingQuote] = useState(false)
  const [quoteLoaded, setQuoteLoaded] = useState(false)

  const [showC360Modal, setShowC360Modal] = useState(false)
  const [c360Prefill, setC360Prefill]     = useState({})

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }
    const [oppRes, actsRes, tasksRes, quoteRes, principalsRes, repsRes] = await Promise.all([
      sb.from('crm_opportunities').select('*, crm_companies(id,company_name), crm_principals(name), crm_contacts(name,phone), profiles(name), customers(id,customer_name,account_owner)').eq('id', id).single(),
      sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false }),
      sb.from('crm_tasks').select('*, profiles(name)').eq('opportunity_id', id).order('due_date', { ascending: true }),
      sb.from('crm_quote_items').select('*').eq('opportunity_id', id).order('created_at', { ascending: true }),
      sb.from('crm_principals').select('*').order('name'),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    const oppData = oppRes.data
    setOpp(oppData)
    setEditData(oppData || {})
    // seed editBrands from stored brands array (match principal names → ids)
    const pList = principalsRes.data || []
    const storedBrands = oppData?.brands || []
    setEditBrands(pList.filter(p => storedBrands.includes(p.name)).map(p => p.id))
    // seed account search display
    if (oppData?.customers?.customer_name) setEditAcctSearch(oppData.customers.customer_name)
    setActivities(actsRes.data || [])
    setTasks(tasksRes.data || [])
    if (quoteRes.data?.length) {
      setQuoteRows(quoteRes.data.map(q => ({ ...q, _id: q.id })))
      setQuoteItems(quoteRes.data)
      setQuoteLoaded(true)
    }
    setPrincipals(pList)
    setReps(repsRes.data || [])
    if (oppData?.company_id) {
      const { data: ctcts } = await sb.from('crm_contacts').select('id,name,phone').eq('company_id', oppData.company_id).order('name')
      setContacts(ctcts || [])
    }
    // Load all customers (paginated) for edit mode account search
    let allCusts = []
    let from = 0
    while (true) {
      const { data: page } = await sb.from('customers').select('id,customer_name,account_owner,customer_type').order('customer_name').range(from, from + 999)
      if (!page || page.length === 0) break
      allCusts = [...allCusts, ...page]
      if (page.length < 1000) break
      from += 1000
    }
    setCompanies(allCusts)
    // Load contacts for linked customer
    if (oppData?.customer_id) {
      const { data: ccs } = await sb.from('customer_contacts').select('*').eq('customer_id', oppData.customer_id).order('created_at', { ascending: true })
      setCustContacts(ccs || [])
    }
    setLoading(false)
  }

  async function saveCustContact() {
    if (!contactForm.name.trim()) { alert('Name is required'); return }
    setSavingContact(true)
    const { data, error } = await sb.from('customer_contacts').insert({ ...contactForm, customer_id: opp.customer_id }).select().single()
    if (error) { alert('Error: ' + error.message); setSavingContact(false); return }
    setCustContacts(p => [...p, data])
    setContactForm({ name:'', designation:'', phone:'', whatsapp:'', email:'' })
    setShowContactModal(false)
    setSavingContact(false)
  }

  function calcSampleItem(item) {
    const lp   = parseFloat(item.lp_unit_price) || 0
    const disc = parseFloat(item.discount_pct)  || 0
    const qty  = parseFloat(item.qty)            || 0
    const unit = lp * (1 - disc / 100)
    return { ...item, unit_price_after_disc: unit ? unit.toFixed(2) : '', total_price: (unit && qty) ? (unit * qty).toFixed(2) : '' }
  }
  function updateSampleItem(idx, field, value) {
    setSampleItems(prev => {
      const next = [...prev]
      next[idx] = calcSampleItem({ ...next[idx], [field]: value })
      return next
    })
  }
  function emptySampleItem() {
    return { item_code:'', qty:'1', lp_unit_price:'', discount_pct:'0', unit_price_after_disc:'', total_price:'', dispatch_date: new Date().toISOString().slice(0,10), customer_ref_no:'' }
  }

  async function openSampleModal() {
    let cust = null
    if (opp.customer_id) {
      const { data } = await sb.from('customers').select('customer_name,gst,billing_address,credit_terms,account_owner').eq('id', opp.customer_id).single()
      cust = data
    }
    setSampleCustomer(cust)
    setSampleGst(cust?.gst || '')
    setSampleDispatchAddr(cust?.billing_address || '')
    // Pre-fill items from quote
    const today = new Date().toISOString().slice(0,10)
    const pre = quoteRows.filter(r => r.item_code?.trim()).map(r => calcSampleItem({
      item_code: r.item_code,
      qty: String(r.qty || 1),
      lp_unit_price: String(r.unit_price || r.lp_unit_price || ''),
      discount_pct: String(r.discount_pct || 0),
      unit_price_after_disc: '',
      total_price: '',
      dispatch_date: today,
      customer_ref_no: '',
    }))
    setSampleItems(pre.length ? pre : [emptySampleItem()])
    setSampleOrderDate(today)
    setSampleFreight('0')
    setSampleNotes('Ref: ' + (opp.opportunity_name || opp.product_notes || ''))
    setSamplePoNumber('')
    setSampleReceivedVia('Visit')
    setShowSampleModal(true)
  }

  async function openConvertModal() {
    let cust = null
    if (opp.customer_id) {
      const { data } = await sb.from('customers').select('customer_name,gst,billing_address,credit_terms,account_owner').eq('id', opp.customer_id).single()
      cust = data
    }
    setSampleCustomer(cust)
    setSampleGst(cust?.gst || '')
    setSampleDispatchAddr(cust?.billing_address || '')
    const today = new Date().toISOString().slice(0,10)
    const pre = quoteRows.filter(r => r.item_code?.trim()).map(r => calcSampleItem({
      item_code: r.item_code,
      qty: String(r.qty || 1),
      lp_unit_price: String(r.unit_price || r.lp_unit_price || ''),
      discount_pct: String(r.discount_pct || 0),
      unit_price_after_disc: '',
      total_price: '',
      dispatch_date: today,
      customer_ref_no: '',
    }))
    setSampleItems(pre.length ? pre : [emptySampleItem()])
    setSampleOrderDate(today)
    setSampleFreight('0')
    setSampleNotes('Converted from: ' + (opp.opportunity_name || opp.product_notes || ''))
    setSamplePoNumber('')
    setSampleReceivedVia('Visit')
    setConvertOrderType('SO')
    setShowConvertModal(true)
  }

  async function submitConvertOrder() {
    const validItems = sampleItems.filter(i => i.item_code?.trim())
    if (!sampleCustomer?.customer_name) { alert('No customer linked to this opportunity'); return }
    if (!sampleDispatchAddr.trim()) { alert('Dispatch address is required'); return }
    if (!samplePoNumber.trim()) { alert('PO / Reference Number is required'); return }
    if (!validItems.length) { alert('Add at least one item'); return }
    for (const item of validItems) {
      if (!item.qty) { alert('Qty required for: ' + item.item_code); return }
      if (!item.lp_unit_price) { alert('LP Price required for: ' + item.item_code); return }
      if (!item.dispatch_date) { alert('Dispatch date required for: ' + item.item_code); return }
    }
    setSubmittingSample(true)
    const { data: { session } } = await sb.auth.getSession()
    const { data: order, error } = await sb.from('orders').insert({
      customer_name:     sampleCustomer.customer_name,
      customer_gst:      sampleGst.trim() || '',
      dispatch_address:  sampleDispatchAddr.trim(),
      po_number:         samplePoNumber.trim(),
      order_date:        sampleOrderDate,
      order_type:        convertOrderType,
      engineer_name:     user.name,
      received_via:      sampleReceivedVia,
      freight:           parseFloat(sampleFreight) || 0,
      credit_terms:      sampleCustomer.credit_terms || '',
      account_owner:     sampleCustomer.account_owner || '',
      notes:             sampleNotes.trim(),
      submitted_by_name: user.name,
      created_by:        session.user.id,
      is_test:           false,
    }).select().single()
    if (error) { alert('Error: ' + error.message); setSubmittingSample(false); return }
    const { error: itemsErr } = await sb.from('order_items').insert(
      validItems.map((item, i) => ({
        order_id:              order.id,
        sr_no:                 i + 1,
        item_code:             item.item_code.trim(),
        qty:                   parseFloat(item.qty) || 1,
        lp_unit_price:         parseFloat(item.lp_unit_price) || 0,
        discount_pct:          parseFloat(item.discount_pct) || 0,
        unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
        total_price:           parseFloat(item.total_price) || 0,
        dispatch_date:         item.dispatch_date,
        customer_ref_no:       item.customer_ref_no?.trim() || null,
      }))
    )
    if (itemsErr) { alert('Order created but items failed: ' + itemsErr.message); setSubmittingSample(false); return }
    setShowConvertModal(false)
    setSubmittingSample(false)
    navigate('/orders/' + order.id)
  }

  async function submitSample() {
    const validItems = sampleItems.filter(i => i.item_code?.trim())
    if (!sampleCustomer?.customer_name) { alert('No customer linked to this opportunity'); return }
    if (!sampleDispatchAddr.trim()) { alert('Dispatch address is required'); return }
    if (!validItems.length) { alert('Add at least one item code'); return }
    for (const item of validItems) {
      if (!item.qty) { alert('Qty required for: ' + item.item_code); return }
      if (!item.dispatch_date) { alert('Dispatch date required for: ' + item.item_code); return }
    }
    setSubmittingSample(true)
    const { data: { session } } = await sb.auth.getSession()
    const { data: order, error } = await sb.from('orders').insert({
      customer_name:     sampleCustomer.customer_name,
      customer_gst:      sampleGst.trim() || '',
      dispatch_address:  sampleDispatchAddr.trim(),
      po_number:         samplePoNumber.trim() || '',
      order_date:        sampleOrderDate,
      order_type:        'SAMPLE',
      engineer_name:     user.name,
      received_via:      sampleReceivedVia,
      freight:           parseFloat(sampleFreight) || 0,
      credit_terms:      sampleCustomer.credit_terms || '',
      account_owner:     sampleCustomer.account_owner || '',
      notes:             sampleNotes.trim(),
      submitted_by_name: user.name,
      created_by:        session.user.id,
      is_test:           false,
    }).select().single()
    if (error) { alert('Error: ' + error.message); setSubmittingSample(false); return }
    const { error: itemsErr } = await sb.from('order_items').insert(
      validItems.map((item, i) => ({
        order_id:              order.id,
        sr_no:                 i + 1,
        item_code:             item.item_code.trim(),
        qty:                   parseFloat(item.qty) || 1,
        lp_unit_price:         parseFloat(item.lp_unit_price) || 0,
        discount_pct:          parseFloat(item.discount_pct) || 0,
        unit_price_after_disc: parseFloat(item.unit_price_after_disc) || 0,
        total_price:           parseFloat(item.total_price) || 0,
        dispatch_date:         item.dispatch_date,
        customer_ref_no:       item.customer_ref_no?.trim() || null,
      }))
    )
    if (itemsErr) { alert('Order created but items failed: ' + itemsErr.message); setSubmittingSample(false); return }
    setShowSampleModal(false)
    setSubmittingSample(false)
    navigate('/orders/' + order.id)
  }

  async function saveOpp() {
    setSaving(true)
    const brandNames = principals.filter(p => editBrands.includes(p.id)).map(p => p.name)
    const { error } = await sb.from('crm_opportunities').update({
      opportunity_name: editData.opportunity_name || null,
      customer_id: editData.customer_id || null,
      account_type: editData.account_type || null,
      product_notes: editData.product_notes || null,
      principal_id: editBrands[0] || editData.principal_id || null,
      brands: brandNames,
      opportunity_type: editData.opportunity_type || null,
      assigned_rep_id: editData.assigned_rep_id || null,
      contact_id: editData.contact_id || null,
      estimated_value_inr: editData.estimated_value_inr || null,
      close_date: editData.close_date || null,
      expected_close_date: editData.close_date || editData.expected_close_date || null,
      probability: editData.probability ? parseInt(editData.probability) : null,
      lead_source: editData.lead_source || null,
      lead_source_detail: editData.lead_source_detail || null,
      description: editData.description || null,
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
    const datePrefix = (actDate || actTime) ? '[' + (actDate || '') + (actDate && actTime ? ' ' : '') + (actTime || '') + '] ' : ''
    if (actType === 'Call') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      notes = datePrefix + actDiscussion.trim(); activityType = 'Call'
    } else if (actType === 'Visit') {
      if (!actDiscussion.trim()) { alert('Discussion notes required'); return }
      let visitMeta = actVisitType
      if (actVisitType === 'With SSC' && actSSCMembers.length > 0) {
        const names = reps.filter(r => actSSCMembers.includes(r.id)).map(r => r.name)
        visitMeta += ': ' + names.join(', ')
      } else if (actVisitType === 'With Principal' && actPartnerName.trim()) {
        visitMeta += ': ' + actPartnerName.trim()
      }
      const metLine = actMetContact ? ' | Met: ' + (custContacts.find(c => c.id === actMetContact)?.name || '') : ''
      notes = datePrefix + '[' + visitMeta + ']' + metLine + ' ' + actDiscussion.trim(); activityType = 'Visit'
    } else if (actType === 'Email') {
      if (!actNotes.trim()) { alert('Notes required'); return }
      notes = datePrefix + actNotes.trim(); activityType = 'Email'
    } else if (actType === 'Note') {
      if (!actNotes.trim()) { alert('Write a note first'); return }
      notes = actNotes.trim(); activityType = 'Note'
    } else {
      if (!actNotes.trim()) { alert('Notes required'); return }
      notes = datePrefix + actNotes.trim(); activityType = 'Note'
    }
    // Extract @tagged names
    const tagged = [...notes.matchAll(/@([\w.]+)/g)].map(m => m[1].replace(/_/g, ' '))
    setPostingAct(true)
    await sb.from('crm_activities').insert({ opportunity_id: id, rep_id: user.id, activity_type: activityType, notes, tagged_users: tagged.length ? tagged : null })
    if (tagged.length > 0) {
      await sb.from('notifications').insert(tagged.map(tname => ({
        user_name: tname,
        message: `${user.name} tagged you in an opportunity note`,
        order_id: null,
        order_number: opp.opportunity_name || opp.product_notes || 'Opportunity',
        from_name: user.name,
      })))
    }
    setActDiscussion(''); setActNotes(''); setActVisitType('Alone'); setActSSCMembers([]); setActPartnerName(''); setActMetContact(''); setActDate(''); setActTime(''); setNoteMentionQuery(null)
    const { data: c } = await sb.from('crm_activities').select('*, profiles(name)').eq('opportunity_id', id).order('created_at', { ascending: false })
    setActivities(c || [])
    setPostingAct(false)
  }

  async function addTask() {
    setAddingTask(true)
    await sb.from('crm_tasks').insert({
      opportunity_id: id, task_type: taskType, due_date: taskDueDate || null,
      notes: taskNotes.trim() || null, assigned_rep_id: taskAssignee || user.id, completed: false,
    })
    setTaskType('Call'); setTaskDueDate(''); setTaskNotes('')
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

  async function fetchItems(q) {
    const { data } = await sb.from('items').select('item_code').ilike('item_code', '%' + q + '%').limit(10)
    return data || []
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
    if (!valid.length) { alert('Add at least one item'); return }
    setSavingQuote(true)
    await sb.from('crm_quote_items').delete().eq('opportunity_id', id)
    const { error } = await sb.from('crm_quote_items').insert(valid.map(r => ({
      opportunity_id: id, item_code: r.item_code || null, description: r.description || null,
      qty: parseFloat(r.qty) || 1, unit_price: parseFloat(r.unit_price) || 0,
      discount_pct: parseFloat(r.discount_pct) || 0, total_price: parseFloat(r.total_price) || 0,
    })))
    if (error) { alert('Error saving quote: ' + error.message); setSavingQuote(false); return }
    const total = valid.reduce((s,r) => s + (parseFloat(r.total_price)||0), 0)
    await sb.from('crm_opportunities').update({ estimated_value_inr: total }).eq('id', id)
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

  const today        = new Date().toISOString().slice(0,10)
  const isTerminal   = opp && TERMINAL.includes(opp.stage)
  const currentIdx   = opp ? STAGE_ORDER.indexOf(opp.stage) : -1
  const nextForward  = STAGE_ORDER.slice(currentIdx + 1)
  const nextStage    = nextForward[0] || null
  const pendingTasks = tasks.filter(t => !t.completed)
  const overdueTasks = pendingTasks.filter(t => t.due_date && t.due_date < today)
  const todayTasks   = pendingTasks.filter(t => t.due_date === today)
  const upcomingTasks = pendingTasks.filter(t => !t.due_date || t.due_date > today)
  const quoteTotal   = quoteRows.reduce((s,r) => s + (parseFloat(r.total_price) || 0), 0)
  const actText      = (actType === 'Call' || actType === 'Visit') ? actDiscussion : actNotes

  if (loading) return <Layout pageTitle="Opportunity" pageKey="crm"><CRMSubNav active="opportunities"/><div className="crm-loading"><div className="loading-spin"/>Loading...</div></Layout>
  if (!opp) return null

  return (
    <Layout pageTitle="CRM — Opportunity" pageKey="crm">
      <CRMSubNav active="opportunities" />
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">
                  Opportunity · <StagePill stage={opp.stage} />
                </div>
                <div className="od-header-title">{opp.product_notes || opp.crm_companies?.company_name || '—'}</div>
                <div className="od-header-num">{opp.crm_companies?.company_name || '—'}</div>
                <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>
                  {opp.profiles?.name || '—'}{opp.crm_principals?.name ? ' · ' + opp.crm_principals.name : ''}
                </div>
              </div>
              <div className="od-header-actions">
                <button className="od-btn" onClick={() => navigate('/crm/opportunities')}>← Back</button>
                {!editMode && !isTerminal && <button className="od-btn od-btn-edit" onClick={() => setEditMode(true)}>Edit</button>}
                {!isTerminal && !editMode && (
                  <button className="od-btn" style={{background:'#1e3a5f',color:'white',borderColor:'#1e3a5f'}}
                    onClick={() => { setCloseStage(''); setStageReason(''); setStageRevisit(''); setShowCloseModal(true) }}>
                    Close Opportunity
                  </button>
                )}
                {opp.stage === 'WON' && (
                  <button className="od-btn" onClick={openConvertModal}
                    style={{ background:'#15803d', color:'white', borderColor:'#15803d', fontWeight:700 }}>
                    🎉 Convert to Order
                  </button>
                )}
                {opp.stage === 'WON' && !opp.customer_id && (
                  <button className="od-btn" onClick={() => {
                    setC360Prefill({
                      customer_name: opp.freetext_company || '',
                      gst: opp.gstin || '',
                      customer_type: opp.account_type || '',
                      account_owner: opp.profiles?.name || '',
                    })
                    setShowC360Modal(true)
                  }}
                    style={{ background:'#0369a1', color:'white', borderColor:'#0369a1', fontWeight:700 }}>
                    👤 Add to Customer 360
                  </button>
                )}
                {opp.stage === 'WON' && opp.customer_id && (
                  <button className="od-btn" onClick={() => navigate('/customers/' + opp.customer_id)}
                    style={{ background:'#0369a1', color:'white', borderColor:'#0369a1', fontWeight:700 }}>
                    👤 View in Customer 360
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Close Opportunity Modal */}
          {showCloseModal && (
            <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9000,display:'flex',alignItems:'center',justifyContent:'center'}}
              onClick={e => { if (e.target === e.currentTarget) setShowCloseModal(false) }}>
              <div style={{background:'white',borderRadius:14,padding:32,width:460,maxWidth:'90vw',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24}}>
                  <div style={{fontSize:20,fontWeight:700,color:'var(--gray-900)'}}>Close This Opportunity</div>
                  <button onClick={() => setShowCloseModal(false)} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'var(--gray-400)',lineHeight:1}}>✕</button>
                </div>
                <div style={{marginBottom:16}}>
                  <label style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                    Stage <span style={{color:'#dc2626'}}>*</span>
                  </label>
                  <select value={closeStage} onChange={e => setCloseStage(e.target.value)}
                    style={{width:'100%',padding:'10px 12px',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:13,fontFamily:'var(--font)',outline:'none'}}>
                    <option value="">Select a closed stage…</option>
                    <option value="WON">Closed Won</option>
                    <option value="LOST">Closed Lost</option>
                    <option value="ON_HOLD">On Hold</option>
                  </select>
                </div>
                {closeStage && (
                  <div style={{marginBottom:16}}>
                    <label style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                      Reason {closeStage !== 'ON_HOLD' ? '(optional)' : ''}
                    </label>
                    <input value={stageReason} onChange={e => setStageReason(e.target.value)}
                      placeholder={closeStage==='WON'?'e.g. PO received':closeStage==='LOST'?'e.g. Lost to competition':'e.g. Budget pending next quarter'}
                      style={{width:'100%',padding:'10px 12px',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:13,fontFamily:'var(--font)',outline:'none',boxSizing:'border-box'}} />
                  </div>
                )}
                {closeStage === 'ON_HOLD' && (
                  <div style={{marginBottom:16}}>
                    <label style={{fontSize:13,fontWeight:600,color:'var(--gray-700)',display:'block',marginBottom:6}}>
                      Revisit Date <span style={{color:'#dc2626'}}>*</span>
                    </label>
                    <input type="date" value={stageRevisit} onChange={e => setStageRevisit(e.target.value)}
                      style={{width:'100%',padding:'10px 12px',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:13,fontFamily:'var(--font)',outline:'none',boxSizing:'border-box'}} />
                  </div>
                )}
                <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:24}}>
                  <button onClick={() => setShowCloseModal(false)}
                    style={{padding:'10px 20px',border:'1px solid var(--gray-200)',borderRadius:8,background:'white',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)'}}>
                    Cancel
                  </button>
                  <button
                    disabled={!closeStage || (closeStage==='ON_HOLD' && !stageRevisit) || changingStage}
                    onClick={() => { setPendingStage(closeStage); changeStage(closeStage).then(() => setShowCloseModal(false)) }}
                    style={{padding:'10px 20px',border:'none',borderRadius:8,background:'#1e3a5f',color:'white',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'var(--font)',opacity:(!closeStage||(closeStage==='ON_HOLD'&&!stageRevisit))?0.4:1}}>
                    {changingStage ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Add Activity Modal ── */}
          {showActModal && (() => {
            const ACT_OPTIONS = [
              { key:'Call',  label:'Call',  clr:'#2563eb', icon:'Call' },
              { key:'Visit', label:'Visit', clr:'#059669', icon:'Visit' },
              { key:'Email', label:'Email', clr:'#7c3aed', icon:'Email' },
              { key:'Note',  label:'Note',  clr:'#64748b', icon:'Note' },
            ]
            const sel = ACT_OPTIONS.find(a => a.key === actType)
            const placeholder = actType==='Call'?'What was discussed on the call?':actType==='Visit'?'What was discussed during the visit?':actType==='Email'?'What was the email about?':actType==='Sample'?'Which samples were submitted and to whom?':'Add your note…'
            const textVal = (actType==='Call'||actType==='Visit') ? actDiscussion : actNotes
            const setTextVal = v => (actType==='Call'||actType==='Visit') ? setActDiscussion(v) : setActNotes(v)
            return (
              <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
                onClick={e => { if (e.target===e.currentTarget) setShowActModal(false) }}>
                <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:36, height:36, borderRadius:8, background: sel.clr+'18', display:'flex', alignItems:'center', justifyContent:'center', color: sel.clr }}>
                        <CrmIcon name={sel.icon} size={18} color={sel.clr} />
                      </div>
                      <div>
                        <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Log {actType}</div>
                        <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{opp.opportunity_name || opp.product_notes || 'Opportunity'}</div>
                      </div>
                    </div>
                    <button onClick={() => setShowActModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8', lineHeight:1, padding:4 }}>✕</button>
                  </div>
                  {/* Activity type selector */}
                  <div style={{ padding:'14px 20px 0' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>Activity Type</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {ACT_OPTIONS.map(opt => (
                        <button key={opt.key} onClick={() => { setActType(opt.key); setActDiscussion(''); setActNotes(''); setActVisitType('Alone'); setActSSCMembers([]); setActPartnerName(''); setActMetContact('') }}
                          style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'10px 14px', borderRadius:10, border:'2px solid', cursor:'pointer', fontFamily:'var(--font)', transition:'all 0.15s',
                            background: actType===opt.key ? opt.clr+'12' : 'white',
                            borderColor: actType===opt.key ? opt.clr : '#e2e8f0',
                            color: actType===opt.key ? opt.clr : '#64748b',
                          }}>
                          <CrmIcon name={opt.icon} size={22} color={actType===opt.key ? opt.clr : '#94a3b8'} />
                          <span style={{ fontSize:11, fontWeight:700 }}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Visit type sub-select + extra fields */}
                  {actType === 'Visit' && (
                    <div style={{ padding:'10px 20px 0', display:'flex', flexDirection:'column', gap:10 }}>
                      {/* Visit type pills */}
                      <div>
                        <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Visit Type</div>
                        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                          {VISIT_TYPES.map(vt => (
                            <button key={vt} onClick={() => { setActVisitType(vt); setActSSCMembers([]); setActPartnerName('') }}
                              style={{ fontSize:12, fontWeight:600, padding:'5px 12px', borderRadius:6, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                                background: actVisitType===vt ? '#e8f2fc' : 'white', color: actVisitType===vt ? '#1a4dab' : '#475569',
                                borderColor: actVisitType===vt ? '#c2d9f5' : '#e2e8f0',
                              }}>{vt}</button>
                          ))}
                        </div>
                      </div>
                      {/* With SSC — multi-select team members */}
                      {actVisitType === 'With SSC' && (
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>SSC Team Members</div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                            {reps.filter(r => r.id !== user.id).map(r => {
                              const sel = actSSCMembers.includes(r.id)
                              return (
                                <button key={r.id} type="button"
                                  onClick={() => setActSSCMembers(p => sel ? p.filter(x => x !== r.id) : [...p, r.id])}
                                  style={{ fontSize:12, fontWeight:600, padding:'4px 10px', borderRadius:20, border:'1px solid', cursor:'pointer', fontFamily:'var(--font)',
                                    background: sel ? '#1e3a5f' : 'white', color: sel ? 'white' : '#475569',
                                    borderColor: sel ? '#1e3a5f' : '#e2e8f0',
                                  }}>{r.name}</button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {/* With Principal — partner name */}
                      {actVisitType === 'With Principal' && (
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Principal / Partner Name</div>
                          <input value={actPartnerName} onChange={e => setActPartnerName(e.target.value)}
                            placeholder="e.g. Mitsubishi — Rahul Shah"
                            style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                        </div>
                      )}
                      {/* Met with — customer contact */}
                      {custContacts.length > 0 && (
                        <div>
                          <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Met With</div>
                          <select value={actMetContact} onChange={e => setActMetContact(e.target.value)}
                            style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box', background:'white' }}>
                            <option value="">— Select contact —</option>
                            {custContacts.map(c => (
                              <option key={c.id} value={c.id}>{c.name}{c.designation ? ' · ' + c.designation : ''}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}
                  {/* Date + Time (Call / Visit) */}
                  {(actType === 'Call' || actType === 'Visit') && (
                    <div style={{ padding:'10px 20px 0', display:'flex', gap:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Date</div>
                        <input type="date" value={actDate} onChange={e => setActDate(e.target.value)}
                          style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Time</div>
                        <input type="time" value={actTime} onChange={e => setActTime(e.target.value)}
                          style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                      </div>
                    </div>
                  )}

                  {/* Note — @mention textarea */}
                  {actType === 'Note' ? (
                    <div style={{ padding:'14px 20px' }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>
                        Note <span style={{ fontSize:10, fontWeight:400, textTransform:'none', letterSpacing:0 }}>— type @ to tag a team member</span>
                      </div>
                      <div style={{ position:'relative' }}>
                        <textarea
                          ref={noteInputRef}
                          autoFocus
                          rows={4}
                          value={actNotes}
                          onChange={e => {
                            const val = e.target.value
                            setActNotes(val)
                            const cursor = e.target.selectionStart
                            const match = val.slice(0, cursor).match(/@([\w.]*)$/)
                            setNoteMentionQuery(match ? match[1] : null)
                          }}
                          placeholder="Write a note… type @name to tag someone"
                          style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px', fontSize:13, fontFamily:'var(--font)', resize:'vertical', outline:'none', boxSizing:'border-box', lineHeight:1.6 }}
                        />
                        {noteMentionQuery !== null && (() => {
                          const suggestions = reps.filter(r =>
                            r.id !== user.id &&
                            r.name.toLowerCase().includes(noteMentionQuery.toLowerCase())
                          ).slice(0, 6)
                          return suggestions.length > 0 ? (
                            <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'white', border:'1px solid #e2e8f0', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:300, marginTop:4, overflow:'hidden' }}>
                              {suggestions.map(r => (
                                <div key={r.id}
                                  onMouseDown={e => {
                                    e.preventDefault()
                                    const cursor = noteInputRef.current?.selectionStart || actNotes.length
                                    const slug = r.name.replace(/\s+/g, '_')
                                    const before = actNotes.slice(0, cursor).replace(/@[\w.]*$/, '@' + slug + ' ')
                                    setActNotes(before + actNotes.slice(cursor))
                                    setNoteMentionQuery(null)
                                    setTimeout(() => noteInputRef.current?.focus(), 0)
                                  }}
                                  style={{ padding:'9px 14px', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid #f8fafc' }}
                                  onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
                                  onMouseLeave={e => e.currentTarget.style.background='white'}>
                                  <div style={{ width:26, height:26, borderRadius:'50%', background:'#e0e7ff', color:'#3730a3', fontSize:10, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                    {r.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                                  </div>
                                  <span style={{ fontSize:13, color:'var(--gray-800)' }}>{r.name}</span>
                                </div>
                              ))}
                            </div>
                          ) : null
                        })()}
                      </div>
                      {/* Tagged preview */}
                      {actNotes.match(/@[\w.]+/g) && (
                        <div style={{ marginTop:6, display:'flex', gap:4, flexWrap:'wrap' }}>
                          {[...actNotes.matchAll(/@([\w.]+)/g)].map((m,i) => (
                            <span key={i} style={{ fontSize:11, fontWeight:600, background:'#e0e7ff', color:'#3730a3', borderRadius:4, padding:'2px 7px' }}>
                              @{m[1].replace(/_/g,' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Discussion textarea for Call / Visit / Email */
                    <div style={{ padding:'14px 20px' }}>
                      <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Discussion / Notes</div>
                      <textarea
                        autoFocus
                        rows={4}
                        value={textVal}
                        onChange={e => setTextVal(e.target.value)}
                        placeholder={placeholder}
                        style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px', fontSize:13, fontFamily:'var(--font)', resize:'vertical', outline:'none', boxSizing:'border-box', lineHeight:1.6 }}
                      />
                    </div>
                  )}
                  {/* Footer */}
                  <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
                    <button onClick={() => setShowActModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
                    <button onClick={() => postActivity().then(() => setShowActModal(false))} disabled={postingAct || !(actType==='Note' ? actNotes.trim() : textVal.trim())}
                      style={{ padding:'9px 18px', border:'none', borderRadius:8, background: sel.clr, color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity: !(actType==='Note' ? actNotes.trim() : textVal.trim()) ? 0.4 : 1 }}>
                      {postingAct ? 'Logging…' : actType === 'Note' ? 'Add Note' : 'Log ' + actType}
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* ── Add Task Modal ── */}
          {showTaskModal && (() => {
            const selTask = TASK_TYPES.find(t => t.key === taskType) || TASK_TYPES[0]
            return (
              <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
                onClick={e => { if (e.target===e.currentTarget) setShowTaskModal(false) }}>
                <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:36, height:36, borderRadius:8, background: selTask.clr+'15', display:'flex', alignItems:'center', justifyContent:'center' }}>
                        <CrmIcon name={selTask.icon} size={18} color={selTask.clr} />
                      </div>
                      <div>
                        <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>New Task</div>
                        <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>{opp.opportunity_name || opp.product_notes || 'Opportunity'}</div>
                      </div>
                    </div>
                    <button onClick={() => setShowTaskModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8', lineHeight:1, padding:4 }}>✕</button>
                  </div>
                  {/* Task type grid */}
                  <div style={{ padding:'14px 20px 0' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>Task Type</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {TASK_TYPES.map(opt => (
                        <button key={opt.key} onClick={() => setTaskType(opt.key)}
                          style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'10px 14px', borderRadius:10, border:'2px solid', cursor:'pointer', fontFamily:'var(--font)', transition:'all 0.15s',
                            background: taskType===opt.key ? opt.clr+'12' : 'white',
                            borderColor: taskType===opt.key ? opt.clr : '#e2e8f0',
                            color: taskType===opt.key ? opt.clr : '#64748b',
                          }}>
                          <CrmIcon name={opt.icon} size={22} color={taskType===opt.key ? opt.clr : '#94a3b8'} />
                          <span style={{ fontSize:11, fontWeight:700 }}>{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Due date */}
                  <div style={{ padding:'14px 20px 0' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Due Date</div>
                    <input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)}
                      style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                  </div>
                  {/* Assigned To */}
                  <div style={{ padding:'14px 20px 0' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Assigned To</div>
                    <select value={taskAssignee} onChange={e => setTaskAssignee(e.target.value)}
                      style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box', background:'white', appearance:'auto' }}>
                      <option value="">— Select person —</option>
                      {reps.map(r => <option key={r.id} value={r.id}>{r.name}{r.id === user.id ? ' (me)' : ''}</option>)}
                    </select>
                  </div>

                  {/* Notes */}
                  <div style={{ padding:'14px 20px' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#94a3b8', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Notes (optional)</div>
                    <textarea rows={3} value={taskNotes} onChange={e => setTaskNotes(e.target.value)}
                      placeholder="e.g. Follow up on the quotation sent on Monday…"
                      style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px', fontSize:13, fontFamily:'var(--font)', resize:'vertical', outline:'none', boxSizing:'border-box', lineHeight:1.6 }} />
                  </div>
                  {/* Footer */}
                  <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
                    <button onClick={() => setShowTaskModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
                    <button onClick={() => addTask().then(() => setShowTaskModal(false))} disabled={addingTask}
                      style={{ padding:'9px 18px', border:'none', borderRadius:8, background: selTask.clr, color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                      {addingTask ? 'Adding…' : 'Add Task'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Pipeline bar with "→ Next Stage" built in */}
          <div className="od-pipeline-bar" style={{ marginBottom: !isTerminal && !editMode ? 8 : 16 }}>
            <div className="od-pipeline-stages">
              {STAGE_ORDER.map((s, idx) => {
                let cls = ''
                if (isTerminal) { cls = idx <= currentIdx ? 'done' : '' }
                else { if (idx < currentIdx) cls = 'done'; else if (idx === currentIdx) cls = 'active' }
                return <div key={s} className={'od-pipe-stage ' + cls}>{STAGE_LABELS[s]}</div>
              })}
            </div>
            {isTerminal && (
              <div style={{
                height:44, display:'flex', alignItems:'center', padding:'0 16px', fontWeight:700, fontSize:13, whiteSpace:'nowrap', flexShrink:0,
                background: opp.stage==='WON'?'#15803d':opp.stage==='LOST'?'#dc2626':'#b45309', color:'white',
              }}>{STAGE_LABELS[opp.stage]}</div>
            )}
            {!isTerminal && !editMode && nextStage && (
              <button className="od-mark-complete-btn" onClick={() => { setPendingStage(nextStage); setShowStageMenu(true) }}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="2,8 6,12 14,4"/></svg>
                Mark {STAGE_LABELS[nextStage]}
              </button>
            )}
          </div>


          {/* Stage confirm card */}
          {showStageMenu && pendingStage && (
            <div className="od-card" style={{
              borderColor: pendingStage==='WON'?'#bbf7d0':pendingStage==='LOST'?'#fecaca':'#fde68a',
              marginBottom:16,
            }}>
              <div className="od-card-header">
                <div className="od-card-title">{pendingStage==='WON'?'Mark Won':pendingStage==='LOST'?'Mark Lost':pendingStage==='ON_HOLD'?'Put On Hold':'Move to ' + STAGE_LABELS[pendingStage]}</div>
                <button className="od-btn" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => { setShowStageMenu(false); setPendingStage(null) }}>Cancel</button>
              </div>
              <div className="od-card-body">
                <div className="od-edit-form">
                  {['WON','LOST','ON_HOLD'].includes(pendingStage) && (
                    <div className="od-edit-field"><label>Reason (optional)</label>
                      <input value={stageReason} onChange={e => setStageReason(e.target.value)} placeholder={pendingStage==='WON'?'e.g. PO received':pendingStage==='LOST'?'e.g. Lost to competition':'e.g. Budget pending'}/>
                    </div>
                  )}
                  {pendingStage === 'ON_HOLD' && (
                    <div className="od-edit-field"><label>Revisit Date *</label>
                      <input type="date" value={stageRevisit} onChange={e => setStageRevisit(e.target.value)}/>
                    </div>
                  )}
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="od-btn od-btn-primary" style={{ padding:'6px 12px', fontSize:13 }} onClick={() => changeStage(pendingStage)} disabled={changingStage}>{changingStage?'Saving...':'Confirm'}</button>
                    <button className="od-btn" style={{ padding:'6px 12px', fontSize:13 }} onClick={() => { setShowStageMenu(false); setPendingStage(null) }}>Cancel</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Two-column layout */}
          <div className="od-layout">
            <div className="od-main">

              {/* Opportunity Details */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Opportunity Details</div>
                  {editMode && (
                    <div style={{ display:'flex', gap:8 }}>
                      <button className="od-btn" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => { setEditMode(false); setEditData(opp) }}>Cancel</button>
                      <button className="od-btn od-btn-primary" style={{ padding:'5px 10px', fontSize:12 }} onClick={saveOpp} disabled={saving}>{saving?'Saving...':'Save'}</button>
                    </div>
                  )}
                </div>
                <div className="od-card-body">
                  {editMode ? (
                    <div className="od-edit-form">
                      {/* Opportunity Name */}
                      <div className="od-edit-field"><label>Opportunity Name</label>
                        <input value={editData.opportunity_name||''} onChange={e=>setEditData(p=>({...p,opportunity_name:e.target.value}))} placeholder="e.g. Mitsubishi PLC – Company Name"/>
                      </div>
                      {/* Account Name (typeahead) + Account Type */}
                      <div className="od-edit-row">
                        <div className="od-edit-field" style={{position:'relative'}}>
                          <label>Account Name</label>
                          <input value={editAcctSearch}
                            onChange={e => { setEditAcctSearch(e.target.value); setShowEditAcctDrop(true); if (!e.target.value) setEditData(p=>({...p,customer_id:'',account_type:'',assigned_rep_id:''})) }}
                            onFocus={() => setShowEditAcctDrop(true)}
                            onBlur={() => setTimeout(() => setShowEditAcctDrop(false), 150)}
                            placeholder="Search accounts…" />
                          {showEditAcctDrop && (() => {
                            const m = companies.filter(c => !editAcctSearch.trim() || (c.customer_name||'').toLowerCase().includes(editAcctSearch.toLowerCase())).slice(0,8)
                            if (!m.length) return null
                            return <div style={{position:'absolute',top:'100%',left:0,right:0,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',zIndex:200,marginTop:2,overflow:'hidden'}}>
                              {m.map(c => <div key={c.id} onMouseDown={() => {
                                const rep = reps.find(r => r.name === c.account_owner)
                                setEditData(p=>({...p, customer_id:c.id, account_type:c.customer_type||p.account_type, assigned_rep_id:rep?.id||p.assigned_rep_id}))
                                setEditAcctSearch(c.customer_name); setShowEditAcctDrop(false)
                              }} style={{padding:'9px 14px',fontSize:13,cursor:'pointer',borderBottom:'1px solid #f8fafc'}}
                                onMouseEnter={e=>e.currentTarget.style.background='#f0f4ff'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                                {c.customer_name}
                              </div>)}
                            </div>
                          })()}
                        </div>
                        <div className="od-edit-field"><label>Account Type</label>
                          <select value={editData.account_type||''} onChange={e=>setEditData(p=>({...p,account_type:e.target.value}))}>
                            <option value="">—</option>
                            {['OEM','Panel Builder','End User','Trader'].map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Rep + Probability */}
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Account Owner</label>
                          <select value={editData.assigned_rep_id||''} onChange={e=>setEditData(p=>({...p,assigned_rep_id:e.target.value}))}>
                            <option value="">—</option>{reps.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </div>
                        <div className="od-edit-field"><label>Probability (%)</label>
                          <input type="number" min="0" max="100" value={editData.probability||''} onChange={e=>setEditData(p=>({...p,probability:e.target.value}))} placeholder="0–100"/>
                        </div>
                      </div>
                      {/* Close Date + Opp Type */}
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Close Date</label>
                          <input type="date" value={editData.close_date||editData.expected_close_date||''} onChange={e=>setEditData(p=>({...p,close_date:e.target.value,expected_close_date:e.target.value}))}/>
                        </div>
                        <div className="od-edit-field"><label>Opportunity Type</label>
                          <select value={editData.opportunity_type||''} onChange={e=>setEditData(p=>({...p,opportunity_type:e.target.value}))}>
                            <option value="">—</option>
                            <option value="NEW_BUSINESS">New Business</option>
                            <option value="EXISTING_BUSINESS">Existing Business</option>
                          </select>
                        </div>
                      </div>
                      {/* Brands */}
                      <div className="od-edit-field"><label>Brands</label>
                        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:2}}>
                          {principals.map(p => {
                            const sel = editBrands.includes(p.id)
                            return <button key={p.id} type="button" onClick={() => setEditBrands(prev => sel ? prev.filter(x=>x!==p.id) : [...prev,p.id])}
                              style={{padding:'4px 10px',borderRadius:20,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px solid',
                                background:sel?'#1e3a5f':'white',color:sel?'white':'#475569',borderColor:sel?'#1e3a5f':'#e2e8f0'}}>
                              {p.name}
                            </button>
                          })}
                        </div>
                      </div>
                      {/* Lead Source */}
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Lead Source</label>
                          <select value={editData.lead_source||''} onChange={e=>setEditData(p=>({...p,lead_source:e.target.value,lead_source_detail:''}))}>
                            <option value="">—</option>
                            {['Cold Call','Partner Referral','Customer Referral','Exhibition','Website','SSC Team'].map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        {(editData.lead_source==='Partner Referral'||editData.lead_source==='Customer Referral') && (
                          <div className="od-edit-field"><label>{editData.lead_source==='Partner Referral'?'Partner Name':'Customer Name'}</label>
                            <input value={editData.lead_source_detail||''} onChange={e=>setEditData(p=>({...p,lead_source_detail:e.target.value}))}/>
                          </div>
                        )}
                      </div>
                      {/* Opportunity Value (from quote) + SO Number */}
                      <div className="od-edit-row">
                        <div className="od-edit-field"><label>Opportunity Value</label>
                          <div style={{padding:'6px 10px',border:'1px solid var(--gray-100)',borderRadius:6,background:'var(--gray-50)',fontSize:13,color:quoteTotal>0?'#15803d':'var(--gray-400)',fontWeight:quoteTotal>0?700:400}}>
                            {quoteTotal > 0 ? fmtINR(quoteTotal) : 'Auto from quote items'}
                          </div>
                        </div>
                        <div className="od-edit-field"><label>SO Number</label>
                          <input value={editData.so_number||''} onChange={e=>setEditData(p=>({...p,so_number:e.target.value}))} placeholder="ERP reference"/>
                        </div>
                      </div>
                      {/* Description */}
                      <div className="od-edit-field"><label>Description</label>
                        <textarea rows={3} value={editData.description||''} onChange={e=>setEditData(p=>({...p,description:e.target.value}))} placeholder="Any additional context…"/>
                      </div>
                    </div>
                  ) : (
                    <div className="od-detail-grid">
                      <div className="od-detail-field"><label>Account</label><div className="val">{opp.customers?.customer_name || opp.crm_companies?.company_name || '—'}</div></div>
                      <div className="od-detail-field"><label>Account Type</label><div className="val">{opp.account_type||'—'}</div></div>
                      <div className="od-detail-field"><label>Account Owner</label><div className="val">{opp.profiles?.name||'—'}</div></div>
                      <div className="od-detail-field"><label>Probability</label><div className="val">{opp.probability != null ? opp.probability + '%' : '—'}</div></div>
                      <div className="od-detail-field"><label>Close Date</label><div className="val">{fmt(opp.close_date || opp.expected_close_date)}</div></div>
                      <div className="od-detail-field"><label>Opportunity Type</label><div className="val">{opp.opportunity_type === 'NEW_BUSINESS' ? 'New Business' : opp.opportunity_type === 'EXISTING_BUSINESS' ? 'Existing Business' : '—'}</div></div>
                      <div className="od-detail-field"><label>Opportunity Value</label><div className="val" style={{fontWeight:700,color:'#15803d'}}>{fmtINR(quoteTotal || opp.estimated_value_inr)}</div></div>
                      <div className="od-detail-field"><label>Lead Source</label><div className="val">{opp.lead_source ? opp.lead_source + (opp.lead_source_detail ? ' · ' + opp.lead_source_detail : '') : '—'}</div></div>
                      {(opp.brands?.length > 0) && <div className="od-detail-field" style={{gridColumn:'span 2'}}><label>Brands</label>
                        <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>
                          {opp.brands.map(b => <span key={b} style={{padding:'3px 10px',borderRadius:20,fontSize:11,fontWeight:600,background:'#1e3a5f',color:'white'}}>{b}</span>)}
                        </div>
                      </div>}
                      {opp.description && <div className="od-detail-field" style={{gridColumn:'span 2'}}><label>Description</label><div className="val">{opp.description}</div></div>}
                      {opp.so_number && <div className="od-detail-field"><label>SO Number</label><div className="val">{opp.so_number}</div></div>}
                      {opp.won_lost_on_hold_reason && <div className="od-detail-field" style={{gridColumn:'span 2'}}><label>Reason</label><div className="val">{opp.won_lost_on_hold_reason}</div></div>}
                      {opp.revisit_date && <div className="od-detail-field"><label>Revisit Date</label><div className="val" style={{color:'#b45309',fontWeight:600}}>{fmt(opp.revisit_date)}</div></div>}
                    </div>
                  )}
                </div>
              </div>

              {/* Quote / Products */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Quote / Products</div>
                  {quoteLoaded && <span style={{ fontSize:11, color:'var(--gray-400)' }}>{quoteItems.length} items · {fmtINR(quoteItems.reduce((s,q)=>s+(q.total_price||0),0))}</span>}
                </div>
                <div style={{ borderTop:'1px solid var(--gray-100)', borderBottom:'1px solid var(--gray-100)' }}>
                  <table className="no-items-table">
                    <thead>
                      <tr>
                        <th style={{ width:40, paddingLeft:16 }}>#</th>
                        <th className="col-code">Item Code <span style={{color:'#dc2626'}}>*</span></th>
                        <th className="col-qty">Qty <span style={{color:'#dc2626'}}>*</span></th>
                        <th className="col-lp">LP Price (₹) <span style={{color:'#dc2626'}}>*</span></th>
                        <th className="col-disc">Disc %</th>
                        <th className="col-unit">Unit Price (₹)</th>
                        <th className="col-total">Total (₹)</th>
                        <th style={{ width:32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {quoteRows.map((row, idx) => (
                        <tr key={row._id} className={row.item_code ? 'row-filled' : ''}>
                          <td style={{ paddingLeft:16, color:'var(--gray-400)', fontSize:11, width:40 }}>{idx+1}</td>
                          <td className="col-code">
                            <Typeahead
                              value={row.item_code}
                              onChange={v => updateQuoteRow(idx, 'item_code', v)}
                              onSelect={it => updateQuoteRow(idx, 'item_code', it.item_code)}
                              placeholder="Search or type..."
                              fetchFn={fetchItems}
                              renderItem={it => <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>}
                            />
                          </td>
                          <td className="col-qty"><input type="number" value={row.qty} onChange={e=>updateQuoteRow(idx,'qty',e.target.value)} placeholder="0" min="0" /></td>
                          <td className="col-lp"><input type="number" value={row.unit_price} onChange={e=>updateQuoteRow(idx,'unit_price',e.target.value)} placeholder="0.00" min="0" step="0.01" /></td>
                          <td className="col-disc"><input type="number" value={row.discount_pct} onChange={e=>updateQuoteRow(idx,'discount_pct',e.target.value)} placeholder="0" min="0" max="100" /></td>
                          <td className="col-unit"><input readOnly value={unitAfterDisc(row) > 0 ? unitAfterDisc(row).toFixed(2) : ''} placeholder="—" className="calc-field" /></td>
                          <td className="col-total"><input readOnly value={row.total_price || ''} placeholder="—" className="calc-field total-field" /></td>
                          <td style={{ width:32 }}>
                            {quoteRows.length > 1 && <button onClick={() => setQuoteRows(prev=>prev.filter((_,i)=>i!==idx))} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:18,padding:'0 4px',lineHeight:1 }}>×</button>}
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

            </div>

            {/* Right Sidebar */}
            <div className="od-sidebar">

              {/* Contacts */}
              <div className="od-side-card">
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div className="od-side-card-title" style={{ margin:0 }}>Contacts ({custContacts.length})</div>
                  {opp.customer_id && (
                    <button onClick={() => setShowContactModal(true)}
                      style={{ fontSize:11, fontWeight:700, color:'#1a4dab', background:'#eff6ff', border:'none', borderRadius:6, padding:'4px 10px', cursor:'pointer', fontFamily:'var(--font)' }}>
                      + Add
                    </button>
                  )}
                </div>
                {!opp.customer_id ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)' }}>Link a customer account to manage contacts.</div>
                ) : custContacts.length === 0 ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', textAlign:'center', padding:'10px 0' }}>
                    No contacts yet.<br/>
                    <button onClick={() => setShowContactModal(true)} style={{ marginTop:6, fontSize:12, fontWeight:600, color:'#1a4dab', background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font)' }}>+ Add Contact</button>
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {custContacts.map(c => (
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
            {/* Stage History — Salesforce style */}
            {(() => {
              const stageActs = activities.filter(a => ['Stage Change','Won','Lost'].includes(a.activity_type))
              return (
                <div className="od-side-card" style={{ padding:0, overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.6px' }}>
                      Stage History ({stageActs.length})
                    </div>
                  </div>
                  {stageActs.length === 0 ? (
                    <div style={{ padding:'14px 16px', fontSize:12, color:'var(--gray-400)' }}>No stage changes yet.</div>
                  ) : (
                    stageActs.map((a, i) => {
                      const dt = new Date(a.created_at)
                      const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      const dateStr = dt.getDate() + ' ' + mo[dt.getMonth()] + ' ' + dt.getFullYear() + ', ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
                      const clr = a.activity_type === 'Won' ? '#15803d' : a.activity_type === 'Lost' ? '#dc2626' : '#1a4dab'
                      const stageLabel = a.notes || a.activity_type
                      return (
                        <div key={a.id} style={{ padding:'12px 16px', borderBottom: i < stageActs.length-1 ? '1px solid var(--gray-50)' : 'none', background: i === 0 ? 'white' : 'white' }}>
                          {/* Row: dot + stage label */}
                          <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
                            <div style={{ width:10, height:10, borderRadius:'50%', background:clr, flexShrink:0, marginTop:3 }} />
                            <div style={{ fontSize:12, fontWeight:700, color:'var(--gray-800)', lineHeight:1.4 }}>{stageLabel}</div>
                          </div>
                          {/* Table of fields */}
                          <div style={{ marginLeft:20, display:'flex', flexDirection:'column', gap:4 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                              <span style={{ color:'var(--gray-500)', minWidth:110 }}>Amount:</span>
                              <span style={{ fontWeight:600, color:'var(--gray-800)' }}>{fmtINR(opp.estimated_value_inr) || '—'}</span>
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                              <span style={{ color:'var(--gray-500)', minWidth:110 }}>Probability (%):</span>
                              <span style={{ fontWeight:600, color:'var(--gray-800)' }}>{opp.probability != null ? opp.probability + '%' : '—'}</span>
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                              <span style={{ color:'var(--gray-500)', minWidth:110 }}>Close Date:</span>
                              <span style={{ fontWeight:600, color:'var(--gray-800)' }}>{fmt(opp.expected_close_date)}</span>
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                              <span style={{ color:'var(--gray-500)', minWidth:110 }}>Last Modified By:</span>
                              <span style={{ fontWeight:600, color:'#1a4dab' }}>{a.profiles?.name || '—'}</span>
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                              <span style={{ color:'var(--gray-500)', minWidth:110 }}>Last Modified:</span>
                              <span style={{ fontWeight:600, color:'var(--gray-800)' }}>{dateStr}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })()}

            {/* Sample Request tile */}
            <div className="od-side-card" style={{ background:'#f0fdf4', border:'1px solid #bbf7d0' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:8, background:'#dcfce7', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg fill="none" stroke="#16a34a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{width:18,height:18}}>
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                  </svg>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'#15803d' }}>Sample Request</div>
                  <div style={{ fontSize:11, color:'#16a34a', marginTop:1 }}>Punch a sample order for this opportunity</div>
                </div>
                <button onClick={openSampleModal} disabled={!opp.customer_id}
                  style={{ padding:'6px 14px', border:'none', borderRadius:7, background:'#16a34a', color:'white', fontSize:12, fontWeight:700, cursor: opp.customer_id ? 'pointer' : 'not-allowed', fontFamily:'var(--font)', opacity: opp.customer_id ? 1 : 0.4 }}>
                  Raise SR
                </button>
              </div>
              {!opp.customer_id && <div style={{ fontSize:11, color:'#16a34a', marginTop:8 }}>Link a customer account to raise a sample request.</div>}
            </div>

            </div>
          </div>

          {/* ── Full-width Activity / Notes / Log / Tasks ── */}
          <div style={{ background:'white', borderRadius:10, border:'1px solid var(--gray-100)', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', margin:'20px 0 24px', overflow:'hidden' }}>
            {/* Tab bar */}
            <div style={{ display:'flex', alignItems:'center', borderBottom:'2px solid var(--gray-100)', padding:'0 20px', gap:0 }}>
              {[
                ['activity','Activity', activities.filter(a => ['Call','Visit','Email','Sample'].includes(a.activity_type)).length],
                ['notes','Notes', activities.filter(a => a.activity_type === 'Note').length],
                ['log','Log', activities.filter(a => ['Stage Change','Quotation','Won','Lost'].includes(a.activity_type)).length],
                ['tasks', 'Tasks', pendingTasks.length],
              ].map(([key, label, count]) => (
                <button key={key} onClick={() => setActTab(key)}
                  style={{ padding:'12px 18px', fontSize:13, fontWeight:700, border:'none', background:'none', cursor:'pointer', fontFamily:'var(--font)',
                    color: actTab===key ? '#0e2d6a' : '#94a3b8',
                    borderBottom: actTab===key ? '2px solid #0e2d6a' : '2px solid transparent',
                    marginBottom:-2, transition:'color 0.15s',
                  }}>
                  {label}{count > 0 ? <span style={{ marginLeft:5, fontSize:11, fontWeight:700, background: actTab===key ? '#e8f0fe' : '#f1f5f9', color: actTab===key ? '#0e2d6a' : '#94a3b8', borderRadius:10, padding:'1px 6px' }}>{count}</span> : null}
                </button>
              ))}
              <div style={{ flex:1 }} />
              {actTab === 'activity' && (
                <button onClick={() => { setActType('Call'); setActDiscussion(''); setActNotes(''); setActVisitType('Alone'); setActDate(new Date().toISOString().slice(0,10)); setActTime(''); setShowActModal(true) }}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, border:'none', background:'#0e2d6a', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', marginRight:4 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add Activity
                </button>
              )}
              {actTab === 'notes' && (
                <button onClick={() => { setActType('Note'); setActNotes(''); setShowActModal(true) }}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, border:'none', background:'#0e2d6a', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', marginRight:4 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add Note
                </button>
              )}
              {actTab === 'tasks' && (
                <button onClick={() => { setTaskType('Call'); setTaskDueDate(''); setTaskNotes(''); setTaskAssignee(user.id); setShowTaskModal(true) }}
                  style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, border:'none', background:'#0e2d6a', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', marginRight:4 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  Add Task
                </button>
              )}
            </div>

            {/* ── ACTIVITY TAB ── */}
            {actTab === 'activity' && (() => {
              const manualActs = activities.filter(a => ['Call','Visit','Email','Sample'].includes(a.activity_type))
              const groups = []
              const seen = {}
              manualActs.forEach(a => {
                const dt = new Date(a.created_at)
                const key = dt.getFullYear() + '-' + dt.getMonth()
                const label = dt.toLocaleDateString('en-US', { month:'long', year:'numeric' })
                if (!seen[key]) { seen[key] = true; groups.push({ key, label, items:[] }) }
                groups[groups.length-1].items.push(a)
              })
              const ACT_ICONS = {
                Call:   <CrmIcon name="Call"  size={14} color="currentColor" />,
                Visit:  <CrmIcon name="Visit" size={14} color="currentColor" />,
                Email:  <CrmIcon name="Email" size={14} color="currentColor" />,
                Sample: <CrmIcon name="Quote" size={14} color="currentColor" />,
              }
              const ACT_CLR = { Call:'#2563eb', Visit:'#059669', Email:'#7c3aed', Sample:'#c2410c' }
              return (
                <div>
                  {groups.length === 0 && <div style={{ padding:'32px 20px', fontSize:13, color:'var(--gray-400)', textAlign:'center' }}>No activities yet. Click "Add Activity" to log a call, visit or email.</div>}
                  {groups.map(g => (
                    <div key={g.key}>
                      <div style={{ padding:'8px 20px', background:'#f8fafc', borderBottom:'1px solid var(--gray-100)' }}>
                        <span style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{g.label}</span>
                      </div>
                      {g.items.map(a => {
                        const expanded = expandedActs.has(a.id)
                        const clr = ACT_CLR[a.activity_type] || '#94a3b8'
                        const dt = new Date(a.created_at)
                        const timeStr = dt.getDate() + ' ' + dt.toLocaleDateString('en-US',{month:'short'}) + ' · ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
                        return (
                          <div key={a.id} style={{ borderBottom:'1px solid var(--gray-50)' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 20px', cursor:'pointer' }}
                              onClick={() => setExpandedActs(prev => { const s = new Set(prev); s.has(a.id) ? s.delete(a.id) : s.add(a.id); return s })}>
                              <div style={{ width:32, height:32, borderRadius:8, background:clr+'18', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:clr }}>
                                {ACT_ICONS[a.activity_type] || ACT_ICONS.Call}
                              </div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:700, color:'var(--gray-800)' }}>{actLabel(a)}</div>
                                <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>{a.profiles?.name} · {timeStr}</div>
                              </div>
                              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14, color:'var(--gray-300)', flexShrink:0, transform: expanded?'rotate(180deg)':'none', transition:'transform 0.15s' }}><polyline points="6 9 12 15 18 9"/></svg>
                            </div>
                            {expanded && a.notes && (
                              <div style={{ padding:'0 20px 14px 64px', fontSize:13, color:'var(--gray-600)', lineHeight:1.7, borderTop:'1px solid var(--gray-50)', whiteSpace:'pre-wrap' }}>
                                {a.notes}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* ── NOTES TAB ── */}
            {actTab === 'notes' && (() => {
              const noteActs = activities.filter(a => a.activity_type === 'Note')
              return (
                <div>
                  {noteActs.length === 0 && <div style={{ padding:'32px 20px', fontSize:13, color:'var(--gray-400)', textAlign:'center' }}>No notes yet. Click "Add Note" to write one — use @ to tag a teammate.</div>}
                  {noteActs.map(a => {
                    const expanded = expandedActs.has(a.id)
                    const dt = new Date(a.created_at)
                    const timeStr = dt.getDate() + ' ' + dt.toLocaleDateString('en-US',{month:'short'}) + ' · ' + dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0')
                    return (
                      <div key={a.id} style={{ borderBottom:'1px solid var(--gray-50)' }}>
                        <div style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'14px 20px' }}>
                          <div style={{ width:32, height:32, borderRadius:8, background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'#64748b' }}>
                            <CrmIcon name="Note" size={14} color="#64748b" />
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                              <span style={{ fontSize:12, fontWeight:700, color:'var(--gray-700)' }}>{a.profiles?.name}</span>
                              <span style={{ fontSize:11, color:'var(--gray-400)' }}>{timeStr}</span>
                            </div>
                            <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.7, whiteSpace:'pre-wrap' }}>
                              {renderNoteText(a.notes)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* ── LOG TAB ── */}
            {actTab === 'log' && (() => {
              const logActs = activities.filter(a => ['Stage Change','Quotation','Won','Lost'].includes(a.activity_type))
              const created = opp ? [{ id:'created', profiles:{ name: opp.assigned_rep_name || opp.profiles?.name }, notes:'Opportunity created', activity_type:'Created', created_at: opp.created_at }] : []
              const all = [...logActs, ...created].sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
              const DOT_CLR = { 'Stage Change':'#d97706', 'Quotation':'#16a34a', 'Won':'#15803d', 'Lost':'#dc2626', 'Created':'#1a4dab' }
              return (
                <div style={{ padding:'4px 0' }}>
                  {all.length === 0 && <div style={{ padding:'32px 20px', fontSize:13, color:'var(--gray-400)', textAlign:'center' }}>No log entries yet.</div>}
                  {all.map(a => (
                    <div key={a.id} style={{ display:'flex', alignItems:'flex-start', gap:12, padding:'12px 20px', borderBottom:'1px solid var(--gray-50)' }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background: DOT_CLR[a.activity_type] || '#94a3b8', flexShrink:0, marginTop:5 }} />
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--gray-800)' }}><strong>{a.activity_type}</strong>{a.notes ? ': ' + a.notes : ''}</div>
                        <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>{a.profiles?.name} · {fmtTs(a.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* ── TASKS TAB ── */}
            {actTab === 'tasks' && (
              <div>
                {pendingTasks.length === 0 && (
                  <div style={{ padding:'40px 20px', fontSize:13, color:'var(--gray-400)', textAlign:'center' }}>
                    <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
                    No pending tasks
                  </div>
                )}
                {pendingTasks.map(t => {
                  const isOv  = t.due_date && t.due_date < today
                  const isTdy = t.due_date === today
                  const tt = TASK_TYPES.find(x => x.key === t.task_type) || { clr:'#64748b', icon:'Note', label: t.task_type }
                  return (
                    <div key={t.id} style={{ padding:'14px 20px', borderBottom:'1px solid var(--gray-50)', display:'flex', alignItems:'center', gap:14, background: isOv?'#fff5f5' : isTdy?'#fffbeb' : 'white' }}>
                      <div style={{ width:38, height:38, borderRadius:9, background: tt.clr+'15', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <CrmIcon name={tt.icon} size={18} color={tt.clr} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13, color:'var(--gray-800)' }}>{t.task_type}</div>
                        {t.notes && <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:1 }}>{t.notes}</div>}
                        <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>
                          {t.profiles?.name || reps.find(r => r.id === t.assigned_rep_id)?.name || '—'}
                          {t.due_date && <span style={{ marginLeft:8, fontWeight:600, color: isOv?'#dc2626' : isTdy?'#b45309' : 'var(--gray-400)' }}>{isOv ? '⚠ Overdue · ' : isTdy ? '• Today · ' : '📅 '}{t.due_date}</span>}
                        </div>
                      </div>
                      <button onClick={() => markTaskDone(t.id)} disabled={markingDone===t.id}
                        style={{ width:34, height:34, borderRadius:8, border:'2px solid #16a34a', background:'white', color:'#16a34a', cursor:'pointer', fontWeight:700, fontSize:14, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        {markingDone===t.id ? '…' : '✓'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Add Contact Modal */}
      {showContactModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={e => { if (e.target===e.currentTarget) setShowContactModal(false) }}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:420, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', overflow:'hidden' }}>
            <div style={{ padding:'18px 20px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Add Contact</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{opp.customers?.customer_name || 'Customer'}</div>
              </div>
              <button onClick={() => setShowContactModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12 }}>
              {[['name','Name *','text'],['designation','Title / Designation','text'],['phone','Phone','tel'],['whatsapp','WhatsApp','tel'],['email','Email','email']].map(([field, label, type]) => (
                <div key={field}>
                  <div style={{ fontSize:11, fontWeight:600, color:'#64748b', marginBottom:4, textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
                  <input type={type} value={contactForm[field]} onChange={e => setContactForm(p => ({ ...p, [field]: e.target.value }))}
                    style={{ width:'100%', border:'1px solid #e2e8f0', borderRadius:8, padding:'8px 10px', fontSize:13, fontFamily:'var(--font)', outline:'none', boxSizing:'border-box' }} />
                </div>
              ))}
            </div>
            <div style={{ padding:'0 20px 18px', display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowContactModal(false)} style={{ padding:'9px 18px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={saveCustContact} disabled={savingContact || !contactForm.name.trim()}
                style={{ padding:'9px 18px', border:'none', borderRadius:8, background:'#1e3a5f', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)', opacity: contactForm.name.trim() ? 1 : 0.4 }}>
                {savingContact ? 'Saving…' : 'Save Contact'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Convert to Order Modal */}
      {showConvertModal && (() => {
        const convSubtotal = sampleItems.reduce((s,i) => s + (parseFloat(i.total_price)||0), 0)
        const convGrandTotal = convSubtotal + (parseFloat(sampleFreight)||0)
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
            onClick={e => { if (e.target===e.currentTarget) setShowConvertModal(false) }}>
            <div style={{ background:'#f8fafc', borderRadius:14, width:'100%', maxWidth:820, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }}>

              {/* Header */}
              <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, background:'white', borderRadius:'14px 14px 0 0' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:10, height:10, borderRadius:'50%', background:'#15803d' }} />
                    <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>Convert to Order</div>
                  </div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sampleCustomer?.customer_name} · {opp.opportunity_name || opp.product_notes}</div>
                </div>
                <button onClick={() => setShowConvertModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
              </div>

              <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>

                {/* Customer Info */}
                <div className="no-card" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Customer Information
                  </div>
                  <div className="no-row full">
                    <div className="no-field">
                      <label>Customer Name</label>
                      <input value={sampleCustomer?.customer_name || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                  </div>
                  <div className="no-row three">
                    <div className="no-field">
                      <label>GST Number</label>
                      <input value={sampleGst} onChange={e => setSampleGst(e.target.value)} placeholder="Auto-filled" />
                    </div>
                    <div className="no-field">
                      <label>Credit Terms</label>
                      <input value={sampleCustomer?.credit_terms || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                    <div className="no-field">
                      <label>Account Owner</label>
                      <input value={sampleCustomer?.account_owner || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                  </div>
                  <div className="no-row full">
                    <div className="no-field">
                      <label>Dispatch Address <span className="req">*</span></label>
                      <textarea value={sampleDispatchAddr} onChange={e => setSampleDispatchAddr(e.target.value)} rows={2} placeholder="Delivery address…" />
                    </div>
                  </div>
                </div>

                {/* Order Details */}
                <div className="no-card" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Order Details
                  </div>
                  <div className="no-row three">
                    <div className="no-field">
                      <label>Order Date <span className="req">*</span></label>
                      <input type="date" value={sampleOrderDate} onChange={e => setSampleOrderDate(e.target.value)} />
                    </div>
                    <div className="no-field">
                      <label>Order Type <span className="req">*</span></label>
                      <select value={convertOrderType} onChange={e => setConvertOrderType(e.target.value)}>
                        <option value="SO">Standard Order (SO)</option>
                        <option value="CO">Customised Order (CO)</option>
                      </select>
                    </div>
                    <div className="no-field">
                      <label>Received Via <span className="req">*</span></label>
                      <select value={sampleReceivedVia} onChange={e => setSampleReceivedVia(e.target.value)}>
                        {['Visit','Mobile','WhatsApp','Email','Phone'].map(v => <option key={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="no-row">
                    <div className="no-field">
                      <label>PO / Reference Number <span className="req">*</span></label>
                      <input value={samplePoNumber} onChange={e => setSamplePoNumber(e.target.value)} placeholder="e.g. PO-1234, WhatsApp Order" />
                    </div>
                    <div className="no-field">
                      <label>Notes (for Ops team)</label>
                      <input value={sampleNotes} onChange={e => setSampleNotes(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="no-card no-card-items" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                    Order Items
                  </div>
                  <div className="no-items-table-wrap">
                    <table className="no-items-table">
                      <thead>
                        <tr>
                          <th className="col-sr">#</th>
                          <th className="col-code">Item Code <span className="req">*</span></th>
                          <th className="col-qty">Qty <span className="req">*</span></th>
                          <th className="col-lp">LP Price (₹) <span className="req">*</span></th>
                          <th className="col-disc">Disc %</th>
                          <th className="col-unit">Unit Price (₹)</th>
                          <th className="col-total">Total (₹)</th>
                          <th className="col-date">Delivery Date <span className="req">*</span></th>
                          <th className="col-ref">Cust. Ref</th>
                          <th className="col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleItems.map((row, idx) => (
                          <tr key={idx} className={row.item_code ? 'row-filled' : ''}>
                            <td className="col-sr">{idx+1}</td>
                            <td className="col-code">
                              <Typeahead value={row.item_code}
                                onChange={v => updateSampleItem(idx,'item_code',v)}
                                onSelect={it => updateSampleItem(idx,'item_code',it.item_code)}
                                placeholder="Search or type…"
                                fetchFn={async q => { const { data } = await sb.from('items').select('item_code').ilike('item_code','%'+q+'%').limit(10); return data||[] }}
                                renderItem={it => <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>}
                              />
                            </td>
                            <td className="col-qty"><input type="number" value={row.qty} onChange={e => updateSampleItem(idx,'qty',e.target.value)} placeholder="0" min="0" /></td>
                            <td className="col-lp"><input type="number" value={row.lp_unit_price} onChange={e => updateSampleItem(idx,'lp_unit_price',e.target.value)} placeholder="0.00" min="0" step="0.01" /></td>
                            <td className="col-disc"><input type="number" value={row.discount_pct} onChange={e => updateSampleItem(idx,'discount_pct',e.target.value)} placeholder="0" min="0" max="100" /></td>
                            <td className="col-unit"><input readOnly value={row.unit_price_after_disc} placeholder="—" className="calc-field" /></td>
                            <td className="col-total"><input readOnly value={row.total_price} placeholder="—" className="calc-field total-field" /></td>
                            <td className="col-date"><input type="date" value={row.dispatch_date} onChange={e => updateSampleItem(idx,'dispatch_date',e.target.value)} /></td>
                            <td className="col-ref"><input value={row.customer_ref_no} onChange={e => updateSampleItem(idx,'customer_ref_no',e.target.value)} placeholder="Optional" /></td>
                            <td className="col-del">
                              {sampleItems.length > 1 && (
                                <button className="del-row-btn" onClick={() => setSampleItems(p => p.filter((_,i) => i!==idx))}>
                                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="no-add-row-btn" onClick={() => setSampleItems(p => [...p, emptySampleItem()])}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Row
                  </button>
                </div>

                {/* Totals */}
                <div className="no-card no-totals-card" style={{ margin:0 }}>
                  <div className="no-totals-row">
                    <div className="no-field" style={{ flex:1 }}>
                      <label>Freight Charges (₹)</label>
                      <input type="number" value={sampleFreight} onChange={e => setSampleFreight(e.target.value)} min="0" placeholder="0" />
                    </div>
                    <div className="no-totals-summary">
                      <div className="no-total-line"><span>Subtotal</span><span>₹{convSubtotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                      <div className="no-total-line"><span>Freight</span><span>₹{(parseFloat(sampleFreight)||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                      <div className="no-total-line grand"><span>Grand Total</span><span>₹{convGrandTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Footer */}
              <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', gap:10, justifyContent:'flex-end', flexShrink:0, background:'white', borderRadius:'0 0 14px 14px' }}>
                <button onClick={() => setShowConvertModal(false)}
                  style={{ padding:'10px 20px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                  Cancel
                </button>
                <button onClick={submitConvertOrder} disabled={submittingSample}
                  style={{ padding:'10px 24px', border:'none', borderRadius:8, background:'#15803d', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>
                  {submittingSample ? 'Placing Order…' : 'Place Order'}
                </button>
              </div>

            </div>
          </div>
        )
      })()}

      {/* Sample Request Modal */}
      {showSampleModal && (() => {
        const sampleSubtotal = sampleItems.reduce((s,i) => s + (parseFloat(i.total_price)||0), 0)
        const sampleGrandTotal = sampleSubtotal + (parseFloat(sampleFreight)||0)
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
            onClick={e => { if (e.target===e.currentTarget) setShowSampleModal(false) }}>
            <div style={{ background:'#f8fafc', borderRadius:14, width:'100%', maxWidth:820, maxHeight:'92vh', overflowY:'auto', boxShadow:'0 24px 64px rgba(0,0,0,0.25)', display:'flex', flexDirection:'column' }}>

              {/* Header */}
              <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #e2e8f0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0, background:'white', borderRadius:'14px 14px 0 0' }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700, color:'#0f172a' }}>Sample Request</div>
                  <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{sampleCustomer?.customer_name} · Opp: {opp.opportunity_name || opp.product_notes}</div>
                </div>
                <button onClick={() => setShowSampleModal(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
              </div>

              <div style={{ padding:'16px 20px', display:'flex', flexDirection:'column', gap:12, overflowY:'auto' }}>

                {/* ── Customer Info card ── */}
                <div className="no-card" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    Customer Information
                  </div>
                  <div className="no-row full">
                    <div className="no-field">
                      <label>Customer Name</label>
                      <input value={sampleCustomer?.customer_name || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                  </div>
                  <div className="no-row three">
                    <div className="no-field">
                      <label>GST Number</label>
                      <input value={sampleGst} onChange={e => setSampleGst(e.target.value)} placeholder="Auto-filled" />
                    </div>
                    <div className="no-field">
                      <label>Credit Terms</label>
                      <input value={sampleCustomer?.credit_terms || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                    <div className="no-field">
                      <label>Account Owner</label>
                      <input value={sampleCustomer?.account_owner || ''} readOnly style={{ background:'var(--gray-50)', cursor:'default' }} />
                    </div>
                  </div>
                  <div className="no-row full">
                    <div className="no-field">
                      <label>Dispatch Address <span className="req">*</span></label>
                      <textarea value={sampleDispatchAddr} onChange={e => setSampleDispatchAddr(e.target.value)} rows={2} placeholder="Delivery address…" />
                    </div>
                  </div>
                </div>

                {/* ── Order Details card ── */}
                <div className="no-card" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    Order Details
                  </div>
                  <div className="no-row three">
                    <div className="no-field">
                      <label>Order Date <span className="req">*</span></label>
                      <input type="date" value={sampleOrderDate} onChange={e => setSampleOrderDate(e.target.value)} />
                    </div>
                    <div className="no-field">
                      <label>Order Type</label>
                      <input value="Sample Request (SR)" readOnly style={{ background:'var(--gray-50)', cursor:'default', color:'#16a34a', fontWeight:600 }} />
                    </div>
                    <div className="no-field">
                      <label>Received Via <span className="req">*</span></label>
                      <select value={sampleReceivedVia} onChange={e => setSampleReceivedVia(e.target.value)}>
                        {['Visit','Mobile','WhatsApp','Email','Phone'].map(v => <option key={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="no-row">
                    <div className="no-field">
                      <label>PO / Reference Number <span style={{ color:'var(--gray-400)', fontWeight:400 }}>(optional)</span></label>
                      <input value={samplePoNumber} onChange={e => setSamplePoNumber(e.target.value)} placeholder="e.g. WhatsApp ref, verbal request" />
                    </div>
                    <div className="no-field">
                      <label>Notes (for Ops team)</label>
                      <input value={sampleNotes} onChange={e => setSampleNotes(e.target.value)} placeholder="Opportunity reference, instructions…" />
                    </div>
                  </div>
                </div>

                {/* ── Items card ── */}
                <div className="no-card no-card-items" style={{ margin:0 }}>
                  <div className="no-section-title">
                    <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
                    Order Items
                  </div>
                  <div className="no-items-table-wrap">
                    <table className="no-items-table">
                      <thead>
                        <tr>
                          <th className="col-sr">#</th>
                          <th className="col-code">Item Code <span className="req">*</span></th>
                          <th className="col-qty">Qty <span className="req">*</span></th>
                          <th className="col-lp">LP Price (₹)</th>
                          <th className="col-disc">Disc %</th>
                          <th className="col-unit">Unit Price (₹)</th>
                          <th className="col-total">Total (₹)</th>
                          <th className="col-date">Delivery Date <span className="req">*</span></th>
                          <th className="col-ref">Cust. Ref</th>
                          <th className="col-del"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleItems.map((row, idx) => (
                          <tr key={idx} className={row.item_code ? 'row-filled' : ''}>
                            <td className="col-sr">{idx+1}</td>
                            <td className="col-code">
                              <Typeahead value={row.item_code}
                                onChange={v => updateSampleItem(idx, 'item_code', v)}
                                onSelect={it => updateSampleItem(idx, 'item_code', it.item_code)}
                                placeholder="Search or type…"
                                fetchFn={async q => { const { data } = await sb.from('items').select('item_code').ilike('item_code','%'+q+'%').limit(10); return data||[] }}
                                renderItem={it => <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>}
                              />
                            </td>
                            <td className="col-qty"><input type="number" value={row.qty} onChange={e => updateSampleItem(idx,'qty',e.target.value)} placeholder="0" min="0" /></td>
                            <td className="col-lp"><input type="number" value={row.lp_unit_price} onChange={e => updateSampleItem(idx,'lp_unit_price',e.target.value)} placeholder="0.00" min="0" step="0.01" /></td>
                            <td className="col-disc"><input type="number" value={row.discount_pct} onChange={e => updateSampleItem(idx,'discount_pct',e.target.value)} placeholder="0" min="0" max="100" /></td>
                            <td className="col-unit"><input readOnly value={row.unit_price_after_disc} placeholder="—" className="calc-field" /></td>
                            <td className="col-total"><input readOnly value={row.total_price} placeholder="—" className="calc-field total-field" /></td>
                            <td className="col-date"><input type="date" value={row.dispatch_date} onChange={e => updateSampleItem(idx,'dispatch_date',e.target.value)} /></td>
                            <td className="col-ref"><input value={row.customer_ref_no} onChange={e => updateSampleItem(idx,'customer_ref_no',e.target.value)} placeholder="Optional" /></td>
                            <td className="col-del">
                              {sampleItems.length > 1 && (
                                <button className="del-row-btn" onClick={() => setSampleItems(p => p.filter((_,i) => i!==idx))}>
                                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button className="no-add-row-btn" onClick={() => setSampleItems(p => [...p, emptySampleItem()])}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add Row
                  </button>
                </div>

                {/* ── Totals card ── */}
                <div className="no-card no-totals-card" style={{ margin:0 }}>
                  <div className="no-totals-row">
                    <div className="no-field" style={{ flex:1 }}>
                      <label>Freight Charges (₹)</label>
                      <input type="number" value={sampleFreight} onChange={e => setSampleFreight(e.target.value)} min="0" placeholder="0" />
                    </div>
                    <div className="no-totals-summary">
                      <div className="no-total-line"><span>Subtotal</span><span>₹{sampleSubtotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                      <div className="no-total-line"><span>Freight</span><span>₹{(parseFloat(sampleFreight)||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                      <div className="no-total-line grand"><span>Grand Total</span><span>₹{sampleGrandTotal.toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Footer */}
              <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', gap:10, justifyContent:'flex-end', flexShrink:0, background:'white', borderRadius:'0 0 14px 14px' }}>
                <button onClick={() => setShowSampleModal(false)}
                  style={{ padding:'10px 20px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                  Cancel
                </button>
                <button onClick={submitSample} disabled={submittingSample}
                  style={{ padding:'10px 24px', border:'none', borderRadius:8, background:'#16a34a', color:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                  {submittingSample ? 'Submitting…' : 'Submit Sample Request'}
                </button>
              </div>

            </div>
          </div>
        )
      })()}

      {/* ── Add to Customer 360 Modal ── */}
      {showC360Modal && (
        <NewCustomerModal
          prefill={c360Prefill}
          onClose={() => setShowC360Modal(false)}
          onCreated={async (newId) => {
            await sb.from('crm_opportunities').update({ customer_id: newId }).eq('id', id)
            setShowC360Modal(false)
            navigate('/customers/' + newId)
          }}
        />
      )}

    </Layout>
  )
}
