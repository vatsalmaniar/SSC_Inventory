import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ── Meta WhatsApp Cloud API — payment reminder with the statement attached ──
//
// Sends the approved `statement_of_dues` utility template to ONE customer, with
// their Statement of Dues PDF as the document header.
//
// Two rules this function exists to enforce, because a disabled button is only
// a courtesy and a stale page is not a permission system:
//   1. whatsapp_auto must be true — re-read from the DB, never taken on trust.
//   2. Every figure in the message is computed HERE from customer_dues_bills.
//      The caller supplies the PDF, never the amounts; otherwise a bad client
//      could tell a customer they owe something they don't.

const SB_URL   = Deno.env.get('SUPABASE_URL')!
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SB_ANON  = Deno.env.get('SUPABASE_ANON_KEY')!
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '1187516161121669'
const WA_TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE')  || 'statement_of_dues'
const WA_LANG     = Deno.env.get('WHATSAPP_TEMPLATE_LANG') || 'en'
const GRAPH       = 'https://graph.facebook.com/v21.0'

// Admin only — the user's decision, 2026-08-20. Accounts can view dues and
// print statements but cannot dun a customer.
const SENDER_ROLES = ['admin']

// Twice-a-week cadence: two people working the same list is the easy mistake.
const RESEND_GUARD_DAYS = 3

const MAX_PDF_BYTES = 4 * 1024 * 1024

const ALLOWED_ORIGINS = ['https://app.ssccontrol.com', 'https://ssc-inventory.vercel.app', 'http://localhost:5173']

function corsFor(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}

// Indian grouping, whole rupees — matches how the amounts read on the statement.
function inr(n: number): string {
  const v = Math.round(Number(n) || 0)
  const s = String(Math.abs(v))
  let out = s
  if (s.length > 3) {
    const head = s.slice(0, -3), tail = s.slice(-3)
    const parts: string[] = []
    let h = head
    while (h.length > 2) { parts.unshift(h.slice(-2)); h = h.slice(0, -2) }
    if (h) parts.unshift(h)
    out = parts.join(',') + ',' + tail
  }
  return (v < 0 ? '-' : '') + out
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  const t = new Date(d)
  if (isNaN(t.getTime())) return ''
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${String(t.getUTCDate()).padStart(2,'0')}-${MO[t.getUTCMonth()]}-${t.getUTCFullYear()}`
}

serve(async (req) => {
  const CORS = corsFor(req.headers.get('origin'))
  const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS }
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS })

  const fail = (error: string, status = 200) =>
    new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS })

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────
    // Identify the caller BEFORE reporting anything about configuration —
    // an anonymous probe should learn nothing, not even whether we are set up.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return fail('Not signed in.', 401)
    const sbUser = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authErr } = await sbUser.auth.getUser()
    if (authErr || !user) return fail('Session expired — sign in again.', 401)

    const sb = createClient(SB_URL, SB_KEY)
    const { data: profile } = await sb.from('profiles').select('role, name').eq('id', user.id).maybeSingle()
    if (!profile || !SENDER_ROLES.includes(profile.role)) {
      return fail('Only admins can send payment reminders.', 403)
    }

    if (!WA_TOKEN) return fail('WhatsApp is not configured yet (missing WHATSAPP_TOKEN).', 503)

    // ── INPUT ─────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}))
    const customerId: string = String(body.customer_id || '')
    const pdfB64: string = String(body.pdf_base64 || '')
    const force = body.force === true
    // 'single' (Customer 360 button) or 'bulk' (the Reminders run). Recorded so
    // "when did we last do a bulk run" has an answer.
    const source = body.source === 'bulk' ? 'bulk' : 'single'
    if (!customerId) return fail('Missing customer.')
    if (!pdfB64) return fail('Missing statement PDF.')
    if (pdfB64.length * 0.75 > MAX_PDF_BYTES) return fail('Statement PDF is too large to send.')

    // ── THE CUSTOMER, AND THE OPT-IN, READ FROM THE DATABASE ──────────────
    const { data: cust } = await sb.from('customers')
      .select('id, customer_name, whatsapp_no, whatsapp_name, whatsapp_auto')
      .eq('id', customerId).maybeSingle()
    if (!cust) return fail('Customer not found.')
    if (!cust.whatsapp_no) return fail('No WhatsApp number on file for this customer.')
    if (!cust.whatsapp_auto) return fail('Automatic WhatsApp reminders are switched off for this customer.')

    // ── THE AMOUNTS, COMPUTED HERE ────────────────────────────────────────
    const { data: bills } = await sb.from('customer_dues_bills')
      .select('pending_inr, pdc_inr, is_overdue').eq('customer_id', customerId)
    if (!bills || !bills.length) return fail('This customer has no open bills to send.')
    const outstanding = bills.reduce((s, b) => s + Number(b.pending_inr || 0), 0)
    const overdue = bills.filter(b => b.is_overdue)
      .reduce((s, b) => s + Number(b.pending_inr || 0) - Number(b.pdc_inr || 0), 0)

    // Reminders go to OVERDUE customers only. Someone inside their credit terms
    // has done nothing wrong and must never be chased. Enforced here, not just
    // in the UI, so no button, stale page or future caller can bypass it.
    if (overdue <= 0) {
      return fail('This customer has no overdue balance — nothing to remind them about.')
    }

    const { data: run } = await sb.from('customer_dues_runs')
      .select('as_on').eq('is_current', true).maybeSingle()
    const asOn = run?.as_on || null

    // ── DUPLICATE GUARD ───────────────────────────────────────────────────
    if (!force) {
      const since = new Date(Date.now() - RESEND_GUARD_DAYS * 86400000).toISOString()
      const { data: recent } = await sb.from('whatsapp_messages')
        .select('sent_at').eq('customer_id', customerId)
        .neq('status', 'failed').gte('sent_at', since)
        .order('sent_at', { ascending: false }).limit(1)
      if (recent?.length) {
        return new Response(JSON.stringify({
          ok: false, needs_confirm: true,
          error: `A reminder was already sent to this customer on ${fmtDate(recent[0].sent_at)}.`,
        }), { status: 200, headers: JSON_HEADERS })
      }
    }

    // ── 1. UPLOAD THE PDF TO META ─────────────────────────────────────────
    // Meta hosts the media; we never expose a public URL to a customer's
    // financial statement.
    const bin = Uint8Array.from(atob(pdfB64), c => c.charCodeAt(0))
    const filename = `Statement of Dues - ${String(cust.customer_name).replace(/[^\w \-.]/g, '')}.pdf`
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', 'application/pdf')
    form.append('file', new Blob([bin], { type: 'application/pdf' }), filename)

    const upRes = await fetch(`${GRAPH}/${WA_PHONE_ID}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: form,
    })
    const upJson = await upRes.json().catch(() => ({}))
    if (!upRes.ok || !upJson.id) {
      return fail('Could not upload the statement to WhatsApp: ' + (upJson?.error?.message || upRes.status))
    }
    const mediaId = upJson.id

    // ── 2. SEND THE TEMPLATE ──────────────────────────────────────────────
    const greeting = cust.whatsapp_name || cust.customer_name
    const payload = {
      messaging_product: 'whatsapp',
      to: String(cust.whatsapp_no).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: WA_TEMPLATE,
        language: { code: WA_LANG },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] },
          { type: 'body', parameters: [
            { type: 'text', text: String(greeting) },
            { type: 'text', text: fmtDate(asOn) },
            { type: 'text', text: inr(outstanding) },
            { type: 'text', text: inr(overdue) },
          ] },
        ],
      },
    }

    const sendRes = await fetch(`${GRAPH}/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const sendJson = await sendRes.json().catch(() => ({}))
    const waId = sendJson?.messages?.[0]?.id || null

    // Log the failure too — "we tried and Meta refused" is the answer to a
    // customer asking why they never got it.
    const row = {
      customer_id: customerId,
      to_number: cust.whatsapp_no,
      to_name: cust.whatsapp_name || null,
      template_name: WA_TEMPLATE,
      source,
      as_on: asOn,
      outstanding_inr: outstanding,
      overdue_inr: overdue,
      bill_count: bills.length,
      wa_message_id: waId,
      status: sendRes.ok && waId ? 'sent' : 'failed',
      error_message: sendRes.ok && waId ? null : (sendJson?.error?.message || `HTTP ${sendRes.status}`),
      failed_at: sendRes.ok && waId ? null : new Date().toISOString(),
      sent_by: user.id,
    }
    await sb.from('whatsapp_messages').insert(row)

    if (!sendRes.ok || !waId) {
      return fail('WhatsApp refused the message: ' + (sendJson?.error?.message || sendRes.status))
    }

    return new Response(JSON.stringify({
      ok: true, message_id: waId,
      to: cust.whatsapp_no, outstanding, overdue, as_on: asOn,
    }), { status: 200, headers: JSON_HEADERS })

  } catch (e) {
    return fail('Unexpected error: ' + (e?.message || String(e)), 500)
  }
})
