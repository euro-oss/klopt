import { createServerFn } from '@tanstack/react-start'
import { uuidv7 } from '@klopt/core'
import {
  agreementRequired,
  privacyNoticeConfigured,
  readLegalLinksForRequest,
  type LegalLinksConfig,
} from '~/api/legal-links'
import { isSignupClosed } from '~/api/instance-access'

/**
 * Public legal + signup flags for SignIn / Setup.
 *
 * URLs only — never the document bodies. Self-hosted leaves them null and the
 * screens hide the links and the checkbox.
 */
export type PublicLegalConfig = LegalLinksConfig & {
  readonly signupClosed: boolean
  readonly agreementRequired: boolean
  readonly privacyNoticeConfigured: boolean
}

export const getLegalConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicLegalConfig> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const links = readLegalLinksForRequest(getRequest())
    return {
      ...links,
      signupClosed: isSignupClosed(),
      agreementRequired: agreementRequired(links),
      privacyNoticeConfigured: privacyNoticeConfigured(links),
    }
  },
)

/**
 * After OTP succeeds: should this invitee see the one-time privacy line?
 *
 * Owners with no memberships go to Setup (terms checkbox lives there). Invitees
 * already have a membership and never see Setup — they get the privacy read
 * link once, when KLOPT_PRIVACY_URL + KLOPT_PRIVACY_VERSION are set and no
 * privacy_notice row exists yet.
 */
export const privacyNoticePending = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ show: boolean; privacyUrl: string | null }> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { resolveMemberships } = await import('~/api/auth')
    const { getDatabase } = await import('~/api/database')
    const { LegalAcceptancesRepository } = await import('@klopt/db')

    const request = getRequest()
    const links = readLegalLinksForRequest(request)
    if (!privacyNoticeConfigured(links)) {
      return { show: false, privacyUrl: null }
    }

    const session = await resolveMemberships(getDatabase(), request)
    if (session === null) return { show: false, privacyUrl: null }
    // No memberships → first-admin Setup path; privacy is a read link there,
    // not this interstitial.
    if (session.memberships.length === 0) {
      return { show: false, privacyUrl: null }
    }

    const repository = new LegalAcceptancesRepository(getDatabase())
    if (await repository.hasPrivacyNotice(session.user.id)) {
      return { show: false, privacyUrl: null }
    }

    return { show: true, privacyUrl: links.privacyUrl }
  },
)

/** Record that the invitee was shown the privacy notice, then they may enter. */
export const acknowledgePrivacyNotice = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: true } | { ok: false; detail: string }> => {
    const { getRequest } = await import('@tanstack/react-start/server')
    const { resolveMemberships } = await import('~/api/auth')
    const { getDatabase } = await import('~/api/database')
    const { LegalAcceptancesRepository } = await import('@klopt/db')

    const request = getRequest()
    const links = readLegalLinksForRequest(request)
    if (!privacyNoticeConfigured(links) || links.privacyVersion === null) {
      return { ok: false, detail: 'Privacy notice is not configured.' }
    }

    const session = await resolveMemberships(getDatabase(), request)
    if (session === null) return { ok: false, detail: 'Sign in first.' }
    if (session.memberships.length === 0) {
      return { ok: false, detail: 'Privacy notice step is for invitees.' }
    }

    const repository = new LegalAcceptancesRepository(getDatabase())
    if (await repository.hasPrivacyNotice(session.user.id)) {
      return { ok: true }
    }

    await repository.recordPrivacyNoticeShown({
      id: uuidv7(),
      userId: session.user.id,
      privacyVersion: links.privacyVersion,
    })
    return { ok: true }
  },
)
