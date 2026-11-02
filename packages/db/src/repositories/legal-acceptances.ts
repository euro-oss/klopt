import { and, desc, eq } from 'drizzle-orm'
import type { Database, Transaction } from '../client.js'
import { legalAcceptances } from '../schema/auth.js'

export type LegalAcceptanceKind = 'terms_dpa' | 'privacy_notice'

export type LegalAcceptanceRecord = {
  readonly id: string
  readonly userId: string
  readonly kind: LegalAcceptanceKind
  readonly recordedAt: Date
  readonly termsVersion: string | null
  readonly dpaVersion: string | null
  readonly privacyVersion: string | null
}

export type RecordTermsDpaInput = {
  readonly id: string
  readonly userId: string
  readonly termsVersion: string
  readonly dpaVersion: string
  readonly recordedAt?: Date
}

export type RecordPrivacyNoticeInput = {
  readonly id: string
  readonly userId: string
  readonly privacyVersion: string
  readonly recordedAt?: Date
}

/** @deprecated Prefer RecordTermsDpaInput — kept for call-site clarity during rename. */
export type RecordLegalAcceptanceInput = RecordTermsDpaInput

function asKind(value: string): LegalAcceptanceKind {
  if (value === 'terms_dpa' || value === 'privacy_notice') return value
  throw new Error(`Unknown legal_acceptances.kind: ${value}`)
}

function mapRow(row: typeof legalAcceptances.$inferSelect): LegalAcceptanceRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: asKind(row.kind),
    recordedAt: row.recordedAt,
    termsVersion: row.termsVersion,
    dpaVersion: row.dpaVersion,
    privacyVersion: row.privacyVersion,
  }
}

/**
 * Hosted legal records (issue #138).
 *
 * Writes only when the hosted legal env is configured; callers decide that.
 * Append-only — never updated in place.
 */
export class LegalAcceptancesRepository {
  constructor(private readonly db: Database | Transaction) {}

  async recordTermsDpa(input: RecordTermsDpaInput): Promise<LegalAcceptanceRecord> {
    const recordedAt = input.recordedAt ?? new Date()
    const [row] = await this.db
      .insert(legalAcceptances)
      .values({
        id: input.id,
        userId: input.userId,
        kind: 'terms_dpa',
        recordedAt,
        termsVersion: input.termsVersion,
        dpaVersion: input.dpaVersion,
        privacyVersion: null,
      })
      .returning()

    if (row === undefined) {
      throw new Error('legal_acceptances insert returned no row.')
    }
    return mapRow(row)
  }

  /** Alias used by Setup while call sites migrate. */
  async record(input: RecordLegalAcceptanceInput): Promise<LegalAcceptanceRecord> {
    return this.recordTermsDpa(input)
  }

  async recordPrivacyNoticeShown(input: RecordPrivacyNoticeInput): Promise<LegalAcceptanceRecord> {
    const recordedAt = input.recordedAt ?? new Date()
    const [row] = await this.db
      .insert(legalAcceptances)
      .values({
        id: input.id,
        userId: input.userId,
        kind: 'privacy_notice',
        recordedAt,
        termsVersion: null,
        dpaVersion: null,
        privacyVersion: input.privacyVersion,
      })
      .returning()

    if (row === undefined) {
      throw new Error('legal_acceptances privacy insert returned no row.')
    }
    return mapRow(row)
  }

  async hasPrivacyNotice(userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: legalAcceptances.id })
      .from(legalAcceptances)
      .where(and(eq(legalAcceptances.userId, userId), eq(legalAcceptances.kind, 'privacy_notice')))
      .limit(1)
    return rows.length > 0
  }

  async listForUser(userId: string): Promise<readonly LegalAcceptanceRecord[]> {
    const rows = await this.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.userId, userId))
      .orderBy(desc(legalAcceptances.recordedAt))

    return rows.map(mapRow)
  }

  async listPrivacyForUser(userId: string): Promise<readonly LegalAcceptanceRecord[]> {
    const rows = await this.db
      .select()
      .from(legalAcceptances)
      .where(and(eq(legalAcceptances.userId, userId), eq(legalAcceptances.kind, 'privacy_notice')))
      .orderBy(desc(legalAcceptances.recordedAt))
    return rows.map(mapRow)
  }
}
