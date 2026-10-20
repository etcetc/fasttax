import { clampZero, positionIn, taxFromBrackets } from '../brackets'
import { dollars } from '../format'
import type {
  Bracket, ByStatus, FederalContext, FilingStatus, IncomeType, JurisdictionResult, Line, MarginalFactor, TaxInputs,
} from '../types'

export type { FederalContext }

// The contract for these rules is GENERIC_STATE_SPEC.md; keep the two in step.

export interface Phaseout {
  basis?: 'agi' | 'federalAgi'
  start: ByStatus<number>
  end?: ByStatus<number>
  ratePerDollar?: number
}

export interface GenericStateRules {
  state: string
  name: string
  year: number
  dataYear: number
  sources: string[]
  provisional: string[]
  notes: string[]
  startingPoint: 'federalAgi' | 'federalTaxable'
  brackets: ByStatus<Bracket[]>
  standardDeduction?: { amount: ByStatus<number> | 'federal'; seniorExtra?: number; phaseout?: Phaseout }
  itemized?: {
    medicalFloorRate: number | null
    propertyTax: boolean
    mortgageInterest: boolean
    charitable: boolean
    saltCap: ByStatus<number> | null
    requiresFederalItemizing?: boolean
  }
  exemptions?: { perFiler: number; perDependent: number; perSenior: number; phaseout?: Phaseout }
  credits?: { perFiler: number; perDependent: number; perSenior: number; phaseout?: Phaseout }
  capitalGains?: {
    exclusionRate?: number
    exclusionCap?: ByStatus<number>
    flatExclusion?: number
    maxRate?: number
    schedule?: ByStatus<Bracket[]>
    includesQualifiedDividends?: boolean
  }
  surtax?: { threshold: ByStatus<number>; rate: number; base: 'taxable' | 'investmentIncome'; label: string }
  federalTaxDeduction?: { share: number; cap: ByStatus<number> | null; phaseout?: Phaseout }
  propertyTaxDeduction?: { cap: ByStatus<number> }
  localTax?: { rate: number; label: string; base: 'stateTaxable' | 'agi' }
  countsAsFederalSalt?: boolean
}

const ALL: IncomeType[] = ['wages', 'selfEmployment', 'taxableInterest', 'longTermGains']
const STATUSES: FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh']

function phaseOut(amount: number, p: Phaseout | undefined, s: FilingStatus, income: number, federalAgi: number): number {
  if (!p || amount <= 0) return amount
  const x = p.basis === 'federalAgi' ? federalAgi : income
  if (p.end) {
    const span = p.end[s] - p.start[s]
    const share = span <= 0 ? (x > p.start[s] ? 1 : 0) : Math.min(1, clampZero(x - p.start[s]) / span)
    return amount * (1 - share)
  }
  return clampZero(amount - (p.ratePerDollar ?? 0) * clampZero(x - p.start[s]))
}

/** True while income sits inside a phaseout range, so extra income shrinks the amount. */
function phasingOut(p: Phaseout | undefined, s: FilingStatus, income: number, federalAgi: number): boolean {
  if (!p) return false
  const x = p.basis === 'federalAgi' ? federalAgi : income
  if (x <= p.start[s]) return false
  return p.end ? x < p.end[s] : true
}

export function computeGenericState(rules: GenericStateRules, inp: TaxInputs, fed: FederalContext): JurisdictionResult {
  const s = inp.filingStatus
  const filers = s === 'mfj' ? 2 : 1
  const seniors = (inp.filer65 ? 1 : 0) + (s === 'mfj' && inp.spouse65 ? 1 : 0)
  const dependents = inp.childrenUnder17 + inp.otherDependents
  const investmentIncome = inp.taxableInterest + inp.qualifiedDividends + inp.nonQualifiedDividends + inp.longTermGains

  // 1. Starting income
  const start = rules.startingPoint === 'federalTaxable' ? fed.taxableIncome : fed.agi
  const phaseBase = start
  let income = start
  const lines: Line[] = [{
    key: 'start', role: 'base',
    label: rules.startingPoint === 'federalTaxable' ? 'Federal taxable income' : 'Adjusted gross income',
    amount: start,
  }]
  const factors: MarginalFactor[] = []

  // 2. Gains exclusion
  const cg = rules.capitalGains
  const gains = clampZero(inp.longTermGains + (cg?.includesQualifiedDividends ? inp.qualifiedDividends : 0))
  let excluded = 0
  if (cg && gains > 0) {
    const byRate = Math.min(gains * (cg.exclusionRate ?? 0), cg.exclusionCap?.[s] ?? Infinity)
    excluded = Math.min(gains, Math.max(Math.min(gains, cg.flatExclusion ?? 0), byRate))
    if (excluded > 0) {
      income -= excluded
      lines.push({ key: 'gainsExclusion', role: 'base', label: 'Capital gains exclusion', amount: -excluded })
    }
  }

  // 3. Federal tax deduction
  const ftd = rules.federalTaxDeduction
  if (ftd && fed.incomeTax > 0) {
    const capped = Math.min(fed.incomeTax * ftd.share, ftd.cap?.[s] ?? Infinity)
    const amount = phaseOut(capped, ftd.phaseout, s, phaseBase, fed.agi)
    if (amount > 0) {
      income -= amount
      lines.push({ key: 'federalTaxDeduction', role: 'base', label: 'Federal income tax deduction', amount: -amount })
      if (phasingOut(ftd.phaseout, s, phaseBase, fed.agi)) {
        factors.push({ text: `${rules.name}: the deduction for federal tax shrinks as income rises.`, appliesTo: ALL })
      }
    }
  }

  // 4. Deduction: standard or itemized
  const sd = rules.standardDeduction
  let standard = 0
  if (sd) {
    const base = sd.amount === 'federal' ? fed.standardDeduction : sd.amount[s] + (sd.seniorExtra ?? 0) * seniors
    standard = phaseOut(base, sd.phaseout, s, phaseBase, fed.agi)
    if (phasingOut(sd.phaseout, s, phaseBase, fed.agi) && standard > 0) {
      factors.push({ text: `${rules.name}: the standard deduction shrinks as income rises.`, appliesTo: ALL })
    }
  }
  let itemized = 0
  const it = rules.itemized
  const mayItemize = !!it && !(it.requiresFederalItemizing && !fed.itemizes)
  if (it && mayItemize) {
    const medical = it.medicalFloorRate === null ? 0 : clampZero(inp.medical - it.medicalFloorRate * fed.agi)
    const property = it.propertyTax ? Math.min(inp.propertyTax, it.saltCap?.[s] ?? Infinity) : 0
    itemized = medical + property + (it.mortgageInterest ? inp.mortgageInterest : 0) + (it.charitable ? inp.charitable : 0)
  }
  const used: 'standard' | 'itemized' = itemized > standard ? 'itemized' : 'standard'
  const deduction = Math.max(standard, itemized)
  if (deduction > 0) {
    income -= deduction
    lines.push({ key: 'deduction', role: 'base', label: used === 'itemized' ? 'Itemized deductions' : 'Standard deduction', amount: -deduction })
  }

  // 5. Exemptions
  const ex = rules.exemptions
  if (ex) {
    const gross = ex.perFiler * filers + ex.perDependent * dependents + ex.perSenior * seniors
    const amount = phaseOut(gross, ex.phaseout, s, phaseBase, fed.agi)
    if (amount > 0) {
      income -= amount
      lines.push({ key: 'exemptions', role: 'base', label: 'Exemptions', amount: -amount })
    }
    if (amount > 0 && phasingOut(ex.phaseout, s, phaseBase, fed.agi)) {
      factors.push({ text: `${rules.name}: exemptions shrink as income rises.`, appliesTo: ALL })
    }
  }

  // 6. Separate property tax deduction
  if (rules.propertyTaxDeduction && inp.propertyTax > 0) {
    const amount = Math.min(inp.propertyTax, rules.propertyTaxDeduction.cap[s])
    income -= amount
    lines.push({ key: 'propertyTaxDeduction', role: 'base', label: 'Property tax deduction', amount: -amount })
  }

  // 7. Taxable income
  const taxable = clampZero(income)
  lines.push({ key: 'taxable', role: 'base', label: 'Taxable income', amount: taxable })

  // 8. Tax
  const brackets = rules.brackets[s]
  const gainsPart = Math.min(taxable, clampZero(gains - excluded))
  let tax = taxFromBrackets(taxable, brackets)
  let gainsNote: string | undefined
  if (cg?.schedule && gainsPart > 0) {
    const ordinary = taxable - gainsPart
    const sched = cg.schedule[s]
    tax = taxFromBrackets(ordinary, brackets) + taxFromBrackets(taxable, sched) - taxFromBrackets(ordinary, sched)
    gainsNote = 'gains on their own lower schedule'
  } else if (cg?.maxRate !== undefined && gainsPart > 0) {
    const alt = taxFromBrackets(taxable - gainsPart, brackets) + gainsPart * cg.maxRate
    if (alt < tax) {
      tax = alt
      gainsNote = `gains capped at ${+(cg.maxRate * 100).toFixed(2)}%`
    }
  }
  lines.push({
    key: 'stateTax', role: 'tax',
    label: gainsNote ? `Tax (${gainsNote})` : excluded > 0 ? 'Tax' : 'Tax (gains taxed as ordinary income)',
    amount: tax,
  })

  // 9. Surtax
  let surtax = 0
  if (rules.surtax) {
    const base = rules.surtax.base === 'investmentIncome' ? investmentIncome : taxable
    surtax = rules.surtax.rate * clampZero(base - rules.surtax.threshold[s])
    if (surtax > 0) {
      lines.push({ key: 'surtax', role: 'tax', label: rules.surtax.label, amount: surtax })
      factors.push({
        text: `${rules.name}: ${rules.surtax.label.toLowerCase()} applies above ${dollars(rules.surtax.threshold[s])}.`,
        appliesTo: rules.surtax.base === 'investmentIncome' ? ['taxableInterest', 'longTermGains'] : ALL,
      })
    }
  }

  // 10. Credits
  let credits = 0
  const cr = rules.credits
  if (cr) {
    const gross = cr.perFiler * filers + cr.perDependent * dependents + cr.perSenior * seniors
    credits = Math.min(tax + surtax, phaseOut(gross, cr.phaseout, s, phaseBase, fed.agi))
    if (credits > 0) {
      lines.push({ key: 'credits', role: 'tax', label: 'Credits', amount: -credits })
      if (phasingOut(cr.phaseout, s, phaseBase, fed.agi)) {
        factors.push({ text: `${rules.name}: credits shrink as income rises.`, appliesTo: ALL })
      }
    }
  }

  // 11. Local tax
  let local = 0
  if (rules.localTax) {
    local = rules.localTax.rate * clampZero(rules.localTax.base === 'agi' ? start : taxable)
    if (local > 0) lines.push({ key: 'localTax', role: 'tax', label: rules.localTax.label, amount: local })
  }

  const total = tax + surtax - credits + local

  // Where income sits on the schedule
  const positions = [{
    label: cg?.schedule || cg?.maxRate !== undefined ? 'Ordinary income' : 'All income',
    unit: 'taxable income',
    ...positionIn(brackets, cg?.schedule || cg?.maxRate !== undefined ? taxable - gainsPart : taxable),
  }]
  if (cg?.schedule) {
    positions.push({ label: 'Gains', unit: 'taxable income', ...positionIn(cg.schedule[s], taxable) })
  }

  const notes = [...rules.notes]
  if (excluded > 0) notes.unshift(`${rules.name} excludes ${dollars(excluded)} of your long-term gains.`)
  if (rules.localTax) notes.push(`Includes ${rules.localTax.label.toLowerCase()} at a typical ${+(rules.localTax.rate * 100).toFixed(2)}%.`)

  return {
    name: rules.name,
    totalLabel: 'Total state tax',
    tax: total,
    saltEligibleTax: rules.countsAsFederalSalt === false ? 0 : clampZero(total),
    deduction: sd || it ? { standard, itemized, used } : undefined,
    lines,
    notes,
    positions,
    factors,
  }
}

/** Structural check of a rules file; returns a list of problems (empty when valid). */
export function validateGenericRules(r: GenericStateRules): string[] {
  const problems: string[] = []
  const isNum = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  const checkByStatus = (v: unknown, what: string) => {
    for (const st of STATUSES) {
      if (!v || !isNum((v as Record<string, unknown>)[st])) problems.push(`${what}.${st} missing`)
    }
  }
  const checkBrackets = (b: unknown, what: string) => {
    for (const st of STATUSES) {
      const list = (b as Record<string, unknown> | undefined)?.[st]
      if (!Array.isArray(list) || list.length === 0) { problems.push(`${what}.${st} missing`); continue }
      let prev = -1
      for (const row of list) {
        if (!Array.isArray(row) || !isNum(row[0]) || !isNum(row[1])) { problems.push(`${what}.${st} bad row`); break }
        if (row[0] <= prev) problems.push(`${what}.${st} thresholds not increasing`)
        if (row[1] < 0 || row[1] > 0.2) problems.push(`${what}.${st} rate ${row[1]} out of range`)
        prev = row[0]
      }
      if ((list[0] as number[])[0] !== 0) problems.push(`${what}.${st} must start at 0`)
    }
  }
  const checkPhaseout = (p: Phaseout | undefined, what: string) => {
    if (!p) return
    checkByStatus(p.start, `${what}.start`)
    if (p.end) checkByStatus(p.end, `${what}.end`)
    if (!p.end && !isNum(p.ratePerDollar)) problems.push(`${what} needs end or ratePerDollar`)
  }
  if (!/^[A-Z]{2}$/.test(r.state)) problems.push('state code')
  if (!r.name) problems.push('name')
  if (!['federalAgi', 'federalTaxable'].includes(r.startingPoint)) problems.push('startingPoint')
  if (!Array.isArray(r.sources) || r.sources.length === 0) problems.push('sources')
  if (!Array.isArray(r.provisional)) problems.push('provisional')
  if (!Array.isArray(r.notes)) problems.push('notes')
  checkBrackets(r.brackets, 'brackets')
  if (r.standardDeduction) {
    if (r.standardDeduction.amount !== 'federal') checkByStatus(r.standardDeduction.amount, 'standardDeduction.amount')
    checkPhaseout(r.standardDeduction.phaseout, 'standardDeduction.phaseout')
  }
  if (r.itemized?.saltCap) checkByStatus(r.itemized.saltCap, 'itemized.saltCap')
  checkPhaseout(r.exemptions?.phaseout, 'exemptions.phaseout')
  checkPhaseout(r.credits?.phaseout, 'credits.phaseout')
  checkPhaseout(r.federalTaxDeduction?.phaseout, 'federalTaxDeduction.phaseout')
  if (r.capitalGains?.schedule) checkBrackets(r.capitalGains.schedule, 'capitalGains.schedule')
  if (r.capitalGains?.exclusionCap) checkByStatus(r.capitalGains.exclusionCap, 'capitalGains.exclusionCap')
  if (r.surtax) checkByStatus(r.surtax.threshold, 'surtax.threshold')
  if (r.federalTaxDeduction?.cap) checkByStatus(r.federalTaxDeduction.cap, 'federalTaxDeduction.cap')
  if (r.propertyTaxDeduction) checkByStatus(r.propertyTaxDeduction.cap, 'propertyTaxDeduction.cap')
  return problems
}
