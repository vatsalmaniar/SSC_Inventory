import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

const PO_STATUS_LABELS = {
  draft:'Draft', pending_approval:'Pending Approval', approved:'Approved', placed:'Placed',
  acknowledged:'Acknowledged', partially_received:'Partial GRN', material_received:'Received',
  closed:'Closed', cancelled:'Cancelled',
}

function statusLabel(s) { return PO_STATUS_LABELS[s] || s }

export default function ProcurementDashboard() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', role: '' })
  const [pos, setPos]         = useState([])
  const [coOrders, setCoOrders] = useState([])
  const [pendingGrn, setPendingGrn] = useState(0)
  const [pendingInward, setPendingInward] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const name = profile?.name || session.user.email.split('@')[0]
    const role = profile?.role || 'ops'
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name, role })

    const [posRes, grnCountRes, inwardCountRes] = await Promise.all([
      sb.from('purchase_orders').select('id,po_number,status,total_amount,vendor_name,created_at')
        .eq('is_test', false).gte('created_at', FY_START).order('created_at', { ascending: false }),
      sb.from('grn').select('id', { count:'exact', head:true })
        .in('status', ['draft','checking']).eq('is_test', false),
      sb.from('purchase_invoices').select('id', { count:'exact', head:true })
        .in('status', ['three_way_check','invoice_pending']).eq('is_test', false),
    ])
    setPos(posRes.data || [])
    setPendingGrn(grnCountRes.count || 0)
    setPendingInward(inwardCountRes.count || 0)

    // CO orders — item-level PO coverage
    const { data: coData } = await sb.from('orders')
      .select('id,order_number,customer_name,status,order_items(id,total_price)')
      .eq('is_test', false).eq('order_type', 'CO')
      .in('status', ['inv_check','inventory_check','dispatch'])
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
    let coList = coData || []
    if (coList.length) {
      const coIds = coList.map(o => o.id)
      const { data: linkedPos } = await sb.from('purchase_orders').select('id,order_id').in('order_id', coIds)
      let coveredSet = new Set()
      if (linkedPos?.length) {
        const poIds = linkedPos.map(p => p.id)
        const { data: poItems } = await sb.from('po_items').select('order_item_id').in('po_id', poIds).not('order_item_id', 'is', null)
        coveredSet = new Set((poItems || []).map(pi => pi.order_item_id))
      }
      coList = coList.map(o => {
        const total = (o.order_items || []).length
        const covered = (o.order_items || []).filter(oi => coveredSet.has(oi.id)).length
        return { ...o, _totalItems: total, _coveredItems: covered }
      }).filter(o => o._coveredItems < o._totalItems)
    }
    setCoOrders(coList)
    setLoading(false)
  }

  const openPos       = pos.filter(p => !['material_received','closed','cancelled'].includes(p.status))
  const pendingAppr   = pos.filter(p => p.status === 'pending_approval')
  const placedPos     = pos.filter(p => ['placed','acknowledged'].includes(p.status))
  const partialPos    = pos.filter(p => p.status === 'partially_received')
  const receivedPos   = pos.filter(p => p.status === 'material_received')
  const closedPos     = pos.filter(p => p.status === 'closed')
  const totalPoValue  = openPos.reduce((s, p) => s + (p.total_amount || 0), 0)

  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening'

  const PIPELINE = [
    { label: 'Draft',              count: pos.filter(p => p.status === 'draft').length,              color: '#475569' },
    { label: 'Pending Approval',   count: pendingAppr.length,                                        color: '#b45309' },
    { label: 'Approved',           count: pos.filter(p => p.status === 'approved').length,           color: '#1d4ed8' },
    { label: 'Placed',             count: pos.filter(p => p.status === 'placed').length,             color: '#1d4ed8' },
    { label: 'Acknowledged',       count: pos.filter(p => p.status === 'acknowledged').length,       color: '#1e40af' },
    { label: 'Partially Received', count: partialPos.length,                                         color: '#b45309' },
    { label: 'Received',           count: receivedPos.length,                                        color: '#15803d' },
    { label: 'Closed',             count: closedPos.length,                                          color: '#059669' },
  ]
  const pipelineMax = Math.max(...PIPELINE.map(p => p.count), 1)

  return (
    <Layout pageTitle="Procurement" pageKey="procurement">
      <div className="dash-page">
        <div className="dash-body">

          {/* Header */}
          <div className="dash-header-row">
            <div>
              <div className="dash-greeting">{greeting}, {user.name?.split(' ')[0] || '...'}</div>
              <div className="dash-date">
                Procurement &nbsp;·&nbsp;
                {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="od-dash-viewall-btn" onClick={() => navigate('/procurement/po')}>
                All POs
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:13, height:13 }}><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button className="new-order-btn" onClick={() => navigate('/procurement/po/new')} style={{ fontSize:12 }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New PO
              </button>
            </div>
          </div>

          {loading ? (
            <div className="dash-loading"><div className="loading-spin"/></div>
          ) : (<>

            {/* Stat tiles */}
            <div className="dash-tiles">

              {/* Tile 1 — Open POs */}
              <div className="dash-tile" style={{ background: '#0e2d6a' }} onClick={() => navigate('/procurement/po')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Open POs</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{openPos.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">{fmtCr(totalPoValue)} value</span>
                  {pendingAppr.length > 0 && <span className="dash-tile-badge">{pendingAppr.length} need approval</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <rect x="0"   y="8"  width="60" height="28" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="70"  y="0"  width="60" height="36" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="140" y="12" width="60" height="24" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="210" y="4"  width="60" height="32" rx="6" fill="rgba(255,255,255,0.10)"/>
                    <rect x="260" y="16" width="40" height="20" rx="6" fill="rgba(255,255,255,0.10)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 2 — Awaiting GRN */}
              <div className="dash-tile" style={{ background: '#78350f' }} onClick={() => navigate('/fc/grn')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Awaiting GRN</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{placedPos.length + partialPos.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">placed · acknowledged · partial</span>
                  {partialPos.length > 0 && <span className="dash-tile-badge">{partialPos.length} partially received</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="80"  cy="18" r="48" fill="rgba(255,255,255,0.08)"/>
                    <circle cx="200" cy="18" r="60" fill="rgba(255,255,255,0.08)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 3 — Received / Closed */}
              <div className="dash-tile" style={{ background: '#064e3b' }} onClick={() => navigate('/procurement/po')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Received / Closed</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value">{receivedPos.length + closedPos.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">completed this FY</span>
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5].map(i => {
                      const h = [14,22,18,30,24,36][i]
                      return <rect key={i} x={i*50+8} y={36-h} width={34} height={h} rx={5} fill="rgba(255,255,255,0.15)"/>
                    })}
                  </svg>
                </div>
              </div>

              {/* Tile 4 — CO Needing PO (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/procurement/orders')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">CO Needing PO</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: coOrders.length > 0 ? '#7c3aed' : undefined }}>{coOrders.length}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">orders with uncovered items</span>
                  {coOrders.length > 0 && <span className="dash-tile-badge" style={{ background:'#faf5ff', color:'#7c3aed' }}>Create PO</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    <circle cx="150" cy="18" r="56" fill="rgba(124,58,237,0.04)"/>
                    <circle cx="150" cy="18" r="36" fill="rgba(124,58,237,0.04)"/>
                  </svg>
                </div>
              </div>

              {/* Tile 5 — Pending Inward (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/fc/grn')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Pending Inward</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: pendingGrn > 0 ? '#b45309' : undefined }}>{pendingGrn}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">GRNs awaiting inspection</span>
                  {pendingGrn > 0 && <span className="dash-tile-badge" style={{ background:'#fffbeb', color:'#b45309' }}>Needs inspection</span>}
                </div>
              </div>

              {/* Tile 6 — Inward Billing (light) */}
              <div className="dash-tile dash-tile-light" onClick={() => navigate('/procurement/invoices')}>
                <div className="dash-tile-head">
                  <div className="dash-tile-label">Inward Billing</div>
                  <div className="dash-tile-arrow"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg></div>
                </div>
                <div className="dash-tile-value" style={{ color: pendingInward > 0 ? '#0891b2' : undefined }}>{pendingInward}</div>
                <div className="dash-tile-meta">
                  <span className="dash-tile-sub">3-way check · invoice pending</span>
                  {pendingInward > 0 && <span className="dash-tile-badge" style={{ background:'#ecfeff', color:'#0891b2' }}>Action needed</span>}
                </div>
                <div className="dash-tile-chart">
                  <svg viewBox="0 0 300 36" preserveAspectRatio="none" style={{ height:36 }}>
                    {[0,1,2,3,4,5,6,7].map(i => {
                      const h = [10,18,12,24,16,22,12,26][i]
                      return <rect key={i} x={i*38+4} y={36-h} width={28} height={h} rx={4} fill="rgba(8,145,178,0.08)"/>
                    })}
                  </svg>
                </div>
              </div>

            </div>

            {/* Mid row */}
            <div className="dash-mid">

              {/* Pipeline */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">PO Pipeline</div>
                  <span className="dash-badge">{openPos.length} in progress</span>
                </div>
                <div style={{ padding:'4px 0 0' }}>
                  {PIPELINE.map((p, i) => {
                    const pct  = Math.round((p.count / pipelineMax) * 100)
                    const minW = p.count > 0 ? Math.max(pct, 6) : 0
                    return (
                      <div key={i} style={{ padding:'10px 18px', borderBottom: i < PIPELINE.length - 1 ? '1px solid #f8fafc' : 'none' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                          <span style={{ fontSize:12, color: p.count > 0 ? '#334155' : '#94a3b8', fontWeight: p.count > 0 ? 600 : 400 }}>{p.label}</span>
                          <span style={{ fontSize:14, fontWeight:800, color: p.count > 0 ? '#0f172a' : '#cbd5e1', minWidth:24, textAlign:'right' }}>{p.count}</span>
                        </div>
                        <div style={{ height:6, background:'#f1f5f9', borderRadius:6 }}>
                          {p.count > 0 && <div style={{ height:'100%', width: minW + '%', background: p.color, borderRadius:6, transition:'width 0.6s ease', minWidth:8 }} />}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Pending Approval list */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Pending Approval</div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className="dash-badge" style={{ background: pendingAppr.length > 0 ? '#fef9c3' : '#f1f5f9', color: pendingAppr.length > 0 ? '#854d0e' : '#94a3b8' }}>{pendingAppr.length} POs</span>
                    <button onClick={() => navigate('/procurement/po')} className="dash-icon-btn">
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
                    </button>
                  </div>
                </div>
                {pendingAppr.length === 0
                  ? <div className="dash-empty">No POs pending approval</div>
                  : pendingAppr.slice(0, 8).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/procurement/po/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#b45309' }}>{o.po_number}</div>
                          <div className="dash-row-cust">{o.vendor_name || '—'}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:'var(--gray-800)' }}>{fmtCr(o.total_amount)}</div>
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background:'#fef9c3', color:'#854d0e' }}>Needs Approval</span>
                        </div>
                      </div>
                    ))
                }
              </div>

            </div>

            {/* Bottom row */}
            <div className="dash-bottom">

              {/* CO Orders needing PO */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">CO Orders — Need PO</div>
                  <span className="dash-badge" style={{ background:'#faf5ff', color:'#7c3aed' }}>{coOrders.length} orders</span>
                </div>
                {coOrders.length === 0
                  ? <div className="dash-empty">All CO orders fully covered</div>
                  : coOrders.slice(0, 6).map(o => {
                      const val = (o.order_items || []).reduce((s,i) => s + (i.total_price || 0), 0)
                      const covered = o._coveredItems || 0
                      const total = o._totalItems || 0
                      const hasPartial = covered > 0
                      return (
                        <div key={o.id} className="dash-list-row" onClick={() => navigate('/procurement/po/new?order_id=' + o.id)}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#7c3aed' }}>{o.order_number}</div>
                            <div className="dash-row-cust">{o.customer_name}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:11, fontWeight:600, color: hasPartial ? '#b45309' : 'var(--gray-500)', marginBottom:2 }}>{covered}/{total} covered</div>
                            <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background: hasPartial ? '#fffbeb' : '#fef3c7', color:'#92400e' }}>{hasPartial ? 'Add PO →' : 'Create PO →'}</span>
                          </div>
                        </div>
                      )
                    })
                }
              </div>

              {/* Placed / Awaiting delivery */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Placed — Awaiting Delivery</div>
                  <span className="dash-badge" style={{ background:'#eff6ff', color:'#1d4ed8' }}>{placedPos.length} POs</span>
                </div>
                {placedPos.length === 0
                  ? <div className="dash-empty">No POs awaiting delivery</div>
                  : placedPos.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/procurement/po/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#1d4ed8' }}>{o.po_number}</div>
                          <div className="dash-row-cust">{o.vendor_name || '—'}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--gray-700)' }}>{fmtCr(o.total_amount)}</div>
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background:'#eff6ff', color:'#1d4ed8' }}>{statusLabel(o.status)}</span>
                        </div>
                      </div>
                    ))
                }
              </div>

              {/* Recently Received */}
              <div className="dash-card">
                <div className="dash-card-head">
                  <div className="dash-card-title">Recently Received</div>
                  <span className="dash-badge" style={{ background:'#f0fdf4', color:'#059669' }}>{receivedPos.length} total</span>
                </div>
                {receivedPos.length === 0
                  ? <div className="dash-empty">No received POs yet</div>
                  : receivedPos.slice(0, 6).map(o => (
                      <div key={o.id} className="dash-list-row" onClick={() => navigate('/procurement/po/' + o.id)}>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color:'#059669' }}>{o.po_number}</div>
                          <div className="dash-row-cust">{o.vendor_name || '—'}</div>
                        </div>
                        <div style={{ textAlign:'right', flexShrink:0 }}>
                          <div style={{ fontSize:12, fontWeight:600, color:'var(--gray-700)' }}>{fmtCr(o.total_amount)}</div>
                          <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:4, background:'#f0fdf4', color:'#15803d' }}>Received</span>
                        </div>
                      </div>
                    ))
                }
              </div>

            </div>

          </>)}
        </div>
      </div>
    </Layout>
  )
}
