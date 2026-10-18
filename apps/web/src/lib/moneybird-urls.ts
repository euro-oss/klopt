/**
 * Moneybird web UI URLs for "Open in Moneybird" on findings (issue #42 / PM #55).
 *
 * External ids from the plan look like `sales_invoice:301`. Draft-skipped
 * findings use dotted plan paths (`salesInvoices.301`, `purchase_invoices.401`).
 * The API base (`…/api/v2`) is not the human UI — strip that and build a
 * document path.
 */

const PATH_BY_KIND: Readonly<Record<string, (id: string) => string>> = {
  sales_invoice: (id) => `sales_invoices/${id}`,
  credit_note: (id) => `sales_invoices/${id}`,
  purchase_invoice: (id) => `documents/purchase_invoices/${id}`,
  receipt: (id) => `documents/receipts/${id}`,
  journal: (id) => `documents/general_journal_documents/${id}`,
  bank_mutation: (id) => `financial_mutations/${id}`,
}

/** Plan path prefixes (`draft_skipped` etc.) → Moneybird document kind. */
const KIND_BY_DOTTED_PREFIX: Readonly<Record<string, string>> = {
  salesInvoices: 'sales_invoice',
  purchase_invoices: 'purchase_invoice',
  purchaseInvoices: 'purchase_invoice',
  receipts: 'receipt',
  journalDocuments: 'journal',
  financialMutations: 'bank_mutation',
}

/** Host for the Moneybird web UI derived from an API base URL. */
export function moneybirdWebOrigin(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl)
    // https://moneybird.com/api/v2 → https://moneybird.com
    return `${url.protocol}//${url.host}`
  } catch {
    return 'https://moneybird.com'
  }
}

/**
 * Parse `kind:id` or a dotted plan path (`salesInvoices.301`) into kind + id.
 */
export function parseMoneybirdExternalId(
  externalId: string,
): { readonly kind: string; readonly id: string } | null {
  const colon = externalId.indexOf(':')
  if (colon > 0) {
    const kind = externalId.slice(0, colon)
    const id = externalId.slice(colon + 1)
    if (kind === '' || id === '' || id.includes(':')) return null
    return { kind, id }
  }

  const dot = externalId.indexOf('.')
  if (dot <= 0) return null
  const prefix = externalId.slice(0, dot)
  const rest = externalId.slice(dot + 1)
  // Only the document id — nested detail paths are not openable documents.
  const id = rest.includes('.') ? rest.slice(0, rest.indexOf('.')) : rest
  const kind = KIND_BY_DOTTED_PREFIX[prefix]
  if (kind === undefined || id === '') return null
  return { kind, id }
}

/**
 * Absolute URL to open a Moneybird document in the browser, or null when the
 * external id / administration is unknown.
 */
export function moneybirdDocumentUrl(
  apiBaseUrl: string,
  administrationId: string | null | undefined,
  externalId: string | null | undefined,
): string | null {
  if (
    administrationId === null ||
    administrationId === undefined ||
    administrationId === '' ||
    externalId === null ||
    externalId === undefined ||
    externalId === ''
  ) {
    return null
  }
  const parsed = parseMoneybirdExternalId(externalId)
  if (parsed === null) return null
  const build = PATH_BY_KIND[parsed.kind]
  if (build === undefined || parsed.id === '') return null
  return `${moneybirdWebOrigin(apiBaseUrl)}/${administrationId}/${build(parsed.id)}`
}
