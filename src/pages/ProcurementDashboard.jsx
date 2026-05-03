import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val / 1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val / 1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const PO_STATUS_LABELS = {
  draft:'Draft', pending_approval:'Pending Approval', approved:'Approved', placed:'Placed',
  acknowledged:'Acknowledged', partially_received:'Partial GRN', material_received:'Received',
  closed:'Closed', cancelled:'Cancelled',
}
const PO_STATUS_COLORS = {
  draft:'#94A3B8', pending_approval:'#F59E0B', approved:'#1E54B7', placed:'#0EA5E9',
  acknowledged:'#0F766E', partially_received:'#D97706', material_received:'#22C55E',
  closed:'#047857', cancelled:'#EF4444',
}
const PIPELINE_KEYS = ['draft','pending_approval','approved','placed','acknowledged','partially_received','material_received','closed']

export default function ProcurementDashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [pos, setPos] = useState([])
  const [coOrders, setCoOrders] = useState([])
  const [pendingGrn, setPendingGrn] = useState(0)
  const [pendingInward, setPendingInward] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'ops'
    if (!['ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUser({ name: profile?.name || '', role })

    const [posRes, grnCountRes, inwardCountRes] = await Promise.all([
      sb.from('purchase_orders').select('id,po_number,status,total_amount,vendor_name,created_at')
        .eq('is_test', false).gte('created_at', FY_START).order('created_at', { ascending: false }),
      sb.from('grn').select('id', { count:'exact', head:true }).in('status', ['draft','checking']).eq('is_test', false),
      sb.from('purchase_invoices').select('id', { count:'exact', head:true }).in('status', ['three_way_check','invoice_pending']).eq('is_test', false),
    ])
    setPos(posRes.data || [])
    setPendingGrn(grnCountRes.count || 0)
    setPendingInward(inwardCountRes.count || 0)

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

  const openPos = pos.filter(p => !['material_received','closed','cancelled'].includes(p.status))
  const pendingAppr = pos.filter(p => p.status === 'pending_approval')
  const placedPos = pos.filter(p => ['placed','acknowledged'].includes(p.status))
  const partialPos = pos.filter(p => p.status === 'partially_received')
  const receivedPos = pos.filter(p => p.status === 'material_received')
  const closedPos = pos.filter(p => p.status === 'closed')
  const totalPoValue = openPos.reduce((s, p) => s + (p.total_amount || 0), 0)

  // Vendor leaderboard
  const vendorAgg = Object.values(pos.reduce((m, p) => {
    const k = p.vendor_name || '—'
    if (!m[k]) m[k] = { name: k, value: 0, count: 0 }
    m[k].value += (p.total_amount || 0)
    m[k].count++
    return m
  }, {})).sort((a, b) => b.value - a.value).slice(0, 6)
  const vendorMax = vendorAgg[0]?.value || 1

  const funnel = PIPELINE_KEYS.map(k => ({
    id: k, label: PO_STATUS_LABELS[k], color: PO_STATUS_COLORS[k],
    count: pos.filter(p => p.status === k).length,
  })).filter(s => s.count > 0)

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()

  return (
    <Layout pageTitle="Procurement" pageKey="procurement">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greeting}, {user.name?.split(' ')[0] || ''}</h1>
            <div className="page-sub">Procurement · {openPos.length} open POs · {fmtCr(totalPoValue)} value</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot"/> Live</div>
            <button className="btn-ghost" onClick={() => navigate('/procurement/po')}>All POs</button>
            <button className="btn-primary" onClick={() => navigate('/procurement/po/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New PO
            </button>
          </div>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : (
          <>
            <div className="kpi-row">
              <KpiTile variant="hero" tone="deep" label="Open POs" value={openPos.length} sub={`${fmtCr(totalPoValue)} value`} chart="line" onClick={() => navigate('/procurement/po')}/>
              <KpiTile variant="hero" tone="forest" label="Received / Closed" value={receivedPos.length + closedPos.length} sub="completed FYTD" chart="bars" onClick={() => navigate('/procurement/po')}/>
              <KpiTile variant="hero" tone="teal" label="Awaiting GRN" value={placedPos.length + partialPos.length} sub={`${partialPos.length} partial`} chart="bars" onClick={() => navigate('/fc/grn')}/>
              <KpiTile label="Pending Approval" value={pendingAppr.length} sub="POs to approve" accent={pendingAppr.length > 0 ? 'amber' : null} onClick={() => navigate('/procurement/po')}/>
              <KpiTile label="CO Needing PO" value={coOrders.length} sub="orders uncovered" accent={coOrders.length > 0 ? 'amber' : null} onClick={() => navigate('/procurement/orders')}/>
            </div>

            <div className="o-mid">
              <div className="rep-panel">
                <div className="rp-head">
                  <div className="rp-title">Top Vendors</div>
                  <div className="rp-sub">FYTD · By PO value</div>
                </div>
                <div className="rp-list">
                  {vendorAgg.length === 0 ? (
                    <div className="o-empty">No vendor activity yet</div>
                  ) : vendorAgg.map((v, i) => {
                    const seed = v.name; let h = 0; for (let j = 0; j < seed.length; j++) h = (h * 31 + seed.charCodeAt(j)) & 0xffffffff
                    const palette = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
                    const color = palette[Math.abs(h) % palette.length]
                    return (
                      <div key={v.name} className="rp-row" onClick={() => navigate('/procurement/po')}>
                        <div className="rp-rank">{i+1}</div>
                        <div className="rp-avatar" style={{ background: color }}>{(v.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
                        <div className="rp-info">
                          <div className="rp-name">{v.name}</div>
                          <div className="rp-bar"><div className="rp-fill" style={{ width: `${(v.value/vendorMax)*100}%`, background: color }}/></div>
                        </div>
                        <div className="rp-val">{fmtCr(v.value)}</div>
                      </div>
                    )
                  })}
                </div>
                <div className="rp-foot">
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">VENDORS</div>
                    <div className="rp-foot-val">{vendorAgg.length}</div>
                  </div>
                  <div className="rp-foot-cell">
                    <div className="rp-foot-label">TOTAL VALUE</div>
                    <div className="rp-foot-val">{fmtCr(vendorAgg.reduce((s,v)=>s+v.value,0))}</div>
                  </div>
                </div>
              </div>

              <div className="o-anal">
                <div className="card anal-card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Pipeline · By Status</div>
                      <div className="card-title">PO Pipeline</div>
                    </div>
                    <span className="trend-pill mono">{openPos.length} open</span>
                  </div>
                  <div className="funnel">
                    {funnel.length === 0 ? <div className="o-empty">No POs yet</div> : funnel.map(s => {
                      const max = Math.max(...funnel.map(x => x.count))
                      return (
                        <div key={s.id} className="funnel-row">
                          <div className="funnel-label">
                            <span className="funnel-dot" style={{ background: s.color }}/>
                            <span className="funnel-name">{s.label}</span>
                          </div>
                          <div className="funnel-bar-wrap"><div className="funnel-bar" style={{ width: `${(s.count/max)*100}%`, background: s.color }}/></div>
                          <div className="funnel-val">{s.count}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="card anal-card">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Distribution · By Stage</div>
                      <div className="card-title">PO Mix</div>
                    </div>
                    <span className="trend-pill mono">{pos.length} total</span>
                  </div>
                  <StatusDonut groups={funnel} total={funnel.reduce((s,g) => s + g.count, 0)} centerLabel="POs"/>
                </div>

                <div className="card anal-card full">
                  <div className="card-head">
                    <div>
                      <div className="card-eyebrow">Inward Activity</div>
                      <div className="card-title">GRN & Invoice Queue</div>
                    </div>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 12, padding: 4 }}>
                    <div className="card" style={{ padding: 14, cursor: 'pointer' }} onClick={() => navigate('/fc/grn')}>
                      <div style={{ fontSize: 11, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace', letterSpacing: '0.06em', textTransform:'uppercase' }}>PENDING GRNs</div>
                      <div style={{ fontSize: 28, fontWeight: 600, fontFamily: 'Geist Mono, monospace', color: pendingGrn > 0 ? '#B45309' : 'var(--o-ink)', marginTop: 4 }}>{pendingGrn}</div>
                      <div style={{ fontSize: 11, color: 'var(--o-muted-2)', marginTop: 2 }}>awaiting inspection</div>
                    </div>
                    <div className="card" style={{ padding: 14, cursor: 'pointer' }} onClick={() => navigate('/procurement/invoices')}>
                      <div style={{ fontSize: 11, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace', letterSpacing: '0.06em', textTransform:'uppercase' }}>INWARD INVOICES</div>
                      <div style={{ fontSize: 28, fontWeight: 600, fontFamily: 'Geist Mono, monospace', color: pendingInward > 0 ? '#0F766E' : 'var(--o-ink)', marginTop: 4 }}>{pendingInward}</div>
                      <div style={{ fontSize: 11, color: 'var(--o-muted-2)', marginTop: 2 }}>3-way / pending</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dash-row-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 16 }}>
              <ListCard title="Pending Approval" eyebrow="Action · Now" badge={`${pendingAppr.length} POs`} badgeColor="#B45309"
                items={pendingAppr.slice(0, 8)} emptyText="No POs pending approval"
                renderItem={(o) => ({ left: o.po_number, leftColor: '#B45309', sub: o.vendor_name || '—', right: fmtCr(o.total_amount), status: 'pending_approval' })}
                onClick={(o) => navigate('/procurement/po/' + o.id)}/>
              <ListCard title="CO Orders Need PO" eyebrow="Awaiting coverage" badge={`${coOrders.length} orders`} badgeColor="#1E54B7"
                items={coOrders.slice(0, 8)} emptyText="All CO orders fully covered"
                renderItem={(o) => ({ left: o.order_number, leftColor: '#1E54B7', sub: o.customer_name, right: `${o._coveredItems}/${o._totalItems}`, status: 'placed', label: 'covered' })}
                onClick={(o) => navigate('/procurement/po/new?order_id=' + o.id)}/>
              <ListCard title="Placed · Awaiting Delivery" eyebrow="Vendor · In transit" badge={`${placedPos.length} POs`} badgeColor="#0F766E"
                items={placedPos.slice(0, 8)} emptyText="No POs awaiting delivery"
                renderItem={(o) => ({ left: o.po_number, leftColor: '#0F766E', sub: o.vendor_name || '—', right: fmtCr(o.total_amount), status: o.status })}
                onClick={(o) => navigate('/procurement/po/' + o.id)}/>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">FYTD · Closed</div>
                  <div className="card-title">Recently Received</div>
                </div>
                <span className="trend-pill mono">{receivedPos.length} POs</span>
              </div>
              <div className="o-list">
                {receivedPos.length === 0 ? (
                  <div className="o-empty">No received POs yet</div>
                ) : receivedPos.slice(0, 8).map(o => (
                  <div key={o.id} className="o-list-row" onClick={() => navigate('/procurement/po/' + o.id)}>
                    <div style={{ minWidth: 0 }}>
                      <div className="o-list-num" style={{ color: '#22C55E' }}>{o.po_number}</div>
                      <div className="o-list-cust">{o.vendor_name || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="o-list-val">{fmtCr(o.total_amount)}</div>
                      <span className="ol-status-pill" style={{ '--stage-color': PO_STATUS_COLORS.material_received, marginTop: 2 }}>
                        <span className="ol-status-dot"/>Received
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}

function ListCard({ title, eyebrow, badge, badgeColor, items, emptyText, renderItem, onClick }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-eyebrow">{eyebrow}</div>
          <div className="card-title">{title}</div>
        </div>
        <span className="trend-pill mono" style={{ color: badgeColor }}>{badge}</span>
      </div>
      <div className="o-list">
        {items.length === 0 ? (
          <div className="o-empty">{emptyText}</div>
        ) : items.map(item => {
          const r = renderItem(item)
          return (
            <div key={item.id} className="o-list-row" onClick={() => onClick(item)}>
              <div style={{ minWidth: 0 }}>
                <div className="o-list-num" style={{ color: r.leftColor }}>{r.left}</div>
                <div className="o-list-cust">{r.sub}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="o-list-val">{r.right}</div>
                <span className="ol-status-pill" style={{ '--stage-color': PO_STATUS_COLORS[r.status] || '#94A3B8', marginTop: 2 }}>
                  <span className="ol-status-dot"/>
                  {r.label || PO_STATUS_LABELS[r.status]}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
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

function StatusDonut({ groups, total, centerLabel = 'TOTAL' }) {
  if (!groups.length || !total) return <div className="donut-wrap"><div style={{ color:'var(--o-muted-2)', fontSize:12 }}>No data</div></div>
  const size = 130, r = size/2 - 8, inner = r - 18, cx = size/2, cy = size/2
  let angle = -Math.PI/2
  const arcs = groups.filter(s => s.count > 0).map(s => {
    const portion = s.count / total
    const next = angle + portion * 2 * Math.PI
    const large = portion > 0.5 ? 1 : 0
    const x0 = cx + r * Math.cos(angle), y0 = cy + r * Math.sin(angle)
    const x1 = cx + r * Math.cos(next),  y1 = cy + r * Math.sin(next)
    const ix0 = cx + inner * Math.cos(angle), iy0 = cy + inner * Math.sin(angle)
    const ix1 = cx + inner * Math.cos(next),  iy1 = cy + inner * Math.sin(next)
    const path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${large} 0 ${ix0} ${iy0} Z`
    angle = next
    return { path, color: s.color, label: s.label, count: s.count, pct: Math.round(portion*100) }
  })
  return (
    <div className="donut-wrap">
      <svg width={size} height={size}>
        {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} opacity="0.92"/>)}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="600" fill="#0B1B30" fontFamily="Geist Mono, monospace" style={{ letterSpacing: '-0.02em' }}>{total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="8" fill="#6B7280" letterSpacing="0.06em" fontFamily="Geist Mono, monospace">{centerLabel}</text>
      </svg>
      <div className="donut-legend">
        {arcs.slice(0, 6).map((a, i) => (
          <div key={i} className="dlg-row">
            <span className="dlg-dot" style={{background: a.color}}/>
            <span className="dlg-name">{a.label}</span>
            <span className="dlg-pct mono">{a.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
