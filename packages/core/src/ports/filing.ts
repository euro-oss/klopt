/**
 * Handing a filing to the Belastingdienst, as a port (spec 7.2).
 *
 * Three implementations, and the order they are listed in is the order they
 * matter in:
 *
 *  1. **manual** — produce the instance and a human-readable summary and let
 *     the operator file in Mijn Belastingdienst Zakelijk. The spec is explicit:
 *     "Do not make a self-hoster buy a certificate to be compliant. The manual
 *     path must be a first-class, well-documented flow." So it is the default,
 *     it needs nothing, and it is the one with the most care in it.
 *  2. **sbr_provider** — post the instance to a third-party SBR service
 *     provider, who holds the certificate. One HTTP call and a token.
 *  3. **digipoort** — straight to Logius over WUS 2.0: SOAP with WS-Addressing,
 *     two-way TLS, WS-Security message signing, and a PKIoverheid services
 *     certificate per legal entity at a few hundred euro a year.
 *
 * ## Two calls, not one
 *
 * Digipoort's shape leaks into the port because it is the shape of the problem.
 * `deliver` hands over the instance and gets back a message id; the filing is
 * not accepted at that point, only received. `status` polls the
 * Statusinformatieservice until the Belastingdienst has processed it. A
 * transport that cannot poll — the manual one — reports its status from what
 * the operator told us, which is why `status` is part of the interface rather
 * than optional.
 *
 * ## Everything is recorded
 *
 * Spec 7.2: "Store every submission: instance sent, timestamp, Digipoort
 * message id, all status responses, and the resulting confirmation. This is the
 * evidence chain." So both methods return a record rather than a boolean, and
 * the record is written whether the call succeeded or not. A refused delivery is
 * evidence too — it is the difference between "we did not file" and "we tried
 * and they would not take it", and only one of those is a penalty.
 */

export type FilingTransportKind = 'manual' | 'sbr_provider' | 'digipoort'

/**
 * Where a submission has got to.
 *
 * `delivered` means the service took the bytes. `accepted` means the
 * Belastingdienst processed it and is content. The gap between them is where
 * every real problem lives, and collapsing the two into "sent" is how a
 * rejected aangifte goes unnoticed until a letter arrives.
 */
export type FilingStatus = 'prepared' | 'delivered' | 'accepted' | 'rejected' | 'failed'

export interface FilingPayload {
  /** The XBRL instance. This is the filing. */
  readonly instanceXml: string
  /** The human-readable rendering, for the manual path and for the evidence. */
  readonly summary: string
  readonly periodCode: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly isSuppletie: boolean
  readonly taxonomyVersion: string
  /** False when the taxonomy mapping's element names are unchecked. */
  readonly taxonomyVerified: boolean
  readonly vatNumber: string
  readonly legalName: string
  /** Whole euros, for a transport that wants to show or log the headline. */
  readonly payableEuros: bigint
}

export interface FilingReceipt {
  readonly transport: FilingTransportKind
  readonly status: FilingStatus
  /** Digipoort's `kenmerk`, a provider's job id, or what the operator typed. */
  readonly reference: string | null
  /** ISO 8601, from the transport rather than the caller. */
  readonly at: string
  /** What was sent, verbatim, when the transport sent anything. */
  readonly request: string | null
  /** What came back, verbatim. Kept unparsed: it is evidence. */
  readonly response: string | null
  /** In the operator's words, when something went wrong. */
  readonly error: string | null
  /** What the operator has to do next, when it is their turn. */
  readonly instructions: string | null
}

export interface FilingTransport {
  readonly kind: FilingTransportKind
  readonly name: string
  /**
   * Whether this transport is configured well enough to be offered.
   *
   * Asked before anything is generated, so an unconfigured Digipoort is a
   * greyed-out option with a reason rather than an error after the fact.
   */
  available(): { readonly ok: boolean; readonly reason: string | null }
  deliver(payload: FilingPayload): Promise<FilingReceipt>
  /**
   * Poll for the outcome. `reference` is whatever `deliver` returned.
   *
   * The manual transport cannot poll and says so; the caller records that as
   * an unchanged status rather than a failure.
   */
  status(reference: string): Promise<FilingReceipt>
}
