import { violation, type LedgerViolation } from '../errors.js'
import type { JournalLineInput, PostJournalEntryCommand, SubledgerKind } from '../ledger/types.js'
import { parseXaf, readDeclaredTotals } from './parse.js'
import { validateXafDocument } from './validate.js'
import type {
  XafDebitCredit,
  XafDocument,
  XafJournalType,
  XafTransaction,
  XafTransactionLine,
} from './model.js'

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
  /**
   * Tax codes this administration already has.
   *
   * A file's `vatID` is the *source system's* code and need not mean anything
   * here. Carrying one we cannot resolve would put a tag on a line that no
   * rubriek maps, so an unknown code blocks the import rather than being
   * silently dropped — see the note on `taxCodes` below.
   */
  readonly existingTaxCodes?: readonly string[] | undefined
  /** `TYPE|VALUE`, e.g. `COSTCENTRE|A100`. Posting refuses a value it does not know. */
  readonly existingDimensionValues?: readonly string[] | undefined
  /**
   * Contact number to contact id.
   *
   * The subledger link is by id, and an XAF carries a number. Numbers not in
   * the map lose their link, with a warning — the entries are still right, the
   * creditors ageing just will not know about them until the contacts exist and
   * the plan is built again.
   */
  readonly contactIdsByNumber?: ReadonlyMap<string, string> | undefined
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

/**
 * A tax code the file uses, and whether this administration has it.
 *
 * Listed rather than created: a tax code is a rate *and* a pair of rubrieken
 * and a deductibility and a scope (ADR 0021), and none of that is in an XAF.
 * The file gives a description and a percentage, which is enough for somebody
 * to map it and nowhere near enough to guess.
 */
export interface XafVatCodePlan {
  readonly code: string
  readonly description: string
  readonly exists: boolean
}

/** A cost centre or project the file uses, and whether we know the value. */
export interface XafDimensionPlan {
  readonly typeCode: string
  readonly valueCode: string
  readonly exists: boolean
}

/** A customer or supplier the file names, and whether we have them. */
export interface XafContactPlan {
  readonly number: string
  readonly name: string
  readonly vatNumber: string | null
  readonly isCustomer: boolean
  readonly isSupplier: boolean
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
  readonly vatCodes: readonly XafVatCodePlan[]
  readonly dimensions: readonly XafDimensionPlan[]
  readonly contacts: readonly XafContactPlan[]
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

/** XAF calls a cost centre `costID` and a project `projID`. We call them these. */
const COST_CENTRE = 'COSTCENTRE'
const PROJECT = 'PROJECT'

const dimensionKey = (typeCode: string, valueCode: string): string => `${typeCode}|${valueCode}`

/**
 * Whose subledger a line belongs to.
 *
 * The journal is the reliable signal: a line in a verkoopboek is a debtor and
 * one in an inkoopboek is a creditor, whatever the party record says. `custSupTp`
 * is the fallback, and it is only useful when it is not `B` — plenty of parties
 * are both, which is exactly why the journal is asked first.
 */
function subledgerKindFor(
  journalType: XafJournalPlan['type'],
  custSupTp: 'C' | 'S' | 'B' | 'O' | null,
): SubledgerKind {
  if (journalType === 'verkoop') return 'customer'
  if (journalType === 'inkoop') return 'supplier'
  return custSupTp === 'S' ? 'supplier' : 'customer'
}

interface TaxTag {
  readonly code: string
  readonly role: 'base' | 'tax'
  /** Signed the way the document runs: negative on a credit note. */
  readonly amount: bigint
}

/**
 * Which lines of a transaction carry a tax tag, and which one.
 *
 * ## Why the VAT line has to be found rather than read
 *
 * XAF marks only the taxable **base**: `<vat>` sits on the revenue or cost
 * line, holding the tax that was charged on it. The VAT ledger line beside it
 * carries no block at all — correctly, because marking both would declare the
 * same tax twice.
 *
 * The BTW-aangifte needs both (see `vat/return.ts`): the base line fills
 * rubriek 1a's *omzet* and the tax line fills its *btw*. So importing only what
 * the file marks produces an administration with bases and no VAT — a return
 * that declares turnover and no tax, which reconciles against nothing and is
 * discovered at the next filing.
 *
 * So the tax line is reconstructed: within one transaction, sum the `<vat>`
 * amounts per code and side, and look for an unmarked line of exactly that
 * amount on that side. Summing per code first is what makes an invoice at two
 * rates work, where two base lines share one VAT line per rate.
 *
 * The rule is exact rather than approximate, and when no line matches the tax
 * simply is not tagged and the caller is told. A guess here would put a number
 * in a rubriek that nothing in the journal supports, which is the one thing
 * the reconciliation exists to make impossible.
 */
function taxTagsFor(
  transaction: XafTransaction,
  knownCodes: ReadonlySet<string>,
): { readonly tags: ReadonlyMap<string, TaxTag>; readonly unmatched: readonly string[] } {
  const tags = new Map<string, TaxTag>()
  const groups = new Map<string, { code: string; side: XafDebitCredit; total: bigint }>()

  for (const line of transaction.lines) {
    if (line.vat === null || !knownCodes.has(line.vat.vatID)) continue

    // A base and its tax on the same side is an ordinary document; on opposite
    // sides it is a credit note, and everything about it runs negative.
    const sign = line.vat.vatAmntTp === line.amountType ? 1n : -1n
    tags.set(line.nr, { code: line.vat.vatID, role: 'base', amount: sign * line.vat.vatAmnt })

    const key = `${line.vat.vatID}|${line.vat.vatAmntTp}|${String(sign)}`
    const group = groups.get(key)
    groups.set(key, {
      code: line.vat.vatID,
      side: line.vat.vatAmntTp,
      total: (group?.total ?? 0n) + line.vat.vatAmnt,
    })
  }

  const unmatched: string[] = []
  const taken = new Set<string>()

  for (const [key, group] of groups) {
    const sign = key.endsWith('|-1') ? -1n : 1n
    const match = transaction.lines.find(
      (line) =>
        line.vat === null &&
        !taken.has(line.nr) &&
        line.amountType === group.side &&
        line.amount === group.total,
    )

    if (match === undefined) {
      unmatched.push(`${group.code} ${group.total.toString()}`)
      continue
    }

    taken.add(match.nr)
    tags.set(match.nr, { code: group.code, role: 'tax', amount: sign * group.total })
  }

  return { tags, unmatched }
}

/**
 * One XAF line, as something postable.
 *
 * ## The tax tag
 *
 * XAF puts its `<vat>` block on the line carrying the taxable *base* — `amnt`
 * is the base and `vatAmnt` is the tax on it — which is exactly ADR 0021's
 * `tax_role: 'base'`. The VAT ledger line beside it carries no block and stays
 * untagged, which is right: tagging both would declare the same tax twice, and
 * it is the bug the exporter had before `tax_role` existed to tell them apart.
 *
 * `vatAmnt` is unsigned with its direction in `vatAmntTp`, and `taxAmount` here
 * is signed the way the transaction runs. So the sign comes from comparing the
 * two sides: a base and a tax on the same side is an ordinary document, and on
 * opposite sides it is a credit note. That is the exact inverse of what the
 * exporter writes, which is what makes a file survive a round trip.
 *
 * Dropping all this was the state of the importer until now: every imported
 * line arrived untagged, so a migrated year contributed nothing to any rubriek
 * and an XAF exported from it declared no VAT at all.
 */
function toLine(
  line: XafTransactionLine,
  description: string | null,
  subledgerKind: SubledgerKind,
  tag: TaxTag | null,
  known: {
    readonly dimensionValues: ReadonlySet<string>
    readonly contactIds: ReadonlyMap<string, string>
  },
): JournalLineInput {
  const isDebit = line.amountType === 'D'

  const dimensions: { typeCode: string; valueCode: string }[] = []
  for (const [typeCode, valueCode] of [
    [COST_CENTRE, line.costID],
    [PROJECT, line.projID],
  ] as const) {
    if (valueCode === null || valueCode === '') continue
    if (!known.dimensionValues.has(dimensionKey(typeCode, valueCode))) continue
    dimensions.push({ typeCode, valueCode })
  }

  const contactId = line.custSupID === null ? undefined : known.contactIds.get(line.custSupID)

  return {
    accountNumber: line.accID,
    description,
    debit: isDebit ? line.amount : 0n,
    credit: isDebit ? 0n : line.amount,
    /**
     * XAF's `amnt` is always in the file's own currency; a foreign-currency
     * line carries the original alongside it in `<currency>`, but **not the
     * rate that converted it**. So the import takes the functional amount and
     * drops the original: reconstructing a rate by division would put a
     * computed number into a permanent record and call it a source document.
     *
     * The original is preserved in the line description instead, where it is
     * evidence rather than data.
     */
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    taxCode: tag?.code ?? null,
    taxRole: tag?.role ?? null,
    taxAmount: tag?.amount ?? null,
    dimensions,
    subledgerKind: contactId === undefined ? null : subledgerKind,
    subledgerId: contactId ?? null,
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

  /**
   * What the file uses, and whether this administration has it.
   *
   * Gathered from the lines rather than from the header: a header may declare
   * fifty tax codes of which the year used three, and reporting the other
   * forty-seven as missing would bury the three that matter.
   */
  const usedTaxCodes = new Map<string, string>()
  const usedDimensions = new Map<string, { typeCode: string; valueCode: string }>()
  const usedContacts = new Set<string>()

  for (const journal of document.journals) {
    for (const transaction of journal.transactions) {
      for (const line of transaction.lines) {
        if (line.vat !== null) {
          const declared = document.vatCodes.find((code) => code.vatID === line.vat!.vatID)
          usedTaxCodes.set(line.vat.vatID, declared?.vatDesc ?? line.vat.vatID)
        }
        for (const [typeCode, valueCode] of [
          [COST_CENTRE, line.costID],
          [PROJECT, line.projID],
        ] as const) {
          if (valueCode === null || valueCode === '') continue
          usedDimensions.set(dimensionKey(typeCode, valueCode), { typeCode, valueCode })
        }
        if (line.custSupID !== null && line.custSupID !== '') usedContacts.add(line.custSupID)
      }
    }
  }

  const knownTaxCodes = new Set(options.existingTaxCodes ?? [])
  const knownDimensionValues = new Set(options.existingDimensionValues ?? [])
  const contactIds = options.contactIdsByNumber ?? new Map<string, string>()

  const vatCodes: XafVatCodePlan[] = [...usedTaxCodes].map(([code, description]) => ({
    code,
    description,
    exists: knownTaxCodes.has(code),
  }))

  const dimensionsUsed: XafDimensionPlan[] = [...usedDimensions.values()].map((entry) => ({
    ...entry,
    exists: knownDimensionValues.has(dimensionKey(entry.typeCode, entry.valueCode)),
  }))

  const contacts: XafContactPlan[] = [...usedContacts].map((number) => {
    const party = document.customersSuppliers.find((entry) => entry.custSupID === number)
    return {
      number,
      name: party?.custSupName ?? number,
      vatNumber: party?.taxRegIdent ?? null,
      isCustomer: party?.custSupTp === 'C' || party?.custSupTp === 'B',
      isSupplier: party?.custSupTp === 'S' || party?.custSupTp === 'B',
      exists: contactIds.has(number),
    }
  })

  /**
   * A tax code we cannot resolve stops the import.
   *
   * Not a warning, because the failure is invisible: the entries would post,
   * the trial balance would reconcile, and the BTW-aangifte would quietly
   * declare nothing for a whole migrated year. An accountant discovers that at
   * the next filing, by which time the file is long gone.
   *
   * Dimensions and subledger links are warnings instead. Losing a cost centre
   * costs analysis, not correctness, and refusing every file whose cost centres
   * we have not created yet would make the importer unusable on the first run —
   * which is the failure the dry run exists to avoid.
   */
  const unknownTaxCodes = vatCodes.filter((code) => !code.exists)
  if (unknownTaxCodes.length > 0) {
    problems.push(
      violation(
        'unknown_tax_code',
        'vatCodes',
        `This file uses ${String(unknownTaxCodes.length)} tax code(s) this administration does not have: ${unknownTaxCodes.map((code) => `${code.code} (${code.description})`).join(', ')}. Create them, mapped to their rubrieken, and try again — importing without them would post a year that declares no VAT.`,
        { codes: unknownTaxCodes.map((code) => code.code).join(',') },
      ),
    )
  }

  for (const dimension of dimensionsUsed.filter((entry) => !entry.exists)) {
    warnings.push(
      `${dimension.typeCode} ${dimension.valueCode} is not a dimension value here, so the lines carrying it are imported without it. Create it and import again to keep the analysis.`,
    )
  }

  const unknownContacts = contacts.filter((contact) => !contact.exists)
  if (unknownContacts.length > 0) {
    warnings.push(
      `${String(unknownContacts.length)} customer(s) or supplier(s) in this file have no contact here, so those lines are imported without a subledger link: ${unknownContacts.map((contact) => `${contact.number} (${contact.name})`).join(', ')}.`,
    )
  }

  /**
   * The tax tags, per transaction, worked out once.
   *
   * A transaction is the unit because that is where a base and its VAT line sit
   * together: nothing outside it can tell them apart.
   */
  const taxTags = new Map<XafTransaction, ReadonlyMap<string, TaxTag>>()
  for (const journal of document.journals) {
    for (const transaction of journal.transactions) {
      const resolved = taxTagsFor(transaction, knownTaxCodes)
      taxTags.set(transaction, resolved.tags)
      for (const missing of resolved.unmatched) {
        warnings.push(
          `${journal.jrnID} ${transaction.nr} states VAT of ${missing} on its base line and has no matching line for it, so the tax itself is imported untagged. Its rubriek will show the omzet and not the btw.`,
        )
      }
    }
  }

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
            line,
            line.currency === null
              ? line.desc
              : `${line.desc ?? ''} (${line.currency.curCode} ${line.currency.curAmnt.toString()} minor units)`.trim(),
            subledgerKindFor(
              JOURNAL_TYPE[journal.jrnTp],
              document.customersSuppliers.find((entry) => entry.custSupID === line.custSupID)
                ?.custSupTp ?? null,
            ),
            taxTags.get(transaction)?.get(line.nr) ?? null,
            { dimensionValues: knownDimensionValues, contactIds },
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
    vatCodes,
    dimensions: dimensionsUsed,
    contacts,
    entries,
    reconciliation,
    problems,
    warnings,
  }
}
