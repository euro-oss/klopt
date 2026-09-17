import {
  parseVatNumber,
  type VatNumberCheck,
  type VatNumberCheckRequest,
  type VatNumberValidator,
} from '@klopt/core'

/**
 * VIES, the Commission's VAT number register.
 *
 * The REST interface rather than the SOAP one: same data, no WSDL, and no
 * dependency. `POST /taxation_customs/vies/rest-api/check-vat-number` with the
 * country and number, and — crucially — the requester's own country and number,
 * because that is what makes VIES return a `requestIdentifier`. The
 * consultation number is the proof; a check made anonymously gives an answer
 * and nothing you can show an inspector.
 *
 * Rules this follows from spec 8:
 *
 *  - **Never throws.** An unreachable register returns `outcome: 'unavailable'`
 *    with the reason, and the caller records it. A VIES outage must not stop
 *    anybody invoicing; it stops the ICP opgaaf from being filed, which is a
 *    different thing and the correct one.
 *  - **Records the response verbatim.** `raw` is what came back, not what we
 *    made of it. When VIES changes a field name, the evidence survives.
 *  - **Never called in a test.** The port has a fake; this file has a golden
 *    parser test over captured responses. Hitting a public service from CI is
 *    rude and flaky.
 */

const DEFAULT_ENDPOINT = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'

export interface ViesOptions {
  readonly endpoint?: string
  /** VIES is slow under load and the default fetch timeout is forever. */
  readonly timeoutMs?: number
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => Date
}

interface ViesResponse {
  countryCode?: unknown
  vatNumber?: unknown
  requestDate?: unknown
  valid?: unknown
  requestIdentifier?: unknown
  name?: unknown
  address?: unknown
  userError?: unknown
  actionSucceed?: unknown
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // VIES writes '---' for a member state that does not disclose the name.
  return trimmed === '' || trimmed === '---' ? null : trimmed
}

/**
 * Parse a VIES REST response into a check.
 *
 * Exported because it is the part worth testing: the network is mocked, the
 * parsing is not, and `userError` is the field that decides whether an answer
 * of `valid: false` means "this number is not registered" or "you asked wrong".
 * Conflating those two stores somebody else's typo as the counterparty's fault.
 */
export function parseViesResponse(
  request: VatNumberCheckRequest,
  body: unknown,
  options: { readonly checkedAt: string; readonly source: string; readonly raw: string },
): VatNumberCheck {
  const parsed = parseVatNumber(request.vatNumber)
  const response = (typeof body === 'object' && body !== null ? body : {}) as ViesResponse
  const userError = text(response.userError)

  // VIES returns `userError: 'VALID'` on success. Anything else is a service
  // or request problem: INVALID_INPUT, MS_UNAVAILABLE, GLOBAL_MAX_CONCURRENT_REQ,
  // SERVICE_UNAVAILABLE, TIMEOUT. Only `INVALID` means "not registered".
  const isServiceProblem = userError !== null && userError !== 'VALID' && userError !== 'INVALID'

  const outcome: VatNumberCheck['outcome'] = isServiceProblem
    ? 'unavailable'
    : response.valid === true
      ? 'valid'
      : 'invalid'

  return {
    vatNumber: parsed?.normalised ?? request.vatNumber,
    countryCode: parsed?.countryCode ?? text(response.countryCode) ?? '',
    outcome,
    name: text(response.name),
    address: text(response.address),
    requestDate: text(response.requestDate),
    requestIdentifier: text(response.requestIdentifier),
    checkedAt: options.checkedAt,
    source: options.source,
    raw: options.raw,
    error: isServiceProblem ? `VIES: ${userError}` : null,
  }
}

export function createViesValidator(options: ViesOptions = {}): VatNumberValidator {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs ?? 15_000
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? (() => new Date())

  return {
    name: 'vies',

    async check(request: VatNumberCheckRequest): Promise<VatNumberCheck> {
      const checkedAt = now().toISOString()
      const parsed = parseVatNumber(request.vatNumber)

      if (parsed === null) {
        // Refused before the call: a typo should not become a stored "invalid"
        // that reads as the counterparty's fault, and VIES rate limits are real.
        return {
          vatNumber: request.vatNumber,
          countryCode: request.vatNumber.slice(0, 2).toUpperCase(),
          outcome: 'invalid',
          name: null,
          address: null,
          requestDate: null,
          requestIdentifier: null,
          checkedAt,
          source: 'vies',
          raw: '',
          error: 'Not the shape of a VAT number in that member state; VIES was not asked.',
        }
      }

      const requester =
        request.requesterVatNumber === null ? null : parseVatNumber(request.requesterVatNumber)

      const payload: Record<string, string> = {
        countryCode: parsed.countryCode,
        vatNumber: parsed.number,
      }
      if (requester !== null) {
        payload['requesterMemberStateCode'] = requester.countryCode
        payload['requesterNumber'] = requester.number
      }

      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
      }, timeoutMs)

      try {
        const response = await doFetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const raw = await response.text()

        if (!response.ok) {
          return {
            vatNumber: parsed.normalised,
            countryCode: parsed.countryCode,
            outcome: 'unavailable',
            name: null,
            address: null,
            requestDate: null,
            requestIdentifier: null,
            checkedAt,
            source: 'vies',
            raw,
            error: `VIES answered ${String(response.status)}.`,
          }
        }

        let body: unknown
        try {
          body = JSON.parse(raw)
        } catch {
          return {
            vatNumber: parsed.normalised,
            countryCode: parsed.countryCode,
            outcome: 'unavailable',
            name: null,
            address: null,
            requestDate: null,
            requestIdentifier: null,
            checkedAt,
            source: 'vies',
            raw,
            error: 'VIES answered with something that is not JSON.',
          }
        }

        return parseViesResponse(request, body, { checkedAt, source: 'vies', raw })
      } catch (error: unknown) {
        return {
          vatNumber: parsed.normalised,
          countryCode: parsed.countryCode,
          outcome: 'unavailable',
          name: null,
          address: null,
          requestDate: null,
          requestIdentifier: null,
          checkedAt,
          source: 'vies',
          raw: '',
          error:
            error instanceof Error && error.name === 'AbortError'
              ? `VIES did not answer within ${String(timeoutMs)}ms.`
              : `VIES could not be reached: ${error instanceof Error ? error.message : String(error)}`,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/**
 * The no-third-party default (spec 8, rule 1).
 *
 * Checks the shape and says so, without claiming VIES agreed. An install with
 * no outbound network still validates typos and still records what it did —
 * and the ICP opgaaf still refuses to file, because `unavailable` is not proof.
 * That is the honest degradation: the books work, the claim does not.
 */
export function createOfflineVatNumberValidator(
  options: { readonly now?: () => Date } = {},
): VatNumberValidator {
  const now = options.now ?? (() => new Date())

  return {
    name: 'offline',
    check(request: VatNumberCheckRequest): Promise<VatNumberCheck> {
      const parsed = parseVatNumber(request.vatNumber)
      return Promise.resolve({
        vatNumber: parsed?.normalised ?? request.vatNumber,
        countryCode: parsed?.countryCode ?? request.vatNumber.slice(0, 2).toUpperCase(),
        outcome: parsed === null ? 'invalid' : 'unavailable',
        name: null,
        address: null,
        requestDate: null,
        requestIdentifier: null,
        checkedAt: now().toISOString(),
        source: 'offline',
        raw: '',
        error:
          parsed === null
            ? 'Not the shape of a VAT number in that member state.'
            : 'No VIES connection is configured, so nothing has confirmed this number. Set KLOPT_VIES_ENDPOINT or check it by hand at ec.europa.eu and record the consultation number.',
      })
    },
  }
}
