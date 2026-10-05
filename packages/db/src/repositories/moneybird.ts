import { uuidv7 } from '@klopt/core'
import { eq } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { moneybirdConnections } from '../schema/documents.js'
import { decryptSecret, encryptSecret } from '../secrets.js'

/**
 * The connection to a Moneybird administration (issue #32).
 *
 * `find` never returns the token. `withCredentials` is the one method that
 * decrypts, the same shape as Exact and inbound sources.
 */

export interface MoneybirdConnectionRow {
  readonly id: string
  readonly entityId: string
  readonly baseUrl: string
  readonly administrationId: string | null
  readonly administrationName: string | null
  readonly administrationCurrency: string | null
  readonly accountMappings: Readonly<Record<string, string>>
  readonly taxMappings: Readonly<Record<string, string>>
  readonly connected: boolean
  readonly lastImportAt: string | null
  readonly lastError: string | null
}

export interface MoneybirdConnectionCredentials extends MoneybirdConnectionRow {
  readonly apiToken: string
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.trim() !== '') result[key] = item
  }
  return result
}

export class MoneybirdConnectionRepository {
  constructor(private readonly tx: Transaction) {}

  async find(entityId: string): Promise<MoneybirdConnectionRow | null> {
    const [row] = await this.tx
      .select({
        id: moneybirdConnections.id,
        entityId: moneybirdConnections.entityId,
        baseUrl: moneybirdConnections.baseUrl,
        administrationId: moneybirdConnections.administrationId,
        administrationName: moneybirdConnections.administrationName,
        administrationCurrency: moneybirdConnections.administrationCurrency,
        accountMappings: moneybirdConnections.accountMappings,
        taxMappings: moneybirdConnections.taxMappings,
        lastImportAt: moneybirdConnections.lastImportAt,
        lastError: moneybirdConnections.lastError,
      })
      .from(moneybirdConnections)
      .where(eq(moneybirdConnections.entityId, entityId))
      .limit(1)

    if (row === undefined) return null
    return {
      ...row,
      accountMappings: asStringMap(row.accountMappings),
      taxMappings: asStringMap(row.taxMappings),
      connected: true,
      lastImportAt: row.lastImportAt?.toISOString() ?? null,
    }
  }

  async withCredentials(entityId: string): Promise<MoneybirdConnectionCredentials | null> {
    const [row] = await this.tx
      .select()
      .from(moneybirdConnections)
      .where(eq(moneybirdConnections.entityId, entityId))
      .limit(1)

    if (row === undefined) return null
    const publicRow = await this.find(entityId)
    if (publicRow === null) return null
    return { ...publicRow, apiToken: decryptSecret(row.apiToken) ?? '' }
  }

  async upsertToken(request: {
    readonly entityId: string
    readonly baseUrl: string
    readonly apiToken: string
  }): Promise<string> {
    const secret = encryptSecret(request.apiToken)
    const existing = await this.find(request.entityId)
    if (existing !== null) {
      await this.tx
        .update(moneybirdConnections)
        .set({
          baseUrl: request.baseUrl,
          apiToken: secret,
          administrationId: null,
          administrationName: null,
          administrationCurrency: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(moneybirdConnections.entityId, request.entityId))
      return existing.id
    }

    const id = uuidv7()
    await this.tx.insert(moneybirdConnections).values({
      id,
      entityId: request.entityId,
      baseUrl: request.baseUrl,
      apiToken: secret,
    })
    return id
  }

  async chooseAdministration(request: {
    readonly entityId: string
    readonly id: string
    readonly name: string
    readonly currency: string | null
  }): Promise<void> {
    await this.tx
      .update(moneybirdConnections)
      .set({
        administrationId: request.id,
        administrationName: request.name,
        administrationCurrency: request.currency,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(moneybirdConnections.entityId, request.entityId))
  }

  async saveMappings(request: {
    readonly entityId: string
    readonly accountMappings: Readonly<Record<string, string>>
    readonly taxMappings: Readonly<Record<string, string>>
  }): Promise<void> {
    await this.tx
      .update(moneybirdConnections)
      .set({
        accountMappings: request.accountMappings,
        taxMappings: request.taxMappings,
        updatedAt: new Date(),
      })
      .where(eq(moneybirdConnections.entityId, request.entityId))
  }

  async recordSuccess(entityId: string): Promise<void> {
    await this.tx
      .update(moneybirdConnections)
      .set({ lastError: null, updatedAt: new Date() })
      .where(eq(moneybirdConnections.entityId, entityId))
  }

  async recordFailure(entityId: string, message: string): Promise<void> {
    await this.tx
      .update(moneybirdConnections)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(moneybirdConnections.entityId, entityId))
  }

  async recordImport(entityId: string): Promise<void> {
    await this.tx
      .update(moneybirdConnections)
      .set({ lastImportAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(moneybirdConnections.entityId, entityId))
  }

  async remove(entityId: string): Promise<void> {
    await this.tx.delete(moneybirdConnections).where(eq(moneybirdConnections.entityId, entityId))
  }
}
