import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ── Resend delivery callbacks ──────────────────────────────────────────────
//
// Our email_log recorded "sent", which only ever meant "Resend accepted it" — not
// that anyone received it. A vendor PO could be marked emailed while the message
// bounced, and nothing anywhere would say so. Resend posts the real outcome here
// (delivered / bounced / complained / delayed) and it is written back onto the
// log row, and onto the PO's own activity timeline when the mail was a PO.
//
// Public by necessity — Resend cannot present a Supabase JWT — so it is protected
// by Svix signature verification (RESEND_WEBHOOK_SECRET, the `whsec_…` value from
// the Resend dashboard) and by only ever UPDATING rows whose resend_id we issued.
// Nothing is created from the payload.
//
// Deploy: supabase functions deploy resend-webhook --no-verify-jwt
// Then add the URL as an endpoint in Resend → Webhooks, subscribed to the
// email.* events, and set RESEND_WEBHOOK_SECRET from the signing secret it shows.

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WH_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') || ''

// Only ever move forward: a late 'sent' must not overwrite a 'delivered', and a
// bounce must never be masked by a delayed-delivery notice arriving after it.
const RANK: Record<string, number> = {
  sent: 1, delayed: 2, opened: 3, clicked: 3, delivered: 4, complained: 5, bounced: 6, failed: 6,
}

const EVENT_MAP: Record<string, string> = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.delivery_delayed': 'delayed',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
}

/** Svix signature check: HMAC-SHA256 over `id.timestamp.body`, base64, `v1,<sig>`. */
async function verify(req: Request, raw: string): Promise<boolean> {
  if (!WH_SECRET) return false
  const id = req.headers.get('svix-id') || req.headers.get('webhook-id')
  const ts = req.headers.get('svix-timestamp') || req.headers.get('webhook-timestamp')
  const sigHeader = req.headers.get('svix-signature') || req.headers.get('webhook-signature')
  if (!id || !ts || !sigHeader) return false

  // Reject anything older than 5 minutes so a captured payload cannot be replayed.
  const age = Math.abs(Date.now() / 1000 - Number(ts))
  if (!Number.isFinite(age) || age > 300) return false

  const secretB64 = WH_SECRET.startsWith('whsec_') ? WH_SECRET.slice(6) : WH_SECRET
  const keyBytes = Uint8Array.from(atob(secretB64), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))

  // The header may carry several space-separated versioned signatures.
  return sigHeader.split(' ').some(part => {
    const [v, sig] = part.split(',')
    if (v !== 'v1' || !sig || sig.length !== expected.length) return false
    let diff = 0                                   // constant-time compare
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
    return diff === 0
  })
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await verify(req, raw))) return new Response('invalid signature', { status: 401 })

  // Always 200 after this point: a non-200 makes Resend retry, and a retry storm
  // is worse than one dropped status update.
  try {
    const evt = JSON.parse(raw)
    const status = EVENT_MAP[evt?.type]
    const emailId = evt?.data?.email_id || evt?.data?.id
    if (!status || !emailId) return new Response('ignored', { status: 200 })

    const sb = createClient(SB_URL, SB_KEY)
    const { data: rows } = await sb.from('email_log')
      .select('id, status, po_id, recipient_email, email_type, last_event')
      .eq('resend_id', emailId)
    if (!rows?.length) return new Response('unknown email id', { status: 200 })

    const now = new Date().toISOString()
    const reason = evt?.data?.bounce?.message || evt?.data?.reason || null

    for (const row of rows) {
      // Opens/clicks are recorded as events but must not overwrite the delivery status.
      const isEngagement = status === 'opened' || status === 'clicked'
      const beats = (RANK[status] || 0) > (RANK[row.status as string] || 0)
      const patch: Record<string, unknown> = { last_event: status, last_event_at: now }
      if (!isEngagement && beats) patch.status = status
      if (status === 'delivered') patch.delivered_at = now
      if (reason && (status === 'bounced' || status === 'complained')) patch.error_message = reason
      await sb.from('email_log').update(patch).eq('id', row.id)

      // Put the outcome on the PO's own timeline — that is where procurement looks.
      // Only the outcomes that change a decision; opens/clicks would be noise.
      if (row.po_id && !isEngagement && beats && status !== 'sent') {
        const label = status === 'delivered' ? `✅ PO email delivered to ${row.recipient_email}`
          : status === 'bounced'    ? `⛔ PO email BOUNCED — ${row.recipient_email}${reason ? ` — ${reason}` : ''}. The vendor did NOT receive it.`
          : status === 'complained' ? `⚠️ PO email marked as spam by ${row.recipient_email}`
          : `⏳ PO email delayed — ${row.recipient_email}${reason ? ` — ${reason}` : ''}`
        try {
          await sb.from('po_comments').insert({
            po_id: row.po_id, author_name: 'Email delivery', message: label, is_activity: true,
          })
        } catch (_) { /* a log write must never fail the webhook */ }
      }
    }
    return new Response('ok', { status: 200 })
  } catch (_) {
    return new Response('ok', { status: 200 })
  }
})
