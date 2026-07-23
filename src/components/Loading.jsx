// The single shared loading state for the whole app.
// Renders the standard `.o-loading` look (centred spinner + tagline) defined
// once in styles/global.css — the same visual 20+ pages already use.
//
// USE THIS for any page/section loading state. Do NOT hand-roll a new spinner
// (no more .p-spin / .loading-spin / inline <div>Loading…</div>). See CLAUDE.md.
//
// Props:
//   label  – optional; kept for call-site compatibility. The standard look hides
//            inline text by design, so it does not render, but passing it is safe.
//   style / className – forwarded to the wrapper for the rare layout tweak.
export default function Loading({ label = 'Loading…', className = '', style }) {
  return <div className={`o-loading${className ? ' ' + className : ''}`} style={style}>{label}</div>
}
