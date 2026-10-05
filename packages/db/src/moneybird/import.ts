import {
  postJournalEntry,
  systemClock,
  uuidv7,
  type Actor,
  type MoneybirdImportPlan,
  type MoneybirdPlannedEntry,
} from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import { accounts, bankAccounts, bankTransactions } from '../schema/index.js'
import type { Database, Transaction } from '../client.js'
import { DrizzleLedgerRepository } from '../repositories/ledger.js'
import { PurchaseRepository } from '../repositories/purchase.js'
import { SalesRepository } from '../repositories/sales.js'
import { MoneybirdImportRepository } from '../repositories/moneybird-import.js'

/**
 * Committing a Moneybird plan (issue #32).
 *
 * Every journal line goes through `postJournalEntry`. Accounts and contacts
 * are ordinary inserts. External Moneybird ids are remembered so a re-run
 * posts nothing twice.
 */

export interface MoneybirdCommitRequest {
  readonly entityId: string
  readonly plan: MoneybirdImportPlan
  readonly actor: Actor
  readonly idempotencyKey: string
  readonly requestId: string | null
  readonly ip: string | null
  readonly mayPostToSoftClosedPeriod: boolean
}

export interface MoneybirdCommitResult {
  readonly accountsCreated: number
  readonly contactsCreated: number
  readonly entriesPosted: number
  readonly entriesReplayed: number
  readonly entriesSkipped: number
  readonly bankAccountsCreated: number
  readonly bankTransactionsCreated: number
  readonly invoicesImported: number
  readonly skipped: readonly string[]
}

export async function commitMoneybirdImport(
  database: Database,
  request: MoneybirdCommitRequest,
): Promise<MoneybirdCommitResult> {
  return database.transaction((tx) => runImport(tx, request))
}

async function runImport(
  tx: Transaction,
  request: MoneybirdCommitRequest,
): Promise<MoneybirdCommitResult> {
  const { plan, entityId } = request
  const sales = new SalesRepository(tx)
  const purchase = new PurchaseRepository(tx)
  const ledger = new DrizzleLedgerRepository(tx)
  const imported = new MoneybirdImportRepository(tx)
  const skipped: string[] = []

  const newAccounts = plan.accounts.filter((account) => !account.exists && account.number !== '')
  if (newAccounts.length > 0) {
    await tx.insert(accounts).values(
      newAccounts.map((account) => ({
        id: uuidv7(),
        entityId,
        number: account.number,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        rgsCode: account.rgsCode,
        isBlocked: false,
        defaultTaxCode: null,
      })),
    )
  }

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
      paymentTermsDays: 30,
      iban: contact.iban,
      address:
        contact.address === null
          ? null
          : {
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

  const accountRows = await tx
    .select({ id: accounts.id, number: accounts.number })
    .from(accounts)
    .where(eq(accounts.entityId, entityId))
  const accountIds = new Map(accountRows.map((row) => [row.number, row.id]))

  let bankAccountsCreated = 0
  const bankAccountIdByMoneybird = new Map<string, string>()
  for (const financial of plan.financialAccounts) {
    const iban = financial.identifier ?? `MB-${financial.moneybirdId}`
    const ledgerAccountId =
      financial.ledgerAccountNumber === null
        ? null
        : (accountIds.get(financial.ledgerAccountNumber) ?? null)
    const existing = await tx
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(eq(bankAccounts.entityId, entityId), eq(bankAccounts.iban, iban)))
      .limit(1)
    if (existing.length > 0) {
      bankAccountIdByMoneybird.set(financial.moneybirdId, existing[0]!.id)
      continue
    }
    const id = uuidv7()
    await tx.insert(bankAccounts).values({
      id,
      entityId,
      iban,
      currency: plan.administration.currency ?? 'EUR',
      name: financial.name,
      ledgerAccountId,
    })
    bankAccountIdByMoneybird.set(financial.moneybirdId, id)
    bankAccountsCreated += 1
  }

  let entriesPosted = 0
  let entriesReplayed = 0
  let entriesSkipped = 0
  let invoicesImported = 0
  let bankTransactionsCreated = 0
  const note = `Overgenomen uit Moneybird, administratie ${plan.administration.name}.`

  for (const entry of plan.entries) {
    if (entry.exists) {
      entriesSkipped += 1
      skipped.push(entry.externalId)
      continue
    }

    const lines = entry.lines.map((item) => {
      if (item.subledgerKind === null || entry.contactNumber === null) return item
      const contactId = contactIdByNumber.get(entry.contactNumber) ?? null
      return { ...item, subledgerId: contactId }
    })

    const posted = await postJournalEntry(
      {
        entityId,
        journalCode: entry.journalCode,
        bookingDate: entry.bookingDate,
        documentDate: entry.documentDate,
        description: entry.description,
        sourceDocumentRef: entry.sourceDocumentRef,
        reversesEntryId: null,
        lines,
      },
      request.actor,
      {
        dryRun: false,
        idempotencyKey: `${request.idempotencyKey}:${entry.externalId}`,
        requestId: request.requestId,
        ip: request.ip,
        mayPostToSoftClosedPeriod: request.mayPostToSoftClosedPeriod,
      },
      { repository: ledger, clock: systemClock },
    )

    if (posted.replayed) entriesReplayed += 1
    else entriesPosted += 1

    await imported.remember({
      entityId,
      externalId: entry.externalId,
      kind: entry.kind,
      journalEntryId: posted.entry.id,
    })

    await rememberDocument(
      sales,
      purchase,
      contactIdByNumber,
      request.actor.id,
      entityId,
      entry,
      posted.entry.id,
      note,
    )

    if (entry.kind === 'bank_mutation') {
      const bankAccountId =
        (entry.financialAccountId === null
          ? null
          : bankAccountIdByMoneybird.get(entry.financialAccountId)) ??
        [...bankAccountIdByMoneybird.values()][0] ??
        null
      if (bankAccountId !== null) {
        const inserted = await tx
          .insert(bankTransactions)
          .values({
            id: uuidv7(),
            entityId,
            bankAccountId,
            statementId: null,
            dedupeKey: `moneybird:${entry.externalId}`,
            amountMinorUnits: entry.outstanding,
            currency: entry.currency,
            bookingDate: entry.bookingDate,
            valueDate: entry.bookingDate,
            bankReference: entry.documentNumber,
            endToEndId: null,
            counterpartyName: null,
            counterpartyIban: null,
            description: entry.description,
            remittanceReference: null,
            transactionCode: null,
            raw: entry.sourceDocumentRef,
            status: entry.matched ? 'matched' : 'unmatched',
            journalEntryId: posted.entry.id,
            matchedAt: entry.matched ? new Date() : null,
          })
          .onConflictDoNothing({
            target: [bankTransactions.bankAccountId, bankTransactions.dedupeKey],
          })
          .returning({ id: bankTransactions.id })
        if (inserted.length > 0) bankTransactionsCreated += 1
      }
    }

    if (
      entry.kind === 'sales_invoice' ||
      entry.kind === 'credit_note' ||
      entry.kind === 'purchase_invoice' ||
      entry.kind === 'receipt'
    ) {
      invoicesImported += 1
    }
  }

  return {
    accountsCreated: newAccounts.length,
    contactsCreated,
    entriesPosted,
    entriesReplayed,
    entriesSkipped,
    bankAccountsCreated,
    bankTransactionsCreated,
    invoicesImported,
    skipped,
  }
}

async function rememberDocument(
  sales: SalesRepository,
  purchase: PurchaseRepository,
  contactIdByNumber: ReadonlyMap<string, string>,
  actorId: string,
  entityId: string,
  entry: MoneybirdPlannedEntry,
  journalEntryId: string,
  note: string,
): Promise<void> {
  const outstanding = entry.outstanding < 0n ? -entry.outstanding : entry.outstanding
  if (entry.kind === 'sales_invoice' || entry.kind === 'credit_note') {
    if (entry.contactNumber === null) return
    const contactId = contactIdByNumber.get(entry.contactNumber)
    if (contactId === undefined) return
    await sales.createImportedInvoice({
      entityId,
      contactId,
      number: entry.documentNumber,
      issueDate: entry.documentDate,
      dueDate: entry.documentDate,
      currency: entry.currency,
      outstanding,
      kind: entry.kind === 'credit_note' ? 'credit_note' : 'invoice',
      reference: entry.documentNumber,
      notes: note,
      journalEntryId,
    })
    return
  }
  if (entry.kind === 'purchase_invoice' || entry.kind === 'receipt') {
    if (entry.contactNumber === null) return
    const contactId = contactIdByNumber.get(entry.contactNumber)
    if (contactId === undefined) return
    await purchase.createImportedInvoice({
      entityId,
      contactId,
      supplierInvoiceNumber: entry.documentNumber,
      invoiceDate: entry.documentDate,
      dueDate: entry.documentDate,
      currency: entry.currency,
      outstanding,
      kind: 'invoice',
      notes: note,
      journalEntryId,
      bookedBy: actorId,
    })
  }
}
