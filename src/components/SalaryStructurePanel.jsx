// The salary calculator, as a reusable panel.
//
// Two callers: /people/salary-calculator (the standalone what-if tool) and the
// Talent 360 offer screen, where the number you settle on IS the offer. They
// must not drift — a letter promising a breakup the payroll record does not
// match is the worst bug this module could ship — so the inputs, the maths and
// the presentation all live here once.
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
  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, padding:strong?'8px 0 0':'5px 0', marginTop:strong?4:0, borderTop:strong?'1px solid var(--line-2)':'none' }}>
    <span style={{ fontSize:12.5, color:strong?'var(--ink)':'var(--muted)', fontWeight:strong?600:400, display:'inline-flex', alignItems:'center', gap:5 }}>
      {l}
      {onHelp && <button type="button" onClick={onHelp} title="How this is calculated" style={{ border:0, background:'none', cursor:'pointer', color:'var(--accent)', padding:0, display:'inline-flex' }}>
        <svg width="12.5" height="12.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
      </button>}
    </span>
    <span style={{ fontSize:strong?14:13, fontWeight:strong?600:500, color:'var(--ink)', fontFamily:"'Geist Mono',monospace" }}>{inr(v)}</span>
  </div>
)

const Field = ({ label, children, hint }) => (
  <div style={{ marginBottom:14 }}>
    <label style={{ display:'block', fontSize:11, fontWeight:600, letterSpacing:'0.03em', textTransform:'uppercase', color:'var(--muted)', marginBottom:5 }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize:11, color:'var(--muted-2)', marginTop:4 }}>{hint}</div>}
  </div>
)

const inputStyle = { width:'100%', border:'1px solid var(--line)', borderRadius:8, padding:'9px 11px', font:'inherit', fontSize:14, color:'var(--ink)', background:'var(--surface)', boxSizing:'border-box' }

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
    <div style={{ display:'grid', gridTemplateColumns:'320px 1fr', gap:16, alignItems:'start' }} className="salcalc-grid">
      {/* inputs */}
      <div className="acard" style={{ padding:'18px 20px' }}>
        <Field label="Annual CTC (₹)">
          <input type="number" value={v.ctc} onChange={e=>set({ ctc:e.target.value })} style={inputStyle} placeholder="e.g. 390600" />
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:6 }}>Monthly CTC: <b style={{ color:'var(--ink)' }}>{inr(r.monthlyCtc)}</b></div>
        </Field>
        <Field label="Split ratio · Basic / HRA / Travel / Special">
          <select value={v.ratio} onChange={e=>set({ ratio:e.target.value })} style={inputStyle}>
            {Object.keys(RATIOS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Tax regime">
          <div style={{ display:'inline-flex', gap:3, padding:3, background:'var(--bg)', borderRadius:9, width:'100%' }}>
            {['new','old'].map(x => (
              <button type="button" key={x} onClick={()=>set({ regime:x })} style={{ flex:1, border:0, cursor:'pointer', borderRadius:6, padding:'7px 0', fontSize:12.5, fontWeight:600, fontFamily:'inherit', color:v.regime===x?'#fff':'var(--muted)', background:v.regime===x?'var(--accent)':'transparent' }}>{x==='new'?'New':'Old'}</button>
            ))}
          </div>
        </Field>
        <Field label="PF applicable">
          <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
            <input type="checkbox" checked={v.pf} onChange={e=>set({ pf:e.target.checked })} /> Deduct PF (₹1,800 employee / ₹1,950 employer)
          </label>
        </Field>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Field label="Prof. Tax"><input type="number" value={v.pt} onChange={e=>set({ pt:e.target.value })} style={inputStyle} /></Field>
          <Field label="Accidental Ins."><input type="number" value={v.acc} onChange={e=>set({ acc:e.target.value })} style={inputStyle} /></Field>
        </div>
      </div>

      {/* output */}
      <div className="acard">
        {!compact && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)' }}>
            <div style={{ padding:'18px 20px', borderRight:'1px solid var(--line-2)' }}><div className="pmc-l">Annual CTC</div><div className="pmc-v" style={{ fontSize:22 }}>{inr(r.annualCtc)}</div></div>
            <div style={{ padding:'18px 20px', borderRight:'1px solid var(--line-2)' }}><div className="pmc-l">Monthly Gross</div><div className="pmc-v" style={{ fontSize:18 }}>{inr(r.gross)}</div></div>
            <div style={{ padding:'18px 20px' }}><div className="pmc-l">Annual TDS</div><div className="pmc-v" style={{ fontSize:18 }}>{inr(r.tax.totalTaxAnnual)}</div></div>
          </div>
        )}
        <div style={{ borderTop:compact?'none':'1px solid var(--line-2)', display:'grid', gridTemplateColumns:'1fr 1fr' }}>
          <div style={{ padding:'16px 20px', borderRight:'1px solid var(--line-2)' }}>
            <div className="pmc-l" style={{ marginBottom:6 }}>Earnings · {v.ratio}</div>
            <Line l="Basic" v={r.basic}/>
            <Line l="HRA" v={r.hra}/>
            <Line l="Travel Allowance" v={r.travelAllowance}/>
            <Line l="Special Allowance" v={r.specialAllowance}/>
            <Line l="Monthly Gross" v={r.gross} strong/>
          </div>
          <div style={{ padding:'16px 20px' }}>
            <div className="pmc-l" style={{ marginBottom:6 }}>Deductions</div>
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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap', padding:'16px 20px', borderTop:'1px solid var(--line-2)', background:'var(--bg)' }}>
          <div><div className="pmc-l">Net Payable / month</div><div className="pmc-v" style={{ fontSize:24, color:'var(--st-present)' }}>{inr(r.netPayable)}</div></div>
          <div style={{ fontSize:11.5, color:'var(--muted)', textAlign:'right' }}>
            Employer PF {inr(r.employerPf)} · ESIC {inr(r.employerEsic)}<br/>
            <span style={{ color:'var(--muted-2)' }}>TDS on {v.regime==='old'?'Old':'New'} regime · gratuity &amp; bonus deducted upfront · excludes overtime</span>
          </div>
        </div>
      </div>
    </div>
  )
}
