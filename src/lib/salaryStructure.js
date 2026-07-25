// Reverse salary structure — Annual CTC → monthly breakup → net payable, per SSC structure.
// Pure. Reuses the tax engine for TDS. No React/Supabase.
import { calculateTax } from './tax'

export const RATIOS = {
  '50 / 20 / 10 / 20': [0.50, 0.20, 0.10, 0.20],
  '55 / 20 / 15 / 10': [0.55, 0.20, 0.15, 0.10],
  '60 / 20 / 10 / 10': [0.60, 0.20, 0.10, 0.10],
  '40 / 20 / 20 / 20': [0.40, 0.20, 0.20, 0.20],
}

const PF_WAGE_CEILING = 15000        // PF computed on basic capped at ₹15,000
const ESIC_GROSS_CEILING = 21000     // ESIC applies only up to ₹21,000 gross
const BONUS_MONTHLY = 0.0833 * 7000  // Payment of Bonus Act — 8.33% of ₹7,000 = ₹583.10
const GRATUITY_PCT = 0.0481          // Payment of Gratuity Act — 4.81% of basic

export function computeStructure({
  annualCtc = 0, ratio = '50 / 20 / 10 / 20', regime = 'new',
  pfApplicable = false, professionalTax = 200, accidentalInsurance = 128,
} = {}) {
  const [rB, rH, rT, rS] = RATIOS[ratio] || RATIOS['50 / 20 / 10 / 20']
  const monthlyCtc = annualCtc / 12

  // CTC = Gross + Employer PF + Employer ESIC → solve for Gross
  let employerPf = 0, gross = 0, basic = 0
  if (pfApplicable) {
    gross = monthlyCtc - 0.13 * PF_WAGE_CEILING       // assume basic ≥ ceiling (PF capped ₹1,950)
    basic = rB * gross
    if (basic < PF_WAGE_CEILING) {                    // low salary → PF on actual basic
      gross = monthlyCtc / (1 + 0.13 * rB); basic = rB * gross; employerPf = 0.13 * basic
    } else employerPf = 0.13 * PF_WAGE_CEILING
  } else { gross = monthlyCtc; basic = rB * gross }

  let employerEsic = 0, esicEmployee = 0
  if (gross <= ESIC_GROSS_CEILING) {                  // rare — only very low salaries
    gross = (monthlyCtc - employerPf) / 1.0325
    basic = rB * gross
    employerEsic = 0.0325 * gross
    esicEmployee = 0.0075 * gross
  }

  const hra = rH * gross, travelAllowance = rT * gross, specialAllowance = rS * gross
  const pfEmployee = pfApplicable ? 0.12 * Math.min(basic, PF_WAGE_CEILING) : 0
  const gratuity = GRATUITY_PCT * basic
  const bonus = BONUS_MONTHLY

  const tax = calculateTax({
    regime, grossAnnual: gross * 12, basic: basic * 12,
    professionalTax: professionalTax * 12, monthsRemainingInFy: 12,
  })
  const tds = tax.monthlyTds

  const totalDeductions = pfEmployee + esicEmployee + professionalTax + accidentalInsurance + gratuity + bonus + tds
  const netPayable = gross - totalDeductions

  return {
    annualCtc, monthlyCtc, ratio, regime,
    gross, basic, hra, travelAllowance, specialAllowance,
    employerPf, employerEsic, pfEmployee, esicEmployee,
    professionalTax, accidentalInsurance, gratuity, bonus, tds,
    totalDeductions, netPayable, tax,
  }
}
