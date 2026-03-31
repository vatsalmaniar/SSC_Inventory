import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import './layout.css'

const NAV_ITEMS = [
  {
    key: 'home',
    label: 'Home',
    path: '/dashboard',
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/sales',
    roles: ['sales', 'admin', 'ops'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>,
  },
  {
    key: 'orders',
    label: 'Orders',
    path: '/orders',
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  },
  {
    key: 'people',
    label: 'People',
    path: null,
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    key: 'crm',
    label: 'CRM',
    path: null,
    roles: ['all'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  },
  {
    key: 'upload',
    label: 'Upload',
    path: '/accounts',
    roles: ['admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  },
]

export default function Layout({ children, pageTitle, pageKey }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const bellRef   = useRef(null)
  const [user, setUser]           = useState({ name: '', avatar: '', role: '' })
  const [notifs, setNotifs]       = useState([])
  const [showNotifs, setShowNotifs] = useState(false)

  useEffect(() => {
    sb.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        const { data } = await sb.auth.refreshSession()
        if (!data?.session) { navigate('/login'); return }
      }
      const s = session || (await sb.auth.getSession()).data.session
      if (!s) return
      const { data: profile } = await sb.from('profiles').select('name,role').eq('id', s.user.id).single()
      const name   = profile?.name || s.user.email.split('@')[0]
      const role   = profile?.role || 'sales'
      const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      setUser({ name, avatar, role })
      loadNotifs(name)
    })
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function loadNotifs(name) {
    const { data } = await sb.from('notifications')
      .select('*')
      .eq('user_name', name)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifs(data || [])
  }

  async function markAllRead(name) {
    const unreadIds = notifs.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return
    await sb.from('notifications').update({ is_read: true }).in('id', unreadIds)
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  function fmtNotifTime(d) {
    if (!d) return ''
    const dt = new Date(d)
    const now = new Date()
    const diff = Math.floor((now - dt) / 60000)
    if (diff < 1) return 'Just now'
    if (diff < 60) return diff + 'm ago'
    if (diff < 1440) return Math.floor(diff / 60) + 'h ago'
    return Math.floor(diff / 1440) + 'd ago'
  }

  async function signOut() { await sb.auth.signOut(); navigate('/login') }

  const activeKey = pageKey || location.pathname.split('/')[1] || 'home'

  const visibleNav = NAV_ITEMS.filter(n => n.roles.includes('all') || n.roles.includes(user.role))

  return (
    <div className="ly-wrap">

      {/* ── Sidebar ── */}
      <aside className="ly-sidebar">

        <div className="ly-logo-row">
          <div className="ly-logo-icon">
            <img src="/ssc-logo.svg" alt="SSC Control" />
          </div>
        </div>

        <div className="ly-nav-section">
          <div className="ly-nav-label">Menu</div>
          {visibleNav.slice(0, 5).map(item => (
            <button
              key={item.key}
              className={'ly-nav-item' + (activeKey === item.key || (item.path && location.pathname.startsWith(item.path) && item.path !== '/dashboard') ? ' active' : '') + (!item.path ? ' soon' : '')}
              onClick={() => item.path && navigate(item.path)}
              title={!item.path ? item.label + ' — Coming Soon' : ''}
            >
              <span className="ly-nav-icon">{item.icon}</span>
              {item.label}
              {!item.path && <span className="ly-soon-pill">Soon</span>}
            </button>
          ))}
          {visibleNav.find(n => n.key === 'upload') && (
            <button
              className={'ly-nav-item' + (activeKey === 'upload' || location.pathname === '/accounts' ? ' active' : '')}
              onClick={() => navigate('/accounts')}
            >
              <span className="ly-nav-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              </span>
              Upload
            </button>
          )}
        </div>

        <div className="ly-nav-section ly-nav-bottom">
          <div className="ly-nav-label">Account</div>
          <div className="ly-nav-item ly-nav-user">
            <div className="ly-user-dot">{user.avatar}</div>
            <span className="ly-user-fullname">{user.name || '...'}</span>
          </div>
          <button className="ly-nav-item" onClick={signOut}>
            <span className="ly-nav-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </span>
            Logout
          </button>
        </div>

      </aside>

      {/* ── Main ── */}
      <div className="ly-main">

        {/* Topbar */}
        <header className="ly-topbar">
          <div className="ly-topbar-left">
            <span className="ly-topbar-app">SSC Control</span>
            <span className="ly-topbar-sep">/</span>
            <span className="ly-topbar-page">{pageTitle || 'Home'}</span>
          </div>
          <div className="ly-topbar-right">
            {/* Bell */}
            <div className="ly-bell-wrap" ref={bellRef}>
              <button
                className="ly-bell-btn"
                onClick={() => {
                  setShowNotifs(v => !v)
                  if (!showNotifs) markAllRead(user.name)
                }}
              >
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" width="20" height="20">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 01-3.46 0"/>
                </svg>
                {notifs.filter(n => !n.is_read).length > 0 && (
                  <span className="ly-bell-badge">{notifs.filter(n => !n.is_read).length}</span>
                )}
              </button>
              {showNotifs && (
                <div className="ly-notif-dropdown">
                  <div className="ly-notif-header">
                    <span>Notifications</span>
                    {notifs.filter(n => !n.is_read).length > 0 && (
                      <button className="ly-notif-markread" onClick={() => markAllRead(user.name)}>Mark all read</button>
                    )}
                  </div>
                  {notifs.length === 0 ? (
                    <div className="ly-notif-empty">No notifications</div>
                  ) : (
                    <div className="ly-notif-list">
                      {notifs.map(n => (
                        <div
                          key={n.id}
                          className={'ly-notif-item' + (n.is_read ? '' : ' unread')}
                          onClick={() => { setShowNotifs(false); if (n.order_id) navigate('/orders/' + n.order_id) }}
                        >
                          <div className="ly-notif-msg">{n.message}</div>
                          <div className="ly-notif-time">{fmtNotifTime(n.created_at)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ly-user-chip">
              <div className="ly-user-avatar">{user.avatar || '?'}</div>
              <span className="ly-user-name">{user.name || '...'}</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="ly-content">
          {children}
        </div>

      </div>
    </div>
  )
}
