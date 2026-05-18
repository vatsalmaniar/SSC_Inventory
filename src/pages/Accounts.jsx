import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { sb } from '../lib/supabase'
import { fmtDateTime } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/accounts.css'

const LOCATION_MAP = { AMD: 'Kaveri', BRD: 'Godawari' }

function extractLocation(filename) {
  const name = filename.replace(/\.[^.]+$/, '')
  const part = name.split(/[_\-\d]/)[0].toUpperCase().trim()
  return LOCATION_MAP[part] || part
}


export default function Accounts() {
  const navigate = useNavigate()
  const [parsedRows, setParsedRows]     = useState([])
  const [location, setLocation]         = useState('')
  const [detectInfo, setDetectInfo]     = useState(null)
  const [showDetect, setShowDetect]     = useState(false)
  const [showPreview, setShowPreview]   = useState(false)
  const [showPush, setShowPush]         = useState(false)
  const [pushing, setPushing]           = useState(false)
  const [progress, setProgress]         = useState({ pct: 0, label: '' })
  const [showProgress, setShowProgress] = useState(false)
  const [success, setSuccess]           = useState(null)
  const [errorMsg, setErrorMsg]         = useState('')
  const [showReset, setShowReset]       = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const [locRows, setLocRows]           = useState([])
  const fileInputRef = useRef(null)
  const [showConfirm, setShowConfirm]   = useState(false)
  const [diffSummary, setDiffSummary]   = useState(null)   // { newCount, updateCount, zeroOutCodes }
  const [computingDiff, setComputingDiff] = useState(false)

  // Tab + Pending Payments state
  const [tab, setTab]                       = useState('inventory')   // 'inventory' | 'payments'
  const payFileInputRef                     = useRef(null)
  const [payDragOver, setPayDragOver]       = useState(false)
  const [payRows, setPayRows]               = useState([])              // [{party_name_raw, outstanding_inr, overdue_inr, bill_count}]
  const [payFileName, setPayFileName]       = useState('')
  const [payErrorMsg, setPayErrorMsg]       = useState('')
  const [paySuccess, setPaySuccess]         = useState(null)
  const [payShowConfirm, setPayShowConfirm] = useState(false)
  const [payPushing, setPayPushing]         = useState(false)
  const [payProgress, setPayProgress]       = useState({ pct: 0, label: '' })
  const [payShowProgress, setPayShowProgress] = useState(false)
  const [payShowReset, setPayShowReset]     = useState(false)
  const [payLastImport, setPayLastImport]   = useState(null)   // { imported_at, party_count }
  const [payMatchCount, setPayMatchCount]   = useState(0)

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) { navigate('/login'); return }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!profile || (!['accounts','admin','management'].includes(profile.role))) {
      navigate('/login'); return
    }
    loadStatus()
    loadPayStatus()
  }

  async function loadPayStatus() {
    const { data, count } = await sb
      .from('customer_payments_snapshot')
      .select('imported_at', { count: 'exact' })
      .order('imported_at', { ascending: false })
      .limit(1)
    if (data && data.length) {
      const matched = await sb.from('customer_payments_snapshot').select('id', { count: 'exact', head: true }).not('customer_id', 'is', null)
      setPayLastImport({ imported_at: data[0].imported_at, party_count: count || 0 })
      setPayMatchCount(matched.count || 0)
    } else {
      setPayLastImport(null)
      setPayMatchCount(0)
    }
  }

  async function loadStatus() {
    const { data: rpcData, error: rpcErr } = await sb.rpc('get_inventory_status')
    if (!rpcErr && rpcData && rpcData.length) {
      setLocRows(rpcData.map(r => ({ loc: r.location, updatedAt: new Date(r.max_updated_at), count: r.count })))
      return
    }
    const { data: allData } = await sb.from('inventory').select('location, updated_at').order('updated_at', { ascending: false }).limit(10000)
    if (!allData || !allData.length) { setLocRows([]); return }
    const map = {}
    allData.forEach(row => {
      const loc = (row.location || 'Unknown').trim()
      if (!map[loc]) map[loc] = { updatedAt: new Date(row.updated_at), count: 0 }
      const d = new Date(row.updated_at)
      if (d > map[loc].updatedAt) map[loc].updatedAt = d
      map[loc].count++
    })
    setLocRows(Object.entries(map).map(([loc, v]) => ({ loc, ...v })).sort((a, b) => a.loc.localeCompare(b.loc)))
  }

  function handleDragOver(e) { e.preventDefault(); setDragOver(true) }
  function handleDragLeave()  { setDragOver(false) }
  function handleDrop(e)  { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) processFile(f) }
  function handleFile(e)  { const f = e.target.files[0]; if (f) processFile(f) }

  function processFile(file) {
    setSuccess(null); setErrorMsg(''); setShowReset(false)
    const loc = extractLocation(file.name)
    setLocation(loc)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'binary' })
        const ws  = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const rows = []
        raw.forEach(row => {
          const colA = String(row[0] || '').trim()
          const qty  = parseFloat(row[1])
          if (colA && !isNaN(qty) && qty >= 0) rows.push({ product_code: colA, quantity: Math.round(qty) })
        })
        if (!rows.length) { setErrorMsg('Could not find valid data. Make sure Column A has product codes and Column B has quantities.'); return }
        setParsedRows(rows)
        setDetectInfo({ codeSample: rows.slice(0,3).map(r=>r.product_code).join(', '), qtySample: rows.slice(0,3).map(r=>r.quantity).join(', '), location: loc, fileName: file.name })
        setShowDetect(true); setShowPreview(true); setShowPush(true)
      } catch { setErrorMsg('Could not read file. Make sure it is a valid XLS or XLSX file.') }
    }
    reader.readAsBinaryString(file)
  }

  // Step 1: compute summary stats and show confirmation modal.
  // Uses count-only queries — no pagination, no row caps to worry about.
  async function startPush() {
    setSuccess(null); setErrorMsg(''); setComputingDiff(true)
    let totalAtLocation = 0, totalWithStock = 0
    try {
      const r1 = await sb.from('inventory').select('id', { count: 'exact', head: true }).eq('location', location)
      totalAtLocation = r1.count || 0
      const r2 = await sb.from('inventory').select('id', { count: 'exact', head: true }).eq('location', location).gt('quantity', 0)
      totalWithStock = r2.count || 0
    } catch (_) { /* fall back to safe defaults — upload still works */ }
    // Best-effort estimate: items in this XLS with qty > 0 won't be zeroed; remaining stocked items will.
    const newRowsWithStock = parsedRows.filter(r => r.quantity > 0).length
    const oosEstimate = Math.max(0, totalWithStock - newRowsWithStock)
    setDiffSummary({
      totalAtLocation,
      totalWithStock,
      uploadCount: parsedRows.length,
      oosEstimate,
    })
    setComputingDiff(false)
    setShowConfirm(true)
  }

  // Step 2: actually push (after user confirms)
  async function confirmAndPush() {
    setShowConfirm(false)
    setSuccess(null); setErrorMsg(''); setPushing(true); setShowProgress(true)
    setProgress({ pct: 0, label: 'Uploading...' })
    const now   = new Date().toISOString()
    const rows  = parsedRows.map(r => ({ product_code: r.product_code, quantity: r.quantity, location, updated_at: now }))
    const total = rows.length
    const BATCH = 100
    let done = 0
    // (a) Upsert items from XLS
    for (let i = 0; i < total; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await sb.from('inventory').upsert(batch, { onConflict: 'product_code,location' })
      if (error) { setErrorMsg('Upload failed at row ' + (i+1) + ': ' + error.message); setPushing(false); return }
      done += batch.length
      setProgress({ pct: Math.round((done/total)*100), label: done+' of '+total+' products uploaded...' })
    }
    // (b) Zero out items at this location that weren't touched by this upload (their updated_at < now)
    // Single server-side UPDATE — no pagination, no URL length issues, no client-side row caps.
    setProgress(p => ({ ...p, label: 'Marking missing items as Out of Stock...' }))
    let oosCount = 0
    const { count: zeroedCount, error: zErr } = await sb.from('inventory')
      .update({ quantity: 0, updated_at: now }, { count: 'exact' })
      .eq('location', location)
      .lt('updated_at', now)
      .gt('quantity', 0)
    if (zErr) { setErrorMsg('Out-of-stock update failed: ' + zErr.message); setPushing(false); return }
    oosCount = zeroedCount || 0

    setPushing(false)
    const oosTxt = oosCount ? ` · ${oosCount} marked Out of Stock` : ''
    setSuccess({ text: total + ' products updated in live inventory', sub: 'Location: ' + location + oosTxt + ' · Sales team can search stock now' })
    setProgress(p => ({ ...p, label: 'Done — ' + total + ' products uploaded successfully.' }))
    setShowReset(true)
    loadStatus()
  }

  // ── Pending Payments upload ──
  function parsePaymentsRows(raw) {
    if (!raw || raw.length < 3) return []
    const parties = []
    let curParty = null
    let curBills = 0
    let curOverdue = 0
    // raw[0] = column headers ("Date","Ref. No.","Party's Name","Pending",…,"Due on")
    // raw[1] = sub-header row ("Amount", …)
    // Detail rows have a numeric Excel-serial date in col A.
    // Party-header rows: only col C has the party name.
    // Subtotal rows: cols A/B/C empty, col D (Pending) > 0.

    // Find the "Due on" column dynamically — Tally versions shift it
    // (seen at col K and col M across exports). Auto-detect by header text.
    const header = raw[0] || []
    let dueOnIdx = -1
    for (let i = 0; i < header.length; i++) {
      const h = String(header[i] || '').toLowerCase().replace(/[\s.]/g, '')
      if (h === 'dueon' || h === 'duedate' || h === 'due') { dueOnIdx = i; break }
    }

    // Excel serial → JS Date. 25569 = days between 1900-01-01 and 1970-01-01.
    function serialToDate(s) {
      if (typeof s !== 'number' || s < 30000) return null
      return new Date(Math.round((s - 25569) * 86400 * 1000))
    }
    const today = new Date(); today.setHours(0,0,0,0)

    for (let i = 2; i < raw.length; i++) {
      const r = raw[i] || []
      const a = r[0]
      const b = String(r[1] || '').trim()
      const c = String(r[2] || '').trim().replace(/\s+/g, ' ')
      const pending = parseFloat(r[3]) || 0
      const hasDate = typeof a === 'number' && a > 30000
      // Party header: name present, no date/ref/amount
      if (c && !hasDate && !b && pending === 0) {
        curParty = c
        curBills = 0
        curOverdue = 0
        continue
      }
      // Detail bill row — per-bill overdue check:
      // if Due-on is in the past (< today), this bill's Pending amount is overdue.
      // Falls back to aging buckets (90+ days) if Due-on column is missing.
      if (hasDate && curParty) {
        curBills++
        let billOverdue = 0
        if (dueOnIdx >= 0) {
          const due = serialToDate(r[dueOnIdx])
          if (due && due < today) billOverdue = pending
        } else {
          // Legacy fallback: 90+ aging buckets
          billOverdue =
            (parseFloat(r[7]) || 0) +
            (parseFloat(r[8]) || 0) +
            (parseFloat(r[9]) || 0)
        }
        curOverdue += billOverdue
        continue
      }
      // Per-party subtotal — finalize the current party. (Grand total row at end has curParty=null → skipped.)
      if (!c && !hasDate && !b && pending > 0 && curParty) {
        parties.push({
          party_name_raw: curParty,
          outstanding_inr: pending,
          overdue_inr: curOverdue,
          bill_count: curBills,
        })
        curParty = null
        curBills = 0
        curOverdue = 0
      }
    }
    return parties
  }

  function handlePayDragOver(e) { e.preventDefault(); setPayDragOver(true) }
  function handlePayDragLeave() { setPayDragOver(false) }
  function handlePayDrop(e) { e.preventDefault(); setPayDragOver(false); const f = e.dataTransfer.files[0]; if (f) processPayFile(f) }
  function handlePayFile(e) { const f = e.target.files[0]; if (f) processPayFile(f) }

  function processPayFile(file) {
    setPaySuccess(null); setPayErrorMsg(''); setPayShowReset(false); setPayShowProgress(false)
    setPayFileName(file.name)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const parsed = parsePaymentsRows(raw)
        if (!parsed.length) {
          setPayErrorMsg('Could not find any parties. Expected a Tally-style Bills Receivable export with columns: Date, Ref. No., Party\'s Name, Pending, <30, 30–60, 60–90, 90–120, 120–240, >240.')
          return
        }
        setPayRows(parsed)
      } catch (err) {
        setPayErrorMsg('Could not read file: ' + (err.message || 'invalid XLS/XLSX'))
      }
    }
    reader.readAsBinaryString(file)
  }

  async function confirmPayPush() {
    setPayShowConfirm(false)
    setPaySuccess(null); setPayErrorMsg(''); setPayPushing(true); setPayShowProgress(true)
    setPayProgress({ pct: 0, label: 'Matching parties to Customer 360…' })

    // Build customer name → id map (client-side matching, case-insensitive)
    let custMap = new Map()
    try {
      let from = 0; const PAGE = 1000
      while (true) {
        const { data, error } = await sb.from('customers').select('id,customer_name').range(from, from + PAGE - 1)
        if (error) throw error
        if (!data?.length) break
        data.forEach(c => { if (c.customer_name) custMap.set(c.customer_name.trim().toLowerCase(), c.id) })
        if (data.length < PAGE) break
        from += PAGE
      }
    } catch (e) {
      setPayErrorMsg('Failed to load customer list for matching: ' + e.message)
      setPayPushing(false); return
    }

    const now = new Date().toISOString()
    const rows = payRows.map(p => ({
      party_name_raw: p.party_name_raw,
      customer_id: custMap.get(p.party_name_raw.trim().toLowerCase()) || null,
      outstanding_inr: p.outstanding_inr,
      overdue_inr: p.overdue_inr,
      bill_count: p.bill_count,
      imported_at: now,
    }))
    const matched = rows.filter(r => r.customer_id).length

    // Clear existing snapshot
    setPayProgress({ pct: 8, label: 'Clearing previous snapshot…' })
    const { error: delErr } = await sb.from('customer_payments_snapshot').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (delErr) { setPayErrorMsg('Could not clear previous snapshot: ' + delErr.message); setPayPushing(false); return }

    // Batch insert
    const BATCH = 100
    let done = 0
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await sb.from('customer_payments_snapshot').insert(batch)
      if (error) { setPayErrorMsg('Upload failed at row ' + (i+1) + ': ' + error.message); setPayPushing(false); return }
      done += batch.length
      setPayProgress({ pct: 10 + Math.round((done / rows.length) * 88), label: done + ' of ' + rows.length + ' parties uploaded…' })
    }

    setPayPushing(false)
    setPayProgress({ pct: 100, label: 'Done — ' + rows.length + ' parties imported.' })
    setPaySuccess({ text: rows.length + ' parties imported into Receivables snapshot', sub: matched + ' matched to Customer 360 · ' + (rows.length - matched) + ' unmatched (will not show on customer pages)' })
    setPayShowReset(true)
    loadPayStatus()
  }

  function resetPayUpload() {
    setPayRows([]); setPayFileName(''); setPayErrorMsg(''); setPaySuccess(null)
    setPayShowProgress(false); setPayProgress({ pct: 0, label: '' }); setPayShowReset(false)
    if (payFileInputRef.current) payFileInputRef.current.value = ''
  }

  function resetUpload() {
    setParsedRows([]); setLocation(''); setDetectInfo(null)
    setShowDetect(false); setShowPreview(false); setShowPush(false)
    setShowProgress(false); setProgress({ pct: 0, label: '' })
    setSuccess(null); setErrorMsg(''); setShowReset(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const now = new Date()

  return (
    <Layout pageTitle="Uploads" pageKey="upload">
      <div className="acc-page">
      <div className="acc-body">
        <div className="acc-page-title">Uploads</div>
        <div className="acc-page-sub">{tab === 'inventory' ? 'Drop the daily warehouse XLS — columns are detected automatically.' : 'Drop the Tally "Bills Receivable" export — party-wise outstanding + overdue are updated.'}</div>

        {/* Tab toggle */}
        <div className="acc-tabs" style={{ display:'inline-flex', gap:4, borderRadius:10, padding:4, marginBottom:18 }}>
          <button onClick={() => setTab('inventory')} className={'acc-tab ' + (tab === 'inventory' ? 'on' : '')}>
            Inventory
          </button>
          <button onClick={() => setTab('payments')} className={'acc-tab ' + (tab === 'payments' ? 'on' : '')}>
            Pending Payments
          </button>
        </div>

        {tab === 'inventory' && (<>
        {/* Warehouse status */}
        {locRows.length === 0 ? (
          <div style={{ background:'white', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:'12px 16px', fontSize:13, color:'var(--gray-500)', marginBottom:20 }}>
            No inventory yet — upload your first XLS file.
          </div>
        ) : (
          <div className="acc-status-row">
            {locRows.map(({ loc, updatedAt, count }) => {
              const diffHrs  = (now - updatedAt) / 3600000
              const diffDays = Math.floor(diffHrs / 24)
              const timeStr  = diffHrs < 1 ? 'Just now' : diffHrs < 24 ? Math.floor(diffHrs)+'h ago' : diffDays+' day'+(diffDays>1?'s':'')+' ago'
              const isOld    = diffHrs > 25
              return (
                <div key={loc} className="acc-status-card" style={{ border: '1px solid '+(isOld?'#fca5a5':'#86efac') }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div className="acc-status-dot" style={{ background: isOld?'#ef4444':'#22c55e' }} />
                    <div>
                      <div className="acc-status-name">{loc} Warehouse</div>
                      <div className="acc-status-meta">Last upload: {fmtDateTime(updatedAt)} · {count} products</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                    <span className="acc-status-badge" style={{ background: isOld?'#fee2e2':'#d4f5e2', color: isOld?'#9b1c1c':'#14653a' }}>
                      {isOld ? 'NEEDS UPDATE' : 'UP TO DATE'}
                    </span>
                    <span style={{ fontSize:12, color:'var(--gray-400)' }}>{timeStr}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* How-it-works strip */}
        <div className="acc-how-strip">
          <div className="acc-how-item">
            <div className="acc-how-num">A</div>
            <div className="acc-how-label"><strong>Column A</strong>Product item code</div>
          </div>
          <div className="acc-how-item">
            <div className="acc-how-num">B</div>
            <div className="acc-how-label"><strong>Column B</strong>Quantity / stock</div>
          </div>
          <div className="acc-how-item">
            <div className="acc-how-num">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            </div>
            <div className="acc-how-label"><strong>File name</strong>Warehouse / location</div>
          </div>
        </div>

        {/* Drop Zone */}
        <div
          className={'acc-upload-zone' + (dragOver ? ' drag-over' : '')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="acc-upload-icon">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
              <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
            </svg>
          </div>
          <h3>Drop your XLS / XLSX file here</h3>
          <p>Columns A &amp; B are auto-detected</p>
          <div className="acc-hint">e.g. Amd_28032026.xls → Kaveri &nbsp;|&nbsp; BRD_28032026.xls → Godawari</div>
          <button className="acc-browse-btn" onClick={e => { e.stopPropagation(); fileInputRef.current?.click() }}>
            Browse file
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept=".xls,.xlsx,.csv" style={{ display:'none' }} onChange={handleFile} />

        {/* Auto-detect Card */}
        {showDetect && detectInfo && (
          <div className="acc-detect-card">
            <div className="acc-detect-header">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
              </svg>
              <div className="acc-detect-header-text">
                <h3>Auto-detected — ready to upload</h3>
                <p>No manual mapping needed</p>
              </div>
            </div>
            <div className="acc-detect-grid">
              <div className="acc-detect-field">
                <label>Product Code</label>
                <div className="acc-detect-value">
                  <div className="acc-detect-check"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
                  Column A
                </div>
                <div className="acc-detect-sub">e.g. {detectInfo.codeSample}</div>
              </div>
              <div className="acc-detect-field">
                <label>Quantity</label>
                <div className="acc-detect-value">
                  <div className="acc-detect-check"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
                  Column B
                </div>
                <div className="acc-detect-sub">e.g. {detectInfo.qtySample}</div>
              </div>
              <div className="acc-detect-field">
                <label>Location / Warehouse</label>
                <div className="acc-detect-value">
                  <div className="acc-detect-check"><svg fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div>
                  {detectInfo.location}
                </div>
                <div className="acc-detect-sub">from: {detectInfo.fileName}</div>
              </div>
            </div>
          </div>
        )}

        {/* Preview Table */}
        {showPreview && parsedRows.length > 0 && (
          <div className="acc-preview-card">
            <div className="acc-preview-header">
              <h3>Preview</h3>
              <span>Showing {Math.min(30, parsedRows.length)} of {parsedRows.length} rows</span>
            </div>
            <div className="acc-preview-scroll">
              <table className="acc-preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Product Code</th>
                    <th>Quantity</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 30).map((row, i) => {
                    const cls = row.quantity === 0 ? 'acc-qty-zero' : row.quantity <= 5 ? 'acc-qty-low' : 'acc-qty-ok'
                    return (
                      <tr key={i}>
                        <td style={{ color:'var(--gray-400)', fontSize:12 }}>{i+1}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:500 }}>{row.product_code}</td>
                        <td><span className={'acc-qty-pill '+cls}>{row.quantity}</span></td>
                        <td style={{ fontSize:12, color:'var(--gray-500)' }}>{location}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Push Section */}
        {showPush && (
          <div>
            <button className="acc-push-btn" onClick={startPush} disabled={pushing || computingDiff}>
              {pushing || computingDiff ? <div className="acc-push-spinner" /> : (
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              )}
              <span>{pushing ? 'Pushing to database...' : 'Push to live inventory'}</span>
            </button>

            {showProgress && (
              <div className="acc-progress-wrap">
                <div className="acc-progress-bg">
                  <div className="acc-progress-fill" style={{ width: progress.pct+'%' }} />
                </div>
                <div className="acc-progress-label">{progress.label}</div>
              </div>
            )}

            {success && (
              <div className="acc-success-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                <div><span>{success.text}</span><small>{success.sub}</small></div>
              </div>
            )}

            {errorMsg && (
              <div className="acc-error-banner">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
                </svg>
                <span>{errorMsg}</span>
              </div>
            )}

            {showReset && (
              <div className="acc-reset-link">
                <button onClick={resetUpload}>Upload another file</button>
              </div>
            )}
          </div>
        )}
        </>)}

        {tab === 'payments' && (<>
          {/* Last import status */}
          {payLastImport ? (
            <div className="acc-status-row">
              <div className="acc-status-card" style={{ border:'1px solid #86efac' }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div className="acc-status-dot" style={{ background:'#22c55e' }} />
                  <div>
                    <div className="acc-status-name">Receivables Snapshot</div>
                    <div className="acc-status-meta">Last import: {fmtDateTime(new Date(payLastImport.imported_at))} · {payLastImport.party_count} parties · {payMatchCount} matched to Customer 360</div>
                  </div>
                </div>
                <span className="acc-status-badge" style={{ background:'#d4f5e2', color:'#14653a' }}>UP TO DATE</span>
              </div>
            </div>
          ) : (
            <div style={{ background:'white', border:'1px solid var(--gray-200)', borderRadius:'var(--radius-sm)', padding:'12px 16px', fontSize:13, color:'var(--gray-500)', marginBottom:20 }}>
              No receivables snapshot yet — upload your first Pending Payment XLS.
            </div>
          )}

          {/* How-it-works strip */}
          <div className="acc-how-strip">
            <div className="acc-how-item">
              <div className="acc-how-num">1</div>
              <div className="acc-how-label"><strong>Tally export</strong>Bills Receivable XLS</div>
            </div>
            <div className="acc-how-item">
              <div className="acc-how-num">2</div>
              <div className="acc-how-label"><strong>Per party</strong>Outstanding + Overdue computed</div>
            </div>
            <div className="acc-how-item">
              <div className="acc-how-num">3</div>
              <div className="acc-how-label"><strong>Auto-match</strong>Linked to Customer 360 by name</div>
            </div>
          </div>

          {/* Drop zone */}
          <div className={'acc-upload-zone' + (payDragOver ? ' drag-over' : '')}
            onDragOver={handlePayDragOver} onDragLeave={handlePayDragLeave} onDrop={handlePayDrop}
            onClick={() => payFileInputRef.current?.click()}>
            <div className="acc-upload-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
              </svg>
            </div>
            <h3>Drop your Bills Receivable XLS / XLSX file here</h3>
            <p>Party-wise subtotals are detected automatically</p>
            <div className="acc-hint">Tally export with columns: Date · Ref. No. · Party's Name · Pending · age buckets (&lt;30, 30–60, 60–90, 90–120, 120–240, &gt;240)</div>
            <button className="acc-browse-btn" onClick={e => { e.stopPropagation(); payFileInputRef.current?.click() }}>Browse file</button>
          </div>
          <input ref={payFileInputRef} type="file" accept=".xls,.xlsx" style={{ display:'none' }} onChange={handlePayFile} />

          {/* Parsed summary card */}
          {payRows.length > 0 && (
            <div className="acc-detect-card">
              <div className="acc-detect-header">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                </svg>
                <div className="acc-detect-header-text">
                  <h3>Parsed — ready to upload</h3>
                  <p>{payRows.length} parties detected from {payFileName}</p>
                </div>
              </div>
              <div className="acc-detect-grid">
                <div className="acc-detect-field">
                  <label>Total Outstanding</label>
                  <div className="acc-detect-value" style={{ fontSize:18, fontWeight:700 }}>
                    ₹{Math.round(payRows.reduce((s, p) => s + p.outstanding_inr, 0)).toLocaleString('en-IN')}
                  </div>
                  <div className="acc-detect-sub">across {payRows.length} parties</div>
                </div>
                <div className="acc-detect-field">
                  <label>Total Overdue</label>
                  <div className="acc-detect-value" style={{ fontSize:18, fontWeight:700, color:'#b91c1c' }}>
                    ₹{Math.round(payRows.reduce((s, p) => s + p.overdue_inr, 0)).toLocaleString('en-IN')}
                  </div>
                  <div className="acc-detect-sub">over 30 days</div>
                </div>
                <div className="acc-detect-field">
                  <label>Total Bills</label>
                  <div className="acc-detect-value" style={{ fontSize:18, fontWeight:700 }}>
                    {payRows.reduce((s, p) => s + p.bill_count, 0)}
                  </div>
                  <div className="acc-detect-sub">bill line items</div>
                </div>
              </div>
            </div>
          )}

          {/* Preview table */}
          {payRows.length > 0 && (
            <div className="acc-preview-card">
              <div className="acc-preview-header">
                <h3>Preview</h3>
                <span>Top {Math.min(30, payRows.length)} of {payRows.length} parties (by outstanding)</span>
              </div>
              <div className="acc-preview-scroll">
                <table className="acc-preview-table">
                  <thead>
                    <tr><th>#</th><th>Party Name</th><th>Bills</th><th>Outstanding (₹)</th><th>Overdue (₹)</th></tr>
                  </thead>
                  <tbody>
                    {[...payRows].sort((a,b) => b.outstanding_inr - a.outstanding_inr).slice(0, 30).map((p, i) => (
                      <tr key={i}>
                        <td style={{ color:'var(--gray-400)', fontSize:12 }}>{i+1}</td>
                        <td style={{ fontSize:12, fontWeight:500 }}>{p.party_name_raw}</td>
                        <td>{p.bill_count}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:12 }}>₹{Math.round(p.outstanding_inr).toLocaleString('en-IN')}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:12, color: p.overdue_inr > 0 ? '#b91c1c' : 'var(--gray-400)', fontWeight: p.overdue_inr > 0 ? 600 : 400 }}>
                          {p.overdue_inr > 0 ? '₹' + Math.round(p.overdue_inr).toLocaleString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Push */}
          {payRows.length > 0 && (
            <div>
              <button className="acc-push-btn" onClick={() => setPayShowConfirm(true)} disabled={payPushing}>
                {payPushing ? <div className="acc-push-spinner" /> : (
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                )}
                <span>{payPushing ? 'Importing…' : 'Replace snapshot with this file'}</span>
              </button>

              {payShowProgress && (
                <div className="acc-progress-wrap">
                  <div className="acc-progress-bg"><div className="acc-progress-fill" style={{ width: payProgress.pct + '%' }} /></div>
                  <div className="acc-progress-label">{payProgress.label}</div>
                </div>
              )}

              {paySuccess && (
                <div className="acc-success-banner">
                  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <div><span>{paySuccess.text}</span><small>{paySuccess.sub}</small></div>
                </div>
              )}

              {payShowReset && (
                <div className="acc-reset-link"><button onClick={resetPayUpload}>Upload another file</button></div>
              )}
            </div>
          )}

          {payErrorMsg && (
            <div className="acc-error-banner">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <span>{payErrorMsg}</span>
            </div>
          )}
        </>)}
      </div>
      </div>

      {/* Confirm Upload Modal */}
      {showConfirm && diffSummary && (() => {
        const dangerThreshold = diffSummary.totalWithStock > 0 && diffSummary.oosEstimate > diffSummary.totalWithStock * 0.5
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
            onClick={() => setShowConfirm(false)}>
            <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 20px 60px rgba(0,0,0,0.25)', overflow:'hidden' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #f1f5f9' }}>
                <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Confirm Upload — {location}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>Review before pushing to live inventory.</div>
              </div>
              <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:10 }}>
                <SummaryRow icon="📤" label="Items in this file"           count={diffSummary.uploadCount} color="#1d4ed8" />
                <SummaryRow icon="📊" label="Items currently with stock"   count={diffSummary.totalWithStock} color="#0d9488"
                  sub={`of ${diffSummary.totalAtLocation} total at this location`} />
                <SummaryRow icon="📦" label="Approx. items to mark Out of Stock" count={diffSummary.oosEstimate} color="#b45309"
                  sub="anything in DB with stock but missing from this file" />
              </div>
              {dangerThreshold && (
                <div style={{ margin:'0 24px 16px', padding:'10px 14px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#b91c1c', lineHeight:1.5 }}>
                  ⚠ This will mark <strong>more than half</strong> of the existing stock at this location as Out of Stock. Make sure the file is correct before continuing.
                </div>
              )}
              <div style={{ padding:'0 24px 20px', display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => setShowConfirm(false)}
                  style={{ padding:'10px 20px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
                <button onClick={confirmAndPush}
                  style={{ padding:'10px 22px', border:'none', borderRadius:8, background: dangerThreshold ? '#dc2626' : '#1a4dab', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>
                  Confirm Upload
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Pending Payments — Confirm Modal */}
      {payShowConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
          onClick={() => setPayShowConfirm(false)}>
          <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:460, boxShadow:'0 20px 60px rgba(0,0,0,0.25)', overflow:'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #f1f5f9' }}>
              <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Replace Receivables Snapshot</div>
              <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>The previous snapshot will be deleted and replaced with this file.</div>
            </div>
            <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:10 }}>
              <SummaryRow icon="🏢" label="Parties in this file" count={payRows.length} color="#1d4ed8" />
              <SummaryRow icon="💰" label="Total Outstanding" count={'₹' + Math.round(payRows.reduce((s, p) => s + p.outstanding_inr, 0)).toLocaleString('en-IN')} color="#0d9488" />
              <SummaryRow icon="⏰" label="Total Overdue (>30d)" count={'₹' + Math.round(payRows.reduce((s, p) => s + p.overdue_inr, 0)).toLocaleString('en-IN')} color="#b45309" />
              {payLastImport && (
                <div style={{ padding:'10px 14px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e', lineHeight:1.5 }}>
                  Replacing previous snapshot from <strong>{fmtDateTime(new Date(payLastImport.imported_at))}</strong> ({payLastImport.party_count} parties).
                </div>
              )}
            </div>
            <div style={{ padding:'0 24px 20px', display:'flex', gap:10, justifyContent:'flex-end' }}>
              <button onClick={() => setPayShowConfirm(false)} style={{ padding:'10px 20px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
              <button onClick={confirmPayPush} style={{ padding:'10px 22px', border:'none', borderRadius:8, background:'#1a4dab', color:'white', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'var(--font)' }}>Replace Snapshot</button>
            </div>
          </div>
        </div>
      )}

    </Layout>
  )
}

function SummaryRow({ icon, label, count, color, sub }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8 }}>
      <div style={{ fontSize:18 }}>{icon}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#0f172a' }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:'#64748b', marginTop:1 }}>{sub}</div>}
      </div>
      <div style={{ fontSize:18, fontWeight:700, color }}>{count}</div>
    </div>
  )
}
