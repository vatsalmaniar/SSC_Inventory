import { useState, useRef, useEffect } from 'react'

// Common country dial codes; India default. Each entry: { code, flag, name, len }
// len = expected digit count for full validation. If a country has variable
// length, use a range like [min, max].
export const DIAL_CODES = [
  { iso: 'IN', code: '+91',  flag: '🇮🇳', name: 'India',          len: 10 },
  { iso: 'US', code: '+1',   flag: '🇺🇸', name: 'USA / Canada',   len: 10 },
  { iso: 'GB', code: '+44',  flag: '🇬🇧', name: 'UK',             len: [10, 11] },
  { iso: 'AE', code: '+971', flag: '🇦🇪', name: 'UAE',            len: 9 },
  { iso: 'SA', code: '+966', flag: '🇸🇦', name: 'Saudi Arabia',   len: 9 },
  { iso: 'SG', code: '+65',  flag: '🇸🇬', name: 'Singapore',      len: 8 },
  { iso: 'CN', code: '+86',  flag: '🇨🇳', name: 'China',          len: 11 },
  { iso: 'JP', code: '+81',  flag: '🇯🇵', name: 'Japan',          len: [10, 11] },
  { iso: 'DE', code: '+49',  flag: '🇩🇪', name: 'Germany',        len: [10, 11] },
  { iso: 'FR', code: '+33',  flag: '🇫🇷', name: 'France',         len: 9 },
  { iso: 'AU', code: '+61',  flag: '🇦🇺', name: 'Australia',      len: 9 },
  { iso: 'BD', code: '+880', flag: '🇧🇩', name: 'Bangladesh',     len: 10 },
  { iso: 'PK', code: '+92',  flag: '🇵🇰', name: 'Pakistan',       len: 10 },
  { iso: 'LK', code: '+94',  flag: '🇱🇰', name: 'Sri Lanka',      len: 9 },
  { iso: 'NP', code: '+977', flag: '🇳🇵', name: 'Nepal',          len: 10 },
]

export function isValidPhone(dialCode, digits) {
  if (!digits) return false
  const d = String(digits).replace(/\D/g, '')
  const entry = DIAL_CODES.find(c => c.code === dialCode)
  if (!entry) return d.length >= 7 && d.length <= 15
  if (Array.isArray(entry.len)) return d.length >= entry.len[0] && d.length <= entry.len[1]
  return d.length === entry.len
}

export function isValidEmail(s) {
  if (!s) return true                                  // empty is fine; we only validate non-empty
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim())
}

// Read-only display of a stored phone string. Renders flag + dial code + digits.
// Use inside a span/link wrapper; doesn't apply colors itself.
export function PhoneDisplay({ value }) {
  if (!value) return <>—</>
  const { dial, digits } = splitPhone(value)
  if (!digits) return <>—</>
  const entry = DIAL_CODES.find(c => c.code === dial) || DIAL_CODES[0]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: '0.9em', lineHeight: 1 }}>{entry.flag}</span>
      <span>{dial} {digits}</span>
    </span>
  )
}

// Split a stored phone string (e.g. "+919876543210") into { dial, digits }
export function splitPhone(stored) {
  const s = String(stored || '').trim()
  if (!s) return { dial: '+91', digits: '' }
  for (const c of DIAL_CODES) {
    if (s.startsWith(c.code)) return { dial: c.code, digits: s.slice(c.code.length).replace(/\D/g, '') }
  }
  // No recognised prefix — treat all digits as local; default India
  return { dial: '+91', digits: s.replace(/\D/g, '') }
}

export default function PhoneInput({ dial, digits, onChange, label = null, placeholder = '', disabled = false }) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const entry = DIAL_CODES.find(c => c.code === dial) || DIAL_CODES[0]
  const valid = !digits || isValidPhone(dial, digits)

  const accentColor = !valid ? '#dc2626' : (focused || open) ? '#5a3df0' : '#e2e8f0'
  const borderWidth = (focused || open || !valid) ? 2 : 1

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'stretch', borderRadius: 12, border: `${borderWidth}px solid ${accentColor}`, background: 'white', overflow: 'visible', transition: 'border-color 0.12s, border-width 0.12s' }}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: '#f8fafc', border: 'none', borderRight: '1px solid #eef2f7', borderRadius: '11px 0 0 11px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', minWidth: 76 }}>
        <span style={{ fontSize: 20, lineHeight: 1 }}>{entry.flag}</span>
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#64748b" strokeWidth="2" style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}><path d="M3 5l3 3 3-3"/></svg>
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: label ? '8px 14px' : '10px 14px', minWidth: 0 }}>
        {label && <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.2, marginBottom: 2 }}>{label}</div>}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 16, color: '#0f172a', fontWeight: 500 }}>{entry.code}</span>
          <input
            type="tel"
            inputMode="numeric"
            value={digits}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder || (Array.isArray(entry.len) ? `${entry.len[0]}–${entry.len[1]} digits` : `${'0'.repeat(Math.min(entry.len, 10))}`)}
            onChange={e => onChange({ dial, digits: e.target.value.replace(/\D/g, '') })}
            style={{ flex: 1, border: 'none', padding: 0, fontSize: 16, fontFamily: 'inherit', outline: 'none', minWidth: 0, background: 'transparent', color: '#0f172a', fontWeight: 500 }}
          />
        </div>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 9999, minWidth: 240, maxHeight: 280, overflowY: 'auto' }}>
          {DIAL_CODES.map(c => (
            <button key={c.code} type="button"
              onClick={() => { onChange({ dial: c.code, digits }); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', background: c.code === dial ? '#f5f3ff' : 'white', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              <span style={{ fontSize: 17 }}>{c.flag}</span>
              <span style={{ fontWeight: 600, minWidth: 28, color: '#0f172a' }}>{c.iso}</span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, minWidth: 48, color: '#475569' }}>{c.code}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
