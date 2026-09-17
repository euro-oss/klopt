import type { FilingPayload, FilingReceipt, FilingStatus, FilingTransport } from '@klopt/core'

/**
 * Filing through a third-party SBR service provider.
 *
 * The middle path: the provider holds the PKIoverheid certificate and the
 * Digipoort connection, and charges per filing. For most small administrations
 * that is cheaper and less work than a certificate of their own, and it is why
 * spec 7.2 lists it as one of the three transports rather than as an
 * afterthought.
 *
 * There is no standard API across providers, so this is deliberately generic:
 * POST the instance to a configured URL with a bearer token, expect an
 * identifier back, GET the status by that identifier. Providers whose APIs
 * differ get their own adapter — the port is the contract, not this file. What
 * is not configurable is the recording: every request and response goes into
 * the receipt verbatim.
 *
 * Never throws. A provider being down is `failed` with the reason, recorded,
 * and the operator can fall back to the manual path — which is spec 8's fourth
 * rule and the reason the manual transport needs no configuration.
 */

export interface SbrProviderOptions {
  /** Where to POST the instance. */
  readonly deliverUrl: string
  /**
   * Where to GET a status, with `{reference}` substituted. Defaults to
   * `deliverUrl/{reference}`.
   */
  readonly statusUrl?: string
  readonly token: string
  /** Shown to the operator, so they know whose service refused. */
  readonly providerName?: string
  readonly timeoutMs?: number
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
}

interface ProviderResponse {
  reference?: unknown
  id?: unknown
  kenmerk?: unknown
  status?: unknown
  message?: unknown
  error?: unknown
}

/** A status body that is not JSON tells us nothing, which is not an error. */
function parseOrEmpty(body: string): ProviderResponse {
  try {
    return JSON.parse(body) as ProviderResponse
  } catch {
    return {}
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * Map a provider's status word onto ours.
 *
 * Exported because it is the part with judgement in it. Anything unrecognised
 * becomes `delivered` rather than `accepted`: the provider has the filing and
 * we do not know the Belastingdienst's verdict, which is exactly what
 * `delivered` means. Guessing `accepted` from an unknown word would report a
 * filing as done when it may have been refused.
 */
export function mapProviderStatus(value: string | null): FilingStatus {
  switch ((value ?? '').toLowerCase()) {
    case 'accepted':
    case 'accepteerd':
    case 'geaccepteerd':
    case 'verwerkt':
    case 'processed':
    case 'success':
      return 'accepted'
    case 'rejected':
    case 'afgekeurd':
    case 'geweigerd':
    case 'error':
    case 'invalid':
      return 'rejected'
    case 'failed':
      return 'failed'
    default:
      return 'delivered'
  }
}

export function createSbrProviderTransport(options: SbrProviderOptions): FilingTransport {
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? 30_000
  const providerName = options.providerName ?? 'SBR-dienstverlener'

  async function call(
    url: string,
    init: RequestInit,
  ): Promise<{ body: string; ok: boolean; status: number } | { error: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    try {
      const response = await doFetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${options.token}`,
          accept: 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      })
      return { body: await response.text(), ok: response.ok, status: response.status }
    } catch (error: unknown) {
      return {
        error:
          error instanceof Error && error.name === 'AbortError'
            ? `${providerName} antwoordde niet binnen ${String(timeoutMs)}ms.`
            : `${providerName} is niet bereikbaar: ${error instanceof Error ? error.message : String(error)}`,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    kind: 'sbr_provider',
    name: providerName,

    available() {
      if (options.deliverUrl === '' || options.token === '') {
        return {
          ok: false,
          reason:
            'Er is geen SBR-dienstverlener geconfigureerd. Zet KLOPT_SBR_URL en KLOPT_SBR_TOKEN, of dien met de hand in.',
        }
      }
      return { ok: true, reason: null }
    },

    async deliver(payload: FilingPayload): Promise<FilingReceipt> {
      const at = now().toISOString()

      // An unverified taxonomy mapping must not be sent anywhere. The figures
      // are right; the element names may not be, and a well-formed instance
      // declaring the wrong box is worse than no instance at all.
      if (!payload.taxonomyVerified) {
        return {
          transport: 'sbr_provider',
          status: 'failed',
          reference: null,
          at,
          request: null,
          response: null,
          error: `De taxonomie-mapping ${payload.taxonomyVersion} is niet gecontroleerd tegen de gepubliceerde Nederlandse Taxonomie, dus deze instance wordt niet verstuurd. Dien met de hand in, of controleer de mapping en zet verified op true.`,
          instructions: null,
        }
      }

      const request = JSON.stringify({
        report: 'ob-aangifte',
        period: payload.periodCode,
        periodFrom: payload.periodFrom,
        periodTo: payload.periodTo,
        isSuppletie: payload.isSuppletie,
        taxonomyVersion: payload.taxonomyVersion,
        vatNumber: payload.vatNumber,
        instance: payload.instanceXml,
      })

      const result = await call(options.deliverUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: request,
      })

      if ('error' in result) {
        return {
          transport: 'sbr_provider',
          status: 'failed',
          reference: null,
          at,
          request,
          response: null,
          error: result.error,
          instructions: null,
        }
      }

      if (!result.ok) {
        return {
          transport: 'sbr_provider',
          status: 'failed',
          reference: null,
          at,
          request,
          response: result.body,
          error: `${providerName} antwoordde ${String(result.status)}.`,
          instructions: null,
        }
      }

      let parsed: ProviderResponse
      try {
        parsed = JSON.parse(result.body) as ProviderResponse
      } catch {
        // Accepted the bytes but answered with something unparseable. The
        // filing may well be on its way, so it is not `failed` — but without a
        // reference nothing can be polled, and that is worth saying.
        return {
          transport: 'sbr_provider',
          status: 'delivered',
          reference: null,
          at,
          request,
          response: result.body,
          error: `${providerName} accepteerde de aangifte maar antwoordde niet met JSON, dus er is geen kenmerk om de status mee op te vragen.`,
          instructions: null,
        }
      }

      const reference = text(parsed.reference) ?? text(parsed.id) ?? text(parsed.kenmerk)

      return {
        transport: 'sbr_provider',
        status: mapProviderStatus(text(parsed.status)),
        reference,
        at,
        request,
        response: result.body,
        error: text(parsed.error),
        instructions:
          reference === null
            ? `${providerName} gaf geen kenmerk terug, dus de status kan niet automatisch worden opgevraagd. Controleer de indiening in het portaal van de dienstverlener.`
            : null,
      }
    },

    async status(reference: string): Promise<FilingReceipt> {
      const at = now().toISOString()
      const url = (options.statusUrl ?? `${options.deliverUrl}/{reference}`).replace(
        '{reference}',
        encodeURIComponent(reference),
      )

      const result = await call(url, { method: 'GET' })

      if ('error' in result) {
        return {
          transport: 'sbr_provider',
          // Not `failed`: the filing's own state is unchanged, we just could
          // not ask. Recording it as failed would make an outage look like a
          // rejection.
          status: 'delivered',
          reference,
          at,
          request: null,
          response: null,
          error: result.error,
          instructions: null,
        }
      }

      const parsed = parseOrEmpty(result.body)

      return {
        transport: 'sbr_provider',
        status: result.ok ? mapProviderStatus(text(parsed.status)) : 'delivered',
        reference,
        at,
        request: null,
        response: result.body,
        error: result.ok
          ? (text(parsed.error) ?? text(parsed.message))
          : `${providerName} antwoordde ${String(result.status)}.`,
        instructions: null,
      }
    },
  }
}
