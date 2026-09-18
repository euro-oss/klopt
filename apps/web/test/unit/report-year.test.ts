import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * No screen decides the book year from the calendar.
 *
 * The dashboard and the three statements each carried
 * `const YEAR = String(new Date().getFullYear())`. For an administration whose
 * boekjaar runs July to June — which `/setup` offers in as many words — that
 * is the wrong year for half of every year, chosen silently, with no control
 * on screen to say so or to correct it.
 *
 * This asserts the wiring rather than the behaviour, and that is a deliberate
 * limit: what the year resolves to is tested in `fiscal-year.test.ts`, where
 * it can be tested by naming dates. What a source scan can catch is the thing
 * that actually happened — somebody adds the fourth report screen and reaches
 * for `new Date()` because that is what the file next to it used to do.
 *
 * BTW is not in this list on purpose. A Dutch VAT period is tied to the
 * calendar year by law, not to the boekjaar, so `vat.index` is right to ask
 * the calendar.
 */

const routes = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'routes', '_app')

/**
 * The code, without what it says about itself.
 *
 * Every one of these files explains in a comment what it used to do, and a
 * scan that cannot tell an explanation from a call would forbid writing the
 * history down.
 */
const read = (file: string): string =>
  readFileSync(join(routes, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const YEAR_SCOPED = [
  'index.tsx',
  'reports.trial-balance.tsx',
  'reports.balance-sheet.tsx',
  'reports.profit-and-loss.tsx',
  'reports.debtor-ageing.tsx',
  'reports.creditor-ageing.tsx',
]

describe('the screens that are about a book year', () => {
  for (const file of YEAR_SCOPED) {
    it(`${file} does not ask the calendar what year the books are in`, () => {
      expect(read(file)).not.toContain('getFullYear')
    })

    it(`${file} does not date itself from the browser either`, () => {
      // `new Date()` for "today" is the same guess wearing a different hat:
      // an ageing report as of today, in a year that closed in June, buckets
      // every invoice in it as a year late.
      expect(read(file)).not.toContain('new Date()')
    })
  }
})

describe('the shell', () => {
  const shell = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'components', 'app-shell.tsx'),
    'utf8',
  )

  it('carries the year control, so there is one and not one per report', () => {
    expect(shell).toContain('shell.fiscalYear')
  })

  it('shows the dates of the chosen year, not only its label', () => {
    // A boekjaar labelled 2025 may run from July 2025 to June 2026. A picker
    // that shows only the label is the old guess with a dropdown on it.
    expect(shell).toContain('activeYear.startsOn')
    expect(shell).toContain('activeYear.endsOn')
  })

  it('offers ageing in the navigation rather than under reports', () => {
    expect(shell).toContain('/reports/debtor-ageing')
    expect(shell).toContain('/reports/creditor-ageing')
    expect(shell).toContain('nav.group.ageing')
  })
})
