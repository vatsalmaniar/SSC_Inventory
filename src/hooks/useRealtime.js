import { useEffect, useRef } from 'react'
import { sb } from '../lib/supabase'

/**
 * Subscribe to Supabase Realtime postgres_changes on a table.
 *
 * @param {string}   channelName  - Unique channel name, e.g. "notifications-abc123"
 * @param {object}   opts
 * @param {string}   opts.table   - Table name
 * @param {string}   [opts.event] - 'INSERT' | 'UPDATE' | 'DELETE' | '*' (default '*')
 * @param {string}   [opts.filter]- e.g. 'order_id=eq.xyz'
 * @param {function} opts.onEvent - Callback receiving the payload
 * @param {boolean}  [opts.enabled] - Pass false to skip subscribing
 */
export function useRealtimeSubscription(channelName, opts) {
  const callbackRef = useRef(opts.onEvent)
  callbackRef.current = opts.onEvent

  useEffect(() => {
    if (opts.enabled === false || !opts.table) return

    const config = {
      event:  opts.event  || '*',
      schema: opts.schema || 'public',
      table:  opts.table,
    }
    if (opts.filter) config.filter = opts.filter

    const channel = sb
      .channel(channelName)
      .on('postgres_changes', config, (payload) => callbackRef.current(payload))
      .subscribe()

    return () => sb.removeChannel(channel)
  }, [channelName, opts.table, opts.filter, opts.enabled])
}
