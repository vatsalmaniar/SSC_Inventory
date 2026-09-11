// The salary calculator, as a reusable panel.
//
// Two callers: /people/salary-calculator (the standalone what-if tool) and the
// Talent 360 offer screen, where the number you settle on IS the offer. They
// must not drift — a letter promising a breakup the payroll record does not
// match is the worst bug this module could ship — so the inputs, the maths and
// the presentation all live here once.
//
// ⚠️ SELF-CONTAINED STYLING, deliberately. The first version borrowed .acard,
// .pmc-l and .pmc-v, which are scoped to `.people-app`. The offer screen
// renders this inside a drawer, and drawers portal onto document.body — well
// outside that scope — so the whole panel came out as unstyled bare divs and
// looked like it had not rendered at all. A component used in two different
// scopes has to carry its own CSS.
//
// Controlled: the caller owns `value` and persists it (offer_versions stores
// these six inputs alongside the frozen breakup, so a revision can reopen the
// calculator exactly where the last one left off).

import { computeStructure, RATIOS } from '../lib/salaryStructure'

export const EMPTY_SALARY = {
  ctc: '', ratio: '50 / 20 / 10 / 20', regime: 'new', pf: false, pt: '200', acc: '128',
}

// THE call. Both the on-screen preview and whatever the caller writes to the
// database must come from this, or the screen and the record disagree.
export const computePanel = (v = EMPTY_SALARY) => computeStructure({
  annualCtc: Number(v.ctc) || 0,
  ratio: v.ratio,
  regime: v.regime,
  pfApplicable: v.pf,
  professionalTax: Number(v.pt) || 0,
  accidentalInsurance: Number(v.acc) || 0,
})

const inr = n => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })

const Line = ({ l, v, strong, onHelp }) => (
  <div className={'ssp-line' + (strong ? ' is-strong' : '')}>
    <span className="ssp-line-l">
      {l}
      {onHelp && <button type="button" onClick={onHelp} title="How this is calculated" className="ssp-help">
        <svg width="12.5" height="12.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
      </button>}
    </span>
    <span className="ssp-line-v">{inr(v)}</span>
  </div>
)

const Field = ({ label, children, hint }) => (
  <div className="ssp-field">
    <label>{label}</label>
    {children}
    {hint && <div className="ssp-hint">{hint}</div>}
  </div>
)

const CSS = `
.ssp{display:grid;grid-template-columns:300px minmax(0,1fr);gap:14px;align-items:start;font-family:var(--font,inherit);}
.ssp-card{background:var(--surface,#fff);border:1px solid var(--line-2,#E4E7EC);border-radius:12px;overflow:hidden;}
.ssp-inputs{padding:16px 18px;}
.ssp-field{margin-bottom:13px;}
.ssp-field:last-child{margin-bottom:0;}
.ssp-field > label{display:block;font-size:10.5px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#5B738B);margin-bottom:5px;}
.ssp-field input[type=number],.ssp-field select{width:100%;border:1px solid var(--line,#D8DEE6);border-radius:8px;padding:8px 11px;font:inherit;font-size:13.5px;color:var(--ink,#1D2D3E);background:var(--surface,#fff);outline:none;}
.ssp-field input[type=number]:focus,.ssp-field select:focus{border-color:var(--accent,#1a73e8);}
.ssp-hint{font-size:11.5px;color:var(--muted,#5B738B);margin-top:6px;}
.ssp-hint b{color:var(--ink,#1D2D3E);}
.ssp-seg{display:inline-flex;gap:3px;padding:3px;background:var(--bg,#F5F7FA);border-radius:9px;width:100%;}
.ssp-seg button{flex:1;border:0;cursor:pointer;border-radius:6px;padding:7px 0;font:inherit;font-size:12.5px;font-weight:600;color:var(--muted,#5B738B);background:transparent;}
.ssp-seg button.on{color:#fff;background:var(--accent,#1a73e8);}
.ssp-check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;color:var(--ink,#1D2D3E);}
.ssp-2{display:grid;grid-template-columns:1fr 1fr;gap:11px;}
.ssp-top{display:grid;grid-template-columns:repeat(3,1fr);border-bottom:1px solid var(--line-2,#E4E7EC);}
.ssp-top > div{padding:14px 16px;}
.ssp-top > div + div{border-left:1px solid var(--line-2,#E4E7EC);}
.ssp-l{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-2,#8C99A8);}
.ssp-v{font-size:17px;font-weight:600;margin-top:4px;letter-spacing:-.01em;color:var(--ink,#1D2D3E);}
.ssp-cols{display:grid;grid-template-columns:1fr 1fr;}
.ssp-cols > div{padding:14px 16px;}
.ssp-cols > div + div{border-left:1px solid var(--line-2,#E4E7EC);}
.ssp-line{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:4px 0;}
.ssp-line.is-strong{padding:7px 0 0;margin-top:4px;border-top:1px solid var(--line-2,#E4E7EC);}
.ssp-line-l{font-size:12.5px;color:var(--muted,#5B738B);display:inline-flex;align-items:center;gap:5px;}
.ssp-line.is-strong .ssp-line-l{color:var(--ink,#1D2D3E);font-weight:600;}
.ssp-line-v{font-size:13px;font-weight:500;color:var(--ink,#1D2D3E);font-family:var(--mono,'Geist Mono',monospace);}
.ssp-line.is-strong .ssp-line-v{font-size:14px;font-weight:600;}
.ssp-help{border:0;background:none;cursor:pointer;color:var(--accent,#1a73e8);padding:0;display:inline-flex;}
.ssp-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;border-top:1px solid var(--line-2,#E4E7EC);background:var(--bg,#F5F7FA);}
.ssp-net{font-size:22px;font-weight:600;color:#15803d;margin-top:3px;letter-spacing:-.01em;}
.ssp-meta{font-size:11.5px;color:var(--muted,#5B738B);text-align:right;}
.ssp-meta span{color:var(--muted-2,#8C99A8);}
@media (max-width:900px){
  .ssp{grid-template-columns:1fr;}
  .ssp-top{grid-template-columns:1fr;}
  .ssp-top > div + div{border-left:0;border-top:1px solid var(--line-2,#E4E7EC);}
  .ssp-cols{grid-template-columns:1fr;}
  .ssp-cols > div + div{border-left:0;border-top:1px solid var(--line-2,#E4E7EC);}
}
`

/**
 * @param {object}   value     { ctc, ratio, regime, pf, pt, acc }
 * @param {function} onChange  receives the next value object
 * @param {function} onHelp    optional — opens SalaryHelpDrawer for a topic
 * @param {boolean}  compact   offer screen: drop the three-up summary strip,
 *                             which duplicates figures the offer header shows
 */
export default function SalaryStructurePanel({ value = EMPTY_SALARY, onChange, onHelp, compact = false }) {
  const v = { ...EMPTY_SALARY, ...value }
  const set = patch => onChange?.({ ...v, ...patch })
  const r = computePanel(v)

  return (
    <div className="ssp">
      <style>{CSS}</style>

      {/* inputs */}
      <div className="ssp-card ssp-inputs">
        <Field label="Annual CTC (₹)" hint={<>Monthly CTC: <b>{inr(r.monthlyCtc)}</b></>}>
          <input type="number" value={v.ctc} onChange={e=>set({ ctc:e.target.value })} placeholder="e.g. 390600" />
        </Field>
        <Field label="Split · Basic / HRA / Travel / Special">
          <select value={v.ratio} onChange={e=>set({ ratio:e.target.value })}>
            {Object.keys(RATIOS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Tax regime">
          <div className="ssp-seg">
            {['new','old'].map(x => (
              <button type="button" key={x} className={v.regime===x?'on':''} onClick={()=>set({ regime:x })}>{x==='new'?'New':'Old'}</button>
            ))}
          </div>
        </Field>
        <Field label="PF applicable">
          <label className="ssp-check">
            <input type="checkbox" checked={v.pf} onChange={e=>set({ pf:e.target.checked })} />
            Deduct PF (₹1,800 employee / ₹1,950 employer)
          </label>
        </Field>
        <div className="ssp-2">
          <Field label="Prof. Tax"><input type="number" value={v.pt} onChange={e=>set({ pt:e.target.value })} /></Field>
          <Field label="Accidental Ins."><input type="number" value={v.acc} onChange={e=>set({ acc:e.target.value })} /></Field>
        </div>
      </div>

      {/* output */}
      <div className="ssp-card">
        {!compact && (
          <div className="ssp-top">
            <div><div className="ssp-l">Annual CTC</div><div className="ssp-v">{inr(r.annualCtc)}</div></div>
            <div><div className="ssp-l">Monthly Gross</div><div className="ssp-v">{inr(r.gross)}</div></div>
            <div><div className="ssp-l">Annual TDS</div><div className="ssp-v">{inr(r.tax.totalTaxAnnual)}</div></div>
          </div>
        )}
        <div className="ssp-cols">
          <div>
            <div className="ssp-l" style={{ marginBottom:6 }}>Earnings · {v.ratio}</div>
            <Line l="Basic" v={r.basic}/>
            <Line l="HRA" v={r.hra}/>
            <Line l="Travel Allowance" v={r.travelAllowance}/>
            <Line l="Special Allowance" v={r.specialAllowance}/>
            <Line l="Monthly Gross" v={r.gross} strong/>
          </div>
          <div>
            <div className="ssp-l" style={{ marginBottom:6 }}>Deductions</div>
            {r.pfEmployee > 0 && <Line l="PF (Employee)" v={r.pfEmployee}/>}
            {r.esicEmployee > 0 && <Line l="ESIC (Employee)" v={r.esicEmployee}/>}
            <Line l="Professional Tax" v={r.professionalTax}/>
            <Line l="Accidental Insurance" v={r.accidentalInsurance}/>
            <Line l="Gratuity" v={r.gratuity} onHelp={onHelp && (()=>onHelp('gratuity'))}/>
            <Line l="Bonus" v={r.bonus} onHelp={onHelp && (()=>onHelp('bonus'))}/>
            <Line l="TDS" v={r.tds} onHelp={onHelp && (()=>onHelp('tds'))}/>
            <Line l="Total Deductions" v={r.totalDeductions} strong/>
          </div>
        </div>
        <div className="ssp-foot">
          <div><div className="ssp-l">Net Payable / month</div><div className="ssp-net">{inr(r.netPayable)}</div></div>
          <div className="ssp-meta">
            Employer PF {inr(r.employerPf)} · ESIC {inr(r.employerEsic)}<br/>
            <span>TDS on {v.regime==='old'?'Old':'New'} regime · gratuity &amp; bonus deducted upfront · excludes overtime</span>
          </div>
        </div>
      </div>
    </div>
  )
}
