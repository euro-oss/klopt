import { describe, expect, it } from 'vitest'
import {
  contentDispositionHeader,
  isInlineSafeContentType,
  sanitizeContentDispositionFilename,
} from '../../src/documents/disposition.js'

describe('isInlineSafeContentType', () => {
  it.each([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/pdf; charset=binary',
  ])('allows %s inline', (type) => {
    expect(isInlineSafeContentType(type)).toBe(true)
  })

  it.each([
    'text/html',
    'image/svg+xml',
    'application/xml',
    'text/plain',
    'application/octet-stream',
  ])('forces attachment for %s', (type) => {
    expect(isInlineSafeContentType(type)).toBe(false)
  })
})

describe('sanitizeContentDispositionFilename', () => {
  it('strips quotes and control characters', () => {
    expect(sanitizeContentDispositionFilename('a"b\nc.pdf')).toBe('a_b_c.pdf')
  })

  it('falls back when empty', () => {
    expect(sanitizeContentDispositionFilename('   ')).toBe('document')
  })
})

describe('contentDispositionHeader', () => {
  it('serves PDF inline with a sanitized name', () => {
    const result = contentDispositionHeader('application/pdf', 'quote"me.pdf')
    expect(result.disposition).toBe('inline')
    expect(result.header).toContain('inline;')
    expect(result.header).toContain('filename="quote_me.pdf"')
    expect(result.header).toContain("filename*=UTF-8''")
  })

  it('serves HTML as attachment', () => {
    const result = contentDispositionHeader('text/html', 'x.html')
    expect(result.disposition).toBe('attachment')
    expect(result.header.startsWith('attachment;')).toBe(true)
  })
})
