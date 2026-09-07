import { describe, expect, it } from 'vitest'
import { presentInvoice, type InvoicePresentation } from '@klopt/core'
import { createInvoicePdfRenderer } from '../../src/pdf/index.js'

/**
 * The PDF renderer.
 *
 * What is worth asserting about a drawn document, and what is not. Not: where
 * anything sits, which is geometry nobody can review in a test. Yes: that it is
 * a structurally valid PDF of one page, that the strings `presentInvoice`
 * decided on actually reach the content stream, and that an attached UBL is
 * really embedded — because "the PDF came out and the attachment silently
 * didn't" is the failure mode of the fallback transport.
 *
 * pdfkit compresses content streams, so the text assertions decompress them
 * rather than grepping the file. Grepping would pass on an empty page.
 */

const presentation = (): InvoicePresentation =>
  presentInvoice({
    profile: 'peppol-bis-3',
    kind: 'invoice',
    number: 'VRK-2026-00042',
    issueDate: '2026-03-15',
    dueDate: '2026-04-14',
    currency: 'EUR',
    buyerReference: 'KOSTENPLAATS-42',
    orderReference: null,
    note: null,
    precedingInvoiceNumber: null,
    precedingInvoiceIssueDate: null,
    seller: {
      legalName: 'De Tol Beheer B.V.',
      tradingName: 'Speelgoedwinkel De Tol',
      street: 'Keizersgracht',
      houseNumber: '123-B',
      postalCode: '1015 CJ',
      city: 'Amsterdam',
      countryCode: 'NL',
      vatNumber: 'NL123456789B01',
      kvkNumber: '12345678',
      electronicAddress: '12345678',
      electronicAddressScheme: '0106',
      contactName: null,
      phone: null,
      email: 'facturen@detol.nl',
    },
    buyer: {
      legalName: 'Grote Klant N.V.',
      tradingName: null,
      street: 'Coolsingel',
      houseNumber: '42',
      postalCode: '3011 AD',
      city: 'Rotterdam',
      countryCode: 'NL',
      vatNumber: 'NL987654321B01',
      kvkNumber: '87654321',
      electronicAddress: '87654321',
      electronicAddressScheme: '0106',
      contactName: null,
      phone: null,
      email: null,
    },
    iban: 'NL02ABNA0123456789',
    bic: 'ABNANL2A',
    net: 100_000n,
    tax: 21_000n,
    total: 121_000n,
    lines: [
      {
        lineNumber: 1,
        description: 'Advieswerk maart 2026',
        quantity: '10',
        unitCode: 'HUR',
        unitPrice: 10_000n,
        net: 100_000n,
        tax: 21_000n,
        ublCategory: 'S',
        rateBasisPoints: 2100,
        taxDescription: 'BTW hoog 21%',
      },
    ],
  })

/**
 * Every content stream in the document, decompressed.
 *
 * `stream` also occurs inside `endstream`, and the payload starts after the
 * newline that follows the keyword — getting either wrong yields an empty
 * string, which then makes every text assertion pass vacuously. Hence the care.
 */
async function streamsOf(bytes: Uint8Array): Promise<string> {
  const { inflateSync } = await import('node:zlib')
  const buffer = Buffer.from(bytes)
  const latin = buffer.toString('latin1')
  const found: string[] = []

  let at = latin.indexOf('stream')
  while (at !== -1) {
    if (latin.slice(at - 3, at) !== 'end') {
      const from = at + (latin[at + 6] === '\r' ? 8 : 7)
      const end = latin.indexOf('endstream', from)
      if (end !== -1) {
        const slice = buffer.subarray(from, end)
        try {
          found.push(inflateSync(slice).toString('latin1'))
        } catch {
          // Not deflated. An uncompressed stream is still worth reading.
          found.push(slice.toString('latin1'))
        }
      }
    }
    at = latin.indexOf('stream', at + 6)
  }

  if (found.length === 0) throw new Error('No streams found; the extractor is wrong.')
  return found.join('\n')
}

/**
 * The words in a content stream.
 *
 * PDF text is `(literal) Tj` or `<hex> Tj`, and pdfkit writes hex. Reading only
 * the parenthesised form finds nothing and looks like a blank page.
 */
function readable(content: string): string {
  const literals = [...content.matchAll(/\((?:[^()\\]|\\.)*\)/g)].map((match) =>
    match[0].slice(1, -1).replace(/\\([()\\])/g, '$1'),
  )

  const hex = [...content.matchAll(/<([0-9A-Fa-f]{2,})>/g)].map((match) =>
    Buffer.from(match[1]!, 'hex').toString('latin1'),
  )

  return [...literals, ...hex].join(' ')
}

/**
 * Compare with whitespace removed.
 *
 * pdfkit emits a separate text run per kerning pair, so the extracted text of
 * "Factuur" is "F actuur". That is correct PDF and useless for an assertion, so
 * both sides lose their spaces.
 */
function squash(value: string): string {
  return value.replace(/\s+/g, '')
}

describe('rendering an invoice', () => {
  it('produces a one-page PDF', async () => {
    const rendered = await createInvoicePdfRenderer().renderInvoice(presentation())
    const text = Buffer.from(rendered.bytes).toString('latin1')

    expect(rendered.contentType).toBe('application/pdf')
    expect(rendered.filename).toBe('VRK-2026-00042.pdf')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    expect(/\/Count\s+1\b/.test(text)).toBe(true)
  })

  it('puts the words on the page, not only in the model', async () => {
    const rendered = await createInvoicePdfRenderer().renderInvoice(presentation())
    const words = readable(await streamsOf(rendered.bytes))

    for (const expected of [
      'Factuur',
      'VRK-2026-00042',
      'Speelgoedwinkel De Tol',
      'Grote Klant N.V.',
      'Advieswerk maart 2026',
      // The total, formatted the Dutch way, exactly as the screen shows it.
      '1.210,00',
      'NL123456789B01',
      // And the payment instruction, which is the point of sending it.
      'NL02ABNA0123456789',
      // The VAT breakdown, so the recipient can check the arithmetic.
      'Btw 21%',
    ]) {
      expect(squash(words), expected).toContain(squash(expected))
    }
  })

  it('prints the legal notice when no VAT is charged', async () => {
    const source = presentation()
    const rendered = await createInvoicePdfRenderer().renderInvoice({
      ...source,
      notices: ['Btw verlegd.'],
    })

    expect(squash(readable(await streamsOf(rendered.bytes)))).toContain(squash('Btw verlegd.'))
  })

  it('embeds the UBL when asked, so the fallback transport is one file', async () => {
    const xml = '<?xml version="1.0"?><Invoice><ID>VRK-2026-00042</ID></Invoice>'
    const rendered = await createInvoicePdfRenderer().renderInvoice(presentation(), {
      attachUbl: { filename: 'VRK-2026-00042.ubl.xml', xml },
    })
    const raw = Buffer.from(rendered.bytes).toString('latin1')

    expect(raw).toContain('EmbeddedFiles')
    expect(raw).toContain('VRK-2026-00042.ubl.xml')
    // `Alternative` says the XML is the same invoice, not an extra document.
    expect(raw).toContain('Alternative')
    // The bytes really are in there.
    expect(await streamsOf(rendered.bytes)).toContain('<ID>VRK-2026-00042</ID>')
  })

  it('embeds nothing when not asked', async () => {
    const rendered = await createInvoicePdfRenderer().renderInvoice(presentation())
    expect(Buffer.from(rendered.bytes).toString('latin1')).not.toContain('EmbeddedFiles')
  })

  it('grows the page rather than overwriting a wrapped description', async () => {
    const source = presentation()
    const long = 'Advieswerk, '.repeat(40)
    const rendered = await createInvoicePdfRenderer().renderInvoice({
      ...source,
      rows: Array.from({ length: 30 }, (_, index) => ({
        description: `${String(index + 1)}. ${long}`,
        quantity: '1 EA',
        unitPrice: '100,00',
        taxCode: '21%',
        net: '100,00',
      })),
    })

    const text = Buffer.from(rendered.bytes).toString('latin1')
    // Thirty wrapped rows do not fit on one page, and they must not be drawn
    // on top of each other.
    expect(/\/Count\s+([2-9]|\d\d)\b/.test(text)).toBe(true)
  })
})
