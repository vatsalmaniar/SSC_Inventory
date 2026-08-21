import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// ── Dispatch notice ────────────────────────────────────────────────────────
//
// One WhatsApp message, with the invoice attached, when FC marks a batch
// delivered. Triggered by the database, not by the order screen: marking a
// delivery must never wait on — or fail because of — a notification.
//
// One message per dispatch, guaranteed by a unique index on dispatch_id rather
// than by hoping the trigger fires once. Re-clicking Delivered, a replayed
// trigger or a retried send all collide on that index and stop.

const SB_URL   = Deno.env.get('SUPABASE_URL')!
const SB_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') || ''
const WA_PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') || '1187516161121669'
const WA_TEMPLATE = Deno.env.get('WHATSAPP_DISPATCH_TEMPLATE') || 'dispatch_invoice'
const WA_LANG     = Deno.env.get('WHATSAPP_TEMPLATE_LANG') || 'en'
const JOB_SECRET  = Deno.env.get('JOB_SECRET') || ''
const GRAPH       = 'https://graph.facebook.com/v21.0'

const clean = (s: unknown) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim()

serve(async (req) => {
  const H = { 'Content-Type': 'application/json' }
  const out = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: H })

  let body: any = {}
  try { body = await req.json() } catch { /* fall through to the guard */ }
  if (!JOB_SECRET || body.secret !== JOB_SECRET) return out({ ok: false, error: 'Not allowed.' }, 403)

  const dispatchId = String(body.dispatch_id || '')
  if (!dispatchId) return out({ ok: false, error: 'missing dispatch' })
  if (!WA_TOKEN)   return out({ ok: false, error: 'WhatsApp not configured' })

  const sb = createClient(SB_URL, SB_KEY)

  try {
    // Already notified? The unique index would stop the insert anyway; this
    // just avoids uploading a PDF to Meta for nothing.
    const { data: existing } = await sb.from('whatsapp_messages')
      .select('id').eq('dispatch_id', dispatchId).maybeSingle()
    if (existing) return out({ ok: true, skipped: 'already notified' })

    const { data: d } = await sb.from('order_dispatches')
      .select('id, order_id, batch_no, invoice_number, invoice_pdf_url, einvoice_pdf_url, delivered_at')
      .eq('id', dispatchId).maybeSingle()
    if (!d) return out({ ok: false, error: 'dispatch not found' })
    if (!d.delivered_at) return out({ ok: true, skipped: 'not delivered' })

    // e-invoice preferred; the plain invoice is the fallback (8 of the last 895
    // deliveries have no e-invoice).
    const pdfUrl = d.einvoice_pdf_url || d.invoice_pdf_url
    if (!pdfUrl) return await note(sb, d.order_id, 'Invoice not sent on WhatsApp — no invoice PDF on this dispatch.', out)

    const { data: order } = await sb.from('orders')
      .select('id, order_number, po_number, customer_id, customer_name').eq('id', d.order_id).maybeSingle()
    if (!order) return out({ ok: false, error: 'order not found' })
    if (!order.customer_id) return await note(sb, d.order_id, 'Invoice not sent on WhatsApp — order is not linked to a customer.', out)

    const { data: cust } = await sb.from('customers')
      .select('id, customer_name, whatsapp_no, whatsapp_name, whatsapp_dispatch_auto, account_owner')
      .eq('id', order.customer_id).maybeSingle()
    if (!cust) return out({ ok: false, error: 'customer not found' })
    if (!cust.whatsapp_no) return await note(sb, d.order_id, 'Invoice not sent on WhatsApp — no WhatsApp number on file for this customer.', out)
    if (!cust.whatsapp_dispatch_auto) return await note(sb, d.order_id, 'Invoice not sent on WhatsApp — dispatch notices are switched off for this customer.', out)

    // Meta rejects empty template parameters, so nothing may be blank.
    const contact  = clean(cust.whatsapp_name || cust.customer_name) || 'Sir/Madam'
    const company  = clean(cust.customer_name || order.customer_name) || '—'
    const poNo     = clean(order.po_number) || '—'
    const orderNo  = clean(order.order_number) || '—'
    const invNo    = clean(d.invoice_number) || '—'
    const owner    = clean(cust.account_owner) || 'our accounts team'

    // Fetch our own invoice PDF and hand it to Meta. The customer never gets a
    // link to our storage.
    const file = await fetch(pdfUrl)
    if (!file.ok) return await note(sb, d.order_id, `Invoice not sent on WhatsApp — could not read the invoice PDF (HTTP ${file.status}).`, out)
    const bytes = new Uint8Array(await file.arrayBuffer())

    const filename = `Invoice ${invNo.replace(/[^\w \-.\/]/g, '').replace(/\//g, '-')}.pdf`
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', 'application/pdf')
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename)
    const up = await fetch(`${GRAPH}/${WA_PHONE_ID}/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${WA_TOKEN}` }, body: form,
    })
    const upJson = await up.json().catch(() => ({}))
    if (!up.ok || !upJson.id) {
      return await note(sb, d.order_id, `Invoice not sent on WhatsApp — ${upJson?.error?.message || 'media upload failed'}.`, out)
    }

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
            { type: 'body', parameters: [contact, company, poNo, orderNo, invNo, owner]
                .map(t => ({ type: 'text', text: t })) },
          ],
        },
      }),
    })
    const json = await res.json().catch(() => ({}))
    const waId = json?.messages?.[0]?.id || null

    await sb.from('whatsapp_messages').insert({
      customer_id: cust.id, dispatch_id: d.id, kind: 'dispatch',
      to_number: cust.whatsapp_no, to_name: cust.whatsapp_name || null,
      template_name: WA_TEMPLATE, source: 'single',
      wa_message_id: waId, status: res.ok && waId ? 'sent' : 'failed',
      error_message: res.ok && waId ? null : (json?.error?.message || `HTTP ${res.status}`),
      failed_at: res.ok && waId ? null : new Date().toISOString(),
    })

    if (!res.ok || !waId) {
      return await note(sb, d.order_id, `Invoice not sent on WhatsApp — ${json?.error?.message || 'WhatsApp refused the message'}.`, out)
    }
    return await note(sb, d.order_id,
      `Invoice ${invNo} sent on WhatsApp to ${contact} (${cust.whatsapp_no}).`, out, true)

  } catch (e) {
    return out({ ok: false, error: String((e as Error)?.message || e) })
  }
})

/** Leave a line on the order's activity timeline, so FC can see what happened
 *  without going looking for it. */
async function note(sb: any, orderId: string, message: string, out: (b: unknown) => Response, ok = false) {
  try {
    await sb.from('order_comments').insert({
      order_id: orderId, author_name: 'WhatsApp', message, tagged_users: [], is_activity: true,
    })
  } catch { /* the message mattered more than the note */ }
  return out({ ok, message })
}
