import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { closeDatabase, createDatabase, runMigrations, type Database } from '../src/index.js'
import { advancedModeFor, setAdvancedModeFor } from '../src/repositories/advanced-mode.js'
import { users } from '../src/schema/auth.js'

/**
 * Geavanceerd preference is per user row (issue #44 server storage).
 *
 * Read and write always filter by the caller-supplied user id — the web layer
 * must pass the session user and never a client-provided id. These tests pin
 * that one account cannot observe or overwrite another's choice.
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

async function insertUser(id: string, email: string): Promise<void> {
  await database.insert(users).values({
    id,
    name: email,
    email,
    emailVerified: true,
  })
}

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 4 })
})

afterAll(async () => {
  await closeDatabase(database)
})

describe('advancedModeFor / setAdvancedModeFor', () => {
  it('starts null and remembers an explicit choice for that user only', async () => {
    const a = `adv-a-${Date.now()}`
    const b = `adv-b-${Date.now()}`
    await insertUser(a, `${a}@example.test`)
    await insertUser(b, `${b}@example.test`)

    expect(await advancedModeFor(database, a)).toBeNull()
    expect(await advancedModeFor(database, b)).toBeNull()

    await setAdvancedModeFor(database, a, true)

    expect(await advancedModeFor(database, a)).toBe(true)
    expect(await advancedModeFor(database, b)).toBeNull()

    await setAdvancedModeFor(database, a, false)
    expect(await advancedModeFor(database, a)).toBe(false)
    expect(await advancedModeFor(database, b)).toBeNull()
  })

  it('does not let user A overwrite user B when writing with A id', async () => {
    const a = `adv-write-a-${Date.now()}`
    const b = `adv-write-b-${Date.now()}`
    await insertUser(a, `${a}@example.test`)
    await insertUser(b, `${b}@example.test`)

    await setAdvancedModeFor(database, b, true)
    await setAdvancedModeFor(database, a, false)

    expect(await advancedModeFor(database, a)).toBe(false)
    expect(await advancedModeFor(database, b)).toBe(true)

    const [rowB] = await database
      .select({ advancedMode: users.advancedMode })
      .from(users)
      .where(eq(users.id, b))
      .limit(1)
    expect(rowB?.advancedMode).toBe(true)
  })

  it('does not let user A read user B preference via A id', async () => {
    const a = `adv-read-a-${Date.now()}`
    const b = `adv-read-b-${Date.now()}`
    await insertUser(a, `${a}@example.test`)
    await insertUser(b, `${b}@example.test`)

    await setAdvancedModeFor(database, b, true)

    expect(await advancedModeFor(database, a)).toBeNull()
    expect(await advancedModeFor(database, b)).toBe(true)
  })
})
