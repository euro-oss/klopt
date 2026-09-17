import { z } from 'zod'
import { PURCHASE_INVOICE_STATUSES } from '@klopt/core'

/**
 * One schema per concept, three consumers: the REST routes, the server
 * functions and the forms (spec 11).
 *
 * Money crosses the boundary as a decimal string, never a number. The
 * `klopt/no-number-money` lint rule fails the build on `z.number()` for a
 * money-shaped field, so this is enforced rather than remembered.
 */

/**
 * Minor units as a string, parsed to bigint. Never through Number.
 *
 * The `.default()` goes *before* the `.transform()` deliberately: in Zod 4 a
 * default short-circuits the pipeline and is returned as the parsed output, so
 * `.transform(BigInt).default('0')` yields the string '0' and the domain then
 * tries to add a string to a bigint.
 *
 * The `.meta({ id })` here and below is not decoration. It is what makes the
 * generated OpenAPI document say `MinorUnits` in ninety places instead of
 * repeating a regex, so that the one thing an integrator most needs to notice
 * about this API — money is a string of minor units, never a number — has a
 * name they can look up. See ADR 0043.
 */
const minorUnitString = z
  .string()
  .regex(/^\d+$/, 'Amounts are unsigned integer minor units, as a string.')
  .meta({
    id: 'MinorUnits',
    description:
      'An amount in unsigned integer minor units, as a decimal string: "124950" is ' +
      '€1249,50. Never a number — a float cannot hold a cent exactly, and a ledger ' +
      'that is out by a cent is out. The sign lives in the debit/credit distinction.',
  })

export const minorUnits = minorUnitString.transform((value) => BigInt(value))

const minorUnitsWithDefault = minorUnitString.default('0').transform((value) => BigInt(value))

const nullableMinorUnits = minorUnitString
  .nullable()
  .default(null)
  .transform((value) => (value === null ? null : BigInt(value)))

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.')
  .meta({ id: 'IsoDate', description: 'A calendar date, YYYY-MM-DD. No time, no zone.' })

export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO 4217, three uppercase letters.')
  .meta({ id: 'CurrencyCode', description: 'ISO 4217, three uppercase letters.' })

export const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'A positive decimal, as a string.')
  .meta({
    id: 'DecimalString',
    description: 'A positive decimal as a string, for rates and ratios. Not money.',
  })

export const dimensionAssignment = z
  .object({
    typeCode: z.string().min(1),
    valueCode: z.string().min(1),
  })
  .meta({ id: 'DimensionAssignment' })

export const journalLineInput = z
  .object({
    accountNumber: z.string().min(1),
    description: z.string().nullable().default(null),
    debit: minorUnitsWithDefault,
    credit: minorUnitsWithDefault,
    currency: currencyCode.nullable().default(null),
    exchangeRate: decimalString.nullable().default(null),
    exchangeRateSource: z.string().nullable().default(null),
    taxCode: z.string().nullable().default(null),
    /**
     * Whether this line is the taxable base or the tax on it (spec 7.2).
     *
     * Required alongside a tax code rather than defaulted, because the
     * BTW-aangifte is derived from the journal: a default would put somebody
     * else's turnover in rubriek 1a's VAT box and the mistake would surface as
     * a reconciliation finding a quarter later instead of a 422 now.
     */
    taxRole: z.enum(['base', 'tax']).nullable().default(null),
    taxAmount: nullableMinorUnits,
    dimensions: z.array(dimensionAssignment).default([]),
    subledgerKind: z.enum(['customer', 'supplier', 'asset', 'project']).nullable().default(null),
    subledgerId: z.uuid().nullable().default(null),
  })
  .refine((line) => (line.taxCode === null) === (line.taxRole === null), {
    error: 'A tax code needs a tax role, and a tax role needs a tax code: set both or neither.',
    path: ['taxRole'],
  })

export const postJournalEntryBody = z.object({
  journalCode: z.string().min(1),
  bookingDate: isoDate,
  documentDate: isoDate,
  description: z.string().min(1),
  sourceDocumentRef: z.string().nullable().default(null),
  reversesEntryId: z.uuid().nullable().default(null),
  lines: z.array(journalLineInput).min(2, 'An entry has at least two lines.'),
  /** Validate and return what would be created, commit nothing (spec 10.2). */
  dryRun: z.boolean().default(false),
})

export const reverseJournalEntryBody = z.object({
  bookingDate: isoDate,
  description: z.string().nullable().default(null),
  dryRun: z.boolean().default(false),
})

export const trialBalanceQuery = z.object({
  fiscalYear: z.string().min(1),
  fromPeriod: z.coerce.number().int().min(1).max(13).default(1),
  toPeriod: z.coerce.number().int().min(1).max(13).default(13),
  currency: currencyCode.default('EUR'),
  includeZeroRows: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export const listEntriesQuery = z.object({
  cursor: z.string().regex(/^\d+$/).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export type PostJournalEntryBody = z.infer<typeof postJournalEntryBody>
export type ReverseJournalEntryBody = z.infer<typeof reverseJournalEntryBody>

export const statementQuery = z.object({
  fiscalYear: z.string().min(1),
  fromPeriod: z.coerce.number().int().min(1).max(13).default(1),
  toPeriod: z.coerce.number().int().min(1).max(13).default(13),
  currency: currencyCode.default('EUR'),
})

export const rgsCoverageQuery = z.object({
  currency: currencyCode.default('EUR'),
  /** Narrows "unused codes" to the profile the entity is, e.g. `ZZP` or `BV`. */
  applicableFlag: z.string().min(1).nullable().default(null),
})

export const rgsMappingsBody = z.object({
  mappings: z
    .array(
      z.object({
        accountNumber: z.string().min(1),
        rgsCode: z.string().min(1).nullable(),
      }),
    )
    .min(1),
  dryRun: z.boolean().default(false),
})

export const rgsUpgradeQuery = z.object({
  toVersion: z.string().min(1),
})

export const auditFileQuery = z.object({
  fiscalYear: z.string().min(1),
  fromPeriod: z.coerce.number().int().min(1).max(13).nullable().default(null),
  toPeriod: z.coerce.number().int().min(1).max(13).nullable().default(null),
})

export const auditFileImportBody = z.object({
  xml: z.string().min(1),
  dryRun: z.boolean().default(true),
})

export const closeYearBody = z.object({
  fiscalYear: z.string().min(1),
  resultAccountNumber: z.string().min(1),
  journalCode: z.string().min(1).default('MEM'),
  carryForward: z.boolean().default(true),
  dryRun: z.boolean().default(false),
})

/**
 * Incremental sync, on the lists whose rows change in place (ADR 0053).
 *
 * A filter, not a subscription. It answers "what has moved since I last
 * looked" well enough to keep a mirror warm, and `GET /api/v1/events` is the
 * feed with the ordering guarantee — the two are for different jobs and the
 * document says which is which.
 */
export const updatedSince = z.iso
  .datetime({ offset: true })
  .nullable()
  .default(null)
  .describe('RFC 3339. Only rows whose updatedAt is at or after this.')

/** Sales (M1). */

export const contactsQuery = z.object({
  updatedSince,
  customersOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export const createContactBody = z.object({
  number: z.string().min(1).max(35),
  name: z.string().min(1),
  /** BT-44, the registered name. Defaults to `name`, which is usually right. */
  legalName: z.string().nullable().default(null),
  isCustomer: z.boolean().default(true),
  isSupplier: z.boolean().default(false),
  email: z.email().nullable().default(null),
  phone: z.string().nullable().default(null),
  vatNumber: z.string().nullable().default(null),
  kvkNumber: z.string().nullable().default(null),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Two-letter ISO 3166.')
    .default('NL'),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  /** BT-49. Defaults to the KvK number in scheme 0106 when it is not given. */
  electronicAddress: z.string().nullable().default(null),
  electronicAddressScheme: z.string().nullable().default(null),
  /**
   * Where a payment run sends the money.
   *
   * Not validated here beyond emptiness: `isValidIban` in @klopt/core checks
   * the mod-97 when a payment batch is built, and refusing a contact because
   * somebody typed the IBAN from memory would be refusing the contact for the
   * wrong reason.
   */
  iban: z.string().nullable().default(null),
  /**
   * The postal address. Optional, because a contact is worth recording before
   * you know it — but EN 16931 makes it mandatory on an invoice, so an invoice
   * to a customer without one is refused with BR-10 rather than sent.
   */
  address: z
    .object({
      street: z.string().nullable().default(null),
      houseNumber: z.string().nullable().default(null),
      postalCode: z.string().nullable().default(null),
      city: z.string().nullable().default(null),
      countryCode: z
        .string()
        .regex(/^[A-Za-z]{2}$/, 'Two-letter ISO 3166.')
        .transform((value) => value.toUpperCase())
        .default('NL'),
    })
    .nullable()
    .default(null),
})

/** A decimal string. Quantity is not money, but it is not a float either. */
const quantity = z.string().regex(/^\d+(\.\d{1,6})?$/, 'A positive decimal, up to six places.')

export const invoiceLineInput = z.object({
  description: z.string().min(1),
  quantity: quantity.default('1'),
  unitCode: z.string().min(1).default('EA'),
  unitPrice: minorUnits,
  revenueAccountNumber: z.string().min(1),
  taxCode: z.string().min(1),
})

export const draftInvoiceBody = z.object({
  contactNumber: z.string().min(1),
  kind: z.enum(['invoice', 'credit_note']).default('invoice'),
  issueDate: isoDate,
  reference: z.string().nullable().default(null),
  buyerReference: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  creditsInvoiceId: z.uuid().nullable().default(null),
  lines: z.array(invoiceLineInput).min(1, 'An invoice needs a line.'),
})

export const issueInvoiceBody = z.object({
  journalCode: z.string().min(1).default('VRK'),
  /** Debiteuren. The control account the invoice total lands on. */
  receivableAccountNumber: z.string().min(1).default('1300'),
})

export const invoicesQuery = z.object({
  updatedSince,
  status: z.enum(['draft', 'issued', 'cancelled']).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export const overdueQuery = z.object({
  asOf: isoDate.default(() => new Date().toISOString().slice(0, 10)),
})

export type CreateContactBody = z.infer<typeof createContactBody>
export type DraftInvoiceBody = z.infer<typeof draftInvoiceBody>
export type IssueInvoiceBody = z.infer<typeof issueInvoiceBody>

/**
 * Provisioning (principle 4). Everything optional here has a defensible default
 * so that the shortest possible setup — a name — produces working books.
 */
export const createEntityBody = z.object({
  name: z.string().min(1, 'An administration needs a name.').max(200),
  legalName: z.string().nullable().default(null),
  kvkNumber: z.string().nullable().default(null),
  vatNumber: z.string().nullable().default(null),
  chartCode: z.string().min(1).default('nl-mkb'),
  functionalCurrency: z
    .string()
    .regex(/^[A-Za-z]{3}$/, 'Use a three-letter ISO 4217 code.')
    .default('EUR'),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12).default(1),
  firstFiscalYear: z
    .string()
    .regex(/^\d{4}$/, 'A book year is labelled by its four-digit start year.')
    .default(() => String(new Date().getUTCFullYear())),
  vatRounding: z.enum(['per_invoice', 'per_line']).default('per_invoice'),
})

export const createFiscalYearBody = z.object({
  code: z.string().regex(/^\d{4}$/, 'A book year is labelled by its four-digit start year.'),
})

export type CreateEntityBody = z.infer<typeof createEntityBody>
export type CreateFiscalYearBody = z.infer<typeof createFiscalYearBody>

/**
 * Membership (spec 4). The role is validated in the domain rather than here, so
 * that a bad role comes back as `unknown_role` with the list of real ones
 * rather than as a schema enum mismatch.
 */
export const inviteMemberBody = z.object({
  email: z.string().min(3),
  role: z.string().min(1),
})

export const setMemberRoleBody = z.object({
  role: z.string().min(1),
})

export type InviteMemberBody = z.infer<typeof inviteMemberBody>
export type SetMemberRoleBody = z.infer<typeof setMemberRoleBody>

/**
 * The administration's own details (spec 7.5).
 *
 * Everything optional, and everything nullable: these are the fields a UBL
 * invoice needs and the setup form was right not to ask for. `undefined` means
 * "leave it alone" and `null` means "clear it", which is the distinction a
 * PATCH exists to make.
 */
const nullableText = z
  .string()
  .trim()
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))

export const updateEntityBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: z.string().trim().min(1).max(200).optional(),
  kvkNumber: nullableText.optional(),
  vatNumber: nullableText.optional(),
  street: nullableText.optional(),
  houseNumber: nullableText.optional(),
  postalCode: nullableText.optional(),
  city: nullableText.optional(),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'Use a two-letter ISO 3166-1 country code.')
    .transform((value) => value.toUpperCase())
    .optional(),
  email: nullableText.optional(),
  phone: nullableText.optional(),
  website: nullableText.optional(),
  iban: nullableText.optional(),
  bic: nullableText.optional(),
  electronicAddress: nullableText.optional(),
  /** 0106 is a KvK number, 0190 an OIN, 9944 a Dutch VAT number. */
  electronicAddressScheme: nullableText.optional(),
  vatRounding: z.enum(['per_invoice', 'per_line']).optional(),
  /**
   * Where bank charges are split off to (spec 7.4).
   *
   * Validated against the chart in the handler rather than here, because "is
   * 4901 an account you have" is a question about the database.
   */
  bankChargesAccountNumber: nullableText.optional(),
})

export type UpdateEntityBody = z.infer<typeof updateEntityBody>

/**
 * Correcting a contact.
 *
 * Every field optional, because a patch says what changed and a screen that had
 * to send all fifteen back would overwrite whatever somebody else fixed in the
 * meantime. `null` clears a field; absent leaves it.
 *
 * The address is a whole or nothing: it is one thing on a document, and a
 * half-updated address is worse than either version of it.
 */
export const updateContactBody = z.object({
  number: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  legalName: nullableText.optional(),
  isCustomer: z.boolean().optional(),
  isSupplier: z.boolean().optional(),
  isBlocked: z.boolean().optional(),
  email: nullableText.optional(),
  phone: nullableText.optional(),
  vatNumber: nullableText.optional(),
  kvkNumber: nullableText.optional(),
  countryCode: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'Two-letter ISO 3166.')
    .transform((value) => value.toUpperCase())
    .optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  electronicAddress: nullableText.optional(),
  electronicAddressScheme: nullableText.optional(),
  iban: nullableText.optional(),
  notes: nullableText.optional(),
  address: z
    .object({
      street: nullableText,
      houseNumber: nullableText,
      postalCode: nullableText,
      city: nullableText,
      countryCode: z
        .string()
        .regex(/^[A-Za-z]{2}$/, 'Two-letter ISO 3166.')
        .transform((value) => value.toUpperCase())
        .default('NL'),
    })
    .nullable()
    .optional(),
})

export type UpdateContactBody = z.infer<typeof updateContactBody>

export const invoicePdfQuery = z.object({
  /**
   * Attach the UBL to the PDF (spec 7.5's fallback transport). Off by default:
   * a PDF for a customer who wants paper should not be refused because of a
   * Peppol code-list rule, and attaching the XML is what makes the rules apply.
   */
  embedUbl: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

/**
 * Sending. `embedUbl` decides whether the attached PDF carries the XML inside
 * it as well; the XML is attached separately regardless, because that is the
 * file a recipient's software looks for.
 */
export const sendInvoiceBody = z.object({
  /** Overrides the contact's address for this send only. */
  to: z.string().nullable().default(null),
  embedUbl: z.boolean().default(true),
})

export const dunningQuery = z.object({
  asOf: isoDate.default(() => new Date().toISOString().slice(0, 10)),
})

export const sendReminderBody = z.object({
  /** Refuse unless the caller expected this stage. Guards a stale screen. */
  expectedStage: z.coerce.number().int().min(1).max(9).nullable().default(null),
  asOf: isoDate.default(() => new Date().toISOString().slice(0, 10)),
})

export type SendInvoiceBody = z.infer<typeof sendInvoiceBody>
export type SendReminderBody = z.infer<typeof sendReminderBody>

/** Banking (spec 7.4). */
export const createBankAccountBody = z.object({
  iban: z
    .string()
    .trim()
    .min(5)
    .transform((value) => value.replace(/\s/g, '').toUpperCase()),
  name: z.string().trim().min(1),
  currency: currencyCode.default('EUR'),
  /** The ledger account this posts to. 1100 in the shipped chart. */
  ledgerAccountNumber: z.string().nullable().default(null),
})

/**
 * How to read a bank's CSV (spec 7.4).
 *
 * A column is named by its header, or by a zero-based index when the file has
 * no header. Nullable everywhere a bank might not have the column at all,
 * because most of them do not have most of them.
 */
export const csvMappingSchema = z.object({
  delimiter: z.string().min(1).max(1).nullable().default(null),
  hasHeader: z.boolean().default(true),
  bookingDate: z.string().min(1),
  valueDate: z.string().nullable().default(null),
  amount: z.string().min(1),
  amountStyle: z.enum(['signed', 'debit_credit_columns', 'indicator']).default('signed'),
  creditAmount: z.string().nullable().default(null),
  indicator: z.string().nullable().default(null),
  creditIndicator: z.string().nullable().default(null),
  counterpartyName: z.string().nullable().default(null),
  counterpartyIban: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  reference: z.string().nullable().default(null),
  balanceAfter: z.string().nullable().default(null),
  dateFormat: z
    .enum(['yyyy-MM-dd', 'yyyy/MM/dd', 'yyyyMMdd', 'dd-MM-yyyy', 'dd/MM/yyyy', 'dd.MM.yyyy'])
    .default('yyyy-MM-dd'),
  decimalSeparator: z.enum([',', '.']).default(','),
  currency: currencyCode.default('EUR'),
})

export const importStatementBody = z.object({
  bankAccountId: z.uuid(),
  /** The file, as text. CAMT is XML, MT940 a telex dump, CSV is CSV. */
  content: z.string().min(1, 'The file is empty.'),
  format: z.enum(['camt.053', 'mt940', 'csv']).nullable().default(null),
  /**
   * How to read it, for a CSV. Omitted on the first import of a new bank, in
   * which case a dry run comes back with a guess to check rather than an error.
   * The account's stored mapping is used when there is one.
   */
  mapping: csvMappingSchema.nullable().default(null),
  /** Remember the mapping on the account, so the next import does not ask. */
  saveMapping: z.boolean().default(true),
  /** A dry run reports what would happen and writes nothing. */
  dryRun: z.boolean().default(false),
})

export const transactionsQuery = z.object({
  updatedSince,
  bankAccountId: z.uuid().nullable().default(null),
  status: z.enum(['unmatched', 'matched', 'ignored']).nullable().default(null),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
})

export type CreateBankAccountBody = z.infer<typeof createBankAccountBody>
export type ImportStatementBody = z.infer<typeof importStatementBody>

/** Confirming a match (spec 7.4). */
export const confirmMatchBody = z.object({
  allocations: z
    .array(
      z.object({
        invoiceId: z.uuid(),
        /** Unsigned minor units. The direction is the transaction's. */
        amount: minorUnits,
      }),
    )
    .default([]),
  /** Where anything not allocated goes. */
  accountNumber: z.string().nullable().default(null),
  chargesAmount: minorUnitsWithDefault,
  chargesAccountNumber: z.string().nullable().default(null),
  /** The control account the allocations clear. Debiteuren in the shipped chart. */
  receivableAccountNumber: z.string().min(1).default('1300'),
  journalCode: z.string().min(1).default('BNK'),
  /**
   * Remember this choice for next time (spec 7.4). Off for a line that quoted
   * its invoice number: the next payment will quote its own, so there is
   * nothing to learn.
   */
  learn: z.boolean().default(true),
  /** The rule that was applied, so its confidence grows when it was right. */
  ruleId: z.uuid().nullable().default(null),
})

export const setRuleActiveBody = z.object({
  isActive: z.boolean(),
})

export type ConfirmMatchBody = z.infer<typeof confirmMatchBody>

export type CsvMappingBody = z.infer<typeof csvMappingSchema>

/** Outbound payments (spec 7.4). */
export const createBatchBody = z.object({
  reference: z.string().trim().min(1).max(35, 'A bank message id is at most 35 characters.'),
  bankAccountId: z.uuid(),
  requestedExecutionDate: isoDate,
})

export const addInstructionBody = z.object({
  endToEndId: z.string().trim().min(1).max(35),
  contactNumber: z.string().nullable().default(null),
  creditorName: z.string().trim().min(1).max(70),
  creditorIban: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, '').toUpperCase()),
  creditorBic: z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === '' ? null : value.toUpperCase())),
  amount: minorUnits,
  currency: currencyCode.default('EUR'),
  remittanceInformation: z.string().trim().max(140).default(''),
  remittanceReference: z.string().trim().max(35).nullable().default(null),
})

export const transitionBatchBody = z.object({
  action: z.enum(['submit', 'approve', 'reject', 'reopen', 'export']),
  reason: z.string().trim().max(500).nullable().default(null),
})

export type CreateBatchBody = z.infer<typeof createBatchBody>
export type AddInstructionBody = z.infer<typeof addInstructionBody>
export type TransitionBatchBody = z.infer<typeof transitionBatchBody>

/**
 * The BTW-aangifte (spec 7.2).
 *
 * `acceptWarnings` is a deliberate speed bump. A return with warnings can be
 * filed, because a hand-typed correction is legitimate, but only by somebody
 * who says so and says why — and the reason is stored with the filing, because
 * it is part of the evidence for the period.
 */
/**
 * Filters on the purchase invoice list.
 *
 * This route used to read both straight off the URL with no schema at all, so
 * `status` reached the repository as whatever string was typed and the query
 * appeared nowhere in the OpenAPI document. Found by the response conformance
 * suite, which could not call the handler without knowing what to pass it.
 */
export const listPurchaseInvoicesQuery = z.object({
  updatedSince,
  status: z.enum(PURCHASE_INVOICE_STATUSES).nullable().default(null),
  openOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export const listVatPeriodsQuery = z.object({
  /**
   * Defaults to this year, which is what the route did by hand before the
   * schema existed. A VAT screen opened with no year means "the current one".
   */
  year: z.coerce
    .number()
    .int()
    .min(1900)
    .max(2999)
    .default(() => new Date().getUTCFullYear()),
})

export const fileVatReturnBody = z
  .object({
    /** `2026-Q1`, `2026-03` or `2026`. */
    period: z.string().min(4),
    transport: z.enum(['digipoort', 'sbr_provider', 'manual']),
    /** Digipoort's message id, or the reference from Mijn Belastingdienst. */
    transportReference: z.string().nullable().default(null),
    acceptWarnings: z.boolean().default(false),
    acceptedReason: z.string().nullable().default(null),
  })
  .refine((body) => !body.acceptWarnings || (body.acceptedReason ?? '').trim() !== '', {
    error: 'Accepting a warning needs a reason: it is stored as part of the filing.',
    path: ['acceptedReason'],
  })

export type ContactsQuery = z.infer<typeof contactsQuery>
export type InvoicesQuery = z.infer<typeof invoicesQuery>
export type ListPurchaseInvoicesQuery = z.infer<typeof listPurchaseInvoicesQuery>
export type TransactionsQuery = z.infer<typeof transactionsQuery>
export type ListVatPeriodsQuery = z.infer<typeof listVatPeriodsQuery>
export type FileVatReturnBody = z.infer<typeof fileVatReturnBody>

/**
 * VAT numbers to check. A list rather than one, because the ICP screen's whole
 * job is "check all of these", and a hundred sequential round trips to VIES is
 * a worse idea than one request that fans out.
 */
export const checkVatNumbersBody = z.object({
  vatNumbers: z.array(z.string().min(4)).min(1).max(50),
})

export type CheckVatNumbersBody = z.infer<typeof checkVatNumbersBody>

/**
 * A supplier's invoice, as captured.
 *
 * The totals are required rather than derived, and that is the point: on a
 * purchase invoice the supplier is the authority on every figure, so the
 * document's own net, VAT and total are what get recorded. The checks in
 * `@klopt/core`'s purchase module then verify them against the lines and
 * against our tax codes, and say what disagrees — see ADR 0025.
 */
export const purchaseInvoiceLineInput = z.object({
  description: z.string().min(1),
  accountNumber: z.string().min(1),
  taxCode: z.string().min(1),
  net: minorUnits,
  tax: minorUnitsWithDefault,
})

export const capturePurchaseInvoiceBody = z.object({
  contactNumber: z.string().min(1),
  supplierInvoiceNumber: z.string().min(1).max(64),
  kind: z.enum(['invoice', 'credit_note']).default('invoice'),
  invoiceDate: isoDate,
  dueDate: isoDate,
  currency: currencyCode.default('EUR'),
  net: minorUnits,
  tax: minorUnitsWithDefault,
  total: minorUnits,
  paymentReference: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  lines: z.array(purchaseInvoiceLineInput).min(1, 'An invoice needs at least one line.'),
})

/**
 * Booking a captured invoice.
 *
 * `bookingDate` is optional and defaults to the invoice's own date, which is
 * where the liability and the deductible VAT belong. An override exists for the
 * January invoice that arrives in April, after the period has been declared.
 */
export const bookPurchaseInvoiceBody = z.object({
  bookingDate: isoDate.nullable().default(null),
})

export const transitionPurchaseInvoiceBody = z.object({
  action: z.enum(['approve', 'dispute', 'resolve', 'cancel']),
  reason: z.string().nullable().default(null),
})

export const creditorAgeingQuery = z.object({
  asOf: isoDate,
})

export type BookPurchaseInvoiceBody = z.infer<typeof bookPurchaseInvoiceBody>
export type CapturePurchaseInvoiceBody = z.infer<typeof capturePurchaseInvoiceBody>
export type TransitionPurchaseInvoiceBody = z.infer<typeof transitionPurchaseInvoiceBody>
export type CreditorAgeingQuery = z.infer<typeof creditorAgeingQuery>

/**
 * Turning an inbox arrival into a draft.
 *
 * The supplier and the coding can be overridden, because the parse suggests and
 * a human decides. The *amounts* cannot: those are the document's, and a field
 * that let somebody change them here would be a field for making the books
 * disagree with the paper.
 */
export const draftFromInboxBody = z.object({
  contactNumber: z.string().min(1).nullable().default(null),
  lines: z
    .array(
      z.object({
        accountNumber: z.string().min(1).optional(),
        taxCode: z.string().min(1).optional(),
      }),
    )
    .optional(),
})

export const discardInboxItemBody = z.object({
  reason: z.string().min(1, 'Say why. The next person has to know.'),
})

export const inboxQuery = z.object({
  state: z.enum(['new', 'drafted', 'discarded']).optional(),
})

export type DraftFromInboxBody = z.infer<typeof draftFromInboxBody>
export type DiscardInboxItemBody = z.infer<typeof discardInboxItemBody>
export type InboxQuery = z.infer<typeof inboxQuery>

/**
 * Configuring somewhere documents arrive from (spec 6).
 *
 * The secret is separate from the rest of the configuration, in the body as it
 * is in the table, so that "show me my settings" and "give me the password"
 * stay two different requests.
 */
export const addInboundSourceBody = z
  .object({
    kind: z.enum(['maildir', 'imap', 'peppol']),
    name: z.string().trim().min(1).max(80),
    /** A drop directory. */
    directory: nullableText.optional(),
    /** A mailbox. */
    host: nullableText.optional(),
    port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
    secure: z.boolean().optional(),
    user: nullableText.optional(),
    mailbox: nullableText.optional(),
    processedMailbox: nullableText.optional(),
    /** Stored encrypted, never returned. */
    password: nullableText.optional(),
  })
  .superRefine((value, context) => {
    // Checked here rather than at the first poll, because a mailbox that
    // silently never runs is the failure nobody notices for a month.
    if (value.kind === 'maildir' && (value.directory ?? '') === '') {
      context.addIssue({
        code: 'custom',
        path: ['directory'],
        message: 'A drop directory needs a path.',
      })
    }
    if (value.kind === 'imap') {
      if ((value.host ?? '') === '') {
        context.addIssue({ code: 'custom', path: ['host'], message: 'A mailbox needs a server.' })
      }
      if ((value.user ?? '') === '') {
        context.addIssue({ code: 'custom', path: ['user'], message: 'A mailbox needs a user.' })
      }
      if ((value.password ?? '') === '') {
        context.addIssue({
          code: 'custom',
          path: ['password'],
          message: 'A mailbox needs a password.',
        })
      }
    }
  })

export type AddInboundSourceBody = z.infer<typeof addInboundSourceBody>

/**
 * Reading the audit log (spec 7.6).
 *
 * `until` is exclusive so a day is `from=2026-03-01&until=2026-03-02` and
 * nobody has to think about whether 23:59:59.999 is inside it.
 */
export const auditLogQuery = z.object({
  from: z.string().trim().min(4).optional(),
  until: z.string().trim().min(4).optional(),
  resourceType: z.string().trim().min(1).optional(),
  resourceId: z.string().trim().min(1).optional(),
  actorId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
})

export const auditLogExportQuery = z.object({
  from: z.string().trim().min(4).optional(),
  until: z.string().trim().min(4).optional(),
  /**
   * JSON Lines by default: `before` and `after` are arbitrary objects, and CSV
   * flattens them into a quoted blob nobody can read. CSV exists because an
   * inspector who asks for a spreadsheet gets one.
   */
  format: z.enum(['jsonl', 'csv']).default('jsonl'),
})

export type AuditLogQuery = z.infer<typeof auditLogQuery>
export type AuditLogExportQuery = z.infer<typeof auditLogExportQuery>

/** The bewaarplicht (spec 7.6). */
export const retentionQuery = z.object({
  /** Defaults to today. Settable so a preview can be run against a future date. */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd.')
    .optional(),
})

export const setLegalHoldBody = z
  .object({
    /** The whole administration, or named documents. */
    scope: z.enum(['entity', 'documents']),
    held: z.boolean(),
    documentIds: z.array(z.uuid()).default([]),
    reason: nullableText.optional().default(null),
  })
  .superRefine((value, context) => {
    if (value.scope === 'documents' && value.documentIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['documentIds'],
        message: 'Say which documents.',
      })
    }
  })

export const setRetentionClassBody = z.object({
  documentIds: z.array(z.uuid()).min(1),
  retentionClass: z.enum(['standard', 'immovable_property']),
})

/**
 * Deleting documents whose term has run out.
 *
 * A reason is required, not optional. This is the one action in the system that
 * destroys evidence rather than reversing an entry, and "who deleted forty
 * thousand documents and why" is a question that gets asked.
 */
export const deleteDocumentsBody = z.object({
  documentIds: z.array(z.uuid()).min(1),
  reason: z.string().trim().min(1, 'Say why. This is the one act that cannot be reversed.'),
})

/**
 * Erasing a contact (spec 7.6).
 *
 * The reason is required for the same reason it is on a deletion: this is
 * answering a request somebody made, and "we erased X on this date because
 * they asked on that date" is what a supervisory authority looks for.
 */
export const pseudonymiseContactBody = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Say why. An erasure answers a request, and the request is the record.'),
})

export type RetentionQuery = z.infer<typeof retentionQuery>
export type SetLegalHoldBody = z.infer<typeof setLegalHoldBody>
export type SetRetentionClassBody = z.infer<typeof setRetentionClassBody>
export type DeleteDocumentsBody = z.infer<typeof deleteDocumentsBody>
export type PseudonymiseContactBody = z.infer<typeof pseudonymiseContactBody>

/**
 * Subscribing to the event stream (spec 10.2).
 *
 * `https` only, and not a courtesy: the signature proves who sent it and that
 * it is recent, but it does nothing about who *read* it on the way. Over plain
 * http the resource ids are in the clear, and an id is enough to ask the API
 * for the thing itself if you also have a token.
 */
export const createWebhookBody = z.object({
  url: z
    .url()
    .refine((value) => value.startsWith('https://'), 'A webhook URL has to be https.')
    .refine((value) => value.length <= 2000, 'That URL is unreasonably long.'),
  /** Empty means every type, including ones added after this was created. */
  eventTypes: z.array(z.string().min(1)).default([]),
})

/**
 * Replaying (spec 10.2's "replay endpoint").
 *
 * `after` is where to resume from — the id of the last event to treat as
 * already delivered. Absent means the very beginning, which is the honest
 * meaning of "send me everything again".
 */
export const replayWebhookBody = z.object({
  after: z.uuid().nullish(),
})

export type CreateWebhookBody = z.infer<typeof createWebhookBody>
export type ReplayWebhookBody = z.infer<typeof replayWebhookBody>

/**
 * Reading the event stream (spec 10.2).
 *
 * `after` is the id of the last event already handled, which is also its dedup
 * id — so resuming is "give me what came after this" and needs no clock.
 */
export const eventsQuery = z.object({
  after: z.uuid().optional(),
  /**
   * Comma-separated, not repeated. Query parameters arrive here already
   * flattened to one value per key, and `?type=a&type=b` would silently keep
   * whichever came last — a filter that quietly drops half of what you asked
   * for is worse than one that does not exist.
   */
  type: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined
        ? undefined
        : value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== ''),
    ),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
})

export type EventsQuery = z.infer<typeof eventsQuery>

/** Sealing a snapshot (spec 7.6). */
export const sealSnapshotBody = z.object({
  fiscalYear: z.string().regex(/^\d{4}$/, 'A book year is four digits.'),
})

export const verifySnapshotQuery = z.object({
  /**
   * Re-export the auditfile and compare its bytes.
   *
   * Off by default: it is the slow half and the one that fires benignly when
   * the exporter improves. When it is off the result says so, because
   * "verified" with a check skipped is a lie by omission.
   */
  recomputeAuditFile: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .default(false)
    .transform((value) => value === true || value === 'true'),
})

export type SealSnapshotBody = z.infer<typeof sealSnapshotBody>
export type VerifySnapshotQuery = z.infer<typeof verifySnapshotQuery>

/**
 * Connecting to Exact Online (spec 13).
 *
 * The OAuth app belongs to whoever runs this instance — spec 8's
 * bring-your-own-credential rule — so the client id and secret arrive here
 * rather than out of the environment. The secret is stored encrypted and never
 * returned, the same way a mailbox password is.
 *
 * `redirectUri` has to match what was registered with Exact exactly, including
 * the scheme and any trailing path, or the handshake fails at Exact's end with
 * an error that does not say why. So it is required rather than derived from
 * the request's own host: guessing it right some of the time is worse than
 * asking.
 */
export const connectExactBody = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    // A token issued at start.exactonline.nl is not valid at .be, so the host
    // is part of the connection rather than a display preference.
    //
    // https, with loopback carved out. Every Exact host is https and a client
    // secret over plain http is a credential on the wire — but refusing
    // loopback outright means the flow cannot be walked against a stand-in,
    // which is how the parts of it that only show up over real HTTP get found.
    .refine(
      (value) =>
        value.startsWith('https://') ||
        value.startsWith('http://localhost') ||
        value.startsWith('http://127.0.0.1'),
      'The Exact host must be https, or localhost for a stand-in.',
    ),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(400),
  // https, with no loopback exception — unlike `baseUrl` above.
  //
  // Exact refuses to register a plain-http redirect URI, and the refusal
  // happens in their App Center rather than here, where it is somebody else's
  // error message. Refusing it at this end costs nothing and can name the fix.
  redirectUri: z
    .string()
    .trim()
    .url()
    .refine(
      (value) => value.startsWith('https://'),
      'Exact only accepts an https redirect. Serve the app over https — `pnpm dev:https` does it locally — and use that origin.',
    ),
})

export type ConnectExactBody = z.infer<typeof connectExactBody>

/** The callback's query, posted by the screen Exact redirects to. */
export const completeExactBody = z.object({
  code: z.string().trim().min(1).max(2000),
  state: z.string().trim().min(1).max(200),
})

export type CompleteExactBody = z.infer<typeof completeExactBody>

/**
 * Choosing the administration to import from.
 *
 * The code is checked against what Exact actually offers rather than trusted:
 * a number in a request body is not evidence that this login can reach that
 * division.
 */
export const chooseExactDivisionBody = z.object({
  divisionCode: z.coerce.number().int().min(1),
})

export type ChooseExactDivisionBody = z.infer<typeof chooseExactDivisionBody>

/**
 * What a dry run reads.
 *
 * `year` because `financial/ReportingBalance` is per book year and there is no
 * "all of it" — a trial balance without a year is not a trial balance.
 */
export const exactPreviewQuery = z.object({
  year: z.coerce.number().int().min(1990).max(2200),
  /** Read the document archive too. Slow, and not needed to reconcile. */
  documents: z.coerce.boolean().optional(),
})

export type ExactPreviewQuery = z.infer<typeof exactPreviewQuery>

/**
 * Running the import for real.
 *
 * Every account here is asked for rather than defaulted, and that is the point:
 * a migration puts somebody's whole debtor position on a control account and
 * the balancing side somewhere. Picking those on their behalf would be a
 * bookkeeping decision made by a program, and the wrong one is not visible
 * afterwards — the numbers are all plausible.
 */
export const runExactImportBody = z.object({
  year: z.number().int().min(1990).max(2200),
  /**
   * The date the opening entry is booked on.
   *
   * Not the invoice dates: those stay on the invoices, where the ageing and the
   * dunning clock read them. This is the single date the balance is established
   * on, which is how an overname is normally booked.
   */
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The memoriaal the opening entry lands in. */
  journalCode: z.string().trim().min(1).max(20),
  /** Debiteuren. */
  receivableAccount: z.string().trim().min(1).max(20),
  /** Crediteuren. */
  payableAccount: z.string().trim().min(1).max(20),
  /**
   * The other side of every open item — usually equity or a suspense account.
   *
   * No default. An import that quietly balanced itself against a cost account
   * would understate the result by the whole debtor position, and nothing on
   * any screen would look wrong.
   */
  openingBalanceAccount: z.string().trim().min(1).max(20),
  idempotencyKey: z.string().uuid().optional(),
})

export type RunExactImportBody = z.infer<typeof runExactImportBody>

/**
 * Issuing an API token.
 *
 * `permissions` is required and has no default. A token whose scope somebody
 * did not think about is a token with the wrong scope, and the common case —
 * read-only for an agent — is two clicks on the screen rather than an omission.
 */
export const issueTokenBody = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.string().trim().min(1)).min(1).max(30),
  /** Null means it does not expire, which is a choice somebody has to make. */
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(90),
  idempotencyKey: z.string().uuid().optional(),
})

export type IssueTokenBody = z.infer<typeof issueTokenBody>
