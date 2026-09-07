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

export const journalLineInput = z.object({
  accountNumber: z.string().min(1),
  description: z.string().nullable().default(null),
  debit: minorUnitsWithDefault,
  credit: minorUnitsWithDefault,
  currency: currencyCode.nullable().default(null),
  exchangeRate: decimalString.nullable().default(null),
  exchangeRateSource: z.string().nullable().default(null),
  taxCode: z.string().nullable().default(null),
  taxAmount: nullableMinorUnits,
  dimensions: z.array(dimensionAssignment).default([]),
  subledgerKind: z.enum(['customer', 'supplier', 'asset', 'project']).nullable().default(null),
  subledgerId: z.uuid().nullable().default(null),
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
