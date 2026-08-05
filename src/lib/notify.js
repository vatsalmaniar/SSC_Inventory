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
