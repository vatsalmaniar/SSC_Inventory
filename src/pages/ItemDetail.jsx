import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { forgetRetiredItems } from '../lib/itemStatus'
import { fmtMoneyFull } from '../lib/fmt'
import Typeahead from '../components/Typeahead'
import Layout from '../components/Layout'
import Loading from '../components/Loading'
import { useHistoryFilter, HistoryFilterBar, HistoryPager } from '../components/HistoryFilter'
import { fetchAll } from '../lib/fetchAll'
import '../styles/orderdetail.css'
import '../styles/customer360.css'
import '../styles/drawer.css'
import '../styles/orders-redesign.css'
import { SpaDrawer } from '../components/SpaPanel'

const ORDER_STATUS = {
  pending:              { label: 'Pending Approval',    bg: '#fef3c7', color: '#92400e' },
  inv_check:            { label: 'Order Approved',      bg: '#dbeafe', color: '#1e40af' },
  inventory_check:      { label: 'Inventory Check',     bg: '#e0e7ff', color: '#3730a3' },
  dispatch:             { label: 'Ready to Ship',       bg: '#bfdbfe', color: '#1e40af' },
  partial_dispatch:     { label: 'Partially Shipped',   bg: '#ede9fe', color: '#5b21b6' },
  gen_invoice:          { label: 'Delivery Created',    bg: '#e0e7ff', color: '#3730a3' },
  delivery_created:     { label: 'Delivery Created',    bg: '#e0e7ff', color: '#3730a3' },
  picking:              { label: 'Picking',             bg: '#fef9c3', color: '#854d0e' },
  packing:              { label: 'Packing',             bg: '#fef9c3', color: '#854d0e' },
  pi_requested:         { label: 'PI Requested',        bg: '#fef9c3', color: '#854d0e' },
  pi_generated:         { label: 'PI Issued',           bg: '#fef9c3', color: '#854d0e' },
  pi_payment_pending:   { label: 'PI Payment Pending',  bg: '#fef9c3', color: '#854d0e' },
  goods_issued:         { label: 'Goods Issued',        bg: '#d1fae5', color: '#065f46' },
  pending_billing:      { label: 'Pending Billing',     bg: '#fef9c3', color: '#854d0e' },
  credit_check:         { label: 'Credit Check',        bg: '#fef3c7', color: '#92400e' },
  goods_issue_posted:   { label: 'GI Posted',           bg: '#d1fae5', color: '#065f46' },
  invoice_generated:    { label: 'Invoice Generated',   bg: '#dcfce7', color: '#166534' },
  delivery_ready:       { label: 'Delivery Ready',      bg: '#dcfce7', color: '#166534' },
  eway_pending:         { label: 'E-Way Pending',        bg: '#fef9c3', color: '#854d0e' },
  eway_generated:       { label: 'E-Way Generated',     bg: '#d1fae5', color: '#065f46' },
  dispatched_fc:        { label: 'Delivered',           bg: '#dcfce7', color: '#166534' },
  closed:               { label: 'Closed',              bg: '#f3f4f6', color: '#374151' },
  cancelled:            { label: 'Cancelled',           bg: '#fee2e2', color: '#991b1b' },
}

const PO_STATUS = {
  draft:                { label: 'Draft',                bg: '#f3f4f6', color: '#6b7280' },
  pending_approval:     { label: 'Pending Approval',     bg: '#fef3c7', color: '#92400e' },
  approved:             { label: 'Approved',             bg: '#dbeafe', color: '#1e40af' },
  placed:               { label: 'Placed',               bg: '#e0e7ff', color: '#3730a3' },
  acknowledged:         { label: 'Acknowledged',         bg: '#ede9fe', color: '#5b21b6' },
  delivery_confirmation:{ label: 'Delivery Confirmed',   bg: '#d1fae5', color: '#065f46' },
  material_received:    { label: 'Material Received',    bg: '#dcfce7', color: '#166534' },
  cancelled:            { label: 'Cancelled',            bg: '#fee2e2', color: '#991b1b' },
}

const GRN_STATUS = {
  draft:      { label: 'Draft',      bg: '#f3f4f6', color: '#6b7280' },
  checking:   { label: 'Checking',   bg: '#fef9c3', color: '#854d0e' },
  confirmed:  { label: 'Confirmed',  bg: '#dcfce7', color: '#166534' },
  cancelled:  { label: 'Cancelled',  bg: '#fee2e2', color: '#991b1b' },
}

const GRN_TYPE_LABELS = {
  standard: 'Standard', purchase: 'Purchase', return: 'Return',
  rejection: 'Rejection', sample_return: 'Sample Return',
}

function StatusBadge({ status, map }) {
  const s = map[status] || { label: status || '—', bg: '#f3f4f6', color: '#6b7280' }
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function TypeBadge({ type }) {
  if (!type) return <span style={{ color: 'var(--gray-300)' }}>—</span>
  const ci = type === 'CI'
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: ci ? '#fff7ed' : '#eff6ff', color: ci ? '#c2410c' : '#1d4ed8' }}>
      {ci ? 'CI – Customised' : 'SI – Standard'}
    </span>
  )
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Unit prices on the order / PO history tables. Always two decimals: "₹13.3"
// and "₹13.30" are the same number but the second is the one on the invoice.
function inr(v) {
  if (v == null || v === '') return '—'
  return fmtMoneyFull(v)
}

// toISOString() is UTC — in IST that reads as yesterday until 05:30, so an
// Active special rendered as Future and closing one back-dated it by a day.
// This is the local calendar date.
function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Scopes a special price can be created against.
//
// PROJECT is deliberately absent. The rules, the DB constraint and the resolver
// all support it, but no document carries a project reference yet — `orders`
// and `purchase_orders` have no such column — so a project special could be
// saved and would then never apply to anything. Offering it would be a trap.
// Add a project_ref to orders, then add ['PROJECT', 'Project'] back here; the
// pricing side already handles it and is covered by tests.
const SPECIAL_SCOPES = [['CUSTOMER', 'Customer'], ['STOCK', 'All — every customer & stock']]

// 16px on the inputs keeps iOS from zooming the page when a field is focused.
// Column layout for the special-price list, shared by the header and the rows
// so they can never drift apart.
const BTN_SM = { padding: '4px 9px', fontSize: 11.5, lineHeight: 1.2, whiteSpace: 'nowrap' }

const SPA_COLS = 'minmax(190px,1.4fr) 74px 104px 104px 72px 152px 142px 132px 104px'

const SP_LABEL = { fontSize: 10, fontWeight: 600, color: 'var(--gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'block' }
const SP_INPUT = { padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font)', background: 'white', outline: 'none', width: '100%', boxSizing: 'border-box' }

export default function ItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [item, setItem]         = useState(null)
  const [auditNames, setAuditNames] = useState({})
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('summary')
  const [orders, setOrders]     = useState([])
  const [pos, setPos]           = useState([])
  const [grns, setGrns]         = useState([])
  const [kpi, setKpi]           = useState({ totalOrders: 0, pendingOrders: 0, deliveredOrders: 0, totalPos: 0, pendingPos: 0, receivedPos: 0, totalGrns: 0 })
  const [transfers, setTransfers] = useState([])
  // Commercials: list price + partner discount. RLS on item_prices means sales
  // simply get no rows, so this stays null and the tab never renders for them.
  const [commercials, setCommercials] = useState(null)
  const [specials, setSpecials]       = useState([])
  const [role, setRole]               = useState('')
  const [spOpen, setSpOpen]           = useState(false)
  const [spaOpen, setSpaOpen]         = useState(null)   // agreement being viewed
  const [spSaving, setSpSaving]       = useState(false)
  const spGuard                       = useRef(false)
  // A special case can fix what we PAY, what we SELL at, or both — they are
  // separate condition records sharing one scope + validity, so margin is
  // always SALES − PURCHASE and can never be computed off the wrong side.
  const blankSpecial = { price_scope: 'CUSTOMER', price_kind: 'PURCHASE', customer_id: '', customer_name: '',
    buy_pct: '', buy_amount: '', sell_pct: '', sell_amount: '', min_qty: '1',
    valid_from: '', valid_to: '', project_ref: '', notes: '' }
  const [sp, setSp]                   = useState(blankSpecial)

  useEffect(() => { init() }, [id])

  async function init() {
    setLoading(true)
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return } session = data.session }

    const { data: itemData } = await sb.from('items').select('*').eq('id', id).single()
    if (!itemData) { navigate('/items'); return }
    setItem(itemData)

    // Resolve audit names (created_by / updated_by → profile name)
    const auditIds = [itemData.created_by, itemData.updated_by].filter(Boolean)
    if (auditIds.length) {
      const { data: profs } = await sb.from('profiles').select('id,name').in('id', auditIds)
      const map = {}; (profs || []).forEach(p => { map[p.id] = p.name })
      setAuditNames(map)
    }

    // One row per item at most; RLS decides whether the caller sees it at all.
    const { data: comm } = await sb.from('v_item_commercials').select('*').eq('item_code', itemData.item_code).maybeSingle()
    setCommercials(comm || null)
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
    setRole(prof?.role || '')
    await loadSpecials(itemData.item_code)   // may exist even with no list price

    // fetchAll pages past PostgREST's 1000-row cap — these 360 tables are a decision
    // log, so a very active item must never silently drop line items past row 1000.
    const [ordItemsRes, poItemsRes, grnItemsRes, transferRes] = await Promise.all([
      fetchAll((from, to) => sb.from('order_items')
        .select('id,qty,dispatched_qty,unit_price_after_disc,total_price,orders!inner(id,order_number,customer_name,order_date,status,is_test)')
        .eq('item_code', itemData.item_code)
        .eq('orders.is_test', false)
        .order('id', { ascending: false })
        .range(from, to)),
      fetchAll((from, to) => sb.from('po_items')
        .select('id,qty,received_qty,unit_price,total_price,purchase_orders!inner(id,po_number,vendor_name,po_date,status)')
        .eq('item_code', itemData.item_code)
        .order('id', { ascending: false })
        .range(from, to)),
      fetchAll((from, to) => sb.from('grn_items')
        .select('id,received_qty,accepted_qty,rejected_qty,grn:grn_id!inner(id,grn_number,grn_type,status,received_at,vendor_name,is_test)')
        .eq('item_code', itemData.item_code)
        .eq('grn.is_test', false)
        // A voided GRN is paperwork that was withdrawn — it never moved stock,
        // so it must not appear in this item's receipt history.
        .neq('grn.status', 'cancelled')
        .order('id', { ascending: false })
        .range(from, to)),
      fetchAll((from, to) => sb.from('stock_transfer_items')
        .select('id,qty,received_qty,stock_transfers!inner(id,transfer_number,source_fc,destination_fc,status,created_at,is_test)')
        .eq('item_code', itemData.item_code)
        .eq('stock_transfers.is_test', false)
        .order('id', { ascending: false })
        .range(from, to)),
    ])
    setTransfers(transferRes.data || [])

    const ordRows = ordItemsRes.data || []
    const poRows  = poItemsRes.data || []
    const grnRows = grnItemsRes.data || []

    setOrders(ordRows)
    setPos(poRows)
    setGrns(grnRows)

    const deliveredStatuses = ['dispatched_fc', 'goods_issued', 'invoice_generated']
    const pendingOrdStatuses = ['pending', 'dispatch', 'partial_dispatch', 'delivery_created', 'picking', 'packing']

    // KPI tiles exclude cancelled (cancelled still show in the order-history list, just not counted).
    const uniqueOrderIds = new Set(ordRows.filter(r => r.orders?.status !== 'cancelled').map(r => r.orders?.id).filter(Boolean))
    const uniquePoIds    = new Set(poRows.filter(r => r.purchase_orders?.status !== 'cancelled').map(r => r.purchase_orders?.id).filter(Boolean))

    const pendingOrders   = new Set(ordRows.filter(r => pendingOrdStatuses.includes(r.orders?.status)).map(r => r.orders?.id)).size
    const deliveredOrders = new Set(ordRows.filter(r => deliveredStatuses.includes(r.orders?.status)).map(r => r.orders?.id)).size
    const pendingPos      = new Set(poRows.filter(r => ['pending', 'placed', 'partial'].includes(r.purchase_orders?.status)).map(r => r.purchase_orders?.id)).size
    const receivedPos     = new Set(poRows.filter(r => r.purchase_orders?.status === 'received').map(r => r.purchase_orders?.id)).size

    const uniqueGrnIds = new Set(grnRows.map(r => r.grn?.id).filter(Boolean))

    setKpi({
      totalOrders:   uniqueOrderIds.size,
      pendingOrders,
      deliveredOrders,
      totalPos:      uniquePoIds.size,
      pendingPos,
      receivedPos,
      totalGrns:     uniqueGrnIds.size,
    })

    setLoading(false)
  }

  // ── History filters (oldest → newest). Orders keep cancelled visible; POs stay cancelled-free. ──
  const orderRows = [...orders].sort((a, b) => new Date(a.orders?.order_date || 0) - new Date(b.orders?.order_date || 0))
  const poRows    = pos.filter(r => r.purchase_orders?.status !== 'cancelled')
    .sort((a, b) => new Date(a.purchase_orders?.po_date || 0) - new Date(b.purchase_orders?.po_date || 0))
  const ordersF = useHistoryFilter(orderRows, {
    dateOf: r => r.orders?.order_date,
    searchOf: r => `${r.orders?.order_number || ''} ${r.orders?.customer_name || ''}`,
  })
  const posF = useHistoryFilter(poRows, {
    dateOf: r => r.purchase_orders?.po_date,
    searchOf: r => `${r.purchase_orders?.po_number || ''} ${r.purchase_orders?.vendor_name || ''}`,
  })
  const grnRows = [...grns].sort((a, b) => new Date(a.grn?.received_at || 0) - new Date(b.grn?.received_at || 0))
  const grnsF = useHistoryFilter(grnRows, {
    dateOf: r => r.grn?.received_at,
    searchOf: r => `${r.grn?.grn_number || ''} ${r.grn?.vendor_name || ''}`,
  })

  if (loading) return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <Loading />
    </Layout>
  )

  if (!item) return null

  const transferQty = transfers.reduce((s, t) => s + (t.qty || 0), 0)

  // Prices are shown to the PAISA, never rounded. A Connectwell terminal block
  // lists at ₹13.30 and the next colour variant at ₹13.80 — rounded to whole
  // rupees both read "₹13", so the page hid the only difference between them.
  // At MOQ 500 that is ₹250 a line. Whole-rupee display is fine for an order
  // VALUE; it is never fine for a unit price.
  const rupee = fmtMoneyFull
  // Editing prices is admin + management only. Accounts and ops can read, not write.
  const canSeePurchase = ['admin', 'management', 'ops', 'accounts'].includes(role)
  const canEditPrices = ['admin', 'management'].includes(role)

  // ── Item status ──
  // Retiring a part is a master-data decision: it stops the whole company
  // putting that code on a new order or PO. set_item_status() checks the role
  // and refuses a chain (a replacement that is itself retired), so this is a
  // prompt, not the rule.
  const [savingStatus, setSavingStatus] = useState(false)

  async function openStatus() {
    const cur = item.item_status || 'Active'
    const next = window.prompt(
      `Status for ${item.item_code}\n\n` +
      `Active         — normal\n` +
      `Superseded     — a duplicate; you will be asked which code replaces it\n` +
      `Discontinued   — no longer sold\n\n` +
      `Currently: ${cur}${item.superseded_by ? ' (use ' + item.superseded_by + ')' : ''}`,
      cur)
    if (!next) return
    const status = next.trim()
    if (status === cur && status !== 'Superseded') return

    let replacement = null
    if (status === 'Superseded') {
      replacement = window.prompt(`Which item code replaces ${item.item_code}?`, item.superseded_by || '')
      if (!replacement || !replacement.trim()) return
      replacement = replacement.trim()
    }

    setSavingStatus(true)
    const { error } = await sb.rpc('set_item_status', {
      p_item_code: item.item_code, p_status: status, p_superseded_by: replacement,
    })
    setSavingStatus(false)
    if (error) { toast(error.message || friendlyError(error, 'Could not change the status.')); return }
    // The pickers read a cached list of retired items — drop it so the change
    // shows immediately rather than in five minutes.
    forgetRetiredItems()
    toast(`${item.item_code} is now ${status}`, 'success')
    init()
  }

  async function loadSpecials(code) {
    const { data } = await sb.from('item_prices')
      .select('id,price_type,price_scope,customer_id,vendor_id,amount,min_qty,valid_from,valid_to,project_ref,notes,price_status,approved_by_user,approved_at,created_by,price_list_id,spa_id,price_lists(name),special_price_agreements(spa_no,title,counterparty_type,reference,valid_from,valid_to,status,source_file,notes),vendors(vendor_name),customers(customer_name)')
      .eq('item_code', code).in('price_type', ['PURCHASE', 'SALES'])
      .order('valid_from', { ascending: false })
    setSpecials(data || [])
  }

  // A special is quoted either way round — type a discount and the net follows,
  // type a net and the discount follows. Same feel as an order line.
  // `side` is 'buy' (what we pay) or 'sell' (what the customer pays).
  function spSetPct(side, v) {
    const lp = Number(commercials?.list_price || 0)
    const pct = v === '' ? '' : Number(v)
    setSp(p => ({ ...p, [side + '_pct']: v,
      [side + '_amount']: (v === '' || !lp || isNaN(pct)) ? '' : String(Math.round(lp * (1 - pct / 100) * 100) / 100) }))
  }
  function spSetAmount(side, v) {
    const lp = Number(commercials?.list_price || 0)
    const amt = v === '' ? '' : Number(v)
    setSp(p => ({ ...p, [side + '_amount']: v,
      [side + '_pct']: (v === '' || !lp || isNaN(amt)) ? '' : String(Math.round((1 - amt / lp) * 1000) / 10) }))
  }

  // One visual row per negotiated case, with the buy and sell legs side by side.
  function groupedSpecials() {
    const g = new Map()
    specials.forEach(r => {
      // Buy and sell are one negotiated case shown on one line. Within an
      // agreement they pair on rung + validity — NOT on vendor: the purchase
      // leg is vendor-locked and the sales leg has no vendor at all, so
      // including it split every SPA into two rows.
      const k = r.spa_id
        ? ['spa', r.spa_id, r.min_qty, r.valid_from, r.valid_to || ''].join('|')
        : [r.price_scope, r.customer_id || '', r.vendor_id || '', r.project_ref || '',
           r.min_qty, r.valid_from, r.valid_to || ''].join('|')
      if (!g.has(k)) g.set(k, { key: k, ...r, buy: null, sell: null })
      const row = g.get(k)
      if (r.price_type === 'PURCHASE') { row.buy = r; row.vendors = r.vendors || row.vendors }
      else                             { row.sell = r }
    })
    return [...g.values()]
  }

  async function saveSpecial() {
    if (spGuard.current) return
    const wantsBuy  = sp.price_kind === 'PURCHASE' || sp.price_kind === 'BOTH'
    const wantsSell = sp.price_kind === 'SALES'    || sp.price_kind === 'BOTH'
    const hasBuy  = wantsBuy  && sp.buy_amount  !== '' && !isNaN(Number(sp.buy_amount))
    const hasSell = wantsSell && sp.sell_amount !== '' && !isNaN(Number(sp.sell_amount))
    if (sp.price_kind === 'BOTH' && (!hasBuy || !hasSell)) { toast('Enter both the purchase and the sales price'); return }
    if (sp.price_scope === 'CUSTOMER' && !sp.customer_id)        { toast('Pick a customer'); return }
    if (!hasBuy && !hasSell)        { toast('Enter a purchase price, a sales price, or both'); return }
    if (!sp.valid_from)             { toast('Valid from is required'); return }
    if (sp.valid_to && sp.valid_to < sp.valid_from) { toast('Valid to cannot be before valid from'); return }
    if (sp.price_scope === 'STOCK' && hasSell) { toast('A stock-order special is a purchase price only'); return }
    if (hasBuy && hasSell && Number(sp.sell_amount) < Number(sp.buy_amount)
        && !window.confirm('The sales price is below the purchase price — that is a loss on every unit. Save anyway?')) return
    spGuard.current = true; setSpSaving(true)
    const { data: { session } } = await sb.auth.getSession()
    const base = {
      item_code:   item.item_code,
      price_scope: sp.price_scope,
      customer_id: sp.price_scope === 'CUSTOMER' ? sp.customer_id : null,
      valid_from:  sp.valid_from,
      valid_to:    sp.valid_to || null,
      project_ref: sp.project_ref.trim() || null,
      notes:       sp.notes.trim() || null,
      min_qty:     sp.min_qty === '' ? 1 : Number(sp.min_qty),
      // NOT approved_by: that column recorded whoever typed the price, so every
      // rate approved itself. A new special is PENDING until a second person
      // approves it, and the resolver ignores anything not approved.
      price_status: 'pending',
      created_by:  session?.user?.id || null,
    }
    const payload = []
    if (hasBuy)  payload.push({ ...base, price_type: 'PURCHASE', amount: Number(sp.buy_amount) })
    if (hasSell) payload.push({ ...base, price_type: 'SALES',    amount: Number(sp.sell_amount) })
    const { error } = await sb.from('item_prices').insert(payload)
    if (error) {
      // the partial unique index rejects a second open special for the same customer
      toast(error.code === '23505'
        ? 'An open special price already exists for this — close it before adding another.'
        : friendlyError(error, 'Could not save the special price'))
      spGuard.current = false; setSpSaving(false); return
    }
    toast('Special price added', 'success')
    setSp(blankSpecial); setSpOpen(false)
    spGuard.current = false; setSpSaving(false)
    await loadSpecials(item.item_code)
  }

  // Closing is never a delete — it end-dates the record so the history survives.
  // Both legs of a case close together; a live sell price with no buy price
  // behind it would quietly misreport margin.
  async function closeSpecial(group) {
    const today = localToday()
    const ids = [group.buy?.id, group.sell?.id].filter(Boolean)
    if (!ids.length) return
    if (!window.confirm(`Close this special price from ${today}? The record is kept, not deleted.`)) return
    const { error } = await sb.from('item_prices').update({ valid_to: today }).in('id', ids)
    if (error) { toast(friendlyError(error, 'Could not close the special price')); return }
    toast('Special price closed', 'success')
    await loadSpecials(item.item_code)
  }

  // Approving is a SECOND person's act. The database refuses an approval by the
  // record's own author (item_prices_approval_shape), which is the whole point:
  // before this, `approved_by` was filled with the session of whoever typed the
  // price, so every rate approved itself.
  async function approveSpecial(group) {
    const ids = [group.buy?.id, group.sell?.id].filter(Boolean)
    if (!ids.length) return
    const { data: { session } } = await sb.auth.getSession()
    const me = session?.user?.id
    // A price backed by a published document (a price list or a vendor scheme
    // flyer) needs no countersignature — anyone can re-check it against the
    // source. Four eyes are for a rate typed from memory, which is the only
    // kind a second person can meaningfully catch. Mirrors the DB constraint
    // item_prices_approval_shape.
    if (!group.price_list_id && group.created_by && group.created_by === me) {
      toast('You entered this price — someone else has to approve it'); return
    }
    if (!window.confirm('Approve this price? Purchase orders will start using it.')) return
    const { error } = await sb.from('item_prices')
      .update({ price_status: 'approved',
                // Document-backed prices record no approver: nobody vouched for
                // the number, the source document does.
                approved_by_user: group.price_list_id ? null : me,
                approved_at: new Date().toISOString() })
      .in('id', ids)
    if (error) { toast(friendlyError(error, 'Could not approve — an approver must be a different person from the author')); return }
    toast('Price approved', 'success')
    await loadSpecials(item.item_code)
  }

  // Replacing a rate is one transaction, not "close the old, remember to add the
  // new": the overlap constraint refuses two live records, so a half-done
  // replacement would leave the item with no price at all.
  async function supersedeSpecial(row) {
    const amount = window.prompt(`New ${row.price_type === 'PURCHASE' ? 'purchase' : 'sales'} price for ${item.item_code} (current ₹${row.amount}):`)
    if (amount == null || amount.trim() === '' || isNaN(Number(amount))) return
    const from = window.prompt('Effective from (YYYY-MM-DD):', localToday())
    if (!from) return
    const { data, error } = await sb.rpc('supersede_item_price', {
      p_old_id: row.id, p_amount: Number(amount), p_valid_from: from,
    })
    if (error) { toast(friendlyError(error, 'Could not supersede this price')); return }
    toast(data ? 'New price recorded — it needs approving before POs use it' : 'Done', 'success')
    await loadSpecials(item.item_code)
  }

  function specialStatus(r) {
    const today = localToday()
    // Approval outranks dates: an unapproved record cannot price anything, so
    // calling it "Active" because its window is open would be a lie.
    if (r.price_status === 'pending')    return { label: 'Awaiting approval', bg: '#fffbeb', fg: '#b45309' }
    if (r.price_status === 'superseded') return { label: 'Superseded', bg: 'var(--gray-100)', fg: 'var(--gray-500)' }
    if (r.valid_from > today) return { label: 'Future',  bg: '#eff6ff', fg: '#1d4ed8' }
    if (r.valid_to && r.valid_to < today) return { label: 'Expired', bg: 'var(--gray-100)', fg: 'var(--gray-500)' }
    return { label: 'Active', bg: '#f0fdf4', fg: '#166534' }
  }

  const TABS = [
    { key: 'summary',  label: 'Summary' },
    ...((commercials || specials.length) ? [{ key: 'commercials', label: 'Commercials' }] : []),
    { key: 'orders',   label: `Order History (${kpi.totalOrders})` },
    // PO History carries vendor unit prices — what we PAY. Sales sees the item,
    // the orders and the stock, but not our buying price.
    ...(canSeePurchase ? [{ key: 'pos', label: `PO History (${kpi.totalPos})` }] : []),
    { key: 'grns',     label: `GRNs (${kpi.totalGrns})` },
    { key: 'transfers', label: `Internal Transfers (${transfers.length})` },
  ]

  return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <div className="c360-page">
        <div className="c360-body">

          {/* Back */}
          <button onClick={() => navigate('/items')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16, padding: '6px 12px', border: '1px solid var(--gray-200)', borderRadius: 8, background: 'white', fontSize: 13, color: 'var(--gray-600)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 14, height: 14 }}><polyline points="15 18 9 12 15 6" /></svg>
            Item 360
          </button>

          {/* Hero */}
          <div className="c360-hero" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div className="c360-hero-avatar" style={{ background: '#1a73e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 26, height: 26 }}>
                  <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 5 }}>{item.item_no}</span>
                  <TypeBadge type={item.type} />
                  {item.brand && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>{item.brand}</span>}
                  {item.category && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#f0fdf4', color: '#166534', fontWeight: 600 }}>{item.category}</span>}
                  {/* A retired part is marked here rather than hidden, the same
                      way a blacklisted customer is. Without this the status set
                      in the database would be invisible, and nobody could undo
                      it — items have no edit screen anywhere else in the app. */}
                  {item.item_status && item.item_status !== 'Active' && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                      background: item.item_status === 'Superseded' ? '#fffbeb' : '#fef2f2',
                      color:      item.item_status === 'Superseded' ? '#b45309' : '#dc2626' }}>
                      {item.item_status.toUpperCase()}
                      {item.superseded_by && ` — use ${item.superseded_by}`}
                    </span>
                  )}
                  {canEditPrices && (
                    <button onClick={openStatus} disabled={savingStatus}
                      style={{ fontSize: 11, fontWeight: 600, padding: '2px 9px', borderRadius: 6,
                               border: '1px solid var(--gray-300)', background: 'white',
                               color: 'var(--gray-600)', cursor: 'pointer' }}>
                      {item.item_status && item.item_status !== 'Active' ? 'Change status' : 'Retire item'}
                    </button>
                  )}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 800, color: 'var(--gray-900)', letterSpacing: '-0.3px', wordBreak: 'break-all' }}>{item.item_code}</div>
                {item.description && (
                  <div style={{ fontSize: 13, color: 'var(--gray-700)', marginTop: 5 }}>{item.description}</div>
                )}
                {(item.subcategory || item.series) && (
                  <div style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 3 }}>
                    {[item.subcategory, item.series].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </div>

            {/* KPI tiles */}
            <div className="c360-stats" style={{ marginTop: 16 }}>
              {[
                { label: 'Total Orders',     val: kpi.totalOrders,     color: '#1a73e8' },
                { label: 'Pending Orders',   val: kpi.pendingOrders,   color: '#92400e' },
                { label: 'Delivered Orders', val: kpi.deliveredOrders, color: '#166534' },
                { label: 'Total POs',        val: kpi.totalPos,        color: '#5b21b6' },
                { label: 'Pending POs',      val: kpi.pendingPos,      color: '#92400e' },
                { label: 'Received POs',     val: kpi.receivedPos,     color: '#166534' },
                { label: 'GRNs',             val: kpi.totalGrns,       color: '#0d9488' },
                { label: 'Internal Transfers', val: transfers.length,  color: '#0891b2' },
                { label: 'Transfer Qty',     val: transferQty,         color: '#0891b2' },
              ].map(k => (
                <div key={k.label} className="c360-stat">
                  <span className="c360-stat-label">{k.label}</span>
                  <span className="c360-stat-value" style={{ color: k.color }}>{k.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="c360-tabs" style={{ marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.key} className={'c360-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Summary Tab ── */}
          {tab === 'summary' && (
            <div className="c360-summary-grid">
              <div className="c360-card" style={{ padding: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 16 }}>Item Details</div>
                <div className="c360-field-grid">
                  {[
                    { label: 'Item No',     val: <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{item.item_no || '—'}</span> },
                    { label: 'Item Code',   val: <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, wordBreak: 'break-all' }}>{item.item_code}</span> },
                    { label: 'Description', val: item.description || '—' },
                    { label: 'MOQ',         val: item.moq || '—' },
                    { label: 'Brand',       val: item.brand || '—' },
                    { label: 'Category',    val: item.category || '—' },
                    { label: 'Subcategory', val: item.subcategory || '—' },
                    { label: 'Series',      val: item.series || '—' },
                    { label: 'Type',        val: <TypeBadge type={item.type} /> },
                    // Status sits with the item's own facts, not only as a pill
                    // in the header — Item Details is where someone looks to
                    // ask "what is this item", and a retired one must answer.
                    { label: 'Status', val: (item.item_status && item.item_status !== 'Active')
                        ? <span style={{ fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                            background: item.item_status === 'Superseded' ? '#fffbeb' : '#fef2f2',
                            color:      item.item_status === 'Superseded' ? '#b45309' : '#dc2626' }}>
                            {item.item_status.toUpperCase()}{item.superseded_by && ` — use ${item.superseded_by}`}
                          </span>
                        : <span style={{ fontSize: 11.5, fontWeight: 600, color: '#166534' }}>Active</span> },
                    { label: 'Added On',    val: fmt(item.created_at) },
                    { label: 'Added By',    val: item.created_by ? (auditNames[item.created_by] || '—') : <span style={{ color:'var(--gray-400)' }}>Legacy / unknown</span> },
                    ...(item.updated_by && item.updated_by !== item.created_by
                      ? [{ label: 'Last Edited By', val: (auditNames[item.updated_by] || '—') + (item.updated_at ? ' · ' + fmt(item.updated_at) : '') }]
                      : []),
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{f.label}</div>
                      <div style={{ fontSize: 13, color: 'var(--gray-800)' }}>{f.val}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="c360-card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 12 }}>Notes</div>
                  <div style={{ fontSize: 13, color: item.notes ? 'var(--gray-700)' : 'var(--gray-300)', lineHeight: 1.6, minHeight: 60 }}>
                    {item.notes || 'No notes added.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Commercials Tab ── */}
          {tab === 'commercials' && (commercials || specials.length > 0) && (
            <>
              {/* Same stat tiles as the header KPI row, so the numbers read at the app's scale */}
              {commercials && <div className="c360-stats" style={{ marginBottom: 14 }}>
                <div className="c360-stat">
                  <span className="c360-stat-label">List Price</span>
                  <span className="c360-stat-value">{rupee(commercials.list_price)}</span>
                </div>
                <div className="c360-stat">
                  <span className="c360-stat-label">Standard Discount</span>
                  <span className="c360-stat-value">{commercials.standard_discount_pct != null ? Number(commercials.standard_discount_pct) + '%' : '—'}</span>
                </div>
                <div className="c360-stat">
                  <span className="c360-stat-label">Purchase Price</span>
                  <span className="c360-stat-value green">{commercials.standard_purchase_price != null ? rupee(commercials.standard_purchase_price) : '—'}</span>
                </div>
                <div className="c360-stat">
                  <span className="c360-stat-label">Stock Status</span>
                  <span className="c360-stat-value">{commercials.stock_indicator || '—'}</span>
                </div>
                <div className="c360-stat">
                  <span className="c360-stat-label">MOQ</span>
                  <span className="c360-stat-value">{item.moq || 1}</span>
                </div>
              </div>}

              {commercials && <div className="c360-card" style={{ marginBottom: 14 }}>
                <div className="c360-card-header"><span className="c360-card-title">Price Source</span></div>
                <div className="c360-card-body">
                  <div className="c360-field-grid" style={{ marginBottom: 0 }}>
                    {[
                      { label: 'Price List',     val: commercials.price_source || '—' },
                      { label: 'Page',           val: commercials.page_ref ? 'p' + commercials.page_ref : '—' },
                      { label: 'Effective From', val: commercials.price_valid_from },
                      { label: 'Discount Group', val: commercials.discount_group || 'No partner discount — series superseded' },
                      ...(commercials.model_as_printed && commercials.model_as_printed !== item.item_code
                        ? [{ label: 'Listed As', val: <span style={{ fontFamily: 'var(--mono)' }}>{commercials.model_as_printed}</span> }]
                        : []),
                    ].map(f => (
                      <div key={f.label}>
                        <div style={{ fontSize: 10, color: 'var(--gray-400)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 3 }}>{f.label}</div>
                        <div style={{ fontSize: 13, color: 'var(--gray-800)' }}>{f.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>}

              <div className="c360-card">
                <div className="c360-card-header">
                  <span className="c360-card-title">Special Prices ({specials.length})</span>
                  {canEditPrices && (
                    <button className="od-btn od-btn-approve" onClick={() => { setSp({ ...blankSpecial }); setSpOpen(true) }}>
                      Add Special Price
                    </button>
                  )}
                </div>
                <div className="c360-card-body">
                  {specials.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--gray-400)' }}>
                      No special prices.{commercials?.standard_discount_pct != null && <> The standard {Number(commercials.standard_discount_pct)}% partner rate applies.</>}
                    </div>
                  ) : (
                    // The Orders list is the reference layout for any list in this
                    // app (CLAUDE.md), so this uses the same .ol-* rows rather than
                    // a table of its own. Those classes are scoped under
                    // .orders-app, which also carries page chrome — background and
                    // padding are neutralised so only the tokens and row styles
                    // come through.
                    <div className="orders-app" style={{ background: 'transparent', padding: 0 }}>
                      {/* The row keeps its natural column widths and the CARD
                          scrolls, rather than columns collapsing into each
                          other — which is what made the headers overlap. */}
                      <div className="ol-wrap" style={{ marginTop: 0, overflowX: 'auto' }}>
                        <div className="ol-row ol-head" style={{ gridTemplateColumns: SPA_COLS }}>
                          <div>For</div>
                          <div className="num">From Qty</div>
                          <div className="num">We Buy At</div>
                          <div className="num">We Sell At</div>
                          <div className="num">Margin</div>
                          <div>Valid</div>
                          <div>Agreement</div>
                          <div>Status</div>
                          {canEditPrices && <div></div>}
                        </div>
                        <div className="ol-table">
                          {groupedSpecials().map(g => {
                            const st = specialStatus(g)
                            const lp = Number(commercials?.list_price || 0)
                            const off = a => (lp ? Math.round((1 - Number(a) / lp) * 1000) / 10 + '% off' : '')
                            const margin = (g.buy && g.sell)
                              ? Math.round((1 - Number(g.buy.amount) / Number(g.sell.amount)) * 1000) / 10
                              : null
                            const forWhom = g.price_scope === 'CUSTOMER' ? (g.customers?.customer_name || 'Customer')
                                          : g.price_scope === 'PROJECT'  ? `Project · ${g.project_ref || '—'}`
                                          : 'Our stock order'
                            return (
                              <div key={g.key} className="ol-row ol-data" style={{ gridTemplateColumns: SPA_COLS, cursor: 'default',
                                                opacity: st.label === 'Expired' || st.label === 'Superseded' ? 0.55 : 1 }}>
                                <div className="ol-cell" title={forWhom}>
                                  <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{forWhom}</div>
                                  {g.vendors?.vendor_name && (
                                    <div title={g.vendors.vendor_name}
                                      style={{ fontSize: 10.5, color: 'var(--o-muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      via {g.vendors.vendor_name}
                                    </div>
                                  )}
                                </div>
                                <div className="ol-cell num" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{g.min_qty || 1}</div>
                                <div className="ol-cell num" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                                  {g.buy ? <>{rupee(g.buy.amount)}<div style={{ fontSize: 10.5, color: 'var(--o-muted-2)', fontFamily: 'var(--font)' }}>{off(g.buy.amount)}</div></> : '—'}
                                </div>
                                <div className="ol-cell num" style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>
                                  {g.sell ? <>{rupee(g.sell.amount)}<div style={{ fontSize: 10.5, color: 'var(--o-muted-2)', fontFamily: 'var(--font)' }}>{off(g.sell.amount)}</div></> : '—'}
                                </div>
                                <div className="ol-cell num" style={{ textAlign: 'right', fontWeight: 'var(--fw-semibold)',
                                     color: margin == null ? 'var(--o-muted-2)' : margin < 0 ? 'var(--o-bad)' : 'var(--green-text)' }}>
                                  {margin == null ? '—' : margin + '%'}
                                </div>
                                <div className="ol-cell" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{g.valid_from} → {g.valid_to || 'open'}</div>
                                <div className="ol-cell">
                                  {/* The agreement this rate belongs to. Without it a
                                      negotiated price is a loose number with no document
                                      behind it — you can see WHAT we pay but not WHY. */}
                                  {g.special_price_agreements ? (
                                    <button onClick={() => setSpaOpen({ ...g.special_price_agreements, id: g.spa_id })}
                                      style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left',
                                               fontFamily:'var(--mono)', fontSize:11.5, color:'var(--ssc-blue)',
                                               fontWeight:'var(--fw-semibold)' }}>
                                      {g.special_price_agreements.spa_no}
                                    </button>
                                  ) : <span style={{ color:'var(--o-muted-2)' }}>{g.project_ref || '—'}</span>}
                                </div>
                                <div className="ol-cell ol-status-cell">
                                  <span className="ol-status-pill" style={{ '--stage-color': st.fg }}>
                                    <span className="ol-status-dot"/>{st.label}
                                  </span>
                                </div>
                                {canEditPrices && (
                                  <div className="ol-cell" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                                    {/* Labelled actions, never a bare icon — these change what we pay. */}
                                    {g.price_status === 'pending' && (
                                      <button className="od-btn od-btn-approve" style={BTN_SM} onClick={() => approveSpecial(g)}>Approve</button>
                                    )}
                                    {g.price_status === 'approved' && !g.valid_to && g.buy && (
                                      <button className="od-btn" style={BTN_SM} onClick={() => supersedeSpecial(g.buy)}>New rate</button>
                                    )}
                                    {!g.valid_to && <button className="od-btn" style={BTN_SM} onClick={() => closeSpecial(g)}>Close</button>}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Order History Tab ── */}
          {tab === 'orders' && (() => {
            // Footer totals exclude cancelled (not counted), even though cancelled rows stay visible.
            const nonCancelled = ordersF.filtered.filter(r => r.orders?.status !== 'cancelled')
            return (
            <div className="c360-card">
              {orders.length === 0 ? (
                <div className="c360-hempty">No orders found for this item.</div>
              ) : (
                <>
                  <HistoryFilterBar f={ordersF} placeholder="Search order # or customer…" />
                  {ordersF.filtered.length === 0 ? (
                    <div className="c360-hempty">No orders match the current filters.</div>
                  ) : (
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>Order #</th>
                        <th>Customer</th>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Qty Ordered</th>
                        <th style={{ width: 110, textAlign: 'right' }}>Qty Dispatched</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Unit Price</th>
                        <th style={{ width: 150, textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordersF.paginated.map(r => (
                        <tr key={r.id} onClick={() => navigate('/orders/' + r.orders?.id)} style={{ cursor: 'pointer' }}>
                          <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#1a73e8' }}>{r.orders?.order_number || '—'}</span></td>
                          <td style={{ fontSize: 13 }}>{r.orders?.customer_name || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.orders?.order_date)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.dispatched_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{inr(r.unit_price_after_disc)}</td>
                          <td><StatusBadge status={r.orders?.status} map={ORDER_STATUS} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                        <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({nonCancelled.length} orders, excl. cancelled)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{nonCancelled.reduce((s, r) => s + (r.qty || 0), 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{nonCancelled.reduce((s, r) => s + (r.dispatched_qty || 0), 0)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                  )}
                  <HistoryPager f={ordersF} />
                </>
              )}
            </div>
            )
          })()}

          {/* ── PO History Tab ── */}
          {tab === 'pos' && canSeePurchase && (
            // Cancelled POs stay hidden here (poRows already excludes them), per earlier ask.
            <div className="c360-card">
              {poRows.length === 0 ? (
                <div className="c360-hempty">No purchase orders found for this item.</div>
              ) : (
                <>
                  <HistoryFilterBar f={posF} placeholder="Search PO # or vendor…" />
                  {posF.filtered.length === 0 ? (
                    <div className="c360-hempty">No purchase orders match the current filters.</div>
                  ) : (
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>PO #</th>
                        <th>Vendor</th>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ width: 80, textAlign: 'right' }}>Qty</th>
                        <th style={{ width: 110, textAlign: 'right' }}>Qty Received</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Unit Price</th>
                        <th style={{ width: 150, textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posF.paginated.map(r => (
                        <tr key={r.id} onClick={() => navigate('/procurement/po/' + r.purchase_orders?.id)} style={{ cursor: 'pointer' }}>
                          <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#5b21b6' }}>{r.purchase_orders?.po_number || '—'}</span></td>
                          <td style={{ fontSize: 13 }}>{r.purchase_orders?.vendor_name || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.purchase_orders?.po_date)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.received_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{inr(r.unit_price)}</td>
                          <td><StatusBadge status={r.purchase_orders?.status} map={PO_STATUS} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                        <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({posF.filtered.length} rows)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{posF.filtered.reduce((s, r) => s + (r.qty || 0), 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{posF.filtered.reduce((s, r) => s + (r.received_qty || 0), 0)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                  )}
                  <HistoryPager f={posF} />
                </>
              )}
            </div>
          )}

          {/* ── GRN History Tab ── */}
          {tab === 'grns' && (
            <div className="c360-card">
              {grns.length === 0 ? (
                <div className="c360-hempty">No GRNs found for this item.</div>
              ) : (
                <>
                  <HistoryFilterBar f={grnsF} placeholder="Search GRN # or vendor…" />
                  {grnsF.filtered.length === 0 ? (
                    <div className="c360-hempty">No GRNs match the current filters.</div>
                  ) : (
                  <table className="od-items-table">
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>GRN #</th>
                        <th>Vendor / Source</th>
                        <th style={{ width: 120 }}>Type</th>
                        <th style={{ width: 110 }}>Received</th>
                        <th style={{ width: 100, textAlign: 'right' }}>Qty Received</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Accepted</th>
                        <th style={{ width: 90, textAlign: 'right' }}>Rejected</th>
                        <th style={{ width: 130, textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grnsF.paginated.map(r => (
                        <tr key={r.id} onClick={() => navigate('/fc/grn/' + r.grn?.id)} style={{ cursor: 'pointer' }}>
                          <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#0d9488' }}>{r.grn?.grn_number || '—'}</span></td>
                          <td style={{ fontSize: 13 }}>{r.grn?.vendor_name || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{GRN_TYPE_LABELS[r.grn?.grn_type] || r.grn?.grn_type?.replace(/_/g, ' ') || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.grn?.received_at)}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.received_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.accepted_qty ?? '—'}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, color: (r.rejected_qty || 0) > 0 ? '#dc2626' : undefined }}>{r.rejected_qty ?? '—'}</td>
                          <td><StatusBadge status={r.grn?.status} map={GRN_STATUS} /></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                        <td colSpan={4} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({grnsF.filtered.length} rows)</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{grnsF.filtered.reduce((s, r) => s + (r.received_qty || 0), 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{grnsF.filtered.reduce((s, r) => s + (r.accepted_qty || 0), 0)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{grnsF.filtered.reduce((s, r) => s + (r.rejected_qty || 0), 0)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                  )}
                  <HistoryPager f={grnsF} />
                </>
              )}
            </div>
          )}

          {/* ── Internal Transfers Tab ── */}
          {tab === 'transfers' && (
            <div className="c360-card">
              {transfers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--gray-400)', fontSize: 13 }}>No internal transfers for this item.</div>
              ) : (
                <table className="od-items-table">
                  <thead>
                    <tr>
                      <th>Transfer #</th>
                      <th>Route</th>
                      <th>Date</th>
                      <th style={{ textAlign: 'right' }}>Qty Sent</th>
                      <th style={{ textAlign: 'right' }}>Qty Received</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map(r => (
                      <tr key={r.id} onClick={() => navigate('/fc/transfers/' + r.stock_transfers?.id)} style={{ cursor: 'pointer' }}>
                        <td><span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: '#0891b2' }}>{r.stock_transfers?.transfer_number || '—'}</span></td>
                        <td style={{ fontSize: 13 }}>{r.stock_transfers?.source_fc} → {r.stock_transfers?.destination_fc}</td>
                        <td style={{ fontSize: 12, color: 'var(--gray-500)' }}>{fmt(r.stock_transfers?.created_at)}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.qty}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12 }}>{r.received_qty || '—'}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: r.stock_transfers?.status === 'received' ? '#d1fae5' : r.stock_transfers?.status === 'cancelled' ? '#fee2e2' : '#dbeafe', color: r.stock_transfers?.status === 'received' ? '#065f46' : r.stock_transfers?.status === 'cancelled' ? '#991b1b' : '#1e40af' }}>{r.stock_transfers?.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: '2px solid var(--gray-200)', background: 'var(--gray-50)' }}>
                      <td colSpan={3} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--gray-600)' }}>Total ({transfers.length} rows)</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{transfers.reduce((s, r) => s + (r.qty || 0), 0)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, padding: '8px 12px' }}>{transfers.reduce((s, r) => s + (r.received_qty || 0), 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Same drawer as Customer 360 and Vendor 360 — components/SpaPanel.jsx.
          side="both" because this tab is already RLS-gated to the roles allowed
          to see a purchase price. */}
      {spaOpen && (
        <SpaDrawer spa={spaOpen} side="both" highlightItem={item.item_code}
                   onClose={() => setSpaOpen(null)} />
      )}

      {/* Add special price — docks bottom-right (same .gcompose chrome as the
          PO compose window) so the list price stays readable while you type. */}
      {spOpen && commercials && (
        <div className="gcompose">
          <div className="gcompose-head">
            <span className="gcompose-title">Special price · {item.item_code}</span>
            <button className="gcompose-btn" onClick={() => setSpOpen(false)} title="Close">✕</button>
          </div>
          <div className="gcompose-body" style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 14 }}>
              List price {rupee(commercials.list_price)}
              {commercials.standard_discount_pct != null && <> · standard {Number(commercials.standard_discount_pct)}% = {rupee(commercials.standard_purchase_price)}</>}
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={SP_LABEL}>Special price for</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SPECIAL_SCOPES.map(([v, l]) => (
                  <button key={v} type="button"
                    className={'od-btn' + (sp.price_scope === v ? ' od-btn-approve' : '')}
                    onClick={() => setSp(p => ({ ...p, price_scope: v, customer_id: '', customer_name: '',
                      // a stock-order special is a buy price by definition
                      price_kind: v === 'STOCK' ? 'PURCHASE' : p.price_kind }))}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {sp.price_scope === 'CUSTOMER' && (
              <div style={{ marginBottom: 14 }}>
                <label style={SP_LABEL}>Customer</label>
                <Typeahead
                  value={sp.customer_name}
                  placeholder="Search customer"
                  strictSelect
                  onChange={v => setSp(p => ({ ...p, customer_name: v, customer_id: '' }))}
                  onSelect={c => setSp(p => ({ ...p, customer_id: c.id, customer_name: c.customer_name }))}
                  fetchFn={async q => {
                    const { data } = await sb.from('customers').select('id,customer_name')
                      .ilike('customer_name', '%' + q + '%').limit(10)
                    return data || []
                  }}
                  renderItem={c => c.customer_name}
                />
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={SP_LABEL}>This price is</label>
              <select style={SP_INPUT} value={sp.price_kind}
                onChange={e => setSp(p => ({ ...p, price_kind: e.target.value }))}>
                <option value="PURCHASE">Purchase price — what we pay</option>
                {sp.price_scope !== 'STOCK' && <option value="SALES">Sales price — what the customer pays</option>}
                {sp.price_scope !== 'STOCK' && <option value="BOTH">Both — fix the buy and the sell</option>}
              </select>
            </div>

            {(sp.price_kind === 'PURCHASE' || sp.price_kind === 'BOTH') && (
              <div style={{ marginBottom: 6 }}>
                <label style={SP_LABEL}>What we buy at</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <input style={SP_INPUT} type="number" min="0" max="99.9" step="0.1" value={sp.buy_pct}
                    onChange={e => spSetPct('buy', e.target.value)} placeholder="Discount % e.g. 72" />
                  <input style={SP_INPUT} type="number" min="0" step="0.01" value={sp.buy_amount}
                    onChange={e => spSetAmount('buy', e.target.value)} placeholder="or net ₹" />
                </div>
              </div>
            )}

            {(sp.price_kind === 'SALES' || sp.price_kind === 'BOTH') && sp.price_scope !== 'STOCK' && (
              <div style={{ marginBottom: 6 }}>
                <label style={SP_LABEL}>What we sell at</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <input style={SP_INPUT} type="number" min="0" max="99.9" step="0.1" value={sp.sell_pct}
                    onChange={e => spSetPct('sell', e.target.value)} placeholder="Discount % e.g. 55" />
                  <input style={SP_INPUT} type="number" min="0" step="0.01" value={sp.sell_amount}
                    onChange={e => spSetAmount('sell', e.target.value)} placeholder="or net ₹" />
                </div>
              </div>
            )}

            {sp.price_kind === 'BOTH' && sp.buy_amount !== '' && sp.sell_amount !== '' && !isNaN(Number(sp.buy_amount)) && !isNaN(Number(sp.sell_amount)) && Number(sp.sell_amount) > 0 && (
              <div style={{ fontSize: 12, marginBottom: 14, color: Number(sp.sell_amount) < Number(sp.buy_amount) ? '#b91c1c' : '#166534' }}>
                Margin {Math.round((1 - Number(sp.buy_amount) / Number(sp.sell_amount)) * 1000) / 10}%
                {' · '}{rupee(Number(sp.sell_amount) - Number(sp.buy_amount))} per unit
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={SP_LABEL}>Applies from quantity (MOQ)</label>
              <input style={SP_INPUT} type="number" min="1" step="1" value={sp.min_qty}
                onChange={e => setSp(p => ({ ...p, min_qty: e.target.value }))}
                placeholder="1 = from the first unit" />
              <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 4 }}>
                Add a second special at a higher quantity for a volume break.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={SP_LABEL}>Valid from</label>
                <input style={SP_INPUT} type="date" value={sp.valid_from}
                  onChange={e => setSp(p => ({ ...p, valid_from: e.target.value }))} />
              </div>
              <div>
                <label style={SP_LABEL}>Valid to</label>
                <input style={SP_INPUT} type="date" value={sp.valid_to} min={sp.valid_from || undefined}
                  onChange={e => setSp(p => ({ ...p, valid_to: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={SP_LABEL}>Approval / project reference</label>
              <input style={SP_INPUT} value={sp.project_ref}
                onChange={e => setSp(p => ({ ...p, project_ref: e.target.value }))}
                placeholder="OEM approval ref (optional)" />
            </div>

            <div>
              <label style={SP_LABEL}>Notes</label>
              <textarea style={{ ...SP_INPUT, minHeight: 60, resize: 'vertical' }} value={sp.notes}
                onChange={e => setSp(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div className="gcompose-foot">
            <span style={{ flex: 1, fontSize: 11, color: 'var(--gray-400)' }}>Recorded and approved by you — only admin and management can add these.</span>
            <button className="od-btn" onClick={() => setSpOpen(false)}>Cancel</button>
            <button className="od-btn od-btn-approve" onClick={saveSpecial} disabled={spSaving}>
              {spSaving ? 'Saving…' : 'Save special price'}
            </button>
          </div>
        </div>
      )}
    </Layout>
  )
}
