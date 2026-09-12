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
//   react/jsx-no-undef — no-undef DOES NOT SEE JSX ELEMENT NAMES. Deleting a local
//   component and calling the shared one without importing it passes both `npm run
//   lint` and `npm run build`, then renders a blank page. That happened twice in one
//   session (Orders.jsx <StatusDonut>, PeopleHome <AttendanceTabs>).
//
//   react/jsx-uses-vars — the same blindness in reverse: without it, no-unused-vars
//   reports every imported component as unused (Layout was flagged 79 times), which
//   is why no-unused-vars could never be switched on. With it, the 569 reports drop
//   to the ~130 that are real.
//
//   no-unused-vars — WARNING, not error, so it never blocks a push while the existing
//   ~130 are cleared.
//
//   no-restricted-syntax / unpaged select — PostgREST silently caps a select at 1000
//   rows. Three dashboards were quietly reading two thirds of their data this way:
//   /procurement (1,498 POs), /dashboard's POs, /dashboard's inventory (4,231 rows).
//   No error, no warning, just numbers a third too small.
//
// Not a style config. Run it before every push: npm run lint
import hooks from 'eslint-plugin-react-hooks'
import react from 'eslint-plugin-react'
import noUnpagedSelect from './eslint-rules/no-unpaged-select.js'

const BROWSER = ['window','document','localStorage','sessionStorage','navigator','console',
  'setTimeout','clearTimeout','setInterval','clearInterval','fetch','alert','confirm','prompt',
  'Date','URL','Blob','File','ImageData','btoa','atob','FileReader','FormData','Image','requestAnimationFrame',
  'cancelAnimationFrame','crypto','performance','location','history','open','Intl','TextEncoder',
  'AbortController','structuredClone','ResizeObserver','IntersectionObserver','MutationObserver',
  'CustomEvent','Event','matchMedia','getComputedStyle','screen','XMLHttpRequest','WebSocket',
  'Notification','indexedDB','caches','queueMicrotask','process','globalThis','HTMLElement','Node',
  'DOMParser','XPathResult','requestIdleCallback','URLSearchParams','URLSearchParams','TextDecoder','Response','Request','Headers','AbortSignal','ReadableStream','atob']

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'supabase/**', 'scripts/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': hooks, react, local: { rules: { 'no-unpaged-select': noUnpagedSelect } } },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: Object.fromEntries(BROWSER.map(g => [g, 'readonly'])),
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'no-undef': 'error',
      // JSX element names — the gap no-undef leaves open.
      'react/jsx-no-undef': 'error',
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Warning: the repo has ~130 pre-existing dead identifiers to clear.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      // WARNING, not error, for the same reason as no-unused-vars: it currently
      // surfaces 10 pre-existing unpaged reads that each need checking against real
      // row counts (Sales.jsx reads `inventory` — 4,231 rows — and has been showing
      // 1,000 of them). Blocking every push on day one would just get the rule
      // disabled. Promote to 'error' once those 10 are cleared.
      'local/no-unpaged-select': 'warn',
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.property.name='rpc'][arguments.0.value=/^search_(items|inventory)/]",
          message: 'Do not call the search RPCs directly. Use searchItems() / searchSimilarItems() from src/lib/itemSearch.js — it is the only place that knows which RPC is live, which is also the rollback switch.',
        },
        {
          selector: "CallExpression[callee.property.name='ilike'][arguments.0.value=/^(item_code|product_code)$/]",
          message: 'No hand-rolled item search. %ILIKE% on a part code cannot match across punctuation — "MAD140" never finds "MAD 1401040R5" (45% of codes carry a space). Use searchItems() from src/lib/itemSearch.js.',
        },
        {
          selector: "TemplateElement[value.raw=/(item_code|product_code)\\.ilike/]",
          message: 'No hand-rolled item search inside .or(). Use searchItems() from src/lib/itemSearch.js.',
        },
        {
          // ONLY inside a .reduce() — that is the accumulation shape all three
          // incidents took. Reading one line's total_price to display it, or
          // writing the field, is legitimate and must not be flagged; a rule
          // people have to disable is worse than no rule.
          selector: "CallExpression[callee.property.name='reduce'][callee.object.left.property.name='order_items'] MemberExpression[property.name='total_price'], CallExpression[callee.property.name='reduce'][callee.object.property.name='order_items'] MemberExpression[property.name='total_price']",
          message: 'Do not read order_items.total_price directly. Order value must net cancelled qty, treat a cancelled order as 0 and exclude SAMPLE — use lineNetValue / orderNetValue / ordersTotalValue from src/lib/orderValue.js. Summing it by hand has shipped three times, most recently a 60.3 lakh overstatement on /orders.',
        },
      ],
    },
  },
  {
    // The one place allowed to name a search RPC — it owns the rollback switch.
    files: ['src/lib/itemSearch.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // The definition of order value itself. Everything else reads it from here.
    files: ['src/lib/orderValue.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
]
