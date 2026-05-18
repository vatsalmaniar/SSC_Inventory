import { useState, useRef, useEffect } from 'react'

// Common country dial codes; India default. Each entry: { code, flag, name, len }
// len = expected digit count for full validation. If a country has variable
// length, use a range like [min, max].
export const DIAL_CODES = [
  { code: '+91',  flag: '🇮🇳', name: 'India',          len: 10 },
  { code: '+1',   flag: '🇺🇸', name: 'USA / Canada',   len: 10 },
  { code: '+44',  flag: '🇬🇧', name: 'UK',             len: [10, 11] },
  { code: '+971', flag: '🇦🇪', name: 'UAE',            len: 9 },
  { code: '+966', flag: '🇸🇦', name: 'Saudi Arabia',   len: 9 },
  { code: '+65',  flag: '🇸🇬', name: 'Singapore',      len: 8 },
  { code: '+86',  flag: '🇨🇳', name: 'China',          len: 11 },
  { code: '+81',  flag: '🇯🇵', name: 'Japan',          len: [10, 11] },
  { code: '+49',  flag: '🇩🇪', name: 'Germany',        len: [10, 11] },
  { code: '+33',  flag: '🇫🇷', name: 'France',         len: 9 },
  { code: '+61',  flag: '🇦🇺', name: 'Australia',      len: 9 },
  { code: '+880', flag: '🇧🇩', name: 'Bangladesh',     len: 10 },
  { code: '+92',  flag: '🇵🇰', name: 'Pakistan',       len: 10 },
  { code: '+94',  flag: '🇱🇰', name: 'Sri Lanka',      len: 9 },
  { code: '+977', flag: '🇳🇵', name: 'Nepal',          len: 10 },
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

export default function PhoneInput({ dial, digits, onChange, placeholder = '', disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const entry = DIAL_CODES.find(c => c.code === dial) || DIAL_CODES[0]
  const valid = !digits || isValidPhone(dial, digits)

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'stretch', border: `1px solid ${valid ? '#e2e8f0' : '#fca5a5'}`, borderRadius: 8, background: 'white', overflow: 'visible' }}>
      <button type="button" disabled={disabled} onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#f8fafc', border: 'none', borderRight: '1px solid #e2e8f0', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', minWidth: 78, whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 15 }}>{entry.flag}</span>
        <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{entry.code}</span>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#64748b" strokeWidth="2"><path d="M3 5l3 3 3-3"/></svg>
      </button>
      <input
        type="tel"
        inputMode="numeric"
        value={digits}
        disabled={disabled}
        placeholder={placeholder || (Array.isArray(entry.len) ? `${entry.len[0]}–${entry.len[1]} digits` : `${entry.len} digits`)}
        onChange={e => onChange({ dial, digits: e.target.value.replace(/\D/g, '') })}
        style={{ flex: 1, border: 'none', padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', minWidth: 0 }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 9999, minWidth: 220, maxHeight: 260, overflowY: 'auto' }}>
          {DIAL_CODES.map(c => (
            <button key={c.code} type="button"
              onClick={() => { onChange({ dial: c.code, digits }); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 12px', background: c.code === dial ? '#eff6ff' : 'white', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
              <span style={{ fontSize: 15 }}>{c.flag}</span>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 600, minWidth: 44, color: '#0f172a' }}>{c.code}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
