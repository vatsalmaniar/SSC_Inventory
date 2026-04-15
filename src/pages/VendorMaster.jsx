import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/orders.css'

const PAGE_SIZE = 50
const TYPE_OPTIONS   = ['Manufacturer','Distributor','Agent']
const STATUS_OPTIONS = ['active','inactive']

const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(name) { let h=0; for(let i=0;i<name.length;i++) h=name.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function OwnerChip({ name }) {
  if (!name) return <span style={{ color:'var(--gray-300)' }}>—</span>
  const ini = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ width:28, height:28, borderRadius:'50%', background:ownerColor(name), color:'white', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{ini}</div>
      <span style={{ fontSize:12, fontWeight:500, color:'var(--gray-800)' }}>{name}</span>
    </div>
  )
}

function StatusBadge({ status }) {
  const active = status === 'active'
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background: active ? '#f0fdf4' : '#fef2f2', color: active ? '#15803d' : '#dc2626' }}>{active ? 'Active' : 'Inactive'}</span>
}

function TypeBadge({ type }) {
  if (!type) return <span style={{ color:'var(--gray-300)' }}>—</span>
  const c = type === 'Manufacturer' ? { bg:'#eff6ff', color:'#1d4ed8' } : type === 'Distributor' ? { bg:'#f0fdf4', color:'#15803d' } : { bg:'#faf5ff', color:'#7e22ce' }
  return <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600, background:c.bg, color:c.color }}>{type}</span>
}

export default function VendorMaster() {
  const navigate = useNavigate()
  const [vendors, setVendors]   = useState([])
  const [pending, setPending]   = useState([])
  const [tab, setTab]           = useState('approved')
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [filterType, setFilterType]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [testMode, setTestMode]         = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || 'sales')
    // Load pending vendors for admin
    if (profile?.role === 'admin') {
      const { data: pend } = await sb.from('vendors').select('id,vendor_code,vendor_name,vendor_type,poc_name,created_at')
        .eq('approval_status', 'pending').order('created_at', { ascending: false })
      setPending(pend || [])
    }
    await loadVendors({ p: 1 })
    setLoading(false)
  }

  async function loadVendors(opts = {}) {
    const p    = opts.p    ?? page
    const q    = opts.q    ?? search
    const type = opts.type ?? filterType
    const stat = opts.stat ?? filterStatus
    const test = opts.test ?? testMode

    if (!opts.silent) setLoading(true)
    let query = sb.from('vendors')
      .select('id,vendor_code,vendor_name,vendor_type,poc_name,poc_phone,status,credit_terms,created_at', { count:'exact' })
      .eq('is_test', test)
      .eq('approval_status', 'approved')
      .order('vendor_name')

    if (q.trim()) query = query.or(`vendor_name.ilike.%${q.trim()}%,vendor_code.ilike.%${q.trim()}%,gst.ilike.%${q.trim()}%`)
    if (type) query = query.eq('vendor_type', type)
    if (stat) query = query.eq('status', stat)

    const from = (p - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)

    const { data, count } = await query
    setVendors(data || [])
    setTotal(count || 0)
    setPage(p)
    setLoading(false)
    setSearching(false)
  }

  function handleSearch(val) {
    setSearch(val)
    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadVendors({ q: val, p: 1 }), 300)
  }

  function applyFilter(key, val) {
    const updates = { type: filterType, stat: filterStatus, [key]: val }
    if (key === 'type') setFilterType(val)
    if (key === 'stat') setFilterStatus(val)
    loadVendors({ p: 1, ...updates })
  }

  function clearFilters() {
    setFilterType(''); setFilterStatus('')
    loadVendors({ p: 1, type: '', stat: '' })
  }

  const hasFilters = filterType || filterStatus
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const SEL = { padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:12, fontFamily:'var(--font)', background:'white', color:'var(--gray-700)', cursor:'pointer', outline:'none' }

  return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="od-page">
        <div className="od-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Vendor Directory</div>
                <div className="od-header-title">Vendor 360</div>
                <div className="od-header-num">{total} vendor{total !== 1 ? 's' : ''}</div>
              </div>
              <div className="od-header-actions">
                {userRole === 'admin' && pending.length > 0 && (
                  <button onClick={() => setTab(t => t === 'pending' ? 'approved' : 'pending')}
                    style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid #fde68a', background: tab === 'pending' ? '#fef3c7' : 'white', color:'#92400e', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
                    <span style={{ background:'#f59e0b', color:'white', borderRadius:'50%', width:18, height:18, fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{pending.length}</span>
                    Pending Approval
                  </button>
                )}
                {userRole === 'admin' && (
                  <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color: testMode ? '#b45309' : 'var(--gray-500)', fontWeight: testMode ? 600 : 400, background: testMode ? '#fef3c7' : 'transparent', border: testMode ? '1px solid #fde68a' : '1px solid var(--gray-200)', borderRadius:8, padding:'6px 12px', transition:'all 0.15s' }}>
                    <input type="checkbox" checked={testMode} onChange={e => { setTestMode(e.target.checked); loadVendors({ test: e.target.checked, p: 1 }) }} style={{ accentColor:'#b45309', width:13, height:13 }} />
                    Test Mode
                  </label>
                )}
                <button className="new-order-btn" onClick={() => navigate('/vendors/new')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Vendor
                </button>
              </div>
            </div>
          </div>

          {/* Search + Filters */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:16, alignItems:'center' }}>
            <div style={{ position:'relative', flex:'1 1 220px', maxWidth:340 }}>
              <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)', width:15, height:15, pointerEvents:'none' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', outline:'none', background:'white', boxSizing:'border-box' }}
                placeholder="Search by name, code, GST, owner..."
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
              {searching && <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}><div className="loading-spin" style={{ width:14, height:14 }}/></div>}
            </div>

            <select value={filterType} onChange={e => applyFilter('type', e.target.value)} style={{ ...SEL, minWidth:130 }}>
              <option value="">Vendor Type</option>
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            <select value={filterStatus} onChange={e => applyFilter('stat', e.target.value)} style={{ ...SEL, minWidth:120 }}>
              <option value="">Status</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select>

            {hasFilters && (
              <button onClick={clearFilters} style={{ padding:'7px 12px', borderRadius:8, border:'1px solid var(--gray-200)', background:'white', color:'var(--gray-500)', fontSize:12, cursor:'pointer', fontFamily:'var(--font)', whiteSpace:'nowrap' }}>
                Clear filters
              </button>
            )}
          </div>

          {/* Active filter pills */}
          {hasFilters && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
              {filterType && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:600 }}>{filterType} <button onClick={() => applyFilter('type', '')} style={{ background:'none', border:'none', color:'#1d4ed8', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterStatus && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background: filterStatus === 'active' ? '#f0fdf4' : '#fef2f2', color: filterStatus === 'active' ? '#15803d' : '#dc2626', fontSize:11, fontWeight:600 }}>{filterStatus.charAt(0).toUpperCase()+filterStatus.slice(1)} <button onClick={() => applyFilter('stat', '')} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              <span style={{ fontSize:11, color:'var(--gray-400)', alignSelf:'center' }}>{total} result{total !== 1 ? 's' : ''}</span>
            </div>
          )}

          {loading && !vendors.length ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:60, gap:10, color:'var(--gray-400)', fontSize:14 }}>
              <div className="loading-spin"/>Loading...
            </div>
          ) : tab === 'pending' ? (
            <div className="od-card">
              <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:13, fontWeight:600, color:'#92400e' }}>Pending Approval ({pending.length})</span>
              </div>
              <table className="od-items-table">
                <thead><tr><th>Code</th><th>Vendor Name</th><th>Type</th><th>Contact</th><th>Created</th></tr></thead>
                <tbody>
                  {pending.map(v => (
                    <tr key={v.id} onClick={() => navigate('/vendors/' + v.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:12, color:'var(--gray-500)' }}>{v.vendor_code}</td>
                      <td><span style={{ fontWeight:600, color:'var(--gray-900)' }}>{v.vendor_name}</span></td>
                      <td><TypeBadge type={v.vendor_type}/></td>
                      <td style={{ fontSize:13 }}>{v.poc_name || '—'}</td>
                      <td style={{ fontSize:12, color:'var(--gray-400)' }}>{v.created_at ? new Date(v.created_at).toLocaleDateString('en-IN') : '—'}</td>
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
                    <th>Code</th>
                    <th>Vendor Name</th>
                    <th>Type</th>
                    <th>Contact</th>
                    <th>Credit Terms</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id} onClick={() => navigate('/vendors/' + v.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:12, color:'var(--gray-500)' }}>{v.vendor_code}</td>
                      <td><span style={{ fontWeight:600, color:'var(--gray-900)' }}>{v.vendor_name}</span></td>
                      <td><TypeBadge type={v.vendor_type}/></td>
                      <td>
                        <div style={{ fontSize:13 }}>{v.poc_name || '—'}</div>
                        {v.poc_phone && <div style={{ fontSize:11, color:'var(--gray-400)' }}>{v.poc_phone}</div>}
                      </td>
                      <td style={{ fontSize:12, color:'var(--gray-500)' }}>{v.credit_terms || '—'}</td>
                      <td><StatusBadge status={v.status}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!vendors.length && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)' }}>
                  No vendors found{search.trim() ? ` for "${search}"` : ''}
                </div>
              )}

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--gray-100)', flexWrap:'wrap', gap:8 }}>
                  <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                    Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total}
                  </span>
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => loadVendors({ p: page-1 })} disabled={page===1}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:page===1?'default':'pointer', color:page===1?'var(--gray-300)':'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>‹</button>
                    {Array.from({ length: totalPages }, (_,i) => i+1).map(p => {
                      const show = totalPages <= 7 || p===1 || p===totalPages || Math.abs(p-page)<=1
                      const ellipsis = !show && Math.abs(p-page)===2
                      if (ellipsis) return <span key={p} style={{ padding:'0 4px', color:'var(--gray-400)', fontSize:13 }}>…</span>
                      if (!show) return null
                      return <button key={p} onClick={() => loadVendors({ p })}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor:p===page?'#1a4dab':'var(--gray-200)', background:p===page?'#1a4dab':'white', color:p===page?'white':'var(--gray-700)', fontWeight:p===page?700:400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{p}</button>
                    })}
                    <button onClick={() => loadVendors({ p: page+1 })} disabled={page===totalPages}
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
