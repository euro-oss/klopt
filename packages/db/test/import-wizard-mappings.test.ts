/**
 * Per-administration mappings survive disconnect (#100 / migration 0037).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ImportWizardRepository,
  MoneybirdConnectionRepository,
  closeDatabase,
  createDatabase,
  encryptSecret,
  runMigrations,
  type Database,
} from '../src/index.js'
import { seedEntity } from '../src/testing.js'
import { TEST_DATABASE_URL } from './support/fixture.js'

describe('import administration mappings (#100)', () => {
  let database: Database

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL)
    database = createDatabase({ url: TEST_DATABASE_URL, maxConnections: 4 })
    // Ensure encryptSecret works for connection rows in this process.
    if (process.env['KLOPT_ENCRYPTION_KEY'] === undefined) {
      process.env['KLOPT_ENCRYPTION_KEY'] = Buffer.alloc(32, 7).toString('base64')
    }
    void encryptSecret
  })

  afterAll(async () => {
    await closeDatabase(database)
  })

  it('keeps mappings after the Moneybird connection is removed', async () => {
    const entityId = await seedEntity(database)

    await database.transaction(async (tx) => {
      const connections = new MoneybirdConnectionRepository(tx)
      const wizard = new ImportWizardRepository(tx)

      await connections.upsertToken({
        entityId,
        baseUrl: 'https://moneybird.com/api/v2',
        apiToken: 'test-token-for-mappings',
      })
      await connections.chooseAdministration({
        entityId,
        id: 'admin-42',
        name: 'Voorbeeld BV',
        currency: 'EUR',
      })
      await connections.saveMappings({
        entityId,
        accountMappings: { '1': '4000' },
        taxMappings: { '10': 'VH21' },
        importDecisions: { excludedYears: ['2024'] },
      })
      await wizard.upsertMappings({
        entityId,
        source: 'moneybird',
        administrationId: 'admin-42',
        accountMappings: { '1': '4000' },
        taxMappings: { '10': 'VH21' },
        importDecisions: { excludedYears: ['2024'] },
      })

      await connections.remove(entityId)
      expect(await connections.find(entityId)).toBeNull()

      const kept = await wizard.findMappings(entityId, 'moneybird', 'admin-42')
      expect(kept).not.toBeNull()
      expect(kept?.accountMappings).toEqual({ '1': '4000' })
      expect(kept?.taxMappings).toEqual({ '10': 'VH21' })
      expect(kept?.importDecisions.excludedYears).toEqual(['2024'])
    })
  })

  it('restores saved mappings when the same administration is chosen again', async () => {
    const entityId = await seedEntity(database)

    await database.transaction(async (tx) => {
      const connections = new MoneybirdConnectionRepository(tx)
      const wizard = new ImportWizardRepository(tx)

      await wizard.upsertMappings({
        entityId,
        source: 'moneybird',
        administrationId: 'admin-99',
        accountMappings: { '7': '8000' },
        taxMappings: { '20': 'H21' },
        importDecisions: { excludedExternalIds: ['sales_invoice:1'] },
      })

      await connections.upsertToken({
        entityId,
        baseUrl: 'https://moneybird.com/api/v2',
        apiToken: 'reconnect-token',
      })
      const saved = await wizard.findMappings(entityId, 'moneybird', 'admin-99')
      expect(saved).not.toBeNull()
      await connections.chooseAdministration({
        entityId,
        id: 'admin-99',
        name: 'Herconnect BV',
        currency: 'EUR',
      })
      await connections.saveMappings({
        entityId,
        accountMappings: saved!.accountMappings,
        taxMappings: saved!.taxMappings,
        importDecisions: saved!.importDecisions,
      })

      const live = await connections.find(entityId)
      expect(live?.accountMappings).toEqual({ '7': '8000' })
      expect(live?.taxMappings).toEqual({ '20': 'H21' })
      expect(live?.importDecisions.excludedExternalIds).toEqual(['sales_invoice:1'])
    })
  })

  it('persists wizard resume state per entity', async () => {
    const entityId = await seedEntity(database)

    await database.transaction(async (tx) => {
      const wizard = new ImportWizardRepository(tx)
      const saved = await wizard.upsertWizardState({
        entityId,
        source: 'moneybird',
        step: 'btw',
        administrationId: 'admin-1',
        selectedYears: ['2025', '2026'],
        previewStale: false,
      })
      expect(saved.step).toBe('btw')
      expect(saved.selectedYears).toEqual(['2025', '2026'])

      const again = await wizard.findWizardState(entityId)
      expect(again?.step).toBe('btw')
      expect(again?.source).toBe('moneybird')

      await wizard.clearWizardState(entityId)
      expect(await wizard.findWizardState(entityId)).toBeNull()
    })
  })
})
