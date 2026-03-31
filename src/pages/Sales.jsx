import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/sales.css'

function fmt(d) {
  if (!d) return '—'
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const h = d.getHours(), m = d.getMinutes()
  return d.getDate()+' '+mo[d.getMonth()]+' '+d.getFullYear()+' · '+(h<10?'0':'')+h+':'+(m<10?'0':'')+m
}
function sc(qty) { return qty === 0 ? 'zero' : qty <= 5 ? 'low' : 'ok' }
function sl(qty) { return qty === 0 ? 'Out of stock' : qty <= 5 ? 'Low stock' : 'In stock' }

export default function Sales() {
  const navigate    = useNavigate()
  const [statsCache, setStatsCache] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView]           = useState('loading') // 'loading' | 'home' | 'searching' | 'results' | 'empty' | 'error'
  const [results, setResults]     = useState([])
  const [errorMsg, setErrorMsg]   = useState('')
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
    const { data } = await sb
      .from('inventory')
      .select('quantity, updated_at, product_code, location, category_brand')
      .order('updated_at', { ascending: false })
    if (data) setStatsCache(data)
  }

  async function doSearch(term) {
    const raw = (term ?? searchTerm).trim()
    if (!raw) { setView('home'); return }

    setView('searching')

    const { data, error } = await sb
      .from('inventory')
      .select('*')
      .ilike('product_code', '%' + raw + '%')
      .order('product_code')

    if (error) { setErrorMsg(error.message); setView('error'); return }
    if (!data || !data.length) { setView('empty'); return }

    setResults(data)
    setView('results')
  }

  function fillAndSearch(code) {
    setSearchTerm(code)
    doSearch(code)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') doSearch()
  }

  // ── HOME SCREEN CONTENT ──
  function HomeContent() {
    if (!statsCache || !statsCache.length) {
      return (
        <div className="empty-state">
          <div className="empty-icon">
            <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div className="empty-title">No inventory yet</div>
          <div className="empty-sub">Accounts team needs to upload the XLS file.</div>
        </div>
      )
    }

    const total    = statsCache.length
    const low      = statsCache.filter(i => i.quantity > 0 && i.quantity <= 5).length
    const zero     = statsCache.filter(i => i.quantity === 0).length
    const lastDate = statsCache[0] ? new Date(statsCache[0].updated_at) : null

    return (
      <>
        {lastDate && (
          <div className="update-banner">
            <div className="update-dot" />
            <div className="update-text">Last synced <strong>{fmt(lastDate)}</strong></div>
          </div>
        )}

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-num">{total}</div>
            <div className="stat-label">Total products</div>
          </div>
          <div className="stat-card">
            <div className="stat-num" style={{ color: 'var(--amber-text)' }}>{low}</div>
            <div className="stat-label">Low stock</div>
          </div>
          <div className="stat-card">
            <div className="stat-num" style={{ color: 'var(--red-text)' }}>{zero}</div>
            <div className="stat-label">Out of stock</div>
          </div>
        </div>

        <div className="section-label">Quick access</div>
        {statsCache.slice(0, 6).map(item => {
          const c = sc(item.quantity)
          return (
            <div key={item.product_code + item.location} className="quick-item" onClick={() => fillAndSearch(item.product_code)}>
              <div>
                <div className="quick-code">{item.product_code}</div>
                <div className="quick-loc">{item.location || '—'}</div>
              </div>
              <div className={'quick-qty ' + c}>{item.quantity} pcs</div>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <Layout pageTitle="Inventory" pageKey="inventory">

      {/* Hero + Search */}
      <div className="hero">
        <div className="hero-label">Stock check</div>
        <div className="hero-heading">Search by<br />product code</div>
        <div className="search-wrap">
          <span className="search-icon">
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. CTS, STB"
          />
          <button className="search-btn" onClick={() => doSearch()}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            Search
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="content">

        {/* Loading */}
        {view === 'loading' && (
          <div className="loading-state">
            <div className="loading-spin" />
            Loading...
          </div>
        )}

        {/* Home */}
        {view === 'home' && <HomeContent />}

        {/* Searching */}
        {view === 'searching' && (
          <div className="loading-state">
            <div className="loading-spin" />
            Searching...
          </div>
        )}

        {/* Results */}
        {view === 'results' && (
          <>
            <div className="results-meta">
              <div className="results-meta-left">
                <strong>{results.length}</strong> result{results.length > 1 ? 's' : ''} for "{searchTerm}"
              </div>
            </div>
            {results.map((item, i) => {
              const c = sc(item.quantity)
              return (
                <div key={item.id || i} className="product-card" style={{ animationDelay: i * 0.05 + 's' }}>
                  <div className="card-header">
                    <div>
                      <div className="card-code">{item.product_code}</div>
                      <div className="card-meta">{item.category_brand || '—'} · {item.location || '—'}</div>
                    </div>
                    <span className={'stock-pill stock-' + c}>{sl(item.quantity)}</span>
                  </div>
                  <div className="card-body">
                    <div className="card-grid">
                      <div className="card-field">
                        <label>Quantity</label>
                        <div className={'qty-num ' + c}>{item.quantity}</div>
                        <div className="qty-unit">units available</div>
                      </div>
                      <div className="card-field">
                        <label>Location</label>
                        <div className="field-val">{item.location || '—'}</div>
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 6v6l4 2"/>
                    </svg>
                    <span>Updated <strong>{fmt(new Date(item.updated_at))}</strong></span>
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* No results */}
        {view === 'empty' && (
          <>
            <div className="results-meta">
              <div className="results-meta-left">No results for <strong>"{searchTerm}"</strong></div>
            </div>
            <div className="empty-state">
              <div className="empty-icon">
                <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              </div>
              <div className="empty-title">No product found</div>
              <div className="empty-sub">
                No match for "{searchTerm}".<br />Try a partial code like "CTS" or "STB".
              </div>
            </div>
          </>
        )}

        {/* Error */}
        {view === 'error' && (
          <div className="empty-state">
            <div className="empty-icon">
              <svg fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
            </div>
            <div className="empty-title">Search error</div>
            <div className="empty-sub">{errorMsg}</div>
          </div>
        )}
      </div>
    </Layout>
  )
}
