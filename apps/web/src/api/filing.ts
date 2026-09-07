import {
  createDigipoortTransport,
  createManualFilingTransport,
  createSbrProviderTransport,
} from '@klopt/adapters'
import type { FilingTransport, FilingTransportKind } from '@klopt/core'

/**
 * Which transports this installation has.
 *
 * `manual` is always there and needs nothing — spec 7.2: "Do not make a
 * self-hoster buy a certificate to be compliant." The other two are built from
 * environment configuration and report their own unavailability with a reason,
 * so the screen shows a greyed-out option that explains itself rather than an
 * error after a filing has been generated.
 *
 * Credentials come from the environment rather than the database for now. Spec
 * 8's second rule wants them per entity and encrypted, and that is a real gap
 * — an accountancy firm with forty administrations needs forty certificates.
 * It is called out in docs/decisions/0024 rather than pretended away.
 */

let transports: Map<FilingTransportKind, FilingTransport> | null = null

function environment(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function build(): Map<FilingTransportKind, FilingTransport> {
  const built = new Map<FilingTransportKind, FilingTransport>()

  built.set('manual', createManualFilingTransport())

  built.set(
    'sbr_provider',
    createSbrProviderTransport({
      deliverUrl: environment('KLOPT_SBR_URL') ?? '',
      token: environment('KLOPT_SBR_TOKEN') ?? '',
      ...(environment('KLOPT_SBR_STATUS_URL') === undefined
        ? {}
        : { statusUrl: environment('KLOPT_SBR_STATUS_URL')! }),
      ...(environment('KLOPT_SBR_PROVIDER_NAME') === undefined
        ? {}
        : { providerName: environment('KLOPT_SBR_PROVIDER_NAME')! }),
    }),
  )

  built.set(
    'digipoort',
    createDigipoortTransport({
      deliverUrl: environment('KLOPT_DIGIPOORT_DELIVER_URL') ?? '',
      statusUrl: environment('KLOPT_DIGIPOORT_STATUS_URL') ?? '',
      ...(environment('KLOPT_DIGIPOORT_CERT') === undefined
        ? {}
        : { clientCertificate: environment('KLOPT_DIGIPOORT_CERT')! }),
      ...(environment('KLOPT_DIGIPOORT_KEY') === undefined
        ? {}
        : { clientKey: environment('KLOPT_DIGIPOORT_KEY')! }),
      ...(environment('KLOPT_DIGIPOORT_KEY_PASSPHRASE') === undefined
        ? {}
        : { clientKeyPassphrase: environment('KLOPT_DIGIPOORT_KEY_PASSPHRASE')! }),
      ...(environment('KLOPT_DIGIPOORT_CA') === undefined
        ? {}
        : { certificateAuthority: environment('KLOPT_DIGIPOORT_CA')! }),
      // No signer. See the note in the Digipoort adapter: WS-Security signing
      // cannot be verified without a test certificate and a run against
      // Logius's pre-production environment, so it is a seam rather than a
      // guess, and `available()` says so.
    }),
  )

  return built
}

export function filingTransports(): ReadonlyMap<FilingTransportKind, FilingTransport> {
  transports ??= build()
  return transports
}

export function filingTransport(kind: FilingTransportKind): FilingTransport {
  const found = filingTransports().get(kind)
  if (found === undefined) throw new Error(`No filing transport ${kind}.`)
  return found
}

/** Test seam. Nothing in the suite may reach Logius or a provider. */
export function setFilingTransportsForTest(
  value: ReadonlyMap<FilingTransportKind, FilingTransport> | null,
): void {
  transports = value === null ? null : new Map(value)
}
