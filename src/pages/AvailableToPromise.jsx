// Available to Promise (ATP) — which pending orders can actually be dispatched
// today, given the godown stock uploaded this morning.
//
// Matching + FIFO allocation live in src/lib/dispatchability.js (exact-match
// only, running decrement). This page is presentation: it fetches, allocates,
// and renders. It is READ-ONLY — nothing here writes to the database. The
// list is advisory; enforcement stays in the dispatch flow (FIFO jump warning
// + dispatch_order_batch).
import { useState, useEffect } from 'react'
import { codeIncludes } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, fmtTs, FY_START } from '../lib/fmt'
import { fetchAll } from '../lib/fetchAll'
import { TERMINAL_STATUSES } from '../lib/orderStatus'
import { buildStockMap, allocateFifo, deriveOrderBucket, computeCounts, ORDER_BUCKET, BUCKET } from '../lib/dispatchability'
import { toast } from '../lib/toast'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import Layout from '../components/Layout'
import Loading from '../components/Loading'
import PeopleAvatar from '../components/PeopleAvatar'
import '../styles/orders-redesign.css'

function OwnerChip({ name }) {
  if (!name) return <span style={{color:'var(--o-muted-2)'}}>—</span>
  return (
    <div className="ol-owner" title={name}>
      <PeopleAvatar name={name} className="ol-owner-avatar" />
      <span className="ol-owner-name">{name}</span>
    </div>
  )
}

// Coverage pill colors (order buckets)
const COVERAGE = {
  [ORDER_BUCKET.FULL]:            { label: 'Full Stock',    color: '#16A34A' },
  [ORDER_BUCKET.PARTIAL]:         { label: 'Partial',       color: '#D97706' },
  [ORDER_BUCKET.BLOCKED_PARTIAL]: { label: 'Partials OFF',  color: '#B45309' },
  [ORDER_BUCKET.NO_STOCK]:        { label: 'No Stock',      color: '#94A3B8' },
  [ORDER_BUCKET.NOT_IN_SHEET]:    { label: 'Not in Sheet',  color: '#64748B' },
}
const LINE_COVERAGE = {
  [BUCKET.FULL]:         { label: 'Full',         color: '#16A34A' },
  [BUCKET.PARTIAL]:      { label: 'Partial',      color: '#D97706' },
  [BUCKET.NO_STOCK]:     { label: 'No Stock',     color: '#94A3B8' },
  [BUCKET.NOT_IN_SHEET]: { label: 'Not in Sheet', color: '#64748B' },
}

const CHIPS = [
  { key: 'dispatchable', label: 'Dispatchable' },
  { key: ORDER_BUCKET.FULL, label: 'Full Stock' },
  { key: ORDER_BUCKET.PARTIAL, label: 'Partial' },
  { key: ORDER_BUCKET.BLOCKED_PARTIAL, label: 'Partials OFF', tone: 'warn' },
  { key: ORDER_BUCKET.NO_STOCK, label: 'No Stock' },
  { key: ORDER_BUCKET.NOT_IN_SHEET, label: 'Not in Sheet' },
  { key: 'all', label: 'All' },
]
const isDispatchable = (r) => r.bucket === ORDER_BUCKET.FULL || r.bucket === ORDER_BUCKET.PARTIAL
function matchChip(r, chip) {
  if (chip === 'all') return true
  if (chip === 'dispatchable') return isDispatchable(r)
  return r.bucket === chip
}

const STALE_AMBER_H = 25 // same threshold the Upload page uses (24h + grace)
const STALE_RED_H = 49

// Allocation snapshot cache — per browser, per mode. Opening the page shows
// the LAST synced allocation (with its timestamp); only the Sync button
// re-runs the stock match. Delivered/terminal orders are still dropped on
// every load so an already-shipped order can never look dispatchable.
const cacheKey = (testMode) => `atp_snapshot_v1_${testMode ? 'test' : 'live'}`
function readCache(testMode) {
  try { const raw = localStorage.getItem(cacheKey(testMode)); return raw ? JSON.parse(raw) : null } catch { return null }
}
function writeCache(testMode, ts, result) {
  try { localStorage.setItem(cacheKey(testMode), JSON.stringify({ ts, result })) } catch { /* quota/private mode — page just syncs each load */ }
}

export default function AvailableToPromise() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name: '', role: '', id: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [result, setResult] = useState(null)       // allocateFifo() output (live or cached)
  const [freshness, setFreshness] = useState([])   // [{ loc, updatedAt, count }]
  const [tornLocs, setTornLocs] = useState([])
  const [ghostLocs, setGhostLocs] = useState([])
  const [lastSynced, setLastSynced] = useState(null)   // when the shown allocation was computed
  const [newSinceSync, setNewSinceSync] = useState(0)  // pending orders not in the snapshot — bannered, never hidden
  const [tab, setTab] = useState('SO')
  const [chip, setChip] = useState('dispatchable')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [showTest, setShowTest] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const PAGE_SIZE = 50

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    // Ops planning surface — ops / admin / management only (user directive)
    if (!['ops', 'admin', 'management'].includes(role)) { navigate('/not-authorized'); return }
    setUser({ name: profile?.name || '', role, id: session.user.id })
    await open(false)
  }

  // Page open: show the last synced snapshot (no stock re-match), refresh only
  // the order side so delivered orders drop off. First visit → full sync.
  async function open(testMode) {
    const cache = readCache(testMode)
    if (!cache?.result?.orders) { await fullSync(testMode); return }
    await refreshFromCache(testMode, cache)
  }

  function fetchOrders(testMode) {
    return fetchAll((from, to) =>
      sb.from('orders')
        .select('id,order_number,customer_name,account_owner,engineer_name,order_date,order_type,status,partial_deliveries_allowed,hold_party,hold_reason,fulfilment_center,order_items(id,sr_no,item_code,qty,dispatched_qty,cancelled_qty,line_status,unit_price_after_disc)')
        .gte('created_at', FY_START).eq('is_test', testMode)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to))
  }

  async function loadFreshness(statusRes, invRows) {
    if (statusRes && !statusRes.error && statusRes.data?.length) {
      setFreshness(statusRes.data.map(r => ({ loc: r.location, updatedAt: new Date(r.max_updated_at), count: r.count })))
      return
    }
    const map = {}
    for (const r of invRows || []) {
      const loc = (r.location || 'Unknown').trim()
      const d = new Date(r.updated_at)
      if (!map[loc] || d > map[loc].updatedAt) map[loc] = { updatedAt: d, count: 0 }
    }
    for (const r of invRows || []) { const loc = (r.location || 'Unknown').trim(); if (map[loc]) map[loc].count++ }
    setFreshness(Object.entries(map).map(([loc, v]) => ({ loc, ...v })).sort((a, b) => a.loc.localeCompare(b.loc)))
  }

  // The Sync button: re-read orders + the full stock sheet, re-run FIFO.
  async function fullSync(testMode = false) {
    setLoading(true)
    setLoadError(null)
    try {
      const [ordersRes, invRes, statusRes] = await Promise.all([
        fetchOrders(testMode),
        // Whole stock sheet — fetchAll, NOT a single capped select (1000-row trap)
        fetchAll((from, to) =>
          sb.from('inventory').select('product_code,quantity,location,updated_at')
            .order('id', { ascending: true })
            .range(from, to)
        ),
        sb.rpc('get_inventory_status'),
      ])
      if (ordersRes.error) throw ordersRes.error
      if (invRes.error) throw invRes.error

      // Live orders only; SAMPLE excluded from ATP (SO/CO are the two lists)
      const live = (ordersRes.data || []).filter(o =>
        !TERMINAL_STATUSES.includes(o.status) && o.order_type !== 'SAMPLE')

      const smap = buildStockMap(invRes.data || [])
      setGhostLocs(smap.ghostLocations)
      // Torn-upload probe: a normal upload stamps every qty>0 row of a location
      // with one timestamp. A wide min↔max spread means a half-finished upload.
      setTornLocs(Object.entries(smap.freshness)
        .filter(([, f]) => new Date(f.max) - new Date(f.min) > 2 * 3600000)
        .map(([loc]) => loc))
      await loadFreshness(statusRes, invRes.data)

      const alloc = allocateFifo(live, smap)
      const ts = new Date().toISOString()
      setResult(alloc)
      setLastSynced(new Date(ts))
      setNewSinceSync(0)
      writeCache(testMode, ts, alloc)
      setExpanded(new Set())
      setPage(1)
    } catch (e) {
      console.error('ATP sync error:', e)
      setLoadError(e.message || 'Failed to load')
      toast('Available to Promise failed to sync: ' + (e.message || e), 'error')
      setResult(null)
    }
    setLoading(false)
  }

  // Cached view: allocation untouched, but the order side is refreshed —
  // delivered/terminal/fully-batched orders are dropped, hold flags and the
  // partials toggle are updated, and orders NEW since the snapshot are counted
  // into a banner (never silently missing).
  async function refreshFromCache(testMode, cache) {
    setLoading(true)
    setLoadError(null)
    try {
      const [ordersRes, statusRes] = await Promise.all([fetchOrders(testMode), sb.rpc('get_inventory_status')])
      if (ordersRes.error) throw ordersRes.error
      await loadFreshness(statusRes, null)

      const freshById = new Map((ordersRes.data || []).map(o => [o.id, o]))
      const hasPend = (o) => (o.order_items || []).some(i =>
        i.line_status !== 'cancelled' && Math.max(0, (i.qty || 0) - (i.dispatched_qty || 0) - (i.cancelled_qty || 0)) > 0)

      const rows = []
      const snapIds = new Set()
      for (const r of cache.result.orders) {
        snapIds.add(r.order_id)
        const fresh = freshById.get(r.order_id)
        if (!fresh) continue                                  // order gone (deleted) — nothing to show
        if (TERMINAL_STATUSES.includes(fresh.status)) continue // delivered/closed/cancelled since sync
        if (!hasPend(fresh)) continue                          // batch already created — being processed
        const partials = fresh.partial_deliveries_allowed === true
        rows.push({
          ...r,
          order_status: fresh.status,
          hold_party: fresh.hold_party || null,
          hold_reason: fresh.hold_reason || null,
          partials_allowed: partials,
          bucket: deriveOrderBucket(r.lines, partials),
        })
      }

      // Orders with pending work that the snapshot has never seen
      const fresh_new = (ordersRes.data || []).filter(o =>
        !snapIds.has(o.id) && !TERMINAL_STATUSES.includes(o.status) && o.order_type !== 'SAMPLE' && hasPend(o))
      setNewSinceSync(fresh_new.length)

      setResult({ ...cache.result, orders: rows, counts: computeCounts(rows) })
      setLastSynced(new Date(cache.ts))
      setTornLocs([]); setGhostLocs([]) // probes belong to a live sheet read — recomputed on Sync
      setExpanded(new Set())
      setPage(1)
    } catch (e) {
      console.error('ATP cached load error:', e)
      // Cache path failing must not strand the user — fall back to a real sync
      await fullSync(testMode)
      return
    }
    setLoading(false)
  }

  const rows = result?.orders || []
  const tabRows = rows.filter(r => r.order_type === tab)
  const owners = [...new Set(rows.map(r => r.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const ownerRows = tabRows.filter(r => ownerFilter === 'all' || r.owner === ownerFilter)
  const chipCounts = CHIPS.reduce((acc, { key }) => { acc[key] = ownerRows.filter(r => matchChip(r, key)).length; return acc }, {})
  const q = search.trim().toLowerCase()
  const filtered = ownerRows
    .filter(r => matchChip(r, chip))
    .filter(r => !q || r.customer_name?.toLowerCase().includes(q) || codeIncludes(r.order_number, q)
      || r.owner?.toLowerCase().includes(q) || r.lines.some(l => codeIncludes(l.item_code, q)))

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const now = new Date()
  const staleHours = freshness.length
    ? Math.max(...freshness.map(f => (now - f.updatedAt) / 3600000))
    : null
  const staleState = staleHours === null ? null : staleHours > STALE_RED_H ? 'red' : staleHours > STALE_AMBER_H ? 'amber' : 'ok'

  function toggleExpand(id) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function downloadSheet() {
    // Export exactly what the screen shows: order rows (fresh) + their lines
    const exportLines = (result?.orders || []).flatMap(r =>
      r.lines.map(l => ({ ...l, order_status: r.order_status, hold_reason: r.hold_reason, partials_allowed: r.partials_allowed })))
    if (!exportLines.length) { toast('Nothing to export.', 'warning'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { toast('Failed to load Excel library: ' + e.message, 'error'); return }
    try {
      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('Available to Promise', { views: [{ state: 'frozen', ySplit: 1 }] })
      ws.columns = [
        { header: 'Order No', key: 'order_number', width: 20 },
        { header: 'Order Date', key: 'order_date', width: 12 },
        { header: 'Type', key: 'type', width: 6 },
        { header: 'Customer', key: 'customer', width: 34 },
        { header: 'Owner', key: 'owner', width: 18 },
        { header: 'Item', key: 'item', width: 34 },
        { header: 'Pending Qty', key: 'pend', width: 11 },
        { header: 'Allocated (FIFO)', key: 'alloc', width: 14 },
        { header: 'From Kaveri (AMD)', key: 'k', width: 15 },
        { header: 'From Godawari (BRD)', key: 'g', width: 17 },
        { header: 'Coverage', key: 'coverage', width: 12 },
        { header: 'Partials Allowed', key: 'partials', width: 14 },
        { header: 'Order Status', key: 'status', width: 15 },
        { header: 'Hold', key: 'hold', width: 18 },
      ]
      const covFill = { full: 'FFDCFCE7', partial: 'FFFEF3C7', no_stock: 'FFF1F5F9', not_in_sheet: 'FFE2E8F0' }
      for (const l of exportLines) {
        const row = ws.addRow({
          order_number: l.order_number, order_date: l.order_date ? fmt(l.order_date) : '',
          type: l.order_type, customer: l.customer_name, owner: l.owner,
          item: l.item_code, pend: l.pend, alloc: l.alloc, k: l.from_kaveri, g: l.from_godawari,
          coverage: LINE_COVERAGE[l.bucket]?.label || l.bucket,
          partials: l.partials_allowed ? 'Yes' : 'No',
          status: l.order_status, hold: l.hold_reason || '',
        })
        const c = row.getCell('coverage')
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: covFill[l.bucket] || 'FFF1F5F9' } }
        c.font = { bold: true, color: { argb: l.bucket === 'full' ? 'FF166534' : l.bucket === 'partial' ? 'FF92400E' : 'FF334155' } }
      }
      xlsFinish(ws, 14)
      await xlsDownload(wb, `SSC_ATP_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) { toast('Failed to generate Excel: ' + (e.message || e), 'error'); console.error(e) }
  }

  const counts = result?.counts

  return (
    <Layout pageTitle="Available to Promise" pageKey="orders">
      <div className="orders-app olist-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Available to Promise</h1>
            <div className="o-summary">
              {counts ? (
                <>
                  <span><b>{counts.so}</b> of {counts.soTotal} SOs dispatchable</span>
                  <span className="o-sep">·</span>
                  <span><b>{counts.co}</b> of {counts.coTotal} COs dispatchable</span>
                  <span className="o-sep">·</span>
                  <span style={{color:'var(--o-muted)'}}>oldest order first · stock never counted twice</span>
                </>
              ) : <span>—</span>}
            </div>
          </div>
          <div className="page-meta">
            {lastSynced && (
              <div className="meta-pill" title="When the allocation you are looking at was computed. Press Sync to recompute.">
                <span className="meta-label">Last synced</span>
                <span className="meta-val">{fmtTs(lastSynced)}</span>
              </div>
            )}
            {freshness.map(f => {
              const hrs = (now - f.updatedAt) / 3600000
              const old = hrs > STALE_AMBER_H
              return (
                <div key={f.loc} className="meta-pill" title={`${f.count} rows · uploaded ${fmtTs(f.updatedAt)}`}
                  style={old ? { background:'rgba(180,83,9,0.10)', borderColor:'rgba(180,83,9,0.35)', color:'#92400e' } : undefined}>
                  <span className="meta-label">{f.loc}</span>
                  <span className="meta-val">{fmtTs(f.updatedAt)}</span>
                </div>
              )
            })}
            {user.role === 'admin' && (
              <label className={`o-test-toggle ${showTest ? 'on' : ''}`}>
                <input type="checkbox" checked={showTest} onChange={e => { setShowTest(e.target.checked); fullSync(e.target.checked) }} style={{accentColor:'#B45309',width:13,height:13}}/>
                Test Mode
              </label>
            )}
            <button className="o-dl-btn" onClick={downloadSheet} title="Export line-level sheet (parallel-run format)">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
            <button onClick={() => fullSync(showTest)} disabled={loading}
              title="Re-read orders and the stock sheet, re-run FIFO allocation"
              style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', border:'1px solid #1a73e8', borderRadius:8, background: loading ? '#dbeafe' : '#1a73e8', color: loading ? '#1e40af' : 'white', fontSize:12, fontWeight:600, cursor: loading ? 'wait' : 'pointer', fontFamily:'var(--font)' }}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><path d="M21 12a9 9 0 11-3.5-7.1M21 4v5h-5"/></svg>
              {loading ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>

        {/* Staleness / integrity warnings — the list must never look fresher than it is */}
        {lastSynced && freshness.some(f => f.updatedAt > lastSynced) && (
          <div style={{ border:'1px solid rgba(26,115,232,0.35)', background:'rgba(26,115,232,0.06)', color:'#1a56b8', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>A newer stock sheet was uploaded after your last sync.</b> Press Sync to allocate against today's stock.
          </div>
        )}
        {newSinceSync > 0 && (
          <div style={{ border:'1px solid rgba(180,83,9,0.35)', background:'rgba(180,83,9,0.07)', color:'#92400e', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>{newSinceSync} pending order{newSinceSync > 1 ? 's are' : ' is'} not in this list</b> — created after your last sync. Press Sync to include {newSinceSync > 1 ? 'them' : 'it'}.
          </div>
        )}
        {staleState === 'red' && (
          <div style={{ border:'1px solid rgba(185,28,28,0.4)', background:'rgba(185,28,28,0.06)', color:'#B91C1C', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>Stock sheet is over {STALE_RED_H - 1}h old.</b> Do not dispatch from this list — ask accounts to upload today's AMD/BRD sheets, then press Sync.
          </div>
        )}
        {staleState === 'amber' && (
          <div style={{ border:'1px solid rgba(180,83,9,0.35)', background:'rgba(180,83,9,0.07)', color:'#92400e', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>Stock sheet has not been uploaded today.</b> Quantities below are from the last upload — treat with care.
          </div>
        )}
        {tornLocs.length > 0 && (
          <div style={{ border:'1px solid rgba(180,83,9,0.35)', background:'rgba(180,83,9,0.07)', color:'#92400e', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>Upload may be incomplete for {tornLocs.join(', ')}</b> — the sheet's rows carry mixed upload times. Re-upload that godown's file, then Sync.
          </div>
        )}
        {ghostLocs.length > 0 && (
          <div style={{ border:'1px solid rgba(180,83,9,0.35)', background:'rgba(180,83,9,0.07)', color:'#92400e', borderRadius:'var(--o-radius)', padding:'10px 14px', marginBottom:12, fontSize:13 }}>
            <b>Unknown godown in stock data: {ghostLocs.join(', ')}.</b> A stock file was probably uploaded with a misspelled name — its quantities are NOT counted here.
          </div>
        )}
        {result && result.nearMissCount > 0 && (
          <div style={{ color:'var(--o-muted)', fontSize:12, marginBottom:12 }}>
            {result.nearMissCount} pending line{result.nearMissCount > 1 ? 's' : ''} nearly match a stock code but differ in spacing/case — shown under "Not in Sheet", never assumed dispatchable. Export the sheet to see them.
          </div>
        )}

        {/* SO / CO switch */}
        <div className="o-datemode" style={{ display:'inline-flex', marginBottom:12 }}>
          <button className={tab === 'SO' ? 'on' : ''} onClick={() => { setTab('SO'); setPage(1) }}>
            Sales Orders {counts ? `(${counts.so}/${counts.soTotal})` : ''}
          </button>
          <button className={tab === 'CO' ? 'on' : ''} onClick={() => { setTab('CO'); setPage(1) }}>
            Customer Orders {counts ? `(${counts.co}/${counts.coTotal})` : ''}
          </button>
        </div>

        {/* Toolbar */}
        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search order, customer, owner, item…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          {['ops', 'admin', 'management'].includes(user.role) && (
            <select className="o-owner-select" value={ownerFilter} onChange={e => { setOwnerFilter(e.target.value); setPage(1) }}>
              <option value="all">All Owners</option>
              {owners.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>

        {/* Coverage chips */}
        <div className="o-filter-row">
          {CHIPS.map(({ key, label, tone }) => (
            <button key={key} className={`o-chip ${chip === key ? 'on' : ''} ${tone || ''}`} onClick={() => { setChip(key); setPage(1) }}>
              {label}
              {chipCounts[key] > 0 && <span className="o-chip-n">{chipCounts[key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <Loading />
        ) : loadError ? (
          <div className="ol-wrap">
            <div className="ol-empty">
              <div className="ol-empty-title" style={{ color:'#B91C1C' }}>Could not load the list</div>
              <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{loadError} — press Sync to retry. Nothing was hidden: no data is shown rather than wrong data.</div>
            </div>
          </div>
        ) : result && !result.reconciled ? (
          <div className="ol-wrap">
            <div className="ol-empty">
              <div className="ol-empty-title" style={{ color:'#B91C1C' }}>Allocation failed its self-check</div>
              <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Line buckets do not add up to the pending-line total. The list is withheld — report this to the admin.</div>
            </div>
          </div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '130px 86px minmax(0,1.3fr) minmax(0,1fr) 60px 110px 100px 120px' }}>
              <div>Order #</div>
              <div>Order Date</div>
              <div>Customer</div>
              <div>Owner</div>
              <div className="num">Lines</div>
              <div className="num">Qty (alloc/pend)</div>
              <div>Stock In</div>
              <div className="num">Coverage</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">Nothing here</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>
                  {chip === 'dispatchable' ? 'No orders can be dispatched from the current stock sheet.' : 'Nothing matches the selected filters.'}
                </div>
              </div>
            ) : (
              <div className="ol-table">
                {paginated.map(r => {
                  const cov = COVERAGE[r.bucket]
                  const open = expanded.has(r.order_id)
                  return (
                    <div key={r.order_id}>
                      <div className="ol-row ol-data" style={{ gridTemplateColumns: '130px 86px minmax(0,1.3fr) minmax(0,1fr) 60px 110px 100px 120px' }} onClick={() => toggleExpand(r.order_id)}>
                        <div className="ol-cell">
                          <div className="ol-num" style={{ color:'var(--ssc-blue)', cursor:'pointer' }} title="Open order"
                            onClick={e => { e.stopPropagation(); navigate('/orders/' + r.order_id) }}>{r.order_number}</div>
                          {r.order_status === 'pending' && <span className="ol-sample-tag" style={{ background:'rgba(180,83,9,0.12)', color:'#92400e' }}>Awaiting Approval</span>}
                          {r.hold_party && <span className="ol-sample-tag" style={{ background:'rgba(185,28,28,0.10)', color:'#B91C1C' }} title={r.hold_reason || ''}>On Hold</span>}
                        </div>
                        <div className="ol-cell ol-date">{r.order_date ? fmt(r.order_date) : <span style={{color:'#B45309'}}>no date</span>}</div>
                        <div className="ol-cell ol-cust" title={r.customer_name}>{r.customer_name}</div>
                        <div className="ol-cell"><OwnerChip name={r.owner}/></div>
                        <div className="ol-cell num">{r.covered_lines}/{r.line_count}</div>
                        <div className="ol-cell num">{r.alloc_qty.toLocaleString('en-IN')} / {r.pend_qty.toLocaleString('en-IN')}</div>
                        <div className="ol-cell">{r.stock_loc}</div>
                        <div className="ol-cell ol-status-cell">
                          <span className="ol-status-pill" style={{ '--stage-color': cov.color }}>
                            <span className="ol-status-dot"/>{cov.label}
                          </span>
                        </div>
                      </div>
                      {open && r.lines.map(l => {
                        const lc = LINE_COVERAGE[l.bucket]
                        return (
                          <div key={l.order_id + l.item_code + l.sr_no} className="ol-row ol-data" style={{ gridTemplateColumns: '130px 86px minmax(0,2.3fr) 60px 110px 100px 120px', background:'var(--o-row-alt, rgba(26,115,232,0.03))', cursor:'default' }}>
                            <div className="ol-cell" style={{ color:'var(--o-muted-2)', fontSize:11 }}>line {l.sr_no || '—'}</div>
                            <div className="ol-cell"/>
                            <div className="ol-cell" style={{ fontFamily:'var(--mono)', fontSize:12 }} title={l.item_code}>
                              {l.item_code}
                              {l.near_miss && <span style={{ color:'#B45309', marginLeft:6, fontSize:11 }}>≈ near-miss code</span>}
                            </div>
                            <div className="ol-cell"/>
                            <div className="ol-cell num">{l.alloc.toLocaleString('en-IN')} / {l.pend.toLocaleString('en-IN')}</div>
                            <div className="ol-cell" style={{ fontSize:12 }}>
                              {l.from_kaveri > 0 && `K ${l.from_kaveri.toLocaleString('en-IN')}`}
                              {l.from_kaveri > 0 && l.from_godawari > 0 && ' · '}
                              {l.from_godawari > 0 && `G ${l.from_godawari.toLocaleString('en-IN')}`}
                              {l.alloc === 0 && '—'}
                            </div>
                            <div className="ol-cell ol-status-cell">
                              <span className="ol-status-pill" style={{ '--stage-color': lc.color }}>
                                <span className="ol-status-dot"/>{lc.label}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
            {filtered.length > 0 && (
              <div className="ol-foot">
                <span>Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - safePage) <= 1
                    const ellipsis = !show && Math.abs(p - safePage) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === safePage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
                    if (ellipsis) return <span key={'e'+p} style={{ padding:'5px 4px', color:'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
