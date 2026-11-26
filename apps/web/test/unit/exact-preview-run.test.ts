import { describe, expect, it } from 'vitest'
import { exactPreviewStateAfterRun, runExactPreviewLoad } from '../../src/lib/exact-preview-run'

describe('exactPreviewStateAfterRun', () => {
  it('clears loadFailed and sets preview on success', () => {
    const data = { accounts: {} }
    expect(exactPreviewStateAfterRun({ kind: 'success', data })).toEqual({
      preview: data,
      loadFailed: false,
    })
  })

  it('nulls preview and sets loadFailed on failure', () => {
    expect(exactPreviewStateAfterRun({ kind: 'failure' })).toEqual({
      preview: null,
      loadFailed: true,
    })
  })
})

describe('runExactPreviewLoad', () => {
  it('returns failure when the load throws', async () => {
    await expect(runExactPreviewLoad(() => Promise.reject(new Error('network')))).resolves.toEqual({
      kind: 'failure',
    })
  })

  it('returns failure when ok is false', async () => {
    await expect(runExactPreviewLoad(() => Promise.resolve({ ok: false }))).resolves.toEqual({
      kind: 'failure',
    })
  })

  it('returns success with data when ok', async () => {
    const data = { taxCodes: 3 }
    await expect(runExactPreviewLoad(() => Promise.resolve({ ok: true, data }))).resolves.toEqual({
      kind: 'success',
      data,
    })
  })
})
