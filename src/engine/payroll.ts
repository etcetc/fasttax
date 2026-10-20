import rules from '../data/2026/federal.json'
import ca from '../data/2026/ca.json'
import { clampZero } from './brackets'
import type { JurisdictionResult, Line, TaxInputs } from './types'

/** Schedule SE: self-employment tax on 1099 profit. */
export function selfEmploymentTax(inp: TaxInputs) {
  const se = rules.selfEmployment
  const netEarnings = clampZero(inp.selfEmployment) * se.earningsFactor
  if (netEarnings < se.minimumNetEarnings) {
    return { netEarnings: 0, socialSecurity: 0, medicare: 0, total: 0, deductibleHalf: 0 }
  }
  // W-2 wages use up the Social Security wage base first.
  const ssRoom = clampZero(rules.payroll.wageBase - inp.wages)
  const socialSecurity = se.socialSecurityRate * Math.min(netEarnings, ssRoom)
  const medicare = se.medicareRate * netEarnings
  const total = socialSecurity + medicare
  return { netEarnings, socialSecurity, medicare, total, deductibleHalf: total / 2 }
}

/** Form 8959: 0.9% on wages and self-employment earnings above the threshold. */
export function additionalMedicareTax(inp: TaxInputs, seNetEarnings: number): number {
  const a = rules.additionalMedicare
  const threshold = a.threshold[inp.filingStatus]
  const onWages = clampZero(inp.wages - threshold)
  const onSe = clampZero(seNetEarnings - clampZero(threshold - inp.wages))
  return a.rate * (onWages + onSe)
}

/** Employee payroll taxes withheld from W-2 wages. Reported, but not part of income tax. */
export function computePayroll(inp: TaxInputs): JurisdictionResult {
  const p = rules.payroll
  const wages = clampZero(inp.wages)
  const socialSecurity = p.socialSecurityRate * Math.min(wages, p.wageBase)
  const medicare = p.medicareRate * wages
  const sdi = inp.state === 'CA' ? ca.sdi.rate * wages : 0
  const lines: Line[] = []
  if (wages > 0) {
    lines.push({ key: 'socialSecurity', role: 'tax', label: `Social Security (6.2% up to $${p.wageBase.toLocaleString('en-US')})`, amount: socialSecurity })
    lines.push({ key: 'medicare', role: 'tax', label: 'Medicare (1.45%)', amount: medicare })
    if (sdi > 0) lines.push({ key: 'sdi', role: 'tax', label: 'California SDI (1.3%)', amount: sdi })
  }
  return {
    name: 'Payroll taxes',
    totalLabel: 'Total withheld from wages',
    tax: socialSecurity + medicare + sdi,
    // California SDI is a state income tax for the federal SALT deduction.
    saltEligibleTax: sdi,
    lines,
    notes: wages > 0 ? ['Withheld from your pay, so not counted in the income tax total above.'] : [],
    positions: [],
    factors: [],
  }
}
