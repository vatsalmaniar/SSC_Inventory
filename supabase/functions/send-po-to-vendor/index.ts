import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL     = Deno.env.get('SUPABASE_URL')!
const SB_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SB_ANON    = Deno.env.get('SUPABASE_ANON_KEY')!
const FROM       = 'SSC Procurement <no-reply@ssccontrol.com>'

// Standing internal copies. BCC, not CC: the vendor has no business seeing who
// internally is on the thread, and a vendor "reply all" must not land in six
// inboxes. The UI pre-fills these as removable chips.
const INTERNAL_BCC = ['purchase@ssccontrol.com', 'purchase.brd@ssccontrol.com',
                      'ankit.dave@ssccontrol.com', 'hiral.patel@ssccontrol.com']

// Who may send a PO to a vendor. Mirrors the procurement pages' own gate.
const SENDER_ROLES = ['ops', 'admin', 'management']

const MAX_RECIPIENTS = 30          // a PO goes to a handful of people, never a list
const MAX_SUBJECT    = 300

const ALLOWED_ORIGINS = ['https://app.ssccontrol.com', 'https://ssc-inventory.vercel.app', 'http://localhost:5173']

function corsFor(origin: string | null) {
  // Reflect only known origins. The previous '*' let any site on the internet
  // call this endpoint straight from a browser.
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i

/** Strip CR/LF before anything reaches a mail header — classic header injection. */
function clean(s: unknown): string {
  return String(s ?? '').replace(/[\r\n]+/g, ' ').trim()
}

/** Validate + normalise an address list, dropping anything malformed. */
function addrList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const raw of v) {
    const a = clean(raw).toLowerCase()
    if (a && EMAIL_RE.test(a) && !out.includes(a)) out.push(a)
  }
  return out
}

serve(async (req) => {
  const CORS_HEADERS = corsFor(req.headers.get('origin'))
  const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS }
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS })

  const fail = (error: string, status = 200) =>
    new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS })

  try {
    // ── AUTHENTICATION ────────────────────────────────────────────────────
    // This endpoint was previously WIDE OPEN: no JWT was required and the
    // frontend sent none, so anyone with the URL could send mail from
    // no-reply@ssccontrol.com to any address, with any body and any
    // attachment. Verified 2026-08-05 by an unauthenticated probe that
    // returned the function's own validation error instead of a 401.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) return fail('Not signed in.', 401)

    const sbUser = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authErr } = await sbUser.auth.getUser()
    if (authErr || !user) return fail('Session expired — sign in again.', 401)

    const sb = createClient(SB_URL, SB_KEY)
    const { data: profile } = await sb.from('profiles').select('role, name').eq('id', user.id).maybeSingle()
    if (!profile || !SENDER_ROLES.includes(profile.role)) {
      return fail('You are not allowed to send purchase orders to vendors.', 403)
    }

    // ── INPUT ─────────────────────────────────────────────────────────────
    const body = await req.json()
    const { po_id, html_body, text_body, attachments } = body

    if (!po_id || typeof po_id !== 'string') return fail('Missing purchase order.')
    const to  = addrList(body.to_emails)
    const cc  = addrList(body.cc_emails)
    const bcc = addrList(body.bcc_emails)
    if (!to.length) return fail('Add at least one valid recipient.')

    // De-duplicate across fields, To winning, then Cc — nobody gets two copies
    // and nobody is silently both visible and hidden.
    const seen = new Set(to)
    const ccFinal  = cc.filter(a => !seen.has(a) && seen.add(a))
    const bccFinal = bcc.filter(a => !seen.has(a) && seen.add(a))

    if (to.length + ccFinal.length + bccFinal.length > MAX_RECIPIENTS) {
      return fail(`Too many recipients (max ${MAX_RECIPIENTS}).`)
    }

    const subject = clean(body.subject).slice(0, MAX_SUBJECT)
    if (!subject) return fail('Subject is required.')
    // reply_to must be a real address or Resend rejects the whole send
    const senderEmail = clean(body.sender_email).toLowerCase()
    const replyTo = EMAIL_RE.test(senderEmail) ? senderEmail : 'purchase@ssccontrol.com'
    const senderName = clean(body.sender_name) || profile.name || 'SSC'

    // The PO must exist, and its number is taken from the DATABASE — never from
    // the request — so a caller cannot log an email against a PO it did not send.
    const { data: po } = await sb.from('purchase_orders').select('id, po_number').eq('id', po_id).maybeSingle()
    if (!po) return fail('Purchase order not found.')

    // ── ATTACHMENTS ───────────────────────────────────────────────────────
    // Only inline base64, or a URL on OUR OWN storage host. Fetching arbitrary
    // URLs made this a server-side request forgery tool: it would happily pull
    // an internal endpoint and mail the contents out.
    const storageHost = new URL(SB_URL).host
    const atts: any[] = []
    const failedAtts: string[] = []
    for (const a of (attachments || []).slice(0, 10)) {
      const filename = clean(a?.filename).replace(/[/\\]/g, '_') || 'attachment'
      if (a?.content) { atts.push({ filename, content: a.content }); continue }
      if (!a?.url) { failedAtts.push(filename); continue }
      let u: URL
      try { u = new URL(a.url) } catch { failedAtts.push(filename); continue }
      if (u.protocol !== 'https:' || u.host !== storageHost) { failedAtts.push(filename); continue }
      try {
        const fileRes = await fetch(u.toString())
        if (!fileRes.ok) { failedAtts.push(filename); continue }
        const buf = await fileRes.arrayBuffer()
        if (buf.byteLength > 15 * 1024 * 1024) { failedAtts.push(filename); continue }
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        atts.push({ filename, content: btoa(bin) })
      } catch (_) { failedAtts.push(filename) }
    }

    // ── SEND ──────────────────────────────────────────────────────────────
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM, to, subject,
        ...(ccFinal.length  ? { cc: ccFinal }   : {}),
        ...(bccFinal.length ? { bcc: bccFinal } : {}),
        reply_to: replyTo,
        // Vendor POs are plain text by decision (2026-09-04): a marketing-styled HTML
        // mail is the wrong register for a contractual document, and text survives every
        // vendor mail client and print-out intact. html_body stays supported for any
        // caller that still sends one.
        ...(text_body ? { text: text_body } : { html: html_body }),
        ...(atts.length ? { attachments: atts } : {}),
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const errMsg = data?.message || data?.error || `Resend ${res.status}`
      // A failed vendor send used to vanish: no log row, no activity line — the PO simply
      // looked un-emailed with no reason recorded. Both are now written before returning.
      try {
        await sb.from('email_log').insert(to.map((addr: string) => ({
          recipient_email: addr, email_type: 'po_vendor', po_id, status: 'failed',
          error_message: errMsg, last_event: 'failed', last_event_at: new Date().toISOString(),
        })))
      } catch (_) { /* logging must not mask the real error */ }
      try {
        await sb.from('po_comments').insert({ po_id, author_name: senderName, is_activity: true,
          message: `${po.po_number} email FAILED to ${to.join(', ')} — ${errMsg}` })
      } catch (_) { /* ditto */ }
      return new Response(JSON.stringify({ ok: false, error: errMsg, failed_attachments: failedAtts }),
        { status: 200, headers: JSON_HEADERS })
    }

    // Activity log. Bcc recipients are counted, never named — writing them into
    // a comment every colleague can read would defeat the point of Bcc.
    const msg = `${po.po_number} emailed to ${to.join(', ')}`
      + (ccFinal.length ? ` (+${ccFinal.length} Cc)` : '')
      + (bccFinal.length ? ` (+${bccFinal.length} Bcc)` : '')
      + ` by ${senderName}`
      + (atts.length ? ` — ${atts.length} attachment${atts.length !== 1 ? 's' : ''}` : '')
    try {
      await sb.from('po_comments').insert({ po_id, author_name: senderName, message: msg, is_activity: true })
    } catch (_) { /* never fail a sent email on a log write */ }

    // Durable delivery record, one row per To recipient, keyed by the Resend id so the
    // webhook can flip it to delivered/bounced later. Vendor sends previously left NO
    // record anywhere — "was this PO ever actually e-mailed?" was unanswerable.
    try {
      await sb.from('email_log').insert(to.map((addr: string) => ({
        recipient_email: addr, email_type: 'po_vendor', po_id,
        resend_id: data?.id || null, status: 'sent',
        last_event: 'sent', last_event_at: new Date().toISOString(),
      })))
    } catch (_) { /* never fail a sent email on a log write */ }

    return new Response(JSON.stringify({
      ok: true, resend_id: data?.id, to, cc: ccFinal, bcc_count: bccFinal.length,
      attachments: atts.length, failed_attachments: failedAtts,
    }), { status: 200, headers: JSON_HEADERS })
  } catch (e) {
    return fail((e as Error).message)
  }
})

export { INTERNAL_BCC }
