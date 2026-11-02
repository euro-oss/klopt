import { describe, expect, it } from 'vitest'
import {
  agreementRequired,
  privacyNoticeConfigured,
  readLegalLinks,
  readLegalLinksForRequest,
} from '../../src/api/legal-links.js'
import { en } from '../../src/i18n/en.js'
import { nl } from '../../src/i18n/nl.js'

describe('readLegalLinks', () => {
  it('returns nulls when every env var is unset (self-hosted default)', () => {
    const config = readLegalLinks({})
    expect(config).toEqual({
      privacyUrl: null,
      termsUrl: null,
      dpaUrl: null,
      termsVersion: null,
      dpaVersion: null,
      privacyVersion: null,
    })
    expect(agreementRequired(config)).toBe(false)
    expect(privacyNoticeConfigured(config)).toBe(false)
  })

  it('trims blank strings to null', () => {
    const config = readLegalLinks({
      KLOPT_PRIVACY_URL: '  ',
      KLOPT_PRIVACY_VERSION: '',
      KLOPT_TERMS_URL: '',
      KLOPT_DPA_URL: '\t',
      KLOPT_TERMS_VERSION: ' ',
      KLOPT_DPA_VERSION: '',
    })
    expect(config.privacyUrl).toBeNull()
    expect(config.privacyVersion).toBeNull()
    expect(agreementRequired(config)).toBe(false)
    expect(privacyNoticeConfigured(config)).toBe(false)
  })

  it('requires both document URLs and both versions for the checkbox', () => {
    const partial = readLegalLinks({
      KLOPT_TERMS_URL: 'https://example.test/terms',
      KLOPT_DPA_URL: 'https://example.test/dpa',
    })
    expect(agreementRequired(partial)).toBe(false)

    const full = readLegalLinks({
      KLOPT_PRIVACY_URL: 'https://example.test/privacy',
      KLOPT_PRIVACY_VERSION: '2026-11-02-privacy',
      KLOPT_TERMS_URL: 'https://example.test/terms',
      KLOPT_DPA_URL: 'https://example.test/dpa',
      KLOPT_TERMS_VERSION: '2026-11-02',
      KLOPT_DPA_VERSION: '2026-11-02-dpa',
    })
    expect(full.privacyUrl).toBe('https://example.test/privacy')
    expect(full.privacyVersion).toBe('2026-11-02-privacy')
    expect(agreementRequired(full)).toBe(true)
    expect(privacyNoticeConfigured(full)).toBe(true)
  })

  it('honours the e2e cookie only when the toggle env is set', () => {
    const request = { headers: { get: () => 'klopt-e2e-legal=on' } }
    expect(readLegalLinksForRequest(request, {}).privacyUrl).toBeNull()
    const withToggle = readLegalLinksForRequest(request, { KLOPT_E2E_LEGAL_TOGGLE: '1' })
    expect(withToggle.termsUrl).toBe('https://example.test/terms')
    expect(withToggle.privacyVersion).toBe('2026-11-02-privacy-e2e')
    expect(agreementRequired(withToggle)).toBe(true)
    expect(privacyNoticeConfigured(withToggle)).toBe(true)
  })
})

describe('legal copy catalogue', () => {
  it('has no secure / GDPR / EU-hosted claims in NL or EN legal strings', () => {
    const keys = Object.keys(nl).filter(
      (key) => key.startsWith('legal.') || key.startsWith('signIn.') || key.startsWith('setup.'),
    )
    const forbidden = /secure|gdpr|100%\s*veilig|eu-hosted|hosted in europe|gehost in europa/i
    for (const key of keys) {
      expect(nl[key as keyof typeof nl], `nl ${key}`).not.toMatch(forbidden)
      expect(en[key as keyof typeof en], `en ${key}`).not.toMatch(forbidden)
    }
  })
})
