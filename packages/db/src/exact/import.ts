import {
  postJournalEntry,
  systemClock,
  uuidv7,
  type Actor,
  type ExactImportPlan,
  type ExactPlannedOpenItem,
  type JournalLineInput,
} from '@klopt/core'
import { accounts } from '../schema/ledger.js'
import type { Database, Transaction } from '../client.js'
import { DrizzleLedgerRepository } from '../repositories/ledger.js'
import { PurchaseRepository } from '../repositories/purchase.js'
import { SalesRepository } from '../repositories/sales.js'

/**
 * Committing what the dry run described (spec 13).
 *
 * In `@klopt/db` rather than in a handler because it needs the ledger, sales
 * and purchase repositories in **one transaction** — a migration that half
 * happened is worse than one that did not — and because a worker running an
 * overnight import must reach the same code as the button.
 *
 * ## What is imported, and what an open item actually is
 *
 * The chart of accounts and the relations are ordinary inserts. The open items
 * are the part worth explaining.
 *
 * An outstanding invoice is two facts: a **document** somebody owes on, which
 * dunning and bank matching read out of `sales_invoices` and
 * `purchase_invoices`, and a **balance** on the debtors or creditors account,
 * which the trial balance reads out of the journal. Import one without the
 * other and either the ageing is empty while account 1300 says thirty thousand,
 * or the reverse. So both are written, from the same list, in the same
 * transaction.
 *
 * ## One entry, not one per invoice
 *
 * Every open item is a line on a single opening entry — a line per invoice on
 * the control account, and one counter-line for the total. That is how a
 * bookkeeper does an overname, and it means the whole migration reverses as one
 * thing if it turns out to be wrong.
 *
 * The counter-account is the caller's decision and there is no default. It is
 * usually an equity or suspense account, and guessing at it would silently
 * misstate either equity or a cost. A migration that puts thirty thousand euro
 * somewhere nobody chose is not a convenience.
 *
 * ## The dates
 *
 * The entry is booked on one `openingDate`. The invoices keep their own issue
 * and due dates, because those drive the ageing and the dunning clock, and an
 * invoice that was late in November should still look late.
 *
 * The entry's document date is the opening date too, not the invoice date: a
 * document date after its booking date is a ledger violation, and a migration
 * necessarily books old documents on a new date.
 */

export interface ExactCommitRequest {
  readonly entityId: string
  readonly plan: ExactImportPlan
  readonly actor: Actor
  readonly idempotencyKey: string
  readonly requestId: string | null
  readonly ip: string | null
  readonly mayPostToSoftClosedPeriod: boolean
  /** Where the other side of every open item goes. No default, deliberately. */
  readonly openingBalanceAccount: string
  /** The date the opening entry is booked on. */
  readonly openingDate: string
  /** Which memoriaal the opening entry lands in. */
  readonly journalCode: string
  /** The debtors control account, for the receivable side. */
  readonly receivableAccount: string
  /** The creditors control account, for the payable side. */
  readonly payableAccount: string
}

export interface ExactCommitResult {
  readonly accountsCreated: number
  readonly contactsCreated: number
  readonly openItemsImported: number
  // `Count`, not `receivablesImported`: the money lint is right that a field
  // called `receivables` typed `number` is almost always an amount, and these
  // two are the exception rather than a reason to weaken the rule.
  readonly receivableCount: number
  readonly payableCount: number
  /** Null when the plan had no open items to post. */
  readonly openingEntryId: string | null
  /** Rows that were already here, named so a re-run is explicable. */
  readonly skipped: readonly string[]
}

/** Positive amount plus a side, which is how the rest of the system carries sign. */
function signed(item: ExactPlannedOpenItem): {
  readonly amount: bigint
  readonly kind: 'invoice' | 'credit_note'
} {
  return item.outstanding < 0n
    ? { amount: -item.outstanding, kind: 'credit_note' }
    : { amount: item.outstanding, kind: 'invoice' }
}

/**
 * One transaction for the whole migration.
 *
 * The chart, the relations, the opening entry and every invoice, or none of
 * them. A half-imported administration is worse than one that failed: the
 * failure is visible and the half is not.
 */
export async function commitExactImport(
  database: Database,
  request: ExactCommitRequest,
): Promise<ExactCommitResult> {
  return database.transaction((tx) => runImport(tx, request))
}

async function runImport(tx: Transaction, request: ExactCommitRequest): Promise<ExactCommitResult> {
  const { plan, entityId } = request
  const sales = new SalesRepository(tx)
  const purchase = new PurchaseRepository(tx)
  const ledger = new DrizzleLedgerRepository(tx)
  const skipped: string[] = []

  // --- the chart ------------------------------------------------------------

  const newAccounts = plan.accounts.filter((account) => !account.exists)
  if (newAccounts.length > 0) {
    await tx.insert(accounts).values(
      newAccounts.map((account) => ({
        id: uuidv7(),
        entityId,
        number: account.number,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        // Exact's `ReportingCode` is sometimes an RGS code and sometimes the
        // customer's own scheme. Importing it as one would put an unverified
        // mapping into the auditfile, so it is left for the RGS screen.
        rgsCode: null,
        isBlocked: account.isBlocked,
        defaultTaxCode: account.defaultTaxCode,
      })),
    )
  }

  // --- the relations --------------------------------------------------------

  const contactIdByNumber = new Map<string, string>([
    ...(await sales.contactIdsByNumber(
      entityId,
      plan.contacts.map((contact) => contact.number),
    )),
  ])

  let contactsCreated = 0
  for (const contact of plan.contacts) {
    if (contactIdByNumber.has(contact.number)) {
      skipped.push(`contact ${contact.number}`)
      continue
    }

    const id = await sales.createContact({
      entityId,
      number: contact.number,
      name: contact.name,
      isCustomer: contact.isCustomer,
      isSupplier: contact.isSupplier,
      email: contact.email,
      phone: contact.phone,
      vatNumber: contact.vatNumber,
      kvkNumber: contact.kvkNumber,
      countryCode: contact.countryCode,
      paymentTermsDays: contact.paymentTermsDays,
      address:
        contact.address === null
          ? null
          : {
              // Exact keeps the whole visit address in free-text lines rather
              // than a street and a number, so it arrives as one street line.
              // Splitting it on a guess would be worse than not splitting it.
              street: contact.address.line1,
              houseNumber: null,
              postalCode: contact.address.postcode,
              city: contact.address.city,
              countryCode: contact.address.countryCode,
            },
    })
    contactIdByNumber.set(contact.number, id)
    contactsCreated += 1
  }

  // --- the open items -------------------------------------------------------

  if (plan.openItems.length === 0) {
    return {
      accountsCreated: newAccounts.length,
      contactsCreated,
      openItemsImported: 0,
      receivableCount: 0,
      payableCount: 0,
      openingEntryId: null,
      skipped,
    }
  }

  const receivables = plan.openItems.filter((item) => item.side === 'receivable')
  const payables = plan.openItems.filter((item) => item.side === 'payable')

  // One line per invoice on the control account, so the entry itself is the
  // subledger and the balance is explicable line by line rather than as one
  // total nobody can take apart.
  const lines: JournalLineInput[] = []
  const blank = {
    currency: null,
    exchangeRate: null,
    exchangeRateSource: null,
    // No tax on an opening entry: the VAT on these invoices was declared in the
    // old system, in the period it belonged to. Tagging it again here would
    // claim it twice.
    taxCode: null,
    taxRole: null,
    taxAmount: null,
    dimensions: [],
  } as const

  let openingTotal = 0n

  for (const item of receivables) {
    const { amount, kind } = signed(item)
    const contactId = contactIdByNumber.get(item.contactNumber) ?? null
    // A credit note owed to a customer is a credit on the debtors account.
    const debit = kind === 'invoice' ? amount : 0n
    const credit = kind === 'invoice' ? 0n : amount
    openingTotal += debit - credit

    lines.push({
      ...blank,
      accountNumber: request.receivableAccount,
      description: `${item.contactName} ${item.documentNumber}`,
      debit,
      credit,
      subledgerKind: 'customer',
      subledgerId: contactId,
    })
  }

  for (const item of payables) {
    const { amount, kind } = signed(item)
    const contactId = contactIdByNumber.get(item.contactNumber) ?? null
    const credit = kind === 'invoice' ? amount : 0n
    const debit = kind === 'invoice' ? 0n : amount
    openingTotal += debit - credit

    lines.push({
      ...blank,
      accountNumber: request.payableAccount,
      description: `${item.contactName} ${item.documentNumber}`,
      debit,
      credit,
      subledgerKind: 'supplier',
      subledgerId: contactId,
    })
  }

  // The counter-line balances whatever the two sides came to together, so the
  // entry balances by construction rather than by hoping the source did.
  lines.push({
    ...blank,
    accountNumber: request.openingBalanceAccount,
    description: 'Beginbalans openstaande posten',
    debit: openingTotal < 0n ? -openingTotal : 0n,
    credit: openingTotal > 0n ? openingTotal : 0n,
    subledgerKind: null,
    subledgerId: null,
  })

  const posted = await postJournalEntry(
    {
      entityId,
      journalCode: request.journalCode,
      bookingDate: request.openingDate,
      documentDate: request.openingDate,
      description: `Beginbalans uit Exact Online (${plan.division.description})`,
      sourceDocumentRef: `exact:${String(plan.division.code)}`,
      reversesEntryId: null,
      lines,
    },
    request.actor,
    {
      dryRun: false,
      idempotencyKey: `${request.idempotencyKey}:opening`,
      requestId: request.requestId,
      ip: request.ip,
      mayPostToSoftClosedPeriod: request.mayPostToSoftClosedPeriod,
    },
    { repository: ledger, clock: systemClock },
  )

  const note = `Overgenomen uit Exact Online, administratie ${String(plan.division.code)}.`

  let receivableCount = 0
  for (const item of receivables) {
    const contactId = contactIdByNumber.get(item.contactNumber)
    if (contactId === undefined) {
      skipped.push(`receivable ${item.documentNumber}`)
      continue
    }
    const { amount, kind } = signed(item)

    await sales.createImportedInvoice({
      entityId,
      contactId,
      number: item.documentNumber,
      issueDate: item.issuedOn,
      dueDate: item.dueOn,
      currency: item.currency,
      outstanding: amount,
      kind,
      reference: item.theirReference,
      notes: note,
      journalEntryId: posted.entry.id,
    })
    receivableCount += 1
  }

  let payableCount = 0
  for (const item of payables) {
    const contactId = contactIdByNumber.get(item.contactNumber)
    if (contactId === undefined) {
      skipped.push(`payable ${item.documentNumber}`)
      continue
    }
    const { amount, kind } = signed(item)

    await purchase.createImportedInvoice({
      entityId,
      contactId,
      // Their reference where Exact has one, because that is the number the
      // supplier will quote when they chase it.
      supplierInvoiceNumber: item.theirReference ?? item.documentNumber,
      invoiceDate: item.issuedOn,
      dueDate: item.dueOn,
      currency: item.currency,
      outstanding: amount,
      kind,
      notes: note,
      journalEntryId: posted.entry.id,
      // The person who ran the import booked it. An imported liability with no
      // name against it would be the one booking nobody is accountable for.
      bookedBy: request.actor.id,
    })
    payableCount += 1
  }

  return {
    accountsCreated: newAccounts.length,
    contactsCreated,
    openItemsImported: receivableCount + payableCount,
    receivableCount,
    payableCount,
    openingEntryId: posted.entry.id,
    skipped,
  }
}
