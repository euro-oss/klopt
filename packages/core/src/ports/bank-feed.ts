import type { BankStatement } from '../bank/model.js'

/**
 * Where bank data comes from (spec 7.4, 8).
 *
 * "Define one `BankFeedProvider` interface: list accounts, fetch transactions
 * since cursor, refresh consent, report consent expiry. **A file import is the
 * same interface with a different source.** API and file import must produce an
 * identical transaction stream so nothing downstream cares which one is in
 * use."
 *
 * So this port has one implementation today — the file one — and it is not a
 * placeholder for the real thing. It *is* the real thing for a self-hoster:
 * every Dutch bank exports CAMT.053 and MT940, with no licence, no fee and no
 * consent to renew (spec 8, rule 1).
 *
 * The aggregator implementations arrive behind the same interface. What makes
 * them awkward is not fetching but `consent`: PSD2 consents lapse after ninety
 * days and "the failure mode today across all incumbents is silence", which is
 * why expiry is on this port rather than being something a caller has to
 * remember to ask about.
 */

export interface BankFeedAccount {
  /** The provider's own identifier for the account. */
  readonly providerAccountId: string
  readonly iban: string
  readonly currency: string
  readonly name: string
}

export type ConsentState = 'not_required' | 'active' | 'expiring' | 'expired'

export interface BankFeedConsent {
  readonly state: ConsentState
  /** Null when the provider needs no consent, which a file import does not. */
  readonly expiresAt: string | null
  /** What a human has to do about it, when there is something. */
  readonly action: string | null
}

export interface BankFeedFetch {
  readonly statements: readonly BankStatement[]
  /**
   * Where to resume. Opaque to us: the provider defines what it means, and
   * storing it rather than a date is what makes an at-least-once feed safe.
   */
  readonly cursor: string | null
}

export interface BankFeedProvider {
  readonly name: string
  listAccounts(): Promise<readonly BankFeedAccount[]>
  /** Everything since the cursor. A file provider ignores it. */
  fetch(request: {
    readonly providerAccountId: string
    readonly cursor: string | null
  }): Promise<BankFeedFetch>
  consent(providerAccountId: string): Promise<BankFeedConsent>
  refreshConsent(providerAccountId: string): Promise<BankFeedConsent>
}

/**
 * How long before expiry a consent is worth warning about.
 *
 * A week: long enough that somebody notices before the feed goes quiet, short
 * enough that the warning still means something when it appears.
 */
export const CONSENT_WARNING_DAYS = 7

export function consentStateFor(expiresAt: string | null, now: Date = new Date()): ConsentState {
  if (expiresAt === null) return 'not_required'

  const expiry = Date.parse(expiresAt)
  if (Number.isNaN(expiry)) return 'not_required'
  if (expiry <= now.getTime()) return 'expired'

  const days = (expiry - now.getTime()) / 86_400_000
  return days <= CONSENT_WARNING_DAYS ? 'expiring' : 'active'
}
