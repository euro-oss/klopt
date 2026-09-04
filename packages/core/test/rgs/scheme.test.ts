import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { RgsSchemeError, loadRgsScheme, type RgsScheme } from '../../src/rgs/scheme.js'
import { buildCoverageReport, effectiveCode, validateMapping } from '../../src/rgs/mapping.js'
import { assessUpgradeImpact, diffRgsSchemes } from '../../src/rgs/diff.js'
import {
  createReferenceDataStore,
  loadReferenceDataFromDirectory,
} from '../../src/reference/store.js'

/**
 * These run against the **real** RGS 3.7 MKB scheme, not a fixture.
 *
 * A hand-written five-code fixture would prove the code compiles. Loading 3691
 * real codes proves it survives the data it will actually meet: inactive codes,
 * omslagcodes, a five-level hierarchy, and the one lowercase `c` the published
 * workbook contains.
 */

const REFERENCE_DATA = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'reference-data',
)

let rgs: RgsScheme

beforeAll(() => {
  rgs = loadReferenceDataFromDirectory(REFERENCE_DATA).rgs('3.7')
})

describe('loading the published RGS 3.7 scheme', () => {
  it('loads every code', () => {
    expect(rgs.version).toBe('3.7')
    expect(rgs.variant).toBe('mkb')
    expect(rgs.codes.length).toBe(3691)
  })

  it('indexes by code and by reference number', () => {
    const debtors = rgs.get('BVorDeb')
    expect(debtors?.description).toBe('Vorderingen op handelsdebiteuren')
    expect(debtors?.referenceNumber).toBe('1101000')
    expect(debtors?.debitCredit).toBe('D')
    expect(rgs.byReferenceNumber('1101000')?.code).toBe('BVorDeb')
  })

  it('derives the hierarchy from the code prefix', () => {
    expect(rgs.parentOf('BVorDeb')?.code).toBe('BVor')
    expect(rgs.ancestorsOf('BVorDeb').map((code) => code.code)).toEqual(['B', 'BVor'])
    expect(rgs.childrenOf('BVorDeb').length).toBeGreaterThan(0)
    // Level 1 is the root of its tree.
    expect(rgs.parentOf('B')).toBeUndefined()
  })

  it('carries the levels the workbook declares', () => {
    const levels = new Map<number, number>()
    for (const code of rgs.codes) levels.set(code.level, (levels.get(code.level) ?? 0) + 1)
    expect(levels.get(1)).toBe(2)
    expect(levels.get(5)).toBe(2293)
  })

  it('keeps omslagcodes, and they resolve', () => {
    const withOmslag = rgs.codes.filter((code) => code.omslagCode !== null)
    expect(withOmslag.length).toBeGreaterThan(200)
    for (const code of withOmslag) {
      expect(rgs.get(code.omslagCode!), `${code.code} -> ${code.omslagCode!}`).toBeDefined()
    }
  })

  it('carries the applicability filters as data, not interpretation', () => {
    expect(rgs.get('BVorDeb')?.flags['Basis']).toBe(true)
    expect(rgs.get('BVorDeb')?.flags['ZZP']).toBe(true)
  })

  it('every ancestor chain terminates at a level-1 code', () => {
    for (const code of rgs.codes) {
      const ancestors = rgs.ancestorsOf(code.code)
      if (code.level === 1) {
        expect(ancestors).toEqual([])
        continue
      }
      expect(ancestors[0]?.level, code.code).toBe(1)
    }
  })
})

describe('rejecting a malformed scheme', () => {
  it('refuses a file that is not an RGS scheme', () => {
    expect(() => loadRgsScheme({ scheme: 'nt', codes: [] })).toThrow(RgsSchemeError)
  })

  it('refuses a duplicate code', () => {
    const code = {
      code: 'B',
      omslagCode: null,
      sortKey: '',
      referenceNumber: '1',
      shortDescription: 'x',
      description: 'x',
      debitCredit: null,
      level: 1,
      inactive: false,
      flags: {},
    }
    expect(() =>
      loadRgsScheme({ scheme: 'rgs', version: '1', variant: 'x', codes: [code, code] }),
    ).toThrow(/Duplicate/)
  })

  it('refuses a declared count that disagrees with the contents', () => {
    expect(() =>
      loadRgsScheme({ scheme: 'rgs', version: '1', variant: 'x', codeCount: 5, codes: [] }),
    ).toThrow(/declares 5 codes/)
  })

  it('refuses a bad debitCredit', () => {
    expect(() =>
      loadRgsScheme({
        scheme: 'rgs',
        version: '1',
        variant: 'x',
        codes: [
          {
            code: 'B',
            omslagCode: null,
            sortKey: '',
            referenceNumber: '1',
            shortDescription: 'x',
            description: 'x',
            debitCredit: 'X',
            level: 1,
            inactive: false,
            flags: {},
          },
        ],
      }),
    ).toThrow(/debitCredit/)
  })
})

describe('the reference data store', () => {
  it('reports what it has when asked for something it does not', () => {
    const store = createReferenceDataStore({ rgs: new Map() })
    expect(() => store.rgs('3.7')).toThrow(/not loaded/)
    expect(store.hasRgs('3.7')).toBe(false)
  })

  it('resolves a bare version to the only variant loaded', () => {
    const store = loadReferenceDataFromDirectory(REFERENCE_DATA)
    expect(store.rgsVersions).toEqual(['3.7-mkb'])
    expect(store.rgs('3.7').variant).toBe('mkb')
    expect(store.rgs('3.7-mkb').variant).toBe('mkb')
  })
})

const account = (
  number: string,
  rgsCode: string | null,
  normalBalance: 'debit' | 'credit' = 'debit',
  balance = 100_00n,
) => ({ number, name: `Account ${number}`, normalBalance, rgsCode, balance })

describe('mapping validation', () => {
  it('accepts a well-formed mapping', () => {
    expect(validateMapping(account('1300', 'BVorDebHad'), rgs)).toEqual([])
  })

  it('flags an unmapped account', () => {
    const problems = validateMapping(account('1300', null), rgs)
    expect(problems[0]?.code).toBe('unmapped')
    expect(problems[0]?.severity).toBe('warning')
  })

  it('rejects a code that is not in the scheme', () => {
    const problems = validateMapping(account('1300', 'NOTACODE'), rgs)
    expect(problems[0]?.code).toBe('unknown_code')
    expect(problems[0]?.severity).toBe('error')
  })

  it('rejects a withdrawn code', () => {
    const withdrawn = rgs.codes.find((code) => code.inactive)
    expect(withdrawn).toBeDefined()
    const problems = validateMapping(account('1300', withdrawn!.code), rgs)
    expect(problems.some((problem) => problem.code === 'inactive_code')).toBe(true)
  })

  it('warns when a posting account is mapped to an aggregate', () => {
    // BVor is level 2: Vorderingen. Real detail lives deeper.
    const problems = validateMapping(account('1300', 'BVor'), rgs)
    expect(problems.some((problem) => problem.code === 'aggregate_code')).toBe(true)
  })

  it('warns when the account and the code disagree about the side', () => {
    const problems = validateMapping(account('1300', 'BVorDebHad', 'credit'), rgs)
    const mismatch = problems.find((problem) => problem.code === 'direction_mismatch')
    expect(mismatch?.severity).toBe('warning')
  })
})

describe('coverage, the dashboard metric', () => {
  it('counts accounts and the share of balance that is mappable', () => {
    const report = buildCoverageReport(
      [
        account('1300', 'BVorDebHad', 'debit', 300_00n),
        account('1100', 'BLimBanRba', 'debit', 100_00n),
        account('9999', null, 'debit', 100_00n),
      ],
      rgs,
      { applicableFlag: 'ZZP' },
    )

    expect(report.accountCount).toBe(3)
    expect(report.mappedCount).toBe(2)
    expect(report.unmappedAccounts).toEqual(['9999'])
    // 400 of 500 is 80%.
    expect(report.mappableBalanceBasisPoints).toBe(8000)
    expect(report.unusedCodeCount).toBeGreaterThan(0)
  })

  it('calls an empty chart fully covered rather than dividing by zero', () => {
    const report = buildCoverageReport([], rgs)
    expect(report.mappableBalanceBasisPoints).toBe(10_000)
    expect(report.accountCount).toBe(0)
  })
})

describe('indirect mapping through the omslagcode', () => {
  it('reports a balance that has flipped side under its omslagcode', () => {
    const withOmslag = rgs.codes.find(
      (code) => code.omslagCode !== null && code.debitCredit === 'D',
    )
    expect(withOmslag).toBeDefined()

    // On its own side, the code is unchanged.
    expect(effectiveCode(withOmslag!, 100n, rgs).code).toBe(withOmslag!.code)
    // On the other side, it becomes the omslagcode.
    expect(effectiveCode(withOmslag!, -100n, rgs).code).toBe(withOmslag!.omslagCode)
    // A zero balance has no side.
    expect(effectiveCode(withOmslag!, 0n, rgs).code).toBe(withOmslag!.code)
  })
})

describe('version upgrades', () => {
  const base = {
    scheme: 'rgs' as const,
    version: '3.6',
    variant: 'mkb',
    codes: [
      {
        code: 'BVorDeb',
        omslagCode: null,
        sortKey: 'G.A',
        referenceNumber: '1101000',
        shortDescription: 'Debiteuren',
        description: 'Vorderingen op handelsdebiteuren',
        debitCredit: 'D',
        level: 3,
        inactive: false,
        flags: {},
      },
      {
        code: 'BVorGoneAf',
        omslagCode: null,
        sortKey: 'G.B',
        referenceNumber: '1102000',
        shortDescription: 'Oud',
        description: 'Wordt ingetrokken',
        debitCredit: 'D',
        level: 4,
        inactive: false,
        flags: {},
      },
    ],
  }

  it('reports what changed between two versions', () => {
    const next = {
      ...base,
      version: '3.7',
      codes: [
        { ...base.codes[0]!, description: 'Handelsdebiteuren' },
        { ...base.codes[1]!, inactive: true },
        {
          code: 'BVorNew',
          omslagCode: null,
          sortKey: 'G.C',
          referenceNumber: '1103000',
          shortDescription: 'Nieuw',
          description: 'Nieuwe post',
          debitCredit: 'D',
          level: 4,
          inactive: false,
          flags: {},
        },
      ],
    }

    const diff = diffRgsSchemes(loadRgsScheme(base), loadRgsScheme(next))

    expect(diff.added.map((code) => code.code)).toEqual(['BVorNew'])
    expect(diff.removed).toEqual([])
    expect(diff.deactivated.map((code) => code.code)).toEqual(['BVorGoneAf'])
    expect(diff.changed).toContainEqual({
      code: 'BVorDeb',
      field: 'description',
      before: 'Vorderingen op handelsdebiteuren',
      after: 'Handelsdebiteuren',
    })
  })

  it('reduces the diff to the handful of mappings that need a decision', () => {
    const next = { ...base, version: '3.7', codes: [{ ...base.codes[0]! }] }
    const diff = diffRgsSchemes(loadRgsScheme(base), loadRgsScheme(next))

    const impacts = assessUpgradeImpact(
      [
        { accountNumber: '1300', rgsCode: 'BVorDeb' },
        { accountNumber: '1350', rgsCode: 'BVorGoneAf' },
        { accountNumber: '9999', rgsCode: null },
      ],
      diff,
    )

    expect(impacts).toHaveLength(1)
    expect(impacts[0]).toMatchObject({ accountNumber: '1350', impact: 'removed' })
  })
})
