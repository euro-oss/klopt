import { createServerFn } from '@tanstack/react-start'
import { setActiveEntity } from '@klopt/db'
import { getRequest } from '@tanstack/react-start/server'
import {
  handleGetJournalEntry,
  handleListAccounts,
  handleListJournalEntries,
  handleGetTrialBalance,
  handlePostJournalEntry,
  handleReverseJournalEntry,
  handleVerifyChain,
} from '~/api/handlers/ledger'
import {
  handleCloseYear,
  handleGetBalanceSheet,
  handleGetProfitAndLoss,
  handleGetRgsCoverage,
  handleSetRgsMappings,
} from '~/api/handlers/compliance'
import {
  closeYearBody,
  listEntriesQuery,
  postJournalEntryBody,
  reverseJournalEntryBody,
  rgsMappingsBody,
  statementQuery,
  trialBalanceQuery,
} from '~/api/schemas'
import { getDatabase } from '~/api/database'
import { resolveMemberships } from '~/api/auth'
import { contextFromRequest, run, runWith } from './internal'

/**
 * The UI's RPC surface. Every one of these is three lines: resolve context,
 * parse, call the handler that `/api/v1` calls.
 */

export const listAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListAccounts(await contextFromRequest())).body),
)

export const getRgsCoverage = createServerFn({ method: 'GET' })
  .validator((input: { currency?: string; applicableFlag?: string | null }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleGetRgsCoverage(await contextFromRequest(), {
            currency: data.currency ?? 'EUR',
            applicableFlag: data.applicableFlag ?? null,
          })
        ).body,
    ),
  )

export const setRgsMappings = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      rgsMappingsBody,
      data,
      async (body) => (await handleSetRgsMappings(await contextFromRequest(), body)).body,
    ),
  )

export const getTrialBalance = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      trialBalanceQuery,
      data,
      async (body) => (await handleGetTrialBalance(await contextFromRequest(), body)).body,
    ),
  )

export const getBalanceSheet = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      statementQuery,
      data,
      async (body) => (await handleGetBalanceSheet(await contextFromRequest(), body)).body,
    ),
  )

export const getProfitAndLoss = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      statementQuery,
      data,
      async (body) => (await handleGetProfitAndLoss(await contextFromRequest(), body)).body,
    ),
  )

export const listEntries = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      listEntriesQuery,
      data,
      async (body) => (await handleListJournalEntries(await contextFromRequest(), body)).body,
    ),
  )

export const getEntry = createServerFn({ method: 'GET' })
  .validator((input: { entryId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => (await handleGetJournalEntry(await contextFromRequest(), data.entryId)).body),
  )

export const verifyChain = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleVerifyChain(await contextFromRequest())).body),
)

export const postEntry = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      postJournalEntryBody,
      data,
      async (body) => (await handlePostJournalEntry(await contextFromRequest(), body)).body,
    ),
  )

export const reverseEntry = createServerFn({ method: 'POST' })
  .validator(
    (input: { entryId: string; bookingDate: string; description?: string | null }) => input,
  )
  .handler(async ({ data }) =>
    runWith(
      reverseJournalEntryBody,
      { bookingDate: data.bookingDate, description: data.description ?? null },
      async (body) =>
        (await handleReverseJournalEntry(await contextFromRequest(), data.entryId, body)).body,
    ),
  )

export const closeYear = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      closeYearBody,
      data,
      async (body) => (await handleCloseYear(await contextFromRequest(), body)).body,
    ),
  )

/** Switch which entity's books this session is looking at. */
export const switchEntity = createServerFn({ method: 'POST' })
  .validator((input: { entityId: string }) => input)
  .handler(async ({ data }) =>
    run(async () => {
      const database = getDatabase()
      const session = await resolveMemberships(database, getRequest())
      if (session === null) throw new Error('Not signed in.')

      const allowed = session.memberships.some(
        (membership) => membership.entityId === data.entityId,
      )
      // The membership check matters: without it the entity id in a request
      // body would be enough to read another company's books.
      if (!allowed) throw new Error('No such entity.')

      await setActiveEntity(database, session.sessionToken, data.entityId)
      return { entityId: data.entityId }
    }),
  )
