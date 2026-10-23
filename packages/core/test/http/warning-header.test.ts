import { describe, expect, it } from 'vitest'
import {
  decodeWarningMessagesHeader,
  encodeWarningMessagesHeader,
} from '../../src/http/warning-header.js'
import {
  moneybirdSelfAssessedExportBanner,
  moneybirdUntaggedVatExportBanner,
} from '../../src/index.js'

describe('XAF warning-messages header encoding', () => {
  it('round-trips non-ASCII Dutch banners without corrupting the header', () => {
    const messages = [
      moneybirdUntaggedVatExportBanner('nl'),
      moneybirdSelfAssessedExportBanner('nl'),
      'Rekening 1500: €21,00 te weinig',
    ]
    expect(messages.some((message) => /[éë€]/.test(message))).toBe(true)

    const encoded = encodeWarningMessagesHeader(messages)
    // HTTP headers must stay ASCII.
    expect(/^[\x20-\x7E]*$/.test(encoded)).toBe(true)
    expect(encoded).not.toContain('é')
    expect(encoded).not.toContain('€')

    expect(decodeWarningMessagesHeader(encoded)).toEqual(messages)
  })

  it('still accepts legacy raw JSON for a soft upgrade path', () => {
    const legacy = JSON.stringify(['plain ascii warning'])
    expect(decodeWarningMessagesHeader(legacy)).toEqual(['plain ascii warning'])
  })
})
