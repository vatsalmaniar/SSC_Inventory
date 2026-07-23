import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/kpi-dashboard.css'
import '../styles/orderdetail.css'   // .od-btn family
import '../styles/expenses.css'      // .exp-cfg-input / .exp-cfg-mini

const fmtD = d => d ? new Date(d).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—'

function Field({ label, children }) {
  return <label className="exp-cfg-branch-field" style={{ display:'flex', flexDirection:'column', gap:5, alignItems:'flex-start' }}><span className="exp-cfg-mini">{label}</span>{children}</label>
}

export default function PeopleAttendanceConfig({ embed = false }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [cfg, setCfg] = useState(null)
  const [offices, setOffices] = useState([])
  const [holidays, setHolidays] = useState([])
  const [emps, setEmps] = useState([])
  const [nh, setNh] = useState({ holiday_date:'', name:'' })
  const savingCfg = useRef(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['admin','management'].includes(prof?.role)) { setDenied(true); setLoading(false); return }
    await load()
    setLoading(false)
  }

  async function load() {
    const [c, o, h, e] = await Promise.all([
      sb.from('attendance_config').select('*').maybeSingle(),
      sb.from('office_locations').select('*').order('name'),
      sb.from('holidays').select('*').eq('is_active', true).order('holiday_date'),
      sb.from('employees').select('id,full_name').neq('lifecycle_status','exited').order('full_name'),
    ])
    setCfg(c?.data || {}); setOffices(o?.data || []); setHolidays(h?.data || []); setEmps(e?.data || [])
  }

  async function saveCfg() {
    if (savingCfg.current) return
    savingCfg.current = true
    try {
      const p = { office_start:cfg.office_start, grace_until:cfg.grace_until, half_day_cutoff:cfg.half_day_cutoff, office_end:cfg.office_end,
        birthday_leave_at:cfg.birthday_leave_at, annual_leave_quota:cfg.annual_leave_quota, max_carry_forward:cfg.max_carry_forward,
        hr_approver_employee_id:cfg.hr_approver_employee_id || null }
      const { error } = await sb.from('attendance_config').update(p).eq('id', cfg.id)
      if (error) throw error
      toast('Policy saved.', 'success')
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
    finally { savingCfg.current = false }
  }

  async function saveOffice(o) {
    try {
      const { error } = await sb.from('office_locations').update({ lat:Number(o.lat)||null, lng:Number(o.lng)||null, radius_m:Number(o.radius_m)||150, is_active:o.is_active }).eq('id', o.id)
      if (error) throw error
      toast(`${o.branch} saved.`, 'success')
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  async function addHoliday() {
    if (!nh.holiday_date || !nh.name.trim()) { toast('Date and name required.', 'error'); return }
    try {
      const { error } = await sb.from('holidays').insert({ holiday_date:nh.holiday_date, name:nh.name.trim(), is_active:true })
      if (error) throw error
      setNh({ holiday_date:'', name:'' }); await load(); toast('Holiday added.', 'success')
    } catch (e) { toast(e?.message||friendlyError(e),'error') }
  }
  async function removeHoliday(h) {
    if (!window.confirm(`Remove ${h.name}?`)) return
    try { await sb.from('holidays').update({ is_active:false }).eq('id', h.id); await load(); toast('Removed.', 'success') }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  if (denied) return embed ? null : (
    <Layout pageKey="people" pageTitle="Attendance Config">
      <div style={{ padding:'80px 32px', textAlign:'center' }}>
        <div style={{ fontSize:20, fontWeight:600, marginBottom:8, color:'#0B1B30' }}>Page not found</div>
        <button className="od-btn od-btn-primary" onClick={()=>navigate('/people')}>Back to People</button>
      </div>
    </Layout>
  )
  if (loading) return embed ? <div className="o-loading">Loading…</div> : <Layout pageKey="people" pageTitle="Attendance Config"><div className="o-loading">Loading…</div></Layout>

  const T = (label, key) => <Field label={label}><input className="exp-cfg-input" style={{ width:130 }} type="time" value={(cfg[key]||'').slice(0,5)} onChange={e=>setCfg({...cfg,[key]:e.target.value})} /></Field>

  const body = (
    <div className="kpi-app density-comfortable accent-ssc" style={embed ? { padding:0 } : undefined}>
      {!embed && (
        <div className="page-head">
          <div>
            <button className="od-btn" style={{ marginBottom:8 }} onClick={()=>navigate('/people/attendance')}>← Back</button>
            <h1 className="page-title">Attendance Config</h1>
            <div className="page-sub">Policy, geofences &amp; holidays</div>
          </div>
          <div className="page-meta"><div className="meta-pill"><span className="meta-label">ACCESS</span><span className="meta-val">Admin / Management</span></div></div>
        </div>
      )}

      {/* Policy */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <div>
            <div className="card-eyebrow">Working hours</div>
            <div className="card-title">Timing &amp; leave policy</div>
            <div className="card-sub">Office runs {(cfg.office_start||'').slice(0,5)}–{(cfg.office_end||'').slice(0,5)}. Arrivals after grace are late; after the half-day cutoff count as a half day.</div>
          </div>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:18 }}>
          {T('Office start','office_start')}
          {T('Grace until','grace_until')}
          {T('Half-day cutoff','half_day_cutoff')}
          {T('Office end','office_end')}
          {T('Birthday leave at','birthday_leave_at')}
          <Field label="Annual leave quota"><input className="exp-cfg-input" style={{ width:110 }} type="number" min="0" value={cfg.annual_leave_quota??''} onChange={e=>setCfg({...cfg,annual_leave_quota:e.target.value})} /></Field>
          <Field label="Max carry-forward"><input className="exp-cfg-input" style={{ width:110 }} type="number" min="0" value={cfg.max_carry_forward??''} onChange={e=>setCfg({...cfg,max_carry_forward:e.target.value})} /></Field>
          <Field label="HR approver"><select className="exp-cfg-input" style={{ width:180 }} value={cfg.hr_approver_employee_id||''} onChange={e=>setCfg({...cfg,hr_approver_employee_id:e.target.value})}><option value="">—</option>{emps.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></Field>
        </div>
        <div style={{ marginTop:16 }}><button className="od-btn od-btn-primary" onClick={saveCfg}>Save policy</button></div>
      </div>

      {/* Geofences */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <div>
            <div className="card-eyebrow">Punch locations</div>
            <div className="card-title">Office geofences</div>
            <div className="card-sub">A web/mobile punch is flagged inside-geofence when within the radius of one of these coordinates.</div>
          </div>
        </div>
        {offices.map((o,i) => (
          <div key={o.id} className="exp-cfg-branch-row" style={{ alignItems:'flex-end', flexWrap:'wrap', gap:16 }}>
            <div className="exp-cfg-branch-name" style={{ minWidth:150 }}>{o.branch}</div>
            <Field label="Latitude"><input className="exp-cfg-input" style={{ width:170 }} value={o.lat??''} onChange={e=>{const c=[...offices];c[i]={...o,lat:e.target.value};setOffices(c)}} /></Field>
            <Field label="Longitude"><input className="exp-cfg-input" style={{ width:170 }} value={o.lng??''} onChange={e=>{const c=[...offices];c[i]={...o,lng:e.target.value};setOffices(c)}} /></Field>
            <Field label="Radius (m)"><input className="exp-cfg-input" style={{ width:100 }} type="number" value={o.radius_m??''} onChange={e=>{const c=[...offices];c[i]={...o,radius_m:e.target.value};setOffices(c)}} /></Field>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, paddingBottom:8 }}><input type="checkbox" checked={o.is_active} onChange={e=>{const c=[...offices];c[i]={...o,is_active:e.target.checked};setOffices(c)}} />Active</label>
            <button className="od-btn" style={{ marginBottom:2 }} onClick={()=>saveOffice(offices[i])}>Save</button>
          </div>
        ))}
      </div>

      {/* Holidays */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">Calendar</div>
            <div className="card-title">Holidays · {holidays.length}</div>
            <div className="card-sub">Marked as non-working on the muster and excluded from leave-day counts.</div>
          </div>
        </div>
        <div className="exp-cfg-branch-row" style={{ alignItems:'flex-end', gap:16, borderBottom:'1px solid var(--gray-200,#E4E7EC)', paddingBottom:14, marginBottom:6 }}>
          <Field label="Date"><input className="exp-cfg-input" style={{ width:160 }} type="date" value={nh.holiday_date} onChange={e=>setNh({...nh,holiday_date:e.target.value})} /></Field>
          <Field label="Name"><input className="exp-cfg-input" style={{ width:220 }} value={nh.name} onChange={e=>setNh({...nh,name:e.target.value})} placeholder="e.g. Diwali" /></Field>
          <button className="od-btn od-btn-primary" style={{ marginBottom:2 }} onClick={addHoliday}>+ Add</button>
        </div>
        {holidays.length===0 ? <div className="exp-cfg-ph" style={{ padding:'14px 4px' }}>No holidays yet.</div> : holidays.map(h => (
          <div key={h.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'11px 2px', borderBottom:'1px solid var(--gray-100,#EFF1F4)' }}>
            <div><span style={{ fontWeight:600, fontSize:13.5 }}>{h.name}</span><span style={{ fontSize:12.5, color:'#5B6878', marginLeft:12 }}>{fmtD(h.holiday_date)}</span></div>
            <button className="od-btn" onClick={()=>removeHoliday(h)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  )

  return embed ? body : <Layout pageKey="people" pageTitle="Attendance Config">{body}</Layout>
}
