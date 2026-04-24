import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb, checkSessionAge } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtime'
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
    sub: [
      { key: 'crm-dash',  label: 'Dashboard',     path: '/crm' },
      { key: 'crm-opps',  label: 'Opportunities', path: '/crm/opportunities' },
      { key: 'crm-visits', label: 'Field Visits',  path: '/crm/visits' },
    ],
  },
  {
    key: 'orders',
    label: 'Orders',
    path: '/orders',
    roles: ['sales', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
    sub: [
      { key: 'orders-dash', label: 'Dashboard',  path: '/orders' },
      { key: 'orders-list', label: 'All Orders',  path: '/orders/list' },
    ],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    path: '/procurement',
    roles: ['ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
    sub: [
      { key: 'proc-dash', label: 'Dashboard',       path: '/procurement' },
      { key: 'proc-po',   label: 'Purchase Orders',  path: '/procurement/po' },
      { key: 'proc-co',   label: 'CO Orders',        path: '/procurement/orders' },
    ],
  },
  {
    key: 'fc',
    label: 'Fulfilment Center',
    path: '/fc',
    roles: ['fc_kaveri', 'fc_godawari', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="1.5"/><circle cx="18.5" cy="18.5" r="1.5"/></svg>,
    sub: [
      { key: 'fc-dash', label: 'Dashboard',  path: '/fc' },
      { key: 'fc-list', label: 'Deliveries', path: '/fc/list' },
      { key: 'fc-grn',  label: 'GRN',        path: '/fc/grn' },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    path: '/billing',
    roles: ['accounts', 'ops', 'admin'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    sub: [
      { key: 'bill-dash',    label: 'Dashboard',       path: '/billing' },
      { key: 'bill-dispatch', label: 'Dispatch Billing', path: '/billing/list' },
      { key: 'bill-inward',  label: 'Inward Billing',   path: '/procurement/invoices' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    path: '/sales',
    roles: ['sales', 'admin', 'ops'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg>,
    section: '360',
  },
  {
    key: 'customer360',
    label: 'Customer 360',
    path: '/customers',
    roles: ['sales', 'ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="19" cy="8" r="2.5"/><path d="M21.5 14c-.8-.9-2-1.5-3.5-1.5"/><circle cx="5" cy="8" r="2.5"/><path d="M2.5 14c.8-.9 2-1.5 3.5-1.5"/></svg>,
  },
  {
    key: 'vendor360',
    label: 'Vendor 360',
    path: '/vendors',
    roles: ['ops', 'admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>,
  },
  {
    key: 'upload',
    label: 'Upload',
    path: '/accounts',
    roles: ['admin', 'accounts'],
    icon: <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    section: 'Upload',
  },
]

export default function Layout({ children, pageTitle, pageKey }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const bellRef   = useRef(null)
  const searchRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchTimer = useRef(null)
  const [user, setUser]           = useState(() => {
    try { const c = sessionStorage.getItem('ly_user'); return c ? JSON.parse(c) : { name: '', avatar: '', role: '' } } catch { return { name: '', avatar: '', role: '' } }
  })
  const [notifs, setNotifs]       = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [collapsedSubs, setCollapsedSubs] = useState({})
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return sessionStorage.getItem('ly_sidebar_collapsed') === 'true' } catch { return false }
  })

  function toggleSidebar() {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { sessionStorage.setItem('ly_sidebar_collapsed', String(next)) } catch {}
      return next
    })
  }
  const [searchQ, setSearchQ]     = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState({ orders: [], companies: [], leads: [], opportunities: [], vendors: [], purchaseOrders: [], grns: [], purchaseInvoices: [] })

  useEffect(() => {
    // Force re-login after 24 hours
    if (!checkSessionAge()) { navigate('/login'); return }

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
      const userData = { name, avatar, role, id: s.user.id }
      setUser(userData)
      try { sessionStorage.setItem('ly_user', JSON.stringify(userData)) } catch {}
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

  // Realtime: live notification updates
  useRealtimeSubscription(`notifications-${user.id}`, {
    table:   'notifications',
    filter:  `user_id=eq.${user.id}`,
    enabled: !!user.id,
    onEvent: (payload) => {
      if (payload.eventType === 'INSERT') {
        setNotifs(prev => [payload.new, ...prev].slice(0, 30))
      } else if (payload.eventType === 'UPDATE') {
        setNotifs(prev => prev.map(n => n.id === payload.new.id ? payload.new : n))
      }
    },
  })

  async function loadNotifs(userId) {
    const { data } = await sb.from('notifications')
      .select('id,user_id,user_name,message,order_id,order_number,from_name,is_read,email_type,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifs(data || [])
  }

  async function markAllRead() {
    const unreadIds = notifs.filter(n => !n.is_read).map(n => n.id)
    if (unreadIds.length === 0) return
    await sb.from('notifications').update({ is_read: true }).in('id', unreadIds)
    setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  async function markOneRead(notif) {
    if (notif.is_read) return
    await sb.from('notifications').update({ is_read: true }).eq('id', notif.id)
    setNotifs(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
  }

  const CRM_EMAIL_TYPES = ['opportunity_won','opportunity_lost','overdue_followup']
  async function handleNotifClick(n) {
    markOneRead(n)
    setShowNotifs(false)
    // CRM notifications — look up opportunity by name (stored in order_number)
    if (CRM_EMAIL_TYPES.includes(n.email_type) || (n.email_type === 'mention' && !n.order_id)) {
      const oppName = n.order_number
      if (oppName) {
        const { data } = await sb.from('crm_opportunities').select('id').or(`opportunity_name.eq.${oppName},product_notes.eq.${oppName}`).limit(1).maybeSingle()
        if (data?.id) { navigate('/crm/opportunities/' + data.id); return }
      }
      navigate('/crm/opportunities')
      return
    }
    // New customer approval/onboarding notifications
    if (n.email_type === 'new_customer_approval' || n.email_type === 'new_customer_approved') {
      navigate('/customers')
      return
    }
    // New vendor approval
    if (n.email_type === 'new_vendor_approval') {
      navigate('/procurement/vendors')
      return
    }
    // PO-linked: CO was cancelled — navigate to the PO detail page (order_id stores PO UUID here)
    if (n.email_type === 'po_linked_co_cancelled') {
      if (n.order_id) navigate('/procurement/po/' + n.order_id)
      return
    }
    // Order-linked notifications
    if (n.order_id) navigate('/orders/' + n.order_id)
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
    if (q.trim().length < 3) { setSearchResults({ orders:[], companies:[], leads:[], opportunities:[], vendors:[], purchaseOrders:[], grns:[], purchaseInvoices:[] }); setSearchOpen(q.length > 0); return }
    setSearchLoading(true)
    setSearchOpen(true)
    searchTimer.current = setTimeout(() => doSearch(q.trim()), 600)
  }

  async function doSearch(q) {
    const role = user.role
    const canCRM = ['sales', 'ops', 'admin'].includes(role)
    const canOrders = ['sales', 'ops', 'admin', 'accounts', 'fc_kaveri', 'fc_godawari'].includes(role)
    const canProcurement = ['ops', 'admin', 'accounts'].includes(role)
    const [ordersRes, companiesRes, leadsRes, oppsRes, vendorsRes, poRes, grnRes, piRes] = await Promise.all([
      canOrders ? sb.from('orders').select('id,order_number,customer_name,status').or(`order_number.ilike.%${q}%,customer_name.ilike.%${q}%`).eq('is_test', false).limit(5) : { data: [] },
      (canCRM || canProcurement) ? sb.from('customers').select('id,customer_name').ilike('customer_name', `%${q}%`).limit(5) : { data: [] },
      canCRM    ? sb.from('crm_leads').select('id,contact_name_freetext,freetext_company,stage').or(`contact_name_freetext.ilike.%${q}%,freetext_company.ilike.%${q}%`).limit(5) : { data: [] },
      canCRM    ? sb.from('crm_opportunities').select('id,opportunity_name,product_notes,stage').or(`opportunity_name.ilike.%${q}%,product_notes.ilike.%${q}%`).limit(5) : { data: [] },
      (canCRM || canProcurement) ? sb.from('vendors').select('id,vendor_code,vendor_name,status').or(`vendor_code.ilike.%${q}%,vendor_name.ilike.%${q}%`).limit(5) : { data: [] },
      canProcurement ? sb.from('purchase_orders').select('id,po_number,vendor_name,status').or(`po_number.ilike.%${q}%,vendor_name.ilike.%${q}%`).limit(5) : { data: [] },
      canProcurement ? sb.from('grn').select('id,grn_number,grn_type,status').ilike('grn_number', `%${q}%`).limit(5) : { data: [] },
      canProcurement ? sb.from('purchase_invoices').select('id,invoice_number,vendor_name,status').or(`invoice_number.ilike.%${q}%,vendor_name.ilike.%${q}%`).limit(5) : { data: [] },
    ])
    setSearchResults({
      orders:           ordersRes.data || [],
      companies:        companiesRes.data || [],
      leads:            leadsRes.data || [],
      opportunities:    oppsRes.data || [],
      vendors:          vendorsRes.data || [],
      purchaseOrders:   poRes.data || [],
      grns:             grnRes.data || [],
      purchaseInvoices: piRes.data || [],
    })
    setSearchLoading(false)
  }

  function goToResult(path) {
    setSearchOpen(false)
    setSearchQ('')
    navigate(path)
  }

  const totalResults = searchResults.orders.length + searchResults.companies.length + searchResults.leads.length + searchResults.opportunities.length + searchResults.vendors.length + searchResults.purchaseOrders.length + searchResults.grns.length + searchResults.purchaseInvoices.length

  const STATUS_LABEL = { pending:'Pending', dispatch:'Ready to Ship', partial_dispatch:'Partially Shipped', delivery_created:'At FC', picking:'Picking', packing:'Packing', goods_issued:'Goods Issued', invoice_generated:'Invoiced', dispatched_fc:'Delivered', cancelled:'Cancelled' }

  async function signOut() { await sb.auth.signOut(); navigate('/login') }

  const activeKey = pageKey || location.pathname.split('/')[1] || 'home'

  const visibleNav = NAV_ITEMS.filter(n => n.roles.includes('all') || n.roles.includes(user.role))

  // Access denied check: if user role is loaded and pageKey doesn't match any allowed nav item
  const accessDenied = user.role && pageKey && pageKey !== 'home'
    && !NAV_ITEMS.some(n => n.key === pageKey && (n.roles.includes('all') || n.roles.includes(user.role)))

  return (
    <div className="ly-wrap">

      {/* ── Sidebar ── */}
      <aside className={'ly-sidebar' + (sidebarCollapsed ? ' collapsed' : '')}>

        <div className="ly-logo-row">
          {sidebarCollapsed ? (
            <button className="ly-collapsed-logo" onClick={toggleSidebar} title="Expand sidebar">
              <img src="/ssc-favicon.png" alt="SSC" />
            </button>
          ) : (
            <>
              <div className="ly-logo-icon">
                <img src="/logo/ssc-60-years.png" alt="SSC Control" />
              </div>
              <button className="ly-collapse-btn" onClick={toggleSidebar} title="Collapse sidebar">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:16, height:16 }}>
                  <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
                </svg>
              </button>
            </>
          )}
        </div>

        <div className="ly-nav-section">
          {!sidebarCollapsed && <div className="ly-nav-label">Menu</div>}
          {visibleNav.map((item, idx) => {
            const isActive = activeKey === item.key || (item.path && location.pathname.startsWith(item.path) && item.path !== '/dashboard')
              || (item.sub && item.sub.some(s => location.pathname === s.path || location.pathname.startsWith(s.path + '/')))
            const isExpanded = item.sub && isActive && !collapsedSubs[item.key]

            const prevItem = visibleNav[idx - 1]
            const showSection = item.section && (!prevItem || prevItem.section !== item.section)

            return (
              <div key={item.key}>
                {showSection && !sidebarCollapsed && <div className="ly-nav-label" style={{ marginTop: 12 }}>{item.section}</div>}
                <button
                  className={'ly-nav-item' + (isActive ? ' active' : '') + (!item.path ? ' soon' : '')}
                  onClick={() => {
                    if (!item.path) return
                    if (sidebarCollapsed) { navigate(item.sub ? item.sub[0].path : item.path); return }
                    if (item.sub) {
                      if (isActive) {
                        setCollapsedSubs(prev => ({ ...prev, [item.key]: !prev[item.key] }))
                      } else {
                        setCollapsedSubs(prev => ({ ...prev, [item.key]: false }))
                        navigate(item.sub[0].path)
                      }
                    } else {
                      navigate(item.path)
                    }
                  }}
                  title={sidebarCollapsed ? item.label : (!item.path ? item.label + ' — Coming Soon' : '')}
                >
                  <span className="ly-nav-icon">{item.icon}</span>
                  {!sidebarCollapsed && item.label}
                  {!sidebarCollapsed && !item.path && <span className="ly-soon-pill">Soon</span>}
                  {!sidebarCollapsed && item.sub && (
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14, marginLeft:'auto', transition:'transform 0.15s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', opacity:0.4 }}><polyline points="6 9 12 15 18 9"/></svg>
                  )}
                </button>
                {isExpanded && !sidebarCollapsed && (
                  <div style={{ display:'flex', flexDirection:'column', gap:1, paddingLeft:20, marginTop:2, marginBottom:4 }}>
                    {item.sub.map(sub => {
                      const subActive = location.pathname === sub.path || (sub.path !== item.path && location.pathname.startsWith(sub.path))
                      return (
                        <button
                          key={sub.key}
                          className="ly-nav-item"
                          style={{
                            fontSize:12.5, padding:'6px 12px', borderRadius:6,
                            background: subActive ? 'rgba(26,77,171,0.08)' : 'transparent',
                            color: subActive ? 'var(--blue-800)' : 'var(--gray-500)',
                            fontWeight: subActive ? 600 : 400,
                            borderLeft: subActive ? '2px solid var(--blue-800)' : '2px solid transparent',
                          }}
                          onClick={() => navigate(sub.path)}
                        >
                          {sub.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="ly-nav-section ly-nav-bottom">
          {!sidebarCollapsed && <div className="ly-nav-label">Account</div>}
          {!sidebarCollapsed && (
            <div className="ly-nav-item ly-nav-user">
              <div className="ly-user-dot">{user.avatar}</div>
              <span className="ly-user-fullname">{user.name || '...'}</span>
            </div>
          )}
          {sidebarCollapsed && (
            <div className="ly-nav-item ly-nav-user" title={user.name}>
              <div className="ly-user-dot">{user.avatar}</div>
            </div>
          )}
          <button className="ly-nav-item" onClick={signOut} style={{ color:'#dc2626' }} title={sidebarCollapsed ? 'Logout' : ''}>
            <span className="ly-nav-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </span>
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>

      </aside>

      {/* ── Main ── */}
      <div className={'ly-main' + (sidebarCollapsed ? ' ly-main-collapsed' : '')}>

        {/* Topbar */}
        <header className="ly-topbar">
          <div className="ly-topbar-left">
            {sidebarCollapsed && (
              <button className="ly-topbar-hamburger" onClick={toggleSidebar} title="Expand sidebar">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:18,height:18}}><path d="M3 12h18M3 6h18M3 18h18"/></svg>
              </button>
            )}
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
              {searchQ && <button onClick={() => { setSearchQ(''); setSearchOpen(false); setSearchResults({ orders:[], companies:[], leads:[], opportunities:[], vendors:[], purchaseOrders:[], grns:[], purchaseInvoices:[] }) }} style={{background:'none',border:'none',cursor:'pointer',color:'var(--gray-400)',padding:0,lineHeight:1}}>✕</button>}
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
                    {searchResults.vendors.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Vendor 360</div>
                        {searchResults.vendors.map(v => (
                          <div key={v.id} onClick={() => goToResult('/vendors/'+v.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#d97706" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:600,color:'var(--gray-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.vendor_name}</div>
                              {v.vendor_code && <div style={{fontSize:11,color:'var(--gray-400)',fontFamily:'var(--mono)'}}>{v.vendor_code}</div>}
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#fef3c7',color:'#d97706',flexShrink:0,fontWeight:600}}>{v.status || 'Vendor'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.purchaseOrders.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Purchase Orders</div>
                        {searchResults.purchaseOrders.map(p => (
                          <div key={p.id} onClick={() => goToResult('/procurement/po/'+p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#e0e7ff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#4f46e5" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#4f46e5'}}>{p.po_number}</div>
                              <div style={{fontSize:11,color:'var(--gray-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.vendor_name}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#e0e7ff',color:'#4f46e5',flexShrink:0,fontWeight:600}}>{p.status || 'PO'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.grns.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>GRN</div>
                        {searchResults.grns.map(g => (
                          <div key={g.id} onClick={() => goToResult('/fc/grn/'+g.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#dcfce7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#16a34a" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#16a34a'}}>{g.grn_number}</div>
                              <div style={{fontSize:11,color:'var(--gray-400)'}}>{g.grn_type || '—'}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#dcfce7',color:'#16a34a',flexShrink:0,fontWeight:600}}>{g.status || 'GRN'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {searchResults.purchaseInvoices.length > 0 && (
                      <div>
                        <div style={{padding:'10px 16px 4px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.8px',color:'var(--gray-400)'}}>Purchase Invoices</div>
                        {searchResults.purchaseInvoices.map(pi => (
                          <div key={pi.id} onClick={() => goToResult('/procurement/invoices/'+pi.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',borderTop:'1px solid var(--gray-50)'}} onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <div style={{width:28,height:28,borderRadius:7,background:'#fce7f3',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                              <svg fill="none" stroke="#db2777" strokeWidth="2" viewBox="0 0 24 24" style={{width:13,height:13}}><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
                            </div>
                            <div style={{minWidth:0}}>
                              <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#db2777'}}>{pi.invoice_number}</div>
                              <div style={{fontSize:11,color:'var(--gray-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pi.vendor_name}</div>
                            </div>
                            <span style={{marginLeft:'auto',fontSize:10,padding:'2px 7px',borderRadius:4,background:'#fce7f3',color:'#db2777',flexShrink:0,fontWeight:600}}>{pi.status || 'Invoice'}</span>
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
                onClick={() => setShowNotifs(v => !v)}
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
                          onClick={() => handleNotifClick(n)}
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
          {accessDenied ? (
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'60vh',textAlign:'center',padding:40}}>
              <div style={{width:56,height:56,borderRadius:'50%',background:'#fef2f2',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:16}}>
                <svg fill="none" stroke="#dc2626" strokeWidth="2" viewBox="0 0 24 24" style={{width:28,height:28}}><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              </div>
              <div style={{fontSize:18,fontWeight:700,color:'var(--gray-800)',marginBottom:6}}>Access Restricted</div>
              <div style={{fontSize:13,color:'var(--gray-500)',maxWidth:340,lineHeight:1.5}}>
                You don't have permission to access this module. Please contact your administrator to request access.
              </div>
              <button className="od-btn" style={{marginTop:20}} onClick={() => navigate('/dashboard')}>← Back to Home</button>
            </div>
          ) : children}
        </div>

      </div>
    </div>
  )
}
