import { sb } from './supabase'

// ─────────────────────────────────────────────────────────────────────────────
// One dispatch path for procurement notifications.
//
// Recipients used to be hardcoded role arrays inside page components, copied
// (and drifted) across three pages. They now live in `notification_rules`, so
// adding or removing someone is a data change, not a deploy.
//
// SCOPE: procurement events only. The ~20,600 sales / dispatch / billing emails
// a month keep their existing inline inserts — this is new surface beside them,
// not a refactor of them.
//
// A notification must NEVER break the business action that triggered it.
// Cancelling a PO has to succeed even if the notify insert fails, so nothing in
// here throws: callers get { sent, recipients, error } and may log it.
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve who should receive an event, without sending. Used by the admin preview. */
export async function resolveRecipients(eventKey, { actorId = null, toUserIds = null, alsoUserIds = null } = {}) {
  const { data: rule, error: ruleErr } = await sb
    .from('notification_rules').select('*').eq('event_key', eventKey).maybeSingle()

  if (ruleErr) return { rule: null, recipients: [], error: ruleErr }
  // No rule = no guess. Silently mailing a fallback list is how the hardcoded
  // arrays drifted in the first place.
  if (!rule) return { rule: null, recipients: [], error: new Error(`No notification rule for "${eventKey}"`) }
  if (!rule.is_active) return { rule, recipients: [], error: null }

  const { data: people, error: pplErr } = await sb
    .from('profiles').select('id,name,username,email,role')
  if (pplErr) return { rule, recipients: [], error: pplErr }

  // alsoUserIds: people this SPECIFIC event concerns who cannot be named in a
  // static rule — above all the PO's own creator, which differs per PO.
  const extra   = new Set([...(rule.extra_user_ids || []), ...(alsoUserIds || []).filter(Boolean)])
  const blocked = new Set(rule.exclude_user_ids || [])
  const roles   = rule.roles || []
  // Explicit targets (e.g. @-mentions) are the whole list — roles don't widen it.
  const explicit = toUserIds ? new Set(toUserIds) : null

  const recipients = (people || []).filter(p => {
    if (blocked.has(p.id)) return false
    if (rule.exclude_actor && actorId && p.id === actorId) return false
    if (explicit) return explicit.has(p.id)
    return roles.includes(p.role) || extra.has(p.id)
  })

  return { rule, recipients, error: null }
}

/**
 * Send a procurement notification.
 *
 * @param eventKey  key in notification_rules, e.g. 'po_placed'
 * @param payload   { message, po_id, order_id, order_number, actorId, actorName, toUserIds }
 */
export async function notify(eventKey, payload = {}) {
  const { message, po_id = null, order_id = null, order_number = null,
          actorId = null, actorName = null, toUserIds = null, alsoUserIds = null } = payload

  const { rule, recipients, error } = await resolveRecipients(eventKey, { actorId, toUserIds, alsoUserIds })
  if (error)            { console.error('notify:', eventKey, error); return { sent: 0, recipients: [], error } }
  if (!recipients.length) return { sent: 0, recipients: [], error: null }

  const rows = recipients.map(r => ({
    user_id:      r.id,
    user_name:    r.name,
    message,
    po_id,
    order_id,
    order_number,
    from_name:    actorName,
    email_type:   eventKey,
  }))

  // External CC rides on ONE row only. notifications.user_id references
  // profiles, so an address without a login can never have its own row; and
  // putting the cc on all of them would mail the outsider once per recipient.
  const cc = (rule.cc_emails || []).filter(Boolean)
  if (cc.length) rows[0].cc_emails = cc

  const { error: insErr } = await sb.from('notifications').insert(rows)
  if (insErr) { console.error('notify insert:', eventKey, insErr); return { sent: 0, recipients, error: insErr } }

  return { sent: rows.length, recipients, error: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORDER-JOURNEY DISPATCH  (added 2026-09-04)
//
// The order journey used to hardcode role arrays inside BillingOrderDetail,
// FCOrderDetail and OrderDetail — three copies, unchangeable without a deploy,
// and the reason ~31,000 emails went out every 60 days (520/day). Recipients and
// channels now come from `notification_rules`, so who-gets-what is a data change
// you make from the admin screen.
//
// Two lists per event:
//   roles        -> receives the BELL
//   email_roles  -> ALSO receives an email (a subset of the above)
//
// Both accept static roles (accounts, ops, fc_kaveri…) plus three tokens resolved
// per order: 'creator' (who raised it), 'owner' (account owner) and 'fc' (this
// order's own fulfilment centre).
//
// Per-recipient email control works by setting email_type only on the rows that
// should be mailed — the edge function skips any notification without one. So a
// bell-only recipient costs nothing and still sees the event in-app.
// ─────────────────────────────────────────────────────────────────────────────

/** Expand role tokens for one order into a set of profile ids. */
function expandTargets(tokens, { profiles, order, fcRole }) {
  const ids = new Set()
  const has = t => (tokens || []).includes(t)
  const staticRoles = (tokens || []).filter(t => !['creator', 'owner', 'fc'].includes(t))
  const roles = has('fc') && fcRole ? [...staticRoles, fcRole] : staticRoles
  if (roles.length) profiles.filter(p => roles.includes(p.role)).forEach(p => ids.add(p.id))
  if (has('creator') && order?.created_by) ids.add(order.created_by)
  if (has('owner')) {
    const ownerName = order?.account_owner || order?.engineer_name || ''
    const owner = ownerName ? profiles.find(p => p.name === ownerName) : null
    if (owner) ids.add(owner.id)
  }
  return ids
}

/**
 * Notify an order-journey event from notification_rules.
 *
 * @param eventKey  e.g. 'order_dispatched', 'invoice_generated'
 * @param ctx       { message, order, orderId, profiles, actorId, actorName, fcRole }
 * Never throws: a notification must not be able to fail the business action.
 */
export async function notifyOrderEvent(eventKey, ctx = {}) {
  const { message, order, orderId, profiles = [], actorId = null, actorName = null, fcRole = null } = ctx
  try {
    const { data: rule, error } = await sb
      .from('notification_rules').select('*').eq('event_key', eventKey).maybeSingle()
    // No rule, inactive, or a lookup failure must not silence the event — fall back to
    // notifying the order's own people so nothing is ever lost by a missing config row.
    const fallback = { roles: ['creator', 'owner'], email_roles: ['creator', 'owner'], bell_enabled: true, email_enabled: true, exclude_actor: true, is_active: true }
    const r = (error || !rule || !rule.is_active) ? fallback : rule
    if (error) console.warn('notifyOrderEvent: rule lookup failed, using fallback', eventKey, error.message)
    if (!r.bell_enabled) return { sent: 0 }

    const bell  = expandTargets(r.roles, { profiles, order, fcRole })
    const mail  = r.email_enabled ? expandTargets(r.email_roles, { profiles, order, fcRole }) : new Set()
    if (r.exclude_actor && actorId) { bell.delete(actorId); mail.delete(actorId) }
    ;(r.exclude_user_ids || []).forEach(id => { bell.delete(id); mail.delete(id) })
    if (!bell.size) return { sent: 0 }

    const byId = new Map(profiles.map(p => [p.id, p]))
    const rows = [...bell].filter(id => byId.has(id)).map(id => ({
      user_id: id, user_name: byId.get(id).name, message,
      order_id: orderId || null, order_number: order?.order_number || '',
      from_name: actorName,
      // email_type present => the edge function mails it; absent => bell only.
      email_type: mail.has(id) ? eventKey : null,
    }))
    if (!rows.length) return { sent: 0 }
    const { error: insErr } = await sb.from('notifications').insert(rows)
    if (insErr) { console.error('notifyOrderEvent insert:', eventKey, insErr); return { sent: 0, error: insErr } }
    return { sent: rows.length, emailed: rows.filter(x => x.email_type).length }
  } catch (e) {
    console.error('notifyOrderEvent:', eventKey, e)
    return { sent: 0, error: e }
  }
}
