import type { FilingPayload, FilingReceipt, FilingTransport } from '@klopt/core'

/**
 * Filing by hand, which is a first-class path.
 *
 * Spec 7.2 is unambiguous: "Do not make a self-hoster buy a certificate to be
 * compliant. The manual path must be a first-class, well-documented flow." A
 * PKIoverheid services certificate is a few hundred euro a year per legal
 * entity, plus an aansluitformulier to Logius, and requiring that of somebody
 * with one BV and four invoices a quarter would make the product a toy for
 * everybody else.
 *
 * So this is not a stub. It produces the instance and the summary, hands them
 * over, and tells the operator exactly what to do with them — and it records
 * the whole thing, so the evidence chain is the same shape as Digipoort's. The
 * only difference is who presses the last button.
 *
 * `status` reports what it knows, which is nothing beyond what the operator
 * told us. That is honest: nobody polled anything. The screen asks for the
 * confirmation number from Mijn Belastingdienst and stores it, and *that* is
 * the confirmation.
 */

const INSTRUCTIONS = [
  'Meld je aan op Mijn Belastingdienst Zakelijk en kies Omzetbelasting > Aangifte doen.',
  'Neem de bedragen uit de samenvatting over. Alle bedragen zijn hele euro’s.',
  'Verstuur de aangifte en noteer het ontvangstbewijs.',
  'Vul het kenmerk van dat ontvangstbewijs hier in, zodat het bij deze periode bewaard blijft.',
].join('\n')

export function createManualFilingTransport(
  options: { readonly now?: () => Date } = {},
): FilingTransport {
  const now = options.now ?? (() => new Date())

  return {
    kind: 'manual',
    name: 'manual',

    // Needs nothing, which is the point. Never unavailable.
    available: () => ({ ok: true, reason: null }),

    deliver(payload: FilingPayload): Promise<FilingReceipt> {
      return Promise.resolve({
        transport: 'manual',
        // Not `delivered`: nothing has been delivered anywhere. The instance
        // and the summary exist and it is the operator's turn.
        status: 'prepared',
        reference: null,
        at: now().toISOString(),
        // The instance is the evidence of what was prepared, even on the path
        // where a human retypes the figures.
        request: payload.instanceXml,
        response: null,
        error: null,
        instructions: INSTRUCTIONS,
      })
    },

    status(reference: string): Promise<FilingReceipt> {
      return Promise.resolve({
        transport: 'manual',
        status: 'prepared',
        reference,
        at: now().toISOString(),
        request: null,
        response: null,
        error: null,
        instructions:
          'Deze aangifte is met de hand ingediend, dus er is niets om te bevragen. De status is wat je zelf hebt vastgelegd.',
      })
    },
  }
}
