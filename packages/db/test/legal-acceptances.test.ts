import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uuidv7 } from '@klopt/core'
import { closeDatabase, createDatabase, runMigrations, type Database } from '../src/index.js'
import { LegalAcceptancesRepository } from '../src/repositories/legal-acceptances.js'
import { users } from '../src/schema/auth.js'

/**
 * Hosted terms/DPA acceptance and invitee privacy-notice records (issue #138).
 */

const DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgres://klopt:klopt@localhost:5432/klopt'

let database: Database

beforeAll(async () => {
  await runMigrations(DATABASE_URL)
  database = createDatabase({ url: DATABASE_URL, maxConnections: 2 })
})

afterAll(async () => {
  await closeDatabase(database)
})

async function insertUser(email: string): Promise<string> {
  const id = `user_${uuidv7()}`
  await database.insert(users).values({
    id,
    name: '',
    email,
    emailVerified: true,
  })
  return id
}

describe('LegalAcceptancesRepository', () => {
  it('writes who, when, and which terms/DPA versions were accepted', async () => {
    const userId = await insertUser(`legal-accept-${uuidv7()}@example.test`)
    const repository = new LegalAcceptancesRepository(database)
    const before = new Date()

    const record = await repository.recordTermsDpa({
      id: uuidv7(),
      userId,
      termsVersion: '2026-11-02',
      dpaVersion: '2026-11-02-dpa',
    })

    expect(record.kind).toBe('terms_dpa')
    expect(record.userId).toBe(userId)
    expect(record.termsVersion).toBe('2026-11-02')
    expect(record.dpaVersion).toBe('2026-11-02-dpa')
    expect(record.privacyVersion).toBeNull()
    expect(record.recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000)

    const listed = await repository.listForUser(userId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(record.id)
  })

  it('records that the privacy notice was shown (invitee first sign-in)', async () => {
    const userId = await insertUser(`legal-privacy-${uuidv7()}@example.test`)
    const repository = new LegalAcceptancesRepository(database)
    expect(await repository.hasPrivacyNotice(userId)).toBe(false)

    const record = await repository.recordPrivacyNoticeShown({
      id: uuidv7(),
      userId,
      privacyVersion: '2026-11-02-privacy',
    })

    expect(record.kind).toBe('privacy_notice')
    expect(record.privacyVersion).toBe('2026-11-02-privacy')
    expect(record.termsVersion).toBeNull()
    expect(record.dpaVersion).toBeNull()
    expect(await repository.hasPrivacyNotice(userId)).toBe(true)
    expect(await repository.listPrivacyForUser(userId)).toHaveLength(1)
  })

  it('lists nothing when no acceptance was recorded (env unset / never called)', async () => {
    const userId = await insertUser(`legal-unset-${uuidv7()}@example.test`)
    const repository = new LegalAcceptancesRepository(database)
    expect(await repository.listForUser(userId)).toEqual([])
    expect(await repository.hasPrivacyNotice(userId)).toBe(false)
  })
})
