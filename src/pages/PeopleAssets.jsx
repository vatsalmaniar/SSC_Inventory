import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { signPhotos } from '../lib/photos'
import Layout from '../components/Layout'
import { AssetsSkeleton } from '../components/PeopleLoaders'
import '../styles/people.css'

const TYPES = ['Laptop','Desktop','Mobile','Tablet','Monitor','Printer','Scanner','SIM','Other']
const STICKERS = ['Asset Tag','QR Code','Barcode','None']
const PREFIX = { Laptop:'LAP', Desktop:'DSK', Mobile:'MOB', Tablet:'TAB', Monitor:'MON', Printer:'PRN', Scanner:'SCN', SIM:'SIM', Other:'AST' }
// Windows system-info fields (Laptop / Desktop) — labels kept as shown in Windows.
const SPEC_FIELDS = [
  ['device_name','Device name'], ['full_device_name','Full device name'],
  ['processor','Processor'], ['installed_ram','Installed RAM'],
  ['device_id','Device ID'], ['product_id','Product ID'],
  ['system_type','System type'], ['os_edition','Edition'],
  ['os_version','Version'], ['os_build','OS build'],
  ['os_installed_on','Installed on'], ['windows_experience','Experience'],
  ['pen_touch','Pen and touch'],
]
const EMPTY_SPEC = Object.fromEntries(SPEC_FIELDS.map(([k]) => [k, '']))
const HAS_SPECS = t => t === 'Laptop' || t === 'Desktop'
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
  const [selDevice, setSelDevice] = useState(null)   // asset object for detail view
  const [qr, setQr] = useState('')
  const [addForm, setAddForm] = useState({ asset_tag:'', name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', manufacturer:'', ...EMPTY_SPEC, sticker_type:'QR Code' })
  const [assignForm, setAssignForm] = useState({ employee_id:'', reason:'' })
  const guard = useRef(false)

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (!selDevice) { setQr(''); return }
    const payload = `${window.location.origin}/people/assets?tag=${encodeURIComponent(selDevice.asset_tag)}`
    QRCode.toDataURL(payload, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''))
  }, [selDevice])

  function printLabel(a) {
    if (!qr) return
    const w = window.open('', '_blank', 'width=560,height=300')
    if (!w) { toast('Allow pop-ups to print the label.', 'error'); return }
    const esc = s => String(s || '').replace(/</g, '&lt;')
    w.document.write(`<!doctype html><html><head><title>${esc(a.asset_tag)}</title><style>
      *{margin:0;box-sizing:border-box;font-family:'Geist','DM Sans',system-ui,sans-serif}
      @page{size:100mm 44mm;margin:0}
      html,body{width:100mm;height:44mm}
      .label{width:100mm;height:44mm;display:flex;align-items:center;gap:3.5mm;padding:3mm 4mm}
      .qr{width:38mm;height:38mm;flex-shrink:0}
      .qr img{width:100%;height:100%;display:block}
      .info{flex:1;min-width:0;overflow:hidden}
      .tag{font-family:'Geist Mono',monospace;font-size:19pt;font-weight:700;color:#0A2540;letter-spacing:.5px;line-height:1}
      .nm{font-size:10pt;color:#1D2D3E;margin-top:2mm;line-height:1.15}
      .sub{font-size:8pt;color:#5B738B;font-family:'Geist Mono',monospace;margin-top:1.5mm}
      .co{font-size:7pt;color:#8C99A8;letter-spacing:.12em;margin-top:2mm}
    </style></head><body onload="window.print()">
      <div class="label">
        <div class="qr"><img src="${qr}"/></div>
        <div class="info">
          <div class="tag">${esc(a.asset_tag)}</div>
          <div class="nm">${esc(a.name || a.make_model || a.asset_type)}</div>
          ${a.serial_no ? `<div class="sub">S/N ${esc(a.serial_no)}</div>` : ''}
          <div class="co">SSC CONTROL PVT. LTD.</div>
        </div>
      </div>
    </body></html>`)
    w.document.close()
  }

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
      sb.from('asset_assignments').select('id,asset_id,employee_id,employee:employees(full_name,photo_url)').is('assigned_to', null),
      sb.from('employees').select('id,full_name,department').neq('lifecycle_status','exited').order('full_name'),
    ])
    setAssets(as.data || [])
    const h = {}; (aa.data || []).forEach(x => { h[x.asset_id] = { employee_id:x.employee_id, name:x.employee?.full_name || '—', photo_url:x.employee?.photo_url || null, assignment_id:x.id } })
    await signPhotos(Object.values(h))
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
    setAddForm({ asset_tag: nextTag('Laptop'), name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', manufacturer:'', ...EMPTY_SPEC, sticker_type:'QR Code' })
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
        mac_id: addForm.mac_id.trim() || null, manufacturer: addForm.manufacturer.trim() || null,
        ...Object.fromEntries(SPEC_FIELDS.map(([k]) => [k, (addForm[k] || '').trim() || null])),
        sticker_type: addForm.sticker_type, status:'spare', condition:'returned',
      })
      if (error) throw error
      toast('Device added to register.', 'success')
      setShowAdd(false); setAddForm({ asset_tag:'', name:'', asset_type:'Laptop', make_model:'', serial_no:'', mac_id:'', manufacturer:'', ...EMPTY_SPEC, sticker_type:'QR Code' })
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
                  <div key={a.id} className="arow" style={{cursor:'pointer'}} onClick={()=>setSelDevice(a)}>
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
                        <select value={a.condition||'returned'} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setCondition(a, e.target.value)}} style={{padding:'6px 28px 6px 10px',fontSize:12}}>
                          <option value="inuse">In use</option><option value="repair">In repair</option><option value="returned">Spare / Returned</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      {h ? (
                        <span className="a-holder"><span className="avatar av-28" style={h.signedPhoto?{backgroundImage:`url(${h.signedPhoto})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:ownerColor(h.name)}}>{h.signedPhoto?'':initials(h.name)}</span>{h.name}</span>
                      ) : <span className="a-unassigned">Unassigned</span>}
                    </div>
                    <div style={{textAlign:'right',whiteSpace:'nowrap'}}>
                      {h
                        ? <button className="btn btn-neutral btn-sm" onClick={e=>{e.stopPropagation();returnDevice(a)}}>Return</button>
                        : <button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation(); setAssignFor(a); setAssignForm({employee_id:'',reason:''}) }}>Assign</button>}
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
          <div className="pd-f"><label>Device name</label><input value={addForm.name} onChange={e=>setAddForm({...addForm,name:e.target.value})} placeholder="e.g. Aarth's Laptop" autoFocus /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Manufacturer</label><input value={addForm.manufacturer} onChange={e=>setAddForm({...addForm,manufacturer:e.target.value})} placeholder="HP" /></div>
            <div className="pd-f"><label>Model / Laptop name</label><input value={addForm.make_model} onChange={e=>setAddForm({...addForm,make_model:e.target.value})} placeholder="HP ProBook 440 14 G9" /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Serial number</label><input value={addForm.serial_no} onChange={e=>setAddForm({...addForm,serial_no:e.target.value})} placeholder="5CD42630HV" /></div>
            <div className="pd-f"><label>MAC ID</label><input value={addForm.mac_id} onChange={e=>setAddForm({...addForm,mac_id:e.target.value})} placeholder="10:5F:AD:59:E5:F3" /></div>
          </div>
          <div className="pd-f"><label>Sticker</label><select value={addForm.sticker_type} onChange={e=>setAddForm({...addForm,sticker_type:e.target.value})}>{STICKERS.map(s=><option key={s}>{s}</option>)}</select></div>
          {HAS_SPECS(addForm.asset_type) && (
            <>
              <div style={{fontSize:10.5,fontWeight:600,letterSpacing:'0.05em',textTransform:'uppercase',color:'#8C99A8',marginTop:8,borderTop:'1px solid #EFF1F4',paddingTop:12}}>System details · {addForm.asset_type}</div>
              {SPEC_FIELDS.map(([k,l]) => (
                <div key={k} className="pd-f"><label>{l}</label>
                  <input type={k==='os_installed_on'?'date':'text'} value={addForm[k]} onChange={e=>setAddForm({...addForm,[k]:e.target.value})} />
                </div>
              ))}
            </>
          )}
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

      {/* Device detail drawer */}
      {selDevice && (
        <Drawer title={selDevice.asset_tag} sub={selDevice.name || selDevice.make_model || selDevice.asset_type} onClose={()=>setSelDevice(null)}
          footer={<><button className="pd-btn neutral" onClick={()=>setSelDevice(null)}>Close</button><button className="pd-btn primary" onClick={()=>printLabel(selDevice)} disabled={!qr}>Print QR label</button></>}>
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'6px 0 12px',borderBottom:'1px solid #EFF1F4'}}>
            {qr ? <img src={qr} alt="QR" style={{width:160,height:160}} /> : <div className="p-spin" style={{margin:'40px'}} />}
            <div style={{fontSize:11,color:'#8C99A8',fontFamily:'Geist Mono,monospace'}}>Scan → opens this device</div>
          </div>
          {(() => {
            const rows = [
              ['Manufacturer', selDevice.manufacturer], ['Model', selDevice.make_model], ['Type', selDevice.asset_type],
              ['Serial number', selDevice.serial_no], ['MAC ID', selDevice.mac_id], ['Sticker', selDevice.sticker_type],
              ...SPEC_FIELDS.map(([k,l]) => [l, k==='os_installed_on' && selDevice[k] ? new Date(selDevice[k]).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : selDevice[k]]),
            ].filter(([,v]) => v)
            return <div style={{padding:'6px 0'}}>{rows.map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',gap:14,padding:'9px 0',borderBottom:'1px solid #EFF1F4'}}>
                <span style={{fontSize:11.5,color:'#5B738B',flexShrink:0}}>{l}</span>
                <span style={{fontSize:12.5,fontWeight:500,textAlign:'right',wordBreak:'break-word'}}>{v}</span>
              </div>
            ))}</div>
          })()}
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
