import { describe, expect, it } from 'vitest'
import { SetupRepository } from '../src/repositories/setup.js'
import { createFixture } from './support/fixture.js'

describe('SetupRepository.createFiscalYear', () => {
  it('returns one created row and one existing row when two opens race', async () => {
    const fixture = await createFixture({ fiscalYearCode: '2026' })
    try {
      const repository = new SetupRepository(fixture.database)
      const [first, second] = await Promise.all([
        repository.createFiscalYear(fixture.entityId, '2027'),
        repository.createFiscalYear(fixture.entityId, '2027'),
      ])

      expect(first.code).toBe('2027')
      expect(second.code).toBe('2027')
      expect(first.created !== second.created).toBe(true)
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })
})
