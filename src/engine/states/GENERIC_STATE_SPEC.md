# Generic state rules — data spec

Every state without a hand-written module (`ca.ts`, `ny.ts`, `wa.ts`) is described by one
JSON file, `src/data/2026/states/<xx>.json` (lower-case postal code), and computed by
`src/engine/states/generic.ts`. This document is the contract between the data and the
engine: a field means exactly what is written here, nothing more.

## Shape

```ts
type Status = 'single' | 'mfj' | 'mfs' | 'hoh'
type ByStatus<T> = { single: T; mfj: T; mfs: T; hoh: T }
type Bracket = [number, number]          // [threshold, rate]; rate applies above threshold

interface Phaseout {
  /** Income the phaseout is measured against. Default 'agi' (the state's starting income). */
  basis?: 'agi' | 'federalAgi'
  start: ByStatus<number>
  /** EITHER: amount falls linearly from full at `start` to zero at `end` */
  end?: ByStatus<number>
  /** OR: amount falls by this many dollars per dollar above `start` (e.g. 0.12) */
  ratePerDollar?: number
}

interface GenericStateRules {
  state: string                 // postal code, e.g. "GA"
  name: string                  // "Georgia"
  year: 2026                    // tax year this estimate is for
  dataYear: number              // year the figures come from (2025 if 2026 not published)
  sources: string[]             // URL or document per figure group
  provisional: string[]         // each figure that is not a confirmed 2026 value, in plain words
  notes: string[]               // 0–3 short sentences shown to users (e.g. "Local county tax not included.")

  /** What the state's computation starts from. */
  startingPoint: 'federalAgi' | 'federalTaxable'

  brackets: ByStatus<Bracket[]> // flat-tax states: one bracket [[0, rate]]

  standardDeduction?: {
    amount: ByStatus<number> | 'federal'   // 'federal' = the federal standard deduction incl. its 65+ add-on
    seniorExtra?: number                   // extra per person 65+ (not used with 'federal')
    phaseout?: Phaseout
  }

  /** Present only if the state lets you itemize. The engine uses the larger of this and the standard deduction. */
  itemized?: {
    medicalFloorRate: number | null       // deduct medical above this share of AGI; null = no medical deduction
    propertyTax: boolean
    mortgageInterest: boolean
    charitable: boolean
    saltCap: ByStatus<number> | null       // cap on property tax; null = uncapped. State income tax is never included.
    requiresFederalItemizing?: boolean      // true if you may itemize only when you itemize federally
  }

  /** Subtracted from income. perFiler counts 2 on a joint return. perSenior is per person 65+. */
  exemptions?: { perFiler: number; perDependent: number; perSenior: number; phaseout?: Phaseout }

  /** Nonrefundable credits subtracted from tax (never below zero). */
  credits?: { perFiler: number; perDependent: number; perSenior: number; phaseout?: Phaseout }

  capitalGains?: {
    /** Share of long-term gains excluded from income (e.g. 0.5 for Arkansas). */
    exclusionRate?: number
    exclusionCap?: ByStatus<number>        // maximum excluded dollars
    /** Excluded dollars are max(min(gains, flatExclusion), the rate-based exclusion). */
    flatExclusion?: number
    /** Gains taxed at no more than this rate (alternative tax, e.g. Hawaii 0.0725). */
    maxRate?: number
    /** Gains taxed on their own schedule, stacked on top of other income (e.g. Montana). */
    schedule?: ByStatus<Bracket[]>
    /** Whether qualified dividends get the same treatment as long-term gains. Default false. */
    includesQualifiedDividends?: boolean
  }

  /** Extra tax on income above a threshold (e.g. Massachusetts 4% over ~$1.1M). */
  surtax?: { threshold: ByStatus<number>; rate: number; base: 'taxable' | 'investmentIncome'; label: string }

  /** Deduction for federal income tax paid (Alabama, Missouri, Oregon…). */
  federalTaxDeduction?: { share: number; cap: ByStatus<number> | null; phaseout?: Phaseout }

  /** A separate deduction for property tax that is not part of itemizing (e.g. New Jersey). */
  propertyTaxDeduction?: { cap: ByStatus<number> }

  /** Local income tax that nearly every resident pays (e.g. Maryland counties). Typical rate. */
  localTax?: { rate: number; label: string; base: 'stateTaxable' | 'agi' }

  /** Whether the state income tax counts toward the federal SALT deduction. Default true. */
  countsAsFederalSalt?: boolean
}
```

## Order of computation

All money amounts are annual dollars. "Gains" means long-term capital gains, plus qualified
dividends when `capitalGains.includesQualifiedDividends` is true.

1. **Starting income**
   - `federalAgi`: federal AGI (wages + 1099 profit − half of self-employment tax + interest + all dividends + long-term gains).
   - `federalTaxable`: federal taxable income (after the federal deduction, senior deduction and QBI).
2. **Gains exclusion**: `excluded = max(min(gains, flatExclusion ?? 0), min(gains × exclusionRate, exclusionCap ?? ∞))`. Subtract from income.
3. **Federal tax deduction**: `min(federal income tax × share, cap ?? ∞)`, then phased out. Subtract. "Federal income tax" is regular tax less nonrefundable credits, excluding self-employment tax and NIIT.
4. **Deduction**: the standard deduction (amount for the status, plus `seniorExtra` × people 65+, less the phaseout), or itemized if larger. Itemized = (medical − floor × AGI, if ≥ 0) + property tax (capped by `saltCap`) + mortgage interest + charitable gifts, each only if enabled. If `requiresFederalItemizing` and the federal return takes the standard deduction, itemizing is not allowed. Subtract.
5. **Exemptions**: `(perFiler × filers + perDependent × dependents + perSenior × seniors)`, phased out. Subtract.
6. **Property tax deduction**: `min(property tax, cap)`. Subtract.
7. **Taxable income** = max(0, result).
8. **Tax**
   - default: brackets applied to taxable income.
   - `schedule`: the gains part (min(taxable, remaining gains)) sits on top. Tax = brackets(ordinary part) + schedule(taxable) − schedule(ordinary part).
   - `maxRate`: tax = min(brackets(taxable), brackets(taxable − gains part) + gains part × maxRate).
9. **Surtax**: rate × max(0, base − threshold). `investmentIncome` = interest + all dividends + long-term gains.
10. **Credits**: phased-out total, limited to tax (steps 8 + 9).
11. **Local tax**: rate × base (`stateTaxable` = step 7, `agi` = starting income before step 2).
12. **Total** = tax + surtax − credits + local tax.

Phaseouts: with `end`, the amount is multiplied by `1 − clamp((x − start)/(end − start), 0, 1)`;
with `ratePerDollar`, the amount is reduced by `ratePerDollar × max(0, x − start)`, not below
zero. `x` is the starting income (or federal AGI if `basis: 'federalAgi'`).

"Filers" is 2 on a joint return, otherwise 1. "Seniors" is the number of people 65+ on
the return (the spouse counts only on a joint return). "Dependents" is children under 17 +
other dependents.

## What to leave out

Things the engine cannot express: refundable credits (EITC, child credits that need earned
income), low-income forgiveness schedules, credits for taxes paid to other states, retirement
income exclusions, and anything specific to pensions or Social Security. Note any that would
move a typical result by more than a few hundred dollars in `notes`.
