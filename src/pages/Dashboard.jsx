import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START, FY_LABEL, fmtMoneyShort } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/dashboard.css'

const APPS = [
  { key:'crm', label:'CRM', desc:'Leads & opportunities', path:'/crm', roles:['all'], color:{ bg:'#eef2ff', icon:'#4338ca' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
  { key:'customer360', label:'Customer 360', desc:'Accounts & profiles', path:'/customers', roles:['sales','ops','admin','management'], color:{ bg:'#f0fdfa', icon:'#0f766e' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
  { key:'inventory', label:'Inventory', desc:'Stock & availability', path:'/inventory', roles:['sales','admin','management','ops'], color:{ bg:'#f0fdf4', icon:'#15803d' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg> },
  { key:'orders', label:'Orders', desc:'Create & track orders', path:'/orders', roles:['all'], color:{ bg:'#fffbeb', icon:'#b45309' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg> },
  { key:'fc', label:'Fulfilment Center', desc:'Dispatch & delivery', path:'/fc', roles:['fc_kaveri','fc_godawari','ops','admin','management'], color:{ bg:'#fff7ed', icon:'#c2410c' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg> },
  { key:'billing', label:'Billing', desc:'Invoices & accounts', path:'/billing', roles:['accounts','ops','admin','management'], color:{ bg:'#faf5ff', icon:'#0F766E' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  { key:'procurement', label:'Procurement', desc:'Purchase orders & GRN', path:'/procurement', roles:['ops','admin','management'], color:{ bg:'#fef3c7', icon:'#b45309' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> },
  { key:'item360', label:'Item 360', desc:'Product master catalog', path:'/items', roles:['ops','admin','management','accounts'], color:{ bg:'#f0f9ff', icon:'#0369a1' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg> },
  { key:'vendor360', label:'Vendor 360', desc:'Vendor profiles & contacts', path:'/vendors', roles:['ops','admin','management'], color:{ bg:'#e0f2fe', icon:'#0369a1' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg> },
  { key:'people', label:'People', desc:'KRA / KPI & team', path:'/people/kpi', roles:['sales','ops','admin','management','accounts','fc_kaveri','fc_godawari'], color:{ bg:'#ecfeff', icon:'#0e7490' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> },
  { key:'upload', label:'Upload', desc:'Sync inventory data', path:'/uploads', roles:['admin','accounts'], color:{ bg:'#e8f2fc', icon:'#1a4dab' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
  { key:'users', label:'Users', desc:'Manage users & emails', path:'/admin/users', roles:['admin'], color:{ bg:'#f1f5f9', icon:'#475569' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 15a6 6 0 00-6 6h12a6 6 0 00-6-6z"/><circle cx="12" cy="8" r="4"/></svg> },
]

const FC_ACTION_STATUSES = ['delivery_created','picking','packing']
const BILLING_ACTION_STATUSES = ['pi_requested','goods_issued','goods_issue_posted','delivery_ready']

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'' })
  const [loading, setLoading] = useState(true)
  const [m, setM] = useState({
    crmOpenValue: 0, crmOpenCount: 0,
    ordersActive: 0, ordersPending: 0,
    fcAction: 0, fcDelivered: 0,
    procOpenPOs: 0, procOpenPOValue: 0, procPendingAppr: 0,
    billingAction: 0, billingOverrides: 0,
    invLow: 0, invZero: 0,
  })

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
    setUser({ name: profile?.name || session.user.email.split('@')[0], role })
    if (role === 'demo') { setLoading(false); return }

    const isAdmin = ['admin','management','ops'].includes(role)
    const queries = []

    queries.push(sb.from('crm_opportunities').select('estimated_value_inr,stage').not('stage','in','(WON,LOST,ON_HOLD)'))
    queries.push(sb.from('orders').select('status').gte('created_at', FY_START).eq('is_test', false))
    if (isAdmin) {
      queries.push(sb.from('purchase_orders').select('status,total_amount').eq('is_test', false).gte('created_at', FY_START))
      queries.push(sb.from('inventory').select('quantity'))
    }

    const results = await Promise.all(queries)
    const crmRes = results[0]
    const ordersRes = results[1]
    const poRes = isAdmin ? results[2] : { data: [] }
    const invRes = isAdmin ? results[3] : { data: [] }

    const crmOpen = crmRes.data || []
    const orders = ordersRes.data || []
    const pos = poRes.data || []
    const inv = invRes.data || []

    setM({
      crmOpenValue: crmOpen.reduce((s, o) => s + (o.estimated_value_inr || 0), 0),
      crmOpenCount: crmOpen.length,
      ordersActive: orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length,
      ordersPending: orders.filter(o => o.status === 'pending').length,
      fcAction: orders.filter(o => FC_ACTION_STATUSES.includes(o.status)).length,
      fcDelivered: orders.filter(o => o.status === 'dispatched_fc').length,
      procOpenPOs: pos.filter(p => !['material_received','closed','cancelled'].includes(p.status)).length,
      procOpenPOValue: pos.filter(p => !['material_received','closed','cancelled'].includes(p.status)).reduce((s, p) => s + (p.total_amount || 0), 0),
      procPendingAppr: pos.filter(p => p.status === 'pending_approval').length,
      billingAction: orders.filter(o => BILLING_ACTION_STATUSES.includes(o.status)).length,
      billingOverrides: 0,
      invLow: inv.filter(i => i.quantity > 0 && i.quantity <= 5).length,
      invZero: inv.filter(i => i.quantity === 0).length,
    })
    setLoading(false)
  }

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name.split(' ')[0] || ''
  const dateStr = now.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })

  const visibleApps = user.role === 'demo'
    ? APPS.filter(a => !['upload','users'].includes(a.key))
    : APPS.filter(a => a.roles.includes('all') || a.roles.includes(user.role))

  function role(roleArr) { return roleArr.includes('all') || roleArr.includes(user.role) }

  // Build module KPI tiles based on role access
  const moduleKpis = []
  if (role(['all'])) {
    moduleKpis.push({
      key:'crm', tone:'deep', label:'CRM · Open Pipeline', value: fmtMoneyShort(m.crmOpenValue), sub:`${m.crmOpenCount} active opportunities`,
      path:'/crm', icon:'pipeline'
    })
  }
  if (role(['all'])) {
    moduleKpis.push({
      key:'orders', tone:'forest', label:'Orders · Active', value: m.ordersActive, sub: m.ordersPending > 0 ? `${m.ordersPending} pending approval` : 'in pipeline',
      path:'/orders', icon:'cart'
    })
  }
  if (role(['fc_kaveri','fc_godawari','ops','admin','management','accounts'])) {
    moduleKpis.push({
      key:'fc', tone:'teal', label:'FC · Action Required', value: m.fcAction, sub:`${m.fcDelivered} delivered FYTD`,
      path:'/fc', icon:'truck'
    })
  }
  if (role(['ops','admin','management'])) {
    moduleKpis.push({
      key:'procurement', label:'Procurement · Open POs', value: m.procOpenPOs, sub: fmtMoneyShort(m.procOpenPOValue) + ' value', accent: m.procPendingAppr > 0 ? 'amber' : null, badge: m.procPendingAppr > 0 ? `${m.procPendingAppr} need approval` : null,
      path:'/procurement', icon:'po'
    })
  }
  if (role(['accounts','ops','admin','management'])) {
    moduleKpis.push({
      key:'billing', label:'Billing · Action Needed', value: m.billingAction, sub:'credit · invoice · e-way', accent: m.billingAction > 0 ? 'amber' : null,
      path:'/billing', icon:'invoice'
    })
  }
  if (role(['sales','admin','management','ops'])) {
    moduleKpis.push({
      key:'inventory', label:'Inventory · Low Stock', value: m.invLow + m.invZero, sub:`${m.invZero} out of stock`, accent: (m.invLow + m.invZero) > 0 ? 'amber' : null,
      path:'/inventory', icon:'box'
    })
  }

  return (
    <Layout pageTitle="Home" pageKey="home">
      <div className="hd-content">

        {/* Greeting */}
        <div className="hd-hero">
          <div className="hd-greeting">{greeting}, <strong>{firstName}</strong></div>
          <div className="hd-date">{dateStr} · {FY_LABEL}</div>
        </div>

        {/* Module KPIs */}
        {!loading && moduleKpis.length > 0 && (
          <div className="hd-section-label" style={{ marginTop: 4 }}>At a glance</div>
        )}
        <div className="hd-module-kpis">
          {moduleKpis.map(k => (
            <KpiTile key={k.key} {...k} onClick={() => navigate(k.path)}/>
          ))}
        </div>

        {/* Apps */}
        <div className="hd-apps-section">
          <div className="hd-section-label">Applications</div>
          <div className="hd-apps-grid">
            {visibleApps.map(app => (
              <div key={app.key}
                className={'hd-app-card' + (!app.path ? ' hd-app-soon' : '')}
                onClick={() => app.path && navigate(app.path)}>
                <div className="hd-app-icon-box" style={{ background: app.color.bg, color: app.color.icon }}>
                  {app.icon}
                </div>
                <div className="hd-app-info">
                  <div className="hd-app-name">{app.label}</div>
                  <div className="hd-app-desc">{app.desc}</div>
                </div>
                {app.path && (
                  <div className="hd-app-arrow">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                  </div>
                )}
                {!app.path && <div className="hd-app-soon-badge">Soon</div>}
              </div>
            ))}
          </div>
        </div>

      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, badge, tone, onClick }) {
  const isHero = !!tone
  return (
    <div className={`hd-kpi-tile ${isHero ? `hd-kpi-hero hd-tone-${tone}` : ''} ${accent ? `hd-accent-${accent}` : ''}`} onClick={onClick}>
      {isHero && <KpiChartBg tone={tone}/>}
      <div className="hd-kpi-top">
        <div className="hd-kpi-label">{label}</div>
        <span className="hd-kpi-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>
      </div>
      <div className="hd-kpi-value">{value}</div>
      <div className="hd-kpi-foot">
        {sub && <div className="hd-kpi-sub mono">{sub}</div>}
        {badge && <span className="hd-kpi-badge mono">{badge}</span>}
      </div>
    </div>
  )
}

function KpiChartBg({ tone }) {
  if (tone === 'forest' || tone === 'teal') {
    return (
      <svg className="hd-kpi-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
        {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
          <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
        ))}
      </svg>
    )
  }
  return (
    <svg className="hd-kpi-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
}
