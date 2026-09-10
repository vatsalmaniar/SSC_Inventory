import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { loadOpenings, loadPipeline, canSeeTalent } from '../lib/talent'
import { LIVE_STAGES, TERMINAL_STAGES, stageLabel, stageColor } from '../lib/talentStage'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import Loading from '../components/Loading'
import Stat from '../components/StatTile'
import '../styles/people.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const SOURCES = [
  ['referral','Referral'], ['naukri','Naukri'], ['linkedin','LinkedIn'],
  ['consultant','Consultant'], ['walk_in','Walk-in'], ['direct','Direct'], ['other','Other'],
]
const initials = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569']
const avColor = (n='') => { let h=0; for (let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }

// How long this candidate has sat where they are.
const daysIn = a => Math.max(0, Math.round((Date.now() - new Date(a.stage_changed_at || a.created_at)) / 86400000))

const EMPTY = {
  full_name:'', phone:'', email:'', location:'', current_employer:'', current_designation:'',
  total_experience_years:'', current_ctc:'', expected_ctc:'', notice_period_days:'',
  source:'direct', source_detail:'', opening_id:'', notes:'',
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

export default function TalentPipeline() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [apps, setApps] = useState([])
  const [openings, setOpenings] = useState([])
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ ...EMPTY })
  const guard = useRef(false)

  const fOpening = params.get('opening') || 'all'
  const setOpening = v => { const p = new URLSearchParams(params); v === 'all' ? p.delete('opening') : p.set('opening', v); setParams(p) }

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
    const [a, o] = await Promise.all([loadPipeline(false), loadOpenings(false)])
    if (a.error) { toast(friendlyError(a.error), 'error'); return }
    setApps(a.data || []); setOpenings(o.data || [])
  }

  const set = patch => setForm(f => ({ ...f, ...patch }))

  async function addCandidate() {
    if (guard.current) return
    if (!form.full_name.trim()) { toast('Candidate name is required.', 'error'); return }
    if (!form.opening_id) { toast('Pick the opening they are applying for.', 'error'); return }
    guard.current = true
    try {
      // One RPC. It reuses an existing candidate when the phone or email
      // already matches (a candidate is a PERSON — two recruiters adding the
      // same walk-in a minute apart must not create two of them), creates the
      // application, and writes the timeline entry, all in one transaction.
      // Matching server-side rather than here is what makes that race safe.
      const { error } = await sb.rpc('add_candidate_application', {
        p_opening_id: form.opening_id,
        p_full_name: form.full_name.trim(),
        p_phone: form.phone.trim() || null,
        p_email: form.email.trim() || null,
        p_location: form.location.trim() || null,
        p_current_employer: form.current_employer.trim() || null,
        p_current_designation: form.current_designation.trim() || null,
        p_total_experience_years: parseFloat(form.total_experience_years) || null,
        p_current_ctc: parseFloat(form.current_ctc) || null,
        p_expected_ctc: parseFloat(form.expected_ctc) || null,
        p_notice_period_days: parseInt(form.notice_period_days, 10) || null,
        p_source: form.source,
        p_source_detail: form.source_detail.trim() || null,
        p_notes: form.notes.trim() || null,
        p_is_test: false,
      })
      if (error) throw error
      toast(`${form.full_name.trim()} added to the pipeline.`, 'success')
      setShowAdd(false); setForm({ ...EMPTY })
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return apps.filter(a => {
      if (fOpening !== 'all' && a.opening_id !== fOpening) return false
      if (!q) return true
      const c = a.candidate || {}
      return [c.full_name, c.phone, c.email, c.current_employer, a.opening?.title]
        .some(v => (v || '').toLowerCase().includes(q))
    })
  }, [apps, fOpening, search])

  const byStage = useMemo(() => {
    const m = Object.fromEntries([...LIVE_STAGES, ...TERMINAL_STAGES].map(s => [s, []]))
    for (const a of visible) if (m[a.stage]) m[a.stage].push(a)
    return m
  }, [visible])

  const stats = useMemo(() => {
    const live = visible.filter(a => LIVE_STAGES.includes(a.stage))
    const stale = live.filter(a => daysIn(a) > 14)
    return {
      live: live.length,
      offer: visible.filter(a => a.stage === 'offer').length,
      joined: visible.filter(a => a.stage === 'joined').length,
      stale: stale.length,
      lost: visible.filter(a => TERMINAL_STAGES.includes(a.stage) && a.stage !== 'joined').length,
    }
  }, [visible])

  if (denied) return (
    <Layout pageKey="talent" pageTitle="Pipeline"><div className="orders-app"><div className="o-empty">Talent 360 is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="talent" pageTitle="Pipeline"><div className="orders-app"><Loading /></div></Layout>

  return (
    <Layout pageKey="talent" pageTitle="Pipeline">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Pipeline</h1>
            <div className="page-sub">Every candidate, and exactly where they are</div>
          </div>
          <div className="page-meta">
            <button className="btn-primary" onClick={()=>{ setForm({ ...EMPTY, opening_id: fOpening !== 'all' ? fOpening : '' }); setShowAdd(true) }}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3 V13 M3 8 H13"/></svg>
              Add candidate
            </button>
          </div>
        </div>

        <TalentTabs />

        <div className="ph-bento o-bento-flat">
          <Stat label="Live candidates" value={stats.live} foot="still in play" />
          <Stat label="At offer" value={stats.offer} foot={stats.offer ? 'awaiting a decision' : 'none at offer'} />
          <Stat label="Stalled 14d+" value={stats.stale} warn={stats.stale > 0}
            foot={stats.stale ? 'not moved in two weeks' : 'everything moving'} />
          <Stat label="Joined" value={stats.joined} foot="hired" />
          <Stat label="Closed out" value={stats.lost} foot="rejected or dropped" />
        </div>

        <div className="ph-filters">
          <span className="ph-search">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by name, phone, employer…" value={search} onChange={e=>setSearch(e.target.value)} />
          </span>
          <select className="ph-picker" value={fOpening} onChange={e=>setOpening(e.target.value)}>
            <option value="all">All openings</option>
            {openings.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
          <span className="ph-count"><b>{visible.length}</b> shown</span>
        </div>

        {visible.length === 0 && <div className="o-empty">No candidates yet. Add the first one.</div>}

        {/* Live stages get a column each. The terminal ones are listed below
            rather than as columns — over a year 'rejected' is bigger than
            every live stage combined and would dominate the board. */}
        <div className="tp-board">
          {LIVE_STAGES.map(s => (
            <div className="tp-col" key={s}>
              <div className="tp-col-h">
                <span className="tp-dot" style={{ background: stageColor(s) }} />
                <span className="tp-col-t">{stageLabel(s)}</span>
                <span className="tp-col-n mono">{byStage[s].length}</span>
              </div>
              <div className="tp-col-b">
                {byStage[s].length === 0 && <div className="tp-empty">—</div>}
                {byStage[s].map(a => {
                  const c = a.candidate || {}
                  const d = daysIn(a)
                  return (
                    <button className="tp-card" key={a.id} onClick={()=>navigate(`/talent/candidates/${c.id}?app=${a.id}`)}>
                      <div className="tp-card-top">
                        <span className="tp-av" style={{ background: avColor(c.full_name) }}>{initials(c.full_name)}</span>
                        <span className="tp-nm">{c.full_name}</span>
                      </div>
                      <div className="tp-sub">{c.current_designation || c.current_employer || '—'}</div>
                      <div className="tp-meta">
                        <span>{a.opening?.title || '—'}</span>
                        <span className={'tp-age' + (d > 14 ? ' warn' : '')}>{d}d</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {(byStage.joined.length > 0 || byStage.rejected.length > 0 || byStage.dropped_out.length > 0) && (
          <div className="card" style={{ marginTop:16, padding:'14px 18px' }}>
            <div className="card-eyebrow">Closed out</div>
            <div className="tp-closed">
              {['joined','rejected','dropped_out'].map(s => (
                <div key={s}>
                  <div className="pmc-l" style={{ color: stageColor(s) }}>{stageLabel(s)} · {byStage[s].length}</div>
                  {byStage[s].slice(0, 8).map(a => (
                    <button className="tp-closed-row" key={a.id} onClick={()=>navigate(`/talent/candidates/${a.candidate?.id}?app=${a.id}`)}>
                      {a.candidate?.full_name}
                      <span>{a.opening?.title || ''}</span>
                    </button>
                  ))}
                  {byStage[s].length > 8 && <div className="tp-empty">+{byStage[s].length - 8} more</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <Drawer title="Add candidate" sub="A candidate is a person — if we already have their number, we reuse the record."
          onClose={()=>setShowAdd(false)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setShowAdd(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={addCandidate}>Add to pipeline</button>
          </>}>
          <div className="pd-f"><label>Applying for *</label>
            <select value={form.opening_id} onChange={e=>set({ opening_id:e.target.value })}>
              <option value="">Pick an opening…</option>
              {openings.filter(o => o.status === 'open').map(o => <option key={o.id} value={o.id}>{o.title}{o.branch ? ` · ${o.branch}` : ''}</option>)}
            </select>
            {openings.filter(o => o.status === 'open').length === 0 && <div className="pd-hint">No open positions — open one first.</div>}
          </div>
          <div className="pd-f"><label>Full name *</label>
            <input value={form.full_name} onChange={e=>set({ full_name:e.target.value })} placeholder="First Last" autoFocus /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Phone</label><input value={form.phone} onChange={e=>set({ phone:e.target.value })} /></div>
            <div className="pd-f"><label>Email</label><input type="email" value={form.email} onChange={e=>set({ email:e.target.value })} /></div>
          </div>
          <div className="pd-f"><label>Location</label><input value={form.location} onChange={e=>set({ location:e.target.value })} placeholder="Vadodara" /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Current employer</label><input value={form.current_employer} onChange={e=>set({ current_employer:e.target.value })} /></div>
            <div className="pd-f"><label>Current designation</label><input value={form.current_designation} onChange={e=>set({ current_designation:e.target.value })} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Experience (yrs)</label><input type="number" step="0.5" min="0" value={form.total_experience_years} onChange={e=>set({ total_experience_years:e.target.value })} /></div>
            <div className="pd-f"><label>Notice period (days)</label><input type="number" min="0" value={form.notice_period_days} onChange={e=>set({ notice_period_days:e.target.value })} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Current CTC</label><input type="number" value={form.current_ctc} onChange={e=>set({ current_ctc:e.target.value })} /></div>
            <div className="pd-f"><label>Expected CTC</label><input type="number" value={form.expected_ctc} onChange={e=>set({ expected_ctc:e.target.value })} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Source</label>
              <select value={form.source} onChange={e=>set({ source:e.target.value })}>
                {SOURCES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="pd-f"><label>{form.source === 'referral' ? 'Referred by' : 'Source detail'}</label>
              <input value={form.source_detail} onChange={e=>set({ source_detail:e.target.value })}
                placeholder={form.source === 'referral' ? 'Employee name' : 'Consultant / portal ref'} /></div>
          </div>
          <div className="pd-f"><label>Notes</label><textarea rows="2" value={form.notes} onChange={e=>set({ notes:e.target.value })} /></div>
        </Drawer>
      )}

      <style>{`
        .tp-board { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; align-items:start; }
        .tp-col { background:var(--bg); border:1px solid var(--line-2); border-radius:var(--o-radius,14px); overflow:hidden; }
        .tp-col-h { display:flex; align-items:center; gap:7px; padding:10px 12px; border-bottom:1px solid var(--line-2); }
        .tp-dot { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
        .tp-col-t { font-size:12px; font-weight:600; color:var(--ink); }
        .tp-col-n { margin-left:auto; font-size:12px; color:var(--muted); }
        .tp-col-b { padding:8px; display:flex; flex-direction:column; gap:7px; }
        .tp-empty { font-size:11.5px; color:var(--muted-2); text-align:center; padding:6px 0; }
        .tp-card { text-align:left; width:100%; background:var(--surface); border:1px solid var(--line-2); border-radius:10px;
                   padding:9px 10px; cursor:pointer; font-family:inherit; display:flex; flex-direction:column; gap:4px; }
        .tp-card:hover { border-color:var(--accent); }
        .tp-card-top { display:flex; align-items:center; gap:7px; }
        .tp-av { width:22px; height:22px; border-radius:50%; color:#fff; font-size:9.5px; font-weight:600;
                 display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
        .tp-nm { font-size:12.5px; font-weight:600; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tp-sub { font-size:11px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tp-meta { display:flex; justify-content:space-between; gap:6px; font-size:10.5px; color:var(--muted-2); }
        .tp-meta span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .tp-age { font-family:'Geist Mono',monospace; flex:0 0 auto; }
        .tp-age.warn { color:#b45309; font-weight:600; }
        .tp-closed { display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:8px; }
        .tp-closed-row { display:flex; justify-content:space-between; gap:8px; width:100%; background:none; border:0;
                         border-bottom:1px solid var(--line-2); padding:5px 0; font:inherit; font-size:12px;
                         color:var(--ink); cursor:pointer; text-align:left; }
        .tp-closed-row span { color:var(--muted-2); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        @media (max-width:1000px){ .tp-board { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @media (max-width:560px){ .tp-board, .tp-closed { grid-template-columns:1fr; } }
      `}</style>
    </Layout>
  )
}
