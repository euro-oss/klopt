import { describe, expect, it } from 'vitest'
import type { FilingPayload } from '@klopt/core'
import {
  buildAanleverenEnvelope,
  buildStatusEnvelope,
  createDigipoortTransport,
  createManualFilingTransport,
  createSbrProviderTransport,
  mapDigipoortStatus,
  mapProviderStatus,
} from '../src/filing/index.js'

/** The adapters always send a JSON string to a string URL; this asserts that. */
function sentTo(url: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof url !== 'string') throw new Error('Expected a string URL.')
  return url
}

function sentBody(init: RequestInit | undefined): string {
  const body = init?.body
  if (typeof body !== 'string') throw new Error('Expected a JSON string body.')
  return body
}

/**
 * The three filing transports, without the Belastingdienst.
 *
 * Nothing here opens a socket. What is worth testing is the judgement: that an
 * outage is not an acceptance, that an unverified taxonomy mapping is never
 * sent anywhere, and that a refusal is recorded rather than thrown.
 */

const PAYLOAD: FilingPayload = {
  instanceXml: '<?xml version="1.0"?>\n<xbrli:xbrl/>\n',
  summary: 'AANGIFTE OMZETBELASTING\n',
  periodCode: '2026-Q1',
  periodFrom: '2026-01-01',
  periodTo: '2026-03-31',
  isSuppletie: false,
  taxonomyVersion: 'NT20',
  taxonomyVerified: true,
  vatNumber: 'NL123456789B01',
  legalName: 'Test Beheer B.V.',
  payableEuros: 210n,
}

const NOW = () => new Date('2026-04-02T09:00:00.000Z')

describe('the manual transport, which is the default', () => {
  const transport = createManualFilingTransport({ now: NOW })

  it('needs nothing and is never unavailable', () => {
    expect(transport.available()).toEqual({ ok: true, reason: null })
  })

  it('prepares rather than delivers, because nobody delivered anything', async () => {
    const receipt = await transport.deliver(PAYLOAD)

    expect(receipt.status).toBe('prepared')
    expect(receipt.transport).toBe('manual')
    expect(receipt.reference).toBeNull()
    expect(receipt.at).toBe('2026-04-02T09:00:00.000Z')
    // The instance is kept even on the path where a human retypes the figures:
    // it is the evidence of what was prepared.
    expect(receipt.request).toBe(PAYLOAD.instanceXml)
    expect(receipt.error).toBeNull()
  })

  it('says what the operator has to do next, in steps', async () => {
    const receipt = await transport.deliver(PAYLOAD)
    expect(receipt.instructions).toContain('Mijn Belastingdienst')
    expect(receipt.instructions).toContain('hele euro')
    expect(receipt.instructions?.split('\n').length).toBeGreaterThan(2)
  })

  it('sends an unverified mapping, because a human is reading the figures', async () => {
    // The distinction that matters: the *numbers* are right regardless of what
    // the XBRL elements are called, and somebody typing them into a form does
    // not care. Only the electronic transports refuse.
    const receipt = await transport.deliver({ ...PAYLOAD, taxonomyVerified: false })
    expect(receipt.status).toBe('prepared')
    expect(receipt.error).toBeNull()
  })

  it('reports what it knows on a poll, which is nothing it did not store', async () => {
    const receipt = await transport.status('OB-2026-Q1-77')
    expect(receipt.status).toBe('prepared')
    expect(receipt.reference).toBe('OB-2026-Q1-77')
    expect(receipt.instructions).toContain('met de hand')
  })
})

describe('mapProviderStatus', () => {
  it('reads the words it knows', () => {
    expect(mapProviderStatus('geaccepteerd')).toBe('accepted')
    expect(mapProviderStatus('afgekeurd')).toBe('rejected')
    expect(mapProviderStatus('failed')).toBe('failed')
  })

  it('reads anything else as delivered, never as accepted', () => {
    // The provider has the filing and we do not know the verdict. Guessing
    // `accepted` from an unknown word reports a rejection as done.
    expect(mapProviderStatus('bezig')).toBe('delivered')
    expect(mapProviderStatus(null)).toBe('delivered')
    expect(mapProviderStatus('')).toBe('delivered')
  })
})

describe('the SBR provider transport', () => {
  function transport(
    fetchImpl: typeof globalThis.fetch,
    options: { deliverUrl?: string; token?: string } = {},
  ) {
    return createSbrProviderTransport({
      deliverUrl: options.deliverUrl ?? 'https://sbr.test/filings',
      token: options.token ?? 'secret',
      providerName: 'Testdienstverlener',
      fetch: fetchImpl,
      now: NOW,
    })
  }

  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

  it('is unavailable, with a reason, when unconfigured', () => {
    const result = transport(() => ok({}), { deliverUrl: '', token: '' }).available()
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('KLOPT_SBR_URL')
  })

  it('posts the instance with the token and keeps both sides verbatim', async () => {
    // Declared with the shape rather than `| null`: narrowing a `let` that is
    // only ever written inside a callback defeats control-flow analysis.
    const seen: { url: string; auth: string | null; body: string } = {
      url: '',
      auth: null,
      body: '',
    }
    const receipt = await transport((url, init) => {
      seen.url = sentTo(url)
      seen.auth = new Headers(init?.headers).get('authorization')
      seen.body = sentBody(init)
      return ok({ reference: 'JOB-1', status: 'ontvangen' })
    }).deliver(PAYLOAD)

    expect(seen.url).toBe('https://sbr.test/filings')
    expect(seen.auth).toBe('Bearer secret')
    expect(seen.body).toContain('xbrli:xbrl')
    expect(receipt.reference).toBe('JOB-1')
    // `ontvangen` is not a word it knows, so: delivered, not accepted.
    expect(receipt.status).toBe('delivered')
    expect(receipt.request).toBe(seen.body)
    expect(receipt.response).toContain('JOB-1')
  })

  it('refuses to send an unverified taxonomy mapping', async () => {
    let called = false
    const receipt = await transport(() => {
      called = true
      return ok({})
    }).deliver({ ...PAYLOAD, taxonomyVerified: false })

    expect(called).toBe(false)
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('NT20')
  })

  it('records an unreachable provider as failed rather than throwing', async () => {
    const receipt = await transport(() =>
      Promise.reject(new Error('getaddrinfo ENOTFOUND')),
    ).deliver(PAYLOAD)

    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('Testdienstverlener')
    expect(receipt.error).toContain('ENOTFOUND')
  })

  it('records an HTTP failure with the body, which is the only explanation there is', async () => {
    const receipt = await transport(() =>
      Promise.resolve(new Response('quota exceeded', { status: 402 })),
    ).deliver(PAYLOAD)

    expect(receipt.status).toBe('failed')
    expect(receipt.response).toBe('quota exceeded')
    expect(receipt.error).toContain('402')
  })

  it('treats an accepted-but-unparseable answer as delivered without a reference', async () => {
    const receipt = await transport(() =>
      Promise.resolve(new Response('<html>ok</html>', { status: 200 })),
    ).deliver(PAYLOAD)

    expect(receipt.status).toBe('delivered')
    expect(receipt.reference).toBeNull()
    expect(receipt.error).toContain('geen kenmerk')
  })

  it('says so when the provider accepts but gives nothing to poll with', async () => {
    const receipt = await transport(() => ok({ status: 'ontvangen' })).deliver(PAYLOAD)
    expect(receipt.reference).toBeNull()
    expect(receipt.instructions).toContain('portaal')
  })

  it('polls by substituting the reference into the status URL', async () => {
    let seen = ''
    const receipt = await createSbrProviderTransport({
      deliverUrl: 'https://sbr.test/filings',
      statusUrl: 'https://sbr.test/filings/{reference}/state',
      token: 'secret',
      fetch: (url) => {
        seen = sentTo(url)
        return ok({ status: 'geaccepteerd' })
      },
      now: NOW,
    }).status('JOB 1')

    expect(seen).toBe('https://sbr.test/filings/JOB%201/state')
    expect(receipt.status).toBe('accepted')
  })

  it('leaves the status alone when the poll itself fails', async () => {
    // An outage must not read as a rejection: the filing's own state has not
    // changed, we simply could not ask.
    const receipt = await transport(() => Promise.reject(new Error('boom'))).status('JOB-1')
    expect(receipt.status).toBe('delivered')
    expect(receipt.error).toContain('boom')
  })
})

describe('mapDigipoortStatus', () => {
  it('reads the Belastingdienst’s own wording', () => {
    expect(mapDigipoortStatus('Bericht is verwerkt')).toBe('accepted')
    expect(mapDigipoortStatus('Aangifte afgekeurd')).toBe('rejected')
    expect(mapDigipoortStatus('Technische fout')).toBe('failed')
  })

  it('reads anything else as delivered', () => {
    expect(mapDigipoortStatus('In behandeling')).toBe('delivered')
    expect(mapDigipoortStatus(null)).toBe('delivered')
  })
})

describe('the Digipoort envelopes', () => {
  const envelope = buildAanleverenEnvelope({
    payload: PAYLOAD,
    messageKind: 'Omzetbelasting',
    messageId: 'uuid:11111111-2222-3333-4444-555555555555',
    to: 'https://preprod-dgp2.procesinfrastructuur.nl/wus/2.0/aanleverservice/1.2',
    reference: 'KLOPT-2026-Q1-A',
  })

  it('carries WS-Addressing and the koppelvlak action', () => {
    expect(envelope).toContain('xmlns:wsa="http://www.w3.org/2005/08/addressing"')
    expect(envelope).toContain(
      '<wsa:Action>http://logius.nl/digipoort/koppelvlakservices/1.2/aanleverservice/aanleveren</wsa:Action>',
    )
    expect(envelope).toContain(
      '<wsa:MessageID>uuid:11111111-2222-3333-4444-555555555555</wsa:MessageID>',
    )
  })

  it('identifies the entity by its fiscaal nummer, without the country prefix', () => {
    expect(envelope).toContain('<kv:nummer>123456789B01</kv:nummer>')
    expect(envelope).toContain('<kv:type>Fi</kv:type>')
    expect(envelope).toContain('<kv:rolBelanghebbende>Bedrijf</kv:rolBelanghebbende>')
    expect(envelope).not.toContain('NL123456789B01')
  })

  it('carries the instance base64-encoded, recoverable byte for byte', () => {
    const found = /<kv:inhoud>([^<]+)<\/kv:inhoud>/.exec(envelope)
    expect(found).not.toBeNull()
    expect(Buffer.from(found![1]!, 'base64').toString('utf8')).toBe(PAYLOAD.instanceXml)
  })

  it('carries our own reference, which is what ties an answer to a period', () => {
    expect(envelope).toContain('<kv:aanleverkenmerk>KLOPT-2026-Q1-A</kv:aanleverkenmerk>')
    expect(envelope).toContain('<kv:bestandsnaam>aangifte-ob-2026-Q1.xbrl</kv:bestandsnaam>')
  })

  it('names a suppletie differently, so two filings are distinguishable', () => {
    const suppletie = buildAanleverenEnvelope({
      payload: { ...PAYLOAD, isSuppletie: true },
      messageKind: 'Omzetbelasting',
      messageId: 'uuid:x',
      to: 'https://digipoort.test',
      reference: 'KLOPT-2026-Q1-S',
    })
    expect(suppletie).toContain('<kv:bestandsnaam>suppletie-ob-2026-Q1.xbrl</kv:bestandsnaam>')
  })

  it('includes the empty attachments element, which the schema has', () => {
    // Present and empty is a different document from absent.
    expect(envelope).toContain('<kv:berichtBijlagen/>')
  })

  it('builds a status request around the kenmerk', () => {
    const status = buildStatusEnvelope({
      reference: 'DGP-9',
      messageId: 'uuid:y',
      to: 'https://digipoort.test/status',
    })
    expect(status).toContain('statusinformatieservice/getStatussenProces')
    expect(status).toContain('<kv:kenmerk>DGP-9</kv:kenmerk>')
  })
})

describe('the Digipoort transport', () => {
  const signer = { name: 'test', sign: (xml: string) => Promise.resolve(xml) }

  function configured(
    post: (url: string, body: string, action: string) => Promise<{ status: number; body: string }>,
    overrides: Record<string, unknown> = {},
  ) {
    return createDigipoortTransport({
      deliverUrl: 'https://digipoort.test/aanleveren',
      statusUrl: 'https://digipoort.test/status',
      clientCertificate: 'PEM',
      clientKey: 'KEY',
      signer,
      now: NOW,
      newMessageId: () => 'uuid:fixed',
      post,
      ...overrides,
    })
  }

  it('is unavailable without a certificate, and says which variable is missing', () => {
    const result = createDigipoortTransport({
      deliverUrl: '',
      statusUrl: '',
      now: NOW,
    }).available()

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('KLOPT_DIGIPOORT_CERT')
    expect(result.reason).toContain('KLOPT_DIGIPOORT_DELIVER_URL')
    // And it says the manual path is a real route rather than a fallback.
    expect(result.reason).toContain('volwaardige route')
  })

  it('is unavailable without a signer, and explains why there is no default', () => {
    // The honest gap: WS-Security signing cannot be verified without a test
    // certificate and a run against Logius, so it is a seam rather than a
    // guess. Better a greyed-out option than an unverifiable signature.
    const result = createDigipoortTransport({
      deliverUrl: 'https://digipoort.test/aanleveren',
      statusUrl: 'https://digipoort.test/status',
      clientCertificate: 'PEM',
      clientKey: 'KEY',
      now: NOW,
    }).available()

    expect(result.ok).toBe(false)
    expect(result.reason).toContain('WS-Security')
    expect(result.reason).toContain('canonicalisatie')
  })

  it('refuses to deliver while unavailable, recording the reason', async () => {
    const receipt = await createDigipoortTransport({
      deliverUrl: '',
      statusUrl: '',
      now: NOW,
    }).deliver(PAYLOAD)

    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('niet ingericht')
  })

  it('refuses an unverified taxonomy mapping before signing anything', async () => {
    let posted = false
    const receipt = await configured(() => {
      posted = true
      return Promise.resolve({ status: 200, body: '' })
    }).deliver({ ...PAYLOAD, taxonomyVerified: false })

    expect(posted).toBe(false)
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('Belastingdienst')
  })

  it('reports delivered, not accepted, and keeps the kenmerk', async () => {
    let action = ''
    const receipt = await configured((_url, _body, soapAction) => {
      action = soapAction
      return Promise.resolve({
        status: 200,
        body: '<soap:Envelope><soap:Body><ns:aanleverenResponse><ns:kenmerk>DGP-42</ns:kenmerk></ns:aanleverenResponse></soap:Body></soap:Envelope>',
      })
    }).deliver(PAYLOAD)

    expect(action).toContain('aanleveren')
    // Logius took the bytes. Whether the Belastingdienst is content is what
    // the poll is for, and collapsing the two hides every rejection.
    expect(receipt.status).toBe('delivered')
    expect(receipt.reference).toBe('DGP-42')
    expect(receipt.instructions).toContain('nog niet geaccepteerd')
  })

  it('keeps the faultstring, which is the only explanation there will be', async () => {
    const receipt = await configured(() =>
      Promise.resolve({
        status: 500,
        body: '<soap:Fault><faultstring>Signature verification failed</faultstring></soap:Fault>',
      }),
    ).deliver(PAYLOAD)

    expect(receipt.status).toBe('failed')
    expect(receipt.error).toBe('Signature verification failed')
    expect(receipt.response).toContain('faultstring')
  })

  it('records a signing failure as failed, with the envelope it could not sign', async () => {
    const receipt = await configured(() => Promise.resolve({ status: 200, body: '' }), {
      signer: { name: 'broken', sign: () => Promise.reject(new Error('no private key')) },
    }).deliver(PAYLOAD)

    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('no private key')
    expect(receipt.request).toContain('kv:aanleveren')
  })

  it('records an unreachable Digipoort as failed rather than throwing', async () => {
    const receipt = await configured(() => Promise.reject(new Error('ECONNRESET'))).deliver(PAYLOAD)
    expect(receipt.status).toBe('failed')
    expect(receipt.error).toContain('ECONNRESET')
  })

  it('reads the status the Belastingdienst gives, and quotes it', async () => {
    const receipt = await configured(() =>
      Promise.resolve({
        status: 200,
        body: '<ns:statussen><ns:statuscode>200</ns:statuscode><ns:statusomschrijving>Bericht is verwerkt</ns:statusomschrijving></ns:statussen>',
      }),
    ).status('DGP-42')

    expect(receipt.status).toBe('accepted')
    expect(receipt.instructions).toContain('Bericht is verwerkt')
  })

  it('leaves the status unchanged when the poll cannot be made', async () => {
    const receipt = await configured(() => Promise.reject(new Error('timeout'))).status('DGP-42')
    expect(receipt.status).toBe('delivered')
    expect(receipt.error).toContain('timeout')
  })
})
