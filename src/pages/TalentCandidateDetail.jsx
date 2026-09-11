import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { toast } from '../lib/toast'
import { friendlyError } from '../lib/errorMsg'
import { writeDoc } from '../lib/printDoc'
import { buildOfferLetterHtml } from '../lib/offerLetterHtml'
import {
  TALENT_BUCKET, EMPLOYEE_BUCKET, CANDIDATE_DOC_TYPES, CARRY_ON_JOIN,
  ACCEPT_ATTR, MAX_DOC_MB, docLabel, uploadDoc, openDoc, copyObject, docPath, validateFile,
} from '../lib/hrDocs'
import { createEmployee, validateEmployeeForm, EMPTY_EMPLOYEE_FORM, autoUsername, genPassword, today } from '../lib/createEmployee'
import SalaryStructurePanel, { computePanel, EMPTY_SALARY } from '../components/SalaryStructurePanel'
import {
  // aliased: the page has its own addComment() handler, and an unaliased import
  // would be shadowed by it — the handler would call itself forever.
  canSeeTalent, addComment as postComment, moveStage, effectiveOfferStatus, canAcceptOffer, daysToLapse, todayYmd, loadOrgOptions,
} from '../lib/talent'
import { allowedNext, stageLabel, stageColor, needsReason, isTerminal } from '../lib/talentStage'
import Layout from '../components/Layout'
import TalentTabs from '../components/TalentTabs'
import Loading from '../components/Loading'
import '../styles/people.css'
import '../styles/orders-redesign.css'
import '../styles/people-home.css'

const TABS = ['Profile', 'Documents', 'Interviews', 'References', 'Offer', 'Activity']
// Document types, limits and the uploader all come from lib/hrDocs — the same
// list People 360 uses, so a document filed here is one the employee profile
// can find after they join.
const ROUND_TYPES = [['screening','Screening'],['technical','Technical'],['hr','HR'],['management','Management'],['other','Other']]
const OUTCOMES = [['pending','Pending'],['selected','Selected'],['rejected','Rejected'],['on_hold','On hold'],['no_show','No show']]
// Stored values are unchanged ('positive' / 'negative' / 'unreachable') — only
// the wording differs, so no CHECK constraint is altered and no row migrates.
// 'mixed' is dropped from the picker but still renders if an old row has it.
const VERDICTS = [
  ['pending','Not called yet'],
  ['positive','Recommended'],
  ['negative','Not recommended'],
  ['unreachable','Could not reach'],
]
const VERDICT_LABEL = { pending:'Not called yet', positive:'Recommended', mixed:'Mixed', negative:'Not recommended', unreachable:'Could not reach' }
const OUTCOME_COLOR = { pending:'#b45309', selected:'#15803d', rejected:'#dc2626', on_hold:'#7c3aed', no_show:'#94a3b8' }
const VERDICT_COLOR = { pending:'#b45309', positive:'#15803d', mixed:'#b45309', negative:'#dc2626', unreachable:'#94a3b8' }
const OFFER_COLOR = { draft:'#475569', sent:'#1a73e8', accepted:'#15803d', declined:'#dc2626', lapsed:'#b45309', revoked:'#94a3b8' }
const EMPLOYMENT = [['full_time','Full time'],['contract','Contract'],['intern','Internship'],['part_time','Part time']]
const EMP_LABEL = Object.fromEntries(EMPLOYMENT)

const inr = n => n == null || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'
const initials = (n='') => n.split(' ').filter(Boolean).map(w=>w[0]).join('').toUpperCase().slice(0,2) || '?'
const AVATAR_COLORS = ['#5c6bc0','#0d9488','#059669','#b45309','#7c3aed','#be185d','#0369a1','#475569']
const avColor = (n='') => { let h=0; for (let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length] }


function Drawer({ title, sub, onClose, children, footer, wide }) {
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer" role="dialog" style={wide ? { width:'min(920px, 96vw)' } : undefined}>
        <div className="pd-h"><div><div className="pd-h-t">{title}</div>{sub && <div className="pd-h-s">{sub}</div>}</div><button className="pd-x" onClick={onClose}>✕</button></div>
        <div className="pd-b">{children}</div>
        {footer && <div className="pd-foot">{footer}</div>}
      </div>
    </>, document.body)
}

const Spec = ({ l, v }) => (
  <div className="tc-spec"><div className="tc-spec-l">{l}</div><div className="tc-spec-v">{v ?? '—'}</div></div>
)

export default function TalentCandidateDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [denied, setDenied] = useState(false)
  const [me, setMe] = useState({ id:'', name:'', role:'' })
  const [cand, setCand] = useState(null)
  const [apps, setApps] = useState([])
  const [app, setApp] = useState(null)
  const [interviews, setInterviews] = useState([])
  const [refs, setRefs] = useState([])
  const [offer, setOffer] = useState(null)
  const [versions, setVersions] = useState([])
  const [docs, setDocs] = useState([])
  const [comments, setComments] = useState([])
  const [teams, setTeams] = useState([])
  const [org, setOrg] = useState({ departments: [], branches: [] })
  const [tab, setTab] = useState(params.get('tab') === 'offer' ? 'Offer' : 'Profile')

  // drawers
  const [moveTo, setMoveTo] = useState(null)
  const [moveWhy, setMoveWhy] = useState('')
  const [ivForm, setIvForm] = useState(null)
  const [refForm, setRefForm] = useState(null)
  const [offerForm, setOfferForm] = useState(null)
  const [reviseForm, setReviseForm] = useState(null)
  const [joinForm, setJoinForm] = useState(null)
  const [creds, setCreds] = useState(null)
  const [comment, setComment] = useState('')
  const [uploading, setUploading] = useState(false)
  const guard = useRef(false)
  const fileRef = useRef(null)
  const [docType, setDocType] = useState('cv')

  useEffect(() => { init() }, [id])

  async function init() {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return } ; session = data.session }
    const { data: p } = await sb.from('profiles').select('name,role').eq('id', session.user.id).single()
    if (!canSeeTalent(p?.role)) { setDenied(true); setLoading(false); return }
    setMe({ id: session.user.id, name: p?.name || '', role: p?.role || '' })
    await load()
    setLoading(false)
  }

  async function load() {
    const { data: c } = await sb.from('candidates').select('*').eq('id', id).maybeSingle()
    setCand(c || null)
    if (!c) return

    const { data: as } = await sb.from('applications')
      // employment_type is read by the offer drawer so an internship opening
      // cannot quietly produce a full-time offer letter.
      .select('*, opening:job_openings(id,title,department,branch,headcount,filled_count,employment_type,budget_ctc_min,budget_ctc_max)')
      .eq('candidate_id', id).order('created_at', { ascending: false })
    const list = as || []
    setApps(list)

    const wanted = params.get('app')
    const current = list.find(a => a.id === wanted) || list[0] || null
    setApp(current)

    const { data: d } = await sb.from('talent_documents').select('*').eq('candidate_id', id).order('created_at', { ascending: false })
    setDocs(d || [])

    // Teams only matter for a sales login on the Mark-joined step.
    sb.from('kpi_teams').select('id,name').then(({ data }) => setTeams(data || [])).catch(() => {})
    loadOrgOptions().then(setOrg).catch(() => {})

    if (!current) { setInterviews([]); setRefs([]); setOffer(null); setVersions([]); setComments([]); return }

    const [iv, rc, of, cm] = await Promise.all([
      sb.from('interviews').select('*').eq('application_id', current.id).order('round_no'),
      sb.from('reference_checks').select('*').eq('application_id', current.id).order('created_at'),
      sb.from('offers').select('*').eq('application_id', current.id).maybeSingle(),
      sb.from('talent_comments').select('*').eq('application_id', current.id).order('created_at'),
    ])
    setInterviews(iv.data || []); setRefs(rc.data || []); setComments(cm.data || [])
    setOffer(of.data || null)
    if (of.data) {
      const { data: vs } = await sb.from('offer_versions').select('*').eq('offer_id', of.data.id).order('version', { ascending: false })
      setVersions(vs || [])
    } else setVersions([])
  }

  const currentVersion = useMemo(() => versions.find(v => v.is_current) || versions[0] || null, [versions])

  function switchApp(a) {
    const p = new URLSearchParams(params); p.set('app', a.id); setParams(p)
    setApp(a); load()
  }

  // ── stage ────────────────────────────────────────────────────────────────
  async function doMove() {
    if (guard.current || !app || !moveTo) return
    if (needsReason(moveTo) && !moveWhy.trim()) { toast('A reason is required — an unexplained rejection is useless later.', 'error'); return }
    guard.current = true
    try {
      await moveStage({ application: app, to: moveTo, reason: moveWhy.trim(), authorName: me.name })
      toast(`Moved to ${stageLabel(moveTo)}.`, 'success')
      setMoveTo(null); setMoveWhy('')
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  // ── documents ────────────────────────────────────────────────────────────
  async function upload(file) {
    if (!file || !cand) return
    const bad = validateFile(file)
    if (bad) { toast(bad, 'error'); if (fileRef.current) fileRef.current.value = ''; return }

    setUploading(true)
    try {
      await uploadDoc({
        bucket: TALENT_BUCKET, ownerId: cand.id, docType, file,
        register: async (path) => {
          const { error } = await sb.rpc('add_talent_document', {
            p_candidate_id: cand.id, p_doc_type: docType, p_file_path: path,
            p_file_name: file.name, p_application_id: app?.id || null, p_offer_version_id: null,
          })
          if (error) throw error
        },
      })
      toast(`${docLabel(docType)} uploaded.`, 'success')
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function viewDoc(d) {
    // Private bucket — always a fresh signed URL, never a public one. CVs and
    // ID proofs are personal data.
    try { window.open(await openDoc(TALENT_BUCKET, d.file_path), '_blank', 'noopener') }
    catch { toast('Could not open that document.', 'error') }
  }

  // ── interviews ───────────────────────────────────────────────────────────
  async function saveInterview() {
    if (guard.current || !app) return
    const f = ivForm
    guard.current = true
    try {
      const { error } = await sb.rpc('upsert_interview', {
        p_application_id: app.id,
        p_round_no: parseInt(f.round_no, 10) || 1,
        p_round_type: f.round_type,
        p_scheduled_at: f.scheduled_at ? new Date(f.scheduled_at).toISOString() : null,
        p_interviewer_id: null,
        p_outcome: f.outcome,
        p_overall_rating: f.overall_rating ? parseInt(f.overall_rating, 10) : null,
        p_ratings: {},
        p_notes: f.notes.trim() || null,
        p_id: f.id || null,
      })
      if (error) throw error
      toast('Interview saved.', 'success')
      setIvForm(null); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  // ── references ───────────────────────────────────────────────────────────
  async function saveRef() {
    if (guard.current || !app) return
    const f = refForm
    if (!f.referee_name.trim()) { toast('Referee name is required.', 'error'); return }
    guard.current = true
    try {
      const { error } = await sb.rpc('upsert_reference_check', {
        p_application_id: app.id,
        p_referee_name: f.referee_name.trim(),
        p_referee_company: f.referee_company.trim() || null,
        p_referee_designation: f.referee_designation.trim() || null,
        p_referee_phone: f.referee_phone.trim() || null,
        p_relationship: f.relationship.trim() || null,
        p_verdict: f.verdict,
        p_notes: f.notes.trim() || null,
        p_id: f.id || null,
      })
      if (error) throw error
      toast('Reference saved.', 'success')
      setRefForm(null); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  // ── offers ───────────────────────────────────────────────────────────────
  function openOfferDrawer() {
    setOfferForm({
      designation: app?.opening?.title || cand?.current_designation || '',
      department: app?.opening?.department || '',
      branch: app?.opening?.branch || '',
      // Inherit the type from the opening — an internship opening should not
      // quietly produce a full-time offer letter.
      employment_type: app?.opening?.employment_type || 'full_time',
      internship_months: '6',
      stipend_monthly: '',
      proposed_join_date: '', valid_till: '', reporting_address: '',
      sal: { ...EMPTY_SALARY, ctc: cand?.expected_ctc ? String(cand.expected_ctc) : '' },
    })
  }

  async function saveOffer() {
    if (guard.current || !app) return
    const f = offerForm
    const intern = f.employment_type === 'intern'
    if (!f.designation.trim()) { toast('Designation is required.', 'error'); return }
    if (intern) {
      if (!(Number(f.stipend_monthly) > 0)) { toast('Enter the monthly stipend.', 'error'); return }
      if (!(parseInt(f.internship_months, 10) > 0)) { toast('Enter how many months the internship runs for.', 'error'); return }
    } else if (!(Number(f.sal.ctc) > 0)) {
      toast('Enter the annual CTC — an offer with no money on it is not an offer.', 'error'); return
    }
    guard.current = true
    try {
      // ONE call: the RPC allocates the OFR number and writes the offer AND
      // version 1 in the same transaction, so a refused write rolls the
      // counter back rather than burning a number.
      // An internship has no salary structure, so no breakup is computed for
      // one — the letter prints stipend details instead of Annexure A.
      const { data: row, error } = await sb.rpc('create_offer', {
        p_application_id: app.id,
        p_designation: f.designation.trim(),
        p_department: f.department.trim() || null,
        p_branch: f.branch.trim() || null,
        p_proposed_join_date: f.proposed_join_date || null,
        p_reporting_address: f.reporting_address.trim() || null,
        p_valid_till: f.valid_till || null,
        p_annual_ctc: intern ? 0 : Number(f.sal.ctc) || 0,
        p_salary_ratio: intern ? null : f.sal.ratio,
        p_tax_regime: f.sal.regime,
        p_pf_applicable: intern ? false : !!f.sal.pf,
        p_professional_tax: Number(f.sal.pt) || 0,
        p_accidental_insurance: Number(f.sal.acc) || 0,
        p_breakup: intern ? {} : computePanel(f.sal),
        p_is_test: false,
        p_employment_type: f.employment_type,
        p_internship_months: intern ? parseInt(f.internship_months, 10) : null,
        p_stipend_monthly: intern ? Number(f.stipend_monthly) : null,
      })
      if (error) throw error
      toast(`${row?.offer_no} created.`, 'success')
      setOfferForm(null); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  async function saveRevision() {
    if (guard.current || !offer) return
    const f = reviseForm
    const intern = offer.employment_type === 'intern'
    if (intern) {
      if (!(Number(f.stipend_monthly) > 0)) { toast('Enter the revised monthly stipend.', 'error'); return }
    } else if (!(Number(f.sal.ctc) > 0)) { toast('Enter the revised CTC.', 'error'); return }
    if (!f.reason.trim()) { toast('Say what changed — the version history is the point.', 'error'); return }
    guard.current = true
    try {
      const { data: v, error } = await sb.rpc('revise_offer', {
        p_offer_id: offer.id,
        p_annual_ctc: intern ? 0 : Number(f.sal.ctc) || 0,
        p_salary_ratio: intern ? null : f.sal.ratio,
        p_tax_regime: f.sal.regime,
        p_pf_applicable: intern ? false : !!f.sal.pf,
        p_professional_tax: Number(f.sal.pt) || 0,
        p_accidental_insurance: Number(f.sal.acc) || 0,
        p_breakup: intern ? {} : computePanel(f.sal),
        p_revision_reason: f.reason.trim(),
        p_stipend_monthly: intern ? Number(f.stipend_monthly) : null,
      })
      if (error) throw error
      toast(`Revised to Rev ${v?.version}. The earlier version is superseded.`, 'success')
      setReviseForm(null); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  function printLetter(v) {
    const w = window.open('', '_blank')
    if (!w) { toast('Allow pop-ups to open the letter.', 'error'); return }
    writeDoc(w, buildOfferLetterHtml(offer, v || currentVersion, cand, { letterDate: offer?.sent_at || todayYmd() }))
  }

  async function setOfferStatus(status, reason = null) {
    if (guard.current || !offer) return
    guard.current = true
    try {
      // The server re-checks the lapse rule here too: an offer past its
      // validity date cannot be accepted, whatever this page believes.
      const { error } = await sb.rpc('set_offer_status', {
        p_id: offer.id, p_status: status, p_reason: reason,
      })
      if (error) throw error
      toast(`Offer marked ${status}.`, 'success')
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  // ── mark joined ──────────────────────────────────────────────────────────
  // Prefills the SAME form createEmployee() takes on the Team page. Nothing is
  // retyped, and there is only one code path that can make an employee.
  function openJoin() {
    const v = currentVersion
    setJoinForm({
      ...EMPTY_EMPLOYEE_FORM,
      full_name: cand?.full_name || '',
      designation: offer?.designation || '',
      department: offer?.department || '',
      branch: offer?.branch || '',
      join_date: offer?.proposed_join_date || todayYmd(),
      personal_phone: cand?.phone || '',
      personal_email: cand?.email || '',
      annual_ctc: v?.annual_ctc ? String(v.annual_ctc) : '',
      salary_ratio: v?.salary_ratio || '50 / 20 / 10 / 20',
      tax_regime: v?.tax_regime || 'new',
      pf_applicable: !!v?.pf_applicable,
      professional_tax: v?.professional_tax != null ? String(v.professional_tax) : '200',
      accidental_insurance: v?.accidental_insurance != null ? String(v.accidental_insurance) : '128',
      create_login: true,
      username: autoUsername(cand?.full_name || ''),
      password: genPassword(),
      login_role: 'sales',
    })
  }

  // Moves the candidate's paperwork into the employee-docs bucket and registers
  // it against the new employee. employee_documents is unique on
  // (employee_id, doc_type), so only the newest of each type survives — which
  // is what the People 360 Documents tab shows anyway.
  // Moves the candidate's paperwork onto the employee record.
  //
  // THE BUG THIS FIXES: People 360 used to look for doc_type 'Offer Letter'
  // while this wrote 'offer_letter', so copied documents landed in the table
  // and were never shown — no error, just an empty tab. Both sides now take
  // their vocabulary from lib/hrDocs, so the types match by construction.
  //
  // employee_documents is UNIQUE on (employee_id, doc_type), so only the newest
  // of each type survives — which is what the Documents tab shows anyway.
  async function copyDocsToEmployee(employeeId) {
    const seen = new Set()
    let copied = 0, failed = 0
    for (const d of docs) {
      if (!CARRY_ON_JOIN.includes(d.doc_type) || seen.has(d.doc_type)) continue
      seen.add(d.doc_type)
      try {
        const dest = docPath(EMPLOYEE_BUCKET, employeeId, d.doc_type, d.file_name || d.doc_type)
        await copyObject({ from: TALENT_BUCKET, to: EMPLOYEE_BUCKET, fromPath: d.file_path, toPath: dest })
        const { error } = await sb.from('employee_documents').upsert(
          { employee_id: employeeId, doc_type: d.doc_type, file_path: dest,
            file_name: d.file_name, uploaded_at: new Date().toISOString() },
          { onConflict: 'employee_id,doc_type' },
        )
        if (error) throw error
        copied++
      } catch { failed++ }   // one document is not worth failing the join over
    }
    return { copied, failed }
  }

  async function doJoin() {
    if (guard.current || !joinForm) return
    const bad = validateEmployeeForm(joinForm)
    if (bad) { toast(bad, 'error'); return }
    guard.current = true
    try {
      const { employeeId, credentials } = await createEmployee({ form: joinForm, isMgmt: true, testMode: false })

      // One RPC closes the loop atomically: link the offer to the person it
      // created, move the application to 'joined', consume a seat on the
      // opening and mark it filled if that was the last one. Doing these as
      // three browser calls could leave an employee with an offer that never
      // points at them, or a seat that is never consumed.
      const { error: linkErr } = await sb.rpc('complete_offer_join', {
        p_offer_id: offer.id, p_employee_id: employeeId,
      })
      if (linkErr) throw linkErr
      // Carry the paperwork across so the CV and certificates live on their
      // People 360 record rather than being stranded in Talent.
      //
      // The FILE moves too, not just the row: employee_documents.file_path is
      // read against the employee-docs bucket, so copying only the row would
      // leave People 360 with a path it cannot sign. Best-effort — a document
      // that fails to copy must not undo an employee who already exists.
      const moved = await copyDocsToEmployee(employeeId).catch(() => ({ copied: 0, failed: 0 }))
      if (moved.failed) {
        toast(`${moved.failed} document${moved.failed === 1 ? '' : 's'} could not be copied to their profile.`,
          'warning', 'Re-upload from People 360 → Documents.')
      }

      setJoinForm(null)
      if (credentials) setCreds(credentials)
      toast(`${joinForm.full_name} is now on the team.`, 'success')
      await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
    finally { guard.current = false }
  }

  async function addComment() {
    if (!comment.trim() || !app) return
    try {
      // is_activity is not a parameter on the RPC — a human comment must never
      // be able to disguise itself as a system event on the timeline.
      await postComment(app.id, comment.trim())
      setComment(''); await load()
    } catch (e) { toast(e?.message || friendlyError(e), 'error') }
  }

  if (denied) return (
    <Layout pageKey="talent" pageTitle="Candidate"><div className="orders-app"><div className="o-empty">Talent 360 is restricted to Admin &amp; Management.</div></div></Layout>
  )
  if (loading) return <Layout pageKey="talent" pageTitle="Candidate"><div className="orders-app"><Loading /></div></Layout>
  if (!cand) return (
    <Layout pageKey="talent" pageTitle="Candidate"><div className="orders-app"><div className="o-empty">That candidate no longer exists.</div></div></Layout>
  )

  const moves = app ? allowedNext(app.stage) : []
  const effStatus = offer ? effectiveOfferStatus(offer) : null
  const lapseIn = offer ? daysToLapse(offer) : null

  return (
    <Layout pageKey="talent" pageTitle={cand.full_name}>
      <div className="orders-app">
        <div className="page-head">
          <div>
            <button className="ph-back" onClick={()=>navigate('/talent/pipeline')}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>Pipeline
            </button>
            <h1 className="page-title" style={{ display:'flex', alignItems:'center', gap:10 }}>
              <span className="tc-av" style={{ background: avColor(cand.full_name) }}>{initials(cand.full_name)}</span>
              {cand.full_name}
            </h1>
            <div className="page-sub">
              {cand.current_designation || '—'}{cand.current_employer ? ` at ${cand.current_employer}` : ''}
              {app?.opening?.title ? ` · applying for ${app.opening.title}` : ''}
            </div>
          </div>
          <div className="page-meta">
            {app && (
              <span className="meta-pill" style={{ color: stageColor(app.stage), background:`color-mix(in srgb, ${stageColor(app.stage)} 12%, transparent)` }}>
                {stageLabel(app.stage)}
              </span>
            )}
            {app && !isTerminal(app.stage) && (
              <select className="ph-picker" value="" onChange={e=>{ if (e.target.value) { setMoveTo(e.target.value); setMoveWhy('') } }}>
                <option value="">Move to…</option>
                {moves.map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}
              </select>
            )}
          </div>
        </div>

        <TalentTabs />

        {apps.length > 1 && (
          <div className="tc-apps">
            <span className="pmc-l">Applications</span>
            {apps.map(a => (
              <button key={a.id} className={'tc-app' + (a.id === app?.id ? ' on' : '')} onClick={()=>switchApp(a)}>
                {a.opening?.title || 'Opening'} · {stageLabel(a.stage)}
              </button>
            ))}
          </div>
        )}

        {!app && <div className="o-empty">This candidate has no application yet.</div>}

        {app && (
          <>
            <div className="ptabs2" style={{ marginBottom:16 }}>
              {TABS.map(t => (
                <button key={t} className={'ptab2' + (tab === t ? ' on' : '')} onClick={()=>setTab(t)}>
                  {t}
                  {t === 'Documents' && docs.length > 0 && <span className="tc-badge">{docs.length}</span>}
                  {t === 'Interviews' && interviews.length > 0 && <span className="tc-badge">{interviews.length}</span>}
                  {t === 'References' && refs.length > 0 && <span className="tc-badge">{refs.length}</span>}
                </button>
              ))}
            </div>

            {/* ── Profile ─────────────────────────────────────────────── */}
            {tab === 'Profile' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                <div className="tc-specs">
                  <Spec l="Phone" v={cand.phone} />
                  <Spec l="Email" v={cand.email} />
                  <Spec l="Location" v={cand.location} />
                  <Spec l="Current employer" v={cand.current_employer} />
                  <Spec l="Current designation" v={cand.current_designation} />
                  <Spec l="Experience" v={cand.total_experience_years != null ? `${cand.total_experience_years} yrs` : null} />
                  <Spec l="Current CTC" v={cand.current_ctc != null ? inr(cand.current_ctc) : null} />
                  <Spec l="Expected CTC" v={cand.expected_ctc != null ? inr(cand.expected_ctc) : null} />
                  <Spec l="Notice period" v={cand.notice_period_days != null ? `${cand.notice_period_days} days` : null} />
                  <Spec l="Source" v={cand.source} />
                  <Spec l="Source detail" v={cand.source_detail} />
                  <Spec l="Applied on" v={fmtDate(app.applied_on)} />
                </div>
                {cand.notes && <div className="tc-notes"><div className="pmc-l">Notes</div>{cand.notes}</div>}
                {app.rejected_reason && <div className="tc-notes warn"><div className="pmc-l">Rejected because</div>{app.rejected_reason}</div>}
                {app.dropout_reason && <div className="tc-notes warn"><div className="pmc-l">Dropped out because</div>{app.dropout_reason}</div>}
              </div>
            )}

            {/* ── Documents ───────────────────────────────────────────── */}
            {tab === 'Documents' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                <div className="tc-upload">
                  <select className="ph-picker" value={docType} onChange={e=>setDocType(e.target.value)}>
                    {CANDIDATE_DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <input ref={fileRef} type="file" onChange={e=>upload(e.target.files?.[0])} disabled={uploading}
                    accept={ACCEPT_ATTR} />
                  {uploading && <span className="tc-uploading">Uploading…</span>}
                </div>
                <div className="tc-hint">
                  PDF, Word or image · up to {MAX_DOC_MB} MB.
                  Stored privately — links are signed on demand and expire, because CVs and ID proofs are personal data.
                </div>
                {docs.length === 0 && <div className="o-empty">No documents yet.</div>}
                {docs.map(d => (
                  <div className="tc-doc" key={d.id}>
                    <div>
                      <div className="tc-doc-t">{docLabel(d.doc_type)}</div>
                      <div className="tc-doc-s">{d.file_name} · {fmtDate(d.created_at)}</div>
                    </div>
                    <button className="btn-ghost o-btn-sm" onClick={()=>viewDoc(d)}>Open</button>
                  </div>
                ))}
              </div>
            )}

            {/* ── Interviews ──────────────────────────────────────────── */}
            {tab === 'Interviews' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                <div className="tc-sec-head">
                  <div className="card-title">Rounds &amp; scorecards</div>
                  <button className="btn-primary o-btn-sm" onClick={()=>setIvForm({
                    round_no: String(interviews.length + 1), round_type:'screening',
                    scheduled_at:'', outcome:'pending', overall_rating:'', notes:'',
                  })}>Add round</button>
                </div>
                {interviews.length === 0 && <div className="o-empty">No interviews recorded.</div>}
                {interviews.map(iv => (
                  <div className="tc-iv" key={iv.id}>
                    <div className="tc-iv-h">
                      <span className="tc-iv-r mono">R{iv.round_no}</span>
                      <span className="tc-iv-t">{ROUND_TYPES.find(x => x[0] === iv.round_type)?.[1] || iv.round_type}</span>
                      <span className="meta-pill" style={{ color: OUTCOME_COLOR[iv.outcome], background:`color-mix(in srgb, ${OUTCOME_COLOR[iv.outcome]} 12%, transparent)` }}>
                        {OUTCOMES.find(x => x[0] === iv.outcome)?.[1] || iv.outcome}
                      </span>
                      {iv.overall_rating != null && <span className="tc-stars">{'★'.repeat(iv.overall_rating)}{'☆'.repeat(5 - iv.overall_rating)}</span>}
                      <button className="btn-ghost o-btn-sm" style={{ marginLeft:'auto' }}
                        onClick={()=>setIvForm({ id: iv.id, round_no:String(iv.round_no), round_type:iv.round_type,
                          scheduled_at: iv.scheduled_at ? new Date(iv.scheduled_at).toISOString().slice(0,16) : '',
                          outcome: iv.outcome, overall_rating: iv.overall_rating != null ? String(iv.overall_rating) : '', notes: iv.notes || '' })}>Edit</button>
                    </div>
                    <div className="tc-iv-s">{iv.scheduled_at ? fmtDateTime(iv.scheduled_at) : 'Not scheduled'}</div>
                    {iv.notes && <div className="tc-iv-n">{iv.notes}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* ── References ──────────────────────────────────────────── */}
            {tab === 'References' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                <div className="tc-sec-head">
                  <div className="card-title">Reference checks</div>
                  <button className="btn-primary o-btn-sm" onClick={()=>setRefForm({
                    referee_name:'', referee_company:'', referee_designation:'', referee_phone:'',
                    relationship:'', verdict:'pending', notes:'',
                  })}>Add reference</button>
                </div>
                {refs.length === 0 && <div className="o-empty">No references taken yet.</div>}
                {refs.map(r => (
                  <div className="tc-ref" key={r.id}>
                    <div className="tc-iv-h">
                      <span className="tc-iv-t">{r.referee_name}</span>
                      <span className="meta-pill" style={{ color: VERDICT_COLOR[r.verdict], background:`color-mix(in srgb, ${VERDICT_COLOR[r.verdict]} 12%, transparent)` }}>
                        {VERDICT_LABEL[r.verdict] || r.verdict}
                      </span>
                      <button className="btn-ghost o-btn-sm" style={{ marginLeft:'auto' }}
                        onClick={()=>setRefForm({ id:r.id, referee_name:r.referee_name||'', referee_company:r.referee_company||'',
                          referee_designation:r.referee_designation||'', referee_phone:r.referee_phone||'',
                          relationship:r.relationship||'', verdict:r.verdict, notes:r.notes||'' })}>Edit</button>
                    </div>
                    <div className="tc-iv-s">
                      {[r.referee_designation, r.referee_company].filter(Boolean).join(', ') || '—'}
                      {r.relationship ? ` · ${r.relationship}` : ''}
                      {r.referee_phone ? ` · ${r.referee_phone}` : ''}
                    </div>
                    {r.notes && <div className="tc-iv-n">{r.notes}</div>}
                    {r.checked_at && <div className="tc-doc-s">Checked {fmtDate(r.checked_at)}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* ── Offer ───────────────────────────────────────────────── */}
            {tab === 'Offer' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                {!offer && (
                  <>
                    <div className="tc-sec-head">
                      <div className="card-title">No offer yet</div>
                      <button className="btn-primary o-btn-sm" onClick={openOfferDrawer}>Raise offer</button>
                    </div>
                    <div className="tc-hint">The offer number is allocated from the OFR counter when you save — never reused, never MAX+1.</div>
                  </>
                )}

                {offer && (
                  <>
                    <div className="tc-sec-head">
                      <div>
                        <div className="card-eyebrow mono">{offer.offer_no}{currentVersion?.version > 1 ? ` · Rev ${currentVersion.version}` : ''}</div>
                        <div className="card-title">{offer.designation}</div>
                      </div>
                      <span className="meta-pill" style={{ color: OFFER_COLOR[effStatus], background:`color-mix(in srgb, ${OFFER_COLOR[effStatus]} 12%, transparent)` }}>
                        {effStatus}
                      </span>
                    </div>

                    {effStatus === 'lapsed' && (
                      <div className="tc-notes warn">
                        This offer passed its validity date of {fmtDate(offer.valid_till)} and can no longer be accepted.
                        Revise it to put a fresh number in front of the candidate.
                      </div>
                    )}
                    {offer.status === 'sent' && lapseIn != null && lapseIn >= 0 && lapseIn <= 3 && (
                      <div className="tc-notes warn">Lapses in {lapseIn === 0 ? 'less than a day' : `${lapseIn} day${lapseIn === 1 ? '' : 's'}`} — worth a call.</div>
                    )}

                    <div className="tc-specs">
                      {offer.employment_type === 'intern' ? (
                        <>
                          <Spec l="Monthly stipend" v={inr(currentVersion?.stipend_monthly)} />
                          <Spec l="Duration" v={offer.internship_months ? `${offer.internship_months} months` : null} />
                          <Spec l="Total for the term" v={inr((Number(currentVersion?.stipend_monthly) || 0) * (offer.internship_months || 0))} />
                        </>
                      ) : (
                        <>
                          <Spec l="Annual CTC" v={inr(currentVersion?.annual_ctc)} />
                          <Spec l="Monthly gross" v={inr(currentVersion?.breakup?.gross)} />
                          <Spec l="Net in hand" v={inr(currentVersion?.breakup?.netPayable)} />
                        </>
                      )}
                      <Spec l="Engagement" v={EMP_LABEL[offer.employment_type] || 'Full time'} />
                      <Spec l="Joining" v={fmtDate(offer.proposed_join_date)} />
                      <Spec l="Valid till" v={fmtDate(offer.valid_till)} />
                    </div>

                    <div className="tc-offer-acts">
                      <button className="btn-ghost o-btn-sm" onClick={()=>printLetter(currentVersion)}>View letter</button>
                      {['draft','sent'].includes(offer.status) && (
                        <button className="btn-ghost o-btn-sm" onClick={()=>setReviseForm({
                          reason:'',
                          stipend_monthly: String(currentVersion?.stipend_monthly || ''),
                          sal: { ctc: String(currentVersion?.annual_ctc || ''), ratio: currentVersion?.salary_ratio || '50 / 20 / 10 / 20',
                                 regime: currentVersion?.tax_regime || 'new', pf: !!currentVersion?.pf_applicable,
                                 pt: String(currentVersion?.professional_tax ?? '200'), acc: String(currentVersion?.accidental_insurance ?? '128') },
                        })}>Revise</button>
                      )}
                      {offer.status === 'draft' && <button className="btn-primary o-btn-sm" onClick={()=>setOfferStatus('sent')}>Mark sent</button>}
                      {canAcceptOffer(offer) && <button className="btn-primary o-btn-sm" onClick={()=>setOfferStatus('accepted')}>Accepted</button>}
                      {offer.status === 'sent' && (
                        <button className="btn-ghost o-btn-sm" onClick={()=>{
                          const why = window.prompt('Why did they decline?') || ''
                          if (why.trim()) setOfferStatus('declined', why.trim())
                        }}>Declined</button>
                      )}
                      {offer.status === 'accepted' && !offer.converted_employee_id && (
                        <button className="btn-primary o-btn-sm" onClick={openJoin}>Mark joined →</button>
                      )}
                      {offer.converted_employee_id && (
                        <button className="btn-ghost o-btn-sm" onClick={()=>navigate(`/people/team/${offer.converted_employee_id}`)}>Open People 360 →</button>
                      )}
                    </div>

                    {versions.length > 1 && (
                      <>
                        <div className="pmc-l" style={{ marginTop:18, marginBottom:6 }}>Version history</div>
                        {versions.map(v => (
                          <div className={'tc-ver' + (v.is_current ? ' on' : '')} key={v.id}>
                            <span className="mono">Rev {v.version}</span>
                            <span className="mono">{inr(v.annual_ctc)}</span>
                            <span>{v.revision_reason || (v.version === 1 ? 'Original offer' : '—')}</span>
                            <span className="tc-doc-s">{fmtDate(v.created_at)}{v.is_current ? ' · current' : ' · superseded'}</span>
                            <button className="btn-ghost o-btn-sm" onClick={()=>printLetter(v)}>Letter</button>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Activity ────────────────────────────────────────────── */}
            {tab === 'Activity' && (
              <div className="card" style={{ padding:'18px 20px' }}>
                <div className="od-comment-box" style={{ marginBottom:14 }}>
                  <textarea rows="2" placeholder="Add a note…" value={comment} onChange={e=>setComment(e.target.value)}
                    onKeyDown={e=>{ if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addComment() } }} />
                  <button className="btn-primary o-btn-sm" onClick={addComment} disabled={!comment.trim()}>Post</button>
                </div>
                {comments.length === 0 && <div className="o-empty">Nothing yet.</div>}
                {comments.map(c => (
                  <div className="od-tl-item" key={c.id}>
                    <span className={'od-tl-dot ' + (c.is_activity ? 'system' : 'comment')} />
                    <div className="od-tl-content">
                      <div className="od-tl-header">
                        <span className="od-tl-title">{c.message}</span>
                        <span className="od-tl-time">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <div className="od-tl-sub">{c.author_name || 'System'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── drawers ─────────────────────────────────────────────────── */}
      {moveTo && (
        <Drawer title={`Move to ${stageLabel(moveTo)}`}
          sub={needsReason(moveTo) ? 'A reason is required and is kept on the record.' : 'This is logged on the timeline.'}
          onClose={()=>setMoveTo(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setMoveTo(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doMove}>Move</button>
          </>}>
          <div className="pd-f"><label>{needsReason(moveTo) ? 'Reason *' : 'Note'}</label>
            <textarea rows="3" value={moveWhy} onChange={e=>setMoveWhy(e.target.value)} autoFocus
              placeholder={moveTo === 'rejected' ? 'Not enough field-sales experience…' : moveTo === 'dropped_out' ? 'Took a counter-offer…' : 'Optional'} /></div>
        </Drawer>
      )}

      {ivForm && (
        <Drawer title={ivForm.id ? 'Edit round' : 'Add interview round'} onClose={()=>setIvForm(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setIvForm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveInterview}>Save round</button>
          </>}>
          <div className="pd-2">
            <div className="pd-f"><label>Round no.</label><input type="number" min="1" value={ivForm.round_no} onChange={e=>setIvForm(f=>({...f,round_no:e.target.value}))} /></div>
            <div className="pd-f"><label>Type</label>
              <select value={ivForm.round_type} onChange={e=>setIvForm(f=>({...f,round_type:e.target.value}))}>
                {ROUND_TYPES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
          </div>
          <div className="pd-f"><label>Scheduled for</label>
            <input type="datetime-local" value={ivForm.scheduled_at} onChange={e=>setIvForm(f=>({...f,scheduled_at:e.target.value}))} /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Outcome</label>
              <select value={ivForm.outcome} onChange={e=>setIvForm(f=>({...f,outcome:e.target.value}))}>
                {OUTCOMES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div className="pd-f"><label>Overall rating</label>
              <select value={ivForm.overall_rating} onChange={e=>setIvForm(f=>({...f,overall_rating:e.target.value}))}>
                <option value="">Not rated</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} / 5</option>)}
              </select></div>
          </div>
          <div className="pd-f"><label>Feedback</label>
            <textarea rows="4" value={ivForm.notes} onChange={e=>setIvForm(f=>({...f,notes:e.target.value}))}
              placeholder="Strengths, gaps, whether you would hire — write it now, not in three months." /></div>
        </Drawer>
      )}

      {refForm && (
        <Drawer title={refForm.id ? 'Edit reference' : 'Add reference check'}
          sub="Who you called, and what they actually said." onClose={()=>setRefForm(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setRefForm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveRef}>Save reference</button>
          </>}>
          <div className="pd-f"><label>Referee name *</label><input value={refForm.referee_name} onChange={e=>setRefForm(f=>({...f,referee_name:e.target.value}))} autoFocus /></div>
          <div className="pd-2">
            <div className="pd-f"><label>Company</label><input value={refForm.referee_company} onChange={e=>setRefForm(f=>({...f,referee_company:e.target.value}))} /></div>
            <div className="pd-f"><label>Designation</label><input value={refForm.referee_designation} onChange={e=>setRefForm(f=>({...f,referee_designation:e.target.value}))} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Phone</label><input value={refForm.referee_phone} onChange={e=>setRefForm(f=>({...f,referee_phone:e.target.value}))} /></div>
            <div className="pd-f"><label>Relationship</label><input value={refForm.relationship} onChange={e=>setRefForm(f=>({...f,relationship:e.target.value}))} placeholder="Reporting manager" /></div>
          </div>
          <div className="pd-f"><label>Verdict</label>
            <select value={refForm.verdict} onChange={e=>setRefForm(f=>({...f,verdict:e.target.value}))}>
              {VERDICTS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
          <div className="pd-f"><label>What they said</label>
            <textarea rows="4" value={refForm.notes} onChange={e=>setRefForm(f=>({...f,notes:e.target.value}))} /></div>
        </Drawer>
      )}

      {offerForm && (
        <Drawer wide title="Raise offer" sub="The breakup you settle on here is what the letter prints and what payroll pays."
          onClose={()=>setOfferForm(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setOfferForm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveOffer}>Create offer</button>
          </>}>
          <div className="pd-2">
            <div className="pd-f"><label>Designation *</label><input value={offerForm.designation} onChange={e=>setOfferForm(f=>({...f,designation:e.target.value}))} /></div>
            <div className="pd-f"><label>Department</label>
              <input list="talent-depts" value={offerForm.department} onChange={e=>setOfferForm(f=>({...f,department:e.target.value}))} />
              <datalist id="talent-depts">{org.departments.map(x => <option key={x} value={x} />)}</datalist>
            </div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Branch — which office</label>
              <input list="talent-branches" value={offerForm.branch} onChange={e=>setOfferForm(f=>({...f,branch:e.target.value}))} placeholder="Ahmedabad / Vadodara" />
              <datalist id="talent-branches">{org.branches.map(x => <option key={x} value={x} />)}</datalist>
            </div>
            <div className="pd-f"><label>Proposed joining date</label>
              <input type="date" value={offerForm.proposed_join_date} min={todayYmd()} onChange={e=>setOfferForm(f=>({...f,proposed_join_date:e.target.value}))} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Offer valid till</label>
              <input type="date" value={offerForm.valid_till} min={todayYmd()} onChange={e=>setOfferForm(f=>({...f,valid_till:e.target.value}))} /></div>
            <div className="pd-f"><label>Reporting address</label>
              <input value={offerForm.reporting_address} onChange={e=>setOfferForm(f=>({...f,reporting_address:e.target.value}))} placeholder="Leave blank for the Baroda office" /></div>
          </div>
          <div className="pd-f"><label>Engagement type</label>
            <select value={offerForm.employment_type} onChange={e=>setOfferForm(f=>({...f,employment_type:e.target.value}))}>
              {EMPLOYMENT.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>

          {offerForm.employment_type === 'intern' ? (
            <>
              <div className="pd-2">
                <div className="pd-f"><label>Monthly stipend *</label>
                  <input type="number" min="0" value={offerForm.stipend_monthly}
                    onChange={e=>setOfferForm(f=>({...f,stipend_monthly:e.target.value}))} placeholder="12000" /></div>
                <div className="pd-f"><label>Duration (months) *</label>
                  <input type="number" min="1" value={offerForm.internship_months}
                    onChange={e=>setOfferForm(f=>({...f,internship_months:e.target.value}))} /></div>
              </div>
              <div className="tc-hint">
                Total for the term: <b>{inr((Number(offerForm.stipend_monthly) || 0) * (parseInt(offerForm.internship_months, 10) || 0))}</b>.
                An internship carries no PF, gratuity or bonus, so the letter prints stipend details
                instead of Annexure A and drops the probation and appointment-letter clauses.
              </div>
            </>
          ) : (
            <div className="pd-f"><label>Compensation</label>
              <SalaryStructurePanel compact value={offerForm.sal} onChange={sal=>setOfferForm(f=>({...f,sal}))} /></div>
          )}
        </Drawer>
      )}

      {reviseForm && (
        <Drawer wide title={`Revise ${offer?.offer_no}`}
          sub="Same offer number, new revision. The previous version is superseded."
          onClose={()=>setReviseForm(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setReviseForm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveRevision}>Save revision</button>
          </>}>
          <div className="pd-f"><label>What changed? *</label>
            <input value={reviseForm.reason} onChange={e=>setReviseForm(f=>({...f,reason:e.target.value}))}
              placeholder="Matched their counter-offer" autoFocus /></div>
          {offer?.employment_type === 'intern' ? (
            <div className="pd-f"><label>Revised monthly stipend *</label>
              <input type="number" min="0" value={reviseForm.stipend_monthly}
                onChange={e=>setReviseForm(f=>({...f,stipend_monthly:e.target.value}))} /></div>
          ) : (
            <div className="pd-f"><label>Revised compensation</label>
              <SalaryStructurePanel compact value={reviseForm.sal} onChange={sal=>setReviseForm(f=>({...f,sal}))} /></div>
          )}
        </Drawer>
      )}

      {joinForm && (
        <Drawer wide title="Mark joined" sub="Creates the employee record, salary structure and login — prefilled from the offer."
          onClose={()=>setJoinForm(null)}
          footer={<>
            <button className="btn btn-neutral" onClick={()=>setJoinForm(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doJoin}>Create employee</button>
          </>}>
          <div className="tc-hint">This runs exactly the same steps as Add Member on the Team page — nothing here is a second copy.</div>
          <div className="pd-2">
            <div className="pd-f"><label>Full name *</label><input value={joinForm.full_name} onChange={e=>setJoinForm(f=>({...f,full_name:e.target.value}))} /></div>
            <div className="pd-f"><label>Employee code</label><input value={joinForm.employee_code} onChange={e=>setJoinForm(f=>({...f,employee_code:e.target.value}))} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Designation</label><input value={joinForm.designation} onChange={e=>setJoinForm(f=>({...f,designation:e.target.value}))} /></div>
            <div className="pd-f"><label>Department</label>
              <input list="talent-depts" value={joinForm.department} onChange={e=>setJoinForm(f=>({...f,department:e.target.value}))} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Branch — which office</label>
              <input list="talent-branches" value={joinForm.branch} onChange={e=>setJoinForm(f=>({...f,branch:e.target.value}))} /></div>
            <div className="pd-f"><label>Join date</label><input type="date" value={joinForm.join_date} max={today()} onChange={e=>setJoinForm(f=>({...f,join_date:e.target.value}))} /></div>
          </div>
          <div className="pd-2">
            <div className="pd-f"><label>Personal phone</label><input value={joinForm.personal_phone} onChange={e=>setJoinForm(f=>({...f,personal_phone:e.target.value}))} /></div>
            <div className="pd-f"><label>Personal email</label><input value={joinForm.personal_email} onChange={e=>setJoinForm(f=>({...f,personal_email:e.target.value}))} /></div>
          </div>
          <div className="pd-f"><label>Annual CTC (from the accepted offer)</label>
            <input type="number" value={joinForm.annual_ctc} onChange={e=>setJoinForm(f=>({...f,annual_ctc:e.target.value}))} />
            <div className="pd-hint">Changing this here means the employee is paid something other than what they accepted.</div></div>
          <div className="pd-f">
            <label style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="checkbox" checked={joinForm.create_login} onChange={e=>setJoinForm(f=>({...f,create_login:e.target.checked}))} />
              Create an app login
            </label>
          </div>
          {joinForm.create_login && (
            <>
              <div className="pd-2">
                <div className="pd-f"><label>Username</label><input value={joinForm.username} onChange={e=>setJoinForm(f=>({...f,username:e.target.value}))} /></div>
                <div className="pd-f"><label>Temp password</label><input value={joinForm.password} onChange={e=>setJoinForm(f=>({...f,password:e.target.value}))} /></div>
              </div>
              <div className="pd-2">
                <div className="pd-f"><label>Role</label>
                  <select value={joinForm.login_role} onChange={e=>setJoinForm(f=>({...f,login_role:e.target.value}))}>
                    {[['sales','Sales'],['accounts','Accounts'],['management','Management'],['ops','Operations'],['fc_kaveri','FC Kaveri'],['fc_godawari','FC Godawari']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select></div>
                {joinForm.login_role === 'sales' && (
                  <div className="pd-f"><label>KPI team *</label>
                    <select value={joinForm.team_id} onChange={e=>setJoinForm(f=>({...f,team_id:e.target.value}))}>
                      <option value="">Pick a team…</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select></div>
                )}
              </div>
            </>
          )}
        </Drawer>
      )}

      {creds && (
        <Drawer title="Login created" sub="Share these once — the password is not shown again."
          onClose={()=>setCreds(null)}
          footer={<button className="btn btn-primary" onClick={()=>setCreds(null)}>Done</button>}>
          <div className="tc-specs">
            <Spec l="Username" v={creds.username} />
            <Spec l="Temp password" v={creds.password} />
          </div>
        </Drawer>
      )}

      <style>{`
        .tc-av { width:30px; height:30px; border-radius:50%; color:#fff; font-size:12px; font-weight:600;
                 display:inline-flex; align-items:center; justify-content:center; flex:0 0 auto; }
        .tc-apps { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
        .tc-app { border:1px solid var(--line-2); background:var(--surface); border-radius:999px; padding:5px 12px;
                  font:inherit; font-size:12px; color:var(--muted); cursor:pointer; }
        .tc-app.on { border-color:var(--accent); color:var(--accent); font-weight:600; }
        .tc-badge { margin-left:6px; font-size:10px; background:var(--line-2); color:var(--muted); padding:1px 6px; border-radius:8px; }
        .tc-specs { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px 18px; }
        .tc-spec-l { font-size:10.5px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; color:var(--muted); margin-bottom:3px; }
        .tc-spec-v { font-size:13px; color:var(--ink); }
        .tc-notes { margin-top:16px; font-size:12.5px; color:var(--ink); line-height:1.6; padding:10px 12px;
                    background:var(--bg); border-radius:10px; }
        .tc-notes.warn { background:color-mix(in srgb,#b45309 8%,transparent); }
        .tc-hint { font-size:11.5px; color:var(--muted-2); margin:8px 0 12px; line-height:1.6; }
        .tc-uploading { font-size:11.5px; font-weight:600; color:var(--o-accent,#1a73e8); }
        .tc-sec-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:12px; }
        .tc-upload { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
        /* A bare <input type=file> renders the OS "Choose File" chrome, which
           looks nothing like the rest of the app. ::file-selector-button is the
           only way to restyle it without replacing the control entirely. */
        .orders-app .tc-upload input[type=file] { font:inherit; font-size:12.5px; color:var(--o-muted); max-width:100%; }
        .orders-app .tc-upload input[type=file]::file-selector-button {
          font:inherit; font-size:12px; font-weight:500; padding:6px 12px; margin-right:10px;
          border:1px solid var(--o-line); border-radius:8px; background:var(--o-surface);
          color:var(--o-ink); cursor:pointer; transition:background .12s, border-color .12s;
        }
        .orders-app .tc-upload input[type=file]::file-selector-button:hover {
          background:var(--o-bg-2); border-color:var(--o-accent,#1a73e8);
        }
        .orders-app .tc-upload input[type=file]:disabled::file-selector-button { opacity:.55; cursor:default; }
        .tc-doc { display:flex; justify-content:space-between; align-items:center; gap:12px;
                  padding:10px 0; border-bottom:1px solid var(--line-2); }
        .tc-doc-t { font-size:12.5px; font-weight:600; color:var(--ink); }
        .tc-doc-s { font-size:11px; color:var(--muted-2); }
        .tc-iv, .tc-ref { padding:12px 0; border-bottom:1px solid var(--line-2); }
        .tc-iv-h { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
        .tc-iv-r { font-size:11px; font-weight:600; color:var(--muted); background:var(--bg); padding:2px 7px; border-radius:6px; }
        .tc-iv-t { font-size:13px; font-weight:600; color:var(--ink); }
        .tc-iv-s { font-size:11.5px; color:var(--muted); margin-top:4px; }
        .tc-iv-n { font-size:12.5px; color:var(--ink); margin-top:6px; line-height:1.6; white-space:pre-wrap; }
        .tc-stars { font-size:12px; color:#b45309; letter-spacing:1px; }
        .orders-app .o-btn-sm { padding:5px 10px; font-size:12px; }
        .tc-offer-acts { display:flex; gap:7px; flex-wrap:wrap; margin-top:16px; }
        .tc-ver { display:grid; grid-template-columns:70px 110px 1fr auto auto; gap:10px; align-items:center;
                  padding:8px 0; border-bottom:1px solid var(--line-2); font-size:12px; }
        .tc-ver.on { font-weight:600; }
        @media (max-width:820px){
          .tc-ver { grid-template-columns:1fr 1fr; row-gap:4px; }
        }
      `}</style>
    </Layout>
  )
}
