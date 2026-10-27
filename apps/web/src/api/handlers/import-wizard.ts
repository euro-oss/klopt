/**
 * Import wizard resume state and per-administration mapping reads (#100).
 */

import {
  withImportWizard,
  withImportWizardRead,
  type ImportSource,
  type ImportWizardStep,
} from '@klopt/db'
import { hasPermission, type RequestContext } from '../context.js'
import { ApiError } from '../errors.js'
import { recordAudit } from '../audit.js'
import type { SaveImportWizardStateBody } from '../schemas.js'

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

function requireIdempotencyKey(context: RequestContext): string {
  if (context.idempotencyKey === null || context.idempotencyKey === '') {
    throw new ApiError('idempotency_key_required', 'Every write needs an Idempotency-Key header.')
  }
  return context.idempotencyKey
}

function serialiseState(row: {
  source: ImportSource | null
  step: ImportWizardStep
  administrationId: string | null
  selectedYears: readonly string[]
  previewHash: string | null
  previewStale: boolean
  updatedAt: string
}) {
  return {
    source: row.source,
    step: row.step,
    administrationId: row.administrationId,
    selectedYears: row.selectedYears,
    previewHash: row.previewHash,
    previewStale: row.previewStale,
    updatedAt: row.updatedAt,
  }
}

export async function handleGetImportWizardState(context: RequestContext) {
  requirePermission(context, 'ledger:read')
  const row = await withImportWizardRead(context.database, (repository) =>
    repository.findWizardState(context.entityId),
  )
  return {
    status: 200,
    body: {
      state: row === null ? null : serialiseState(row),
    },
  }
}

export async function handleSaveImportWizardState(
  context: RequestContext,
  body: SaveImportWizardStateBody,
) {
  requirePermission(context, 'ledger:import')
  requireIdempotencyKey(context)
  const row = await withImportWizard(context.database, (repository) =>
    repository.upsertWizardState({
      entityId: context.entityId,
      source: body.source,
      step: body.step,
      ...(body.administrationId !== undefined ? { administrationId: body.administrationId } : {}),
      ...(body.selectedYears !== undefined ? { selectedYears: body.selectedYears } : {}),
      ...(body.previewHash !== undefined ? { previewHash: body.previewHash } : {}),
      ...(body.previewStale !== undefined ? { previewStale: body.previewStale } : {}),
    }),
  )
  await recordAudit(context, {
    action: 'importWizard.saveState',
    resourceType: 'import_wizard_state',
    resourceId: context.entityId,
    after: {
      source: body.source ?? '',
      step: body.step,
      administrationId: body.administrationId ?? '',
    },
  })
  return { status: 200, body: { state: serialiseState(row) } }
}

export async function handleResetImportWizardState(context: RequestContext) {
  requirePermission(context, 'ledger:import')
  requireIdempotencyKey(context)
  await withImportWizard(context.database, (repository) =>
    repository.clearWizardState(context.entityId),
  )
  await recordAudit(context, {
    action: 'importWizard.resetState',
    resourceType: 'import_wizard_state',
    resourceId: context.entityId,
    after: { cleared: true },
  })
  return { status: 200, body: { cleared: true } }
}

export async function handleGetImportAdministrationMappings(
  context: RequestContext,
  query: { readonly source: ImportSource; readonly administrationId: string },
) {
  requirePermission(context, 'ledger:read')
  const row = await withImportWizardRead(context.database, (repository) =>
    repository.findMappings(context.entityId, query.source, query.administrationId),
  )
  return {
    status: 200,
    body: {
      mappings:
        row === null
          ? null
          : {
              source: row.source,
              administrationId: row.administrationId,
              accountMappings: row.accountMappings,
              taxMappings: row.taxMappings,
              importDecisions: row.importDecisions,
              updatedAt: row.updatedAt,
            },
    },
  }
}
