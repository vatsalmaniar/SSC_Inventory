// Regression test for the offer letter's Annexure A.
//
// The offer letter does NOT get its own salary maths. Annexure A is a direct
// render of computeStructure() — the same call that later writes
// employee_compensation when the candidate joins. If those two ever diverge,
// we hand someone a letter promising one number and pay them another.
//
// The fixture is a REAL letter that went out: Aayush Prajapati, 18 July 2026,
// SSC/HR/OFR/01/26-27. Every figure below was read off that PDF. If this test
// fails, either the formula changed or the letter template is wrong — do not
// "fix" it by editing the expected values without checking a real payslip.
//
// Run: node scripts/test-offer-annexure.mjs
import { computeStructure } from '../src/lib/salaryStructure.js'
import { buildOfferLetterHtml } from '../src/lib/offerLetterHtml.js'

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = got === want
  ok ? pass++ : fail++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(24)}${ok ? `${want}` : `got ${got}, want ${want}`}`)
}

// ── Fixture: Aayush Prajapati, Growth Sales Executive, Baroda ──────────────
// Derived from the letter: basic 15,300 of gross 30,600 = 50/20/10/20 ratio;
// employer PF 1,950 = 13% of the ₹15,000 ceiling, so PF applies; the letter's
// accidental insurance is 151 (the app's default of 128 is NOT universal).
const INPUT = {
  annualCtc: 390600,
  ratio: '50 / 20 / 10 / 20',
  regime: 'new',
  pfApplicable: true,
  professionalTax: 200,
  accidentalInsurance: 151,
}

// Annexure A, monthly column, exactly as printed.
const MONTHLY = {
  basic: 15300,
  hra: 6120,
  travelAllowance: 3060,
  specialAllowance: 6120,
  gross: 30600,               // GROSS SALARY - A
  pfEmployee: 1800,
  esicEmployee: 0,
  professionalTax: 200,
  accidentalInsurance: 151,
  gratuity: 736,
  bonus: 583,
  totalDeductions: 3470,      // DEDUCTION FROM SALARY - B
  netPayable: 27130,          // NET PAY IN HAND (A-B)
  employerPf: 1950,
  employerEsic: 0,
  monthlyCtc: 32550,          // TOTAL CTC - COST TO COMPANY
}

console.log('\nAnnexure A — Aayush Prajapati (SSC/HR/OFR/01/26-27)')
const s = computeStructure(INPUT)
for (const [k, want] of Object.entries(MONTHLY)) eq(k, Math.round(s[k]), want)

// The annual column is the monthly column x12 — printed, so it is checked.
console.log('\nannual column (monthly x 12)')
eq('basic annual',  Math.round(s.basic * 12),  183600)
eq('gross annual',  Math.round(s.gross * 12),  367200)
eq('net annual',    Math.round(s.netPayable * 12), 325560)
eq('ctc annual',    Math.round(s.monthlyCtc * 12), 390600)

// The letter's own internal arithmetic must hold, or the page will not foot.
console.log('\ninternal consistency')
eq('A = sum of components', Math.round(s.basic + s.hra + s.travelAllowance + s.specialAllowance), MONTHLY.gross)
eq('B = sum of deductions', Math.round(s.pfEmployee + s.esicEmployee + s.professionalTax + s.accidentalInsurance + s.gratuity + s.bonus + s.tds), MONTHLY.totalDeductions)
eq('A - B = net',           Math.round(s.gross - s.totalDeductions), MONTHLY.netPayable)
eq('CTC = gross + employer', Math.round(s.gross + s.employerPf + s.employerEsic), MONTHLY.monthlyCtc)

// ── The rendered letter ────────────────────────────────────────────────────
// The maths being right is not enough — the letter has to PRINT those figures.
// This renders the real template and looks for the exact strings that appear
// on the PDF, so a broken Annexure row or a lost thousands-separator fails
// here rather than in front of a candidate.
console.log('\nrendered letter')
const offer = {
  offer_no: 'SSC/HR/OFR/01/26-27',
  designation: 'Growth Sales Executive',
  branch: 'Baroda (Vadodara)',
  proposed_join_date: '2026-07-27',
  valid_till: '2026-07-25',
}
const candidate = { full_name: 'Aayush Prajapati', location: 'B501, Phoenix Resicom, Vaikunth Chokdi,\nWaghodia Road, Vadodara - 390019' }
const html = buildOfferLetterHtml(offer, { version: 1, breakup: s, annual_ctc: INPUT.annualCtc }, candidate,
  { letterDate: '2026-07-18' })

const has = (label, needle) => eq(label, html.includes(needle), true)
has('offer number',      'SSC/HR/OFR/01/26-27')
has('letter date',       '18th July 2026')
has('reporting date',    '27th July 2026')
has('designation',       'Growth Sales Executive')
has('candidate name',    'Aayush Prajapati')
has('probation clause',  'probation for a period of three months')
has('background check',  'background verification')
has('void ab initio',    'void ab initio')
has('signatory',         'Ankit Dave')
has('e-generated note',  'does not require a signature')
has('basic monthly',     '15,300')
has('basic annual',      '1,83,600')
has('gross A',           'GROSS SALARY - A')
has('net in hand',       '27,130')
has('total CTC monthly', '32,550')
has('total CTC annual',  '3,90,600')
has('validity printed',  '25th July 2026')
eq('all nine documents', (html.match(/<li>/g) || []).length, 9)

// Rev 1 must NOT be labelled; Rev 2 must be, or a candidate holding both
// cannot tell which one supersedes the other.
eq('v1 unlabelled', html.includes('Rev 1'), false)
const html2 = buildOfferLetterHtml(offer, { version: 2, breakup: s }, candidate, { letterDate: '2026-07-18' })
eq('v2 labelled', html2.includes('Rev 2'), true)

// ── The internship letter ──────────────────────────────────────────────────
// An internship is a fixed-term stipend, not a salary. The salaried letter
// would promise PF, gratuity, a probation period and an appointment letter —
// none of which an intern gets. These assertions exist so nobody "simplifies"
// the two templates back into one.
console.log('\ninternship letter')
const internOffer = {
  offer_no: 'SSC/HR/OFR/0002/26-27',
  designation: 'Sales Intern',
  branch: 'Baroda (Vadodara)',
  proposed_join_date: '2026-08-03',
  valid_till: '2026-07-30',
  employment_type: 'intern',
  internship_months: 6,
}
const internHtml = buildOfferLetterHtml(
  internOffer,
  { version: 1, stipend_monthly: 12000, breakup: {} },
  { full_name: 'Test Intern', location: 'Vadodara' },
  { letterDate: '2026-07-18' },
)
const ihas = (label, needle, want = true) => eq(label, internHtml.includes(needle), want)
ihas('internship title',   'INTERNSHIP OFFER LETTER')
ihas('stipend printed',    '12,000')
ihas('duration printed',   '6 months')
ihas('total for the term', '72,000')            // 12,000 x 6
ihas('stipend annexure',   'Stipend Details')
ihas('PF not applicable',  'PROVIDENT FUND')
// The things an intern must NOT be promised.
ihas('no salary annexure', 'Compensation Structure', false)
ihas('no probation',       'probation for a period of three months', false)
ihas('no appointment ltr', 'detailed appointment letter', false)
ihas('not employment',     'not an offer of employment')
ihas('no payslips asked',  "Last three month's pay slips", false)
ihas('college id asked',   'College / University ID card')

// And the salaried letter must not have picked up any intern wording.
eq('salaried letter unaffected', html.includes('INTERNSHIP') || html.includes('Stipend Details'), false)

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
