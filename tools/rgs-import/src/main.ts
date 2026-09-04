import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { openWorkbook } from './xlsx.js'

/**
 * Converts the official RGS workbook into Klopt reference data.
 *
 * A maintainer task, run when the RGS Beheergroep publishes a version, not a
 * runtime dependency (principle 6: compliance artefacts are versioned data
 * loaded at runtime, never code — and a new RGS version is a data release, not
 * a deploy).
 *
 *   1. Download "Definitief RGS <version>.xlsx" from referentiegrootboekschema.nl
 *   2. pnpm --filter @klopt/rgs-import run generate -- <path> <version>
 *   3. Commit the generated JSON, review the diff, note it in the compliance
 *      calendar.
 *
 * The generated file is the thing under version control. Diffing two of them is
 * how an RGS upgrade gets reviewed, which is why the output is sorted and
 * pretty-printed rather than minified.
 */

/** Columns that mean the same thing on every sheet, by header label. */
const FIELD_HEADERS: Record<string, string> = {
  Referentiecode: 'code',
  ReferentieOmslagcode: 'omslagCode',
  Sortering: 'sortKey',
  Referentienummer: 'referenceNumber',
  'Omschrijving (verkort)': 'shortDescription',
  Omschrijving: 'description',
  'D/C': 'debitCredit',
  Nivo: 'level',
  Inactief: 'inactive',
}

export interface RgsCodeRecord {
  readonly code: string
  readonly omslagCode: string | null
  readonly sortKey: string
  readonly referenceNumber: string
  readonly shortDescription: string
  readonly description: string
  readonly debitCredit: 'D' | 'C' | null
  readonly level: number
  readonly inactive: boolean
  /**
   * The workbook's remaining filter columns, verbatim. Which legal form or
   * bookkeeping profile a code applies to (Basis, Uitgebr, EZ/VOF, ZZP, BV, …).
   * Kept as data rather than interpreted, because the set changes between
   * versions and interpreting it here would make an upgrade a code change.
   */
  readonly flags: Readonly<Record<string, boolean>>
}

export interface RgsSchemeFile {
  readonly scheme: 'rgs'
  readonly version: string
  readonly variant: string
  readonly source: string
  readonly generatedFrom: string
  readonly codeCount: number
  /**
   * Corrections applied to the published workbook, recorded rather than
   * applied silently. If a future release fixes one upstream, this list gets
   * shorter and the diff shows it.
   */
  readonly normalisations: readonly string[]
  readonly codes: readonly RgsCodeRecord[]
}

export function convertSheet(
  rows: readonly Record<string, string>[],
  options: { version: string; variant: string; source: string; generatedFrom: string },
): RgsSchemeFile {
  // Row 0 is a banner, row 1 is the header. Both are workbook conventions, so
  // find the header rather than assuming its index.
  const headerIndex = rows.findIndex((row) => Object.values(row).includes('Referentiecode'))
  if (headerIndex === -1) {
    throw new Error('No header row: this does not look like an RGS sheet.')
  }

  const header = rows[headerIndex]!
  const columnField = new Map<string, string>()
  const columnFlag = new Map<string, string>()

  for (const [column, label] of Object.entries(header)) {
    const field = FIELD_HEADERS[label]
    if (field !== undefined) columnField.set(column, field)
    else columnFlag.set(column, label)
  }

  for (const required of ['code', 'referenceNumber', 'description', 'level']) {
    if (![...columnField.values()].includes(required)) {
      throw new Error(`The sheet has no column for ${required}. Header changed?`)
    }
  }

  const codes: RgsCodeRecord[] = []
  const seen = new Set<string>()
  const normalisations: string[] = []
  // Trailing blank and totals rows are normal. A code-less row *between* two
  // codes means the layout moved and real codes are being dropped.
  let pendingCodeless = 0
  let interiorCodeless = 0

  for (const row of rows.slice(headerIndex + 1)) {
    const raw: Record<string, string> = {}
    for (const [column, field] of columnField) {
      // Trimmed: the workbook has whitespace-only cells where a human once
      // pressed space, and those mean "blank".
      const value = row[column]?.trim()
      if (value !== undefined && value !== '') raw[field] = value
    }

    const code = raw['code']
    if (code === undefined) {
      pendingCodeless += 1
      continue
    }
    interiorCodeless += pendingCodeless
    pendingCodeless = 0

    if (seen.has(code)) throw new Error(`Duplicate reference code ${code}.`)
    seen.add(code)

    const flags: Record<string, boolean> = {}
    for (const [column, label] of columnFlag) {
      // The workbook marks applicability with a "1" and leaves it blank
      // otherwise. Anything else is unexpected and worth failing on.
      const value = row[column]?.trim()
      if (value === undefined || value === '') continue
      if (value !== '1') throw new Error(`Unexpected filter value ${value} for ${code}/${label}.`)
      flags[label] = true
    }

    let debitCredit = raw['debitCredit']
    if (debitCredit !== undefined && debitCredit !== debitCredit.toUpperCase()) {
      normalisations.push(`${code}: D/C "${debitCredit}" uppercased`)
      debitCredit = debitCredit.toUpperCase()
    }
    if (debitCredit !== undefined && debitCredit !== 'D' && debitCredit !== 'C') {
      throw new Error(`Unexpected D/C value ${debitCredit} for ${code}.`)
    }

    const level = Number(raw['level'])
    if (!Number.isInteger(level) || level < 1 || level > 5) {
      throw new Error(`Unexpected level ${raw['level'] ?? '(blank)'} for ${code}.`)
    }

    codes.push({
      code,
      omslagCode: raw['omslagCode'] ?? null,
      sortKey: raw['sortKey'] ?? '',
      referenceNumber: raw['referenceNumber'] ?? '',
      shortDescription: raw['shortDescription'] ?? raw['description'] ?? '',
      description: raw['description'] ?? '',
      debitCredit: debitCredit === 'D' || debitCredit === 'C' ? debitCredit : null,
      level,
      inactive: raw['inactive'] !== undefined,
      flags,
    })
  }

  codes.sort((a, b) => a.code.localeCompare(b.code))

  if (interiorCodeless > 0) {
    throw new Error(
      `${String(interiorCodeless)} row(s) without a reference code appear between codes. ` +
        'The sheet layout has changed and codes would be dropped.',
    )
  }

  return {
    scheme: 'rgs',
    version: options.version,
    variant: options.variant,
    source: options.source,
    generatedFrom: options.generatedFrom,
    codeCount: codes.length,
    normalisations,
    codes,
  }
}

function main(): void {
  const [workbookPath, version, variant = 'mkb', sheetName] = process.argv.slice(2)

  if (workbookPath === undefined || version === undefined) {
    console.error(
      'usage: rgs-import <workbook.xlsx> <version> [variant=mkb] [sheetName]\n' +
        '  e.g. rgs-import "Definitief RGS 3.7.xlsx" 3.7 mkb',
    )
    process.exit(2)
  }

  const workbook = openWorkbook(readFileSync(resolve(workbookPath)))
  const sheet =
    sheetName ??
    workbook.sheetNames.find((name) =>
      variant === 'full'
        ? name.toLowerCase().startsWith('totaal')
        : name.toLowerCase().startsWith(variant.toLowerCase()),
    )

  if (sheet === undefined) {
    console.error(`No sheet for variant ${variant}. Sheets: ${workbook.sheetNames.join(', ')}`)
    process.exit(2)
  }

  const file = convertSheet(workbook.readSheet(sheet), {
    version,
    variant,
    source: 'https://www.referentiegrootboekschema.nl',
    generatedFrom: `${workbookPath.split('/').pop() ?? workbookPath} sheet "${sheet}"`,
  })

  const output = resolve(`reference-data/rgs/rgs-${version}-${variant}.json`)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, `${JSON.stringify(file, null, 1)}\n`)

  console.info(`[rgs-import] ${String(file.codeCount)} codes -> ${output}`)
  for (const note of file.normalisations) console.info(`[rgs-import]   normalised ${note}`)
}

main()
