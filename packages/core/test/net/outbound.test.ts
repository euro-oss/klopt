import { describe, expect, it } from 'vitest'
import {
  assertSafeHostname,
  assertSafeHttpsUrl,
  isBlockedIp,
  PrivateOutboundError,
} from '../../src/net/outbound.js'

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ])('blocks %s', (address) => {
    expect(isBlockedIp(address)).toBe(true)
  })

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '2001:4860:4860::8888'])(
    'allows %s',
    (address) => {
      expect(isBlockedIp(address)).toBe(false)
    },
  )
})

describe('assertSafeHostname', () => {
  it('refuses loopback names', async () => {
    await expect(assertSafeHostname('localhost', {})).rejects.toBeInstanceOf(PrivateOutboundError)
    await expect(assertSafeHostname('mail.localhost', {})).rejects.toBeInstanceOf(
      PrivateOutboundError,
    )
  })

  it('refuses private IP literals', async () => {
    await expect(assertSafeHostname('127.0.0.1', {})).rejects.toBeInstanceOf(PrivateOutboundError)
    await expect(assertSafeHostname('169.254.169.254', {})).rejects.toBeInstanceOf(
      PrivateOutboundError,
    )
  })

  it('allows a public IP literal', async () => {
    await expect(assertSafeHostname('1.1.1.1', {})).resolves.toBeUndefined()
  })

  it('honours the private-outbound escape hatch', async () => {
    await expect(
      assertSafeHostname('127.0.0.1', { KLOPT_ALLOW_PRIVATE_OUTBOUND: '1' }),
    ).resolves.toBeUndefined()
  })
})

describe('assertSafeHttpsUrl', () => {
  it('refuses http', async () => {
    await expect(assertSafeHttpsUrl('http://example.com/hook', {})).rejects.toBeInstanceOf(
      PrivateOutboundError,
    )
  })

  it('refuses a private https target', async () => {
    await expect(assertSafeHttpsUrl('https://127.0.0.1/hook', {})).rejects.toBeInstanceOf(
      PrivateOutboundError,
    )
  })

  it('allows a public https IP', async () => {
    await expect(assertSafeHttpsUrl('https://1.1.1.1/hook', {})).resolves.toBeUndefined()
  })
})
