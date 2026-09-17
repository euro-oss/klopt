import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateXaf } from '../../src/xaf/generate.js'
import { parseXaf, readDeclaredTotals } from '../../src/xaf/parse.js'
import { validateXafDocument } from '../../src/xaf/validate.js'
import { referenceDocument } from './fixture.js'

/**
 * Golden files for XAF (spec 11.4).
 *
 * "Golden files for every regulated artefact. Each with a committed expected
 * output, validated against the official schema and schematron in CI. When a
 * taxonomy or BIS release lands, the diff is visible."
 *
 * Three separate assertions, because they fail for different reasons:
 *
 *   1. The output matches the committed golden file. Catches any unintended
 *      change to the generator.
 *   2. The output validates against the published XSD. Catches structural
 *      drift, and turns a schema release into a red build.
 *   3. The output round-trips through the parser unchanged. Catches an export
 *      that is valid but that we cannot read back — which would make the
 *      migration story a lie.
 *
 * Run with `UPDATE_GOLDEN=1` to rewrite the fixtures after a deliberate change.
 * The diff is the review.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, '__golden__')
const SCHEMA = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'reference-data',
  'xaf',
  'XmlAuditfileFinancieel3.2.xsd',
)

function goldenFile(name: string, actual: string): void {
  const path = join(GOLDEN_DIR, name)

  if (process.env['UPDATE_GOLDEN'] === '1' || !existsSync(path)) {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    writeFileSync(path, actual)
    if (process.env['UPDATE_GOLDEN'] !== '1') {
      throw new Error(
        `Golden file ${name} did not exist and has been created. Review and commit it.`,
      )
    }
    return
  }

  expect(actual).toBe(readFileSync(path, 'utf8'))
}

/** Validate with xmllint. Present on macOS and on ubuntu-latest. */
function validateAgainstSchema(xml: string, name: string): { ok: boolean; output: string } {
  const path = join(GOLDEN_DIR, `.${name}.tmp.xml`)
  mkdirSync(GOLDEN_DIR, { recursive: true })
  writeFileSync(path, xml)

  try {
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA, path], { stdio: 'pipe' })
    return { ok: true, output: '' }
  } catch (error: unknown) {
    const details = error as { stderr?: Buffer; stdout?: Buffer; message?: string }
    return {
      ok: false,
      output: details.stderr?.toString() ?? details.stdout?.toString() ?? details.message ?? '',
    }
  }
}

const hasXmllint = (() => {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

describe('XAF 3.2 golden file', () => {
  const document = referenceDocument()
  const xml = generateXaf(document)

  it('matches the committed golden file', () => {
    goldenFile('reference-bv-2026.xaf.xml', xml)
  })

  it.runIf(hasXmllint)('validates against the published XSD', () => {
    const result = validateAgainstSchema(xml, 'reference-bv-2026')
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  it('passes semantic validation', () => {
    const result = validateXafDocument(document)
    const errors = result.problems.filter((problem) => problem.severity === 'error')
    expect(errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('declares control totals that match its own contents', () => {
    const declared = readDeclaredTotals(xml)
    const computed = validateXafDocument(document)

    expect(declared.linesCount).toBe(computed.lineCount)
    expect(declared.totalDebit).toBe(computed.totalDebit)
    expect(declared.totalCredit).toBe(computed.totalCredit)
    expect(declared.totalDebit).toBe(declared.totalCredit)
  })

  it('round-trips: generate, parse, generate again, identical', () => {
    const reparsed = parseXaf(xml)
    expect(generateXaf(reparsed)).toBe(xml)
  })

  it('parses back to the same document', () => {
    expect(parseXaf(xml)).toEqual(document)
  })
})

describe('the schema check can actually fail', () => {
  it.runIf(hasXmllint)('rejects a document with elements out of order', () => {
    // XSD sequences are ordered. Swapping two elements is the single easiest
    // way to produce an invalid file, and the check has to catch it — otherwise
    // the whole exercise is theatre.
    const broken = generateXaf(referenceDocument()).replace(
      /(\s*)<startDate>([^<]*)<\/startDate>(\s*)<endDate>([^<]*)<\/endDate>/,
      '$1<endDate>$4</endDate>$3<startDate>$2</startDate>',
    )

    const result = validateAgainstSchema(broken, 'out-of-order')
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/endDate|startDate/)
  })
})
