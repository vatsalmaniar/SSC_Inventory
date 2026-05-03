import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import Layout from '../components/Layout'
import '../styles/crm-redesign.css'
import { toast } from '../lib/toast'

const TARGET_TYPES = ['REVENUE','VISITS','NEW_LEADS','CONVERSIONS']
const TARGET_LABELS = { REVENUE:'Revenue (INR)', VISITS:'Field Visits', NEW_LEADS:'New Leads', CONVERSIONS:'Conversions' }
const TARGET_COLORS = { REVENUE:'#1E54B7', VISITS:'#0F766E', NEW_LEADS:'#0EA5E9', CONVERSIONS:'#22C55E' }

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
  if (type === 'REVENUE') {
    if (val >= 1e7) return '₹' + (val/1e7).toFixed(2) + ' Cr'
    if (val >= 1e5) return '₹' + (val/1e5).toFixed(2) + ' L'
    return '₹' + Math.round(val).toLocaleString('en-IN')
  }
  return String(Math.round(val))
}
function pct(achieved, target) {
  if (!target) return 0
  return Math.min(100, Math.round((achieved / target) * 100))
}

const _OC = ['#1E54B7','#0F766E','#15803d','#B45309','#0E7490','#5B21B6','#0369A1','#475569','#C2410C','#0d9488']
function ownerColor(n) { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return _OC[Math.abs(h)%_OC.length] }
function initials(name) { return (name||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?' }

export default function CRMTargets() {
  const navigate = useNavigate()
  const [user, setUser] = useState({ name:'', role:'', id:'' })
  const [targets, setTargets] = useState([])
  const [reps, setReps] = useState([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState(() => {
    const d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  })
  const [editingCell, setEditingCell] = useState(null)
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
    if (!['sales','admin','management','demo'].includes(profile?.role)) { navigate('/dashboard'); return }
    const { data: repsData } = await sb.from('profiles').select('id,name').in('role',['sales','admin'])
    setReps(repsData || [])
  }

  async function loadTargets() {
    setLoading(true)
    const { data } = await sb.from('crm_targets').select('*').eq('period', period)
    setTargets(data || [])
    setLoading(false)
  }

  function getTarget(repId, type) {
    return targets.find(t => t.rep_id === repId && t.target_type === type)
  }

  async function saveTarget(repId, type, targetValue, achievedValue) {
    if (saveGuard.current) return
    saveGuard.current = true; setSaving(true)
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
  const displayReps = isManager ? reps : reps.filter(r => r.id === user.id)

  return (
    <Layout pageTitle="CRM — Targets" pageKey="crm">
      <div className="crm-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Targets & Achieved</h1>
            <div className="opps-summary">
              <span><b>{period}</b> period</span>
              <span className="opps-dot">·</span>
              <span><b>{displayReps.length}</b> {displayReps.length === 1 ? 'rep' : 'reps'}</span>
            </div>
          </div>
          <div className="page-meta">
            <select className="filt-select" value={period} onChange={e => setPeriod(e.target.value)}>
              {periods.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="crm-loading">Loading targets…</div>
        ) : isManager ? (
          <div className="dl-wrap">
            <div className="dl-row dl-head" style={{ gridTemplateColumns: 'minmax(200px, 1fr) repeat(4, 1fr)' }}>
              <div>Rep</div>
              {TARGET_TYPES.map(t => <div key={t} style={{ textAlign: 'center' }}>{TARGET_LABELS[t]}</div>)}
            </div>
            <div className="dl-table">
              {displayReps.map(rep => (
                <div key={rep.id} className="dl-row" style={{ gridTemplateColumns: 'minmax(200px, 1fr) repeat(4, 1fr)', cursor: 'default', alignItems:'flex-start' }}>
                  <div className="dl-cell dl-owner">
                    <div className="dl-owner-avatar" style={{ background: ownerColor(rep.name) }}>{initials(rep.name)}</div>
                    <span className="dl-owner-name">{rep.name}</span>
                  </div>
                  {TARGET_TYPES.map(type => {
                    const t = getTarget(rep.id, type)
                    const p = pct(t?.achieved_value || 0, t?.target_value || 0)
                    const isEditing = editingCell?.repId === rep.id && editingCell?.type === type
                    const color = TARGET_COLORS[type]
                    return (
                      <div key={type} style={{ padding:'4px 6px', minWidth: 0 }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                          <div style={{ fontSize:10, color:'var(--c-muted)', fontFamily:'Geist Mono, monospace', letterSpacing:'0.04em' }}>TARGET</div>
                          <div onClick={() => { setEditingCell({repId:rep.id, type, field:'target'}); setEditVal(t?.target_value||'') }} style={{ cursor:'pointer' }}>
                            {isEditing ? (
                              <input type="number" value={editVal} onChange={e => setEditVal(e.target.value)}
                                onBlur={() => saveTarget(rep.id, type, editVal, t?.achieved_value || 0)}
                                onKeyDown={e => e.key === 'Enter' && saveTarget(rep.id, type, editVal, t?.achieved_value || 0)}
                                style={{ width:'100%', padding:'4px 8px', border:`1px solid ${color}`, borderRadius:6, fontSize:12, fontFamily:'inherit' }} autoFocus/>
                            ) : (
                              <div style={{ fontSize:13, fontWeight:600, color: t?.target_value ? 'var(--c-ink)' : 'var(--c-muted-2)', fontFamily:'Geist Mono, monospace' }}>
                                {formatVal(type, t?.target_value) || 'Set'}
                              </div>
                            )}
                          </div>
                          <div style={{ fontSize:10, color:'var(--c-muted)', fontFamily:'Geist Mono, monospace', letterSpacing:'0.04em', marginTop: 4 }}>ACHIEVED</div>
                          <div style={{ fontSize:13, fontWeight:600, color: p >= 100 ? '#047857' : 'var(--c-ink)', fontFamily:'Geist Mono, monospace' }}>
                            {formatVal(type, t?.achieved_value || 0)}
                          </div>
                          {t?.target_value > 0 && (
                            <div style={{ height:5, background:'var(--c-bg-2)', borderRadius:3, overflow:'hidden' }}>
                              <div style={{ width:p+'%', height:'100%', background: p >= 100 ? '#047857' : color, transition:'width 0.4s' }}/>
                            </div>
                          )}
                          {t?.target_value > 0 && (
                            <div style={{ fontSize:10, color:'var(--c-muted-2)', fontFamily:'Geist Mono, monospace' }}>{p}%</div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
            <div style={{ padding:'10px 16px', fontSize:11, color:'var(--c-muted-2)', borderTop:'1px solid var(--c-line)' }}>Click a target value to edit it.</div>
          </div>
        ) : (
          // Rep view: own targets as KPI tiles
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {TARGET_TYPES.map(type => {
              const t = getTarget(user.id, type)
              const p = pct(t?.achieved_value || 0, t?.target_value || 0)
              const color = TARGET_COLORS[type]
              return (
                <div key={type} className="kpi-tile">
                  <div className="kt-top">
                    <div className="kt-label">{TARGET_LABELS[type]}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                    <div className="kt-value" style={{ color: p >= 100 ? '#047857' : 'var(--c-ink)' }}>{formatVal(type, t?.achieved_value || 0)}</div>
                    {t?.target_value > 0 && <div style={{ fontSize:13, color:'var(--c-muted)', fontFamily:'Geist Mono, monospace' }}>/ {formatVal(type, t.target_value)}</div>}
                  </div>
                  {t?.target_value > 0 && (
                    <div style={{ marginTop: 'auto' }}>
                      <div style={{ height:6, background:'var(--c-bg-2)', borderRadius:3, overflow:'hidden' }}>
                        <div style={{ width:p+'%', height:'100%', background: p >= 100 ? '#047857' : color, transition:'width 0.4s' }}/>
                      </div>
                      <div style={{ fontSize:11, color:'var(--c-muted-2)', marginTop:4, fontFamily:'Geist Mono, monospace' }}>{p}% achieved</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
