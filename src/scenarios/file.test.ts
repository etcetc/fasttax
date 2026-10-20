import { describe, expect, it } from 'vitest'
import { EMPTY_INPUTS } from '../engine'
import { fileNameFor, MAX_FILE_BYTES, parseScenarioFile, sanitizeInputs, toFileText } from './file'

const sample = { ...EMPTY_INPUTS, filingStatus: 'mfj' as const, state: 'NY', wages: 120_000, childrenUnder17: 2, childrenUnder4: 1 }

describe('saved files', () => {
  it('round-trips a scenario', () => {
    const text = toFileText('Base case', sample, new Date('2026-10-20T00:00:00Z'))
    expect(JSON.parse(text)).toMatchObject({ app: 'fasttax', version: 1, name: 'Base case', savedAt: '2026-10-20T00:00:00.000Z' })
    expect(parseScenarioFile(text)).toEqual([{ name: 'Base case', inputs: sample }])
  })

  it('opens the earlier multi-scenario file', () => {
    const old = JSON.stringify({
      'Sell house': { inputs: { longTermGains: 900_000 }, savedAt: 'x' },
      Base: { inputs: { wages: 50_000, state: 'WA' }, savedAt: 'y' },
    })
    const got = parseScenarioFile(old)
    expect(got.map((s) => s.name)).toEqual(['Sell house', 'Base'])
    expect(got[0].inputs.longTermGains).toBe(900_000)
    expect(got[1].inputs).toEqual({ ...EMPTY_INPUTS, wages: 50_000, state: 'WA' })
  })

  it('reads only known fields and clamps bad values', () => {
    const got = sanitizeInputs({
      wages: -5, taxableInterest: 1e15, longTermGains: '100', medical: NaN, charitable: 2500,
      childrenUnder17: 3.7, childrenUnder4: 9, otherDependents: 999,
      filer65: 'yes', spouse65: true, filingStatus: 'married', state: 'XX',
      __proto__: { polluted: true }, extra: '<script>',
    })
    expect(got).toEqual({
      ...EMPTY_INPUTS,
      wages: 0, taxableInterest: 1_000_000_000, charitable: 2500,
      childrenUnder17: 3, childrenUnder4: 3, otherDependents: 20, spouse65: true,
    })
    expect('extra' in got).toBe(false)
  })

  it('rejects files that are not estimates, with a message for the user', () => {
    expect(() => parseScenarioFile('not json')).toThrow("isn't valid JSON")
    expect(() => parseScenarioFile('[1,2]')).toThrow("isn't a FastTax estimate")
    expect(() => parseScenarioFile('{"hello": "world"}')).toThrow("isn't a FastTax estimate")
    expect(() => parseScenarioFile(JSON.stringify({ app: 'fasttax', version: 2 }))).toThrow('newer version')
    expect(() => parseScenarioFile(' '.repeat(MAX_FILE_BYTES + 1))).toThrow('too large')
  })

  it('makes a safe file name', () => {
    expect(fileNameFor('Sell house / 2026!')).toBe('fasttax-sell-house-2026.json')
    expect(fileNameFor('   ')).toBe('fasttax-my-estimate.json')
    expect(fileNameFor('日本')).toBe('fasttax-estimate.json')
  })
})
