import type { NormalBalance } from '../ledger/types.js'
import type { RgsCode, RgsScheme } from './scheme.js'

/**
 * Mapping the chart of accounts onto RGS (spec 7.1).
 *
 * "Mapping quality is what makes the accountant say yes. Treat unmapped
 * accounts as a first-class health metric on the dashboard, not a settings
 * screen nobody visits."
 *
 * So coverage is a report with three numbers an accountant actually cares
 * about: how many accounts are mapped, how much of the balance is mappable, and
 * what is wrong with the mappings that exist.
 */

export type MappingProblemCode =
  'unknown_code' | 'inactive_code' | 'aggregate_code' | 'direction_mismatch' | 'unmapped'

export type MappingSeverity = 'error' | 'warning'

export interface MappingProblem {
  readonly accountNumber: string
  readonly accountName: string
  readonly rgsCode: string | null
  readonly code: MappingProblemCode
  readonly severity: MappingSeverity
  readonly message: string
}

export interface MappableAccount {
  readonly number: string
  readonly name: string
  readonly normalBalance: NormalBalance
  readonly rgsCode: string | null
  /** Signed, debit-positive, in functional minor units. Drives the balance share. */
  readonly balance: bigint
}

/**
 * The level at which a ledger account should be mapped.
 *
 * Levels 1–3 are aggregates: BALANS, then Vorderingen, then Vorderingen op
 * handelsdebiteuren. Mapping a posting account to an aggregate loses the detail
 * the RGS exists to provide, so it is a warning rather than an error — some
 * charts genuinely have nothing more specific, and the accountant decides.
 */
const POSTABLE_LEVEL = 4

export interface RgsCoverageReport {
  readonly version: string
  readonly variant: string
  readonly accountCount: number
  readonly mappedCount: number
  readonly unmappedCount: number
  /**
   * Share of absolute balance sitting on mapped accounts, in basis points, so
   * it stays an integer. 10000 is everything.
   */
  readonly mappableBalanceBasisPoints: number
  readonly problems: readonly MappingProblem[]
  readonly unmappedAccounts: readonly string[]
  /** Codes an entity of this shape could use but has not. Counted, not listed. */
  readonly unusedCodeCount: number
}

/** One mapping, checked against the scheme. Empty means it is fine. */
export function validateMapping(
  account: MappableAccount,
  scheme: RgsScheme,
): readonly MappingProblem[] {
  if (account.rgsCode === null || account.rgsCode === '') {
    return [
      {
        accountNumber: account.number,
        accountName: account.name,
        rgsCode: null,
        code: 'unmapped',
        severity: 'warning',
        message: `Account ${account.number} has no RGS code. It will be absent from any RGS-based report.`,
      },
    ]
  }

  const code = scheme.get(account.rgsCode)
  if (code === undefined) {
    return [
      {
        accountNumber: account.number,
        accountName: account.name,
        rgsCode: account.rgsCode,
        code: 'unknown_code',
        severity: 'error',
        message: `${account.rgsCode} is not a code in RGS ${scheme.version} (${scheme.variant}).`,
      },
    ]
  }

  const problems: MappingProblem[] = []

  if (code.inactive) {
    problems.push({
      accountNumber: account.number,
      accountName: account.name,
      rgsCode: code.code,
      code: 'inactive_code',
      severity: 'error',
      message: `${code.code} is withdrawn in RGS ${scheme.version}. Remap before filing.`,
    })
  }

  if (code.level < POSTABLE_LEVEL) {
    problems.push({
      accountNumber: account.number,
      accountName: account.name,
      rgsCode: code.code,
      code: 'aggregate_code',
      severity: 'warning',
      message: `${code.code} is a level ${String(code.level)} aggregate. Posting accounts normally map to level ${String(POSTABLE_LEVEL)} or deeper.`,
    })
  }

  const expected: NormalBalance | null =
    code.debitCredit === 'D' ? 'debit' : code.debitCredit === 'C' ? 'credit' : null

  if (expected !== null && expected !== account.normalBalance) {
    problems.push({
      accountNumber: account.number,
      accountName: account.name,
      rgsCode: code.code,
      code: 'direction_mismatch',
      severity: 'warning',
      message: `Account ${account.number} is a ${account.normalBalance} account but ${code.code} is ${expected}. Check whether ${code.omslagCode ?? 'the omslagcode'} is the right code.`,
    })
  }

  return problems
}

/**
 * The dashboard number.
 *
 * `applicableFlag` narrows the "unused codes" count to the profile the entity
 * actually is — counting all 3691 MKB codes as unused tells nobody anything.
 */
export function buildCoverageReport(
  accounts: readonly MappableAccount[],
  scheme: RgsScheme,
  options: { readonly applicableFlag?: string } = {},
): RgsCoverageReport {
  const problems: MappingProblem[] = []
  const unmapped: string[] = []
  const used = new Set<string>()

  let mappedBalance = 0n
  let totalBalance = 0n

  for (const account of accounts) {
    const magnitude = account.balance < 0n ? -account.balance : account.balance
    totalBalance += magnitude

    if (account.rgsCode !== null && account.rgsCode !== '') {
      mappedBalance += magnitude
      used.add(account.rgsCode)
    } else {
      unmapped.push(account.number)
    }

    problems.push(...validateMapping(account, scheme))
  }

  const applicable = scheme.codes.filter((code) => {
    if (code.inactive) return false
    // Aggregates are not meant to be mapped to, so they are not "unused".
    if (code.level < POSTABLE_LEVEL) return false
    if (options.applicableFlag === undefined) return true
    return code.flags[options.applicableFlag] === true
  })

  return {
    version: scheme.version,
    variant: scheme.variant,
    accountCount: accounts.length,
    mappedCount: accounts.length - unmapped.length,
    unmappedCount: unmapped.length,
    mappableBalanceBasisPoints:
      totalBalance === 0n ? 10_000 : Number((mappedBalance * 10_000n) / totalBalance),
    problems,
    unmappedAccounts: unmapped,
    unusedCodeCount: applicable.filter((code) => !used.has(code.code)).length,
  }
}

/**
 * The code a balance should be reported under, given its sign.
 *
 * This is RGS indirect mapping: a debtor balance that has gone credit is
 * reported as a creditor, under the omslagcode. Applying it silently at report
 * time is the standard pattern and it is why `omslagCode` is carried in the
 * reference data rather than discarded.
 */
export function effectiveCode(code: RgsCode, balance: bigint, scheme: RgsScheme): RgsCode {
  if (code.omslagCode === null) return code
  if (balance === 0n) return code

  const onDebitSide = balance > 0n
  const belongsOnDebitSide = code.debitCredit === 'D'
  if (code.debitCredit === null || onDebitSide === belongsOnDebitSide) return code

  return scheme.get(code.omslagCode) ?? code
}
