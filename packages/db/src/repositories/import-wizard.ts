import { uuidv7, type MoneybirdImportDecisions } from '@klopt/core'
import { and, eq } from 'drizzle-orm'
import type { Transaction } from '../client.js'
import { importAdministrationMappings, importWizardStates } from '../schema/documents.js'

/**
 * Per-administration mappings and wizard resume state (issue #100 / 0037).
 *
 * Mappings survive disconnect. Wizard state is one row per entity.
 */

export type ImportSource = 'moneybird' | 'exact'

export type ImportWizardStep =
  | 'bron'
  | 'verbinden'
  | 'administratie'
  | 'voorbeeld'
  | 'btw'
  | 'rekeningen'
  | 'problemen'
  | 'overzicht'
  | 'importeren'
  | 'klaar'

export interface ImportAdministrationMappingRow {
  readonly id: string
  readonly entityId: string
  readonly source: ImportSource
  readonly administrationId: string
  readonly accountMappings: Readonly<Record<string, string>>
  readonly taxMappings: Readonly<Record<string, string>>
  readonly importDecisions: MoneybirdImportDecisions
  readonly updatedAt: string
}

export interface ImportWizardStateRow {
  readonly id: string
  readonly entityId: string
  readonly source: ImportSource | null
  readonly step: ImportWizardStep
  readonly administrationId: string | null
  readonly selectedYears: readonly string[]
  readonly previewHash: string | null
  readonly previewStale: boolean
  readonly updatedAt: string
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.trim() !== '') result[key] = item
  }
  return result
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
}

function asImportDecisions(value: unknown): MoneybirdImportDecisions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const exchangeRates: Record<string, { rate: string; source: 'ecb' | 'override'; date: string }> =
    {}
  if (typeof row['exchangeRates'] === 'object' && row['exchangeRates'] !== null) {
    for (const [key, item] of Object.entries(row['exchangeRates'] as Record<string, unknown>)) {
      if (typeof item !== 'object' || item === null) continue
      const rate = item as Record<string, unknown>
      if (
        typeof rate['rate'] === 'string' &&
        (rate['source'] === 'ecb' || rate['source'] === 'override') &&
        typeof rate['date'] === 'string'
      ) {
        exchangeRates[key] = {
          rate: rate['rate'],
          source: rate['source'],
          date: rate['date'],
        }
      }
    }
  }
  const accountTypeOverrides: Record<
    string,
    'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  > = {}
  if (typeof row['accountTypeOverrides'] === 'object' && row['accountTypeOverrides'] !== null) {
    for (const [key, item] of Object.entries(
      row['accountTypeOverrides'] as Record<string, unknown>,
    )) {
      if (
        item === 'asset' ||
        item === 'liability' ||
        item === 'equity' ||
        item === 'revenue' ||
        item === 'expense'
      ) {
        accountTypeOverrides[key] = item
      }
    }
  }
  const decisions: MoneybirdImportDecisions = {
    acknowledgedEmptyYears: asStringArray(row['acknowledgedEmptyYears']),
    excludedExternalIds: asStringArray(row['excludedExternalIds']),
    excludedLockedYears: asStringArray(row['excludedLockedYears']),
    excludedYears: asStringArray(row['excludedYears']),
    contactNumberOverrides: asStringMap(row['contactNumberOverrides']),
    accountTypeOverrides,
    exchangeRates,
    deferredAttachmentIds: asStringArray(row['deferredAttachmentIds']),
  }
  return {
    ...decisions,
    ...(row['confirmedCurrencyIsFunctional'] === true
      ? { confirmedCurrencyIsFunctional: true as const }
      : {}),
    ...(row['confirmedFiscalYearStart'] === true
      ? { confirmedFiscalYearStart: true as const }
      : {}),
  }
}

const WIZARD_STEPS: ReadonlySet<string> = new Set([
  'bron',
  'verbinden',
  'administratie',
  'voorbeeld',
  'btw',
  'rekeningen',
  'problemen',
  'overzicht',
  'importeren',
  'klaar',
])

function asWizardStep(value: string): ImportWizardStep {
  return WIZARD_STEPS.has(value) ? (value as ImportWizardStep) : 'bron'
}

function asSource(value: string | null): ImportSource | null {
  if (value === 'moneybird' || value === 'exact') return value
  return null
}

export class ImportWizardRepository {
  constructor(private readonly tx: Transaction) {}

  async findMappings(
    entityId: string,
    source: ImportSource,
    administrationId: string,
  ): Promise<ImportAdministrationMappingRow | null> {
    const [row] = await this.tx
      .select()
      .from(importAdministrationMappings)
      .where(
        and(
          eq(importAdministrationMappings.entityId, entityId),
          eq(importAdministrationMappings.source, source),
          eq(importAdministrationMappings.administrationId, administrationId),
        ),
      )
      .limit(1)

    if (row === undefined) return null
    return {
      id: row.id,
      entityId: row.entityId,
      source: row.source as ImportSource,
      administrationId: row.administrationId,
      accountMappings: asStringMap(row.accountMappings),
      taxMappings: asStringMap(row.taxMappings),
      importDecisions: asImportDecisions(row.importDecisions),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async upsertMappings(request: {
    readonly entityId: string
    readonly source: ImportSource
    readonly administrationId: string
    readonly accountMappings: Readonly<Record<string, string>>
    readonly taxMappings: Readonly<Record<string, string>>
    readonly importDecisions: MoneybirdImportDecisions
  }): Promise<ImportAdministrationMappingRow> {
    const existing = await this.findMappings(
      request.entityId,
      request.source,
      request.administrationId,
    )
    const now = new Date()
    if (existing !== null) {
      await this.tx
        .update(importAdministrationMappings)
        .set({
          accountMappings: request.accountMappings,
          taxMappings: request.taxMappings,
          importDecisions: request.importDecisions,
          updatedAt: now,
        })
        .where(eq(importAdministrationMappings.id, existing.id))
      return {
        ...existing,
        accountMappings: request.accountMappings,
        taxMappings: request.taxMappings,
        importDecisions: request.importDecisions,
        updatedAt: now.toISOString(),
      }
    }

    const id = uuidv7()
    await this.tx.insert(importAdministrationMappings).values({
      id,
      entityId: request.entityId,
      source: request.source,
      administrationId: request.administrationId,
      accountMappings: request.accountMappings,
      taxMappings: request.taxMappings,
      importDecisions: request.importDecisions,
      createdAt: now,
      updatedAt: now,
    })
    return {
      id,
      entityId: request.entityId,
      source: request.source,
      administrationId: request.administrationId,
      accountMappings: request.accountMappings,
      taxMappings: request.taxMappings,
      importDecisions: request.importDecisions,
      updatedAt: now.toISOString(),
    }
  }

  async findWizardState(entityId: string): Promise<ImportWizardStateRow | null> {
    const [row] = await this.tx
      .select()
      .from(importWizardStates)
      .where(eq(importWizardStates.entityId, entityId))
      .limit(1)

    if (row === undefined) return null
    return {
      id: row.id,
      entityId: row.entityId,
      source: asSource(row.source),
      step: asWizardStep(row.step),
      administrationId: row.administrationId,
      selectedYears: asStringArray(row.selectedYears),
      previewHash: row.previewHash,
      previewStale: row.previewStale,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  async upsertWizardState(request: {
    readonly entityId: string
    readonly source: ImportSource | null
    readonly step: ImportWizardStep
    readonly administrationId?: string | null
    readonly selectedYears?: readonly string[]
    readonly previewHash?: string | null
    readonly previewStale?: boolean
  }): Promise<ImportWizardStateRow> {
    const existing = await this.findWizardState(request.entityId)
    const now = new Date()
    const selectedYears = request.selectedYears ?? existing?.selectedYears ?? []
    const administrationId =
      request.administrationId !== undefined
        ? request.administrationId
        : (existing?.administrationId ?? null)
    const previewHash =
      request.previewHash !== undefined ? request.previewHash : (existing?.previewHash ?? null)
    const previewStale =
      request.previewStale !== undefined ? request.previewStale : (existing?.previewStale ?? false)

    if (existing !== null) {
      await this.tx
        .update(importWizardStates)
        .set({
          source: request.source,
          step: request.step,
          administrationId,
          selectedYears,
          previewHash,
          previewStale,
          updatedAt: now,
        })
        .where(eq(importWizardStates.entityId, request.entityId))
      return {
        id: existing.id,
        entityId: request.entityId,
        source: request.source,
        step: request.step,
        administrationId,
        selectedYears,
        previewHash,
        previewStale,
        updatedAt: now.toISOString(),
      }
    }

    const id = uuidv7()
    await this.tx.insert(importWizardStates).values({
      id,
      entityId: request.entityId,
      source: request.source,
      step: request.step,
      administrationId,
      selectedYears,
      previewHash,
      previewStale,
      updatedAt: now,
    })
    return {
      id,
      entityId: request.entityId,
      source: request.source,
      step: request.step,
      administrationId,
      selectedYears,
      previewHash,
      previewStale,
      updatedAt: now.toISOString(),
    }
  }

  async clearWizardState(entityId: string): Promise<void> {
    await this.tx.delete(importWizardStates).where(eq(importWizardStates.entityId, entityId))
  }
}
