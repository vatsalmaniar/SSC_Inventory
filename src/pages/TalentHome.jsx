import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import {
  loadPipeline, loadOpenings, loadOffers, canSeeTalent,
  funnelCounts, medianDays, daysBetween, daysToLapse, isLapsed,
} from '../lib/talent'
import { LIVE_STAGES, stageLabel, stageColor } from '../lib/talentStage'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import Loading from '../components/Loading'
import Stat from '../components/StatTile'
import TrendChart from '../components/TrendChart'
import StatusDonut from '../components/StatusDonut'
import { FY_START } from '../lib/fmt'
import '../styles/people.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'
import '../styles/orders-bento.css'

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SOURCE_COLORS = { referral:'#0E7C6B', naukri:'#1a73e8', linkedin:'#0369a1', consultant:'#7C3AED', walk_in:'#C25A00', direct:'#475569', other:'#94a3b8' }
const SOURCE_LABEL = { referral:'Referral', naukri:'Naukri', linkedin:'LinkedIn', consultant:'Consultant', walk_in:'Walk-in', direct:'Direct', other:'Other' }
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : '—'
const greetingFor = h => h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'

function ListCard({ title, eyebrow, items, emptyText, onClick }) {
  return (
    <div className="card" style={{ padding:'16px 18px' }}>
      <div className="card-head">
        <div><div className="card-eyebrow">{eyebrow}</div><div className="card-title">{title}</div></div>
      </div>
      <div className="o-list">
        {items.length === 0 && <div className="o-empty" style={{ padding:'14px 0' }}>{emptyText}</div>}
        {items.map(i => (
          <button className="o-list-row" key={i.key} onClick={()=>onClick?.(i)} style={{ width:'100%', textAlign:'left', background:'none', border:0, borderBottom:'1px solid var(--line-2)', font:'inherit', cursor:'pointer' }}>
            <span className="o-list-cust">{i.main}</span>
            <span className="o-list-num mono" style={{ color:i.color || 'var(--muted-2)' }}>{i.right}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function TalentHome() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [me, setMe] = useState({ name:'' })
  const [apps, setApps] = useState([])
  const [openings, setOpenings] = useState([])
  const [offers, setOffers] = useState([])
  const [ivs, setIvs] = useState([])

  useEffect(() => { init() }, [])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return } ; session = data.session }
    const { data: p } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!canSeeTalent(p?.role)) { setDenied(true); setLoading(false); return }
    setMe({ name: p?.name || '' })
    try {
      const [a, o, of] = await Promise.all([loadPipeline(false), loadOpenings(false), loadOffers(false)])
      if (a.error) throw a.error
      setApps(a.data || []); setOpenings(o.data || []); setOffers(of.data || [])
      const ids = (a.data || []).map(x => x.id)
      if (ids.length) {
        const { data: iv } = await sb.from('interviews').select('*').in('application_id', ids).eq('outcome', 'pending')
        setIvs(iv || [])
      }
    } catch (e) { toast(friendlyError(e), 'error') }
    setLoading(false)
  }

  const d = useMemo(() => {
    const live = apps.filter(a => LIVE_STAGES.includes(a.stage))
    const joined = apps.filter(a => a.stage === 'joined')
    const openPos = openings.filter(o => o.status === 'open')

    // Interviews in the next 7 days, soonest first.
    const now = Date.now()
    const week = ivs.filter(i => i.scheduled_at && new Date(i.scheduled_at) >= new Date(now - 86400000) && new Date(i.scheduled_at) <= new Date(now + 7 * 86400000))
      .sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at))

    const offersOut = offers.filter(o => o.status === 'sent' && !isLapsed(o))
    const lapsingSoon = offersOut.filter(o => { const n = daysToLapse(o); return n != null && n <= 3 })
    const accepted = offers.filter(o => o.status === 'accepted')
    const decided = offers.filter(o => ['accepted','declined'].includes(o.status))

    // Time-to-hire: applied → joined, MEDIAN. One nine-month outlier would drag
    // a mean somewhere no real hire has ever been.
    const tth = medianDays(joined.map(a => daysBetween(a.applied_on || a.created_at, a.stage_changed_at)))

    // Offer-to-join drop-off: accepted, then never actually joined.
    const acceptedNotJoined = accepted.filter(o => !o.converted_employee_id).length
    const dropOff = accepted.length ? Math.round((acceptedNotJoined / accepted.length) * 100) : null

    // Joins per month across the FY.
    const start = new Date(FY_START)
    const months = []
    for (let dt = new Date(start.getFullYear(), start.getMonth(), 1); dt <= new Date(); dt.setMonth(dt.getMonth() + 1)) {
      const key = `${dt.getFullYear()}-${dt.getMonth()}`
      months.push({ key, label: MON[dt.getMonth()], value: 0 })
    }
    for (const a of joined) {
      const dt = new Date(a.stage_changed_at)
      const key = `${dt.getFullYear()}-${dt.getMonth()}`
      const m = months.find(x => x.key === key)
      if (m) m.value++
    }

    // Source mix over live candidates — where our pipeline actually comes from.
    const srcCount = {}
    for (const a of live) { const s = a.candidate?.source || 'other'; srcCount[s] = (srcCount[s] || 0) + 1 }
    const srcRows = Object.entries(srcCount).sort((x, y) => y[1] - x[1])
      .map(([k, v]) => ({ label: SOURCE_LABEL[k] || k, value: v, color: SOURCE_COLORS[k] || '#94a3b8' }))
    const referralPct = live.length ? Math.round(((srcCount.referral || 0) / live.length) * 100) : 0

    // Stalled — nobody has touched them in a fortnight.
    const stalled = live.filter(a => (now - new Date(a.stage_changed_at || a.created_at)) / 86400000 > 14)
      .sort((x, y) => new Date(x.stage_changed_at) - new Date(y.stage_changed_at))

    return {
      live, joined, openPos, week, offersOut, lapsingSoon, accepted, decided, tth, dropOff,
      months, srcRows, referralPct, stalled,
      seats: openPos.reduce((s, o) => s + Math.max(0, (o.headcount || 0) - (o.filled_count || 0)), 0),
      // Openings whose target_date has passed and which are still unfilled —
      // the replacement for "requisitions awaiting approval" now that the two
      // concepts are one.
      overdueOpenings: openPos
        .filter(o => o.target_date && o.target_date < new Date().toLocaleDateString('en-CA'))
        .map(o => ({ ...o, daysLate: Math.round((Date.now() - new Date(o.target_date)) / 86400000) }))
        .sort((x, y) => y.daysLate - x.daysLate),
      acceptRate: decided.length ? Math.round((accepted.length / decided.length) * 100) : null,
      funnel: funnelCounts(apps),
    }
  }, [apps, openings, offers, ivs])

  if (denied) return (
    <Layout pageKey="talent" pageTitle="Talent 360"><div className="orders-app"><div className="o-empty">Talent 360 is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="talent" pageTitle="Talent 360"><div className="orders-app"><Loading /></div></Layout>

  const funnelMax = Math.max(1, ...d.funnel.map(f => f.count))
  const first = (me.name || '').split(' ')[0]

  return (
    <Layout pageKey="talent" pageTitle="Talent 360">
      <div className="orders-app">
        <div className="page-head">
          <div>
            <h1 className="page-title">{greetingFor(new Date().getHours())}{first ? `, ${first}` : ''}</h1>
            <div className="page-sub">Hiring at a glance — what is open, who is moving, and what needs chasing</div>
          </div>
          <div className="page-meta">
            <div className="meta-pill live"><span className="meta-dot" /> Live</div>
            <button className="btn-primary" onClick={()=>navigate('/talent/pipeline')}>Open pipeline</button>
          </div>
        </div>

        <TalentTabs />

        <div className="ph-bento">
          <Stat label="Open positions" value={d.openPos.length} foot={`${d.seats} seat${d.seats === 1 ? '' : 's'} to fill`} onClick={()=>navigate('/talent/openings')} />
          <Stat label="Live candidates" value={d.live.length} foot="still in play" onClick={()=>navigate('/talent/pipeline')} />
          <Stat label="Interviews this week" value={d.week.length} foot={d.week.length ? 'scheduled' : 'nothing booked'} />
          <Stat label="Offers out" value={d.offersOut.length} warn={d.lapsingSoon.length > 0}
            foot={d.lapsingSoon.length ? `${d.lapsingSoon.length} lapsing in 3 days` : 'awaiting a reply'}
            onClick={()=>navigate('/talent/offers')} />
          <Stat label="Joined this FY" value={d.joined.length} foot="hires closed" />

          <div className="ph-wide ph-anchor">
            <div className="ph-anchor-head">
              <div>
                <div className="ph-anchor-eyebrow">Median time to hire · applied → joined</div>
                <div className="ph-anchor-v">{d.tth == null ? '—' : d.tth}<small> {d.tth == null ? '' : 'days'}</small></div>
                <div className="ph-anchor-sub">
                  {d.joined.length ? `across ${d.joined.length} hire${d.joined.length === 1 ? '' : 's'} this financial year` : 'no hires closed yet this year'}
                </div>
              </div>
              <div className="ph-anchor-stats">
                <div><div className="ph-as-l">Offer acceptance</div><div className="ph-as-v">{d.acceptRate == null ? '—' : `${d.acceptRate}%`}</div></div>
                <div><div className="ph-as-l">Offer→join drop-off</div><div className="ph-as-v">{d.dropOff == null ? '—' : `${d.dropOff}%`}</div></div>
                <div><div className="ph-as-l">From referrals</div><div className="ph-as-v">{d.referralPct}%</div></div>
              </div>
            </div>
            <TrendChart points={d.months} fmt={v => String(v)} height={96} />
          </div>

          {/* Live stages only. 'joined' and 'rejected' accumulate all year and
              would flatten every live stage to a sliver — the eyebrow says so
              rather than quietly dropping them. Bars, not a pie. */}
          <div className="card ph-tall o-pipe">
            <div className="card-head">
              <div>
                <div className="card-eyebrow">Live stages only</div>
                <div className="card-title">Funnel</div>
              </div>
              <span className="trend-pill mono">{d.live.length}</span>
            </div>
            <div className="o-pipe-list">
              {d.funnel.map(f => (
                <div className="o-pipe-row" key={f.stage}>
                  <div className="o-pipe-top">
                    <span className="o-pipe-dot" style={{ background: stageColor(f.stage) }} />
                    <span className="o-pipe-name">{stageLabel(f.stage)}</span>
                    <span className="o-pipe-n mono">{f.count}</span>
                  </div>
                  <div className="dash-vs-track"><span style={{ width:`${(f.count / funnelMax) * 100}%`, background: stageColor(f.stage) }} /></div>
                </div>
              ))}
            </div>
            {/* The exclusion has to be stated, but it does not fit on one line
                in a one-sixth-width column and .card-eyebrow is nowrap for the
                whole app — so it goes here, where it can wrap. */}
            <div className="th-note">Joined and rejected are excluded — over a year they dwarf every live stage.</div>
          </div>
        </div>

        <div className="o-mid">
          <div className="card" style={{ padding:'16px 18px' }}>
            <div className="card-eyebrow">Live candidates</div>
            <div className="card-title" style={{ marginBottom:12 }}>Where they come from</div>
            <StatusDonut pct={d.referralPct} centerLabel="referral" rows={d.srcRows}
              summary={{ label:'Live candidates', value: d.live.length }} />
          </div>

          <div className="card" style={{ padding:'16px 18px' }}>
            <div className="card-head">
              <div>
                <div className="card-eyebrow">No movement in 14 days</div>
                <div className="card-title">Stalled candidates</div>
              </div>
              <span className="trend-pill mono">{d.stalled.length}</span>
            </div>
            <div className="o-list">
              {d.stalled.length === 0 && <div className="o-empty" style={{ padding:'14px 0' }}>Nothing is stuck — every live candidate has moved inside a fortnight.</div>}
              {d.stalled.slice(0, 8).map(a => {
                const days = Math.round((Date.now() - new Date(a.stage_changed_at || a.created_at)) / 86400000)
                return (
                  <button className="o-list-row" key={a.id} onClick={()=>navigate(`/talent/candidates/${a.candidate?.id}?app=${a.id}`)}
                    style={{ width:'100%', textAlign:'left', background:'none', border:0, borderBottom:'1px solid var(--line-2)', font:'inherit', cursor:'pointer' }}>
                    <span className="o-list-cust">{a.candidate?.full_name}<span style={{ color:'var(--muted-2)' }}> · {stageLabel(a.stage)}</span></span>
                    <span className="o-list-num mono" style={{ color:'#b45309' }}>{days}d</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <style>{`
          .orders-app .th-note { font-size:11px; color:var(--o-muted); line-height:1.5;
            margin-top:10px; padding-top:9px; border-top:1px solid var(--o-line); white-space:normal; }
        `}</style>

        <div className="dash-row-3">
          <ListCard title="Interviews due" eyebrow="Next 7 days"
            items={d.week.slice(0, 8).map(i => {
              const a = apps.find(x => x.id === i.application_id)
              return { key:i.id, main:`${a?.candidate?.full_name || 'Candidate'} · R${i.round_no}`, right:fmtDate(i.scheduled_at), app:a }
            })}
            emptyText="Nothing scheduled this week."
            onClick={i => i.app && navigate(`/talent/candidates/${i.app.candidate?.id}?app=${i.app.id}`)} />

          <ListCard title="Offers awaiting reply" eyebrow="Sent, not yet answered"
            items={d.offersOut.slice(0, 8).map(o => {
              const n = daysToLapse(o)
              return { key:o.id, main:o.application?.candidate?.full_name || o.offer_no,
                right: n == null ? '—' : n < 0 ? `${Math.abs(n)}d over` : `${n}d left`,
                color: n != null && n <= 3 ? '#b45309' : undefined, o }
            })}
            emptyText="No offers outstanding."
            onClick={i => navigate('/talent/offers')} />

          <ListCard title="Roles running late" eyebrow="Past their target date"
            items={d.overdueOpenings.slice(0, 8).map(o => ({ key:o.id, main:o.title,
              right:`${o.daysLate}d late`, color:'#b45309' }))}
            emptyText="Every open role is still inside its target date."
            onClick={()=>navigate('/talent/openings')} />
        </div>
      </div>
    </Layout>
  )
}
