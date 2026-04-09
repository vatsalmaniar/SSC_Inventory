import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import './layout.css'

const NAV_ITEMS = [
  {
    key: 'home',
    label: 'Home',
    path: '/dashboard',
    roles: ['sales', 'ops', 'admin', 'accounts', 'fc_kaveri', 'fc_godawari'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    key: 'crm',
    label: 'CRM',
    path: '/crm',
    roles: ['sales', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
  },
  {
    key: 'customer360',
    label: 'Customer 360',
    path: '/customers',
    roles: ['sales', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="19" cy="8" r="2.5"/><path d="M21.5 14c-.8-.9-2-1.5-3.5-1.5"/><circle cx="5" cy="8" r="2.5"/><path d="M2.5 14c.8-.9 2-1.5 3.5-1.5"/></svg>,
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
    roles: ['sales', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  },
  {
    key: 'people',
    label: 'People',
    path: null,
    roles: ['sales', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    key: 'fc',
    label: 'Fulfilment Center',
    path: '/fc',
    roles: ['fc_kaveri', 'fc_godawari', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>,
  },
  {
    key: 'billing',
    label: 'Billing',
    path: '/billing',
    roles: ['accounts', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
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
  const searchRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchTimer = useRef(null)
  const [user, setUser]           = useState({ name: '', avatar: '', role: '' })
  const [notifs, setNotifs]       = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [searchQ, setSearchQ]     = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState({ orders: [], companies: [], leads: [], opportunities: [] })

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
      setUser({ name, avatar, role, id: s.user.id })
      loadNotifs(s.user.id)
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

  async function loadNotifs(userId) {
    const { data } = await sb.from('notifications')
      .select('*')
      .eq('user_id', userId)
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

  // Close search on outside click
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInputRef.current?.focus(); setSearchOpen(true) }
      if (e.key === 'Escape') { setSearchOpen(false); setSearchQ('') }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [])

  function onSearchChange(e) {
    const q = e.target.value
    setSearchQ(q)
    clearTimeout(searchTimer.current)
    if (q.trim().length < 2) { setSearchResults({ orders: [], companies: [], leads: [], opportunities: [] }); setSearchOpen(q.length > 0); return }
    setSearchLoading(true)
    setSearchOpen(true)
    searchTimer.current = setTimeout(() => doSearch(q.trim()), 300)
  }

  async function doSearch(q) {
    const role = user.role
    const canCRM = ['sales', 'ops', 'admin'].includes(role)
    const canOrders = ['sales', 'ops', 'admin', 'accounts', 'fc_kaveri', 'fc_godawari'].includes(role)
    const [ordersRes, companiesRes, leadsRes, oppsRes] = await Promise.all([
      canOrders ? sb.from('orders').select('id,order_number,customer_name,status').or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`).eq('is_test', false).limit(5) : { data: [] },
      canCRM    ? sb.from('customers').select('id,customer_name').ilike('customer_name', `%${q}%`).limit(5) : { data: [] },
      canCRM    ? sb.from('crm_leads').select('id,contact_name_freetext,freetext_company,stage').or(`contact_name_freetext.ilike.%${q}%,freetext_company.ilike.%${q}%`).limit(5) : { data: [] },
      canCRM    ? sb.from('crm_opportunities').select('id,opportunity_name,product_notes,stage').or(`opportunity_name.ilike.%${q}%,product_notes.ilike.%${q}%`).limit(5) : { data: [] },
    ])
    setSearchResults({
      orders:        ordersRes.data || [],
      companies:     companiesRes.data || [],
      leads:         leadsRes.data || [],
      opportunities: oppsRes.data || [],
    })
    setSearchLoading(false)
  }

  function goToResult(path) {
    setSearchOpen(false)
    setSearchQ('')
    navigate(path)
  }

  const totalResults = searchResults.orders.length + searchResults.companies.length + searchResults.leads.length + searchResults.opportunities.length

  const STATUS_LABEL = { pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partially Shipped', delivery_created:'At FC', picking:'Picking', packing:'Packing', goods_issued:'Goods Issued', invoice_generated:'Invoiced', dispatched_fc:'Delivered', cancelled:'Cancelled' }

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
          {visibleNav.map(item => (
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
        </div>

        <div className="ly-nav-section ly-nav-bottom">
          <div className="ly-nav-label">Account</div>
          <div className="ly-nav-item ly-nav-user">
            <div className="ly-user-dot">{user.avatar}</div>
            <span className="ly-user-fullname">{user.name || '...'}</span>
          </div>
          <button className="ly-nav-item" onClick={signOut} style={{ color:'#dc2626' }}>
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
            <span className="ly-topbar-app">SSC ERP</span>
            <span className="ly-topbar-sep">/</span>
            <span className="ly-topbar-page">{pageTitle || 'Home'}</span>
          </div>
          {/* Global Search */}
          <div ref={searchRef} style={{position:'relative',flex:1,maxWidth:400,margin:'0 24px'}}>
            <div style={{display:'flex',alignItems:'center',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:10,padding:'0 12px',gap:8,transition:'border-color 0.15s',borderColor:searchOpen?'#1a4dab':'var(--gray-200)'}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:15,height:15,color:'var(--gray-400)',flexShrink:0}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                ref={searchInputRef}
                value={searchQ}
                onChange={onSearchChange}
                onFocus={() => { if (searchQ.length >= 2) setSearchOpen(true) }}
                placeholder="Search orders, customers, leads… (⌘K)"
                style={{flex:1,border:'none',background:'none',outline:'none',fontFamily:'var(--font)',fontSize:13,color:'var(--gray-900)',padding:'8px 0'}}
              />
              {searchQ && <button onClick={() => { setSearchQ(''); setSearchOpen(false); setSearchResults({ orders:[], companies:[], leads:[], opportunities:[] }) }} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',padding:0,lineHeight:1}}>✕</button>}
              {!searchQ && <span style={{fontSize:11,color:'var(--gray-300)',background:'var(--gray-100)',border:'1px solid var(--gray-200)',borderRadius:4,padding:'2px 5px',flexShrink:0}}>⌘K</span>}
            </div>
            {searchOpen && (
              <div style={{position:'absolute',top:'calc(100% + 6px)',left:0,right:0,background:'white',border:'1px solid var(--gray-200)',borderRadius:12,boxShadow:'0 8px 32px rgba(0,0,0,0.12)',zIndex:9999,overflow:'hidden',maxHeight:440,overflowY:'auto'}}>
                {searchLoading ? (
                  <div style={{padding:'20px',textAlign:'center',color:'var(--gray-400)',fontSize:13}}>Searching…</div>
                ) : searchQ.length < 2 ? (
                  <div style={{padding:'16px 18px',fontSize:12,color:'var(--gray-400)'}}>Type at least 2 characters to search</div>
                ) : totalResults === 0 ? (
                  <div style={{padding:'20px',textAlign:'center',color:'var(--gray-400)',fontSize:13}}>No results for "{searchQ}"</div>
                ) : (
                  <>
                    {searchResults.orders.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Orders</div>
                        {searchResults.orders.map(o => (
                          <div key={o.id} onClick={() => goToResult('/orders/'+o.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#e8f2fc',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#1a4dab" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#1a4dab'}}>{o.order_number}</div>
                              <div style={{fontSize:12,color:'var(--gray-500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.customer_name}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:4,background:'var(--gray-100)',color:'var(--gray-500)',flexShrink:0}}>{STATUS_LABEL[o.status] || o.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.companies.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Customer 360</div>
                        {searchResults.companies.map(c => (
                          <div key={c.id} onClick={() => goToResult('/customers/'+c.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#f0fdf4',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#059669" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:600,color:'var(--gray-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.customer_name}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#f0fdf4',color:'#059669',flexShrink:0,fontWeight:600}}>Customer</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.leads.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Leads</div>
                        {searchResults.leads.map(l => (
                          <div key={l.id} onClick={() => goToResult('/crm/leads/'+l.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:600,color:'var(--gray-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.contact_name_freetext || '—'}</div>
                              {l.freetext_company && <div style={{fontSize:11,color:'var(--gray-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.freetext_company}</div>}
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#fef3c7',color:'#d97706',flexShrink:0,fontWeight:600}}>{l.stage || 'Lead'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.opportunities.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Opportunities</div>
                        {searchResults.opportunities.map(o => (
                          <div key={o.id} onClick={() => goToResult('/crm/opportunities/'+o.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#f5f3ff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#7c3aed" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:600,color:'var(--gray-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{o.opportunity_name || o.product_notes || '—'}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#f5f3ff',color:'#7c3aed',flexShrink:0,fontWeight:600}}>{o.stage || 'Opp'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
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
