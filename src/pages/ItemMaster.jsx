import { useState, useEffect, useRef, Fragment } from 'react'
import { searchItems, isSuggestion } from '../lib/itemSearch'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const PAGE_SIZE = 50

export default function ItemMaster() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal] = useState(0)
  // Results are matches first, then fuzzy suggestions. matchCount is where the
  // boundary falls in the FULL result set, so the divider survives pagination.
  const [matchCount, setMatchCount] = useState(0)
  const [page, setPage] = useState(1)
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType] = useState('')
  const [brands, setBrands] = useState([])
  const [categories, setCategories] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || 'sales')

    const [brandsRes, catsRes] = await Promise.all([
      sb.rpc('get_all_brands'),
      sb.rpc('get_all_categories'),
    ])
    setBrands((brandsRes.data || []).map(r => r.brand).filter(Boolean))
    setCategories((catsRes.data || []).map(r => r.category).filter(Boolean))

    await loadItems({ p: 1 })
    setLoading(false)
  }

  async function loadItems(opts = {}) {
    const p = opts.p ?? page
    const q = opts.q ?? search
    const brand = opts.brand ?? filterBrand
    const cat = opts.cat ?? filterCategory
    const type = opts.type ?? filterType
    if (!opts.silent) setLoading(true)

    // SEARCH path — tiered (see lib/itemSearch.js). Exact/prefix/contains
    // decide membership; fuzzy only appends below. Server-side top-200,
    // then client filter + paginate.
    if (q.trim()) {
      // Filters go to the DATABASE, not applied to the already-fetched page.
      // Filtering client-side meant the top 200 were fetched and THEN narrowed, so
      // a brand whose items all ranked past 200 showed "No items found" for items
      // that exist — searching "UNI" (415 matches) hid seven brands outright, and
      // the header count under-reported along with them.
      const data = await searchItems(q, { limit: 200, brand, category: cat, type })
      const rows = data || []
      const from = (p - 1) * PAGE_SIZE
      setItems(rows.slice(from, from + PAGE_SIZE))
      setTotal(rows.length)
      setMatchCount(rows.filter(r => !isSuggestion(r)).length)
      setPage(p)
      setLoading(false); setSearching(false)
      return
    }

    // BROWSE path — server-side pagination (every item reachable, no cap).
    let query = sb.from('items')
      .select('id,item_no,item_code,brand,category,subcategory,series,type', { count: 'exact' })
      // item_seq, not item_no: item_no is text, so once numbering passes IN9999
      // a text sort puts IN10000 ahead of IN9999. item_seq is the generated
      // numeric part and stays in true numeric order forever.
      .order('item_seq', { ascending: true })
    if (brand) query = query.eq('brand', brand)
    if (cat) query = query.eq('category', cat)
    if (type) query = query.eq('type', type)
    const from = (p - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)
    const { data, count } = await query
    setItems(data || [])
    setTotal(count || 0)
    setPage(p)
    setLoading(false)
    setSearching(false)
  }

  function handleSearch(val) {
    setSearch(val); setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadItems({ q: val, p: 1 }), 300)
  }
  function applyFilter(key, val) {
    const updates = { brand: filterBrand, cat: filterCategory, type: filterType, [key]: val }
    if (key === 'brand') setFilterBrand(val)
    if (key === 'cat') setFilterCategory(val)
    if (key === 'type') setFilterType(val)
    loadItems({ p: 1, ...updates })
  }
  function clearFilters() {
    setFilterBrand(''); setFilterCategory(''); setFilterType('')
    loadItems({ p: 1, brand: '', cat: '', type: '' })
  }

  const hasFilters = filterBrand || filterCategory || filterType
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Item 360</h1>
            <div className="o-summary">
              <span><b>{matchCount.toLocaleString()}</b> item{matchCount !== 1 ? 's' : ''}</span>
              {total > matchCount && (
                <><span className="o-sep">·</span><span>{total - matchCount} similar</span></>
              )}
              <span className="o-sep">·</span>
              <span>Product Catalog</span>
            </div>
          </div>
          {['admin','management'].includes(userRole) && (
            <div className="page-meta">
              <button className="btn-primary" onClick={() => navigate('/items/new')}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
                New Item
              </button>
            </div>
          )}
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by item code, brand, category…" value={search} onChange={e => handleSearch(e.target.value)}/>
            {search && (
              <button className="o-search-clear" onClick={() => { setSearch(''); loadItems({ q: '', p: 1 }) }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <select className="filt-select" value={filterBrand} onChange={e => applyFilter('brand', e.target.value)}>
            <option value="">Brand: All</option>
            {brands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <select className="filt-select" value={filterCategory} onChange={e => applyFilter('cat', e.target.value)}>
            <option value="">Category: All</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="filt-select" value={filterType} onChange={e => applyFilter('type', e.target.value)}>
            <option value="">Type: All</option>
            <option value="CI">CI – Customised</option>
            <option value="SI">SI – Standard</option>
          </select>
          {hasFilters && <button className="opps-clear" onClick={clearFilters}>Clear</button>}
        </div>

        {loading && !items.length ? (
          <div className="o-loading">Loading items…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '90px 200px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 90px' }}>
              <div>Item No</div>
              <div>Item Code</div>
              <div>Brand</div>
              <div>Category</div>
              <div>Subcategory</div>
              <div className="num">Type</div>
            </div>
            {!items.length ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No items found{search.trim() ? ` for "${search}"` : ''}</div>
              </div>
            ) : (
              <div className="ol-table">
                {items.map((item, i) => {
                  // Global index, so the divider lands correctly on any page.
                  const showBreak = (page - 1) * PAGE_SIZE + i === matchCount && total > matchCount
                  const isCI = item.type === 'CI'
                  const typeColor = isCI ? '#C2410C' : item.type === 'SI' ? '#1a73e8' : '#94A3B8'
                  return (
                    <Fragment key={item.id}>
                    {showBreak && <div className="ol-sep">Similar codes</div>}
                    <div className="ol-row ol-data" style={{ gridTemplateColumns: '90px 200px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 90px' }} onClick={() => navigate('/items/' + item.id)}>
                      <div className="ol-cell" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--o-muted-2)', fontWeight: 600 }}>{item.item_no || '—'}</div>
                      <div className="ol-cell">
                        <div className="ol-num">{item.item_code}</div>
                        {item.description && <div className="ol-desc">{item.description}</div>}
                      </div>
                      <div className="ol-cell ol-cust">{item.brand || '—'}</div>
                      <div className="ol-cell ol-cust">{item.category || '—'}</div>
                      <div className="ol-cell" style={{ fontSize: 12, color: 'var(--o-muted)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.subcategory || '—'}</div>
                      <div className="ol-cell ol-status-cell">
                        {item.type ? (
                          <span className="ol-status-pill" style={{ '--stage-color': typeColor }}>
                            <span className="ol-status-dot"/>
                            {item.type}
                          </span>
                        ) : <span style={{color:'var(--o-muted-2)'}}>—</span>}
                      </div>
                    </div>
                    </Fragment>
                  )
                })}
              </div>
            )}
            {total > PAGE_SIZE && (
              <div className="ol-foot">
                <span>Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total.toLocaleString()}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => loadItems({ p: page-1 })} disabled={page === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1
                    const ellipsis = !show && Math.abs(p - page) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === page ? 'on' : ''}`} onClick={() => loadItems({ p })}>{p}</button>
                    if (ellipsis) return <span key={'e'+p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => loadItems({ p: page+1 })} disabled={page === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
