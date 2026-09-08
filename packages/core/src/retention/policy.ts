/**
 * How long a document has to be kept (spec 7.6).
 *
 * > "Bewaarplicht is 7 years, 10 for onroerend goed. The legal test is that the
 * > administration stays accessible, readable and controllable for the
 * > inspector, in a reasonable time."
 *
 * Article 52 of the Algemene wet inzake rijksbelastingen is the source: the
 * obligation runs seven years, and article 34a of the Wet op de omzetbelasting
 * extends it to ten for immovable property, because the VAT revision period for
 * a building is nine years after the year it was first used.
 *
 * ## The clock starts at the end of a book year, not at a document's own date
 *
 * This is the part that is easy to get wrong. An invoice dated 28 December 2026
 * and one dated 3 January 2027 look a week apart and are a whole year apart in
 * retention, because each is kept relative to *the book year it was posted in*.
 * And the two can disagree: an invoice dated 31 December booked in the next
 * year's opening belongs to the year it was booked in, which is the year an
 * inspector will look for it under.
 *
 * So retention is computed from the fiscal year, and a document with no fiscal
 * year yet has no retention date — which makes it undeletable rather than
 * deletable, because "we do not know how long to keep this" is not a licence to
 * throw it away.
 *
 * ## Nothing here deletes anything
 *
 * This module answers "may this be deleted, and if not why not". The deleting
 * is a deliberate, audited, permissioned batch action somebody presses (spec
 * 7.6), and it is never automatic. A retention date arriving in the past is not
 * an instruction.
 */

/** Seven years, and ten for onroerend goed. */
export type RetentionClass = 'standard' | 'immovable_property'

export const RETENTION_YEARS: Readonly<Record<RetentionClass, number>> = {
  standard: 7,
  immovable_property: 10,
}

export const RETENTION_CLASS_LABEL: Readonly<Record<RetentionClass, string>> = {
  standard: 'Seven years',
  immovable_property: 'Ten years (onroerend goed)',
}

/**
 * The last day this has to be kept.
 *
 * `fiscalYearEndsOn` is the book year's own closing date, so a year that is not
 * a calendar year works without special handling — which matters, because a
 * boekjaar need not be a calendar year (spec 6.4) and a shifted one shifts its
 * retention with it.
 *
 * Computed on the date parts rather than with `Date` arithmetic: adding seven
 * years to a `Date` drags a timezone along, and 29 February plus seven years is
 * a question `Date` answers by rolling into March.
 */
export function retainUntil(fiscalYearEndsOn: string, retentionClass: RetentionClass): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fiscalYearEndsOn)
  if (match === null) {
    throw new RangeError(`${fiscalYearEndsOn} is not a yyyy-mm-dd date.`)
  }

  const year = Number(match[1]) + RETENTION_YEARS[retentionClass]
  const month = match[2]!
  const day = match[3]!

  // A book year ending on 29 February keeps its day only when the target year
  // has one. Clamping to the 28th shortens nothing that matters and beats
  // silently becoming 1 March.
  if (month === '02' && day === '29' && !isLeapYear(year)) {
    return `${String(year)}-02-28`
  }

  return `${String(year)}-${month}-${day}`
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export type RetentionStateCode =
  /** Past its retention date, nothing holding it. The only deletable state. */
  | 'expired'
  /** Still within retention. */
  | 'retained'
  /** Under legal hold, which suspends deletion regardless of the date. */
  | 'held'
  /** No fiscal year known yet, so no retention date. Undeletable. */
  | 'undated'
  /** Already deleted. */
  | 'deleted'

export interface RetentionSubject {
  readonly id: string
  readonly retainUntil: string | null
  readonly retentionClass: RetentionClass
  readonly legalHold: boolean
  readonly deletedAt: string | null
}

export interface RetentionState {
  readonly code: RetentionStateCode
  readonly deletable: boolean
  /** Said in the words somebody deciding would use. */
  readonly reason: string
}

/**
 * Where one document stands.
 *
 * The order of the checks is the order of authority. A legal hold beats an
 * expired date, because that is what a hold is *for* — a dispute or an
 * investigation outlives the bewaarplicht and the whole point is that the clock
 * stops mattering. An entity-wide hold beats a per-document one for the same
 * reason and is checked first, because a firm under investigation should not
 * have to set a flag on forty thousand rows.
 */
export function retentionState(
  subject: RetentionSubject,
  options: { readonly asOf: string; readonly entityLegalHold: boolean },
): RetentionState {
  if (subject.deletedAt !== null) {
    return {
      code: 'deleted',
      deletable: false,
      reason: `Already deleted on ${subject.deletedAt.slice(0, 10)}.`,
    }
  }

  if (options.entityLegalHold) {
    return {
      code: 'held',
      deletable: false,
      reason: 'The whole administration is under legal hold. Nothing is deleted.',
    }
  }

  if (subject.legalHold) {
    return {
      code: 'held',
      deletable: false,
      reason: 'This document is under legal hold and is kept regardless of its retention date.',
    }
  }

  if (subject.retainUntil === null) {
    return {
      code: 'undated',
      deletable: false,
      reason:
        'No book year known yet, so no retention date. Not knowing how long something must be kept is not a licence to throw it away.',
    }
  }

  if (subject.retainUntil >= options.asOf) {
    return {
      code: 'retained',
      deletable: false,
      reason: `Keep until ${subject.retainUntil} inclusive.`,
    }
  }

  return {
    code: 'expired',
    deletable: true,
    reason: `The retention obligation ran out on ${subject.retainUntil}.`,
  }
}

export interface RetentionSummary {
  readonly asOf: string
  readonly entityLegalHold: boolean
  /** A count of documents. Named for what it counts, since `total` reads as money. */
  readonly documents: number
  readonly byState: Readonly<Record<RetentionStateCode, number>>
  /** Bytes that could be freed. Nothing is freed by looking. */
  readonly deletableBytes: bigint
}

/**
 * What a deletion run would find, before anybody presses anything.
 *
 * The preview is the feature. "Deletion after retention is a deliberate,
 * audited, permissioned batch action with a preview. Never automatic" — and a
 * preview that only counts what it would delete is half of one, so this counts
 * every state. An operator wondering why nothing is deletable gets an answer.
 */
export function summariseRetention(
  subjects: readonly (RetentionSubject & { readonly sizeBytes: number })[],
  options: { readonly asOf: string; readonly entityLegalHold: boolean },
): RetentionSummary {
  const byState: Record<RetentionStateCode, number> = {
    expired: 0,
    retained: 0,
    held: 0,
    undated: 0,
    deleted: 0,
  }

  let deletableBytes = 0n

  for (const subject of subjects) {
    const state = retentionState(subject, options)
    byState[state.code] += 1
    if (state.deletable) deletableBytes += BigInt(subject.sizeBytes)
  }

  return {
    asOf: options.asOf,
    entityLegalHold: options.entityLegalHold,
    documents: subjects.length,
    byState,
    deletableBytes,
  }
}
