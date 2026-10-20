import { describe, expect, it } from 'vitest'
import { EMPTY_INPUTS, type TaxInputs } from '../index'
import { computeGenericState, validateGenericRules, type FederalContext, type GenericStateRules } from './generic'

// Expected values in cases/*.json were worked by hand from each state's published
// schedules and forms, independently of this engine.
interface Case {
  description: string
  inputs: Partial<TaxInputs>
  federal: FederalContext & { agi: number }
  expectedStateTax: number
  working: string
}

const ruleFiles = import.meta.glob<GenericStateRules>('../../data/2026/states/*.json', { eager: true, import: 'default' })
const caseFiles = import.meta.glob<Case[]>('./cases/*.json', { eager: true, import: 'default' })
const code = (path: string) => path.split('/').pop()!.replace('.json', '')
const rulesByCode = Object.fromEntries(Object.entries(ruleFiles).map(([p, r]) => [code(p), r]))

/** Hand-worked figures are rounded to whole dollars, and some state tax charts round their base amounts. */
const TOLERANCE = 1

describe('state rule files', () => {
  for (const [c, rules] of Object.entries(rulesByCode)) {
    it(`${c}: matches the spec`, () => {
      expect(validateGenericRules(rules)).toEqual([])
      expect(rules.state.toLowerCase()).toBe(c)
    })
  }
})

describe('hand-worked state cases', () => {
  for (const [path, cases] of Object.entries(caseFiles)) {
    const c = code(path)
    for (const k of cases) {
      it(`${c}: ${k.description}`, () => {
        const rules = rulesByCode[c]
        expect(rules, `no rules file for ${c}`).toBeDefined()
        const inp = { ...EMPTY_INPUTS, ...k.inputs } as TaxInputs
        const got = computeGenericState(rules, inp, k.federal).tax
        expect(Math.abs(got - k.expectedStateTax), `engine ${got.toFixed(2)} vs hand ${k.expectedStateTax}\n${k.working}`).toBeLessThanOrEqual(TOLERANCE)
      })
    }
  }
})

describe('all states in the app', () => {
  it('lists all 50 states and DC exactly once', async () => {
    const { STATES } = await import('../index')
    expect(STATES).toHaveLength(51)
    expect(new Set(STATES.map((s) => s.code)).size).toBe(51)
  })

  it('gives every state a finite, non-negative tax and a consistent what-if', async () => {
    const { STATES, computeTaxes } = await import('../index')
    const { whatIf } = await import('../marginal')
    const inp = {
      ...EMPTY_INPUTS, filingStatus: 'mfj' as const, wages: 120_000, taxableInterest: 15_000,
      qualifiedDividends: 10_000, longTermGains: 60_000, propertyTax: 12_000, mortgageInterest: 9_000,
      charitable: 4_000, childrenUnder17: 2, filer65: true,
    }
    for (const { code } of STATES) {
      const r = computeTaxes({ ...inp, state: code })
      expect(Number.isFinite(r.state.tax), code).toBe(true)
      expect(r.state.tax, code).toBeGreaterThanOrEqual(0)
      // a typical income-tax state takes well under 10% of this income
      expect(r.state.tax / r.grossIncome, code).toBeLessThan(0.1)
      const w = whatIf({ ...inp, state: code }, 'taxableInterest', 1000)
      expect(w.state.rows.reduce((t, x) => t + x.change, 0), code).toBeCloseTo(w.state.change, 2)
    }
  })

  it('settles federal and state tax for a state that starts from federal taxable income', async () => {
    const { computeTaxes } = await import('../index')
    const { computeGenericState } = await import('./generic')
    // itemizing federally, so state tax feeds federal SALT, which feeds federal taxable income
    const inp = { ...EMPTY_INPUTS, state: 'CO', wages: 250_000, propertyTax: 20_000, mortgageInterest: 20_000 }
    const r = computeTaxes(inp)
    const again = computeGenericState(rulesByCode.co, inp, r.federal.federalContext!)
    expect(again.tax).toBeCloseTo(r.state.tax, 6)
  })
})
