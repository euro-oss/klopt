/**
 * Moneybird web UI URLs for "Open in Moneybird" on findings (issue #42 / PM #55).
 *
 * External ids from the plan look like `sales_invoice:301`. The API base
 * (`…/api/v2`) is not the human UI — strip that and build a document path.
 */

const PATH_BY_KIND: Readonly<Record<string, (id: string) => string>> = {
  sales_invoice: (id) => `sales_invoices/${id}`,
  credit_note: (id) => `sales_invoices/${id}`,
  purchase_invoice: (id) => `documents/purchase_invoices/${id}`,
  receipt: (id) => `documents/receipts/${id}`,
  journal: (id) => `documents/general_journal_documents/${id}`,
  bank_mutation: (id) => `financial_mutations/${id}`,
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
  const colon = externalId.indexOf(':')
  if (colon <= 0) return null
  const kind = externalId.slice(0, colon)
  const id = externalId.slice(colon + 1)
  const build = PATH_BY_KIND[kind]
  if (build === undefined || id === '') return null
  return `${moneybirdWebOrigin(apiBaseUrl)}/${administrationId}/${build(id)}`
}
