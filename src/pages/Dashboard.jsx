import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { FY_START, FY_LABEL, fmtMoneyShort } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import { ordersTotalValue } from '../lib/orderValue'
import Layout from '../components/Layout'
import '../styles/dashboard.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'
import Stat from '../components/StatTile'
import Loading from '../components/Loading'
import TrendChart from '../components/TrendChart'
import StatusDonut from '../components/StatusDonut'

// Every business role EXCEPT 'staff'. Used where the old code said roles:['all'] —
// which was fine while every login was a business user, but 'staff' (warehouse and back
// office, People-360 only) must not land on CRM pipeline value or total sales value.
// 'all' is deliberately gone from the role lists below: a future role should be denied by
// default and granted on purpose, never included because nobody remembered to exclude it.
const BIZ = ['sales','ops','admin','management','accounts','fc_kaveri','fc_godawari','demo']

// Who sees the company overview (the percentage KPIs and the four charts).
// Decision 2026-09-09: admin, management, accounts and ops — NOT the fulfilment roles
// and NOT staff. Staff never land here anyway (login sends them to /people); FC users
// keep their dispatch tiles below but not the company money view.
const COMPANY_VIEW = ['admin','management','accounts','ops']

// Who can read CRM data at all — mirrors can_read_crm() in sql/rls_step2_crm.sql.
// ops and accounts are in it because Customer 360 shows opportunities, visits and quotes.
// FC and staff are not: they would have been served a ₹0 pipeline tile they cannot open.
// If you change one side, change the other, or the tile lies.
const CRM_VIEW = ['sales','ops','admin','management','accounts','demo']

const APPS = [
  { key:'crm', label:'CRM', desc:'Leads & opportunities', path:'/crm', roles:CRM_VIEW, color:{ bg:'#eef2ff', icon:'#4338ca' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg> },
  { key:'customer360', label:'Customer 360', desc:'Accounts & profiles', path:'/customers', roles:['sales','ops','admin','management'], color:{ bg:'#f0fdfa', icon:'#0f766e' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg> },
  { key:'inventory', label:'Inventory', desc:'Stock & availability', path:'/inventory', roles:['sales','admin','management','ops'], color:{ bg:'#f0fdf4', icon:'#15803d' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 21H3M21 21V3M9 21V9m4 12V5m4 16v-6"/></svg> },
  { key:'orders', label:'Orders', desc:'Create & track orders', path:'/orders', roles:BIZ, color:{ bg:'#fffbeb', icon:'#b45309' },
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
  // The only tile 'staff' sees. Note the tile path is /people/kpi, which Performance
  // itself bounces them out of (PeopleKpi.jsx) back to /people — harmless, but it is why
  // Login sends staff straight to /people rather than through the dashboard.
  { key:'people', label:'People', desc:'KRA / KPI & team', path:'/people/kpi', roles:['sales','ops','admin','management','accounts','fc_kaveri','fc_godawari','staff'], color:{ bg:'#ecfeff', icon:'#0e7490' },
    icon:<svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> },
  { key:'upload', label:'Upload', desc:'Sync inventory data', path:'/uploads', roles:['admin','accounts'], color:{ bg:'#e8f2fc', icon:'#1a73e8' },
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
    ordersActive: 0, ordersPending: 0, ordersValue: 0,
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
    // Page past the 1000-row cap so order counts reflect all 1400+ FY orders.
    // Items fetched for Total Sales (canonical ordersTotalValue); sales users
    // are scoped to their own orders, same as the /orders headline.
    queries.push(fetchAll((from, to) => {
      let q = sb.from('orders').select('status,order_type,created_at,order_items(total_price,unit_price_after_disc,lp_unit_price,cancelled_qty)').gte('created_at', FY_START).eq('is_test', false).order('id')
      if (role === 'sales') q = q.eq('created_by', session.user.id)
      return q.range(from, to)
    }))
    if (isAdmin) {
      queries.push(sb.from('purchase_orders').select('status,total_amount').eq('is_test', false).gte('created_at', FY_START))
      // PAGED: 4,231 stock rows is past PostgREST's 1000-row cap. Unpaged, the low/out
      // counts were computed from the first 1000 rows only — understating both.
      queries.push(fetchAll((from, to) => sb.from('inventory')
        .select('product_code,quantity').order('product_code').order('location').range(from, to)))
      // SI = the stocked range (359 items). CI items are not held, so "out of stock"
      // across all 4,231 inventory lines was never the question worth answering.
      queries.push(sb.from('items').select('item_code').eq('type', 'SI').eq('is_active', true))
    }
    // ── company overview ──────────────────────────────────────────────────────
    // Only fetched for the roles that may see it, so a sales or FC login never even
    // requests receivables. RLS would also refuse most of it, but not asking is the
    // clearer contract.
    // People tiles for EVERY role. office_presence() is the same presence-only RPC the
    // People home uses — name + in/out + on-leave, no times, no attendance detail — so a
    // sales or FC login gets a true company figure without reading anyone's punches.
    queries.push(sb.rpc('office_presence'))
    // count only — never pull 4,000 customer rows to show one number
    queries.push(sb.from('customers').select('id', { count: 'exact', head: true }))

    const companyView = COMPANY_VIEW.includes(role)
    if (companyView) {
      // win rate needs the CLOSED stages, which the pipeline query excludes
      queries.push(sb.from('crm_opportunities').select('stage'))
      // The CURRENT dues run. Was `.order('id', desc)` — but id is a uuid, so that
      // ordering is arbitrary, not chronological; with more than one run it would have
      // picked a random snapshot. is_current is the flag the import maintains.
      queries.push(sb.from('customer_dues_runs')
        .select('id,as_on,total_outstanding_inr,total_pdc_inr,total_overdue_inr')
        .eq('is_current', true).order('as_on', { ascending: false }).limit(1))
    }

    const results = await Promise.all(queries)
    const crmRes = results[0]
    const ordersRes = results[1]
    const poRes = isAdmin ? results[2] : { data: [] }
    const invRes = isAdmin ? results[3] : { data: [] }
    const siRes  = isAdmin ? results[4] : { data: [] }
    const presIdx = isAdmin ? 5 : 2
    const presRes = results[presIdx] || { data: [] }
    const custRes = results[presIdx + 1] || { count: 0 }
    const base = presIdx + 2
    const crmAllRes = companyView ? results[base] : { data: [] }
    const runRes    = companyView ? results[base + 1] : { data: [] }

    // Ageing for the latest dues run. Paged: ~1,900 bills is past the 1000-row cap, and
    // a truncated read would understate what is owed.
    let ageing = []
    const runId = runRes.data?.[0]?.id
    if (companyView && runId) {
      const { data: bills } = await fetchAll((from, to) => sb.from('customer_dues_bills')
        .select('pending_inr,pdc_inr,days_past_due,party_name_raw').eq('run_id', runId).order('id').range(from, to))
      ageing = bills || []
    }

    const crmOpen = crmRes.data || []
    const orders = ordersRes.data || []
    const pos = poRes.data || []
    const inv = invRes.data || []

    setM({
      crmOpenValue: crmOpen.reduce((s, o) => s + (o.estimated_value_inr || 0), 0),
      crmOpenCount: crmOpen.length,
      ordersActive: orders.filter(o => !['dispatched_fc','cancelled'].includes(o.status)).length,
      ordersValue: ordersTotalValue(orders),
      ordersPending: orders.filter(o => o.status === 'pending').length,
      fcAction: orders.filter(o => FC_ACTION_STATUSES.includes(o.status)).length,
      fcDelivered: orders.filter(o => o.status === 'dispatched_fc').length,
      procOpenPOs: pos.filter(p => !['material_received','closed','cancelled'].includes(p.status)).length,
      procOpenPOValue: pos.filter(p => !['material_received','closed','cancelled'].includes(p.status)).reduce((s, p) => s + (p.total_amount || 0), 0),
      procPendingAppr: pos.filter(p => p.status === 'pending_approval').length,
      procTotalValue: pos.reduce((s2, p) => s2 + (p.total_amount || 0), 0),
      billingAction: orders.filter(o => BILLING_ACTION_STATUSES.includes(o.status)).length,
      billingOverrides: 0,
      invLow: inv.filter(i => i.quantity > 0 && i.quantity <= 5).length,
      invZero: inv.filter(i => i.quantity === 0).length,

      // ── company overview ──────────────────────────────────────────────────
      companyView,
      // Win rate over CLOSED opportunities only. Counting open ones would drag it
      // down for no reason — an opportunity still in play has not been lost.
      crmWon: (crmAllRes.data || []).filter(o => o.stage === 'WON').length,
      crmLost: (crmAllRes.data || []).filter(o => o.stage === 'LOST').length,
      crmFunnel: ['LEAD_CAPTURED','CONTACTED','BOM_RECEIVED','QUOTATION_SENT','WON']
        .map(k => ({ key: k, n: (crmAllRes.data || []).filter(o => o.stage === k).length })),

      // Receivables ageing. days_past_due <= 0 (or null) is not yet due.
      // GROSS outstanding: pending + PDC. pending_inr is stored NET of post-dated
      // cheques, which made our total ₹13.09Cr against the ₹13.37Cr the Tally statement
      // shows. Each cheque is aged with its OWN bill, so the buckets stay honest about
      // how old the money is.
      ageing: (() => {
        const keys = ['Not due','1–30','31–60','61–90','90+']
        const b = Object.fromEntries(keys.map(k => [k, { amount: 0, bills: 0 }]))
        ageing.forEach(x => {
          const d = Number(x.days_past_due) || 0
          const k = d <= 0 ? 'Not due' : d <= 30 ? '1–30' : d <= 60 ? '31–60' : d <= 90 ? '61–90' : '90+'
          b[k].amount += (Number(x.pending_inr) || 0) + (Number(x.pdc_inr) || 0)
          b[k].bills += 1
        })
        return keys.map(label => ({ label, amount: b[label].amount, bills: b[label].bills }))
      })(),

      // Post-dated cheques are held SEPARATELY from pending_inr — a cheque in hand is
      // money promised, not received, so it is not counted as collected. Surfaced on its
      // own tile because the Tally statement adds it in: our ₹13.09Cr + ₹28.1L PDC is
      // the ₹13.37Cr gross that report shows.
      pdcTotal: ageing.reduce((a, x) => a + (Number(x.pdc_inr) || 0), 0),
      pdcParties: new Set(ageing.filter(x => Number(x.pdc_inr)).map(x => x.party_name_raw)).size,

      // Inventory health, three buckets — the tiles above only counted two.
      invOk: inv.filter(i => i.quantity > 5).length,
      invTotal: inv.length,

      // SI availability: of the stocked range, how much is actually on the shelf.
      ...(() => {
        const qty = new Map()
        inv.forEach(i => qty.set(i.product_code, (qty.get(i.product_code) || 0) + (Number(i.quantity) || 0)))
        const codes = (siRes.data || []).map(x => x.item_code)
        const inStock = codes.filter(c => (qty.get(c) || 0) > 0).length
        return { siTotal: codes.length, siInStock: inStock, siOut: codes.length - inStock }
      })(),

      // Fulfilment: how much of the FY's order book has actually shipped.
      ordersTotal: orders.length,
      ordersDispatched: orders.filter(o => o.status === 'dispatched_fc').length,
      ordersCancelled: orders.filter(o => o.status === 'cancelled').length,
      customers: custRes.count || 0,

      // Bookings per month across the FY, for the chart and the month-on-month delta.
      bookings: (() => {
        const by = new Map()
        orders.forEach(o => {
          if (!o.created_at) return
          const k = String(o.created_at).slice(0, 7)
          by.set(k, (by.get(k) || 0) + 1)
        })
        return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => ({ key: k, n }))
      })(),

      // ── people (every role) ───────────────────────────────────────────────
      headcount: (presRes.data || []).length,
      peopleIn: (presRes.data || []).filter(p => p.is_in).length,
      peopleLeave: (presRes.data || []).filter(p => p.on_leave).length,
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

  return (
    <Layout pageTitle="Home" pageKey="home">
      <div className="hd-content">

        {/* Greeting */}
        <div className="hd-hero">
          <div className="hd-greeting">{greeting}, <strong>{firstName}</strong></div>
          <div className="hd-date">{dateStr} · {FY_LABEL}</div>
        </div>

        {/* ── Company overview — admin / management / accounts / ops ──────────── */}
        {/* Until this resolves the page was just a greeting over blank space, with no
            sign anything was coming. Skeleton tiles keep the layout in place and the
            shared <Loading/> says the numbers are on their way. */}
        {loading && (
          <>
            <div className="hd-section-label" style={{ marginTop: 4 }}>Company</div>
            <div className="orders-app dash-embed">
              <div className="ph-bento">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="ph-stat is-skel" />)}
              </div>
              <Loading label="Loading company data…" />
            </div>
          </>
        )}

        {!loading && (m.companyView || m.headcount > 0) && (() => {
          const closed = m.crmWon + m.crmLost
          const winRate = closed ? Math.round((m.crmWon / closed) * 100) : null
          const totalDue = m.ageing.reduce((a, x) => a + x.amount, 0)
          const overdue = m.ageing.filter(x => x.label !== 'Not due').reduce((a, x) => a + x.amount, 0)
          const overduePct = totalDue ? Math.round((overdue / totalDue) * 100) : null
          const shipped = m.ordersTotal ? Math.round((m.ordersDispatched / m.ordersTotal) * 100) : null
          const siPct = m.siTotal ? Math.round((m.siInStock / m.siTotal) * 100) : null
          // Month on month on bookings. The CURRENT month is part-complete, so the
          // comparison is against the same point last month would be misleading —
          // this compares the two most recent COMPLETE months instead.
          const bk = m.bookings || []
          const complete = bk.slice(0, -1)                     // drop the running month
          const lastFull = complete[complete.length - 1]
          const prevFull = complete[complete.length - 2]
          const bookDelta = lastFull && prevFull && prevFull.n
            ? { pct: Math.round(((lastFull.n - prevFull.n) / prevFull.n) * 100), up: lastFull.n >= prevFull.n,
                title: `${lastFull.n} vs ${prevFull.n} the month before` }
            : null
          const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const bookLabel = k => { const [y, mo] = k.split('-').map(Number); return `${MON3[mo-1]} ${String(y).slice(2)}` }
          const funnelPeak = Math.max(1, ...m.crmFunnel.map(f => f.n))
          return (
            <>
              <div className="hd-section-label" style={{ marginTop: 4 }}>Company</div>
              <div className="orders-app dash-embed">
                <div className="ph-bento lv-bento">
                  {/* Money and pipeline: admin / management / accounts / ops only. The
                      People ratios below render for every role — presence is not
                      restricted, and a sales login would otherwise see an empty page. */}
                  {m.companyView && <>
                  <Stat label="Sales FYTD" value={fmtMoneyShort(m.ordersValue)}
                    delta={bookDelta}
                    foot={<><b>{m.ordersTotal}</b> orders booked</>} onClick={() => navigate('/orders')} />
                  <Stat label="Customers" value={m.customers}
                    foot="on the master" onClick={() => navigate('/customers')} />
                  <Stat label="Won" value={winRate != null ? `${winRate}%` : '—'}
                    foot={<><b>{m.crmWon}</b> won · <b>{m.crmLost}</b> lost</>} onClick={() => navigate('/crm')} />
                  <Stat label="Overdue" value={overduePct != null ? `${overduePct}%` : '—'}
                    warn={overduePct > 25}
                    foot={<>{fmtMoneyShort(overdue)} of {fmtMoneyShort(totalDue)}</>} onClick={() => navigate('/billing')} />
                  {m.pdcTotal > 0 && (
                    <Stat label="PDC in hand" value={fmtMoneyShort(m.pdcTotal)}
                      foot={<><b>{m.pdcParties}</b> parties · included above</>}
                      onClick={() => navigate('/billing')} />
                  )}
                  <Stat label="Dispatched" value={shipped != null ? `${shipped}%` : '—'}
                    foot={<><b>{m.ordersDispatched}</b> of {m.ordersTotal} orders</>} onClick={() => navigate('/fc')} />
                  <Stat label="SI in stock" value={siPct != null ? `${siPct}%` : '—'}
                    warn={siPct != null && siPct < 85}
                    foot={<><b>{m.siInStock}</b> of {m.siTotal} stocked items</>} onClick={() => navigate('/inventory')} />
                  {/* Carried over from the old "At a glance" row so the procurement and
                      billing signals are not lost with it. */}
                  {/* One tile, not two: the value IS the headline and the count is its
                      caption — "Open POs" and "Open PO value" said the same thing twice. */}
                  <Stat label="Open POs" value={fmtMoneyShort(m.procOpenPOValue)}
                    warn={m.procPendingAppr > 0}
                    foot={m.procPendingAppr > 0
                      ? <><b>{m.procPendingAppr}</b> need approval · {m.procOpenPOs} open</>
                      : <><b>{m.procOpenPOs}</b> POs still open</>}
                    onClick={() => navigate('/procurement')} />
                  <Stat label="Billing actions" value={m.billingAction}
                    warn={m.billingAction > 0}
                    foot="credit · invoice · e-way" onClick={() => navigate('/billing')} />
                  </>}
                  {/* People sits in the SAME row, as ratios rather than raw counts.
                      Presence comes from office_presence(), which every role may read. */}
                  <Stat label="Attendance" value={m.headcount ? `${Math.round((m.peopleIn / m.headcount) * 100)}%` : '—'}
                    foot={<><b>{m.peopleIn}</b> of {m.headcount} in today</>}
                    onClick={() => navigate('/people/attendance/muster')} />
                  <Stat label="On leave" value={m.headcount ? `${Math.round((m.peopleLeave / m.headcount) * 100)}%` : '—'}
                    foot={<><b>{m.peopleLeave}</b> approved today</>}
                    onClick={() => navigate('/people/attendance/leave')} />
                </div>

                {m.companyView && (<>
                {/* Sales vs purchase — the two sides of the FY on one scale. Sales comes
                    from ordersTotalValue (the one order-value formula); purchases are the
                    PO totals. Not a margin: PO value is committed spend, not cost of the
                    goods sold in those orders. */}
                {(() => {
                  const sales = m.ordersValue || 0
                  const purch = m.procTotalValue || 0
                  const peak = Math.max(sales, purch, 1)
                  const ratio = purch > 0 ? Math.round((sales / purch) * 100) : null
                  return (
                    <div className="card" style={{ marginBottom: 14 }}>
                      <div className="card-head">
                        <div>
                          <div className="card-eyebrow">FY to date · committed, not cost of sales</div>
                          <div className="card-title">Sales vs purchase</div>
                        </div>
                        <span className="trend-pill mono">{ratio != null ? `${ratio}% sales : purchase` : '—'}</span>
                      </div>
                      <div className="dash-vs">
                        <div className="dash-vs-row">
                          <span className="dash-vs-l">Sales</span>
                          <span className="dash-vs-track"><span style={{ width: `${(sales/peak)*100}%`, background: '#10B981' }} /></span>
                          <span className="dash-vs-v">{fmtMoneyShort(sales)}</span>
                        </div>
                        <div className="dash-vs-row">
                          <span className="dash-vs-l">Purchase</span>
                          <span className="dash-vs-track"><span style={{ width: `${(purch/peak)*100}%`, background: '#1a73e8' }} /></span>
                          <span className="dash-vs-v">{fmtMoneyShort(purch)}</span>
                        </div>
                        <div className="dash-vs-row">
                          <span className="dash-vs-l">Open POs</span>
                          <span className="dash-vs-track"><span style={{ width: `${(m.procOpenPOValue/peak)*100}%`, background: '#F59E0B' }} /></span>
                          <span className="dash-vs-v">{fmtMoneyShort(m.procOpenPOValue)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                <div className="dash-charts">
                  {/* Order bookings per month — volume, where sales-vs-purchase is value. */}
                  <div className="card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">FY to date</div><div className="card-title">Order bookings</div></div>
                      <span className="trend-pill mono">{m.ordersTotal} orders</span>
                    </div>
                    <TrendChart
                      points={(m.bookings || []).map(b => ({ key: b.key, label: bookLabel(b.key), value: b.n,
                        note: b.key === (m.bookings[m.bookings.length-1] || {}).key ? 'month in progress' : null }))}
                      fmt={v => `${v} orders`} height={168} />
                  </div>

                  {/* People as a chart, not two numbers: who is in, on leave, or not in
                      yet. Presence only — office_presence() is readable by every role. */}
                  <div className="card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">{m.headcount} people</div><div className="card-title">On the floor today</div></div>
                      <span className="trend-pill mono">{m.headcount ? `${Math.round((m.peopleIn / m.headcount) * 100)}%` : '—'}</span>
                    </div>
                    <StatusDonut
                      pct={m.headcount ? Math.round((m.peopleIn / m.headcount) * 100) : 0}
                      centerLabel="IN OFFICE"
                      rows={[
                        { label:'In office', value:m.peopleIn,    color:'#10B981' },
                        { label:'On leave',  value:m.peopleLeave, color:'#8B5CF6' },
                      ]}
                      summary={{ label:'Not in yet', value:Math.max(0, m.headcount - m.peopleIn - m.peopleLeave) }}
                    />
                  </div>

                  {/* Receivables ageing — the chart with the sharpest signal: what is
                      owed, and how much of it is long overdue. */}
                  <div className="card">
                    <div className="card-head">
                      <div>
                        <div className="card-eyebrow">Latest statement · gross, incl. PDC</div>
                        <div className="card-title">Receivables ageing</div>
                      </div>
                      <span className="trend-pill mono">{fmtMoneyShort(totalDue)}</span>
                    </div>
                    {/* Ageing curve: the shared line chart across the buckets. Points
                        past "Not due" are marked red so the overdue tail reads at a
                        glance. */}
                    <TrendChart
                      points={m.ageing.map(x => ({ key: x.label, label: x.label, value: x.amount,
                        bad: x.label !== 'Not due',
                        note: `${x.bills} bill${x.bills === 1 ? '' : 's'}` }))}
                      fmt={v => fmtMoneyShort(v)} height={168} />
                    {m.pdcTotal > 0 && (
                      <div className="dash-note">
                        Total outstanding <b>{fmtMoneyShort(totalDue)}</b> — gross, including {fmtMoneyShort(m.pdcTotal)} of
                        post-dated cheques. Each cheque is aged with its own bill, so a cheque against a
                        bill that is not yet due sits in “Not due”, not in 90+.
                      </div>
                    )}
                  </div>

                  {/* CRM funnel */}
                  <div className="card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">Opportunities</div><div className="card-title">Pipeline funnel</div></div>
                      <span className="trend-pill mono">{winRate != null ? `${winRate}% win` : '—'}</span>
                    </div>
                    <div className="funnel">
                      {m.crmFunnel.map(f => (
                        <div key={f.key} className="funnel-row">
                          <div className="funnel-label"><span className="funnel-dot" style={{ background: f.key === 'WON' ? '#10B981' : '#1a73e8' }}/>
                            <span className="funnel-name">{f.key.replace(/_/g,' ').toLowerCase()}</span></div>
                          <div className="funnel-bar-wrap"><div className="funnel-bar" style={{ width: `${(f.n/funnelPeak)*100}%`, background: f.key === 'WON' ? '#10B981' : '#1a73e8' }}/></div>
                          <div className="funnel-val">{f.n}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Inventory health */}
                  <div className="card">
                    <div className="card-head">
                      <div><div className="card-eyebrow">{m.siTotal} stocked (SI) items</div><div className="card-title">Stock availability</div></div>
                      <span className="trend-pill mono">{siPct != null ? `${siPct}%` : '—'}</span>
                    </div>
                    <StatusDonut
                      pct={siPct || 0}
                      centerLabel="IN STOCK"
                      rows={[
                        { label:'In stock',     value:m.siInStock, color:'#10B981' },
                        { label:'Out of stock', value:m.siOut,     color:'#EF4444' },
                      ]}
                      summary={{ label:'Low across all lines', value:m.invLow }}
                    />
                  </div>
                </div>
                </>)}
              </div>
            </>
          )
        })()}


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
