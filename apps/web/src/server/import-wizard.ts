import { createServerFn } from '@tanstack/react-start'
import {
  handleGetImportAdministrationMappings,
  handleGetImportWizardState,
  handleResetImportWizardState,
  handleSaveImportWizardState,
} from '~/api/handlers/import-wizard'
import {
  importWizardMappingsQuery,
  resetImportWizardStateBody,
  saveImportWizardStateBody,
} from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** Pull the idempotency key out of a payload (same as ~/server/ledger). */
function keyOf(input: unknown): string | undefined {
  const value = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const getImportWizardState = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleGetImportWizardState(await contextFromRequest())).body),
)

export const saveImportWizardState = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      saveImportWizardStateBody,
      data,
      async (body) =>
        (
          await handleSaveImportWizardState(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const resetImportWizardState = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      resetImportWizardStateBody,
      data,
      async () =>
        (
          await handleResetImportWizardState(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
          )
        ).body,
    ),
  )

export const getImportAdministrationMappings = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      importWizardMappingsQuery,
      data,
      async (query) =>
        (await handleGetImportAdministrationMappings(await contextFromRequest(), query)).body,
    ),
  )
