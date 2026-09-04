import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM = 'SSC ERP <notifications@ssccontrol.com>'

// Resend caps at 10 requests/sec. Celebration/welcome dispatches insert many
// notifications at once → the webhook fires a burst of function calls → some get
// 429'd and silently dropped. Retry on 429 / 5xx with exponential backoff + jitter
// so bursts self-smooth. Each call sends one email, so this just spaces retries out.
async function resendSend(payload: unknown, attempts = 5): Promise<Response> {
  let res!: Response
  for (let i = 0; i < attempts; i++) {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.status !== 429 && res.status < 500) return res   // sent, or a permanent error — don't retry
    if (i < attempts - 1) {
      const backoff = 350 * Math.pow(2, i) + Math.floor(Math.random() * 300)  // ~0.35s,0.7s,1.4s,2.8s + jitter
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  return res
}
const APP_URL = 'https://app.ssccontrol.com'

serve(async (req) => {
  try {
    const { type, table, record } = await req.json()
    if (type !== 'INSERT') return new Response('ok')
    const sb = createClient(SB_URL, SB_KEY)
    if (table === 'notifications') return await handleNotification(sb, record)
    if (table === 'login_audit') return await handleLogin(sb, record)
    return new Response('ok')
  } catch (e) {
    return new Response('error: ' + (e as Error).message, { status: 200 })
  }
})

const PREF_MAP: Record<string, string> = {
  order_dispatched: 'status_changes', goods_issued: 'status_changes',
  order_delivered: 'status_changes', order_cancelled: 'status_changes',
  pi_issued: 'status_changes', pi_payment_confirmed: 'status_changes',
  proforma_issued: 'status_changes', eway_ready: 'status_changes',
  new_customer_approval: 'status_changes', credit_override: 'status_changes',
  po_linked_co_cancelled: 'status_changes',
  po_mention: 'mentions',
  mention: 'mentions',
  opportunity_won: 'crm_alerts', opportunity_lost: 'crm_alerts',
  overdue_followup: 'crm_alerts', assignment: 'crm_alerts',
}

const TYPE_CONFIG: Record<string, { emoji: string; color: string; bg: string; label: string }> = {
  order_dispatched:     { emoji: '🚚', color: '#1d4ed8', bg: '#eff6ff', label: 'Order Dispatched' },
  goods_issued:         { emoji: '📦', color: '#0d9488', bg: '#f0fdfa', label: 'Goods Issued' },
  order_delivered:      { emoji: '✅', color: '#15803d', bg: '#f0fdf4', label: 'Order Delivered' },
  order_cancelled:      { emoji: '❌', color: '#dc2626', bg: '#fef2f2', label: 'Order Cancelled' },
  pi_issued:            { emoji: '🧾', color: '#7c3aed', bg: '#f5f3ff', label: 'Invoice Generated' },
  proforma_issued:      { emoji: '🧾', color: '#7c3aed', bg: '#f5f3ff', label: 'Proforma Invoice Issued' },
  eway_ready:           { emoji: '🚚', color: '#1d4ed8', bg: '#eff6ff', label: 'E-Way Bill Ready' },
  pi_payment_confirmed: { emoji: '💰', color: '#15803d', bg: '#f0fdf4', label: 'Payment Confirmed' },
  new_customer_approval:{ emoji: '🏢', color: '#b45309', bg: '#fffbeb', label: 'Approval Required' },
  credit_override:      { emoji: '⚠️', color: '#dc2626', bg: '#fef2f2', label: 'Credit Override' },
  mention:              { emoji: '💬', color: '#1d4ed8', bg: '#eff6ff', label: 'You were mentioned' },
  po_linked_co_cancelled: { emoji: '⚠️', color: '#ea580c', bg: '#fff7ed', label: 'PO needs action — CO cancelled' },
  po_mention:           { emoji: '💬', color: '#1d4ed8', bg: '#eff6ff', label: 'You were tagged on a PO' },
  approval_request:     { emoji: '📋', color: '#b45309', bg: '#fffbeb', label: 'Approval needed' },
  approval_decision:    { emoji: '✅', color: '#15803d', bg: '#f0fdf4', label: 'Your request was decided' },
  opportunity_won:      { emoji: '🎉', color: '#15803d', bg: '#f0fdf4', label: 'Opportunity Won' },
  opportunity_lost:     { emoji: '📉', color: '#dc2626', bg: '#fef2f2', label: 'Opportunity Lost' },
  overdue_followup:     { emoji: '⏰', color: '#b45309', bg: '#fffbeb', label: 'Overdue Follow-Up' },
  assignment:           { emoji: '👤', color: '#1d4ed8', bg: '#eff6ff', label: 'New Assignment' },
  birthday_self:        { emoji: '🎂', color: '#db2777', bg: '#fdf2f8', label: 'Happy Birthday!' },
  birthday_team:        { emoji: '🎂', color: '#db2777', bg: '#fdf2f8', label: 'Team Birthday' },
  anniv_self:           { emoji: '🎉', color: '#7c3aed', bg: '#f5f3ff', label: 'Work Anniversary' },
  anniv_team:           { emoji: '🎉', color: '#7c3aed', bg: '#f5f3ff', label: 'Work Anniversary' },
}

const CELEBRATION_TYPES = ['birthday_self', 'birthday_team', 'anniv_self', 'anniv_team', 'welcome_self', 'welcome_team']

function subject(r: any): string {
  if (r.email_type === 'birthday_self') return 'Happy Birthday from Team SSC'
  if (r.email_type === 'birthday_team') return `It's ${r.from_name}'s birthday today`
  if (r.email_type === 'anniv_self')    return 'Happy Work Anniversary — Team SSC'
  if (r.email_type === 'anniv_team')    return `${r.from_name} celebrates a work anniversary`
  if (r.email_type === 'welcome_self')  return 'Welcome to SSC Control'
  if (r.email_type === 'welcome_team')  return `Please welcome ${r.from_name} to SSC`
  const t = r.email_type
  const on = r.order_number || ''
  const cfg = TYPE_CONFIG[t]
  // Leave / regularization approvals carry no order number, and the WHO + WHAT is the
  // point of the subject. Use the message's first sentence ("Leave request from X —
  // 05 Sep 2026 (1 day)") rather than the generic label or a mid-word truncation.
  if (t === 'approval_request' || t === 'approval_decision') {
    const head = (r.message || '').split(/\.\s|\s—\s(?=Reason)/)[0].trim().replace(/[.\s]+$/, '')
    return head ? `${cfg.label} — ${head}` : cfg.label
  }
  if (cfg && on) return `${cfg.label} — ${on}`
  if (cfg) return cfg.label
  // Last-resort subject: keep whole words so it never cuts mid-word.
  const snip = (r.message || '').slice(0, 60).replace(/\s+\S*$/, '')
  return on ? `[SSC] ${on} — ${snip}` : `[SSC] ${snip}`
}


// Plain-text part, sent alongside the HTML. Clients that prefer text (and
// anyone reading on a watch, a screen reader, or a stripped-down mail app) get
// something readable instead of a wall of markup. Adding a text part changes
// nothing visually for existing recipients — HTML clients still show the HTML.
function buildEmailText(recipientName: string, r: any, extra: any): string {
  const cfg = TYPE_CONFIG[r.email_type]
  const lines: string[] = []
  lines.push(`${greeting(recipientName)},`)
  lines.push('')
  if (cfg?.label) lines.push(cfg.label.toUpperCase())
  lines.push(r.message || '')
  lines.push('')
  if (r.order_number)  lines.push(`Order      : ${r.order_number}`)
  if (extra?.customer) lines.push(`Customer   : ${extra.customer}`)
  if (extra?.dc)       lines.push(`DC No.     : ${extra.dc}`)
  if (extra?.fc)       lines.push(`Fulfilment : ${extra.fc}`)
  if (r.from_name)     lines.push(`By         : ${r.from_name}`)
  if (r.created_at)    lines.push(`Time       : ${fmtTime(r.created_at)}`)

  const link = approvalLink(r) || (r.po_id ? `${APP_URL}/procurement/po/${r.po_id}`
             : r.order_id ? `${APP_URL}/orders/${r.order_id}` : null)
  if (link) { lines.push(''); lines.push(`Open in SSC ERP: ${link}`) }

  lines.push('')
  lines.push('—')
  lines.push('SSC Control Pvt. Ltd. · This is an automated message.')
  return lines.join('\n')
}

function fmtTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function greeting(name: string): string {
  const hour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()
  const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return `${g}, ${name.split(' ')[0]}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildCelebrationEmail(r: any): string {
  const isWelcome = r.email_type === 'welcome_self' || r.email_type === 'welcome_team'
  const isBday = r.email_type === 'birthday_self' || r.email_type === 'birthday_team'
  const isSelf = r.email_type === 'birthday_self' || r.email_type === 'anniv_self' || r.email_type === 'welcome_self'
  // No emoji anywhere in outbound mail (user rule 2026-09-04) — the colour band
  // below carries the tone instead.
  const grad = isWelcome
    ? 'linear-gradient(90deg,#0ea5e9 0%,#10b981 60%,#22c55e 100%)'
    : isBday
      ? 'linear-gradient(90deg,#ec4899 0%,#f97316 55%,#f59e0b 100%)'
      : 'linear-gradient(90deg,#2563eb 0%,#4f46e5 55%,#7c3aed 100%)'
  const heading = isWelcome
    ? (isSelf ? 'Welcome to SSC!' : 'A New Face at SSC')
    : isSelf
      ? (isBday ? 'Happy Birthday!' : 'Happy Work Anniversary!')
      : (isBday ? 'A Birthday at SSC' : 'A Work Anniversary at SSC')
  const paras = (r.message || '').split('\n').map((line: string) =>
    line.trim() === '' ? '' : `<p style="margin:0 0 12px;font-size:14.5px;color:#334155;line-height:1.75">${esc(line)}</p>`
  ).join('')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
      <td style="font-size:20px;font-weight:700;color:#1a4dab;letter-spacing:-0.5px;padding-left:4px">SSC ERP</td>
    </tr></table>
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:${grad};padding:30px 24px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#ffffff;margin-top:8px">${esc(heading)}</div>
      </div>
      <div style="padding:28px 30px 32px">${paras}</div>
    </div>
    <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:18px">SSC Control Pvt. Ltd.</div>
  </div>
</body></html>`
}

// Approval mail carries no order/PO id — send the reader to the page that holds the
// action instead of leaving the button off entirely.
function approvalLink(r: any): string {
  if (r.email_type !== 'approval_request' && r.email_type !== 'approval_decision') return ''
  return /regulariz/i.test(r.message || '')
    ? `${APP_URL}/people/attendance/regularize`
    : `${APP_URL}/people/attendance/leave`
}

function buildEmail(recipientName: string, r: any, extra: { customer?: string; dc?: string; fc?: string } = {}): string {
  if (CELEBRATION_TYPES.includes(r.email_type)) return buildCelebrationEmail(r)
  const cfg = TYPE_CONFIG[r.email_type] || { emoji: '🔔', color: '#1a4dab', bg: '#eff6ff', label: 'Notification' }
  const link = approvalLink(r)
    || ((r.email_type === 'po_linked_co_cancelled' || r.email_type === 'po_mention')
      ? (r.po_id ? `${APP_URL}/procurement/po/${r.po_id}` : '')
      : (r.order_id ? `${APP_URL}/orders/${r.order_id}` : ''))
  const time = fmtTime(r.created_at)

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px 32px">

    <!-- Logo header -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
      <td style="font-size:20px;font-weight:700;color:#1a4dab;letter-spacing:-0.5px;padding-left:4px">SSC ERP</td>
      <td style="text-align:right;font-size:11px;color:#94a3b8;padding-right:4px">${time}</td>
    </tr></table>

    <!-- Main card -->
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">

      <!-- Top accent bar -->
      <div style="height:4px;background:${cfg.color}"></div>

      <div style="padding:32px 28px 28px">

        <!-- Greeting -->
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:24px;line-height:1.3">
          ${esc(greeting(recipientName))},
        </div>

        <!-- Event pill -->
        <div style="margin-bottom:18px">
          <span style="display:inline-block;padding:6px 14px;border-radius:24px;font-size:12px;font-weight:600;color:${cfg.color};background:${cfg.bg}">
            ${cfg.label}
          </span>
        </div>

        <!-- Message -->
        <div style="font-size:14px;color:#334155;line-height:1.7;margin-bottom:20px">
          ${esc(r.message || '')}
        </div>

        <!-- Details card -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:24px">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569">
            ${r.order_number ? `<tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">Order</td>
              <td style="padding:4px 0;font-weight:700;color:#0f172a;font-family:'Courier New',monospace;font-size:12px">${esc(r.order_number)}</td>
            </tr>` : ''}
            ${extra.customer ? `<tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">Customer</td>
              <td style="padding:4px 0;font-weight:600;color:#0f172a">${esc(extra.customer)}</td>
            </tr>` : ''}
            ${extra.dc ? `<tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">DC No.</td>
              <td style="padding:4px 0;font-weight:600;color:#0f172a;font-family:'Courier New',monospace;font-size:12px">${esc(extra.dc)}</td>
            </tr>` : ''}
            ${extra.fc ? `<tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">FC</td>
              <td style="padding:4px 0;color:#0f172a">${esc(extra.fc)}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">By</td>
              <td style="padding:4px 0;color:#0f172a">${esc(r.from_name || 'System')}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px;vertical-align:top">Time</td>
              <td style="padding:4px 0;color:#475569">${time}</td>
            </tr>
          </table>
        </div>

        <!-- CTA -->
        ${link ? `
        <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#1a4dab">
          <a href="${link}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;font-family:'Segoe UI',sans-serif">
            View Details &nbsp;→
          </a>
        </td></tr></table>` : ''}

      </div>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:24px 0 0;font-size:11px;color:#94a3b8;line-height:1.8">
      <div style="margin-bottom:8px">
        <a href="${APP_URL}" style="color:#64748b;text-decoration:none;font-weight:600">Open SSC ERP</a>
      </div>
      SSC Control Pvt. Ltd.&nbsp;&nbsp;·&nbsp;&nbsp;Internal notification
    </div>

  </div>
</body></html>`
}

function buildSecurityAlert(adminName: string, userName: string, userEmail: string): string {
  const time = fmtTime(new Date().toISOString())

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px 32px">

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
      <td style="font-size:20px;font-weight:700;color:#dc2626;letter-spacing:-0.5px;padding-left:4px">SSC ERP</td>
      <td style="text-align:right;font-size:11px;color:#94a3b8;padding-right:4px">${time}</td>
    </tr></table>

    <div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="height:4px;background:#dc2626"></div>
      <div style="padding:32px 28px 28px">

        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:24px;line-height:1.3">
          ${esc(greeting(adminName))}
        </div>

        <div style="margin-bottom:18px">
          <span style="display:inline-block;padding:6px 14px;border-radius:24px;font-size:12px;font-weight:600;color:#dc2626;background:#fef2f2">
            Security Alert
          </span>
        </div>

        <div style="font-size:14px;color:#334155;line-height:1.7;margin-bottom:20px">
          <strong>${esc(userName)}</strong> has <strong>3 or more failed login attempts</strong> in the last 30 minutes. Please verify this activity.
        </div>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-left:3px solid #dc2626;border-radius:8px;padding:16px 18px;margin-bottom:20px">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569">
            <tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px">User</td>
              <td style="padding:4px 0;font-weight:700;color:#0f172a">${esc(userName)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px">Email</td>
              <td style="padding:4px 0;color:#0f172a">${esc(userEmail)}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;font-weight:600;color:#64748b;width:90px">Time</td>
              <td style="padding:4px 0;color:#475569">${time}</td>
            </tr>
          </table>
        </div>

        <div style="font-size:12px;color:#64748b;line-height:1.6">
          If this is unauthorized, consider resetting the user's password from the Supabase dashboard.
        </div>

      </div>
    </div>

    <div style="text-align:center;padding:24px 0 0;font-size:11px;color:#94a3b8;line-height:1.8">
      <div style="margin-bottom:8px">
        <a href="${APP_URL}" style="color:#64748b;text-decoration:none;font-weight:600">Open SSC ERP</a>
      </div>
      SSC Control Pvt. Ltd.&nbsp;&nbsp;·&nbsp;&nbsp;Security notification
    </div>

  </div>
</body></html>`
}

async function handleNotification(sb: any, r: any) {
  if (!r.email_type) return new Response('no email_type, skipped')

  // Bell-only notification types — never email (user policy: no email spam for
  // recurring operational nudges; unknown types otherwise fall through to send)
  const IN_APP_ONLY = ['sample_return_overdue', 'grn_credit_note']
  if (IN_APP_ONLY.includes(r.email_type)) return new Response('in-app only, skipped')

  // Bell-vs-email is now DATA. notification_rules.email_enabled = false means the
  // notification still appears in the app, but no mail is sent. That is how the
  // PO lifecycle works: the team sees every step in the bell, while only
  // placement and cancellations reach an inbox.
  //
  // Fails OPEN on purpose — if this lookup errors we still send, because losing
  // a notification silently is worse than one extra email. Only an explicit
  // `false` suppresses.
  try {
    const { data: rule } = await sb.from('notification_rules')
      .select('email_enabled').eq('event_key', r.email_type).maybeSingle()
    if (rule && rule.email_enabled === false) {
      await sb.from('email_log').insert({
        notification_id: r.id, recipient_email: '(bell only)',
        email_type: r.email_type, status: 'skipped',
      })
      return new Response('bell only, skipped')
    }
  } catch (err) {
    console.error('notification_rules lookup failed, sending anyway:', err)
  }

  const { data: profile } = await sb.from('profiles').select('username,email,name').eq('id', r.user_id).single()
  if (!profile?.username) return new Response('no profile')
  const email = profile.email || (profile.username + '@ssccontrol.com')
  const recipientName = profile.name || profile.username

  // Celebrations always send — they bypass the opt-out preferences.
  // Approvals do too: they are an ASK, not a status update. Without this they fall into
  // the 'status_changes' bucket, so anyone who muted status mail would silently stop
  // receiving leave/regularization requests waiting on them.
  const ALWAYS_SEND = [...CELEBRATION_TYPES, 'approval_request', 'approval_decision']
  if (!ALWAYS_SEND.includes(r.email_type)) {
    const prefKey = PREF_MAP[r.email_type] || 'status_changes'
    const { data: pref } = await sb.from('email_preferences').select(prefKey).eq('user_id', r.user_id).maybeSingle()
    if (pref && pref[prefKey] === false) {
      await sb.from('email_log').insert({ notification_id: r.id, recipient_email: email, email_type: r.email_type, status: 'skipped' })
      return new Response('opted out')
    }
  }

  // Fetch extra order details for order-related emails
  const extra: { customer?: string; dc?: string; fc?: string } = {}
  const ORDER_TYPES = ['order_dispatched','goods_issued','order_delivered','order_cancelled','pi_issued','pi_payment_confirmed','credit_override']
  if (r.order_id && ORDER_TYPES.includes(r.email_type)) {
    const { data: order } = await sb.from('orders').select('customer_name,fulfilment_center').eq('id', r.order_id).maybeSingle()
    if (order?.customer_name) extra.customer = order.customer_name
    if (order?.fulfilment_center) extra.fc = order.fulfilment_center
    // Get latest DC number for this order
    const { data: dispatch } = await sb.from('order_dispatches').select('dc_number').eq('order_id', r.order_id).not('dc_number', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (dispatch?.dc_number) extra.dc = dispatch.dc_number
  }

  try {
    // The text part must never be able to stop an email going out. It is
    // built inside its own try so a bug here degrades to HTML-only delivery
    // instead of silently killing every notification in the system.
    let textPart: string | undefined
    try { textPart = buildEmailText(recipientName, r, extra) }
    catch (err) { console.error('text part build failed:', err) }

    const res = await resendSend({ from: FROM, to: [email], subject: subject(r),
      html: buildEmail(recipientName, r, extra),
      ...(textPart ? { text: textPart } : {}) })
    const data = await res.json()

    try {
      await sb.from('email_log').insert({
        notification_id: r.id, recipient_email: email, email_type: r.email_type,
        resend_id: data.id || null, status: res.ok ? 'sent' : 'failed',
        error_message: res.ok ? null : JSON.stringify(data),
      })
    } catch (_) { /* log failure doesn't affect email delivery */ }

    return new Response(res.ok ? 'sent' : 'failed')
  } catch (e) {
    try {
      await sb.from('email_log').insert({
        notification_id: r.id, recipient_email: email, email_type: r.email_type,
        status: 'failed', error_message: (e as Error).message,
      })
    } catch (_) {}
    return new Response('email_failed_gracefully')
  }
}

function buildLoginEmail(userName: string, recipientName: string, loginTime: string, device: string): string {
  const time = fmtTime(loginTime)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,sans-serif;-webkit-font-smoothing:antialiased">
  <div style="max-width:560px;margin:0 auto;padding:40px 16px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px"><tr>
      <td style="font-size:20px;font-weight:700;color:#1a4dab;letter-spacing:-0.5px;padding-left:4px">SSC ERP</td>
      <td style="text-align:right;font-size:11px;color:#94a3b8;padding-right:4px">${time}</td>
    </tr></table>
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="height:4px;background:#1a4dab"></div>
      <div style="padding:32px 28px 28px">
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:24px;line-height:1.3">
          ${esc(greeting(recipientName))},
        </div>
        <div style="margin-bottom:18px">
          <span style="display:inline-block;padding:6px 14px;border-radius:24px;font-size:12px;font-weight:600;color:#1a4dab;background:#eff6ff">
            Welcome back
          </span>
        </div>
        <div style="font-size:14px;color:#334155;line-height:1.7;margin-bottom:20px">
          You just signed in to SSC ERP.
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:20px">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#475569">
            <tr><td style="padding:4px 0;font-weight:600;color:#64748b;width:80px">User</td><td style="padding:4px 0;font-weight:700;color:#0f172a">${esc(userName)}</td></tr>
            <tr><td style="padding:4px 0;font-weight:600;color:#64748b;width:80px">Time</td><td style="padding:4px 0;color:#0f172a">${time}</td></tr>
            <tr><td style="padding:4px 0;font-weight:600;color:#64748b;width:80px">Device</td><td style="padding:4px 0;color:#475569">${esc(device || 'Unknown')}</td></tr>
          </table>
        </div>
        <div style="font-size:12px;color:#94a3b8;line-height:1.6">
          If this wasn't you, please contact your admin immediately.
        </div>
      </div>
    </div>
    <div style="text-align:center;padding:24px 0 0;font-size:11px;color:#94a3b8;line-height:1.8">
      SSC Control Pvt. Ltd.&nbsp;&nbsp;·&nbsp;&nbsp;Login notification
    </div>
  </div>
</body></html>`
}

async function handleLogin(sb: any, r: any) {
  // Self-login email — each user gets their own "Welcome back" email
  if (r.event_type === 'login_success' && r.email) {
    try {
      const name = r.user_name || r.email.split('@')[0]
      const device = r.user_agent ? (r.user_agent.includes('Mobile') ? 'Mobile' : 'Desktop') : 'Unknown'
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM, to: [r.email],
          subject: `Welcome back, ${name.split(' ')[0]}`,
          html: buildLoginEmail(name, name, r.created_at || new Date().toISOString(), device),
        }),
      })
    } catch (_) { /* login must not be blocked by email failure */ }
  }

  if (r.event_type === 'login_failed') {
    const { count } = await sb.from('login_audit').select('id', { count: 'exact' })
      .eq('user_name', r.user_name).eq('event_type', 'login_failed')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    if ((count || 0) === 3) {
      const { data: admins } = await sb.from('profiles').select('username,email,name').eq('role', 'admin')
      const sentFailed = new Set<string>()
      for (const a of (admins || [])) {
        const email = a.email || (a.username + '@ssccontrol.com')
        if (sentFailed.has(email)) continue
        sentFailed.add(email)
        try {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM, to: [email],
              subject: `Failed Login Alert — ${r.user_name}`,
              html: buildSecurityAlert(a.name || a.username, r.user_name || '', r.email || ''),
            }),
          })
        } catch (_) { /* email failure must not block login flow */ }
      }
    }
  }
  return new Response('ok')
}
