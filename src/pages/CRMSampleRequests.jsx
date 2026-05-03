import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmtNum } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm-redesign.css'
import { friendlyError } from '../lib/errorMsg'

const SR_STATUSES = ['Pending','Dispatched','Delivered']
const STATUS_COLORS = { Pending:'#F59E0B', Dispatched:'#1E54B7', Delivered:'#22C55E' }

export default function CRMSampleRequests() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [srs, setSrs] = useState([])
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [updating, setUpdating] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    const [srsRes, repsRes] = await Promise.all([
      sb.from('crm_sample_requests').select('*, crm_companies(company_name), crm_principals(name), crm_opportunities(id), crm_contacts(name)').order('created_at', { ascending: false }),
      sb.from('profiles').select('id,name').in('role',['sales','admin']),
    ])
    setSrs(srsRes.data || [])
    setReps(repsRes.data || [])
    setLoading(false)
  }

  async function updateStatus(srId, status) {
    setUpdating(srId)
    const updateData = { status }
    if (status === 'Dispatched') updateData.dispatched_date = new Date().toISOString().slice(0,10)
    if (status === 'Delivered') updateData.delivered_date = new Date().toISOString().slice(0,10)
    const { error } = await sb.from('crm_sample_requests').update(updateData).eq('id', srId)
    if (error) { toast(friendlyError(error)); setUpdating(null); return }
    setSrs(prev => prev.map(s => s.id === srId ? { ...s, ...updateData } : s))
    toast('Status updated to ' + status, 'success')
    setUpdating(null)
  }

  const q = search.trim().toLowerCase()
  const filtered = srs
    .filter(s => !q || (s.sr_number||'').toLowerCase().includes(q) || (s.crm_companies?.company_name||'').toLowerCase().includes(q))
    .filter(s => !filterStatus || s.status === filterStatus)

  const counts = {
    Pending: srs.filter(s => s.status === 'Pending').length,
    Dispatched: srs.filter(s => s.status === 'Dispatched').length,
    Delivered: srs.filter(s => s.status === 'Delivered').length,
  }

  return (
    <Layout pageTitle="CRM — Sample Requests" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Sample Requests</h1>
            <div className="opps-summary">
              <span><b>{filtered.length}</b> requests</span>
              {counts.Pending > 0 && (<><span className="opps-dot">·</span><span style={{color:'#B45309'}}><b style={{color:'#B45309'}}>{counts.Pending}</b> pending</span></>)}
              {counts.Dispatched > 0 && (<><span className="opps-dot">·</span><span><b>{counts.Dispatched}</b> dispatched</span></>)}
              {counts.Delivered > 0 && (<><span className="opps-dot">·</span><span style={{color:'#047857'}}><b style={{color:'#047857'}}>{counts.Delivered}</b> delivered</span></>)}
            </div>
          </div>
        </div>

        <div className="opps-filters">
          <div className="opps-search">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search SR number or company…" value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <select className="filt-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Status: All</option>
            {SR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(search || filterStatus) && (
            <button className="opps-clear" onClick={() => { setSearch(''); setFilterStatus('') }}>Clear</button>
          )}
        </div>

        {loading ? (
          <div className="crm-loading">Loading sample requests…</div>
        ) : (
          <div className="dl-wrap">
            <div className="dl-row dl-head" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 80px 100px 100px 100px 130px 100px' }}>
              <div>SR Number</div>
              <div>Company</div>
              <div>Principal</div>
              <div className="num">Items</div>
              <div>Requested</div>
              <div>Dispatched</div>
              <div>Delivered</div>
              <div>Status</div>
              <div></div>
            </div>
            {filtered.length === 0 ? (
              <div className="dl-empty">No sample requests found</div>
            ) : (
              <div className="dl-table">
                {filtered.map(s => {
                  const color = STATUS_COLORS[s.status] || '#94A3B8'
                  return (
                    <div key={s.id}>
                      <div className="dl-row dl-data" style={{ gridTemplateColumns: '160px minmax(0, 1.4fr) 130px 80px 100px 100px 100px 130px 100px' }} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                        <div className="dl-cell dl-deal">
                          <div className="dl-title" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12.5 }}>{s.sr_number}</div>
                          {s.crm_opportunities?.id && (
                            <div className="dl-deal-meta" style={{ color: 'var(--ssc-blue)', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); navigate('/crm/opportunities/' + s.crm_opportunities.id) }}>
                              <span>View Opportunity →</span>
                            </div>
                          )}
                        </div>
                        <div className="dl-cell dl-cust">{s.crm_companies?.company_name || '—'}</div>
                        <div className="dl-cell"><span className="dl-pr-tag">{s.crm_principals?.name || '—'}</span></div>
                        <div className="dl-cell" style={{ textAlign: 'right', fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>{s.items?.length || 0}</div>
                        <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)' }}>{fmtNum(s.requested_date)}</div>
                        <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)' }}>{fmtNum(s.dispatched_date) || '—'}</div>
                        <div className="dl-cell" style={{ fontSize: 12, color: 'var(--c-muted)' }}>{fmtNum(s.delivered_date) || '—'}</div>
                        <div className="dl-cell">
                          <span className="dl-stage-pill" style={{ '--stage-color': color }}>
                            <span className="dl-stage-dot"/>
                            {s.status}
                          </span>
                        </div>
                        <div className="dl-cell" onClick={e => e.stopPropagation()}>
                          {s.status === 'Pending' && (
                            <button className="btn-primary" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => updateStatus(s.id, 'Dispatched')} disabled={updating === s.id}>
                              {updating === s.id ? '…' : 'Dispatch'}
                            </button>
                          )}
                          {s.status === 'Dispatched' && (
                            <button className="btn-primary" style={{ fontSize: 11, padding: '5px 10px', background: '#22C55E', borderColor: '#22C55E' }} onClick={() => updateStatus(s.id, 'Delivered')} disabled={updating === s.id}>
                              {updating === s.id ? '…' : 'Delivered'}
                            </button>
                          )}
                        </div>
                      </div>
                      {expandedId === s.id && (
                        <div style={{ padding: '12px 16px', background: 'var(--c-bg-2)', borderBottom: '1px solid var(--c-line-2)' }}>
                          <div style={{ fontSize: 11, fontFamily: 'Geist Mono, monospace', color: 'var(--c-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>ITEMS</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(s.items || []).map((item, idx) => (
                              <div key={idx} style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 12.5 }}>
                                <div style={{ fontWeight: 500, color: 'var(--c-ink)', minWidth: 200 }}>{item.product_name}</div>
                                <div style={{ color: 'var(--c-muted)', fontFamily: 'Geist Mono, monospace' }}>Qty: {item.qty}</div>
                                {item.notes && <div style={{ color: 'var(--c-muted-2)' }}>{item.notes}</div>}
                              </div>
                            ))}
                          </div>
                          {s.notes && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c-muted)' }}>Notes: {s.notes}</div>}
                        </div>
                      )}
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
