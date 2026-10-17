/**
 * Seed a fictional Demo BV through production posting paths (issue #48).
 *
 * Every journal line goes through `postJournalEntry`. The command is
 * idempotent: a second run finds the existing demo administration and does
 * not invent another.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildBankMatchEntry,
  buildPurchaseEntry,
  buildTrialBalance,
  DEFAULT_MATCH_OPTIONS,
  isRole,
  loadChart,
  parseBankFile,
  parseVatPeriodCode,
  planEntitySetup,
  planFiling,
  planImport,
  postJournalEntry,
  requireEmail,
  requireRole,
  suggestMatches,
  systemClock,
  taxOn,
  verifyHashChain,
  type Actor,
  type JournalLineInput,
  type PostJournalEntryCommand,
  type Role,
} from '@klopt/core'
import { eq, sql } from 'drizzle-orm'
import type { Database } from '../client.js'
import {
  contacts,
  journalEntries,
  purchaseInvoices,
  salesInvoices,
  users,
} from '../schema/index.js'
import { invoiceEntryFor, priceDraft } from '../repositories/sales.js'
import {
  withBank,
  withBankMatch,
  withBankRead,
  withLedger,
  withMembers,
  withPurchase,
  withReporting,
  withSales,
  withSetup,
  withVatFiling,
  withVatRead,
} from '../unit-of-work.js'
import {
  DEMO_ENTITY_ID,
  DEMO_ENTITY_NAME,
  DEMO_FISCAL_YEAR,
  DEMO_IBAN,
  DEMO_KVK,
  DEMO_LEGAL_NAME,
  DEMO_OPENING_BANK_MINOR,
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_USER_ID,
  DEMO_VAT,
  DEMO_YEAR_START,
} from './constants.js'
import {
  assertDemoDatasetIsFictional,
  DEMO_CONTACTS,
  DEMO_CUSTOMERS,
  DEMO_SUPPLIERS,
  entityAddress,
  planPurchases,
  planSales,
} from './dataset.js'
import { buildMt940, type Mt940Line } from './mt940.js'

const ROLE_ALIASES: Readonly<Record<string, Role>> = {
  owner: 'owner',
  eigenaar: 'owner',
  bookkeeper: 'bookkeeper',
  boekhouder: 'bookkeeper',
  accountant: 'accountant',
  auditor: 'auditor',
  controleur: 'auditor',
}

export function parseDemoRole(value: string): Role {
  const normalised = value.trim().toLowerCase()
  const aliased = ROLE_ALIASES[normalised]
  if (aliased !== undefined) return aliased
  if (isRole(value)) return value
  return requireRole(value)
}

export interface SeedDemoOptions {
  readonly inviteEmail?: string | undefined
  readonly inviteRole?: string | undefined
  /**
   * Operate on this entity id. Must already exist and be marked demo — the
   * seeder never writes into a live administration.
   */
  readonly entityId?: string | undefined
}

export interface SeedDemoResult {
  readonly entityId: string
  readonly name: string
  readonly created: boolean
  readonly seeded: boolean
  readonly alreadyPresent: boolean
  readonly invite: {
    readonly email: string
    readonly role: Role
    readonly joinedImmediately: boolean
    readonly created: boolean
  } | null
  readonly counts: {
    readonly contacts: number
    readonly customers: number
    readonly suppliers: number
    readonly salesInvoices: number
    readonly purchaseInvoices: number
    readonly journalEntries: number
    readonly bankTransactions: number
    readonly bankMatched: number
    readonly bankUnmatched: number
    readonly filedPeriods: number
  }
  readonly trialBalanceDifference: string
  readonly chainVerified: boolean
}

const SCRIPT_ACTOR: Actor = {
  kind: 'script',
  id: 'demo-seed',
  principalId: null,
}

function referenceDataDir(): string {
  const fromEnv = process.env['KLOPT_REFERENCE_DATA_DIR']
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'reference-data')
}

function loadNlMkbChart() {
  const raw: unknown = JSON.parse(
    readFileSync(join(referenceDataDir(), 'charts', 'nl-mkb.json'), 'utf8'),
  )
  return loadChart(raw)
}

function taxOf(net: bigint, taxCode: string): bigint {
  // Same half-up path sales pricing uses (`taxOn`), so purchase VAT does not
  // drift from the rate the BTW-aangifte expects within one cent per line.
  const rate =
    taxCode === 'L9' || taxCode === 'VL9' ? 900 : taxCode === 'H21' || taxCode === 'VH21' ? 2100 : 0
  return taxOn(net, rate)
}

/** Empty tax/dimension fields shared by hand-built bank match lines. */
function bareLine(
  accountNumber: string,
  amount: bigint,
  isDebit: boolean,
  description: string,
  extra: Partial<JournalLineInput> = {},
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
    taxRole: null,
    taxAmount: null,
    dimensions: [],
    subledgerKind: null,
    subledgerId: null,
    ...extra,
  }
}

/**
 * Supplier payment: Dr crediteuren (supplier subledger) / Cr bank.
 *
 * `buildBankMatchEntry` hardcodes the customer subledger, so purchase
 * settlements are built here and still posted through `postJournalEntry`.
 */
function buildSupplierPaymentEntry(request: {
  readonly entityId: string
  readonly journalCode: string
  readonly bookingDate: string
  readonly valueDate: string
  readonly bankAccountNumber: string
  readonly amount: bigint
  readonly counterpartyName: string | null
  readonly description: string
  readonly payableAccountNumber: string
  readonly contactId: string
  readonly contactNumber: string
  readonly contactName: string
  readonly invoiceNumber: string
}): PostJournalEntryCommand {
  const magnitude = request.amount < 0n ? -request.amount : request.amount
  return {
    entityId: request.entityId,
    journalCode: request.journalCode,
    bookingDate: request.bookingDate,
    documentDate: request.valueDate,
    description: `Betaling ${request.invoiceNumber}`,
    sourceDocumentRef: request.invoiceNumber,
    reversesEntryId: null,
    lines: [
      bareLine(
        request.bankAccountNumber,
        magnitude,
        false,
        request.counterpartyName ?? request.description.slice(0, 120),
      ),
      bareLine(
        request.payableAccountNumber,
        magnitude,
        true,
        `${request.contactNumber} ${request.contactName} · ${request.invoiceNumber}`,
        { subledgerKind: 'supplier', subledgerId: request.contactId },
      ),
    ],
  }
}

function dueDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function ensureOwnerUser(database: Database): Promise<string> {
  const [existing] = await database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_OWNER_EMAIL))
    .limit(1)
  if (existing !== undefined) return existing.id

  // Mirrors better-auth's drizzle adapter insert into `klopt.users`
  // (`packages/db/src/schema/auth.ts`, `packages/db/src/auth.ts`): same columns
  // (id, name, email, emailVerified). The seeder cannot call sign-up without a
  // real OTP delivery path, so it writes the same row shape the auth layer would.
  await database.insert(users).values({
    id: DEMO_OWNER_USER_ID,
    name: 'Demo Seed Owner',
    email: DEMO_OWNER_EMAIL,
    emailVerified: true,
  })
  return DEMO_OWNER_USER_ID
}

async function contactCount(database: Database, entityId: string): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(contacts)
    .where(eq(contacts.entityId, entityId))
  return row?.count ?? 0
}

async function entryCount(database: Database, entityId: string): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.entityId, entityId))
  return row?.count ?? 0
}

/**
 * Seed (or re-affirm) the singleton demo administration.
 *
 * Refuses when `--entity` points at books that are not marked demo. Never
 * creates a second demo administration.
 */
export async function seedDemo(
  database: Database,
  options: SeedDemoOptions = {},
): Promise<SeedDemoResult> {
  assertDemoDatasetIsFictional()

  const ownerUserId = await ensureOwnerUser(database)
  const chart = loadNlMkbChart()

  let entityId: string
  let created = false
  let name: string

  if (options.entityId !== undefined && options.entityId !== '') {
    const found = await withSetup(database, (setup) => setup.findEntity(options.entityId!))
    if (found === null) {
      throw new Error(`No administration ${options.entityId}.`)
    }
    if (!found.isDemo) {
      throw new Error(
        `Administration ${options.entityId} is not marked demo. The seeder refuses to write into live books.`,
      )
    }
    entityId = found.id
    name = found.name
  } else {
    const existing = await withSetup(database, (setup) => setup.findDemoEntity())
    if (existing !== null) {
      entityId = existing.id
      name = existing.name
    } else {
      const plan = planEntitySetup(
        {
          name: DEMO_ENTITY_NAME,
          legalName: DEMO_LEGAL_NAME,
          kvkNumber: DEMO_KVK,
          vatNumber: DEMO_VAT,
          firstFiscalYear: DEMO_FISCAL_YEAR,
          functionalCurrency: 'EUR',
          fiscalYearStartMonth: 1,
        },
        chart,
      )

      const provisioned = await withSetup(database, (setup) =>
        setup.provision({
          entityId: DEMO_ENTITY_ID,
          ownerUserId,
          plan,
          isDemo: true,
        }),
      )
      entityId = provisioned.entityId
      name = provisioned.name
      created = provisioned.created

      await withSetup(database, (setup) => setup.updateEntity(entityId, entityAddress()))
    }
  }

  // Contacts are the first durable master-data rows the populate step writes.
  // An interrupted run that only posted the opening memoriaal is treated as
  // not-yet-seeded: the opening uses a fixed idempotency key and will replay.
  const alreadySeeded = (await contactCount(database, entityId)) > 0
  let seeded = false

  if (!alreadySeeded) {
    await populateDemo(database, entityId, ownerUserId)
    seeded = true
  }

  let invite: SeedDemoResult['invite'] = null
  if (options.inviteEmail !== undefined && options.inviteEmail !== '') {
    const email = requireEmail(options.inviteEmail)
    const role = parseDemoRole(options.inviteRole ?? 'accountant')
    const result = await withMembers(database, (members) =>
      members.invite({
        entityId,
        email,
        role,
        actor: {
          kind: 'script',
          id: ownerUserId,
          principalId: null,
          requestId: null,
          ip: null,
        },
      }),
    )
    invite = {
      email: result.email,
      role: result.role,
      joinedImmediately: result.joinedImmediately,
      created: result.created,
    }
  }

  const verification = await verifyDemo(database, entityId)

  return {
    entityId,
    name,
    created,
    seeded,
    alreadyPresent: alreadySeeded,
    invite,
    ...verification,
  }
}

async function populateDemo(
  database: Database,
  entityId: string,
  ownerUserId: string,
): Promise<void> {
  // Opening balances: bank funded by share capital, through the memoriaal.
  await withLedger(database, async (ledger) => {
    await postJournalEntry(
      {
        entityId,
        journalCode: 'MEM',
        bookingDate: DEMO_YEAR_START,
        documentDate: DEMO_YEAR_START,
        description: 'Demo openingsbalans',
        sourceDocumentRef: 'demo-seed:opening',
        reversesEntryId: null,
        lines: [
          {
            accountNumber: '1100',
            description: 'Bank',
            debit: DEMO_OPENING_BANK_MINOR,
            credit: 0n,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxRole: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
          {
            accountNumber: '0500',
            description: 'Aandelenkapitaal',
            debit: 0n,
            credit: DEMO_OPENING_BANK_MINOR,
            currency: null,
            exchangeRate: null,
            exchangeRateSource: null,
            taxCode: null,
            taxRole: null,
            taxAmount: null,
            dimensions: [],
            subledgerKind: null,
            subledgerId: null,
          },
        ],
      },
      SCRIPT_ACTOR,
      {
        dryRun: false,
        idempotencyKey: `demo-seed:${entityId}:opening`,
        requestId: null,
        ip: null,
        mayPostToSoftClosedPeriod: false,
      },
      { repository: ledger, clock: systemClock },
    )
  })

  for (const contact of DEMO_CONTACTS) {
    await withSales(database, async ({ sales }) => {
      await sales.createContact({
        entityId,
        number: contact.number,
        name: contact.name,
        legalName: contact.name,
        isCustomer: contact.isCustomer,
        isSupplier: contact.isSupplier,
        email: contact.email,
        vatNumber: contact.vatNumber,
        kvkNumber: contact.kvkNumber,
        countryCode: 'NL',
        paymentTermsDays: 30,
        iban: contact.iban,
        address: {
          street: contact.street,
          houseNumber: contact.houseNumber,
          postalCode: contact.postalCode,
          city: contact.city,
          countryCode: 'NL',
        },
      })
    })
  }

  const salesPlan = planSales()
  const issuedSales: {
    readonly id: string
    readonly number: string
    readonly total: bigint
    readonly issueDate: string
    readonly contactNumber: string
    readonly contactName: string
    readonly contactIban: string
    readonly expectPayment: boolean
  }[] = []

  for (const [index, sale] of salesPlan.entries()) {
    const customer = DEMO_CUSTOMERS.find((item) => item.number === sale.contactNumber)!
    const issued = await withSales(database, async ({ sales, ledger }) => {
      const context = await sales.loadContext(entityId, sale.contactNumber)
      if (context === null) throw new Error(`No contact ${sale.contactNumber}`)

      const request = {
        entityId,
        contactNumber: sale.contactNumber,
        kind: 'invoice' as const,
        issueDate: sale.issueDate,
        reference: null,
        buyerReference: null,
        notes: null,
        creditsInvoiceId: null,
        lines: [
          {
            description: sale.description,
            quantity: sale.quantity,
            unitCode: 'C62',
            unitPrice: sale.unitPrice,
            revenueAccountNumber: '8000',
            taxCode: sale.taxCode,
          },
        ],
      }
      const priced = priceDraft(request, context)
      const draftId = await sales.createDraft(request, context, priced)
      const number = await sales.allocateInvoiceNumber(entityId, DEMO_FISCAL_YEAR, '')
      const command = invoiceEntryFor({
        entityId,
        journalCode: 'VRK',
        issueDate: sale.issueDate,
        invoiceNumber: number,
        receivableAccountNumber: '1300',
        isCreditNote: false,
        reference: null,
        context,
        priced,
      })
      const posted = await postJournalEntry(
        command,
        SCRIPT_ACTOR,
        {
          dryRun: false,
          idempotencyKey: `demo-seed:${entityId}:sale:${String(index)}`,
          requestId: null,
          ip: null,
          mayPostToSoftClosedPeriod: false,
        },
        { repository: ledger, clock: systemClock },
      )
      await sales.markIssued({ invoiceId: draftId, number, journalEntryId: posted.entry.id })
      return { id: draftId, number, total: priced.total }
    })

    issuedSales.push({
      ...issued,
      issueDate: sale.issueDate,
      contactNumber: sale.contactNumber,
      contactName: customer.name,
      contactIban: customer.iban,
      expectPayment: sale.expectPayment,
    })
  }

  const purchasePlan = planPurchases()
  const bookedPurchases: {
    readonly id: string
    readonly total: bigint
    readonly invoiceDate: string
    readonly contactId: string
    readonly contactNumber: string
    readonly contactName: string
    readonly contactIban: string
    readonly accountNumber: string
    readonly payableAccountNumber: string
    readonly supplierInvoiceNumber: string
  }[] = []

  for (const [index, purchase] of purchasePlan.entries()) {
    const supplier = DEMO_SUPPLIERS.find((item) => item.number === purchase.contactNumber)!
    const tax = taxOf(purchase.netMinorUnits, purchase.taxCode)
    const total = purchase.netMinorUnits + tax

    const booked = await withPurchase(database, async ({ purchase: repo, ledger }) => {
      const context = await repo.loadContext(entityId, purchase.contactNumber)
      if (context === null) throw new Error(`No contact ${purchase.contactNumber}`)
      if (context.payableAccountNumber === null) {
        throw new Error(`No payable account for ${purchase.contactNumber}`)
      }

      const invoice = {
        supplierInvoiceNumber: purchase.supplierInvoiceNumber,
        kind: 'invoice' as const,
        invoiceDate: purchase.invoiceDate,
        dueDate: dueDate(purchase.invoiceDate, 30),
        currency: 'EUR',
        netMinorUnits: purchase.netMinorUnits,
        taxMinorUnits: tax,
        totalMinorUnits: total,
        lines: [
          {
            description: purchase.description,
            accountNumber: purchase.accountNumber,
            taxCode: purchase.taxCode,
            netMinorUnits: purchase.netMinorUnits,
            taxMinorUnits: tax,
          },
        ],
      }

      const draftId = await repo.createDraft({
        entityId,
        contactId: context.contact.id,
        invoice,
        paymentReference: purchase.supplierInvoiceNumber,
        notes: null,
        taxCodeIdByCode: context.taxCodeIdByCode,
        accountIdByNumber: context.accountIdByNumber,
      })

      if (context.payableAccountNumber === null) {
        throw new Error('Chart has no payable control account.')
      }

      const command = buildPurchaseEntry(
        {
          entityId,
          journalCode: 'INK',
          bookingDate: purchase.invoiceDate,
          invoice,
          contactNumber: purchase.contactNumber,
          contactName: context.contact.name,
          contactId: context.contact.id,
          payableAccountNumber: context.payableAccountNumber,
        },
        context.rules,
        (code) => context.taxAccountByCode.get(code) ?? null,
      )

      const posted = await postJournalEntry(
        command,
        SCRIPT_ACTOR,
        {
          dryRun: false,
          idempotencyKey: `demo-seed:${entityId}:purchase:${String(index)}`,
          requestId: null,
          ip: null,
          mayPostToSoftClosedPeriod: false,
        },
        { repository: ledger, clock: systemClock },
      )

      await repo.markBooked({
        entityId,
        invoiceId: draftId,
        journalEntryId: posted.entry.id,
        actorId: ownerUserId,
      })

      return {
        id: draftId,
        total,
        contactId: context.contact.id,
        payableAccountNumber: context.payableAccountNumber,
      }
    })

    // Attachments omitted on purpose: the seeder has no DocumentStore, and a
    // documents row without a stored blob would break when opened. Prefer no
    // attachment over a fake PDF.
    bookedPurchases.push({
      id: booked.id,
      total: booked.total,
      invoiceDate: purchase.invoiceDate,
      contactId: booked.contactId,
      contactNumber: purchase.contactNumber,
      contactName: supplier.name,
      contactIban: supplier.iban,
      accountNumber: purchase.accountNumber,
      payableAccountNumber: booked.payableAccountNumber,
      supplierInvoiceNumber: purchase.supplierInvoiceNumber,
    })
  }

  const bankAccountId = await withBank(database, async (bank) => {
    const ledgerAccountId = await bank.ledgerAccountIdFor(entityId, '1100')
    if (ledgerAccountId === null) throw new Error('No ledger account 1100.')
    return bank.createAccount({
      entityId,
      iban: DEMO_IBAN,
      currency: 'EUR',
      name: 'Demo bankrekening (demo)',
      ledgerAccountId,
    })
  })

  // ~150 bank lines: paid sales, paid purchases, plus unmatched noise.
  const mtLines: Mt940Line[] = []
  let ref = 1

  for (const sale of issuedSales) {
    if (!sale.expectPayment) continue
    const payDate = dueDate(sale.issueDate, 14)
    mtLines.push({
      bookingDate: payDate <= '2025-12-31' ? payDate : '2025-12-28',
      amount: sale.total,
      counterpartyName: sale.contactName,
      counterpartyIban: sale.contactIban,
      remittance: `Factuur ${sale.number}`,
      reference: `SAL${String(ref).padStart(4, '0')}`,
    })
    ref += 1
  }

  for (const purchase of bookedPurchases.slice(0, 35)) {
    const payDate = dueDate(purchase.invoiceDate, 10)
    mtLines.push({
      bookingDate: payDate <= '2025-12-31' ? payDate : '2025-12-27',
      amount: -purchase.total,
      counterpartyName: purchase.contactName,
      counterpartyIban: purchase.contactIban,
      remittance: purchase.supplierInvoiceNumber,
      reference: `PUR${String(ref).padStart(4, '0')}`,
    })
    ref += 1
  }

  // Unmatched noise so the work queue has items (~15 lines).
  for (let i = 0; i < 15; i += 1) {
    const day = 40 + i * 18
    const iso = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
    mtLines.push({
      bookingDate: iso,
      amount: -BigInt(1_250 + i * 175),
      counterpartyName: `Open post ${String(i + 1)} (demo)`,
      counterpartyIban: DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length]!.iban,
      remittance: `Ongeboekte demo-kosten ${String(i + 1)}`,
      reference: `OPN${String(ref).padStart(4, '0')}`,
    })
    ref += 1
  }

  // Pad toward ~150 with small matched-as-expense transfers if needed.
  while (mtLines.length < 150) {
    const i = mtLines.length
    const day = 20 + (i % 300)
    const iso = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
    mtLines.push({
      bookingDate: iso,
      amount: -BigInt(500 + (i % 40) * 25),
      counterpartyName: DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length]!.name,
      counterpartyIban: DEMO_SUPPLIERS[i % DEMO_SUPPLIERS.length]!.iban,
      remittance: `Periodieke demo-kosten ${String(i)}`,
      reference: `PAD${String(ref).padStart(4, '0')}`,
    })
    ref += 1
  }

  mtLines.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate))

  const { content } = buildMt940({
    iban: DEMO_IBAN,
    openingBalance: DEMO_OPENING_BANK_MINOR,
    lines: mtLines,
  })
  const sourceHash = createHash('sha256').update(content, 'utf8').digest('hex')

  await withBank(database, async (bank) => {
    const account = await bank.findAccount(entityId, bankAccountId)
    if (account === null) throw new Error('Demo bank account missing.')
    const statements = parseBankFile(content, 'mt940')
    const plan = planImport(statements, {
      accountIban: account.iban,
      currency: account.currency,
      lastSequenceNumber: account.lastSequenceNumber,
    })
    const errors = plan.problems.filter((problem) => problem.severity === 'error')
    if (errors.length > 0) {
      throw new Error(`Demo MT940 refused: ${errors.map((item) => item.message).join('; ')}`)
    }
    await bank.applyImport({ entityId, bankAccountId, plan, sourceHash })
  })

  // Match customer receipts that quote an invoice number; allocate supplier
  // payments to purchase invoices; leave the open-noise lines unmatched.
  const saleByNumber = new Map(issuedSales.map((sale) => [sale.number, sale]))
  const purchaseByNumber = new Map(
    bookedPurchases.map((purchase) => [purchase.supplierInvoiceNumber, purchase]),
  )

  const transactions = await withBankRead(database, (bank) =>
    bank.listTransactions({
      entityId,
      bankAccountId,
      status: 'unmatched',
      limit: 1000,
    }),
  )

  let matchIndex = 0
  for (const row of transactions) {
    const description = row.description ?? ''
    const invoiceMatch = /Factuur\s+(\d{4}-\d{4})/.exec(description)
    if (invoiceMatch !== null) {
      const sale = saleByNumber.get(invoiceMatch[1]!)
      if (sale === undefined) continue

      await withBankMatch(database, async ({ bank, ledger }) => {
        const transaction = await bank.findTransaction(entityId, row.id)
        if (transaction === null || transaction.bankLedgerAccountNumber === null) return

        const candidates = await bank.matchCandidates(entityId)
        const suggestions = suggestMatches(transaction.entry, candidates, [], {
          ...DEFAULT_MATCH_OPTIONS,
          chargesAccountNumber: '4900',
        })
        const suggestion = suggestions[0]
        const resolved =
          suggestion !== undefined && suggestion.allocations.length > 0
            ? suggestion.allocations.map((allocation) => {
                const contactId = candidates.find(
                  (item) => item.invoiceId === allocation.invoiceId,
                )?.contactId
                if (contactId === undefined) return null
                return {
                  invoiceId: allocation.invoiceId,
                  invoiceNumber: allocation.number,
                  amount: allocation.amount,
                  contactNumber: sale.contactNumber,
                  contactName: sale.contactName,
                  contactId,
                }
              })
            : [
                (() => {
                  const contactId = candidates.find((item) => item.invoiceId === sale.id)?.contactId
                  if (contactId === undefined) return null
                  return {
                    invoiceId: sale.id,
                    invoiceNumber: sale.number,
                    amount: sale.total,
                    contactNumber: sale.contactNumber,
                    contactName: sale.contactName,
                    contactId,
                  }
                })(),
              ]

        const allocations = resolved.filter((item) => item !== null)
        if (allocations.length === 0) return

        const command = buildBankMatchEntry({
          entityId,
          journalCode: 'BNK',
          bookingDate: transaction.bookingDate,
          valueDate: transaction.valueDate,
          bankAccountNumber: transaction.bankLedgerAccountNumber,
          amount: transaction.amount,
          currency: transaction.currency,
          counterpartyName: transaction.counterpartyName,
          description: transaction.description,
          receivableAccountNumber: '1300',
          allocations,
          remainderAccountNumber: null,
          chargesAmount: 0n,
          chargesAccountNumber: null,
        })

        const posted = await postJournalEntry(
          command,
          SCRIPT_ACTOR,
          {
            dryRun: false,
            idempotencyKey: `demo-seed:${entityId}:match:sale:${String(matchIndex)}`,
            requestId: null,
            ip: null,
            mayPostToSoftClosedPeriod: false,
          },
          { repository: ledger, clock: systemClock },
        )

        await bank.recordMatch({
          entityId,
          transactionId: row.id,
          journalEntryId: posted.entry.id,
          allocations: allocations.map((allocation) => ({
            invoiceId: allocation.invoiceId,
            amount: allocation.amount,
          })),
        })
      })
      matchIndex += 1
      continue
    }

    const purchaseMatch = /INK-DEMO-\d{4}-\d{4}/.exec(description)
    if (purchaseMatch !== null) {
      const purchaseNumber = purchaseMatch[0]
      const purchase = purchaseByNumber.get(purchaseNumber)
      if (purchase === undefined) continue

      await withBankMatch(database, async ({ bank, ledger, purchase: purchases }) => {
        const transaction = await bank.findTransaction(entityId, row.id)
        if (transaction === null || transaction.bankLedgerAccountNumber === null) return

        const command = buildSupplierPaymentEntry({
          entityId,
          journalCode: 'BNK',
          bookingDate: transaction.bookingDate,
          valueDate: transaction.valueDate,
          bankAccountNumber: transaction.bankLedgerAccountNumber,
          amount: transaction.amount,
          counterpartyName: transaction.counterpartyName,
          description: transaction.description,
          payableAccountNumber: purchase.payableAccountNumber,
          contactId: purchase.contactId,
          contactNumber: purchase.contactNumber,
          contactName: purchase.contactName,
          invoiceNumber: purchase.supplierInvoiceNumber,
        })

        const posted = await postJournalEntry(
          command,
          SCRIPT_ACTOR,
          {
            dryRun: false,
            idempotencyKey: `demo-seed:${entityId}:match:purchase:${String(matchIndex)}`,
            requestId: null,
            ip: null,
            mayPostToSoftClosedPeriod: false,
          },
          { repository: ledger, clock: systemClock },
        )

        // Sales allocations live on bank_transaction_allocations; purchase
        // settlements use purchase_invoice_allocations via recordBankPayment.
        await bank.recordMatch({
          entityId,
          transactionId: row.id,
          journalEntryId: posted.entry.id,
          allocations: [],
        })
        await purchases.recordBankPayment({
          entityId,
          transactionId: row.id,
          invoiceId: purchase.id,
          amount: purchase.total,
        })
      })
      matchIndex += 1
      continue
    }

    if (description.includes('Periodieke demo-kosten')) {
      await withBankMatch(database, async ({ bank, ledger }) => {
        const transaction = await bank.findTransaction(entityId, row.id)
        if (transaction === null || transaction.bankLedgerAccountNumber === null) return

        const command = buildBankMatchEntry({
          entityId,
          journalCode: 'BNK',
          bookingDate: transaction.bookingDate,
          valueDate: transaction.valueDate,
          bankAccountNumber: transaction.bankLedgerAccountNumber,
          amount: transaction.amount,
          currency: transaction.currency,
          counterpartyName: transaction.counterpartyName,
          description: transaction.description,
          receivableAccountNumber: '1600',
          allocations: [],
          remainderAccountNumber: '4900',
          chargesAmount: 0n,
          chargesAccountNumber: null,
        })

        const posted = await postJournalEntry(
          command,
          SCRIPT_ACTOR,
          {
            dryRun: false,
            idempotencyKey: `demo-seed:${entityId}:match:exp:${String(matchIndex)}`,
            requestId: null,
            ip: null,
            mayPostToSoftClosedPeriod: false,
          },
          { repository: ledger, clock: systemClock },
        )

        await bank.recordMatch({
          entityId,
          transactionId: row.id,
          journalEntryId: posted.entry.id,
          allocations: [],
        })
      })
      matchIndex += 1
    }
  }

  // File Q1 without accepting warnings — the return must already reconcile.
  await withVatFiling(database, async ({ vat }) => {
    const period = parseVatPeriodCode(`${DEMO_FISCAL_YEAR}-Q1`)
    const vatReturn = await vat.buildReturn({
      entityId,
      from: period.from,
      to: period.to,
    })
    const plan = planFiling({
      vatReturn,
      kind: period.kind,
      existing: null,
      acceptWarnings: false,
      acceptedReason: null,
      transport: 'manual',
    })
    await vat.recordFiling({
      entityId,
      vatReturn,
      kind: plan.kind,
      sequence: plan.sequence,
      supersedesId: plan.supersedesId,
      filedBy: ownerUserId,
      transport: plan.transport,
      transportReference: 'DEMO-FILE-Q1',
      acceptedWarningsBy: null,
      acceptedWarningsReason: null,
    })
    await vat.lockPeriods(entityId, period.from, period.to)
  })
}

async function verifyDemo(database: Database, entityId: string) {
  const trial = await withReporting(database, async (reporting) => {
    const rows = await reporting.trialBalanceRows({
      entityId,
      fiscalYearCode: DEMO_FISCAL_YEAR,
      fromPeriod: 1,
      toPeriod: 12,
      currency: 'EUR',
    })
    return buildTrialBalance(
      {
        entityId,
        currency: 'EUR',
        fiscalYearCode: DEMO_FISCAL_YEAR,
        fromPeriod: 1,
        toPeriod: 12,
        includeZeroRows: false,
      },
      rows,
    )
  })

  const chain = await withLedger(database, async (ledger) => {
    const entries = await ledger.loadChain(entityId)
    return verifyHashChain(entries)
  })

  const [contactStats] = await database
    .select({
      contacts: sql<number>`count(*)::int`,
      customers: sql<number>`count(*) filter (where ${contacts.isCustomer})::int`,
      suppliers: sql<number>`count(*) filter (where ${contacts.isSupplier})::int`,
    })
    .from(contacts)
    .where(eq(contacts.entityId, entityId))

  const [salesCount] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(salesInvoices)
    .where(eq(salesInvoices.entityId, entityId))

  const [purchaseCount] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseInvoices)
    .where(eq(purchaseInvoices.entityId, entityId))

  const journalEntriesCount = await entryCount(database, entityId)

  const bankStats = await withBankRead(database, async (bank) => {
    const accounts = await bank.listAccounts(entityId)
    const bankAccountId = accounts[0]?.id
    if (bankAccountId === undefined) {
      return { bankTransactions: 0, bankMatched: 0, bankUnmatched: 0 }
    }
    const all = await bank.listTransactions({
      entityId,
      bankAccountId,
      status: null,
      limit: 1000,
    })
    return {
      bankTransactions: all.length,
      bankMatched: all.filter((row) => row.status === 'matched').length,
      bankUnmatched: all.filter((row) => row.status === 'unmatched').length,
    }
  })

  const filedPeriods = await withVatRead(
    database,
    async (vat) => (await vat.filings(entityId)).length,
  )

  // Suggested matches must exist for at least one unmatched line when any remain.
  if (bankStats.bankUnmatched > 0) {
    await withBankRead(database, async (bank) => {
      const accounts = await bank.listAccounts(entityId)
      const bankAccountId = accounts[0]!.id
      const unmatched = await bank.listTransactions({
        entityId,
        bankAccountId,
        status: 'unmatched',
        limit: 20,
      })
      const candidates = await bank.matchCandidates(entityId)
      const rules = await bank.listRules(entityId)
      for (const row of unmatched) {
        const transaction = await bank.findTransaction(entityId, row.id)
        if (transaction === null) continue
        suggestMatches(transaction.entry, candidates, rules, DEFAULT_MATCH_OPTIONS)
      }
    })
  }

  return {
    counts: {
      contacts: contactStats?.contacts ?? 0,
      customers: contactStats?.customers ?? 0,
      suppliers: contactStats?.suppliers ?? 0,
      salesInvoices: salesCount?.count ?? 0,
      purchaseInvoices: purchaseCount?.count ?? 0,
      journalEntries: journalEntriesCount,
      ...bankStats,
      filedPeriods,
    },
    trialBalanceDifference: trial.difference.toString(),
    chainVerified: chain.verified,
  }
}
