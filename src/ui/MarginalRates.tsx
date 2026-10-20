import { useId, useMemo, useState } from 'react'
import { dollars } from '../engine/format'
import { WHAT_IF_TYPES, whatIf, type ChangedLine, type ChangedSection, type WhatIfType } from '../engine/marginal'
import type { BracketPosition, TaxInputs, TaxResult } from '../engine'
import { MoneyField } from './fields'
import { Panel } from './Panel'

export function percent(rate: number): string {
  const s = (rate * 100).toFixed(2).replace(/\.?0+$/, '')
  return `${s === '-0' ? '0' : s}%`
}

function signed(n: number): string {
  if (Math.abs(n) < 0.5) return '$0'
  return (n > 0 ? '+' : '') + dollars(n)
}

function PositionRows({ title, positions }: { title: string; positions: BracketPosition[] }) {
  if (positions.length === 0) return null
  return (
    <>
      <tr>
        <th colSpan={4} scope="colgroup" className="pt-3 pb-1 text-left text-[14px] font-semibold">{title}</th>
      </tr>
      {positions.map((p) => (
        <tr key={p.label} className="border-t border-rule/70">
          <th scope="row" className="py-1.5 pr-2 text-left font-normal">{p.label}</th>
          <td className="whitespace-nowrap py-1.5 pl-2 text-right">{percent(p.rate)}</td>
          <td className="whitespace-nowrap py-1.5 pl-2 text-right">{p.nextRate === null ? '—' : percent(p.nextRate)}</td>
          <td className="py-1.5 pl-3 text-right">
            {p.headroom === null
              ? <span className="text-ink-soft">Top rate</span>
              : <>{dollars(p.headroom)}<span className="block text-[12.5px] text-ink-soft">more {p.unit}</span></>}
          </td>
        </tr>
      ))}
    </>
  )
}

export function BracketTable({ result }: { result: TaxResult }) {
  const { federal, state } = result
  const fed = federal.positions[0]
  const st = state.positions[0]
  const split = federal.gainsSplit
  const hasGains = !!split && split.atZero + split.atFifteen + split.atTwenty > 0
  const gainsRow = federal.positions.find((p) => p.label.startsWith('Gains'))
  const fedPart = hasGains && gainsRow
    ? `${percent(fed.rate)} ordinary, ${percent(gainsRow.rate)} gains`
    : `${percent(fed.rate)} federal`
  const headline = `${fedPart}, ${st ? `${percent(st.rate)} ${state.name}` : 'no state tax'}`
  return (
    <Panel id="brackets" title="Current tax bracket" headline={headline}>
      <table className="mt-1 w-full text-[14px] sm:text-[14.5px]">
        <thead>
          <tr className="text-[13px] text-ink-soft">
            <th className="pt-2 text-left font-normal"><span className="sr-only">Schedule</span></th>
            <th className="pt-2 pl-2 text-right font-normal">Now</th>
            <th className="pt-2 pl-2 text-right font-normal">Next</th>
            <th className="pt-2 pl-3 text-right font-normal">Room before next</th>
          </tr>
        </thead>
        <tbody>
          <PositionRows title="Federal" positions={federal.positions} />
          <PositionRows title={state.name} positions={state.positions} />
        </tbody>
      </table>
      {state.positions.length === 0 && <p className="mt-2 text-[13.5px] text-ink-soft">{state.name} has no income tax.</p>}
    </Panel>
  )
}

function SectionRows({ section, muted }: { section: ChangedSection; muted?: boolean }) {
  return (
    <>
      <tr className={`border-t border-rule/70 ${muted ? 'text-ink-soft' : 'font-semibold'}`}>
        <th scope="row" className="pt-2 pb-1 text-left">{section.name}</th>
        <td className="pt-2 pb-1 text-right">{signed(section.change)}</td>
      </tr>
      {section.rows.map((r) => <ChangeRow key={r.label} row={r} />)}
    </>
  )
}

function ChangeRow({ row }: { row: ChangedLine }) {
  return (
    <tr className="text-ink-soft">
      <td className="py-0.5 pl-4 text-[13.5px]">
        {row.label}
        {row.note && <span className="block text-[13px] text-ink">{row.note}</span>}
      </td>
      <td className="py-0.5 align-top text-right text-[13.5px]">{signed(row.change)}</td>
    </tr>
  )
}

export function WhatIf({ inputs, result }: { inputs: TaxInputs; result: TaxResult }) {
  const [amount, setAmount] = useState(1000)
  const [type, setType] = useState<WhatIfType>('taxableInterest')
  const typeId = useId()
  const r = useMemo(() => whatIf(inputs, type, amount, result), [inputs, type, amount, result])
  const typeLabel = WHAT_IF_TYPES.find((t) => t.key === type)!.label.toLowerCase()

  const headline = amount > 0
    ? <>{dollars(amount)} of {typeLabel}: <strong>{signed(r.extraTax)}</strong></>
    : undefined
  return (
    <Panel id="what-if" title="What if I add income?" headline={headline}>
      <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
        <MoneyField label="Amount" value={amount} onChange={setAmount} />
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 py-2 sm:grid-cols-[auto_1fr]">
          <label htmlFor={typeId} className="text-[15px]">of</label>
          <select
            id={typeId}
            className="w-full rounded-md border border-rule bg-field px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value as WhatIfType)}
          >
            {WHAT_IF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {amount > 0 && (
        <>
          <p className="mt-3 text-[17px]">
            <strong>{signed(r.extraTax)}</strong> more income tax on {dollars(amount)} of {typeLabel}
            <span className="text-ink-soft">: your marginal rate is <strong className="text-ink">{percent(r.rate)}</strong>.</span>
          </p>

          <table className="mt-2 w-full text-[14.5px]">
            <tbody>
              <SectionRows section={r.federal} />
              <SectionRows section={r.state} />
              {r.payroll.change !== 0 && (
                <>
                  <SectionRows section={{ ...r.payroll, name: 'Payroll withheld (not in the total)' }} muted />
                </>
              )}
            </tbody>
          </table>

          {r.underneath.length > 0 && (
            <>
              <h4 className="mt-4 text-[14px] font-semibold">Underneath, on the federal return</h4>
              <table className="w-full text-[13.5px] text-ink-soft">
                <tbody>
                  {r.underneath.map((l) => (
                    <tr key={l.label}>
                      <td className="py-0.5">{l.label}</td>
                      <td className="py-0.5 text-right">{signed(l.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {r.reasons.length > 0 && (
            <>
              <h4 className="mt-4 text-[14px] font-semibold">Why it isn't just the bracket rate</h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] text-ink-soft">
                {r.reasons.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  )
}
