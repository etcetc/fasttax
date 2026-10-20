import { describe, expect, it } from 'vitest'
import { computeTaxes, EMPTY_INPUTS, type TaxInputs } from './index'
import { incomeTax, saltCap, seniorDeduction } from './federal'
import { nyStateTax } from './states/ny'
import { taxFromBrackets } from './brackets'

// Expected values below are worked by hand from the published 2026 schedules,
// not produced by running this code.
const make = (o: Partial<TaxInputs>): TaxInputs => ({ ...EMPTY_INPUTS, state: 'TX', ...o })

describe('brackets', () => {
  it('is zero for zero or negative income', () => {
    expect(taxFromBrackets(0, [[0, 0.1]])).toBe(0)
    expect(taxFromBrackets(-5, [[0, 0.1]])).toBe(0)
  })
})

describe('federal', () => {
  it('owes nothing with no income', () => {
    expect(computeTaxes(make({})).total).toBe(0)
  })

  it('taxes interest on the ordinary brackets (MFJ, $100k)', () => {
    // 100,000 - 32,200 = 67,800 taxable; 24,800 × 10% + 43,000 × 12% = 7,640
    const r = computeTaxes(make({ filingStatus: 'mfj', taxableInterest: 100_000 }))
    expect(r.federal.tax).toBeCloseTo(7640, 2)
  })

  it('keeps gains under the 0% threshold tax-free (single, $60k LTCG)', () => {
    // 60,000 - 16,100 = 43,900, all under 49,450
    expect(computeTaxes(make({ longTermGains: 60_000 })).federal.tax).toBe(0)
  })

  it('splits gains between 0% and 15% (single, $100k LTCG)', () => {
    // 83,900 taxable; 49,450 at 0%, 34,450 at 15% = 5,167.50
    expect(computeTaxes(make({ longTermGains: 100_000 })).federal.tax).toBeCloseTo(5167.5, 2)
  })

  it('stacks gains on top of ordinary income', () => {
    // 40,000 ordinary + 30,000 pref; ordinary fills 0% room first: 49,450 - 40,000 = 9,450 at 0%
    const t = incomeTax(70_000, 30_000, 'single')
    expect(t.atZero).toBe(9450)
    expect(t.atFifteen).toBe(20_550)
    // ordinary: 12,400 × 10% + 27,600 × 12% = 4,552
    expect(t.ordinaryTax).toBeCloseTo(4552, 2)
  })

  it('reaches the 20% rate and NIIT (single, $700k LTCG)', () => {
    // taxable 683,900: 49,450 at 0, 496,050 at 15% = 74,407.50, 138,400 at 20% = 27,680
    // NIIT: 3.8% × (700,000 - 200,000) = 19,000. Itemizing is not better (SALT 0).
    const r = computeTaxes(make({ longTermGains: 700_000 }))
    expect(r.federal.tax).toBeCloseTo(74_407.5 + 27_680 + 19_000, 2)
  })

  it('phases the senior deduction out per person', () => {
    // single 65+, AGI 100k: 6,000 - 6% × 25,000 = 4,500
    expect(seniorDeduction(make({ filer65: true }), 100_000)).toBe(4500)
    // MFJ both 65+, AGI 200k: (6,000 - 3,000) × 2
    expect(seniorDeduction(make({ filingStatus: 'mfj', filer65: true, spouse65: true }), 200_000)).toBe(6000)
    expect(seniorDeduction(make({ filingStatus: 'mfs', filer65: true }), 50_000)).toBe(0)
  })

  it('adds the 65+ standard deduction (single)', () => {
    // 50,000 interest - 16,100 - 2,050 - 6,000 senior = 25,850 taxable
    // 12,400 × 10% + 13,450 × 12% = 2,854
    const r = computeTaxes(make({ taxableInterest: 50_000, filer65: true }))
    expect(r.federal.tax).toBeCloseTo(2854, 2)
  })

  it('phases the SALT cap down above $505k, not below $10k', () => {
    expect(saltCap('single', 400_000)).toBe(40_400)
    expect(saltCap('single', 600_000)).toBeCloseTo(11_900, 6)
    expect(saltCap('single', 2_000_000)).toBe(10_000)
    expect(saltCap('mfs', 100_000)).toBe(20_200)
  })

  it('itemizes when property tax and medical beat the standard deduction', () => {
    // MFJ, $200k interest. Medical 30,000 - 7.5% × 200,000 = 15,000. Property tax 25,000.
    // Itemized 40,000 > 32,200. Taxable 160,000:
    // 24,800 × 10% + 76,000 × 12% + 59,200 × 22% = 2,480 + 9,120 + 13,024 = 24,624
    const r = computeTaxes(make({ filingStatus: 'mfj', taxableInterest: 200_000, medical: 30_000, propertyTax: 25_000 }))
    expect(r.federal.deduction?.used).toBe('itemized')
    expect(r.federal.tax).toBeCloseTo(24_624, 2)
  })

  it('gives non-itemizers a cash charity deduction', () => {
    // single, 50,000 interest, 1,500 charity: deduct 16,100 + 1,000 → 32,900 taxable
    // 1,240 + 20,500 × 12% = 3,700
    expect(computeTaxes(make({ taxableInterest: 50_000, charitable: 1500 })).federal.tax).toBeCloseTo(3700, 2)
  })

  it('limits the child credit to tax owed (no refundable part without wages)', () => {
    // MFJ, 2 kids, $100k interest: tax 7,640, credit 4,400 → 3,240
    expect(computeTaxes(make({ filingStatus: 'mfj', childrenUnder17: 2, taxableInterest: 100_000 })).federal.tax)
      .toBeCloseTo(3240, 2)
    // MFJ, 2 kids, $80k LTCG: all at 0%, credit unusable
    const zero = computeTaxes(make({ filingStatus: 'mfj', childrenUnder17: 2, longTermGains: 80_000 }))
    expect(zero.federal.tax).toBe(0)
    expect(zero.federal.notes.some((n) => n.includes('refundable'))).toBe(true)
  })

  it('phases the child credit out above $400k (MFJ) without the unused-credit note', () => {
    const r = computeTaxes(make({ filingStatus: 'mfj', childrenUnder17: 1, longTermGains: 500_000 }))
    expect(r.federal.lines.some((l) => l.label.startsWith('Child'))).toBe(false)
    expect(r.federal.notes.some((n) => n.includes('refundable'))).toBe(false)
  })
})

describe('California', () => {
  it('taxes gains as ordinary income and applies the personal credit', () => {
    // 60,000 - 5,900 = 54,100 taxable
    // 114.56 + 314.02 + 628.16 + 11,239 × 6% (674.34) = 1,731.08; minus 158 = 1,573.08
    const r = computeTaxes(make({ state: 'CA', longTermGains: 60_000 }))
    expect(r.state.tax).toBeCloseTo(1573.08, 2)
  })

  it('lets property tax through uncapped and feeds state tax into federal SALT', () => {
    const r = computeTaxes(make({ state: 'CA', filingStatus: 'mfj', taxableInterest: 300_000, propertyTax: 50_000 }))
    expect(r.state.deduction?.used).toBe('itemized')
    expect(r.state.deduction?.itemized).toBe(50_000)
    // federal SALT capped at 40,400
    expect(r.federal.deduction?.itemized).toBe(40_400)
  })

  it('adds the 1% behavioral health tax above $1M taxable', () => {
    const r = computeTaxes(make({ state: 'CA', taxableInterest: 1_105_900 }))
    // taxable 1,100,000 → 1% × 100,000
    const line = r.state.lines.find((l) => l.label.startsWith('Behavioral'))
    expect(line?.amount).toBeCloseTo(1000, 2)
  })
})

describe('New York', () => {
  it('uses the plain schedule below $107,650 AGI', () => {
    // MFJ, TI 50,000: 669 (≈668.85) + ... compute: 17,150×3.9% + 6,450×4.4% + 4,300×5.15% + 22,100×5.4%
    // = 668.85 + 283.80 + 221.45 + 1,193.40 = 2,367.50
    expect(nyStateTax(50_000, 80_000, 'mfj')).toBeCloseTo(2367.5, 2)
  })

  it('phases in the flat rate between $107,650 and $157,650 AGI', () => {
    // MFJ TI 100,000, AGI 130,000: schedule 5,067.50, flat 5,400, f = 0.447
    // 5,067.50 + 332.50 × 0.447 = 5,216.1275
    expect(nyStateTax(100_000, 130_000, 'mfj')).toBeCloseTo(5216.13, 2)
    // AGI ≥ 157,650: flat
    expect(nyStateTax(100_000, 160_000, 'mfj')).toBeCloseTo(5400, 2)
  })

  it('applies the tier recapture above the first tier', () => {
    // MFJ TI 200,000, AGI 250,000: schedule 8,391.20 + 38,450 × 5.9% = 10,659.75
    // f = min(250,000 - 161,550, 50,000)/50,000 = 1 → + 333 + 807
    expect(nyStateTax(200_000, 250_000, 'mfj')).toBeCloseTo(10_659.75 + 1140, 2)
  })

  it('uses a flat 10.9% above $25M AGI', () => {
    expect(nyStateTax(30_000_000, 30_000_000, 'single')).toBeCloseTo(3_270_000, 2)
  })

  it('adds NYC tax on the same taxable income', () => {
    // single, 58,000 interest - 8,000 = 50,000 taxable → NYC 1,813 (schedule) ≈ 369.36 + 489.06 + 954.75
    const r = computeTaxes(make({ state: 'NY', nycResident: true, taxableInterest: 58_000 }))
    const nyc = r.state.lines.find((l) => l.label.startsWith('New York City'))
    expect(nyc?.amount).toBeCloseTo(12_000 * 0.03078 + 13_000 * 0.03762 + 25_000 * 0.03819, 2)
  })

  it('gives the Empire State child credit by age', () => {
    // MFJ AGI 60,000 (below 110k): 1 under 4 + 1 older = 1,500
    const r = computeTaxes(make({ state: 'NY', filingStatus: 'mfj', taxableInterest: 60_000, childrenUnder17: 2, childrenUnder4: 1 }))
    expect(r.state.lines.find((l) => l.label.startsWith('Empire'))?.amount).toBe(-1500)
  })
})

describe('Washington', () => {
  it('taxes only long-term gains above the deduction', () => {
    // 7% × (500,000 - 278,000) = 15,540; dividends ignored
    const r = computeTaxes(make({ state: 'WA', longTermGains: 500_000, qualifiedDividends: 100_000 }))
    expect(r.state.tax).toBeCloseTo(15_540, 2)
  })

  it('adds 2.9% above $1M of taxable gains', () => {
    // taxable 1,222,000: 70,000 + 222,000 × 9.9%
    const r = computeTaxes(make({ state: 'WA', longTermGains: 1_500_000 }))
    expect(r.state.tax).toBeCloseTo(70_000 + 222_000 * 0.099, 2)
  })
})

describe('earned income', () => {
  it('taxes W-2 wages as ordinary income and reports payroll separately (single, $100k)', () => {
    // taxable 83,900: 1,240 + 4,560 + 33,500 × 22% (7,370) = 13,170
    const r = computeTaxes(make({ wages: 100_000 }))
    expect(r.federal.tax).toBeCloseTo(13_170, 2)
    // payroll: 6.2% + 1.45% = 7,650, not in the total
    expect(r.payroll.tax).toBeCloseTo(7650, 2)
    expect(r.total).toBeCloseTo(13_170, 2)
  })

  it('adds self-employment tax and the QBI deduction (single, $100k 1099)', () => {
    // net earnings 92,350; SE tax 15.3% = 14,129.55; half 7,064.775 → AGI 92,935.225
    // before QBI 76,835.225; QBI = min(20% × 92,935.225, 20% × 76,835.225) = 15,367.045
    // taxable 61,468.18 → 1,240 + 4,560 + 11,068.18 × 22% = 8,234.9996
    const r = computeTaxes(make({ selfEmployment: 100_000 }))
    expect(r.agi).toBeCloseTo(92_935.225, 3)
    expect(r.federal.tax).toBeCloseTo(8_234.9996 + 14_129.55, 2)
    expect(r.payroll.tax).toBe(0)
  })

  it('caps Social Security at the wage base and adds 0.9% Medicare above $200k (single)', () => {
    const r = computeTaxes(make({ wages: 250_000 }))
    expect(r.payroll.tax).toBeCloseTo(184_500 * 0.062 + 250_000 * 0.0145, 2)
    expect(r.federal.lines.find((l) => l.label.startsWith('Additional Medicare'))?.amount).toBeCloseTo(450, 2)
  })

  it('lets wages use up the wage base before self-employment earnings', () => {
    // wages 180,000; SE 50,000 → NE 46,175; SS room 4,500 → 558; Medicare 1,339.075
    // Additional Medicare: (46,175 - 20,000) × 0.9% = 235.575
    const r = computeTaxes(make({ wages: 180_000, selfEmployment: 50_000 }))
    expect(r.federal.lines.find((l) => l.label.startsWith('Self-employment'))?.amount).toBeCloseTo(1897.075, 3)
    expect(r.federal.lines.find((l) => l.label.startsWith('Additional Medicare'))?.amount).toBeCloseTo(235.575, 3)
  })

  it('refunds up to $1,700 per child once there are earnings (MFJ, 2 kids, $30k wages)', () => {
    // no income tax; refundable = min(4,400, 3,400, 15% × 27,500 = 4,125) = 3,400
    expect(computeTaxes(make({ filingStatus: 'mfj', childrenUnder17: 2, wages: 30_000 })).federal.tax).toBeCloseTo(-3400, 2)
  })

  it('applies NIIT only to investment income when wages make up the rest', () => {
    // single, wages 300k + interest 50k: NIIT on min(50k, 150k) = 1,900
    const r = computeTaxes(make({ wages: 300_000, taxableInterest: 50_000 }))
    expect(r.federal.lines.find((l) => l.label.startsWith('Net investment'))?.amount).toBeCloseTo(1900, 2)
  })

  it('counts California SDI toward the federal SALT deduction', () => {
    const r = computeTaxes(make({ state: 'CA', wages: 100_000 }))
    expect(r.payroll.lines.find((l) => l.label.startsWith('California SDI'))?.amount).toBeCloseTo(1300, 2)
    expect(r.payroll.saltEligibleTax).toBeCloseTo(1300, 2)
  })

  it('leaves wages untaxed in Washington', () => {
    expect(computeTaxes(make({ state: 'WA', wages: 500_000 })).state.tax).toBe(0)
  })
})
