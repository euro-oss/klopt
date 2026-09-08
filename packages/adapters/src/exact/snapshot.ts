import {
  ATTACHMENT_SELECT,
  CRM_ACCOUNT_SELECT,
  DOCUMENT_SELECT,
  GL_ACCOUNT_SELECT,
  OPEN_ITEM_SELECT,
  PAYMENT_CONDITION_SELECT,
  REPORTING_BALANCE_SELECT,
  VAT_CODE_SELECT,
  parseAccount,
  parseAttachment,
  parseDocument,
  parseGLAccount,
  parseOpenItem,
  parsePaymentCondition,
  parseReportingBalance,
  parseVatCode,
  trialBalanceFilter,
  type ExactClient,
  type ExactDivision,
  type ExactSnapshot,
} from '@klopt/core'
import { collectAll } from './client.js'

/**
 * Reading one Exact division into a snapshot (spec 13).
 *
 * Eight resources, read in one pass, and then never asked again: the planner is
 * pure and the report a human approves has to be the same thing that gets
 * executed. Re-reading between preview and commit would mean approving one
 * administration and importing another.
 *
 * ## The order is not arbitrary
 *
 * The cheap reference data comes first — the chart of accounts, the VAT codes,
 * the payment conditions — so that a connection with the wrong rights fails on
 * a small request rather than halfway through five thousand relations.
 *
 * ## Documents are the expensive half, and optional
 *
 * A division with ten years of scanned purchase invoices has tens of thousands
 * of document rows and as many attachments. That is worth importing and it is
 * not worth doing on the way to a dry-run report, so `documents` is a flag and
 * the reconciliation does not depend on it.
 */

export interface ReadDivisionRequest {
  readonly client: ExactClient
  readonly division: ExactDivision
  /** The book year the trial balance is read for. */
  readonly year: number
  /** Read `documents/Documents` and its attachments too. Slow. */
  readonly documents?: boolean
  /**
   * Stop after this many document rows.
   *
   * A limit rather than none, because the dry run shows a sample and the
   * commit walks the whole set; an unbounded read here would make the preview
   * as expensive as the import.
   */
  readonly documentLimit?: number
  /** Called after each resource, so a screen can say what is happening. */
  readonly onProgress?: (resource: string, rows: number) => void
}

const DEFAULT_DOCUMENT_LIMIT = 500

export async function readDivision(request: ReadDivisionRequest): Promise<ExactSnapshot> {
  const { client, division, year } = request
  const code = division.code
  const progress = request.onProgress ?? (() => {})

  const read = async (
    path: string,
    select: readonly string[],
    options: { readonly filter?: string; readonly orderBy?: string } = {},
  ): Promise<readonly Record<string, unknown>[]> => {
    const rows = await collectAll(client, { division: code, path, select, ...options })
    progress(path, rows.length)
    return rows
  }

  // Reference data first: small, and it fails fast when the rights are wrong.
  const glAccounts = (
    await read('financial/GLAccounts', GL_ACCOUNT_SELECT, { orderBy: 'Code' })
  ).map(parseGLAccount)

  const vatCodes = (await read('vat/VATCodes', VAT_CODE_SELECT, { orderBy: 'Code' })).map(
    parseVatCode,
  )

  const paymentConditions = (
    await read('cashflow/PaymentConditions', PAYMENT_CONDITION_SELECT, { orderBy: 'Code' })
  ).map(parsePaymentCondition)

  // The trial balance for the year, both statuses. Exact's own note: "to get
  // 'after entry' results, both should be included", and a filter on processed
  // rows alone would understate every account that has unprocessed entries.
  const trialBalance = (
    await read('financial/ReportingBalance', REPORTING_BALANCE_SELECT, {
      filter: trialBalanceFilter(year),
    })
  ).map(parseReportingBalance)

  const accounts = (await read('crm/Accounts', CRM_ACCOUNT_SELECT, { orderBy: 'Code' })).map(
    parseAccount,
  )

  const receivables = (await read('read/financial/ReceivablesList', OPEN_ITEM_SELECT)).map(
    parseOpenItem,
  )

  const payables = (await read('read/financial/PayablesList', OPEN_ITEM_SELECT)).map(parseOpenItem)

  let documents: ExactSnapshot['documents'] = []
  let attachments: ExactSnapshot['attachments'] = []

  if (request.documents === true) {
    const limit = request.documentLimit ?? DEFAULT_DOCUMENT_LIMIT
    const rows = await collectAll(client, {
      division: code,
      path: 'documents/Documents',
      select: [...DOCUMENT_SELECT],
      orderBy: 'DocumentDate desc',
    })
    documents = rows.slice(0, limit).map(parseDocument)
    progress('documents/Documents', documents.length)

    // Attachments for the documents we kept, and only those. Reading every
    // attachment row in the division to throw most of them away is the kind of
    // thing that gets a client rate-limited for a day.
    const wanted = new Set(documents.map((document) => document.id))
    const attachmentRows = await collectAll(client, {
      division: code,
      path: 'documents/DocumentAttachments',
      select: [...ATTACHMENT_SELECT],
    })
    attachments = attachmentRows
      .map(parseAttachment)
      .filter((attachment) => wanted.has(attachment.documentId))
    progress('documents/DocumentAttachments', attachments.length)
  }

  return {
    division,
    glAccounts,
    vatCodes,
    accounts,
    paymentConditions,
    receivables,
    payables,
    trialBalance,
    year,
    documents,
    attachments,
  }
}
