// Income-tax / TDS calculator — FY 2026-27 (AY 2027-28).
// Slabs per Finance Act 2025, retained unchanged by Budget 2026.
// Pure, plain JS. No dependencies, no React/Supabase. Both regimes.
// Never persist the computed tax as source of truth — recompute on read.
// Values live in the FY map below so a future year is a new key, no code change.

const FY = {
  '2026-27': {
    new: {
      // [upTo, rate]
      slabs: [[400000,0],[800000,0.05],[1200000,0.10],[1600000,0.15],[2000000,0.20],[2400000,0.25],[Infinity,0.30]],
      standardDeduction: 75000,
      rebateMaxTaxable: 1200000, rebateAmount: 60000,
      surcharge: [[20000000,0.25],[10000000,0.15],[5000000,0.10]], // desc; 37% does NOT apply in new
      cess: 0.04,
    },
    old: {
      slabs: [[250000,0],[500000,0.05],[1000000,0.20],[Infinity,0.30]],
      standardDeduction: 50000,
      basicExemptionByAge: { below60:250000, '60to80':300000, above80:500000 },
      rebateMaxTaxable: 500000, rebateAmount: 12500,
      surcharge: [[50000000,0.37],[20000000,0.25],[10000000,0.15],[5000000,0.10]],
      cess: 0.04,
      hraMetro: 0.50, hraNonMetro: 0.40,
      caps: { c80C:150000, c80CCD1B:50000, homeLoan:200000 },
    },
  },
}

const round10 = n => Math.round(n/10)*10   // s.288A / s.288B

function slabTax(taxable, slabs) {
  let tax=0, prev=0; const breakup=[]
  for (const [upTo, rate] of slabs) {
    if (taxable <= prev) break
    const amt = Math.min(taxable, upTo) - prev
    if (amt > 0) { const t=amt*rate; breakup.push({ from:prev, to:upTo===Infinity?null:upTo, rate, amountInSlab:amt, tax:t }); tax+=t }
    prev = upTo
  }
  return { tax, breakup }
}

// old-regime age exemption implemented by shifting the first slab boundary
function slabsFor(regime, cfg, ageBracket) {
  if (regime !== 'old') return cfg.slabs
  const ex = cfg.basicExemptionByAge[ageBracket] ?? cfg.basicExemptionByAge.below60
  return cfg.slabs.map((s,i)=> i===0 ? [ex, s[1]] : s)
}

function rebateAndRelief(taxable, tax, cfg) {
  if (taxable <= cfg.rebateMaxTaxable) return { rebate: Math.min(tax, cfg.rebateAmount), marginalRelief:0 }
  const excess = taxable - cfg.rebateMaxTaxable            // s.87A marginal relief
  return { rebate:0, marginalRelief: Math.max(0, tax - excess) }
}

function surchargeWithRelief(taxable, tax, cfg, slabs) {
  const bands = cfg.surcharge
  let idx = -1
  for (let i=0;i<bands.length;i++){ if (taxable > bands[i][0]) { idx=i; break } }
  if (idx === -1) return { surcharge:0, relief:0 }
  const [T, R] = bands[idx]
  const prevRate = bands[idx+1] ? bands[idx+1][1] : 0
  let sc = tax * R
  const cap = slabTax(T, slabs).tax * (1 + prevRate) + (taxable - T)   // marginal relief at threshold T
  const relief = Math.max(0, (tax + sc) - cap)
  return { surcharge: sc - relief, relief }
}

// Core: tax on a given taxable income (this is what the fixtures exercise).
export function taxOnTaxable(taxable, { financialYear='2026-27', regime='new', ageBracket='below60' } = {}) {
  const cfg = FY[financialYear][regime]
  const slabs = slabsFor(regime, cfg, ageBracket)
  taxable = Math.max(0, taxable)
  const { tax: slabAmt, breakup } = slabTax(taxable, slabs)
  const { rebate, marginalRelief } = rebateAndRelief(taxable, slabAmt, cfg)
  const afterRebate = slabAmt - rebate - marginalRelief
  const { surcharge, relief: surchargeRelief } = surchargeWithRelief(taxable, afterRebate, cfg, slabs)
  const cess = (afterRebate + surcharge) * cfg.cess
  return {
    taxableIncome: taxable, slabBreakup: breakup, taxBeforeRebate: slabAmt,
    rebate87A: rebate, marginalRelief87A: marginalRelief,
    surcharge, surchargeMarginalRelief: surchargeRelief, cess,
    totalTaxAnnual: round10(afterRebate + surcharge + cess),   // s.288B
  }
}

// Full: from annual salary components → taxable income → tax → monthly TDS.
export function calculateTax(input) {
  const {
    financialYear='2026-27', regime='new', ageBracket='below60', cityType='metro',
    grossAnnual=0, basic=0, da=0, hra=0, rentPaidAnnual=0,
    deduction80C=0, deduction80D=0, deduction80CCD1B=0, homeLoanInterest=0, professionalTax=0,
    otherIncome=0, tdsAlreadyDeducted=0, monthsRemainingInFy=12,
  } = input
  const cfg = FY[financialYear][regime]
  const disallowed = []

  // s.10 HRA exemption (old regime only) — least of three, clamped at zero
  let hraExemption = 0
  if (regime === 'old' && hra > 0) {
    const pct = cityType === 'metro' ? cfg.hraMetro : cfg.hraNonMetro
    hraExemption = Math.max(0, Math.min(hra, rentPaidAnnual - 0.10*(basic+da), pct*(basic+da)))
  } else if (regime === 'new' && hra > 0) disallowed.push('HRA')

  const netSalary = grossAnnual - hraExemption
  const standardDeduction = Math.min(cfg.standardDeduction, netSalary)
  let income = netSalary - standardDeduction + otherIncome

  let chapterVIA = 0
  if (regime === 'old') {
    income -= Math.min(professionalTax, Math.max(0, income))     // s.16(iii)
    chapterVIA = Math.min(deduction80C, cfg.caps.c80C) + deduction80D
      + Math.min(deduction80CCD1B, cfg.caps.c80CCD1B) + Math.min(homeLoanInterest, cfg.caps.homeLoan)
    income -= chapterVIA
  } else {
    if (deduction80C>0) disallowed.push('80C')
    if (deduction80D>0) disallowed.push('80D')
    if (deduction80CCD1B>0) disallowed.push('80CCD(1B)')
    if (homeLoanInterest>0) disallowed.push('Home-loan interest')
    if (professionalTax>0) disallowed.push('Professional Tax')
  }

  income = Math.max(0, Math.floor(income/10)*10)                  // s.288A round-down
  const core = taxOnTaxable(income, { financialYear, regime, ageBracket })
  const monthly = monthsRemainingInFy > 0
    ? Math.max(0, Math.ceil((core.totalTaxAnnual - tdsAlreadyDeducted) / monthsRemainingInFy))
    : 0
  return {
    regime, grossAnnual, hraExemption, standardDeduction, chapterVIADeductions: chapterVIA,
    ...core, monthlyTds: monthly, disallowedInThisRegime: disallowed,
  }
}
