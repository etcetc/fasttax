import rules from '../data/2026/federal.json'
import { clampZero, positionIn, seniorsOnReturn, taxFromBrackets } from './brackets'
import { dollars as fmt } from './format'
import { additionalMedicareTax, type selfEmploymentTax } from './payroll'
import type {
  Bracket, BracketPosition, FilingStatus, IncomeType, JurisdictionResult, Line, MarginalFactor, TaxInputs,
} from './types'

const isMarried = (s: FilingStatus) => s === 'mfj' || s === 'mfs'
const EARNED: IncomeType[] = ['wages', 'selfEmployment']
const ORDINARY: IncomeType[] = ['wages', 'selfEmployment', 'taxableInterest']
const INVESTMENT: IncomeType[] = ['taxableInterest', 'longTermGains']
const ALL: IncomeType[] = [...ORDINARY, 'longTermGains']

type SelfEmployment = ReturnType<typeof selfEmploymentTax>

export function saltCap(status: FilingStatus, agi: number): number {
  const { cap, phaseoutStart, phaseoutRate, floor } = rules.salt
  const reduced = cap[status] - phaseoutRate * clampZero(agi - phaseoutStart[status])
  return Math.max(floor[status], reduced)
}

function seniorPhaseoutStart(s: FilingStatus): number {
  return rules.seniorDeduction.phaseoutStart[s as 'single' | 'mfj' | 'hoh']
}

export function seniorDeduction(inp: TaxInputs, agi: number): number {
  const s = inp.filingStatus
  if (s === 'mfs' && !rules.seniorDeduction.allowedForMfs) return 0
  const people = seniorsOnReturn(inp.filer65, inp.spouse65, s === 'mfj')
  if (people === 0) return 0
  const perPerson = clampZero(rules.seniorDeduction.perPerson - rules.seniorDeduction.phaseoutRate * clampZero(agi - seniorPhaseoutStart(s)))
  return perPerson * people
}

export function standardDeduction(inp: TaxInputs): number {
  const s = inp.filingStatus
  const people = seniorsOnReturn(inp.filer65, inp.spouse65, isMarried(s))
  const extra = isMarried(s) ? rules.additionalStandardDeduction65.married : rules.additionalStandardDeduction65.unmarried
  return rules.standardDeduction[s] + people * extra
}

/** Regular tax with qualified dividends and long-term gains taxed at 0/15/20%. */
export function incomeTax(taxable: number, preferentialIncome: number, status: FilingStatus) {
  const pref = Math.min(taxable, preferentialIncome)
  const ordinary = taxable - pref
  const ordinaryTax = taxFromBrackets(ordinary, rules.brackets[status] as Bracket[])
  const zeroTop = rules.capitalGains.zeroRateTop[status]
  const fifteenTop = rules.capitalGains.fifteenRateTop[status]
  const atZero = Math.min(pref, clampZero(zeroTop - ordinary))
  const atFifteen = Math.min(pref - atZero, clampZero(fifteenTop - ordinary - atZero))
  const atTwenty = pref - atZero - atFifteen
  const prefTax = atFifteen * 0.15 + atTwenty * 0.2
  return { ordinary, ordinaryTax, atZero, atFifteen, atTwenty, prefTax, total: ordinaryTax + prefTax }
}

/**
 * Section 199A deduction for a sole proprietor with no employees or business property.
 * Above the threshold it phases out over the range; it never exceeds 20% of taxable
 * income less net capital gain. The $400 minimum (OBBBA) applies from $1,000 of QBI.
 */
export function qbiDeduction(qbi: number, taxableBeforeQbi: number, netCapitalGain: number, s: FilingStatus) {
  const q = rules.qbi
  if (qbi <= 0) return { deduction: 0, phaseOut: 0 }
  const phaseOut = Math.min(1, clampZero(taxableBeforeQbi - q.threshold[s]) / q.phaseInRange[s])
  const tentative = q.rate * qbi * (1 - phaseOut)
  let deduction = Math.min(tentative, q.rate * clampZero(taxableBeforeQbi - netCapitalGain))
  if (qbi >= q.minimumQbi) deduction = Math.max(deduction, q.minimumDeduction)
  return { deduction: Math.min(deduction, taxableBeforeQbi), phaseOut }
}

/** Schedule 8812: nonrefundable credit up to tax owed, then the refundable part from earnings. */
function childCredits(inp: TaxInputs, agi: number, incomeTaxOwed: number, earnedIncome: number) {
  const c = rules.childTaxCredit
  const gross = inp.childrenUnder17 * c.perChild + inp.otherDependents * c.perOtherDependent
  const steps = Math.ceil(clampZero(agi - c.phaseoutStart[inp.filingStatus]) / 1000)
  const afterPhaseout = clampZero(gross - steps * c.reductionPer1000)
  const nonrefundable = Math.min(afterPhaseout, incomeTaxOwed)
  const earnedLimit = c.refundableRate * clampZero(earnedIncome - c.earnedIncomeFloor)
  const refundable = Math.min(afterPhaseout - nonrefundable, inp.childrenUnder17 * c.refundablePerChild, earnedLimit)
  return { gross, afterPhaseout, nonrefundable, refundable, earnedLimitBinds: refundable > 0 && refundable === earnedLimit }
}

export function computeFederal(inp: TaxInputs, agi: number, stateIncomeTax: number, se: SelfEmployment): JurisdictionResult {
  const s = inp.filingStatus
  const preferential = inp.qualifiedDividends + inp.longTermGains
  const investmentIncome = inp.taxableInterest + inp.qualifiedDividends + inp.nonQualifiedDividends + inp.longTermGains
  const businessIncome = clampZero(inp.selfEmployment - se.deductibleHalf)

  // Itemized deductions (Schedule A)
  const medical = clampZero(inp.medical - rules.medicalFloorRate * agi)
  const saltPaid = stateIncomeTax + inp.propertyTax
  const capNow = saltCap(s, agi)
  const salt = Math.min(saltPaid, capNow)
  const charitableItemized = Math.min(
    clampZero(inp.charitable - rules.charitable.itemizerFloorRate * agi),
    rules.charitable.cashLimitRate * agi,
  )
  const itemizedGross = medical + salt + inp.mortgageInterest + charitableItemized

  const standard = standardDeduction(inp)
  const nonItemizerCharity = Math.min(inp.charitable, rules.charitable.nonItemizerMax[s])
  const senior = seniorDeduction(inp, agi)

  // Itemized path, including the 2/37 limit for the 37% bracket
  const taxableBeforeLimit = clampZero(agi - itemizedGross - senior)
  const top37 = (rules.brackets[s] as Bracket[]).at(-1)![0]
  const itemizedLimit = rules.itemizedLimit.fraction *
    Math.min(itemizedGross, clampZero(taxableBeforeLimit + itemizedGross - top37))
  const itemized = itemizedGross - itemizedLimit

  const paths = (['standard', 'itemized'] as const).map((used) => {
    const deduction = used === 'standard' ? standard + nonItemizerCharity : itemized
    const beforeQbi = clampZero(agi - deduction - senior)
    const qbi = qbiDeduction(businessIncome, beforeQbi, preferential, s)
    const taxable = clampZero(beforeQbi - qbi.deduction)
    return { used, deduction, qbi, taxable, tax: incomeTax(taxable, preferential, s) }
  })
  const best = paths[1].tax.total < paths[0].tax.total ? paths[1] : paths[0]

  const earnedIncome = clampZero(inp.wages) + businessIncome
  const credit = childCredits(inp, agi, best.tax.total, earnedIncome)
  const addlMedicare = additionalMedicareTax(inp, se.netEarnings)
  const niitBase = Math.min(investmentIncome, clampZero(agi - rules.niit.threshold[s]))
  const niit = rules.niit.rate * niitBase

  const total = best.tax.total - credit.nonrefundable - credit.refundable + se.total + addlMedicare + niit

  // ── Breakdown ──
  const grossIncome = clampZero(inp.wages) + inp.selfEmployment + investmentIncome
  const lines: Line[] = []
  if (se.deductibleHalf > 0) {
    lines.push({ key: 'grossIncome', role: 'base', label: 'Total income', amount: grossIncome })
    lines.push({ key: 'halfSeTax', role: 'base', label: 'Half of self-employment tax', amount: -se.deductibleHalf })
  }
  lines.push({ key: 'agi', role: 'base', label: 'Adjusted gross income', amount: agi })
  if (best.used === 'standard') {
    lines.push({ key: 'deduction', role: 'base', label: 'Standard deduction', amount: -standard })
    if (nonItemizerCharity > 0) lines.push({ key: 'nonItemizerCharity', role: 'base', label: 'Charitable deduction for non-itemizers', amount: -nonItemizerCharity })
  } else {
    lines.push({ key: 'deduction', role: 'base', label: 'Itemized deductions', amount: -itemized })
    if (medical > 0) lines.push({ label: 'Medical above 7.5% of AGI', amount: medical, detail: true })
    if (salt > 0) lines.push({ label: saltPaid > salt ? `State & local taxes (capped at ${fmt(salt)})` : 'State & local taxes', amount: salt, detail: true })
    if (inp.mortgageInterest > 0) lines.push({ label: 'Mortgage interest', amount: inp.mortgageInterest, detail: true })
    if (charitableItemized > 0) lines.push({ label: 'Charitable gifts above 0.5% of AGI', amount: charitableItemized, detail: true })
    if (itemizedLimit > 0) lines.push({ label: 'Limit for the 37% bracket', amount: -itemizedLimit, detail: true })
  }
  if (senior > 0) lines.push({ key: 'seniorDeduction', role: 'base', label: 'Senior deduction (65+)', amount: -senior })
  if (best.qbi.deduction > 0) lines.push({ key: 'qbi', role: 'base', label: 'Qualified business income deduction', amount: -best.qbi.deduction })
  lines.push({ key: 'taxable', role: 'base', label: 'Taxable income', amount: best.taxable })
  lines.push({ key: 'ordinaryTax', role: 'tax', label: 'Tax on ordinary income', amount: best.tax.ordinaryTax })
  if (best.tax.ordinary > 0) lines.push({ label: `on ${fmt(best.tax.ordinary)} of wages, 1099, interest and other dividends`, amount: best.tax.ordinaryTax, detail: true })
  lines.push({ key: 'gainsTax', role: 'tax', label: 'Tax on qualified dividends and long-term gains', amount: best.tax.prefTax })
  if (best.tax.atZero > 0) lines.push({ label: `${fmt(best.tax.atZero)} at 0%`, amount: 0, detail: true })
  if (best.tax.atFifteen > 0) lines.push({ label: `${fmt(best.tax.atFifteen)} at 15%`, amount: best.tax.atFifteen * 0.15, detail: true })
  if (best.tax.atTwenty > 0) lines.push({ label: `${fmt(best.tax.atTwenty)} at 20%`, amount: best.tax.atTwenty * 0.2, detail: true })
  if (credit.nonrefundable > 0) lines.push({ key: 'childCredit', role: 'tax', label: 'Child and dependent credits', amount: -credit.nonrefundable })
  if (credit.refundable > 0) lines.push({ key: 'refundableChildCredit', role: 'tax', label: 'Refundable child tax credit', amount: -credit.refundable })
  if (se.total > 0) lines.push({ key: 'seTax', role: 'tax', label: 'Self-employment tax (Social Security and Medicare)', amount: se.total })
  if (addlMedicare > 0) lines.push({ key: 'additionalMedicare', role: 'tax', label: 'Additional Medicare tax (0.9%)', amount: addlMedicare })
  if (niit > 0) lines.push({ key: 'niit', role: 'tax', label: 'Net investment income tax (3.8%)', amount: niit })

  const notes: string[] = []
  const unused = credit.afterPhaseout - credit.nonrefundable - credit.refundable
  if (unused > 0.5) {
    notes.push(earnedIncome > 0
      ? `${fmt(unused)} of the child tax credit goes unused: the refundable part is limited by earnings and capped at ${fmt(rules.childTaxCredit.refundablePerChild)} per child.`
      : 'Part of the child tax credit goes unused: with no wages or 1099 income, none of it is refundable.')
  }
  if (best.qbi.deduction > 0) notes.push('The QBI deduction assumes a business with no employees or equipment.')

  // ── Where income sits on the rate schedules ──
  const zeroTop = rules.capitalGains.zeroRateTop[s]
  const fifteenTop = rules.capitalGains.fifteenRateTop[s]
  const positions: BracketPosition[] = [
    { label: 'Ordinary income', unit: 'taxable income', ...positionIn(rules.brackets[s] as Bracket[], best.tax.ordinary) },
    { label: 'Gains & qualified dividends', unit: 'taxable income', ...positionIn([[0, 0], [zeroTop, 0.15], [fifteenTop, 0.2]], best.taxable) },
  ]
  if (investmentIncome > 0) {
    const t = rules.niit.threshold[s]
    positions.push(agi < t
      ? { label: 'Net investment income tax', rate: 0, nextRate: rules.niit.rate, headroom: t - agi, unit: 'income' }
      : { label: 'Net investment income tax', rate: rules.niit.rate, nextRate: null, headroom: null, unit: 'income' })
  }

  // ── What makes the true marginal rate differ from the bracket rate ──
  const factors: MarginalFactor[] = []
  const ord = best.tax.ordinary
  if (preferential > 0 && ord < zeroTop && best.taxable >= zeroTop) {
    factors.push({ text: 'Each extra dollar of ordinary income pushes a dollar of gains out of the 0% rate into 15%.', appliesTo: ORDINARY })
  }
  if (preferential > 0 && ord < fifteenTop && best.taxable >= fifteenTop) {
    factors.push({ text: 'Each extra dollar of ordinary income pushes a dollar of gains from 15% into 20%.', appliesTo: ORDINARY })
  }
  if (senior > 0 && agi > seniorPhaseoutStart(s)) {
    factors.push({ text: 'The senior deduction shrinks by 6¢ for each extra dollar of income.', appliesTo: ALL })
  }
  if (best.used === 'itemized' && saltPaid > capNow && agi > rules.salt.phaseoutStart[s] && capNow > rules.salt.floor[s]) {
    factors.push({ text: 'The SALT cap shrinks by 30¢ for each extra dollar of income.', appliesTo: ALL })
  }
  if (best.used === 'itemized' && medical > 0) {
    factors.push({ text: 'The medical deduction shrinks by 7.5¢ for each extra dollar of income.', appliesTo: ALL })
  }
  if (credit.nonrefundable + credit.refundable > 0 && agi > rules.childTaxCredit.phaseoutStart[s]) {
    factors.push({ text: 'The child tax credit drops $50 for each extra $1,000 of income.', appliesTo: ALL })
  }
  if (credit.earnedLimitBinds) {
    factors.push({ text: 'Each extra dollar of earnings raises the refundable child credit by 15¢.', appliesTo: EARNED })
  }
  if (se.total > 0) {
    factors.push({
      text: inp.wages + se.netEarnings > rules.payroll.wageBase
        ? 'Self-employment tax adds 2.9% for Medicare above the Social Security wage base; half of it is deductible.'
        : 'Self-employment tax adds about 14% (15.3% of 92.35%); half of it is deductible.',
      appliesTo: ['selfEmployment'],
    })
  }
  if (se.netEarnings > 0 && inp.wages < rules.payroll.wageBase && inp.wages + se.netEarnings > rules.payroll.wageBase) {
    factors.push({
      text: 'Extra wages use up more of the Social Security wage base, so less 1099 income pays the 12.4% Social Security part of self-employment tax.',
      appliesTo: ['wages'],
    })
  }
  if (best.used === 'itemized' && stateIncomeTax > 0 && saltPaid < capNow) {
    factors.push({ text: 'State tax on extra income is deductible here, because you itemize and are under the SALT cap.', appliesTo: ALL })
  }
  if (best.qbi.deduction > 0 && best.qbi.phaseOut === 0) {
    factors.push({ text: '1099 income gets a 20% qualified business income deduction.', appliesTo: ['selfEmployment'] })
  }
  if (best.qbi.phaseOut > 0 && best.qbi.phaseOut < 1) {
    factors.push({ text: 'The QBI deduction is phasing out, so any extra income also loses part of it.', appliesTo: ALL })
  }
  if (addlMedicare > 0) {
    factors.push({ text: 'Earnings above the threshold pay the 0.9% Additional Medicare tax.', appliesTo: EARNED })
  }
  if (niit > 0) {
    factors.push({
      text: 'Investment income pays the 3.8% net investment income tax.',
      appliesTo: niitBase < investmentIncome ? ALL : INVESTMENT,
    })
  }

  return {
    name: 'Federal',
    totalLabel: 'Total federal tax',
    tax: total,
    saltEligibleTax: 0,
    deduction: { standard: standard + nonItemizerCharity, itemized, used: best.used },
    lines,
    notes,
    positions,
    factors,
    gainsSplit: { atZero: best.tax.atZero, atFifteen: best.tax.atFifteen, atTwenty: best.tax.atTwenty },
    federalContext: {
      agi,
      taxableIncome: best.taxable,
      incomeTax: best.tax.total - credit.nonrefundable,
      standardDeduction: standard,
      itemizes: best.used === 'itemized',
    },
  }
}
