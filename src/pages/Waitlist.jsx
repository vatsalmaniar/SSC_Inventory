import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import * as XLSX from 'xlsx'
import '../styles/orders-redesign.css'

const DEAD_STATUSES = ['cancelled', 'dispatched_fc', 'closed']

export default function Waitlist() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name: '', role: '', id: '' })
  const [waitItems, setWaitItems] = useState([])
  const [stockMap, setStockMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUser({ name: profile?.name || '', role, id: session.user.id })
    await load(role, session.user.id)
  }

  async function load(role, uid) {
    setLoading(true)
    let wq = sb.from('order_items')
      .select('id,item_code,qty,dispatched_qty,cancelled_qty,order_id,orders!inner(id,order_number,customer_name,order_date,status,is_test,partial_deliveries_allowed,credit_override,created_by)')
      .eq('stock_status', 'out_of_stock')
      .eq('orders.is_test', role === 'demo')
    if (role === 'sales') wq = wq.eq('orders.created_by', uid)
    const [waitRes, invRes] = await Promise.all([
      wq,
      sb.from('inventory').select('product_code,quantity'),
    ])
    setWaitItems(waitRes.data || [])
    const sm = {}
    for (const r of (invRes.data || [])) sm[r.product_code] = (sm[r.product_code] || 0) + (r.quantity || 0)
    setStockMap(sm)
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const daysSince = (d) => d ? Math.max(0, Math.floor((new Date(today) - new Date(d)) / 86400000)) : 0

  const groups = (() => {
    const byItem = {}
    for (const it of waitItems) {
      const o = it.orders
      if (!o || DEAD_STATUSES.includes(o.status)) continue
      const remaining = (it.qty || 0) - (it.dispatched_qty || 0) - (it.cancelled_qty || 0)
      if (remaining <= 0) continue
      if (!byItem[it.item_code]) byItem[it.item_code] = []
      byItem[it.item_code].push({
        order_id: o.id, order_number: o.order_number, customer_name: o.customer_name,
        order_date: o.order_date, remaining, on_hold: o.credit_override === true,
      })
    }
    return Object.entries(byItem).map(([item_code, rows]) => {
      rows.sort((a, b) => (a.order_date || '').localeCompare(b.order_date || ''))
      return { item_code, rows, totalWaiting: rows.reduce((s, r) => s + r.remaining, 0), available: stockMap[item_code] || 0 }
    }).sort((a, b) => (a.rows[0]?.order_date || '').localeCompare(b.rows[0]?.order_date || ''))
  })()

  const q = search.trim().toLowerCase()
  const filtered = q ? groups.filter(g => g.item_code.toLowerCase().includes(q) || g.rows.some(r => r.customer_name?.toLowerCase().includes(q) || r.order_number?.toLowerCase().includes(q))) : groups

  const totalUnits = groups.reduce((s, g) => s + g.totalWaiting, 0)
  const totalOrders = new Set(groups.flatMap(g => g.rows.map(r => r.order_id))).size

  function downloadSheet() {
    const rows = []
    for (const g of groups) {
      g.rows.forEach((r, idx) => {
        const consumedBefore = g.rows.slice(0, idx).reduce((s, x) => s + x.remaining, 0)
        const canGet = Math.max(0, Math.min(r.remaining, g.available - consumedBefore))
        rows.push({
          'Item Code': g.item_code,
          'In Stock': g.available,
          'Total Needed': g.totalWaiting,
          'Priority': idx + 1,
          'Order': r.order_number,
          'Customer': r.customer_name,
          'Units Needed': r.remaining,
          'Can Fulfil Now': canGet >= r.remaining ? 'Yes (full)' : canGet > 0 ? `${canGet} units` : 'No — wait',
          'Days Waiting': daysSince(r.order_date),
          'On Hold': r.on_hold ? 'YES' : '',
        })
      })
    }
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Item Code': 'Nothing waiting' }])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Waiting for Stock')
    XLSX.writeFile(wb, `SSC_Waiting_for_Stock_${today}.xlsx`)
  }

  return (
    <Layout pageTitle="Waiting for Stock" pageKey="orders">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Waiting for Stock</h1>
            <div className="o-summary">
              <span><b>{groups.length}</b> item{groups.length === 1 ? '' : 's'} short</span>
              <span className="o-sep">·</span>
              <span><b>{totalUnits}</b> units</span>
              <span className="o-sep">·</span>
              <span><b>{totalOrders}</b> order{totalOrders === 1 ? '' : 's'} waiting</span>
              <span className="o-sep">·</span>
              <span style={{ color: 'var(--o-muted)' }}>oldest order gets priority</span>
            </div>
          </div>
          <div className="page-meta">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item / customer / order…"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--o-line-2)', fontFamily: 'var(--font)', fontSize: 13, minWidth: 240 }} />
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSheet} title="Download Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="o-empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="o-empty" style={{ padding: 60 }}>{groups.length === 0 ? 'Nothing waiting on stock 🎉' : 'No matches'}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {filtered.map(g => (
              <div key={g.item_code} style={{ border: '1px solid var(--o-line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--o-surface, #fff)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: 'var(--gray-50)', borderBottom: '1px solid var(--o-line-2)' }}>
                  <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 13.5, fontWeight: 700, color: 'var(--o-ink)' }}>{g.item_code}</div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'Geist Mono, monospace' }}>
                    <span style={{ color: '#92400e' }}>need {g.totalWaiting}</span>
                    <span style={{ color: g.available >= g.totalWaiting ? '#166534' : g.available > 0 ? '#b45309' : '#b91c1c' }}>
                      {g.available > 0 ? `${g.available} in stock` : 'none in stock'}
                    </span>
                    <span style={{ color: 'var(--o-muted)' }}>{g.rows.length} order{g.rows.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                {g.rows.map((r, idx) => {
                  const consumedBefore = g.rows.slice(0, idx).reduce((s, x) => s + x.remaining, 0)
                  const canGet = Math.max(0, Math.min(r.remaining, g.available - consumedBefore))
                  return (
                    <div key={r.order_id} onClick={() => navigate('/orders/' + r.order_id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: idx < g.rows.length - 1 ? '1px solid var(--o-line)' : 'none', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace', minWidth: 22 }}>#{idx + 1}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12.5, color: 'var(--ssc-blue)' }}>{r.order_number}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--o-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>{r.customer_name}</div>
                        </div>
                        {r.on_hold && <span style={{ fontSize: 10, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '1px 7px' }}>On Hold</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12, fontFamily: 'Geist Mono, monospace' }}>
                        <span style={{ color: '#92400e' }}>{r.remaining} units</span>
                        {g.available > 0 && <span style={{ color: canGet >= r.remaining ? '#166534' : canGet > 0 ? '#b45309' : 'var(--o-muted)' }}>{canGet >= r.remaining ? 'can fulfil' : canGet > 0 ? `${canGet} now` : 'wait'}</span>}
                        <span style={{ color: 'var(--o-muted)' }}>{daysSince(r.order_date)}d waiting</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
