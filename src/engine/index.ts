import noIncomeTax from '../data/2026/no-income-tax.json'
import ca from '../data/2026/ca.json'
import ny from '../data/2026/ny.json'
import wa from '../data/2026/wa.json'
import { computeGenericState, type GenericStateRules } from './states/generic'
import { computeFederal } from './federal'
import { computePayroll, selfEmploymentTax } from './payroll'
import { computeCalifornia } from './states/ca'
import { computeNewYork } from './states/ny'
import { computeWashington } from './states/wa'
import type { FederalContext, JurisdictionResult, StateCode, TaxInputs, TaxResult } from './types'

export * from './types'

const genericRules = import.meta.glob<GenericStateRules>('../data/2026/states/*.json', { eager: true, import: 'default' })
const GENERIC: Record<string, GenericStateRules> = Object.fromEntries(
  Object.values(genericRules).map((r) => [r.state, r]),
)
const NO_TAX = noIncomeTax.states as Record<string, string>

/** Every state and DC, sorted by name. */
export const STATES: { code: StateCode; name: string }[] = [
  { code: 'CA', name: 'California' },
  { code: 'NY', name: 'New York' },
  { code: 'WA', name: 'Washington' },
  ...Object.values(GENERIC).map((r) => ({ code: r.state, name: r.name })),
  ...Object.entries(NO_TAX).map(([code, name]) => ({ code, name })),
].sort((a, b) => a.name.localeCompare(b.name))

export const STATE_CODES = new Set(STATES.map((s) => s.code))

/** Figures not yet published for 2026, for the state in use. */
export function provisionalFor(code: StateCode): string[] {
  if (code === 'CA') return ca.provisional
  if (code === 'NY') return ny.provisional
  if (code === 'WA') return wa.provisional
  return GENERIC[code]?.provisional ?? []
}

export function grossIncome(inp: TaxInputs): number {
  return inp.wages + inp.selfEmployment +
    inp.taxableInterest + inp.qualifiedDividends + inp.nonQualifiedDividends + inp.longTermGains
}

/** Gross income less the deductible half of self-employment tax. */
export function adjustedGrossIncome(inp: TaxInputs): number {
  return grossIncome(inp) - selfEmploymentTax(inp).deductibleHalf
}

function computeState(inp: TaxInputs, agi: number, fed: FederalContext): JurisdictionResult {
  switch (inp.state) {
    case 'CA': return computeCalifornia(inp, agi)
    case 'NY': return computeNewYork(inp, agi)
    case 'WA': return computeWashington(inp)
  }
  const rules = GENERIC[inp.state]
  if (rules) return computeGenericState(rules, inp, fed)
  const name = NO_TAX[inp.state] ?? inp.state
  return {
    name,
    tax: 0,
    saltEligibleTax: 0,
    lines: [],
    notes: [`${name} has no individual income tax.`],
    positions: [],
    factors: [],
  }
}

/**
 * State income tax feeds the federal SALT deduction, and some states start from federal
 * taxable income or deduct federal tax, so the two are worked out in turn until they settle.
 */
export function computeTaxes(inp: TaxInputs): TaxResult {
  const se = selfEmploymentTax(inp)
  const gross = grossIncome(inp)
  const agi = gross - se.deductibleHalf
  const payroll = computePayroll(inp)
  let federal = computeFederal(inp, agi, payroll.saltEligibleTax, se)
  let state = computeState(inp, agi, federal.federalContext!)
  for (let i = 0; i < 25; i++) {
    const nextFederal = computeFederal(inp, agi, state.saltEligibleTax + payroll.saltEligibleTax, se)
    const nextState = computeState(inp, agi, nextFederal.federalContext!)
    const settled = Math.abs(nextFederal.tax - federal.tax) < 1e-7 && Math.abs(nextState.tax - state.tax) < 1e-7
    federal = nextFederal
    state = nextState
    if (settled) break
  }
  const total = federal.tax + state.tax
  return { grossIncome: gross, agi, federal, state, payroll, total, effectiveRate: gross > 0 ? total / gross : 0 }
}

export const EMPTY_INPUTS: TaxInputs = {
  year: 2026,
  filingStatus: 'single',
  state: 'CA',
  nycResident: false,
  filer65: false,
  spouse65: false,
  childrenUnder17: 0,
  childrenUnder4: 0,
  otherDependents: 0,
  wages: 0,
  selfEmployment: 0,
  taxableInterest: 0,
  qualifiedDividends: 0,
  nonQualifiedDividends: 0,
  longTermGains: 0,
  medical: 0,
  propertyTax: 0,
  mortgageInterest: 0,
  charitable: 0,
}
