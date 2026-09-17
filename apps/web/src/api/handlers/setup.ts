import { PERMISSIONS, isUuid, planEntitySetup, uuidv7 } from '@klopt/core'
import { setActiveEntity, withBankRead, withSetup } from '@klopt/db'
import {
  hasPermission,
  hasSetupPermission,
  type RequestContext,
  type SetupContext,
} from '../context.js'
import { ApiError, requireIfMatch } from '../errors.js'
import { recordAudit } from '../audit.js'
import { referenceData } from '../reference-data.js'
import type { CreateEntityBody, CreateFiscalYearBody, UpdateEntityBody } from '../schemas.js'
import { etagOf } from '../etag.js'

/**
 * Creating an administration, and opening its book years.
 *
 * The first two operations are the answer to "I have signed in and there is
 * nothing here". Until they existed the only way to get a first entity was to
 * run a test fixture, which made principle 4 — self-hosted is complete, not
 * crippled — false in the most literal way available.
 *
 * `createFiscalYear` is here rather than with the ledger handlers because it is
 * the same job a year later: a close posts its opening balance into the *next*
 * year, so an entity with one book year cannot close it.
 */

function requireSetupPermission(context: SetupContext): void {
  if (!hasSetupPermission(context, PERMISSIONS.createEntity)) {
    throw new ApiError('forbidden', `This caller does not have ${PERMISSIONS.createEntity}.`)
  }
}

function requirePermission(context: RequestContext, permission: string): void {
  if (!hasPermission(context, permission)) {
    throw new ApiError('forbidden', `This token does not have ${permission}.`)
  }
}

export function handleListCharts(context: SetupContext) {
  requireSetupPermission(context)

  return {
    status: 200,
    body: {
      charts: referenceData().charts.map((chart) => ({
        code: chart.code,
        name: chart.name,
        description: chart.description,
        currency: chart.currency,
        rgsVersion: chart.rgsVersion,
        rgsVariant: chart.rgsVariant,
        accountCount: chart.accounts.length,
        journalCount: chart.journals.length,
        taxCodeCount: chart.taxCodes.length,
      })),
    },
  }
}

/**
 * The entity id comes from the caller, which is what makes this idempotent.
 *
 * A `POST /entities` with an Idempotency-Key could not dedupe: the idempotency
 * table is keyed by entity, and the whole point is that there is no entity yet.
 * A client-chosen id under PUT is the standard answer, and it also means a
 * double-submitted setup form produces one administration rather than two.
 */
export async function handleCreateEntity(
  context: SetupContext,
  entityId: string,
  body: CreateEntityBody,
) {
  requireSetupPermission(context)

  if (!isUuid(entityId)) {
    throw new ApiError('validation_failed', 'The administration id must be a UUID.', [
      { code: 'invalid_request', path: 'entityId', message: 'Not a UUID.' },
    ])
  }

  const store = referenceData()
  const chart = store.charts.find((candidate) => candidate.code === body.chartCode)
  if (chart === undefined) {
    throw new ApiError('validation_failed', `No chart of accounts "${body.chartCode}".`, [
      {
        code: 'unknown_chart',
        path: 'chartCode',
        message: `Available: ${store.charts.map((item) => item.code).join(', ') || '(none)'}.`,
      },
    ])
  }

  const plan = planEntitySetup(
    {
      name: body.name,
      legalName: body.legalName,
      kvkNumber: body.kvkNumber,
      vatNumber: body.vatNumber,
      functionalCurrency: body.functionalCurrency,
      fiscalYearStartMonth: body.fiscalYearStartMonth,
      firstFiscalYear: body.firstFiscalYear,
      vatRounding: body.vatRounding,
    },
    chart,
  )

  const result = await withSetup(context.database, (repository) =>
    repository.provision({ entityId, ownerUserId: context.user.id, plan }),
  )

  return {
    status: result.created ? 201 : 200,
    body: {
      entityId: result.entityId,
      name: result.name,
      created: result.created,
      chartCode: plan.chartCode,
      currency: plan.entity.functionalCurrency,
      fiscalYear: {
        code: plan.fiscalYear.code,
        startsOn: plan.fiscalYear.startsOn,
        endsOn: plan.fiscalYear.endsOn,
      },
      accountCount: plan.accounts.length,
      journalCount: plan.journals.length,
      taxCodeCount: plan.taxCodes.length,
    },
  }
}

export async function handleListFiscalYears(context: RequestContext) {
  requirePermission(context, PERMISSIONS.read)

  const years = await withSetup(context.database, (repository) =>
    repository.listFiscalYears(context.entityId),
  )

  return { status: 200, body: { fiscalYears: years } }
}

export async function handleCreateFiscalYear(context: RequestContext, body: CreateFiscalYearBody) {
  requirePermission(context, PERMISSIONS.configure)

  const year = await withSetup(context.database, (repository) =>
    repository.createFiscalYear(context.entityId, body.code),
  )

  return { status: year.created ? 201 : 200, body: year }
}

/** A newly created administration is the one the session should be looking at. */
export async function rememberEntity(
  context: SetupContext,
  sessionToken: string,
  entityId: string,
): Promise<void> {
  await setActiveEntity(context.database, sessionToken, entityId)
}

/** A fresh id for the setup form, so the client can retry safely. */
export function newEntityId(): string {
  return uuidv7()
}

export async function handleGetEntity(context: RequestContext) {
  requirePermission(context, PERMISSIONS.read)

  const entity = await withSetup(context.database, (repository) =>
    repository.findEntity(context.entityId),
  )
  if (entity === null) throw new ApiError('not_found', 'No such administration.')

  // The whole row is editable here, so the resource and the representation are
  // the same thing and the tag can be over either.
  return { status: 200, body: entity, headers: { etag: etagOf(entity) } }
}

/**
 * Change the administration's own details.
 *
 * Not the chart, the journals or the book years — each of those has its own
 * operation, because changing them has consequences that a settings form
 * should not quietly imply.
 */
export async function handleUpdateEntity(context: RequestContext, body: UpdateEntityBody) {
  requirePermission(context, PERMISSIONS.configure)

  // Checked against the chart, because "is 4901 an account you have" is a
  // question about the database and a setting pointing at nothing would go
  // wrong later, quietly, in a matching screen.
  if (body.bankChargesAccountNumber !== undefined && body.bankChargesAccountNumber !== null) {
    const exists = await withBankRead(context.database, (repository) =>
      repository.ledgerAccountIdFor(context.entityId, body.bankChargesAccountNumber!),
    )
    if (exists === null) {
      throw new ApiError(
        'validation_failed',
        `There is no account ${body.bankChargesAccountNumber} in this chart.`,
        [
          {
            code: 'unknown_account',
            path: 'bankChargesAccountNumber',
            message: `There is no account ${body.bankChargesAccountNumber} in this chart.`,
          },
        ],
      )
    }
  }

  const before = await withSetup(context.database, (repository) =>
    repository.findEntity(context.entityId),
  )
  if (before === null) throw new ApiError('not_found', 'No such administration.')

  // Before the write, against the same shape `handleGetEntity` tagged.
  requireIfMatch(context.ifMatch, etagOf(before))

  await withSetup(context.database, (repository) => repository.updateEntity(context.entityId, body))

  const entity = await withSetup(context.database, (repository) =>
    repository.findEntity(context.entityId),
  )

  // Both sides, and only the fields that were sent. "The VAT rounding went from
  // per_invoice to per_line" is an audit entry; the whole record twice is a
  // diff somebody has to do by eye.
  await recordAudit(context, {
    action: 'setup.updateEntity',
    resourceType: 'entity',
    resourceId: context.entityId,
    before: Object.fromEntries(
      Object.keys(body).map((key) => [key, (before as Record<string, unknown>)[key] ?? null]),
    ),
    after: body,
  })

  return { status: 200, body: entity, headers: { etag: etagOf(entity) } }
}
