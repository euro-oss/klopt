import { afterEach, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  secretsAvailable,
  SecretKeyMissingError,
  SecretKeyTooShortError,
} from '../src/secrets.js'

const LONG_KEY = 'test-key-not-for-production-0123456789'

afterEach(() => {
  process.env['KLOPT_ENCRYPTION_KEY'] = LONG_KEY
})

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    process.env['KLOPT_ENCRYPTION_KEY'] = LONG_KEY
    const stored = encryptSecret('mailbox-password')
    expect(decryptSecret(stored)).toBe('mailbox-password')
  })

  it('returns null when the ciphertext is tampered with', () => {
    process.env['KLOPT_ENCRYPTION_KEY'] = LONG_KEY
    const stored = encryptSecret('secret')
    const parts = stored.split('.')
    parts[4] = Buffer.from('tampered').toString('base64url')
    expect(decryptSecret(parts.join('.'))).toBeNull()
  })

  it('refuses when the key is missing', () => {
    delete process.env['KLOPT_ENCRYPTION_KEY']
    expect(secretsAvailable()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(SecretKeyMissingError)
    expect(decryptSecret('v1.a.b.c.d')).toBeNull()
  })

  it('refuses a key shorter than 32 bytes', () => {
    process.env['KLOPT_ENCRYPTION_KEY'] = 'too-short'
    expect(secretsAvailable()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(SecretKeyTooShortError)
  })
})
