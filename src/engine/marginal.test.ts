import { describe, expect, it } from 'vitest'
import { computeTaxes, EMPTY_INPUTS, type TaxInputs } from './index'
import { whatIf, type WhatIfType } from './marginal'

// Expected values are worked by hand from the published 2026 schedules.
const make = (o: Partial<TaxInputs>): TaxInputs => ({ ...EMPTY_INPUTS, state: 'TX', ...o })
const pos = (r: ReturnType<typeof computeTaxes>['federal'], label: string) => r.positions.find((p) => p.label === label)!

describe('bracket positions', () => {
  // single: interest 30,000 + LTCG 60,000 → taxable 73,900, of which 13,900 ordinary
  const inp = make({ taxableInterest: 30_000, longTermGains: 60_000 })
  const r = computeTaxes(inp)

  it('places ordinary income in its bracket with headroom', () => {
    expect(pos(r.federal, 'Ordinary income')).toMatchObject({ rate: 0.12, nextRate: 0.22, headroom: 36_500 })
  })

  it('places gains at the top of the stack', () => {
    expect(pos(r.federal, 'Gains & qualified dividends')).toMatchObject({ rate: 0.15, nextRate: 0.2, headroom: 471_600 })
  })

  it('shows room before NIIT starts', () => {
    expect(pos(r.federal, 'Net investment income tax')).toMatchObject({ rate: 0, nextRate: 0.038, headroom: 110_000 })
  })

  it('folds the 1% CA surtax into the schedule', () => {
    // single interest 905,900 → CA taxable 900,000: 12.3% now, 13.3% after 100,000 more
    const ca = computeTaxes(make({ state: 'CA', taxableInterest: 905_900 }))
    expect(ca.state.positions[0]).toMatchObject({ rate: 0.123, nextRate: 0.133, headroom: 100_000 })
    // single interest 60,000 → taxable 54,100: 6%, next 8% at 59,498
    const low = computeTaxes(make({ state: 'CA', taxableInterest: 60_000 }))
    expect(low.state.positions[0]).toMatchObject({ rate: 0.06, nextRate: 0.08, headroom: 5398 })
  })

  it('shows the WA deduction left before gains are taxed', () => {
    const wa = computeTaxes(make({ state: 'WA', longTermGains: 200_000 }))
    expect(wa.state.positions[0]).toMatchObject({ rate: 0, nextRate: 0.07, headroom: 78_000 })
  })

  it('adds an NYC row for city residents', () => {
    const ny = computeTaxes(make({ state: 'NY', nycResident: true, taxableInterest: 58_000 }))
    expect(ny.state.positions.map((p) => p.label)).toEqual(['New York State', 'New York City'])
  })
})

describe('what if I add income', () => {
  // single, TX: interest 30,000 + LTCG 60,000 → taxable 73,900, of which 13,900 ordinary;
  // 35,550 of gains sit in the 0% band (up to 49,450)
  const base = make({ taxableInterest: 30_000, longTermGains: 60_000 })
  const row = (s: { rows: { label: string; change: number; note?: string }[] }, start: string) =>
    s.rows.find((r) => r.label.startsWith(start))

  it('shows $1,000 of interest costing 27%: 12% on itself, 15% on gains it pushes out of 0%', () => {
    const r = whatIf(base, 'taxableInterest', 1000)
    expect(r.extraTax).toBeCloseTo(270, 6)
    expect(r.rate).toBeCloseTo(0.27, 6)
    expect(row(r.federal, 'Tax on ordinary income')!.change).toBeCloseTo(120, 6)
    const gains = row(r.federal, 'Tax on qualified dividends')!
    expect(gains.change).toBeCloseTo(150, 6)
    expect(gains.note).toBe('$1,000 of your gains moved from 0% to 15%.')
    expect(r.underneath.find((l) => l.label === 'Taxable income')!.change).toBeCloseTo(1000, 6)
    expect(r.reasons.some((t) => t.includes('out of the 0% rate'))).toBe(true)
  })

  it('treats other dividends like interest', () => {
    expect(whatIf(base, 'nonQualifiedDividends', 1000).extraTax).toBeCloseTo(270, 6)
  })

  it('taxes added gains on top of the stack, without the stacking reason', () => {
    const r = whatIf(base, 'longTermGains', 1000)
    expect(r.extraTax).toBeCloseTo(150, 6)
    expect(row(r.federal, 'Tax on qualified dividends')!.note).toBe('The added amount is taxed $1,000 at 15%.')
    expect(r.reasons.some((t) => t.includes('out of the 0% rate'))).toBe(false)
  })

  it('splits added gains that straddle the 0% limit', () => {
    // single, LTCG 60,000 only → taxable 43,900; 5,550 of room left at 0%
    const r = whatIf(make({ longTermGains: 60_000 }), 'longTermGains', 10_000)
    expect(row(r.federal, 'Tax on qualified dividends')!.note).toBe('The added amount is taxed $5,550 at 0%, $4,450 at 15%.')
    expect(r.extraTax).toBeCloseTo(4450 * 0.15, 6)
  })

  it('breaks 1099 income into self-employment tax and income tax (34.2%)', () => {
    // NE 923.50 → SE tax 141.2955; half 70.64775 → AGI +929.35225
    // QBI 20% × 929.35225 = 185.87045 → taxable +743.4818
    // 12% on 743.4818 = 89.217816; 743.4818 of gains pushed to 15% = 111.52227
    const r = whatIf(base, 'selfEmployment', 1000)
    expect(row(r.federal, 'Self-employment tax')!.change).toBeCloseTo(141.2955, 4)
    expect(row(r.federal, 'Tax on ordinary income')!.change).toBeCloseTo(89.217816, 4)
    expect(row(r.federal, 'Tax on qualified dividends')!.change).toBeCloseTo(111.52227, 4)
    expect(r.extraTax).toBeCloseTo(342.035586, 4)
    // deductions that grow read as positive changes
    expect(r.underneath.find((l) => l.label === 'Half of self-employment tax')!.change).toBeCloseTo(70.64775, 4)
    expect(r.underneath.find((l) => l.label === 'Qualified business income deduction')!.change).toBeCloseTo(185.87045, 4)
  })

  it('reports payroll on wages separately from income tax', () => {
    // single, wages 60,000: taxable 43,900 → 12%; payroll 6.2% + 1.45%
    const r = whatIf(make({ wages: 60_000 }), 'wages', 1000)
    expect(r.extraTax).toBeCloseTo(120, 6)
    expect(r.payroll.change).toBeCloseTo(76.5, 6)
    expect(r.payroll.rows.map((x) => x.label)).toEqual(['Social Security (6.2% up to $184,500)', 'Medicare (1.45%)'])
  })

  it('shows wages cutting self-employment tax once the wage base is shared', () => {
    // single, wages 150,000 + 1099 50,000 (NE 46,175): wages + NE > 184,500.
    // Extra $1,000 of wages shrinks SE Social Security room by 1,000: SE tax -124, its deductible half -62,
    // so AGI rises 1,062 and QBI (20% of 1099 profit less half SE tax) rises 12.40.
    // Taxable +1,049.60 in the 24% bracket = +251.904; federal change 251.904 - 124 = 127.904
    const inp = make({ wages: 150_000, selfEmployment: 50_000 })
    const r = whatIf(inp, 'wages', 1000)
    expect(r.federal.change).toBeCloseTo(127.904, 4)
    expect(row(r.federal, 'Self-employment tax')!.change).toBeCloseTo(-124, 4)
    expect(r.reasons.some((t) => t.includes('wage base'))).toBe(true)
  })

  it('ignores dividends and gains under the deduction in Washington', () => {
    const wa = make({ state: 'WA', longTermGains: 200_000 })
    expect(whatIf(wa, 'qualifiedDividends', 5000).state.change).toBe(0)
    expect(whatIf(wa, 'longTermGains', 5000).state.change).toBe(0)
  })

  it('accounts for every dollar: changed rows add up to the change in each tax', () => {
    const cases: [TaxInputs, WhatIfType][] = [
      [make({ state: 'CA', filingStatus: 'mfj', wages: 150_000, selfEmployment: 40_000, taxableInterest: 20_000, longTermGains: 80_000, propertyTax: 15_000, childrenUnder17: 1 }), 'taxableInterest'],
      [make({ state: 'NY', nycResident: true, filingStatus: 'mfj', taxableInterest: 116_050, childrenUnder17: 2, childrenUnder4: 1 }), 'wages'],
      [make({ filer65: true, spouse65: true, filingStatus: 'mfj', taxableInterest: 140_000, medical: 30_000, propertyTax: 20_000 }), 'longTermGains'],
      [make({ state: 'WA', longTermGains: 1_200_000, wages: 300_000 }), 'longTermGains'],
    ]
    for (const [inp, type] of cases) {
      const r = whatIf(inp, type, 5000)
      for (const sec of [r.federal, r.state, r.payroll]) {
        expect(sec.rows.reduce((t, x) => t + x.change, 0)).toBeCloseTo(sec.change, 2)
      }
    }
  })

  it('flags the NY supplemental tax while it phases in', () => {
    // MFJ interest 116,050 → TI 100,000, AGI 116,050 (inside 107,650–157,650)
    const r = computeTaxes(make({ state: 'NY', filingStatus: 'mfj', taxableInterest: 116_050 }))
    expect(r.state.factors.some((f) => f.text.includes('supplemental'))).toBe(true)
  })

  it('flags the senior deduction phaseout', () => {
    const r = computeTaxes(make({ filer65: true, taxableInterest: 100_000 }))
    expect(r.federal.factors.some((f) => f.text.includes('senior deduction'))).toBe(true)
  })
})
