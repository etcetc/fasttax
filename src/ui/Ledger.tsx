import { dollars } from '../engine/format'
import type { JurisdictionResult } from '../engine'
import { Panel } from './Panel'

/** One jurisdiction's return, laid out as ruled lines with right-aligned amounts. */
export function Ledger({ id, result, title }: { id: string; result: JurisdictionResult; title?: string }) {
  const d = result.deduction
  return (
    <Panel id={id} title={title ?? result.name} headline={<strong>{dollars(result.tax)}</strong>}>
      {d && (
        <p className="py-3 text-[14px] text-ink-soft">
          {d.used === 'itemized'
            ? `Itemizing saves more: ${dollars(d.itemized)} against a ${dollars(d.standard)} standard deduction.`
            : d.itemized > 0
              ? `The standard deduction is larger: ${dollars(d.standard)} against ${dollars(d.itemized)} itemized.`
              : `Standard deduction of ${dollars(d.standard)}.`}
        </p>
      )}
      {result.lines.length > 0 && (
        <table className={`w-full text-[14.5px] ${d ? '' : 'mt-3'}`}>
          <tbody>
            {result.lines.map((l, i) => (
              <tr key={i} className={l.detail ? 'text-ink-soft' : 'border-t border-rule/70'}>
                <td className={`py-1.5 ${l.detail ? 'pl-5 text-[13.5px]' : ''}`}>{l.label}</td>
                <td className={`py-1.5 text-right ${l.amount < 0 && !l.detail ? 'text-credit' : ''} ${l.detail ? 'text-[13.5px]' : ''}`}>
                  {dollars(l.amount)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold">
              <td className="pt-2">{result.totalLabel ?? 'Total tax'}</td>
              <td className="pt-2 text-right">{dollars(result.tax)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {result.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[13.5px] text-ink-soft">
          {result.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </Panel>
  )
}
