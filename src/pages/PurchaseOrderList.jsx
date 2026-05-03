import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const REP_PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?' }

const PO_STATUS_LABELS = {
  draft:'PO Created', pending_approval:'Pending Approval', approved:'PO Approved', placed:'Order Placed',
  acknowledged:'Acknowledgement', delivery_confirmation:'Delivery Confirmation',
  material_received:'Material Received', closed:'Closed', cancelled:'Cancelled',
}
const PO_STATUS_COLORS = {
  draft:'#94A3B8', pending_approval:'#F59E0B', approved:'#1E54B7', placed:'#0EA5E9',
  acknowledged:'#0F766E', delivery_confirmation:'#D97706',
  material_received:'#22C55E', closed:'#047857', cancelled:'#EF4444',
}
function poValue(po) { return po.total_amount || 0 }
function isCPO(po) { return !!(po.order_number && po.order_number.includes('/CO')) }

const FILTERS = [
  { key:'all', label:'All' },
  { key:'po', label:'PO' },
  { key:'cpo', label:'PCO' },
  { key:'open', label:'Open' },
  { key:'approval', label:'Pending Approval', tone:'warn' },
  { key:'placed', label:'Order Placed' },
  { key:'delivery', label:'Delivery Confirmation' },
  { key:'received', label:'Material Received' },
  { key:'closed', label:'Closed' },
  { key:'cancelled', label:'Cancelled', tone:'danger' },
]
const TIMELINES = [
  { key:'all', label:'All Time' },
  { key:'today', label:'Today' },
  { key:'week', label:'This Week' },
  { key:'month', label:'This Month' },
  { key:'year', label:'This Year' },
  { key:'custom', label:'Custom' },
]

function matchFilter(po, f) {
  if (f === 'all') return true
  if (f === 'po') return !isCPO(po)
  if (f === 'cpo') return isCPO(po)
  if (f === 'open') return !['material_received','closed','cancelled'].includes(po.status)
  if (f === 'approval') return po.status === 'pending_approval'
  if (f === 'placed') return ['approved','placed','acknowledged'].includes(po.status)
  if (f === 'delivery') return po.status === 'delivery_confirmation'
  if (f === 'received') return po.status === 'material_received'
  if (f === 'closed') return po.status === 'closed'
  if (f === 'cancelled') return po.status === 'cancelled'
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
  const d = new Date(dateStr); d.setHours(0,0,0,0)
  const now = new Date(); now.setHours(0,0,0,0)
  if (t === 'all') return true
  if (t === 'today') return d.getTime() === now.getTime()
  if (t === 'week') { const start = new Date(now); start.setDate(now.getDate() - now.getDay()); return d >= start }
  if (t === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  if (t === 'year') return d.getFullYear() === now.getFullYear()
  if (t === 'custom') {
    if (customFrom) { const f = new Date(customFrom); f.setHours(0,0,0,0); if (d < f) return false }
    if (customTo) { const t2 = new Date(customTo); t2.setHours(0,0,0,0); if (d > t2) return false }
    return true
  }
  return true
}

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

export default function PurchaseOrderList() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState({ name:'', role:'' })
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(location.state?.filter || 'all')
  const [timeline, setTimeline] = useState(location.state?.timeline || 'all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [dateMode, setDateMode] = useState('po')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [showTest, setShowTest] = useState(false)
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })
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
  const counts = FILTERS.reduce((acc, { key }) => { acc[key] = timelineOrders.filter(po => matchFilter(po, key)).length; return acc }, {})
  const q = search.trim().toLowerCase()
  const filtered = timelineOrders
    .filter(po => matchFilter(po, filter))
    .filter(po => !q || po.po_number?.toLowerCase().includes(q) || po.vendor_name?.toLowerCase().includes(q) || po.order_number?.toLowerCase().includes(q) || po.submitted_by_name?.toLowerCase().includes(q))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const sumTotal = filtered.filter(po => po.status !== 'cancelled').reduce((s, po) => s + poValue(po), 0)
  const activeFilterLabel = FILTERS.find(f => f.key === filter)?.label || 'POs'
  const timelineLabel = timeline === 'custom'
    ? (customFrom || customTo ? `${customFrom || ''}–${customTo || ''}` : 'Custom')
    : TIMELINES.find(t => t.key === timeline)?.label || ''
  const fileName = `SSC_PurchaseOrders_${activeFilterLabel}_${timelineLabel}_${new Date().toISOString().slice(0,10)}`

  function downloadSummary() {
    const rows = filtered.map(po => ({
      'PO #': po.po_number, 'Vendor': po.vendor_name || '',
      'Linked Order': po.order_number || '', 'PO Date': fmt(po.po_date),
      'Expected Delivery': po.expected_delivery ? fmt(po.expected_delivery) : '',
      'Submitted By': po.submitted_by_name || '', 'Items': (po.po_items || []).length,
      'Value (₹)': poValue(po), 'Centre': po.fulfilment_center || '',
      'Status': PO_STATUS_LABELS[po.status] || po.status,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'POs')
    XLSX.writeFile(wb, fileName + '_Summary.xlsx')
  }

  return (
    <Layout pageTitle="Purchase Orders" pageKey="procurement">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Purchase Orders</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> {activeFilterLabel.toLowerCase()}</span>
              <span className="o-sep">·</span>
              <span><b>{fmtCr(sumTotal)}</b> total value</span>
            </div>
          </div>
          <div className="page-meta">
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); loadPos(e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSummary} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Summary
              </button>
            </div>
            <button className="btn-primary" onClick={() => navigate('/procurement/po/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New PO
            </button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label={activeFilterLabel} value={filtered.length} sub="matching POs" chart="line"/>
          <KpiTile variant="hero" tone="forest" label="Total Value" value={fmtCr(sumTotal)} sub="across filtered" chart="bars"/>
          <KpiTile variant="hero" tone="teal" label="Open POs" value={counts.open || 0} sub="in progress" chart="bars" onClick={() => { setFilter('open'); setPage(1) }}/>
          <KpiTile label="Pending Approval" value={counts.approval || 0} sub="awaiting approval" accent={(counts.approval || 0) > 0 ? 'amber' : null} onClick={() => { setFilter('approval'); setPage(1) }}/>
          <KpiTile label="Delivery Pending" value={counts.delivery || 0} sub="awaiting delivery" onClick={() => { setFilter('delivery'); setPage(1) }}/>
        </div>

        <div className="o-timeline">
          {TIMELINES.map(({ key, label }) => (
            <button key={key} className={timeline === key ? 'on' : ''} onClick={() => { setTimeline(key); setPage(1) }}>{label}</button>
          ))}
          {timeline === 'custom' && (
            <div className="o-timeline-custom">
              <span>From</span>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}/>
              <span>To</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} max={new Date().toISOString().slice(0,10)}/>
              {(customFrom || customTo) && <button className="o-search-clear" onClick={() => { setCustomFrom(''); setCustomTo('') }} style={{ marginLeft: 6, fontSize: 11, color: 'var(--o-bad)' }}>Clear</button>}
            </div>
          )}
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search PO number, vendor, order…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className="o-datemode">
            <button className={dateMode === 'po' ? 'on' : ''} onClick={() => { setDateMode('po'); setPage(1) }}>PO Date</button>
            <button className={dateMode === 'expected' ? 'on' : ''} onClick={() => { setDateMode('expected'); setPage(1) }}>Expected Delivery</button>
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => { setFilter(key); setPage(1) }}>
              {label}
              {counts[key] > 0 && <span className="o-chip-n">{counts[key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="o-loading">Loading POs…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 110px minmax(0, 1fr) auto 140px' }}>
              <div>PO #</div>
              <div>Vendor</div>
              <div>PO Date</div>
              <div>Submitted By</div>
              <div className="ol-numgroup">
                <div className="num num-label" style={{ textAlign:'right' }}>Items</div>
                <div className="num num-label" style={{ textAlign:'right' }}>Value</div>
              </div>
              <div className="num">Status</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No purchase orders found</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{search ? 'Try a different search term.' : 'Nothing here right now.'}</div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(po => {
                  const color = PO_STATUS_COLORS[po.status] || '#94A3B8'
                  return (
                    <div key={po.id} className="ol-row ol-data" style={{ gridTemplateColumns: '140px minmax(0, 1.4fr) 110px minmax(0, 1fr) auto 140px' }} onClick={() => navigate('/procurement/po/' + po.id)}>
                      <div className="ol-cell">
                        <div className="ol-num">{po.po_number}</div>
                        {po.order_number && <div className="ol-date-sub">{po.order_number}</div>}
                      </div>
                      <div className="ol-cell ol-cust" title={po.vendor_name}>{po.vendor_name || '—'}</div>
                      <div className="ol-cell">
                        <div className="ol-date">{fmt(po.po_date)}</div>
                        {po.expected_delivery && <div className="ol-date-sub">Exp: {fmt(po.expected_delivery)}</div>}
                      </div>
                      <div className="ol-cell">
                        {po.submitted_by_name ? (
                          <div className="ol-owner" title={po.submitted_by_name}>
                            <div className="ol-owner-avatar" style={{background: ownerColor(po.submitted_by_name)}}>{initials(po.submitted_by_name)}</div>
                            <span className="ol-owner-name">{po.submitted_by_name}</span>
                          </div>
                        ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                      </div>
                      <div className="ol-numgroup">
                        <div className="ol-items">{(po.po_items || []).length}</div>
                        <div className="ol-val">₹{poValue(po).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                      </div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': color }}>
                          <span className="ol-status-dot"/>
                          {PO_STATUS_LABELS[po.status] || po.status}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                {totalPages > 1 && (
                  <div className="ol-pages">
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                      const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                      const ellipsis = !show && Math.abs(p - safePage) === 2
                      if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                      if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 4px', color:'var(--o-muted-2)' }}>…</span>
                      return null
                    })}
                    <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {onClick && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">{sub && <div className="kt-sub mono">{sub}</div>}</div>
    </div>
  )
}
function KpiChart({ kind }) {
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
        <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
      ))}
    </svg>
  )
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}
