import { describe, expect, it } from 'vitest'
import { ProductionLogEmailError, resolveEmailTransport } from '../../src/email/resolve.js'
import { createMemoryEmailTransport } from '../../src/email/transport.js'

describe('resolveEmailTransport', () => {
  it('falls back to the log transport outside production', () => {
    const transport = resolveEmailTransport({ NODE_ENV: 'development' })
    expect(transport.name).toBe('log')
  })

  it('refuses the log transport in production', () => {
    expect(() => resolveEmailTransport({ NODE_ENV: 'production' })).toThrow(ProductionLogEmailError)
  })

  it('prefers an outbox directory over the log in production', () => {
    const transport = resolveEmailTransport({
      NODE_ENV: 'production',
      KLOPT_EMAIL_OUTBOX_DIR: '/tmp/klopt-outbox-test',
    })
    expect(transport.name).toBe('file')
  })
})

describe('createMemoryEmailTransport', () => {
  it('records what it was asked to send', async () => {
    const transport = createMemoryEmailTransport()
    await transport.send({ to: 'a@b.test', subject: 'hi', text: 'body' })
    expect(transport.sent).toHaveLength(1)
  })
})
