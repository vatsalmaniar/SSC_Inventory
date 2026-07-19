import { useEffect, useState, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { fetchAll } from '../lib/fetchAll'
import Layout from '../components/Layout'
import ExpenseIcon from '../components/ExpenseIcon'
import { fmt, fmtMoney } from '../lib/fmt'
import { xlsFinish, xlsDownload } from '../lib/xlsExport'
import * as EX from '../lib/expense'
import '../styles/kpi-dashboard.css'
import '../styles/orderdetail.css'   // .od-btn family — app-wide buttons
import '../styles/expenses.css'      // drawers (.od-drawer*) are global via main.jsx

const PAGE_SIZE = 50

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
    <span className="exp-status" style={{ color: m.color, background: m.bg, border: `1px solid ${m.border}` }}>
      <span className="exp-status-dot" style={{ background: m.color }} />
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
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState({})
  const guard = useRef(false)
  const today = new Date().toISOString().slice(0, 10)
  const minDate = (parseInt(today.slice(0, 4)) - 1) + today.slice(4)

  const cat = categories.find(c => c.id === categoryId)
  const vendorOpts = cat?.vendor_options || []
  useEffect(() => { setVendor('') }, [categoryId])

  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    for (const f of chosen) { const v = EX.validateBillFile(f); if (v) { toast(v, 'error'); e.target.value = ''; return } }
    if (files.length + chosen.length > EX.MAX_BILLS) toast(`Up to ${EX.MAX_BILLS} bills per claim.`, 'warning')
    setFiles([...files, ...chosen].slice(0, EX.MAX_BILLS)); e.target.value = ''
  }
  function validate() {
    const er = {}
    if (!categoryId) er.category = 'Pick a category'
    const d = EX.expenseDateIssue(date); if (d) er.date = `Date ${d}`
    const amt = Number(amount)
    if (!amount || isNaN(amt) || amt <= 0) er.amount = 'Enter the bill amount'
    else if (amt > 100000) er.amount = 'Max ₹1,00,000 per claim'
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
      const hashes = await Promise.all(files.map(EX.hashFile))
      const { data: dups } = await sb.from('expense_bills').select('id').eq('profile_id', me.id).in('file_hash', hashes).limit(1)
      if (dups?.length) toast('Heads up — one of these bills matches a receipt from an earlier claim.', 'warning')

      const { data: exp, error: e1 } = await sb.from('expenses').insert({
        profile_id: me.id, category_id: categoryId, expense_date: date, amount: Number(amount),
        payment_method: pay, vendor: vendor || null, notes: notes || null, is_test: testMode,
      }).select('id').single()
      if (e1) throw e1
      expId = exp.id

      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const path = `${me.id}/${crypto.randomUUID()}_${EX.safeName(f.name)}`
        const { error: ue } = await sb.storage.from('expense-bills').upload(path, f, { upsert: false, contentType: f.type })
        if (ue) throw ue
        uploaded.push(path)
        const { error: be } = await sb.from('expense_bills').insert({
          expense_id: expId, profile_id: me.id, file_path: path, filename: f.name,
          mime_type: f.type, size_bytes: f.size, file_hash: hashes[i], uploaded_by: me.id,
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
          <div style={{ display: 'grid', gap: 15 }}>
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
              <label className={'exp-drop' + (err.files ? ' err' : '')}>
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Tap to add a bill or take a photo
                <input type="file" accept={EX.BILL_ACCEPT} capture="environment" multiple style={{ display: 'none' }} onChange={pickFiles} />
              </label>
              {files.length > 0 && (
                <div className="exp-files">
                  {files.map((f, i) => (
                    <span key={i} className="exp-file">
                      {f.name.length > 26 ? f.name.slice(0, 24) + '…' : f.name}
                      <button className="exp-file-x" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                </div>
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
function BillGrid({ bills }) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    let alive = true
    const paths = (bills || []).map(b => b.file_path)
    if (!paths.length) return
    sb.storage.from('expense-bills').createSignedUrls(paths, 3600).then(({ data }) => {
      if (!alive || !data) return
      const m = {}; data.forEach(d => { if (d.signedUrl) m[d.path] = d.signedUrl }); setUrls(m)
    })
    return () => { alive = false }
  }, [bills])

  if (!(bills || []).length) return <div className="exp-cfg-ph">No bill attached.</div>
  return (
    <div className="exp-bill-grid">
      {bills.map((b, i) => {
        const url = urls[b.file_path]
        const isImg = !/pdf$/i.test(b.mime_type || b.filename || '')
        return (
          <button key={b.id} className="exp-bill-thumb" title={b.filename}
            onClick={() => url && window.open(url, '_blank')} disabled={!url}>
            {isImg && url
              ? <img src={url} alt={b.filename || `Bill ${i + 1}`} />
              : <div className="exp-bill-file">
                  <svg fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" />
                  </svg>
                  <span>PDF</span>
                </div>}
            <span className="exp-bill-cap">Bill {i + 1}</span>
          </button>
        )
      })}
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
      toast(decision === 'reject' ? 'Expense rejected.' : isL2 ? 'Expense approved.' : 'Sent to Admin for sign-off.', 'success')
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
  const [fPerson, setFPerson] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fCat, setFCat] = useState('')
  const [page, setPage] = useState(0)
  const [showAdd, setShowAdd] = useState(false)
  const [openRow, setOpenRow] = useState(null)   // row-click opens one drawer

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
    setMe({ id: session.user.id, name: p?.name || '', role: p?.role || 'sales', location: p?.location || null })
  }

  async function load() {
    setLoading(true); setPage(0)
    setSummary([]); setRows([]) // avoid flashing the previous month's numbers under the new month label while the header/card stay visible
    try {
      const [cats, profs, sum] = await Promise.all([
        sb.from('expense_categories').select('*').eq('is_active', true).order('sort_order'),
        sb.from('profiles').select('id,name,role,location'),
        sb.rpc('expense_summary', { p_month: month, p_is_test: testMode }),
      ])
      setCategories(cats.data || [])
      const pmap = {}; (profs.data || []).forEach(p => { pmap[p.id] = p }); setProfiles(pmap)
      setSummary(sum.data || [])

      const { data, error } = await fetchAll((from, to) => sb
        .from('expenses')
        .select('*, expense_categories(name,color,is_budgeted,gl_code), expense_bills(id,file_path,filename)')
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
      toast('Deleted.', 'success'); load()
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
  if (!me) return <Layout pageKey="people"><div className="o-loading">Loading…</div></Layout>

  return (
    <Layout pageKey="people">
      <div className="kpi-app density-comfortable accent-ssc">
        <div className="page-head">
          <div>
            <button className="od-btn" style={{ marginBottom: 8 }} onClick={() => navigate('/people')}>← Back</button>
            <h1 className="page-title">Expenses</h1>
            <div className="page-sub">Submit claims with bills · Management approves · Admin signs off · Accounts pays.</div>
          </div>
          <div className="page-meta">
            <select className="exp-select" value={month} onChange={e => setMonth(e.target.value)}>
              {EX.monthOptions(12).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            {me?.role === 'admin' && (
              <label className={`o-test-toggle ${testMode ? 'on' : ''}`}>
                <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} style={{ accentColor: '#B45309', width: 13, height: 13 }} />
                Test Mode
              </label>
            )}
            {canConfig && <button className="od-btn" onClick={() => navigate('/people/expenses/config')}>Configure</button>}
            <button className="od-btn od-btn-primary" onClick={() => setShowAdd(true)}>+ Add Expense</button>
          </div>
        </div>

        {/* ── The card: total expense + spent vs budget for the selection ── */}
        <div className="exp-card" style={{ marginBottom: 16 }}>
          <div className="exp-card-top">
            <div>
              <div className="exp-card-label">Total expense · {EX.monthOptions(12).find(m => m.value === month)?.label}</div>
              <div className="exp-card-amount">{fmtMoney(card_total)}</div>
              <div className="exp-card-sub">
                {cardCount} {cardCount === 1 ? 'claim' : 'claims'}{cardLoc ? ` · ${cardLoc}` : ''}
              </div>
            </div>

            {isPriv ? (
              <select className="exp-card-select" value={fPerson}
                onChange={e => { setFPerson(e.target.value); setPage(0) }}>
                <option value="">All people</option>
                {/* only active (non-suspended) people toggled ON in the budget config */}
                {summary.filter(sm => sm.in_budget && !sm.suspended).map(sm => (
                  <option key={sm.profile_id} value={sm.profile_id}>{profiles[sm.profile_id]?.name || '—'}</option>
                ))}
              </select>
            ) : (
              cardLoc && <div className="exp-card-pill">{cardLoc}</div>
            )}
          </div>

          {/* Expense vs Budget — the two numbers that drive the decision */}
          <div className="exp-card-split">
            <div className="exp-card-stat">
              <div className="exp-card-ico"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg></div>
              <div>
                <div className="exp-card-stat-label">Expense</div>
                <div className="exp-card-stat-val">{fmtMoney(card.expense)}</div>
              </div>
            </div>
            <div className="exp-card-stat">
              <div className="exp-card-ico"><svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7" /></svg></div>
              <div>
                <div className="exp-card-stat-label">Budget</div>
                <div className="exp-card-stat-val">{card.budget > 0 ? fmtMoney(card.budget) : '—'}</div>
              </div>
            </div>
          </div>

          {/* Mileage budget consumption */}
          {card.budget > 0 && (
            <div className="exp-card-budget">
              <div className="exp-card-btrack">
                <div className="exp-card-bfill" style={{
                  width: Math.min(100, EX.pctUsed(card.budgetedSpent, card.budget)) + '%',
                  background: EX.isOver(card.budgetedSpent, card.budget) ? '#FCA5A5' : '#3DD9D6',
                }} />
              </div>
              <div className="exp-card-bfoot">
                <span>Mileage {fmtMoney(card.budgetedSpent)} / {fmtMoney(card.budget)}</span>
                <span>{EX.isOver(card.budgetedSpent, card.budget)
                  ? `${fmtMoney(-EX.remaining(card.budget, card.budgetedSpent))} over`
                  : `${fmtMoney(EX.remaining(card.budget, card.budgetedSpent))} left`}</span>
              </div>
            </div>
          )}

          {/* Payment decision */}
          <div className="exp-card-foot">
            <div className="exp-card-foot-l">
              <span className="exp-card-foot-label">Ready to pay</span>
              <span className="exp-card-foot-val">{fmtMoney(card.payable)}</span>
              {card.pending > 0 && <span className="exp-card-foot-mut">· {fmtMoney(card.pending)} awaiting approval</span>}
              {card.reimbursed > 0 && <span className="exp-card-foot-mut">· {fmtMoney(card.reimbursed)} paid</span>}
            </div>
            {card.payable > 0 && canPay && (
              <button className="exp-card-cta" onClick={() => { setFStatus('approved'); setPage(0) }}>
                Pay {fmtMoney(card.payable)}
              </button>
            )}
          </div>
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
          </div>

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
                      <th />
                      <th>Date</th>
                      <th className="num">Amount</th>
                      <th>Category</th>
                      {isPriv && !fPerson && <th>Person</th>}
                      <th>Paid via</th>
                      <th>Bills</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map(r => (
                      <tr key={r.id} className="exp-row" onClick={() => setOpenRow(r)}>
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
                        <td className="mut">{EX.PAYMENT_LABEL[r.payment_method] || r.payment_method}</td>
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

      {showAdd && <AddExpenseDrawer me={me} categories={categories} testMode={testMode} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />}
      {openRow && <ExpenseDrawer row={openRow} me={me} canApprove={canApprove} canPay={canPay}
        onClose={() => setOpenRow(null)}
        onDone={() => { setOpenRow(null); load() }}
        onDelete={() => { const r = openRow; setOpenRow(null); delExpense(r) }} />}
    </Layout>
  )
}
