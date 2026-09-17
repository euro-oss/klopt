import { describe, expect, it } from 'vitest'
import {
  assertIcpFileable,
  buildIcpReturn,
  buildVatReturn,
  type IcpJournalLine,
  type IcpProof,
  type TaxCodeRule,
} from '../../src/vat/index.js'

/**
 * The ICP opgaaf, and the cross-check that makes it worth having.
 *
 * Spec 7.2: "ICP totals must equal rubriek 3b. Block on mismatch." The aangifte
 * and the opgaaf describe the same supplies from two angles, so they can only
 * differ if a supply has no counterparty on it — which is the thing being
 * tested here, because it is the thing that actually happens.
 */

function rule(code: string, overrides: Partial<TaxCodeRule> = {}): TaxCodeRule {
  return {
    code,
    description: code,
    rateBasisPoints: 0,
    validFrom: '2026-01-01',
    validTo: null,
    direction: 'output',
    baseRubriek: '3b',
    vatRubriek: null,
    reverseCharge: 'none',
    scope: 'intra_community_supply',
    deductibility: 'full',
    proRataBasisPoints: null,
    supplyKind: 'goods',
    ublCategory: 'K',
    deductionCode: null,
    ...overrides,
  }
}

const RULES: readonly TaxCodeRule[] = [
  rule('ICP'),
  rule('ICPD', { supplyKind: 'services' }),
  rule('H21', {
    rateBasisPoints: 2100,
    baseRubriek: '1a',
    vatRubriek: '1a',
    scope: 'domestic',
    ublCategory: 'S',
  }),
]

let sequence = 0

function line(overrides: Partial<IcpJournalLine> & { signedMinorUnits: bigint }): IcpJournalLine {
  sequence += 1
  return {
    entryId: `entry-${String(sequence)}`,
    entryNumber: String(sequence),
    journalCode: 'VRK',
    bookingDate: '2026-02-15',
    lineNumber: 2,
    accountNumber: '8000',
    accountName: 'Omzet',
    description: 'Levering naar Duitsland',
    taxCode: 'ICP',
    taxRole: 'base',
    counterpartyNumber: 'DEB-0001',
    counterpartyName: 'Kunde GmbH',
    counterpartyVatNumber: 'DE123456789',
    counterpartyCountryCode: 'DE',
    ...overrides,
  }
}

const PROVEN: IcpProof = {
  outcome: 'valid',
  checkedAt: '2026-02-20T10:00:00.000Z',
  requestIdentifier: 'WAPIAAAAX123456789',
  source: 'vies',
}

function build(
  lines: readonly IcpJournalLine[],
  proofs: ReadonlyMap<string, IcpProof> = new Map([['DE123456789', PROVEN]]),
) {
  const vatReturn = buildVatReturn({
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    lines,
    rules: RULES,
    controlAccountNumbers: ['1500', '1510'],
  })

  return buildIcpReturn({
    periodFrom: '2026-01-01',
    periodTo: '2026-03-31',
    lines,
    rules: RULES,
    vatReturn,
    proofs,
  })
}

describe('buildIcpReturn', () => {
  it('groups goods and services per counterparty and agrees with 3b', () => {
    const result = build([
      line({ signedMinorUnits: -100_000n }),
      line({ signedMinorUnits: -25_000n, taxCode: 'ICPD' }),
    ])

    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      vatNumber: 'DE123456789',
      countryCode: 'DE',
      goodsMinorUnits: 100_000n,
      servicesMinorUnits: 25_000n,
      totalMinorUnits: 125_000n,
    })
    expect(result.totalMinorUnits).toBe(125_000n)
    expect(result.rubriek3bMinorUnits).toBe(125_000n)
    expect(result.differenceMinorUnits).toBe(0n)
    expect(result.findings).toEqual([])
    expect(result.blocked).toBe(false)
  })

  it('keeps two counterparties apart and normalises their numbers', () => {
    const result = build(
      [
        line({ signedMinorUnits: -100_000n }),
        line({
          signedMinorUnits: -40_000n,
          counterpartyNumber: 'DEB-0002',
          counterpartyName: 'Société SARL',
          // Written with spaces and a dot, as somebody typed it off an invoice.
          counterpartyVatNumber: 'fr 12.345678901',
        }),
      ],
      new Map([
        ['DE123456789', PROVEN],
        ['FR12345678901', PROVEN],
      ]),
    )

    expect(result.entries.map((entry) => entry.vatNumber)).toEqual(['DE123456789', 'FR12345678901'])
    expect(result.blocked).toBe(false)
  })

  it('ignores domestic supplies entirely', () => {
    const result = build([
      line({ signedMinorUnits: -100_000n }),
      line({ signedMinorUnits: -500_000n, taxCode: 'H21', accountNumber: '8000' }),
    ])

    expect(result.totalMinorUnits).toBe(100_000n)
    expect(result.blocked).toBe(false)
  })

  it('lets a credit note reduce a counterparty, without going negative overall', () => {
    const result = build([
      line({ signedMinorUnits: -100_000n }),
      line({ signedMinorUnits: 30_000n }),
    ])

    expect(result.entries[0]?.goodsMinorUnits).toBe(70_000n)
    expect(result.differenceMinorUnits).toBe(0n)
    expect(result.blocked).toBe(false)
  })

  it('blocks a supply with no customer on the line, which is what breaks 3b', () => {
    const result = build([
      line({ signedMinorUnits: -100_000n }),
      line({
        signedMinorUnits: -60_000n,
        counterpartyNumber: null,
        counterpartyName: null,
        counterpartyVatNumber: null,
        counterpartyCountryCode: null,
      }),
    ])

    expect(result.blocked).toBe(true)
    expect(result.findings.map((finding) => finding.code)).toContain('supply_without_counterparty')

    // And the mismatch it causes is named as well: 3b has 160.000, the opgaaf
    // can only place 100.000.
    expect(result.rubriek3bMinorUnits).toBe(160_000n)
    expect(result.totalMinorUnits).toBe(100_000n)
    expect(result.differenceMinorUnits).toBe(-60_000n)
    const mismatch = result.findings.find((finding) => finding.code === 'icp_mismatch')
    expect(mismatch?.severity).toBe('blocking')
  })

  it('blocks a customer with no VAT number, because that is the zero rate’s condition', () => {
    const result = build([line({ signedMinorUnits: -100_000n, counterpartyVatNumber: null })])

    expect(result.blocked).toBe(true)
    expect(result.findings.map((finding) => finding.code)).toContain(
      'counterparty_without_vat_number',
    )
  })

  it('tells a malformed EU number apart from a non-EU one', () => {
    const malformed = build([
      line({ signedMinorUnits: -100_000n, counterpartyVatNumber: 'DE12345' }),
    ])
    expect(malformed.findings.map((finding) => finding.code)).toContain('vat_number_malformed')

    const foreign = build([
      line({ signedMinorUnits: -100_000n, counterpartyVatNumber: 'CH123456789' }),
    ])
    expect(foreign.findings.map((finding) => finding.code)).toContain('vat_number_not_eu')
  })

  it('blocks a number VIES has never been asked about', () => {
    const result = build([line({ signedMinorUnits: -100_000n })], new Map())

    expect(result.blocked).toBe(true)
    const finding = result.findings.find((entry) => entry.code === 'vat_number_unproven')
    expect(finding?.severity).toBe('blocking')
    expect(finding?.lines).toHaveLength(1)
  })

  it('blocks a number VIES said was invalid', () => {
    const result = build(
      [line({ signedMinorUnits: -100_000n })],
      new Map([['DE123456789', { ...PROVEN, outcome: 'invalid' as const }]]),
    )

    expect(result.blocked).toBe(true)
    expect(result.findings.map((finding) => finding.code)).toContain('vat_number_invalid')
  })

  it('treats an unreachable register as unproven, not as valid', () => {
    // The failure mode worth being explicit about: a VIES outage must not
    // become a silent pass. The books still work; the claim does not.
    const result = build(
      [line({ signedMinorUnits: -100_000n })],
      new Map([['DE123456789', { ...PROVEN, outcome: 'unavailable' as const }]]),
    )

    expect(result.blocked).toBe(true)
    expect(result.findings.map((finding) => finding.code)).toContain('vat_number_unproven')
  })

  it('warns when the proof predates the period, because a number can lapse', () => {
    const result = build(
      [line({ signedMinorUnits: -100_000n })],
      new Map([['DE123456789', { ...PROVEN, checkedAt: '2025-11-01T09:00:00.000Z' }]]),
    )

    const finding = result.findings.find((entry) => entry.code === 'proof_predates_period')
    expect(finding?.severity).toBe('warning')
    expect(result.blocked).toBe(false)
  })

  it('accepts a proof dated inside the period', () => {
    const result = build(
      [line({ signedMinorUnits: -100_000n })],
      new Map([['DE123456789', { ...PROVEN, checkedAt: '2026-01-02T09:00:00.000Z' }]]),
    )
    expect(result.findings).toEqual([])
  })

  it('keeps the lines behind every counterparty, so a figure can be traced', () => {
    const result = build([
      line({ signedMinorUnits: -100_000n }),
      line({ signedMinorUnits: -25_000n, taxCode: 'ICPD' }),
    ])

    expect(result.entries[0]?.lines).toHaveLength(2)
    expect(result.entries[0]?.lines.map((entry) => entry.amountMinorUnits)).toEqual([
      100_000n,
      25_000n,
    ])
  })

  it('is empty and unblocked when there are no intra-community supplies', () => {
    const result = build([line({ signedMinorUnits: -500_000n, taxCode: 'H21' })])

    expect(result.entries).toEqual([])
    expect(result.totalMinorUnits).toBe(0n)
    expect(result.findings).toEqual([])
    expect(result.blocked).toBe(false)
  })
})

describe('assertIcpFileable', () => {
  it('says nothing about an opgaaf that reconciles', () => {
    expect(() => {
      assertIcpFileable(build([line({ signedMinorUnits: -100_000n })]))
    }).not.toThrow()
  })

  it('throws with every blocking reason at once', () => {
    const result = build(
      [
        line({ signedMinorUnits: -100_000n, counterpartyVatNumber: null }),
        line({ signedMinorUnits: -60_000n, counterpartyVatNumber: 'DE9' }),
      ],
      new Map(),
    )

    let thrown: unknown
    try {
      assertIcpFileable(result)
    } catch (error: unknown) {
      thrown = error
    }

    expect(thrown).toMatchObject({ code: 'icp_mismatch' })
    const violations = (thrown as { violations: readonly { path: string | null }[] }).violations
    expect(violations.length).toBeGreaterThan(1)
    expect(violations.map((entry) => entry.path)).toContain('icp.counterparty_without_vat_number')
  })
})
