import { expect } from 'vitest'

/**
 * Assert that a database operation failed with a particular Postgres error.
 *
 * Drizzle wraps driver errors in a `Failed query: ...` message and hangs the
 * real one off `cause`, so a plain `rejects.toThrow(/append-only/)` passes
 * against the wrapper text and tells you nothing. This walks the chain and
 * asserts on what Postgres actually said.
 */
export async function expectDatabaseError(
  operation: Promise<unknown>,
  pattern: RegExp,
): Promise<void> {
  const error = await operation.then(
    () => null,
    (caught: unknown) => caught,
  )

  expect(error, 'expected the operation to fail, but it succeeded').not.toBeNull()

  const messages: string[] = []
  let current: unknown = error
  while (current instanceof Error) {
    messages.push(current.message)
    current = current.cause
  }

  expect(messages.join('\n')).toMatch(pattern)
}
