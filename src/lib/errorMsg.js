// Convert technical Postgres / Supabase / network errors into human-friendly toast messages.
// Always console.error the original so DevTools shows it for debugging.
export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  const raw = err?.message || err?.error_description || err?.error || String(err || '')
  const msg = raw.toLowerCase()

  // Two live prices for the same item, customer, vendor and quantity break. The
  // supported way to change a rate is "New rate" (supersede_item_price), which
  // closes the old record and opens the new one in one transaction. Without
  // this line the buyer sees the raw "conflicting key value violates exclusion
  // constraint" and reads a working rule as a broken screen.
  if (msg.includes('item_prices_no_overlap') || msg.includes('uq_item_price_open'))
    return 'A price for this item is already in force over these dates. Use "New rate" on the existing price instead of adding a second one.'
  // These triggers already raise a message written FOR the user, naming the
  // brand and what to do. friendlyError was swallowing them into "Something
  // went wrong", which left a buyer blocked with no idea why.
  if (raw.includes('cannot be approved without a reason')) return raw
  if (raw.includes('is already issued and cannot be changed')) return raw
  // block_superseded_item names the replacement code. Swallowing it into
  // "Something went wrong" would leave a salesperson with a dead end instead of
  // the one piece of information they need — which code to use.
  if (raw.includes('has been superseded')) return raw
  if (raw.includes('is discontinued and cannot be added')) return raw
  if (msg.includes('item_prices_approval_shape'))
    return 'A price has to be approved by someone other than the person who entered it.'
  if (msg.includes('duplicate key') || msg.includes('unique constraint')) return 'This already exists.'
  if (msg.includes('schema cache') || msg.includes('does not exist'))     return 'System needs an update — please contact admin.'
  if (msg.includes('row-level security') || msg.includes('rls') || msg.includes('permission denied')) return "You don't have permission to do this."
  if (msg.includes('null value') || msg.includes('not-null'))             return 'A required field is missing.'
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) return 'Network problem — please check your connection and try again.'
  if (msg.includes('timeout'))                                            return 'The request took too long. Please try again.'
  if (msg.includes('foreign key'))                                        return 'Linked record is missing. Please refresh and retry.'
  if (msg.includes('jwt') || msg.includes('expired') || msg.includes('not authenticated')) return 'Your session expired — please log out and log in again.'
  if (msg.includes('check constraint'))                                   return 'Some values are out of allowed range. Please review and try again.'
  if (msg.includes('size') && (msg.includes('too large') || msg.includes('exceed'))) return 'File is too large. Try a smaller one.'
  if (msg.includes('not found'))                                          return 'Record not found. Please refresh and try again.'

  // Unknown — log it so we can debug, return the fallback
  console.error('[friendlyError fallback]', err)
  return fallback
}
