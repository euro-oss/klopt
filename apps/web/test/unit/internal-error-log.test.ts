import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@klopt/core'
import { ApiError, problemResponse } from '../../src/api/errors.js'

/**
 * Unknown 500s used to leave the process log empty. The response must stay
 * generic — a stack can name a query — and the log must name the request
 * without echoing a body somebody threw.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('unknown internal errors', () => {
  it('logs the request id and the stack, and hides the message', async () => {
    const error = new Error('connection refused at postgres://klopt:secret@db/klopt')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-pdf-1')

    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string; requestId: string }
    expect(body.detail).toBe('The request could not be completed.')
    expect(body.detail).not.toContain('secret')
    expect(body.requestId).toBe('req-pdf-1')

    expect(spy).toHaveBeenCalledTimes(1)
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-pdf-1')
    expect(logged).toContain('connection refused')
    expect(logged).toContain('internal-error-log.test.ts')
  })

  it('does not log a known API or ledger rejection', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const api = problemResponse(new ApiError('not_found', 'No such invoice.'), 'req-2')
    const ledger = problemResponse(new LedgerError([]), 'req-3')

    expect(api.status).toBe(404)
    expect(ledger.status).toBe(422)
    expect(spy).not.toHaveBeenCalled()
  })

  it('does not dump a thrown value that is not an Error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse({ body: 'customer-iban-NL02ABNA0123456789' }, null)

    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('NL02ABNA')
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    expect(logged).toContain('(no request id)')
    expect(logged).toContain('thrown object')
    expect(logged).not.toContain('NL02ABNA')
    expect(logged).not.toContain('customer-iban')
  })
})
