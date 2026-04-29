import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/orderdetail.css'
import '../styles/orders.css'

const PAGE_SIZE = 50

function TypeBadge({ type }) {
  if (!type) return <span style={{ color:'var(--gray-300)' }}>—</span>
  const ci = type === 'CI'
  return (
    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:6, fontSize:11, fontWeight:600,
      background: ci ? '#fff7ed' : '#eff6ff', color: ci ? '#c2410c' : '#1d4ed8' }}>
      {ci ? 'CI' : 'SI'}
    </span>
  )
}

export default function ItemMaster() {
  const navigate = useNavigate()
  const [items, setItems]         = useState([])
  const [userRole, setUserRole]   = useState('')
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal]         = useState(0)
  const [page, setPage]           = useState(1)
  const [filterBrand, setFilterBrand]       = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterType, setFilterType]         = useState('')
  const [brands, setBrands]       = useState([])
  const [categories, setCategories] = useState([])
  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setUserRole(profile?.role || 'sales')

    const [brandsRes, catsRes] = await Promise.all([
      sb.from('items').select('brand').not('brand', 'is', null).order('brand'),
      sb.from('items').select('category').not('category', 'is', null).order('category'),
    ])
    const uniqueBrands = [...new Set((brandsRes.data || []).map(r => r.brand).filter(Boolean))].sort()
    const uniqueCats   = [...new Set((catsRes.data  || []).map(r => r.category).filter(Boolean))].sort()
    setBrands(uniqueBrands)
    setCategories(uniqueCats)

    await loadItems({ p: 1 })
    setLoading(false)
  }

  async function loadItems(opts = {}) {
    const p    = opts.p        ?? page
    const q    = opts.q        ?? search
    const brand = opts.brand   ?? filterBrand
    const cat  = opts.cat      ?? filterCategory
    const type = opts.type     ?? filterType

    if (!opts.silent) setLoading(true)
    let query = sb.from('items')
      .select('id,item_no,item_code,brand,category,subcategory,series,type', { count: 'exact' })
      .order('item_no', { ascending: true })

    if (q.trim()) query = query.or(`item_code.ilike.%${q.trim()}%,brand.ilike.%${q.trim()}%,category.ilike.%${q.trim()}%,subcategory.ilike.%${q.trim()}%`)
    if (brand) query = query.eq('brand', brand)
    if (cat)   query = query.eq('category', cat)
    if (type)  query = query.eq('type', type)

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
    setSearch(val)
    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadItems({ q: val, p: 1 }), 300)
  }

  function applyFilter(key, val) {
    const updates = { brand: filterBrand, cat: filterCategory, type: filterType, [key]: val }
    if (key === 'brand') setFilterBrand(val)
    if (key === 'cat')   setFilterCategory(val)
    if (key === 'type')  setFilterType(val)
    loadItems({ p: 1, ...updates })
  }

  function clearFilters() {
    setFilterBrand(''); setFilterCategory(''); setFilterType('')
    loadItems({ p: 1, brand: '', cat: '', type: '' })
  }

  const hasFilters = filterBrand || filterCategory || filterType
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const SEL = { padding:'7px 10px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:12, fontFamily:'var(--font)', background:'white', color:'var(--gray-700)', cursor:'pointer', outline:'none' }

  return (
    <Layout pageTitle="Item 360" pageKey="item360">
      <div className="od-page">
        <div className="od-list-body">

          {/* Header */}
          <div className="od-header">
            <div className="od-header-main">
              <div className="od-header-left">
                <div className="od-header-eyebrow">Product Catalog</div>
                <div className="od-header-title">Item 360</div>
                <div className="od-header-num">{total.toLocaleString()} item{total !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </div>

          {/* Search + Filters */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:16, alignItems:'center' }}>
            <div style={{ position:'relative', flex:'1 1 220px', maxWidth:340 }}>
              <svg style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--gray-400)', width:15, height:15, pointerEvents:'none' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input
                style={{ width:'100%', padding:'8px 12px 8px 34px', border:'1px solid var(--gray-200)', borderRadius:8, fontSize:13, fontFamily:'var(--font)', outline:'none', background:'white', boxSizing:'border-box' }}
                placeholder="Search by item code, brand, category…"
                value={search}
                onChange={e => handleSearch(e.target.value)}
              />
              {searching && <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)' }}><div className="loading-spin" style={{ width:14, height:14 }}/></div>}
            </div>

            <select value={filterBrand} onChange={e => applyFilter('brand', e.target.value)} style={{ ...SEL, minWidth:140 }}>
              <option value="">Brand</option>
              {brands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            <select value={filterCategory} onChange={e => applyFilter('cat', e.target.value)} style={{ ...SEL, minWidth:160 }}>
              <option value="">Category</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <select value={filterType} onChange={e => applyFilter('type', e.target.value)} style={{ ...SEL, minWidth:120 }}>
              <option value="">Type</option>
              <option value="CI">CI – Customised</option>
              <option value="SI">SI – Standard</option>
            </select>

            {hasFilters && (
              <button onClick={clearFilters} style={{ padding:'7px 12px', borderRadius:8, border:'1px solid var(--gray-200)', background:'white', color:'var(--gray-500)', fontSize:12, cursor:'pointer', fontFamily:'var(--font)', whiteSpace:'nowrap' }}>
                Clear filters
              </button>
            )}
          </div>

          {/* Active filter pills */}
          {hasFilters && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:12 }}>
              {filterBrand    && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#eff6ff', color:'#1d4ed8', fontSize:11, fontWeight:600 }}>{filterBrand} <button onClick={() => applyFilter('brand','')} style={{ background:'none', border:'none', color:'#1d4ed8', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterCategory && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#f0fdf4', color:'#15803d', fontSize:11, fontWeight:600 }}>{filterCategory} <button onClick={() => applyFilter('cat','')} style={{ background:'none', border:'none', color:'#15803d', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              {filterType     && <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, background:'#fff7ed', color:'#c2410c', fontSize:11, fontWeight:600 }}>{filterType} <button onClick={() => applyFilter('type','')} style={{ background:'none', border:'none', color:'#c2410c', cursor:'pointer', fontSize:13, lineHeight:1, padding:0 }}>×</button></span>}
              <span style={{ fontSize:11, color:'var(--gray-400)', alignSelf:'center' }}>{total.toLocaleString()} result{total !== 1 ? 's' : ''}</span>
            </div>
          )}

          {loading && !items.length ? (
            <div className="loading-state"><div className="loading-spin"/></div>
          ) : (
            <div className="od-card">
              <table className="od-items-table">
                <thead>
                  <tr>
                    <th>Item No</th>
                    <th>Item Code</th>
                    <th>Brand</th>
                    <th>Category</th>
                    <th>Subcategory</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} onClick={() => navigate('/items/' + item.id)} style={{ cursor:'pointer' }}>
                      <td className="mono" style={{ fontSize:11, color:'var(--gray-400)', fontWeight:600 }}>{item.item_no || '—'}</td>
                      <td><span style={{ fontFamily:'var(--mono)', fontSize:12, fontWeight:600, color:'var(--gray-900)' }}>{item.item_code}</span></td>
                      <td style={{ fontSize:13 }}>{item.brand || '—'}</td>
                      <td style={{ fontSize:13 }}>{item.category || '—'}</td>
                      <td style={{ fontSize:12, color:'var(--gray-500)' }}>{item.subcategory || '—'}</td>
                      <td><TypeBadge type={item.type}/></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!items.length && (
                <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--gray-400)' }}>
                  No items found{search.trim() ? ` for "${search}"` : ''}
                </div>
              )}

              {/* Pagination */}
              {total > PAGE_SIZE && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 16px', borderTop:'1px solid var(--gray-100)', flexWrap:'wrap', gap:8 }}>
                  <span style={{ fontSize:12, color:'var(--gray-500)' }}>
                    Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total.toLocaleString()}
                  </span>
                  <div style={{ display:'flex', gap:4 }}>
                    <button onClick={() => loadItems({ p: page-1 })} disabled={page===1}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:page===1?'default':'pointer', color:page===1?'var(--gray-300)':'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>‹</button>
                    {Array.from({ length: totalPages }, (_,i) => i+1).map(p => {
                      const show = totalPages <= 7 || p===1 || p===totalPages || Math.abs(p-page)<=1
                      const ellipsis = !show && Math.abs(p-page)===2
                      if (ellipsis) return <span key={p} style={{ padding:'0 4px', color:'var(--gray-400)', fontSize:13 }}>…</span>
                      if (!show) return null
                      return <button key={p} onClick={() => loadItems({ p })}
                        style={{ padding:'5px 10px', borderRadius:6, border:'1px solid', borderColor:p===page?'#1a4dab':'var(--gray-200)', background:p===page?'#1a4dab':'white', color:p===page?'white':'var(--gray-700)', fontWeight:p===page?700:400, fontSize:13, cursor:'pointer', fontFamily:'var(--font)' }}>{p}</button>
                    })}
                    <button onClick={() => loadItems({ p: page+1 })} disabled={page===totalPages}
                      style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:page===totalPages?'default':'pointer', color:page===totalPages?'var(--gray-300)':'var(--gray-700)', fontSize:13, fontFamily:'var(--font)' }}>›</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
