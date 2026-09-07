import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountType, JournalType, NormalBalance } from '../ledger/types.js'
import { isAssignableRubriek } from '../vat/rubrieken.js'
import type { Deductibility, ReverseCharge, SupplyKind, TaxScope } from '../vat/tax-code.js'

/**
 * The default chart of accounts, as reference data.
 *
 * Spec 6.3: "Chart of accounts is per entity, with a Dutch default chart
 * shipped and RGS-mapped out of the box." Shipped as data rather than code for
 * the same reason the RGS scheme is — a self-hoster with their own chart drops
 * a file in `reference-data/charts/` and provisions from it, and an accountancy
 * firm can ship the one they always use.
 *
 * A test validates every mapping in every shipped chart against the loaded RGS
 * scheme: real code, still active, deep enough to post to, and agreeing about
 * which side the account sits on.
 */

export class ChartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChartError'
  }
}

/**
 * Named accounts the system itself needs to find.
 *
 * Without these, provisioning would have to guess which account is the debtors
 * control account — and a chart written by somebody else will not use 1300.
 */
export interface ChartRoles {
  readonly receivable: string
  readonly payable: string
  readonly vatPayable: string
  readonly vatReceivable: string
  /** Where a year close appropriates the result. */
  readonly result: string
  readonly bank: string
  readonly cash: string
  readonly revenue: string
}

export interface ChartAccount {
  readonly number: string
  readonly name: string
  readonly type: AccountType
  readonly normalBalance: NormalBalance
  readonly rgsCode: string | null
}

export interface ChartJournal {
  readonly code: string
  readonly name: string
  readonly type: JournalType
}

export interface ChartTaxCode {
  readonly code: string
  readonly description: string
  readonly rateBasisPoints: number
  readonly direction: 'output' | 'input'
  /** Which role's account the tax lands on. */
  readonly accountRole: keyof ChartRoles
  readonly isReverseCharge: boolean
  readonly ublCategory: string
  /** The rest of spec 7.2's rule. See `vat/tax-code.ts` for what each means. */
  readonly baseRubriek: string | null
  readonly vatRubriek: string | null
  readonly scope: TaxScope
  readonly reverseCharge: ReverseCharge
  readonly deductibility: Deductibility
  readonly proRataBasisPoints: number | null
  readonly supplyKind: SupplyKind
  readonly deductionCode: string | null
}

export interface Chart {
  readonly code: string
  readonly name: string
  readonly description: string
  readonly rgsVersion: string
  readonly rgsVariant: string
  readonly currency: string
  readonly roles: ChartRoles
  readonly accounts: readonly ChartAccount[]
  readonly journals: readonly ChartJournal[]
  readonly taxCodes: readonly ChartTaxCode[]
}

const ACCOUNT_TYPES = new Set(['asset', 'liability', 'equity', 'revenue', 'expense'])
const JOURNAL_TYPES = new Set(['memoriaal', 'verkoop', 'inkoop', 'bank', 'kas'])
const ROLE_NAMES = [
  'receivable',
  'payable',
  'vatPayable',
  'vatReceivable',
  'result',
  'bank',
  'cash',
  'revenue',
] as const

function requireString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value === '') {
    throw new ChartError(`${where}: ${field} must be a non-empty string.`)
  }
  return value
}

export function loadChart(raw: unknown): Chart {
  if (typeof raw !== 'object' || raw === null) throw new ChartError('A chart must be an object.')
  const file = raw as Record<string, unknown>

  if (file['chart'] !== 'klopt.chart-of-accounts') {
    throw new ChartError('Not a chart file: "chart" must be "klopt.chart-of-accounts".')
  }

  const rawAccounts = file['accounts']
  if (!Array.isArray(rawAccounts) || rawAccounts.length === 0) {
    throw new ChartError('A chart needs accounts.')
  }

  const numbers = new Set<string>()
  const accounts: ChartAccount[] = rawAccounts.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ChartError(`accounts[${String(index)}] is not an object.`)
    }
    const account = entry as Record<string, unknown>
    const number = requireString(account, 'number', `accounts[${String(index)}]`)

    if (numbers.has(number)) throw new ChartError(`Duplicate account number ${number}.`)
    numbers.add(number)

    const type = account['type']
    if (typeof type !== 'string' || !ACCOUNT_TYPES.has(type)) {
      throw new ChartError(`Account ${number} has an unknown type ${String(type)}.`)
    }
    const normalBalance = account['normalBalance']
    if (normalBalance !== 'debit' && normalBalance !== 'credit') {
      throw new ChartError(`Account ${number} must be debit or credit.`)
    }
    const rgsCode = account['rgsCode']
    if (rgsCode !== null && typeof rgsCode !== 'string') {
      throw new ChartError(`Account ${number}: rgsCode must be a string or null.`)
    }

    return {
      number,
      name: requireString(account, 'name', `accounts[${String(index)}]`),
      type: type as AccountType,
      normalBalance,
      rgsCode: rgsCode ?? null,
    }
  })

  const rawRoles = file['roles']
  if (typeof rawRoles !== 'object' || rawRoles === null)
    throw new ChartError('A chart needs roles.')
  const roleSource = rawRoles as Record<string, unknown>

  const roles = Object.fromEntries(
    ROLE_NAMES.map((role) => {
      const number = roleSource[role]
      if (typeof number !== 'string') throw new ChartError(`Role ${role} is missing.`)
      if (!numbers.has(number)) {
        throw new ChartError(`Role ${role} points at account ${number}, which the chart lacks.`)
      }
      return [role, number]
    }),
  ) as unknown as ChartRoles

  const rawJournals = file['journals']
  if (!Array.isArray(rawJournals) || rawJournals.length === 0) {
    throw new ChartError('A chart needs journals: there is nowhere to post without one.')
  }
  const journals: ChartJournal[] = rawJournals.map((entry, index) => {
    const journal = entry as Record<string, unknown>
    const type = journal['type']
    if (typeof type !== 'string' || !JOURNAL_TYPES.has(type)) {
      throw new ChartError(`journals[${String(index)}] has an unknown type ${String(type)}.`)
    }
    return {
      code: requireString(journal, 'code', `journals[${String(index)}]`),
      name: requireString(journal, 'name', `journals[${String(index)}]`),
      type: type as JournalType,
    }
  })

  const rawTaxCodes = file['taxCodes']
  const taxCodes: ChartTaxCode[] = (Array.isArray(rawTaxCodes) ? rawTaxCodes : []).map(
    (entry, index) => {
      const code = entry as Record<string, unknown>
      const rate = code['rateBasisPoints']
      if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 0 || rate > 10_000) {
        throw new ChartError(`taxCodes[${String(index)}]: rateBasisPoints must be 0..10000.`)
      }
      const direction = code['direction']
      if (direction !== 'output' && direction !== 'input') {
        throw new ChartError(`taxCodes[${String(index)}]: direction must be output or input.`)
      }
      const accountRole = code['accountRole']
      if (typeof accountRole !== 'string' || !ROLE_NAMES.includes(accountRole as never)) {
        throw new ChartError(
          `taxCodes[${String(index)}]: unknown accountRole ${String(accountRole)}.`,
        )
      }
      const rubriek = (field: string): string | null => {
        const value = code[field]
        if (value === undefined || value === null) return null
        if (typeof value !== 'string' || !isAssignableRubriek(value)) {
          throw new ChartError(
            `taxCodes[${String(index)}]: ${field} ${JSON.stringify(value)} is not a rubriek a tax code can write to.`,
          )
        }
        return value
      }
      const oneOf = <T extends string>(field: string, allowed: readonly T[], fallback: T): T => {
        const value = code[field]
        if (value === undefined) return fallback
        if (typeof value !== 'string' || !allowed.includes(value as T)) {
          throw new ChartError(
            `taxCodes[${String(index)}]: ${field} must be one of ${allowed.join(', ')}.`,
          )
        }
        return value as T
      }
      const proRata = code['proRataBasisPoints']
      if (proRata !== undefined && proRata !== null && typeof proRata !== 'number') {
        throw new ChartError(`taxCodes[${String(index)}]: proRataBasisPoints must be a number.`)
      }
      const reverseCharge = oneOf<ReverseCharge>(
        'reverseCharge',
        ['none', 'domestic', 'import_article_23'],
        code['isReverseCharge'] === true ? 'domestic' : 'none',
      )

      return {
        code: requireString(code, 'code', `taxCodes[${String(index)}]`),
        description: requireString(code, 'description', `taxCodes[${String(index)}]`),
        rateBasisPoints: rate,
        direction,
        accountRole: accountRole as keyof ChartRoles,
        isReverseCharge: reverseCharge !== 'none',
        ublCategory: typeof code['ublCategory'] === 'string' ? code['ublCategory'] : 'S',
        baseRubriek: rubriek('baseRubriek'),
        vatRubriek: rubriek('vatRubriek'),
        scope: oneOf<TaxScope>(
          'scope',
          [
            'domestic',
            'intra_community_supply',
            'intra_community_acquisition',
            'import',
            'export',
            'private_use',
            'exempt',
            'out_of_scope',
          ],
          'domestic',
        ),
        reverseCharge,
        deductibility: oneOf<Deductibility>('deductibility', ['full', 'pro_rata', 'none'], 'full'),
        proRataBasisPoints: typeof proRata === 'number' ? proRata : null,
        supplyKind: oneOf<SupplyKind>(
          'supplyKind',
          ['goods', 'services', 'not_applicable'],
          'not_applicable',
        ),
        deductionCode: typeof code['deductionCode'] === 'string' ? code['deductionCode'] : null,
      }
    },
  )

  return {
    code: requireString(file, 'code', 'chart'),
    name: requireString(file, 'name', 'chart'),
    description: typeof file['description'] === 'string' ? file['description'] : '',
    rgsVersion: requireString(file, 'rgsVersion', 'chart'),
    rgsVariant: requireString(file, 'rgsVariant', 'chart'),
    currency: typeof file['currency'] === 'string' ? file['currency'] : 'EUR',
    roles,
    accounts,
    journals,
    taxCodes,
  }
}

/** Every chart under a reference-data directory, keyed by its code. */
export function loadChartsFromDirectory(directory: string): ReadonlyMap<string, Chart> {
  const charts = new Map<string, Chart>()
  const path = join(directory, 'charts')

  let files: string[]
  try {
    files = readdirSync(path).filter((name) => name.endsWith('.json'))
  } catch {
    // No charts directory is legitimate: an installation may provision only
    // from charts supplied at runtime.
    return charts
  }

  for (const name of files) {
    const chart = loadChart(JSON.parse(readFileSync(join(path, name), 'utf8')))
    if (charts.has(chart.code)) throw new ChartError(`Two charts claim the code ${chart.code}.`)
    charts.set(chart.code, chart)
  }

  return charts
}
