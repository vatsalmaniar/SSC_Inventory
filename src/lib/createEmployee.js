// ═══════════════════════════════════════════════════════════════════
// THE employee-creation sequence — single source of truth.
//
// Onboarding a person is five writes that must happen in this order:
//   1. employees                  — the base record
//   2. employee_private           — statutory & personal (mgmt only)
//   3. employee_compensation      — the computed salary breakup (mgmt only)
//   4. rpc admin_create_login     — the app login, links employees.profile_id
//   5. rpc assign_kpi_target      — sales only; multiplier resolved server-side
//
// This lived inside PeopleTeam.jsx's addMember(). Talent 360 needs the exact
// same sequence when an accepted candidate joins, and a second copy would
// drift — which is precisely how the CRM "convert to order" payload drifted
// from New Order. One function, two callers.
//
// ⚠️ NOT a transaction. These are five separate calls over PostgREST, so a
// failure at step 3 leaves the employee from step 1 in place. That is the
// pre-existing behaviour and is deliberately unchanged here: the half-made
// record is visible in the Team list and can be completed or removed by hand,
// which is better than silently discarding a record someone just typed. The
// error is surfaced to the caller either way.
// ═══════════════════════════════════════════════════════════════════

import { sb } from './supabase'
import { computeStructure } from './salaryStructure'
import { FY_LABEL } from './fmt'

export const FY = FY_LABEL.replace(/^FY\s*/, '')   // 'FY 26-27' → '26-27'

// Local date, NOT toISOString().slice(0,10) — that yields UTC, so between 00:00
// and 05:30 IST it returns yesterday and back-dates the salary effective_from.
export const today = () => new Date().toLocaleDateString('en-CA')

// Money must reach the DB at paise precision; computeStructure works in JS floats.
export const round2 = n => Math.round((Number(n) || 0) * 100) / 100

// Statutory IDs: blank and placeholder text ("NA", "-", "N/A") must land as NULL,
// never as a literal value — a stored 'NA' collides across employees and breaks
// PF/ESI filing.
export const statutory = (v, upper = false) => {
  const s = String(v ?? '').trim()
  if (!s || /^(na|n\/a|nil|none|-+)$/i.test(s)) return null
  return upper ? s.toUpperCase() : s
}

export const autoUsername = (name = '') => {
  const p = name.trim().toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean)
  return p.length === 0 ? '' : p.length === 1 ? p[0] : `${p[0]}.${p[p.length - 1]}`
}

export const genPassword = () => 'Ssc@' + Math.floor(1000 + Math.random() * 9000)

// The shape createEmployee() expects. Lives here rather than in the page so
// Talent 360 can prefill it from an accepted offer and hand back the same
// object — one form contract, two entry points.
export const EMPTY_EMPLOYEE_FORM = {
  // basic (employees)
  full_name:'', employee_code:'', department:'', designation:'', branch:'', join_date:'',
  reporting_manager_id:'', lifecycle_status:'probation', tax_regime:'new',
  // statutory & personal (employee_private)
  gender:'', marital_status:'', date_of_birth:'', personal_phone:'', personal_email:'',
  emergency_contact:'', pan:'', aadhaar:'', uan_no:'', esic_no:'',
  spouse_name:'', spouse_phone:'', spouse_dob:'', is_permanent:true,
  // salary (employee_compensation)
  annual_ctc:'', salary_ratio:'50 / 20 / 10 / 20', pf_applicable:false, professional_tax:'200', accidental_insurance:'128',
  // login
  create_login:false, username:'', login_role:'sales', password:'', team_id:'',
}

// Returns an error message, or null when the form is good to submit.
export function validateEmployeeForm(f) {
  if (!f.full_name.trim()) return 'Full name is required.'
  if (f.create_login) {
    if (!f.username.trim()) return 'Username is required for the login.'
    if ((f.password || '').length < 6) return 'Temp password must be at least 6 characters.'
    if (f.login_role === 'sales' && !f.team_id) return 'Pick a team for the sales login (target auto-assigns).'
  }
  return null
}

// The salary breakup shown in a live preview and the one written to
// employee_compensation must come from the same call, or the number on screen
// is not the number stored.
export function structureFor(f) {
  const ctc = parseFloat(f.annual_ctc) || 0
  if (!ctc) return null
  return computeStructure({
    annualCtc: ctc,
    ratio: f.salary_ratio,
    regime: f.tax_regime,
    pfApplicable: f.pf_applicable,
    professionalTax: parseFloat(f.professional_tax) || 0,
    accidentalInsurance: parseFloat(f.accidental_insurance) || 0,
  })
}

/**
 * Runs the five-step onboarding sequence.
 *
 * @param {object}  form      the add-member form (see EMPTY_FORM in PeopleTeam)
 * @param {boolean} isMgmt    caller is admin/management — gates private + salary
 * @param {boolean} testMode  stamps is_test on the employee row
 * @returns {{ employeeId: string, credentials: {username, password}|null }}
 * @throws  the underlying Supabase error, for the caller to surface
 */
export async function createEmployee({ form: f, isMgmt, testMode = false }) {
  // 1) base employee record
  const { data: emp, error } = await sb.from('employees').insert({
    full_name: f.full_name.trim(),
    employee_code: f.employee_code.trim() || null,
    department: f.department.trim() || null,
    designation: f.designation.trim() || null,
    branch: f.branch.trim() || null,
    join_date: f.join_date || null,
    reporting_manager_id: f.reporting_manager_id || null,
    lifecycle_status: f.lifecycle_status,
    is_active: f.lifecycle_status !== 'exited',
    tax_regime: f.tax_regime,
    is_test: testMode,
  }).select('id').single()
  if (error) throw error
  const empId = emp.id

  // 2) statutory & personal (mgmt) — only if something was entered
  if (isMgmt) {
    const hasPriv = [f.gender, f.marital_status, f.date_of_birth, f.personal_phone, f.personal_email,
      f.emergency_contact, f.pan, f.aadhaar, f.uan_no, f.esic_no, f.spouse_name, f.spouse_phone, f.spouse_dob]
      .some(v => (v || '').trim && v.trim())
    if (hasPriv || f.is_permanent === false) {
      const { error: e2 } = await sb.from('employee_private').upsert({
        employee_id: empId, gender: f.gender || null, marital_status: f.marital_status || null,
        date_of_birth: f.date_of_birth || null, personal_phone: f.personal_phone || null, personal_email: f.personal_email || null,
        emergency_contact: f.emergency_contact || null, pan: statutory(f.pan, true), aadhaar: statutory(f.aadhaar),
        uan_no: statutory(f.uan_no), esic_no: statutory(f.esic_no),
        spouse_name: f.spouse_name || null, spouse_phone: f.spouse_phone || null, spouse_dob: f.spouse_dob || null,
        is_permanent: f.is_permanent,
      }, { onConflict: 'employee_id' })
      if (e2) throw e2
    }
  }

  // 3) salary breakup (mgmt) — only if a CTC was entered
  const ctc = parseFloat(f.annual_ctc) || 0
  if (isMgmt && ctc > 0) {
    const s = structureFor(f)
    // Every money value is rounded to paise here: computeStructure works in JS floats and
    // its output has never been reconciled against the payroll sheet, so these rows are
    // tagged 'computed_unverified' — payroll must treat them as needing sign-off, unlike
    // the 'sheet_june_2026' rows which came from the real sheet.
    const { error: e3 } = await sb.from('employee_compensation').insert({
      employee_id: empId, fy_label: FY, annual_ctc_inr: round2(ctc), effective_from: f.join_date || today(),
      source: 'onboarding', revision_reason: 'Onboarding', is_current: true,
      monthly_ctc: round2(s.monthlyCtc), monthly_gross: round2(s.gross), basic: round2(s.basic), hra: round2(s.hra),
      travel_allowance: round2(s.travelAllowance), special_allowance: round2(s.specialAllowance), salary_ratio: f.salary_ratio,
      pf_employer: round2(s.employerPf), esic_employer: round2(s.employerEsic), pf_employee: round2(s.pfEmployee), esic_employee: round2(s.esicEmployee),
      professional_tax: round2(s.professionalTax), accidental_insurance: round2(s.accidentalInsurance),
      gratuity: round2(s.gratuity), bonus: round2(s.bonus), tds: round2(s.tds), total_deductions: round2(s.totalDeductions),
      net_payable: round2(s.netPayable), breakup_source: 'computed_unverified', updated_at: new Date().toISOString(),
    })
    if (e3) throw e3
  }

  // 4) app login (optional) — links employees.profile_id server-side
  let credentials = null
  if (f.create_login) {
    const uname = f.username.trim().toLowerCase()
    const { data: newUid, error: e4 } = await sb.rpc('admin_create_login', {
      p_employee_id: empId, p_username: uname, p_password: f.password, p_role: f.login_role, p_name: f.full_name.trim(),
    })
    if (e4) throw e4
    // 5) sales → KPI team + auto target (multiplier resolved server-side)
    if (f.login_role === 'sales' && f.team_id) {
      const { error: e5 } = await sb.rpc('assign_kpi_target', { p_profile_id: newUid, p_team_id: f.team_id, p_fy_label: FY, p_annual_ctc: ctc })
      if (e5) throw e5
    }
    credentials = { username: uname, password: f.password }
  }

  return { employeeId: empId, credentials }
}
