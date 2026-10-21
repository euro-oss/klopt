import { describe, expect, it } from 'vitest'
import {
  ECB_RATE_UPSERT_BATCH_SIZE,
  ECB_RATE_UPSERT_PARAMS_PER_ROW,
  ecbRateUpsertBatchCount,
} from '../src/repositories/ecb-rates.js'

describe('EcbRateRepository upsert batching', () => {
  it('keeps each statement under Postgres 65_535 bind parameters', () => {
    expect(ECB_RATE_UPSERT_BATCH_SIZE * ECB_RATE_UPSERT_PARAMS_PER_ROW).toBeLessThan(65_535)
    expect(ECB_RATE_UPSERT_BATCH_SIZE).toBe(1_000)
  })

  it('splits large upserts into 1_000-row statements', () => {
    expect(ecbRateUpsertBatchCount(0)).toBe(0)
    expect(ecbRateUpsertBatchCount(1)).toBe(1)
    expect(ecbRateUpsertBatchCount(1_000)).toBe(1)
    expect(ecbRateUpsertBatchCount(1_001)).toBe(2)
    expect(ecbRateUpsertBatchCount(221_470)).toBe(222)
  })
})
