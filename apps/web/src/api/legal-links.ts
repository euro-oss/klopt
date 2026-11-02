/**
 * Hosted legal document links and versions (issue #138).
 *
 * Self-hosted default: every URL unset → no privacy link, no terms/DPA
 * checkbox, nothing written to `legal_acceptances`. Hosted (klopt-hosted)
 * sets the URLs and versions; the open-source app never ships euro.computer
 * copy.
 */

export type EnvBag = Readonly<Record<string, string | undefined>>

export type LegalLinksConfig = {
  readonly privacyUrl: string | null
  readonly termsUrl: string | null
  readonly dpaUrl: string | null
  readonly termsVersion: string | null
  readonly dpaVersion: string | null
  readonly privacyVersion: string | null
}

function readUrl(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function readVersion(value: string | undefined): string | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function readLegalLinks(env: EnvBag = process.env): LegalLinksConfig {
  return {
    privacyUrl: readUrl(env['KLOPT_PRIVACY_URL']),
    termsUrl: readUrl(env['KLOPT_TERMS_URL']),
    dpaUrl: readUrl(env['KLOPT_DPA_URL']),
    termsVersion: readVersion(env['KLOPT_TERMS_VERSION']),
    dpaVersion: readVersion(env['KLOPT_DPA_VERSION']),
    privacyVersion: readVersion(env['KLOPT_PRIVACY_VERSION']),
  }
}

/**
 * The Setup checkbox is shown only when both documents and both versions are
 * configured — otherwise we cannot honestly record what was accepted.
 */
export function agreementRequired(config: LegalLinksConfig): boolean {
  return (
    config.termsUrl !== null &&
    config.dpaUrl !== null &&
    config.termsVersion !== null &&
    config.dpaVersion !== null
  )
}

/**
 * Invitee first-sign-in privacy line: URL and version must both be set so the
 * "shown" record can name which notice they saw.
 */
export function privacyNoticeConfigured(config: LegalLinksConfig): boolean {
  return config.privacyUrl !== null && config.privacyVersion !== null
}

const E2E_LEGAL_FIXTURE: LegalLinksConfig = {
  privacyUrl: 'https://example.test/privacy',
  termsUrl: 'https://example.test/terms',
  dpaUrl: 'https://example.test/dpa',
  termsVersion: '2026-11-02-e2e',
  dpaVersion: '2026-11-02-dpa-e2e',
  privacyVersion: '2026-11-02-privacy-e2e',
}

/**
 * Playwright-only override: when `KLOPT_E2E_LEGAL_TOGGLE=1` and the request
 * carries `klopt-e2e-legal=on`, return fixture hosted URLs. The webServer
 * itself leaves the env unset (self-hosted default) so existing specs stay
 * green; redesign specs opt in via the cookie. Never honoured in production.
 */
export function readLegalLinksForRequest(
  request: { headers: { get(name: string): string | null } } | null,
  env: EnvBag = process.env,
): LegalLinksConfig {
  const config = readLegalLinks(env)
  if (env['KLOPT_E2E_LEGAL_TOGGLE'] !== '1') return config
  if (env['NODE_ENV'] === 'production') return config
  if (request === null) return config
  const cookie = request.headers.get('cookie') ?? ''
  if (/(?:^|;\s*)klopt-e2e-legal=on(?:;|$)/.test(cookie)) {
    return E2E_LEGAL_FIXTURE
  }
  return config
}
