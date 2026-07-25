import { createPortal } from 'react-dom'

/* "How this is calculated" explainer for the salary card — TDS / Gratuity / Bonus.
   Cites the governing Act/year. Popups = drawers; reuses pd-* chrome from drawer.css. */

const inr = n => n==null ? '—' : '₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2})
const pctLabel = { 0:'Nil', 0.05:'5%', 0.10:'10%', 0.15:'15%', 0.20:'20%', 0.25:'25%', 0.30:'30%' }

const Row = ({ l, v, strong }) => (
  <div style={{display:'flex',justifyContent:'space-between',gap:12,padding:strong?'8px 0 0':'5px 0',marginTop:strong?4:0,borderTop:strong?'1px solid var(--line-2)':'none'}}>
    <span style={{fontSize:12.5,color:strong?'var(--ink)':'var(--muted)',fontWeight:strong?600:400}}>{l}</span>
    <span style={{fontSize:strong?14:13,fontWeight:strong?600:500,fontFamily:"'Geist Mono',monospace"}}>{v}</span>
  </div>
)
const Cite = ({ children }) => (
  <div style={{marginTop:14,padding:'10px 12px',borderRadius:9,background:'var(--bg)',fontSize:11.5,lineHeight:1.5,color:'var(--muted)'}}>{children}</div>
)

function TdsBody({ calc, regime }) {
  if (!calc) return <div style={{fontSize:12.5,color:'var(--muted)'}}>No taxable income.</div>
  const monthly = inr(Math.round(calc.grossAnnual/12*100)/100)
  return (
    <>
      <div style={{display:'inline-block',fontSize:11,fontWeight:600,color:'var(--accent)',background:'var(--accent-soft)',borderRadius:6,padding:'3px 9px',marginBottom:12}}>
        {regime==='old' ? 'Old regime' : 'New regime · s.115BAC'}
      </div>
      <Row l="Annual gross salary" v={inr(calc.grossAnnual)} />
      {calc.hraExemption>0 && <Row l="− HRA exemption (s.10(13A))" v={inr(calc.hraExemption)} />}
      <Row l="− Standard deduction" v={inr(calc.standardDeduction)} />
      {calc.chapterVIADeductions>0 && <Row l="− Chapter VI-A deductions" v={inr(calc.chapterVIADeductions)} />}
      <Row l="Taxable income (s.288A)" v={inr(calc.taxableIncome)} strong />

      <div className="pmc-l" style={{margin:'16px 0 6px'}}>Tax slab-by-slab</div>
      <div style={{border:'1px solid var(--line-2)',borderRadius:8,overflow:'hidden'}}>
        <div style={{display:'grid',gridTemplateColumns:'1.4fr 0.6fr 1fr',fontSize:11,fontWeight:600,color:'var(--muted)',background:'var(--bg)',padding:'7px 10px'}}>
          <span>Slab</span><span style={{textAlign:'center'}}>Rate</span><span style={{textAlign:'right'}}>Tax</span>
        </div>
        {calc.slabBreakup.map((s,i)=>(
          <div key={i} style={{display:'grid',gridTemplateColumns:'1.4fr 0.6fr 1fr',fontSize:11.5,padding:'6px 10px',borderTop:'1px solid var(--line-2)',fontFamily:"'Geist Mono',monospace"}}>
            <span style={{color:'var(--muted)'}}>{(s.from/100000).toFixed(0)}L–{s.to?(s.to/100000).toFixed(0)+'L':'∞'}</span>
            <span style={{textAlign:'center'}}>{pctLabel[s.rate]??(s.rate*100+'%')}</span>
            <span style={{textAlign:'right'}}>{inr(s.tax)}</span>
          </div>
        ))}
      </div>

      <div style={{marginTop:12}}>
        <Row l="Tax on slabs" v={inr(calc.taxBeforeRebate)} />
        {calc.rebate87A>0 && <Row l="− Rebate u/s 87A" v={inr(calc.rebate87A)} />}
        {calc.marginalRelief87A>0 && <Row l="− Marginal relief (87A)" v={inr(calc.marginalRelief87A)} />}
        {calc.surcharge>0 && <Row l="+ Surcharge" v={inr(calc.surcharge)} />}
        <Row l="+ Health & Education Cess (4%)" v={inr(calc.cess)} />
        <Row l="Annual tax (rounded, s.288B)" v={inr(calc.totalTaxAnnual)} strong />
        <Row l="÷ 12 = Monthly TDS (s.192)" v={inr(calc.monthlyTds)} strong />
      </div>

      <Cite>
        <b style={{color:'var(--ink)'}}>FY 2026-27 (AY 2027-28)</b> · Slabs, standard deduction, rebate, surcharge &amp; cess
        per the <b>Finance Act 2025</b>, retained unchanged by Budget 2026.
        {regime!=='old' && ' New regime under section 115BAC is the statutory default.'}
        {' '}Monthly gross ≈ {monthly}. Estimate — the employee should confirm with their own advisor.
      </Cite>
    </>
  )
}

function GratuityBody({ basic }) {
  const monthly = Number(basic)||0
  const val = monthly*0.0481
  return (
    <>
      <Row l="Monthly Basic" v={inr(monthly)} />
      <Row l="× 4.81%" v="4.81%" />
      <Row l="= Monthly gratuity accrual" v={inr(Math.round(val*100)/100)} strong />
      <Cite>
        <b style={{color:'var(--ink)'}}>Payment of Gratuity Act, 1972.</b> Gratuity accrues at
        <b> 15 days of Basic for every completed year</b> of service. Monthly provision =
        Basic × 15 ÷ 26 ÷ 12 = <b>4.81% of Basic</b>. Retained monthly and paid on exit (after 5 years of service).
      </Cite>
    </>
  )
}

function BonusBody({ value }) {
  return (
    <>
      <Row l="Statutory wage ceiling" v={inr(7000)} />
      <Row l="× 8.33% (minimum bonus)" v="8.33%" />
      <Row l="= Monthly bonus provision" v={inr(value ?? 583.10)} strong />
      <Cite>
        <b style={{color:'var(--ink)'}}>Payment of Bonus Act, 1965.</b> Minimum statutory bonus is
        <b> 8.33%</b> (max 20%) of wages, computed on a <b>wage ceiling of ₹7,000/month</b> (or minimum wage, if higher).
        8.33% × ₹7,000 = <b>₹583.10</b> per month.
      </Cite>
    </>
  )
}

const TITLES = {
  tds:      { t:'How TDS is calculated', s:'Income tax deducted at source · s.192' },
  gratuity: { t:'How Gratuity is calculated', s:'Payment of Gratuity Act, 1972' },
  bonus:    { t:'How Bonus is calculated', s:'Payment of Bonus Act, 1965' },
}

export default function SalaryHelpDrawer({ topic, data, onClose }) {
  if (!topic) return null
  const h = TITLES[topic]
  return createPortal(
    <>
      <div className="people-drawer-scrim" onClick={onClose} />
      <div className="people-drawer">
        <div className="pd-h">
          <div><div className="pd-h-t">{h.t}</div><div className="pd-h-s">{h.s}</div></div>
          <button className="pd-x" onClick={onClose}>✕</button>
        </div>
        <div className="pd-b">
          {topic==='tds' && <TdsBody calc={data?.calc} regime={data?.regime} />}
          {topic==='gratuity' && <GratuityBody basic={data?.basic} />}
          {topic==='bonus' && <BonusBody value={data?.bonus} />}
        </div>
      </div>
    </>,
    document.body
  )
}
