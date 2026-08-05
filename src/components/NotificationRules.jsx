import { useState, useEffect, useMemo } from 'react'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Loading from './Loading'

// ─────────────────────────────────────────────────────────────────────────────
// Two views of the SAME `notification_rules` rows, sharing one resolver so they
// can never disagree:
//   <NotificationRulesAdmin/>  — event-centric  (User Management)
//   <PersonNotifications/>     — person-centric (Employee 360)
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_LABELS = {
  admin: 'Admin', management: 'Management', ops: 'Ops', accounts: 'Accounts',
  sales: 'Sales', fc_kaveri: 'FC Kaveri', fc_godawari: 'FC Godawari', demo: 'Demo',
}

/** The single definition of "does this person receive this event". */
export function personReceives(rule, person) {
  if (!rule?.is_active) return false
  if ((rule.exclude_user_ids || []).includes(person.id)) return false
  return (rule.roles || []).includes(person.role)
      || (rule.extra_user_ids || []).includes(person.id)
}

function byRole(rule, person) { return (rule.roles || []).includes(person.role) }

async function saveRule(eventKey, patch) {
  const { error } = await sb.from('notification_rules')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('event_key', eventKey)
  if (error) { toast(friendlyError(error, 'Could not save. Admin only.'), 'error'); return false }
  return true
}

function Chip({ children, onRemove, tone = 'neutral' }) {
  const tones = {
    neutral: { bg:'var(--gray-50)',  color:'var(--gray-800)', border:'var(--gray-200)' },
    role:    { bg:'#eff6ff', color:'#1d4ed8', border:'#bfdbfe' },
    person:  { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
    blocked: { bg:'#fef2f2', color:'#dc2626', border:'#fecaca' },
  }[tone]
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6, padding:'3px 8px', borderRadius:6,
      fontSize:11.5, fontWeight:500, background:tones.bg, color:tones.color, border:'1px solid '+tones.border,
    }}>
      {children}
      {onRemove && (
        <button onClick={onRemove} title="Remove"
          style={{ border:'none', background:'none', cursor:'pointer', color:'inherit', fontSize:13, lineHeight:1, padding:0, opacity:0.7 }}>×</button>
      )}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT-CENTRIC — User Management
// ═══════════════════════════════════════════════════════════════════════════
export function NotificationRulesAdmin() {
  const [rules, setRules]     = useState([])
  const [people, setPeople]   = useState([])
  const [loading, setLoading] = useState(true)
  const [openKey, setOpenKey] = useState(null)
  const [busy, setBusy]       = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: r }, { data: p }] = await Promise.all([
      sb.from('notification_rules').select('*').order('module').order('event_key'),
      sb.from('profiles').select('id,name,username,email,role').order('name'),
    ])
    setRules(r || []); setPeople(p || []); setLoading(false)
  }

  async function patch(rule, changes) {
    setBusy(rule.event_key)
    const ok = await saveRule(rule.event_key, changes)
    setBusy(null)
    if (!ok) return
    setRules(prev => prev.map(x => x.event_key === rule.event_key ? { ...x, ...changes } : x))
    toast('Recipients updated', 'success')
  }

  if (loading) return <Loading />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div className="card" style={{ padding:14, background:'#fffbeb', borderColor:'#fde68a' }}>
        <div style={{ fontSize:12, color:'#92400e', lineHeight:1.6 }}>
          <strong>Who gets notified.</strong> Recipients live here, not in code — changes take effect on the
          next event, with no deploy. A person receives an event if their <strong>role</strong> is listed or they
          are named individually, and they are not excluded. Sales is deliberately not on any procurement event.
        </div>
      </div>

      {rules.map(rule => {
        const resolved = people.filter(p => personReceives(rule, p))
        const open = openKey === rule.event_key
        const isBusy = busy === rule.event_key
        const named   = people.filter(p => (rule.extra_user_ids || []).includes(p.id))
        const blocked = people.filter(p => (rule.exclude_user_ids || []).includes(p.id))

        return (
          <div key={rule.event_key} className="card" style={{ padding:0, opacity:isBusy ? 0.6 : 1 }}>
            <div onClick={() => setOpenKey(open ? null : rule.event_key)}
              style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:600, fontSize:14, color:'var(--gray-800)' }}>{rule.label}</div>
                <div style={{ fontSize:11.5, color:'var(--gray-500)', marginTop:2 }}>{rule.description}</div>
              </div>
              <span className="meta-pill" style={{ flexShrink:0 }}>
                <span style={{ fontWeight:600 }}>{resolved.length}</span>
                <span className="meta-label" style={{ marginLeft:4 }}>PEOPLE</span>
              </span>
              <span style={{ color:'var(--gray-500)', fontSize:12 }}>{open ? '▴' : '▾'}</span>
            </div>

            {open && (
              <div style={{ padding:'0 16px 14px', display:'flex', flexDirection:'column', gap:12, borderTop:'1px solid var(--gray-200)' }}>
                {/* Roles */}
                <Field label="By role">
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                    {(rule.roles || []).map(r => (
                      <Chip key={r} tone="role"
                        onRemove={() => patch(rule, { roles: rule.roles.filter(x => x !== r) })}>
                        {ROLE_LABELS[r] || r}
                      </Chip>
                    ))}
                    <AddSelect
                      placeholder="+ add role"
                      options={Object.keys(ROLE_LABELS).filter(r => !(rule.roles || []).includes(r)).map(r => ({ v:r, l:ROLE_LABELS[r] }))}
                      onPick={v => patch(rule, { roles: [...(rule.roles || []), v] })}
                    />
                  </div>
                </Field>

                {/* Named individuals */}
                <Field label="Also notify (regardless of role)">
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                    {named.map(p => (
                      <Chip key={p.id} tone="person"
                        onRemove={() => patch(rule, { extra_user_ids: rule.extra_user_ids.filter(x => x !== p.id) })}>
                        {p.name}
                      </Chip>
                    ))}
                    <AddSelect
                      placeholder="+ add person"
                      options={people.filter(p => !personReceives(rule, p)).map(p => ({ v:p.id, l:`${p.name} · ${ROLE_LABELS[p.role] || p.role}` }))}
                      onPick={v => patch(rule, {
                        extra_user_ids: [...(rule.extra_user_ids || []), v],
                        exclude_user_ids: (rule.exclude_user_ids || []).filter(x => x !== v),
                      })}
                    />
                  </div>
                </Field>

                {/* Exclusions */}
                {blocked.length > 0 && (
                  <Field label="Excluded">
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {blocked.map(p => (
                        <Chip key={p.id} tone="blocked"
                          onRemove={() => patch(rule, { exclude_user_ids: rule.exclude_user_ids.filter(x => x !== p.id) })}>
                          {p.name}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                )}

                <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12.5, color:'var(--gray-800)', cursor:'pointer' }}>
                  <input type="checkbox" checked={rule.exclude_actor}
                    onChange={e => patch(rule, { exclude_actor: e.target.checked })} />
                  Don’t notify the person who performed the action
                </label>

                {/* Preview — see exactly who, before trusting it */}
                <Field label={`Will notify · ${resolved.length}`}>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {resolved.length === 0
                      ? <span style={{ fontSize:12, color:'var(--gray-500)' }}>Nobody — this event will be silent.</span>
                      : resolved.map(p => (
                          <Chip key={p.id}
                            onRemove={byRole(rule, p)
                              ? () => patch(rule, { exclude_user_ids: [...(rule.exclude_user_ids || []), p.id] })
                              : () => patch(rule, { extra_user_ids: rule.extra_user_ids.filter(x => x !== p.id) })}>
                            {p.name}
                          </Chip>
                        ))}
                  </div>
                </Field>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <div className="mono" style={{ fontSize:10, color:'var(--gray-500)', letterSpacing:'0.06em', marginBottom:5, marginTop:10 }}>
        {label.toUpperCase()}
      </div>
      {children}
    </div>
  )
}

function AddSelect({ options, onPick, placeholder }) {
  const [v, setV] = useState('')
  return (
    <select value={v} onChange={e => { if (e.target.value) { onPick(e.target.value); setV('') } }}
      style={{ padding:'4px 8px', fontSize:11.5, borderRadius:6, border:'1px dashed var(--gray-200)',
               background:'#fff', color:'var(--gray-500)', cursor:'pointer', fontFamily:'inherit' }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSON-CENTRIC — Employee 360
// ═══════════════════════════════════════════════════════════════════════════
export function PersonNotifications({ profileId, personName }) {
  const [rules, setRules]   = useState([])
  const [person, setPerson] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]     = useState(null)

  useEffect(() => { if (profileId) load() }, [profileId])

  async function load() {
    const [{ data: r }, { data: p }] = await Promise.all([
      sb.from('notification_rules').select('*').order('module').order('event_key'),
      sb.from('profiles').select('id,name,username,email,role').eq('id', profileId).maybeSingle(),
    ])
    setRules(r || []); setPerson(p || null); setLoading(false)
  }

  // Toggling one person on/off has to respect HOW they qualify: someone covered
  // by their role is turned off by excluding them, while someone named
  // individually is turned off by removing the name. Getting this wrong would
  // silently un-notify their whole role.
  async function toggle(rule, on) {
    if (!person) return
    setBusy(rule.event_key)
    const changes = on
      ? byRole(rule, person)
        ? { exclude_user_ids: (rule.exclude_user_ids || []).filter(x => x !== person.id) }
        : { extra_user_ids: [...new Set([...(rule.extra_user_ids || []), person.id])],
            exclude_user_ids: (rule.exclude_user_ids || []).filter(x => x !== person.id) }
      : byRole(rule, person)
        ? { exclude_user_ids: [...new Set([...(rule.exclude_user_ids || []), person.id])] }
        : { extra_user_ids: (rule.extra_user_ids || []).filter(x => x !== person.id) }

    const ok = await saveRule(rule.event_key, changes)
    setBusy(null)
    if (!ok) return
    setRules(prev => prev.map(x => x.event_key === rule.event_key ? { ...x, ...changes } : x))
    toast(on ? `${personName} will receive this` : `${personName} muted for this event`, 'success')
  }

  if (loading) return <Loading />
  if (!person) return <div style={{ fontSize:12.5, color:'var(--gray-500)' }}>No login linked — nothing to notify.</div>

  const on = rules.filter(r => personReceives(r, person)).length

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:12, color:'var(--gray-500)', lineHeight:1.55 }}>
        Receiving <strong style={{ color:'var(--gray-800)' }}>{on} of {rules.length}</strong> procurement events.
        Mail goes to <strong style={{ color:'var(--gray-800)' }}>{person.email || `${person.username}@ssccontrol.com`}</strong>
        {!person.email && ' (default)'}.
      </div>

      {rules.map(rule => {
        const gets = personReceives(rule, person)
        const via  = byRole(rule, person) ? `via ${ROLE_LABELS[person.role] || person.role}` : 'named individually'
        return (
          <div key={rule.event_key}
            style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px',
                     border:'1px solid var(--gray-200)', borderRadius:9, background:'#fff',
                     opacity: busy === rule.event_key ? 0.5 : 1 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, fontWeight:500, color:'var(--gray-800)' }}>{rule.label}</div>
              <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>
                {gets ? via : 'Not receiving'}
              </div>
            </div>
            <button onClick={() => toggle(rule, !gets)} disabled={busy === rule.event_key}
              style={{ padding:'5px 12px', fontSize:11.5, fontWeight:600, borderRadius:7, cursor:'pointer',
                       background: gets ? '#f0fdf4' : 'var(--gray-50)',
                       color:      gets ? '#15803d' : 'var(--gray-500)',
                       border: '1px solid ' + (gets ? '#bbf7d0' : 'var(--gray-200)') }}>
              {gets ? '● On' : 'Off'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
