import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildVatReturn,
  generateVatInstance,
  loadTaxonomyMapping,
  loadTaxonomyMappingsFromDirectory,
  parseVatPeriodCode,
  presentFilingSummary,
  selectTaxonomyMapping,
  type TaxCodeRule,
  type TaxonomyMapping,
  type VatJournalLine,
} from '../../src/vat/index.js'

/**
 * The XBRL instance and the taxonomy that shapes it.
 *
 * Two things are worth testing here and they are both about being wrong in a
 * quiet way: selecting the taxonomy by period rather than by "latest", and
 * rounding to whole euros in an order that leaves the form adding up.
 */

const REFERENCE_DATA = join(import.meta.dirname, '..', '..', '..', '..', 'reference-data')

function mapping(overrides: Partial<TaxonomyMapping> = {}): TaxonomyMapping {
  return {
    version: 'NT-TEST',
    report: 'ob-aangifte',
    appliesFrom: '2026-01-01',
    appliesTo: '2026-12-31',
    schemaRef: 'https://example.test/ob.xsd',
    namespaces: { 'bd-i': 'https://example.test/dictionary' },
    entityScheme: 'http://www.belastingdienst.nl/omzetbelastingnummer',
    exponent: 0,
    verified: true,
    provenance: 'test',
    facts: [
      { rubriek: '1a', kind: 'base', element: 'bd-i:Base1a', label: 'Hoog tarief' },
      { rubriek: '1a', kind: 'vat', element: 'bd-i:Vat1a', label: 'Btw hoog' },
      { rubriek: '1b', kind: 'base', element: 'bd-i:Base1b', label: 'Laag tarief' },
      { rubriek: '1b', kind: 'vat', element: 'bd-i:Vat1b', label: 'Btw laag' },
      { rubriek: '3b', kind: 'base', element: 'bd-i:Base3b', label: 'Naar de EU' },
      { rubriek: '5a', kind: 'vat', element: 'bd-i:Owed', label: 'Verschuldigd' },
      { rubriek: '5b', kind: 'vat', element: 'bd-i:Input', label: 'Voorbelasting' },
      { rubriek: '5c', kind: 'vat', element: 'bd-i:Payable', label: 'Te betalen' },
    ],
    ...overrides,
  }
}

function rule(code: string, overrides: Partial<TaxCodeRule> = {}): TaxCodeRule {
  return {
    code,
    description: code,
    rateBasisPoints: 2100,
    validFrom: '2020-01-01',
    validTo: null,
    direction: 'output',
    baseRubriek: '1a',
    vatRubriek: '1a',
    reverseCharge: 'none',
    scope: 'domestic',
    deductibility: 'full',
    proRataBasisPoints: null,
    supplyKind: 'not_applicable',
    ublCategory: 'S',
    deductionCode: null,
    ...overrides,
  }
}

const RULES: readonly TaxCodeRule[] = [
  rule('H21'),
  rule('L9', { rateBasisPoints: 900, baseRubriek: '1b', vatRubriek: '1b' }),
  rule('VH21', { direction: 'input', baseRubriek: null, vatRubriek: '5b' }),
]

let sequence = 0

function line(
  accountNumber: string,
  signedMinorUnits: bigint,
  extra: Partial<VatJournalLine> = {},
): VatJournalLine {
  sequence += 1
  return {
    entryId: `entry-${String(sequence)}`,
    entryNumber: String(sequence),
    journalCode: 'VRK',
    bookingDate: '2026-02-15',
    lineNumber: 1,
    accountNumber,
    accountName: `Account ${accountNumber}`,
    description: 'test',
    taxCode: null,
    taxRole: null,
    signedMinorUnits,
    ...extra,
  }
}

function returnFrom(lines: readonly VatJournalLine[]) {
  return buildVatReturn({
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    lines,
    rules: RULES,
    controlAccountNumbers: ['1500', '1510'],
  })
}

const IDENTITY = {
  vatNumber: 'NL123456789B01',
  legalName: 'Test Beheer B.V.',
  softwareDesc: 'Klopt',
  softwareVersion: '0.0.0',
}

function instanceFor(lines: readonly VatJournalLine[], overrides: Partial<TaxonomyMapping> = {}) {
  return generateVatInstance({
    vatReturn: returnFrom(lines),
    period: parseVatPeriodCode('2026-Q1'),
    mapping: mapping(overrides),
    isSuppletie: false,
    ...IDENTITY,
  })
}

const SALE = [
  line('1300', 121_000n),
  line('8000', -100_000n, { taxCode: 'H21', taxRole: 'base' }),
  line('1500', -21_000n, { taxCode: 'H21', taxRole: 'tax' }),
]

describe('selectTaxonomyMapping', () => {
  const nt20 = mapping({ version: 'NT20', appliesFrom: '2026-01-01', appliesTo: '2026-12-31' })
  const nt21 = mapping({ version: 'NT21', appliesFrom: '2027-01-01', appliesTo: null })

  it('picks by reporting period, not by newest', () => {
    // The whole requirement in one assertion: a Q4 2026 aangifte filed in
    // January 2027 goes out against NT20, whatever is newest.
    expect(
      selectTaxonomyMapping([nt20, nt21], {
        report: 'ob-aangifte',
        periodFrom: '2026-10-01',
        periodTo: '2026-12-31',
      }).version,
    ).toBe('NT20')

    expect(
      selectTaxonomyMapping([nt20, nt21], {
        report: 'ob-aangifte',
        periodFrom: '2027-01-01',
        periodTo: '2027-03-31',
      }).version,
    ).toBe('NT21')
  })

  it('refuses a period nothing covers, naming what is loaded', () => {
    expect(() =>
      selectTaxonomyMapping([nt20], {
        report: 'ob-aangifte',
        periodFrom: '2024-01-01',
        periodTo: '2024-03-31',
      }),
    ).toThrow(/NT20/)
  })

  it('refuses a period a mapping only half covers', () => {
    // An annual 2026 filing against a mapping that stops in June is not a
    // partial match, it is a wrong one.
    const half = mapping({ version: 'NT-HALF', appliesFrom: '2026-01-01', appliesTo: '2026-06-30' })
    expect(() =>
      selectTaxonomyMapping([half], {
        report: 'ob-aangifte',
        periodFrom: '2026-01-01',
        periodTo: '2026-12-31',
      }),
    ).toThrow(/No ob-aangifte taxonomy mapping covers/)
  })

  it('refuses two mappings claiming one period rather than picking', () => {
    const overlapping = mapping({ version: 'NT20-BETA' })
    expect(() =>
      selectTaxonomyMapping([mapping({ version: 'NT20' }), overlapping], {
        report: 'ob-aangifte',
        periodFrom: '2026-01-01',
        periodTo: '2026-03-31',
      }),
    ).toThrow(/claim/)
  })

  it('ignores mappings for another report', () => {
    expect(() =>
      selectTaxonomyMapping([mapping({ report: 'icp-opgaaf' })], {
        report: 'ob-aangifte',
        periodFrom: '2026-01-01',
        periodTo: '2026-03-31',
      }),
    ).toThrow(/Loaded: \(none\)/)
  })
})

describe('loadTaxonomyMapping', () => {
  const good = {
    taxonomy: 'klopt.nt-mapping',
    version: 'NT20',
    report: 'ob-aangifte',
    appliesFrom: '2026-01-01',
    appliesTo: '2026-12-31',
    schemaRef: 'https://example.test/ob.xsd',
    namespaces: { 'bd-i': 'https://example.test/d' },
    entityScheme: 'https://example.test/scheme',
    facts: [{ rubriek: '1a', kind: 'base', element: 'bd-i:X', label: 'x' }],
  }

  it('accepts a well-formed mapping and defaults to whole euros', () => {
    const loaded = loadTaxonomyMapping(good)
    expect(loaded.version).toBe('NT20')
    expect(loaded.exponent).toBe(0)
    // Unverified unless it says so, which is the safe default.
    expect(loaded.verified).toBe(false)
  })

  it('refuses an element with no namespace prefix', () => {
    expect(() =>
      loadTaxonomyMapping({ ...good, facts: [{ ...good.facts[0], element: 'X' }] }),
    ).toThrow(/no namespace prefix/)
  })

  it('refuses an element whose prefix is not declared', () => {
    expect(() =>
      loadTaxonomyMapping({ ...good, facts: [{ ...good.facts[0], element: 'nope:X' }] }),
    ).toThrow(/undeclared prefix/)
  })

  it('refuses the same rubriek and kind twice', () => {
    expect(() => loadTaxonomyMapping({ ...good, facts: [good.facts[0], good.facts[0]] })).toThrow(
      /mapped twice/,
    )
  })

  it('refuses a validity window that ends before it starts', () => {
    expect(() => loadTaxonomyMapping({ ...good, appliesTo: '2025-01-01' })).toThrow(
      /before appliesFrom/,
    )
  })

  it('refuses a file that is not a mapping', () => {
    expect(() => loadTaxonomyMapping({ ...good, taxonomy: 'something-else' })).toThrow(
      /klopt.nt-mapping/,
    )
  })
})

describe('the shipped taxonomy mappings', () => {
  const loaded = loadTaxonomyMappingsFromDirectory(REFERENCE_DATA)

  it('load, and every one covers a period', () => {
    expect(loaded.length).toBeGreaterThan(0)
    for (const entry of loaded) {
      expect(entry.appliesFrom, entry.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('maps every rubriek the aangifte can carry a figure in', () => {
    // Not a completeness demand on the taxonomy — a demand that the shipped
    // mapping is not silently missing a box. A mapping without 1b drops the
    // low-rate turnover and the instance stays well-formed.
    for (const entry of loaded.filter((one) => one.report === 'ob-aangifte')) {
      const mapped = new Set(entry.facts.map((fact) => `${fact.rubriek}.${fact.kind}`))
      for (const key of [
        '1a.base',
        '1a.vat',
        '1b.base',
        '1b.vat',
        '1c.base',
        '1c.vat',
        '1d.base',
        '1d.vat',
        '1e.base',
        '2a.base',
        '2a.vat',
        '3a.base',
        '3b.base',
        '3c.base',
        '4a.base',
        '4a.vat',
        '4b.base',
        '4b.vat',
        '5a.vat',
        '5b.vat',
        '5c.vat',
      ]) {
        expect(mapped, `${entry.version} is missing ${key}`).toContain(key)
      }
    }
  })

  it('says out loud that its element names are unverified', () => {
    // The element names in this repository have not been checked against the
    // published Nederlandse Taxonomie. That is a fact about the data, and the
    // flag is what stops it being sent to the Belastingdienst by accident.
    for (const entry of loaded) {
      if (entry.verified) continue
      expect(entry.provenance.length, entry.version).toBeGreaterThan(40)
    }
  })

  it('is valid JSON with the loader’s own rules, file by file', () => {
    const path = join(REFERENCE_DATA, 'nt')
    for (const name of readdirSync(path).filter((file) => file.endsWith('.json'))) {
      expect(() =>
        loadTaxonomyMapping(JSON.parse(readFileSync(join(path, name), 'utf8'))),
      ).not.toThrow()
    }
  })
})

describe('generateVatInstance', () => {
  it('writes the context, the unit and a fact per mapped box', () => {
    const instance = instanceFor(SALE)

    expect(instance.xml).toContain('<xbrli:xbrl')
    expect(instance.xml).toContain('<link:schemaRef xlink:type="simple"')
    expect(instance.xml).toContain(
      '<xbrli:identifier scheme="http://www.belastingdienst.nl/omzetbelastingnummer">123456789B01</xbrli:identifier>',
    )
    expect(instance.xml).toContain('<xbrli:startDate>2026-01-01</xbrli:startDate>')
    expect(instance.xml).toContain('<xbrli:endDate>2026-03-31</xbrli:endDate>')
    expect(instance.xml).toContain('<xbrli:measure>iso4217:EUR</xbrli:measure>')
  })

  it('strips the NL prefix, because the scheme is already national', () => {
    const instance = instanceFor(SALE)
    expect(instance.xml).not.toContain('NL123456789B01')
    expect(instance.xml).toContain('>123456789B01<')
  })

  it('declares whole euros', () => {
    const instance = instanceFor(SALE)
    expect(instance.xml).toContain(
      '<bd-i:Base1a contextRef="aangifte" unitRef="EUR" decimals="0">1000</bd-i:Base1a>',
    )
    expect(instance.xml).toContain('>210</bd-i:Vat1a>')
    // No cents anywhere in an amount.
    expect(instance.xml).not.toMatch(/>\d+\.\d\d</)
  })

  it('rounds each box, then derives the totals from the rounded boxes', () => {
    // 1a of 100,49 and 1b of 100,49: each rounds to 100, so 5a is 200 — not
    // the 201 that rounding the 200,98 sum would give. An aangifte whose own
    // boxes do not add up to its own total gets rejected.
    const instance = instanceFor([
      line('1300', 24_218n),
      line('8000', -10_049n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -10_049n, { taxCode: 'H21', taxRole: 'tax' }),
      line('8010', -2_060n, { taxCode: 'L9', taxRole: 'base' }),
      line('1500', -2_060n, { taxCode: 'L9', taxRole: 'tax' }),
    ])

    const vat1a = instance.facts.find((fact) => fact.rubriek === '1a' && fact.kind === 'vat')
    const vat1b = instance.facts.find((fact) => fact.rubriek === '1b' && fact.kind === 'vat')
    expect(vat1a?.euros).toBe(100n)
    expect(vat1b?.euros).toBe(21n)
    expect(instance.owedEuros).toBe(121n)
    expect(instance.payableEuros).toBe(121n)
  })

  it('rounds half away from zero, on integers', () => {
    const halfUp = instanceFor([
      line('1300', 605n),
      line('8000', -500n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -105n, { taxCode: 'H21', taxRole: 'tax' }),
    ])
    // 1,05 rounds to 1; 5,00 stays 5.
    expect(halfUp.facts.find((fact) => fact.kind === 'vat')?.euros).toBe(1n)

    const halfway = instanceFor([
      line('1300', 1_050n),
      line('8000', -900n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -150n, { taxCode: 'H21', taxRole: 'tax' }),
    ])
    // 1,50 rounds away from zero, to 2.
    expect(halfway.facts.find((fact) => fact.kind === 'vat')?.euros).toBe(2n)
  })

  it('reports the rounding difference against the ledger rather than hiding it', () => {
    // 102,33 at 21% is 21,49. The box declares 21, so the instance differs
    // from the ledger by 49 cents — which is rounding, not an error.
    const instance = instanceFor([
      line('1300', 12_382n),
      line('8000', -10_233n, { taxCode: 'H21', taxRole: 'base' }),
      line('1500', -2_149n, { taxCode: 'H21', taxRole: 'tax' }),
    ])

    expect(instance.roundingDifferenceMinorUnits).toBe(-49n)
    expect(
      instance.warnings.some(
        (warning) => warning.includes('hele euro') || warning.includes('whole euro'),
      ),
    ).toBe(true)
  })

  it('says so when the mapping is unverified', () => {
    const instance = instanceFor(SALE, { verified: false, provenance: 'hand-authored' })
    expect(instance.warnings[0]).toContain('unverified')
    // The figures are still generated: an operator filing by hand wants them.
    expect(instance.facts.length).toBeGreaterThan(0)
  })

  it('refuses a box with a figure and no element to put it in', () => {
    // The silent-wrongness case: a mapping with no 1b drops the low-rate
    // turnover and the instance stays well-formed.
    expect(() =>
      instanceFor(
        [
          line('1300', 1_090n),
          line('8010', -1_000n, { taxCode: 'L9', taxRole: 'base' }),
          line('1500', -90n, { taxCode: 'L9', taxRole: 'tax' }),
        ],
        { facts: mapping().facts.filter((fact) => fact.rubriek !== '1b') },
      ),
    ).toThrow(/1b/)
  })

  it('does not mind an unmapped box that has no figure in it', () => {
    expect(() =>
      instanceFor(SALE, { facts: mapping().facts.filter((fact) => fact.rubriek !== '1b') }),
    ).not.toThrow()
  })

  it('refuses an entity with no usable omzetbelastingnummer', () => {
    expect(() =>
      generateVatInstance({
        vatReturn: returnFrom(SALE),
        period: parseVatPeriodCode('2026-Q1'),
        mapping: mapping(),
        isSuppletie: false,
        ...IDENTITY,
        vatNumber: '',
      }),
    ).toThrow(/omzetbelastingnummer/)
  })

  it('marks a suppletie in its context, so two instances are distinguishable', () => {
    const aangifte = instanceFor(SALE)
    const suppletie = generateVatInstance({
      vatReturn: returnFrom(SALE),
      period: parseVatPeriodCode('2026-Q1'),
      mapping: mapping(),
      isSuppletie: true,
      ...IDENTITY,
    })

    expect(aangifte.xml).toContain('<xbrli:context id="aangifte">')
    expect(suppletie.xml).toContain('<xbrli:context id="suppletie">')
  })

  it('leaves an empty quarter as zeroes rather than as nothing', () => {
    // A nil return is a return. Omitting the facts would be a different filing.
    const instance = instanceFor([line('1100', 5_000n), line('0500', -5_000n)])
    expect(instance.payableEuros).toBe(0n)
    expect(instance.xml).toContain('>0</bd-i:Owed>')
  })
})

describe('presentFilingSummary', () => {
  const instance = instanceFor(SALE)
  const summary = presentFilingSummary(instance, {
    period: parseVatPeriodCode('2026-Q1'),
    legalName: 'Test Beheer B.V.',
    vatNumber: 'NL123456789B01',
    isSuppletie: false,
    generatedOn: '2026-04-02',
  })

  it('lines the figures up, whatever the label’s length', () => {
    // A column of figures that does not line up is what somebody retyping into
    // a form misreads. 2a has the longest label on the form.
    const rows = summary.split('\n').filter((entry) => /^ {2}\d[a-e] /.test(entry))
    expect(rows.length).toBeGreaterThan(5)
    const widths = new Set(rows.map((entry) => entry.length))
    expect(widths.size).toBe(1)
  })

  it('leaves a box the form does not have blank rather than zero', () => {
    // 3b carries a base and no VAT. A `0` in the VAT column invites somebody to
    // go looking for a field that is not there.
    const row = summary.split('\n').find((entry) => entry.trimStart().startsWith('3b'))
    expect(row).toBeDefined()
    expect(row?.trimEnd()).toMatch(/0$/)
    const owed = summary.split('\n').find((entry) => entry.trimStart().startsWith('5a'))
    // 5a is VAT only, so its base column is blank.
    expect(owed).toMatch(/ {12}\s+210$/)
  })

  it('is something an operator can read and retype', () => {
    expect(summary).toContain('AANGIFTE OMZETBELASTING')
    expect(summary).toContain('Test Beheer B.V.')
    expect(summary).toContain('1e kwartaal 2026')
    expect(summary).toContain('hele euro')
    expect(summary).toContain('Te betalen: 210 euro')
  })

  it('lists the boxes under their printed headings, in form order', () => {
    const lines = summary.split('\n')
    const first = lines.findIndex((entry) => entry.includes('Prestaties binnenland'))
    const total = lines.findIndex((entry) => entry.includes('Berekening totaal'))
    expect(first).toBeGreaterThan(0)
    expect(total).toBeGreaterThan(first)
  })

  it('says refund rather than payable when the quarter runs the other way', () => {
    const refund = instanceFor([
      line('4400', 50_000n, { taxCode: 'VH21', taxRole: 'base' }),
      line('1510', 10_500n, { taxCode: 'VH21', taxRole: 'tax' }),
      line('1600', -60_500n),
    ])
    const text = presentFilingSummary(refund, {
      period: parseVatPeriodCode('2026-Q1'),
      legalName: 'Test Beheer B.V.',
      vatNumber: 'NL123456789B01',
      isSuppletie: false,
      generatedOn: '2026-04-02',
    })
    expect(text).toContain('Terug te vragen: 105 euro')
  })

  it('puts the warnings where somebody will see them', () => {
    const unverified = instanceFor(SALE, { verified: false, provenance: 'hand-authored' })
    const text = presentFilingSummary(unverified, {
      period: parseVatPeriodCode('2026-Q1'),
      legalName: 'Test Beheer B.V.',
      vatNumber: 'NL123456789B01',
      isSuppletie: true,
      generatedOn: '2026-04-02',
    })
    expect(text).toContain('SUPPLETIE OMZETBELASTING')
    expect(text).toContain('LET OP')
    // Dutch, because the document is: this gets printed and read aloud.
    expect(text).toContain('nog niet gecontroleerd tegen de gepubliceerde')
    expect(text).not.toContain('unverified')
  })
})
