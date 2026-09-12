import { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Stat from '../components/StatTile'
import TrendChart from '../components/TrendChart'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import ExpenseIcon from '../components/ExpenseIcon'
import DocScanner from '../components/DocScanner'
import { fmt, fmtMoney } from '../lib/fmt'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import * as EX from '../lib/expense'
import '../styles/kpi-dashboard.css'
import '../styles/orderdetail.css'   // .od-btn family — app-wide buttons
import '../styles/expenses.css'      // drawers (.od-drawer*) are global via main.jsx
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const PAGE_SIZE = 50

/* Payment-method glyphs.
 *
 * Deliberately OUR OWN neutral marks, not Visa / Mastercard / Google Pay artwork:
 *  - we store only `card`, `gpay` and `cash` — the CARD NETWORK IS NOT RECORDED, so a
 *    Visa or Mastercard badge would be inventing information about the transaction;
 *  - those are third-party trademarks with their own brand rules, which is not
 *    something to paste into an internal tool without a reason.
 * A card outline, a phone-with-rupee and a banknote read instantly and stay honest.
 */
const PAY_ICON = {
  card: <><rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" /><path d="M6 15h4" /></>,
  gpay: <><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 6h4M9.5 10.5h5M9.5 13h5M12 10.5V16" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M5.5 9.5h.01M18.5 14.5h.01" /></>,
}
function PayMethod({ method }) {
  const g = PAY_ICON[method]
  return (
    <span className="exp-pay">
      {g && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{g}</svg>}
      {EX.PAYMENT_LABEL[method] || method}
    </span>
  )
}

/* ── tiny inline glyphs (no emoji) ─────────────────────────────── */
const I = {
  down:  <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>,
  up:    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  clock: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  check: <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5" /></svg>,
  clip:  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" /></svg>,
  bill:  <svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>,
  review:<svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>,
  rupee: <svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M6 3h12M6 8h12M6 13h5a5 5 0 000-10" /><path d="M6 13l8 8" /></svg>,
  trash: <svg fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" /></svg>,
}

function StatusChip({ status, txn }) {
  const m = EX.statusMeta(status)
  return (
    <span className="ol-status-pill" style={{ '--stage-color': m.dot }}>
      <span className="ol-status-dot" />
      {m.label}{txn && status === 'reimbursed' && <span className="exp-status-txn">· {txn}</span>}
    </span>
  )
}

/* ══ Add Expense — drawer ══════════════════════════════════════════ */
function AddExpenseDrawer({ me, categories, testMode, onClose, onDone }) {
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [amount, setAmount] = useState('')
  const [pay, setPay] = useState('')
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState([])
  const [scanQueue, setScanQueue] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState({})
  const guard = useRef(false)
  const today = new Date().toISOString().slice(0, 10)
  const minDate = EX.oldestOpenExpenseDate(me.role)

  const cat = categories.find(c => c.id === categoryId)
  const vendorOpts = cat?.vendor_options || []
  useEffect(() => { setVendor('') }, [categoryId])

  // Photographed bills go through the scanner one at a time; PDFs and anything that is
  // not an image go straight in. `files` holds { file, original, scanMode, scanRisk } so
  // the upload step knows whether a second copy needs keeping.
  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    for (const f of chosen) { const v = EX.validateBillFile(f); if (v) { toast(v, 'error'); e.target.value = ''; return } }
    if (files.length + chosen.length > EX.MAX_BILLS) toast(`Up to ${EX.MAX_BILLS} bills per claim.`, 'warning')
    const room = EX.MAX_BILLS - files.length
    const take = chosen.slice(0, Math.max(0, room))
    e.target.value = ''
    if (!take.length) return

    const scannable = take.filter(f => f.type.startsWith('image/'))
    const asIs = take.filter(f => !f.type.startsWith('image/'))
    if (asIs.length) setFiles(fs => [...fs, ...asIs.map(f => ({ file: f }))])
    if (scannable.length) setScanQueue(q => [...q, ...scannable])
  }

  // One scanner at a time, over the queue. Skip and Cancel both mean "attach the photo
  // exactly as it is" — a screenshot of a UPI payment is not a document, and refusing to
  // attach it because the scanner could not find four corners would be absurd.
  function scanDone(res) {
    const src = scanQueue[0]
    setFiles(fs => [...fs, res?.scan
      ? { file: res.scan, original: res.original, scanMode: res.mode, scanRisk: res.risk }
      : { file: src }])
    setScanQueue(q => q.slice(1))
  }
  function validate() {
    const er = {}
    if (!categoryId) er.category = 'Pick a category'
    const d = EX.expenseDateIssue(date, me.role); if (d) er.date = `Date ${d}`
    const amt = Number(amount)
    if (!amount || isNaN(amt) || amt <= 0) er.amount = 'Enter the bill amount'
    else if (amt > 200000) er.amount = 'Max ₹2,00,000 per claim'
    if (!pay) er.pay = 'Select how you paid'
    if (vendorOpts.length && !vendor) er.vendor = 'Select one'
    if (!files.length) er.files = 'Attach at least one bill'
    setErr(er); return !Object.keys(er).length
  }

  async function submit() {
    if (guard.current) return
    if (!validate()) return
    guard.current = true; setSaving(true)
    let expId = null; const uploaded = []
    try {
      // Hash the ORIGINAL photo, never the scan. Two photos of the same bill will never
      // produce byte-identical scans, so hashing the processed file would quietly kill
      // the duplicate-receipt warning that already exists.
      const hashes = await Promise.all(files.map(b => EX.hashFile(b.original || b.file)))
      const { data: dups } = await sb.from('expense_bills').select('id').eq('profile_id', me.id).in('file_hash', hashes).limit(1)
      if (dups?.length) toast('Heads up — one of these bills matches a receipt from an earlier claim.', 'warning')

      const { data: exp, error: e1 } = await sb.from('expenses').insert({
        profile_id: me.id, category_id: categoryId, expense_date: date, amount: Number(amount),
        payment_method: pay, vendor: vendor || null, notes: notes || null, is_test: testMode,
      }).select('id').single()
      if (e1) throw e1
      expId = exp.id

      for (let i = 0; i < files.length; i++) {
        const b = files[i]
        const f = b.file
        const put = async file => {
          const p = `${me.id}/${crypto.randomUUID()}_${EX.safeName(file.name)}`
          const { error } = await sb.storage.from('expense-bills')
            .upload(p, file, { upsert: false, contentType: file.type })
          if (error) throw error
          uploaded.push(p)
          return p
        }
        const path = await put(f)
        // The untouched photo is kept only when the scan looked risky — a faint thermal
        // receipt, a coloured stamp, a hand-adjusted crop. A bill is a financial document
        // and "the threshold ate the total" is not something you discover in time.
        const originalPath = b.original ? await put(b.original) : null

        const { error: be } = await sb.from('expense_bills').insert({
          expense_id: expId, profile_id: me.id, file_path: path, filename: f.name,
          mime_type: f.type, size_bytes: f.size, file_hash: hashes[i], uploaded_by: me.id,
          original_path: originalPath, scan_mode: b.scanMode || null, scan_risk: b.scanRisk || null,
        })
        if (be) throw be
      }
      toast('Expense submitted for approval.', 'success')
      onDone()
    } catch (e) {
      if (uploaded.length) await sb.storage.from('expense-bills').remove(uploaded).catch(() => {})
      if (expId) await sb.from('expenses').delete().eq('id', expId).catch(() => {})
      toast(e?.message || friendlyError(e), 'error')
    } finally { guard.current = false; setSaving(false) }
  }

  return (
    <div className="od-drawer-scrim" onClick={onClose}>
      <div className="od-drawer" onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div>
            <div className="od-drawer-eyebrow">New claim</div>
            <div className="od-drawer-title">Add Expense{testMode ? ' · Test' : ''}</div>
            <div className="od-drawer-sub">Attach the bill — you're reimbursed the bill amount once approved.</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="od-drawer-body">
          {/* The scanner takes over the drawer body while there is anything to scan. It
              is a STEP in adding a bill, not a dialog on top of one — the form is still
              mounted behind it, so nothing typed is lost. */}
          {scanQueue.length > 0 ? (
            <DocScanner key={scanQueue.length} file={scanQueue[0]}
                        onCancel={() => scanDone(null)} onDone={scanDone} />
          ) : null}
          <div style={{ display: scanQueue.length > 0 ? 'none' : 'grid', gap: 15 }}>
            <div className="exp-field">
              <label className="exp-label">Category<span className="req">*</span></label>
              <select className={'exp-input' + (err.category ? ' err' : '')} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_budgeted ? ' · budgeted' : ''}</option>)}
              </select>
              {err.category && <div className="exp-err">{err.category}</div>}
            </div>

            {vendorOpts.length > 0 && (
              <div className="exp-field">
                <label className="exp-label">{/mobile|telephone/i.test(cat?.name || '') ? 'Carrier' : 'Provider'}<span className="req">*</span></label>
                <div className="exp-seg" style={{ flexWrap: 'wrap' }}>
                  {vendorOpts.map(v => (
                    <button key={v} type="button" className={'exp-seg-btn' + (vendor === v ? ' on' : '')} style={{ flex: '0 0 auto', minWidth: 78 }} onClick={() => setVendor(v)}>{v}</button>
                  ))}
                </div>
                {err.vendor && <div className="exp-err">{err.vendor}</div>}
              </div>
            )}

            <div className="exp-grid2">
              <div className="exp-field">
                <label className="exp-label">Date<span className="req">*</span></label>
                <input className={'exp-input' + (err.date ? ' err' : '')} type="date" value={date} min={minDate} max={today} onChange={e => setDate(e.target.value)} />
                {err.date && <div className="exp-err">{err.date}</div>}
              </div>
              <div className="exp-field">
                <label className="exp-label">Bill amount ₹<span className="req">*</span></label>
                <input className={'exp-input' + (err.amount ? ' err' : '')} type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
                {err.amount && <div className="exp-err">{err.amount}</div>}
              </div>
            </div>

            <div className="exp-field">
              <label className="exp-label">Paid via<span className="req">*</span></label>
              <div className="exp-seg">
                {EX.PAYMENT_METHODS.map(pm => (
                  <button key={pm.key} type="button" className={'exp-seg-btn' + (pay === pm.key ? ' on' : '')} onClick={() => setPay(pm.key)}>{pm.label}</button>
                ))}
              </div>
              {err.pay && <div className="exp-err">{err.pay}</div>}
            </div>

            <div className="exp-field">
              <label className="exp-label">Bills<span className="req">*</span><span className="hint">photo or PDF · max {EX.MAX_BILLS} · ≤ 8 MB</span></label>
              {/* No `capture` on the main input — the OS picker then offers
                  gallery/files (and iOS adds its own camera option). The
                  dedicated camera button (phones only, CSS) forces capture. */}
              <div className="exp-drop-row">
                <label className={'exp-drop' + (err.files ? ' err' : '')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Add bill — gallery or PDF
                  <input type="file" accept={EX.BILL_ACCEPT} multiple style={{ display: 'none' }} onChange={pickFiles} />
                </label>
                <label className={'exp-drop exp-drop-cam' + (err.files ? ' err' : '')}>
                  <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
                  </svg>
                  Take photo
                  <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={pickFiles} />
                </label>
              </div>
              {files.length > 0 && (
                <AttachedBills files={files} onRemove={i => setFiles(files.filter((_, j) => j !== i))} />
              )}
              {err.files && <div className="exp-err">{err.files}</div>}
            </div>

            <div className="exp-field">
              <label className="exp-label">Notes</label>
              <textarea className="exp-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional — what was this for?" />
            </div>
          </div>
        </div>
        <div className="od-drawer-foot">
          <button className="od-btn" onClick={onClose}>Cancel</button>
          <button className="od-btn od-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</button>
        </div>
      </div>
    </div>
  )
}

/* Bill previews — receipts are photos, so show them, don't list filenames. */
/* View a bill without leaving the app.
 *
 * NOT window.open. The manifest declares display:standalone, so in the installed PWA a
 * new window either throws the person out into Safari/Chrome — losing the drawer and
 * everything typed into it — or is blocked outright and looks like a dead button. This is
 * the same trap printDoc.js was written to solve for printed documents.
 */
function BillLightbox({ src, caption, onClose }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  if (!src) return null
  return createPortal(
    <div className="exp-lb" onClick={onClose}>
      <button className="exp-lb-x" onClick={onClose} aria-label="Close">×</button>
      <img src={src} alt={caption || 'Bill'} onClick={e => e.stopPropagation()} />
      {caption && <div className="exp-lb-cap">{caption}</div>}
    </div>,
    document.body,
  )
}

/* Bills attached but not yet submitted.
 *
 * Thumbnails, not filenames. The whole point of scanning is that the result should be
 * checked before it is attached to a claim, and "invoice-scan.jpg" tells you nothing
 * about whether the threshold ate the total. Click to open it full size.
 */
function AttachedBills({ files, onRemove }) {
  const [urls, setUrls] = useState([])
  const [lb, setLb] = useState(null)
  useEffect(() => {
    // Every entry must be the { file, … } wrapper. A bare File slipping in would throw on
    // `b.file.name` during render, React would unmount the whole drawer, and the symptom
    // would be "nothing happens when I attach a bill" with no error anywhere.
    const made = files.map(b => b?.file ? ({
      main: b.file.type.startsWith('image/') ? URL.createObjectURL(b.file) : null,
      orig: b.original ? URL.createObjectURL(b.original) : null,
    }) : {})
    setUrls(made)
    // Object URLs are a leak if they are not released — this drawer can be opened and
    // closed all day while someone files a month of expenses.
    return () => made.forEach(u => { if (u.main) URL.revokeObjectURL(u.main); if (u.orig) URL.revokeObjectURL(u.orig) })
  }, [files])

  return (
    <>
    <BillLightbox src={lb?.src} caption={lb?.cap} onClose={() => setLb(null)} />
    <div className="exp-att">
      {files.filter(b => b?.file).map((b, i) => {
        const u = urls[i] || {}
        return (
          <div className="exp-att-item" key={i}>
            <button type="button" className="exp-att-thumb" disabled={!u.main}
                    title={u.main ? 'Open full size' : b.file.name}
                    onClick={() => u.main && setLb({ src: u.main, cap: b.file.name })}>
              {u.main
                ? <img src={u.main} alt={b.file.name} />
                : <span className="exp-att-pdf">PDF</span>}
            </button>
            <div className="exp-att-meta">
              <div className="exp-att-name" title={b.file.name}>{b.file.name}</div>
              <div className="exp-att-sub">
                {b.scanMode ? MODE_WORD[b.scanMode] || 'Scanned' : 'As uploaded'}
                {' · '}{Math.max(1, Math.round(b.file.size / 1024))} KB
              </div>
              {b.original && (
                <button type="button" className="exp-att-orig"
                        onClick={() => u.orig && setLb({ src: u.orig, cap: 'Original photo — ' + b.file.name })}>
                  View original photo
                </button>
              )}
              {b.scanRisk && <div className="exp-att-risk">Original kept — {b.scanRisk}.</div>}
            </div>
            <button type="button" className="exp-att-x" onClick={() => onRemove(i)} aria-label="Remove">×</button>
          </div>
        )
      })}
    </div>
    </>
  )
}

const MODE_WORD = { xerox: 'Scanned · xerox', grey: 'Scanned · greyscale', plain: 'Scanned · colour' }

function BillGrid({ bills }) {
  const [urls, setUrls] = useState({})
  const [lb, setLb] = useState(null)
  useEffect(() => {
    let alive = true
    // Sign the originals as well. Keeping the untouched photo is pointless if there is
    // no way to open it — and it is the copy that matters when someone disputes a total.
    const paths = [...(bills || []).map(b => b.file_path),
                   ...(bills || []).map(b => b.original_path).filter(Boolean)]
    if (!paths.length) return
    sb.storage.from('expense-bills').createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive || !data) return
      const m = {}; data.forEach(d => { if (d.signedUrl) m[d.path] = d.signedUrl }); setUrls(m)
    })
    return () => { alive = false }
  }, [bills])

  if (!(bills || []).length) return <div className="exp-cfg-ph">No bill attached.</div>
  return (
    <>
    <BillLightbox src={lb?.src} caption={lb?.cap} onClose={() => setLb(null)} />
    <div className="exp-bill-grid">
      {bills.flatMap((b, i) => [
        // Where the untouched photo was kept, it gets its OWN tile. Hiding it behind a
        // shift-click or a tooltip means nobody finds it, and the whole reason it exists
        // is for the moment somebody disputes a figure on the scan.
        ...(b.original_path ? [(
          <button key={b.id + '-orig'} className="exp-bill-thumb exp-bill-orig"
                  title={`The photo as taken — kept because ${b.scan_risk || 'the scan looked risky'}.`}
                  onClick={() => urls[b.original_path] && setLb({ src: urls[b.original_path], cap: 'Original photo of bill ' + (i + 1) })}
                  disabled={!urls[b.original_path]}>
            {urls[b.original_path]
              ? <img src={urls[b.original_path]} alt={`Original of bill ${i + 1}`} />
              : <div className="exp-bill-file"><span>…</span></div>}
            <span className="exp-bill-cap">Original {i + 1}</span>
          </button>
        )] : []),
        billTile(b, i, urls, setLb),
      ])}
    </div>
    </>
  )
}

function billTile(b, i, urls, setLb) {
  const url = urls[b.file_path]
  const isImg = !/pdf$/i.test(b.mime_type || b.filename || '')
  return (
          <button key={b.id} className="exp-bill-thumb" title={b.filename}
            onClick={() => { if (!url) return; if (isImg) setLb({ src: url, cap: b.filename || ('Bill ' + (i + 1)) }); else window.open(url, '_blank') }}
            disabled={!url}>
            {isImg && url
              ? <img src={url} alt={b.filename || `Bill ${i + 1}`} />
              : <div className="exp-bill-file">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  <span>PDF</span>
                </div>}
            <span className="exp-bill-cap">
              Bill {i + 1}
              {b.scan_mode && <span className="exp-bill-scan"> · scan</span>}
            </span>
          </button>
  )
}

/* ══ Bulk pay — several approved claims, one transaction reference ══════ */
function BulkPayDrawer({ rows, profiles, onClose, onDone }) {
  const [txn, setTxn] = useState('')
  const [saving, setSaving] = useState(false)
  const guard = useRef(false)
  const total = rows.reduce((s, r) => s + Number(r.approved_amount ?? r.amount), 0)
  const people = [...new Set(rows.map(r => r.profile_id))]

  async function go() {
    if (guard.current) return
    if (!txn.trim()) { toast('Enter the transaction number.', 'error'); return }
    guard.current = true; setSaving(true)
    try {
      const { data, error } = await sb.rpc('expense_pay_bulk', { p_ids: rows.map(r => r.id), p_txn: txn.trim() })
      if (error) throw error
      toast(`Paid ${data} ${data === 1 ? 'claim' : 'claims'}.`, 'success')
      onDone()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setSaving(false) }
  }

  return (
    <div className="od-drawer-scrim" onClick={onClose}>
      <div className="od-drawer" style={{ width: 'min(480px,95vw)' }} onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div>
            <div className="od-drawer-eyebrow">Reimbursement</div>
            <div className="od-drawer-title">Pay {rows.length} {rows.length === 1 ? 'claim' : 'claims'}</div>
            <div className="od-drawer-sub">{people.length === 1 ? (profiles[people[0]]?.name || '') : `${people.length} people`} · one transaction reference for all</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="od-drawer-body">
          <div className="exp-modal-ctx" style={{ marginBottom: 14 }}>Total payout <b>{fmtMoney(total)}</b></div>
          <div className="exp-bulk-list">
            {rows.map(r => (
              <div key={r.id} className="exp-bulk-row">
                <span className="exp-bulk-cat">{r._cat}{r.vendor ? ` · ${r.vendor}` : ''}</span>
                <span className="exp-bulk-meta">{fmt(r.expense_date)}{people.length > 1 ? ` · ${profiles[r.profile_id]?.name || ''}` : ''}</span>
                <span className="exp-bulk-amt">{fmtMoney(r.approved_amount ?? r.amount)}</span>
              </div>
            ))}
          </div>
          <div className="exp-field" style={{ marginTop: 18 }}>
            <label className="exp-label">Transaction No.<span className="req">*</span></label>
            <input className="exp-input" value={txn} onChange={e => setTxn(e.target.value)} placeholder="UTR / txn reference" autoFocus />
            <div className="exp-err" style={{ color: '#94A3B8' }}>This same reference is recorded on all {rows.length} claims.</div>
          </div>
        </div>
        <div className="od-drawer-foot">
          <button className="od-btn" onClick={onClose}>Cancel</button>
          <button className="od-btn od-btn-pay" onClick={go} disabled={saving}>{saving ? '…' : `Pay ${fmtMoney(total)}`}</button>
        </div>
      </div>
    </div>
  )
}

/* ══ One drawer for everything: detail + bills, with the footer action that
      applies to this row (approve/reject, pay, delete). Rows are clickable,
      so the table itself stays free of buttons. ══════════════════════════ */
function ExpenseDrawer({ row, me, canApprove, canPay, onClose, onDone, onDelete }) {
  const [approvedAmount, setApprovedAmount] = useState(String(row.amount))
  const [note, setNote] = useState('')
  const [txn, setTxn] = useState('')
  const [saving, setSaving] = useState(false)
  const guard = useRef(false)

  // Admin = final authority: approves outright from any stage, own claim
  // included, and sets the approved amount. Management = first level only,
  // and never on their own claim.
  const awaiting = row.status === 'pending' || row.status === 'mgmt_approved'
  const isL2 = me.role === 'admin' && awaiting
  const isL1 = me.role === 'management' && row.status === 'pending' && row.profile_id !== me.id
  const canReview = isL1 || isL2
  const canPayThis = row.status === 'approved' && canPay
  const canDelete = row.profile_id === me.id && row.status === 'pending'
  const m = EX.statusMeta(row.status)

  async function review(decision) {
    if (guard.current) return
    if (decision === 'reject' && !note.trim()) { toast('A reason is required to reject.', 'error'); return }
    if (decision === 'approve' && isL2) {
      const a = Number(approvedAmount)
      if (isNaN(a) || a < 0 || a > row.amount) { toast('Approved amount must be between 0 and the bill amount.', 'error'); return }
    }
    guard.current = true; setSaving(true)
    try {
      const { error } = await sb.rpc('expense_review', {
        p_id: row.id, p_decision: decision,
        p_approved_amount: decision === 'approve' && isL2 ? Number(approvedAmount) : null,
        p_note: note.trim() || null,
      })
      if (error) throw error
      toast(decision === 'reject' ? 'Expense rejected.' : isL2 ? 'Expense approved.' : 'Sent to Admin for sign-off.', decision === 'reject' ? 'warning' : 'success')
      onDone()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setSaving(false) }
  }

  async function payNow() {
    if (guard.current) return
    if (!txn.trim()) { toast('Enter the transaction number.', 'error'); return }
    guard.current = true; setSaving(true)
    try {
      const { error } = await sb.rpc('expense_mark_reimbursed', { p_id: row.id, p_txn: txn.trim() })
      if (error) throw error
      toast('Marked reimbursed.', 'success'); onDone()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setSaving(false) }
  }

  return (
    <div className="od-drawer-scrim" onClick={onClose}>
      <div className="od-drawer" style={{ width: 'min(480px,95vw)' }} onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div>
            <div className="od-drawer-eyebrow">
              {canReview ? (isL2 ? 'Approval · Admin' : 'First approval · Management') : canPayThis ? 'Reimbursement' : 'Expense'}
            </div>
            <div className="od-drawer-title">{row._cat}</div>
            <div className="od-drawer-sub">{row._person} · {fmt(row.expense_date)}</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>×</button>
        </div>

        <div className="od-drawer-body">
          <div className="exp-rv-head">
            <ExpenseIcon name={row._cat} color={row._catColor} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="exp-rv-cat">
                {row.vendor && <span className="exp-vendor">{row.vendor}</span>}
                {row._budgeted && <span className="exp-flag">BUDGET</span>}
                <span className="exp-status" style={{ color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
                  <span className="exp-status-dot" style={{ background: m.color }} />{m.label}
                </span>
              </div>
              {row.payment_ref && <div className="exp-rv-person">Txn {row.payment_ref}</div>}
            </div>
            <div className="exp-rv-amt">{fmtMoney(row.approved_amount ?? row.amount)}</div>
          </div>

          <dl className="exp-rv-dl">
            <div><dt>Bill amount</dt><dd>{fmtMoney(row.amount)}</dd></div>
            <div><dt>Paid via</dt><dd>{EX.PAYMENT_LABEL[row.payment_method] || row.payment_method}</dd></div>
            {row.notes && <div className="wide"><dt>Notes</dt><dd>{row.notes}</dd></div>}
            {row.review_note && <div className="wide"><dt>Review note</dt><dd>{row.review_note}</dd></div>}
          </dl>

          <div className="exp-field" style={{ marginTop: 18 }}>
            <label className="exp-label">Bills <span className="hint">tap to open full size</span></label>
            <BillGrid bills={row.expense_bills} />
          </div>

          {isL2 && (
            <div className="exp-field" style={{ marginTop: 18 }}>
              <label className="exp-label">Approved amount ₹</label>
              <input className="exp-input" type="number" min="0" max={row.amount} value={approvedAmount}
                onChange={e => setApprovedAmount(e.target.value)} />
              <div className="exp-err" style={{ color: '#94A3B8' }}>Defaults to the bill amount — lower it to part-approve.</div>
            </div>
          )}
          {canReview && (
            <div className="exp-field" style={{ marginTop: 18 }}>
              <label className="exp-label">Note <span className="hint">required to reject</span></label>
              <textarea className="exp-textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / remarks" />
            </div>
          )}
          {canPayThis && (
            <div className="exp-field" style={{ marginTop: 18 }}>
              <label className="exp-label">Transaction No.<span className="req">*</span></label>
              <input className="exp-input" value={txn} onChange={e => setTxn(e.target.value)} placeholder="UTR / txn reference" autoFocus />
            </div>
          )}
        </div>

        <div className="od-drawer-foot" style={{ justifyContent: canReview || canDelete ? 'space-between' : 'flex-end' }}>
          {canReview && <button className="od-btn od-btn-danger" onClick={() => review('reject')} disabled={saving}>Reject</button>}
          {!canReview && canDelete && <button className="od-btn od-btn-danger" onClick={onDelete} disabled={saving}>Delete</button>}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="od-btn" onClick={onClose}>Close</button>
            {canReview && (
              <button className="od-btn od-btn-approve" onClick={() => review('approve')} disabled={saving}>
                {saving ? '…' : isL2 ? 'Approve' : 'Approve (send to Admin)'}
              </button>
            )}
            {canPayThis && (
              <button className="od-btn od-btn-pay" onClick={payNow} disabled={saving}>
                {saving ? '…' : `Pay ${fmtMoney(row.approved_amount ?? row.amount)}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════ */
export default function PeopleExpenses() {
  const navigate = useNavigate()
  const [me, setMe] = useState(null)
  const [month, setMonth] = useState(EX.currentMonthStart())
  const [testMode, setTestMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [profiles, setProfiles] = useState({})
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState([])
  const [trend, setTrend] = useState([])   // last 12 months, for the chart only
  const [fPerson, setFPerson] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fCat, setFCat] = useState('')
  const [page, setPage] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [openRow, setOpenRow] = useState(null)   // row-click opens one drawer
  const [selected, setSelected] = useState([])   // ids of approved claims picked for bulk pay
  const [bulkPay, setBulkPay] = useState(null)    // { rows } when the bulk-pay drawer is open

  const isPriv = me && EX.CAN_SEE_ALL.includes(me.role)
  const canApprove = me && EX.CAN_APPROVE.includes(me.role)
  const canPay = me && EX.CAN_PAY.includes(me.role)
  const canConfig = me && EX.CAN_CONFIG.includes(me.role)

  useEffect(() => { init() }, [])
  useEffect(() => { if (me) load() }, [me, month, testMode])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: p } = await sb.from('profiles').select('id,name,role,location').eq('id', session.user.id).single()
    // Hiding the nav link is not access control — /people/expenses typed directly still
    // rendered for ops, staff and FC (empty, but reachable). Refuse it outright.
    if (!EX.CAN_OPEN.includes(p?.role)) { navigate('/people'); return }
    setMe({ id: session.user.id, name: p?.name || '', role: p?.role || 'sales', location: p?.location || null })
  }

  async function load() {
    setLoading(true); setPage(0)
    setSummary([]); setRows([]) // avoid flashing the previous month's numbers under the new month label while the header/card stay visible
    try {
      // 12-month series for the trend chart. Deliberately a separate, minimal query:
      // the page's main fetch is one month with bills and categories joined, and widening
      // that to a year would pull far more than the chart needs. RLS scopes it the same
      // way, so the chart can never show claims the viewer cannot already see.
      const firstMonth = EX.monthOptions(12)[EX.monthOptions(12).length - 1]?.value || month
      const [cats, profs, sum, tr] = await Promise.all([
        sb.from('expense_categories').select('*').eq('is_active', true).order('sort_order'),
        sb.from('profiles').select('id,name,role,location'),
        sb.rpc('expense_summary', { p_month: month, p_is_test: testMode }),
        fetchAll((from, to) => sb.from('expenses')
          .select('month_start,amount,status,profile_id')
          .gte('month_start', firstMonth).eq('is_test', testMode)
          .order('month_start').order('id').range(from, to)),
      ])
      setTrend(tr?.data || [])
      setCategories(cats.data || [])
      const pmap = {}; (profs.data || []).forEach(p => { pmap[p.id] = p }); setProfiles(pmap)
      setSummary(sum.data || [])

      const { data, error } = await fetchAll((from, to) => sb
        .from('expenses')
        .select('*, expense_categories(name,color,is_budgeted,gl_code), expense_bills(id,file_path,filename,mime_type,original_path,scan_mode,scan_risk)')
        .eq('month_start', month).eq('is_test', testMode)
        .order('expense_date', { ascending: false }).order('id', { ascending: false })
        .range(from, to))
      if (error) throw error
      setRows((data || []).map(r => ({
        ...r,
        _cat: r.expense_categories?.name || '—',
        _catColor: r.expense_categories?.color,
        _budgeted: !!r.expense_categories?.is_budgeted,
      })))
    } catch (e) { toast(friendlyError(e), 'error') }
    finally { setLoading(false) }
  }

  const list = useMemo(() => rows.map(r => ({ ...r, _person: profiles[r.profile_id]?.name || '—' })), [rows, profiles])
  const filtered = useMemo(() => list.filter(r =>
    (!fPerson || r.profile_id === fPerson) && (!fStatus || r.status === fStatus) && (!fCat || r.category_id === fCat)
  ), [list, fPerson, fStatus, fCat])
  const paged = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const mySum = summary.find(s => s.profile_id === me?.id)
  const totals = useMemo(() => {
    const t = { approved: 0, pending: 0, payable: 0, reimbursed: 0, over: 0 }
    summary.forEach(s => {
      t.approved += Number(s.budgeted_approved) + Number(s.other_approved)
      t.pending += Number(s.budgeted_pending) + Number(s.other_pending)
      t.payable += Number(s.payable); t.reimbursed += Number(s.reimbursed)
      if (EX.isOver(s.budgeted_approved, s.budget)) t.over++
    })
    return t
  }, [summary])

  // ── The card ────────────────────────────────────────────────────
  // Pick a person (or All) and the card shows THAT selection's month:
  // total expense, what's been spent, and the budget it sits against.
  const N = v => Number(v || 0)
  const cardFor = rows => rows.reduce((a, r) => ({
    expense: a.expense + N(r.budgeted_approved) + N(r.other_approved),   // approved = actually spent
    pending: a.pending + N(r.budgeted_pending) + N(r.other_pending),     // awaiting approval
    budget: a.budget + N(r.budget),            // sales: mileage · accounts: office
    budgetedSpent: a.budgetedSpent + N(r.budgeted_approved),
    payable: a.payable + N(r.payable),
    reimbursed: a.reimbursed + N(r.reimbursed),
  }), { expense: 0, pending: 0, budget: 0, budgetedSpent: 0, payable: 0, reimbursed: 0 })

  const selSum = isPriv && fPerson ? summary.filter(s => s.profile_id === fPerson) : null
  const card = isPriv
    ? cardFor(selSum || summary)
    : cardFor(mySum ? [mySum] : [])
  const card_total = card.expense + card.pending          // total expense this month
  // NOTE: this block runs on the very first render, BEFORE the `if (!me)` guard
  // below — so every `me.*` read here must be optional-chained or it throws
  // "Cannot read properties of null" and blanks the whole page.
  const cardName = isPriv
    ? (fPerson ? (profiles[fPerson]?.name || '—') : 'All people')
    : (me?.name || '')
  const cardLoc = isPriv ? (fPerson ? profiles[fPerson]?.location : null) : (me?.location || null)
  const cardCount = filtered.length

  // Monthly totals for the chart. Follows the SAME person filter as the tiles, so the
  // line always describes whatever the page is currently showing.
  const trendPoints = useMemo(() => {
    const opts = EX.monthOptions(12).slice().reverse()     // oldest -> newest
    const scoped = (isPriv && fPerson) ? trend.filter(r => r.profile_id === fPerson)
      : isPriv ? trend
      : trend.filter(r => r.profile_id === me?.id)
    const by = new Map()
    scoped.forEach(r => {
      if (r.status === 'rejected') return                  // rejected never cost anything
      by.set(r.month_start, (by.get(r.month_start) || 0) + Number(r.amount || 0))
    })
    return opts.map(o => ({
      key: o.value,
      label: o.label.slice(0, 3),                          // "September 2026" -> "Sep"
      value: by.get(o.value) || 0,
    }))
  }, [trend, isPriv, fPerson, me])

  async function viewBill(path) {
    const { data, error } = await sb.storage.from('expense-bills').createSignedUrl(path, 3600)
    if (error) { toast(friendlyError(error), 'error'); return }
    window.open(data.signedUrl, '_blank')
  }
  async function delExpense(row) {
    if (!confirm('Delete this pending expense and its bills?')) return
    try {
      const paths = (row.expense_bills || []).map(b => b.file_path)
      if (paths.length) await sb.storage.from('expense-bills').remove(paths).catch(() => {})
      const { error } = await sb.from('expenses').delete().eq('id', row.id)
      if (error) throw error
      toast('Expense claim deleted', 'warning', 'Its attached bills were removed too.'); load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }
  // Styled .xlsx — same chrome as the Orders sheets (xlsFinish/xlsDownload).
  async function exportXls() {
    if (!filtered.length) { toast('No expenses to export.', 'warning'); return }
    let ExcelJS
    try { ExcelJS = (await import('exceljs')).default } catch (e) { toast('Failed to load Excel library.', 'error'); return }
    try {
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Expenses')
      ws.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Person', key: 'person', width: 20 },
        { header: 'Location', key: 'location', width: 12 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Provider', key: 'vendor', width: 12 },
        { header: 'GL Code', key: 'gl', width: 14 },
        { header: 'Bill Amount', key: 'amount', width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Approved', key: 'approved', width: 14, style: { numFmt: '₹#,##,##0.00' } },
        { header: 'Paid Via', key: 'paid', width: 11 },
        { header: 'Status', key: 'status', width: 16 },
        { header: 'Txn No', key: 'txn', width: 18 },
        { header: 'Notes', key: 'notes', width: 30 },
      ]
      filtered.forEach(r => {
        const m = EX.statusMeta(r.status)
        const row = ws.addRow({
          date: fmt(r.expense_date),
          person: profiles[r.profile_id]?.name || '',
          location: profiles[r.profile_id]?.location || '',
          category: r._cat,
          vendor: r.vendor || '',
          gl: r.expense_categories?.gl_code || '',
          amount: Number(r.amount),
          approved: r.approved_amount != null ? Number(r.approved_amount) : null,
          paid: EX.PAYMENT_LABEL[r.payment_method] || r.payment_method,
          status: m.label,
          txn: r.payment_ref || '',
          notes: r.notes || '',
        })
        const c = row.getCell('status')
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EX.xlsStatusFill(r.status).bg } }
        c.font = { bold: true, color: { argb: EX.xlsStatusFill(r.status).fg } }
        c.alignment = { horizontal: 'center', vertical: 'middle' }
      })
      xlsFinish(ws, 12)
      await xlsDownload(wb, `Expenses_${month}.xlsx`)
    } catch (e) { toast('Failed to generate Excel: ' + (e.message || e), 'error'); console.error(e) }
  }

  // ── Bulk pay: pick several APPROVED claims, pay them with one txn ref ──
  const payableRows = filtered.filter(r => r.status === 'approved' && canPay)
  const selectedRows = filtered.filter(r => selected.includes(r.id))
  const selTotal = selectedRows.reduce((s, r) => s + Number(r.approved_amount ?? r.amount), 0)
  const selPeople = [...new Set(selectedRows.map(r => r.profile_id))]
  function toggleSel(id) { setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]) }
  function selectAllPayable() {
    const ids = payableRows.map(r => r.id)
    const allOn = ids.length > 0 && ids.every(i => selected.includes(i))
    setSelected(allOn ? [] : ids)
  }
  // drop selection whenever the visible set changes
  useEffect(() => { setSelected([]) }, [fPerson, fStatus, fCat, month, testMode])

  // Exactly one labelled button per row, and only when this user is the one
  // who has to act. Everything else lives in the drawer (row is clickable).
  function rowAction(r) {
    const mine = r.profile_id === me.id
    // Admin is the final authority: one click approves outright, at any stage,
    // including their own claim. Management gives first-level sign-off only.
    if (me.role === 'admin' && (r.status === 'pending' || r.status === 'mgmt_approved'))
      return <button className="exp-rowbtn approve" onClick={e => { e.stopPropagation(); setOpenRow(r) }}>Approve</button>
    if (me.role === 'management' && r.status === 'pending' && !mine)
      return <button className="exp-rowbtn approve" onClick={e => { e.stopPropagation(); setOpenRow(r) }}>Review</button>
    if (r.status === 'approved' && canPay)
      return <button className="exp-rowbtn pay" onClick={e => { e.stopPropagation(); setOpenRow(r) }}>Pay</button>
    return <span className="exp-rowchev">›</span>
  }

  // Only the initial profile fetch blanks the whole page — a subsequent data
  // reload (switching month/test mode) keeps the header/card visible and only
  // swaps the table body below, matching the Orders/GRN loading pattern.
  if (!me) return <Layout pageKey="people"><div className="orders-app"><div className="o-loading">Loading…</div></div></Layout>

  return (
    <Layout pageKey="people">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={() => navigate('/people')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="page-title">Expenses</h1>
            <div className="page-sub">Submit claims with bills · Management approves · Admin signs off · Accounts pays.</div>
          </div>
          <div className="page-meta">
            <select className="ph-picker" value={month} onChange={e => setMonth(e.target.value)}>
              {EX.monthOptions(12).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {isPriv && (
              <select className="ph-picker" value={fPerson}
                onChange={e => { setFPerson(e.target.value); setPage(0) }}>
                <option value="">All people</option>
                {/* This is a PEOPLE filter, not the budget list — the two are different
                    questions and the page used to conflate them. Budgets exist for mileage
                    and are sales-only, so anyone outside that (accounts, ops, admin,
                    management) was unselectable here even with claims on screen: Maunang
                    had 9 expenses and no way to filter to them. So: budgeted people, PLUS
                    anyone who actually has a claim in the month being shown. */}
                {(() => {
                  const seen = new Set()
                  const ids = []
                  summary.filter(sm => sm.in_budget && !sm.suspended).forEach(sm => {
                    if (!seen.has(sm.profile_id)) { seen.add(sm.profile_id); ids.push(sm.profile_id) }
                  })
                  rows.forEach(r => {
                    if (r.profile_id && !seen.has(r.profile_id)) { seen.add(r.profile_id); ids.push(r.profile_id) }
                  })
                  return ids
                    .map(id => ({ id, name: profiles[id]?.name || '—' }))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(o => <option key={o.id} value={o.id}>{o.name}</option>)
                })()}
              </select>
            )}
            {me?.role === 'admin' && (
              <label className={`o-test-toggle ${testMode ? 'on' : ''}`}>
                <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} style={{ accentColor: '#B45309', width: 13, height: 13 }} />
                Test Mode
              </label>
            )}
            {canConfig && <button className="btn-ghost" onClick={() => navigate('/people/expenses/config')}>Configure</button>}
            <button className="btn-primary" onClick={() => setShowAdd(true)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              Add Expense
            </button>
          </div>
        </div>

        {/* The expense surface below is purpose-built (bill thumbnails, bulk select, budget
            cards) with ~67 classes of its own, all scoped to .kpi-app. It keeps its own
            shell nested here so every class still resolves and nothing about the claim
            flow changes — only the page chrome above moved to the shared language. */}
        <div className="kpi-app density-comfortable accent-ssc">

        {/* Bento summary — the same figures the old card showed (total, approved,
            awaiting, payable, mileage budget), in the shared tile language. Every value
            is read from `card`, unchanged. */}
        <div className="ph-bento lv-bento">
          <Stat label={`Total · ${EX.monthOptions(12).find(m => m.value === month)?.label || ''}`}
            value={fmtMoney(card_total)}
            foot={<>{cardCount} {cardCount === 1 ? 'claim' : 'claims'}{cardLoc ? ` · ${cardLoc}` : ''}</>} />
          <Stat label="Approved" value={fmtMoney(card.expense)} foot="actually spent" />
          <Stat label="Awaiting" value={fmtMoney(card.pending)} warn={card.pending > 0}
            foot={card.pending > 0 ? 'not yet approved' : 'nothing pending'} />
          <Stat label="Ready to pay" value={fmtMoney(card.payable)}
            foot={card.reimbursed > 0 ? <><b>{fmtMoney(card.reimbursed)}</b> already paid</> : 'approved, unpaid'}
            onClick={card.payable > 0 && canPay ? () => { setFStatus('approved'); setPage(0) } : undefined} />
          <Stat label="Mileage budget"
            value={card.budget > 0 ? fmtMoney(card.budgetedSpent) : '—'}
            unit={card.budget > 0 ? `/ ${fmtMoney(card.budget)}` : ''}
            foot={card.budget > 0
              ? <span className="lv-mini">
                  <span className="lv-mini-bar"><span style={{
                    width: Math.min(100, EX.pctUsed(card.budgetedSpent, card.budget)) + '%',
                    background: EX.isOver(card.budgetedSpent, card.budget) ? '#EF4444' : '#10B981' }} /></span>
                  {EX.isOver(card.budgetedSpent, card.budget)
                    ? `${fmtMoney(-EX.remaining(card.budget, card.budgetedSpent))} over`
                    : `${fmtMoney(EX.remaining(card.budget, card.budgetedSpent))} left`}
                </span>
              : 'no budget set'} />
        </div>

        {/* Monthly trend — same shared chart as the People dashboard, following the
            person filter. Rejected claims are excluded: they never cost anything. */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <div>
              <div className="card-eyebrow">Last 12 months{isPriv && fPerson ? ` · ${profiles[fPerson]?.name || ''}` : ''}</div>
              <div className="card-title">Expense Trend</div>
            </div>
            <span className="trend-pill mono">{fmtMoney(trendPoints.reduce((a, p) => a + p.value, 0))} total</span>
          </div>
          <TrendChart points={trendPoints} fmt={v => fmtMoney(v)} height={110} />
        </div>

        {/* ── Filters ── */}
        {isPriv && (
          <div className="exp-filters">
            <select className="exp-select" value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(0) }}>
              <option value="">All statuses</option>
              {Object.keys(EX.STATUS_META).map(s => <option key={s} value={s}>{EX.STATUS_META[s].label}</option>)}
            </select>
            <select className="exp-select" value={fCat} onChange={e => { setFCat(e.target.value); setPage(0) }}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="exp-spacer" />
            <button className="exp-dl-btn" onClick={exportXls} title="Download Excel">
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download Excel
            </button>
          </div>
        )}

        {/* ── Transactions ── */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="card-head" style={{ padding: '16px 18px 12px', marginBottom: 0, borderBottom: '1px solid var(--kline)' }}>
            <div>
              <div className="card-eyebrow">Claims</div>
              <div className="card-title">{filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'}</div>
            </div>
            {canPay && payableRows.length > 0 && (
              <div className="exp-sub-note">Tick approved claims to pay several at once</div>
            )}
          </div>

          {/* selection bar — appears once approved claims are ticked */}
          {selected.length > 0 && (
            <div className="exp-selbar">
              <div>
                <b>{selected.length}</b> selected · <b>{fmtMoney(selTotal)}</b>
                {selPeople.length > 1 && <span className="exp-selbar-warn"> · {selPeople.length} people — one txn will apply to all</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="od-btn" onClick={() => setSelected([])}>Clear</button>
                <button className="exp-dl-btn" style={{ background: '#6D28D9', borderColor: '#6D28D9' }} onClick={() => setBulkPay({ rows: selectedRows })}>Pay {fmtMoney(selTotal)}</button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="o-loading">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="exp-empty">
              <svg fill="none" stroke="#CBD5E1" strokeWidth="1.5" viewBox="0 0 24 24" style={{ width: 34, height: 34 }}>
                <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
              </svg>
              <div className="exp-empty-title">No expenses this month</div>
              <div className="exp-empty-sub">Claims you submit will appear here.</div>
            </div>
          ) : (
            <>
              <div className="exp-table">
                <table>
                  <thead>
                    <tr>
                      {canPay && (
                        <th className="chk">
                          {payableRows.length > 0 && (
                            <input type="checkbox" title="Select all approved"
                              checked={payableRows.every(r => selected.includes(r.id))}
                              onChange={selectAllPayable} />
                          )}
                        </th>
                      )}
                      <th className="ico" />
                      <th>Date</th>
                      <th className="num">Amount</th>
                      <th>Category</th>
                      {isPriv && !fPerson && <th>Person</th>}
                      <th>Paid via</th>
                      <th>Bills</th>
                      <th>Status</th>
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(r => (
                      <tr key={r.id} className={'exp-row' + (selected.includes(r.id) ? ' sel' : '')} onClick={() => setOpenRow(r)}>
                        {canPay && (
                          <td className="chk" onClick={e => e.stopPropagation()}>
                            {r.status === 'approved'
                              ? <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSel(r.id)} />
                              : null}
                          </td>
                        )}
                        <td className="ico"><ExpenseIcon name={r._cat} color={r._catColor} small /></td>
                        <td className="date">{fmt(r.expense_date)}</td>
                        <td className="num">
                          {fmtMoney(r.approved_amount ?? r.amount)}
                          {r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) &&
                            <span className="exp-strike">{fmtMoney(r.amount)}</span>}
                        </td>
                        <td>
                          <span className="exp-cat-name">{r._cat}</span>
                          {r.vendor && <span className="exp-vendor">{r.vendor}</span>}
                          {r._budgeted && <span className="exp-flag">BUDGET</span>}
                          {r.status === 'rejected' && r.review_note &&
                            <div className="exp-note" title={r.review_note}>{r.review_note}</div>}
                        </td>
                        {isPriv && !fPerson && <td className="mut">{profiles[r.profile_id]?.name || '—'}</td>}
                        <td className="mut"><PayMethod method={r.payment_method} /></td>
                        <td>
                          {(r.expense_bills || []).length > 0
                            ? <span className="exp-billcount">{I.clip}{(r.expense_bills || []).length}</span>
                            : <span className="exp-dash">—</span>}
                        </td>
                        <td><StatusChip status={r.status} txn={r.payment_ref} /></td>
                        <td className="act">{rowAction(r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile claim cards (≤560px) — same rows & handlers as the table */}
              <div className="exp-cards">
                {paged.map(r => (
                  <div key={r.id} className={'exp-mcard' + (selected.includes(r.id) ? ' sel' : '')} onClick={() => setOpenRow(r)}>
                    <div className="exp-mcard-top">
                      <ExpenseIcon name={r._cat} color={r._catColor} small />
                      <div className="exp-mcard-mid">
                        <span className="exp-cat-name">{r._cat}</span>
                        {isPriv && !fPerson && <span className="exp-mcard-person">{profiles[r.profile_id]?.name || '—'}</span>}
                      </div>
                      <div className="exp-mcard-amt">
                        {fmtMoney(r.approved_amount ?? r.amount)}
                        {r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) &&
                          <span className="exp-strike">{fmtMoney(r.amount)}</span>}
                      </div>
                    </div>
                    {r.vendor && <div className="exp-mcard-vendor">{r.vendor}</div>}
                    <div className="exp-mcard-meta">
                      <span>{fmt(r.expense_date)}</span>
                      <span className="exp-dash">·</span>
                      <span>{EX.PAYMENT_LABEL[r.payment_method] || r.payment_method}</span>
                      {(r.expense_bills || []).length > 0 && <>
                        <span className="exp-dash">·</span>
                        <span className="exp-billcount">{I.clip}{(r.expense_bills || []).length}</span>
                      </>}
                      {r._budgeted && <span className="exp-flag">BUDGET</span>}
                    </div>
                    {r.status === 'rejected' && r.review_note && <div className="exp-note">{r.review_note}</div>}
                    <div className="exp-mcard-foot" onClick={e => e.stopPropagation()}>
                      <StatusChip status={r.status} txn={r.payment_ref} />
                      <div className="exp-mcard-acts">
                        {canPay && r.status === 'approved' && (
                          <label className="exp-mcard-sel">
                            <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggleSel(r.id)} />
                            Select
                          </label>
                        )}
                        {rowAction(r)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="exp-pager">
                  <button className="od-btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Prev</button>
                  <span className="exp-pager-info">Page {page + 1} / {totalPages}</span>
                  <button className="od-btn" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {showAdd && <AddExpenseDrawer me={me} categories={categories} testMode={testMode} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />}
      {openRow && <ExpenseDrawer row={openRow} me={me} canApprove={canApprove} canPay={canPay}
        onClose={() => setOpenRow(null)}
        onDone={() => { setOpenRow(null); load() }}
        onDelete={() => { const r = openRow; setOpenRow(null); delExpense(r) }} />}
      {bulkPay && <BulkPayDrawer rows={bulkPay.rows} profiles={profiles}
        onClose={() => setBulkPay(null)}
        onDone={() => { setBulkPay(null); setSelected([]); load() }} />}
    </Layout>
  )
}
