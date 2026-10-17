/**
 * Fixed identities for the demo administration (issue #48).
 *
 * Deterministic on purpose: a re-run on a wiped database produces the same
 * entity id, the same owner row and the same fictional identifiers. Tests and
 * operators can both rely on that.
 */

/** Well-known UUID for the singleton demo BV. Version-7-shaped, fixed. */
export const DEMO_ENTITY_ID = '01948a00-d000-7000-8000-00000000d001'

/** better-auth user id for the synthetic owner the seeder provisions under. */
export const DEMO_OWNER_USER_ID = 'demo-seed-owner'

export const DEMO_OWNER_EMAIL = 'owner@demo.invalid'

export const DEMO_ENTITY_NAME = 'Demo BV (demo)'
export const DEMO_LEGAL_NAME = 'Demo Beheer B.V. (demo)'

/** Obviously fictional — eight zeros and a one, never a live KvK. */
export const DEMO_KVK = '00000001'

/** Obviously fictional Dutch BTW-id shape. */
export const DEMO_VAT = 'NL000000001B99'

/** Reserved-pattern test IBAN (bank code TEST). */
export const DEMO_IBAN = 'NL69TEST0000000001'

/** Seed for the PRNG that builds amounts and day offsets. */
export const DEMO_SEED = 0x4b_4c_4f_50_54 // "KLOPT"

/** One calendar book year of fictional activity. */
export const DEMO_FISCAL_YEAR = '2025'

export const DEMO_YEAR_START = '2025-01-01'
export const DEMO_YEAR_END = '2025-12-31'

/** Opening bank balance after the memoriaal opening entry (€50.000,00). */
export const DEMO_OPENING_BANK_MINOR = 5_000_000n
