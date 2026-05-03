import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { fmt, FY_START, FY_LABEL } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/orders-redesign.css'

const STATUS_LABELS = { three_way_check:'3-Way Check', invoice_pending:'Invoice Pending', inward_complete:'Inward Complete' }
const STATUS_COLORS = { three_way_check:'#F59E0B', invoice_pending:'#1E54B7', inward_complete:'#22C55E' }

function fmtINR(val) {
  if (!val) return '₹0'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}
function fmtCr(val) {
  if (!val) return '₹0'
  if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
  if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
  return '₹' + Math.round(val).toLocaleString('en-IN')
}

const FILTERS = [
  { key:'action', label:'3-Way Check', tone:'warn' },
  { key:'invoice_pending', label:'Invoice Pending' },
  { key:'inward_complete', label:'Inward Complete' },
  { key:'all', label:'All' },
]

export default function PurchaseInvoiceList() {
  const navigate = useNavigate()
  const [userRole, setUserRole] = useState('')
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('action')
  const [search, setSearch] = useState('')

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    const role = profile?.role || 'sales'
    if (!['accounts','ops','admin','management','demo'].includes(role)) { navigate('/dashboard'); return }
    setUserRole(role)
    await loadInvoices()
  }

  async function loadInvoices() {
    setLoading(true)
    const { data } = await sb.from('purchase_invoices')
      .select('id, invoice_number, vendor_name, invoice_date, invoice_amount, gst_amount, total_amount, status, po_id, grn_id, created_at')
      .eq('is_test', false).gte('created_at', FY_START).order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  function matchFilter(inv) {
    const s = inv.status || 'three_way_check'
    if (filter === 'action') return s === 'three_way_check'
    if (filter === 'invoice_pending') return s === 'invoice_pending'
    if (filter === 'inward_complete') return s === 'inward_complete'
    if (filter === 'all') return true
    return s === filter
  }

  const counts = {
    action: invoices.filter(i => (i.status || 'three_way_check') === 'three_way_check').length,
    invoice_pending: invoices.filter(i => i.status === 'invoice_pending').length,
    inward_complete: invoices.filter(i => i.status === 'inward_complete').length,
    all: invoices.length,
  }
  const q = search.trim().toLowerCase()
  const filtered = invoices.filter(matchFilter).filter(inv =>
    !q || (inv.invoice_number || '').toLowerCase().includes(q) || (inv.vendor_name || '').toLowerCase().includes(q)
  )
  const totalAmount = filtered.reduce((s, i) => s + (i.total_amount || 0), 0)

  return (
    <Layout pageTitle="Inward Billing" pageKey="billing">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Inward Billing — Purchase Invoices</h1>
            <div className="o-summary">
              <span><b>{filtered.length}</b> invoices</span>
              {totalAmount > 0 && (<><span className="o-sep">·</span><span><b>{fmtCr(totalAmount)}</b> total</span></>)}
              <span className="o-sep">·</span><span>{FY_LABEL}</span>
            </div>
          </div>
          <div className="page-meta">
            <button className="btn-ghost" onClick={() => navigate('/billing')}>Dashboard</button>
          </div>
        </div>

        <div className="kpi-row">
          <KpiTile variant="hero" tone="deep" label="3-Way Check" value={counts.action} sub="verify PO·GRN·invoice" chart="bars" onClick={() => setFilter('action')}/>
          <KpiTile variant="hero" tone="forest" label="Inward Complete" value={counts.inward_complete} sub="fully processed" chart="bars" onClick={() => setFilter('inward_complete')}/>
          <KpiTile variant="hero" tone="teal" label="Invoice Pending" value={counts.invoice_pending} sub="awaiting entry" chart="line" onClick={() => setFilter('invoice_pending')}/>
          <KpiTile label="Total Value" value={fmtCr(totalAmount)} sub="filtered amount"/>
          <KpiTile label="Total Invoices" value={counts.all} sub={FY_LABEL} onClick={() => setFilter('all')}/>
        </div>

        <div className="o-toolbar">
          <div className="o-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search invoice number, vendor…" value={search} onChange={e => setSearch(e.target.value)}/>
            {search && (
              <button className="o-search-clear" onClick={() => setSearch('')}>
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:12,height:12}}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
        </div>

        <div className="o-filter-row">
          {FILTERS.map(({ key, label, tone }) => {
            const c = counts[key] || 0
            return (
              <button key={key} className={`o-chip ${filter === key ? 'on' : ''} ${tone || ''}`} onClick={() => setFilter(key)}>
                {label}
                {c > 0 && <span className="o-chip-n">{c}</span>}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="o-loading">Loading invoices…</div>
        ) : (
          <div className="ol-wrap">
            <div className="ol-row ol-head" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 110px 110px 110px 110px 140px' }}>
              <div>Invoice #</div>
              <div>Vendor</div>
              <div>Invoice Date</div>
              <div className="num">Amount</div>
              <div className="num">GST</div>
              <div className="num">Total</div>
              <div className="num">Stage</div>
            </div>
            {filtered.length === 0 ? (
              <div className="ol-empty">
                <div className="ol-empty-title">No invoices here</div>
                <div style={{ fontSize: 13, color: 'var(--o-muted)' }}>Nothing to show right now.</div>
              </div>
            ) : (
              <div className="ol-table">
                {filtered.map(inv => {
                  const stage = inv.status || 'three_way_check'
                  return (
                    <div key={inv.id} className="ol-row ol-data" style={{ gridTemplateColumns: '180px minmax(0, 1.4fr) 110px 110px 110px 110px 140px' }} onClick={() => navigate('/procurement/invoices/' + inv.id)}>
                      <div className="ol-cell">
                        {inv.invoice_number ? (
                          <div className="ol-num" style={{ color: stage === 'inward_complete' ? '#047857' : 'var(--ssc-blue)' }}>{inv.invoice_number}</div>
                        ) : (
                          <div className="ol-num" style={{ color: '#92400E' }}>
                            Pending
                            <span className="ol-sample-tag" style={{ background: 'rgba(245,158,11,0.12)', color: '#B45309' }}>No Inv</span>
                          </div>
                        )}
                        <div className="ol-date-sub">{fmt(inv.created_at)}</div>
                      </div>
                      <div className="ol-cell ol-cust" title={inv.vendor_name}>{inv.vendor_name || '—'}</div>
                      <div className="ol-cell ol-date">{inv.invoice_date ? fmt(inv.invoice_date) : '—'}</div>
                      <div className="ol-cell ol-val">{inv.invoice_amount ? fmtINR(inv.invoice_amount) : '—'}</div>
                      <div className="ol-cell ol-pending">{inv.gst_amount ? fmtINR(inv.gst_amount) : '—'}</div>
                      <div className="ol-cell ol-val">{inv.total_amount ? fmtINR(inv.total_amount) : '—'}</div>
                      <div className="ol-cell ol-status-cell">
                        <span className="ol-status-pill" style={{ '--stage-color': STATUS_COLORS[stage] || '#94A3B8' }}>
                          <span className="ol-status-dot"/>
                          {STATUS_LABELS[stage] || stage}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function KpiTile({ label, value, sub, accent, variant, tone, chart, onClick }) {
  const isHero = variant === 'hero'
  return (
    <div className={`kpi-tile ${isHero ? `kpi-hero tone-${tone}` : ''} ${accent ? `accent-${accent}` : ''}`} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      {isHero && <KpiChart kind={chart}/>}
      <div className="kt-top">
        <div className="kt-label">{label}</div>
        {onClick && <span className="kt-arrow"><svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span>}
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
  if (kind === 'line') return (
    <svg className="kt-chart" viewBox="0 0 120 60" preserveAspectRatio="none">
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M0 45 L20 38 L40 42 L60 28 L80 32 L100 18 L120 22 L120 60 L0 60 Z" fill="currentColor" opacity="0.12"/>
    </svg>
  )
  return null
}
