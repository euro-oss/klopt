import {
  reminderEmailCopy,
  type EInvoiceDocument,
  type EInvoiceReceipt,
  type EInvoiceRecipient,
  type EInvoiceTransport,
  type EmailTransport,
} from '@klopt/core'

/**
 * The fallback transport: email the UBL and the PDF (spec 7.5).
 *
 * "Not Peppol, but it is what most Dutch SMBs actually exchange today and it
 * keeps a self-hosted instance functional." It is also spec 8's rule 1 — the
 * implementation that needs no third party and is the default in a fresh
 * install. With no SMTP configured the underlying email transport writes to a
 * directory or the log, so an operator can still get the document out; the
 * receipt says `delivered: false` and does not pretend otherwise.
 *
 * The **XML is attached, not inlined**, and the PDF alongside it. A recipient
 * who can parse UBL gets a file their software recognises; one who cannot gets
 * something to look at. Spec 7.5 also allows a PDF with the XML embedded, and
 * the caller may pass exactly that as the PDF — this transport does not care
 * which, because it is a courier.
 */

export interface EmailEInvoiceConfig {
  readonly email: EmailTransport
  /** Where a reply should go. The seller's own address, usually. */
  readonly replyTo?: string | undefined
  readonly productName?: string | undefined
}

function invoiceMessage(document: EInvoiceDocument): { subject: string; text: string } {
  const noun = document.kind === 'credit_note' ? 'Creditnota' : 'Factuur'

  return {
    subject: `${noun} ${document.invoiceNumber} van ${document.sellerName}`,
    text: [
      `Bijgaand ${noun.toLowerCase()} ${document.invoiceNumber} van ${document.sellerName}.`,
      '',
      document.kind === 'credit_note'
        ? `Het bedrag van ${document.total} ${document.currency} wordt gecrediteerd.`
        : `Het bedrag is ${document.total} ${document.currency}, te voldoen voor ${document.dueDate}.`,
      '',
      'De bijlage bevat de factuur zowel als PDF om te lezen als in UBL-formaat',
      'voor uw boekhoudsoftware. Beide bevatten dezelfde gegevens.',
    ].join('\n'),
  }
}

function reminderMessage(
  document: EInvoiceDocument,
  reminder: { stage: number; daysOverdue: number },
): { subject: string; text: string } {
  // Shared with the Reminders preview (#107). Legal: no incassokosten / rente
  // claim until WIK is implemented — see reminderEmailCopy.
  return reminderEmailCopy({
    invoiceNumber: document.invoiceNumber,
    total: document.total,
    currency: document.currency,
    dueDate: document.dueDate,
    stage: reminder.stage,
    daysOverdue: reminder.daysOverdue,
  })
}

export function createEmailEInvoiceTransport(config: EmailEInvoiceConfig): EInvoiceTransport {
  return {
    channel: 'email',
    name: 'email',

    reachable(recipient: EInvoiceRecipient): Promise<boolean> {
      return Promise.resolve(recipient.email !== null && recipient.email.trim() !== '')
    },

    async send(document: EInvoiceDocument, recipient: EInvoiceRecipient): Promise<EInvoiceReceipt> {
      const to = (recipient.email ?? '').trim()

      if (to === '') {
        return {
          channel: 'email',
          transport: 'email',
          delivered: false,
          messageId: null,
          recipient: recipient.name,
          failure: `${recipient.name} has no email address.`,
        }
      }

      const { subject, text } =
        document.reminder === undefined
          ? invoiceMessage(document)
          : reminderMessage(document, document.reminder)

      try {
        const result = await config.email.send({
          to,
          subject,
          text,
          ...(config.replyTo === undefined ? {} : { replyTo: config.replyTo }),
          // The evidence chain wants to know which document this message was.
          reference: `invoice:${document.invoiceNumber}`,
          attachments: [
            ...(document.pdf === undefined
              ? []
              : [
                  {
                    filename: document.pdf.filename,
                    contentType: document.pdf.contentType,
                    content: document.pdf.content,
                  },
                ]),
            {
              filename: document.xmlFilename,
              contentType: 'application/xml',
              content: document.xml,
            },
          ],
        })

        return {
          channel: 'email',
          transport: result.transport,
          delivered: result.delivered,
          messageId: result.messageId,
          recipient: to,
          // A transport that logged rather than sent is not a failure to
          // report — it is a deployment with no SMTP, and `delivered` says so.
          failure: null,
        }
      } catch (error: unknown) {
        return {
          channel: 'email',
          transport: 'email',
          delivered: false,
          messageId: null,
          recipient: to,
          failure: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
