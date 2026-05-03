import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtDateTime } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

function stockLevel(qty) {
  if (qty === 0) return { key: 'zero', label: 'Out of stock', color: '#EF4444' }
  if (qty <= 5)  return { key: 'low',  label: 'Low stock',    color: '#F59E0B' }
  return { key: 'ok', label: 'In stock', color: '#22C55E' }
}

export default function Sales() {
  const navigate = useNavigate()
  const [statsCache, setStatsCache] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState('loading')
  const [results, setResults] = useState([])
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) {
      const { data } = await sb.auth.refreshSession()
      if (!data?.session) { navigate('/login'); return }
    }
    await loadStats()
    setView('home')
  }

  async function loadStats() {
    const { data } = await sb.from('inventory')
      .select('quantity, updated_at, product_code, location, category_brand')
      .order('updated_at', { ascending: false })
    if (data) setStatsCache(data)
  }

  async function doSearch(term) {
    const raw = (term ?? searchTerm).trim()
    if (!raw) { setView('home'); return }
    setView('searching')
    const { data, error } = await sb.from('inventory')
      .select('*').ilike('product_code', '%' + raw + '%').order('product_code')
    if (error) { setErrorMsg(error.message); setView('error'); return }
    if (!data || !data.length) { setView('empty'); return }
    setResults(data)
    setView('results')
  }

  function fillAndSearch(code) { setSearchTerm(code); doSearch(code) }
  function onKeyDown(e) { if (e.key === 'Enter') doSearch() }

  const total = statsCache?.length || 0
  const low = statsCache?.filter(i => i.quantity > 0 && i.quantity <= 5).length || 0
  const zero = statsCache?.filter(i => i.quantity === 0).length || 0
  const inStock = total - low - zero
  const lastDate = statsCache?.[0] ? new Date(statsCache[0].updated_at) : null

  return (
    <Layout pageTitle="Inventory" pageKey="inventory">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Live Inventory Check</h1>
            <div className="o-summary">
              {total > 0 && (
                <>
                  <span><b>{total}</b> products tracked</span>
                  {lastDate && (<><span className="o-sep">·</span><span>last synced <b>{fmtDateTime(lastDate)}</b></span></>)}
                </>
              )}
              {!total && <span>Search by product code to check live stock</span>}
            </div>
          </div>
          <div className="page-meta">
            {lastDate && <div className="meta-pill live"><span className="meta-dot"/> Live</div>}
          </div>
        </div>

        {/* Search bar */}
        <div className="card" style={{ marginTop: 12, padding: '14px 16px' }}>
          <div className="o-search" style={{ flex: 1, maxWidth: 'none', padding: '10px 14px', background: 'var(--o-bg-2)' }}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input ref={inputRef} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} onKeyDown={onKeyDown}
              placeholder="Search by product code (e.g. CTS, STB)…"
              style={{ fontSize: 14 }}/>
            <button className="btn-primary" onClick={() => doSearch()} style={{ padding: '6px 14px', fontSize: 12 }}>
              Search
            </button>
          </div>
        </div>

        {view === 'loading' || view === 'searching' ? (
          <div className="o-loading">{view === 'loading' ? 'Loading…' : 'Searching…'}</div>
        ) : view === 'home' ? (
          !statsCache?.length ? (
            <div className="card" style={{ marginTop: 16, padding: 60, textAlign: 'center' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--o-ink)', marginBottom: 6 }}>No inventory yet</div>
              <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Accounts team needs to upload the XLS file.</div>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">Recently Updated</div>
                    <div className="card-title">Quick Access</div>
                  </div>
                  <span className="trend-pill mono">{Math.min(statsCache.length, 6)} items</span>
                </div>
                <div className="o-list">
                  {statsCache.slice(0, 6).map(item => {
                    const lvl = stockLevel(item.quantity)
                    return (
                      <div key={item.product_code + item.location} className="o-list-row" onClick={() => fillAndSearch(item.product_code)}>
                        <div style={{ minWidth: 0 }}>
                          <div className="o-list-num">{item.product_code}</div>
                          <div className="o-list-cust">{item.location || '—'}{item.category_brand ? ` · ${item.category_brand}` : ''}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="o-list-val" style={{ color: lvl.color }}>{item.quantity} <span style={{ fontSize: 11, color: 'var(--o-muted-2)', fontWeight: 400 }}>units</span></div>
                          <span className="ol-status-pill" style={{ '--stage-color': lvl.color, marginTop: 2 }}>
                            <span className="ol-status-dot"/>
                            {lvl.label}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )
        ) : view === 'results' ? (
          <>
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--o-muted)' }}>
              <b style={{ color: 'var(--o-ink)' }}>{results.length}</b> result{results.length > 1 ? 's' : ''} for "<b style={{ color: 'var(--o-ink)' }}>{searchTerm}</b>"
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
              {results.map((item, i) => {
                const lvl = stockLevel(item.quantity)
                return (
                  <div key={item.id || i} className="card" style={{ padding: 18, animationDelay: i * 0.05 + 's' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="o-list-num" style={{ fontSize: 14, marginBottom: 2 }}>{item.product_code}</div>
                        <div className="o-list-cust">{item.category_brand || '—'} · {item.location || '—'}</div>
                      </div>
                      <span className="ol-status-pill" style={{ '--stage-color': lvl.color }}>
                        <span className="ol-status-dot"/>
                        {lvl.label}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px 0', borderTop: '1px solid var(--o-line-2)', borderBottom: '1px solid var(--o-line-2)' }}>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Quantity</div>
                        <div style={{ fontSize: 28, fontWeight: 600, color: lvl.color, fontFamily: 'Geist Mono, monospace', letterSpacing: '-0.02em', marginTop: 2 }}>{item.quantity}</div>
                        <div style={{ fontSize: 11, color: 'var(--o-muted-2)' }}>units available</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--o-muted)', fontFamily: 'Geist Mono, monospace', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Location</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--o-ink)', marginTop: 6 }}>{item.location || '—'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11, color: 'var(--o-muted)' }}>
                      <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 12, height: 12 }}><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                      <span>Updated <b style={{ color: 'var(--o-ink)' }}>{fmtDateTime(new Date(item.updated_at))}</b></span>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : view === 'empty' ? (
          <div className="card" style={{ marginTop: 16, padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--o-ink)', marginBottom: 6 }}>No product found</div>
            <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>No match for "{searchTerm}". Try a partial code like "CTS" or "STB".</div>
          </div>
        ) : view === 'error' ? (
          <div className="card" style={{ marginTop: 16, padding: 60, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#B91C1C', marginBottom: 6 }}>Search error</div>
            <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>{errorMsg}</div>
          </div>
        ) : null}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
      </div>
      <div className="kt-value">{value}</div>
      <div className="kt-foot">{sub && <div className="kt-sub mono">{sub}</div>}</div>
    </div>
  )
}
function KpiChart({ kind }) {
  if (kind === 'bars') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      {[0.4, 0.6, 0.5, 0.75, 0.55, 0.85, 0.7, 0.95].map((h, i) => (
        <rect key={i} x={i*15 + 2} y={60 - h*55} width="10" height={h*55} fill="currentColor" opacity="0.18" rx="1"/>
      ))}
    </svg>
  )
  return null
}
