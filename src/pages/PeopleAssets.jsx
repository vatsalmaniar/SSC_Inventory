import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import { AssetsSkeleton } from '../components/PeopleLoaders'
import '../styles/people.css'

const TYPES = ['Laptop','Desktop','Mobile','Tablet','Monitor','Printer','Scanner','SIM','Other']
const STICKERS = ['Asset Tag','QR Code','Barcode','None']
const PREFIX = { Laptop:'LAP', Desktop:'DSK', Mobile:'MOB', Tablet:'TAB', Monitor:'MON', Printer:'PRN', Scanner:'SCN', SIM:'SIM', Other:'AST' }
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n='') { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function initials(n='') { return n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??' }
const COND_LABEL = { inuse:'In use', repair:'In repair', returned:'Returned' }
const DeviceIcon = () => <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="3.5" width="13" height="9" rx="1.2"/><path d="M6 15.5h6M9 12.5v3"/></svg>

export default function PeopleAssets() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [assets, setAssets] = useState([])
  const [holders, setHolders] = useState({})   // asset_id -> {employee_id, name, assignment_id}
  const [emps, setEmps] = useState([])
  const [search, setSearch] = useState('')
  const [fType, setFType] = useState('all')
  const [fAssigned, setFAssigned] = useState('all')  // all | assigned | free
  const [showAdd, setShowAdd] = useState(false)
  const [assignFor, setAssignFor] = useState(null)   // asset object being assigned
  const [addForm, setAddForm] = useState({ asset_tag:'', name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', sticker_type:'Asset Tag' })
  const [assignForm, setAssignForm] = useState({ employee_id:'', reason:'' })
  const guard = useRef(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: p } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    if (!['admin','management'].includes(p?.role)) { setDenied(true); setLoading(false); return }
    await load(); setLoading(false)
  }

  async function load() {
    const [as, aa, em] = await Promise.all([
      sb.from('assets').select('*').eq('is_test', false).order('asset_tag'),
      sb.from('asset_assignments').select('id,asset_id,employee_id,employee:employees(full_name)').is('assigned_to', null),
      sb.from('employees').select('id,full_name,department').neq('lifecycle_status','exited').order('full_name'),
    ])
    setAssets(as.data || [])
    const h = {}; (aa.data || []).forEach(x => { h[x.asset_id] = { employee_id:x.employee_id, name:x.employee?.full_name || '—', assignment_id:x.id } })
    setHolders(h)
    setEmps(em.data || [])
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return assets.filter(a => {
      if (fType !== 'all' && a.asset_type !== fType) return false
      const assigned = !!holders[a.id]
      if (fAssigned === 'assigned' && !assigned) return false
      if (fAssigned === 'free' && assigned) return false
      if (!q) return true
      return (a.asset_tag||'').toLowerCase().includes(q) || (a.name||'').toLowerCase().includes(q)
        || (a.make_model||'').toLowerCase().includes(q) || (a.serial_no||'').toLowerCase().includes(q)
    })
  }, [assets, holders, search, fType, fAssigned])

  function nextTag(type) {
    const pfx = PREFIX[type] || 'AST'
    const re = new RegExp('^SSC-' + pfx + '-(\\d+)$', 'i')
    let max = 0
    assets.forEach(a => { const m = (a.asset_tag || '').match(re); if (m) max = Math.max(max, parseInt(m[1], 10)) })
    return 'SSC-' + pfx + '-' + String(max + 1).padStart(3, '0')
  }
  function openAdd() {
    setAddForm({ asset_tag: nextTag('Laptop'), name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', sticker_type:'Asset Tag' })
    setShowAdd(true)
  }

  const stats = useMemo(() => ({
    total: assets.length,
    assigned: assets.filter(a => holders[a.id]).length,
    repair: assets.filter(a => a.condition === 'repair').length,
    free: assets.filter(a => !holders[a.id]).length,
  }), [assets, holders])

  async function addDevice() {
    if (guard.current) return
    if (!addForm.asset_tag.trim()) { toast('Asset ID (tag) is required.', 'error'); return }
    guard.current = true
    try {
      const { error } = await sb.from('assets').insert({
        asset_tag: addForm.asset_tag.trim(), name: addForm.name.trim() || null, asset_type: addForm.asset_type,
        make_model: addForm.make_model.trim() || null, serial_no: addForm.serial_no.trim() || null,
        mac_id: addForm.mac_id.trim() || null,
        sticker_type: addForm.sticker_type, status:'spare', condition:'returned',
      })
      if (error) throw error
      toast('Device added to register.', 'success')
      setShowAdd(false); setAddForm({ asset_tag:'', name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', sticker_type:'Asset Tag' })
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  async function assignDevice() {
    if (guard.current) return
    if (!assignForm.employee_id) { toast('Pick an employee.', 'error'); return }
    guard.current = true
    try {
      const { error } = await sb.from('asset_assignments').insert({
        asset_id: assignFor.id, employee_id: assignForm.employee_id, action:'issued', reason: assignForm.reason.trim() || null,
      })
      if (error) throw error
      await sb.from('assets').update({ status:'in_use', condition:'inuse' }).eq('id', assignFor.id)
      toast('Device assigned.', 'success')
      setAssignFor(null); setAssignForm({ employee_id:'', reason:'' })
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  async function returnDevice(a) {
    const h = holders[a.id]; if (!h) return
    const reason = window.prompt(`Return "${a.asset_tag}" from ${h.name}?\nReason:`)
    if (reason === null) return
    try {
      await sb.from('asset_assignments').update({ assigned_to: new Date().toISOString().slice(0,10), action:'returned', reason: reason || 'Returned' }).eq('id', h.assignment_id)
      await sb.from('assets').update({ status:'spare', condition:'returned' }).eq('id', a.id)
      toast('Device returned.', 'success'); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  async function setCondition(a, cond) {
    try { await sb.from('assets').update({ condition: cond }).eq('id', a.id); await load() }
    catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  if (denied) return (
    <Layout pageKey="people" pageTitle="Assets"><div className="people-app"><div className="e-empty">This page is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="people" pageTitle="Assets"><div className="people-app"><AssetsSkeleton /></div></Layout>

  const Sel = ({ value, onChange, children }) => <div className="f-sel"><select value={value} onChange={e=>onChange(e.target.value)}>{children}</select></div>

  return (
    <Layout pageKey="people" pageTitle="Assets">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="ph-title">Assets &amp; Devices</h1>
            <div className="ph-sub">Company device register — add devices, then assign to people</div>
          </div>
          <div className="ph-actions">
            <button className="btn btn-primary" onClick={openAdd}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3v10M3 8h10" strokeLinecap="round"/></svg>Add Device
            </button>
          </div>
        </div>

        <div className="astats">
          <div className="astat"><div className="astat-l">Total Devices</div><div className="astat-v">{stats.total}</div></div>
          <div className="astat"><div className="astat-l">Assigned</div><div className="astat-v" style={{color:'var(--accent)'}}>{stats.assigned}</div></div>
          <div className="astat"><div className="astat-l">Unassigned</div><div className="astat-v">{stats.free}</div></div>
          <div className="astat"><div className="astat-l">In Repair</div><div className="astat-v" style={{color:'var(--crit)'}}>{stats.repair}</div></div>
        </div>

        <div className="filters">
          <div className="f-search">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by tag, name, model, serial…" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <Sel value={fType} onChange={setFType}><option value="all">All Types</option>{TYPES.map(t=><option key={t}>{t}</option>)}</Sel>
          <Sel value={fAssigned} onChange={setFAssigned}><option value="all">All</option><option value="assigned">Assigned</option><option value="free">Unassigned</option></Sel>
        </div>

        <div className="card">
          <div className="tbl-wrap">
            <div style={{minWidth:1040}}>
              <div className="arow head">
                <div>Asset ID</div><div>Device</div><div>Type</div><div>Sticker · Serial</div><div>Condition</div><div>Assigned To</div><div style={{textAlign:'right'}}>Action</div>
              </div>
              {filtered.length === 0 ? (
                <div className="e-empty">No devices match your filters.</div>
              ) : filtered.map(a => {
                const h = holders[a.id]
                return (
                  <div key={a.id} className="arow">
                    <div className="arow-tag">{a.asset_tag}</div>
                    <div className="arow-nm">
                      <div className="arow-ico"><DeviceIcon /></div>
                      <div style={{minWidth:0}}>
                        <div className="a-name">{a.name || a.make_model || a.asset_type}</div>
                        {a.make_model && a.name && <div className="a-sub">{a.make_model}</div>}
                      </div>
                    </div>
                    <div><span className="dept-pill">{a.asset_type}</span></div>
                    <div style={{fontSize:12.5,color:'var(--muted)'}}>
                      {a.sticker_type || '—'}{a.serial_no && <div className="a-sub">{a.serial_no}</div>}
                    </div>
                    <div>
                      <div className="f-sel" style={{display:'inline-block'}}>
                        <select value={a.condition||'returned'} onChange={e=>setCondition(a, e.target.value)} style={{padding:'6px 28px 6px 10px',fontSize:12}}>
                          <option value="inuse">In use</option><option value="repair">In repair</option><option value="returned">Spare / Returned</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      {h ? (
                        <span className="a-holder"><span className="avatar av-28" style={{background:ownerColor(h.name)}}>{initials(h.name)}</span>{h.name}</span>
                      ) : <span className="a-unassigned">Unassigned</span>}
                    </div>
                    <div style={{textAlign:'right',whiteSpace:'nowrap'}}>
                      {h
                        ? <button className="btn btn-neutral btn-sm" onClick={()=>returnDevice(a)}>Return</button>
                        : <button className="btn btn-ghost btn-sm" onClick={()=>{ setAssignFor(a); setAssignForm({employee_id:'',reason:''}) }}>Assign</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Add device drawer */}
      {showAdd && (
        <Drawer title="Add Device" sub="Add a device to the company register" onClose={()=>setShowAdd(false)}
          footer={<><button className="pd-btn neutral" onClick={()=>setShowAdd(false)}>Cancel</button><button className="pd-btn primary" onClick={addDevice}>Add to Register</button></>}>
          <div className="pd-2">
            <div className="pd-f"><label>Type</label><select value={addForm.asset_type} onChange={e=>setAddForm(f=>({...f, asset_type:e.target.value, asset_tag: nextTag(e.target.value)}))}>{TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
            <div className="pd-f"><label>Asset ID · auto</label><input value={addForm.asset_tag} onChange={e=>setAddForm({...addForm,asset_tag:e.target.value})} placeholder="SSC-LAP-014" /></div>
          </div>
          <div className="pd-f"><label>Device name</label><input value={addForm.name} onChange={e=>setAddForm({...addForm,name:e.target.value})} placeholder="MacBook Pro 16″" autoFocus /></div>
          <div className="pd-f"><label>Make / Model</label><input value={addForm.make_model} onChange={e=>setAddForm({...addForm,make_model:e.target.value})} placeholder="Apple M3 Pro" /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Serial No</label><input value={addForm.serial_no} onChange={e=>setAddForm({...addForm,serial_no:e.target.value})} /></div>
            <div className="pd-f"><label>MAC ID</label><input value={addForm.mac_id} onChange={e=>setAddForm({...addForm,mac_id:e.target.value})} placeholder="00:1A:2B:3C:4D:5E" /></div>
          </div>
          <div className="pd-f"><label>Sticker</label><select value={addForm.sticker_type} onChange={e=>setAddForm({...addForm,sticker_type:e.target.value})}>{STICKERS.map(s=><option key={s}>{s}</option>)}</select></div>
        </Drawer>
      )}

      {/* Assign drawer */}
      {assignFor && (
        <Drawer title={`Assign ${assignFor.asset_tag}`} sub={assignFor.name || assignFor.asset_type} onClose={()=>setAssignFor(null)}
          footer={<><button className="pd-btn neutral" onClick={()=>setAssignFor(null)}>Cancel</button><button className="pd-btn primary" onClick={assignDevice}>Assign</button></>}>
          <div className="pd-f"><label>Assign to</label>
            <select value={assignForm.employee_id} onChange={e=>setAssignForm({...assignForm,employee_id:e.target.value})} autoFocus>
              <option value="">Select employee…</option>
              {emps.map(em=><option key={em.id} value={em.id}>{em.full_name}{em.department?` · ${em.department}`:''}</option>)}
            </select>
          </div>
          <div className="pd-f"><label>Reason / note</label><input value={assignForm.reason} onChange={e=>setAssignForm({...assignForm,reason:e.target.value})} placeholder="optional" /></div>
        </Drawer>
      )}
    </Layout>
  )
}

function Drawer({ title, sub, onClose, children, footer }) {
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer" role="dialog">
        <div className="pd-h">
          <div><div className="pd-h-t">{title}</div>{sub && <div className="pd-h-s">{sub}</div>}</div>
          <button className="pd-x" onClick={onClose}>✕</button>
        </div>
        <div className="pd-b">{children}</div>
        {footer && <div className="pd-foot">{footer}</div>}
      </div>
    </>,
    document.body
  )
}
