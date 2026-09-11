import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { loadOffers, canSeeTalent, effectiveOfferStatus, daysToLapse, isLapsed } from '../lib/talent'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import Loading from '../components/Loading'
import Stat from '../components/StatTile'
import '../styles/people.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const STATUS_COLOR = {
  draft:'#475569', sent:'#1a73e8', accepted:'#15803d', declined:'#dc2626', lapsed:'#b45309', revoked:'#94a3b8',
}
const STATUS_LABEL = {
  draft:'Draft', sent:'Awaiting response', accepted:'Accepted', declined:'Declined', lapsed:'Lapsed', revoked:'Revoked',
}
const inr = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'

export default function TalentOffers() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [rows, setRows] = useState([])
  const [versions, setVersions] = useState({})   // offer_id -> current version
  const [fStatus, setFStatus] = useState('all')
  const [search, setSearch] = useState('')

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
    const { data, error } = await loadOffers(false)
    if (error) { toast(friendlyError(error), 'error'); return }
    setRows(data || [])
    const ids = (data || []).map(o => o.id)
    if (!ids.length) { setVersions({}); return }
    // Only the live version — the superseded ones are history and belong on
    // the candidate's Offer tab, not in this list.
    const { data: vs } = await sb.from('offer_versions').select('*').in('offer_id', ids).eq('is_current', true)
    setVersions(Object.fromEntries((vs || []).map(v => [v.offer_id, v])))
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(o => {
      if (fStatus !== 'all' && effectiveOfferStatus(o) !== fStatus) return false
      if (!q) return true
      const c = o.application?.candidate || {}
      return [o.offer_no, o.designation, c.full_name].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [rows, fStatus, search])

  const stats = useMemo(() => {
    const out = rows.filter(o => o.status === 'sent' && !isLapsed(o))
    const lapsingSoon = out.filter(o => { const d = daysToLapse(o); return d != null && d <= 3 })
    const accepted = rows.filter(o => o.status === 'accepted')
    const decided = rows.filter(o => ['accepted','declined'].includes(o.status))
    return {
      out: out.length,
      lapsingSoon: lapsingSoon.length,
      accepted: accepted.length,
      lapsed: rows.filter(o => effectiveOfferStatus(o) === 'lapsed').length,
      // Acceptance rate over DECIDED offers only — counting the ones still
      // awaiting a reply would make the rate drift down every time we send one.
      rate: decided.length ? Math.round((accepted.length / decided.length) * 100) : null,
    }
  }, [rows])

  if (denied) return (
    <Layout pageKey="talent" pageTitle="Offers"><div className="orders-app"><div className="o-empty">Talent 360 is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="talent" pageTitle="Offers"><div className="orders-app"><Loading /></div></Layout>

  return (
    <Layout pageKey="talent" pageTitle="Offers">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">Offers</h1>
            <div className="page-sub">What we offered, who accepted, and what is about to lapse</div>
          </div>
        </div>

        <TalentTabs />

        <div className="ph-bento o-bento-flat">
          <Stat label="Awaiting response" value={stats.out} foot={stats.out ? 'offers out' : 'none outstanding'} />
          <Stat label="Lapsing in 3 days" value={stats.lapsingSoon} warn={stats.lapsingSoon > 0}
            foot={stats.lapsingSoon ? 'chase these today' : 'nothing urgent'} />
          <Stat label="Accepted" value={stats.accepted} foot="said yes" />
          <Stat label="Acceptance rate" value={stats.rate == null ? '—' : `${stats.rate}%`} foot="of decided offers" />
          <Stat label="Lapsed" value={stats.lapsed} warn={stats.lapsed > 0} foot="expired unanswered" />
        </div>

        <div className="ph-filters">
          <span className="ph-search">
            <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5"/><path d="M11 11 L14 14"/></svg>
            <input placeholder="Search by offer number, name, role…" value={search} onChange={e=>setSearch(e.target.value)} />
          </span>
          <select className="ph-picker" value={fStatus} onChange={e=>setFStatus(e.target.value)}>
            <option value="all">All statuses</option>
            {Object.keys(STATUS_LABEL).map(k => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select>
          <span className="ph-count"><b>{filtered.length}</b> shown</span>
        </div>

        <div className="ol-wrap">
          <div className="ol-row ol-head tof-grid">
            <div>Offer</div><div>Candidate</div><div>Role</div>
            <div className="r">CTC</div><div>Joining</div><div>Valid till</div><div>Status</div>
          </div>
          {filtered.length === 0 && <div className="o-empty">No offers match this filter.</div>}
          {filtered.map(o => {
            const v = versions[o.id]
            const eff = effectiveOfferStatus(o)
            const d = daysToLapse(o)
            const c = o.application?.candidate || {}
            return (
              <div className="ol-row ol-data tof-grid" key={o.id}
                onClick={()=>c.id && navigate(`/talent/candidates/${c.id}?app=${o.application?.id}&tab=offer`)}
                style={{ cursor: c.id ? 'pointer' : 'default' }}>
                <div className="mono">
                  {o.offer_no}
                  {v?.version > 1 && <span className="tof-rev">Rev {v.version}</span>}
                </div>
                <div style={{ fontWeight:600 }}>{c.full_name || '—'}</div>
                <div>{o.designation}<div style={{ fontSize:11.5, color:'var(--muted)' }}>{o.branch || o.department || ''}</div></div>
                <div className="r mono">{inr(v?.annual_ctc)}</div>
                <div style={{ fontSize:12 }}>{fmtDate(o.proposed_join_date)}</div>
                <div style={{ fontSize:12 }}>
                  {fmtDate(o.valid_till)}
                  {o.status === 'sent' && d != null && (
                    <div style={{ fontSize:11, color: d < 0 ? '#b45309' : d <= 3 ? '#b45309' : 'var(--muted-2)', fontWeight: d <= 3 ? 600 : 400 }}>
                      {d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? 'today' : `${d}d left`}
                    </div>
                  )}
                </div>
                <div>
                  <span className="meta-pill" style={{ color: STATUS_COLOR[eff], background:`color-mix(in srgb, ${STATUS_COLOR[eff]} 12%, transparent)` }}>
                    {STATUS_LABEL[eff] || eff}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        <div className="tof-note">
          An offer past its validity date shows as <b>Lapsed</b> and can no longer be accepted.
          Nothing runs in the background to do that — it is worked out when this page loads, and
          the status is written only when someone acts on the offer.
        </div>
      </div>

      <style>{`
        /* MUST out-specify .orders-app .ol-row (0,2,0), which carries the
           Orders column template. A bare .tof-grid (0,1,0) loses to it and the
           table silently renders in Orders' widths — 110px for the offer
           number, which wrapped it onto two lines and collided with the name. */
        .orders-app .ol-row.tof-grid {
          grid-template-columns: 200px minmax(0,1.1fr) minmax(0,1.2fr) 104px 100px 112px 118px;
        }
        /* overflow:hidden is the guard that matters: a cell whose content is
           wider than its track must clip, never spill into its neighbour.
           "SSC/HR/OFR/0001/26-27" is ~160px of Geist Mono, so the track is
           sized for it — but a longer number must still not collide. */
        .orders-app .ol-row.tof-grid > * { min-width: 0; overflow: hidden; }
        .orders-app .ol-row.tof-grid .tof-num { white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
        .tof-rev { font-family:var(--font); font-size:10px; font-weight:600; color:#7c3aed;
                   background:color-mix(in srgb, #7c3aed 12%, transparent); padding:1px 6px; border-radius:6px; margin-left:6px; }
        .tof-note { margin-top:12px; font-size:11.5px; color:var(--muted-2); line-height:1.6; }
        @media (max-width: 820px) {
          /* same specificity fight as above — the mobile restack has to beat
             .orders-app .ol-row too, or the table stays 7 columns on a phone */
          .orders-app .ol-row.tof-grid { grid-template-columns: 1fr 1fr; row-gap: 4px; }
          .tof-grid > div.r { text-align: left; }
          .ol-row.ol-head.tof-grid { display: none; }
        }
      `}</style>
    </Layout>
  )
}
