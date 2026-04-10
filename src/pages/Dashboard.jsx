import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START, FY_LABEL } from '../lib/fmt'
import '../styles/dashboard.css'

const APPS = [
  {
    key: 'crm', label: 'CRM', desc: 'Leads & opportunities', path: '/crm',
    roles: ['all'],
    color: { bg: '#eef2ff', icon: '#4338ca' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  },
  {
    key: 'customer360', label: 'Customer 360', desc: 'Accounts & profiles', path: '/customers',
    roles: ['sales', 'ops', 'admin'],
    color: { bg: '#f0fdfa', icon: '#0f766e' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="19" cy="8" r="2.5"/><path d="M21.5 14c-.8-.9-2-1.5-3.5-1.5"/><circle cx="5" cy="8" r="2.5"/><path d="M2.5 14c.8-.9 2-1.5 3.5-1.5"/></svg>,
  },
  {
    key: 'inventory', label: 'Inventory', desc: 'Stock & availability', path: '/sales',
    roles: ['sales', 'admin', 'ops'],
    color: { bg: '#f0fdf4', icon: '#15803d' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>,
  },
  {
    key: 'orders', label: 'Orders', desc: 'Create & track orders', path: '/orders',
    roles: ['all'],
    color: { bg: '#fffbeb', icon: '#b45309' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  },
  {
    key: 'people', label: 'People', desc: 'Team & permissions', path: null,
    roles: ['all'],
    color: { bg: '#f1f5f9', icon: '#475569' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    key: 'fc', label: 'Fulfilment Center', desc: 'Dispatch & delivery', path: '/fc',
    roles: ['fc_kaveri', 'fc_godawari', 'ops', 'admin'],
    color: { bg: '#fff7ed', icon: '#c2410c' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>,
  },
  {
    key: 'billing', label: 'Billing', desc: 'Invoices & accounts', path: '/billing',
    roles: ['accounts', 'ops', 'admin'],
    color: { bg: '#faf5ff', icon: '#7e22ce' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  },
  {
    key: 'procurement', label: 'Procurement', desc: 'Purchase orders & GRN', path: '/procurement',
    roles: ['ops', 'admin'],
    color: { bg: '#fef3c7', icon: '#b45309' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
  },
  {
    key: 'vendor360', label: 'Vendor 360', desc: 'Vendor profiles & contacts', path: '/vendors',
    roles: ['ops', 'admin'],
    color: { bg: '#e0f2fe', icon: '#0369a1' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>,
  },
  {
    key: 'upload', label: 'Upload', desc: 'Sync inventory data', path: '/accounts',
    roles: ['admin', 'accounts'],
    color: { bg: '#e8f2fc', icon: '#1a4dab' },
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [activeKey, setActiveKey] = useState('home')
  const [stats, setStats]     = useState({ active: 0, pending: 0, delivered: 0, revenue: 0 })

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
      session = data.session
    }
    const [{ data: profile }, { data: orders }] = await Promise.all([
      sb.from('profiles').select('name,role').eq('id', session.user.id).single(),
      sb.from('orders').select('status,freight,order_items(total_price)').gte('created_at', FY_START).eq('is_test', false),
    ])
    const name   = profile?.name || session.user.email.split('@')[0]
    const role   = profile?.role || 'sales'
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
    if (orders) {
      const active    = orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length
      const pending   = orders.filter(o => o.status === 'pending').length
      const delivered = orders.filter(o => o.status === 'dispatched_fc').length
      const revenue   = orders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.order_items || []).reduce((a, i) => a + (i.total_price || 0), 0) + (o.freight || 0), 0)
      setStats({ active, pending, delivered, revenue })
    }
  }

  async function signOut() { await sb.auth.signOut(); navigate('/login') }

  function fmtVal(v) {
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + ' Cr'
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L'
    return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  }

  const now      = new Date()
  const hour     = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user.name.split(' ')[0] || '...'
  const dateStr   = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const visibleApps = APPS.filter(a => a.roles.includes('all') || a.roles.includes(user.role))

  function openApp(app) {
    if (!app.path) return
    setActiveKey(app.key)
    navigate(app.path)
  }

  const STATS = [
    {
      label: 'Active Orders', num: stats.active, trend: 'neu', trendLabel: 'in pipeline',
      path: '/orders/list',
      icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>,
      bg: '#e8f2fc', color: '#1a4dab',
    },
    {
      label: 'Pending Review', num: stats.pending, trend: stats.pending > 0 ? 'warn' : 'neu', trendLabel: 'need action',
      path: '/ops',
      icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      bg: '#fffbeb', color: '#b45309',
    },
    {
      label: 'Delivered', num: stats.delivered, trend: 'up', trendLabel: 'completed',
      path: '/orders/list',
      icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>,
      bg: '#f0fdf4', color: '#16a34a',
    },
    {
      label: 'Total Revenue', num: fmtVal(stats.revenue), trend: 'up', trendLabel: FY_LABEL,
      path: '/orders',
      icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>,
      bg: '#f5f3ff', color: '#7e22ce',
    },
  ]

  return (
    <div className="hd-wrap">

      {/* ── Sidebar ── */}
      <aside className="hd-sidebar">
        <div className="hd-logo-row">
          <div className="hd-logo-icon"><img src="/ssc-logo.svg" alt="SSC" /></div>
        </div>

        <div className="hd-nav-section">
          <div className="hd-nav-label">Menu</div>
          <button className={'hd-nav-item' + (activeKey === 'home' ? ' active' : '')} onClick={() => setActiveKey('home')}>
            <span className="hd-nav-item-icon"><svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
            Home
          </button>
          {visibleApps.map(app => (
            <button key={app.key}
              className={'hd-nav-item' + (activeKey === app.key ? ' active' : '') + (!app.path ? ' soon' : '')}
              onClick={() => openApp(app)}>
              <span className="hd-nav-item-icon">{app.icon}</span>
              {app.label}
              {!app.path && <span className="hd-soon-pill">Soon</span>}
            </button>
          ))}
        </div>

        <div className="hd-nav-section" style={{ marginTop: 'auto' }}>
          <div className="hd-nav-label">Account</div>
          <button className="hd-nav-item" onClick={signOut} style={{ color:'#dc2626' }}>
            <span className="hd-nav-item-icon"><svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="hd-main">

        <header className="hd-topbar">
          <nav className="hd-topnav">
            {visibleApps.filter(a => a.path).map(app => (
              <button key={app.key}
                className={'hd-topnav-item' + (activeKey === app.key ? ' active' : '')}
                onClick={() => openApp(app)}>
                {app.label}
              </button>
            ))}
          </nav>
          <div className="hd-user-chip">
            <div className="hd-user-avatar">{user.avatar || '?'}</div>
            <span className="hd-user-name">{user.name || '...'}</span>
          </div>
        </header>

        <div className="hd-content">

          {/* Greeting */}
          <div className="hd-hero">
            <div className="hd-greeting">{greeting}, <strong>{firstName}</strong></div>
            <div className="hd-date">{dateStr}</div>
          </div>

          {/* Stats */}
          <div className="hd-stats">
            {STATS.map((s, i) => (
              <div key={i} className="hd-stat" onClick={() => navigate(s.path)}>
                <div className="hd-stat-top">
                  <div className="hd-stat-lbl">{s.label}</div>
                  <div className="hd-stat-icon-wrap" style={{ background: s.bg, color: s.color }}>{s.icon}</div>
                </div>
                <div className="hd-stat-num">{s.num}</div>
                <span className={'hd-stat-trend ' + s.trend}>{s.trendLabel}</span>
              </div>
            ))}
          </div>

          {/* Apps */}
          <div className="hd-apps-section">
            <div className="hd-section-label">Applications</div>
            <div className="hd-apps-grid">
              {visibleApps.map(app => (
                <div key={app.key}
                  className={'hd-app-card' + (!app.path ? ' hd-app-soon' : '')}
                  onClick={() => openApp(app)}>
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
      </div>
    </div>
  )
}
