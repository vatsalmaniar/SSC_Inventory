import { useState, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Gmail-style To / Cc / Bcc rows.
//
// Replaces a fixed checkbox list plus one free-text box, where the Cc list was
// hardcoded in the edge function and shown to the user as read-only text. Every
// address is now visible, addable and removable.
//
// Addresses are validated here AND again in the edge function — this layer is
// for the person typing, not for security.
// ─────────────────────────────────────────────────────────────────────────────

export const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[a-z]{2,}$/i

function Chip({ addr, onRemove, disabled }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6, maxWidth:'100%',
      padding:'3px 6px 3px 10px', borderRadius:14, background:'var(--gray-100)',
      border:'1px solid var(--gray-200)', fontSize:12.5, color:'var(--gray-800)',
    }}>
      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{addr}</span>
      {!disabled && (
        <button type="button" onClick={() => onRemove(addr)} aria-label={`Remove ${addr}`}
          style={{ border:'none', background:'none', cursor:'pointer', color:'var(--gray-500)',
                   fontSize:15, lineHeight:1, padding:'0 2px', minWidth:22, minHeight:22 }}>×</button>
      )}
    </span>
  )
}

/** One labelled row of address chips plus a free-text input. */
export function RecipientRow({ label, value, onChange, suggestions = [], disabled, autoFocus, right }) {
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  function add(raw) {
    // Accept pasted lists: "a@b.com, c@d.com" or newline-separated
    const parts = String(raw).split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return
    const bad = parts.filter(p => !EMAIL_RE.test(p))
    if (bad.length) { setErr(`Not a valid email: ${bad[0]}`); return }
    const next = [...value]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next); setDraft(''); setErr('')
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
      if (draft.trim()) { e.preventDefault(); add(draft) }
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))   // Gmail behaviour: backspace eats the last chip
    }
  }

  const unused = suggestions.filter(s => !value.includes(s.email.toLowerCase()))

  return (
    <div style={{ borderBottom:'1px solid var(--gray-200)', padding:'8px 0' }}>
      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <span style={{ fontSize:13, color:'var(--gray-500)', paddingTop:6, minWidth:34, flexShrink:0 }}>{label}</span>
        <div style={{ flex:1, minWidth:0, display:'flex', flexWrap:'wrap', gap:6, alignItems:'center' }}>
          {value.map(a => <Chip key={a} addr={a} onRemove={x => onChange(value.filter(v => v !== x))} disabled={disabled} />)}
          <input
            ref={inputRef}
            value={draft}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={e => { setDraft(e.target.value); if (err) setErr('') }}
            onKeyDown={onKeyDown}
            onBlur={() => draft.trim() && add(draft)}
            onPaste={e => {
              const t = e.clipboardData.getData('text')
              if (/[,;\s]/.test(t)) { e.preventDefault(); add(t) }
            }}
            placeholder={value.length ? '' : 'Type an email and press Enter'}
            style={{
              flex:'1 1 160px', minWidth:120, border:'none', outline:'none',
              fontSize:16,          // 16px stops iOS zooming the page on focus
              fontFamily:'inherit', color:'var(--gray-800)', background:'transparent', padding:'6px 0',
            }} />
        </div>
        {right && <div style={{ flexShrink:0, paddingTop:4 }}>{right}</div>}
      </div>

      {err && <div style={{ fontSize:11.5, color:'#dc2626', paddingLeft:44, paddingBottom:4 }}>{err}</div>}

      {unused.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, paddingLeft:44, paddingTop:2, paddingBottom:2 }}>
          {unused.map(s => (
            <button key={s.email} type="button" disabled={disabled}
              onClick={() => onChange([...value, s.email.toLowerCase()])}
              title={s.email}
              style={{ fontSize:11, padding:'3px 9px', borderRadius:12, cursor:'pointer',
                       border:'1px dashed var(--gray-300)', background:'transparent', color:'var(--gray-600)',
                       maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              + {s.name || s.email}{s.role ? ` · ${s.role}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The whole To/Cc/Bcc block, with Cc and Bcc revealed on demand like Gmail. */
export function RecipientFields({ to, cc, bcc, setTo, setCc, setBcc, suggestions, disabled }) {
  const [showCc, setShowCc]   = useState(cc.length > 0)
  const [showBcc, setShowBcc] = useState(bcc.length > 0)

  const toggle = (on, set, label) => (
    <button type="button" onClick={() => set(v => !v)} disabled={disabled}
      style={{ border:'none', background:'none', cursor:'pointer', padding:'4px 6px',
               fontSize:12.5, fontWeight:500, color: on ? 'var(--gray-800)' : 'var(--gray-500)' }}>
      {label}
    </button>
  )

  return (
    <div>
      <RecipientRow
        label="To" value={to} onChange={setTo} suggestions={suggestions} disabled={disabled} autoFocus
        right={
          <span style={{ display:'flex' }}>
            {!showCc  && toggle(showCc,  setShowCc,  'Cc')}
            {!showBcc && toggle(showBcc, setShowBcc, 'Bcc')}
          </span>
        } />
      {showCc  && <RecipientRow label="Cc"  value={cc}  onChange={setCc}  disabled={disabled} />}
      {showBcc && <RecipientRow label="Bcc" value={bcc} onChange={setBcc} disabled={disabled} />}
    </div>
  )
}
