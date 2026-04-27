import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!
const SB_URL     = Deno.env.get('SUPABASE_URL')!
const SB_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FROM       = 'SSC Procurement <no-reply@ssccontrol.com>'
const FIXED_CC   = ['purchase@ssccontrol.com', 'purchase.brd@ssccontrol.com', 'ankit.dave@ssccontrol.com', 'hiral.patel@ssccontrol.com']

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS_HEADERS }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS_HEADERS })

  try {
    const body = await req.json()
    const { po_id, to_emails, sender_name, sender_email, subject, html_body, attachments } = body
    if (!po_id || !Array.isArray(to_emails) || !to_emails.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Missing required fields' }), { status: 200, headers: JSON_HEADERS })
    }

    const sb = createClient(SB_URL, SB_KEY)

    // Dedup CC: fixed list + sender, remove duplicates, remove anything already in To
    const toSet = new Set(to_emails.map((e: string) => e.trim().toLowerCase()))
    const replyTo = (sender_email || '').trim().toLowerCase()
    const ccSet = new Set<string>()
    for (const c of [...FIXED_CC, sender_email]) {
      const addr = (c || '').trim().toLowerCase()
      if (!addr) continue
      if (addr === replyTo) continue         // sender replaces reply-to slot
      if (toSet.has(addr)) continue          // already in To
      ccSet.add(addr)
    }
    const cc = [...ccSet]

    // Build attachments from URLs — Resend fetches them via path
    const atts = (attachments || []).map((a: any) => ({
      filename: a.filename,
      path:     a.url,
    }))

    // Send via Resend
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: to_emails,
        cc,
        reply_to: sender_email || 'purchase@ssccontrol.com',
        subject,
        html: html_body,
        ...(atts.length ? { attachments: atts } : {}),
      }),
    })

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: data?.message || 'Resend error', detail: data }), { status: 200, headers: JSON_HEADERS })
    }

    // Log activity on PO
    const ccCount = cc.length
    const attCount = atts.length
    const msg = `📧 PO emailed to ${to_emails.join(', ')}${ccCount ? ` (+${ccCount} Cc)` : ''} by ${sender_name || 'Unknown'}${attCount ? ` — ${attCount} attachment${attCount !== 1 ? 's' : ''}` : ''}`
    await sb.from('po_comments').insert({
      po_id, author_name: sender_name || 'System', message: msg, is_activity: true,
    }).catch(() => {})

    return new Response(JSON.stringify({ ok: true, resend_id: data?.id, to: to_emails, cc, attachments: attCount }), {
      status: 200, headers: JSON_HEADERS,
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 200, headers: JSON_HEADERS })
  }
})
