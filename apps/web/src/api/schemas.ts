import { z } from 'zod'

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
 */
const minorUnitString = z
  .string()
  .regex(/^\d+$/, 'Amounts are unsigned integer minor units, as a string.')

export const minorUnits = minorUnitString.transform((value) => BigInt(value))

const minorUnitsWithDefault = minorUnitString.default('0').transform((value) => BigInt(value))

const nullableMinorUnits = minorUnitString
  .nullable()
  .default(null)
  .transform((value) => (value === null ? null : BigInt(value)))

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.')

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217, three uppercase letters.')

export const decimalString = z.string().regex(/^\d+(\.\d+)?$/, 'A positive decimal, as a string.')

export const dimensionAssignment = z.object({
  typeCode: z.string().min(1),
  valueCode: z.string().min(1),
})

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

/** Sales (M1). */

export const contactsQuery = z.object({
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
  bic: z.string().nullable().default(null),
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
})

export type UpdateEntityBody = z.infer<typeof updateEntityBody>

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
export const listVatPeriodsQuery = z.object({
  year: z.coerce.number().int().min(1900).max(2999),
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
