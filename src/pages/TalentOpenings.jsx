import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { loadOpenings, loadPipeline, canSeeTalent, todayYmd, loadOrgOptions } from '../lib/talent'
import { LIVE_STAGES, stageLabel, stageColor } from '../lib/talentStage'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import Loading from '../components/Loading'
import Stat from '../components/StatTile'
import '../styles/people.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const STATUS_COLOR = { open:'#15803d', on_hold:'#b45309', filled:'#1a73e8', closed:'#94a3b8' }
const STATUS_LABEL = { open:'Open', on_hold:'On hold', filled:'Filled', closed:'Closed' }

const EMPLOYMENT = [['full_time','Full time'],['contract','Contract'],['intern','Internship'],['part_time','Part time']]
const EMP_LABEL = Object.fromEntries(EMPLOYMENT)
const inr = n => n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'

const EMPTY = {
  title:'', department:'', branch:'', description:'', must_have:'',
  exp_min_years:'', exp_max_years:'', headcount:'1', employment_type:'full_time',
  budget_ctc_min:'', budget_ctc_max:'', justification:'', target_date:'',
}

function Drawer({ title, sub, onClose, children, footer }) {
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer" role="dialog">
        <div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub && <div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div>
        <div className="pd-b">{children}</div>
        {footer && <div className="pd-foot">{footer}</div>}
      </div>
    </>, document.body)
}

export default function TalentOpenings() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [rows, setRows] = useState([])
  const [apps, setApps] = useState([])
  const [org, setOrg] = useState({ departments: [], branches: [] })
  const [fStatus, setFStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const [viewing, setViewing] = useState(null)   // opening shown in the detail drawer
  const guard = useRef(false)

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return } ; session = data.session }
    const { data: p } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!canSeeTalent(p?.role)) { setDenied(true); setLoading(false); return }
    await load()
    setLoading(false)
  }

  async function load() {
    const [o, a, g] = await Promise.all([loadOpenings(false), loadPipeline(false), loadOrgOptions()])
    if (o.error) { toast(friendlyError(o.error), 'error'); return }
    setRows(o.data || []); setApps(a.data || []); setOrg(g)
  }


  const set = patch => setForm(f => ({ ...f, ...patch }))


  async function save() {
    if (guard.current) return
    if (!form.title.trim()) { toast('Job title is required.', 'error'); return }
    const lo = parseFloat(form.exp_min_years), hi = parseFloat(form.exp_max_years)
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi < lo) { toast('Maximum experience cannot be below the minimum.', 'error'); return }
    const bmin = parseFloat(form.budget_ctc_min), bmax = parseFloat(form.budget_ctc_max)
    if (Number.isFinite(bmin) && Number.isFinite(bmax) && bmax < bmin) { toast('Budget maximum cannot be below the minimum.', 'error'); return }
    guard.current = true
    try {
      // RPC — the client has no write grant on job_openings.
      const { error } = await sb.rpc('create_job_opening', {
        p_title: form.title.trim(),
        p_department: form.department.trim() || null,
        p_branch: form.branch.trim() || null,
        p_description: form.description.trim() || null,
        p_must_have: form.must_have.trim() || null,
        p_exp_min_years: Number.isFinite(lo) ? lo : null,
        p_exp_max_years: Number.isFinite(hi) ? hi : null,
        p_headcount: parseInt(form.headcount, 10) || 1,
        p_employment_type: form.employment_type,
        p_is_test: false,
        p_budget_ctc_min: parseFloat(form.budget_ctc_min) || null,
        p_budget_ctc_max: parseFloat(form.budget_ctc_max) || null,
        p_justification: form.justification.trim() || null,
        p_target_date: form.target_date || null,
      })
      if (error) throw error
      toast(`"${form.title.trim()}" is open — add candidates from the Pipeline.`, 'success')
      setShowAdd(false); setForm({ ...EMPTY })
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  // Duplicate — same role, fresh opening. Everything the person typed is
  // carried over; the live counters (status, filled_count) are not, because
  // they belong to the opening being copied, not to the new one.
  function duplicate(o) {
    setViewing(null)
    setForm({
      ...EMPTY,
      title: o.title || '',
      department: o.department || '',
      branch: o.branch || '',
      description: o.description || '',
      must_have: o.must_have || '',
      exp_min_years: o.exp_min_years != null ? String(o.exp_min_years) : '',
      exp_max_years: o.exp_max_years != null ? String(o.exp_max_years) : '',
      headcount: String(o.headcount || 1),
      employment_type: o.employment_type || 'full_time',
      budget_ctc_min: o.budget_ctc_min != null ? String(o.budget_ctc_min) : '',
      budget_ctc_max: o.budget_ctc_max != null ? String(o.budget_ctc_max) : '',
      justification: o.justification || '',
      // A target date copied from an older opening is almost always in the
      // past, so it is left blank rather than shipped already overdue.
      target_date: '',
    })
    setShowAdd(true)
  }

  async function setStatus(o, status) {
    try {
      const { error } = await sb.rpc('set_opening_status', { p_id: o.id, p_status: status })
      if (error) throw error
      toast(`"${o.title}" marked ${STATUS_LABEL[status].toLowerCase()}.`, 'success')
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  // Per-opening funnel — live stages only. Terminal stages would swamp it.
  const funnelFor = id => {
    const mine = apps.filter(a => a.opening_id === id)
    return LIVE_STAGES.map(s => ({ stage: s, n: mine.filter(a => a.stage === s).length }))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (fStatus !== 'all' && r.status !== fStatus) return false
      if (!q) return true
      return [r.title, r.department, r.branch].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, fStatus, search])

  const stats = useMemo(() => {
    const open = rows.filter(r => r.status === 'open')
    const live = apps.filter(a => LIVE_STAGES.includes(a.stage))
    return {
      open: open.length,
      seats: open.reduce((s, r) => s + Math.max(0, (r.headcount || 0) - (r.filled_count || 0)), 0),
      candidates: live.length,
      filled: rows.filter(r => r.status === 'filled').length,
      hold: rows.filter(r => r.status === 'on_hold').length,
    }
  }, [rows, apps])

  if (denied) return (
    <Layout pageKey="talent" pageTitle="Openings"><div className="orders-app"><div className="o-empty">Talent 360 is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="talent" pageTitle="Openings"><div className="orders-app"><Loading /></div></Layout>

  return (
    <Layout pageKey="talent" pageTitle="Openings">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Openings</h1>
            <div className="page-sub">The positions we are actively recruiting for</div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={()=>{ setForm({ ...EMPTY }); setShowAdd(true) }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              New opening
            </button>
          </div>
        </div>

        <TalentTabs />

        <div className="ph-bento o-bento-flat">
          <Stat label="Open positions" value={stats.open} foot="recruiting now" />
          <Stat label="Seats to fill" value={stats.seats} foot="headcount still open" />
          <Stat label="Live candidates" value={stats.candidates} foot="across all openings" />
          <Stat label="On hold" value={stats.hold} warn={stats.hold > 0} foot={stats.hold ? 'paused' : 'none paused'} />
          <Stat label="Filled" value={stats.filled} foot="closed by a hire" />
        </div>

        <div className="ph-filters">
          <span className="ph-search">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by title, department, branch…" value={search} onChange={e=>setSearch(e.target.value)} />
          </span>
          <select className="ph-picker" value={fStatus} onChange={e=>setFStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.keys(STATUS_LABEL).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          <span className="ph-count"><b>{filtered.length}</b> shown</span>
        </div>

        {filtered.length === 0 && <div className="o-empty">No openings match this filter.</div>}

        <div className="to-cards">
          {filtered.map(o => {
            const f = funnelFor(o.id)
            const total = f.reduce((s, x) => s + x.n, 0)
            const left = Math.max(0, (o.headcount || 0) - (o.filled_count || 0))
            return (
              <div className="card to-card is-clickable" key={o.id}
                role="button" tabIndex={0}
                onClick={()=>setViewing(o)}
                onKeyDown={e=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewing(o) } }}>
                <div className="card-head">
                  <div>
                    <div className="card-eyebrow">{o.department || 'No department'}{o.branch ? ` · ${o.branch}` : ''}</div>
                    <div className="card-title">
                      {o.title}
                      {o.employment_type && o.employment_type !== 'full_time' && (
                        <span className="to-emp">{EMP_LABEL[o.employment_type] || o.employment_type}</span>
                      )}
                    </div>
                  </div>
                  <span className="meta-pill" style={{ color: STATUS_COLOR[o.status], background:`color-mix(in srgb, ${STATUS_COLOR[o.status]} 12%, transparent)` }}>
                    {STATUS_LABEL[o.status] || o.status}
                  </span>
                </div>

                <div className="to-nums">
                  <div><div className="pmc-l">Seats left</div><div className="pmc-v mono">{left}<span style={{ fontSize:12, color:'var(--muted)' }}> / {o.headcount}</span></div></div>
                  <div><div className="pmc-l">In pipeline</div><div className="pmc-v mono">{total}</div></div>
                  <div><div className="pmc-l">Experience</div><div className="pmc-v" style={{ fontSize:14 }}>
                    {o.exp_min_years != null || o.exp_max_years != null ? `${o.exp_min_years ?? 0}–${o.exp_max_years ?? '+'} yrs` : '—'}
                  </div></div>
                </div>

                {/* Live stages only — 'joined' and 'rejected' would flatten the
                    rest to slivers. Bars, never a pie. */}
                <div className="dash-vs">
                  <div className="pmc-l" style={{ marginBottom:6 }}>Pipeline · live stages only</div>
                  {f.map(x => (
                    <div className="dash-vs-row" key={x.stage}>
                      <div className="dash-vs-l">{stageLabel(x.stage)}</div>
                      <div className="dash-vs-track">
                        <span style={{ width: total ? `${(x.n / total) * 100}%` : 0, background: stageColor(x.stage) }} />
                      </div>
                      <div className="dash-vs-v mono">{x.n}</div>
                    </div>
                  ))}
                </div>

                {/* stopPropagation everywhere — the card itself is now a
                    button, and without it every action would also open the
                    detail drawer behind the thing you just clicked. */}
                <div className="to-acts" onClick={e=>e.stopPropagation()}>
                  <button className="btn-ghost o-btn-sm" onClick={()=>navigate(`/talent/pipeline?opening=${o.id}`)}>View pipeline</button>
                  <button className="btn-ghost o-btn-sm" onClick={()=>duplicate(o)}>Duplicate</button>
                  {o.status === 'open' && <button className="btn-ghost o-btn-sm" onClick={()=>setStatus(o, 'on_hold')}>Hold</button>}
                  {o.status === 'on_hold' && <button className="btn-ghost o-btn-sm" onClick={()=>setStatus(o, 'open')}>Resume</button>}
                  {o.status !== 'closed' && o.status !== 'filled' && <button className="btn-ghost o-btn-sm" onClick={()=>setStatus(o, 'closed')}>Close</button>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {viewing && (
        <Drawer title={viewing.title}
          sub={`${EMP_LABEL[viewing.employment_type] || 'Full time'} · ${viewing.department || 'No department'}${viewing.branch ? ` · ${viewing.branch}` : ''}`}
          onClose={()=>setViewing(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>duplicate(viewing)}>Duplicate</button>
            <button className="btn btn-primary" onClick={()=>navigate(`/talent/pipeline?opening=${viewing.id}`)}>View pipeline</button>
          </>}>
          <div className="to-view">
            <div className="to-view-row"><span>Status</span><b style={{ color: STATUS_COLOR[viewing.status] }}>{STATUS_LABEL[viewing.status] || viewing.status}</b></div>
            <div className="to-view-row"><span>Headcount</span><b>{viewing.filled_count || 0} filled of {viewing.headcount}</b></div>
            <div className="to-view-row"><span>Engagement</span><b>{EMP_LABEL[viewing.employment_type] || 'Full time'}</b></div>
            <div className="to-view-row"><span>Department</span><b>{viewing.department || '—'}</b></div>
            <div className="to-view-row"><span>Branch</span><b>{viewing.branch || '—'}</b></div>
            <div className="to-view-row"><span>Experience</span><b>
              {viewing.exp_min_years != null || viewing.exp_max_years != null
                ? `${viewing.exp_min_years ?? 0}–${viewing.exp_max_years ?? '+'} yrs` : '—'}</b></div>
            <div className="to-view-row"><span>Budget CTC</span><b>
              {viewing.budget_ctc_min || viewing.budget_ctc_max
                ? `${inr(viewing.budget_ctc_min)} – ${inr(viewing.budget_ctc_max)}` : '—'}</b></div>
            <div className="to-view-row"><span>Target date</span><b>{fmtDate(viewing.target_date)}</b></div>
            <div className="to-view-row"><span>Opened on</span><b>{fmtDate(viewing.created_at)}</b></div>
          </div>

          {viewing.justification && (
            <div className="to-view-block"><label>Why this role exists</label><p>{viewing.justification}</p></div>
          )}
          {viewing.must_have && (
            <div className="to-view-block"><label>Must-have skills</label><p>{viewing.must_have}</p></div>
          )}
          {viewing.description && (
            <div className="to-view-block"><label>Description</label><p>{viewing.description}</p></div>
          )}

          <div className="to-view-block">
            <label>Pipeline · live stages only</label>
            {(() => {
              const f = funnelFor(viewing.id)
              const total = f.reduce((s2, x) => s2 + x.n, 0)
              return total === 0
                ? <p>No candidates yet.</p>
                : f.map(x => (
                    <div className="to-view-row" key={x.stage}>
                      <span>{stageLabel(x.stage)}</span><b>{x.n}</b>
                    </div>
                  ))
            })()}
          </div>
        </Drawer>
      )}

      {showAdd && (
        <Drawer title="New opening" sub="The role, where it sits, and what we are willing to pay for it."
          onClose={()=>setShowAdd(false)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Open position</button>
          </>}>
          <div className="pd-f"><label>Job title *</label>
            <input value={form.title} onChange={e=>set({ title:e.target.value })} placeholder="e.g. Growth Sales Executive" /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Department</label>
              <input list="talent-depts" value={form.department} onChange={e=>set({ department:e.target.value })}
                placeholder="Pick or type a new one" />
              <datalist id="talent-depts">{org.departments.map(x => <option key={x} value={x} />)}</datalist>
            </div>
            <div className="pd-f"><label>Branch — which office</label>
              <input list="talent-branches" value={form.branch} onChange={e=>set({ branch:e.target.value })}
                placeholder="Ahmedabad / Vadodara" />
              <datalist id="talent-branches">{org.branches.map(x => <option key={x} value={x} />)}</datalist>
            </div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Employment type</label>
              <select value={form.employment_type} onChange={e=>set({ employment_type:e.target.value })}>
                {EMPLOYMENT.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {form.employment_type === 'intern' && <div className="pd-hint">Interns get a stipend and a fixed term — set both on the offer.</div>}
            </div>
            <div className="pd-f"><label>Headcount</label><input type="number" min="1" value={form.headcount} onChange={e=>set({ headcount:e.target.value })} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Experience — min (yrs)</label><input type="number" step="0.5" min="0" value={form.exp_min_years} onChange={e=>set({ exp_min_years:e.target.value })} /></div>
            <div className="pd-f"><label>Experience — max (yrs)</label><input type="number" step="0.5" min="0" value={form.exp_max_years} onChange={e=>set({ exp_max_years:e.target.value })} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Budget CTC — min</label>
              <input type="number" value={form.budget_ctc_min} onChange={e=>set({ budget_ctc_min:e.target.value })} placeholder="360000" /></div>
            <div className="pd-f"><label>Budget CTC — max</label>
              <input type="number" value={form.budget_ctc_max} onChange={e=>set({ budget_ctc_max:e.target.value })} placeholder="450000" /></div>
          </div>
          <div className="pd-f"><label>Target date to fill</label>
            <input type="date" value={form.target_date} min={todayYmd()} onChange={e=>set({ target_date:e.target.value })} /></div>
          <div className="pd-f"><label>Why this role exists</label>
            <textarea rows="2" value={form.justification} onChange={e=>set({ justification:e.target.value })}
              placeholder="Replacement for a leaver, new territory, volume growth…" /></div>
          <div className="pd-f"><label>Must-have skills</label>
            <textarea rows="2" value={form.must_have} onChange={e=>set({ must_have:e.target.value })} placeholder="Industrial automation sales, Gujarati + Hindi, own two-wheeler…" /></div>
          <div className="pd-f"><label>Description</label>
            <textarea rows="3" value={form.description} onChange={e=>set({ description:e.target.value })} /></div>
        </Drawer>
      )}

      <style>{`
        .to-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:14px; }
        .to-card { padding:16px 18px; display:flex; flex-direction:column; gap:14px; }
        .to-nums { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        /* .pmc-l / .pmc-v are scoped to .people-app; this card is inside
           .orders-app, so they arrived unstyled. Declared locally instead. */
        .orders-app .to-card .pmc-l { font-size:10px; font-weight:600; letter-spacing:.05em;
          text-transform:uppercase; color:var(--o-muted); }
        .orders-app .to-card .pmc-v { font-size:16px; font-weight:600; margin-top:4px;
          letter-spacing:-.01em; color:var(--o-ink); }
        .orders-app .to-card.is-clickable { cursor:pointer; transition:border-color .12s, box-shadow .12s; }
        .orders-app .to-card.is-clickable:hover { border-color:var(--o-accent,#1a73e8); }
        .orders-app .to-card.is-clickable:focus-visible { outline:2px solid var(--o-accent,#1a73e8); outline-offset:2px; }
        .to-view { margin-bottom:6px; }
        .to-view-row { display:flex; justify-content:space-between; gap:12px; padding:7px 0;
          border-bottom:1px solid var(--line-2); font-size:12.5px; color:var(--muted); }
        .to-view-row b { color:var(--ink); font-weight:600; text-align:right; }
        .to-view-block { margin-top:16px; }
        .to-view-block label { display:block; font-size:10.5px; font-weight:600; letter-spacing:.03em;
          text-transform:uppercase; color:var(--muted); margin-bottom:5px; }
        .to-view-block p { font-size:12.5px; color:var(--ink); line-height:1.6; white-space:pre-wrap; margin:0; }
        /* The shared .dash-vs-row gives the label a 76px column, which clips
           "Reference check" straight into the bar. These stage names need more. */
        .orders-app .to-card .dash-vs-row { grid-template-columns:112px minmax(0,1fr) auto; }
        .orders-app .to-card .dash-vs-l { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .orders-app .o-btn-sm { padding:5px 10px; font-size:12px; }
        .to-emp { margin-left:8px; font-size:10px; font-weight:600; text-transform:uppercase;
                  letter-spacing:.04em; color:#7c3aed; background:color-mix(in srgb,#7c3aed 12%,transparent);
                  padding:2px 7px; border-radius:6px; vertical-align:middle; }
        .to-acts { display:flex; gap:6px; flex-wrap:wrap; margin-top:auto; padding-top:4px; }
        @media (max-width:560px){ .to-cards{ grid-template-columns:1fr; } }
      `}</style>
    </Layout>
  )
}
