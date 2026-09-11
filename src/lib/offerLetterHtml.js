// Shared offer-letter template — print-ready standalone HTML.
//
// Laid out to match the Delivery Challan (src/pages/OrderDetail.jsx): same
// letterhead, same doc-type badge and big right-aligned title, same two-column
// meta grid, same reference table, same signature row and footer, same A4
// print rules. An offer letter is an SSC document and should be recognisable
// as one at a glance.
//
// Page 1 is the letter. Page 2 is Annexure A — the compensation table — on its
// own sheet, so the money can be handed over, filed or withheld separately
// from the letter itself.
//
// ⚠️ Annexure A has NO salary maths of its own. It renders the frozen
// `breakup` stored on the offer version, which is computeStructure()'s output
// — the same call that writes employee_compensation when they join. A second
// formula here is how a letter ends up promising one number and payroll
// paying another. scripts/test-offer-annexure.mjs guards this against the
// real letter SSC issued to Aayush Prajapati.

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
// `rule` marks a subtotal line.
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

const LETTERHEAD = `<div class="header">
  <div>
    <div class="co-name">SSC Control Pvt. Ltd.</div>
    <div class="co-sub">Engineering Industry. Powering Progress.</div>
    <div class="co-tags">Industrial Automation &nbsp;|&nbsp; Product Distribution &nbsp;|&nbsp; Safety Solutions &nbsp;|&nbsp; Robotics</div>
    <div class="co-addr">E/12, Siddhivinayak Towers, B/H DCP Office<br/>Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>GSTIN: 24ABGCS0605M1ZE</div>
  </div>
  <div style="text-align:right">
    <img src="${origin()}/logo/ssc-60-years.png" alt="SSC 60 Years" class="logo"/>
    <div class="doc-type-badge">__BADGE__</div>
    <div class="doc-title">__TITLE__</div>
  </div>
</div>`

const FOOTER = `<div class="footer">
  <div class="footer-left">SSC Control Pvt. Ltd. &nbsp;|&nbsp; GSTIN: 24ABGCS0605M1ZE &nbsp;|&nbsp; CIN: U51909GJ2021PTC122539<br/>Ahmedabad: E/12, Siddhivinayak Towers, Off. SG Highway, Makarba, Ahmedabad – 380 051<br/>Baroda: 31 GIDC Estate, B/h Bank Of Baroda, Makarpura, Vadodara – 390 010</div>
  <div class="footer-right">sales@ssccontrol.com<br/>www.ssccontrol.com</div>
</div>`

const head = (badge, title) => LETTERHEAD.replace('__BADGE__', badge).replace('__TITLE__', title)

/**
 * @param {object} offer     offers row — offer_no, designation, branch,
 *                           proposed_join_date, valid_till, reporting_address,
 *                           employment_type, internship_months
 * @param {object} version   offer_versions row — version, breakup, annual_ctc, stipend_monthly
 * @param {object} candidate candidates row — full_name, location
 * @param {object} opts      { signatoryName, signatoryTitle, letterDate, reportingTime }
 */
export function buildOfferLetterHtml(offer, version, candidate, opts = {}) {
  const b = version?.breakup || {}
  // An intern has no salary structure, so every head prints 0 rather than being
  // hidden — the reader should see that PF, gratuity and bonus are nil, not be
  // left wondering whether they were simply left off the page.
  const {
    signatoryName  = 'Ankit Dave',
    signatoryTitle = 'Head of Operations',
    letterDate     = new Date().toLocaleDateString('en-CA'),
    reportingTime  = '10:00 AM',
  } = opts

  // An internship is a fixed-term stipend, not a salary structure: no PF, no
  // gratuity, no Annexure A of the salaried shape, and no probation clause
  // (the whole thing is a trial). Printing the salaried letter for an intern
  // would promise benefits that do not exist.
  const isIntern = offer?.employment_type === 'intern'
  const stipend  = Number(version?.stipend_monthly) || 0
  const months   = offer?.internship_months || null

  const first = (candidate?.full_name || '').trim().split(/\s+/)[0] || 'Candidate'
  const officeLine = offer?.branch ? `our ${esc(offer.branch)} Office` : 'our office'
  const reportAddr = offer?.reporting_address || BARODA_OFFICE
  // A revision is the same offer, so the number is unchanged and the revision
  // is called out instead — a candidate holding both must see which is newer.
  const rev = (version?.version || 1) > 1 ? version.version : null

  const employerAdd = (Number(b.employerPf) || 0) + (Number(b.employerEsic) || 0)
  const monthlyCtc  = (Number(b.gross) || 0) + employerAdd

  // Annexure A is laid out like the in-app salary calculator — same two
  // columns, same Monthly Gross / Total Deductions subtotals, same Net Payable
  // band — so the breakup the person priced the offer on and the breakup the
  // candidate reads are visibly the same thing.
  const line = (label, key, strong) => {
    const m = Number(b[key]) || 0
    return `<div class="calc-row${strong ? ' is-strong' : ''}">
      <span>${label}</span><b class="mono">${money(m)}</b><i class="mono">${money(m * 12)}</i>
    </div>`
  }

  const earnings = [
    line('Basic &amp; DA', 'basic'),
    line('HRA', 'hra'),
    line('Travel Allowance', 'travelAllowance'),
    line('Special Allowance', 'specialAllowance'),
    line('Monthly Gross', 'gross', true),
  ].join('')

  const deductions = [
    (isIntern || (Number(b.pfEmployee) || 0) > 0) ? line('PF (Employee)', 'pfEmployee') : '',
    (isIntern || (Number(b.esicEmployee) || 0) > 0) ? line('ESIC (Employee)', 'esicEmployee') : '',
    line('Professional Tax', 'professionalTax'),
    line('Accidental Insurance', 'accidentalInsurance'),
    line('Gratuity', 'gratuity'),
    line('Bonus', 'bonus'),
    line('TDS', 'tds'),
    line('Total Deductions', 'totalDeductions', true),
  ].join('')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${isIntern ? 'Internship Offer' : 'Offer Letter'} — ${esc(offer?.offer_no || '')}</title>
<link href="${origin()}/fonts/fonts.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
/* On screen the two sheets sit on a grey canvas as two distinct pages, so it
   reads the way it will print. In print they are bare — no shadow, no gap. */
body{font-family:'Geist',sans-serif;font-size:12px;color:#0f172a;background:#eef2f6;line-height:1.6;padding:22px 0;margin:0}
.mono{font-family:'Geist Mono',monospace}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
.co-name{font-size:17px;font-weight:700;margin-bottom:2px}
.co-sub{font-size:11px;color:#64748b;margin-bottom:8px}
.co-tags{font-size:10px;color:#64748b;margin-bottom:8px;letter-spacing:0.2px}
.co-addr{font-size:10.5px;color:#475569;line-height:1.6}
.logo{height:95px;width:auto;display:block;margin-left:auto;margin-bottom:10px}
.doc-title{font-size:28px;font-weight:700;text-align:right;letter-spacing:-0.5px;line-height:1.15}
.doc-type-badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;padding:3px 10px;border-radius:4px;margin-bottom:6px;background:#eff6ff;color:#1d4ed8}
.divider{border:none;border-top:1px solid #e2e8f0;margin:20px 0}
.meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
.meta-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.7px;color:#94a3b8;margin-bottom:6px}
.meta-name{font-size:13px;font-weight:700;margin-bottom:3px}
.meta-addr{font-size:11px;color:#475569;line-height:1.6}
.ref-table{width:100%;border-collapse:collapse}
.ref-table tr td{padding:3px 0;font-size:11px;vertical-align:top}
.ref-table tr td:first-child{color:#64748b;width:45%}
.ref-table tr td:last-child{font-weight:600}
.terms{display:flex;gap:32px;font-size:11px;color:#475569;margin-bottom:20px;flex-wrap:wrap}
.terms span strong{color:#0f172a;font-weight:600}
p{margin-bottom:11px}
.strong{font-weight:600}
ol.docs{margin:6px 0 14px 20px}
ol.docs li{margin-bottom:3px}
.note-box{font-size:11px;color:#475569;margin:16px 0 20px;padding:10px 14px;background:#f8fafc;border-left:3px solid #e2e8f0;border-radius:0 6px 6px 0}
table.items{width:100%;border-collapse:collapse;margin-bottom:4px}
table.items thead tr{border-bottom:2px solid #0f172a}
table.items th{padding:8px 10px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;text-align:left}
table.items th.r{text-align:right}
table.items td{padding:9px 10px;font-size:11.5px;vertical-align:top;border-bottom:1px solid #f1f5f9}
table.items td.r{text-align:right}
table.items td.idx{color:#94a3b8;width:40px}
table.items tr.rule td{font-weight:700;background:#f8fafc;border-bottom:1px solid #cbd5e1}
/* Annexure A, laid out like the in-app salary calculator. */
.calc{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}
.calc-top{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid #e2e8f0}
.calc-top > div{padding:13px 16px}
.calc-top > div + div{border-left:1px solid #e2e8f0}
.calc-l{font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8}
.calc-v{font-size:16px;font-weight:700;margin-top:3px;color:#0f172a}
.calc-cols{display:grid;grid-template-columns:1fr 1fr}
.calc-col{padding:12px 16px}
.calc-col + .calc-col{border-left:1px solid #e2e8f0}
.calc-h{display:grid;grid-template-columns:1fr 74px 82px;gap:8px;padding-bottom:6px;margin-bottom:4px;
  border-bottom:1px solid #e2e8f0;font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8}
.calc-h b,.calc-h i{font-weight:600;font-style:normal;text-align:right}
.calc-row{display:grid;grid-template-columns:1fr 74px 82px;gap:8px;padding:4px 0;font-size:11.5px;color:#475569}
.calc-row b,.calc-row i{font-style:normal;font-weight:500;text-align:right;color:#0f172a}
.calc-row.is-strong{margin-top:5px;padding-top:7px;border-top:1px solid #e2e8f0;color:#0f172a;font-weight:600}
.calc-row.is-strong b,.calc-row.is-strong i{font-weight:700}
.calc-foot{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  padding:13px 16px;border-top:1px solid #e2e8f0;background:#f8fafc}
.calc-net{font-size:21px;font-weight:700;color:#15803d;margin-top:2px}
.calc-meta{font-size:10.5px;color:#475569;text-align:right;line-height:1.7}
.calc-meta span{color:#94a3b8}
/* Both cells bottom-align, so the candidate's signature line and SSC's
   sign-off finish on the same baseline instead of drifting apart. */
.sig-row{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:34px;padding-top:20px;border-top:1px solid #e2e8f0;align-items:end}
.sig-cell{font-size:10.5px;color:#64748b}
.sig-cell.r{text-align:right}
.sig-for{font-size:11px;color:#475569;line-height:1.7}
.sig-line{border-top:1px solid #94a3b8;margin-bottom:7px}
.sig-gap{height:44px}
.sig-name{font-weight:600;color:#0f172a;font-size:11.5px}
.egen{margin-top:16px;font-size:10.5px;color:#64748b;font-style:italic}
.footer{margin-top:24px;padding-top:14px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center}
.footer-left{font-size:10px;color:#94a3b8;line-height:1.6}
.footer-right{font-size:10px;color:#94a3b8;text-align:right}
.sheet{background:#fff;max-width:860px;margin:0 auto 22px;padding:38px 46px;box-shadow:0 1px 10px rgba(15,23,42,.10);border-radius:3px;page-break-after:always}
.sheet:last-child{page-break-after:auto;margin-bottom:0}
@media print{
  body{background:#fff;padding:0}
  .sheet{box-shadow:none;border-radius:0;margin:0;padding:0;max-width:100%}
  @page{size:A4;margin:16mm 14mm}
}
</style></head><body>

<!-- ───────────────── Page 1 — the letter ───────────────── -->
<div class="sheet">
${head(isIntern ? 'Internship' : 'Employment', isIntern ? 'Internship<br/>Offer' : 'Offer Letter')}
<hr class="divider"/>

<div class="meta-grid">
  <div>
    <div class="meta-section-label">Offered To</div>
    <div class="meta-name">${esc(candidate?.full_name || '')}</div>
    <div class="meta-addr">${candidate?.location ? esc(candidate.location).replace(/\n/g, '<br/>') : ''}</div>
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>Offer No.</td><td class="mono">${esc(offer?.offer_no || '—')}</td></tr>
      ${rev ? `<tr><td>Revision</td><td>Rev ${rev}</td></tr>` : ''}
      <tr><td>Date</td><td>${esc(longDate(letterDate))}</td></tr>
      <tr><td>Position</td><td>${esc(offer?.designation || '—')}</td></tr>
      ${offer?.valid_till ? `<tr><td>Valid Till</td><td>${esc(longDate(offer.valid_till))}</td></tr>` : ''}
    </table>
  </div>
</div>
<hr class="divider"/>

<div class="terms">
  <span>Engagement: <strong>${isIntern ? 'Internship' : 'Full time'}</strong></span>
  <span>Location: <strong>${esc(offer?.branch || 'Ahmedabad')}</strong></span>
  <span>Reporting on: <strong>${esc(longDate(offer?.proposed_join_date))}</strong></span>
  ${isIntern && months ? `<span>Duration: <strong>${months} month${months === 1 ? '' : 's'}</strong></span>` : ''}
</div>

<p>Dear ${esc(first)},</p>

<p>This is with reference to your application and subsequent interviews you had with us. We are
pleased to offer you ${isIntern ? 'an internship as' : 'the position of'} "<span class="strong">${esc(offer?.designation || '')}</span>"
in our esteemed organization, based at ${officeLine}.</p>

${isIntern
  ? `<p>The internship is for a fixed term of <span class="strong">${months ? `${months} month${months === 1 ? '' : 's'}` : 'the agreed period'}</span>
from the date of joining, and carries a stipend of <span class="strong">₹${money(stipend)} per month</span>,
as detailed in Annexure A.</p>

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

${offer?.valid_till ? `<div class="note-box">This offer is valid up to <strong>${esc(longDate(offer.valid_till))}</strong>.
If we do not hear from you by this date, the offer shall lapse.</div>` : ''}

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

<div class="sig-row">
  <div class="sig-cell">
    <div class="sig-gap"></div>
    <div class="sig-line"></div>
    <div class="sig-name">${esc(candidate?.full_name || 'Candidate')}</div>
    Accepted — signature &amp; date
  </div>
  <div class="sig-cell r">
    <div class="sig-for">For, SSC Control Pvt. Ltd.<br/>Sd/-</div>
    <div class="sig-name" style="margin-top:22px">${esc(signatoryName)}</div>
    ${esc(signatoryTitle)}
  </div>
</div>

<div class="egen">*Electronically generated — SSC's signature is not required. Please sign and return a copy to accept.</div>
${FOOTER}
</div>

<!-- ───────────────── Page 2 — Annexure A ───────────────── -->
<div class="sheet">
${head('Annexure A', isIntern ? 'Stipend<br/>Details' : 'Compensation<br/>Structure')}
<hr class="divider"/>

<div class="meta-grid">
  <div>
    <div class="meta-section-label">For</div>
    <div class="meta-name">${esc(candidate?.full_name || '')}</div>
    <div class="meta-addr">${esc(offer?.designation || '')}${offer?.department ? ` · ${esc(offer.department)}` : ''}</div>
  </div>
  <div>
    <div class="meta-section-label">Reference</div>
    <table class="ref-table">
      <tr><td>Offer No.</td><td class="mono">${esc(offer?.offer_no || '—')}</td></tr>
      ${rev ? `<tr><td>Revision</td><td>Rev ${rev}</td></tr>` : ''}
      <tr><td>Date</td><td>${esc(longDate(letterDate))}</td></tr>
      <tr><td>Effective From</td><td>${esc(longDate(offer?.proposed_join_date))}</td></tr>
    </table>
  </div>
</div>
<hr class="divider"/>

<div class="calc">
  <div class="calc-top">
    <div><div class="calc-l">${isIntern ? 'Monthly stipend' : 'Annual CTC'}</div>
      <div class="calc-v mono">₹${money(isIntern ? stipend : monthlyCtc * 12)}</div></div>
    <div><div class="calc-l">${isIntern ? 'Duration' : 'Monthly gross'}</div>
      <div class="calc-v mono">${isIntern ? (months ? `${months} month${months === 1 ? '' : 's'}` : '—') : '₹' + money(b.gross)}</div></div>
    <div><div class="calc-l">${isIntern ? 'Total for the term' : 'Annual TDS'}</div>
      <div class="calc-v mono">₹${money(isIntern ? stipend * (months || 0) : (Number(b.tds) || 0) * 12)}</div></div>
  </div>

  <div class="calc-cols">
    <div class="calc-col">
      <div class="calc-h"><span>Earnings${isIntern ? '' : ` · ${esc(version?.salary_ratio || '')}`}</span><b>Monthly</b><i>${isIntern ? 'Term' : 'Annual'}</i></div>
      ${isIntern ? `<div class="calc-row"><span>Monthly Stipend</span><b class="mono">${money(stipend)}</b><i class="mono">${money(stipend * (months || 0))}</i></div>` : ''}
      ${earnings}
    </div>
    <div class="calc-col">
      <div class="calc-h"><span>Deductions</span><b>Monthly</b><i>${isIntern ? 'Term' : 'Annual'}</i></div>
      ${deductions}
    </div>
  </div>

  <div class="calc-foot">
    <div>
      <div class="calc-l">${isIntern ? 'Stipend payable / month' : 'Net Payable / month'}</div>
      <div class="calc-net mono">₹${money(isIntern ? stipend : b.netPayable)}</div>
    </div>
    <div class="calc-meta">
      ${isIntern
        ? 'Employer PF ₹0 &middot; ESIC ₹0<br/><span>No provident fund, gratuity or bonus accrues during an internship.</span>'
        : `Employer PF ₹${money(b.employerPf)} &middot; ESIC ₹${money(b.employerEsic)}<br/>
           <span>Total CTC ₹${money(monthlyCtc)} / month &middot; ₹${money(monthlyCtc * 12)} / annum</span>`}
    </div>
  </div>
</div>

<div class="note-box">
  ${isIntern
    ? 'The stipend is paid monthly, subject to statutory deductions if any become applicable. An internship carries no salary structure, and no provident fund, gratuity or bonus accrues during the term.'
    : 'Gratuity and bonus are shown as monthly accruals and are paid as per statute. TDS is indicative and is recomputed each month against actual earnings and declared investments.'}
</div>

<div class="sig-row">
  <div class="sig-cell">
    <div class="sig-gap"></div>
    <div class="sig-line"></div>
    <div class="sig-name">${esc(candidate?.full_name || 'Candidate')}</div>
    Accepted — signature &amp; date
  </div>
  <div class="sig-cell r">
    <div class="sig-for">For, SSC Control Pvt. Ltd.<br/>Sd/-</div>
    <div class="sig-name" style="margin-top:22px">${esc(signatoryName)}</div>
    ${esc(signatoryTitle)}
  </div>
</div>

<div class="egen">*Electronically generated — SSC's signature is not required. Please sign and return a copy to accept.</div>
${FOOTER}
</div>

</body></html>`
}
