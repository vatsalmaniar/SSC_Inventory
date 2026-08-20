import { useState, useEffect, useRef } from 'react'
import { sb, SUPABASE_URL } from '../lib/supabase'
import { fmt, fmtMoney } from '../lib/fmt'
import { summariseDues, buildDuesStatementHtml } from '../lib/duesStatement'
import { htmlToPdfBlob } from '../lib/htmlToPdf'
import { fetchAll } from '../lib/fetchAll'
import Loading from '../components/Loading'
import { toast } from '../lib/toast'

// Bulk WhatsApp payment reminders.
//
// Eligibility is deliberately narrow: the toggle is ON and the customer is
// actually overdue. Someone inside their credit terms has done nothing wrong
// and must not be chased.
//
// Sends run ONE AT A TIME with a pause between them. Not for Meta's sake — it
// would take far more — but because each statement is rendered to a PDF in this
// browser tab, and because a run that fails should fail after two messages, not
// after two hundred.
const GAP_MS = 900

export default function ReminderRunModal({ onClose, onSent }) {
  const [loading, setLoading]   = useState(true)
  const [rows, setRows]         = useState([])       // eligible customers + dues
  const [picked, setPicked]     = useState(() => new Set())
  const [running, setRunning]   = useState(false)
  const [done, setDone]         = useState(null)     // { sent, failed, skipped }
  const [progress, setProgress] = useState({ i: 0, n: 0, label: '' })
  const [results, setResults]   = useState({})       // customerId -> 'sent' | error text
  const [asOn, setAsOn]         = useState(null)    // statement date of the current dues run
  const abortRef = useRef(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // The eligible set and the amounts both come from the current dues run, the
    // same source the statement and the Edge Function use.
    const [{ data: custs }, bills, { data: run }, { data: recent }] = await Promise.all([
      sb.from('customers')
        .select('id,customer_name,customer_id,whatsapp_no,whatsapp_name,gst,credit_terms,poc_name,account_owner,billing_address')
        .eq('whatsapp_auto', true).not('whatsapp_no', 'is', null),
      fetchAll((from, to) => sb.from('customer_dues_bills')
        .select('customer_id,bill_date,bill_ref,pending_inr,pdc_inr,due_date,days_past_due,is_overdue')
        .not('customer_id', 'is', null).range(from, to)),
      sb.from('customer_dues_runs').select('as_on').eq('is_current', true).maybeSingle(),
      sb.from('whatsapp_messages').select('customer_id,sent_at,status')
        .neq('status', 'failed')
        .gte('sent_at', new Date(Date.now() - 3 * 86400000).toISOString()),
    ])

    const byCust = new Map()
    ;(bills || []).forEach(b => {
      if (!byCust.has(b.customer_id)) byCust.set(b.customer_id, [])
      byCust.get(b.customer_id).push(b)
    })
    const sentRecently = new Map()
    ;(recent || []).forEach(m => {
      if (!sentRecently.has(m.customer_id)) sentRecently.set(m.customer_id, m.sent_at)
    })

    const out = []
    ;(custs || []).forEach(c => {
      const bl = byCust.get(c.id) || []
      if (!bl.length) return
      const d = summariseDues(bl)
      if (d.overdue <= 0) return          // within terms — not a reminder candidate
      out.push({ customer: c, bills: bl, dues: d, recentAt: sentRecently.get(c.id) || null })
    })
    out.sort((a, b) => b.dues.overdue - a.dues.overdue)

    setRows(out)
    // Pre-tick everyone except those already reminded in the last 3 days.
    setPicked(new Set(out.filter(r => !r.recentAt).map(r => r.customer.id)))
    setAsOn(run?.as_on || null)
    setLoading(false)
  }

  function toggle(id) {
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function run() {
    const list = rows.filter(r => picked.has(r.customer.id))
    if (!list.length) return
    const totalOverdue = list.reduce((s, r) => s + r.dues.overdue, 0)
    if (!window.confirm(
      `Send WhatsApp payment reminders to ${list.length} customer${list.length > 1 ? 's' : ''}?\n\n` +
      `Total overdue: ${fmtMoney(totalOverdue)}\n` +
      `Statement as on ${fmt(asOn)}\n\n` +
      `Each customer receives their own statement PDF. This cannot be undone.`)) return

    setRunning(true); abortRef.current = false
    const res = {}
    let sent = 0, failed = 0
    for (let i = 0; i < list.length; i++) {
      if (abortRef.current) break
      const r = list[i]
      setProgress({ i: i + 1, n: list.length, label: r.customer.customer_name })
      try {
        const html = buildDuesStatementHtml({
          customer: r.customer, partyName: r.customer.customer_name,
          bills: r.bills, asOn,
        })
        const { blob } = await htmlToPdfBlob(html, 'Statement of Dues.pdf')
        if (!blob) throw new Error('Could not build the statement PDF')
        const b64 = await new Promise((ok, no) => {
          const fr = new FileReader()
          fr.onload = () => ok(String(fr.result).split(',')[1])
          fr.onerror = no
          fr.readAsDataURL(blob)
        })
        const { data: { session } } = await sb.auth.getSession()
        const resp = await fetch(SUPABASE_URL + '/functions/v1/send-whatsapp-statement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ customer_id: r.customer.id, pdf_base64: b64, force: true, source: 'bulk' }),
        })
        const out = await resp.json()
        if (out.ok) { res[r.customer.id] = 'sent'; sent++ }
        else { res[r.customer.id] = out.error || 'Failed'; failed++ }
      } catch (e) {
        res[r.customer.id] = e?.message || 'Failed'; failed++
      }
      setResults({ ...res })
      if (i < list.length - 1) await new Promise(t => setTimeout(t, GAP_MS))
    }
    setDone({ sent, failed, stopped: abortRef.current })
    setRunning(false)
    if (sent && !failed)      toast(`${sent} payment reminder${sent > 1 ? 's' : ''} sent on WhatsApp`, 'success')
    else if (sent && failed)  toast(`${sent} sent · ${failed} failed`, 'warning')
    else if (failed)          toast(`All ${failed} failed to send`, 'error')
    if (onSent) onSent()
  }

  const chosenCount = rows.filter(r => picked.has(r.customer.id)).length
  const chosenOverdueTop = rows.filter(r => picked.has(r.customer.id)).reduce((s, r) => s + r.dues.overdue, 0)
  const chosen = rows.filter(r => picked.has(r.customer.id))
  const chosenOverdue = chosen.reduce((s, r) => s + r.dues.overdue, 0)

  return (
    <div className="rr-backdrop" onClick={running ? undefined : onClose}>
      <div className="rr-modal" onClick={e => e.stopPropagation()}>
        <div className="rr-head">
          <div>
            <div className="rr-title">
              Send Payment Reminders
              {!loading && rows.length > 0 && (
                <span className="rr-count">{chosenCount} of {rows.length} selected · {fmtMoney(chosenOverdueTop)} overdue</span>
              )}
            </div>
            <div className="rr-sub">
              Customers with reminders switched on and an overdue balance
              {asOn ? ` · statement as on ${fmt(asOn)}` : ''}
            </div>
          </div>
          {!running && <button className="rr-x" onClick={onClose}>×</button>}
        </div>

        {loading ? <div style={{ padding: 40 }}><Loading /></div> : rows.length === 0 ? (
          <div className="rr-empty">
            No customer is currently eligible. A customer qualifies when the WhatsApp
            toggle is on, a number is on file, and they have an overdue balance.
          </div>
        ) : (<>
          <div className="rr-summary">
            <span><strong>{chosen.length}</strong> of {rows.length} selected</span>
            <span>Overdue: <strong>{fmtMoney(chosenOverdue)}</strong></span>
            {!running && !done && (
              <span className="rr-links">
                <button onClick={() => setPicked(new Set(rows.map(r => r.customer.id)))}>Select all</button>
                <button onClick={() => setPicked(new Set())}>Clear</button>
              </span>
            )}
          </div>

          <div className="rr-scroll">
            <table className="rr-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Customer</th>
                  <th>WhatsApp</th>
                  <th style={{ textAlign: 'right' }}>Overdue</th>
                  <th style={{ textAlign: 'center' }}>Oldest</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const st = results[r.customer.id]
                  return (
                    <tr key={r.customer.id} className={st === 'sent' ? 'ok' : st ? 'bad' : ''}>
                      <td>
                        <input type="checkbox" disabled={running || !!done}
                          checked={picked.has(r.customer.id)}
                          onChange={() => toggle(r.customer.id)} />
                      </td>
                      <td>
                        <div className="rr-name">{r.customer.customer_name}</div>
                        <div className="rr-code">{r.customer.customer_id}{r.customer.account_owner ? ' · ' + r.customer.account_owner : ''}</div>
                      </td>
                      <td className="rr-mono">
                        {r.customer.whatsapp_no}
                        {r.customer.whatsapp_name ? <div className="rr-code">{r.customer.whatsapp_name}</div> : null}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: '#b91c1c' }}>{fmtMoney(r.dues.overdue)}</td>
                      <td style={{ textAlign: 'center' }}>{r.dues.oldest}d</td>
                      <td>
                        {st === 'sent' ? <span className="rr-ok">Sent</span>
                          : st ? <span className="rr-bad" title={st}>{st}</span>
                          : r.recentAt ? <span className="rr-warn">Sent {fmt(r.recentAt)}</span>
                          : <span className="rr-code">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {running && (
            <div className="rr-progress">
              <div className="rr-bar"><div style={{ width: `${(progress.i / Math.max(1, progress.n)) * 100}%` }} /></div>
              <div className="rr-progress-label">
                Sending {progress.i} of {progress.n} — {progress.label}
              </div>
            </div>
          )}

          {done && (
            <div className={'rr-done' + (done.failed ? ' bad' : '')}>
              {done.sent} sent{done.failed ? ` · ${done.failed} failed` : ''}{done.stopped ? ' · stopped early' : ''}
            </div>
          )}

          <div className="rr-foot">
            {running ? (
              <button className="rr-btn" onClick={() => { abortRef.current = true }}>Stop after current</button>
            ) : done ? (
              <button className="rr-btn rr-primary" onClick={onClose}>Close</button>
            ) : (<>
              <button className="rr-btn" onClick={onClose}>Cancel</button>
              <button className="rr-btn rr-primary" disabled={!chosen.length} onClick={run}>
                Send to {chosen.length} customer{chosen.length === 1 ? '' : 's'}
              </button>
            </>)}
          </div>
        </>)}
      </div>
    </div>
  )
}
