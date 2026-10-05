import {
  parseContact,
  parseFinancialAccount,
  parseFinancialMutation,
  parseGeneralDocument,
  parseJournalDocument,
  parseLedgerAccount,
  parsePurchaseInvoice,
  parseReceipt,
  parseSalesInvoice,
  parseTaxRate,
  type MoneybirdClient,
  type MoneybirdSnapshot,
  type MoneybirdUnreadableResource,
} from '@klopt/core'
import { collectAll, MoneybirdApiError } from './client.js'

/**
 * Reading one Moneybird administration into a snapshot.
 *
 * One pass, then never asked again: the planner is pure and the report a human
 * approves has to be the same thing that gets executed.
 *
 * Reference data first so a token with the wrong rights fails on a small
 * request. Booked history follows. One resource being refused is recorded on
 * the snapshot rather than throwing the rest away — unreadable is not empty.
 */

export interface ReadAdministrationRequest {
  readonly client: MoneybirdClient
  readonly administrationId: string
  readonly onProgress?: (resource: string, rows: number) => void
}

const DEGRADES: ReadonlySet<number> = new Set([403, 404])

export async function readAdministration(
  request: ReadAdministrationRequest,
): Promise<MoneybirdSnapshot> {
  const { client } = request
  const progress = request.onProgress ?? (() => {})
  const unreadable: MoneybirdUnreadableResource[] = []

  const administrations = await client.administrations()
  const administration = administrations.find((item) => item.id === request.administrationId)
  if (administration === undefined) {
    throw new MoneybirdApiError(
      `This token cannot reach Moneybird administration ${request.administrationId}.`,
      404,
      '/administrations.json',
    )
  }

  const read = async (path: string): Promise<readonly Record<string, unknown>[] | null> => {
    try {
      const rows = await collectAll(client, { administrationId: request.administrationId, path })
      progress(path, rows.length)
      return rows
    } catch (error: unknown) {
      if (!(error instanceof MoneybirdApiError) || !DEGRADES.has(error.status)) throw error
      unreadable.push({ resource: path, status: error.status, message: error.message })
      progress(path, 0)
      return null
    }
  }

  const ledgerAccounts = ((await read('ledger_accounts.json')) ?? []).map(parseLedgerAccount)
  const taxRates = ((await read('tax_rates.json')) ?? []).map(parseTaxRate)
  const contacts = ((await read('contacts.json')) ?? []).map(parseContact)
  const salesInvoices = ((await read('sales_invoices.json')) ?? []).map(parseSalesInvoice)
  const purchaseInvoices = ((await read('documents/purchase_invoices.json')) ?? []).map(
    parsePurchaseInvoice,
  )
  const receipts = ((await read('documents/receipts.json')) ?? []).map(parseReceipt)
  const financialAccounts = ((await read('financial_accounts.json')) ?? []).map(
    parseFinancialAccount,
  )
  const financialMutations = ((await read('financial_mutations.json')) ?? []).map(
    parseFinancialMutation,
  )
  const journalDocuments = ((await read('documents/general_journal_documents.json')) ?? []).map(
    parseJournalDocument,
  )
  const generalDocuments = ((await read('documents/general_documents.json')) ?? []).map(
    parseGeneralDocument,
  )

  return {
    administration,
    ledgerAccounts,
    taxRates,
    contacts,
    salesInvoices,
    purchaseInvoices,
    receipts,
    financialAccounts,
    financialMutations,
    journalDocuments,
    generalDocuments,
    unreadable,
  }
}
