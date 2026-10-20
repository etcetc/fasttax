import { EMPTY_INPUTS, STATE_CODES, type FilingStatus, type TaxInputs } from '../engine'

/** A scenario saved to the user's own device. Nothing is stored on a server. */
export interface ScenarioFile {
  app: 'fasttax'
  version: 1
  name: string
  savedAt: string
  inputs: TaxInputs
}

export interface NamedScenario {
  name: string
  inputs: TaxInputs
}

export const MAX_FILE_BYTES = 1_000_000
const MAX_AMOUNT = 1_000_000_000
const MAX_COUNT = 20
const STATUSES: FilingStatus[] = ['single', 'mfj', 'mfs', 'hoh']

const MONEY_FIELDS = [
  'wages', 'selfEmployment', 'taxableInterest', 'qualifiedDividends', 'nonQualifiedDividends',
  'longTermGains', 'medical', 'propertyTax', 'mortgageInterest', 'charitable',
] as const satisfies readonly (keyof TaxInputs)[]
const COUNT_FIELDS = ['childrenUnder17', 'childrenUnder4', 'otherDependents'] as const satisfies readonly (keyof TaxInputs)[]
const FLAG_FIELDS = ['nycResident', 'filer65', 'spouse65'] as const satisfies readonly (keyof TaxInputs)[]

export function cleanName(raw: string): string {
  return raw.trim().slice(0, 80) || 'My estimate'
}

export function fileNameFor(name: string): string {
  const slug = cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'estimate'
  return `fasttax-${slug}.json`
}

export function toFileText(name: string, inputs: TaxInputs, now: Date = new Date()): string {
  const file: ScenarioFile = { app: 'fasttax', version: 1, name: cleanName(name), savedAt: now.toISOString(), inputs }
  return JSON.stringify(file, null, 2) + '\n'
}

/**
 * Build inputs from untrusted data: only known fields are read, each is checked and
 * clamped, and anything missing or invalid falls back to the empty value.
 */
export function sanitizeInputs(raw: unknown): TaxInputs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: TaxInputs = { ...EMPTY_INPUTS }
  for (const k of MONEY_FIELDS) {
    const v = src[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(MAX_AMOUNT, Math.max(0, v))
  }
  for (const k of COUNT_FIELDS) {
    const v = src[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(MAX_COUNT, Math.max(0, Math.floor(v)))
  }
  for (const k of FLAG_FIELDS) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean
  }
  if (typeof src.filingStatus === 'string' && STATUSES.includes(src.filingStatus as FilingStatus)) {
    out.filingStatus = src.filingStatus as FilingStatus
  }
  if (typeof src.state === 'string' && STATE_CODES.has(src.state)) out.state = src.state
  out.childrenUnder4 = Math.min(out.childrenUnder4, out.childrenUnder17)
  return out
}

/**
 * Read a saved file. Accepts the current one-scenario format and the earlier
 * `{ "<name>": { inputs, savedAt } }` file that held several. Throws an Error whose
 * message can be shown to the user.
 */
export function parseScenarioFile(text: string): NamedScenario[] {
  if (text.length > MAX_FILE_BYTES) throw new Error("That file is too large to be a FastTax estimate.")
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't a FastTax estimate (it isn't valid JSON).")
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error("That file isn't a FastTax estimate.")
  }
  const obj = data as Record<string, unknown>
  if (obj.app === 'fasttax') {
    if (obj.version !== 1) throw new Error('That estimate was saved by a newer version of FastTax.')
    return [{ name: cleanName(String(obj.name ?? '')), inputs: sanitizeInputs(obj.inputs) }]
  }
  const older = Object.entries(obj)
    .filter(([, v]) => v && typeof v === 'object' && 'inputs' in (v as object))
    .map(([name, v]) => ({ name: cleanName(name), inputs: sanitizeInputs((v as { inputs: unknown }).inputs) }))
  if (older.length === 0) throw new Error("That file isn't a FastTax estimate.")
  return older
}

/** Hand the file to the browser to save in the user's downloads. */
export function downloadScenario(name: string, inputs: TaxInputs) {
  const blob = new Blob([toFileText(name, inputs)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileNameFor(name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function sameInputs(a: TaxInputs, b: TaxInputs): boolean {
  return (Object.keys(EMPTY_INPUTS) as (keyof TaxInputs)[]).every((k) => a[k] === b[k])
}
