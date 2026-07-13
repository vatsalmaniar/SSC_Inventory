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
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_mileage ? ' · mileage' : ''}</option>)}
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

/* ══ Review — drawer. Approve AND Reject both live in here, so the list
      row stays clean (one "Review" button instead of a wall of buttons). ══ */
function ReviewDrawer({ row, level, bills, onClose, onDone }) {
  const [approvedAmount, setApprovedAmount] = useState(String(row.amount))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const guard = useRef(false)
  const isFinal = level === 'l2'

  async function go(decision) {
    if (guard.current) return
    if (decision === 'reject' && !note.trim()) { toast('A reason is required to reject.', 'error'); return }
    if (decision === 'approve' && isFinal) {
      const a = Number(approvedAmount)
      if (isNaN(a) || a < 0 || a > row.amount) { toast('Approved amount must be between 0 and the bill amount.', 'error'); return }
    }
    guard.current = true; setSaving(true)
    try {
      const { error } = await sb.rpc('expense_review', {
        p_id: row.id, p_decision: decision,
        p_approved_amount: decision === 'approve' && isFinal ? Number(approvedAmount) : null,
        p_note: note.trim() || null,
      })
      if (error) throw error
      toast(decision === 'reject' ? 'Expense rejected.'
        : isFinal ? 'Expense approved.' : 'Passed to Admin for final approval.', 'success')
      onDone()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false; setSaving(false) }
  }

  return (
    <div className="od-drawer-scrim" onClick={onClose}>
      <div className="od-drawer" style={{ width: 'min(480px,95vw)' }} onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div>
            <div className="od-drawer-eyebrow">{isFinal ? 'Final approval · Admin' : 'Approval · Management'}</div>
            <div className="od-drawer-title">Review expense</div>
            <div className="od-drawer-sub">{isFinal ? 'Approving pays out the approved amount.' : 'Approving sends it to Admin for sign-off.'}</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="od-drawer-body">
          <div className="exp-modal-ctx" style={{ marginBottom: 15 }}>
            {row._person} · {row._cat}{row.vendor ? ` · ${row.vendor}` : ''} · <b>{fmtMoney(row.amount)}</b> · {fmt(row.expense_date)}
          </div>
          {(bills || []).length > 0 && (
            <div className="exp-field" style={{ marginBottom: 15 }}>
              <label className="exp-label">Bills</label>
              <div className="exp-bills">
                {bills.map((b, i) => (
                  <button key={b.id} className="exp-bill" onClick={() => b.open(b.file_path)} title={b.filename}>{I.clip}{b.filename || `Bill ${i + 1}`}</button>
                ))}
              </div>
            </div>
          )}
          {isFinal && (
            <div className="exp-field" style={{ marginBottom: 15 }}>
              <label className="exp-label">Approved amount ₹</label>
              <input className="exp-input" type="number" min="0" max={row.amount} value={approvedAmount} onChange={e => setApprovedAmount(e.target.value)} />
              <div className="exp-err" style={{ color: '#94A3B8' }}>Defaults to the bill amount — lower it to part-approve.</div>
            </div>
          )}
          <div className="exp-field">
            <label className="exp-label">Note <span className="hint">required to reject</span></label>
            <textarea className="exp-textarea" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Reason / remarks" />
          </div>
        </div>
        <div className="od-drawer-foot" style={{ justifyContent: 'space-between' }}>
          <button className="od-btn od-btn-danger" onClick={() => go('reject')} disabled={saving}>Reject</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="od-btn" onClick={onClose}>Cancel</button>
            <button className="od-btn od-btn-approve" onClick={() => go('approve')} disabled={saving}>
              {saving ? '…' : isFinal ? 'Approve & pay out' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ══ Pay Now — drawer ═════════════════════════════════════════════ */
function PayDrawer({ row, onClose, onDone }) {
  const [txn, setTxn] = useState('')
  const [saving, setSaving] = useState(false)
  const guard = useRef(false)
  async function go() {
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
      <div className="od-drawer" style={{ width: 'min(420px,95vw)' }} onClick={e => e.stopPropagation()}>
        <div className="od-drawer-head">
          <div>
            <div className="od-drawer-eyebrow">Reimbursement</div>
            <div className="od-drawer-title">Pay Now</div>
          </div>
          <button className="od-drawer-close" onClick={onClose}>×</button>
        </div>
        <div className="od-drawer-body">
          <div className="exp-modal-ctx" style={{ marginBottom: 15 }}>{row._person} · paying <b>{fmtMoney(row.approved_amount ?? row.amount)}</b></div>
          <div className="exp-field">
            <label className="exp-label">Transaction No.<span className="req">*</span></label>
            <input className="exp-input" value={txn} onChange={e => setTxn(e.target.value)} placeholder="UTR / txn reference" autoFocus />
          </div>
        </div>
        <div className="od-drawer-foot">
          <button className="od-btn" onClick={onClose}>Cancel</button>
          <button className="od-btn od-btn-pay" onClick={go} disabled={saving}>{saving ? '…' : 'Mark Reimbursed'}</button>
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
  const [review, setReview] = useState(null)
  const [pay, setPay] = useState(null)

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
        .select('*, expense_categories(name,color,is_mileage,gl_code), expense_bills(id,file_path,filename)')
        .eq('month_start', month).eq('is_test', testMode)
        .order('expense_date', { ascending: false }).order('id', { ascending: false })
        .range(from, to))
      if (error) throw error
      setRows((data || []).map(r => ({
        ...r,
        _cat: r.expense_categories?.name || '—',
        _catColor: r.expense_categories?.color,
        _mileage: !!r.expense_categories?.is_mileage,
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
      t.approved += Number(s.mileage_approved) + Number(s.general_approved)
      t.pending += Number(s.mileage_pending) + Number(s.general_pending)
      t.payable += Number(s.payable); t.reimbursed += Number(s.reimbursed)
      if (EX.isOver(s.mileage_approved, s.mileage_budget)) t.over++
    })
    return t
  }, [summary])

  // Hero: team view for admin/mgmt/accounts, personal otherwise
  const hero = isPriv
    ? { label: 'Team spend this month', amount: totals.approved, pending: totals.pending, payable: totals.payable, reimbursed: totals.reimbursed }
    : {
      label: 'Your spend this month',
      amount: Number(mySum?.mileage_approved || 0) + Number(mySum?.general_approved || 0),
      pending: Number(mySum?.mileage_pending || 0) + Number(mySum?.general_pending || 0),
      payable: Number(mySum?.payable || 0), reimbursed: Number(mySum?.reimbursed || 0),
    }
  const showBudget = !isPriv && mySum && Number(mySum.mileage_budget) > 0

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

  // One action per row. Approve/Reject both live inside the Review drawer,
  // so the list never turns into a wall of buttons.
  function actions(r) {
    const a = []
    if (r.status === 'pending' && canApprove) {
      a.push(<button key="v" className="od-btn od-btn-primary" onClick={() => setReview({ row: r, level: 'l1' })}>Review</button>)
    }
    if (r.status === 'mgmt_approved' && me.role === 'admin') {
      a.push(<button key="v" className="od-btn od-btn-primary" onClick={() => setReview({ row: r, level: 'l2' })}>Review</button>)
    }
    if (r.status === 'approved' && canPay) {
      a.push(<button key="p" className="od-btn od-btn-pay" onClick={() => setPay(r)}>Pay Now</button>)
    }
    if (r.profile_id === me.id && r.status === 'pending') {
      a.push(<button key="d" className="od-btn exp-icon-btn" title="Delete claim" onClick={() => delExpense(r)}>
        <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
      </button>)
    }
    return a
  }

  if (!me || loading) return <Layout pageKey="people"><div style={{ padding: 60, textAlign: 'center', color: '#94A3B8' }}>Loading…</div></Layout>

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
            {me.role === 'admin' && (
              <label className={`o-test-toggle ${testMode ? 'on' : ''}`}>
                <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} style={{ accentColor: '#B45309', width: 13, height: 13 }} />
                Test Mode
              </label>
            )}
            {canConfig && <button className="od-btn" onClick={() => navigate('/people/expenses/config')}>Configure</button>}
            <button className="od-btn od-btn-primary" onClick={() => setShowAdd(true)}>+ Add Expense</button>
          </div>
        </div>

        {/* ── Hero ── */}
        <div className="exp-hero" style={{ marginBottom: 16 }}>
          <div className="exp-hero-top">
            <div>
              <div className="exp-hero-label">{hero.label}</div>
              <div className="exp-hero-amount">{fmtMoney(hero.amount)}</div>
              <div className="exp-hero-sub">approved &amp; payable this month</div>
            </div>
            {!isPriv && me.location && <div className="exp-hero-loc">{me.location}</div>}
            {isPriv && totals.over > 0 && <div className="exp-hero-loc">{totals.over} over mileage</div>}
          </div>

          <div className="exp-hero-split">
            <div className="exp-hero-stat">
              <div className="exp-hero-ico">{I.clock}</div>
              <div><div className="exp-hero-stat-label">Pending</div><div className="exp-hero-stat-val">{fmtMoney(hero.pending)}</div></div>
            </div>
            <div className="exp-hero-stat">
              <div className="exp-hero-ico">{I.up}</div>
              <div><div className="exp-hero-stat-label">Payable</div><div className="exp-hero-stat-val">{fmtMoney(hero.payable)}</div></div>
            </div>
            <div className="exp-hero-stat">
              <div className="exp-hero-ico">{I.check}</div>
              <div><div className="exp-hero-stat-label">Reimbursed</div><div className="exp-hero-stat-val">{fmtMoney(hero.reimbursed)}</div></div>
            </div>
          </div>

          {showBudget && (
            <div className="exp-hero-budget">
              <div className="exp-hero-bhead">
                <span>Mileage budget</span>
                <span>{fmtMoney(mySum.mileage_approved)} / {fmtMoney(mySum.mileage_budget)}</span>
              </div>
              <div className="exp-hero-btrack">
                <div className="exp-hero-bfill" style={{
                  width: Math.min(100, EX.pctUsed(mySum.mileage_approved, mySum.mileage_budget)) + '%',
                  background: EX.isOver(mySum.mileage_approved, mySum.mileage_budget) ? '#FCA5A5' : '#3DD9D6',
                }} />
              </div>
              <div className="exp-hero-bfoot">
                <span>{EX.pctUsed(mySum.mileage_approved, mySum.mileage_budget)}% used</span>
                <span>{EX.isOver(mySum.mileage_approved, mySum.mileage_budget)
                  ? `${fmtMoney(-EX.remaining(mySum.mileage_budget, mySum.mileage_approved))} over`
                  : `${fmtMoney(EX.remaining(mySum.mileage_budget, mySum.mileage_approved))} left`}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Filters ── */}
        {isPriv && (
          <div className="exp-filters">
            <select className="exp-select" value={fPerson} onChange={e => { setFPerson(e.target.value); setPage(0) }}>
              <option value="">All people</option>
              {[...new Set(list.map(r => r.profile_id))].map(id => <option key={id} value={id}>{profiles[id]?.name || id}</option>)}
            </select>
            <select className="exp-select" value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(0) }}>
              <option value="">All statuses</option>
              {Object.keys(EX.STATUS_META).map(s => <option key={s} value={s}>{EX.STATUS_META[s].label}</option>)}
            </select>
            <select className="exp-select" value={fCat} onChange={e => { setFCat(e.target.value); setPage(0) }}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="exp-spacer" />
            <button className="od-btn" onClick={exportXls}>Export Excel</button>
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

          {filtered.length === 0 ? (
            <div className="exp-empty">
              <svg fill="none" stroke="#CBD5E1" strokeWidth="1.5" viewBox="0 0 24 24" style={{ width: 34, height: 34 }}>
                <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
              </svg>
              <div className="exp-empty-title">No expenses this month</div>
              <div className="exp-empty-sub">Claims you submit will appear here.</div>
            </div>
          ) : (
            <>
              <div className="exp-txns">
                {paged.map(r => (
                  <div key={r.id} className="exp-txn">
                    <ExpenseIcon name={r._cat} color={r._catColor} />
                    <div className="exp-txn-main">
                      <div className="exp-txn-name">
                        {r._cat}
                        {r.vendor && <span className="exp-vendor">{r.vendor}</span>}
                        {r._mileage && <span className="exp-flag">MILEAGE</span>}
                      </div>
                      <div className="exp-txn-sub">
                        <span>{fmt(r.expense_date)}</span>
                        {isPriv && <><span className="exp-txn-sep">·</span><span>{profiles[r.profile_id]?.name || '—'}</span></>}
                        <span className="exp-txn-sep">·</span>
                        <span>{EX.PAYMENT_LABEL[r.payment_method] || r.payment_method}</span>
                        {(r.expense_bills || []).length > 0 && (
                          <>
                            <span className="exp-txn-sep">·</span>
                            {(r.expense_bills || []).map((b, i) => (
                              <button key={b.id} className="exp-bill" title={b.filename} onClick={() => viewBill(b.file_path)}>{I.clip}{i + 1}</button>
                            ))}
                          </>
                        )}
                      </div>
                      {r.status === 'rejected' && r.review_note && <div className="exp-note" title={r.review_note}>{r.review_note}</div>}
                    </div>
                    <div className="exp-txn-right">
                      <div className={'exp-txn-amt' + (r.status === 'reimbursed' ? ' paid' : '')}>
                        {fmtMoney(r.approved_amount ?? r.amount)}
                        {r.approved_amount != null && Number(r.approved_amount) !== Number(r.amount) && <span className="exp-strike">{fmtMoney(r.amount)}</span>}
                      </div>
                      <StatusChip status={r.status} txn={r.payment_ref} />
                    </div>
                    <div className="exp-txn-acts">{actions(r)}</div>
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

      {showAdd && <AddExpenseDrawer me={me} categories={categories} testMode={testMode} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />}
      {review && <ReviewDrawer row={review.row} level={review.level}
        bills={(review.row.expense_bills || []).map(b => ({ ...b, open: viewBill }))}
        onClose={() => setReview(null)} onDone={() => { setReview(null); load() }} />}
      {pay && <PayDrawer row={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); load() }} />}
    </Layout>
  )
}
