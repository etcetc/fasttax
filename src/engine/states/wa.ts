import rules from '../../data/2026/wa.json'
import { clampZero, positionIn, taxFromBrackets } from '../brackets'
import type { Bracket, JurisdictionResult, Line, TaxInputs } from '../types'

export function computeWashington(inp: TaxInputs): JurisdictionResult {
  const charitable = Math.min(rules.charitable.cap, clampZero(inp.charitable - rules.charitable.floor))
  const taxableGains = clampZero(inp.longTermGains - rules.standardDeduction - charitable)
  const tax = taxFromBrackets(taxableGains, rules.rates as Bracket[])

  const lines: Line[] = [
    { key: 'gains', role: 'base', label: 'Long-term capital gains', amount: inp.longTermGains },
    { label: 'Standard deduction (one per household)', amount: -Math.min(inp.longTermGains, rules.standardDeduction) },
  ]
  if (charitable > 0) lines.push({ label: 'Charitable gifts above the floor', amount: -charitable })
  lines.push({ key: 'taxable', role: 'base', label: 'Taxable gains', amount: taxableGains })
  lines.push({ key: 'gainsTax', role: 'tax', label: 'Capital gains excise tax (7%, 9.9% over $1M)', amount: tax })

  const deductionLeft = clampZero(rules.standardDeduction + charitable - inp.longTermGains)
  const position = deductionLeft > 0
    ? { rate: 0, nextRate: (rules.rates as Bracket[])[0][1], headroom: deductionLeft }
    : positionIn(rules.rates as Bracket[], taxableGains)

  return {
    name: 'Washington',
    totalLabel: 'Total state tax',
    positions: [{ label: 'Long-term gains', unit: 'gains', ...position }],
    factors: [],
    tax,
    saltEligibleTax: rules.countsAsFederalSalt ? tax : 0,
    lines,
    notes: [
      'Washington taxes only long-term gains on stocks and funds; interest, dividends, and real estate are exempt.',
      'Whether this tax counts toward the federal SALT deduction is unsettled; it is left out here.',
    ],
  }
}
