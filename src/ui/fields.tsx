import { useEffect, useId, useState, type ReactNode } from 'react'

const fieldBox =
  'w-full rounded-md border border-rule bg-field px-3 py-2 text-ink outline-none focus:border-owed'

function withCommas(n: number) {
  return n === 0 ? '' : n.toLocaleString('en-US')
}

export function MoneyField(props: { label: string; hint?: string; value: number; onChange: (n: number) => void }) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  // If the value changes from outside (a file opened, Clear all) while this field has
  // focus, show the new value rather than what was being typed.
  useEffect(() => {
    setDraft((d) => (d !== null && (Number(d) || 0) !== props.value ? String(props.value || '') : d))
  }, [props.value])
  return (
    <div className="grid grid-cols-[1fr_9.5rem] items-center gap-x-4 gap-y-0.5 py-2">
      <label htmlFor={id} className="text-[15px] leading-snug">
        {props.label}
        {props.hint && <span className="block text-[13px] text-ink-soft">{props.hint}</span>}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">$</span>
        <input
          id={id}
          inputMode="decimal"
          className={`${fieldBox} pl-6 text-right`}
          value={draft ?? withCommas(props.value)}
          placeholder="0"
          onFocus={() => setDraft(props.value ? String(props.value) : '')}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '')
            setDraft(raw)
            props.onChange(Number(raw) || 0)
          }}
        />
      </div>
    </div>
  )
}

export function CountField(props: { label: string; value: number; onChange: (n: number) => void; max?: number }) {
  const id = useId()
  return (
    <div className="grid grid-cols-[1fr_5rem] items-center gap-4 py-2">
      <label htmlFor={id} className="text-[15px]">{props.label}</label>
      <input
        id={id}
        type="number"
        min={0}
        max={props.max ?? 20}
        className={`${fieldBox} text-right`}
        value={props.value}
        onChange={(e) => props.onChange(Math.max(0, Math.min(props.max ?? 20, Math.floor(Number(e.target.value) || 0))))}
      />
    </div>
  )
}

export function Toggle(props: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2 text-[15px]">
      <input
        type="checkbox"
        className="size-4 accent-[var(--color-owed)]"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  )
}

export function SelectField<T extends string>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const id = useId()
  return (
    <div className="grid grid-cols-[1fr_11rem] items-center gap-4 py-2">
      <label htmlFor={id} className="text-[15px]">{props.label}</label>
      <select
        id={id}
        className="w-full rounded-md border border-rule bg-field px-3 py-2 outline-none focus:border-owed"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value as T)}
      >
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-rule pt-4 pb-3 first:border-t-0 first:pt-0">
      <h2 className="mb-1 text-[17px] font-semibold">{props.title}</h2>
      <div className="divide-y divide-rule/60">{props.children}</div>
    </section>
  )
}
