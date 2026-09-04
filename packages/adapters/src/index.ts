/**
 * @klopt/adapters — the four capabilities gated by someone else's credentials
 * (spec 8).
 *
 *   filing      BTW-aangifte and ICP to the Belastingdienst
 *   bank-feed   account information
 *   e-invoice   Peppol and its fallbacks
 *   payment     outbound payment initiation
 *
 * Three rules hold for all four, and they are what makes a self-hosted install
 * complete and legal on its own:
 *
 *   1. Every family has a manual or file-based implementation that needs no
 *      third party, and that implementation is the default in a fresh install.
 *   2. Credentials are per entity, encrypted, entered by the operator. This
 *      repository ships no credentials.
 *   3. An adapter failing degrades to its fallback with a visible warning. It
 *      never blocks bookkeeping.
 *
 * The compliance interfaces are deliberately still unwritten: their signatures
 * are made of domain types that arrive with the module that needs them, and
 * inventing them ahead of the domain is how you get a port shaped like the
 * first adapter you happened to think of. See
 * docs/decisions/0008-adapter-ports-deferred.md.
 *
 * `email` is the exception, and not really one: sending a message is generic
 * infrastructure rather than a compliance surface, and three separate callers
 * already need it — sign-in codes, invoice delivery and dunning (M1), and the
 * e-invoice email fallback (spec 7.5).
 */
export * from './email/index.js'

export const ADAPTER_FAMILIES = ['filing', 'bank-feed', 'e-invoice', 'payment'] as const

export type AdapterFamily = (typeof ADAPTER_FAMILIES)[number]
