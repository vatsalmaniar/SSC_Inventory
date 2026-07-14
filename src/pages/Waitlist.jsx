import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import '../styles/orders-redesign.css'

const DEAD_STATUSES = ['cancelled', 'dispatched_fc', 'closed']
const FLAG_ROLES = ['ops', 'admin', 'management']

// Reason whitelists — must mirror orders_hold_reason_check in sql/waiting_for_clearance.sql
// 'Other' removed from UI 2026-07-03 (user request) but kept in the DB CHECK —
// 7 flags were already saved with it before removal; they stay valid until re-flagged.
const REASONS = {
  sales:    ['Payment follow-up', 'Customer confirmation pending', 'Order change expected', 'PO/price issue'],
  customer: ['Project not ready', 'Machines not ready'],
}

function ownerName(o) { return o.account_owner || o.engineer_name || '' }

// Overdue = some pending line's promised delivery date has passed.
// Pending follows the dispatch-pipeline rule: a line stays pending until its
// goods issue is POSTED (posted_qty) — a created-but-stuck delivery batch does
// NOT clear an order from this list (that was the loophole).
function overdueInfo(o, today) {
  if (DEAD_STATUSES.includes(o.status)) return null
  const pendDates = (o.order_items || [])
    .filter(i => (i.qty - (i.posted_qty || 0) - (i.cancelled_qty || 0)) > 0 && i.dispatch_date && i.dispatch_date < today)
    .map(i => i.dispatch_date).sort()
  if (!pendDates[0]) return null
  return { due: pendDates[0], days: Math.max(1, Math.floor((new Date(today) - new Date(pendDates[0])) / 86400000)) }
}

// FC pipeline stages before GI-post — shown as an auto chip so ops sees WHERE
// an in-flight order is stuck (pi_payment_pending has its own chip).
const FC_STAGES = ['delivery_created', 'picking', 'packing', 'pi_requested', 'pi_generated', 'goods_issued', 'pending_billing', 'credit_check', 'invoice_generated', 'delivery_ready', 'eway_pending', 'eway_generated']
const FC_STAGE_LABELS = { delivery_created: 'Delivery Created', picking: 'Picking', packing: 'Packing', pi_requested: 'PI Requested', pi_generated: 'PI Issued', goods_issued: 'Goods Issued', pending_billing: 'Pending Billing', credit_check: 'Credit Check', invoice_generated: 'Invoice Generated', delivery_ready: 'Delivery Ready', eway_pending: 'E-Way Pending', eway_generated: 'E-Way Generated' }

function autoFlags(o) {
  const flags = []
  if (o.credit_override === true) flags.push({ key: 'credit', label: 'Credit Hold' })
  if ((o.order_items || []).some(i => i.stock_status === 'out_of_stock' && (i.qty - (i.dispatched_qty || 0) - (i.cancelled_qty || 0)) > 0)) flags.push({ key: 'oos', label: 'Out of Stock' })
  if (o.status === 'pi_payment_pending') flags.push({ key: 'pi', label: 'PI Payment' })
  if (FC_STAGES.includes(o.status)) flags.push({ key: 'fc', label: `In FC · ${FC_STAGE_LABELS[o.status] || o.status}` })
  return flags
}

const CHIP_STYLES = {
  credit:   { color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca' },
  oos:      { color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a' },
  pi:       { color: '#78350f', background: '#fef3c7', border: '1px solid #fcd34d' },
  fc:       { color: '#0f766e', background: '#f0fdfa', border: '1px solid #99f6e4' },
  sales:    { color: '#1e40af', background: '#eff6ff', border: '1px solid #bfdbfe' },
  customer: { color: '#3730a3', background: '#eef2ff', border: '1px solid #c7d2fe' },
  none:     { color: '#b45309', background: '#fffbeb', border: '1px dashed #f59e0b' },
}
function FlagChip({ kind, children, title }) {
  return <span title={title} style={{ fontSize: 10.5, fontWeight: 600, borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap', ...CHIP_STYLES[kind] }}>{children}</span>
}

// Same status palette as OrdersList.jsx, kept local — used to tint the Excel export's Status column
const ORDER_STATUS_COLORS = {
  pending: '#F59E0B', inv_check: '#1a73e8', inventory_check: '#0EA5E9', dispatch: '#06B6D4',
  partial: '#C2410C', partial_dispatch: '#C2410C', delivery_created: '#0F766E', picking: '#14B8A6',
  packing: '#0D9488', pi_requested: '#B45309', pi_generated: '#92400E', pi_payment_pending: '#78350F',
  goods_issued: '#D97706', pending_billing: '#EAB308', credit_check: '#65A30D', goods_issue_posted: '#16A34A',
  invoice_generated: '#059669', delivery_ready: '#15803D', eway_pending: '#84CC16', eway_generated: '#22C55E',
  dispatched_fc: '#047857', cancelled: '#EF4444',
}
const toArgb = (hex) => 'FF' + hex.replace('#', '').toUpperCase()
function tintArgb(hex, whiteAmount = 0.85) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  const mix = (c) => Math.round(255 * whiteAmount + c * (1 - whiteAmount))
  return 'FF' + [r, g, b].map(c => mix(c).toString(16).padStart(2, '0').toUpperCase()).join('')
}

export default function Waitlist() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name: '', role: '', id: '' })
  const [orders, setOrders] = useState([])
  const [reps, setReps] = useState([])
  const [stockMap, setStockMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('overdue')
  const [flagFilter, setFlagFilter] = useState('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  // flag drawer
  const [flagOrder, setFlagOrder] = useState(null)
  const [fParty, setFParty] = useState('')
  const [fRep, setFRep] = useState('')
  const [fReason, setFReason] = useState('')
  const [saving, setSaving] = useState(false)
  const submitGuard = useRef(false)

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
    const [ordersRes, invRes, repsRes] = await Promise.all([
      // One dataset feeds both tabs; page past the 1000-row cap.
      fetchAll((from, to) => {
        let q = sb.from('orders')
          .select('id,order_number,customer_name,account_owner,engineer_name,order_date,status,credit_override,partial_deliveries_allowed,created_by,hold_party,hold_reason,hold_set_by,hold_set_at,order_items(id,item_code,qty,dispatched_qty,posted_qty,cancelled_qty,stock_status,dispatch_date)')
          .gte('created_at', FY_START).eq('is_test', role === 'demo')
          .order('created_at', { ascending: false }).order('id', { ascending: false })
        if (role === 'sales') q = q.eq('created_by', uid)
        return q.range(from, to)
      }),
      sb.from('inventory').select('product_code,quantity'),
      sb.from('profiles').select('name,role').in('role', ['sales', 'admin', 'management']),
    ])
    if (ordersRes.error) console.error('Waitlist load error:', ordersRes.error)
    setOrders(ordersRes.data || [])
    const sm = {}
    for (const r of (invRes.data || [])) sm[r.product_code] = (sm[r.product_code] || 0) + (r.quantity || 0)
    setStockMap(sm)
    setReps([...new Set((repsRes.data || []).map(p => p.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const canFlag = FLAG_ROLES.includes(user.role)

  // ── Tab 1: overdue orders ──
  const overdue = orders
    .map(o => ({ o, od: overdueInfo(o, today) }))
    .filter(r => r.od)
    .map(r => ({ ...r, auto: autoFlags(r.o) }))
    .sort((a, b) => b.od.days - a.od.days)

  const counts = {
    sales:    overdue.filter(r => r.o.hold_party === 'sales').length,
    customer: overdue.filter(r => r.o.hold_party === 'customer').length,
    credit:   overdue.filter(r => r.auto.some(f => f.key === 'credit')).length,
    oos:      overdue.filter(r => r.auto.some(f => f.key === 'oos')).length,
    pi:       overdue.filter(r => r.auto.some(f => f.key === 'pi')).length,
    fc:       overdue.filter(r => r.auto.some(f => f.key === 'fc')).length,
    none:     overdue.filter(r => !r.o.hold_party && r.auto.length === 0).length,
  }

  const q = search.trim().toLowerCase()
  const matchesSearch = (o) => !q || o.order_number?.toLowerCase().includes(q) || o.customer_name?.toLowerCase().includes(q) || ownerName(o).toLowerCase().includes(q)
  const overdueFiltered = overdue.filter(r => matchesSearch(r.o)).filter(r => {
    if (flagFilter === 'all') return true
    if (flagFilter === 'none') return !r.o.hold_party && r.auto.length === 0
    if (flagFilter === 'sales' || flagFilter === 'customer') return r.o.hold_party === flagFilter
    return r.auto.some(f => f.key === flagFilter)
  })

  // ── Tab 2: out-of-stock items (unchanged behaviour, derived from same dataset) ──
  const groups = (() => {
    const byItem = {}
    for (const o of orders) {
      if (DEAD_STATUSES.includes(o.status)) continue
      for (const it of (o.order_items || [])) {
        if (it.stock_status !== 'out_of_stock') continue
        const remaining = (it.qty || 0) - (it.dispatched_qty || 0) - (it.cancelled_qty || 0)
        if (remaining <= 0) continue
        if (!byItem[it.item_code]) byItem[it.item_code] = []
        byItem[it.item_code].push({
          order_id: o.id, order_number: o.order_number, customer_name: o.customer_name,
          order_date: o.order_date, remaining, on_hold: o.credit_override === true,
        })
      }
    }
    return Object.entries(byItem).map(([item_code, rows]) => {
      rows.sort((a, b) => (a.order_date || '').localeCompare(b.order_date || ''))
      return { item_code, rows, totalWaiting: rows.reduce((s, r) => s + r.remaining, 0), available: stockMap[item_code] || 0 }
    }).sort((a, b) => (a.rows[0]?.order_date || '').localeCompare(b.rows[0]?.order_date || ''))
  })()
  const groupsFiltered = q ? groups.filter(g => g.item_code.toLowerCase().includes(q) || g.rows.some(r => r.customer_name?.toLowerCase().includes(q) || r.order_number?.toLowerCase().includes(q))) : groups
  const daysSince = (d) => d ? Math.max(0, Math.floor((new Date(today) - new Date(d)) / 86400000)) : 0

  // Pagination — same 50-per-page pattern as OrdersList/GRNList. Each tab has its own row set.
  const activeList = tab === 'overdue' ? overdueFiltered : groupsFiltered
  const totalPages = Math.max(1, Math.ceil(activeList.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const overduePaginated = tab === 'overdue' ? overdueFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : []
  const groupsPaginated = tab === 'stock' ? groupsFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE) : []

  // ── Flag drawer ──
  function openFlag(o) {
    setFlagOrder(o)
    setFParty(o.hold_party || '')
    setFReason(o.hold_reason || '')
    setFRep(o.hold_party === 'sales' ? (o.hold_set_by || '') : (reps.includes(ownerName(o)) ? ownerName(o) : ''))
  }
  function closeFlag() { setFlagOrder(null); setFParty(''); setFRep(''); setFReason('') }

  async function saveFlag() {
    if (submitGuard.current) return
    if (!fParty) { alert('Select who is holding this order.'); return }
    if (fParty === 'sales' && !fRep) { alert('Select the salesperson.'); return }
    if (!fReason) { alert('Select a reason.'); return }
    submitGuard.current = true
    setSaving(true)
    const heldBy = fParty === 'sales' ? fRep : user.name
    const { error } = await sb.from('orders').update({
      hold_party: fParty, hold_reason: fReason, hold_set_by: heldBy, hold_set_at: new Date().toISOString(),
    }).eq('id', flagOrder.id)
    if (error) { alert('Could not save flag: ' + error.message); submitGuard.current = false; setSaving(false); return }
    await sb.from('order_comments').insert({
      order_id: flagOrder.id, author_name: user.name, tagged_users: [], is_activity: true,
      message: `Clearance flag: Held by ${fParty === 'sales' ? `Sales (${fRep})` : 'Customer'} — ${fReason}`,
    })
    closeFlag(); submitGuard.current = false; setSaving(false)
    await load(user.role, user.id)
  }

  async function clearFlag() {
    if (submitGuard.current) return
    submitGuard.current = true
    setSaving(true)
    const { error } = await sb.from('orders').update({
      hold_party: null, hold_reason: null, hold_set_by: null, hold_set_at: null,
    }).eq('id', flagOrder.id)
    if (error) { alert('Could not clear flag: ' + error.message); submitGuard.current = false; setSaving(false); return }
    await sb.from('order_comments').insert({
      order_id: flagOrder.id, author_name: user.name, tagged_users: [], is_activity: true,
      message: 'Clearance flag cleared',
    })
    closeFlag(); submitGuard.current = false; setSaving(false)
    await load(user.role, user.id)
  }

  async function downloadSheet() {
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      if (tab === 'overdue') {
        if (!overdueFiltered.length) { alert('Nothing overdue to export.'); return }
        const ws = wb.addWorksheet('Waiting for Clearance', { views: [{ state: 'frozen', ySplit: 1 }] })
        ws.columns = [
          { header: 'Order', key: 'order', width: 22 },
          { header: 'Customer', key: 'customer', width: 32 },
          { header: 'Owner', key: 'owner', width: 18 },
          { header: 'Order Date', key: 'od', width: 12 },
          { header: 'Due Date', key: 'due', width: 12 },
          { header: 'Days Overdue', key: 'days', width: 13 },
          { header: 'Auto Flags', key: 'auto', width: 26 },
          { header: 'Held By', key: 'held', width: 22 },
          { header: 'Reason', key: 'reason', width: 28 },
          { header: 'Flagged On', key: 'fon', width: 12 },
        ]
        overdueFiltered.forEach(({ o, od, auto }) => {
          const row = ws.addRow({
            order: o.order_number, customer: o.customer_name, owner: ownerName(o),
            od: fmt(o.order_date), due: fmt(od.due), days: od.days,
            auto: auto.map(f => f.label).join(', '),
            held: o.hold_party === 'sales' ? `Sales (${o.hold_set_by})` : o.hold_party === 'customer' ? 'Customer' : '',
            reason: o.hold_reason || '', fon: o.hold_set_at ? fmt(o.hold_set_at) : '',
          })
          const d = row.getCell('days')
          d.font = { bold: true, color: { argb: od.days > 7 ? 'FFB91C1C' : 'FFB45309' } }
          d.alignment = { horizontal: 'center' }
          if (o.hold_party) {
            const h = row.getCell('held')
            const st = o.hold_party === 'sales' ? { bg: 'FFEFF6FF', fg: 'FF1E40AF' } : { bg: 'FFEEF2FF', fg: 'FF3730A3' }
            h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.bg } }
            h.font = { bold: true, color: { argb: st.fg } }
          } else if (auto.length === 0) {
            const h = row.getCell('held')
            h.value = 'NEEDS FLAG'
            h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
            h.font = { bold: true, color: { argb: 'FFB45309' } }
          }
        })
        xlsFinish(ws, 10)
        await xlsDownload(wb, `SSC_Waiting_for_Clearance_${today}.xlsx`)
        return
      }
      if (!groups.length) { alert('Nothing waiting on stock to export.'); return }
      const ws = wb.addWorksheet('Out of Stock', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'Item Code', key: 'item', width: 26 },
        { header: 'In Stock', key: 'stock', width: 9 },
        { header: 'Total Needed', key: 'needed', width: 12 },
        { header: 'Priority', key: 'prio', width: 8 },
        { header: 'Order', key: 'order', width: 22 },
        { header: 'Customer', key: 'customer', width: 32 },
        { header: 'Units Needed', key: 'units', width: 12 },
        { header: 'Can Fulfil Now', key: 'fulfil', width: 14 },
        { header: 'Days Waiting', key: 'days', width: 12 },
        { header: 'On Hold', key: 'hold', width: 9 },
      ]
      for (const g of groups) {
        g.rows.forEach((r, idx) => {
          const consumedBefore = g.rows.slice(0, idx).reduce((s, x) => s + x.remaining, 0)
          const canGet = Math.max(0, Math.min(r.remaining, g.available - consumedBefore))
          const row = ws.addRow({
            item: g.item_code, stock: g.available, needed: g.totalWaiting,
            prio: idx + 1, order: r.order_number, customer: r.customer_name,
            units: r.remaining,
            fulfil: canGet >= r.remaining ? 'Yes (full)' : canGet > 0 ? `${canGet} units` : 'No — wait',
            days: daysSince(r.order_date), hold: r.on_hold ? 'YES' : '',
          })
          const f = row.getCell('fulfil')
          f.font = { bold: true, color: { argb: canGet >= r.remaining ? 'FF166534' : canGet > 0 ? 'FFB45309' : 'FF64748B' } }
          if (r.on_hold) {
            const h = row.getCell('hold')
            h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } }
            h.font = { bold: true, color: { argb: 'FFB91C1C' } }
          }
        })
      }
      xlsFinish(ws, 10)
      await xlsDownload(wb, `SSC_Out_of_Stock_${today}.xlsx`)
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  // Line-item level export for the Overdue tab — one row per pending item,
  // with an explicit Flag (auto + manual hold combined) and Comment (hold_reason) column.
  async function downloadDetailedOverdue() {
    if (!overdueFiltered.length) { alert('Nothing overdue to export.'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { alert('Failed to load Excel library: ' + e.message); return }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('Waiting for Clearance - Detailed', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'Sr No',        key: 'sr_no',   width: 6 },
        { header: 'Order',        key: 'order',   width: 22 },
        { header: 'Customer',     key: 'customer',width: 32 },
        { header: 'Owner',        key: 'owner',   width: 18 },
        { header: 'Order Date',   key: 'od',      width: 12 },
        { header: 'Item Code',    key: 'item',    width: 22 },
        { header: 'Ordered Qty',  key: 'qty',     width: 12 },
        { header: 'Pending Qty',  key: 'pending', width: 12 },
        { header: 'Due Date',     key: 'due',     width: 12 },
        { header: 'Days Overdue', key: 'days',    width: 13 },
        { header: 'Flag',         key: 'flag',    width: 32 },
        { header: 'Comment',      key: 'comment', width: 32 },
        { header: 'Flagged By',   key: 'held',    width: 20 },
        { header: 'Flagged On',   key: 'fon',     width: 12 },
        { header: 'Status',       key: 'status',  width: 16 },
      ]

      let sr = 0
      overdueFiltered.forEach(({ o, od, auto }) => {
        const manualFlag = o.hold_party === 'sales' ? `Sales Hold (${o.hold_set_by})` : o.hold_party === 'customer' ? 'Customer Hold' : ''
        const flagLabel = [manualFlag, ...auto.map(f => f.label)].filter(Boolean).join(', ') || 'NEEDS FLAG'
        const base = {
          order: o.order_number, customer: o.customer_name, owner: ownerName(o),
          od: fmt(o.order_date), due: fmt(od.due), days: od.days,
          flag: flagLabel, comment: o.hold_reason || '',
          held: o.hold_party === 'sales' ? o.hold_set_by : (o.hold_party === 'customer' ? 'Customer' : ''),
          fon: o.hold_set_at ? fmt(o.hold_set_at) : '',
          status: o.status,
        }
        const pushRow = (data) => {
          sr += 1
          const row = ws.addRow({ ...data, sr_no: sr })
          const d = row.getCell('days')
          d.font = { bold: true, color: { argb: data.days > 7 ? 'FFB91C1C' : 'FFB45309' } }
          d.alignment = { horizontal: 'center' }

          // Flag cell — colored by hold kind, same palette as the on-screen chips
          const flagKind = o.hold_party === 'sales' ? 'sales' : o.hold_party === 'customer' ? 'customer' : (auto[0]?.key || 'none')
          const flagStyle = CHIP_STYLES[flagKind] || CHIP_STYLES.none
          const f = row.getCell('flag')
          f.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toArgb(flagStyle.background) } }
          f.font = { bold: true, color: { argb: toArgb(flagStyle.color) } }

          // Status cell — tinted with the same palette OrdersList uses on-screen
          const statusColor = ORDER_STATUS_COLORS[o.status] || '#94A3B8'
          const s = row.getCell('status')
          s.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tintArgb(statusColor) } }
          s.font = { bold: true, color: { argb: toArgb(statusColor) } }
          s.alignment = { horizontal: 'center' }
        }
        const pendingItems = (o.order_items || []).filter(i => (i.qty - (i.posted_qty || 0) - (i.cancelled_qty || 0)) > 0)
        if (pendingItems.length === 0) {
          pushRow({ ...base, item: '', qty: '', pending: '' })
        } else {
          pendingItems.forEach(it => {
            pushRow({ ...base, item: it.item_code, qty: it.qty, pending: (it.qty || 0) - (it.posted_qty || 0) - (it.cancelled_qty || 0) })
          })
        }
      })

      xlsFinish(ws, 10)
      await xlsDownload(wb, `SSC_Waiting_for_Clearance_Detailed_${today}.xlsx`)
    } catch (e) { alert('Failed to generate Excel: ' + (e.message || e)); console.error(e) }
  }

  const chipDefs = [
    { key: 'all',      label: 'All',            n: overdue.length },
    { key: 'none',     label: 'Needs Flag',     n: counts.none, kind: 'none' },
    { key: 'sales',    label: 'Held by Sales',  n: counts.sales, kind: 'sales' },
    { key: 'customer', label: 'Held by Customer', n: counts.customer, kind: 'customer' },
    { key: 'oos',      label: 'Out of Stock',   n: counts.oos, kind: 'oos' },
    { key: 'credit',   label: 'Credit Hold',    n: counts.credit, kind: 'credit' },
    { key: 'pi',       label: 'PI Payment',     n: counts.pi, kind: 'pi' },
    { key: 'fc',       label: 'Stuck in FC',    n: counts.fc, kind: 'fc' },
  ]

  return (
    <Layout pageTitle="Waiting for Clearance" pageKey="orders">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Waiting for Clearance</h1>
            <div className="o-summary">
              {tab === 'overdue' ? (
                <>
                  <span><b>{overdue.length}</b> order{overdue.length === 1 ? '' : 's'} past due date</span>
                  <span className="o-sep">·</span>
                  <span style={{ color: counts.none > 0 ? '#b45309' : 'var(--o-muted)' }}><b style={{ color: counts.none > 0 ? '#b45309' : undefined }}>{counts.none}</b> without a reason</span>
                </>
              ) : (
                <>
                  <span><b>{groups.length}</b> item{groups.length === 1 ? '' : 's'} short</span>
                  <span className="o-sep">·</span>
                  <span><b>{groups.reduce((s, g) => s + g.totalWaiting, 0)}</b> units</span>
                  <span className="o-sep">·</span>
                  <span style={{ color: 'var(--o-muted)' }}>oldest order gets priority</span>
                </>
              )}
            </div>
          </div>
          <div className="page-meta">
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search item / customer / order…"
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--o-line-2)', fontFamily: 'var(--font)', fontSize: 13, minWidth: 240 }} />
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSheet} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Summary
              </button>
              {tab === 'overdue' && (
                <button className="o-dl-btn" onClick={downloadDetailedOverdue} title="Detailed Excel — line items, flag & comment">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  Detailed
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="o-datemode" style={{ display: 'inline-flex', marginBottom: 12 }}>
          <button className={tab === 'overdue' ? 'on' : ''} onClick={() => { setTab('overdue'); setPage(1) }}>Overdue Orders{overdue.length > 0 ? ` (${overdue.length})` : ''}</button>
          <button className={tab === 'stock' ? 'on' : ''} onClick={() => { setTab('stock'); setPage(1) }}>Out of Stock{groups.length > 0 ? ` (${groups.length})` : ''}</button>
        </div>

        {loading ? (
          <div className="o-loading">Loading…</div>
        ) : tab === 'overdue' ? (
          <>
            <div className="o-filter-row" style={{ marginTop: 0, marginBottom: 12 }}>
              {chipDefs.map(c => (
                <button key={c.key} className={`o-chip ${flagFilter === c.key ? 'on' : ''} ${c.key === 'none' ? 'warn' : ''}`} onClick={() => { setFlagFilter(c.key); setPage(1) }}>
                  {c.label}{c.n > 0 && <span className="o-chip-n">{c.n}</span>}
                </button>
              ))}
            </div>
            {overdueFiltered.length === 0 ? (
              <div className="o-empty" style={{ padding: 60 }}>{overdue.length === 0 ? 'Nothing past its delivery date 🎉' : 'No matches'}</div>
            ) : (
              <div style={{ border: '1px solid var(--o-line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--o-surface, #fff)' }}>
                {overduePaginated.map(({ o, od, auto }, idx) => (
                  <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderBottom: idx < overduePaginated.length - 1 ? '1px solid var(--o-line)' : 'none' }}>
                    <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => navigate('/orders/' + o.id)}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12.5, color: 'var(--ssc-blue)' }}>{o.order_number}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--o-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{o.customer_name}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--o-muted)', marginTop: 2 }}>
                        {ownerName(o)} · ordered {fmt(o.order_date)} · due {fmt(od.due)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {auto.map(f => <FlagChip key={f.key} kind={f.key}>{f.label}</FlagChip>)}
                      {o.hold_party && (
                        <FlagChip kind={o.hold_party} title={`Flagged by ${o.hold_set_by || '—'} on ${o.hold_set_at ? fmt(o.hold_set_at) : '—'}`}>
                          {o.hold_party === 'sales' ? `Sales · ${o.hold_set_by}` : 'Customer'} — {o.hold_reason}
                        </FlagChip>
                      )}
                      {!o.hold_party && auto.length === 0 && <FlagChip kind="none">Needs flag</FlagChip>}
                      <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, fontWeight: 700, color: od.days > 7 ? '#b91c1c' : '#b45309', minWidth: 64, textAlign: 'right' }}>{od.days}d late</span>
                      {canFlag && (
                        <button onClick={() => openFlag(o)}
                          style={{ background: 'var(--o-surface)', border: '1px solid var(--o-line-2)', borderRadius: 7, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, color: 'var(--o-ink)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                          {o.hold_party ? 'Update' : 'Flag'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {overdueFiltered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, overdueFiltered.length)} of {overdueFiltered.length}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    if (ellipsis) return <span key={'e' + p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </>
        ) : (
          groupsFiltered.length === 0 ? (
            <div className="o-empty" style={{ padding: 60 }}>{groups.length === 0 ? 'Nothing waiting on stock 🎉' : 'No matches'}</div>
          ) : (
            <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {groupsPaginated.map(g => (
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
                          {r.on_hold && <FlagChip kind="credit">On Hold</FlagChip>}
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
            {groupsFiltered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, groupsFiltered.length)} of {groupsFiltered.length}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    if (ellipsis) return <span key={'e' + p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                </div>
              </div>
            )}
            </>
          )
        )}

        {/* ── Flag drawer ── */}
        {flagOrder && (
          <div className="od-drawer-scrim" onClick={e => { if (e.target === e.currentTarget) closeFlag() }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(11,27,48,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div style={{ background: '#fff', borderRadius: 14, width: 'min(440px, 94vw)', boxShadow: '0 18px 50px rgba(11,27,48,0.25)' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--o-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace' }}>{flagOrder.order_number}</div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>Why is this order held?</div>
                </div>
                <button onClick={closeFlag} style={{ background: 'none', border: 0, fontSize: 16, cursor: 'pointer', color: 'var(--o-muted)' }}>✕</button>
              </div>
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--o-muted)', display: 'block', marginBottom: 5 }}>Held by <span style={{ color: '#dc2626' }}>*</span></label>
                  <select value={fParty} onChange={e => { setFParty(e.target.value); setFReason('') }}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--o-line-2)', fontFamily: 'var(--font)', fontSize: 13 }}>
                    <option value="">Select…</option>
                    <option value="sales">Sales</option>
                    <option value="customer">Customer</option>
                  </select>
                </div>
                {fParty === 'sales' && (
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--o-muted)', display: 'block', marginBottom: 5 }}>Salesperson <span style={{ color: '#dc2626' }}>*</span></label>
                    <select value={fRep} onChange={e => setFRep(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--o-line-2)', fontFamily: 'var(--font)', fontSize: 13 }}>
                      <option value="">Select…</option>
                      {reps.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
                {fParty && (
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--o-muted)', display: 'block', marginBottom: 5 }}>Reason <span style={{ color: '#dc2626' }}>*</span></label>
                    <select value={fReason} onChange={e => setFReason(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--o-line-2)', fontFamily: 'var(--font)', fontSize: 13 }}>
                      <option value="">Select…</option>
                      {REASONS[fParty].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                {flagOrder.hold_set_at && (
                  <div style={{ fontSize: 11.5, color: 'var(--o-muted)' }}>Currently flagged by {flagOrder.hold_set_by} on {fmt(flagOrder.hold_set_at)}</div>
                )}
              </div>
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--o-line)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                {flagOrder.hold_party
                  ? <button onClick={clearFlag} disabled={saving} style={{ background: 'none', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>Clear Flag</button>
                  : <span />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={closeFlag} style={{ background: 'none', border: '1px solid var(--o-line-2)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>Cancel</button>
                  <button onClick={saveFlag} disabled={saving} className="btn-primary" style={{ borderRadius: 8, padding: '8px 16px', fontSize: 12.5 }}>Save Flag</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
