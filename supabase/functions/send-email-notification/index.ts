import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM = 'SSC Control <notifications@ssccontrol.com>'
const APP_URL = 'https://ssc-inventory.vercel.app'

serve(async (req) => {
  try {
    const { type, table, record } = await req.json()
    if (type !== 'INSERT') return new Response('ok')

    const sb = createClient(SB_URL, SB_KEY)

    if (table === 'notifications') return await handleNotification(sb, record)
    if (table === 'login_audit') return await handleLogin(sb, record)
    return new Response('ok')
  } catch (e) {
    // Always 200 to prevent webhook retry storm
    return new Response('error: ' + (e as Error).message, { status: 200 })
  }
})

// ── Email type → preference category mapping ──
const PREF_MAP: Record<string, string> = {
  order_dispatched: 'status_changes',
  goods_issued: 'status_changes',
  order_delivered: 'status_changes',
  order_cancelled: 'status_changes',
  pi_issued: 'status_changes',
  pi_payment_confirmed: 'status_changes',
  new_customer_approval: 'status_changes',
  credit_override: 'status_changes',
  mention: 'mentions',
  opportunity_won: 'crm_alerts',
  opportunity_lost: 'crm_alerts',
  overdue_followup: 'crm_alerts',
  assignment: 'crm_alerts',
}

// ── Subject line builder ──
function subject(r: any): string {
  const t = r.email_type
  const on = r.order_number || ''
  if (t === 'mention') return `[SSC] ${r.from_name} tagged you in ${on}`
  if (t === 'new_customer_approval') return `[SSC] New Customer — Approval Required`
  if (t === 'credit_override') return `[SSC] Credit Override — ${on}`
  if (t === 'opportunity_won') return `[SSC] Opportunity Won — ${on}`
  if (t === 'opportunity_lost') return `[SSC] Opportunity Lost — ${on}`
  if (t === 'overdue_followup') return `[SSC] Overdue Follow-Up — ${on}`
  if (t === 'order_cancelled') return `[SSC] Order Cancelled — ${on}`
  if (t === 'order_dispatched') return `[SSC] Order Dispatched — ${on}`
  if (t === 'goods_issued') return `[SSC] Goods Issued — ${on}`
  if (t === 'order_delivered') return `[SSC] Order Delivered — ${on}`
  if (t === 'pi_issued') return `[SSC] Invoice Generated — ${on}`
  if (t === 'pi_payment_confirmed') return `[SSC] Payment Confirmed — ${on}`
  return `[SSC] ${on} — ${(r.message || '').slice(0, 60)}`
}

// ── HTML email body ──
function body(r: any): string {
  const link = r.order_id ? `${APP_URL}/orders/${r.order_id}` : ''
  const btn = link
    ? `<a href="${link}" style="display:inline-block;padding:10px 20px;background:#1a4dab;color:white;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;margin-top:4px">View Order</a>`
    : ''
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px">
    <div style="border-bottom:2px solid #1a4dab;padding-bottom:14px;margin-bottom:20px">
      <strong style="color:#1a4dab;font-size:16px">SSC Control</strong>
    </div>
    <p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 16px">${escapeHtml(r.message || '')}</p>
    <p style="font-size:13px;color:#888;margin:0 0 20px">By: ${escapeHtml(r.from_name || 'System')} · ${new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
    ${btn}
    <div style="margin-top:28px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#aaa">
      SSC Control Pvt. Ltd. · Internal notification · <a href="${APP_URL}" style="color:#aaa">Open App</a>
    </div>
  </div>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function handleNotification(sb: any, r: any) {
  if (!r.email_type) return new Response('no email_type, skipped')

  // Get recipient email (prefer email column, fallback to username@ssccontrol.com)
  const { data: profile } = await sb.from('profiles').select('username,email').eq('id', r.user_id).single()
  if (!profile?.username) return new Response('no profile')
  const email = profile.email || (profile.username + '@ssccontrol.com')

  // Check preferences
  const prefKey = PREF_MAP[r.email_type] || 'status_changes'
  const { data: pref } = await sb.from('email_preferences').select(prefKey).eq('user_id', r.user_id).maybeSingle()
  if (pref && pref[prefKey] === false) {
    await sb.from('email_log').insert({
      notification_id: r.id, recipient_email: email,
      email_type: r.email_type, status: 'skipped',
    })
    return new Response('opted out')
  }

  // Send via Resend
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [email], subject: subject(r), html: body(r) }),
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
  // Skip login success emails — too noisy for 28 users
  // Only alert on suspicious failed logins
  if (r.event_type === 'login_failed') {
    // Check if 3+ failures in last 30 min for this user
    const { count } = await sb.from('login_audit').select('id', { count: 'exact' })
      .eq('user_name', r.user_name).eq('event_type', 'login_failed')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
    if ((count || 0) >= 3) {
      const { data: admins } = await sb.from('profiles').select('username,email').eq('role', 'admin')
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
            subject: `[SSC] Failed Login Alert — ${r.user_name}`,
            html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <div style="border-bottom:2px solid #be123c;padding-bottom:14px;margin-bottom:20px"><strong style="color:#be123c;font-size:16px">SSC Control — Security Alert</strong></div>
              <p style="font-size:14px;color:#333"><strong>${escapeHtml(r.user_name || '')}</strong> (${escapeHtml(r.email || '')}) has 3+ failed login attempts in the last 30 minutes.</p>
              <div style="margin-top:28px;border-top:1px solid #eee;padding-top:14px;font-size:11px;color:#aaa">SSC Control Pvt. Ltd.</div>
            </div>`,
          }),
        })
      }
    }
  }

  return new Response('ok')
}
