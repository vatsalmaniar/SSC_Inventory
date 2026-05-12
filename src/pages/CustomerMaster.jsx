import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt } from '../lib/fmt'
import { toast } from '../lib/toast'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const PAGE_SIZE = 50
const CREDIT_OPTIONS = ['Against PI','Against Delivery','7 Days','15 Days','30 Days','45 Days','60 Days','75 Days','90 Days']
const TYPE_OPTIONS = ['OEM','Panel Builder','End User','Trader']
const NEW_CUSTOMER_FLOOR = '2026-04-06'

const CREDIT_COLORS = {
  'Against PI':'#94A3B8', 'Against Delivery':'#C2410C',
  '7 Days':'#D97706', '15 Days':'#F59E0B', '30 Days':'#22C55E',
  '45 Days':'#0F766E', '60 Days':'#1E54B7', '75 Days':'#1E40AF', '90 Days':'#5B21B6',
}

const REP_PALETTE = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return REP_PALETTE[Math.abs(h)%REP_PALETTE.length] }
function initials(name) { return (name||'').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?' }
function isNewCustomer(created_at) { if (!created_at) return false; return created_at >= NEW_CUSTOMER_FLOOR }

export default function CustomerMaster() {
  const navigate = useNavigate()
  const location = useLocation()
  const [customers, setCustomers] = useState([])
  const [pending, setPending] = useState([])
  const [creditCheck, setCreditCheck] = useState([])
  const [userRole, setUserRole] = useState('')
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('approved')
  const [submitted, setSubmitted] = useState(location.state?.submitted || false)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filterNew, setFilterNew] = useState(false)
  const [filterTerms, setFilterTerms] = useState('')
  const [filterRep, setFilterRep] = useState('')
  const [filterType, setFilterType] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => { init() }, [])
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('search')
    if (q) { setSearch(q); loadCustomers({ q, p:1 }) }
  }, [location.search])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    setUserRole(role)
    const { data: repData } = await sb.from('profiles').select('name').in('role',['sales','ops','admin','management']).order('name')
    setReps((repData || []).map(r => r.name))
    if (role === 'admin') {
      const [pendRes, ccRes] = await Promise.all([
        sb.from('customers').select('id,customer_id,customer_name,account_owner,gst,credit_terms,created_at')
          .eq('approval_status', 'pending').order('created_at', { ascending: false }),
        sb.from('customers').select('id,customer_id,customer_name,account_owner,gst,credit_terms,created_at')
          .eq('approval_status', 'approved').eq('credit_check_status', 'pending')
          .gte('created_at', NEW_CUSTOMER_FLOOR).order('created_at', { ascending: false }),
      ])
      setPending(pendRes.data || []); setCreditCheck(ccRes.data || [])
    }
    await loadCustomers({ p:1 })
    setLoading(false)
  }

  async function loadCustomers(opts = {}) {
    const p = opts.p ?? page
    const q = opts.q ?? search
    const fnew = opts.fnew ?? filterNew
    const terms = opts.terms ?? filterTerms
    const rep = opts.rep ?? filterRep
    const type = opts.type ?? filterType
    if (!opts.silent) setLoading(true)
    let query = sb.from('customers')
      .select('id,customer_id,customer_name,account_owner,gst,credit_terms,customer_type,created_at', { count:'exact' })
      .eq('approval_status', 'approved').order('customer_name')
    if (q.trim()) query = query.or(`customer_name.ilike.%${q.trim()}%,gst.ilike.%${q.trim()}%,account_owner.ilike.%${q.trim()}%`)
    if (fnew) query = query.gte('created_at', NEW_CUSTOMER_FLOOR)
    if (terms) query = query.eq('credit_terms', terms)
    if (rep) query = query.ilike('account_owner', rep)
    if (type) query = query.eq('customer_type', type)
    const from = (p - 1) * PAGE_SIZE
    query = query.range(from, from + PAGE_SIZE - 1)
    const { data, count } = await query
    setCustomers(data || []); setTotal(count || 0); setPage(p); setLoading(false); setSearching(false)
  }

  function handleSearch(val) {
    setSearch(val); setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadCustomers({ q: val, p:1 }), 300)
  }
  function applyFilter(key, val) {
    const updates = { fnew: filterNew, terms: filterTerms, rep: filterRep, type: filterType, [key]: val }
    if (key === 'fnew') setFilterNew(val)
    if (key === 'terms') setFilterTerms(val)
    if (key === 'rep') setFilterRep(val)
    if (key === 'type') setFilterType(val)
    loadCustomers({ p:1, ...updates })
  }
  function clearFilters() {
    setFilterNew(false); setFilterTerms(''); setFilterRep(''); setFilterType('')
    loadCustomers({ p:1, fnew:false, terms:'', rep:'', type:'' })
  }

  const hasFilters = filterNew || filterTerms || filterRep || filterType
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const [downloading, setDownloading] = useState(false)
  async function downloadSummary() {
    if (downloading) return
    setDownloading(true)
    try {
      // Fetch ALL matching customers (paginated so we don't blow the 1000-row default cap)
      let query = sb.from('customers')
        .select('customer_id,customer_name,account_owner,gst,credit_terms,customer_type,billing_address,shipping_address,created_at')
        .eq('approval_status', 'approved').order('customer_name')
      if (search.trim()) query = query.or(`customer_name.ilike.%${search.trim()}%,gst.ilike.%${search.trim()}%,account_owner.ilike.%${search.trim()}%`)
      if (filterNew) query = query.gte('created_at', NEW_CUSTOMER_FLOOR)
      if (filterTerms) query = query.eq('credit_terms', filterTerms)
      if (filterRep) query = query.ilike('account_owner', filterRep)
      if (filterType) query = query.eq('customer_type', filterType)

      const all = []
      const PAGE = 1000
      let from = 0
      while (true) {
        const { data, error } = await query.range(from, from + PAGE - 1)
        if (error) { toast('Export failed: ' + error.message); setDownloading(false); return }
        if (!data?.length) break
        all.push(...data)
        if (data.length < PAGE) break
        from += PAGE
      }
      if (!all.length) { toast('No customers to export'); setDownloading(false); return }

      let ExcelJS
      try { ExcelJS = (await import('exceljs')).default } catch (e) { toast('Failed to load Excel library: ' + e.message); setDownloading(false); return }

      const wb = new ExcelJS.Workbook()
      wb.creator = 'SSC ERP'; wb.created = new Date()
      const ws = wb.addWorksheet('Customers', { views: [{ state: 'frozen', ySplit: 1 }] })
      const cols = [
        { header: 'Customer ID',      key: 'customer_id',      width: 14 },
        { header: 'Customer Name',    key: 'customer_name',    width: 36 },
        { header: 'Type',             key: 'customer_type',    width: 14 },
        { header: 'Account Owner',    key: 'account_owner',    width: 20 },
        { header: 'GST',              key: 'gst',              width: 18 },
        { header: 'Credit Terms',     key: 'credit_terms',     width: 16 },
        { header: 'Billing Address',  key: 'billing_address',  width: 50 },
        { header: 'Shipping Address', key: 'shipping_address', width: 50 },
        { header: 'Created On',       key: 'created_at',       width: 13 },
      ]
      ws.columns = cols

      const termsStyle = (t) => CREDIT_COLORS[t] ? { bg: 'FFF1F5F9', fg: CREDIT_COLORS[t].replace('#', 'FF') } : null
      const typeStyle = (t) => {
        switch (t) {
          case 'OEM':           return { bg: 'FFDBEAFE', fg: 'FF1E40AF' }
          case 'Panel Builder': return { bg: 'FFE0E7FF', fg: 'FF3730A3' }
          case 'End User':      return { bg: 'FFDCFCE7', fg: 'FF166534' }
          case 'Trader':        return { bg: 'FFFEF3C7', fg: 'FF92400E' }
          default:              return null
        }
      }
      all.forEach(c => {
        const row = ws.addRow({
          customer_id:      c.customer_id || '',
          customer_name:    c.customer_name || '',
          customer_type:    c.customer_type || '',
          account_owner:    c.account_owner || '',
          gst:              c.gst || '',
          credit_terms:     c.credit_terms || '',
          billing_address:  c.billing_address || '',
          shipping_address: c.shipping_address || '',
          created_at:       c.created_at ? fmt(c.created_at) : '',
        })
        const idCell = row.getCell('customer_id')
        idCell.font = { name: 'Geist Mono', bold: true, color: { argb: 'FF1E54B7' } }
        const ts = typeStyle(c.customer_type)
        if (ts) {
          const tc = row.getCell('customer_type')
          tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ts.bg } }
          tc.font = { bold: true, color: { argb: ts.fg } }
          tc.alignment = { horizontal: 'center', vertical: 'middle' }
        }
        const cs = termsStyle(c.credit_terms)
        if (cs) {
          const ctc = row.getCell('credit_terms')
          ctc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: cs.bg } }
          ctc.font = { bold: true, color: { argb: cs.fg } }
          ctc.alignment = { horizontal: 'center', vertical: 'middle' }
        }
        // Wrap long address cells
        row.getCell('billing_address').alignment  = { wrapText: true, vertical: 'top' }
        row.getCell('shipping_address').alignment = { wrapText: true, vertical: 'top' }
      })

      const header = ws.getRow(1)
      header.height = 24
      header.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A2540' } }
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
        cell.alignment = { vertical: 'middle', horizontal: 'left' }
        cell.border = { bottom: { style: 'thin', color: { argb: 'FF143055' } } }
      })
      const lastRow = ws.rowCount
      for (let r = 2; r <= lastRow; r++) {
        const row = ws.getRow(r)
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } }
        })
        if (r % 2 === 0) {
          row.eachCell({ includeEmpty: true }, cell => {
            const isTinted = cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor?.argb !== 'FFFFFFFF'
            if (!isTinted) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
          })
        }
      }
      ws.autoFilter = { from: { row:1, column:1 }, to: { row:1, column: cols.length } }
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const fname = `SSC_Customers_${hasFilters ? 'Filtered_' : ''}${new Date().toISOString().slice(0,10)}.xlsx`
      const a = document.createElement('a'); a.href = url; a.download = fname
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) {
      toast('Export failed: ' + (e.message || e))
    }
    setDownloading(false)
  }

  return (
    <Layout pageTitle="Customer 360" pageKey="customer360">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Customer 360</h1>
            <div className="o-summary">
              <span><b>{total}</b> account{total !== 1 ? 's' : ''}</span>
              <span className="o-sep">·</span>
              <span>Customer Directory</span>
            </div>
          </div>
          <div className="page-meta">
            {userRole === 'admin' && creditCheck.length > 0 && (
              <button className={`o-test-toggle ${tab === 'creditcheck' ? 'on' : ''}`} onClick={() => setTab(t => t === 'creditcheck' ? 'approved' : 'creditcheck')}>
                <span style={{ background:'#F59E0B', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{creditCheck.length}</span>
                Credit Check
              </button>
            )}
            {userRole === 'admin' && pending.length > 0 && (
              <button className={`o-test-toggle ${tab === 'pending' ? 'on' : ''}`} onClick={() => setTab(t => t === 'pending' ? 'approved' : 'pending')}>
                <span style={{ background:'#F59E0B', color:'#fff', borderRadius:'50%', width:18, height:18, fontSize:10, fontWeight:700, display:'inline-flex', alignItems:'center', justifyContent:'center' }}>{pending.length}</span>
                Pending Approval
              </button>
            )}
            <div className="o-dl-group">
              <button className="o-dl-btn" onClick={downloadSummary} disabled={downloading} title="Summary Excel">
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                {downloading ? 'Exporting…' : 'Summary'}
              </button>
            </div>
            <button className="btn-primary" onClick={() => navigate('/customers/new')}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New Customer
            </button>
          </div>
        </div>

        {submitted && (
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)', borderRadius:10, padding:'12px 16px', marginTop:12, color:'#047857' }}>
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width:18, height:18 }}><polyline points="20 6 9 17 4 12"/></svg>
            <div>
              <div style={{ fontSize:13, fontWeight:600 }}>Customer submitted for approval</div>
              <div style={{ fontSize:12, opacity:0.85 }}>An admin will review and approve the new account.</div>
            </div>
            <button onClick={() => setSubmitted(false)} style={{ marginLeft:'auto', background:'none', border:'none', color:'#047857', cursor:'pointer', fontSize:18 }}>×</button>
          </div>
        )}

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by name, GST, owner…" value={search} onChange={e => handleSearch(e.target.value)}/>
            {search && (
              <button className="o-search-clear" onClick={() => { setSearch(''); loadCustomers({ q:'', p:1 }) }}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <button className={`o-chip ${filterNew ? 'on' : ''}`} onClick={() => applyFilter('fnew', !filterNew)} style={{ marginLeft: 4 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background: filterNew ? '#fff' : '#22C55E', display:'inline-block' }}/>
            New Customer
          </button>
          <select className="filt-select" value={filterTerms} onChange={e => applyFilter('terms', e.target.value)}>
            <option value="">Payment Terms</option>
            {CREDIT_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="filt-select" value={filterType} onChange={e => applyFilter('type', e.target.value)}>
            <option value="">Type: All</option>
            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="filt-select" value={filterRep} onChange={e => applyFilter('rep', e.target.value)}>
            <option value="">Sales Rep</option>
            {reps.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          {hasFilters && <button className="opps-clear" onClick={clearFilters}>Clear</button>}
        </div>

        {loading ? (
          <div className="o-loading">Loading customers…</div>
        ) : tab === 'creditcheck' ? (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 160px 140px 130px 110px' }}>
              <div>Cust ID</div><div>Customer Name</div><div>Account Owner</div><div>GST</div><div>Credit Terms</div><div>Created</div>
            </div>
            {creditCheck.length === 0 ? (
              <div className="ol-empty"><div className="ol-empty-title">No credit checks pending</div></div>
            ) : (
              <div className="ol-table">
                {creditCheck.map(c => (
                  <div key={c.id} className="ol-row ol-data" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 160px 140px 130px 110px' }} onClick={() => navigate('/customers/' + c.id)}>
                    <div className="ol-cell ol-num" style={{ fontSize: 11 }}>{c.customer_id || '—'}</div>
                    <div className="ol-cell">
                      <div className="ol-cust" style={{ fontWeight: 500 }}>{c.customer_name}</div>
                      <span className="ol-sample-tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}>Credit Check</span>
                    </div>
                    <div className="ol-cell">{c.account_owner ? <div className="ol-owner" title={c.account_owner}><div className="ol-owner-avatar" style={{ background: ownerColor(c.account_owner) }}>{initials(c.account_owner)}</div><span className="ol-owner-name">{c.account_owner}</span></div> : <span style={{color:'var(--o-muted-2)'}}>—</span>}</div>
                    <div className="ol-cell" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5 }}>{c.gst || '—'}</div>
                    <div className="ol-cell">{c.credit_terms ? <span className="ol-status-pill" style={{ '--stage-color': CREDIT_COLORS[c.credit_terms] || '#94A3B8' }}><span className="ol-status-dot"/>{c.credit_terms}</span> : <span style={{color:'var(--o-muted-2)'}}>—</span>}</div>
                    <div className="ol-cell ol-date">{c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'pending' ? (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 160px 140px 110px' }}>
              <div>Cust ID</div><div>Customer Name</div><div>Account Owner</div><div>GST</div><div>Submitted</div>
            </div>
            {pending.length === 0 ? (
              <div className="ol-empty"><div className="ol-empty-title">No pending approvals</div></div>
            ) : (
              <div className="ol-table">
                {pending.map(c => (
                  <div key={c.id} className="ol-row ol-data" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 160px 140px 110px' }} onClick={() => navigate('/customers/' + c.id)}>
                    <div className="ol-cell ol-num" style={{ fontSize: 11 }}>{c.customer_id || '—'}</div>
                    <div className="ol-cell">
                      <div className="ol-cust" style={{ fontWeight: 500 }}>{c.customer_name}</div>
                      <span className="ol-sample-tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}>Pending Approval</span>
                    </div>
                    <div className="ol-cell">{c.account_owner ? <div className="ol-owner" title={c.account_owner}><div className="ol-owner-avatar" style={{ background: ownerColor(c.account_owner) }}>{initials(c.account_owner)}</div><span className="ol-owner-name">{c.account_owner}</span></div> : <span style={{color:'var(--o-muted-2)'}}>—</span>}</div>
                    <div className="ol-cell" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5 }}>{c.gst || '—'}</div>
                    <div className="ol-cell ol-date">{c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px 160px 140px 130px' }}>
              <div>Cust ID</div>
              <div>Customer Name</div>
              <div>Type</div>
              <div>Account Owner</div>
              <div>GST Number</div>
              <div>Credit Terms</div>
            </div>
            {customers.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No customers found{search.trim() ? ` for "${search}"` : ''}</div>
              </div>
            ) : (
              <div className="ol-table">
                {customers.map(c => (
                  <div key={c.id} className="ol-row ol-data" style={{ gridTemplateColumns: '120px minmax(0, 1.4fr) 130px 160px 140px 130px' }} onClick={() => navigate('/customers/' + c.id)}>
                    <div className="ol-cell ol-num" style={{ fontSize: 11 }}>{c.customer_id || '—'}</div>
                    <div className="ol-cell">
                      <div style={{ display:'flex', alignItems:'center', gap:7, minWidth: 0 }}>
                        <div className="ol-cust" style={{ fontWeight: 500 }}>{c.customer_name}</div>
                        {isNewCustomer(c.created_at) && <span className="ol-sample-tag" style={{ background:'rgba(34,197,94,0.12)', color:'#15803D' }}>New</span>}
                      </div>
                    </div>
                    <div className="ol-cell"><span className="dl-pr-tag" style={{ display:'inline-block', fontSize:11, fontWeight:500, padding:'3px 8px', borderRadius:5, background:'var(--o-bg-2)', border:'1px solid var(--o-line)', color:'var(--o-ink)', whiteSpace:'nowrap' }}>{c.customer_type || '—'}</span></div>
                    <div className="ol-cell">{c.account_owner ? <div className="ol-owner" title={c.account_owner}><div className="ol-owner-avatar" style={{ background: ownerColor(c.account_owner) }}>{initials(c.account_owner)}</div><span className="ol-owner-name">{c.account_owner}</span></div> : <span style={{color:'var(--o-muted-2)'}}>—</span>}</div>
                    <div className="ol-cell" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11.5 }}>{c.gst || '—'}</div>
                    <div className="ol-cell">{c.credit_terms ? <span className="ol-status-pill" style={{ '--stage-color': CREDIT_COLORS[c.credit_terms] || '#94A3B8' }}><span className="ol-status-dot"/>{c.credit_terms}</span> : <span style={{color:'var(--o-muted-2)'}}>—</span>}</div>
                  </div>
                ))}
              </div>
            )}
            {total > PAGE_SIZE && (
              <div className="ol-foot">
                <span>Showing {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, total)} of {total}</span>
                <div className="ol-pages">
                  <button className="ol-page-btn" onClick={() => loadCustomers({ p: page-1 })} disabled={page === 1}>‹ Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => {
                    const show = totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1
                    const ellipsis = !show && Math.abs(p - page) === 2
                    if (show) return <button key={p} className={`ol-page-btn ${p === page ? 'on' : ''}`} onClick={() => loadCustomers({ p })}>{p}</button>
                    if (ellipsis) return <span key={'e'+p} style={{ padding: '5px 4px', color: 'var(--o-muted-2)' }}>…</span>
                    return null
                  })}
                  <button className="ol-page-btn" onClick={() => loadCustomers({ p: page+1 })} disabled={page === totalPages}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}
