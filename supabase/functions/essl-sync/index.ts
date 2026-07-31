// essl-sync — receives fingerprint punches from the on-prem connector
// (which reads eTimeTrackLite's SQL Server DB read-only) and writes them into
// attendance_punches. Server-to-server: authenticated by a shared connector
// secret, NOT a Supabase user JWT. Uses the service role, so it runs behind
// the secret check + narrow inserts (never trusts arbitrary columns).
//
// Deploy: supabase functions deploy essl-sync --no-verify-jwt --project-ref <ref>
// Secret: supabase secrets set ESSL_CONNECTOR_SECRET=<random> --project-ref <ref>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CONNECTOR_SECRET = Deno.env.get('ESSL_CONNECTOR_SECRET') ?? ''
const DEFAULT_SOURCE = 'essl-etimetracklite'

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })

// YYYY-MM-DD in IST (work date)
const istDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

Deno.serve(async (req) => {
  // simple health check (no data, no secret needed)
  if (req.method === 'GET') return json({ ok: true, service: 'essl-sync' })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // auth: shared connector secret
  if (!CONNECTOR_SECRET) return json({ error: 'server not configured' }, 500)
  if (req.headers.get('x-connector-secret') !== CONNECTOR_SECRET) return json({ error: 'unauthorized' }, 401)

  let body: any
  try { body = await req.json() } catch { return json({ error: 'invalid json' }, 400) }
  const punches = Array.isArray(body?.punches) ? body.punches : null
  if (!punches) return json({ error: 'punches[] required' }, 400)
  const source = typeof body?.source === 'string' ? body.source : DEFAULT_SOURCE

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // validate + normalize
  const rows: { code: string; at: string; loc: string | null; ref: string; dir: 'in' | 'out' | null }[] = []
  const errors: { i: number; reason: string }[] = []
  punches.forEach((p: any, i: number) => {
    if (!p || typeof p.employee_code !== 'string' || !p.punch_at || typeof p.external_ref !== 'string') {
      errors.push({ i, reason: 'missing employee_code/punch_at/external_ref' }); return
    }
    const t = new Date(p.punch_at)
    if (isNaN(t.getTime())) { errors.push({ i, reason: 'bad punch_at' }); return }
    rows.push({
      code: p.employee_code.trim(), at: t.toISOString(),
      loc: typeof p.location === 'string' ? p.location.trim() : null,
      ref: p.external_ref, dir: p.direction === 'in' || p.direction === 'out' ? p.direction : null,
    })
  })
  if (rows.length === 0) return json({ received: punches.length, inserted: 0, duplicates: 0, errors }, 200)

  // bulk resolve employees — tolerant to zero-padding (021 == 21). An exact code always wins.
  // A stripped code that two different employees share ('010' and '10') is left OUT of the map
  // entirely: the old first-wins build depended on unordered row arrival, so it could attribute
  // one person's punches to another and change its mind between runs. Unresolvable codes now
  // surface in unmatched_codes instead.
  const strip = (s: string) => s.replace(/^0+/, '') || '0'
  const { data: emps } = await sb.from('employees').select('id, employee_code').not('employee_code', 'is', null)
  const empMap = new Map<string, string>()
  const byStrip = new Map<string, Set<string>>()
  for (const e of (emps ?? []) as any[]) {
    const c = String(e.employee_code).trim()
    if (!c) continue
    empMap.set(c, e.id)
    const s = strip(c)
    if (!byStrip.has(s)) byStrip.set(s, new Set())
    byStrip.get(s)!.add(e.id)
  }
  const ambiguousCodes: string[] = []
  for (const [s, ids] of byStrip) {
    if (ids.size > 1) { ambiguousCodes.push(s); continue }   // ambiguous → resolve by exact code only
    if (!empMap.has(s)) empMap.set(s, [...ids][0])
  }
  const locs = [...new Set(rows.map(r => r.loc).filter(Boolean))] as string[]
  const { data: lmap } = await sb.from('essl_location_map').select('essl_location, office_id, active')
    .in('essl_location', locs.length ? locs : ['__none__'])
  const locMap = new Map((lmap ?? []).filter((l: any) => l.active).map((l: any) => [l.essl_location, l.office_id]))

  // chronological → derive in/out per employee+day when the device didn't say
  rows.sort((a, b) => a.at.localeCompare(b.at))
  const unmatched = new Set<string>(), unmapped = new Set<string>()
  const seed = new Map<string, number>()
  const toInsert: any[] = []

  for (const r of rows) {
    const empId = empMap.get(r.code) ?? empMap.get(strip(r.code))
    if (!empId) { unmatched.add(r.code); continue }
    if (r.loc && !locMap.has(r.loc)) unmapped.add(r.loc)
    const officeId = r.loc ? (locMap.get(r.loc) ?? null) : null

    let dir = r.dir
    if (!dir) {
      // Count only punches EARLIER than this one, so direction is a function of the punch's
      // position in the day rather than of batch arrival order. The old code counted the whole
      // IST day (and used a 23:59:59 .lte bound that missed sub-second punches), so a punch
      // ingested out of order flipped in/out for every punch after it. Rows are time-sorted
      // above, which keeps the cached seed valid within a batch.
      const day = istDate(r.at)
      const key = empId + '|' + day
      let n = seed.get(key)
      if (n === undefined) {
        const dayStart = new Date(day + 'T00:00:00+05:30').toISOString()
        const { count } = await sb.from('attendance_punches').select('id', { count: 'exact', head: true })
          .eq('employee_id', empId).eq('method', 'biometric').gte('punch_at', dayStart).lt('punch_at', r.at)
        n = count ?? 0
      }
      dir = n % 2 === 0 ? 'in' : 'out'
      seed.set(key, n + 1)
    }
    toInsert.push({
      employee_id: empId, punch_at: r.at, direction: dir, method: 'biometric',
      office_id: officeId, external_ref: r.ref, note: r.loc ? `eSSL:${r.loc}` : 'eSSL',
    })
  }

  // de-dupe against already-ingested refs (idempotent), then insert the fresh ones.
  //
  // Inserted in chunks, and a failed chunk is retried row-by-row. Previously this was ONE
  // insert for the whole batch, so a single rejected row (a concurrent run, or a retry after a
  // timeout where the insert had actually committed) failed all 500 — and because the
  // connector only advances its watermark on success, it re-sent the same poisoned batch every
  // 120s forever. Punches that never land cannot be reconstructed later, so one bad row must
  // never be able to block the rest.
  let inserted = 0, duplicates = 0
  if (toInsert.length) {
    const refs = toInsert.map(r => r.external_ref)
    const { data: exist } = await sb.from('attendance_punches').select('external_ref').in('external_ref', refs)
    const seen = new Set((exist ?? []).map((e: any) => e.external_ref))
    const fresh = toInsert.filter(r => !seen.has(r.external_ref))
    duplicates = toInsert.length - fresh.length

    const CHUNK = 100
    const hardFailures: { ref: string; reason: string }[] = []
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK)
      const { data, error } = await sb.from('attendance_punches').insert(chunk).select('id')
      if (!error) { inserted += data?.length ?? 0; continue }
      for (const row of chunk) {
        const { data: one, error: e1 } = await sb.from('attendance_punches').insert(row).select('id')
        if (e1) {
          // an already-present ref is benign — that is the case that used to poison the batch
          if (/duplicate key|unique constraint/i.test(e1.message)) duplicates++
          else hardFailures.push({ ref: row.external_ref, reason: e1.message })
        } else inserted += one?.length ?? 0
      }
    }
    // A genuine failure must NOT advance the watermark, or those punches are lost for good.
    // Rows that did land are skipped as duplicates on the connector's next attempt, so the
    // retry is idempotent — unlike before, a duplicate alone can no longer cause this.
    if (hardFailures.length) {
      return json({
        error: 'some punches could not be stored — watermark not advanced, connector will retry',
        stage: 'insert', received: punches.length, inserted, duplicates,
        failures: hardFailures.slice(0, 20), failure_count: hardFailures.length,
      }, 500)
    }
  }

  // advance the watermark
  const { data: st } = await sb.from('biometric_sync_state').select('rows_ingested').eq('source', source).maybeSingle()
  await sb.from('biometric_sync_state').upsert({
    source,
    last_external_ref: rows[rows.length - 1].ref,
    last_punch_at: rows[rows.length - 1].at,
    last_run_at: new Date().toISOString(),
    rows_ingested: (Number(st?.rows_ingested) || 0) + inserted,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source' })

  return json({
    received: punches.length, inserted, duplicates,
    unmatched_codes: [...unmatched], unmapped_locations: [...unmapped],
    ambiguous_codes: ambiguousCodes, errors,
  }, 200)
})
