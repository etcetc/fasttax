import type { Bracket } from './types'

/** Tax on `income` under a progressive rate schedule. */
export function taxFromBrackets(income: number, brackets: Bracket[]): number {
  if (income <= 0) return 0
  let tax = 0
  for (let i = 0; i < brackets.length; i++) {
    const [floor, rate] = brackets[i]
    const ceiling = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity
    if (income <= floor) break
    tax += (Math.min(income, ceiling) - floor) * rate
  }
  return tax
}

export const clampZero = (n: number) => Math.max(0, n)

export function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

/** Count of people age 65+ on the return. */
export function seniorsOnReturn(filer65: boolean, spouse65: boolean, married: boolean): number {
  return (filer65 ? 1 : 0) + (married && spouse65 ? 1 : 0)
}

/** Rate at `income` on a schedule, the next rate up, and the room before it. */
export function positionIn(brackets: Bracket[], income: number) {
  const x = Math.max(0, income)
  let i = 0
  while (i + 1 < brackets.length && x >= brackets[i + 1][0]) i++
  const next = brackets[i + 1]
  return {
    rate: brackets[i][1],
    nextRate: next ? next[1] : null,
    headroom: next ? next[0] - x : null,
  }
}
