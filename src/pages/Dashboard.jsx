import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import '../styles/dashboard.css'

const FUN_FACTS = [
  "A day on Venus is longer than a year on Venus — it rotates slower than it orbits the Sun.",
  "Honey never expires. Archaeologists found 3,000-year-old honey in Egyptian tombs that was still edible.",
  "The Eiffel Tower grows about 15 cm taller in summer due to thermal expansion of iron.",
  "Octopuses have three hearts, blue blood, and nine brains — one central and one per tentacle.",
  "A group of flamingos is called a 'flamboyance'. Fitting.",
  "The shortest war in history lasted 38–45 minutes — between Britain and Zanzibar in 1896.",
  "Bananas are slightly radioactive due to their potassium content.",
  "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.",
  "The human nose can detect over 1 trillion different scents.",
  "A bolt of lightning is five times hotter than the surface of the Sun.",
  "There are more possible iterations of a game of chess than atoms in the observable universe.",
  "The dot over the letters 'i' and 'j' is called a tittle.",
  "Wombat poop is cube-shaped — the only animal in the world to produce cubic waste.",
  "Scotland's national animal is the unicorn.",
  "Cleopatra lived closer to the invention of the iPhone than to the construction of the Great Pyramid.",
]

const APPS = [
  {
    key: 'crm', label: 'CRM', path: null,
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  },
  {
    key: 'inventory', label: 'Inventory', path: '/sales',
    roles: ['sales', 'admin', 'ops'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>,
  },
  {
    key: 'orders', label: 'Orders', path: '/orders',
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  },
  {
    key: 'people', label: 'People', path: null,
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    key: 'fc', label: 'Fulfilment Center', path: '/fc',
    roles: ['fc_kaveri', 'fc_godawari', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>,
  },
  {
    key: 'billing', label: 'Billing', path: '/billing',
    roles: ['accounts', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  },
  {
    key: 'upload', label: 'Upload', path: '/accounts',
    roles: ['admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  },
]

export default function Dashboard() {
  const navigate = useNavigate()
  const [user, setUser]       = useState({ name: '', avatar: '', role: '' })
  const [activeKey, setActiveKey] = useState('home')
  const [fact] = useState(FUN_FACTS[Math.floor(Math.random() * FUN_FACTS.length)])

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
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    setUser({ name, avatar, role })
  }

  async function signOut() { await sb.auth.signOut(); navigate('/login') }

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

  return (
    <div className="hd-wrap">

      {/* ── Sidebar ── */}
      <aside className="hd-sidebar">

        {/* Logo */}
        <div className="hd-logo-row">
          <div className="hd-logo-icon">
            <img src="/ssc-logo.svg" alt="SSC" />
          </div>
        </div>

        {/* Nav */}
        <div className="hd-nav-section">
          <div className="hd-nav-label">Menu</div>

          <button
            className={'hd-nav-item' + (activeKey === 'home' ? ' active' : '')}
            onClick={() => setActiveKey('home')}
          >
            <span className="hd-nav-item-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            </span>
            Home
          </button>

          {visibleApps.map(app => (
            <button
              key={app.key}
              className={'hd-nav-item' + (activeKey === app.key ? ' active' : '') + (!app.path ? ' soon' : '')}
              onClick={() => openApp(app)}
              title={!app.path ? app.label + ' — Coming Soon' : ''}
            >
              <span className="hd-nav-item-icon">{app.icon}</span>
              {app.label}
              {!app.path && <span className="hd-soon-pill">Soon</span>}
            </button>
          ))}
        </div>

        <div className="hd-nav-section">
          <div className="hd-nav-label">Account</div>
          <button className="hd-nav-item" onClick={signOut}>
            <span className="hd-nav-item-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </span>
            Logout
          </button>
        </div>

      </aside>

      {/* ── Main ── */}
      <div className="hd-main">

        {/* Top nav */}
        <header className="hd-topbar">
          <nav className="hd-topnav">
            {visibleApps.filter(a => a.path).map(app => (
              <button
                key={app.key}
                className={'hd-topnav-item' + (activeKey === app.key ? ' active' : '')}
                onClick={() => openApp(app)}
              >
                {app.label}
              </button>
            ))}
          </nav>
          <div className="hd-user-chip">
            <div className="hd-user-avatar">{user.avatar || '?'}</div>
            <span className="hd-user-name">{user.name || '...'}</span>
          </div>
        </header>

        {/* Content */}
        <div className="hd-content">

          {/* Greeting */}
          <div className="hd-greeting">{greeting}, {firstName}</div>
          <div className="hd-date">{dateStr}</div>

          {/* Fun fact */}
          <div className="hd-fact-card">
            <div className="hd-fact-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
              </svg>
            </div>
            <div>
              <div className="hd-fact-label">Did you know?</div>
              <div className="hd-fact-text">{fact}</div>
            </div>
          </div>

          {/* Apps */}
          <div className="hd-section-label">Applications</div>
          <div className="hd-apps-grid">
            {visibleApps.map(app => (
              <div
                key={app.key}
                className={'hd-app-card' + (!app.path ? ' hd-app-soon' : '')}
                onClick={() => openApp(app)}
              >
                <div className="hd-app-icon-box">
                  {app.icon}
                </div>
                <div className="hd-app-name">{app.label}</div>
                {!app.path && <div className="hd-app-soon-badge">Soon</div>}
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  )
}
