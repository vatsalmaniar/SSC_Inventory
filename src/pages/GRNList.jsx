import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import FCSubNav from '../components/FCSubNav'
import '../styles/orders.css'

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }

const GRN_TYPE_LABELS = {
  po_inward: 'PO Inward', customer_rejection: 'Customer Rejection',
  sample_return: 'Sample Return', cancellation_return: 'Cancellation Return',
}
const GRN_STATUS_LABELS = {
  draft: 'GRN Created', checking: 'Checking', confirmed: 'Confirmed',
  invoice_matched: 'Invoice Matched', inward_posted: 'Inward Posted',
}

function statusLabel(s) { return GRN_STATUS_LABELS[s] || s }
function typeLabel(t)   { return GRN_TYPE_LABELS[t] || t }

const FILTERS = [
  { key: 'all',      label: 'All GRNs' },
  { key: 'draft',    label: 'GRN Created' },
  { key: 'checking', label: 'Checking' },
  { key: 'confirmed',label: 'Confirmed' },
  { key: 'invoice_matched', label: 'Invoice Matched' },
  { key: 'inward_posted',   label: 'Inward Posted' },
]

const TYPE_FILTERS = [
  { key: 'all',                  label: 'All Types' },
  { key: 'po_inward',            label: 'PO Inward' },
  { key: 'customer_rejection',   label: 'Customer Rejection' },
  { key: 'sample_return',        label: 'Sample Return' },
  { key: 'cancellation_return',  label: 'Cancellation Return' },
]

const PAGE_SIZE = 50

export default function GRNList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [grns, setGrns]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','fc_kaveri','fc_godawari'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadGrns()
  }

  async function loadGrns() {
    setLoading(true)
    const { data, error } = await sb.from('grn')
      .select('*')
      .eq('is_test', false)
      .gte('created_at', FY_START)
      .order('received_at', { ascending: false })
    if (error) console.error('GRN error:', error)
    setGrns(data || [])
    setLoading(false)
  }

  function matchFilter(g, f) {
    if (f === 'all') return true
    return g.status === f
  }

  function matchType(g, t) {
    if (t === 'all') return true
    return g.grn_type === t
  }

  const counts = FILTERS.reduce((acc, { key }) => {
    acc[key] = grns.filter(g => matchFilter(g, key) && matchType(g, typeFilter)).length
    return acc
  }, {})

  const q = search.trim().toLowerCase()
  const filtered = grns
    .filter(g => matchFilter(g, filter))
    .filter(g => matchType(g, typeFilter))
    .filter(g => !q || g.grn_number?.toLowerCase().includes(q) || g.vendor_name?.toLowerCase().includes(q) || g.invoice_number?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Layout pageTitle="Goods Receipt Notes" pageKey="fc">
      <FCSubNav active="grn" />
    <div className="od-list-page">
      <div className="od-list-body">

        {/* Header */}
        <div className="od-list-header">
          <div>
            <div className="od-list-title">Goods Receipt Notes</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="new-order-btn" onClick={() => navigate('/fc/grn/new')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New GRN
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="od-stat-grid">
          <div className="od-stat-card od-stat-blue">
            <div className="od-stat-card-top">
              <div className="od-stat-label">{FILTERS.find(f => f.key === filter)?.label || 'GRNs'}</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{filtered.length}</div>
            <div className="od-stat-sub">matching GRNs</div>
          </div>
          <div className="od-stat-card od-stat-navy">
            <div className="od-stat-card-top">
              <div className="od-stat-label">Total Value</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>
              </div>
            </div>
            <div className="od-stat-val" style={{ fontSize: 26 }}>
              {(() => { const s = filtered.reduce((sum, g) => sum + (g.total_amount || 0), 0); return s >= 1e7 ? '₹'+(s/1e7).toFixed(2)+' Cr' : s >= 1e5 ? '₹'+(s/1e5).toFixed(1)+'L' : '₹'+s.toLocaleString('en-IN',{maximumFractionDigits:0}) })()}
            </div>
            <div className="od-stat-sub">across filtered GRNs</div>
          </div>
          <div className="od-stat-card od-stat-amber" onClick={() => { setFilter('draft'); setPage(1) }} style={{ cursor:'pointer' }}>
            <div className="od-stat-card-top">
              <div className="od-stat-label">Pending</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{grns.filter(g => (g.status === 'draft' || g.status === 'checking') && matchType(g, typeFilter)).length}</div>
            <div className="od-stat-sub">created + checking</div>
          </div>
          <div className="od-stat-card od-stat-green" onClick={() => { setFilter('confirmed'); setPage(1) }} style={{ cursor:'pointer' }}>
            <div className="od-stat-card-top">
              <div className="od-stat-label">Confirmed</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{grns.filter(g => g.status === 'confirmed' && matchType(g, typeFilter)).length}</div>
            <div className="od-stat-sub">confirmed GRNs</div>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="od-list-controls">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%' }}>
            <div className="od-search-wrap">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                className="od-search-input"
                placeholder="Search GRN number, vendor, invoice..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1) }}
              />
              {search && (
                <button className="od-search-clear" onClick={() => setSearch('')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            {/* Type toggle */}
            <div style={{ display:'flex', borderRadius:8, border:'1px solid var(--gray-200)', overflow:'hidden', background:'#f9fafb', flexShrink:0 }}>
              {TYPE_FILTERS.map(({ key, label }) => (
                <button key={key} onClick={() => { setTypeFilter(key); setPage(1) }}
                  style={{ padding:'6px 12px', fontSize:12, fontWeight: typeFilter === key ? 700 : 400, background: typeFilter === key ? 'white' : 'transparent', color: typeFilter === key ? 'var(--gray-900)' : 'var(--gray-500)', border:'none', cursor:'pointer', fontFamily:'var(--font)', boxShadow: typeFilter === key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', margin: typeFilter === key ? 2 : 0, borderRadius: typeFilter === key ? 6 : 0, whiteSpace:'nowrap' }}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="filter-bar" style={{ margin:0, padding:0 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'draft' ? ' filter-chip-warn' : '')}
                onClick={() => { setFilter(key); setPage(1) }}
              >
                {label}{counts[key] > 0 ? ` (${counts[key]})` : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="od-table-card">
          {loading ? (
            <div className="loading-state" style={{ padding:40 }}><div className="loading-spin"/>Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="orders-empty" style={{ border:'none' }}>
              <div className="orders-empty-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/>
                </svg>
              </div>
              <div className="orders-empty-title">No GRNs found</div>
              <div className="orders-empty-sub">{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="orders-table-wrap" style={{ border:'none', borderRadius:0 }}>
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>GRN #</th>
                      <th>Vendor / Source</th>
                      <th>Type</th>
                      <th>Centre</th>
                      <th>Received By</th>
                      <th>Invoice #</th>
                      <th>Date</th>
                      <th style={{ textAlign:'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(g => (
                      <tr key={g.id} onClick={() => navigate('/fc/grn/' + g.id)}>
                        <td className="order-num-cell">
                          {g.grn_number}
                          {g.grn_type !== 'po_inward' && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background: g.grn_type === 'customer_rejection' ? '#fee2e2' : g.grn_type === 'sample_return' ? '#f3e8ff' : '#fef3c7',color: g.grn_type === 'customer_rejection' ? '#dc2626' : g.grn_type === 'sample_return' ? '#7e22ce' : '#b45309',borderRadius:3,padding:'1px 5px',letterSpacing:'0.5px',verticalAlign:'middle'}}>{typeLabel(g.grn_type).toUpperCase()}</span>}
                        </td>
                        <td className="customer-cell">{g.vendor_name || '—'}</td>
                        <td style={{ fontSize:12, color:'var(--gray-600)' }}>{typeLabel(g.grn_type)}</td>
                        <td style={{ fontSize:12, color:'var(--gray-500)' }}>{g.fulfilment_center || '—'}</td>
                        <td><OwnerChip name={g.received_by} /></td>
                        <td style={{ fontSize:12, fontFamily:'var(--mono)', color:'var(--gray-500)' }}>{g.invoice_number || '—'}</td>
                        <td>{fmt(g.received_at || g.created_at)}</td>
                        <td className="status-cell">
                          <span className={'pill pill-' + g.status}>{statusLabel(g.status)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile cards */}
              <div style={{ padding:'0 4px 4px' }}>
                {paginated.map((g, i) => (
                  <div key={g.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/fc/grn/' + g.id)}>
                    <div className="order-card-top">
                      <div>
                        <div className="order-num">
                          {g.grn_number}
                          {g.grn_type !== 'po_inward' && <span style={{marginLeft:6,fontSize:9,fontWeight:700,background:'#e0e7ff',color:'#3730a3',borderRadius:3,padding:'1px 5px',letterSpacing:'0.5px',verticalAlign:'middle'}}>{typeLabel(g.grn_type).toUpperCase()}</span>}
                        </div>
                        <div className="order-customer">{g.vendor_name || '—'}</div>
                        <div className="order-date" style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>{fmt(g.received_at || g.created_at)} · <OwnerChip name={g.received_by} /></div>
                      </div>
                      <span className={'pill pill-' + g.status}>{statusLabel(g.status)}</span>
                    </div>
                    <div className="order-card-bottom">
                      <span className="order-items-count">{typeLabel(g.grn_type)}</span>
                      <span className="order-total">{g.fulfilment_center || '—'}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--gray-100)', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                  Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} GRNs
                </span>
                <div style={{ display:'flex', gap:4 }}>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === 1 ? 'default' : 'pointer', color: safePage === 1 ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}
                  >‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return (
                      <button key={p} onClick={() => setPage(p)}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor: p === safePage ? '#1a4dab' : 'var(--gray-200)', background: p === safePage ? '#1a4dab' : 'white', color: p === safePage ? 'white' : 'var(--gray-700)', fontWeight: p === safePage ? 700 : 400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}
                      >{p}</button>
                    )
                    if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 2px', color:'var(--gray-400)', fontSize:13, lineHeight:'28px' }}>…</span>
                    return null
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor: safePage === totalPages ? 'default' : 'pointer', color: safePage === totalPages ? 'var(--gray-300)' : 'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}
                  >Next ›</button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>
    </div>
    </Layout>
  )
}
