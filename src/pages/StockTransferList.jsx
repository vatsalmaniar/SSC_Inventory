import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders.css'

const STATUS_LABELS = { draft: 'Draft', dispatched: 'In Transit', received: 'Received', cancelled: 'Cancelled' }
const STATUS_COLORS = {
  draft:      { bg: '#fef3c7', fg: '#92400e' },
  dispatched: { bg: '#dbeafe', fg: '#1e40af' },
  received:   { bg: '#d1fae5', fg: '#065f46' },
  cancelled:  { bg: '#fee2e2', fg: '#991b1b' },
}

const FILTERS = [
  { key: 'all',        label: 'All' },
  { key: 'draft',      label: 'Draft' },
  { key: 'dispatched', label: 'In Transit' },
  { key: 'received',   label: 'Received' },
  { key: 'cancelled',  label: 'Cancelled' },
]

const PAGE_SIZE = 50

export default function StockTransferList() {
  const navigate = useNavigate()
  const [userRole, setUserRole]   = useState('')
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading]     = useState(true)
  const [filter, setFilter]       = useState('all')
  const [search, setSearch]       = useState('')
  const [testMode, setTestMode]   = useState(false)
  const [page, setPage]           = useState(1)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['ops','admin','management','fc_kaveri','fc_godawari','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadTransfers(role === 'demo' ? true : false)
  }

  async function loadTransfers(test) {
    setLoading(true)
    const { data, error } = await sb.from('stock_transfers')
      .select('*, stock_transfer_items(id)')
      .eq('is_test', test)
      .gte('created_at', FY_START)
      .order('created_at', { ascending: false })
    if (error) console.error('Transfer load error:', error)
    setTransfers(data || [])
    setLoading(false)
  }

  function matchFilter(t, f) {
    if (f === 'all') return true
    return t.status === f
  }

  const counts = FILTERS.reduce((acc, { key }) => {
    acc[key] = transfers.filter(t => matchFilter(t, key)).length
    return acc
  }, {})

  const filtered = transfers.filter(t => {
    if (!matchFilter(t, filter)) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      return (t.transfer_number || '').toLowerCase().includes(q)
        || (t.source_fc || '').toLowerCase().includes(q)
        || (t.destination_fc || '').toLowerCase().includes(q)
    }
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const isAdmin = userRole === 'admin'
  const canCreate = ['ops','admin','management','fc_kaveri','fc_godawari'].includes(userRole)

  return (
    <Layout pageTitle="Stock Transfers" pageKey="fc">
      <div style={{ padding: '24px 32px', maxWidth: 1280, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--gray-900)' }}>Stock Transfers</div>
            <div style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 2 }}>Move stock between Kaveri & Godawari</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
            {isAdmin && (
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:12, color: testMode ? '#b45309' : 'var(--gray-500)', fontWeight: testMode ? 600 : 400, background: testMode ? '#fef3c7' : 'transparent', border: testMode ? '1px solid #fde68a' : '1px solid var(--gray-200)', borderRadius:8, padding:'6px 12px' }}>
                <input type="checkbox" checked={testMode} onChange={e => { setTestMode(e.target.checked); loadTransfers(e.target.checked) }} style={{ accentColor:'#b45309', width:13, height:13 }} />
                Test Mode
              </label>
            )}
            {canCreate && (
              <button onClick={() => navigate('/fc/transfers/new')} className="new-order-btn">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:14, height:14 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Transfer
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div style={{ marginBottom: 14 }}>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by transfer # or FC..."
            style={{ width: '100%', padding: '10px 14px', border: '1.5px solid var(--gray-200)', borderRadius: 8, fontSize: 14, outline: 'none' }} />
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => { setFilter(f.key); setPage(1) }}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: '1px solid', cursor: 'pointer',
                background: filter === f.key ? 'var(--blue-700)' : 'white',
                color: filter === f.key ? 'white' : 'var(--gray-600)',
                borderColor: filter === f.key ? 'var(--blue-700)' : 'var(--gray-200)',
              }}>
              {f.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{counts[f.key] || 0}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: 'white', border: '1px solid var(--gray-100)', borderRadius: 10, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--gray-400)' }}>Loading...</div>
          ) : pageRows.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--gray-400)' }}>
              No transfers yet. {canCreate && <span style={{ display:'block', marginTop: 8, fontSize: 13 }}>Click "New Transfer" to create one.</span>}
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-100)' }}>
                  <th style={{ padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'left' }}>Transfer #</th>
                  <th style={{ padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'left' }}>Route</th>
                  <th style={{ padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'right' }}>Items</th>
                  <th style={{ padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'left' }}>Status</th>
                  <th style={{ padding:'10px 14px', fontSize:11, fontWeight:600, color:'var(--gray-500)', textAlign:'left' }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(t => {
                  const c = STATUS_COLORS[t.status] || STATUS_COLORS.draft
                  return (
                    <tr key={t.id} onClick={() => navigate('/fc/transfers/' + t.id)}
                      style={{ borderBottom:'1px solid var(--gray-50)', cursor:'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background='#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background='white'}>
                      <td style={{ padding:'12px 14px', fontSize:13, fontWeight:600, color:'var(--gray-900)', fontFamily:'var(--mono)' }}>{t.transfer_number || '—'}</td>
                      <td style={{ padding:'12px 14px', fontSize:13, color:'var(--gray-700)' }}>
                        {t.source_fc} <span style={{ color:'var(--gray-300)', margin:'0 6px' }}>→</span> {t.destination_fc}
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:13, color:'var(--gray-700)', textAlign:'right' }}>{(t.stock_transfer_items || []).length}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ background: c.bg, color: c.fg, padding:'3px 10px', borderRadius:6, fontSize:11, fontWeight:600 }}>{STATUS_LABELS[t.status] || t.status}</span>
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'var(--gray-500)' }}>{fmt(t.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', alignItems:'center', gap: 10, marginTop: 16 }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={{ padding:'6px 12px', border:'1px solid var(--gray-200)', borderRadius:6, background:'white', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>Prev</button>
            <span style={{ fontSize: 13, color: 'var(--gray-500)' }}>Page {page} of {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} style={{ padding:'6px 12px', border:'1px solid var(--gray-200)', borderRadius:6, background:'white', cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}>Next</button>
          </div>
        )}
      </div>
    </Layout>
  )
}
