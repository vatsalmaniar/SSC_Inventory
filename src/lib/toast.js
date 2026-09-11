// Toast — one implementation, used by ~690 call sites.
//
// API IS UNCHANGED: toast(message, type). Every existing call keeps working.
//   type: 'success' | 'info' | 'warning' | 'error'   (default 'error', see note)
//
// Optional: pass a second line either as toast('Title\nDetail', type) or
// toast('Title', type, 'Detail'). The first line is the title, the rest is the
// muted sub-line — matching the agreed design.
//
// ⚠️ THE DEFAULT IS 'error' AND STAYS THAT WAY. 466 of the 691 call sites pass no
// type, so flipping the default would silently recolour every one of them. Spot
// checks show the large majority are genuine failures and validations, where red
// is correct; making them green would be a worse bug than the one being fixed.
// The fix for a specific toast is to pass its type at the call site.

let container = null

function getContainer() {
  // `container.isConnected` matters: the reference is cached for the life of
  // the module, so if the node is ever detached from the DOM — a stray
  // innerHTML wipe, a portal cleanup, an extension rewriting <body> — every
  // later toast would be appended to an orphan node and silently never appear.
  // Nothing throws and nothing logs; the app just goes quiet. Re-create it.
  if (container && container.isConnected) return container
  container = document.createElement('div')
  container.id = 'toast-container'
  Object.assign(container.style, {
    position: 'fixed',
    // Sits clear of a notch and of the app's fixed topbar.
    // Plain fallbacks FIRST, then the env() versions. If a browser rejects the
    // calc(... env(...)) value the plain one survives, so the container still
    // pins to the top-right. Without the fallback an unsupported env() leaves
    // `top` unset entirely and the container lands at its static position —
    // the bottom of <body>, usually well below the fold and invisible.
    top: '16px',
    right: '16px',
    left: 'auto',
    zIndex: '9999',
    display: 'flex', flexDirection: 'column', gap: '10px',
    pointerEvents: 'none',
    maxWidth: 'min(400px, calc(100vw - 32px))',
  })
  // Applied after the fallbacks so a supporting browser upgrades to the
  // notch-aware values, and a non-supporting one silently keeps 16px.
  container.style.top = 'calc(16px + env(safe-area-inset-top))'
  container.style.right = 'calc(16px + env(safe-area-inset-right))'
  document.body.appendChild(container)
  return container
}

// Outline circle + glyph, drawn at 22px. Stroke-linecap is set on every path:
// a zero-length segment (the dot of an "i" or "!") renders as NOTHING without it.
const ICONS = {
  success: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-4.9"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>',
  warning: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>',
  error:   '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none"/>',
}

const TONES = {
  success: { accent: '#12A150', wash: 'rgba(18,161,80,0.10)' },
  info:    { accent: '#1a73e8', wash: 'rgba(26,115,232,0.10)' },
  warning: { accent: '#D08700', wash: 'rgba(208,135,0,0.12)' },
  error:   { accent: '#E5484D', wash: 'rgba(229,72,77,0.10)' },
}

export function toast(message, type = 'error', detail = '') {
  const tone = TONES[type] || TONES.error
  const raw = String(message ?? '')
  const [title, ...rest] = raw.split('\n')
  const sub = detail || rest.join(' ').trim()

  const el = document.createElement('div')
  Object.assign(el.style, {
    // Tint on the left fading to white, as agreed — not a flat colour block.
    background: `linear-gradient(100deg, ${tone.wash} 0%, rgba(255,255,255,0.96) 62%), #fff`,
    border: '1px solid rgba(16,24,40,0.07)',
    borderRadius: '14px',
    padding: '13px 16px',
    display: 'flex', alignItems: 'flex-start', gap: '11px',
    fontFamily: 'Geist, system-ui, sans-serif',
    boxShadow: '0 4px 16px rgba(16,24,40,0.10), 0 1px 3px rgba(16,24,40,0.06)',
    pointerEvents: 'auto', cursor: 'pointer',
    animation: 'toast-in 0.28s cubic-bezier(0.16,1,0.3,1)',
    maxWidth: '100%',
  })

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', tone.accent)
  icon.setAttribute('stroke-width', '1.8')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  Object.assign(icon.style, { width: '22px', height: '22px', flexShrink: '0', marginTop: '1px' })
  icon.innerHTML = ICONS[type] || ICONS.error

  const body = document.createElement('div')
  Object.assign(body.style, { minWidth: '0', flex: '1' })

  const h = document.createElement('div')
  Object.assign(h.style, {
    fontSize: '14px', fontWeight: '600', color: '#101828',
    lineHeight: '1.35', wordBreak: 'break-word',
  })
  // textContent, never innerHTML — toast copy includes database values and
  // error strings, which must never be parsed as markup.
  h.textContent = title

  body.appendChild(h)
  if (sub) {
    const p = document.createElement('div')
    Object.assign(p.style, {
      fontSize: '13px', color: '#667085', lineHeight: '1.4',
      marginTop: '3px', wordBreak: 'break-word',
    })
    p.textContent = sub
    body.appendChild(p)
  }

  let gone = false
  const dismiss = () => {
    if (gone) return
    gone = true
    el.style.animation = 'toast-out 0.2s ease-in forwards'
    setTimeout(() => el.remove(), 200)
  }

  // Explicit close. A real <button> so it is keyboard reachable and announced —
  // clicking the body also dismisses, but a discoverable control should not be
  // left implicit.
  const close = document.createElement('button')
  close.type = 'button'
  close.setAttribute('aria-label', 'Dismiss notification')
  Object.assign(close.style, {
    background: 'none', border: '0', padding: '3px', margin: '-2px -4px 0 0',
    lineHeight: '0', cursor: 'pointer', color: '#98A2B3', borderRadius: '6px',
    flexShrink: '0', alignSelf: 'flex-start',
  })
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  close.addEventListener('mouseenter', () => { close.style.color = '#475467'; close.style.background = 'rgba(16,24,40,0.06)' })
  close.addEventListener('mouseleave', () => { close.style.color = '#98A2B3'; close.style.background = 'none' })
  close.addEventListener('click', e => { e.stopPropagation(); dismiss() })

  el.appendChild(icon)
  el.appendChild(body)
  el.appendChild(close)

  // The body is still clickable to dismiss, for anyone who does not aim for the ×.
  el.addEventListener('click', dismiss)

  getContainer().appendChild(el)
  // Long enough to actually read. The old blanket 6s was too short for a two-line
  // message, and an error you may need to act on should outlast a confirmation you
  // only need to notice. Roughly: reading speed is ~200 wpm, so scale with length
  // and floor it generously.
  const words = (title + ' ' + sub).trim().split(/\s+/).length
  const readMs = Math.max(4500, Math.min(14000, words * 380))
  setTimeout(dismiss, type === 'error' ? readMs + 3000 : readMs)
}

// Keyframes injected once.
const style = document.createElement('style')
style.textContent = `
@keyframes toast-in { from { opacity:0; transform:translateX(18px) scale(0.98) } to { opacity:1; transform:none } }
@keyframes toast-out { from { opacity:1; transform:none } to { opacity:0; transform:translateX(18px) } }
@media (prefers-reduced-motion: reduce) {
  #toast-container > * { animation: none !important; }
}
`
document.head.appendChild(style)
