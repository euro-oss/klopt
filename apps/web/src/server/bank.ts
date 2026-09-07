import { createServerFn } from '@tanstack/react-start'
import {
  handleCreateBankAccount,
  handleImportStatement,
  handleListBankAccounts,
  handleListBankTransactions,
} from '~/api/handlers/bank'
import { createBankAccountBody, importStatementBody, transactionsQuery } from '~/api/schemas'
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
