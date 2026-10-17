import { describe, expect, it } from 'vitest'
import { floorElapsed, SEND_OTP_SILENT_FLOOR_MS } from '../src/timing.js'

describe('floorElapsed', () => {
  it('waits until the floor has passed', async () => {
    const started = Date.now()
    await floorElapsed(started, 40)
    expect(Date.now() - started).toBeGreaterThanOrEqual(35)
  })

  it('returns immediately when the floor is already met', async () => {
    const started = Date.now() - 200
    const before = Date.now()
    await floorElapsed(started, 50)
    expect(Date.now() - before).toBeLessThan(30)
  })

  it('exposes a positive silent-send floor for invite-only OTP', () => {
    expect(SEND_OTP_SILENT_FLOOR_MS).toBeGreaterThan(0)
  })
})
