import { useState, useEffect } from 'react'
import { sb, SUPABASE_URL } from '../lib/supabase'
import { fmt, fmtMoney } from '../lib/fmt'
import { summariseDues, buildDuesStatementHtml } from '../lib/duesStatement'
import { htmlToPdfBlob } from '../lib/htmlToPdf'
import Loading from '../components/Loading'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'

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
  const [results, setResults]   = useState({})       // customerId -> 'sent' | error text
  const [asOn, setAsOn]         = useState(null)    // statement date of the current dues run
  const [jobId, setJobId]       = useState(null)
  const [job, setJob]           = useState(null)    // live job row while a run is in flight
  const [itemStatus, setItemStatus] = useState({})  // customer_id -> 'sent' | 'failed' | 'skipped'

  useEffect(() => { load() }, [])

  // Watch the job while this window happens to be open. Closing it does not
  // stop anything — the server owns the run.
  useEffect(() => {
    if (!jobId) return
    let alive = true
    const tick = async () => {
      const [{ data }, { data: its }] = await Promise.all([
        sb.from('whatsapp_reminder_jobs').select('*').eq('id', jobId).maybeSingle(),
        sb.from('whatsapp_reminder_job_items').select('customer_id,status,error').eq('job_id', jobId).neq('status', 'pending'),
      ])
      if (!alive || !data) return
      setJob(data)
      if (its) setItemStatus(Object.fromEntries(its.map(i => [i.customer_id, i.status === 'sent' ? 'sent' : (i.error || i.status)])))
      if (['done', 'stopped', 'failed'].includes(data.status)) {
        setRunning(false)
        setDone({ sent: data.sent, failed: data.failed, stopped: data.status === 'stopped' })
        if (data.sent && !data.failed) toast(`${data.sent} payment reminder${data.sent > 1 ? 's' : ''} sent`, 'success')
        else if (data.sent) toast(`${data.sent} sent · ${data.failed} failed`, 'warning')
        else if (data.failed) toast(`All ${data.failed} failed to send`, 'error')
        if (onSent) onSent()
        return
      }
      if (alive) setTimeout(tick, 2500)
    }
    tick()
    return () => { alive = false }
  }, [jobId])

  // Pick up a run that is already going, started from another tab or session.
  useEffect(() => {
    sb.from('whatsapp_reminder_jobs').select('*').in('status', ['queued','running']).maybeSingle()
      .then(({ data }) => { if (data) { setJobId(data.id); setJob(data); setRunning(true) } })
  }, [])

  async function load() {
    setLoading(true)
    // One aggregated read (~200 rows) instead of every bill in the book. The
    // bill LINES are only needed to build a statement, so they are fetched for
    // one customer at a time during the run.
    const [{ data: queue }, { data: run }, { data: recent }] = await Promise.all([
      sb.from('whatsapp_reminder_queue').select('*').order('overdue', { ascending: false }),
      sb.from('customer_dues_runs').select('as_on').eq('is_current', true).maybeSingle(),
      sb.from('whatsapp_messages').select('customer_id,sent_at')
        .neq('status', 'failed')
        .gte('sent_at', new Date(Date.now() - 3 * 86400000).toISOString()),
    ])

    const sentRecently = new Map()
    ;(recent || []).forEach(m => { if (!sentRecently.has(m.customer_id)) sentRecently.set(m.customer_id, m.sent_at) })

    const out = (queue || []).map(q => ({
      customer: {
        id: q.customer_id, customer_name: q.customer_name, customer_id: q.code,
        account_owner: q.account_owner, whatsapp_no: q.whatsapp_no, whatsapp_name: q.whatsapp_name,
      },
      dues: {
        billCount: q.bill_count, outstanding: Number(q.outstanding) || 0,
        pdc: Number(q.pdc) || 0, overdue: Number(q.overdue) || 0, oldest: q.oldest || 0,
      },
      recentAt: sentRecently.get(q.customer_id) || null,
    }))

    setRows(out)
    setPicked(new Set(out.filter(r => !r.recentAt).map(r => r.customer.id)))
    setAsOn(run?.as_on || null)
    setLoading(false)
  }

  function toggle(id) {
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // The run happens on the server now. This starts it and then watches — the
  // browser can be closed the moment it is queued, which is the whole point.
  async function run() {
    const list = rows.filter(r => picked.has(r.customer.id))
    if (!list.length) return
    const totalOverdue = list.reduce((s, r) => s + r.dues.overdue, 0)
    if (!window.confirm(
      `Send WhatsApp payment reminders to ${list.length} customer${list.length > 1 ? 's' : ''}?\n\n` +
      `Total overdue: ${fmtMoney(totalOverdue)}\n` +
      `Statement as on ${fmt(asOn)}\n\n` +
      `Each customer receives their own statement PDF. This runs on the server — ` +
      `you can close this window once it starts.`)) return

    setRunning(true)
    try {
      const { data: { session } } = await sb.auth.getSession()
      const resp = await fetch(SUPABASE_URL + '/functions/v1/run-reminder-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ action: 'start', customer_ids: list.map(r => r.customer.id) }),
      })
      const out = await resp.json()
      if (!out.ok) { toast(out.error || 'Could not start the run.', 'error'); setRunning(false); return }
      if (out.already_running) toast('A run is already in progress.', 'warning')
      else toast(`Queued ${out.total} reminders — running in the background`, 'success')
      setJobId(out.job_id || out.job?.id || null)
      if (onSent) onSent()
    } catch (e) {
      toast(friendlyError(e, 'Could not start the run.'), 'error')
      setRunning(false)
    }
  }

  async function stopRun() {
    if (!window.confirm('Stop the run? Messages already sent cannot be recalled.')) return
    const { data: { session } } = await sb.auth.getSession()
    await fetch(SUPABASE_URL + '/functions/v1/run-reminder-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'stop' }),
    })
    toast('Stopping after the current message', 'warning')
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
                  const st = itemStatus[r.customer.id] || results[r.customer.id]
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
              <div className="rr-bar">
                <div style={{ width: `${(((job?.sent || 0) + (job?.failed || 0)) / Math.max(1, job?.total || 1)) * 100}%` }} />
              </div>
              <div className="rr-progress-label">
                Sending {(job?.sent || 0) + (job?.failed || 0)} of {job?.total || '…'}
                {job?.failed ? ` · ${job.failed} failed` : ''}
                {' — running on the server, you can close this window'}
              </div>
            </div>
          )}

          {done && (
            <div className={'rr-done' + (done.failed ? ' bad' : '')}>
              {done.sent} sent{done.failed ? ` · ${done.failed} failed` : ''}{done.stopped ? ' · stopped early' : ''}
            </div>
          )}

          <div className="rr-foot">
            {running ? (<>
              <button className="rr-btn" onClick={onClose}>Close (keeps running)</button>
              <button className="rr-btn" onClick={stopRun}>Stop run</button>
            </>
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
