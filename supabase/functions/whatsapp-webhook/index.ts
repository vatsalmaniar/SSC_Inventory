import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ── Meta delivery callbacks ────────────────────────────────────────────────
//
// Without this, every message sits at 'sent' forever and nobody can say whether
// a statement actually reached the customer. Meta posts status transitions
// (sent → delivered → read, or failed) and inbound replies here.
//
// Public by necessity — Meta cannot present a Supabase JWT — so it is protected
// two ways: a verify token on the GET handshake, and the payload is only ever
// matched against message IDs we already issued. Nothing is created from it.

const SB_URL = Deno.env.get('SUPABASE_URL')!
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || ''

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

serve(async (req) => {
  const url = new URL(req.url)

  // Meta's subscription handshake
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge') || ''
    if (mode === 'subscribe' && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 })
    }
    return new Response('forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })

  // Always 200 to Meta, whatever happens below: a non-200 makes it retry, and a
  // retry storm is worse than a dropped status update.
  try {
    const body = await req.json()
    const sb = createClient(SB_URL, SB_KEY)

    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const v = change?.value || {}

        for (const st of v.statuses || []) {
          const id = st?.id
          if (!id) continue
          const next = String(st.status || '').toLowerCase()
          if (!(next in RANK)) continue

          // Statuses can arrive out of order. Never walk a message backwards
          // from 'read' to 'delivered' just because a packet was late.
          const { data: row } = await sb.from('whatsapp_messages')
            .select('id, status').eq('wa_message_id', id).maybeSingle()
          if (!row) continue
          if ((RANK[next] ?? 0) <= (RANK[row.status] ?? 0) && next !== 'failed') continue

          const at = st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString()
          const patch: Record<string, unknown> = { status: next }
          if (next === 'delivered') patch.delivered_at = at
          if (next === 'read')      patch.read_at = at
          if (next === 'failed') {
            patch.failed_at = at
            patch.error_message = st?.errors?.[0]?.title || st?.errors?.[0]?.message || 'failed at Meta'
          }
          await sb.from('whatsapp_messages').update(patch).eq('id', row.id)
        }

        // Inbound replies. Recorded against the customer so accounts can see
        // "already paid" sitting next to the dues, rather than nowhere.
        for (const msg of v.messages || []) {
          const from = String(msg?.from || '').replace(/\D/g, '')
          if (!from) continue
          const text = msg?.text?.body || `[${msg?.type || 'message'}]`
          const { data: cust } = await sb.from('customers')
            .select('id').eq('whatsapp_no', '+' + from).maybeSingle()
          await sb.from('whatsapp_replies').insert({
            customer_id: cust?.id || null,
            from_number: '+' + from,
            wa_message_id: msg?.id || null,
            body: String(text).slice(0, 2000),
            received_at: msg?.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          })
        }
      }
    }
  } catch (_e) { /* swallow: see the note above about retries */ }

  return new Response('ok', { status: 200 })
})
