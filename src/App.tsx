import { useEffect, useMemo, useState } from 'react'
import { computeTaxes, EMPTY_INPUTS, provisionalFor, STATES, type FilingStatus, type StateCode, type TaxInputs } from './engine'
import { dollars } from './engine/format'
import { CountField, MoneyField, Section, SelectField, Toggle } from './ui/fields'
import { Ledger } from './ui/Ledger'
import { BracketTable, WhatIf } from './ui/MarginalRates'
import { ScenarioBar } from './ui/ScenarioBar'
import { Panel } from './ui/Panel'
import { sanitizeInputs } from './scenarios/file'

const STORAGE_KEY = 'fasttax.inputs.v1'

const STATUS_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married, joint' },
  { value: 'mfs', label: 'Married, separate' },
  { value: 'hoh', label: 'Head of household' },
]

const STATE_OPTIONS = STATES.map((s) => ({ value: s.code, label: s.name }))

function loadInputs(): TaxInputs {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return sanitizeInputs(JSON.parse(saved))
  } catch { /* storage unavailable */ }
  return EMPTY_INPUTS
}

export default function App() {
  const [inp, setInp] = useState<TaxInputs>(loadInputs)
  const set = <K extends keyof TaxInputs>(k: K) => (v: TaxInputs[K]) => setInp((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(inp)) } catch { /* ignore */ }
  }, [inp])

  const result = useMemo(() => computeTaxes(inp), [inp])
  const married = inp.filingStatus === 'mfj' || inp.filingStatus === 'mfs'
  const stateName = STATES.find((s) => s.code === inp.state)!.name

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 lg:py-12">
      <header className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight">FastTax</h1>
            <p className="text-[14px] text-ink-soft">2026 income tax estimate</p>
          </div>
          <ScenarioBar inputs={inp} onLoad={setInp} />
        </div>
        <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-ink-soft">
          A quick estimate of your 2026 federal and state income tax, with a breakdown of where it
          comes from and what your next dollar of income would cost. Everything is calculated in
          your browser; nothing you type is sent anywhere. It's an estimate, not tax advice.
        </p>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
        <form className="self-start rounded-lg border border-rule bg-sheet px-5 py-5" onSubmit={(e) => e.preventDefault()}>
          <Section title="Household">
            <SelectField label="Filing status" value={inp.filingStatus} options={STATUS_OPTIONS} onChange={set('filingStatus')} />
            <SelectField label="State of residence" value={inp.state} options={STATE_OPTIONS} onChange={set('state')} />
            {inp.state === 'NY' && <Toggle label="I live in New York City" checked={inp.nycResident} onChange={set('nycResident')} />}
            <div>
              <Toggle label="I'm 65 or older" checked={inp.filer65} onChange={set('filer65')} />
              {married && <Toggle label="My spouse is 65 or older" checked={inp.spouse65} onChange={set('spouse65')} />}
            </div>
            <CountField label="Children under 17" value={inp.childrenUnder17} onChange={set('childrenUnder17')} />
            {inp.state === 'NY' && inp.childrenUnder17 > 0 && (
              <CountField label="…of whom under 4" value={inp.childrenUnder4} max={inp.childrenUnder17} onChange={set('childrenUnder4')} />
            )}
            <CountField label="Other dependents" value={inp.otherDependents} onChange={set('otherDependents')} />
          </Section>

          <Section title="Income">
            <MoneyField label="W-2 wages" hint="Box 1, after 401(k) and pre-tax benefits" value={inp.wages} onChange={set('wages')} />
            <MoneyField label="1099 income" hint="Net self-employment profit" value={inp.selfEmployment} onChange={set('selfEmployment')} />
            <MoneyField label="Interest" value={inp.taxableInterest} onChange={set('taxableInterest')} />
            <MoneyField label="Qualified dividends" hint="1099-DIV box 1b" value={inp.qualifiedDividends} onChange={set('qualifiedDividends')} />
            <MoneyField label="Other dividends" hint="Box 1a minus box 1b" value={inp.nonQualifiedDividends} onChange={set('nonQualifiedDividends')} />
            <MoneyField label="Long-term capital gains" hint="Held over a year, net of losses" value={inp.longTermGains} onChange={set('longTermGains')} />
          </Section>

          <Section title="Deductible spending">
            <MoneyField label="Medical" hint="Premiums paid after tax, plus out of pocket" value={inp.medical} onChange={set('medical')} />
            <MoneyField label="Property tax" value={inp.propertyTax} onChange={set('propertyTax')} />
            <MoneyField label="Mortgage interest" hint="On up to $750k of home debt" value={inp.mortgageInterest} onChange={set('mortgageInterest')} />
            <MoneyField label="Charitable gifts" hint="Cash to public charities" value={inp.charitable} onChange={set('charitable')} />
          </Section>

          <button
            type="button"
            className="mt-2 text-[14px] text-ink-soft underline underline-offset-4 hover:text-ink"
            onClick={() => setInp(EMPTY_INPUTS)}
          >
            Clear all
          </button>
        </form>

        <main className="space-y-5 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <Summary income={result.grossIncome} federal={result.federal.tax} state={result.state.tax} payroll={result.payroll.tax}
            rate={result.effectiveRate} stateName={stateName} />
          <div className="space-y-2.5">
            <Ledger id="federal" result={result.federal} />
            <Ledger id="state" result={result.state} />
            {result.payroll.tax > 0 && <Ledger id="payroll" title="Payroll withheld from wages" result={result.payroll} />}
            {result.grossIncome > 0 && <BracketTable result={result} />}
            {result.grossIncome > 0 && <WhatIf inputs={inp} result={result} />}
            <Assumptions state={inp.state} />
          </div>
        </main>
      </div>

      {result.grossIncome > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-rule bg-sheet/95 px-4 py-3 backdrop-blur lg:hidden">
          <p className="mx-auto flex max-w-6xl justify-between text-[15px]">
            <span>You'd owe <strong>{dollars(result.total)}</strong></span>
            <span className="text-ink-soft">{(result.effectiveRate * 100).toFixed(1)}% of income</span>
          </p>
        </div>
      )}
    </div>
  )
}

function Summary(props: { income: number; federal: number; state: number; payroll: number; rate: number; stateName: string }) {
  const total = props.federal + props.state
  if (props.income <= 0) {
    return (
      <div className="py-2">
        <p className="text-[28px] font-extrabold leading-tight tracking-tight sm:text-[34px]">
          Enter your income to see what you'd owe.
        </p>
      </div>
    )
  }
  const pct = (n: number) => `${Math.max(0, (n / props.income) * 100)}%`
  return (
    <div className="py-2">
      <p className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-[32px]">
        You'd owe {dollars(total)} on {dollars(props.income)} of income.
      </p>
      <p className="mt-2 text-[16px] text-ink-soft">
        That's {(props.rate * 100).toFixed(1)}% overall: {dollars(props.federal)} federal and {dollars(props.state)} {props.stateName}.
        {props.payroll > 0 && <> Payroll taxes withheld from wages add {dollars(props.payroll)}.</>}
      </p>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-kept" role="img"
        aria-label={`Federal ${dollars(props.federal)}, state ${dollars(props.state)}, kept ${dollars(props.income - total)}`}>
        <div className="bg-owed" style={{ width: pct(props.federal) }} />
        <div className="bg-state" style={{ width: pct(props.state) }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-owed align-middle" />Federal</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-state align-middle" />State</span>
        <span><i className="mr-1.5 inline-block size-2.5 rounded-sm bg-kept align-middle ring-1 ring-rule" />Yours to keep</span>
      </div>
    </div>
  )
}

function Assumptions({ state }: { state: StateCode }) {
  const provisional = provisionalFor(state)
  return (
    <Panel id="assumptions" title="What this estimate leaves out">
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[14px] text-ink-soft">
        <li>Retirement withdrawals, Social Security benefits, and short-term gains.</li>
        <li>For 1099 income: business deductions beyond net profit, self-employed health insurance and retirement contributions. The QBI deduction assumes no employees or equipment.</li>
        <li>State payroll taxes other than California SDI, and city or county income taxes except where noted.</li>
        <li>State credits that depend on earnings or rent, retirement-income exclusions, and credits for tax paid to other states.</li>
        <li>Alternative minimum tax, and penalties for not paying estimated tax.</li>
        <li>State adjustments to interest: Treasury interest is exempt from state tax, and other states' muni interest is taxable.</li>
        <li>NIIT is figured on all investment income, without subtracting state tax paid on it.</li>
        {provisional.map((p) => <li key={p}>{p}.</li>)}
      </ul>
    </Panel>
  )
}
