export type FilingStatus = 'single' | 'mfj' | 'mfs' | 'hoh'
/** Postal code of any state or DC. */
export type StateCode = string

export interface TaxInputs {
  year: 2026
  filingStatus: FilingStatus
  state: StateCode
  /** Only read when state is NY. */
  nycResident: boolean
  filer65: boolean
  /** Ignored unless filing jointly or separately. */
  spouse65: boolean
  childrenUnder17: number
  /** Subset of childrenUnder17. Only read for NY's Empire State child credit. */
  childrenUnder4: number
  otherDependents: number

  /** W-2 box 1: wages after pre-tax 401(k) and benefits. */
  wages: number
  /** 1099 / Schedule C net profit. */
  selfEmployment: number

  taxableInterest: number
  qualifiedDividends: number
  /** Dividends that are not qualified (1099-DIV box 1a minus box 1b). */
  nonQualifiedDividends: number
  longTermGains: number

  medical: number
  propertyTax: number
  mortgageInterest: number
  /** Cash gifts to public charities. */
  charitable: number
}

/** One row of the breakdown shown to the reader. */
export interface Line {
  label: string
  amount: number
  /** Stable id so the same line can be matched before and after a change. */
  key?: string
  /** 'tax' lines add up to the jurisdiction's tax; 'base' lines are the amounts it is figured on. */
  role?: 'tax' | 'base'
  /** Indented rows explain the row above them. */
  detail?: boolean
}

export interface DeductionChoice {
  standard: number
  itemized: number
  used: 'standard' | 'itemized'
}

/** Where income sits on one rate schedule, and how far it is to the next rate. */
export interface BracketPosition {
  label: string
  rate: number
  nextRate: number | null
  /** Dollars of additional income before nextRate applies. */
  headroom: number | null
  /** What the headroom is measured in, e.g. "taxable income" or "income". */
  unit: string
}

/** Something at the current income that makes the true marginal rate differ from the bracket rate. */
export interface MarginalFactor {
  text: string
  /** Income types it affects. */
  appliesTo: IncomeType[]
}

export type IncomeType = 'wages' | 'selfEmployment' | 'taxableInterest' | 'longTermGains'

export interface JurisdictionResult {
  name: string
  /** Defaults to "Total tax". */
  totalLabel?: string
  tax: number
  /** State and local income tax that counts toward the federal SALT deduction. */
  saltEligibleTax: number
  deduction?: DeductionChoice
  lines: Line[]
  notes: string[]
  positions: BracketPosition[]
  factors: MarginalFactor[]
  /** Federal only: the figures state returns start from. */
  federalContext?: FederalContext
  /** Federal only: how qualified dividends and long-term gains split across the 0/15/20% rates. */
  gainsSplit?: { atZero: number; atFifteen: number; atTwenty: number }
}

export interface TaxResult {
  /** Everything entered under Income, before any deduction. */
  grossIncome: number
  agi: number
  federal: JurisdictionResult
  state: JurisdictionResult
  /** Employee Social Security, Medicare and state payroll taxes withheld from wages. Not in `total`. */
  payroll: JurisdictionResult
  /** Federal + state income tax, including self-employment tax. */
  total: number
  effectiveRate: number
}

/** [threshold, rate] — rate applies to income above threshold up to the next row. */
export type Bracket = [number, number]
export type ByStatus<T> = Record<FilingStatus, T>

/** What a state needs from the federal return. */
export interface FederalContext {
  agi: number
  taxableIncome: number
  /** Regular tax less nonrefundable credits; no self-employment tax or NIIT. */
  incomeTax: number
  /** Federal standard deduction including the 65+ add-on. */
  standardDeduction: number
  itemizes: boolean
}
