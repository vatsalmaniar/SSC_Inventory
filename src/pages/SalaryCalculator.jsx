import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { sb } from '../lib/supabase'
import { computeStructure, RATIOS } from '../lib/salaryStructure'
import Layout from '../components/Layout'
import SalaryHelpDrawer from '../components/SalaryHelpDrawer'
import { Spinner } from '../components/PeopleLoaders'
import '../styles/people.css'

const inr = n => n==null ? '—' : '₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:0})

const Line = ({ l, v, strong, onHelp }) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:12,padding:strong?'8px 0 0':'5px 0',marginTop:strong?4:0,borderTop:strong?'1px solid var(--line-2)':'none'}}>
    <span style={{fontSize:12.5,color:strong?'var(--ink)':'var(--muted)',fontWeight:strong?600:400,display:'inline-flex',alignItems:'center',gap:5}}>
      {l}
      {onHelp && <button onClick={onHelp} title="How this is calculated" style={{border:0,background:'none',cursor:'pointer',color:'var(--accent)',padding:0,display:'inline-flex'}}>
        <svg width="12.5" height="12.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="7.5"/><path d="M10 9v4M10 6.5h.01" strokeLinecap="round"/></svg>
      </button>}
    </span>
    <span style={{fontSize:strong?14:13,fontWeight:strong?600:500,color:'var(--ink)',fontFamily:"'Geist Mono',monospace"}}>{inr(v)}</span>
  </div>
)

const Field = ({ label, children, hint }) => (
  <div style={{marginBottom:14}}>
    <label style={{display:'block',fontSize:11,fontWeight:600,letterSpacing:'0.03em',textTransform:'uppercase',color:'var(--muted)',marginBottom:5}}>{label}</label>
    {children}
    {hint && <div style={{fontSize:11,color:'var(--muted-2)',marginTop:4}}>{hint}</div>}
  </div>
)
const inputStyle = { width:'100%', border:'1px solid var(--line)', borderRadius:8, padding:'9px 11px', font:'inherit', fontSize:14, color:'var(--ink)', background:'var(--surface)', boxSizing:'border-box' }

export default function SalaryCalculator() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [ctc, setCtc] = useState('1854000')
  const [ratio, setRatio] = useState('50 / 20 / 10 / 20')
  const [regime, setRegime] = useState('new')
  const [pf, setPf] = useState(false)
  const [pt, setPt] = useState('200')
  const [acc, setAcc] = useState('128')
  const [help, setHelp] = useState(null)

  useEffect(() => { (async () => {
    let { data: { session } } = await sb.auth.getSession()
    if (!session) { const { data } = await sb.auth.refreshSession(); if (!data?.session) { navigate('/login'); return }; session = data.session }
    const { data: prof } = await sb.from('profiles').select('role').eq('id', session.user.id).single()
    setAllowed(['admin','management'].includes(prof?.role))
    setLoading(false)
  })() }, [])

  const r = computeStructure({
    annualCtc: Number(ctc)||0, ratio, regime, pfApplicable: pf,
    professionalTax: Number(pt)||0, accidentalInsurance: Number(acc)||0,
  })

  if (loading) return <Layout pageKey="people" pageTitle="Salary Calculator"><div className="people-app"><Spinner /></div></Layout>
  if (!allowed) return <Layout pageKey="people" pageTitle="Salary Calculator"><div className="people-app"><div className="e-empty">Salary tools are visible to Admin &amp; Management only.</div></div></Layout>

  return (
    <Layout pageKey="people" pageTitle="Salary Calculator">
      <div className="people-app">
        <div className="ph">
          <div>
            <button onClick={()=>navigate('/people')} style={{background:'none',border:0,cursor:'pointer',color:'var(--muted)',display:'inline-flex',alignItems:'center',gap:4,fontSize:13,padding:0,marginBottom:4}}>
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{width:14,height:14}}><path d="M19 12H5M12 5l-7 7 7 7"/></svg>People
            </button>
            <h1 className="ph-title">Salary Calculator</h1>
            <div className="ph-sub">Enter CTC → full breakup + net payable, on our structure. For offers &amp; what-ifs.</div>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:16,alignItems:'start'}} className="salcalc-grid">
          {/* inputs */}
          <div className="acard" style={{padding:'18px 20px'}}>
            <Field label="Annual CTC (₹)">
              <input type="number" value={ctc} onChange={e=>setCtc(e.target.value)} style={inputStyle} placeholder="e.g. 1854000" />
              <div style={{fontSize:12,color:'var(--muted)',marginTop:6}}>Monthly CTC: <b style={{color:'var(--ink)'}}>{inr(r.monthlyCtc)}</b></div>
            </Field>
            <Field label="Split ratio · Basic / HRA / Travel / Special">
              <select value={ratio} onChange={e=>setRatio(e.target.value)} style={inputStyle}>
                {Object.keys(RATIOS).map(k=><option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Tax regime">
              <div style={{display:'inline-flex',gap:3,padding:3,background:'var(--bg)',borderRadius:9,width:'100%'}}>
                {['new','old'].map(x=>(
                  <button key={x} onClick={()=>setRegime(x)} style={{flex:1,border:0,cursor:'pointer',borderRadius:6,padding:'7px 0',fontSize:12.5,fontWeight:600,fontFamily:'inherit',color:regime===x?'#fff':'var(--muted)',background:regime===x?'var(--accent)':'transparent'}}>{x==='new'?'New':'Old'}</button>
                ))}
              </div>
            </Field>
            <Field label="PF applicable">
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                <input type="checkbox" checked={pf} onChange={e=>setPf(e.target.checked)} /> Deduct PF (₹1,800 employee / ₹1,950 employer)
              </label>
            </Field>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <Field label="Prof. Tax"><input type="number" value={pt} onChange={e=>setPt(e.target.value)} style={inputStyle} /></Field>
              <Field label="Accidental Ins."><input type="number" value={acc} onChange={e=>setAcc(e.target.value)} style={inputStyle} /></Field>
            </div>
          </div>

          {/* output */}
          <div className="acard">
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)'}}>
              <div style={{padding:'18px 20px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Annual CTC</div><div className="pmc-v" style={{fontSize:22}}>{inr(r.annualCtc)}</div></div>
              <div style={{padding:'18px 20px',borderRight:'1px solid var(--line-2)'}}><div className="pmc-l">Monthly Gross</div><div className="pmc-v" style={{fontSize:18}}>{inr(r.gross)}</div></div>
              <div style={{padding:'18px 20px'}}><div className="pmc-l">Annual TDS</div><div className="pmc-v" style={{fontSize:18}}>{inr(r.tax.totalTaxAnnual)}</div></div>
            </div>
            <div style={{borderTop:'1px solid var(--line-2)',display:'grid',gridTemplateColumns:'1fr 1fr'}}>
              <div style={{padding:'16px 20px',borderRight:'1px solid var(--line-2)'}}>
                <div className="pmc-l" style={{marginBottom:6}}>Earnings · {ratio}</div>
                <Line l="Basic" v={r.basic}/>
                <Line l="HRA" v={r.hra}/>
                <Line l="Travel Allowance" v={r.travelAllowance}/>
                <Line l="Special Allowance" v={r.specialAllowance}/>
                <Line l="Monthly Gross" v={r.gross} strong/>
              </div>
              <div style={{padding:'16px 20px'}}>
                <div className="pmc-l" style={{marginBottom:6}}>Deductions</div>
                {r.pfEmployee>0 && <Line l="PF (Employee)" v={r.pfEmployee}/>}
                {r.esicEmployee>0 && <Line l="ESIC (Employee)" v={r.esicEmployee}/>}
                <Line l="Professional Tax" v={r.professionalTax}/>
                <Line l="Accidental Insurance" v={r.accidentalInsurance}/>
                <Line l="Gratuity" v={r.gratuity} onHelp={()=>setHelp('gratuity')}/>
                <Line l="Bonus" v={r.bonus} onHelp={()=>setHelp('bonus')}/>
                <Line l="TDS" v={r.tds} onHelp={()=>setHelp('tds')}/>
                <Line l="Total Deductions" v={r.totalDeductions} strong/>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',padding:'16px 20px',borderTop:'1px solid var(--line-2)',background:'var(--bg)'}}>
              <div><div className="pmc-l">Net Payable / month</div><div className="pmc-v" style={{fontSize:24,color:'var(--st-present)'}}>{inr(r.netPayable)}</div></div>
              <div style={{fontSize:11.5,color:'var(--muted)',textAlign:'right'}}>
                Employer PF {inr(r.employerPf)} · ESIC {inr(r.employerEsic)}<br/>
                <span style={{color:'var(--muted-2)'}}>TDS on {regime==='old'?'Old':'New'} regime · gratuity &amp; bonus deducted upfront · excludes overtime</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <SalaryHelpDrawer topic={help} data={{ calc: r.tax, regime, basic: r.basic, bonus: r.bonus }} onClose={()=>setHelp(null)} />
      <style>{`@media (max-width:820px){ .salcalc-grid{ grid-template-columns:1fr !important; } }`}</style>
    </Layout>
  )
}
