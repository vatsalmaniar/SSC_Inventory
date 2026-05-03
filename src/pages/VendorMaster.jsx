import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const PAGE_SIZE = 50
const TYPE_OPTIONS = ['Manufacturer','Distributor','Agent']
const STATUS_OPTIONS = ['active','inactive']
const TYPE_COLORS = { Manufacturer:'#1E54B7', Distributor:'#22C55E', Agent:'#0F766E' }
const STATUS_COLORS = { active:'#22C55E', inactive:'#EF4444' }

export default function VendorMaster() {
  const navigate = useNavigate()
  const [vendors, setVendors] = useState([])
  const [pending, setPending] = useState([])
  const [tab, setTab] = useState('approved')
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [testMode, setTestMode] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || 'sales')
    if (profile?.role === 'admin') {
      const { data: pend } = await sb.from('vendors').select('id,vendor_code,vendor_name,vendor_type,poc_name,created_at')
        .eq('approval_status', 'pending').order('created_at', { ascending: false })
      setPending(pend || [])
    }
    await loadVendors({ p: 1 })
    setLoading(false)
  }

  async function loadVendors(opts = {}) {
    const p = opts.p ?? page
    const q = opts.q ?? search
    const type = opts.type ?? filterType
    const stat = opts.stat ?? filterStatus
    const test = opts.test ?? testMode
    if (!opts.silent) setLoading(true)
    let query = sb.from('vendors')
      .select('id,vendor_code,vendor_name,vendor_type,poc_name,poc_phone,status,credit_terms,created_at', { count:'exact' })
      .eq('is_test', test).eq('approval_status', 'approved').order('vendor_name')
    if (q.trim()) query = query.or(`vendor_name.ilike.%${q.trim()}%,vendor_code.ilike.%${q.trim()}%,gst.ilike.%${q.trim()}%`)
    if (type) query = query.eq('vendor_type', type)
    if (stat) query = query.eq('status', stat)
    const from = (p - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)
    const { data, count } = await query
    setVendors(data || []); setTotal(count || 0); setPage(p); setLoading(false); setSearching(false)
  }

  function handleSearch(val) {
    setSearch(val); setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadVendors({ q: val, p: 1 }), 300)
  }
  function applyFilter(key, val) {
    const updates = { type: filterType, stat: filterStatus, [key]: val }
    if (key === 'type') setFilterType(val)
    if (key === 'stat') setFilterStatus(val)
    loadVendors({ p: 1, ...updates })
  }
  function clearFilters() { setFilterType(''); setFilterStatus(''); loadVendors({ p: 1, type: '', stat: '' }) }

  const hasFilters = filterType || filterStatus
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const list = tab === 'pending' ? pending : vendors

  return (
    <Layout pageTitle="Vendor 360" pageKey="vendor360">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Vendor 360</h1>
            <div className="o-summary">
              <span><b>{total}</b> vendor{total !== 1 ? 's' : ''}</span>
              <span className="o-sep">·</span>
              <span>Vendor Directory</span>
            </div>
          </div>
          <div className="page-meta">
            {userRole === 'admin' && pending.length > 0 && (
              <button className={`o-test-toggle ${tab === 'pending' ? 'on' : ''}`} onClick={() => setTab(t => t === 'pending' ? 'approved' : 'pending')}>
                <span style={{ background:'#F59E0B', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{pending.length}</span>
                Pending Approval
              </button>
            )}
            {userRole === 'admin' && (
              <label className={`o-test-toggle ${testMode ? 'on' : ''}`}>
                <input type="checkbox" checked={testMode} onChange={e => { setTestMode(e.target.checked); loadVendors({ test: e.target.checked, p: 1 }) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <button className="btn-primary" onClick={() => navigate('/vendors/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Vendor
            </button>
          </div>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by name, code, GST, owner…" value={search} onChange={e => handleSearch(e.target.value)}/>
            {search && (
              <button className="o-search-clear" onClick={() => { setSearch(''); loadVendors({ q: '', p: 1 }) }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <select className="filt-select" value={filterType} onChange={e => applyFilter('type', e.target.value)}>
            <option value="">Type: All</option>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="filt-select" value={filterStatus} onChange={e => applyFilter('stat', e.target.value)}>
            <option value="">Status: All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          {hasFilters && <button className="opps-clear" onClick={clearFilters}>Clear</button>}
        </div>

        {loading && !list.length ? (
          <div className="o-loading">Loading vendors…</div>
        ) : tab === 'pending' ? (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px minmax(0, 1fr) 120px' }}>
              <div>Code</div>
              <div>Vendor Name</div>
              <div>Type</div>
              <div>Contact</div>
              <div>Created</div>
            </div>
            {pending.length === 0 ? (
              <div className="ol-empty"><div className="ol-empty-title">No pending approvals</div></div>
            ) : (
              <div className="ol-table">
                {pending.map(v => (
                  <div key={v.id} className="ol-row ol-data" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px minmax(0, 1fr) 120px' }} onClick={() => navigate('/vendors/' + v.id)}>
                    <div className="ol-cell ol-num" style={{ fontSize: 12 }}>{v.vendor_code}</div>
                    <div className="ol-cell ol-cust" style={{ fontWeight: 500 }}>{v.vendor_name}</div>
                    <div className="ol-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': TYPE_COLORS[v.vendor_type] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>{v.vendor_type || '—'}
                      </span>
                    </div>
                    <div className="ol-cell" style={{ fontSize: 12.5 }}>{v.poc_name || '—'}</div>
                    <div className="ol-cell ol-date">{v.created_at ? new Date(v.created_at).toLocaleDateString('en-IN') : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px minmax(0, 1fr) 130px 110px' }}>
              <div>Code</div>
              <div>Vendor Name</div>
              <div>Type</div>
              <div>Contact</div>
              <div>Credit Terms</div>
              <div className="num">Status</div>
            </div>
            {!vendors.length ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No vendors found{search.trim() ? ` for "${search}"` : ''}</div>
              </div>
            ) : (
              <div className="ol-table">
                {vendors.map(v => (
                  <div key={v.id} className="ol-row ol-data" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px minmax(0, 1fr) 130px 110px' }} onClick={() => navigate('/vendors/' + v.id)}>
                    <div className="ol-cell ol-num" style={{ fontSize: 12 }}>{v.vendor_code}</div>
                    <div className="ol-cell ol-cust" style={{ fontWeight: 500 }}>{v.vendor_name}</div>
                    <div className="ol-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': TYPE_COLORS[v.vendor_type] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>{v.vendor_type || '—'}
                      </span>
                    </div>
                    <div className="ol-cell">
                      <div style={{ fontSize: 12.5, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{v.poc_name || '—'}</div>
                      {v.poc_phone && <div className="ol-date-sub">{v.poc_phone}</div>}
                    </div>
                    <div className="ol-cell" style={{ fontSize: 12, color: 'var(--o-muted)' }}>{v.credit_terms || '—'}</div>
                    <div className="ol-cell ol-status-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': STATUS_COLORS[v.status] || '#94A3B8' }}>
                        <span className="ol-status-dot"/>
                        {v.status ? v.status.charAt(0).toUpperCase()+v.status.slice(1) : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {total > PAGE_SIZE && (
              <div className="ol-foot">
                <span>Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => loadVendors({ p: page-1 })} disabled={page === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1
                    const ellipsis = !show && Math.abs(p - page) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === page ? 'on' : ''}`} onClick={() => loadVendors({ p })}>{p}</button>
                    if (ellipsis) return <span key={'e'+p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => loadVendors({ p: page+1 })} disabled={page === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
