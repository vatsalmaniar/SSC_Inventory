// Minimal, deliberately narrow: two rules that catch the two classes of bug
// that have actually shipped from this repo.
//
//   rules-of-hooks — a useState below an early return is valid JavaScript and
//   builds perfectly, then kills the page at render with React error #310.
//   ItemDetail, VendorDetail and CustomerDetail have each died this way.
//
//   no-undef — vite build resolves imports, not identifiers, so a typo'd
//   function name ships happily and throws in the browser.
//
// Not a style config. Run it before every push: npm run lint
import hooks from 'eslint-plugin-react-hooks'

const BROWSER = ['window','document','localStorage','sessionStorage','navigator','console',
  'setTimeout','clearTimeout','setInterval','clearInterval','fetch','alert','confirm','prompt',
  'Date','URL','Blob','btoa','atob','FileReader','FormData','Image','requestAnimationFrame',
  'cancelAnimationFrame','crypto','performance','location','history','open','Intl','TextEncoder',
  'AbortController','structuredClone','ResizeObserver','IntersectionObserver','MutationObserver',
  'CustomEvent','Event','matchMedia','getComputedStyle','screen','XMLHttpRequest','WebSocket',
  'Notification','indexedDB','caches','queueMicrotask','process','globalThis','HTMLElement','Node',
  'DOMParser','XPathResult','requestIdleCallback','URLSearchParams','URLSearchParams','TextDecoder','Response','Request','Headers','AbortSignal','ReadableStream','atob']

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'supabase/**', 'scripts/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': hooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: Object.fromEntries(BROWSER.map(g => [g, 'readonly'])),
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'no-undef': 'error',
    },
  },
]
