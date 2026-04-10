import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'
import BillingSubNav from '../components/BillingSubNav'
import '../styles/orders.css'

const STATUS_LABELS = {
  three_way_check: '3-Way Check',
  invoice_pending: 'Invoice Pending',
  inward_complete: 'Inward Complete',
}

function fmtINR(val) {
  if (!val) return '₹0'
  return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

function pillClass(s) {
  if (s === 'inward_complete') return 'pill pill-dispatched_fc'
  if (s === 'invoice_pending') return 'pill pill-waiting'
  return 'pill pill-goods_issued'
}

export default function PurchaseInvoiceList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('action')
  const [search, setSearch]     = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['accounts','ops','admin'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadInvoices()
  }

  async function loadInvoices() {
    setLoading(true)
    const { data } = await sb.from('purchase_invoices')
      .select('id, invoice_number, vendor_name, invoice_date, invoice_amount, gst_amount, total_amount, status, po_id, grn_id, created_at')
      .eq('is_test', false)
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  function matchFilter(inv) {
    const s = inv.status || 'three_way_check'
    if (filter === 'action')           return s === 'three_way_check'
    if (filter === 'invoice_pending')  return s === 'invoice_pending'
    if (filter === 'inward_complete')  return s === 'inward_complete'
    if (filter === 'all')              return true
    return s === filter
  }

  const counts = {
    action:           invoices.filter(i => (i.status || 'three_way_check') === 'three_way_check').length,
    invoice_pending:  invoices.filter(i => i.status === 'invoice_pending').length,
    inward_complete:  invoices.filter(i => i.status === 'inward_complete').length,
  }

  const q = search.trim().toLowerCase()
  const filtered = invoices.filter(matchFilter).filter(inv =>
    !q ||
    (inv.invoice_number || '').toLowerCase().includes(q) ||
    (inv.vendor_name || '').toLowerCase().includes(q)
  )

  const FILTERS = [
    { key: 'action',          label: '3-Way Check' },
    { key: 'invoice_pending', label: 'Invoice Pending' },
    { key: 'inward_complete', label: 'Inward Complete' },
    { key: 'all',             label: 'All' },
  ]

  return (
    <Layout pageTitle="Inward Billing" pageKey="billing">
      <BillingSubNav active="inward" />
      <div className="od-list-page">
        <div className="od-list-body">

          {/* Header */}
          <div className="od-list-header">
            <div className="od-list-title">Inward Billing — Purchase Invoices</div>
            <button className="od-btn" onClick={() => navigate('/billing')} style={{gap:6}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Dashboard
            </button>
          </div>

          {/* Summary */}
          <div className="od-stat-grid">
            <div className="od-stat-card od-stat-amber" onClick={() => setFilter('action')} style={{cursor:'pointer'}}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">3-Way Check</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.action}</div>
              <div className="od-stat-sub">verify PO · GRN · vendor invoice</div>
            </div>
            <div className="od-stat-card od-stat-blue" onClick={() => setFilter('invoice_pending')} style={{cursor:'pointer'}}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Invoice Pending</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.invoice_pending}</div>
              <div className="od-stat-sub">awaiting invoice entry</div>
            </div>
            <div className="od-stat-card od-stat-green" onClick={() => setFilter('inward_complete')} style={{cursor:'pointer'}}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Inward Complete</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{counts.inward_complete}</div>
              <div className="od-stat-sub">fully processed</div>
            </div>
            <div className="od-stat-card od-stat-teal" onClick={() => setFilter('all')} style={{cursor:'pointer'}}>
              <div className="od-stat-card-top">
                <div className="od-stat-label">Total</div>
                <div className="od-stat-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>
                </div>
              </div>
              <div className="od-stat-val">{invoices.length}</div>
              <div className="od-stat-sub">{FY_LABEL}</div>
            </div>
          </div>

          {/* Search + Filters */}
          <div className="od-list-controls">
            <div className="od-search-wrap">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="od-search-icon">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                className="od-search-input"
                placeholder="Search invoice number, vendor..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="od-search-clear" onClick={() => setSearch('')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}>
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            <div className="filter-bar" style={{margin:0,padding:0}}>
              {FILTERS.map(({ key, label }) => {
                const count = key === 'all' ? invoices.length : counts[key]
                return (
                  <button key={key}
                    className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'inward_complete' ? ' filter-chip-green' : '')}
                    onClick={() => setFilter(key)}>
                    {label}{count > 0 ? ` (${count})` : ''}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Table */}
          <div className="od-table-card">
            {loading ? (
              <div className="loading-state" style={{padding:40}}><div className="loading-spin"/>Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="orders-empty" style={{border:'none'}}>
                <div className="orders-empty-icon">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="orders-empty-title">No invoices here</div>
                <div className="orders-empty-sub">Nothing to show right now.</div>
              </div>
            ) : (
              <>
                <div className="orders-table-wrap" style={{border:'none',borderRadius:0}}>
                  <table className="orders-table">
                    <thead>
                      <tr>
                        <th>Invoice / Vendor</th>
                        <th>Invoice Date</th>
                        <th style={{textAlign:'right'}}>Amount</th>
                        <th style={{textAlign:'right'}}>GST</th>
                        <th style={{textAlign:'right'}}>Total</th>
                        <th style={{textAlign:'right'}}>Stage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(inv => (
                        <tr key={inv.id} onClick={() => navigate('/procurement/invoices/' + inv.id)}>
                          <td className="order-num-cell">
                            {inv.invoice_number ? (
                              <span style={{fontFamily:'var(--mono)',fontWeight:700,color: inv.status === 'inward_complete' ? '#166534' : '#1a4dab'}}>
                                {inv.invoice_number}
                              </span>
                            ) : (
                              <span style={{fontFamily:'var(--mono)',fontWeight:700,color:'#92400e'}}>
                                Pending
                                <span style={{marginLeft:6,fontSize:9,background:'#fef3c7',color:'#92400e',borderRadius:3,padding:'1px 5px',fontWeight:600}}>No Invoice</span>
                              </span>
                            )}
                            <div style={{fontSize:11,color:'var(--gray-500)',marginTop:2}}>{inv.vendor_name || '—'}</div>
                            <div style={{fontSize:10,color:'var(--gray-400)',fontFamily:'var(--mono)',marginTop:1}}>{fmt(inv.created_at)}</div>
                          </td>
                          <td>{inv.invoice_date ? fmt(inv.invoice_date) : '—'}</td>
                          <td className="amount-cell">{inv.invoice_amount ? fmtINR(inv.invoice_amount) : '—'}</td>
                          <td className="amount-cell">{inv.gst_amount ? fmtINR(inv.gst_amount) : '—'}</td>
                          <td className="amount-cell">{inv.total_amount ? fmtINR(inv.total_amount) : '—'}</td>
                          <td className="status-cell">
                            <span className={pillClass(inv.status)}>{STATUS_LABELS[inv.status] || inv.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{padding:'0 4px 4px'}}>
                  {filtered.map((inv, i) => (
                    <div key={inv.id} className="order-card" style={{animationDelay: i * 0.03 + 's'}} onClick={() => navigate('/procurement/invoices/' + inv.id)}>
                      <div className="order-card-top">
                        <div>
                          <div className="order-num" style={{fontFamily:'var(--mono)',color: inv.invoice_number ? (inv.status === 'inward_complete' ? '#166534' : '#1a4dab') : '#92400e'}}>
                            {inv.invoice_number || 'Pending'}
                            {!inv.invoice_number && <span style={{marginLeft:6,fontSize:9,background:'#fef3c7',color:'#92400e',borderRadius:3,padding:'1px 5px',fontWeight:600}}>No Invoice</span>}
                          </div>
                          <div className="order-customer">{inv.vendor_name || '—'}</div>
                          <div className="order-date">{inv.invoice_date ? fmt(inv.invoice_date) : fmt(inv.created_at)}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <span className={pillClass(inv.status)}>{STATUS_LABELS[inv.status] || inv.status}</span>
                        </div>
                      </div>
                      <div className="order-card-bottom">
                        <span className="order-items-count">{inv.invoice_amount ? `Amt: ${fmtINR(inv.invoice_amount)}` : 'No amount yet'}</span>
                        <span className="order-total">{inv.total_amount ? fmtINR(inv.total_amount) : '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </Layout>
  )
}
