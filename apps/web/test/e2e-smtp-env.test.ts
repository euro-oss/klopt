import { describe, expect, it } from 'vitest'
import { resolveEmailTransport, smtpConfigFromEnvironment } from '@klopt/adapters'
import { E2E_SMTP_BLANK, e2eWebServerEnv, OUTBOX } from '../e2e/server-env'

/**
 * Gate for issue #120: a local e2e run must never resolve the SMTP transport,
 * even when the developer's shell has a full relay export.
 *
 * Playwright's `webServer.env` replaces named keys on the child process; the
 * blanking in `e2eWebServerEnv` is what makes that safe. If a key is dropped
 * from the blank list, this fails before a fixture address is mailed.
 */

describe('e2e webServer email env', () => {
  it('blanks every SMTP key the resolver reads', () => {
    const env = e2eWebServerEnv()
    for (const [key, value] of Object.entries(E2E_SMTP_BLANK)) {
      expect(env[key], key).toBe(value)
      expect(env[key], key).toBe('')
    }
  })

  it('resolves the file outbox, never SMTP, even when the shell has a relay', () => {
    const pollutedShell = {
      KLOPT_SMTP_HOST: 'smtp.example.com',
      KLOPT_SMTP_FROM: 'klopt@example.com',
      KLOPT_SMTP_PORT: '587',
      KLOPT_SMTP_USER: 'user',
      KLOPT_SMTP_PASSWORD: 'secret',
      KLOPT_SMTP_SECURE: 'false',
      KLOPT_SMTP_INSECURE_TLS: 'true',
      KLOPT_EMAIL_OUTBOX_DIR: '/tmp/should-not-win',
      NODE_ENV: 'development',
    }

    // Same merge Playwright applies: named webServer.env keys replace the shell.
    const effective = { ...pollutedShell, ...e2eWebServerEnv(pollutedShell) }

    expect(smtpConfigFromEnvironment(effective)).toBeNull()
    const transport = resolveEmailTransport(effective)
    expect(transport.name).toBe('file')
    expect(effective['KLOPT_EMAIL_OUTBOX_DIR']).toBe(OUTBOX)
  })

  it('keeps the outbox path absolute so a reused cwd cannot hide deliveries', () => {
    expect(OUTBOX.startsWith('/')).toBe(true)
    expect(e2eWebServerEnv()['KLOPT_EMAIL_OUTBOX_DIR']).toBe(OUTBOX)
  })
})
