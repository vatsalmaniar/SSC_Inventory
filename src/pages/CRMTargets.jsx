import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm.css'
import { toast } from '../lib/toast'

const TARGET_TYPES = ['REVENUE','VISITS','NEW_LEADS','CONVERSIONS']
const TARGET_LABELS = { REVENUE:'Revenue (INR)', VISITS:'Field Visits', NEW_LEADS:'New Leads', CONVERSIONS:'Conversions' }

function getPeriods() {
  const periods = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    periods.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
  }
  return periods
}

function formatVal(type, val) {
  if (!val && val !== 0) return '—'
  if (type === 'REVENUE') return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return String(Math.round(val))
}

function pct(achieved, target) {
  if (!target) return 0
  return Math.min(100, Math.round((achieved / target) * 100))
}

export default function CRMTargets() {
  const navigate = useNavigate()
  const [user, setUser]     = useState({ name:'', role:'', id:'' })
  const [targets, setTargets] = useState([])
  const [reps, setReps]     = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  })
  const [editingCell, setEditingCell] = useState(null) // { repId, type }
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)
  const saveGuard = useRef(false)

  const periods = getPeriods()

  useEffect(() => { init() }, [])
  useEffect(() => { loadTargets() }, [period])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: profile } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).single()
    setUser({ name: profile?.name||'', role: profile?.role||'sales', id: session.user.id })
    if (!['sales','admin','management'].includes(profile?.role)) { navigate('/dashboard'); return }
    const { data: repsData } = await sb.from('profiles').select('id,name').in('role',['sales','admin'])
    setReps(repsData || [])
  }

  async function loadTargets(silent) {
    if (!silent) setLoading(true)
    const { data } = await sb.from('crm_targets').select('*').eq('period', period)
    setTargets(data || [])
    setLoading(false)
  }

  function getTarget(repId, type) {
    return targets.find(t => t.rep_id === repId && t.target_type === type)
  }

  async function saveTarget(repId, type, targetValue, achievedValue) {
    if (saveGuard.current) return
    saveGuard.current = true
    setSaving(true)
    const existing = getTarget(repId, type)
    if (existing) {
      await sb.from('crm_targets').update({ target_value: targetValue, achieved_value: achievedValue }).eq('id', existing.id)
    } else {
      await sb.from('crm_targets').insert({ rep_id: repId, period, target_type: type, target_value: targetValue, achieved_value: achievedValue })
    }
    await loadTargets()
    toast('Target saved', 'success')
    setEditingCell(null); setEditVal(''); saveGuard.current = false; setSaving(false)
  }

  const isManager = ['admin','management'].includes(user.role)

  const displayReps = isManager
    ? reps
    : reps.filter(r => r.id === user.id)

  return (
    <Layout pageTitle="CRM — Targets" pageKey="crm">
      <div className="crm-page">
        <div className="crm-body">
          <div className="crm-page-header">
            <div>
              <div className="crm-page-title">Targets & Achieved</div>
              <div className="crm-page-sub">{period}</div>
            </div>
            <div className="crm-header-actions">
              <select className="crm-filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
                {periods.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="crm-loading"><div className="loading-spin"/></div>
          ) : isManager ? (
            // Manager view: table of all reps
            <div className="crm-card">
              <div className="crm-table-wrap">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Rep</th>
                      {TARGET_TYPES.map(t => (
                        <th key={t} colSpan={2} style={{textAlign:'center'}}>{TARGET_LABELS[t]}</th>
                      ))}
                    </tr>
                    <tr>
                      <th></th>
                      {TARGET_TYPES.map(t => (
                        <>
                          <th key={t+'_t'} style={{fontSize:10,color:'var(--gray-400)'}}>Target</th>
                          <th key={t+'_a'} style={{fontSize:10,color:'var(--gray-400)'}}>Achieved</th>
                        </>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayReps.map(rep => (
                      <tr key={rep.id} style={{cursor:'default'}}>
                        <td style={{fontWeight:600}}>{rep.name}</td>
                        {TARGET_TYPES.map(type => {
                          const t = getTarget(rep.id, type)
                          const p = pct(t?.achieved_value || 0, t?.target_value || 0)
                          const isEditing = editingCell?.repId === rep.id && editingCell?.type === type
                          return (
                            <>
                              <td key={type+'_t'} onClick={() => { if (isManager) { setEditingCell({repId:rep.id,type,field:'target'}); setEditVal(t?.target_value||'') } }}>
                                {isEditing && editingCell.field === 'target' ? (
                                  <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                                    onBlur={() => saveTarget(rep.id, type, editVal, t?.achieved_value || 0)}
                                    onKeyDown={e => e.key === 'Enter' && saveTarget(rep.id, type, editVal, t?.achieved_value || 0)}
                                    style={{width:80,padding:'3px 6px',border:'1px solid #1A3A8F',borderRadius:4,fontSize:12}} autoFocus />
                                ) : (
                                  <div style={{cursor:'pointer',fontSize:12,color:t?.target_value?'var(--gray-800)':'var(--gray-300)'}}>
                                    {formatVal(type, t?.target_value) || 'Set target'}
                                  </div>
                                )}
                              </td>
                              <td key={type+'_a'}>
                                <div>
                                  <div style={{fontSize:12,fontWeight:600,color:p>=100?'#15803d':p>=70?'var(--gray-800)':'var(--gray-700)'}}>
                                    {formatVal(type, t?.achieved_value || 0)}
                                  </div>
                                  {t?.target_value > 0 && (
                                    <div className="crm-progress-bar" style={{width:80}}>
                                      <div className={'crm-progress-fill' + (p>=100?' over':'')} style={{width:p+'%'}}/>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{padding:'12px 16px',fontSize:11,color:'var(--gray-400)'}}>Click a target value to edit it.</div>
            </div>
          ) : (
            // Rep view: own targets as tiles
            <div>
              <div className="crm-summary-row">
                {TARGET_TYPES.map(type => {
                  const t = getTarget(user.id, type)
                  const p = pct(t?.achieved_value || 0, t?.target_value || 0)
                  return (
                    <div key={type} className="crm-summary-tile">
                      <div className="crm-summary-label">{TARGET_LABELS[type]}</div>
                      <div style={{display:'flex',alignItems:'baseline',gap:6,marginTop:6}}>
                        <div style={{fontSize:22,fontWeight:800,color:p>=100?'#15803d':'var(--gray-900)'}}>{formatVal(type, t?.achieved_value || 0)}</div>
                        {t?.target_value > 0 && <div style={{fontSize:13,color:'var(--gray-400)'}}>/ {formatVal(type, t.target_value)}</div>}
                      </div>
                      {t?.target_value > 0 && (
                        <>
                          <div className="crm-progress-bar">
                            <div className={'crm-progress-fill' + (p>=100?' over':'')} style={{width:p+'%'}}/>
                          </div>
                          <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>{p}% achieved</div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
