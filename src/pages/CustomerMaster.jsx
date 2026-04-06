import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

const PAGE_SIZE = 50

const CREDIT_OPTIONS = ['Against PI','Against Delivery','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days']
const TYPE_OPTIONS   = ['OEM','Panel Builder','End User','Trader']

const CREDIT_COLORS = {
  'Against PI':       { bg:'#f1f5f9', color:'#475569' },
  'Against Delivery': { bg:'#fdf2f8', color:'#9d174d' },
  '7 Days':           { bg:'#fff7ed', color:'#c2410c' },
  '15 Days':          { bg:'#fffbeb', color:'#b45309' },
  '30 Days':          { bg:'#f0fdf4', color:'#15803d' },
  '45 Days':          { bg:'#f0fdfa', color:'#0f766e' },
  '60 Days':          { bg:'#e8f2fc', color:'#1a4dab' },
  '75 Days':          { bg:'#eef2ff', color:'#4338ca' },
  '90 Days':          { bg:'#faf5ff', color:'#7e22ce' },
}
function CreditTag({ term }) {
  const s = CREDIT_COLORS[term] || { bg:'#f1f5f9', color:'#475569' }
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:s.bg, color:s.color }}>{term}</span>
}

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function OwnerChip({ name }) {
  const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(name), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
      <span style={{ fontSize:12, fontWeight:500, color:'var(--gray-800)' }}>{name}</span>
    </div>
  )
}

// Customers added from the new onboarding form launch date onwards are "New"
const NEW_CUSTOMER_FLOOR = '2026-04-06'

function isNewCustomer(created_at) {
  if (!created_at) return false
  return created_at >= NEW_CUSTOMER_FLOOR
}

export default function CustomerMaster() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [customers, setCustomers] = useState([])
  const [pending, setPending]     = useState([])
  const [userRole, setUserRole]   = useState('')
  const [reps, setReps]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('approved')
  const [submitted, setSubmitted] = useState(location.state?.submitted || false)

  const [search, setSearch]       = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)

  // Filters
  const [filterNew,   setFilterNew]   = useState(false)
  const [filterTerms, setFilterTerms] = useState('')
  const [filterRep,   setFilterRep]   = useState('')
  const [filterType,  setFilterType]  = useState('')

  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('search')
    if (q) { setSearch(q); loadCustomers({ q, p:1 }) }
  }, [location.search])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUserRole(role)

    const { data: repData } = await sb.from('profiles').select('name').in('role',['sales','ops','admin']).order('name')
    setReps((repData || []).map(r => r.name))

    if (role === 'admin') {
      const { data: pend } = await sb.from('customers')
        .select('id,customer_id,customer_name,account_owner,gst,credit_terms,created_at')
        .eq('approval_status', 'pending').order('created_at', { ascending: false })
      setPending(pend || [])
    }

    await loadCustomers({ p:1 })
    setLoading(false)
  }

  async function loadCustomers(opts = {}) {
    const p     = opts.p     ?? page
    const q     = opts.q     ?? search
    const fnew  = opts.fnew  ?? filterNew
    const terms = opts.terms ?? filterTerms
    const rep   = opts.rep   ?? filterRep
    const type  = opts.type  ?? filterType

    setLoading(true)
    let query = sb.from('customers')
      .select('id,customer_id,customer_name,account_owner,gst,credit_terms,customer_type,created_at', { count:'exact' })
      .eq('approval_status', 'approved')
      .order('customer_name')

    if (q.trim()) query = query.or(`customer_name.ilike.%${q.trim()}%,gst.ilike.%${q.trim()}%,account_owner.ilike.%${q.trim()}%`)
    if (fnew)  query = query.gte('created_at', NEW_CUSTOMER_FLOOR)
    if (terms) query = query.eq('credit_terms', terms)
    if (rep)   query = query.ilike('account_owner', rep)
    if (type)  query = query.eq('customer_type', type)

    const from = (p - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)

    const { data, count } = await query
    setCustomers(data || [])
    setTotal(count || 0)
    setPage(p)
    setLoading(false)
    setSearching(false)
  }

  function handleSearch(val) {
    setSearch(val)
    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadCustomers({ q: val, p:1 }), 300)
  }

  function applyFilter(key, val) {
    const updates = { fnew: filterNew, terms: filterTerms, rep: filterRep, type: filterType, [key]: val }
    if (key === 'fnew')  setFilterNew(val)
    if (key === 'terms') setFilterTerms(val)
    if (key === 'rep')   setFilterRep(val)
    if (key === 'type')  setFilterType(val)
    loadCustomers({ p:1, ...updates })
  }

  function clearFilters() {
    setFilterNew(false); setFilterTerms(''); setFilterRep(''); setFilterType('')
    loadCustomers({ p:1, fnew:false, terms:'', rep:'', type:'' })
  }

  const hasFilters = filterNew || filterTerms || filterRep || filterType
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const SEL = { padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:12, fontFamily:'var(--font)', background:'white', color:'var(--gray-700)', cursor:'pointer', outline:'none' }

  return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Customer Directory</div>
                <div className="od-header-title">Customer 360</div>
                <div className="od-header-num">{total} accounts</div>
              </div>
              <div className="od-header-actions">
                {userRole === 'admin' && pending.length > 0 && (
                  <button onClick={() => setTab(t => t === 'pending' ? 'approved' : 'pending')}
                    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid #fde68a', background: tab === 'pending' ? '#fef3c7' : 'white', color:'#92400e', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                    <span style={{ background:'#f59e0b', color:'white', borderRadius:'50%', width:18, height:18, fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{pending.length}</span>
                    Pending Approval
                  </button>
                )}
                <button className="new-order-btn" onClick={() => navigate('/customers/new')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Customer
                </button>
              </div>
            </div>
          </div>

          {/* Submitted banner */}
          {submitted && (
            <div style={{ display:'flex', alignItems:'center', gap:10, background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 16px', marginBottom:16 }}>
              <svg fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18, flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>
              <div>
                <div style={{ fontSize:13, fontWeight:600, color:'#15803d' }}>Customer submitted for approval</div>
                <div style={{ fontSize:12, color:'#166534' }}>An admin will review and approve the new account.</div>
              </div>
              <button onClick={() => setSubmitted(false)} style={{ marginLeft:'auto', background:'none', border:'none', color:'#16a34a', cursor:'pointer', fontSize:16 }}>×</button>
            </div>
          )}

          {/* Search + Filters */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:16, alignItems:'center' }}>
            {/* Search */}
            <div style={{ position:'relative', flex:'1 1 220px', maxWidth:340 }}>
              <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)', width:15, height:15, pointerEvents:'none' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', outline:'none', background:'white', boxSizing:'border-box' }}
                placeholder="Search by name, GST, owner..."
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
              {searching && <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}><div className="loading-spin" style={{ width:14, height:14 }}/></div>}
            </div>

            {/* New Customer toggle */}
            <button
              onClick={() => applyFilter('fnew', !filterNew)}
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1.5px solid', borderColor: filterNew ? '#16a34a' : 'var(--gray-200)', background: filterNew ? '#f0fdf4' : 'white', color: filterNew ? '#15803d' : 'var(--gray-600)', fontSize:12, fontWeight: filterNew ? 700 : 500, cursor:'pointer', fontFamily:'var(--font)', whiteSpace:'nowrap' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background: filterNew ? '#16a34a' : 'var(--gray-300)', flexShrink:0 }}/>
              New Customer
            </button>

            {/* Payment Terms */}
            <select value={filterTerms} onChange={e => applyFilter('terms', e.target.value)} style={{ ...SEL, minWidth:130 }}>
              <option value="">Payment Terms</option>
              {CREDIT_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Customer Type */}
            <select value={filterType} onChange={e => applyFilter('type', e.target.value)} style={{ ...SEL, minWidth:130 }}>
              <option value="">Customer Type</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Sales Rep */}
            <select value={filterRep} onChange={e => applyFilter('rep', e.target.value)} style={{ ...SEL, minWidth:140 }}>
              <option value="">Sales Rep</option>
              {reps.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            {/* Clear filters */}
            {hasFilters && (
              <button onClick={clearFilters}
                style={{ padding:'7px 12px', borderRadius:8, border:'1px solid var(--gray-200)', background:'white', color:'var(--gray-500)', fontSize:12, cursor:'pointer', fontFamily:'var(--font)', whiteSpace:'nowrap' }}>
                Clear filters
              </button>
            )}
          </div>

          {/* Active filter pills */}
          {hasFilters && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
              {filterNew && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#f0fdf4', color:'#15803d', fontSize:11, fontWeight:600 }}>New Customers <button onClick={() => applyFilter('fnew', false)} style={{ background:'none', border:'none', color:'#16a34a', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterTerms && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#e8f2fc', color:'#1a4dab', fontSize:11, fontWeight:600 }}>{filterTerms} <button onClick={() => applyFilter('terms', '')} style={{ background:'none', border:'none', color:'#1a4dab', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterType && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#faf5ff', color:'#7e22ce', fontSize:11, fontWeight:600 }}>{filterType} <button onClick={() => applyFilter('type', '')} style={{ background:'none', border:'none', color:'#7e22ce', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterRep && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#fffbeb', color:'#b45309', fontSize:11, fontWeight:600 }}>{filterRep} <button onClick={() => applyFilter('rep', '')} style={{ background:'none', border:'none', color:'#b45309', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              <span style={{ fontSize:11, color:'var(--gray-400)', alignSelf:'center' }}>{total} result{total !== 1 ? 's' : ''}</span>
            </div>
          )}

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>Loading...
            </div>
          ) : tab === 'pending' ? (
            <div className="od-card" style={{ border:'1px solid #fde68a' }}>
              <div style={{ padding:'10px 16px', borderBottom:'1px solid #fde68a', background:'#fffbeb', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#92400e' }}>Pending Approval ({pending.length})</span>
                <button onClick={() => setTab('approved')} style={{ background:'none', border:'none', fontSize:12, color:'#b45309', cursor:'pointer', fontFamily:'var(--font)' }}>← Back to directory</button>
              </div>
              <table className="od-items-table">
                <thead>
                  <tr><th>Cust ID</th><th>Customer Name</th><th>Account Owner</th><th>GST Number</th><th>Submitted</th></tr>
                </thead>
                <tbody>
                  {pending.map(c => (
                    <tr key={c.id} onClick={() => navigate('/customers/' + c.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:12, color:'var(--gray-500)' }}>{c.customer_id || '—'}</td>
                      <td>
                        <div style={{ fontWeight:600, color:'var(--gray-900)' }}>{c.customer_name}</div>
                        <span style={{ fontSize:10, fontWeight:700, background:'#fef3c7', color:'#92400e', borderRadius:4, padding:'1px 6px' }}>Pending Approval</span>
                      </td>
                      <td>{c.account_owner ? <OwnerChip name={c.account_owner}/> : <span style={{ color:'var(--gray-300)' }}>—</span>}</td>
                      <td className="mono" style={{ fontSize:12 }}>{c.gst || '—'}</td>
                      <td style={{ fontSize:12, color:'var(--gray-500)' }}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pending.length === 0 && <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)' }}>No pending approvals</div>}
            </div>
          ) : (
            <div className="od-card">
              <table className="od-items-table">
                <thead>
                  <tr>
                    <th>Cust ID</th>
                    <th>Customer Name</th>
                    <th>Type</th>
                    <th>Account Owner</th>
                    <th>GST Number</th>
                    <th>Credit Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map(c => (
                    <tr key={c.id} onClick={() => navigate('/customers/' + c.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:12, color:'var(--gray-500)' }}>{c.customer_id || '—'}</td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                          <span style={{ fontWeight:600, color:'var(--gray-900)' }}>{c.customer_name}</span>
                          {isNewCustomer(c.created_at) && (
                            <span style={{ fontSize:10, fontWeight:700, background:'#f0fdf4', color:'#15803d', borderRadius:20, padding:'2px 7px', border:'1px solid #bbf7d0', whiteSpace:'nowrap' }}>New</span>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize:12, color:'var(--gray-500)' }}>{c.customer_type || '—'}</td>
                      <td>{c.account_owner ? <OwnerChip name={c.account_owner}/> : <span style={{ color:'var(--gray-300)' }}>—</span>}</td>
                      <td className="mono" style={{ fontSize:12 }}>{c.gst || '—'}</td>
                      <td>{c.credit_terms ? <CreditTag term={c.credit_terms}/> : <span style={{ color:'var(--gray-300)' }}>—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {customers.length === 0 && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)' }}>
                  No customers found{search.trim() ? ` for "${search}"` : ''}
                </div>
              )}

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--gray-100)', flexWrap:'wrap', gap:8 }}>
                  <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                    Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total}
                  </span>
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => loadCustomers({ p: page-1 })} disabled={page===1}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:page===1?'default':'pointer', color:page===1?'var(--gray-300)':'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>‹</button>
                    {Array.from({ length: totalPages }, (_,i) => i+1).map(p => {
                      const show = totalPages <= 7 || p===1 || p===totalPages || Math.abs(p-page)<=1
                      const ellipsis = !show && Math.abs(p-page)===2
                      if (ellipsis) return <span key={p} style={{ padding:'0 4px', color:'var(--gray-400)', fontSize:13 }}>…</span>
                      if (!show) return null
                      return <button key={p} onClick={() => loadCustomers({ p })}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor:p===page?'#1a4dab':'var(--gray-200)', background:p===page?'#1a4dab':'white', color:p===page?'white':'var(--gray-700)', fontWeight:p===page?700:400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{p}</button>
                    })}
                    <button onClick={() => loadCustomers({ p: page+1 })} disabled={page===totalPages}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:page===totalPages?'default':'pointer', color:page===totalPages?'var(--gray-300)':'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>›</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
