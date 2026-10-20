# FastTax — Claude Session Guide

A one-page estimator of federal + state income tax on W-2 wages, 1099 income,
interest, dividends, and long-term capital gains, for all 50 states and DC. Vite + React 19 +
TypeScript + Tailwind v4, tested with vitest. A static site with no server, database or
analytics, deployed on Vercel from GitHub.

Borrows its working rules from `../PFMs/ffpm/CLAUDE.md`; the ones that apply here are
restated below so this file stands alone.

## Layout

| Path | What it holds |
|---|---|
| `src/data/<year>/*.json` | Every tax number: brackets, deductions, caps, credits. One file per jurisdiction, with `sources` and a `provisional` list of values not yet published for that year |
| `src/engine/federal.ts` | Federal: deductions, 0/15/20% stacking, senior deduction, SALT cap, 37%-bracket itemized limit, QBI, child credits (incl. refundable), SE tax, Additional Medicare, NIIT |
| `src/engine/payroll.ts` | Self-employment tax, Additional Medicare, and employee payroll (Social Security, Medicare, CA SDI) — payroll is reported but kept out of the income-tax total |
| `src/engine/marginal.ts` | `whatIf(inputs, type, amount)`: recomputes the whole return with more income and lists every keyed line that changed |
| `src/engine/states/ca.ts`, `ny.ts`, `wa.ts` | Hand-written state modules, for rules the shared engine can't express |
| `src/engine/states/generic.ts` | Shared engine for the other 40 income-tax states; contract in `GENERIC_STATE_SPEC.md` |
| `src/data/2026/states/<xx>.json` | One rules file per generic state, with sources and `provisional` |
| `src/engine/states/cases/<xx>.json` | Two hand-worked cases per generic state, checked by `generic.test.ts` |
| `src/data/2026/no-income-tax.json` | AK, FL, NV, NH, SD, TN, TX, WY |
| `src/engine/index.ts` | `computeTaxes()` — federal and state worked out in turn until they settle (state tax feeds federal SALT; some states start from federal taxable income or deduct federal tax) |
| `src/engine/*.test.ts` | Expected values worked by hand from published schedules |
| `src/ui/`, `src/App.tsx` | Inputs on the left, results on the right; `ScenarioBar` in the header; under the summary, collapsible `Panel`s in this order: federal, state, payroll, `BracketTable` ("Current tax bracket"), `WhatIf`, assumptions. Each panel shows one headline when closed and remembers open/closed in localStorage |
| `src/scenarios/file.ts` | Save downloads a JSON file; Open reads one back with strict validation (only known fields, clamped). Also opens the old multi-scenario `saved/scenarios.json` |
| `vercel.json` | Build settings and security headers; the CSP sets `connect-src 'none'` so the page cannot send data anywhere |

## Rules

- **Numbers live in data files, never as code literals.** A new year is a new
  `src/data/<year>/` folder; a rate change is a JSON edit.
- **Every number cites a source.** If a value is not published yet, use the latest
  published one and add it to that file's `provisional` list; the UI shows that list.
- **Tests are written with the feature, and their expected values are worked by hand**
  from the published schedule — never pasted from the engine's own output.
- **Before making changes:** say what you'll do and which files, and wait for approval.
- **Investigate before claiming.** Check a tax rule against a primary source (IRS, FTB,
  DTF, DOR) before stating it; mark what was inferred rather than confirmed.
- **Product code is user-agnostic.** No personal figures in code, tests, or docs.
- **Nothing leaves the browser.** No server calls, analytics, or third-party assets (the font is bundled). Keep `connect-src 'none'` in `vercel.json`; if a feature needs the network, that's a decision for the owner.
- **`saved/` holds real personal figures** (from the old local-server saving) and is gitignored. Never read it for test data or commit it.

## Changing a state

Edit `src/data/2026/states/<xx>.json` per `GENERIC_STATE_SPEC.md`, and update or add its
hand-worked cases in `src/engine/states/cases/<xx>.json`. If a rule can't be expressed in the
spec, either extend the spec and `generic.ts` together (with tests), or write a hand-written
module like `ca.ts`. Figures not yet published for 2026 go in `provisional`, which the UI
shows. Known approximations are in each file's `notes` and `provisional`.

## Not modelled yet

AMT (federal and CA), state interest adjustments (Treasury interest exempt, out-of-state
munis taxable), NY household credit, NYC household/school credits, ACA premium tax
credit, retirement withdrawals and Social Security benefits, short-term gains, carryovers,
local income taxes (except Maryland and Indiana county tax at a typical rate),
self-employed health insurance and retirement deductions, QBI for businesses with
employees or property, state payroll taxes other than CA SDI.

## Brackets and marginal rates

Two different things, and the UI keeps the words apart:
- **Bracket rate** — the rate on the schedule where income sits. Each jurisdiction returns
  `positions` (rate, next rate, headroom); shown as "Current tax bracket".
- **Marginal rate** — how much total tax changes for more income. `whatIf` diffs the
  return before and after; it is the only thing labelled "marginal rate".

Every breakdown line that should appear in a what-if carries a stable `key` and a `role`
(`tax` lines sum to the jurisdiction's tax; `base` lines are what it is figured on). A
test checks the changed `tax` rows add up to the change in tax — a new tax line without a
key breaks it. `factors` explain why the marginal rate differs from the bracket; add one
whenever a new rule creates such an effect, with a hand-worked test in `marginal.test.ts`.

## Commands

`npm install` · `npm run dev` (port 5180) · `npm test` · `npm run build` · `npm run preview` (port 5181)
