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
