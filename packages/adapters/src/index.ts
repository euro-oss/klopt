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
 * The interfaces are deliberately not written yet: their signatures are made of
 * domain types (a VAT return, a statement line, an invoice) that arrive with the
 * ledger in M0, and inventing them ahead of the domain is how you get a port
 * shaped like the first adapter you happened to think of. See
 * docs/decisions/0008-adapter-ports-deferred.md.
 */
export const ADAPTER_FAMILIES = ['filing', 'bank-feed', 'e-invoice', 'payment'] as const

export type AdapterFamily = (typeof ADAPTER_FAMILIES)[number]
