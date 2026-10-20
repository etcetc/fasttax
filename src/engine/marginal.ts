import { computeTaxes } from './index'
import { dollars } from './format'
import type { IncomeType, JurisdictionResult, TaxInputs, TaxResult } from './types'

/** Income fields the what-if form can add to. */
export type WhatIfType =
  | 'wages' | 'selfEmployment' | 'taxableInterest'
  | 'nonQualifiedDividends' | 'qualifiedDividends' | 'longTermGains'

export const WHAT_IF_TYPES: { key: WhatIfType; label: string; factorType: IncomeType }[] = [
  { key: 'wages', label: 'W-2 wages', factorType: 'wages' },
  { key: 'selfEmployment', label: '1099 income', factorType: 'selfEmployment' },
  { key: 'taxableInterest', label: 'Interest', factorType: 'taxableInterest' },
  { key: 'nonQualifiedDividends', label: 'Other dividends', factorType: 'taxableInterest' },
  { key: 'qualifiedDividends', label: 'Qualified dividends', factorType: 'longTermGains' },
  { key: 'longTermGains', label: 'Long-term capital gains', factorType: 'longTermGains' },
]

export interface ChangedLine {
  label: string
  before: number
  after: number
  change: number
  note?: string
}

export interface ChangedSection {
  name: string
  change: number
  rows: ChangedLine[]
}

export interface WhatIfResult {
  type: WhatIfType
  amount: number
  /** Change in federal + state income tax (self-employment tax included, payroll not). */
  extraTax: number
  rate: number
  federal: ChangedSection
  state: ChangedSection
  payroll: ChangedSection
  /** Amounts the taxes are figured on that changed: AGI, deductions, taxable income. */
  underneath: ChangedLine[]
  /** Why the result differs from the bracket rate, for this kind of income. */
  reasons: string[]
}

const CENT = 0.005

/** Match lines by key across two versions of the same breakdown and keep the ones that moved. */
function changedLines(before: JurisdictionResult, after: JurisdictionResult, role: 'tax' | 'base'): ChangedLine[] {
  const pick = (r: JurisdictionResult) => r.lines.filter((l) => l.key && l.role === role)
  const b = new Map(pick(before).map((l) => [l.key!, l]))
  const a = new Map(pick(after).map((l) => [l.key!, l]))
  const keys = [...new Set([...a.keys(), ...b.keys()])]
  return keys
    .map((k) => {
      // Deductions are stored as negative amounts; underneath, show their size instead,
      // so a deduction that grows reads as +$87 rather than −$87.
      const size = (n: number) => (role === 'base' ? Math.abs(n) : n)
      const prior = size(b.get(k)?.amount ?? 0)
      const next = size(a.get(k)?.amount ?? 0)
      return { label: (a.get(k) ?? b.get(k))!.label, before: prior, after: next, change: next - prior }
    })
    .filter((l) => Math.abs(l.change) >= CENT)
}

function section(before: JurisdictionResult, after: JurisdictionResult): ChangedSection {
  return { name: after.name, change: after.tax - before.tax, rows: changedLines(before, after, 'tax') }
}

/** Plain-language account of how the gains split across 0/15/20% moved. */
export function describeGainsShift(before: TaxResult, after: TaxResult, type: WhatIfType): string | undefined {
  const b = before.federal.gainsSplit
  const a = after.federal.gainsSplit
  if (!a || !b) return undefined
  const d0 = a.atZero - b.atZero
  const d15 = a.atFifteen - b.atFifteen
  const d20 = a.atTwenty - b.atTwenty
  const parts: string[] = []
  if (type === 'qualifiedDividends' || type === 'longTermGains') {
    if (d0 >= 1) parts.push(`${dollars(d0)} at 0%`)
    if (d15 >= 1) parts.push(`${dollars(d15)} at 15%`)
    if (d20 >= 1) parts.push(`${dollars(d20)} at 20%`)
    return parts.length ? `The added amount is taxed ${parts.join(', ')}.` : undefined
  }
  if (d0 <= -1) parts.push(`${dollars(-d0)} of your gains moved from 0% to ${d20 > d15 ? '20%' : '15%'}`)
  if (d15 <= -1 && d20 >= 1) parts.push(`${dollars(-d15)} moved from 15% to 20%`)
  return parts.length ? `${parts.join('; ')}.` : undefined
}

export function whatIf(inp: TaxInputs, type: WhatIfType, amount: number, before: TaxResult = computeTaxes(inp)): WhatIfResult {
  const after = computeTaxes({ ...inp, [type]: inp[type] + amount })
  const federal = section(before.federal, after.federal)
  const shift = describeGainsShift(before, after, type)
  if (shift) {
    const row = federal.rows.find((r) => r.label.startsWith('Tax on qualified dividends'))
    if (row) row.note = shift
  }
  const extraTax = after.total - before.total
  const factorType = WHAT_IF_TYPES.find((t) => t.key === type)!.factorType
  const reasons = [...before.federal.factors, ...before.state.factors]
    .filter((f) => f.appliesTo.includes(factorType))
    .map((f) => f.text)

  return {
    type,
    amount,
    extraTax,
    rate: amount !== 0 ? extraTax / amount : 0,
    federal,
    state: section(before.state, after.state),
    payroll: section(before.payroll, after.payroll),
    underneath: changedLines(before.federal, after.federal, 'base'),
    reasons,
  }
}
