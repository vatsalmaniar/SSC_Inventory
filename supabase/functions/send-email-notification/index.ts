import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM = 'SSC ERP <notifications@ssccontrol.com>'
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
  new_customer_approval: 'status_changes', credit_override: 'status_changes',
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
  pi_payment_confirmed: { emoji: '💰', color: '#15803d', bg: '#f0fdf4', label: 'Payment Confirmed' },
  new_customer_approval:{ emoji: '🏢', color: '#b45309', bg: '#fffbeb', label: 'Approval Required' },
  credit_override:      { emoji: '⚠️', color: '#dc2626', bg: '#fef2f2', label: 'Credit Override' },
  mention:              { emoji: '💬', color: '#1d4ed8', bg: '#eff6ff', label: 'You were mentioned' },
  opportunity_won:      { emoji: '🎉', color: '#15803d', bg: '#f0fdf4', label: 'Opportunity Won' },
  opportunity_lost:     { emoji: '📉', color: '#dc2626', bg: '#fef2f2', label: 'Opportunity Lost' },
  overdue_followup:     { emoji: '⏰', color: '#b45309', bg: '#fffbeb', label: 'Overdue Follow-Up' },
  assignment:           { emoji: '👤', color: '#1d4ed8', bg: '#eff6ff', label: 'New Assignment' },
}

function subject(r: any): string {
  const t = r.email_type
  const on = r.order_number || ''
  const cfg = TYPE_CONFIG[t]
  if (cfg && on) return `${cfg.emoji} ${cfg.label} — ${on}`
  if (cfg) return `${cfg.emoji} ${cfg.label}`
  return `[SSC] ${on} — ${(r.message || '').slice(0, 60)}`
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

function buildEmail(recipientName: string, r: any, extra: { customer?: string; dc?: string; fc?: string } = {}): string {
  const cfg = TYPE_CONFIG[r.email_type] || { emoji: '🔔', color: '#1a4dab', bg: '#eff6ff', label: 'Notification' }
  const link = r.order_id ? `${APP_URL}/orders/${r.order_id}` : ''
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
          ${esc(greeting(recipientName))} 👋
        </div>

        <!-- Event pill -->
        <div style="margin-bottom:18px">
          <span style="display:inline-block;padding:6px 14px;border-radius:24px;font-size:12px;font-weight:600;color:${cfg.color};background:${cfg.bg}">
            ${cfg.emoji}&nbsp;&nbsp;${cfg.label}
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
            🚨&nbsp;&nbsp;Security Alert
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

  // Skip high-volume email types to stay within Resend free tier (100/day)
  const SKIP_TYPES = ['opportunity_won', 'opportunity_lost']
  if (SKIP_TYPES.includes(r.email_type)) return new Response('skipped: volume optimization')

  const { data: profile } = await sb.from('profiles').select('username,email,name').eq('id', r.user_id).single()
  if (!profile?.username) return new Response('no profile')
  const email = profile.email || (profile.username + '@ssccontrol.com')
  const recipientName = profile.name || profile.username

  const prefKey = PREF_MAP[r.email_type] || 'status_changes'
  const { data: pref } = await sb.from('email_preferences').select(prefKey).eq('user_id', r.user_id).maybeSingle()
  if (pref && pref[prefKey] === false) {
    await sb.from('email_log').insert({ notification_id: r.id, recipient_email: email, email_type: r.email_type, status: 'skipped' })
    return new Response('opted out')
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject: subject(r), html: buildEmail(recipientName, r, extra) }),
  })
  const data = await res.json()

  await sb.from('email_log').insert({
    notification_id: r.id, recipient_email: email, email_type: r.email_type,
    resend_id: data.id || null, status: res.ok ? 'sent' : 'failed',
    error_message: res.ok ? null : JSON.stringify(data),
  })

  return new Response(res.ok ? 'sent' : 'failed')
}

async function handleLogin(sb: any, r: any) {
  // Self-login emails removed to stay within Resend free tier (100/day)

  if (r.event_type === 'login_failed') {
    const { count } = await sb.from('login_audit').select('id', { count: 'exact' })
      .eq('user_name', r.user_name).eq('event_type', 'login_failed')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    if ((count || 0) >= 3) {
      const { data: admins } = await sb.from('profiles').select('username,email,name').eq('role', 'admin')
      const sentFailed = new Set<string>()
      for (const a of (admins || [])) {
        const email = a.email || (a.username + '@ssccontrol.com')
        if (sentFailed.has(email)) continue
        sentFailed.add(email)
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: [email],
            subject: `🚨 Failed Login Alert — ${r.user_name}`,
            html: buildSecurityAlert(a.name || a.username, r.user_name || '', r.email || ''),
          }),
        })
      }
    }
  }
  return new Response('ok')
}
