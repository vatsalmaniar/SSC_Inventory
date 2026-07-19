import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import Layout from '../components/Layout'
import '../styles/people.css'

const DEPT_HEX = { 'Management':'#6D28D9','Sales':'#1E54B7','Operation & Support':'#0E7C6B','Opeartion & Support':'#0E7C6B','Account':'#C2255C','Back Office':'#8C99A8','People & Culture':'#C2255C' }
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569','#c2410c','#4f7942']
function ownerColor(n='') { let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }
function initials(n='') { return n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '??' }
function deptColor(d) { return DEPT_HEX[d] || '#5B738B' }
const Avatar = ({ e, cls }) => <div className={'avatar '+cls} style={e.photo_url?{backgroundImage:`url(${e.photo_url})`,backgroundSize:'cover',backgroundPosition:'center'}:{background:ownerColor(e.full_name)}}>{e.photo_url?'':initials(e.full_name)}</div>
const Pin = () => <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 1.3C4 1.3 2.8 2.8 2.8 4.4 2.8 6.6 6 10.5 6 10.5S9.2 6.6 9.2 4.4C9.2 2.8 8 1.3 6 1.3Z"/><circle cx="6" cy="4.3" r="1.1"/></svg>

function OrgNode({ emp, childrenOf, depth, sel, onSelect, expanded, toggle }) {
  const kids = childrenOf[emp.id] || []
  const collapsed = expanded[emp.id] === false
  return (
    <li className={collapsed && kids.length ? 'collapsed' : ''}>
      <div className="node">
        <button className={'ocard'+(depth===0?' root':'')+(sel===emp.id?' sel':'')} onClick={()=>onSelect(emp.id)}>
          <div className="oc-top">
            <Avatar e={emp} cls="av-36" />
            <div className="oc-body"><div className="oc-name">{emp.full_name}</div><div className="oc-role"><span className="dept-dot" style={{background:deptColor(emp.department),display:'inline-block',marginRight:5}} />{emp.designation||'—'}</div></div>
          </div>
          <div className="oc-foot">
            <span className="oc-loc"><Pin />{emp.branch||'—'}</span>
            {kids.length>0 && <span className="oc-collapse" onClick={e=>{e.stopPropagation();toggle(emp.id)}}><svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 4l4 4 4-4"/></svg>{kids.length}</span>}
          </div>
        </button>
      </div>
      {kids.length>0 && <ul>{kids.map(k=><OrgNode key={k.id} emp={k} childrenOf={childrenOf} depth={depth+1} sel={sel} onSelect={onSelect} expanded={expanded} toggle={toggle} />)}</ul>}
    </li>
  )
}

export default function PeopleOrg() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState('')
  const [emps, setEmps] = useState([])
  const [sel, setSel] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [showExited, setShowExited] = useState(false)
  const isMgmt = ['admin','management'].includes(role)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: p } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setRole(p?.role || '')
    const { data } = await sb.from('employees').select('id,full_name,designation,department,branch,reporting_manager_id,lifecycle_status,photo_url').eq('is_test', false)
    setEmps(data || [])
    setLoading(false)
  }

  const { roots, childrenOf, byId } = useMemo(() => {
    const list = showExited ? emps : emps.filter(e=>e.lifecycle_status!=='exited')
    const ids = new Set(list.map(e=>e.id)); const byId={}; list.forEach(e=>byId[e.id]=e)
    const childrenOf = {}
    list.forEach(e => { const m = e.reporting_manager_id && ids.has(e.reporting_manager_id) ? e.reporting_manager_id : null; if(m)(childrenOf[m]||=[]).push(e) })
    Object.values(childrenOf).forEach(a=>a.sort((x,y)=>x.full_name.localeCompare(y.full_name)))
    const roots = list.filter(e=>!e.reporting_manager_id||!ids.has(e.reporting_manager_id)).sort((a,b)=>a.full_name.localeCompare(b.full_name))
    return { roots, childrenOf, byId }
  }, [emps, showExited])

  const selEmp = sel ? byId[sel] : null
  const selMgr = selEmp?.reporting_manager_id ? byId[selEmp.reporting_manager_id] : null
  const selReports = selEmp ? (childrenOf[selEmp.id]||[]) : []
  const mgrOptions = useMemo(() => emps.filter(x=>x.id!==sel && x.lifecycle_status!=='exited').sort((a,b)=>a.full_name.localeCompare(b.full_name)), [emps, sel])

  function toggle(id) { setExpanded(x=>({ ...x, [id]: x[id]===false })) }
  function expandAll() { const all={}; emps.forEach(e=>all[e.id]=true); setExpanded(all) }
  function collapseAll() { const all={}; emps.forEach(e=>all[e.id]=false); setExpanded(all) }

  async function reassign(newMgr) {
    try { await sb.from('employees').update({ reporting_manager_id:newMgr||null }).eq('id', sel); toast('Reporting manager updated.','success')
      setEmps(es=>es.map(e=>e.id===sel?{...e,reporting_manager_id:newMgr||null}:e)) }
    catch (e) { toast(e?.message||friendlyError(e),'error') }
  }

  if (loading) return <Layout pageKey="people" pageTitle="Org Chart"><div className="people-app"><div className="e-empty">Loading org chart…</div></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Org Chart">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people/team')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Team
            </button>
            <h1 className="ph-title">Org Chart</h1>
            <div className="ph-sub">Reporting structure across SSC · click a card to inspect{isMgmt?' or reassign':''}</div>
          </div>
          <div className="ph-actions">
            <div className="vswitch"><button onClick={()=>navigate('/people/team')}>List</button><button className="on">Org</button></div>
            <button className="btn btn-neutral" onClick={expandAll}>Expand all</button>
            <button className="btn btn-neutral" onClick={collapseAll}>Collapse</button>
          </div>
        </div>

        <div className="org-toolbar">
          <div className="org-legend">
            {[['Management','#6D28D9'],['Sales','#1E54B7'],['Operation & Support','#0E7C6B'],['Account','#C2255C']].map(([l,c])=>
              <span key={l} className="leg"><span className="dept-dot" style={{background:c}} />{l}</span>)}
          </div>
          <button className="btn btn-neutral btn-sm" onClick={()=>setShowExited(v=>!v)} style={showExited?{borderColor:'#C25A00',color:'#C25A00'}:undefined}>{showExited?'● Showing exited':'Show exited'}</button>
        </div>

        <div className="org-canvas">
          {roots.length===0 ? <div className="e-empty">No org data.</div> : (
            <ul className="tree">
              {roots.map(r=><OrgNode key={r.id} emp={r} childrenOf={childrenOf} depth={0} sel={sel} onSelect={setSel} expanded={expanded} toggle={toggle} />)}
            </ul>
          )}
        </div>
      </div>

      {selEmp && createPortal(
        <div className="people-org-inspect">
          <div className="oi-head">
            <Avatar e={selEmp} cls="av-44" />
            <div><div className="oi-name">{selEmp.full_name}</div><div className="oi-role">{selEmp.designation||'—'}</div></div>
            <button className="oi-x" onClick={()=>setSel(null)}>✕</button>
          </div>
          <div className="oi-body">
            <div className="oi-field"><div className="oi-l">Department</div><div className="oi-v"><span className="dept-pill"><span className="dept-dot" style={{background:deptColor(selEmp.department)}} />{selEmp.department||'—'}</span></div></div>
            <div className="oi-field"><div className="oi-l">Location</div><div className="oi-v">{selEmp.branch||'—'}</div></div>
            <div className="oi-field"><div className="oi-l">Reports to</div><div className="oi-v">{selMgr?selMgr.full_name:'Top of org'}</div></div>
            <div className="oi-field"><div className="oi-l">Direct reports</div><div className="oi-v">{selReports.length}</div></div>
            {isMgmt && (
              <div className="oi-field"><div className="oi-l">Reassign manager</div>
                <select value={selEmp.reporting_manager_id||''} onChange={e=>reassign(e.target.value)}>
                  <option value="">— Top of org —</option>
                  {mgrOptions.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="oi-actions">
            <button className="neu" onClick={()=>setSel(null)}>Close</button>
            <button className="prim" onClick={()=>navigate('/people/team/'+selEmp.id)}>Open profile</button>
          </div>
        </div>, document.body)}
    </Layout>
  )
}
