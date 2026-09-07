import { createServerFn } from '@tanstack/react-start'
import {
  handleConfirmMatch,
  handleCreateBankAccount,
  handleIgnoreTransaction,
  handleImportStatement,
  handleListBankAccounts,
  handleListBankTransactions,
  handleListMatchRules,
  handleSetMatchRuleActive,
  handleSuggestMatches,
} from '~/api/handlers/bank'
import {
  confirmMatchBody,
  createBankAccountBody,
  importStatementBody,
  transactionsQuery,
} from '~/api/schemas'
import { contextFromRequest, run, runWith } from './internal'

/** The banking screens' RPC surface. Same handlers as `/api/v1/bank-*`. */

function keyOf(input: unknown): string | undefined {
  const value = (input as { idempotencyKey?: unknown } | null)?.idempotencyKey
  return typeof value === 'string' && value !== '' ? value : undefined
}

export const listBankAccounts = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListBankAccounts(await contextFromRequest())).body),
)

export const createBankAccount = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      createBankAccountBody,
      data,
      async (body) =>
        (
          await handleCreateBankAccount(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const importStatement = createServerFn({ method: 'POST' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      importStatementBody,
      data,
      async (body) =>
        (
          await handleImportStatement(
            await contextFromRequest({ idempotencyKey: keyOf(data) }),
            body,
          )
        ).body,
    ),
  )

export const listBankTransactions = createServerFn({ method: 'GET' })
  .validator((input: unknown) => input)
  .handler(async ({ data }) =>
    runWith(
      transactionsQuery,
      data,
      async (query) => (await handleListBankTransactions(await contextFromRequest(), query)).body,
    ),
  )

export const suggestMatches = createServerFn({ method: 'GET' })
  .validator((input: { transactionId: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () => (await handleSuggestMatches(await contextFromRequest(), data.transactionId)).body,
    ),
  )

export const confirmMatch = createServerFn({ method: 'POST' })
  .validator((input: { transactionId: string; idempotencyKey: string; body: unknown }) => input)
  .handler(async ({ data }) =>
    runWith(
      confirmMatchBody,
      data.body,
      async (body) =>
        (
          await handleConfirmMatch(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.transactionId,
            body,
          )
        ).body,
    ),
  )

export const ignoreTransaction = createServerFn({ method: 'POST' })
  .validator((input: { transactionId: string; idempotencyKey: string }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleIgnoreTransaction(
            await contextFromRequest({ idempotencyKey: data.idempotencyKey }),
            data.transactionId,
          )
        ).body,
    ),
  )

export const listMatchRules = createServerFn({ method: 'GET' }).handler(async () =>
  run(async () => (await handleListMatchRules(await contextFromRequest())).body),
)

export const setMatchRuleActive = createServerFn({ method: 'POST' })
  .validator((input: { ruleId: string; isActive: boolean }) => input)
  .handler(async ({ data }) =>
    run(
      async () =>
        (
          await handleSetMatchRuleActive(await contextFromRequest(), data.ruleId, {
            isActive: data.isActive,
          })
        ).body,
    ),
  )
