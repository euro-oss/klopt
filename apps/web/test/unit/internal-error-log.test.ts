import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerError } from '@klopt/core'
import { ApiError, problemResponse } from '../../src/api/errors.js'

/**
 * Unknown 500s used to leave the process log empty. The response must stay
 * generic. The log names the request, the error's name, and the frames.
 * `error.stack` begins with the message, and a driver message can quote a
 * row, so that text must not be logged. A message line that itself begins
 * with `    at ` is still the message. A stack that is not a string, and a
 * throw that is not an Error, log no frames and must not throw.
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

  it('does not log a message line that begins with a stack frame marker', async () => {
    const error = new Error('duplicate key\n    at NL91ABNA0417164300 Eva\nstill the message')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-frame-msg')

    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string; requestId: string }
    expect(body.detail).toBe('The request could not be completed.')
    expect(body.requestId).toBe('req-frame-msg')

    expect(spy).toHaveBeenCalledTimes(1)
    const args = spy.mock.calls.flat().map((part) => String(part))
    const logged = args.join('\n')
    expect(logged).not.toContain('    at NL91ABNA0417164300 Eva')
    expect(logged).not.toContain('NL91ABNA0417164300')
    expect(logged).not.toContain('Eva')
    expect(logged).not.toContain('duplicate key')
    expect(logged).not.toContain('still the message')
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-frame-msg')
    expect(logged).toContain(error.name)
    expect(args.some((arg) => arg.includes('    at '))).toBe(true)
  })

  it('logs no frames when error.stack is not a string', async () => {
    const stacks = [undefined, { row: '    at NL91ABNA0417164300 Eva' }, 12]
    for (const stack of stacks) {
      const error = new Error('driver quoted NL91ABNA0417164300 Eva')
      Object.defineProperty(error, 'stack', { configurable: true, value: stack })
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = problemResponse(error, 'req-nostack')

      expect(response.status).toBe(500)
      const body = (await response.json()) as { detail: string }
      expect(body.detail).toBe('The request could not be completed.')
      expect(spy).toHaveBeenCalledTimes(1)
      const logged = spy.mock.calls
        .flat()
        .map((part) => String(part))
        .join('\n')
      expect(logged).toContain('[api] internal_error')
      expect(logged).toContain('req-nostack')
      expect(logged).toContain(error.name)
      expect(logged).toContain('(no stack)')
      expect(logged).not.toContain('    at ')
      expect(logged).not.toContain('NL91ABNA0417164300')
      expect(logged).not.toContain('Eva')
      expect(logged).not.toContain('driver quoted')
      spy.mockRestore()
    }
  })

  it('logs a non-Error throw safely', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const thrown = Object.create(null) as { stack: unknown; message: string }
    thrown.stack = { at: '    at NL91ABNA0417164300 Eva' }
    thrown.message = '    at NL91ABNA0417164300 Eva'

    const response = problemResponse(thrown, 'req-throw')

    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('NL91ABNA0417164300')
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    expect(logged).toContain('req-throw')
    expect(logged).toContain('thrown object')
    expect(logged).not.toContain('    at ')
    expect(logged).not.toContain('NL91ABNA0417164300')
    expect(logged).not.toContain('Eva')
  })

  /**
   * Frame-shaped, and not a V8 location. The values sit where a row would.
   */
  const planted = [
    '    at NL02INGB0999999999 Sanne Bakker',
    '    at postgres://u:s3cr3t@h/db',
    '    at Sanne Bakker (postgres://u:s3cr3t@h/db)',
    '    at readFile (NL02INGB0999999999)',
  ].join('\n')

  function assertPlantedAbsent(logged: string): void {
    expect(logged).not.toContain('NL02INGB0999999999')
    expect(logged).not.toContain('Sanne Bakker')
    expect(logged).not.toContain('Sanne')
    expect(logged).not.toContain('Bakker')
    expect(logged).not.toContain('postgres://u:s3cr3t@h/db')
    expect(logged).not.toContain('s3cr3t')
  }

  it('does not log secrets in an overwritten stack', async () => {
    const error = new Error('plain failure')
    error.stack = `${error.stack ?? ''}\n${planted}`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-overwritten')

    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string }
    expect(body.detail).toBe('The request could not be completed.')
    expect(spy).toHaveBeenCalledTimes(1)
    const args = spy.mock.calls.flat().map((part) => String(part))
    const logged = args.join('\n')
    assertPlantedAbsent(logged)
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-overwritten')
    expect(logged).toContain(error.name)
    expect(args.some((arg) => arg.includes('    at '))).toBe(true)
  })

  it('does not log secrets in a cause chain appended to the stack', () => {
    const error = new Error('outer failure')
    const cause = new Error('downstream NL02INGB0999999999 Sanne Bakker postgres://u:s3cr3t@h/db')
    error.stack = `${error.stack ?? ''}\nCaused by: ${cause.stack ?? ''}\n${planted}`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-cause')

    expect(response.status).toBe(500)
    expect(spy).toHaveBeenCalledTimes(1)
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertPlantedAbsent(logged)
    expect(logged).not.toContain('downstream')
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-cause')
    expect(logged).toContain(error.name)
    expect(logged).toContain('    at ')
  })

  it('does not log secrets when the message is replaced after the stack is read', async () => {
    const error = new Error(
      `driver quoted NL02INGB0999999999 Sanne Bakker\n${planted}\nstill postgres://u:s3cr3t@h/db`,
    )
    const frozen = error.stack
    if (typeof frozen !== 'string') throw new Error('expected a stack')
    error.stack = frozen
    error.message = 'replaced'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-swap')

    expect(response.status).toBe(500)
    const body = (await response.json()) as { detail: string }
    expect(body.detail).toBe('The request could not be completed.')
    expect(spy).toHaveBeenCalledTimes(1)
    const args = spy.mock.calls.flat().map((part) => String(part))
    const logged = args.join('\n')
    assertPlantedAbsent(logged)
    expect(logged).not.toContain('driver quoted')
    expect(logged).not.toContain('replaced')
    expect(logged).toContain('[api] internal_error')
    expect(logged).toContain('req-swap')
    expect(logged).toContain(error.name)
    expect(args.some((arg) => arg.includes('    at '))).toBe(true)
  })

  it('logs Error when error.name is not an identifier', () => {
    const badNames = [
      'Sanne Bakker',
      'postgres://u:s3cr3t@h/db',
      'TypeError NL02INGB0999999999',
      '123Boom',
      '',
    ]
    for (const name of badNames) {
      const error = new Error('plain failure')
      error.name = name
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const response = problemResponse(error, 'req-name')

      expect(response.status).toBe(500)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0]?.[2]).toBe('Error')
      const logged = spy.mock.calls
        .flat()
        .map((part) => String(part))
        .join('\n')
      assertPlantedAbsent(logged)
      expect(logged).toContain('[api] internal_error')
      expect(logged).toContain('req-name')
      spy.mockRestore()
    }

    const error = new Error('plain failure')
    error.name = 'PostgresError'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    problemResponse(error, 'req-name-ok')
    expect(spy.mock.calls[0]?.[2]).toBe('PostgresError')
  })
})
