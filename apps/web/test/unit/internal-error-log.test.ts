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
      'Jan Jansen',
      'NL02INGB0999999999',
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
      expect(logged).not.toContain('Jan Jansen')
      expect(logged).not.toContain('NL02INGB0999999999')
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

  const userinfoFrame = '    at foo (postgres://u:pw@h:5432/x:1:2)'
  const ibanFrame = '    at NL91ABNA0417164300:1:2'
  const personFrame = '    at Jan Jansen NL91ABNA0417164300 (/app/x.js:1:2)'

  function assertShapeSecretsAbsent(logged: string): void {
    expect(logged).not.toContain('postgres://u:pw@h:5432/x')
    expect(logged).not.toContain('u:pw')
    expect(logged).not.toContain('NL91ABNA0417164300')
    expect(logged).not.toContain('NL91 ABNA 0417 1643 00')
    expect(logged).not.toContain('Jan Jansen')
    expect(logged).not.toContain('foo (postgres')
  }

  it('drops a userinfo location instead of logging the function name', () => {
    const error = new Error('plain failure')
    error.stack = `${error.stack ?? ''}\n${userinfoFrame}`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-userinfo')

    expect(response.status).toBe(500)
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertShapeSecretsAbsent(logged)
    expect(logged).toContain('    at ')
    expect(logged).not.toContain('ModuleJob.run')
  })

  it('redacts an account-number token used as a path:line:col location', () => {
    const error = new Error('plain failure')
    error.stack = `${error.stack ?? ''}\n${ibanFrame}\n    at /files/NL20INGB0001234567/app.js:4:5`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    problemResponse(error, 'NL20 INGB 0001 2345 67')

    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertShapeSecretsAbsent(logged)
    expect(logged).not.toContain('NL20INGB0001234567')
    expect(logged).not.toContain('NL20 INGB')
    expect(logged).toContain('[iban]')
    expect(logged).toContain('/files/')
    expect(logged).toContain('app.js:4:5')
  })

  it('logs the file location and drops the person and account number in the name', () => {
    const error = new Error('plain failure')
    error.stack = `${error.stack ?? ''}\n${personFrame}`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    problemResponse(error, 'req-person')

    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertShapeSecretsAbsent(logged)
    expect(logged).toContain('    at /app/x.js:1:2')
    expect(logged).not.toContain('ModuleJob.run')
  })

  it('drops those shapes when a cause chain is glued onto the stack', () => {
    const cause = new Error('downstream')
    cause.stack = `${cause.stack ?? ''}\n${userinfoFrame}\n${ibanFrame}\n${personFrame}`
    const error = new Error('outer failure', { cause })
    error.stack = `${error.stack ?? ''}\nCaused by: ${cause.stack ?? ''}`
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-glued')

    expect(response.status).toBe(500)
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertShapeSecretsAbsent(logged)
    expect(logged).not.toContain('downstream')
    expect(logged).toContain('    at /app/x.js:1:2')
    expect(logged).toContain('    at ')
  })

  it('drops those shapes when the message is replaced after the stack is read', () => {
    const error = new Error(`note\n${userinfoFrame}\n${ibanFrame}\n${personFrame}`)
    const frozen = error.stack
    if (typeof frozen !== 'string') throw new Error('expected a stack')
    error.stack = frozen
    error.message = 'other words'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = problemResponse(error, 'req-swap-shape')

    expect(response.status).toBe(500)
    const logged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    assertShapeSecretsAbsent(logged)
    expect(logged).not.toContain('other words')
    expect(logged).not.toContain('note')
    expect(logged).toContain('    at /app/x.js:1:2')
  })

  it('returns a 500 when name, message, stack, or cause getters throw', () => {
    const error = new Error('plain failure')
    Object.defineProperty(error, 'cause', {
      configurable: true,
      get() {
        throw new Error('NL20INGB0001234567')
      },
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const withCause = problemResponse(error, 'req-cause-getter')
    expect(withCause.status).toBe(500)
    const causeLogged = spy.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    expect(causeLogged).not.toContain('NL20INGB0001234567')
    expect(causeLogged).toContain('    at ')
    spy.mockRestore()

    const thrown = new Error('plain failure')
    for (const key of ['name', 'message', 'stack', 'cause'] as const) {
      Object.defineProperty(thrown, key, {
        configurable: true,
        get() {
          throw new Error('NL91ABNA0417164300 Jan Jansen postgres://u:pw@h:5432/x')
        },
      })
    }
    const again = vi.spyOn(console, 'error').mockImplementation(() => {})
    let response: Response | undefined
    expect(() => {
      response = problemResponse(thrown, 'req-getter')
    }).not.toThrow()
    expect(response?.status).toBe(500)
    expect(again).toHaveBeenCalled()
    expect(again.mock.calls[0]?.[2]).toBe('Error')
    const logged = again.mock.calls
      .flat()
      .map((part) => String(part))
      .join('\n')
    expect(logged).toContain('(no stack)')
    expect(logged).not.toContain('NL91ABNA0417164300')
    expect(logged).not.toContain('Jan Jansen')
    expect(logged).not.toContain('postgres://u:pw@h:5432/x')
  })
})
