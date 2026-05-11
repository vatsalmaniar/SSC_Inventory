import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmtTs } from '../lib/fmt'
import Layout from '../components/Layout'
import Typeahead from '../components/Typeahead'
import '../styles/neworder.css'
import '../styles/orderdetail.css'
import '../styles/crm-redesign.css'

const INP = { width:'100%', padding:'8px 10px', fontSize:13, border:'1px solid #e2e8f0', borderRadius:8, outline:'none', fontFamily:'inherit', background:'white', color:'#0f172a', boxSizing:'border-box' }
const LBL = { display:'block', fontSize:11, fontWeight:600, color:'#475569', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.4px' }

function emptyItem() {
  return { _id: Date.now()+Math.random(), item_code:'', description:'', qty:'1', unit_price:'', discount_pct:'0', total_price:'' }
}

function unitAfterDisc(r) {
  return (parseFloat(r.unit_price)||0) * (1 - (parseFloat(r.discount_pct)||0)/100)
}
function rowTotal(r) {
  const q = parseFloat(r.qty)||0
  return q * unitAfterDisc(r)
}

function fmtINR(v) {
  return '₹' + Math.round(v||0).toLocaleString('en-IN')
}

const _OC = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<(n||'').length;i++) h=(n||'').charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function initials(n) { return (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }
function quoteCustomerName(q) {
  return q.customer_name || q.company_freetext
    || q.crm_opportunities?.customers?.customer_name
    || q.crm_opportunities?.crm_companies?.company_name
    || q.crm_opportunities?.freetext_company
    || q.crm_opportunities?.opportunity_name
    || '—'
}

export default function CRMQuotations() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ id:'', name:'', role:'' })
  const [loading, setLoading] = useState(true)
  const [quotes, setQuotes] = useState([])  // grouped by quote_number (only latest revision per group in list)
  const [search, setSearch] = useState('')
  const [viewScope, setViewScope] = useState('mine')  // mine | team | all
  const [filterRep, setFilterRep] = useState('')
  const [reps, setReps] = useState([])
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const [viewQuote, setViewQuote] = useState(null)  // { quote_number, revisions: [...] }
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)  // existing quote_number when revising
  const [form, setForm] = useState({
    customer_id: '',
    customer_name: '',
    opportunity_id: '',
    rows: [emptyItem()],
  })
  const [acctSearch, setAcctSearch] = useState('')
  const [acctMatches, setAcctMatches] = useState([])
  const [showAcctDrop, setShowAcctDrop] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ id: session.user.id, name: profile?.name||'', role: profile?.role||'sales' })
    if (!['sales','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    const { data: repList } = await sb.from('profiles').select('id,name').in('role',['sales','admin']).order('name')
    setReps(repList || [])
    await loadQuotes()
  }

  const isManager = ['admin','management'].includes(user.role)

  async function loadQuotes() {
    setLoading(true)
    const { data } = await sb.from('crm_quotes')
      .select('*, crm_opportunities(id,opportunity_name,stage,customer_id,freetext_company,customers(customer_name),crm_companies(company_name)), profiles(name)')
      .order('created_at', { ascending: false })
    // Group by quote_number
    const groups = {}
    ;(data || []).forEach(q => {
      const key = q.quote_number || q.full_ref || q.id
      if (!groups[key]) groups[key] = []
      groups[key].push(q)
    })
    // For list: take the highest-revision row per group
    const rows = Object.values(groups).map(rs => {
      const sorted = [...rs].sort((a,b) => (b.revision||0) - (a.revision||0))
      return { ...sorted[0], _revision_count: rs.length, _all_revisions: sorted }
    }).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    setQuotes(rows)
    setLoading(false)
  }

  async function searchCustomers(q) {
    const term = (q||'').trim()
    if (!term) { setAcctMatches([]); return }
    const { data } = await sb.from('customers')
      .select('id,customer_name,customer_type')
      .ilike('customer_name', `%${term}%`)
      .order('customer_name').limit(10)
    setAcctMatches(data || [])
  }

  function onSelectCustomer(c) {
    setForm(p => ({ ...p, customer_id: c.id, customer_name: c.customer_name }))
    setAcctSearch(c.customer_name); setShowAcctDrop(false)
  }

  function openNewQuote() {
    setEditingId(null)
    setForm({ customer_id:'', customer_name:'', opportunity_id:'', rows:[emptyItem()] })
    setAcctSearch(''); setAcctMatches([]); setShowAcctDrop(false)
    setShowForm(true)
  }

  function openReviseQuote(group) {
    // Pre-populate form from latest revision; save will create rev+1 under same quote_number
    const latest = group._all_revisions[0]
    setEditingId(latest.quote_number)
    const items = Array.isArray(latest.items) ? latest.items : []
    setForm({
      customer_id: latest.customer_id || '',
      customer_name: latest.customer_name || group.customer_name || '',
      opportunity_id: latest.opportunity_id || '',
      rows: items.length ? items.map(it => ({
        _id: Date.now()+Math.random(),
        item_code: it.item_code||'',
        description: it.description||'',
        qty: String(it.qty||1),
        unit_price: String(it.unit_price||''),
        discount_pct: String(it.discount_pct||'0'),
        total_price: String(it.total_price||''),
      })) : [emptyItem()],
    })
    setAcctSearch(latest.customer_name || group.customer_name || '')
    setAcctMatches([]); setShowAcctDrop(false)
    setViewQuote(null); setShowForm(true)
  }

  function addRow() { setForm(p => ({ ...p, rows: [...p.rows, emptyItem()] })) }
  function removeRow(idx) { setForm(p => ({ ...p, rows: p.rows.filter((_,i)=>i!==idx) })) }
  function updateRow(idx, key, val) {
    setForm(p => {
      const next = [...p.rows]
      const updated = { ...next[idx], [key]: val }
      if (['qty','unit_price','discount_pct'].includes(key)) {
        const qty   = parseFloat(key === 'qty' ? val : updated.qty) || 0
        const price = parseFloat(key === 'unit_price' ? val : updated.unit_price) || 0
        const disc  = parseFloat(key === 'discount_pct' ? val : updated.discount_pct) || 0
        updated.total_price = (qty * price * (1 - disc / 100)).toFixed(2)
      }
      next[idx] = updated
      return { ...p, rows: next }
    })
  }

  async function fetchItems(q) {
    const { data } = await sb.from('items').select('item_code').ilike('item_code', '%' + q + '%').limit(10)
    return data || []
  }

  async function nextQuoteNumber() {
    // FY format like SSC/QU0001/26-27. Increment the QU counter.
    const now = new Date()
    const yr = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
    const fy = `${String(yr%100).padStart(2,'0')}-${String((yr+1)%100).padStart(2,'0')}`
    // Upsert into order_number_counters
    const { data: existing } = await sb.from('order_number_counters').select('last_seq').eq('fy', fy).eq('order_type','QU').maybeSingle()
    let nextSeq = (existing?.last_seq || 0) + 1
    if (existing) {
      await sb.from('order_number_counters').update({ last_seq: nextSeq }).eq('fy', fy).eq('order_type','QU')
    } else {
      await sb.from('order_number_counters').insert({ fy, order_type:'QU', last_seq: nextSeq })
    }
    const qnum = `SSC/QU${String(nextSeq).padStart(4,'0')}/${fy}`
    return { quote_number: qnum, fy }
  }

  async function saveQuote() {
    const customerName = form.customer_name.trim() || acctSearch.trim()
    if (!customerName) { toast('Customer / Company is required'); return }
    const validRows = form.rows.filter(r => r.item_code.trim() && parseFloat(r.qty) > 0)
    if (!validRows.length) { toast('Add at least one line item'); return }
    setSaving(true)

    const items = validRows.map((r, idx) => ({
      sr_no: idx+1,
      item_code: r.item_code.trim(),
      description: r.description||'',
      qty: parseFloat(r.qty)||0,
      unit_price: parseFloat(r.unit_price)||0,
      discount_pct: parseFloat(r.discount_pct)||0,
      total_price: parseFloat(r.total_price)||0,
    }))
    const total = items.reduce((s,i) => s + (i.total_price||0), 0)

    let quote_number, fy, revision, full_ref
    if (editingId) {
      // Revising existing quote: same quote_number, revision+1
      quote_number = editingId
      const { data: existing } = await sb.from('crm_quotes').select('revision,full_ref').eq('quote_number', quote_number).order('revision', { ascending: false }).limit(1).maybeSingle()
      revision = (existing?.revision || 0) + 1
      const refBase = (existing?.full_ref || quote_number).replace(/\/\d+$/, '')
      full_ref = `${refBase}/${revision}`
    } else {
      const fresh = await nextQuoteNumber()
      quote_number = fresh.quote_number; fy = fresh.fy
      revision = 1
      full_ref = `${quote_number}/${revision}`
    }

    const payload = {
      opportunity_id: form.opportunity_id || null,
      customer_id: form.customer_id || null,
      customer_name: customerName,
      company_freetext: form.customer_id ? null : customerName,
      quote_number, full_ref, revision,
      items,
      total_value: total,
      created_by: user.id,
    }
    const { error } = await sb.from('crm_quotes').insert(payload)
    if (error) { toast('Failed: ' + error.message); setSaving(false); return }

    toast(editingId ? `Revision ${revision} saved` : `Quote ${quote_number} created`, 'success')
    setShowForm(false); setEditingId(null); setSaving(false)
    await loadQuotes()
  }

  async function printQuote(q) {
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))
    const items = q.items || []
    const subtotal = items.reduce((s,i) => s + (i.total_price || 0), 0)
    const dateStr = fmtTs(q.created_at)

    let custName = quoteCustomerName(q)
    let custAddr = '', custGst = '', creditTerms = 'Against PI', custId = ''
    const customerId = q.customer_id || q.crm_opportunities?.customer_id
    if (customerId) {
      const { data: cust } = await sb.from('customers').select('customer_id,customer_name,billing_address,gst,credit_terms').eq('id', customerId).single()
      if (cust) {
        custName    = cust.customer_name || custName
        custAddr    = cust.billing_address || ''
        custGst     = cust.gst || ''
        creditTerms = cust.credit_terms || 'Against PI'
        custId      = cust.customer_id || ''
      }
    }
    const isAgainstPI = creditTerms === 'Against PI'

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Quotation ${esc(q.full_ref)}</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.5}
  .mono{font-family:'Geist Mono',monospace}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .co-name{font-size:17px;font-weight:700;color:#0f172a;margin-bottom:2px}
  .co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
  .co-addr{font-size:10.5px;color:#475569;line-height:1.6}
  .doc-title{font-size:28px;font-weight:700;color:#0f172a;text-align:right;letter-spacing:-0.5px}
  .doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:#eff6ff;color:#1d4ed8;text-align:right}
  .divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
  .meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
  .meta-name{font-size:13px;font-weight:700;color:#0f172a;margin-bottom:3px}
  .meta-addr{font-size:11px;color:#475569;line-height:1.6}
  .meta-gstin{font-size:11px;color:#475569;margin-top:5px}
  .ref-table{width:100%;border-collapse:collapse}
  .ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
  .ref-table tr td:first-child{color:#64748b;width:45%}
  .ref-table tr td:last-child{font-weight:600;color:#0f172a}
  .terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px}
  .terms span strong{color:#0f172a;font-weight:600}
  table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
  table.items thead tr{border-bottom:2px solid #0f172a}
  table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
  table.items th.r{text-align:right}
  table.items tbody tr{border-bottom:1px solid #f1f5f9}
  table.items tbody tr:last-child{border-bottom:none}
  table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;color:#0f172a}
  table.items td.r{text-align:right}
  table.items td.code{font-family:'Geist Mono',monospace;font-size:11px;font-weight:500}
  .totals-wrap{display:flex;justify-content:flex-end;margin-top:12px}
  .totals-table{width:300px;border-collapse:collapse}
  .totals-table td{padding:5px 0;font-size:11.5px}
  .totals-table td.lbl{color:#64748b}
  .totals-table td.val{text-align:right;font-weight:500}
  .totals-table tr.grand td{border-top:2px solid #0f172a;padding-top:8px;font-size:13px;font-weight:700}
  .notes-box{font-size:11px;color:#475569;margin:16px 0 24px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
  .sig-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:32px;padding-top:20px;border-top:1px solid #e2e8f0}
  .sig-cell{text-align:center;font-size:10px;color:#64748b}
  .sig-line{border-top:1px solid #94a3b8;margin:28px 20px 8px}
  .sig-name{font-weight:600;color:#0f172a;font-size:11px}
  .footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:10px;color:#94a3b8;line-height:1.6}
  .footer-right{font-size:10px;color:#94a3b8;text-align:right}
  @media print{body{padding:0;max-width:100%}@page{size:A4;margin:16mm 14mm}}
</style></head><body>

<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">
      E/12, Siddhivinayak Towers, B/H DCP Office<br/>
      Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
      GSTIN: 24ABGCS0605M1ZE
    </div>
  </div>
  <div style="text-align:right">
    <img src="${window.location.origin}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
    <div class="doc-type-badge">Quotation</div>
    <div class="doc-title">Quotation</div>
  </div>
</div>

<hr class="divider"/>

<div class="meta-grid">
  <div>
    <div class="meta-section-label">Prepared For</div>
    <div class="meta-name">${esc(custName)}</div>
    ${custId ? `<div style="font-size:11px;color:#475569;margin-top:2px">Customer ID: <strong style="font-family:'Geist Mono',monospace">${esc(custId)}</strong></div>` : ''}
    ${custAddr ? `<div class="meta-addr">${esc(custAddr).replace(/\n/g,'<br/>')}</div>` : ''}
    ${custGst ? `<div class="meta-gstin">GSTIN: <strong>${esc(custGst)}</strong></div>` : ''}
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>Quote Ref.</td><td class="mono">${esc(q.full_ref)}</td></tr>
      <tr><td>Date</td><td>${esc(dateStr)}</td></tr>
      <tr><td>Revision</td><td>${q.revision}</td></tr>
      ${q.profiles?.name ? `<tr><td>Prepared By</td><td>${esc(q.profiles.name)}</td></tr>` : ''}
    </table>
  </div>
</div>

<hr class="divider"/>

<div class="terms">
  <span>Payment Terms: <strong>${esc(creditTerms) || '—'}</strong></span>
  <span>Currency: <strong>INR</strong></span>
  ${isAgainstPI ? '<span style="color:#b45309;font-weight:600">⚠ Order against Proforma Invoice</span>' : ''}
</div>

<table class="items">
  <thead>
    <tr>
      <th style="width:36px">#</th>
      <th>Item Code / Description</th>
      <th class="r" style="width:60px">Qty</th>
      <th class="r" style="width:130px">Unit Price (₹)</th>
      <th class="r" style="width:130px">Total (₹)</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((it,i) => `<tr>
      <td style="color:#94a3b8">${i+1}</td>
      <td class="code">${esc(it.item_code)||'—'}${it.description ? `<div style="font-family:sans-serif;font-size:11px;color:#475569;font-weight:400;margin-top:2px">${esc(it.description)}</div>` : ''}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${((it.unit_price||0)*(1-(it.discount_pct||0)/100)).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
      <td class="r" style="font-weight:600">${(it.total_price||0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
    </tr>`).join('')}
  </tbody>
</table>

<div class="totals-wrap">
  <table class="totals-table">
    <tr><td class="lbl">Subtotal</td><td class="val">${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
    <tr><td class="lbl">GST (18%)</td><td class="val">As applicable / Extra</td></tr>
    <tr><td class="lbl">Freight</td><td class="val">Extra / Actual</td></tr>
    <tr class="grand"><td class="lbl">Quote Value</td><td class="val">₹ ${subtotal.toLocaleString('en-IN',{minimumFractionDigits:2})}</td></tr>
  </table>
</div>

<div class="notes-box">
  <strong>Note:</strong> All prices are exclusive of GST. Freight charges will be billed at actuals.${isAgainstPI ? ' This quotation is valid against Proforma Invoice only.' : ''} Prices are subject to change without prior notice.
</div>

<div class="sig-row">
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Prepared By</div>Sales Team</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised By</div>Manager</div>
  <div class="sig-cell"><div class="sig-line"></div><div class="sig-name">Authorised Signatory</div>For SSC Control Pvt. Ltd.</div>
</div>

<div class="footer">
  <div class="footer-left">
    SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>
    Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>
    Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010
  </div>
  <div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div>
</div>

</body></html>`
    const w = window.open('', '_blank')
    if (!w) { toast('Popup blocked — allow popups for this site and try again.'); return }
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 600)
  }

  async function deleteQuote(group) {
    if (!['admin','management'].includes(user.role)) { toast('Admin/management only'); return }
    if (!window.confirm(`Delete ${group.quote_number} (${group._revision_count} revision${group._revision_count>1?'s':''})?\n\nThis cannot be undone.`)) return
    const { error } = await sb.from('crm_quotes').delete().eq('quote_number', group.quote_number)
    if (error) { toast('Delete failed: ' + error.message); return }
    setViewQuote(null)
    await loadQuotes()
    toast('Quote deleted', 'success')
  }

  const q = search.trim().toLowerCase()
  const filtered = quotes
    .filter(qt => {
      if (viewScope === 'mine') return qt.created_by === user.id
      if (viewScope === 'team') return qt.created_by !== user.id  // others' quotes
      return true  // all
    })
    .filter(qt => !filterRep || qt.created_by === filterRep)
    .filter(qt => !q ||
      (qt.quote_number||'').toLowerCase().includes(q) ||
      quoteCustomerName(qt).toLowerCase().includes(q)
    )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Layout pageTitle="Quotations" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Quotations</h1>
            <div className="opps-summary"><span><b>{filtered.length}</b> quotes</span></div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={openNewQuote}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Quote
            </button>
          </div>
        </div>

        <div className="opps-bar">
          <div className="view-toggle">
            <button className={viewScope==='mine' ? 'on' : ''} onClick={() => { setViewScope('mine'); setPage(1) }}>My View</button>
            <button className={viewScope==='team' ? 'on' : ''} onClick={() => { setViewScope('team'); setPage(1) }}>Team</button>
            <button className={viewScope==='all' ? 'on' : ''} onClick={() => { setViewScope('all'); setPage(1) }}>All</button>
          </div>
        </div>

        <div className="opps-filters">
          <div className="opps-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search quote #, customer…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
          </div>
          {isManager && (
            <select className="filt-select" value={filterRep} onChange={e => { setFilterRep(e.target.value); setPage(1) }}>
              <option value="">All Reps</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {(search || filterRep) && (
            <button className="opps-clear" onClick={() => { setSearch(''); setFilterRep(''); setPage(1) }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="crm-loading">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="dl-wrap"><div className="dl-empty">No quotes found</div></div>
        ) : (
          <>
            <div className="dl-wrap">
              <div className="dl-row dl-head" style={{ gridTemplateColumns: '1.6fr 100px 110px 1.4fr 130px 170px' }}>
                <div>Quote / Customer</div>
                <div>Revision</div>
                <div className="num">Total</div>
                <div>Opportunity</div>
                <div>Created</div>
                <div>Rep</div>
              </div>
              <div className="dl-table">
                {paged.map(q => (
                  <div key={q.quote_number} className="dl-row dl-data" onClick={() => setViewQuote(q)}
                    style={{ gridTemplateColumns: '1.6fr 100px 110px 1.4fr 130px 170px' }}>
                    <div className="dl-cell dl-deal">
                      <div className="dl-title" style={{ fontFamily:'var(--mono)' }}>{q.quote_number}</div>
                      <div className="dl-deal-meta">
                        <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{quoteCustomerName(q)}</span>
                      </div>
                    </div>
                    <div className="dl-cell">
                      <span className="dl-stage-pill" style={{ '--stage-color': q._revision_count > 1 ? '#b45309' : '#475569' }}>
                        <span className="dl-stage-dot"/>
                        v{q.revision}{q._revision_count > 1 ? ` of ${q._revision_count}` : ''}
                      </span>
                    </div>
                    <div className="dl-cell dl-value">{fmtINR(q.total_value)}</div>
                    <div className="dl-cell" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:12 }}>
                      {q.crm_opportunities?.opportunity_name || <span style={{color:'var(--c-muted-2)'}}>—</span>}
                    </div>
                    <div className="dl-cell">
                      <div className="dl-date-main">{fmtTs(q.created_at)}</div>
                    </div>
                    <div className="dl-cell dl-owner">
                      {q.profiles?.name ? (
                        <>
                          <div className="dl-owner-avatar" style={{background: ownerColor(q.profiles.name)}}>{initials(q.profiles.name)}</div>
                          <span className="dl-owner-name">{q.profiles.name}</span>
                        </>
                      ) : <span style={{color:'var(--c-muted-2)'}}>—</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {totalPages > 1 && (
              <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:10,padding:'16px 0',fontSize:12,color:'var(--c-muted)'}}>
                <button className="btn-ghost" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Prev</button>
                <span>Page {safePage} of {totalPages} ({filtered.length} results)</span>
                <button className="btn-ghost" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Quote Detail Drawer ── */}
      {viewQuote && (
        <div className="od-drawer-scrim"
          onClick={e => { if (e.target === e.currentTarget) setViewQuote(null) }}>
          <div className="od-drawer" style={{ width:'min(720px, 95vw)' }}>
            <div className="od-drawer-head">
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--c-text)', fontFamily:'var(--mono)' }}>{viewQuote.quote_number}</div>
                <div style={{ fontSize:12, color:'var(--c-muted)', marginTop:2 }}>{quoteCustomerName(viewQuote)}</div>
                <div style={{ fontSize:11, color:'var(--c-muted-2)', marginTop:2 }}>{viewQuote._revision_count} revision{viewQuote._revision_count>1?'s':''} · Current total {fmtINR(viewQuote.total_value)}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <button onClick={() => printQuote(viewQuote)} title="Download PDF of current revision"
                  style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:6, padding:'5px 10px', fontSize:12, fontWeight:600, color:'#15803d', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download
                </button>
                <button onClick={() => openReviseQuote(viewQuote)} title="Revise — creates a new revision"
                  style={{ background:'#eff6ff', border:'1px solid #c2d9f5', borderRadius:6, padding:'5px 10px', fontSize:12, fontWeight:600, color:'#1a4dab', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Revise
                </button>
                {['admin','management'].includes(user.role) && (
                  <button onClick={() => deleteQuote(viewQuote)} title="Delete entire quote (all revisions)"
                    style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:6, padding:'5px 10px', fontSize:12, fontWeight:600, color:'#dc2626', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    Delete
                  </button>
                )}
                <button onClick={() => setViewQuote(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--c-muted-2)', padding:4, marginLeft:2 }}>✕</button>
              </div>
            </div>
            <div className="od-drawer-body">
              <div className="od-page" style={{ display:'flex', flexDirection:'column', gap:14, minHeight:'unset', background:'transparent' }}>
              {viewQuote.opportunity_id && viewQuote.crm_opportunities && (
                <div className="linked-opp-tile" onClick={() => navigate('/crm/opportunities/' + viewQuote.opportunity_id)}
                  style={{ padding:'10px 12px', borderRadius:8, border:'1px solid #c2d9f5', background:'#eff6ff', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
                  <div>
                    <div className="linked-opp-label" style={{ fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.5px', color:'#1a4dab', marginBottom:3 }}>Linked Opportunity</div>
                    <div style={{ fontSize:13, fontWeight:600, color:'var(--c-text)' }}>{viewQuote.crm_opportunities.opportunity_name}</div>
                    {viewQuote.crm_opportunities.stage && <div style={{ fontSize:11, color:'var(--c-muted)', marginTop:1 }}>Stage: {viewQuote.crm_opportunities.stage}</div>}
                  </div>
                  <svg className="linked-opp-arrow" fill="none" stroke="#1a4dab" strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </div>
              )}

              {/* Current revision — Quote / Products card (mirrors Opportunity Detail) */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Current Quote · v{viewQuote.revision}</div>
                  <span style={{ fontSize:11, color:'var(--gray-400)' }}>{(viewQuote.items||[]).length} items · {fmtINR(viewQuote.total_value)}</span>
                </div>
                <div style={{ borderTop:'1px solid var(--gray-100)', borderBottom:'1px solid var(--gray-100)', overflowX:'auto' }}>
                  <table className="no-items-table" style={{ minWidth:'unset', tableLayout:'fixed', width:'100%' }}>
                    <colgroup>
                      <col style={{ width:32 }} />
                      <col style={{ width:'auto' }} />
                      <col style={{ width:60 }} />
                      <col style={{ width:90 }} />
                      <col style={{ width:60 }} />
                      <col style={{ width:90 }} />
                      <col style={{ width:100 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft:12 }}>#</th>
                        <th>Item Code</th>
                        <th>Qty</th>
                        <th>LP (₹)</th>
                        <th>Disc %</th>
                        <th>Unit (₹)</th>
                        <th>Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(viewQuote.items||[]).map((it, i) => (
                        <tr key={i} className="row-filled">
                          <td style={{ paddingLeft:12, color:'var(--gray-400)', fontSize:11 }}>{i+1}</td>
                          <td>
                            <div style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>
                            {it.description && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>{it.description}</div>}
                          </td>
                          <td>{it.qty}</td>
                          <td>{Number(it.unit_price||0).toLocaleString('en-IN')}</td>
                          <td>{it.discount_pct||0}%</td>
                          <td>{((parseFloat(it.unit_price)||0)*(1-(parseFloat(it.discount_pct)||0)/100)).toFixed(2)}</td>
                          <td style={{ fontWeight:600 }}>{Number(it.total_price||0).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="od-totals">
                  <div className="od-totals-inner">
                    <div className="od-totals-row"><span>Subtotal</span><span>₹{Number(viewQuote.total_value||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    <div className="od-totals-row grand"><span>Grand Total</span><span>₹{Number(viewQuote.total_value||0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
              </div>

              {/* Quote Revisions card (mirrors Opportunity Detail) */}
              {viewQuote._all_revisions.length > 1 && (
                <div className="od-card">
                  <div className="od-card-header">
                    <div className="od-card-title">Quote Revisions</div>
                    <span style={{ fontSize:11, color:'var(--gray-400)' }}>{viewQuote._all_revisions.length} revisions</span>
                  </div>
                  <div style={{ padding:'0 4px' }}>
                    {viewQuote._all_revisions.map((rev, idx) => (
                      <div key={rev.id} className={rev.revision === viewQuote.revision ? 'qu-rev-row qu-rev-current' : 'qu-rev-row'} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderBottom: idx < viewQuote._all_revisions.length - 1 ? '1px solid var(--gray-100)' : 'none', background: rev.revision === viewQuote.revision ? '#eff6ff' : 'transparent' }}>
                        <div>
                          <div className="qu-rev-ref" style={{ fontFamily:'var(--mono)', fontWeight:700, fontSize:13, color:'#1a4dab' }}>
                            {rev.full_ref}
                            {rev.revision === viewQuote.revision && <span className="qu-rev-badge" style={{ fontSize:10, fontWeight:600, marginLeft:8, padding:'2px 6px', background:'#dbeafe', color:'#1a4dab', borderRadius:4 }}>CURRENT</span>}
                          </div>
                          <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>
                            {fmtINR(rev.total_value)} · {(rev.items||[]).length} items · {rev.profiles?.name || '—'} · {fmtTs(rev.created_at)}
                          </div>
                        </div>
                        <button onClick={() => printQuote({ ...rev, crm_opportunities: viewQuote.crm_opportunities, customer_id: viewQuote.customer_id, customer_name: viewQuote.customer_name, company_freetext: viewQuote.company_freetext })}
                          style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', border:'1px solid #1a4dab', borderRadius:7, background:'#eff6ff', color:'#1a4dab', fontSize:11, fontWeight:600, cursor:'pointer', flexShrink:0, marginLeft:12 }}>
                          <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Form Drawer (New Quote / Revise) ── */}
      {showForm && (
        <div className="od-drawer-scrim"
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false) }}>
          <div className="od-drawer" style={{ width:'min(780px, 95vw)' }}>
            <div className="od-drawer-head">
              <div>
                <div style={{ fontSize:15, fontWeight:700, color:'var(--c-text)' }}>{editingId ? `Revise ${editingId}` : 'New Quotation'}</div>
                <div style={{ fontSize:11, color:'var(--c-muted-2)', marginTop:1 }}>{editingId ? 'Creates a new revision under the same quote number' : 'Generates a new SSC/QU number'}</div>
              </div>
              <button onClick={() => setShowForm(false)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'var(--c-muted-2)', padding:4 }}>✕</button>
            </div>
            <div className="od-drawer-body">
              <div className="od-page" style={{ display:'flex', flexDirection:'column', gap:14, minHeight:'unset', background:'transparent' }}>
              {/* Customer */}
              <div>
                <label style={LBL}>Customer / Company <span style={{color:'#dc2626'}}>*</span></label>
                <div style={{ position:'relative' }}>
                  <input value={acctSearch} onChange={e => { const v=e.target.value; setAcctSearch(v); setShowAcctDrop(true); if (!v) { setForm(p=>({...p,customer_id:'',customer_name:''})); setAcctMatches([]) } else { searchCustomers(v); setForm(p=>({...p,customer_name:v})) } }}
                    onFocus={() => setShowAcctDrop(true)} onBlur={() => setTimeout(() => setShowAcctDrop(false), 150)}
                    placeholder="Type to search Customer 360, or just enter name…"
                    style={{ ...INP, background: form.customer_id ? '#f0fdf4' : 'white', borderColor: form.customer_id ? '#059669' : '#e2e8f0' }} />
                  {form.customer_id && (
                    <button type="button" onClick={() => { setForm(p=>({...p,customer_id:'',customer_name:''})); setAcctSearch('') }}
                      style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}>✕</button>
                  )}
                  {showAcctDrop && acctSearch.trim() && !form.customer_id && acctMatches.length > 0 && (
                    <div style={{ position:'absolute', top:'100%', left:0, right:0, background:'white', border:'1px solid #e2e8f0', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', zIndex:200, marginTop:2 }}>
                      {acctMatches.map(c => (
                        <div key={c.id} onMouseDown={() => onSelectCustomer(c)} style={{ padding:'10px 14px', fontSize:13, cursor:'pointer', borderBottom:'1px solid #f8fafc' }}
                          onMouseEnter={e => e.currentTarget.style.background='#f0f9ff'} onMouseLeave={e => e.currentTarget.style.background='white'}>
                          <div style={{fontWeight:600}}>{c.customer_name}</div>
                          {c.customer_type && <div style={{ fontSize:11, color:'#94a3b8' }}>{c.customer_type}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quote / Products card — same design as Opportunity Detail */}
              <div className="od-card">
                <div className="od-card-header">
                  <div className="od-card-title">Quote / Products</div>
                  <span style={{ fontSize:11, color:'var(--gray-400)' }}>
                    {form.rows.filter(r => r.item_code).length} items · ₹{form.rows.reduce((s,r)=>s+rowTotal(r),0).toLocaleString('en-IN',{maximumFractionDigits:0})}
                  </span>
                </div>
                <div style={{ borderTop:'1px solid var(--gray-100)', borderBottom:'1px solid var(--gray-100)', overflowX:'auto' }}>
                  <table className="no-items-table" style={{ minWidth:'unset', tableLayout:'fixed', width:'100%' }}>
                    <colgroup>
                      <col style={{ width:32 }} />
                      <col style={{ width:'auto' }} />
                      <col style={{ width:68 }} />
                      <col style={{ width:100 }} />
                      <col style={{ width:62 }} />
                      <col style={{ width:100 }} />
                      <col style={{ width:100 }} />
                      <col style={{ width:28 }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{ paddingLeft:12 }}>#</th>
                        <th>Item Code <span style={{color:'#dc2626'}}>*</span></th>
                        <th>Qty <span style={{color:'#dc2626'}}>*</span></th>
                        <th>LP Price (₹) <span style={{color:'#dc2626'}}>*</span></th>
                        <th>Disc %</th>
                        <th>Unit Price (₹)</th>
                        <th>Total (₹)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.rows.map((row, idx) => (
                        <tr key={row._id} className={row.item_code ? 'row-filled' : ''}>
                          <td style={{ paddingLeft:12, color:'var(--gray-400)', fontSize:11 }}>{idx+1}</td>
                          <td>
                            <Typeahead
                              value={row.item_code}
                              onChange={v => updateRow(idx, 'item_code', v)}
                              onSelect={it => updateRow(idx, 'item_code', it.item_code)}
                              placeholder="Search or type..."
                              fetchFn={fetchItems}
                              strictSelect
                              renderItem={it => <div className="typeahead-item-main" style={{ fontFamily:'var(--mono)', fontSize:12 }}>{it.item_code}</div>}
                            />
                            <input
                              value={row.description || ''}
                              onChange={e => updateRow(idx, 'description', e.target.value)}
                              placeholder="Description (optional)"
                              style={{ marginTop:4, fontSize:11, color:'var(--gray-600)', fontStyle: row.description ? 'normal' : 'italic' }}
                            />
                          </td>
                          <td><input type="number" value={row.qty} onChange={e=>updateRow(idx,'qty',e.target.value)} placeholder="0" min="0" /></td>
                          <td><input type="number" value={row.unit_price} onChange={e=>updateRow(idx,'unit_price',e.target.value)} placeholder="0.00" min="0" step="0.01" /></td>
                          <td><input type="number" value={row.discount_pct} onChange={e=>updateRow(idx,'discount_pct',e.target.value)} placeholder="0" min="0" max="100" /></td>
                          <td><input readOnly value={unitAfterDisc(row) > 0 ? unitAfterDisc(row).toFixed(2) : ''} placeholder="—" className="calc-field" /></td>
                          <td><input readOnly value={row.total_price || ''} placeholder="—" className="calc-field total-field" /></td>
                          <td>
                            {form.rows.length > 1 && <button onClick={() => removeRow(idx)} style={{ background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',fontSize:18,padding:'0 2px',lineHeight:1 }}>×</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ padding:'10px 20px', borderTop:'1px solid var(--gray-100)' }}>
                  <button className="od-btn" style={{ padding:'6px 10px', fontSize:12 }} onClick={addRow}>+ Add Row</button>
                </div>
                <div className="od-totals">
                  <div className="od-totals-inner">
                    <div className="od-totals-row"><span>Subtotal</span><span>₹{form.rows.reduce((s,r)=>s+rowTotal(r),0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                    <div className="od-totals-row grand"><span>Grand Total</span><span>₹{form.rows.reduce((s,r)=>s+rowTotal(r),0).toLocaleString('en-IN',{maximumFractionDigits:2})}</span></div>
                  </div>
                </div>
                <div style={{ padding:'10px 20px', borderTop:'1px solid var(--gray-100)', display:'flex', justifyContent:'flex-end', gap:8 }}>
                  <button className="od-btn" style={{ padding:'6px 12px', fontSize:12 }} onClick={() => setShowForm(false)}>Cancel</button>
                  <button className="od-btn od-btn-primary" style={{ padding:'6px 12px', fontSize:12 }} onClick={saveQuote} disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save Revision' : 'Save Quote'}</button>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
