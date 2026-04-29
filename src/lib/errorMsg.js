// Convert technical Postgres / Supabase / network errors into human-friendly toast messages.
// Always console.error the original so DevTools shows it for debugging.
export function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  const raw = err?.message || err?.error_description || err?.error || String(err || '')
  const msg = raw.toLowerCase()

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
