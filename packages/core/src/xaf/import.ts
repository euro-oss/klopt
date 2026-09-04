import { violation, type LedgerViolation } from '../errors.js'
import type { JournalLineInput, PostJournalEntryCommand } from '../ledger/types.js'
import { parseXaf, readDeclaredTotals } from './parse.js'
import { validateXafDocument } from './validate.js'
import type { XafDocument, XafJournalType } from './model.js'

/**
 * Turning somebody else's XAF into postable entries (spec 13).
 *
 * Migration is a product feature, not a services engagement, and the thing that
 * makes it one is **the dry run**: a reconciliation report against the source
 * file's own control totals, produced before anything is committed. An importer
 * that gets halfway and stops is worse than one that refuses to start.
 *
 * This module is pure. It reads a file and produces a plan; the caller decides
 * whether to post it.
 */

export interface XafImportOptions {
  readonly entityId: string
  /** Journals, accounts and periods that already exist, so the plan can say what is new. */
  readonly existingAccountNumbers: readonly string[]
  readonly existingJournalCodes: readonly string[]
  /** Booking dates outside this range are reported rather than posted. */
  readonly acceptFrom: string | null
  readonly acceptTo: string | null
}

export interface XafAccountPlan {
  readonly number: string
  readonly name: string
  readonly type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  readonly normalBalance: 'debit' | 'credit'
  readonly rgsCode: string | null
  readonly exists: boolean
}

export interface XafJournalPlan {
  readonly code: string
  readonly name: string
  readonly type: 'memoriaal' | 'verkoop' | 'inkoop' | 'bank' | 'kas'
  readonly exists: boolean
}

export interface XafReconciliation {
  /** What the file says about itself. */
  readonly declaredLineCount: number | null
  readonly declaredTotalDebit: bigint | null
  readonly declaredTotalCredit: bigint | null
  /** What it actually contains. */
  readonly actualLineCount: number
  readonly actualTotalDebit: bigint
  readonly actualTotalCredit: bigint
  readonly matches: boolean
}

export interface XafImportPlan {
  readonly fiscalYear: string
  readonly companyName: string
  readonly currency: string
  readonly accounts: readonly XafAccountPlan[]
  readonly journals: readonly XafJournalPlan[]
  readonly entries: readonly PostJournalEntryCommand[]
  readonly reconciliation: XafReconciliation
  /** Blocking. The plan must not be posted while this is non-empty. */
  readonly problems: readonly LedgerViolation[]
  /** Non-blocking, but an accountant should read them. */
  readonly warnings: readonly string[]
}

const JOURNAL_TYPE: Record<XafJournalType, XafJournalPlan['type']> = {
  B: 'bank',
  C: 'kas',
  P: 'inkoop',
  S: 'verkoop',
  M: 'memoriaal',
  Z: 'memoriaal',
}

/**
 * XAF's `accTp` is three-way — balance, profit-and-loss, memoriaal — and Klopt's
 * account type is five-way. The extra distinction cannot be recovered from the
 * file, so it is inferred from the RGS lead code where there is one and from
 * the Dutch numbering convention otherwise, and the result is reported as a
 * warning so a human checks it.
 */
function inferAccountType(
  accTp: string,
  accountNumber: string,
  leadCode: string | null,
): {
  type: XafAccountPlan['type']
  normalBalance: XafAccountPlan['normalBalance']
  certain: boolean
} {
  if (accTp === 'P') {
    // RGS puts costs under W…, and within that Omzet is the revenue branch.
    const isRevenue = leadCode?.startsWith('WOmz') ?? accountNumber.startsWith('8')
    return {
      type: isRevenue ? 'revenue' : 'expense',
      normalBalance: isRevenue ? 'credit' : 'debit',
      certain: leadCode !== null,
    }
  }

  if (leadCode !== null) {
    if (leadCode.startsWith('BEiv'))
      return { type: 'equity', normalBalance: 'credit', certain: true }
    if (leadCode.startsWith('BSch') || leadCode.startsWith('BVrz')) {
      return { type: 'liability', normalBalance: 'credit', certain: true }
    }
    if (leadCode.startsWith('B')) return { type: 'asset', normalBalance: 'debit', certain: true }
  }

  // Dutch decimal convention: 0 is equity and fixed assets, 1 is current.
  if (accountNumber.startsWith('05') || accountNumber.startsWith('06')) {
    return { type: 'equity', normalBalance: 'credit', certain: false }
  }
  if (accountNumber.startsWith('16') || accountNumber.startsWith('17')) {
    return { type: 'liability', normalBalance: 'credit', certain: false }
  }
  return { type: 'asset', normalBalance: 'debit', certain: false }
}

/**
 * XAF's `amnt` is always in the file's own currency; a foreign-currency line
 * carries the original alongside it in `<currency>`, but **not the rate that
 * converted it**. So the import takes the functional amount and drops the
 * original: reconstructing a rate by division would put a computed number into
 * a permanent record and call it a source document.
 *
 * The original is preserved in the line description instead, where it is
 * evidence rather than data.
 */
function toLine(
  accountNumber: string,
  amount: bigint,
  isDebit: boolean,
  description: string | null,
): JournalLineInput {
  return {
    accountNumber,
    description,
    debit: isDebit ? amount : 0n,
    credit: isDebit ? 0n : amount,
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
  }
}

export function planXafImport(source: string, options: XafImportOptions): XafImportPlan {
  const document: XafDocument = parseXaf(source)
  const declared = readDeclaredTotals(source)
  const computed = validateXafDocument(document)

  const problems: LedgerViolation[] = []
  const warnings: string[] = []

  for (const problem of computed.problems) {
    if (problem.severity === 'error') {
      problems.push(violation('unknown_entry', problem.path, problem.message))
    } else {
      warnings.push(`${problem.path}: ${problem.message}`)
    }
  }

  const reconciliation: XafReconciliation = {
    declaredLineCount: declared.linesCount,
    declaredTotalDebit: declared.totalDebit,
    declaredTotalCredit: declared.totalCredit,
    actualLineCount: computed.lineCount,
    actualTotalDebit: computed.totalDebit,
    actualTotalCredit: computed.totalCredit,
    matches:
      (declared.linesCount === null || declared.linesCount === computed.lineCount) &&
      (declared.totalDebit === null || declared.totalDebit === computed.totalDebit) &&
      (declared.totalCredit === null || declared.totalCredit === computed.totalCredit),
  }

  if (!reconciliation.matches) {
    problems.push(
      violation(
        'entry_unbalanced',
        'transactions',
        `The file's own control totals do not match its contents: it declares ${String(declared.linesCount)} lines, ${String(declared.totalDebit)} debit and ${String(declared.totalCredit)} credit; it contains ${String(computed.lineCount)}, ${computed.totalDebit.toString()} and ${computed.totalCredit.toString()}.`,
      ),
    )
  }

  const existingAccounts = new Set(options.existingAccountNumbers)
  const accounts: XafAccountPlan[] = document.ledgerAccounts.map((account) => {
    const inferred = inferAccountType(account.accTp, account.accID, account.leadCode)
    if (!inferred.certain) {
      warnings.push(
        `Account ${account.accID} (${account.accDesc}) has no RGS code; its type was guessed as ${inferred.type} from the account number. Check it.`,
      )
    }
    return {
      number: account.accID,
      name: account.accDesc,
      type: inferred.type,
      normalBalance: inferred.normalBalance,
      rgsCode: account.leadCode,
      exists: existingAccounts.has(account.accID),
    }
  })

  const existingJournals = new Set(options.existingJournalCodes)
  const journals: XafJournalPlan[] = document.journals.map((journal) => ({
    code: journal.jrnID,
    name: journal.desc,
    type: JOURNAL_TYPE[journal.jrnTp],
    exists: existingJournals.has(journal.jrnID),
  }))

  const entries: PostJournalEntryCommand[] = []

  for (const journal of document.journals) {
    for (const transaction of journal.transactions) {
      if (options.acceptFrom !== null && transaction.trDt < options.acceptFrom) {
        warnings.push(
          `${journal.jrnID} ${transaction.nr} is dated ${transaction.trDt}, before the accepted range. Skipped.`,
        )
        continue
      }
      if (options.acceptTo !== null && transaction.trDt > options.acceptTo) {
        warnings.push(
          `${journal.jrnID} ${transaction.nr} is dated ${transaction.trDt}, after the accepted range. Skipped.`,
        )
        continue
      }

      entries.push({
        entityId: options.entityId,
        journalCode: journal.jrnID,
        bookingDate: transaction.trDt,
        documentDate: transaction.lines[0]?.effDate ?? transaction.trDt,
        description: transaction.desc ?? `${journal.jrnID} ${transaction.nr}`,
        // The original numbering is preserved: dunning and matching depend on
        // it (spec 13), and an accountant looking for invoice 2026-001 should
        // find 2026-001.
        sourceDocumentRef: transaction.sourceID ?? `xaf:${journal.jrnID}:${transaction.nr}`,
        reversesEntryId: null,
        lines: transaction.lines.map((line) =>
          toLine(
            line.accID,
            line.amount,
            line.amountType === 'D',
            line.currency === null
              ? line.desc
              : `${line.desc ?? ''} (${line.currency.curCode} ${line.currency.curAmnt.toString()} minor units)`.trim(),
          ),
        ),
      })
    }
  }

  return {
    fiscalYear: document.header.fiscalYear,
    companyName: document.company.companyName,
    currency: document.header.curCode,
    accounts,
    journals,
    entries,
    reconciliation,
    problems,
    warnings,
  }
}
