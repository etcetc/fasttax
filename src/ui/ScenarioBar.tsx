import { useEffect, useRef, useState } from 'react'
import type { TaxInputs } from '../engine'
import { cleanName, downloadScenario, MAX_FILE_BYTES, parseScenarioFile, sameInputs, type NamedScenario } from '../scenarios/file'

const LAST_KEY = 'fasttax.lastFile.v1'

/** The name and inputs last saved to or opened from a file, so we can say whether there are unsaved changes. */
interface LastFile { name: string; inputs: TaxInputs }

type Mode =
  | { kind: 'idle' }
  | { kind: 'naming'; name: string }
  | { kind: 'choosing'; scenarios: NamedScenario[]; index: number }

const button = 'rounded-md border border-rule bg-field px-3 py-1.5 text-[14px] hover:border-ink-soft'
const primary = 'rounded-md border border-owed bg-owed px-3 py-1.5 text-[14px] text-sheet disabled:opacity-40'

function readLast(): LastFile | null {
  try {
    const v = localStorage.getItem(LAST_KEY)
    return v ? (JSON.parse(v) as LastFile) : null
  } catch { return null }
}

export function ScenarioBar(props: { inputs: TaxInputs; onLoad: (inputs: TaxInputs) => void }) {
  const [last, setLast] = useState<LastFile | null>(readLast)
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (last) localStorage.setItem(LAST_KEY, JSON.stringify(last))
      else localStorage.removeItem(LAST_KEY)
    } catch { /* ignore */ }
  }, [last])

  const dirty = !last || !sameInputs(last.inputs, props.inputs)

  function save(name: string) {
    const clean = cleanName(name)
    downloadScenario(clean, props.inputs)
    setLast({ name: clean, inputs: props.inputs })
    setMode({ kind: 'idle' })
    setMessage({ text: `Saved “${clean}” to your downloads.` })
  }

  function open(s: NamedScenario) {
    props.onLoad(s.inputs)
    setLast({ name: s.name, inputs: s.inputs })
    setMode({ kind: 'idle' })
    setMessage({ text: `Opened “${s.name}”.` })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error('That file is too large to be a FastTax estimate.')
      const scenarios = parseScenarioFile(await file.text())
      if (scenarios.length === 1) open(scenarios[0])
      else setMode({ kind: 'choosing', scenarios, index: 0 })
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true })
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  let body
  if (mode.kind === 'naming') {
    body = (
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(mode.name) }}>
        <label htmlFor="scenario-name" className="sr-only">Name for this estimate</label>
        <input
          id="scenario-name"
          autoFocus
          maxLength={80}
          placeholder="Name this estimate"
          className="w-48 rounded-md border border-rule bg-field px-3 py-1.5 text-[14px] outline-none focus:border-owed"
          value={mode.name}
          onChange={(e) => setMode({ kind: 'naming', name: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && setMode({ kind: 'idle' })}
        />
        <button type="submit" className={primary}>Download</button>
        <button type="button" className={button} onClick={() => setMode({ kind: 'idle' })}>Cancel</button>
      </form>
    )
  } else if (mode.kind === 'choosing') {
    body = (
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <label htmlFor="scenario-pick">This file has {mode.scenarios.length} estimates:</label>
        <select
          id="scenario-pick"
          className="max-w-48 rounded-md border border-rule bg-field px-3 py-1.5"
          value={mode.index}
          onChange={(e) => setMode({ ...mode, index: Number(e.target.value) })}
        >
          {mode.scenarios.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
        </select>
        <button type="button" className={primary} onClick={() => open(mode.scenarios[mode.index])}>Open</button>
        <button type="button" className={button} onClick={() => setMode({ kind: 'idle' })}>Cancel</button>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={() => fileInput.current?.click()}>Open file…</button>
        <button type="button" className={primary} onClick={() => setMode({ kind: 'naming', name: last?.name ?? '' })}>
          Save to file…
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      {body}
      <p className="text-[13px] text-ink-soft" aria-live="polite">
        {message && (message.error || !dirty)
          ? <span className={message.error ? 'text-alert' : undefined}>{message.text}</span>
          : last
            ? dirty ? `Changes since “${last.name}” aren't saved to a file` : `“${last.name}”`
            : 'Files stay on your device'}
      </p>
    </div>
  )
}
