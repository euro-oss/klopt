import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  absoluteContext,
  loadSchematronFromDirectory,
  parseSchematron,
  validateAgainst,
} from '../../src/schematron/index.js'
import { SchematronError, type SchematronSchema } from '../../src/schematron/model.js'

/**
 * The Schematron evaluator, against the **real** Peppol artefacts (ADR 0017).
 *
 * A validator that never fails is worthless and looks exactly like one that
 * works, so the load-bearing tests here are the ones that break a document on
 * purpose and check that the official rule identifier comes back. `BR-CL-14`
 * in particular is a code-list rule nothing hand-written would have caught —
 * it is the evidence that running the artefact buys something.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const ARTEFACTS = join(HERE, '..', '..', '..', '..', 'reference-data', 'peppol', 'bis-3')
const GOLDEN = join(HERE, '..', '..', '..', 'core', 'test', 'ubl', '__golden__')

let schemas: readonly SchematronSchema[]
let invoice: string
let creditNote: string

const rulesFor = (xml: string): string[] => [
  ...new Set(validateAgainst(schemas, xml).failures.map((failure) => failure.rule)),
]

beforeAll(() => {
  schemas = loadSchematronFromDirectory(ARTEFACTS)
  invoice = readFileSync(join(GOLDEN, 'peppol-bis-3-invoice.xml'), 'utf8')
  creditNote = readFileSync(join(GOLDEN, 'peppol-bis-3-credit-note.xml'), 'utf8')
}, 60_000)

describe('loading the artefacts', () => {
  it('reads both, with their rules and functions', () => {
    expect(schemas.map((schema) => schema.artefact)).toEqual([
      'CEN-EN16931-UBL.sch',
      'PEPPOL-EN16931-UBL.sch',
    ])

    const rules = schemas.reduce(
      (count, schema) =>
        count + schema.patterns.reduce((inner, pattern) => inner + pattern.rules.length, 0),
      0,
    )
    // The number will move with a BIS release. That it is in the hundreds is
    // the assertion: a parser that silently read nothing would pass everything.
    expect(rules).toBeGreaterThan(150)
  })

  it('translates every xsl:function, including the awkward ones', () => {
    const peppol = schemas[1]!
    const names = peppol.functions.map((declaration) => declaration.localName)

    expect(names).toContain('slack')
    // The one with an xsl:choose in it, which a naive translator chokes on.
    expect(names).toContain('checkSEOrgnr')
    expect(peppol.functions.every((declaration) => declaration.body.length > 0)).toBe(true)
  })

  it('refuses a file that is not Schematron', () => {
    expect(() => parseSchematron('<hello/>', 'x.sch')).toThrow(SchematronError)
  })
})

describe('turning a match pattern into a selection', () => {
  it('anchors a relative context, because a rule context is not a path', () => {
    expect(absoluteContext('cac:TaxSubtotal')).toBe('//cac:TaxSubtotal')
    expect(absoluteContext("cbc:ID[. = 'x']")).toBe("//cbc:ID[. = 'x']")
  })

  it('leaves an absolute one alone', () => {
    expect(absoluteContext('/*/cac:TaxTotal')).toBe('/*/cac:TaxTotal')
    expect(absoluteContext('(/a | /b)[$x]')).toBe('(/a | /b)[$x]')
  })

  it('expands a union term by term', () => {
    expect(absoluteContext('cac:A | cac:B')).toBe('//cac:A | //cac:B')
  })

  it('does not cut inside a predicate or a literal', () => {
    expect(absoluteContext("cbc:X[matches(., 'a|b')]")).toBe("//cbc:X[matches(., 'a|b')]")
    expect(absoluteContext('cbc:X[a[b | c]]')).toBe('//cbc:X[a[b | c]]')
  })
})

describe('the golden files pass the published rules', () => {
  it('accepts the reference invoice', () => {
    const result = validateAgainst(schemas, invoice)
    expect(result.failures).toEqual([])
    expect(result.valid).toBe(true)
    // Proof it did something: a validator that evaluated nothing also passes.
    expect(result.assertionsEvaluated).toBeGreaterThan(500)
  })

  it('accepts the reference credit note', () => {
    expect(validateAgainst(schemas, creditNote).failures).toEqual([])
  })

  it('accepts the reverse-charge invoice', () => {
    const xml = readFileSync(join(GOLDEN, 'peppol-bis-3-reverse-charge.xml'), 'utf8')
    expect(validateAgainst(schemas, xml).failures).toEqual([])
  })
})

describe('and it fails what it should', () => {
  it('catches a standard-rated invoice with no seller VAT number (BR-S-02)', () => {
    const broken = invoice.replace(/<cac:PartyTaxScheme>[\s\S]*?<\/cac:PartyTaxScheme>/, '')
    expect(rulesFor(broken)).toContain('BR-S-02')
  })

  it('catches a total that does not add up (BR-CO-15)', () => {
    const broken = invoice.replace(
      '<cbc:TaxInclusiveAmount currencyID="EUR">1755.00<',
      '<cbc:TaxInclusiveAmount currencyID="EUR">1700.00<',
    )
    expect(rulesFor(broken)).toContain('BR-CO-15')
  })

  it('catches a missing buyer reference and order reference (PEPPOL-EN16931-R003)', () => {
    const broken = invoice
      .replace(/<cbc:BuyerReference>[^<]*<\/cbc:BuyerReference>\n/, '')
      .replace(/<cac:OrderReference>[\s\S]*?<\/cac:OrderReference>\n/, '')
    expect(rulesFor(broken)).toContain('PEPPOL-EN16931-R003')
  })

  it('catches an empty element (PEPPOL-EN16931-R008)', () => {
    const broken = invoice.replace(
      '<cbc:BuyerReference>KOSTENPLAATS-42</cbc:BuyerReference>',
      '<cbc:BuyerReference></cbc:BuyerReference>',
    )
    expect(rulesFor(broken)).toContain('PEPPOL-EN16931-R008')
  })

  it('catches a credit note that names no invoice (NL-R-001)', () => {
    const broken = creditNote.replace(
      /<cac:BillingReference>[\s\S]*?<\/cac:BillingReference>\n/,
      '',
    )
    expect(rulesFor(broken)).toContain('NL-R-001')
  })

  it('catches a country code that is not in the code list (BR-CL-14)', () => {
    // Nothing hand-written would have caught this: it needs the ISO 3166 list
    // the artefact carries. This is what running the real rules is for.
    const broken = invoice.replace(
      '<cbc:IdentificationCode>NL</cbc:IdentificationCode>',
      '<cbc:IdentificationCode>ZZ</cbc:IdentificationCode>',
    )
    expect(rulesFor(broken)).toContain('BR-CL-14')
  })

  it('reports where, not only what', () => {
    const broken = invoice.replace(/<cac:PartyTaxScheme>[\s\S]*?<\/cac:PartyTaxScheme>/, '')
    const failure = validateAgainst(schemas, broken).failures.find(
      (item) => item.rule === 'BR-S-02',
    )

    expect(failure?.location).toMatch(/^\/Invoice/)
    expect(failure?.artefact).toBe('CEN-EN16931-UBL.sch')
    expect(failure?.message).toContain('Standard rated')
    expect(failure?.severity).toBe('fatal')
  })

  it('refuses XML that is not well-formed rather than passing it', () => {
    expect(() => validateAgainst(schemas, '<Invoice>')).toThrow(SchematronError)
  })
})

describe('rule ordering inside a pattern', () => {
  it('lets only the first matching rule claim a node', () => {
    // Two rules whose contexts both match the root. Schematron says the first
    // claims it and the second never runs; getting this wrong produces a flood
    // of failures from a general rule that was meant to be a fallback.
    const schema = parseSchematron(
      `<schema xmlns="http://purl.oclc.org/dsdl/schematron">
         <pattern>
           <rule context="root"><assert id="first" test="false()">first</assert></rule>
           <rule context="*"><assert id="second" test="false()">second</assert></rule>
         </pattern>
       </schema>`,
      'ordering.sch',
    )

    const result = validateAgainst([schema], '<root><child/></root>')
    expect(result.failures.map((failure) => failure.rule)).toEqual(['first', 'second'])
    // `first` claimed <root>; `second` only got <child>.
    expect(result.failures.map((failure) => failure.location)).toEqual(['/root', '/root/child'])
  })

  it('starts again in the next pattern', () => {
    const schema = parseSchematron(
      `<schema xmlns="http://purl.oclc.org/dsdl/schematron">
         <pattern><rule context="root"><assert id="a" test="false()">a</assert></rule></pattern>
         <pattern><rule context="root"><assert id="b" test="false()">b</assert></rule></pattern>
       </schema>`,
      'patterns.sch',
    )

    expect(validateAgainst([schema], '<root/>').failures.map((f) => f.rule)).toEqual(['a', 'b'])
  })
})

describe('warnings', () => {
  it('are reported without making the document invalid', () => {
    const schema = parseSchematron(
      `<schema xmlns="http://purl.oclc.org/dsdl/schematron">
         <pattern>
           <rule context="root">
             <assert id="w" test="false()" flag="warning">a warning</assert>
           </rule>
         </pattern>
       </schema>`,
      'warn.sch',
    )

    const result = validateAgainst([schema], '<root/>')
    expect(result.valid).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.warnings.map((warning) => warning.rule)).toEqual(['w'])
  })
})
