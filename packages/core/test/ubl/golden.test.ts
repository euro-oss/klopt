import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateUbl, ublAmount, ublPercent } from '../../src/ubl/generate.js'
import { toUblDocument } from '../../src/ubl/from-invoice.js'
import { checkUblRules } from '../../src/ubl/rules.js'
import { referenceCreditNote, referenceInvoice, reverseChargeInvoice } from './fixture.js'

/**
 * Golden files for UBL (spec 11.4, 7.5).
 *
 * "Golden files for every regulated artefact. Each with a committed expected
 * output, validated against the official schema and schematron in CI. When a
 * taxonomy or BIS release lands, the diff is visible."
 *
 * The XSD half of that is here. The schematron half is not yet: running the
 * Peppol rules properly needs an XSLT 2.0 processor over the compiled
 * stylesheet, which is its own piece of work. Until it lands, `checkUblRules`
 * is a **pre-flight subset** carrying the official rule ids, and nothing in the
 * product sends an invoice — you can generate and download one, which is
 * exactly as far as it is safe to go without the authority.
 *
 * Run with `UPDATE_GOLDEN=1` to rewrite the fixtures after a deliberate change.
 * The diff is the review.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const GOLDEN_DIR = join(HERE, '__golden__')
const UBL_DIR = join(HERE, '..', '..', '..', '..', 'reference-data', 'ubl', '2.1', 'maindoc')
const SCHEMA = {
  invoice: join(UBL_DIR, 'UBL-Invoice-2.1.xsd'),
  credit_note: join(UBL_DIR, 'UBL-CreditNote-2.1.xsd'),
}

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

function validateAgainstSchema(
  xml: string,
  kind: 'invoice' | 'credit_note',
  name: string,
): { ok: boolean; output: string } {
  const path = join(GOLDEN_DIR, `.${name}.tmp.xml`)
  mkdirSync(GOLDEN_DIR, { recursive: true })
  writeFileSync(path, xml)

  try {
    execFileSync('xmllint', ['--noout', '--schema', SCHEMA[kind], path], { stdio: 'pipe' })
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

const cases = [
  { name: 'invoice', file: 'peppol-bis-3-invoice.xml', source: referenceInvoice() },
  { name: 'credit note', file: 'peppol-bis-3-credit-note.xml', source: referenceCreditNote() },
  {
    name: 'reverse charge',
    file: 'peppol-bis-3-reverse-charge.xml',
    source: reverseChargeInvoice(),
  },
] as const

describe.each(cases)('$name', ({ file, source }) => {
  const document = toUblDocument(source)
  const xml = generateUbl(document)

  it('matches the committed golden file', () => {
    goldenFile(file, xml)
  })

  it.runIf(hasXmllint)('validates against the published UBL 2.1 XSD', () => {
    const result = validateAgainstSchema(xml, source.kind, file.replace('.xml', ''))
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  it('breaks no rule we know how to check', () => {
    expect(checkUblRules(document)).toEqual([])
  })
})

describe('the document that comes out', () => {
  it('declares the Peppol customisation, which is what makes it a BIS invoice', () => {
    const xml = generateUbl(toUblDocument(referenceInvoice()))
    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>',
    )
  })

  it('declares the NLCIUS customisation when asked for the Dutch profile', () => {
    const xml = generateUbl(toUblDocument({ ...referenceInvoice(), profile: 'nlcius' }))
    expect(xml).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0</cbc:CustomizationID>',
    )
  })

  it('groups the VAT breakdown by category and rate', () => {
    const document = toUblDocument(referenceInvoice())
    expect(document.taxSubtotals).toEqual([
      {
        taxableAmount: 100_000n,
        taxAmount: 21_000n,
        categoryCode: 'S',
        rateBasisPoints: 2100,
        exemptionReason: null,
        exemptionReasonCode: null,
      },
      {
        taxableAmount: 50_000n,
        taxAmount: 4_500n,
        categoryCode: 'S',
        rateBasisPoints: 900,
        exemptionReason: null,
        exemptionReasonCode: null,
      },
    ])
  })

  it('gives a reverse-charge breakdown the reason that makes it legal', () => {
    const document = toUblDocument(reverseChargeInvoice())
    expect(document.taxSubtotals[0]).toMatchObject({
      categoryCode: 'AE',
      taxAmount: 0n,
      exemptionReasonCode: 'VATEX-EU-AE',
      exemptionReason: 'Reverse charge',
    })
  })

  it('leaves a credit note without a due date or a payment instruction', () => {
    const document = toUblDocument(referenceCreditNote())
    expect(document.dueDate).toBeNull()
    expect(document.paymentMeans).toBeNull()
  })
})

describe('amounts and percentages', () => {
  it('formats minor units without touching a float', () => {
    expect(ublAmount(0n)).toBe('0.00')
    expect(ublAmount(5n)).toBe('0.05')
    expect(ublAmount(175_500n)).toBe('1755.00')
    expect(ublAmount(-4_200n)).toBe('-42.00')
    // 21% of 12345678901234567 cents, which no float can hold.
    expect(ublAmount(12_345_678_901_234_567n)).toBe('123456789012345.67')
  })

  it('writes a rate the way every other system writes it', () => {
    expect(ublPercent(2100)).toBe('21')
    expect(ublPercent(900)).toBe('9')
    expect(ublPercent(0)).toBe('0')
    expect(ublPercent(875)).toBe('8.75')
    expect(ublPercent(1250)).toBe('12.5')
  })
})
