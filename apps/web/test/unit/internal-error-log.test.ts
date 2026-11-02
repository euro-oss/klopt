import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@klopt/core'
import { ApiError, problemResponse } from '../../src/api/errors.js'

/**
 * Unknown 500s used to leave the process log empty. The response must stay
 * generic. The log names the request, the error's name, and the frames.
 * `error.stack` begins with the message, and a driver message can quote a
 * row, so that text must not be logged.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('unknown internal errors', () => {
  it('logs the request id, the name, and frames, not the message', async () => {
    const error = new Error(
      'connection refused at postgres://klopt:secret@db/klopt for NL91ABNA0417164300 Eva',
    )
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-pdf-1')

    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string; requestId: string }
    expect(body.detail).toBe('The request could not be completed.')
    expect(body.requestId).toBe('req-pdf-1')

    expect(spy).toHaveBeenCalledTimes(1)
    const args = spy.mock.calls.flat().map((part) => String(part))
    const hidden = [
      'connection refused',
      'postgres://klopt:secret@db/klopt',
      'secret',
      'NL91ABNA0417164300',
      'Eva',
    ]
    for (const arg of args) {
      for (const text of hidden) expect(arg).not.toContain(text)
    }
    const logged = args.join('\n')
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-pdf-1')
    expect(logged).toContain(error.name)
    expect(args.some((arg) => arg.includes('    at '))).toBe(true)
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
