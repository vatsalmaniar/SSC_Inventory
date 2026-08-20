import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { buildDuesStatementPdf } from "../_shared/duesStatementPdf.ts"
import { statementAssets } from "../_shared/statementAssets.ts"

// ── Background WhatsApp payment reminders ──────────────────────────────────
//
// The browser used to build every statement PDF, so a 206-customer run meant
// 25 minutes with the tab open. The PDF is drawn here now, so a run survives a
// closed laptop.
//
// Shape: "start" queues the eligible customers and returns immediately.
// "process" takes a batch, sends it, and calls itself for the next batch until
// the queue is empty. No cron — a chained call, capped, so a bug cannot spin.
//
// Every guard from the single-send path still applies, and applies HERE rather
// than in the caller: admin only, whatsapp_auto re-read per customer, overdue
// recomputed from customer_dues_bills, and the ₹500 floor.

const SB_URL   = Deno.env.get('SUPABASE_URL')!
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SB_ANON  = Deno.env.get('SUPABASE_ANON_KEY')!
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '1187516161121669'
const WA_TEMPLATE = Deno.env.get('WHATSAPP_TEMPLATE') || 'statement_of_dues'
const WA_LANG     = Deno.env.get('WHATSAPP_TEMPLATE_LANG') || 'en'
const GRAPH       = 'https://graph.facebook.com/v21.0'
const ASSET_BASE  = Deno.env.get('PUBLIC_ASSET_BASE') || 'https://ssc-inventory.vercel.app'
// Shared secret for the function's calls to itself. A dedicated value rather
// than the service-role key: Supabase injects a different key shape than the
// Management API hands out, and a secret used for one job should not also be
// the key to the whole database.
const JOB_SECRET  = Deno.env.get('JOB_SECRET') || ''

const SENDER_ROLES   = ['admin']
const MIN_OVERDUE    = 500      // below this, chasing costs more than it collects
const BATCH          = 12       // ~12 × 1.5s ≈ 18s, inside the invocation limit
const MAX_PASSES     = 60       // 60 × 12 = 720 customers, then it stops itself
const GAP_MS         = 400
const RESEND_GUARD_DAYS = 3

const ALLOWED_ORIGINS = ['https://app.ssccontrol.com', 'https://ssc-inventory.vercel.app', 'http://localhost:5173']
const corsFor = (o: string | null) => ({
  'Access-Control-Allow-Origin': o && ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
})

// Fonts and the logo are embedded (see _shared/statementAssets.ts) rather than
// fetched: a runtime fetch tied PDF generation to deploy order, and a missing
// file came back as index.html, which fontkit reported as "Unknown font format".
const assets = () => statementAssets()

const inr = (v: number) => {
  const n = Math.round(Number(v) || 0), s = String(Math.abs(n))
  let out = s
  if (s.length > 3) {
    const head = s.slice(0, -3), tail = s.slice(-3), parts: string[] = []
    let h = head
    while (h.length > 2) { parts.unshift(h.slice(-2)); h = h.slice(0, -2) }
    if (h) parts.unshift(h)
    out = parts.join(',') + ',' + tail
  }
  return (n < 0 ? '-' : '') + out
}
const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtDate = (d: string | null) => {
  if (!d) return ''
  const t = new Date(d)
  return isNaN(t.getTime()) ? '' : `${String(t.getUTCDate()).padStart(2,'0')}-${MO[t.getUTCMonth()]}-${t.getUTCFullYear()}`
}
const b64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}

serve(async (req) => {
  const CORS = corsFor(req.headers.get('origin'))
  const H = { 'Content-Type': 'application/json', ...CORS }
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS })
  const fail = (error: string, status = 200) =>
    new Response(JSON.stringify({ ok: false, error }), { status, headers: H })

  const sb = createClient(SB_URL, SB_KEY)
  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine for a chained call */ }
  const action = body.action || 'start'

  try {
    // ── PROCESS ── a chained call. Authenticated by the service-role secret,
    // not a user session: it is the function calling itself.
    if (action === 'process') {
      if (!JOB_SECRET || body.secret !== JOB_SECRET) return fail('Not allowed.', 403)
      return await processBatch(sb, String(body.job_id || ''), H)
    }

    // ── SCHEDULED ── pg_cron, twice a week at noon. Authenticated by the job
    // secret, not a user session, so it carries its own guard rails.
    if (action === 'scheduled') {
      if (!JOB_SECRET || body.secret !== JOB_SECRET) return fail('Not allowed.', 403)
      if (!WA_TOKEN) return await skip(sb, 'WhatsApp is not configured', H)

      // The dues come from a Tally sheet somebody uploads by hand. Running on
      // yesterday's sheet would dun customers who have paid since — statements
      // listing bills they have already settled. A missed Monday is cheaper.
      const { data: run } = await sb.from('customer_dues_runs')
        .select('as_on').eq('is_current', true).maybeSingle()
      const today = new Date().toISOString().slice(0, 10)
      if (!run?.as_on) return await skip(sb, 'no receivables uploaded yet', H)
      if (run.as_on !== today) {
        return await skip(sb, `receivables are from ${run.as_on}, not today — nobody uploaded this morning`, H)
      }

      const { data: busy } = await sb.from('whatsapp_reminder_jobs')
        .select('id').in('status', ['queued','running']).maybeSingle()
      if (busy) return await skip(sb, 'a run is already in progress', H)

      const queued = await queueRun(sb, null, run.as_on)
      if (!queued.ok) return await skip(sb, queued.error!, H)
      await notify(sb, `Scheduled WhatsApp reminders started — ${queued.total} customers queued.`)
      kick(queued.job_id!)
      return new Response(JSON.stringify({ ok: true, job_id: queued.job_id, total: queued.total }), { headers: H })
    }

    // ── START ── a human pressing the button.
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!token) return fail('Not signed in.', 401)
    const sbUser = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const { data: { user }, error: authErr } = await sbUser.auth.getUser()
    if (authErr || !user) return fail('Session expired — sign in again.', 401)
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (!profile || !SENDER_ROLES.includes(profile.role)) return fail('Only admins can send payment reminders.', 403)
    if (!WA_TOKEN) return fail('WhatsApp is not configured yet (missing WHATSAPP_TOKEN).', 503)

    if (action === 'stop') {
      const { error } = await sb.from('whatsapp_reminder_jobs')
        .update({ status: 'stopped', finished_at: new Date().toISOString() })
        .in('status', ['queued', 'running'])
      if (error) return fail(error.message)
      return new Response(JSON.stringify({ ok: true, stopped: true }), { headers: H })
    }

    // one run at a time — a second press while one is in flight would send twice
    const { data: active } = await sb.from('whatsapp_reminder_jobs')
      .select('id, status, total, sent, failed').in('status', ['queued', 'running']).maybeSingle()
    if (active) return new Response(JSON.stringify({ ok: true, job: active, already_running: true }), { headers: H })

    const { data: run } = await sb.from('customer_dues_runs').select('as_on').eq('is_current', true).maybeSingle()
    const queued = await queueRun(sb, user.id, run?.as_on || null, body.customer_ids, body.include_recent === true)
    if (!queued.ok) return fail(queued.error!)
    kick(queued.job_id!)   // fire and forget; the caller does not wait for the run
    return new Response(JSON.stringify({ ok: true, job_id: queued.job_id, total: queued.total }), { headers: H })

  } catch (e) {
    return fail('Unexpected error: ' + ((e as Error)?.message || String(e)), 500)
  }
})

/** Snapshot the eligible customers into a new job. One implementation, so the
 *  button and the schedule can never diverge on who gets a reminder. */
async function queueRun(sb: any, userId: string | null, asOn: string | null,
                        onlyIds?: unknown, includeRecent = false) {
  const { data: queue, error: qErr } = await sb.from('whatsapp_reminder_queue').select('customer_id, overdue')
  if (qErr) return { ok: false, error: 'Could not read the reminder queue: ' + qErr.message }

  let chosen = (queue || []).filter((q: any) => Number(q.overdue) >= MIN_OVERDUE)
  if (Array.isArray(onlyIds) && onlyIds.length) {
    const want = new Set(onlyIds.map(String))
    chosen = chosen.filter((q: any) => want.has(String(q.customer_id)))
  }
  if (!includeRecent) {
    const since = new Date(Date.now() - RESEND_GUARD_DAYS * 86400000).toISOString()
    const { data: recent } = await sb.from('whatsapp_messages')
      .select('customer_id').neq('status', 'failed').gte('sent_at', since)
    const done = new Set((recent || []).map((r: any) => r.customer_id))
    chosen = chosen.filter((q: any) => !done.has(q.customer_id))
  }
  if (!chosen.length) return { ok: false, error: 'Nobody is due a reminder right now.' }

  const { data: job, error: jErr } = await sb.from('whatsapp_reminder_jobs')
    .insert({ status: 'queued', as_on: asOn, total: chosen.length, created_by: userId })
    .select('id').single()
  if (jErr) return { ok: false, error: 'Could not create the run: ' + jErr.message }

  for (let i = 0; i < chosen.length; i += 500) {
    const { error } = await sb.from('whatsapp_reminder_job_items').insert(
      chosen.slice(i, i + 500).map((c: any) => ({ job_id: job.id, customer_id: c.customer_id, overdue_inr: c.overdue })))
    if (error) {
      await sb.from('whatsapp_reminder_jobs').update({ status: 'failed', last_error: error.message }).eq('id', job.id)
      return { ok: false, error: 'Could not queue the customers: ' + error.message }
    }
  }
  return { ok: true, job_id: job.id as string, total: chosen.length }
}

/** Tell the admins. A scheduled run that quietly does nothing is worse than one
 *  that fails loudly — a skipped Monday would otherwise go unnoticed for days. */
async function notify(sb: any, message: string) {
  const { data: admins } = await sb.from('profiles').select('id, name').eq('role', 'admin')
  if (!admins?.length) return
  await sb.from('notifications').insert(admins.map((a: any) => ({
    user_id: a.id, user_name: a.name || 'Admin', from_name: 'WhatsApp Reminders', message,
  })))
}

async function skip(sb: any, why: string, H: HeadersInit) {
  await notify(sb, `Scheduled WhatsApp reminders did NOT run — ${why}.`)
  return new Response(JSON.stringify({ ok: true, skipped: true, reason: why }), { headers: H })
}

/** Ask ourselves to process the next batch. Deliberately not awaited. */
function kick(jobId: string) {
  fetch(`${SB_URL}/functions/v1/run-reminder-job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SB_KEY}` },
    body: JSON.stringify({ action: 'process', job_id: jobId, secret: JOB_SECRET }),
  }).catch(() => { /* the next pass or a manual retry will pick it up */ })
}

async function processBatch(sb: any, jobId: string, H: HeadersInit) {
  const done = (payload: unknown) => new Response(JSON.stringify(payload), { headers: H })

  const { data: job } = await sb.from('whatsapp_reminder_jobs').select('*').eq('id', jobId).maybeSingle()
  if (!job) return done({ ok: false, error: 'job not found' })
  if (job.status === 'stopped' || job.status === 'done') return done({ ok: true, status: job.status })
  if (job.passes >= MAX_PASSES) {
    await sb.from('whatsapp_reminder_jobs').update({
      status: 'failed', last_error: `stopped after ${MAX_PASSES} passes`, finished_at: new Date().toISOString(),
    }).eq('id', jobId)
    return done({ ok: false, error: 'pass limit reached' })
  }

  await sb.from('whatsapp_reminder_jobs')
    .update({ status: 'running', passes: job.passes + 1, started_at: job.started_at || new Date().toISOString() })
    .eq('id', jobId)

  const { data: items } = await sb.from('whatsapp_reminder_job_items')
    .select('id, customer_id').eq('job_id', jobId).eq('status', 'pending').limit(BATCH)

  if (!items?.length) {
    await finish(sb, jobId)
    return done({ ok: true, status: 'done' })
  }

  const A = assets()
  let sent = 0, failed = 0

  for (const item of items) {
    try {
      const r = await sendOne(sb, item.customer_id, job.as_on, A)
      await sb.from('whatsapp_reminder_job_items')
        .update({ status: r.ok ? 'sent' : (r.skipped ? 'skipped' : 'failed'),
                  error: r.ok ? null : r.error, sent_at: new Date().toISOString() })
        .eq('id', item.id)
      if (r.ok) sent++; else if (!r.skipped) failed++
    } catch (e) {
      await sb.from('whatsapp_reminder_job_items')
        .update({ status: 'failed', error: String((e as Error)?.message || e).slice(0, 300), sent_at: new Date().toISOString() })
        .eq('id', item.id)
      failed++
    }
    await new Promise(r => setTimeout(r, GAP_MS))
  }

  const { data: fresh } = await sb.from('whatsapp_reminder_jobs').select('sent, failed').eq('id', jobId).maybeSingle()
  await sb.from('whatsapp_reminder_jobs')
    .update({ sent: (fresh?.sent || 0) + sent, failed: (fresh?.failed || 0) + failed }).eq('id', jobId)

  const { count } = await sb.from('whatsapp_reminder_job_items')
    .select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('status', 'pending')

  if (count && count > 0) kick(jobId)
  else await finish(sb, jobId)

  return done({ ok: true, sent, failed, remaining: count || 0 })
}

/** Close the job and tell the admins what happened. */
async function finish(sb: any, jobId: string) {
  await sb.from('whatsapp_reminder_jobs')
    .update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId)
  const { data: j } = await sb.from('whatsapp_reminder_jobs')
    .select('sent, failed, total').eq('id', jobId).maybeSingle()
  if (!j) return
  await notify(sb, j.failed
    ? `WhatsApp reminders finished — ${j.sent} sent, ${j.failed} failed of ${j.total}.`
    : `WhatsApp reminders finished — ${j.sent} of ${j.total} sent.`)
}

/** One customer: re-check, build, upload, send, log. */
async function sendOne(sb: any, customerId: string, asOn: string | null, A: Record<string, Uint8Array>) {
  const { data: cust } = await sb.from('customers')
    .select('id, customer_name, customer_id, gst, credit_terms, poc_name, account_owner, billing_address, whatsapp_no, whatsapp_name, whatsapp_auto')
    .eq('id', customerId).maybeSingle()
  if (!cust) return { ok: false, error: 'customer not found' }
  // Re-read, never trust the queue snapshot: the toggle may have been switched
  // off, or the number removed, since the run was created.
  if (!cust.whatsapp_no) return { ok: false, skipped: true, error: 'no WhatsApp number' }
  if (!cust.whatsapp_auto) return { ok: false, skipped: true, error: 'reminders switched off' }

  const { data: bills } = await sb.from('customer_dues_bills')
    .select('bill_date, bill_ref, pending_inr, pdc_inr, due_date, days_past_due, is_overdue')
    .eq('customer_id', customerId).order('due_date', { ascending: true })
  if (!bills?.length) return { ok: false, skipped: true, error: 'no open bills' }

  const outstanding = bills.reduce((s: number, b: any) => s + Number(b.pending_inr || 0), 0)
  const overdue = bills.filter((b: any) => b.is_overdue)
    .reduce((s: number, b: any) => s + Number(b.pending_inr || 0) - Number(b.pdc_inr || 0), 0)
  if (overdue < MIN_OVERDUE) return { ok: false, skipped: true, error: `overdue below ₹${MIN_OVERDUE}` }

  const pdfBytes = await buildDuesStatementPdf({ customer: cust, bills, asOn, assets: A })
  const filename = `Statement of Dues - ${String(cust.customer_name).replace(/[^\w \-.]/g, '')}.pdf`

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', 'application/pdf')
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), filename)
  const up = await fetch(`${GRAPH}/${WA_PHONE_ID}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: form,
  })
  const upJson = await up.json().catch(() => ({}))
  if (!up.ok || !upJson.id) return { ok: false, error: 'media upload: ' + (upJson?.error?.message || up.status) }

  const res = await fetch(`${GRAPH}/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(cust.whatsapp_no).replace(/\D/g, ''),
      type: 'template',
      template: {
        name: WA_TEMPLATE, language: { code: WA_LANG },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: upJson.id, filename } }] },
          { type: 'body', parameters: [
            { type: 'text', text: String(cust.whatsapp_name || cust.customer_name) },
            { type: 'text', text: fmtDate(asOn) },
            { type: 'text', text: inr(outstanding) },
            { type: 'text', text: inr(overdue) },
          ] },
        ],
      },
    }),
  })
  const json = await res.json().catch(() => ({}))
  const waId = json?.messages?.[0]?.id || null

  await sb.from('whatsapp_messages').insert({
    customer_id: customerId, to_number: cust.whatsapp_no, to_name: cust.whatsapp_name || null,
    template_name: WA_TEMPLATE, source: 'bulk', as_on: asOn,
    outstanding_inr: outstanding, overdue_inr: overdue, bill_count: bills.length,
    wa_message_id: waId, status: res.ok && waId ? 'sent' : 'failed',
    error_message: res.ok && waId ? null : (json?.error?.message || `HTTP ${res.status}`),
    failed_at: res.ok && waId ? null : new Date().toISOString(),
  })

  if (!res.ok || !waId) return { ok: false, error: json?.error?.message || `HTTP ${res.status}` }
  return { ok: true }
}
