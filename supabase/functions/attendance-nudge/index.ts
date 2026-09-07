// Attendance nudge — "you have not checked in today", sent 10:30 IST on working days.
//
// WHY IT EXISTS: a day with no punch and no leave becomes Loss of Pay at month end. By then
// the 48-hour regularization window has long closed and it needs HR. A prompt at 10:30
// lets the person fix it themselves, the same morning.
//
// WHO IT GOES TO (public.att_missing_punch_today decides; this function only delivers):
//   * a normal user  -> emailed directly, with people@ in copy
//   * role 'staff'   -> NOT emailed. They have no mailbox. One digest naming them goes to
//                       people@ instead, so Ankit can chase it. (staff_never_emailed.sql
//                       would strip any mail addressed to them anyway.)
//   * role 'admin'   -> excluded entirely; all four are attendance_exempt and never punch.
// Week-offs, public holidays and DECLARED holidays are skipped inside the SQL function,
// including the rule that the fulfilment team works the 2nd and 4th Saturday.
//
// SAFETY: this sends real mail to real people on a schedule, so it is DRY RUN BY DEFAULT.
// It only sends when called with ?send=1. A cron that forgets the flag reports and mails
// nobody, which is the failure direction you want.
//
// Every send is written to email_log (email_type 'attendance_missing_punch'), so there is
// a record of who was told what and when.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL   = Deno.env.get('SUPABASE_URL')!
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND   = Deno.env.get('RESEND_API_KEY')!
const FROM     = 'SSC People <notifications@ssccontrol.com>'
const PEOPLE   = 'people@ssccontrol.com'
const TYPE     = 'attendance_missing_punch'

const sb = createClient(SB_URL, SB_KEY)

const istToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const istLongDate = () =>
  new Date().toLocaleDateString('en-IN',
    { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })

// Plain text on purpose: this is a helpful prompt, not a notice, and it must read the
// same on every phone. No emoji anywhere (house rule).
function personText(fullName: string): string {
  const first = (fullName || '').split(' ')[0] || fullName
  return [
    `Hi ${first},`,
    '',
    `As of 10:30 AM we haven't received a check-in for you today (${istLongDate()}), and you're not marked as on leave.`,
    '',
    'If nothing is recorded for the day, it will be treated as Loss of Pay. That is easy to avoid — just do one of these:',
    '',
    "If you are at work and the device didn't capture your punch, raise a Regularization: open People, go to Attendance, and choose Regularize. Please do it within 48 hours of the day.",
    '',
    'If you are not coming in today, apply for leave from the same place.',
    '',
    'One thing worth knowing: you can regularise up to 7 days in a month, so it is best to keep them for genuine cases where the device missed you.',
    '',
    'Warm regards,',
    'People and Culture Team',
  ].join('\n')
}

// Staff have no inbox, so People get one message naming them.
function staffDigestText(names: string[]): string {
  return [
    'Hello,',
    '',
    `These team members have no check-in recorded as of 10:30 AM today (${istLongDate()}), and are not on leave:`,
    '',
    ...names.map(n => `  - ${n}`),
    '',
    'They do not have an email address, so they cannot be prompted directly. Could someone check with them and either record the punch or raise a Regularization on their behalf?',
    '',
    'A day left with no punch and no leave is treated as Loss of Pay.',
    '',
    'Warm regards,',
    'People and Culture Team',
  ].join('\n')
}

async function send(to: string[], subject: string, text: string, cc?: string[]) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, text, ...(cc ? { cc } : {}) }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, id: data?.id ?? null, data }
}

async function log(recipient: string, status: string, resendId: string | null, err?: string) {
  try {
    await sb.from('email_log').insert({
      recipient_email: recipient, email_type: TYPE,
      resend_id: resendId, status, error_message: err ?? null,
    })
  } catch (_) { /* a logging failure must never affect delivery */ }
}

Deno.serve(async (req) => {
  // Only the scheduler may run this. A dedicated secret rather than the service key:
  // the platform already gate-keeps on JWT, but the anon key is a valid JWT too, so
  // comparing against a purpose-made secret is what actually restricts this to cron.
  const secret = Deno.env.get('NUDGE_SECRET') || ''
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('unauthorized', { status: 401 })
  }

  const url = new URL(req.url)
  const doSend = url.searchParams.get('send') === '1'

  const { data: rows, error } = await sb.rpc('att_missing_punch_today')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const all    = rows ?? []
  const people = all.filter((r: any) => r.role !== 'staff')
  const staff  = all.filter((r: any) => r.role === 'staff')

  const plan = {
    date: istToday(),
    mode: doSend ? 'SEND' : 'dry-run (pass ?send=1 to actually send)',
    emailed_individually: people.map((r: any) => `${r.full_name} <${r.email}>`),
    reported_to_people: staff.map((r: any) => r.full_name),
    total: all.length,
  }
  if (!doSend) return Response.json(plan)

  let sent = 0, failed = 0
  for (const r of people) {
    const out = await send([r.email], 'Attendance — no check-in recorded today',
                           personText(r.full_name), [PEOPLE])
    await log(r.email, out.ok ? 'sent' : 'failed', out.id,
              out.ok ? undefined : JSON.stringify(out.data))
    out.ok ? sent++ : failed++
    // Resend allows 10/sec; these batches are tiny but stay well inside it.
    await new Promise(res => setTimeout(res, 120))
  }

  if (staff.length) {
    const names = staff.map((r: any) => r.full_name)
    const out = await send([PEOPLE], `Attendance — ${names.length} team member${names.length > 1 ? 's' : ''} not checked in`,
                           staffDigestText(names))
    await log(PEOPLE, out.ok ? 'sent' : 'failed', out.id,
              out.ok ? undefined : JSON.stringify(out.data))
    out.ok ? sent++ : failed++
  }

  return Response.json({ ...plan, sent, failed })
})
