import { useState, useEffect, useRef } from 'react'
import { searchInventory } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmtDateTime } from '../lib/fmt'
import Layout from '../components/Layout'
import Stat from '../components/StatTile'
import { fetchAll } from '../lib/fetchAll'
import '../styles/orders-redesign.css'
// .ph-bento / .ph-stat — the shared tile the rest of the app uses.
import '../styles/people-home.css'
import '../styles/orders-bento.css'

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
    // PAGED. This was a plain select against PostgREST's 1000-row cap while the table
    // holds 4,232 rows — and because it is ordered by updated_at DESC it kept only the
    // 1,000 most recently touched. So "products tracked" read 1,000 instead of 4,232,
    // and the low/out-of-stock counts were computed from that arbitrary slice: 817 rows
    // are actually out of stock and 1,200 are low. Silent truncation, no error.
    const { data, error, truncated } = await fetchAll((from, to) => sb.from('inventory')
      .select('quantity, updated_at, product_code, location, category_brand')
      .order('updated_at', { ascending: false }).order('product_code')
      .range(from, to))
    if (error) console.error('inventory stats load error:', error)
    if (truncated) console.warn('Inventory: hit fetch ceiling — counts may be short.')
    if (data) setStatsCache(data)
  }

  async function doSearch(term) {
    const raw = (term ?? searchTerm).trim()
    if (!raw) { setView('home'); return }
    setView('searching')
    // Tiered search — see sql/search_inventory.sql. The old %ILIKE% on the raw
    // Tally code could not find any of the 1,781 stock rows (42%) whose code
    // carries a space: "UNI704" returned nothing while the stock sat under
    // "UNI 704-B ZDA 48 05 00". Sales concluded there was no stock.
    const { data, error } = await searchInventory(raw, { limit: 200 })
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
  const locations = statsCache ? [...new Set(statsCache.map(i => i.location).filter(Boolean))] : []

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
            <div className="card inv-empty">
              <div className="inv-empty-t">No inventory yet</div>
              <div className="inv-empty-s">Accounts team needs to upload the XLS file.</div>
            </div>
          ) : (
            <>
              {/* KPI tiles — the shared <Stat/>, same as every other module. These
                  figures existed already but only as a one-line text summary. */}
              <div className="ph-bento o-bento-flat">
                <Stat label="Products Tracked" value={total.toLocaleString('en-IN')}
                  foot={locations.length > 1 ? <><b>{locations.length}</b> warehouses</> : (locations[0] || 'all stock rows')} />
                <Stat label="In Stock" value={inStock.toLocaleString('en-IN')}
                  foot={total ? <><b>{Math.round(inStock / total * 100)}%</b> of catalogue</> : '—'} />
                <Stat label="Low Stock" value={low.toLocaleString('en-IN')} warn={low > 0}
                  foot="5 units or fewer" />
                <Stat label="Out of Stock" value={zero.toLocaleString('en-IN')} warn={zero > 0}
                  foot={total ? <><b>{Math.round(zero / total * 100)}%</b> of catalogue</> : '—'} />
                <Stat label="Last Synced" value={lastDate ? fmtDateTime(lastDate).split(',')[0] : '—'}
                  foot={lastDate ? fmtDateTime(lastDate) : 'never'} />
              </div>

              <div className="card">
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
          <div className="ol-wrap">
            {/* Was a grid of cards. The rest of the app reads stock in the .ol-* table,
                and a table is the better shape here: one product code usually exists in
                BOTH warehouses, and as adjacent rows the two quantities can be compared
                at a glance instead of sitting in separate cards. */}
            <div className="card-head inv-res-head">
              <div>
                <div className="card-eyebrow">Live stock · {searchTerm}</div>
                <div className="card-title">{results.length} result{results.length === 1 ? '' : 's'}</div>
              </div>
              <span className="trend-pill mono">
                {results.reduce((a, r) => a + (Number(r.quantity) || 0), 0).toLocaleString('en-IN')} units total
              </span>
            </div>
            <div className="ol-row ol-head inv-row">
              <div>Product Code</div>
              <div>Brand / Category</div>
              <div>Location</div>
              <div className="num">Quantity</div>
              <div className="num">Status</div>
              <div>Updated</div>
            </div>
            <div className="ol-table">
              {results.map((item, i) => {
                const lvl = stockLevel(item.quantity)
                return (
                  <div key={item.id || i} className="ol-row ol-data inv-row">
                    <div className="ol-cell"><div className="ol-num">{item.product_code}</div></div>
                    <div className="ol-cell ol-cust" title={item.category_brand || ''}>{item.category_brand || '—'}</div>
                    <div className="ol-cell inv-loc-cell">{item.location || '—'}</div>
                    <div className="ol-cell num">
                      <span className="inv-qty-n" style={{ color: lvl.color }}>{item.quantity}</span>
                      <span className="inv-qty-u">units</span>
                    </div>
                    <div className="ol-cell ol-status-cell">
                      <span className="ol-status-pill" style={{ '--stage-color': lvl.color }}>
                        <span className="ol-status-dot"/>{lvl.label}
                      </span>
                    </div>
                    <div className="ol-cell ol-date">{fmtDateTime(new Date(item.updated_at))}</div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : view === 'empty' ? (
          <div className="card inv-empty">
            <div className="inv-empty-t">No product found</div>
            <div className="inv-empty-s">No match for "{searchTerm}". Try a partial code like "CTS" or "STB".</div>
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

// A local KpiTile lived here and was never rendered — dead since before this
// change. The tiles above are the shared <Stat/>.

