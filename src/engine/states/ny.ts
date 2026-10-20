import rules from '../../data/2026/ny.json'
import { clampZero, positionIn, taxFromBrackets } from '../brackets'
import type { Bracket, FilingStatus, IncomeType, JurisdictionResult, Line, MarginalFactor, TaxInputs } from '../types'

const ALL: IncomeType[] = ['wages', 'selfEmployment', 'taxableInterest', 'longTermGains']

/** NY's phase-in fraction: min(excess, 50,000) / 50,000, rounded to four places. */
function phaseIn(excess: number, width: number): number {
  return Math.round((Math.min(clampZero(excess), width) / width) * 10000) / 10000
}

/** True while extra NY AGI is still phasing in the supplemental tax. */
export function recapturePhasingIn(taxable: number, nyAgi: number, status: FilingStatus): boolean {
  const r = rules.recapture
  if (nyAgi <= r.startAgi || nyAgi > r.topRateAgi) return false
  if (taxable <= r.firstTier[status].upTo) return nyAgi < r.startAgi + r.phaseInWidth
  const tiers = r.tiers[status] as [number, number, number][]
  const [floor] = tiers.filter(([f]) => taxable > f).at(-1)!
  return nyAgi - floor < r.phaseInWidth
}

/**
 * NYS tax including the supplemental "recapture" tax, which takes back the benefit of the
 * lower brackets once NY AGI passes $107,650 (IT-2105-I tax computation worksheets).
 */
export function nyStateTax(taxable: number, nyAgi: number, status: FilingStatus): number {
  const brackets = rules.brackets[status] as Bracket[]
  const scheduleTax = taxFromBrackets(taxable, brackets)
  const r = rules.recapture
  if (nyAgi <= r.startAgi) return scheduleTax
  if (nyAgi > r.topRateAgi) return r.topRate * taxable

  const first = r.firstTier[status]
  if (taxable <= first.upTo) {
    const flat = first.flatRate * taxable
    if (nyAgi >= r.startAgi + r.phaseInWidth) return flat
    return scheduleTax + (flat - scheduleTax) * phaseIn(nyAgi - r.startAgi, r.phaseInWidth)
  }
  const tiers = r.tiers[status] as [number, number, number][]
  const [floor, base, increment] = tiers.filter(([f]) => taxable > f).at(-1)!
  return scheduleTax + base + increment * phaseIn(nyAgi - floor, r.phaseInWidth)
}

function nyItemized(inp: TaxInputs, agi: number) {
  const s = inp.filingStatus
  const it = rules.itemized
  const medical = clampZero(inp.medical - it.medicalFloorRate * agi)
  const charitable = Math.min(inp.charitable, 0.5 * agi)
  const gross = medical + inp.propertyTax + inp.mortgageInterest + charitable

  // Old federal "Pease" reduction, which NY still applies
  const p = it.federalAgiReduction
  const pease = Math.min(p.excessRate * clampZero(agi - p.threshold[s]), p.maxShare * (gross - medical))
  const afterPease = gross - pease

  // NY AGI-based reduction (Tax Law 615(f), (g))
  const n = it.nyAgiReduction
  let itemized: number
  if (agi > n.charityOnlyAbove) {
    itemized = charitable * (agi > n.tenMillion ? n.charityShareAbove10M : n.charityShareUpTo10M)
  } else if (agi > n.secondStepTop) {
    itemized = afterPease * 0.5
  } else if (agi > n.firstStepTop) {
    itemized = afterPease - afterPease * 0.25 - afterPease * 0.25 * phaseIn(agi - n.firstStepTop, n.phaseInWidth)
  } else if (agi > n.threshold[s]) {
    itemized = afterPease - afterPease * 0.25 * phaseIn(agi - n.threshold[s], n.phaseInWidth)
  } else {
    itemized = afterPease
  }
  return { medical, charitable, gross, itemized }
}

function empireChildCredit(inp: TaxInputs, agi: number): number {
  const c = rules.empireChildCredit
  const under4 = Math.min(inp.childrenUnder4, inp.childrenUnder17)
  const gross = under4 * c.under4 + (inp.childrenUnder17 - under4) * c.age4to16
  const steps = Math.ceil(clampZero(agi - c.phaseoutStart[inp.filingStatus]) / 1000)
  return clampZero(gross - steps * c.reductionPer1000)
}

export function computeNewYork(inp: TaxInputs, agi: number): JurisdictionResult {
  const s = inp.filingStatus
  const { medical, charitable, gross, itemized } = nyItemized(inp, agi)
  const standard = rules.standardDeduction[s]
  const used = itemized > standard ? 'itemized' : 'standard'
  const deduction = Math.max(itemized, standard)
  const dependents = inp.childrenUnder17 + inp.otherDependents
  const exemptions = dependents * rules.dependentExemption

  const taxable = clampZero(agi - deduction - exemptions)
  const stateTax = nyStateTax(taxable, agi, s)
  const scheduleOnly = taxFromBrackets(taxable, rules.brackets[s] as Bracket[])
  const recapture = stateTax - scheduleOnly
  const childCredit = empireChildCredit(inp, agi)
  const nycTax = inp.nycResident ? taxFromBrackets(taxable, rules.nyc.brackets[s] as Bracket[]) : 0
  const tax = stateTax + nycTax - childCredit

  const lines: Line[] = [
    { key: 'agi', role: 'base', label: 'Adjusted gross income', amount: agi },
    { key: 'deduction', role: 'base', label: used === 'itemized' ? 'Itemized deductions' : 'Standard deduction', amount: -deduction },
  ]
  if (used === 'itemized') {
    if (medical > 0) lines.push({ label: 'Medical above 10% of AGI', amount: medical, detail: true })
    if (inp.propertyTax > 0) lines.push({ label: 'Property tax (no cap)', amount: inp.propertyTax, detail: true })
    if (inp.mortgageInterest > 0) lines.push({ label: 'Mortgage interest', amount: inp.mortgageInterest, detail: true })
    if (charitable > 0) lines.push({ label: 'Charitable gifts', amount: charitable, detail: true })
    if (gross > itemized) lines.push({ label: 'High-income reductions', amount: itemized - gross, detail: true })
  }
  if (exemptions > 0) lines.push({ key: 'exemptions', role: 'base', label: 'Dependent exemptions', amount: -exemptions })
  lines.push({ key: 'taxable', role: 'base', label: 'Taxable income', amount: taxable })
  lines.push({ key: 'stateTax', role: 'tax', label: 'State tax (gains taxed as ordinary income)', amount: scheduleOnly })
  if (recapture > 0.005) lines.push({ key: 'recapture', role: 'tax', label: 'Supplemental tax (recaptures lower brackets)', amount: recapture })
  if (childCredit > 0) lines.push({ key: 'childCredit', role: 'tax', label: 'Empire State child credit', amount: -childCredit })
  if (nycTax > 0) lines.push({ key: 'nycTax', role: 'tax', label: 'New York City resident tax', amount: nycTax })

  const notes = ['New York taxes capital gains and qualified dividends as ordinary income.']
  if (inp.nycResident) notes.push('NYC household and school tax credits are not included.')

  const factors: MarginalFactor[] = []
  if (recapturePhasingIn(taxable, agi, s)) {
    factors.push({ text: "New York: the supplemental tax is phasing in, taking back the benefit of the lower brackets.", appliesTo: ALL })
  }
  if (used === 'itemized' && gross > itemized && agi > rules.itemized.nyAgiReduction.threshold[s] && agi <= rules.itemized.nyAgiReduction.charityOnlyAbove) {
    factors.push({ text: 'New York: itemized deductions shrink as income rises.', appliesTo: ALL })
  }
  if (childCredit > 0 && agi > rules.empireChildCredit.phaseoutStart[s]) {
    factors.push({ text: 'New York: the Empire State child credit drops $16.50 per extra $1,000.', appliesTo: ALL })
  }

  const positions = [{ label: 'New York State', unit: 'taxable income', ...positionIn(rules.brackets[s] as Bracket[], taxable) }]
  if (inp.nycResident) positions.push({ label: 'New York City', unit: 'taxable income', ...positionIn(rules.nyc.brackets[s] as Bracket[], taxable) })

  return {
    name: inp.nycResident ? 'New York + NYC' : 'New York',
    totalLabel: 'Total state tax',
    positions,
    factors,
    tax,
    saltEligibleTax: clampZero(stateTax + nycTax),
    deduction: { standard, itemized, used },
    lines,
    notes,
  }
}
