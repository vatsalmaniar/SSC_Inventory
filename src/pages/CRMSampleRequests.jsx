import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { fmtNum } from '../lib/fmt'
import Layout from '../components/Layout'
import '../styles/crm.css'

const SR_STATUSES = ['Pending','Dispatched','Delivered']

function statusStyle(s) {
  if (s === 'Pending')    return { background:'#fffbeb', color:'#b45309' }
  if (s === 'Dispatched') return { background:'#e8f2fc', color:'#1a4dab' }
  if (s === 'Delivered')  return { background:'#f0fdf4', color:'#15803d' }
  return {}
}

export default function CRMSampleRequests() {
  const navigate = useNavigate()
  const [user, setUser]     = useState({ name:'', role:'', id:'' })
  const [srs, setSrs]       = useState([])
  const [reps, setReps]     = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterRep, setFilterRep] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [updating, setUpdating] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin'].includes(profile?.role)) { navigate('/dashboard'); return }

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
    if (status === 'Delivered')  updateData.delivered_date  = new Date().toISOString().slice(0,10)
    const { error } = await sb.from('crm_sample_requests').update(updateData).eq('id', srId)
    if (error) { toast('Error: ' + error.message); setUpdating(null); return }
    setSrs(prev => prev.map(s => s.id === srId ? { ...s, ...updateData } : s))
    toast('Status updated to ' + status, 'success')
    setUpdating(null)
  }

  const isManager = user.role === 'admin'
  const q = search.trim().toLowerCase()
  const filtered = srs
    .filter(s => !q || (s.sr_number||'').toLowerCase().includes(q) || (s.crm_companies?.company_name||'').toLowerCase().includes(q))
    .filter(s => !filterStatus || s.status === filterStatus)

  return (
    <Layout pageTitle="CRM — Sample Requests" pageKey="crm">
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Sample Requests</div>
              <div className="crm-page-sub">
                {filtered.filter(s => s.status === 'Pending').length} pending
                {' · '}{filtered.filter(s => s.status === 'Dispatched').length} dispatched
                {' · '}{filtered.filter(s => s.status === 'Delivered').length} delivered
              </div>
            </div>
          </div>

          <div className="crm-controls">
            <div className="crm-search-wrap">
              <svg className="crm-search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input className="crm-search-input" placeholder="Search SR number or company..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="crm-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {SR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/></div>
          ) : (
            <div className="crm-card">
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>SR Number</th>
                      <th>Company</th>
                      <th>Principal</th>
                      <th>Items</th>
                      <th>Requested</th>
                      <th>Dispatched</th>
                      <th>Delivered</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(s => (
                      <>
                        <tr key={s.id} onClick={() => setExpandedId(expandedId === s.id ? null : s.id)} style={{cursor:'pointer'}}>
                          <td>
                            <div className="crm-table-name">{s.sr_number}</div>
                            {s.crm_opportunities?.id && (
                              <div className="crm-table-sub" onClick={e => { e.stopPropagation(); navigate('/crm/opportunities/' + s.crm_opportunities.id) }} style={{cursor:'pointer',color:'#1A3A8F'}}>
                                View Opportunity →
                              </div>
                            )}
                          </td>
                          <td>{s.crm_companies?.company_name || '—'}</td>
                          <td>{s.crm_principals?.name || '—'}</td>
                          <td>{s.items?.length || 0} item{(s.items?.length||0) !== 1 ? 's' : ''}</td>
                          <td style={{whiteSpace:'nowrap'}}>{fmtNum(s.requested_date)}</td>
                          <td style={{whiteSpace:'nowrap'}}>{fmtNum(s.dispatched_date)}</td>
                          <td style={{whiteSpace:'nowrap'}}>{fmtNum(s.delivered_date)}</td>
                          <td><span style={{...statusStyle(s.status), fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 7px'}}>{s.status}</span></td>
                          <td>
                            <div style={{display:'flex',gap:6}} onClick={e => e.stopPropagation()}>
                              {s.status === 'Pending' && (
                                <button className="crm-btn crm-btn-sm" onClick={() => updateStatus(s.id, 'Dispatched')} disabled={updating === s.id}>
                                  {updating === s.id ? '...' : 'Dispatch'}
                                </button>
                              )}
                              {s.status === 'Dispatched' && (
                                <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => updateStatus(s.id, 'Delivered')} disabled={updating === s.id}>
                                  {updating === s.id ? '...' : 'Delivered'}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expandedId === s.id && (
                          <tr key={s.id + '_exp'}>
                            <td colSpan={9} style={{padding:'0 16px 12px',background:'var(--gray-50)'}}>
                              <div style={{fontSize:12,fontWeight:600,color:'var(--gray-500)',marginBottom:6,marginTop:8}}>ITEMS</div>
                              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {(s.items || []).map((item, idx) => (
                                  <div key={idx} style={{display:'flex',gap:16,alignItems:'center'}}>
                                    <div style={{fontWeight:600,color:'var(--gray-800)',minWidth:200}}>{item.product_name}</div>
                                    <div style={{color:'var(--gray-500)'}}>Qty: {item.qty}</div>
                                    {item.notes && <div style={{color:'var(--gray-400)'}}>{item.notes}</div>}
                                  </div>
                                ))}
                              </div>
                              {s.notes && <div style={{marginTop:8,fontSize:12,color:'var(--gray-600)'}}>Notes: {s.notes}</div>}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile */}
              <div className="crm-card-list">
                {filtered.map(s => (
                  <div key={s.id} className="crm-list-card" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                    <div className="crm-list-card-top">
                      <div>
                        <div className="crm-list-card-name">{s.sr_number}</div>
                        <div className="crm-list-card-sub">{s.crm_companies?.company_name || ''}{s.crm_principals?.name ? ' · ' + s.crm_principals.name : ''}</div>
                      </div>
                      <span style={{...statusStyle(s.status), fontSize:11, fontWeight:700, borderRadius:4, padding:'2px 7px', whiteSpace:'nowrap'}}>{s.status}</span>
                    </div>
                    <div className="crm-list-card-bottom">
                      <span style={{fontSize:11,color:'var(--gray-400)'}}>{s.items?.length || 0} items · {fmtNum(s.requested_date)}</span>
                      <div style={{display:'flex',gap:6}} onClick={e => e.stopPropagation()}>
                        {s.status === 'Pending' && <button className="crm-btn crm-btn-sm" onClick={() => updateStatus(s.id, 'Dispatched')}>Dispatch</button>}
                        {s.status === 'Dispatched' && <button className="crm-btn crm-btn-sm crm-btn-green" onClick={() => updateStatus(s.id, 'Delivered')}>Delivered</button>}
                      </div>
                    </div>
                    {expandedId === s.id && s.items?.length > 0 && (
                      <div style={{marginTop:8,paddingTop:8,borderTop:'1px solid var(--gray-100)'}}>
                        {s.items.map((item, idx) => (
                          <div key={idx} style={{fontSize:12,color:'var(--gray-700)',padding:'2px 0'}}>
                            {item.product_name} · Qty {item.qty}{item.notes?' · '+item.notes:''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {filtered.length === 0 && (
                <div className="crm-empty"><div className="crm-empty-title">No sample requests found</div></div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
