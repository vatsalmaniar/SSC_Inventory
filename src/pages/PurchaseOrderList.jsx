import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import ProcSubNav from '../components/ProcSubNav'
import * as XLSX from 'xlsx'
import '../styles/orders.css'

const _OC = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function OwnerChip({name}) { if(!name) return <span style={{color:'var(--gray-300)'}}>—</span>; const ini=name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); return <div style={{display:'flex',alignItems:'center',gap:7,whiteSpace:'nowrap'}}><div style={{width:24,height:24,borderRadius:'50%',background:ownerColor(name),color:'white',fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{ini}</div><span style={{fontSize:12,fontWeight:500}}>{name}</span></div> }

const PO_STATUS_LABELS = {
  draft:'PO Created', pending_approval:'Pending Approval', approved:'PO Approved', placed:'Order Placed',
  acknowledged:'Acknowledgement', delivery_confirmation:'Delivery Confirmation',
  material_received:'Material Received', closed:'Closed', cancelled:'Cancelled',
}

function statusLabel(s) { return PO_STATUS_LABELS[s] || s }

function pillStatus(po) { return po.status }

function poValue(po) { return po.total_amount || 0 }

const FILTERS = [
  { key: 'all',        label: 'All POs' },
  { key: 'open',       label: 'Open' },
  { key: 'approval',   label: 'Pending Approval' },
  { key: 'placed',     label: 'Order Placed' },
  { key: 'delivery',   label: 'Delivery Confirmation' },
  { key: 'received',   label: 'Material Received' },
  { key: 'closed',     label: 'Closed' },
  { key: 'cancelled',  label: 'Cancelled' },
]

const TIMELINES = [
  { key: 'all',    label: 'All Time' },
  { key: 'today',  label: 'Today' },
  { key: 'week',   label: 'This Week' },
  { key: 'month',  label: 'This Month' },
  { key: 'year',   label: 'This Year' },
  { key: 'custom', label: 'Custom' },
]

function matchFilter(po, f) {
  if (f === 'all')        return true
  if (f === 'open')       return !['material_received','closed','cancelled'].includes(po.status)
  if (f === 'approval')   return po.status === 'pending_approval'
  if (f === 'placed')     return ['approved','placed','acknowledged'].includes(po.status)
  if (f === 'delivery')   return po.status === 'delivery_confirmation'
  if (f === 'received')   return po.status === 'material_received'
  if (f === 'closed')     return po.status === 'closed'
  if (f === 'cancelled')  return po.status === 'cancelled'
  return false
}

function inTimeline(po, t, customFrom, customTo, dateMode) {
  let dateStr
  if (dateMode === 'expected') {
    dateStr = po.expected_delivery || null
    if (!dateStr) return false
  } else {
    dateStr = po.po_date || po.created_at
  }
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  const now = new Date(); now.setHours(0, 0, 0, 0)
  if (t === 'all') return true
  if (t === 'today') return d.getTime() === now.getTime()
  if (t === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - now.getDay())
    return d >= start
  }
  if (t === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (t === 'year')  return d.getFullYear() === now.getFullYear()
  if (t === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0,0,0,0); if (d < f) return false }
    if (customTo)   { const t2 = new Date(customTo);  t2.setHours(0,0,0,0); if (d > t2) return false }
    return true
  }
  return true
}

export default function PurchaseOrderList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [pos, setPos]         = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]     = useState(location.state?.filter || 'all')
  const [timeline, setTimeline] = useState(location.state?.timeline || 'all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo]     = useState('')
  const [dateMode, setDateMode]     = useState('po')
  const [search, setSearch]     = useState('')
  const [page, setPage]         = useState(1)
  const [showTest, setShowTest] = useState(false)

  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    if (!['ops','admin'].includes(role)) { navigate('/dashboard'); return }
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
    await loadPos(false)
  }

  async function loadPos(testMode = false) {
    setLoading(true)
    const { data } = await sb.from('purchase_orders')
      .select('id,po_number,status,total_amount,vendor_name,vendor_id,order_number,fulfilment_center,submitted_by_name,created_at,po_date,expected_delivery,po_items(id)')
      .gte('created_at', FY_START).eq('is_test', testMode)
      .order('created_at', { ascending: false })
    setPos(data || [])
    setLoading(false)
  }

  const timelineOrders = pos.filter(po => inTimeline(po, timeline, customFrom, customTo, dateMode))

  const counts = FILTERS.reduce((acc, { key }) => {
    acc[key] = timelineOrders.filter(po => matchFilter(po, key)).length
    return acc
  }, {})

  const q = search.trim().toLowerCase()
  const filtered = timelineOrders
    .filter(po => matchFilter(po, filter))
    .filter(po => !q || po.po_number?.toLowerCase().includes(q) || po.vendor_name?.toLowerCase().includes(q) || po.order_number?.toLowerCase().includes(q) || po.submitted_by_name?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const sumTotal = filtered.filter(po => po.status !== 'cancelled').reduce((s, po) => s + poValue(po), 0)

  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'POs'
  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || ''}–${customTo || ''}` : 'Custom')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fileName = `SSC_PurchaseOrders_${activeFilterLabel}_${timelineLabel}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    const rows = filtered.map(po => ({
      'PO #':             po.po_number,
      'Vendor':           po.vendor_name || '',
      'Linked Order':     po.order_number || '',
      'PO Date':          fmt(po.po_date),
      'Expected Delivery':po.expected_delivery ? fmt(po.expected_delivery) : '',
      'Submitted By':     po.submitted_by_name || '',
      'Items':            (po.po_items || []).length,
      'Value (₹)':        poValue(po),
      'Centre':           po.fulfilment_center || '',
      'Status':           statusLabel(po.status),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'POs')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  return (
    <Layout pageTitle="Purchase Orders" pageKey="procurement">
    <ProcSubNav active="po" />
    <div className="od-list-page">
      <div className="od-list-body">

        {/* Header */}
        <div className="od-list-header">
          <div>
            <div className="od-list-title">Purchase Orders</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {user.role === 'admin' && (
              <label style={{display:'inline-flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:showTest ? '#b45309' : 'var(--gray-500)',fontWeight:showTest ? 600 : 400,background:showTest ? '#fef3c7' : 'transparent',border:showTest ? '1px solid #fde68a' : '1px solid var(--gray-200)',borderRadius:8,padding:'6px 12px',transition:'all 0.15s'}}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadPos(e.target.checked) }} style={{accentColor:'#b45309',width:13,height:13}} />
                Test Mode
              </label>
            )}
            <div className="od-download-group">
              <button className="od-download-btn" onClick={downloadSummary} title="Download summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Summary
              </button>
            </div>
            <button className="new-order-btn" onClick={() => navigate('/procurement/po/new')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New PO
            </button>
          </div>
        </div>

        {/* Summary */}
        <div className="od-stat-grid">
          <div className="od-stat-card od-stat-blue">
            <div className="od-stat-card-top">
              <div className="od-stat-label">{FILTERS.find(f => f.key === filter)?.label || 'POs'}</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{filtered.length}</div>
            <div className="od-stat-sub">matching POs</div>
          </div>
          <div className="od-stat-card od-stat-navy">
            <div className="od-stat-card-top">
              <div className="od-stat-label">Total Value</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>
              </div>
            </div>
            <div className="od-stat-val" style={{ fontSize: sumTotal >= 1e7 ? 22 : sumTotal >= 1e5 ? 26 : 32 }}>
              {sumTotal >= 1e7 ? '₹' + (sumTotal/1e7).toFixed(2) + ' Cr' : sumTotal >= 1e5 ? '₹' + (sumTotal/1e5).toFixed(1) + 'L' : '₹' + sumTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <div className="od-stat-sub">across filtered POs</div>
          </div>
          <div className="od-stat-card od-stat-amber" onClick={() => { setFilter('approval'); setPage(1) }} style={{ cursor:'pointer' }}>
            <div className="od-stat-card-top">
              <div className="od-stat-label">Pending Approval</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{counts.approval}</div>
            <div className="od-stat-sub">awaiting approval</div>
          </div>
          <div className="od-stat-card od-stat-red" onClick={() => { setFilter('delivery'); setPage(1) }} style={{ cursor:'pointer' }}>
            <div className="od-stat-card-top">
              <div className="od-stat-label">Delivery Pending</div>
              <div className="od-stat-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>
              </div>
            </div>
            <div className="od-stat-val">{counts.delivery}</div>
            <div className="od-stat-sub">awaiting delivery</div>
          </div>
        </div>

        <div className="od-timeline-bar">
          {TIMELINES.map(({ key, label }) => (
            <button
              key={key}
              className={'od-timeline-btn' + (timeline === key ? ' active' : '')}
              onClick={() => { setTimeline(key); setPage(1) }}
            >
              {label}
            </button>
          ))}
          {timeline === 'custom' && (
            <div className="od-custom-range">
              <span className="od-range-label">From</span>
              <input type="date" className="od-range-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              <span className="od-range-label">To</span>
              <input type="date" className="od-range-input" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)} />
              {(customFrom || customTo) && (
                <button className="od-range-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }}>Clear</button>
              )}
            </div>
          )}
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
              placeholder="Search PO number, vendor, order..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
            {search && (
              <button className="od-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>
          <div style={{ display:'flex', borderRadius:8, border:'1px solid var(--gray-200)', overflow:'hidden', background:'#f9fafb', flexShrink:0 }}>
            <button onClick={() => { setDateMode('po'); setPage(1) }}
              style={{ padding:'6px 12px', fontSize:12, fontWeight: dateMode === 'po' ? 700 : 400, background: dateMode === 'po' ? 'white' : 'transparent', color: dateMode === 'po' ? 'var(--gray-900)' : 'var(--gray-500)', border:'none', cursor:'pointer', fontFamily:'var(--font)', boxShadow: dateMode === 'po' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', margin: dateMode === 'po' ? 2 : 0, borderRadius: dateMode === 'po' ? 6 : 0 }}
            >PO Date</button>
            <button onClick={() => { setDateMode('expected'); setPage(1) }}
              style={{ padding:'6px 12px', fontSize:12, fontWeight: dateMode === 'expected' ? 700 : 400, background: dateMode === 'expected' ? 'white' : 'transparent', color: dateMode === 'expected' ? 'var(--gray-900)' : 'var(--gray-500)', border:'none', cursor:'pointer', fontFamily:'var(--font)', boxShadow: dateMode === 'expected' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', margin: dateMode === 'expected' ? 2 : 0, borderRadius: dateMode === 'expected' ? 6 : 0 }}
            >Expected Delivery</button>
          </div>
          </div>
          <div className="filter-bar" style={{ margin: 0, padding: 0 }}>
            {FILTERS.map(({ key, label }) => (
              <button
                key={key}
                className={'filter-chip' + (filter === key ? ' active' : '') + (key === 'approval' || key === 'delivery' ? ' filter-chip-warn' : '') + (key === 'cancelled' ? ' filter-chip-danger' : '')}
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
            <div className="loading-state" style={{ padding: 40 }}><div className="loading-spin" />Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="orders-empty" style={{ border: 'none' }}>
              <div className="orders-empty-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                  <rect x="9" y="3" width="6" height="4" rx="1"/>
                </svg>
              </div>
              <div className="orders-empty-title">No purchase orders found</div>
              <div className="orders-empty-sub">{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="orders-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>PO #</th>
                      <th>Vendor</th>
                      <th>Linked Order</th>
                      <th>PO Date</th>
                      <th>Expected Delivery</th>
                      <th>Submitted By</th>
                      <th>Items</th>
                      <th style={{ textAlign: 'right' }}>Value (₹)</th>
                      <th style={{ textAlign: 'right' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(po => {
                      const ps = pillStatus(po)
                      return (
                        <tr key={po.id} onClick={() => navigate('/procurement/po/' + po.id)}>
                          <td className="order-num-cell">{po.po_number}</td>
                          <td className="customer-cell">{po.vendor_name || '—'}</td>
                          <td style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--gray-500)' }}>{po.order_number || '—'}</td>
                          <td>{fmt(po.po_date)}</td>
                          <td>{po.expected_delivery ? fmt(po.expected_delivery) : '—'}</td>
                          <td><OwnerChip name={po.submitted_by_name} /></td>
                          <td>{(po.po_items || []).length}</td>
                          <td className="amount-cell">{poValue(po).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                          <td className="status-cell">
                            <span className={'pill pill-' + ps}>{statusLabel(ps)}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div style={{ padding: '0 4px 4px' }}>
                {paginated.map((po, i) => (
                  <div key={po.id} className="order-card" style={{ animationDelay: i * 0.03 + 's' }} onClick={() => navigate('/procurement/po/' + po.id)}>
                    <div className="order-card-top">
                      <div>
                        <div className="order-num">{po.po_number}</div>
                        <div className="order-customer">{po.vendor_name || '—'}</div>
                        <div className="order-date" style={{display:'flex',alignItems:'center',gap:6,marginTop:2}}>{fmt(po.po_date)} · <OwnerChip name={po.submitted_by_name} /></div>
                        {po.expected_delivery && <div className="order-date" style={{ color:'var(--gray-500)' }}>Expected: {fmt(po.expected_delivery)}</div>}
                        {po.order_number && <div className="order-date" style={{ color:'var(--gray-400)', fontFamily:'var(--mono)' }}>Order: {po.order_number}</div>}
                      </div>
                      <span className={'pill pill-' + pillStatus(po)}>{statusLabel(po.status)}</span>
                    </div>
                    <div className="order-card-bottom">
                      <span className="order-items-count">
                        {(po.po_items || []).length} item{(po.po_items || []).length !== 1 ? 's' : ''}
                      </span>
                      <span className="order-total">₹{poValue(po).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderTop:'1px solid var(--gray-100)', gap:8, flexWrap:'wrap' }}>
                <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                  Showing {filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} POs
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
