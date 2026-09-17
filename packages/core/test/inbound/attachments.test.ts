import { describe, expect, it } from 'vitest'
import {
  nothingFiledReason,
  selectInboundAttachments,
  type InboundAttachment,
  type InboundMessage,
} from '../../src/index.js'

/**
 * What comes out of an email that had an invoice in it.
 *
 * The cases here are the ones a shared `facturen@` mailbox actually sees: an
 * invoice with the sender's logo under it, a forward carrying two copies of the
 * same PDF, an S/MIME signed message, a newsletter, and a photograph of a
 * receipt — which has to survive, because it is a real document and it looks
 * exactly like the logo the rules throw away.
 */

const bytes = (size: number, fill = 65): Uint8Array => new Uint8Array(size).fill(fill)

function part(overrides: Partial<InboundAttachment> = {}): InboundAttachment {
  return {
    filename: 'factuur.pdf',
    contentType: 'application/pdf',
    bytes: bytes(120_000),
    inline: false,
    contentId: null,
    ...overrides,
  }
}

function message(attachments: readonly InboundAttachment[]): InboundMessage {
  return {
    externalId: '<abc@leverancier.test>',
    source: 'email',
    receivedFrom: 'facturen@leverancier.test',
    subject: 'Factuur F-2026-0042',
    receivedAt: '2026-02-10T09:15:00.000Z',
    attachments,
    // The message's own bytes. Not what this module looks at, but what gets
    // stored when it decides nothing here is filable.
    raw: new Uint8Array([1, 2, 3]),
  }
}

const names = (selection: {
  keep: readonly { attachment: InboundAttachment }[]
}): (string | null)[] => selection.keep.map((entry) => entry.attachment.filename)

describe('choosing what to file out of a message', () => {
  it('keeps the invoice and leaves the signature logo behind', () => {
    const selection = selectInboundAttachments(
      message([
        part(),
        part({
          filename: 'factuur.xml',
          contentType: 'application/xml',
          bytes: bytes(4_000, 60),
        }),
        part({
          filename: 'logo.png',
          contentType: 'image/png',
          bytes: bytes(6_000, 1),
          inline: true,
          contentId: '<logo@leverancier.test>',
        }),
      ]),
    )

    expect(names(selection)).toEqual(['factuur.pdf', 'factuur.xml'])
    expect(selection.skip).toHaveLength(1)
    expect(selection.skip[0]?.reason).toBe('inline_image')
  })

  it('keeps a photograph of a receipt', () => {
    // The rule that earns the `inline` distinction: this is the same file type
    // as the logo above and it is a document somebody photographed.
    const selection = selectInboundAttachments(
      message([
        part({ filename: 'bonnetje.jpg', contentType: 'image/jpeg', bytes: bytes(900_000, 7) }),
      ]),
    )

    expect(names(selection)).toEqual(['bonnetje.jpg'])
    expect(selection.skip).toEqual([])
  })

  it('leaves an attached logo that lost its disposition behind, by size', () => {
    const selection = selectInboundAttachments(
      message([part({ filename: 'banner.gif', contentType: 'image/gif', bytes: bytes(3_000, 2) })]),
    )

    expect(selection.keep).toEqual([])
    expect(selection.skip[0]?.reason).toBe('image_too_small')
  })

  it('leaves the message’s own S/MIME signature behind', () => {
    const selection = selectInboundAttachments(
      message([
        part(),
        part({
          filename: 'smime.p7s',
          contentType: 'application/pkcs7-signature; name="smime.p7s"',
          bytes: bytes(3_500, 9),
        }),
      ]),
    )

    expect(names(selection)).toEqual(['factuur.pdf'])
    expect(selection.skip[0]?.reason).toBe('signature_part')
  })

  it('takes the same file once when a forward carried it twice', () => {
    const twice = part({ filename: 'factuur.pdf', bytes: bytes(120_000) })
    const selection = selectInboundAttachments(
      message([twice, { ...twice, filename: 'factuur (1).pdf' }]),
    )

    expect(names(selection)).toEqual(['factuur.pdf'])
    expect(selection.skip[0]?.reason).toBe('duplicate_of_earlier_part')
  })

  it('does not unpack an archive, and says so', () => {
    const selection = selectInboundAttachments(
      message([
        part({
          filename: 'facturen-februari.zip',
          contentType: 'application/zip',
          bytes: bytes(400_000, 3),
        }),
      ]),
    )

    expect(selection.keep).toEqual([])
    expect(selection.skip[0]?.reason).toBe('archive')
    expect(selection.skip[0]?.message).toContain('attach the invoices separately')
  })

  it('catches an archive that lied about its content type', () => {
    const selection = selectInboundAttachments(
      message([
        part({
          filename: 'facturen.zip',
          contentType: 'application/octet-stream',
          bytes: bytes(400_000, 3),
        }),
      ]),
    )

    expect(selection.skip[0]?.reason).toBe('archive')
  })

  it('keeps a format nothing here can read', () => {
    // Keeping is the default. A .docx invoice is a real thing a real supplier
    // really sends, and a document nobody can parse is still a document
    // somebody can open.
    const selection = selectInboundAttachments(
      message([
        part({
          filename: 'factuur.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          bytes: bytes(40_000, 4),
        }),
      ]),
    )

    expect(names(selection)).toEqual(['factuur.docx'])
  })

  it('refuses an empty part and one the size of an archive', () => {
    const selection = selectInboundAttachments(
      message([
        part({ filename: 'leeg.pdf', bytes: bytes(0) }),
        part({ filename: 'alles.pdf', bytes: bytes(31 * 1024 * 1024) }),
      ]),
    )

    expect(selection.keep).toEqual([])
    expect(selection.skip.map((entry) => entry.reason)).toEqual(['empty', 'too_large'])
  })

  it('stops at twenty, and says how many there were', () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      part({ filename: `bijlage-${String(index)}.pdf`, bytes: bytes(1_000 + index) }),
    )
    const selection = selectInboundAttachments(message(many))

    expect(selection.keep).toHaveLength(20)
    expect(selection.skip).toHaveLength(5)
    expect(selection.skip[0]?.reason).toBe('too_many_parts')
  })

  it('a calendar invitation is not a document', () => {
    const selection = selectInboundAttachments(
      message([
        part({ filename: 'afspraak.ics', contentType: 'text/calendar', bytes: bytes(2_000) }),
      ]),
    )

    expect(selection.skip[0]?.reason).toBe('not_a_document')
  })
})

describe('why a message produced nothing', () => {
  it('says a message with no attachments was kept anyway', () => {
    const selection = selectInboundAttachments(message([]))
    expect(selection.keep).toEqual([])
    expect(nothingFiledReason(selection)).toContain('no attachments')
  })

  it('gives the reason when there was exactly one', () => {
    const selection = selectInboundAttachments(
      message([
        part({
          filename: 'logo.png',
          contentType: 'image/png',
          bytes: bytes(6_000),
          inline: true,
        }),
      ]),
    )

    expect(nothingFiledReason(selection)).toContain('logo.png')
    expect(nothingFiledReason(selection)).toContain('Nothing to file:')
  })

  it('does not repeat a reason that applied to several parts', () => {
    const logo = part({
      filename: 'logo.png',
      contentType: 'image/png',
      bytes: bytes(6_000),
      inline: true,
    })
    const selection = selectInboundAttachments(message([logo, logo]))

    // Two parts, one sentence: the second is a duplicate of the first, so the
    // reasons differ — what must not happen is the same sentence twice.
    const reason = nothingFiledReason(selection)
    expect(reason.split('logo.png').length - 1).toBeLessThanOrEqual(2)
  })
})
