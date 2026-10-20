import rules from '../../data/2026/ca.json'
import { clampZero, positionIn, seniorsOnReturn, taxFromBrackets } from '../brackets'
import type { Bracket, IncomeType, JurisdictionResult, Line, MarginalFactor, TaxInputs } from '../types'

const ALL: IncomeType[] = ['wages', 'selfEmployment', 'taxableInterest', 'longTermGains']

/** The rate schedule with the 1% behavioral health tax folded in above its threshold. */
function scheduleWithSurtax(brackets: Bracket[]): Bracket[] {
  const { threshold, rate } = rules.behavioralHealthTax
  const out: Bracket[] = brackets.filter(([f]) => f < threshold).map(([f, r]) => [f, r])
  const atThreshold = brackets.filter(([f]) => f <= threshold).at(-1)![1]
  out.push([threshold, atThreshold + rate])
  for (const [f, r] of brackets) if (f > threshold) out.push([f, r + rate])
  return out
}

export function computeCalifornia(inp: TaxInputs, agi: number): JurisdictionResult {
  const s = inp.filingStatus
  const excessAgi = clampZero(agi - rules.highIncomeThreshold[s])

  // Itemized: no SALT cap, state income tax not deductible, 7.5% medical floor
  const medical = clampZero(inp.medical - rules.medicalFloorRate * agi)
  const charitable = Math.min(inp.charitable, rules.charitableLimitRate * agi)
  const itemizedGross = medical + inp.propertyTax + inp.mortgageInterest + charitable
  const itemizedLimit = Math.min(
    rules.itemizedLimit.excessRate * excessAgi,
    rules.itemizedLimit.maxShare * (itemizedGross - medical),
  )
  const itemized = itemizedGross - itemizedLimit
  const standard = rules.standardDeduction[s]
  const used = itemized > standard ? 'itemized' : 'standard'
  const deduction = Math.max(itemized, standard)

  const taxable = clampZero(agi - deduction)
  const bracketTax = taxFromBrackets(taxable, rules.brackets[s] as Bracket[])

  // Exemption credits, each reduced by $6 per $2,500 of AGI over the threshold
  const steps = Math.ceil(excessAgi / rules.creditPhaseout.stepSize[s])
  const cut = steps * rules.creditPhaseout.reductionPerStep
  const seniors = seniorsOnReturn(inp.filer65, inp.spouse65, s === 'mfj' || s === 'mfs')
  const personalCount = rules.personalCreditCount[s]
  const personal = clampZero(personalCount * rules.personalCredit + seniors * rules.seniorCredit - cut * (personalCount + seniors))
  const dependents = inp.childrenUnder17 + inp.otherDependents
  const dependent = clampZero(dependents * rules.dependentCredit - cut * dependents)
  const credits = Math.min(bracketTax, personal + dependent)

  const bhst = rules.behavioralHealthTax.rate * clampZero(taxable - rules.behavioralHealthTax.threshold)
  const tax = bracketTax - credits + bhst

  const lines: Line[] = [
    { key: 'agi', role: 'base', label: 'Adjusted gross income', amount: agi },
    { key: 'deduction', role: 'base', label: used === 'itemized' ? 'Itemized deductions' : 'Standard deduction', amount: -deduction },
  ]
  if (used === 'itemized') {
    if (medical > 0) lines.push({ label: 'Medical above 7.5% of AGI', amount: medical, detail: true })
    if (inp.propertyTax > 0) lines.push({ label: 'Property tax (no cap)', amount: inp.propertyTax, detail: true })
    if (inp.mortgageInterest > 0) lines.push({ label: 'Mortgage interest', amount: inp.mortgageInterest, detail: true })
    if (charitable > 0) lines.push({ label: 'Charitable gifts', amount: charitable, detail: true })
    if (itemizedLimit > 0) lines.push({ label: 'High-income limit', amount: -itemizedLimit, detail: true })
  }
  lines.push({ key: 'taxable', role: 'base', label: 'Taxable income', amount: taxable })
  lines.push({ key: 'stateTax', role: 'tax', label: 'Tax (gains taxed as ordinary income)', amount: bracketTax })
  if (credits > 0) lines.push({ key: 'exemptionCredits', role: 'tax', label: 'Exemption credits', amount: -credits })
  if (bhst > 0) lines.push({ key: 'behavioralHealthTax', role: 'tax', label: 'Behavioral health tax (1% over $1M)', amount: bhst })

  const factors: MarginalFactor[] = []
  if (used === 'itemized' && medical > 0) {
    factors.push({ text: 'California: the medical deduction shrinks by 7.5¢ for each extra dollar.', appliesTo: ALL })
  }
  if (used === 'itemized' && itemizedLimit > 0 && itemizedLimit < rules.itemizedLimit.maxShare * (itemizedGross - medical)) {
    factors.push({ text: 'California: the high-income limit takes back 6¢ of itemized deductions per extra dollar.', appliesTo: ALL })
  }

  return {
    name: 'California',
    totalLabel: 'Total state tax',
    tax,
    saltEligibleTax: tax,
    deduction: { standard, itemized, used },
    lines,
    notes: ['California taxes capital gains and qualified dividends as ordinary income.'],
    positions: [{ label: 'All income', unit: 'taxable income', ...positionIn(scheduleWithSurtax(rules.brackets[s] as Bracket[]), taxable) }],
    factors,
  }
}
