import { useState, useEffect } from 'react'
import { sb } from '../lib/supabase'
import { fmtDateTime, fmtMoney } from '../lib/fmt'
import Loading from '../components/Loading'

// Every WhatsApp message and reply, across all customers, a week at a time.
//
// Payment statements and dispatch invoices are different things and are tagged
// as such: a delivery notice has no overdue figure, and nobody sends one by
// hand — they fire when FC marks a delivery.

const DAY = 86400000
const STATUS_COLOR = { sent:'#1d4ed8', delivered:'#047857', read:'#047857', failed:'#b91c1c', queued:'#b45309' }

/** Monday 00:00 of the week containing d, in local time. */
function weekStart(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const fmtDay = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

export default function MessageLogModal({ onClose }) {
  const [offset, setOffset]   = useState(0)      // 0 = this week, -1 = last week
  const [loading, setLoading] = useState(true)
  const [rows, setRows]       = useState([])
  const [kind, setKind]       = useState('all')  // all | statement | dispatch | reply

  const from = new Date(weekStart(new Date()).getTime() + offset * 7 * DAY)
  const to   = new Date(from.getTime() + 7 * DAY)

  useEffect(() => { load() }, [offset])

  async function load() {
    setLoading(true)
    const [{ data: msgs }, { data: reps }] = await Promise.all([
      sb.from('whatsapp_messages')
        .select('id,kind,sent_at,status,to_name,to_number,overdue_inr,error_message,source,customers(customer_name,customer_id,account_owner)')
        .gte('sent_at', from.toISOString()).lt('sent_at', to.toISOString())
        .order('sent_at', { ascending: false }),
      sb.from('whatsapp_replies')
        .select('id,body,from_number,received_at,customers(customer_name,customer_id,account_owner)')
        .gte('received_at', from.toISOString()).lt('received_at', to.toISOString())
        .order('received_at', { ascending: false }),
    ])
    const feed = [
      ...(msgs || []).map(m => ({ t: m.sent_at, dir: 'out', m })),
      ...(reps || []).map(r => ({ t: r.received_at, dir: 'in', r })),
    ].sort((a, b) => String(b.t).localeCompare(String(a.t)))
    setRows(feed)
    setLoading(false)
  }

  const shown = rows.filter(f =>
    kind === 'all' ? true
    : kind === 'reply' ? f.dir === 'in'
    : f.dir === 'out' && f.m.kind === kind)

  const sent      = rows.filter(f => f.dir === 'out').length
  const statements= rows.filter(f => f.dir === 'out' && f.m.kind === 'statement').length
  const dispatches= rows.filter(f => f.dir === 'out' && f.m.kind === 'dispatch').length
  const read      = rows.filter(f => f.dir === 'out' && f.m.status === 'read').length
  const failed    = rows.filter(f => f.dir === 'out' && f.m.status === 'failed').length
  const replies   = rows.filter(f => f.dir === 'in').length

  const cust = f => (f.dir === 'in' ? f.r.customers : f.m.customers) || {}

  return (
    <div className="rr-backdrop" onClick={onClose}>
      <div className="rr-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 1040 }}>
        <div className="rr-head">
          <div>
            <div className="rr-title">WhatsApp Message Log</div>
            <div className="rr-sub">{fmtDay(from)} – {fmtDay(new Date(to.getTime() - DAY))}
              {offset === 0 ? ' · this week' : offset === -1 ? ' · last week' : ''}</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <button className="rr-btn" onClick={() => setOffset(o => o - 1)}>‹ Earlier</button>
            <button className="rr-btn" disabled={offset >= 0} onClick={() => setOffset(o => o + 1)}>Later ›</button>
            <button className="rr-x" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="rr-summary">
          <span><strong>{sent}</strong> sent</span>
          <span><strong>{read}</strong> read</span>
          {failed > 0 && <span style={{ color:'#b91c1c' }}><strong>{failed}</strong> failed</span>}
          <span><strong>{replies}</strong> replies</span>
          <span className="rr-links">
            {[['all', `All ${rows.length}`], ['statement', `Payment ${statements}`],
              ['dispatch', `Dispatch ${dispatches}`], ['reply', `Replies ${replies}`]].map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)}
                style={{ fontWeight: kind === k ? 700 : 600, textDecoration: kind === k ? 'underline' : 'none' }}>
                {label}
              </button>
            ))}
          </span>
        </div>

        <div className="rr-scroll">
          {loading ? <div style={{ padding: 40 }}><Loading /></div>
            : shown.length === 0 ? <div className="rr-empty">Nothing in this week.</div> : (
            <table className="rr-table">
              <thead><tr>
                <th style={{ width: 130 }}>When</th>
                <th>Customer</th>
                <th style={{ width: 92 }}>Type</th>
                <th style={{ width: 150 }}>Status</th>
                <th style={{ textAlign:'right', width: 130 }}>Overdue</th>
              </tr></thead>
              <tbody>
                {shown.map(f => f.dir === 'in' ? (
                  <tr key={'r' + f.r.id}>
                    <td style={{ whiteSpace:'nowrap', color:'var(--gray-500)' }}>{fmtDateTime(f.r.received_at)}</td>
                    <td>
                      <div className="rr-name">{cust(f).customer_name || f.r.from_number}</div>
                      <div className="rr-code">{cust(f).account_owner || '—'}</div>
                    </td>
                    <td><span className="c360-wa-tag" style={{ background:'#f0fdf4', color:'#15803d' }}>Reply</span></td>
                    <td colSpan={2} style={{ color:'var(--gray-800)', whiteSpace:'pre-wrap' }}>{f.r.body}</td>
                  </tr>
                ) : (
                  <tr key={'m' + f.m.id}>
                    <td style={{ whiteSpace:'nowrap', color:'var(--gray-500)' }}>{fmtDateTime(f.m.sent_at)}</td>
                    <td>
                      <div className="rr-name">{cust(f).customer_name || f.m.to_number}</div>
                      <div className="rr-code">{cust(f).account_owner || '—'}{f.m.to_name ? ' · ' + f.m.to_name : ''}</div>
                    </td>
                    <td>
                      <span className={'c360-wa-tag ' + (f.m.kind === 'dispatch' ? 'disp' : 'pay')}>
                        {f.m.kind === 'dispatch' ? 'Dispatch' : 'Payment'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontWeight:600, color: STATUS_COLOR[f.m.status] || 'var(--gray-500)' }}>{f.m.status}</span>
                      <div className="rr-code">
                        {f.m.kind === 'dispatch' ? 'on delivery' : f.m.source === 'bulk' ? 'scheduled run' : 'sent by hand'}
                      </div>
                      {f.m.error_message && <div style={{ color:'#b91c1c', fontSize:11 }}>{f.m.error_message}</div>}
                    </td>
                    <td style={{ textAlign:'right', fontWeight:600 }}>
                      {f.m.kind === 'statement' && f.m.overdue_inr > 0 ? fmtMoney(f.m.overdue_inr) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rr-foot"><button className="rr-btn rr-primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
