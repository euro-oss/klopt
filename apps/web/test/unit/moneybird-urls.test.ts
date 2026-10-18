import { describe, expect, it } from 'vitest'
import {
  moneybirdDocumentUrl,
  moneybirdWebOrigin,
  parseMoneybirdExternalId,
} from '../../src/lib/moneybird-urls.js'

describe('moneybirdDocumentUrl', () => {
  it('builds a sales invoice web URL from the API base', () => {
    expect(moneybirdWebOrigin('https://moneybird.com/api/v2')).toBe('https://moneybird.com')
    expect(
      moneybirdDocumentUrl('https://moneybird.com/api/v2', '123456', 'sales_invoice:301'),
    ).toBe('https://moneybird.com/123456/sales_invoices/301')
  })

  it('accepts draft_skipped dotted plan paths', () => {
    expect(parseMoneybirdExternalId('salesInvoices.301')).toEqual({
      kind: 'sales_invoice',
      id: '301',
    })
    expect(
      moneybirdDocumentUrl('https://moneybird.com/api/v2', '123456', 'salesInvoices.301'),
    ).toBe('https://moneybird.com/123456/sales_invoices/301')
    expect(
      moneybirdDocumentUrl('https://moneybird.com/api/v2', '123456', 'purchase_invoices.401'),
    ).toBe('https://moneybird.com/123456/documents/purchase_invoices/401')
    expect(moneybirdDocumentUrl('https://moneybird.com/api/v2', '123456', 'receipts.501')).toBe(
      'https://moneybird.com/123456/documents/receipts/501',
    )
  })

  it('returns null when administration or id is missing', () => {
    expect(moneybirdDocumentUrl('https://moneybird.com/api/v2', null, 'sales_invoice:1')).toBeNull()
    expect(moneybirdDocumentUrl('https://moneybird.com/api/v2', '1', null)).toBeNull()
    expect(moneybirdDocumentUrl('https://moneybird.com/api/v2', '1', 'unknown:1')).toBeNull()
    expect(moneybirdDocumentUrl('https://moneybird.com/api/v2', '1', 'unknownPath.1')).toBeNull()
  })
})
