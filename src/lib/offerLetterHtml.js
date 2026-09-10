// Shared offer-letter template — print-ready standalone HTML.
//
// Reproduces the letter SSC already issues by hand (fixture:
// Aayush_Prajapati_Offer_Letter.pdf, SSC/HR/OFR/01/26-27). Wording, clause
// order and the Annexure A row order all come from that letter — a candidate
// who compares it against a colleague's should not see a different document.
//
// ⚠️ Annexure A has NO salary maths of its own. It renders the frozen
// `breakup` stored on the offer version, which is computeStructure()'s output
// — the same call that writes employee_compensation when they join. A second
// formula here is how a letter ends up promising one number and payroll
// paying another. scripts/test-offer-annexure.mjs guards this against the
// real letter.
//
// Letterhead matches src/lib/grnHtml.js so every SSC document looks alike.

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const origin = () => (typeof window !== 'undefined' ? window.location.origin : '')

// "18th July 2026" — the letters are written in long form, not 18/07/2026.
const ORD = n => (n % 10 === 1 && n !== 11) ? 'st' : (n % 10 === 2 && n !== 12) ? 'nd' : (n % 10 === 3 && n !== 13) ? 'rd' : 'th'
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export function longDate(d) {
  if (!d) return '—'
  // Split ymd by parts — new Date('2026-07-18') parses as UTC and renders the
  // previous day for any viewer west of IST.
  const [y, m, day] = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)
    ? d.slice(0, 10).split('-').map(Number)
    : (dt => [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()])(new Date(d))
  return `${day}${ORD(day)} ${MONTHS[m - 1]} ${y}`
}

const money = n => Math.round(Number(n) || 0).toLocaleString('en-IN')

// Annexure A, in the printed order. `key` reads the frozen breakup object.
// `rule` marks the two subtotal lines and the final CTC line.
const ANNEXURE_ROWS = [
  { label: 'BASIC & DA',            key: 'basic' },
  { label: 'HRA',                   key: 'hra' },
  { label: 'TRAVEL ALL',            key: 'travelAllowance' },
  { label: 'SPECIAL ALL',           key: 'specialAllowance' },
  { label: 'GROSS SALARY - A',      key: 'gross',              rule: true },
  { label: 'PF EMPLOYEE PART',      key: 'pfEmployee' },
  { label: 'ESIC EMPLOYEE PART',    key: 'esicEmployee' },
  { label: 'PROFESSIONAL TAX',      key: 'professionalTax' },
  { label: 'ACCIDENTAL INSURANCE',  key: 'accidentalInsurance' },
  { label: 'GRATUITY',              key: 'gratuity' },
  { label: 'BONUS',                 key: 'bonus' },
  { label: 'DEDUCTION FROM SALARY - B', key: 'totalDeductions', rule: true },
  { label: 'NET PAY IN HAND (A-B)', key: 'netPayable',         rule: true },
  { label: 'PF EMPLOYER PART',      key: 'employerPf' },
  { label: 'ESIC EMPLOYER PART',    key: 'employerEsic' },
]

// The nine documents the letter asks for, verbatim.
const DOCUMENTS = [
  'SSC and HSC Mark Sheets &amp; Certificates',
  'Graduation Marksheet of all semesters &amp; Graduation Certificate',
  'Post-Graduation Marksheet and Certificate (IF ANY)',
  'Previous company Experience and Relieving Letter',
  "Last three month's pay slips",
  'Aadhar Card',
  'Photo ID Proof - PAN Card / License / Passport (ANYONE)',
  'Address Proof - Telephone Bill / Electricity Bill / License / Passport (ANYONE)',
  'Latest Photograph (Passport Size)',
]

// An intern has no previous employer, so asking for a relieving letter and
// three months' payslips is asking for something they cannot produce. They do
// need proof they are actually enrolled somewhere.
const INTERN_DOCUMENTS = [
  'SSC and HSC Mark Sheets &amp; Certificates',
  'Latest Marksheet of the ongoing course',
  'College / University ID card',
  'Bonafide or No-Objection certificate from the institute (if the internship is for credit)',
  'Aadhar Card',
  'Photo ID Proof - PAN Card / License / Passport (ANYONE)',
  'Address Proof - Telephone Bill / Electricity Bill / License / Passport (ANYONE)',
  'Latest Photograph (Passport Size)',
]

const BARODA_OFFICE = '31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara, Gujarat - 390010'

/**
 * @param {object} offer    offers row — offer_no, designation, branch,
 *                          proposed_join_date, valid_till, reporting_address
 * @param {object} version  offer_versions row — version, breakup (frozen), annual_ctc
 * @param {object} candidate candidates row — full_name, location/address
 * @param {object} opts     { signatoryName, signatoryTitle, letterDate, reportingTime }
 */
export function buildOfferLetterHtml(offer, version, candidate, opts = {}) {
  const b = version?.breakup || {}
  const {
    signatoryName  = 'Ankit Dave',
    signatoryTitle = 'Head of Operations',
    letterDate     = new Date().toLocaleDateString('en-CA'),
    reportingTime  = '10:00 AM',
  } = opts

  // An internship is a fixed-term stipend, not a salary structure: no PF, no
  // gratuity, no Annexure A, and no probation clause (the whole thing is a
  // trial). Printing the salaried letter for an intern would promise benefits
  // that do not exist.
  const isIntern = offer?.employment_type === 'intern'
  const stipend = Number(version?.stipend_monthly) || 0
  const months = offer?.internship_months || null

  const first = (candidate?.full_name || '').trim().split(/\s+/)[0] || 'Candidate'
  const officeLine = offer?.branch ? `our ${esc(offer.branch)} Office` : 'our office'
  const reportAddr = offer?.reporting_address || BARODA_OFFICE
  // A revision is the same offer, so the number is unchanged and the revision
  // is called out instead — a candidate holding both must see which is newer.
  const revSuffix = (version?.version || 1) > 1 ? ` &middot; Rev ${version.version}` : ''

  const annexure = ANNEXURE_ROWS.map(r => {
    const m = Number(b[r.key]) || 0
    return `<tr class="${r.rule ? 'rule' : ''}">
      <td>${r.label}</td>
      <td class="r mono">${money(m)}</td>
      <td class="r mono">${money(m * 12)}</td>
    </tr>`
  }).join('')

  const employerAdd = (Number(b.employerPf) || 0) + (Number(b.employerEsic) || 0)
  const monthlyCtc  = (Number(b.gross) || 0) + employerAdd

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Offer Letter — ${esc(candidate?.full_name || '')}</title>
<link href="${origin()}/fonts/fonts.css" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#fff;padding:40px 48px;max-width:860px;margin:0 auto;line-height:1.6}
  .mono{font-family:'Geist Mono',monospace}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}
  .co-name{font-size:17px;font-weight:600;color:#0f172a;margin-bottom:2px}
  .co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
  .co-addr{font-size:10.5px;color:#475569;line-height:1.6}
  .divider{border:none;border-top:1px solid #e2e8f0;margin:18px 0}
  .meta{display:flex;justify-content:space-between;font-size:11px;color:#475569;margin-bottom:22px}
  .meta b{color:#0f172a;font-weight:600}
  .to{font-size:12px;margin-bottom:20px;line-height:1.7}
  .to .nm{font-size:13px;font-weight:600}
  .doc-title{text-align:center;font-size:15px;font-weight:600;letter-spacing:1.4px;margin:22px 0 20px;text-decoration:underline}
  p{margin-bottom:11px}
  .strong{font-weight:600}
  ol.docs{margin:6px 0 12px 20px} ol.docs li{margin-bottom:3px}
  .sig{margin-top:26px;font-size:12px;line-height:1.9}
  .sig .nm{font-weight:600}
  .note{margin-top:16px;font-size:10.5px;color:#64748b;font-style:italic}
  .annex-title{text-align:center;font-size:14px;font-weight:600;margin-bottom:4px;letter-spacing:0.6px}
  .annex-sub{text-align:center;font-size:11.5px;color:#475569;margin-bottom:14px}
  table.annex{width:100%;border-collapse:collapse}
  table.annex thead tr{border-bottom:2px solid #0f172a}
  table.annex th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
  table.annex th.r{text-align:right}
  table.annex td{padding:7px 10px;font-size:11.5px;border-bottom:1px solid #f1f5f9}
  table.annex td.r{text-align:right}
  table.annex tr.rule td{font-weight:600;background:#f8f9fa;border-bottom:1px solid #cbd5e1}
  table.annex tr.total td{font-weight:600;font-size:12.5px;border-top:2px solid #0f172a;border-bottom:none;background:#fff}
  .footer{margin-top:26px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
  .footer-left{font-size:10px;color:#94a3b8;line-height:1.6} .footer-right{font-size:10px;color:#94a3b8;text-align:right}
  .pgbreak{page-break-before:always}
  @media print{body{padding:0}}
</style></head><body>

<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE</div>
  </div>
  <div style="text-align:right">
    <img src="${origin()}/logo/ssc-60-years.png" alt="SSC 60 Years" style="height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px"/>
  </div>
</div>
<hr class="divider"/>

<div class="meta">
  <div>Date: <b>${esc(longDate(letterDate))}</b></div>
  <div>No: <b class="mono">${esc(offer?.offer_no || '—')}${revSuffix}</b></div>
</div>

<div class="to">
  <div class="nm">${esc(candidate?.full_name || '')}</div>
  ${candidate?.location ? esc(candidate.location).replace(/\n/g, '<br/>') : ''}
</div>

<div class="doc-title">${isIntern ? 'INTERNSHIP OFFER LETTER' : 'OFFER LETTER'}</div>

<p>Dear ${esc(first)},</p>

<p>This is with reference to your application and subsequent interviews you had with us. We are
pleased to offer you ${isIntern ? 'an internship as' : 'the position of'} "<span class="strong">${esc(offer?.designation || '')}</span>"
in our esteemed organization, based at ${officeLine}.</p>

${isIntern
  ? `<p>The internship is for a fixed term of <span class="strong">${months ? `${months} month${months === 1 ? '' : 's'}` : 'the agreed period'}</span>
from the date of joining, and carries a stipend of
<span class="strong">₹${money(stipend)} per month</span>.</p>

<p>This is a training engagement and not an offer of employment. It does not carry provident fund,
gratuity, bonus, leave encashment or any other employment benefit, and it does not by itself create
any entitlement to a permanent role at the end of the term. Any offer of employment afterwards would
be made separately and in writing.</p>`
  : `<p>Your gross emoluments per annum including all other benefits will be as mentioned in Annexure A.</p>`}

<p>You are requested to report on <span class="strong">${esc(longDate(offer?.proposed_join_date))} at ${esc(reportingTime)}</span>
at "${esc(reportAddr)}".</p>

<p>Your ${isIntern ? 'internship' : 'service'} will be subject to the rules and regulations of the organization as may be scheduled
from time to time.${isIntern ? '' : ' We would also like to inform you that your job can be transferred internally depending upon the discretion of the management.'}</p>

${isIntern
  ? `<p>You will be assigned a mentor, and your work will be reviewed by the department head through
the term. Either side may end the internship with one week's written notice.</p>`
  : `<p>You will be on <span class="strong">probation for a period of three months</span> from the date of
joining. During this period, your work will be evaluated and assessed by the department head. During
the probation period you are not entitled to receive petrol or a travel allowance.</p>

<p>Further, you shall get a detailed appointment letter upon joining, which will include all terms and
conditions of your employment.</p>`}

<p>In case you fail to report on this date unless otherwise agreed in writing or verbally, the offer
shall stand automatically withdrawn.</p>

${offer?.valid_till ? `<p>This offer is valid up to <span class="strong">${esc(longDate(offer.valid_till))}</span>.
If we do not hear from you by this date, the offer shall lapse.</p>` : ''}

<p>Please note that a <span class="strong">background verification</span> of the information and
documents provided by you shall be initiated by the company. In case any information furnished by you
is found to be false, incorrect, or misleading at any stage, this offer, and the subsequent
appointment shall be treated as void ab initio, and the decision of the management in this regard
shall be final and binding.</p>

<p>Please send the original scan copies of the following documents before joining:</p>
<ol class="docs">${(isIntern ? INTERN_DOCUMENTS : DOCUMENTS).map(d => `<li>${d}</li>`).join('')}</ol>

<p>If on verification, at the time of appointment or later it is found that you have furnished wrong
information, in such cases your services with the company will be liable to termination.</p>

<p>We welcome you to the SSC Control Pvt. Ltd. family and wish you a rewarding career ahead.</p>

<p>We wish you all the best in your future career.</p>

<div class="sig">
  For, SSC Control Pvt. Ltd.<br/>
  Sd/-<br/>
  <span class="nm">${esc(signatoryName)}</span><br/>
  (${esc(signatoryTitle)})
</div>

<div class="note">*This is an electronically generated letter and hence does not require a signature.</div>

${isIntern ? `<div class="pgbreak"></div>
<div class="annex-title">Annexure - A</div>
<div class="annex-sub">Stipend Details</div>

<table class="annex">
  <thead><tr><th>STIPEND</th><th class="r">Amount</th></tr></thead>
  <tbody>
    <tr><td>MONTHLY STIPEND</td><td class="r mono">${money(stipend)}</td></tr>
    <tr><td>INTERNSHIP DURATION</td><td class="r mono">${months ? `${months} month${months === 1 ? '' : 's'}` : '—'}</td></tr>
    <tr class="rule"><td>TOTAL STIPEND FOR THE TERM</td>
      <td class="r mono">${months ? money(stipend * months) : '—'}</td></tr>
    <tr><td>PROVIDENT FUND</td><td class="r">Not applicable</td></tr>
    <tr><td>GRATUITY / BONUS</td><td class="r">Not applicable</td></tr>
    <tr class="total"><td>PAYABLE PER MONTH</td><td class="r mono">${money(stipend)}</td></tr>
  </tbody>
</table>

<p style="margin-top:14px;font-size:11px;color:#64748b">The stipend is paid monthly, subject to
statutory deductions if any become applicable. An internship carries no salary structure, and no
provident fund, gratuity or bonus accrues during the term.</p>
` : `<div class="pgbreak"></div>
<div class="annex-title">Annexure - A</div>
<div class="annex-sub">Compensation Structure</div>

<table class="annex">
  <thead><tr><th>SALARY</th><th class="r">Monthly</th><th class="r">Annualy</th></tr></thead>
  <tbody>
    ${annexure}
    <tr class="rule"><td>TOTAL ADDITION TO SALARY BY COMPANY</td>
      <td class="r mono">${money(employerAdd)}</td><td class="r mono">${money(employerAdd * 12)}</td></tr>
    <tr class="total"><td>TOTAL CTC - COST TO COMPANY</td>
      <td class="r mono">${money(monthlyCtc)}</td><td class="r mono">${money(monthlyCtc * 12)}</td></tr>
  </tbody>
</table>`}

<div class="footer">
  <div class="footer-left">SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div>
  <div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div>
</div>

</body></html>`
}
