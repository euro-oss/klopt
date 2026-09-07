import { XmlWriter, escapeXml } from '@klopt/core'
import type { FilingPayload, FilingReceipt, FilingStatus, FilingTransport } from '@klopt/core'

/**
 * Digipoort, straight to Logius (spec 7.2).
 *
 * Logius publishes a connection manual for companies wanting to connect their
 * own software, so this is not vendor-only. What it requires:
 *
 *   - the WUS 2.0 for Companies interface: SOAP with WS-Addressing, two-way
 *     TLS, WS-Security message signing;
 *   - an `Aanleverservice` call and a `Statusinformatieservice` poll;
 *   - a PKIoverheid services certificate for production, per legal entity;
 *   - an aansluitformulier submitted to Logius.
 *
 * ## What is here, and what is honestly not
 *
 * The envelopes are here and they are tested against golden files: they are the
 * fiddly, mechanical part, and they are the part that can be got right without
 * a certificate. The two-way TLS is here, through `node:https`, because a
 * client certificate is configuration rather than cryptography.
 *
 * **The WS-Security message signature is a seam with no default.** Signing
 * means exclusive XML canonicalisation and an enveloped RSA-SHA256 signature
 * over the body and the addressing headers, and a subtly wrong canonicalisation
 * produces a signature Digipoort rejects with a message that says nothing about
 * why. That cannot be verified from a test suite — it needs a test certificate
 * and a run against Logius's pre-production environment. Shipping an
 * unverifiable signer and calling the transport done would be the same mistake
 * as shipping a schematron engine nobody had run: see
 * docs/decisions/0017-schematron-in-process.md for the precedent, and
 * docs/decisions/0024-the-manual-path-is-the-default.md for this decision.
 *
 * So `available()` returns false, with the reason, until a signer is supplied.
 * The operator sees a greyed-out option that explains itself rather than an
 * error after generating a filing, and nobody is told an unsigned envelope was
 * accepted.
 *
 * Nothing here throws. A refused delivery is `failed` with the response kept
 * verbatim, because "we tried and they would not take it" and "we did not file"
 * are different facts and only one of them is a penalty.
 */

const SOAP = 'http://schemas.xmlsoap.org/soap/envelope/'
const WSA = 'http://www.w3.org/2005/08/addressing'

/** The koppelvlak namespaces. Version-pinned, because Logius versions them. */
const AANLEVEREN_NS = 'http://logius.nl/digipoort/koppelvlakservices/1.2/'
const STATUS_NS = 'http://logius.nl/digipoort/koppelvlakservices/1.2/'

const AANLEVEREN_ACTION =
  'http://logius.nl/digipoort/koppelvlakservices/1.2/aanleverservice/aanleveren'
const STATUS_ACTION =
  'http://logius.nl/digipoort/koppelvlakservices/1.2/statusinformatieservice/getStatussenProces'

/**
 * Signs a SOAP envelope for WS-Security.
 *
 * Given the envelope this module built, return the envelope with a
 * `wsse:Security` header containing an X.509 token and an enveloped signature.
 * Deliberately a whole-document transform rather than "give me a digest": how
 * much of the envelope is signed, and how it is canonicalised, is the part that
 * has to be right, and it is not this module's to decide.
 */
export interface DigipoortSigner {
  readonly name: string
  sign(envelope: string): Promise<string>
}

export interface DigipoortOptions {
  /** The Aanleverservice endpoint. Pre-production and production differ. */
  readonly deliverUrl: string
  readonly statusUrl: string
  /** PEM. The PKIoverheid services certificate and its key. */
  readonly clientCertificate?: string
  readonly clientKey?: string
  readonly clientKeyPassphrase?: string
  /** PEM. The chain to verify Logius against, when not in the system store. */
  readonly certificateAuthority?: string
  readonly signer?: DigipoortSigner
  /** `Omzetbelasting`. Logius calls this the berichtsoort. */
  readonly messageKind?: string
  readonly timeoutMs?: number
  readonly now?: () => Date
  readonly newMessageId?: () => string
  /**
   * Test seam. Replaces the whole HTTPS call, because a real one needs a
   * certificate and a counterparty and neither belongs in a test suite.
   */
  readonly post?: (
    url: string,
    body: string,
    action: string,
  ) => Promise<{ readonly status: number; readonly body: string }>
}

/**
 * The `aanleveren` request.
 *
 * Exported so a golden test can read it. The instance travels base64-encoded
 * inside `berichtInhoud`, which is why the payload is not signed as XML in its
 * own right: Digipoort signs the envelope, and the envelope carries bytes.
 */
export function buildAanleverenEnvelope(request: {
  readonly payload: FilingPayload
  readonly messageKind: string
  readonly messageId: string
  readonly to: string
  readonly reference: string
}): string {
  const writer = new XmlWriter()
  writer.open('soapenv:Envelope', {
    'xmlns:soapenv': SOAP,
    'xmlns:wsa': WSA,
    'xmlns:kv': AANLEVEREN_NS,
  })

  writer.open('soapenv:Header')
  writer.leaf('wsa:Action', AANLEVEREN_ACTION)
  writer.leaf('wsa:MessageID', request.messageId)
  writer.leaf('wsa:To', request.to)
  writer.close('soapenv:Header')

  writer.open('soapenv:Body')
  writer.open('kv:aanleveren')
  writer.leaf('kv:berichtsoort', request.messageKind)
  // Our own reference, echoed back on every status response. This is how a
  // filing is tied to the period it belongs to when the answer arrives later.
  writer.leaf('kv:aanleverkenmerk', request.reference)

  writer.open('kv:identiteitBelanghebbende')
  writer.leaf('kv:nummer', omzetbelastingnummer(request.payload.vatNumber))
  // `Fi` is the fiscaal nummer. The entity files for itself, so the
  // belanghebbende is the entity.
  writer.leaf('kv:type', 'Fi')
  writer.close('kv:identiteitBelanghebbende')

  writer.leaf('kv:rolBelanghebbende', 'Bedrijf')

  writer.open('kv:berichtInhoud')
  writer.leaf('kv:mimeType', 'application/xml')
  writer.leaf(
    'kv:bestandsnaam',
    `${request.payload.isSuppletie ? 'suppletie' : 'aangifte'}-ob-${request.payload.periodCode}.xbrl`,
  )
  writer.leaf('kv:inhoud', Buffer.from(request.payload.instanceXml, 'utf8').toString('base64'))
  writer.close('kv:berichtInhoud')

  // Present and empty: the schema has the element, and this filing has no
  // attachments. Omitting it entirely is a different document.
  writer.empty('kv:berichtBijlagen')

  writer.close('kv:aanleveren')
  writer.close('soapenv:Body')
  writer.close('soapenv:Envelope')

  return `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`
}

/** The `getStatussenProces` request: the Statusinformatieservice poll. */
export function buildStatusEnvelope(request: {
  readonly reference: string
  readonly messageId: string
  readonly to: string
}): string {
  const writer = new XmlWriter()
  writer.open('soapenv:Envelope', {
    'xmlns:soapenv': SOAP,
    'xmlns:wsa': WSA,
    'xmlns:kv': STATUS_NS,
  })

  writer.open('soapenv:Header')
  writer.leaf('wsa:Action', STATUS_ACTION)
  writer.leaf('wsa:MessageID', request.messageId)
  writer.leaf('wsa:To', request.to)
  writer.close('soapenv:Header')

  writer.open('soapenv:Body')
  writer.open('kv:getStatussenProces')
  writer.leaf('kv:kenmerk', request.reference)
  writer.close('kv:getStatussenProces')
  writer.close('soapenv:Body')
  writer.close('soapenv:Envelope')

  return `<?xml version="1.0" encoding="UTF-8"?>\n${writer.toString()}`
}

function omzetbelastingnummer(vatNumber: string): string {
  const normalised = vatNumber.toUpperCase().replace(/\s/g, '')
  return normalised.startsWith('NL') ? normalised.slice(2) : normalised
}

/** First match of an element's text, whatever prefix it carries. */
function elementText(xml: string, localName: string): string | null {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${escapeRegExp(localName)}(?:\\s[^>]*)?>([^<]*)</(?:[A-Za-z0-9_.-]+:)?${escapeRegExp(localName)}>`,
  )
  const found = pattern.exec(xml)
  return found?.[1]?.trim() ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Digipoort's status codes onto ours.
 *
 * Exported because the mapping is judgement, not mechanism. Anything
 * unrecognised is `delivered`: Logius has the filing and we do not know the
 * Belastingdienst's verdict. Reading an unknown code as `accepted` would report
 * a rejected aangifte as done.
 */
export function mapDigipoortStatus(code: string | null): FilingStatus {
  if (code === null) return 'delivered'
  const normalised = code.trim().toLowerCase()
  if (normalised.includes('afgekeurd') || normalised.includes('reject')) return 'rejected'
  if (normalised.includes('fout') || normalised.includes('error')) return 'failed'
  if (
    normalised.includes('verwerkt') ||
    normalised.includes('geaccepteerd') ||
    normalised.includes('accept')
  ) {
    return 'accepted'
  }
  return 'delivered'
}

async function postOverMutualTls(
  url: string,
  body: string,
  action: string,
  options: DigipoortOptions,
): Promise<{ status: number; body: string }> {
  // `node:https` rather than fetch: a client certificate is what makes this
  // two-way TLS, and it is an agent-level setting that fetch does not expose
  // without a dispatcher.
  const { request: httpsRequest } = await import('node:https')

  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const outgoing = httpsRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port === '' ? 443 : Number(target.port),
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        timeout: options.timeoutMs ?? 60_000,
        cert: options.clientCertificate,
        key: options.clientKey,
        passphrase: options.clientKeyPassphrase,
        ca: options.certificateAuthority,
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          soapaction: `"${action}"`,
          'content-length': String(Buffer.byteLength(body, 'utf8')),
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    outgoing.on('timeout', () => {
      outgoing.destroy(
        new Error(`Digipoort antwoordde niet binnen ${String(options.timeoutMs ?? 60_000)}ms.`),
      )
    })
    outgoing.on('error', reject)
    outgoing.write(body, 'utf8')
    outgoing.end()
  })
}

export function createDigipoortTransport(options: DigipoortOptions): FilingTransport {
  const now = options.now ?? (() => new Date())
  const newMessageId = options.newMessageId ?? (() => `uuid:${crypto.randomUUID()}`)
  const messageKind = options.messageKind ?? 'Omzetbelasting'
  const post =
    options.post ?? ((url, body, action) => postOverMutualTls(url, body, action, options))

  function unavailable(): { ok: boolean; reason: string | null } {
    const missing: string[] = []
    if (options.deliverUrl === '') missing.push('KLOPT_DIGIPOORT_DELIVER_URL')
    if (options.clientCertificate === undefined || options.clientCertificate === '') {
      missing.push('een PKIoverheid-servicescertificaat (KLOPT_DIGIPOORT_CERT)')
    }
    if (options.clientKey === undefined || options.clientKey === '') {
      missing.push('de bijbehorende sleutel (KLOPT_DIGIPOORT_KEY)')
    }
    if (options.signer === undefined) {
      missing.push(
        'een WS-Security-ondertekenaar. Die zit niet in Klopt: het ondertekenen vraagt exclusieve XML-canonicalisatie en dat is niet te verifiëren zonder een testcertificaat en een proefrun tegen de preproductieomgeving van Logius. Zie docs/decisions/0024',
      )
    }

    if (missing.length === 0) return { ok: true, reason: null }
    return {
      ok: false,
      reason: `Digipoort is niet ingericht. Wat ontbreekt: ${missing.join('; ')}. Zolang dit niet klaar is, dient de handmatige weg de aangifte in — dat is een volwaardige route, geen noodoplossing.`,
    }
  }

  return {
    kind: 'digipoort',
    name: 'digipoort',
    available: unavailable,

    async deliver(payload: FilingPayload): Promise<FilingReceipt> {
      const at = now().toISOString()
      const ready = unavailable()

      if (!ready.ok) {
        return {
          transport: 'digipoort',
          status: 'failed',
          reference: null,
          at,
          request: null,
          response: null,
          error: ready.reason,
          instructions: null,
        }
      }

      if (!payload.taxonomyVerified) {
        return {
          transport: 'digipoort',
          status: 'failed',
          reference: null,
          at,
          request: null,
          response: null,
          error: `De taxonomie-mapping ${payload.taxonomyVersion} is niet gecontroleerd tegen de gepubliceerde Nederlandse Taxonomie, dus deze instance gaat niet naar de Belastingdienst.`,
          instructions: null,
        }
      }

      // Our own reference travels with the filing and comes back on every
      // status response, which is what ties an answer to a period.
      const reference = `KLOPT-${payload.periodCode}-${payload.isSuppletie ? 'S' : 'A'}`
      const envelope = buildAanleverenEnvelope({
        payload,
        messageKind,
        messageId: newMessageId(),
        to: options.deliverUrl,
        reference,
      })

      let signed: string
      try {
        // Non-null: `unavailable()` above proved the signer is there.
        signed = await options.signer!.sign(envelope)
      } catch (error: unknown) {
        return {
          transport: 'digipoort',
          status: 'failed',
          reference: null,
          at,
          request: envelope,
          response: null,
          error: `Het ondertekenen van het bericht is mislukt: ${error instanceof Error ? error.message : String(error)}`,
          instructions: null,
        }
      }

      let result: { status: number; body: string }
      try {
        result = await post(options.deliverUrl, signed, AANLEVEREN_ACTION)
      } catch (error: unknown) {
        return {
          transport: 'digipoort',
          status: 'failed',
          reference: null,
          at,
          request: signed,
          response: null,
          error: `Digipoort is niet bereikbaar: ${error instanceof Error ? error.message : String(error)}`,
          instructions: null,
        }
      }

      // Digipoort answers a fault with 500 and a SOAP Fault body, which is
      // worth keeping: the faultstring is the only explanation there will be.
      if (result.status >= 400) {
        return {
          transport: 'digipoort',
          status: 'failed',
          reference: null,
          at,
          request: signed,
          response: result.body,
          error:
            elementText(result.body, 'faultstring') ??
            `Digipoort antwoordde ${String(result.status)}.`,
          instructions: null,
        }
      }

      // The `kenmerk` is Digipoort's message id, and it is what the
      // Statusinformatieservice is polled with.
      const kenmerk = elementText(result.body, 'kenmerk')

      return {
        transport: 'digipoort',
        // Delivered, not accepted: Logius took the bytes. Whether the
        // Belastingdienst is content is what the poll is for.
        status: 'delivered',
        reference: kenmerk ?? reference,
        at,
        request: signed,
        response: result.body,
        error:
          kenmerk === null
            ? 'Digipoort accepteerde het bericht maar gaf geen kenmerk terug, dus de status kan niet worden opgevraagd.'
            : null,
        instructions:
          'Digipoort heeft het bericht ontvangen. Vraag de status op tot de Belastingdienst de aangifte heeft verwerkt — ontvangen is nog niet geaccepteerd.',
      }
    },

    async status(reference: string): Promise<FilingReceipt> {
      const at = now().toISOString()
      const ready = unavailable()

      if (!ready.ok) {
        return {
          transport: 'digipoort',
          status: 'delivered',
          reference,
          at,
          request: null,
          response: null,
          error: ready.reason,
          instructions: null,
        }
      }

      const envelope = buildStatusEnvelope({
        reference,
        messageId: newMessageId(),
        to: options.statusUrl,
      })

      let signed: string
      try {
        signed = await options.signer!.sign(envelope)
      } catch (error: unknown) {
        return {
          transport: 'digipoort',
          status: 'delivered',
          reference,
          at,
          request: envelope,
          response: null,
          error: `Het ondertekenen van de statusvraag is mislukt: ${error instanceof Error ? error.message : String(error)}`,
          instructions: null,
        }
      }

      let result: { status: number; body: string }
      try {
        result = await post(options.statusUrl, signed, STATUS_ACTION)
      } catch (error: unknown) {
        return {
          transport: 'digipoort',
          // The filing's own state has not changed; we could not ask. Recording
          // this as failed would make an outage look like a rejection.
          status: 'delivered',
          reference,
          at,
          request: signed,
          response: null,
          error: `Digipoort is niet bereikbaar: ${error instanceof Error ? error.message : String(error)}`,
          instructions: null,
        }
      }

      if (result.status >= 400) {
        return {
          transport: 'digipoort',
          status: 'delivered',
          reference,
          at,
          request: signed,
          response: result.body,
          error:
            elementText(result.body, 'faultstring') ??
            `Digipoort antwoordde ${String(result.status)}.`,
          instructions: null,
        }
      }

      const code = elementText(result.body, 'statuscode')
      const omschrijving = elementText(result.body, 'statusomschrijving')

      return {
        transport: 'digipoort',
        status: mapDigipoortStatus(omschrijving ?? code),
        reference,
        at,
        request: signed,
        response: result.body,
        error: null,
        instructions: omschrijving === null ? null : `Belastingdienst: ${escapeXml(omschrijving)}`,
      }
    },
  }
}
