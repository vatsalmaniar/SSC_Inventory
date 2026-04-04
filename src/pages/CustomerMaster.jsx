import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'

export default function CustomerMaster() {
  const navigate = useNavigate()
  const location = useLocation()
  const [customers, setCustomers] = useState([])
  const [loading, setLoading]     = useState(true)

  const [searching, setSearching] = useState(false)
  const [search, setSearch]       = useState('')
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const debounceRef = useRef(null)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  useEffect(() => {
    const q = new URLSearchParams(location.search).get('search')
    if (q) handleSearch(q)
  }, [location.search])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }

    const { data, count } = await sb.from('customers').select('id,customer_id,customer_name,account_owner,gst,credit_terms', { count: 'exact' }).order('customer_name').range(0, PAGE_SIZE - 1)

    setCustomers(data || [])
    setTotal(count || 0)
    setLoading(false)
  }

  async function fetchPage(p) {
    setLoading(true)
    const from = (p - 1) * PAGE_SIZE
    const { data, count } = await sb.from('customers')
      .select('id,customer_id,customer_name,account_owner,gst,credit_terms', { count: 'exact' })
      .order('customer_name')
      .range(from, from + PAGE_SIZE - 1)
    setCustomers(data || [])
    if (count !== null) setTotal(count)
    setPage(p)
    setLoading(false)
  }


  function handleSearch(val) {
    setSearch(val)
    setPage(1)
    clearTimeout(debounceRef.current)
    if (!val.trim()) {
      setSearching(false)
      fetchPage(1)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      const q = val.trim()
      const { data, count } = await sb.from('customers')
        .select('id,customer_id,customer_name,account_owner,gst,credit_terms', { count: 'exact' })
        .or(`customer_name.ilike.%${q}%,gst.ilike.%${q}%,account_owner.ilike.%${q}%`)
        .order('customer_name')
        .limit(1000)
      setCustomers(data || [])
      setTotal(count || 0)
      setSearching(false)
    }, 300)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = search.trim() ? customers.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : customers

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
                <div className="od-header-num">
                  {search.trim() ? `${customers.length} results` : `${total} accounts`}
                </div>

              </div>
            </div>
          </div>

          {/* Search */}
          <div style={{ marginBottom: 16, position: 'relative', maxWidth: 400 }}>
            <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)', width:15, height:15 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              style={{ width:'100%', padding:'9px 12px 9px 34px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', outline:'none', background:'white', boxSizing:'border-box' }}
              placeholder="Search by name or GST..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              autoFocus
            />
            {searching && (
              <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}>
                <div className="loading-spin" style={{ width:14, height:14 }}/>
              </div>
            )}
          </div>

          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>Loading...
            </div>
          ) : (
            <div className="od-card">
              <table className="od-items-table">
                <thead>
                  <tr>
                    <th>Cust ID</th>
                    <th>Customer Name</th>
                    <th>Account Owner</th>
                    <th>GST Number</th>
                    <th>Credit Terms</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map(c => (
                    <tr key={c.id} onClick={() => navigate('/customers/' + c.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:12, color:'var(--gray-500)' }}>{c.customer_id || '—'}</td>
                      <td><div style={{ fontWeight:600, color:'var(--gray-900)' }}>{c.customer_name}</div></td>
                      <td>
                        {c.account_owner
                          ? <OwnerChip name={c.account_owner} />
                          : <span style={{ color:'var(--gray-300)' }}>—</span>}
                      </td>
                      <td className="mono" style={{ fontSize:12 }}>{c.gst || '—'}</td>
                      <td>
                        {c.credit_terms
                          ? <CreditTag term={c.credit_terms} />
                          : <span style={{ color:'var(--gray-300)' }}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {customers.length === 0 && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)' }}>
                  No customers found{search.trim() ? ` for "${search}"` : ''}
                </div>
              )}
              {customers.length > 0 && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--gray-100)', flexWrap:'wrap', gap:8 }}>
                  <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                    Showing {total === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, total)} of {total} customers
                  </span>
                  <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                    <button onClick={() => { if (!search.trim()) fetchPage(safePage - 1); else setPage(p => Math.max(1, p - 1)) }} disabled={safePage === 1}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === 1 ? 'default' : 'pointer', color: safePage === 1 ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>‹</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                      const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                      const ellipsis = !show && Math.abs(p - safePage) === 2
                      if (ellipsis) return <span key={p} style={{ padding:'0 4px', color:'var(--gray-400)', fontSize:13 }}>…</span>
                      if (!show) return null
                      return <button key={p} onClick={() => { if (!search.trim()) fetchPage(p); else setPage(p) }}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor: p === safePage ? '#1a4dab' : 'var(--gray-200)', background: p === safePage ? '#1a4dab' : 'white', color: p === safePage ? 'white' : 'var(--gray-700)', fontWeight: p === safePage ? 700 : 400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{p}</button>
                    })}
                    <button onClick={() => { if (!search.trim()) fetchPage(safePage + 1); else setPage(p => Math.min(totalPages, p + 1)) }} disabled={safePage === totalPages}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === totalPages ? 'default' : 'pointer', color: safePage === totalPages ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>›</button>
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
  const style = CREDIT_COLORS[term] || { bg:'#f1f5f9', color:'#475569' }
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:style.bg, color:style.color, letterSpacing:'0.2px' }}>
      {term}
    </span>
  )
}

const AVATAR_COLORS = [
  '#5c6bc0', // muted indigo
  '#0d9488', // teal
  '#059669', // emerald
  '#b45309', // amber
  '#7c3aed', // violet
  '#be185d', // rose
  '#0369a1', // sky
  '#475569', // slate
  '#c2410c', // burnt orange
  '#4f7942', // sage green
]

function ownerColor(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function OwnerChip({ name }) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const color = ownerColor(name)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:color, color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        {initials}
      </div>
      <span style={{ fontSize:12, fontWeight:500, color:'var(--gray-800)' }}>{name}</span>
    </div>
  )
}
