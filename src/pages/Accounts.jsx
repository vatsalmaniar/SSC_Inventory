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

  useEffect(() => { init() }, [])

  async function init() {
    const { data: { session } } = await sb.auth.getSession()
    if (!session) { navigate('/login'); return }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!profile || (profile.role !== 'accounts' && profile.role !== 'admin')) {
      navigate('/login'); return
    }
    loadStatus()
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

  // Step 1: compute diff against existing inventory and show confirmation modal.
  // If the diff query fails for any reason, fall back to old behavior (no auto-zero) so upload is never blocked.
  async function startPush() {
    setSuccess(null); setErrorMsg(''); setComputingDiff(true)
    const newCodes = new Set(parsedRows.map(r => r.product_code))
    // Supabase defaults to 1000 rows/request — paginate (with stable ORDER BY) to read entire location inventory (~5K rows)
    let existing = []
    try {
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('inventory')
          .select('product_code,quantity').eq('location', location)
          .order('product_code', { ascending: true })
          .range(from, from + PAGE - 1)
        if (error) { existing = []; break }
        if (!Array.isArray(data) || data.length === 0) break
        existing.push(...data)
        if (data.length < PAGE) break
      }
    } catch (_) { /* fall back: no auto-zero */ existing = [] }
    const existingCodes = new Set(existing.map(e => e.product_code))
    const zeroOutCodes  = existing
      .filter(e => !newCodes.has(e.product_code) && e.quantity > 0)
      .map(e => e.product_code)
    const newCount    = parsedRows.filter(r => !existingCodes.has(r.product_code)).length
    const updateCount = parsedRows.length - newCount
    setDiffSummary({ newCount, updateCount, zeroOutCodes })
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
    // (b) Zero out items that were in DB but missing from this XLS
    const zeroOutCodes = diffSummary?.zeroOutCodes || []
    if (zeroOutCodes.length) {
      setProgress(p => ({ ...p, label: `Marking ${zeroOutCodes.length} items as Out of Stock...` }))
      const ZBATCH = 200
      for (let i = 0; i < zeroOutCodes.length; i += ZBATCH) {
        const codes = zeroOutCodes.slice(i, i + ZBATCH)
        const { error } = await sb.from('inventory').update({ quantity: 0, updated_at: now })
          .eq('location', location).in('product_code', codes)
        if (error) { setErrorMsg('Zero-out failed: ' + error.message); setPushing(false); return }
      }
    }
    setPushing(false)
    const oosTxt = zeroOutCodes.length ? ` · ${zeroOutCodes.length} marked Out of Stock` : ''
    setSuccess({ text: total + ' products updated in live inventory', sub: 'Location: ' + location + oosTxt + ' · Sales team can search stock now' })
    setProgress(p => ({ ...p, label: 'Done — ' + total + ' products uploaded successfully.' }))
    setShowReset(true)
    loadStatus()
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
    <Layout pageTitle="Upload Inventory" pageKey="upload">
      <div className="acc-page">
      <div className="acc-body">
        <div className="acc-page-title">Upload Inventory</div>
        <div className="acc-page-sub">Drop the daily XLS file — columns are detected automatically.</div>

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
      </div>
      </div>

      {/* Confirm Upload Modal */}
      {showConfirm && diffSummary && (() => {
        const totalExisting = diffSummary.newCount + diffSummary.updateCount + diffSummary.zeroOutCodes.length
        const dangerThreshold = totalExisting > 0 && diffSummary.zeroOutCodes.length > totalExisting * 0.5
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
            onClick={() => setShowConfirm(false)}>
            <div style={{ background:'white', borderRadius:14, width:'100%', maxWidth:440, boxShadow:'0 20px 60px rgba(0,0,0,0.25)', overflow:'hidden' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ padding:'18px 24px 14px', borderBottom:'1px solid #f1f5f9' }}>
                <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>Confirm Upload — {location}</div>
                <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>Review what will change before pushing to live inventory.</div>
              </div>
              <div style={{ padding:'18px 24px', display:'flex', flexDirection:'column', gap:10 }}>
                <SummaryRow icon="📥" label="New items to add"            count={diffSummary.newCount}    color="#1d4ed8" />
                <SummaryRow icon="🔄" label="Items to update"              count={diffSummary.updateCount} color="#0d9488" />
                <SummaryRow icon="📦" label="Items to mark Out of Stock"   count={diffSummary.zeroOutCodes.length} color="#b45309"
                  sub="not in this file (sold out / not tracked)" />
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
