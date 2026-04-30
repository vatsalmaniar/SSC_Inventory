let container = null

function getContainer() {
  if (container) return container
  container = document.createElement('div')
  container.id = 'toast-container'
  Object.assign(container.style, {
    position: 'fixed', top: '16px', right: '16px', zIndex: '9999',
    display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none',
  })
  document.body.appendChild(container)
  return container
}

export function toast(message, type = 'error') {
  const el = document.createElement('div')
  const colors = {
    error:   { bg: '#fef2f2', border: '#fca5a5', color: '#dc2626' },
    success: { bg: '#f0fdf4', border: '#86efac', color: '#15803d' },
    warning: { bg: '#fffbeb', border: '#fcd34d', color: '#b45309' },
    info:    { bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8' },
  }
  const c = colors[type] || colors.error
  Object.assign(el.style, {
    background: c.bg, border: '1px solid ' + c.border, color: c.color,
    padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '500',
    fontFamily: 'Geist, system-ui, sans-serif', maxWidth: '380px', pointerEvents: 'auto',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', animation: 'toast-in 0.25s ease-out',
    lineHeight: '1.4', wordBreak: 'break-word',
  })
  el.textContent = message
  getContainer().appendChild(el)
  setTimeout(() => {
    el.style.animation = 'toast-out 0.2s ease-in forwards'
    setTimeout(() => el.remove(), 200)
  }, 6000)
}

// Inject animation keyframes once
const style = document.createElement('style')
style.textContent = `
@keyframes toast-in { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
@keyframes toast-out { from { opacity:1; transform:translateX(0) } to { opacity:0; transform:translateX(20px) } }
`
document.head.appendChild(style)
